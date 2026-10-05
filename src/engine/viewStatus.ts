import { getField, hasValue, isConflicted } from '../models/brief.ts';
import type { ApplicationBrief, FieldId, FieldStatus } from '../models/types.ts';
import { componentRatioMismatch } from './derive.ts';

/** The two fields that contradict each other when the component count and the ratio terms disagree. */
export const MISMATCH_FIELDS: readonly FieldId[] = ['material.componentCount', 'mixing.ratio'];

/**
 * Effective state of one field for display and completeness. It is the stored state, except that
 * values the user contradicted (conflicting statements, or a component count that disagrees with
 * the ratio) are never shown as plain KNOWN: they need an engineer.
 */
export function fieldViewStatus(brief: ApplicationBrief, id: FieldId): FieldStatus {
  const field = getField(brief, id);
  if (isConflicted(field)) return 'REQUIRES_ENGINEER_REVIEW';
  if (hasValue(field)) {
    if (MISMATCH_FIELDS.includes(id) && componentRatioMismatch(brief)) return 'REQUIRES_ENGINEER_REVIEW';
    return field.status === 'UNKNOWN' ? 'KNOWN' : field.status;
  }
  if (field.status === 'REQUIRES_ENGINEER_REVIEW' && field.raw) return 'REQUIRES_ENGINEER_REVIEW';
  return 'UNKNOWN';
}
