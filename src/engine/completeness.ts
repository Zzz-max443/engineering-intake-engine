import { DEFAULT_PROFILE } from '../data/applications/index.ts';
import type { ApplicationProfile } from '../data/applications/types.ts';
import { getFieldDef } from '../data/fields.ts';
import { getField, hasValue } from '../models/brief.ts';
import type { ApplicationBrief, Confidence, FieldId, Priority } from '../models/types.ts';
import { calculateMissingFields, countsTowardCompleteness, orderedFieldIds } from './missing.ts';
import type { MissingField } from './missing.ts';
import { getPriority } from './profileRules.ts';
import { fieldViewStatus } from './viewStatus.ts';

export interface ListedField {
  fieldId: FieldId;
  label: string;
}

export interface CompletenessReport {
  /** 0–100. A visual indicator of how filled-in the form is — not a technical measure. */
  percent: number;
  known: ListedField[];
  inferred: ListedField[];
  needsReview: ListedField[];
  missing: MissingField[];
  required: { total: number; provided: number };
  /** Qualitative label from the share of REQUIRED fields provided. Not a technical assessment. */
  confidence: Confidence;
  note: string;
}

const WEIGHT: Record<Priority, number> = { REQUIRED: 3, USEFUL: 2, OPTIONAL: 1, ENGINEER_REVIEW: 0 };

export const COMPLETENESS_NOTE =
  'Visual indicator of how much of the form is filled in. It is not a technical or scientific measure.';

/** Credit for one field: stated = full, inferred or flagged-for-review = half, nothing = zero. */
function credit(brief: ApplicationBrief, id: FieldId): number {
  const field = getField(brief, id);
  if (!hasValue(field)) return 0;
  return fieldViewStatus(brief, id) === 'KNOWN' ? 1 : 0.5;
}

export function calculateCompleteness(brief: ApplicationBrief, profile: ApplicationProfile = DEFAULT_PROFILE): CompletenessReport {
  let total = 0;
  let earned = 0;
  let requiredTotal = 0;
  let requiredEarned = 0;
  // For display only: required fields as the user sees them (a value and its unit count once).
  let requiredShown = 0;
  let requiredShownProvided = 0;
  const known: ListedField[] = [];
  const inferred: ListedField[] = [];
  const needsReview: ListedField[] = [];

  for (const id of orderedFieldIds(profile)) {
    const priority = getPriority(profile, brief, id);
    const counts = countsTowardCompleteness(profile, brief, id);
    const field = getField(brief, id);
    // A field that does not apply but that the user stated anyway (e.g. a ratio for a single component)
    // earns no credit, yet it is still listed, so that it is never hidden.
    const statedAnyway = priority === null && hasValue(field);
    if (!counts && !statedAnyway) continue;

    if (counts && priority) {
      const weight = WEIGHT[priority];
      const c = credit(brief, id);
      total += weight;
      earned += weight * c;
      if (priority === 'REQUIRED') {
        requiredTotal += weight;
        requiredEarned += weight * c;
        if (getFieldDef(id).kind !== 'unit') {
          requiredShown += 1;
          if (c > 0) requiredShownProvided += 1;
        }
      }
    }

    const def = getFieldDef(id);
    if (!hasValue(field) || def.kind === 'unit') continue; // units are not listed on their own
    const entry = { fieldId: id, label: def.shortLabel };
    const view = fieldViewStatus(brief, id);
    if (view === 'KNOWN') known.push(entry);
    else if (view === 'INFERRED') inferred.push(entry);
    else if (view === 'REQUIRES_ENGINEER_REVIEW') needsReview.push(entry);
  }

  const requiredShare = requiredTotal === 0 ? 0 : requiredEarned / requiredTotal;
  const confidence: Confidence = requiredShare >= 0.99 ? 'HIGH' : requiredShare >= 0.6 ? 'MEDIUM' : 'LOW';

  return {
    percent: total === 0 ? 0 : Math.round((100 * earned) / total),
    known,
    inferred,
    needsReview,
    missing: calculateMissingFields(brief, profile),
    required: { total: requiredShown, provided: requiredShownProvided },
    confidence,
    note: COMPLETENESS_NOTE,
  };
}
