import { CHEMISTRY_LABELS, getFieldDef } from '../data/fields.ts';
import { getField, hasValue, isConflicted, numberOf, stringOf } from '../models/brief.ts';
import type { ApplicationBrief, FieldId } from '../models/types.ts';
import { APPROXIMATE_NOTE, capitalize, formatNumber } from '../utils/text.ts';
import { componentRatioMismatch } from './derive.ts';
import { MISMATCH_FIELDS } from './viewStatus.ts';

export const NOT_PROVIDED = 'Not provided';

/** "a single component" / "2 components" — for sentences about the component count. */
export function componentsPhrase(count: number): string {
  return count === 1 ? 'a single component' : `${count} components`;
}

export function chemistryLabel(value: string): string {
  return CHEMISTRY_LABELS[value] ?? capitalize(value);
}

/**
 * Human-readable value of one field. Unknown fields render as `empty` ("Not provided" in the RFQ,
 * "Unknown" in the live brief). Values are never filled in or estimated here.
 */
export function formatFieldValue(brief: ApplicationBrief, id: FieldId, empty: string = NOT_PROVIDED): string {
  const field = getField(brief, id);
  const def = getFieldDef(id);

  if (isConflicted(field)) {
    return `${empty} (conflicting statements: ${(field.candidates ?? []).map((c) => String(c.value)).join(' vs ')})`;
  }
  if (!hasValue(field)) {
    return field.raw && field.status === 'REQUIRES_ENGINEER_REVIEW' ? `${empty} (user said: “${field.raw}”)` : empty;
  }

  const value = field.value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  if (def.kind === 'number' && typeof value === 'number') {
    // "approximately 15 grams" stays approximate everywhere it is shown.
    const approximate = field.note?.includes(APPROXIMATE_NOTE) ? ' (approximate)' : '';
    const text = formatNumber(value);
    if (!def.unitField) return `${text}${approximate}`;
    const unit = stringOf(brief, def.unitField);
    if (unit) return `${text} ${unit}${approximate}`;
    return field.raw ? `${text}${approximate} (unit not confirmed — stated as “${field.raw}”)` : `${text}${approximate} (unit not provided)`;
  }

  if (id === 'material.chemistry' && typeof value === 'string') return chemistryLabel(value);
  if (id === 'material.componentCount') return String(value);
  if (def.kind === 'text' && typeof value === 'string') return capitalize(value);
  return String(value);
}

/** "2-component epoxy" — combines component count and chemistry without inventing either. */
export function formatMaterial(brief: ApplicationBrief, empty: string = NOT_PROVIDED): string {
  const count = numberOf(brief, 'material.componentCount');
  const chemistry = stringOf(brief, 'material.chemistry');
  const name = stringOf(brief, 'material.materialName');
  let text: string;
  if (count !== null && chemistry) text = `${count}-component ${chemistryLabel(chemistry).toLowerCase()}`;
  else if (chemistry) text = chemistryLabel(chemistry);
  else if (count !== null) text = `${count}-component (chemistry not provided)`;
  else text = empty;
  if (name && text !== empty) text += ` — ${name}`;
  else if (name) text = name;
  return text;
}

/** One-line summary of a field's origin for tooltips and the field table. */
export function describeProvenance(brief: ApplicationBrief, id: FieldId): string {
  const field = getField(brief, id);
  if (isConflicted(field)) return 'Conflicting statements — needs clarification';
  if (MISMATCH_FIELDS.includes(id) && hasValue(field)) {
    const mismatch = componentRatioMismatch(brief);
    if (mismatch) {
      return `${capitalize(componentsPhrase(mismatch.components))} stated, but the ratio ${mismatch.ratio} has ${mismatch.terms} terms — confirm which is correct.`;
    }
  }
  if (field.status === 'REQUIRES_ENGINEER_REVIEW') return field.note ?? 'Requires engineer review';
  if (field.status === 'INFERRED') return field.note ?? 'Inferred — not confirmed';
  if (field.status === 'KNOWN') {
    const base = field.origin === 'NORMALIZED' ? 'Stated by the user, normalized' : 'Stated by the user';
    return field.raw ? `${base}: “${field.raw}”` : base;
  }
  return field.userUnknown ? 'User does not know yet' : 'Not provided';
}
