import { getField, hasValue, setField } from '../models/brief.ts';
import type { ApplicationBrief, Candidate, Field, FieldId, FieldStatus, Origin, Primitive } from '../models/types.ts';
import type { ExtractedValue, ExtractionResult } from '../extraction/types.ts';
import { joinNotes } from '../utils/text.ts';

export type ChangeKind = 'SET' | 'UPDATED' | 'CONFLICT' | 'DECLARED_UNKNOWN' | 'NEEDS_DETAIL';

/** What merging did to one field; the UI uses this to say what the system "understood". */
export interface AppliedChange {
  fieldId: FieldId;
  kind: ChangeKind;
  value: Primitive | null;
  status: FieldStatus;
  origin: Origin;
  raw: string;
  note?: string;
  previous?: Primitive | null;
}

/** A guess ranks below anything the user actually stated. */
const rank = (status: FieldStatus): number => (status === 'INFERRED' ? 1 : 3);

/**
 * Merge extractor output into the brief (mutates `brief`).
 * Rules:
 *  - a guess (INFERRED) never overrides a value the user stated;
 *  - a newer stated value replaces an older one and says so in the note;
 *  - two different stated values inside one message are a CONFLICT: the value stays null, both
 *    candidates are kept, and the engine will ask which one applies — it never picks for the user;
 *  - qualitative / range / "I don't know" statements never create numeric values.
 */
export function applyExtraction(brief: ApplicationBrief, result: ExtractionResult, message: number): AppliedChange[] {
  const groups = new Map<FieldId, ExtractedValue[]>();
  for (const v of result.values) {
    const list = groups.get(v.fieldId);
    if (list) list.push(v);
    else groups.set(v.fieldId, [v]);
  }

  const changes: AppliedChange[] = [];
  for (const [fieldId, list] of groups) {
    const valued = list.filter((v) => v.value !== null);
    const change = valued.length > 0 ? mergeValued(brief, fieldId, valued, message) : mergeValueless(brief, fieldId, list);
    if (change) changes.push(change);
  }

  for (const signal of result.signals) {
    if (!brief.metadata.signals.includes(signal)) brief.metadata.signals.push(signal);
  }
  for (const note of result.capturedNotes) {
    if (!brief.metadata.capturedNotes.includes(note)) brief.metadata.capturedNotes.push(note);
  }
  return changes;
}

function mergeValued(brief: ApplicationBrief, fieldId: FieldId, valued: ExtractedValue[], message: number): AppliedChange | null {
  const current = getField(brief, fieldId);
  const top = Math.max(...valued.map((v) => rank(v.status)));
  const strongest = valued.filter((v) => rank(v.status) === top);

  const distinct = new Map<string, ExtractedValue>();
  for (const v of strongest) {
    const key = String(v.value);
    const seen = distinct.get(key);
    if (!seen || v.status === 'REQUIRES_ENGINEER_REVIEW') distinct.set(key, v);
  }
  const options = Array.from(distinct.values());

  if (options.length > 1) {
    const candidates: Candidate[] = options.map((v) => ({ value: v.value as Primitive, raw: v.raw }));
    const field: Field = {
      value: null,
      status: 'REQUIRES_ENGINEER_REVIEW',
      origin: 'USER_STATED',
      raw: candidates.map((c) => c.raw).join(' / '),
      note: `Conflicting statements: ${candidates.map((c) => String(c.value)).join(' vs ')}.`,
      candidates,
      ...(current.asked ? { asked: current.asked } : {}),
    };
    setField(brief, fieldId, field);
    return { fieldId, kind: 'CONFLICT', value: null, status: field.status, origin: field.origin, raw: field.raw ?? '', ...(field.note ? { note: field.note } : {}) };
  }

  const candidate = options[0];
  if (!candidate) return null;

  const same = hasValue(current) && String(current.value) === String(candidate.value);
  if (hasValue(current) && candidate.status === 'INFERRED') return null; // a guess never overrides a stated value
  if (same) {
    const upgrade = current.status === 'INFERRED' && candidate.status !== 'INFERRED';
    const newlyFlagged = current.status !== 'REQUIRES_ENGINEER_REVIEW' && candidate.status === 'REQUIRES_ENGINEER_REVIEW';
    if (!upgrade && !newlyFlagged) return null;
  }

  const kind: ChangeKind = hasValue(current) && !same ? 'UPDATED' : 'SET';
  const previous = current.value;
  const note = joinNotes(kind === 'UPDATED' ? `Updated: previously ${String(previous)}.` : undefined, candidate.note);
  const field: Field = {
    value: candidate.value,
    status: candidate.status,
    origin: candidate.origin,
    raw: candidate.raw,
    ...(note ? { note } : {}),
    ...(current.asked ? { asked: current.asked } : {}),
  };
  setField(brief, fieldId, field);
  if (candidate.raw) {
    brief.metadata.sourceOfInformation.push({ fieldId, origin: candidate.origin, raw: candidate.raw, message });
  }
  return {
    fieldId,
    kind,
    value: candidate.value,
    status: candidate.status,
    origin: candidate.origin,
    raw: candidate.raw,
    ...(note ? { note } : {}),
    ...(kind === 'UPDATED' ? { previous } : {}),
  };
}

/** Statements without a value: "I don't know it yet", "high viscosity", "50-100 cc/min". */
function mergeValueless(brief: ApplicationBrief, fieldId: FieldId, list: ExtractedValue[]): AppliedChange | null {
  const current = getField(brief, fieldId);
  if (hasValue(current)) return null; // never degrade a known value

  const detail = list.find((v) => v.status === 'REQUIRES_ENGINEER_REVIEW');
  const declared = list.find((v) => v.userUnknown);
  const asked = current.asked ? { asked: current.asked } : {};

  if (detail) {
    const field: Field = {
      value: null,
      status: 'REQUIRES_ENGINEER_REVIEW',
      origin: 'USER_STATED',
      raw: detail.raw,
      ...(detail.note ? { note: detail.note } : {}),
      ...(declared ? { userUnknown: true } : {}),
      ...asked,
    };
    setField(brief, fieldId, field);
    return { fieldId, kind: 'NEEDS_DETAIL', value: null, status: field.status, origin: field.origin, raw: detail.raw, ...(detail.note ? { note: detail.note } : {}) };
  }

  if (declared) {
    const keepsDetail = current.status === 'REQUIRES_ENGINEER_REVIEW' && Boolean(current.raw);
    const field: Field = keepsDetail
      ? { ...current, userUnknown: true }
      : {
          value: null,
          status: 'UNKNOWN',
          origin: 'USER_STATED',
          raw: declared.raw,
          ...(declared.note ? { note: declared.note } : {}),
          userUnknown: true,
          ...asked,
        };
    setField(brief, fieldId, field);
    return { fieldId, kind: 'DECLARED_UNKNOWN', value: null, status: field.status, origin: field.origin, raw: declared.raw, ...(declared.note ? { note: declared.note } : {}) };
  }
  return null;
}
