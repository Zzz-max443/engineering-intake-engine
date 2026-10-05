import { getFieldDef } from '../data/fields.ts';
import { getField, numberOf } from '../models/brief.ts';
import type { ApplicationBrief, FieldId, Priority } from '../models/types.ts';
import { chemistryLabel, componentsPhrase } from '../engine/format.ts';
import type { Choice, Question, QuestionKind } from './types.ts';

interface Template {
  kind: QuestionKind;
  prompt: (brief: ApplicationBrief) => string;
  placeholder?: string;
  choices?: Choice[];
  /** Extra context from what the user already said. */
  hint?: (brief: ApplicationBrief) => string | undefined;
}

const yesNo: Choice[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
];

/** "You described it as “high viscosity”..." — reuses the user's own words, never invents any. */
function statedHint(brief: ApplicationBrief, id: FieldId, what: string): string | undefined {
  const f = getField(brief, id);
  if (f.value === null && f.status === 'REQUIRES_ENGINEER_REVIEW' && f.raw) {
    // The field's own note says why the statement is not a value ("Range stated…", "…without naming the component").
    const reason = f.note ? f.note.trim().replace(/\.?$/, '.') : `${what.charAt(0).toUpperCase()}${what.slice(1)}.`;
    return `You mentioned “${f.raw}”. ${reason} A precise value is still needed for the RFQ.`;
  }
  return undefined;
}

function viscosityTemplate(id: FieldId, letter: 'A' | 'B' | 'C'): Template {
  return {
    kind: 'number',
    prompt: (b) =>
      numberOf(b, 'material.componentCount') === 1
        ? 'What is the approximate viscosity of the material?'
        : `What is the approximate viscosity of Component ${letter}?`,
    placeholder: 'e.g. 5000 cP',
    hint: (b) => statedHint(b, id, 'viscosity was not given as a number'),
  };
}

