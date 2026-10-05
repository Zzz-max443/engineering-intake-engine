import { FIELD_IDS } from './types.ts';
import type { ApplicationBrief, Field, FieldId, Primitive } from './types.ts';

/** A field nobody has told us anything about. */
export function unknownField<T extends Primitive = Primitive>(): Field<T> {
  return { value: null, status: 'UNKNOWN', origin: 'NONE' };
}

/** Build a brief in which every field is UNKNOWN. Nothing is pre-filled. */
export function createEmptyBrief(): ApplicationBrief {
  return {
    application: { category: unknownField(), subcategory: unknownField(), description: unknownField() },
    material: { materialName: unknownField(), chemistry: unknownField(), componentCount: unknownField() },
    mixing: { ratio: unknownField(), ratioKnown: unknownField() },
    properties: {
      viscosityA: unknownField(),
      viscosityB: unknownField(),
      viscosityC: unknownField(),
      viscosityUnit: unknownField(),
      temperature: unknownField(),
      temperatureUnit: unknownField(),
      filled: unknownField(),
      abrasive: unknownField(),
      thixotropic: unknownField(),
    },
    production: {
      productionRate: unknownField(),
      productionUnit: unknownField(),
      shotSize: unknownField(),
      shotSizeUnit: unknownField(),
      flowRate: unknownField(),
      flowUnit: unknownField(),
      cycleTime: unknownField(),
      cycleTimeUnit: unknownField(),
    },
    automation: {
      automationLevel: unknownField(),
      robotic: unknownField(),
      conveyor: unknownField(),
      existingAutomation: unknownField(),
    },
    environment: {
      operatingEnvironment: unknownField(),
      hazardousEnvironment: unknownField(),
      operatingTemperature: unknownField(),
      operatingTemperatureUnit: unknownField(),
    },
    part: { partDescription: unknownField(), cavityGeometry: unknownField(), targetArea: unknownField() },
    integration: { existingEquipment: unknownField(), integrationRequirements: unknownField() },
    contact: { company: unknownField(), contactName: unknownField() },
    notes: { additionalNotes: unknownField() },
    metadata: {
      confidence: 'LOW',
      engineerReviewRequired: true,
      missingRequiredFields: [],
      sourceOfInformation: [],
      signals: [],
      capturedNotes: [],
      messageCount: 0,
    },
  };
}

export function cloneBrief(brief: ApplicationBrief): ApplicationBrief {
  return structuredClone(brief);
}

type GroupRecord = Record<string, Field>;

function splitId(id: FieldId): [string, string] {
  const dot = id.indexOf('.');
  return [id.slice(0, dot), id.slice(dot + 1)];
}

export function getField(brief: ApplicationBrief, id: FieldId): Field {
  const [group, key] = splitId(id);
  const groupRecord = (brief as unknown as Record<string, GroupRecord>)[group];
  const field = groupRecord?.[key];
  if (!field) throw new Error(`Unknown field id: ${id}`);
  return field;
}

export function setField(brief: ApplicationBrief, id: FieldId, field: Field): void {
  const [group, key] = splitId(id);
  const groupRecord = (brief as unknown as Record<string, GroupRecord>)[group];
  if (!groupRecord || !(key in groupRecord)) throw new Error(`Unknown field id: ${id}`);
  groupRecord[key] = field;
}

/** True when the field holds a usable value (any status). */
export function hasValue(field: Field): boolean {
  return field.value !== null && field.value !== undefined;
}

/** Convenience: current value of a field, or null. */
export function valueOf(brief: ApplicationBrief, id: FieldId): Primitive | null {
  return getField(brief, id).value;
}

export function numberOf(brief: ApplicationBrief, id: FieldId): number | null {
  const v = getField(brief, id).value;
  return typeof v === 'number' ? v : null;
}

export function stringOf(brief: ApplicationBrief, id: FieldId): string | null {
  const v = getField(brief, id).value;
  return typeof v === 'string' ? v : null;
}

export function allFieldIds(): readonly FieldId[] {
  return FIELD_IDS;
}

/** True while the user's own statements contradict each other for this field. */
export function isConflicted(field: Field): boolean {
  return field.value === null && (field.candidates?.length ?? 0) > 1;
}
