/**
 * Business-logic facade. The UI (and any other front end) should only need these functions:
 *
 *   extractRequirements()    free text            -> extracted data points
 *   calculateMissingFields() brief                -> what is still missing, by priority
 *   getNextQuestion()        brief                -> the single next question (or null)
 *   buildEngineeringBrief()  brief                -> the Engineering Brief view model
 *   buildRFQ()               brief                -> the RFQ draft
 *
 * plus IntakeSession, which wires them into one conversation.
 */
export { extractRequirements, runExtractor, setExtractor, getExtractor } from '../extraction/index.ts';
export type { ExtractedValue, ExtractionResult, Extractor } from '../extraction/index.ts';
export { calculateMissingFields } from './missing.ts';
export type { MissingField } from './missing.ts';
export { calculateCompleteness } from './completeness.ts';
export type { CompletenessReport } from './completeness.ts';
export { computeReviewFlags } from './review.ts';
export type { ReviewFlag } from './review.ts';
export { getNextQuestion, interpretAnswer } from '../questions/index.ts';
export type { Question } from '../questions/index.ts';
export { buildEngineeringBrief, buildRFQ, buildExportText, rfqToText, getPlatformContext } from '../rfq/index.ts';
export type { EngineeringBriefView, RFQDraft } from '../rfq/index.ts';
export { IntakeSession } from './session.ts';
export type { Phase, TranscriptEntry, UnderstoodItem } from './session.ts';
export { createEmptyBrief } from '../models/brief.ts';
