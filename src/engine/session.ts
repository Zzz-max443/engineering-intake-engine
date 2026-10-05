import { DEFAULT_PROFILE } from '../data/applications/index.ts';
import type { ApplicationProfile } from '../data/applications/types.ts';
import { FIELD_DEFS, getFieldDef } from '../data/fields.ts';
import { runExtractor } from '../extraction/index.ts';
import type { ExtractedValue, ExtractionResult } from '../extraction/types.ts';
import { createEmptyBrief, getField, hasValue, isConflicted, setField } from '../models/brief.ts';
import type { ApplicationBrief, FieldId, FieldStatus } from '../models/types.ts';
import { getNextQuestion, interpretAnswer, markAsked, MAX_CLARIFICATION_ASKS } from '../questions/index.ts';
import type { Question } from '../questions/types.ts';
import { calculateCompleteness } from './completeness.ts';
import { applyDerivations } from './derive.ts';
import { describeProvenance, formatFieldValue } from './format.ts';
import { applyExtraction } from './merge.ts';
import type { AppliedChange } from './merge.ts';
import { missingRequiredIds } from './missing.ts';
import { fieldViewStatus } from './viewStatus.ts';

export type Phase = 'AWAITING_DESCRIPTION' | 'ASKING' | 'COMPLETE';

/** One thing the engine understood, shown to the user as "Got it. I have identified: ...". */
export interface UnderstoodItem {
  fieldId: FieldId;
  label: string;
  value: string;
  status: FieldStatus;
  note?: string;
}

export type TranscriptEntry =
  | { id: number; type: 'user'; text: string }
  | { id: number; type: 'understood'; intro: string; items: UnderstoodItem[]; outro?: string }
  | { id: number; type: 'question'; question: Question }
  | { id: number; type: 'notice'; tone: 'info' | 'warning'; text: string }
  | { id: number; type: 'complete'; text: string };

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type NewEntry = DistributiveOmit<TranscriptEntry, 'id'>;

const UNKNOWN_ANSWER_TEXT = "I don't know";

/**
 * The intake conversation. It owns the brief and the transcript and nothing else: all parsing,
 * merging, prioritising and asking is delegated to the engine functions, and the UI only
 * reads this object and calls submit() / skip() / markUnknown() / finish() / reset().
 */
export class IntakeSession {
  brief: ApplicationBrief;
  readonly profile: ApplicationProfile;
  transcript: TranscriptEntry[] = [];
  currentQuestion: Question | null = null;
  phase: Phase = 'AWAITING_DESCRIPTION';

  private nextEntryId = 1;
  private attempts = 0;
  private requiredAnnounced = false;
  /** Set by finish(): the user closed the intake, so no further questions are asked until reset(). */
  private closed = false;
  private readonly listeners = new Set<() => void>();

  constructor(profile: ApplicationProfile = DEFAULT_PROFILE) {
    this.profile = profile;
    this.brief = createEmptyBrief();
    this.afterChange(); // metadata (missing required fields, confidence) is accurate from the start
  }

