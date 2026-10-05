import type { ApplicationBrief, FieldId, FieldStatus, Origin, Primitive } from '../models/types.ts';
import type { ApplicationProfile } from '../data/applications/types.ts';

/**
 * One datum found in the user's text. The extractor only REPORTS what it found;
 * it never writes to the brief. engine/merge.ts decides what ends up in the brief.
 */
export interface ExtractedValue {
  fieldId: FieldId;
  /** null when the user gave only a qualitative / ranged / unknown statement. */
  value: Primitive | null;
  status: FieldStatus;
  origin: Origin;
  /** Evidence: the user's own words that produced this datum. */
  raw: string;
  note?: string;
  /** The user explicitly said they do not know this one. */
  userUnknown?: boolean;
}

export interface ExtractionResult {
  values: ExtractedValue[];
  /** Topics detected in the text (e.g. MENTIONS_TEMPERATURE). */
  signals: string[];
  /** Statements recognised but not mappable to a field; kept verbatim for the engineer. */
  capturedNotes: string[];
}

export interface ExtractionInput {
  text: string;
  profile: ApplicationProfile;
  /** When the text answers a specific question, the field being asked about. */
  expecting?: FieldId;
  /** Current brief (read-only context; extractors may use it to disambiguate). */
  brief?: ApplicationBrief;
}

/**
 * Anything that turns text into ExtractedValue[]. The local rule-based extractor implements it;
 * an LLM-backed extractor can implement the same interface and be plugged in with setExtractor().
 */
export interface Extractor {
  readonly name: string;
  extract(input: ExtractionInput): ExtractionResult | Promise<ExtractionResult>;
}

export const SIGNALS = {
  MENTIONS_TEMPERATURE: 'MENTIONS_TEMPERATURE',
  MENTIONS_COMPONENT_B: 'MENTIONS_COMPONENT_B',
  MENTIONS_COMPONENT_C: 'MENTIONS_COMPONENT_C',
  OTHER_APPLICATION: 'OTHER_APPLICATION',
} as const;
