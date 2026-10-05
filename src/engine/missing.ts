import { DEFAULT_PROFILE } from '../data/applications/index.ts';
import type { ApplicationProfile } from '../data/applications/types.ts';
import { FIELD_DEFS, getFieldDef } from '../data/fields.ts';
import { getField, hasValue, isConflicted } from '../models/brief.ts';
import type { ApplicationBrief, FieldId, Priority } from '../models/types.ts';
import { getPriority, isAskable, isDerivedField } from './profileRules.ts';

export type MissingReason =
  /** Nobody mentioned it. */
  | 'NOT_PROVIDED'
  /** The user said they do not know it (yet). */
  | 'USER_UNKNOWN'
  /** The user gave something qualitative or a range; a precise value is still missing. */
  | 'NEEDS_DETAIL'
  /** The user's statements contradict each other. */
  | 'CONFLICT';

export interface MissingField {
  fieldId: FieldId;
  label: string;
  priority: Priority;
  reason: MissingReason;
  /** Context for the engineer (what the user actually said). */
  detail?: string;
}

const TIER_ORDER: Record<Priority, number> = { REQUIRED: 0, USEFUL: 1, OPTIONAL: 2, ENGINEER_REVIEW: 3 };

/** Profile question order first, then every other field in catalog order. */
export function orderedFieldIds(profile: ApplicationProfile): FieldId[] {
  const seen = new Set<FieldId>(profile.questionOrder);
  const rest = FIELD_DEFS.map((d) => d.id).filter((id) => !seen.has(id));
  return [...profile.questionOrder, ...rest];
}

/**
 * Fields that count for completeness and the missing list: applicable, not derived, and not
 * ENGINEER_REVIEW. OPTIONAL fields count only when the engine would actually ask for them;
 * capture-only optional fields (conveyor, cycle time...) matter only if the user mentions them.
 */
export function countsTowardCompleteness(profile: ApplicationProfile, brief: ApplicationBrief, id: FieldId): boolean {
  const priority = getPriority(profile, brief, id);
  if (!priority || priority === 'ENGINEER_REVIEW' || isDerivedField(profile, id)) return false;
  return priority !== 'OPTIONAL' || isAskable(profile, brief, id);
}

/** calculateMissingFields(): what the brief still lacks, most important first. */
export function calculateMissingFields(brief: ApplicationBrief, profile: ApplicationProfile = DEFAULT_PROFILE): MissingField[] {
  const missing: MissingField[] = [];
  for (const id of orderedFieldIds(profile)) {
    if (!countsTowardCompleteness(profile, brief, id)) continue;
    const field = getField(brief, id);
    if (hasValue(field)) continue;
    const priority = getPriority(profile, brief, id);
    if (!priority) continue;

    let reason: MissingReason = 'NOT_PROVIDED';
    if (isConflicted(field)) reason = 'CONFLICT';
    else if (field.status === 'REQUIRES_ENGINEER_REVIEW' && field.raw) reason = 'NEEDS_DETAIL';
    else if (field.userUnknown) reason = 'USER_UNKNOWN';

    missing.push({
      fieldId: id,
      label: getFieldDef(id).shortLabel,
      priority,
      reason,
      ...(field.note && reason !== 'NOT_PROVIDED' ? { detail: field.note } : {}),
    });
  }
  return missing.sort((a, b) => TIER_ORDER[a.priority] - TIER_ORDER[b.priority]);
}

export function missingRequiredIds(brief: ApplicationBrief, profile: ApplicationProfile = DEFAULT_PROFILE): FieldId[] {
  return calculateMissingFields(brief, profile)
    .filter((m) => m.priority === 'REQUIRED')
    .map((m) => m.fieldId);
}
