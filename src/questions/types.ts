import type { ExtractedValue } from '../extraction/types.ts';
import type { FieldId, Priority } from '../models/types.ts';

export type QuestionKind = 'text' | 'number' | 'count' | 'choice' | 'boolean' | 'ratio' | 'unit' | 'clarify';

/** How the question came about. */
export type QuestionMode =
  /** A missing field, asked in priority order. */
  | 'ASK'
  /** A value was given without a unit: ask only for the unit. */
  | 'UNIT'
  /** The user's own statements conflict or disagree: ask which one applies. */
  | 'CLARIFY';

export interface Choice {
  label: string;
  /** Text submitted as the answer when the choice is clicked. */
  value: string;
}

export interface Question {
  /** Stable id, e.g. "ask:mixing.ratio", "unit:properties.viscosityUnit", "clarify:ratio-components". */
  id: string;
  fieldId: FieldId;
  kind: QuestionKind;
  mode: QuestionMode;
  prompt: string;
  /** Context taken from what the user already said ("You described it as ..."). */
  hint?: string;
  placeholder?: string;
  choices?: Choice[];
  priority: Priority;
}

/** What the intake engine understood from an answer. */
export type AnswerOutcome =
  | { type: 'values'; values: ExtractedValue[] }
  | { type: 'unknown' }
  | { type: 'skip' }
  | { type: 'invalid'; hint: string };
