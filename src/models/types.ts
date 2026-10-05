/**
 * Core data model for the Engineering Intake Engine.
 *
 * The central rule of the model: a field's VALUE and its STATUS are always kept
 * separate. A numeric field is either a real number or null — never a placeholder
 * such as "unknown", "probably high" or "estimated".
 */

/** Epistemic state of a single datum. */
export type FieldStatus = 'KNOWN' | 'UNKNOWN' | 'INFERRED' | 'REQUIRES_ENGINEER_REVIEW';

/**
 * Where a datum came from.
 *  - USER_STATED: the user wrote it explicitly, in the form we store it.
 *  - NORMALIZED: the user stated it, we only changed its form ("10 to 1" -> "10:1").
 *  - INFERRED:   the system deduced it; it is NOT a fact until the user confirms it.
 *  - NONE:       nothing is known.
 */
export type Origin = 'USER_STATED' | 'NORMALIZED' | 'INFERRED' | 'NONE';

/** How much an application profile cares about a field. */
export type Priority = 'REQUIRED' | 'USEFUL' | 'OPTIONAL' | 'ENGINEER_REVIEW';

export type Primitive = string | number | boolean;

/** One alternative value, kept when the user gave conflicting statements. */
export interface Candidate {
  value: Primitive;
  raw: string;
}

export interface Field<T extends Primitive = Primitive> {
  value: T | null;
  status: FieldStatus;
  origin: Origin;
  /** Exact text the user wrote (evidence). */
  raw?: string;
  /** Human-readable explanation: why inferred, why it needs review, etc. */
  note?: string;
  /** Present only while the user's statements conflict and the value is unresolved. */
  candidates?: Candidate[];
  /** How many times the engine has asked about this field (never ask forever). */
  asked?: number;
  /** The user explicitly said they do not know / cannot provide this. */
  userUnknown?: boolean;
  /** Produced by engine/derive.ts (not read from the user's text); recomputed on every pass. */
  derived?: boolean;
}

export const FIELD_IDS = [
  'application.category',
  'application.subcategory',
  'application.description',
  'material.materialName',
  'material.chemistry',
  'material.componentCount',
  'mixing.ratio',
  'mixing.ratioKnown',
  'properties.viscosityA',
  'properties.viscosityB',
  'properties.viscosityC',
  'properties.viscosityUnit',
  'properties.temperature',
  'properties.temperatureUnit',
  'properties.filled',
  'properties.abrasive',
  'properties.thixotropic',
  'production.productionRate',
  'production.productionUnit',
  'production.shotSize',
  'production.shotSizeUnit',
  'production.flowRate',
  'production.flowUnit',
  'production.cycleTime',
  'production.cycleTimeUnit',
  'automation.automationLevel',
  'automation.robotic',
  'automation.conveyor',
  'automation.existingAutomation',
  'environment.operatingEnvironment',
  'environment.hazardousEnvironment',
  'environment.operatingTemperature',
  'environment.operatingTemperatureUnit',
  'part.partDescription',
  'part.cavityGeometry',
  'part.targetArea',
  'integration.existingEquipment',
  'integration.integrationRequirements',
  'contact.company',
  'contact.contactName',
  'notes.additionalNotes',
] as const;

export type FieldId = (typeof FIELD_IDS)[number];

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

/** Provenance log: which user text produced which field. */
export interface SourceEntry {
  fieldId: FieldId;
  origin: Origin;
  raw: string;
  /** 1-based index of the user message the datum came from. */
  message: number;
}

export interface BriefMetadata {
  /** Qualitative label of how much of the REQUIRED set is provided. Not a technical assessment. */
  confidence: Confidence;
  /** Always true in v0.1: every brief needs a human engineer. */
  engineerReviewRequired: boolean;
  missingRequiredFields: FieldId[];
  sourceOfInformation: SourceEntry[];
  /** Topics the extractor detected (e.g. MENTIONS_TEMPERATURE). Used for conditional priorities. */
  signals: string[];
  /** User statements that were recognised but do not map to any field (kept verbatim). */
  capturedNotes: string[];
  /** Number of user messages processed so far. */
  messageCount: number;
}

export interface ApplicationBrief {
  application: {
    category: Field<string>;
    subcategory: Field<string>;
    description: Field<string>;
  };
  material: {
    materialName: Field<string>;
    chemistry: Field<string>;
    componentCount: Field<number>;
  };
  mixing: {
    ratio: Field<string>;
    ratioKnown: Field<boolean>;
  };
  properties: {
    viscosityA: Field<number>;
    viscosityB: Field<number>;
    viscosityC: Field<number>;
    viscosityUnit: Field<string>;
    temperature: Field<number>;
    temperatureUnit: Field<string>;
    filled: Field<boolean>;
    abrasive: Field<boolean>;
    thixotropic: Field<boolean>;
  };
  production: {
    productionRate: Field<number>;
    productionUnit: Field<string>;
    shotSize: Field<number>;
    shotSizeUnit: Field<string>;
    flowRate: Field<number>;
    flowUnit: Field<string>;
    cycleTime: Field<number>;
    cycleTimeUnit: Field<string>;
  };
  automation: {
    automationLevel: Field<string>;
    robotic: Field<boolean>;
    conveyor: Field<boolean>;
    existingAutomation: Field<string>;
  };
  environment: {
    operatingEnvironment: Field<string>;
    hazardousEnvironment: Field<boolean>;
    operatingTemperature: Field<number>;
    operatingTemperatureUnit: Field<string>;
  };
  part: {
    partDescription: Field<string>;
    cavityGeometry: Field<string>;
    targetArea: Field<string>;
  };
  integration: {
    existingEquipment: Field<string>;
    integrationRequirements: Field<string>;
  };
  contact: {
    company: Field<string>;
    contactName: Field<string>;
  };
  notes: {
    additionalNotes: Field<string>;
  };
  metadata: BriefMetadata;
}
