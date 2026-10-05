import { DEFAULT_PROFILE } from '../data/applications/index.ts';
import type { ApplicationProfile } from '../data/applications/types.ts';
import { getFieldDef } from '../data/fields.ts';
import { extractRequirements } from '../extraction/index.ts';
import { countFromToken } from '../extraction/rules/material.ts';
import { originFor } from '../extraction/scan.ts';
import type { ExtractedValue } from '../extraction/types.ts';
import {
  MASS_VOL_SRC,
  normalizeMassVol,
  normalizePeriod,
  normalizeTempUnit,
  normalizeTimeShort,
  normalizeViscosityUnit,
  PERIOD_SRC,
  TIME_SHORT_SRC,
  VISCOSITY_UNIT_SRC,
} from '../extraction/units.ts';
import { stringOf } from '../models/brief.ts';
import type { ApplicationBrief, FieldId } from '../models/types.ts';
import { collapseWhitespace, normalizeInput, parseNumber } from '../utils/text.ts';
import type { AnswerOutcome, Question } from './types.ts';

const UNKNOWN_RE =
  /^(?:i\s+)?(?:really\s+)?(?:don'?t|do\s+not|dont)\s+know|^not\s+sure|^unsure|^unknown|^no\s+idea|^idk\b|^tbd\b|^to\s+be\s+determined|^n\/?a\b|^can'?t\s+say|^not\s+known/i;
// "skip" (and "skip this one", "skip it for now") is a command; "pass", "next", "later" only when they are the whole reply,
// so that an answer such as "Pass-through connector housings" is never mistaken for a skip.
const SKIP_RE = /^(?:skip\b|(?:pass|next|later|not\s+now|move\s+on)[.!]?$)/i;
const NOTHING_RE = /^(?:no|none|nothing|nope|nothing\s+else|no\s+thanks|that'?s\s+all|all\s+good)\.?$/i;

const invalid = (hint: string): AnswerOutcome => ({ type: 'invalid', hint });

function one(fieldId: FieldId, value: string | number | boolean, raw: string, origin: 'USER_STATED' | 'NORMALIZED', note?: string): ExtractedValue {
  return { fieldId, value, status: 'KNOWN', origin, raw, ...(note ? { note } : {}) };
}

/** Run the normal extraction rules over `text`, keeping only the listed fields. */
function extractFor(text: string, expecting: FieldId, keep: FieldId[]): ExtractedValue[] {
  return extractRequirements(text, { expecting }).values.filter((v) => keep.includes(v.fieldId));
}

// ---- field-specific parsers ----------------------------------------------------------------

function parseCount(fieldId: FieldId, text: string): AnswerOutcome {
  const found = extractFor(text, fieldId, ['material.componentCount']);
  if (found.length > 0) return { type: 'values', values: found };
  const m = /^(?:(?:it'?s|it\s+is|there\s+(?:are|is)|we\s+(?:have|use)|about|just|only)\s+)?(one|single|two|three|four|five|six|[1-6])(?:\s*(?:components?|parts?|k))?\.?$/i.exec(text);
  const n = m ? countFromToken(m[1] ?? '') : null;
  if (n !== null) return { type: 'values', values: [one('material.componentCount', n, text, 'NORMALIZED')] };
  return invalid('Please give the number of components, for example 2.');
}

function parseRatio(text: string): AnswerOutcome {
  const found = extractFor(text, 'mixing.ratio', ['mixing.ratio']);
  if (found.length > 0) return { type: 'values', values: found };
  // A reply to the ratio question is a ratio even without the words "mix ratio": "10 to 1", "10-to-1", "10/1", "10 1", "1 1 1".
  const term = String.raw`(\d+(?:\.\d+)?)`;
  const sep = String.raw`\s*(?:[:/]|-to-|to|\s)\s*`;
  const m = new RegExp(`^${term}${sep}${term}(?:${sep}${term})?$`, 'i').exec(text);
  if (m) {
    const terms = [m[1], m[2], m[3]].filter((t): t is string => t !== undefined).map(Number);
    if (terms.every((t) => t > 0)) return { type: 'values', values: [one('mixing.ratio', terms.join(':'), text, 'NORMALIZED')] };
  }
  return invalid('I could not read a mix ratio. Please write it like 10:1 (or "10 to 1", or 1:1:1 for three components).');
}

function parseChemistry(text: string): AnswerOutcome {
  const found = extractFor(text, 'material.chemistry', ['material.chemistry']);
  if (found.length > 0) return { type: 'values', values: found };
  if (text.length <= 40 && /[a-z]{3}/i.test(text)) {
    return {
      type: 'values',
      values: [
        {
          fieldId: 'material.chemistry',
          value: text.toLowerCase(),
          status: 'REQUIRES_ENGINEER_REVIEW',
          origin: 'USER_STATED',
          raw: text,
          note: 'Chemistry is not in the intake vocabulary (epoxy, polyurethane, silicone...); engineer review.',
        },
      ],
    };
  }
  return invalid('Please name the chemistry, for example epoxy, polyurethane or silicone.');
}

function parseAutomation(text: string): AnswerOutcome {
  const found = extractFor(text, 'automation.automationLevel', ['automation.automationLevel']);
  if (found.length > 0) return { type: 'values', values: found };
  let level: string | null = null;
  if (/^semi/i.test(text)) level = 'Semi-automatic';
  else if (/^auto/i.test(text)) level = 'Automated';
  else if (/^(?:hand|man)/i.test(text)) level = 'Manual';
  if (level) return { type: 'values', values: [one('automation.automationLevel', level, text, 'NORMALIZED')] };
  return invalid('Please choose Manual, Semi-automatic or Automated.');
}

function parseBoolean(fieldId: FieldId, text: string): AnswerOutcome {
  if (/^(?:y|yes|yeah|yep|yup|sure|correct|true|affirmative|of course|definitely)\b/i.test(text)) {
    return { type: 'values', values: [one(fieldId, true, text, 'NORMALIZED')] };
  }
  if (/^(?:n|no|nope|nah|false|negative|not really|not at all|none)\b/i.test(text)) {
    return { type: 'values', values: [one(fieldId, false, text, 'NORMALIZED')] };
  }
  return invalid('Please answer Yes or No (or "I don\'t know").');
}

const SYNTHETIC_SENTENCE: Partial<Record<FieldId, (t: string) => string>> = {
  'properties.viscosityA': (t) => `viscosity of component A is ${t}`,
  'properties.viscosityB': (t) => `viscosity of component B is ${t}`,
  'properties.viscosityC': (t) => `viscosity of component C is ${t}`,
  'production.shotSize': (t) => `shot size ${t}`,
  'production.productionRate': (t) => `we produce ${t}`,
  'production.flowRate': (t) => `flow rate ${t}`,
  'properties.temperature': (t) => `material temperature ${t}`,
};

/**
 * Numeric answers reuse the extraction rules: "5000 cP" is read as if the user had written
 * "viscosity of component A is 5000 cP". A bare number is accepted WITHOUT a unit — the unit is
 * then asked as a separate follow-up; it is never assumed.
 */
function parseNumeric(fieldId: FieldId, text: string, brief: ApplicationBrief): AnswerOutcome {
  const synthesize = SYNTHETIC_SENTENCE[fieldId];
  const unitField = getFieldDef(fieldId).unitField;
  if (!synthesize) return invalid('Please give a value.');
  const keep = unitField ? [fieldId, unitField] : [fieldId];

  const found = extractFor(synthesize(text), fieldId, keep);
  if (found.some((v) => v.fieldId === fieldId)) return { type: 'values', values: found };

  if (fieldId.startsWith('properties.viscosity')) {
    const qualitative = extractFor(`${text} viscosity`, fieldId, [fieldId]);
    if (qualitative.length > 0) return { type: 'values', values: qualitative };
  }

  const bare = /^(?:about|approximately|approx\.?|around|roughly|~)?\s*(-)?\s*(\d[\d.,]*)\s*$/i.exec(text);
  if (bare) {
    const n = parseNumber(bare[2] ?? '');
    const negative = Boolean(bare[1]);
    if (n !== null && (!negative || fieldId === 'properties.temperature')) {
      const value = negative ? -n : n;
      // A unit given earlier for another value of the same kind is NOT assumed silently: flag it.
      const sharedUnit = unitField ? stringOf(brief, unitField) : null;
      if (sharedUnit) {
        return {
          type: 'values',
          values: [
            {
              fieldId,
              value,
              status: 'INFERRED',
              origin: 'INFERRED',
              raw: text,
              note: `Stated without a unit; the unit given earlier (${sharedUnit}) was assumed — confirm.`,
            },
          ],
        };
      }
      return { type: 'values', values: [one(fieldId, value, text, 'USER_STATED', 'Stated without a unit.')] };
    }
  }
  return invalid('I could not read a value. Please include a number and its unit, for example "5000 cP" or "15 g".');
}

function parseText(fieldId: FieldId, text: string): AnswerOutcome {
  if (NOTHING_RE.test(text)) return { type: 'skip' };
  return { type: 'values', values: [one(fieldId, text.slice(0, 400), text, 'USER_STATED')] };
}

function parseUnit(fieldId: FieldId, text: string): AnswerOutcome {
  const bounded = (src: string): RegExp => new RegExp(`(?<![a-z])(${src})(?![a-z])`, 'i');
  let canonical: string | null = null;

  switch (fieldId) {
    case 'properties.viscosityUnit': {
      const m = bounded(VISCOSITY_UNIT_SRC).exec(text);
      if (m) canonical = normalizeViscosityUnit(m[1] ?? '');
      break;
    }
    case 'production.shotSizeUnit': {
      const m = bounded(MASS_VOL_SRC).exec(text);
      if (m) canonical = normalizeMassVol(m[1] ?? '');
      break;
    }
    case 'production.flowUnit': {
      const m = new RegExp(String.raw`(${MASS_VOL_SRC})\s*(?:/|per)\s*(${TIME_SHORT_SRC})(?![a-z])`, 'i').exec(text);
      if (m) canonical = `${normalizeMassVol(m[1] ?? '')}/${normalizeTimeShort(m[2] ?? '')}`;
      break;
    }
    case 'production.productionUnit': {
      const m = new RegExp(String.raw`(?:/|per|a|each)\s*(${PERIOD_SRC})(?![a-z])|^(${PERIOD_SRC})$`, 'i').exec(text);
      const period = m?.[1] ?? m?.[2];
      if (period) canonical = `parts/${normalizePeriod(period)}`;
      break;
    }
    case 'properties.temperatureUnit':
    case 'environment.operatingTemperatureUnit': {
      if (/^(?:deg(?:rees?)?\.?\s*|°\s*|º\s*)?(?:celsius|fahrenheit|kelvin|[CFK])$/i.test(text)) {
        canonical = normalizeTempUnit(text);
      }
      break;
    }
    case 'production.cycleTimeUnit': {
      if (/^(?:s|secs?|seconds?)$/i.test(text)) canonical = 's';
      else if (/^(?:min|mins|minutes?)$/i.test(text)) canonical = 'min';
      break;
    }
    default:
      break;
  }
  if (!canonical) return invalid('I could not read that unit. Please type it (for example cP, g, cc/min) or choose one.');
  return { type: 'values', values: [one(fieldId, canonical, text, originFor(text, canonical))] };
}

function parseMismatch(text: string): AnswerOutcome {
  const asCount = parseCount('material.componentCount', text);
  if (asCount.type === 'values') return asCount;
  const asRatio = parseRatio(text);
  if (asRatio.type === 'values') return asRatio;
  return invalid('Please reply with the correct number of components (for example 2) or the correct ratio (for example 10:1).');
}

function parseForField(fieldId: FieldId, text: string, brief: ApplicationBrief): AnswerOutcome {
  switch (getFieldDef(fieldId).kind) {
    case 'count':
      return parseCount(fieldId, text);
    case 'ratio':
      return parseRatio(text);
    case 'choice':
      return fieldId === 'material.chemistry' ? parseChemistry(text) : parseAutomation(text);
    case 'boolean':
      return parseBoolean(fieldId, text);
    case 'number':
      return parseNumeric(fieldId, text, brief);
    case 'unit':
      return parseUnit(fieldId, text);
    default:
      return parseText(fieldId, text);
  }
}

/**
 * interpretAnswer(): what did the user mean by this reply to this question?
 * Returns values to merge, or "unknown" / "skip", or "invalid" with a hint for a retry.
 */
export function interpretAnswer(
  question: Question,
  rawText: string,
  brief: ApplicationBrief,
  _profile: ApplicationProfile = DEFAULT_PROFILE,
): AnswerOutcome {
  const text = collapseWhitespace(normalizeInput(rawText));
  if (!text) return invalid('Please type an answer, or choose "I don\'t know" or "Skip".');
  if (UNKNOWN_RE.test(text)) return { type: 'unknown' };
  if (SKIP_RE.test(text)) return { type: 'skip' };
  if (question.id === 'clarify:ratio-components') return parseMismatch(text);
  if (question.mode === 'UNIT') return parseUnit(question.fieldId, text);
  return parseForField(question.fieldId, text, brief);
}
