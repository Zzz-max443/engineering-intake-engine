import type { FieldId } from '../../models/types.ts';
import type { Rule } from './types.ts';

interface Topic {
  /** Regex source that matches the topic words. */
  words: string;
  fields: FieldId[];
}

const TOPICS: Topic[] = [
  { words: 'viscosit(?:y|ies)', fields: ['properties.viscosityA', 'properties.viscosityB', 'properties.viscosityC'] },
  { words: '(?:mix(?:ing)?\\s+)?ratio', fields: ['mixing.ratio'] },
  { words: 'flow(?:\\s*rate)?', fields: ['production.flowRate'] },
  { words: 'shot\\s*size|dispens(?:e|ed|ing)?\\s*(?:volume|amount)|volume\\s*per\\s*part', fields: ['production.shotSize'] },
  { words: 'production(?:\\s*(?:rate|volume))?|throughput', fields: ['production.productionRate'] },
  { words: 'chemistry|material(?:\\s+type)?', fields: ['material.chemistry'] },
  { words: '(?:number\\s+of\\s+)?components', fields: ['material.componentCount'] },
  { words: '(?:material\\s+|process\\s+)?temperature', fields: ['properties.temperature'] },
];

const ANY_TOPIC = TOPICS.map((t) => `(?:${t.words})`).join('|');
const NEGATED_KNOW =
  String.raw`(?:don't|do\s+not|dont|doesn't|does\s+not|haven't|have\s+not|not|never|can't|cannot)\s+(?:yet\s+)?(?:know|sure|certain|aware|determined|decided|measured|have|got|specified)\s+(?:yet\s+)?(?:about\s+|of\s+)?(?:the\s+|our\s+|its\s+|what\s+the\s+|what\s+our\s+)?`;
const UNKNOWN_WORD = String.raw`(?:unknown|not\s+known|tbd|tba|to\s+be\s+determined|unclear|undetermined|not\s+sure|n\/a)`;

function fieldsForTopic(topicText: string): FieldId[] {
  const t = topicText.toLowerCase();
  for (const topic of TOPICS) {
    if (new RegExp(`^(?:${topic.words})$`, 'i').test(t)) return topic.fields;
  }
  return [];
}

/**
 * "We don't know the viscosity yet" -> viscosity is recorded as UNKNOWN *declared by the user*,
 * so the engine does not ask for it again, while it still appears as missing for the engineer.
 */
export const declaredUnknownRule: Rule = (scan) => {
  const patterns = [
    new RegExp(String.raw`${NEGATED_KNOW}(?<topic>${ANY_TOPIC})\b`, 'gi'),
    new RegExp(String.raw`\b(?<topic>${ANY_TOPIC})\s*(?:is|are|=|:)?\s*${UNKNOWN_WORD}`, 'gi'),
    new RegExp(String.raw`\b(?:unknown|tbd|tba)\s+(?<topic>${ANY_TOPIC})\b`, 'gi'),
  ];
  for (const re of patterns) {
    for (const m of scan.matches(re)) {
      for (const fieldId of fieldsForTopic(m.groups?.topic ?? '')) {
        scan.declaredUnknown(fieldId, m[0].trim(), 'The user stated this is not known yet.');
      }
      scan.consume(m);
    }
  }
};
