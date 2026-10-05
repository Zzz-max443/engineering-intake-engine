import { DEFAULT_PROFILE } from '../data/applications/index.ts';
import type { ApplicationProfile } from '../data/applications/types.ts';
import { FIELD_DEFS, getFieldDef } from '../data/fields.ts';
import { getField, hasValue, isConflicted, numberOf } from '../models/brief.ts';
import type { ApplicationBrief, FieldId } from '../models/types.ts';
import { capitalize } from '../utils/text.ts';
import { componentRatioMismatch } from './derive.ts';
import { calculateMissingFields } from './missing.ts';
import { componentsPhrase, formatFieldValue } from './format.ts';

export type FlagSeverity = 'info' | 'warning';

export interface ReviewFlag {
  id: string;
  severity: FlagSeverity;
  message: string;
  fieldIds: FieldId[];
}

export const ENGINEER_REVIEW_STATEMENT =
  'Every brief requires review by a qualified Fluidic engineer before any equipment selection or quotation.';

/**
 * computeReviewFlags(): everything a human engineer must look at. Nothing here is decided by the
 * tool; it only lists what is inferred, ambiguous, contradictory, hazardous or simply unknown.
 */
export function computeReviewFlags(brief: ApplicationBrief, profile: ApplicationProfile = DEFAULT_PROFILE): ReviewFlag[] {
  const flags: ReviewFlag[] = [
    { id: 'ENGINEER_REQUIRED', severity: 'info', message: ENGINEER_REVIEW_STATEMENT, fieldIds: [] },
  ];

  const flaggedFields: FieldId[] = [];
  const inferredFields: FieldId[] = [];
  for (const def of FIELD_DEFS) {
    if (def.id === 'mixing.ratioKnown') continue;
    const field = getField(brief, def.id);
    if (isConflicted(field)) {
      flags.push({
        id: `CONFLICT:${def.id}`,
        severity: 'warning',
        message: `Conflicting statements for ${def.label.toLowerCase()}: ${(field.candidates ?? []).map((c) => String(c.value)).join(' vs ')}. Which one applies must be confirmed.`,
        fieldIds: [def.id],
      });
    } else if (field.status === 'REQUIRES_ENGINEER_REVIEW') {
      flaggedFields.push(def.id);
      flags.push({
        id: `REVIEW:${def.id}`,
        severity: 'warning',
        message: `${def.label}: ${field.note ?? 'requires engineer review.'}`,
        fieldIds: [def.id],
      });
    } else if (field.status === 'INFERRED' && hasValue(field)) {
      inferredFields.push(def.id);
    }
  }

  if (inferredFields.length > 0) {
    const items = inferredFields.map((id) => `${getFieldDef(id).shortLabel} = ${formatFieldValue(brief, id)}`);
    flags.push({
      id: 'INFERRED',
      severity: 'warning',
      message: `Inferred, not confirmed by the user: ${items.join('; ')}.`,
      fieldIds: inferredFields,
    });
  }

  const mismatch = componentRatioMismatch(brief);
  if (mismatch) {
    flags.push({
      id: 'RATIO_COMPONENT_MISMATCH',
      severity: 'warning',
      message: `${capitalize(componentsPhrase(mismatch.components))} ${mismatch.components === 1 ? 'was' : 'were'} stated but the ratio ${mismatch.ratio} has ${mismatch.terms} terms. Confirm the number of components or the ratio.`,
      fieldIds: ['material.componentCount', 'mixing.ratio'],
    });
  }

  // (With a ratio stated as well, the mismatch flag above is the one that applies.)
  if (numberOf(brief, 'material.componentCount') === 1 && !mismatch) {
    flags.push({
      id: 'SINGLE_COMPONENT',
      severity: 'warning',
      message: 'Single-component material stated. Mix ratio does not apply and the preliminary platform context (multi-component systems) is not shown; the engineer must confirm the intended equipment type.',
      fieldIds: ['material.componentCount'],
    });
  }

  if (getField(brief, 'properties.filled').value === true) {
    flags.push({
      id: 'FILLED_MATERIAL',
      severity: 'warning',
      message: 'Filled material stated. Abrasiveness and its implications were not assessed by this tool; the engineer must evaluate them.',
      fieldIds: ['properties.filled'],
    });
  }

  const unknownByUser = calculateMissingFields(brief, profile).filter((m) => m.priority === 'REQUIRED' && m.reason === 'USER_UNKNOWN');
  if (unknownByUser.length > 0) {
    flags.push({
      id: 'USER_UNKNOWN',
      severity: 'info',
      message: `The user does not know yet: ${unknownByUser.map((m) => m.label).join(', ')}.`,
      fieldIds: unknownByUser.map((m) => m.fieldId),
    });
  }

  for (const note of brief.metadata.capturedNotes) {
    flags.push({ id: `NOTE:${note.slice(0, 24)}`, severity: 'info', message: note, fieldIds: [] });
  }

  return flags;
}