const TEMPLATES: Partial<Record<FieldId, Template>> = {
  'material.componentCount': {
    kind: 'count',
    prompt: () => 'How many components does the material have?',
    placeholder: 'e.g. 2 (a resin and a hardener)',
    choices: [
      { label: '1 (single component)', value: '1' },
      { label: '2', value: '2' },
      { label: '3', value: '3' },
    ],
  },
  'material.chemistry': {
    kind: 'choice',
    prompt: () => 'What is the material chemistry?',
    placeholder: 'e.g. epoxy, polyurethane, silicone',
    choices: [
      { label: 'Epoxy', value: 'Epoxy' },
      { label: 'Polyurethane', value: 'Polyurethane' },
      { label: 'Silicone', value: 'Silicone' },
      { label: 'Acrylic', value: 'Acrylic' },
    ],
  },
  'mixing.ratio': {
    kind: 'ratio',
    prompt: (b) => {
      const n = numberOf(b, 'material.componentCount');
      const which = n === 2 ? 'the two components' : n === 3 ? 'the three components' : 'the components';
      return `What is the mix ratio of ${which}?`;
    },
    placeholder: 'e.g. 10:1 (say whether by volume or weight if you know)',
  },
  'properties.viscosityA': viscosityTemplate('properties.viscosityA', 'A'),
  'properties.viscosityB': viscosityTemplate('properties.viscosityB', 'B'),
  'properties.viscosityC': viscosityTemplate('properties.viscosityC', 'C'),
  'production.shotSize': {
    kind: 'number',
    prompt: () => 'What is the shot size — the amount of material dispensed per part or per shot?',
    placeholder: 'e.g. 15 g, or 12 cc',
    hint: (b) => statedHint(b, 'production.shotSize', 'shot size was not given as a single number'),
  },
  'production.productionRate': {
    kind: 'number',
    prompt: () => 'What production rate do you need?',
    placeholder: 'e.g. 500 parts per hour',
    hint: (b) => statedHint(b, 'production.productionRate', 'production rate was not given as a single number'),
  },
  'production.flowRate': {
    kind: 'number',
    prompt: () => 'What flow rate is required, if you know it?',
    placeholder: 'e.g. 100 cc/min',
    hint: (b) =>
      statedHint(b, 'production.flowRate', 'flow rate was not given as a single number') ??
      "If you do not know it, answer \"I don't know\" and the engineer will review it.",
  },
  'automation.automationLevel': {
    kind: 'choice',
    prompt: () => 'What is the automation level of the dispensing process?',
    choices: [
      { label: 'Automated', value: 'Automated' },
      { label: 'Semi-automatic', value: 'Semi-automatic' },
      { label: 'Manual', value: 'Manual' },
    ],
  },
  'part.partDescription': {
    kind: 'text',
    prompt: () => 'What is being potted or encapsulated? Describe the part.',
    placeholder: 'e.g. control module in a plastic housing',
  },
  'environment.operatingEnvironment': {
    kind: 'text',
    prompt: () => 'What is the operating environment of the dispensing equipment?',
    placeholder: 'e.g. factory floor, cleanroom, humid, dusty',
  },
  'properties.filled': {
    kind: 'boolean',
    prompt: () => 'Is the material filled (for example with mineral, glass or ceramic fillers)?',
    choices: [...yesNo, { label: 'Not sure', value: 'Not sure' }],
  },
  'properties.temperature': {
    kind: 'number',
    prompt: () => 'What temperature is the material dispensed at?',
    placeholder: 'e.g. 60 °C',
  },
  'automation.robotic': {
    kind: 'boolean',
    prompt: () => 'Will a robot handle the parts or position the dispensing head?',
    choices: yesNo,
  },
  'material.materialName': {
    kind: 'text',
    prompt: () => 'Do you have a product name or material designation? (optional)',
    placeholder: 'e.g. the supplier name and grade',
  },
  'part.cavityGeometry': {
    kind: 'text',
    prompt: () => 'Briefly describe the cavity or fill geometry — depth, narrow gaps, undercuts. (optional)',
    placeholder: 'e.g. 30 mm deep cavity with narrow ribs',
  },
  'part.targetArea': {
    kind: 'text',
    prompt: () => 'Which area has to be filled or covered? (optional)',
    placeholder: 'e.g. the whole board, or only around the connector',
  },
  'integration.existingEquipment': {
    kind: 'text',
    prompt: () => 'Is there existing dispensing or mixing equipment this has to work with? (optional)',
    placeholder: 'e.g. none, or a description of the current equipment',
  },
  'integration.integrationRequirements': {
    kind: 'text',
    prompt: () => 'Any integration requirements — PLC, protocol, line interface? (optional)',
    placeholder: 'e.g. Profinet signals from the line PLC',
  },
  'notes.additionalNotes': {
    kind: 'text',
    prompt: () => 'Anything else the engineer should know? (optional)',
    placeholder: 'Free text',
  },
};

const UNIT_TEMPLATES: Partial<Record<FieldId, { prompt: string; choices: Choice[]; placeholder?: string }>> = {
  'properties.viscosityUnit': {
    prompt: 'Which unit is the viscosity given in?',
    choices: ['cP', 'mPa·s', 'Pa·s'].map((u) => ({ label: u, value: u })),
  },
  'production.shotSizeUnit': {
    prompt: 'Which unit is the shot size given in?',
    choices: ['g', 'ml', 'cc', 'oz'].map((u) => ({ label: u, value: u })),
  },
  'production.productionUnit': {
    prompt: 'What is the production rate counted in, and per which period?',
    choices: ['parts/minute', 'parts/hour', 'parts/day', 'parts/week'].map((u) => ({ label: u, value: u })),
    placeholder: 'e.g. parts per hour',
  },
  'production.flowUnit': {
    prompt: 'Which unit is the flow rate given in?',
    choices: ['cc/min', 'ml/min', 'g/min', 'g/s'].map((u) => ({ label: u, value: u })),
  },
  'properties.temperatureUnit': {
    prompt: 'Which temperature scale is that in?',
    choices: ['°C', '°F'].map((u) => ({ label: u, value: u })),
  },
  'production.cycleTimeUnit': {
    prompt: 'Which unit is the cycle time given in?',
    choices: ['s', 'min'].map((u) => ({ label: u, value: u })),
  },
  'environment.operatingTemperatureUnit': {
    prompt: 'Which temperature scale is the operating temperature in?',
    choices: ['°C', '°F'].map((u) => ({ label: u, value: u })),
  },
};