  // ---- subscription ------------------------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private push(entry: NewEntry): void {
    this.transcript.push({ ...entry, id: this.nextEntryId++ } as TranscriptEntry);
  }

  // ---- public actions ----------------------------------------------------------------------

  reset(): void {
    this.brief = createEmptyBrief();
    this.afterChange();
    this.transcript = [];
    this.currentQuestion = null;
    this.phase = 'AWAITING_DESCRIPTION';
    this.attempts = 0;
    this.requiredAnnounced = false;
    this.closed = false;
    this.emit();
  }

  /** Free-text description, an answer to the current question, or extra information after completion. */
  async submit(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text) return;
    this.brief.metadata.messageCount += 1;
    const messageNo = this.brief.metadata.messageCount;
    this.push({ type: 'user', text });
    this.emit(); // show the message at once, even if the active extractor takes a while

    if (this.phase === 'AWAITING_DESCRIPTION') {
      setField(this.brief, 'application.description', { value: text, status: 'KNOWN', origin: 'USER_STATED', raw: text });
      const result = await runExtractor(text, { profile: this.profile, brief: this.brief });
      const changes = applyExtraction(this.brief, result, messageNo);
      this.afterChange();
      this.announce(changes, true);
      this.advance();
      return;
    }

    const question = this.currentQuestion;
    if (!question) {
      const result = await runExtractor(text, { profile: this.profile, brief: this.brief });
      const changes = applyExtraction(this.brief, result, messageNo);
      this.afterChange();
      this.announce(changes, false);
      this.advance();
      return;
    }
    await this.handleAnswer(question, text, messageNo);
  }

  skip(): Promise<void> {
    return this.submit('skip');
  }

  markUnknown(): Promise<void> {
    return this.submit(UNKNOWN_ANSWER_TEXT);
  }

  /** The user closes the intake now; whatever is missing stays "Not provided". */
  finish(): void {
    if (this.phase !== 'ASKING') return;
    this.closed = true;
    this.currentQuestion = null;
    this.phase = 'COMPLETE';
    const missing = missingRequiredIds(this.brief, this.profile).length;
    this.push({
      type: 'complete',
      text:
        missing > 0
          ? `Intake closed. ${missing} required ${missing === 1 ? 'field is' : 'fields are'} still missing and will appear as "Not provided" in the RFQ draft. Engineer review is required.`
          : 'Intake closed. The Engineering Brief and RFQ draft are ready for engineer review.',
    });
    this.emit();
  }

  /** Company / contact / notes typed into the RFQ panel. Empty text clears the field. */
  setRfqDetail(which: 'company' | 'contactName' | 'additionalNotes', text: string): void {
    const id: FieldId = which === 'additionalNotes' ? 'notes.additionalNotes' : which === 'company' ? 'contact.company' : 'contact.contactName';
    const value = text.trim();
    const current = getField(this.brief, id);
    setField(
      this.brief,
      id,
      value
        ? { value, status: 'KNOWN', origin: 'USER_STATED', raw: value, ...(current.asked ? { asked: current.asked } : {}) }
        : { value: null, status: 'UNKNOWN', origin: 'NONE', ...(current.asked ? { asked: current.asked } : {}) },
    );
    this.emit();
  }

  // ---- internals ---------------------------------------------------------------------------

  private async handleAnswer(question: Question, text: string, messageNo: number): Promise<void> {
    const outcome = interpretAnswer(question, text, this.brief, this.profile);

    if (outcome.type === 'unknown') {
      this.declareUnknown(question, messageNo);
      this.attempts = 0;
      this.advance();
      return;
    }
    if (outcome.type === 'skip') {
      this.attempts = 0;
      this.settle(question);
      this.advance();
      return;
    }

    // Read the reply for anything else it says ("10:1, and the viscosity is 5000 cP").
    const general = await runExtractor(text, { profile: this.profile, brief: this.brief, expecting: question.fieldId });
    const targeted: ExtractedValue[] = outcome.type === 'values' ? outcome.values : [];
    const targetedIds = new Set(targeted.map((v) => v.fieldId));
    const merged: ExtractionResult = {
      values: [...targeted, ...general.values.filter((v) => !targetedIds.has(v.fieldId))],
      signals: general.signals,
      capturedNotes: general.capturedNotes,
    };
    const changes = applyExtraction(this.brief, merged, messageNo);
    this.afterChange();

    if (this.isAnswered(question)) {
      this.attempts = 0;
      this.announce(changes, false);
      this.advance();
      return;
    }

    // Not understood: keep what else was learned, then retry once before giving up.
    this.attempts += 1;
    if (changes.length > 0) this.announce(changes, false);
    if (this.attempts >= 2) {
      this.attempts = 0;
      this.settle(question);
      this.push({
        type: 'notice',
        tone: 'warning',
        text: `I could not read that, so ${getFieldDef(question.fieldId).shortLabel.toLowerCase()} stays "Not provided". It will be flagged for the engineer.`,
      });
      this.advance();
      return;
    }
    this.push({ type: 'notice', tone: 'warning', text: outcome.type === 'invalid' ? outcome.hint : 'That did not answer the question.' });
    this.emit();
  }

  /** Did the reply settle the question that was asked? */
  private isAnswered(question: Question): boolean {
    if (question.id === 'clarify:ratio-components') return true; // asked once; a mismatch stays flagged for review
    const field = getField(this.brief, question.fieldId);
    if (question.mode === 'CLARIFY') return hasValue(field) && !isConflicted(field);
    if (hasValue(field)) return true;
    // A qualitative or ranged reply is an answer: it is recorded for the engineer, not re-asked.
    return field.status === 'REQUIRES_ENGINEER_REVIEW' && Boolean(field.raw) && !isConflicted(field);
  }

  /**
   * The user declined (or could not answer) a clarification: it stays flagged for the engineer and
   * is not asked again. Plain questions need no bookkeeping — each field is asked once anyway.
   */
  private settle(question: Question): void {
    if (question.mode === 'ASK' || question.id === 'clarify:ratio-components') return;
    const field = getField(this.brief, question.fieldId);
    setField(this.brief, question.fieldId, { ...field, asked: Math.max(field.asked ?? 0, MAX_CLARIFICATION_ASKS) });
  }

  private declareUnknown(question: Question, messageNo: number): void {
    if (question.id === 'clarify:ratio-components') return;
    const value: ExtractedValue = {
      fieldId: question.fieldId,
      value: null,
      status: 'UNKNOWN',
      origin: 'USER_STATED',
      raw: UNKNOWN_ANSWER_TEXT,
      note: 'The user does not know this yet.',
      userUnknown: true,
    };
    applyExtraction(this.brief, { values: [value], signals: [], capturedNotes: [] }, messageNo);
    this.afterChange();
  }

  private afterChange(): void {
    applyDerivations(this.brief);
    const completeness = calculateCompleteness(this.brief, this.profile);
    this.brief.metadata.engineerReviewRequired = true;
    this.brief.metadata.confidence = completeness.confidence;
    this.brief.metadata.missingRequiredFields = missingRequiredIds(this.brief, this.profile);
  }

  /** Tell the user what was understood from their last message. */
  private announce(changes: AppliedChange[], first: boolean): void {
    const items = this.toItems(changes);
    // The tool-scope assumption for the application is not something the user said: on its own it is not "understood".
    const informative = items.filter((item) => !(item.fieldId === 'application.category' && item.status === 'INFERRED'));
    if (informative.length === 0) {
      this.push({
        type: 'notice',
        tone: 'info',
        text: first
          ? 'I could not extract technical details from that description, so nothing was filled in. This version reads English descriptions only. Add what you know — material, ratio, production, shot size, automation — or answer the questions below.'
          : 'I did not find new technical data in that message.',
      });
      return;
    }
    const more = !this.closed && getNextQuestion(this.brief, this.profile) !== null;
    this.push({
      type: 'understood',
      intro: first ? 'Got it. I have identified:' : 'Noted:',
      items,
      ...(more && first ? { outro: 'I still need a few details.' } : {}),
    });
  }

  private toItems(changes: AppliedChange[]): UnderstoodItem[] {
    const changed = new Set(changes.map((c) => c.fieldId));
    const items: UnderstoodItem[] = [];
    for (const def of FIELD_DEFS) {
      if (!changed.has(def.id)) continue;
      const change = changes.find((c) => c.fieldId === def.id);
      if (!change) continue;
      if (def.id === 'application.subcategory') continue; // folded into the Application item
      if (def.kind === 'unit' && (def.unitFor ?? []).some((id) => changed.has(id))) continue; // folded into the value
      const field = getField(this.brief, def.id);
      // The same state the Engineering Brief shows (a count that contradicts the ratio is "needs review", not "known").
      const view = fieldViewStatus(this.brief, def.id);
      const status: FieldStatus = change.kind === 'DECLARED_UNKNOWN' ? 'UNKNOWN' : view;
      const contradicted = view === 'REQUIRES_ENGINEER_REVIEW' && field.status !== 'REQUIRES_ENGINEER_REVIEW' && !isConflicted(field);
      const note = contradicted ? describeProvenance(this.brief, def.id) : field.note;
      let value = formatFieldValue(this.brief, def.id, 'Not known yet');
      if (def.id === 'application.category') {
        const sub = getField(this.brief, 'application.subcategory').value;
        value = typeof sub === 'string' ? `${String(field.value)} (${sub})` : value;
      }
      if (change.kind === 'DECLARED_UNKNOWN') value = 'Not known yet (noted)';
      items.push({ fieldId: def.id, label: def.shortLabel, value, status, ...(note ? { note } : {}) });
    }
    return items;
  }

  /** Ask the next question, or complete the intake. */
  private advance(): void {
    const next = this.closed ? null : getNextQuestion(this.brief, this.profile);
    if (!next) {
      this.currentQuestion = null;
      const alreadyComplete = this.phase === 'COMPLETE';
      this.phase = 'COMPLETE';
      if (!alreadyComplete) {
        this.push({
          type: 'complete',
          text: 'Intake complete. The Engineering Brief and RFQ draft are ready for engineer review. You can still add information at any time.',
        });
      }
      this.emit();
      return;
    }
    if (!this.requiredAnnounced && next.priority !== 'REQUIRED' && this.brief.metadata.missingRequiredFields.length === 0) {
      this.requiredAnnounced = true;
      this.push({
        type: 'notice',
        tone: 'info',
        text: 'Every required detail has been addressed. The remaining questions are optional — you can finish at any time.',
      });
    }
    markAsked(this.brief, next);
    this.currentQuestion = next;
    this.phase = 'ASKING';
    this.push({ type: 'question', question: next });
    this.emit();
  }
}
