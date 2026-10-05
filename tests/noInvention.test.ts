import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildEngineeringBrief,
  buildExportText,
  buildRFQ,
  calculateCompleteness,
  createEmptyBrief,
  extractRequirements,
  IntakeSession,
  rfqToText,
} from '../src/engine/index.ts';
import { applyExtraction } from '../src/engine/merge.ts';
import { DEMO_CASE_TEXT } from '../src/data/demo.ts';
import { PLATFORM_DISCLAIMER, SAFETY_NOTICE } from '../src/data/products.ts';
import { FIELD_IDS } from '../src/models/types.ts';
import type { FieldId } from '../src/models/types.ts';
import { getField, hasValue } from '../src/models/brief.ts';
import { parseNumber } from '../src/utils/text.ts';
import { knownFieldIds, runInput, tokens } from './helpers.ts';

/**
 * Global properties of the intake engine: whatever the user writes, nothing is invented,
 * nothing inferred is presented as fact, and nothing claims that a machine is the right one.
 */

interface CaseFile {
  cases: Array<{ id: string; name: string; input: string }>;
}
const CASES = (JSON.parse(readFileSync(new URL('../test-cases.json', import.meta.url), 'utf8')) as CaseFile).cases;

const COMPLETE_TEXT =
  'We pot 500 control modules per hour with an automated robotic cell. The two-component epoxy is mixed 10:1 by volume. ' +
  'Component A viscosity is 8000 cP and component B is 200 cP. We dispense 15 g per part at 100 cc/min. ' +
  'The material is glass-filled and heated to 60 °C. Cycle time is 12 seconds. The parts are circuit boards in plastic housings. ' +
  'The area is a cleanroom. There is an existing conveyor and we must integrate with a Profinet PLC.';

const NOISE = [
  'The weather is nice today.',
  'Please contact us soon, thanks a lot.',
  'Lorem ipsum dolor sit amet.',
  'a b c d e f',
  '???',
  'Necesitamos encapsular 500 módulos por hora con epoxi de dos componentes.',
];

const INPUTS: Array<readonly [string, string]> = [
  ...CASES.map((c) => [`${c.id} ${c.name}`, c.input] as const),
  ['demo', DEMO_CASE_TEXT],
  ['complete description', COMPLETE_TEXT],
  ...NOISE.map((n) => [`noise: ${n}`, n] as const),
];

const NUMBER_WORDS: Record<string, number> = { one: 1, single: 1, two: 2, bi: 2, double: 2, three: 3, tri: 3, four: 4, five: 5, six: 6 };

/** Numbers as a person writes them: "2,000" -> 2000, "1,5" -> 1.5, "100k" -> 100000 (also kept as 100). */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d.,]*\d|\d)(\s*k\b)?/gi)) {
    const n = parseNumber(m[1] ?? '');
    if (n === null) continue;
    out.push(n);
    if (m[2]) out.push(n * 1000);
  }
  return out;
}

function numberWordsIn(text: string): number[] {
  return tokens(text).flatMap((t) => (t in NUMBER_WORDS ? [NUMBER_WORDS[t] as number] : []));
}

