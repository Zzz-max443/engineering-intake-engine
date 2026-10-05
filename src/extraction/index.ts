import { DEFAULT_PROFILE } from '../data/applications/index.ts';
import type { ApplicationProfile } from '../data/applications/types.ts';
import type { ApplicationBrief, FieldId } from '../models/types.ts';
import { extractWithRules, localExtractor } from './localExtractor.ts';
import type { ExtractionInput, ExtractionResult, Extractor } from './types.ts';

export type { ExtractedValue, ExtractionInput, ExtractionResult, Extractor } from './types.ts';
export { SIGNALS } from './types.ts';
export { localExtractor, RULES } from './localExtractor.ts';

/**
 * The extractor the engine uses. It is local and rule-based by default.
 * To use an LLM instead, implement `Extractor` and call setExtractor(yourExtractor).
 */
let activeExtractor: Extractor = localExtractor;

export function setExtractor(extractor: Extractor): void {
  activeExtractor = extractor;
}

export function getExtractor(): Extractor {
  return activeExtractor;
}

export interface ExtractOptions {
  profile?: ApplicationProfile;
  expecting?: FieldId;
  brief?: ApplicationBrief;
}

/**
 * extractRequirements(): free text -> list of extracted data points (synchronous, local rules).
 * This is the function the business logic documents as "the extractor".
 */
export function extractRequirements(text: string, options: ExtractOptions = {}): ExtractionResult {
  return extractWithRules(toInput(text, options));
}

/** Same as extractRequirements() but goes through the ACTIVE extractor (may be async / LLM-backed). */
export async function runExtractor(text: string, options: ExtractOptions = {}): Promise<ExtractionResult> {
  return activeExtractor.extract(toInput(text, options));
}

function toInput(text: string, options: ExtractOptions): ExtractionInput {
  const input: ExtractionInput = { text, profile: options.profile ?? DEFAULT_PROFILE };
  if (options.expecting) input.expecting = options.expecting;
  if (options.brief) input.brief = options.brief;
  return input;
}