export function hasTemplate(id: FieldId): boolean {
  return id in TEMPLATES;
}

/** Normal question for a missing field. */
export function buildAskQuestion(id: FieldId, brief: ApplicationBrief, priority: Priority): Question | null {
  const t = TEMPLATES[id];
  if (!t) return null;
  const hint = t.hint?.(brief);
  return {
    id: `ask:${id}`,
    fieldId: id,
    kind: t.kind,
    mode: 'ASK',
    prompt: t.prompt(brief),
    ...(hint ? { hint } : {}),
    ...(t.placeholder ? { placeholder: t.placeholder } : {}),
    ...(t.choices ? { choices: t.choices } : {}),
    priority,
  };
}

/** Follow-up when the value is known but its unit is not. */
export function buildUnitQuestion(unitFieldId: FieldId, brief: ApplicationBrief, priority: Priority): Question | null {
  const t = UNIT_TEMPLATES[unitFieldId];
  if (!t) return null;
  const valueIds = getFieldDef(unitFieldId).unitFor ?? [];
  const stated = valueIds
    .map((id) => getField(brief, id))
    .find((f) => f.value !== null && f.raw);
  return {
    id: `unit:${unitFieldId}`,
    fieldId: unitFieldId,
    kind: 'unit',
    mode: 'UNIT',
    prompt: t.prompt,
    ...(stated?.raw ? { hint: `You wrote “${stated.raw}” without a unit I can read.` } : {}),
    ...(t.placeholder ? { placeholder: t.placeholder } : { placeholder: 'Type the unit' }),
    choices: t.choices,
    priority,
  };
}

/** The user's own statements conflict for one field: ask which applies. */
export function buildConflictQuestion(id: FieldId, brief: ApplicationBrief, priority: Priority): Question {
  const field = getField(brief, id);
  const def = getFieldDef(id);
  const candidates = field.candidates ?? [];
  const show = (v: string | number | boolean): string => (id === 'material.chemistry' ? chemistryLabel(String(v)) : String(v));
  return {
    id: `clarify:${id}`,
    fieldId: id,
    kind: 'clarify',
    mode: 'CLARIFY',
    prompt: `You gave more than one value for ${def.label.toLowerCase()}: ${candidates.map((c) => show(c.value)).join(' / ')}. Which one applies?`,
    placeholder: 'Type the correct value',
    choices: candidates.map((c) => ({ label: show(c.value), value: show(c.value) })),
    priority,
  };
}

/** Component count and ratio disagree (e.g. 3 components, ratio 10:1). */
export function buildMismatchQuestion(components: number, terms: number, ratio: string): Question {
  return {
    id: 'clarify:ratio-components',
    fieldId: 'material.componentCount',
    kind: 'clarify',
    mode: 'CLARIFY',
    prompt: `You stated ${componentsPhrase(components)}, but the ratio ${ratio} has ${terms} terms. Which is correct?`,
    hint: components === 1 ? 'Reply with the right number of components, or confirm that it is a single component.' : 'Reply with the right number of components, or with the right ratio.',
    placeholder: components === 1 ? `e.g. ${terms}   or   “single component”` : `e.g. ${terms}   or   a ratio such as ${Array(components).fill(1).join(':')}`,
    priority: 'REQUIRED',
  };
}
