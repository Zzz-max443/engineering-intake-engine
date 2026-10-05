import { SIGNALS } from '../extraction/types.ts';
import { getField, hasValue, isConflicted, numberOf, setField, stringOf, unknownField } from '../models/brief.ts';
import type { ApplicationBrief, Field, FieldId } from '../models/types.ts';

/** Fields the engine may fill by itself. They are always recomputed from the user's current facts. */
const DERIVED_FIELDS: FieldId[] = ['mixing.ratioKnown', 'material.componentCount', 'automation.automationLevel'];

/** Number of terms in a stored ratio like "10:1" or "1:1:1". */
export function ratioTermCount(ratio: string | null): number {
  return ratio ? ratio.split(':').length : 0;
}

/**
 * Cross-field derivations (mutates `brief`). Everything produced here is either
 * trivially implied (ratioKnown) or explicitly INFERRED and flagged as unconfirmed.
 */
export function applyDerivations(brief: ApplicationBrief): void {
  // Start from the user's facts: drop what a previous pass derived.
  for (const id of DERIVED_FIELDS) {
    const f = getField(brief, id);
    if (f.derived) setField(brief, id, { ...unknownField(), ...(f.asked ? { asked: f.asked } : {}) });
  }

  // ratioKnown: only restates whether a ratio exists.
  const ratio = getField(brief, 'mixing.ratio');
  if (hasValue(ratio)) {
    setField(brief, 'mixing.ratioKnown', {
      value: true,
      status: 'KNOWN',
      origin: 'NORMALIZED',
      note: 'Derived from the stated ratio.',
      derived: true,
    });
  } else if (ratio.userUnknown) {
    setField(brief, 'mixing.ratioKnown', {
      value: false,
      status: 'KNOWN',
      origin: 'USER_STATED',
      note: 'The user stated the ratio is not known.',
      derived: true,
    });
  }

  // Component count: a guess from the ratio's terms, or from a reference to "Component B/C".
  const comps = getField(brief, 'material.componentCount');
  if (!hasValue(comps) && !isConflicted(comps)) {
    const terms = ratioTermCount(stringOf(brief, 'mixing.ratio'));
    const asked = comps.asked ? { asked: comps.asked } : {};
    if (terms >= 2) {
      const field: Field = {
        value: terms,
        status: 'INFERRED',
        origin: 'INFERRED',
        raw: ratio.raw ?? '',
        note: `Inferred from the ${terms}-term ratio "${String(ratio.value)}"; the number of components was not stated.`,
        derived: true,
        ...asked,
      };
      setField(brief, 'material.componentCount', field);
    } else if (brief.metadata.signals.includes(SIGNALS.MENTIONS_COMPONENT_B)) {
      const n = brief.metadata.signals.includes(SIGNALS.MENTIONS_COMPONENT_C) ? 3 : 2;
      setField(brief, 'material.componentCount', {
        value: n,
        status: 'INFERRED',
        origin: 'INFERRED',
        raw: '',
        note: `Inferred from a reference to Component ${n === 3 ? 'C' : 'B'}; the number of components was not stated.`,
        derived: true,
        ...asked,
      });
    }
  }

  // Robotic handling implies automation, but the user did not say "automated": INFERRED only.
  const level = getField(brief, 'automation.automationLevel');
  const robotic = getField(brief, 'automation.robotic');
  if (!hasValue(level) && !isConflicted(level) && !level.userUnknown && robotic.value === true) {
    setField(brief, 'automation.automationLevel', {
      value: 'Automated',
      status: 'INFERRED',
      origin: 'INFERRED',
      raw: robotic.raw ?? '',
      note: 'Inferred from robotic handling; the automation level was not stated.',
      derived: true,
      ...(level.asked ? { asked: level.asked } : {}),
    });
  }
}

/**
 * True when the stated component count and the ratio disagree (e.g. 3 components with ratio 10:1,
 * or a single component with a ratio at all). The user's own statements contradict each other.
 */
export function componentRatioMismatch(brief: ApplicationBrief): { components: number; terms: number; ratio: string } | null {
  const comps = getField(brief, 'material.componentCount');
  const count = numberOf(brief, 'material.componentCount');
  const ratio = stringOf(brief, 'mixing.ratio');
  if (count === null || ratio === null || comps.status === 'INFERRED') return null;
  const terms = ratioTermCount(ratio);
  return terms >= 2 && count >= 1 && terms !== count ? { components: count, terms, ratio } : null;
}