describe('known values are traceable to the user\'s own words', () => {
  it.each(INPUTS)('%s', async (_name, input) => {
    const s = await runInput(input);
    const inputTokens = new Set(tokens(input));
    const problems: string[] = [];

    for (const id of FIELD_IDS) {
      if (id === 'application.description') continue;
      const f = getField(s.brief, id);
      if (!hasValue(f) || f.derived || f.status !== 'KNOWN') continue;

      if (!f.raw) {
        problems.push(`${id}: KNOWN but has no evidence`);
        continue;
      }
      const missingTokens = tokens(f.raw).filter((t) => !inputTokens.has(t));
      if (missingTokens.length > 0) problems.push(`${id}: evidence “${f.raw}” has words that are not in the input: ${missingTokens.join(', ')}`);

      if (typeof f.value === 'number') {
        const fromDigits = numbersIn(f.raw);
        const candidates = fromDigits.length > 0 ? fromDigits : numberWordsIn(f.raw);
        if (!candidates.includes(f.value)) problems.push(`${id}: value ${f.value} is not in the evidence “${f.raw}”`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('what is inferred is never presented as fact', () => {
  it.each(INPUTS)('%s', async (_name, input) => {
    const s = await runInput(input);
    const inferred = FIELD_IDS.filter((id) => getField(s.brief, id).status === 'INFERRED' && hasValue(getField(s.brief, id)));
    const report = calculateCompleteness(s.brief, s.profile);
    const view = buildEngineeringBrief(s.brief, s.profile);

    for (const id of inferred) {
      const f = getField(s.brief, id);
      expect(f.origin, id).toBe('INFERRED');
      expect(f.note?.length ?? 0, `${id} needs a note saying why it was inferred`).toBeGreaterThan(0);
      expect(report.known.map((k) => k.fieldId), `${id} must not be listed as known`).not.toContain(id);
      expect(knownFieldIds(s.brief), id).not.toContain(id);
    }
    // ... and the RFQ marks every inferred number or choice that it prints.
    const rfq = buildRFQ(s.brief, {}, s.profile);
    const rfqText = rfqToText(rfq);
    if (inferred.includes('material.componentCount')) expect(rfqText).toContain('(inferred — unconfirmed)');
    if (inferred.length > 0) expect(view.reviewFlags.map((f) => f.id)).toContain('INFERRED');
  });

  it('a user-stated value is never replaced by an inference', async () => {
    const s = await runInput('We use a two-component epoxy with a 1:1:1 ratio.');
    expect(getField(s.brief, 'material.componentCount')).toMatchObject({ value: 2, status: 'KNOWN' });
  });

  it('a later statement replaces an earlier inference, and says so', async () => {
    const s = await runInput('Mix ratio of 100:1.');
    expect(getField(s.brief, 'material.componentCount')).toMatchObject({ value: 2, status: 'INFERRED' });
    await s.submit('Actually it has three components.');
    expect(getField(s.brief, 'material.componentCount')).toMatchObject({ value: 3, status: 'KNOWN' });
  });
});

describe('qualitative, ranged, bounded and unknown statements never become numbers', () => {
  const NUMERIC: FieldId[] = [
    'properties.viscosityA',
    'properties.viscosityB',
    'properties.viscosityC',
    'production.flowRate',
    'production.shotSize',
    'production.productionRate',
    'production.cycleTime',
    'properties.temperature',
    'environment.operatingTemperature',
  ];
  const statements = [
    'The epoxy has high viscosity.',
    'It is a very viscous paste-like resin.',
    'Viscosity between 3000 and 5000 cP.',
    'We dispense between 10 and 20 grams per shot.',
    'Shot size 10-20 g.',
    'We run 400-600 parts per hour.',
    'We need up to 600 parts per hour.',
    'We need at least 50 cc/min.',
    'Flow rate no more than 200 cc/min.',
    "We don't know the viscosity yet.",
    "We don't know the flow rate or the shot size.",
    'The flow rate is not known.',
    'Production is somewhere between 500 and 600 parts an hour.',
  ];

  it.each(statements)('"%s"', async (text) => {
    const s = await runInput(text);
    for (const id of NUMERIC) {
      expect(getField(s.brief, id).value, `${id} must stay empty`).toBeNull();
    }
  });
});

describe('no number appears in the RFQ that the user did not give', () => {
  it.each(INPUTS)('%s', async (_name, input) => {
    const s = await runInput(input);
    const given = new Set([...numbersIn(input), ...numberWordsIn(input)]);
    const rfq = buildRFQ(s.brief, {}, s.profile);
    const problems: string[] = [];
    for (const line of rfq.lines) {
      for (const text of line.lines) {
        const marked = /inferred|unconfirmed|assumed/.test(text);
        for (const n of numbersIn(text)) {
          if (!given.has(n) && !marked) problems.push(`${line.label}: “${text}” contains ${n}, which is not in the input and is not marked as inferred`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('the tool never claims a machine is the right one, and never promises anything', () => {
  const BANNED: RegExp[] = [
    /\bguarantee/i,
    /\bdefinitely\b/i,
    /\bcertainly\b/i,
    /\bwill work\b/i,
    /\bwe recommend\b/i,
    /\brecommended\s+(?:system|platform|machine|equipment|configuration)\b/i,
    /\b(?:system|platform|machine|equipment|configuration|PK\d\w*)\s+(?:is|are)\s+(?:the\s+)?(?:correct|right|best|ideal|recommended|suitable|compatible)\b/i,
    /\b(?:the\s+)?(?:correct|right|best|ideal|perfect)\s+(?:system|platform|machine|equipment|configuration)\b/i,
  ];

  async function everything(input: string): Promise<string> {
    const s = await runInput(input);
    const parts: string[] = [];
    const collect = (): void => {
      for (const e of s.transcript) {
        if (e.type === 'user') continue;
        if (e.type === 'understood') parts.push(e.intro, e.outro ?? '', ...e.items.flatMap((i) => [i.label, i.value, i.note ?? '']));
        else if (e.type === 'question') parts.push(e.question.prompt, e.question.hint ?? '', e.question.placeholder ?? '', ...(e.question.choices ?? []).map((c) => c.label));
        else parts.push(e.text);
      }
    };
    while (s.currentQuestion) await s.skip();
    collect();
    const rfq = buildRFQ(s.brief, {}, s.profile);
    parts.push(rfqToText(rfq), buildExportText(s.brief, rfq, s.profile));
    const view = buildEngineeringBrief(s.brief, s.profile);
    for (const row of view.rows) parts.push(row.value, row.detail ?? '', ...(row.children ?? []).flatMap((c) => [c.value, c.detail ?? '']));
    for (const flag of view.reviewFlags) parts.push(flag.message);
    parts.push(view.completeness.note, view.engineerReview.statement, view.disclaimer, view.platformContext.disclaimer, view.platformContext.reason ?? '');
    for (const entry of view.platformContext.entries) parts.push(entry.statement, entry.basis);
    return parts.join('\n');
  }

  it.each(INPUTS)('%s', async (_name, input) => {
    const text = await everything(input);
    for (const re of BANNED) expect(text, String(re)).not.toMatch(re);
  });

  it('shows the preliminary-intake notice and the engineering-review disclaimer in every RFQ and brief', async () => {
    for (const [, input] of INPUTS) {
      const s = await runInput(input);
      const rfq = buildRFQ(s.brief, {}, s.profile);
      const text = rfqToText(rfq);
      expect(text).toContain(SAFETY_NOTICE);
      expect(text).toContain(PLATFORM_DISCLAIMER);
      const view = buildEngineeringBrief(s.brief, s.profile);
      expect(view.disclaimer).toBe(SAFETY_NOTICE);
      expect(view.platformContext.disclaimer).toBe(PLATFORM_DISCLAIMER);
      expect(view.engineerReview.required).toBe(true);
      expect(s.brief.metadata.engineerReviewRequired).toBe(true);
    }
  });

  it('SAFETY_NOTICE is exactly the required wording', () => {
    expect(SAFETY_NOTICE).toBe(
      'Preliminary engineering intake only. This tool does not determine final equipment selection. Final configuration and compatibility must be confirmed by a qualified Fluidic engineer.',
    );
    expect(PLATFORM_DISCLAIMER).toBe('Final system selection requires Fluidic engineering review.');
  });

  it('shows no platform when information is insufficient', async () => {
    for (const text of ['', 'hello', 'We pot 500 modules per hour.', 'We use a two-component epoxy.', 'We use a 10:1 epoxy.', 'We use a single component silicone.']) {
      const s = new IntakeSession();
      if (text) await s.submit(text);
      const view = buildEngineeringBrief(s.brief, s.profile);
      expect(view.platformContext.available, text).toBe(false);
      expect(view.platformContext.entries, text).toEqual([]);
    }
  });
});

describe('extraction is repeatable and does not accumulate', () => {
  it.each(INPUTS)('%s', (_name, input) => {
    const result = extractRequirements(input);
    const again = extractRequirements(input);
    expect(again).toEqual(result);

    const brief = createEmptyBrief();
    applyExtraction(brief, result, 1);
    const snapshot = FIELD_IDS.map((id) => [id, getField(brief, id).value, getField(brief, id).status] as const);
    applyExtraction(brief, result, 2);
    expect(FIELD_IDS.map((id) => [id, getField(brief, id).value, getField(brief, id).status] as const)).toEqual(snapshot);
  });

  it('repeating a statement is not a conflict', async () => {
    const s = await runInput('We use a 10:1 epoxy.');
    await s.submit('10:1');
    expect(getField(s.brief, 'mixing.ratio')).toMatchObject({ value: '10:1', status: 'KNOWN' });
    expect(getField(s.brief, 'mixing.ratio').candidates).toBeUndefined();
  });
});

describe('text with nothing technical in it', () => {
  it.each(NOISE)('"%s" fills in nothing and asks the first question', async (text) => {
    const s = await runInput(text);
    expect(knownFieldIds(s.brief)).toEqual([]);
    expect(s.currentQuestion?.fieldId).toBe('material.componentCount');
    const view = buildEngineeringBrief(s.brief, s.profile);
    expect(view.completeness.known).toEqual([]);
    expect(view.platformContext.available).toBe(false);
    const rfq = buildRFQ(s.brief, {}, s.profile);
    // Only the application (assumed from the tool scope, and marked so) and the verbatim description can appear.
    const provided = rfq.lines.filter((l) => l.provided).map((l) => l.label);
    expect(provided.filter((l) => l !== 'Application' && l !== 'Additional Notes')).toEqual([]);
  });
});
