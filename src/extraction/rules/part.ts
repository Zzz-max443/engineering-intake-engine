import { collapseWhitespace, stripTrailingPunctuation } from '../../utils/text.ts';
import { NUM } from '../../utils/text.ts';
import type { Rule } from './types.ts';

const PART_VERBS =
  String.raw`(?:pot(?!\s+life)(?:ting|ted|s)?|encapsulat(?:e|es|ed|ing)|encapsulation\s+of|fill(?:ing|s)?|seal(?:ing|s)?|embed(?:ding)?|cast(?:ing)?)`;
const ARTICLES =
  String.raw`(?:(?:the|our|these|those|some|a|an|my|their|its)\s+|all\s+(?:of\s+)?(?:the\s+)?)?`;
const STOP_AFTER =
  String.raw`(?=\s+(?:per|with|using|in|at|into|and|for|made|that|which|on|each|every|from|by|to|before|after|where|so|once|but|when|inside)\b|[.,;:!?]|$)`;
const NOUN_PHRASE = String.raw`(?<np>[a-z][a-z0-9\-]*(?:\s+[a-z][a-z0-9\-]*){0,4}?)`;

/** Words that, alone, say nothing about the part. */
const GENERIC_WORDS = new Set([
  'part', 'parts', 'unit', 'units', 'piece', 'pieces', 'item', 'items', 'component', 'components',
  'product', 'products', 'thing', 'things', 'material', 'materials', 'compound', 'resin', 'epoxy',
  'silicone', 'polyurethane', 'urethane', 'it', 'them', 'this', 'that', 'one', 'system', 'systems',
  'machine', 'machines', 'process', 'line', 'application', 'equipment', 'station', 'cell', 'setup',
  'solution', 'robotic', 'automated', 'automatic', 'manual', 'electronic', 'electronics', 'a', 'an', 'the',
]);

/** Words that make a phrase after "into / in / inside" credible as a part. */
const PART_KEYWORDS =
  /\b(?:housing|enclosure|module|pcb|board|case|can|shell|cup|connector|sensor|transformer|coil|assembly|package|cavity|mold|mould|casing|box|capsule|inductor|capacitor|relay|solenoid|driver|motor|magnet|cable|battery|pack|led|lamp|power\s+supply)s?\b/i;

function isInformative(phrase: string): boolean {
  const tokens = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.some((t) => !GENERIC_WORDS.has(t));
}

/** Part description: only the user's own noun phrase, never an invented one. */
export const partRule: Rule = (scan) => {
  const afterVerb = new RegExp(String.raw`\b${PART_VERBS}\s+${ARTICLES}(?:${NUM}\s+)?${NOUN_PHRASE}${STOP_AFTER}`, 'gi');
  for (const m of scan.matches(afterVerb)) {
    const phrase = stripTrailingPunctuation(collapseWhitespace(m.groups?.np ?? ''));
    if (!phrase || !isInformative(phrase)) continue;
    scan.knownAs('part.partDescription', phrase, phrase, 'USER_STATED');
    return;
  }

  const afterPreposition = new RegExp(String.raw`\b(?:into|inside|onto|around|over|in)\s+${ARTICLES}${NOUN_PHRASE}${STOP_AFTER}`, 'gi');
  for (const m of scan.matches(afterPreposition)) {
    const phrase = stripTrailingPunctuation(collapseWhitespace(m.groups?.np ?? ''));
    if (!phrase || !PART_KEYWORDS.test(phrase) || !isInformative(phrase)) continue;
    scan.knownAs('part.partDescription', phrase, phrase, 'USER_STATED');
    return;
  }
};
