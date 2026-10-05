import { DEFAULT_PROFILE } from '../data/applications/index.ts';
import type { ApplicationProfile } from '../data/applications/types.ts';
import { getFieldDef } from '../data/fields.ts';
import { componentRatioMismatch } from '../engine/derive.ts';
import { orderedFieldIds } from '../engine/missing.ts';
import { getPriority, isApplicable, isAskable } from '../engine/profileRules.ts';
import { getField, hasValue, isConflicted, setField } from '../models/brief.ts';
import type { ApplicationBrief, FieldId, Priority } from '../models/types.ts';
import { buildAskQuestion, buildConflictQuestion, buildMismatchQuestion, buildUnitQuestion } from './questionBank.ts';
import type { Question } from './types.ts';

const MISMATCH_ASKED = 'ASKED_RATIO_COMPONENTS';
const TIERS: Priority[] = ['REQUIRED', 'USEFUL', 'OPTIONAL'];

/** A clarification (conflict or missing unit) is asked at most this many times for one field. */
export const MAX_CLARIFICATION_ASKS = 2;

const asked = (brief: ApplicationBrief, id: FieldId): number => getField(brief, id).asked ?? 0;

/**
 * getNextQuestion(): the single most useful thing to ask next, or null when nothing is left.
 *
 * Order: (1) contradictions the user created, (2) missing units for values already given,
 * (3) missing fields by priority tier — REQUIRED, then USEFUL, then OPTIONAL — in profile order.
 * It never asks for something already known, already declared unknown, or already asked.
 */
export function getNextQuestion(brief: ApplicationBrief, profile: ApplicationProfile = DEFAULT_PROFILE): Question | null {
  const ids = orderedFieldIds(profile);

  // 1a. conflicting statements about one field
  for (const id of ids) {
    const field = getField(brief, id);
    if (getFieldDef(id).kind === 'unit' || !isConflicted(field) || field.userUnknown) continue;
    if (!isApplicable(profile, brief, id) || asked(brief, id) >= MAX_CLARIFICATION_ASKS) continue;
    return buildConflictQuestion(id, brief, getPriority(profile, brief, id) ?? 'REQUIRED');
  }

  // 1b. component count and ratio disagree
  const mismatch = componentRatioMismatch(brief);
  if (mismatch && !brief.metadata.signals.includes(MISMATCH_ASKED)) {
    return buildMismatchQuestion(mismatch.components, mismatch.terms, mismatch.ratio);
  }

  // 2. a value without a unit: ask only for the unit
  for (const id of ids) {
    if (getFieldDef(id).kind !== 'unit') continue;
    const priority = getPriority(profile, brief, id);
    if (!priority || priority === 'ENGINEER_REVIEW') continue;
    const field = getField(brief, id);
    if (hasValue(field) || isConflicted(field) || field.userUnknown || asked(brief, id) >= MAX_CLARIFICATION_ASKS) continue;
    const question = buildUnitQuestion(id, brief, priority);
    if (question) return question;
  }

  // 3. missing fields, tier by tier
  for (const tier of TIERS) {
    for (const id of profile.questionOrder) {
      if (!isAskable(profile, brief, id) || getPriority(profile, brief, id) !== tier) continue;
      const field = getField(brief, id);
      if (hasValue(field) || isConflicted(field) || field.userUnknown || asked(brief, id) > 0) continue;
      const question = buildAskQuestion(id, brief, tier);
      if (question) return question;
    }
  }
  return null;
}

/** Record that a question was shown, so the engine never asks the same thing forever. */
export function markAsked(brief: ApplicationBrief, question: Question): void {
  if (question.id === 'clarify:ratio-components') {
    if (!brief.metadata.signals.includes(MISMATCH_ASKED)) brief.metadata.signals.push(MISMATCH_ASKED);
    return;
  }
  const field = getField(brief, question.fieldId);
  setField(brief, question.fieldId, { ...field, asked: (field.asked ?? 0) + 1 });
}
