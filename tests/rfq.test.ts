import { describe, expect, it } from 'vitest';
import { buildEngineeringBrief, buildExportText, buildRFQ, createEmptyBrief, getPlatformContext, IntakeSession, rfqToText } from '../src/engine/index.ts';
import type { RFQDraft } from '../src/engine/index.ts';
import { DEMO_CASE_TEXT } from '../src/data/demo.ts';
import { PLATFORM_DISCLAIMER, PLATFORM_HEADING, SAFETY_NOTICE } from '../src/data/products.ts';
import { RFQ_STATUS_SUFFIX } from '../src/rfq/index.ts';
import { getField } from '../src/models/brief.ts';
import { runInput } from './helpers.ts';

const NOW = new Date('2026-10-04T12:34:56Z');

const rfqOf = (session: IntakeSession, options: Parameters<typeof buildRFQ>[1] = {}): RFQDraft =>
  buildRFQ(session.brief, { now: NOW, ...options }, session.profile);

/** label -> the line's text (several lines joined with " | "). */
function lineMap(rfq: RFQDraft): Record<string, string> {
  return Object.fromEntries(rfq.lines.map((l) => [l.label, l.lines.join(' | ')]));
}

const LABELS = [
  'Company',
  'Contact',
  'Application',
  'Material',
  'Components',
  'Ratio',
  'Viscosity',
  'Flow Rate',
  'Shot Size',
  'Production',
  'Automation',
  'Part Description',
  'Environment',
  'Additional Notes',
];

describe('buildRFQ: structure', () => {
  it('is a DRAFT that says engineer review is required, with a deterministic timestamp', () => {
    const rfq = buildRFQ(createEmptyBrief(), { now: NOW });
    expect(rfq.title).toBe('REQUEST FOR QUOTE — DRAFT');
    expect(rfq.status).toBe('DRAFT — engineer review required');
    expect(rfq.generatedAt).toBe('2026-10-04 12:34 UTC');
    expect(rfq.disclaimer).toBe(SAFETY_NOTICE);
  });

  it('always lists the same lines in the same order', async () => {
    expect(buildRFQ(createEmptyBrief(), { now: NOW }).lines.map((l) => l.label)).toEqual(LABELS);
    const s = await runInput(DEMO_CASE_TEXT);
    expect(rfqOf(s).lines.map((l) => l.label)).toEqual(LABELS);
  });

  it('an empty brief says "Not provided" everywhere and provides nothing', () => {
    const rfq = buildRFQ(createEmptyBrief(), { now: NOW });
    for (const line of rfq.lines) {
      expect(line.provided, line.label).toBe(false);
      for (const text of line.lines) expect(text, line.label).toMatch(/Not provided/);
    }
    expect(lineMap(rfq).Viscosity).toBe('Component A — Not provided | Component B — Not provided');
  });

  it('plain-text rendering has the title, every label, the platform block and the disclaimer', () => {
    const text = rfqToText(buildRFQ(createEmptyBrief(), { now: NOW }));
    expect(text.startsWith('REQUEST FOR QUOTE — DRAFT\nStatus: DRAFT — engineer review required\nGenerated: 2026-10-04 12:34 UTC')).toBe(true);
    for (const label of LABELS) expect(text).toContain(`${label}:`);
    expect(text).toContain('PRELIMINARY PLATFORM CONTEXT');
    expect(text).toContain('ENGINEER REVIEW NOTES');
    expect(text.trimEnd().endsWith(SAFETY_NOTICE)).toBe(true);
  });
});

describe('buildRFQ: values come only from what the user said', () => {
  it('spec example 1: only the stated values are filled in', async () => {
    const lines = lineMap(rfqOf(await runInput('We need to pot 500 electronic modules per hour using a two-component epoxy.')));
    expect(lines).toMatchObject({
      Material: 'Epoxy',
      Components: '2',
      Production: '500 parts/hour',
      Ratio: 'Not provided',
      'Flow Rate': 'Not provided',
      'Shot Size': 'Not provided',
      Automation: 'Not provided',
      Viscosity: 'Component A — Not provided | Component B — Not provided',
    });
  });

  it('the demo case fills the stated values and marks "approximately" as approximate', async () => {
    const lines = lineMap(rfqOf(await runInput(DEMO_CASE_TEXT), { company: 'Acme Electronics', contact: 'J. Doe' }));
    expect(lines).toMatchObject({
      Company: 'Acme Electronics',
      Contact: 'J. Doe',
      Material: 'Epoxy',
      Components: '2',
      Ratio: '10:1',
      'Shot Size': '15 g (approximate)',
      Production: '500 parts/hour',
      Automation: 'Automated',
      'Flow Rate': 'Not provided',
    });
  });

  it('flow rate, shot size and production keep their own units', async () => {
    const lines = lineMap(rfqOf(await runInput('We need 100 cc/min, 12 cc per part, 30 parts per minute.')));
    expect(lines['Flow Rate']).toBe('100 cc/min');
    expect(lines['Shot Size']).toBe('12 cc');
    expect(lines.Production).toBe('30 parts/minute');
  });

  it('inferred values are marked as unconfirmed', async () => {
    const rfq = rfqOf(await runInput('We use a 10:1 epoxy and need 100 cc/min.'));
    const lines = lineMap(rfq);
    expect(lines.Components).toBe(`2${RFQ_STATUS_SUFFIX.INFERRED}`);
    expect(lines.Application).toBe('Potting & Encapsulation (assumed from tool scope — not stated by the user)');
    expect(lines.Ratio).toBe('10:1');
    expect(lines['Flow Rate']).toBe('100 cc/min');
  });

  it('an inferred automation level (from a robot) is marked as unconfirmed', async () => {
    const lines = lineMap(rfqOf(await runInput('We need a robotic potting system.')));
    expect(lines.Automation).toBe(`Automated, robotic handling${RFQ_STATUS_SUFFIX.INFERRED}`);
  });

  it('a robot without any stated automation level does not claim one', async () => {
    const s = await runInput('We have a robot and a conveyor.');
    expect(getField(s.brief, 'automation.automationLevel').status).toBe('INFERRED');
    expect(lineMap(rfqOf(s)).Automation).toContain('unconfirmed');
  });

  it('a qualitative viscosity is not a number: it stays "Not provided", with the user\'s words', async () => {
    const lines = lineMap(rfqOf(await runInput('The epoxy has high viscosity.')));
    expect(lines.Viscosity).toBe(
      'Component A — Not provided (user said: “high viscosity”) | Component B — Not provided (user said: “high viscosity”)',
    );
  });

  it('a range is not a value', async () => {
    const lines = lineMap(rfqOf(await runInput('We dispense between 10 and 20 grams per shot and run 400-600 parts per hour.')));
    expect(lines['Shot Size']).toMatch(/^Not provided \(user said: “between 10 and 20 grams per shot”\)$/);
    expect(lines.Production).toMatch(/^Not provided \(user said: “400-600 parts per hour”\)$/);
  });

  it('a bound is not a value', async () => {
    const lines = lineMap(rfqOf(await runInput('We need up to 600 parts per hour.')));
    expect(lines.Production).toMatch(/^Not provided \(user said:/);
  });

  it('a value given without a unit says so', async () => {
    const s = await runInput('hello');
    while (s.currentQuestion && s.currentQuestion.fieldId !== 'production.shotSize') await s.skip();
    await s.submit('15');
    expect(lineMap(rfqOf(s))['Shot Size']).toBe('15 (unit not confirmed — stated as “15”)');
  });

  it('conflicting statements are shown as a conflict, not resolved', async () => {
    const lines = lineMap(rfqOf(await runInput('We mix it 10:1, actually maybe 5:1, not sure.')));
    expect(lines.Ratio).toBe('Not provided (conflicting statements: 10:1 vs 5:1)');
  });

  it('"I don\'t know" is "Not provided"', async () => {
    const lines = lineMap(rfqOf(await runInput("We don't know the viscosity yet.")));
    expect(lines.Viscosity).toBe('Component A — Not provided | Component B — Not provided');
  });

  it('a single-component material: ratio does not apply and there is one viscosity line', async () => {
    const lines = lineMap(rfqOf(await runInput('We pot with a single component silicone.')));
    expect(lines.Ratio).toBe('Not applicable (single-component material)');
    expect(lines.Viscosity).toBe('Material — Not provided');
  });

  it('a single component with a ratio: the stated ratio is shown and flagged, never hidden', async () => {
    const rfq = rfqOf(await runInput('We use a single component epoxy mixed 10:1.'));
    const lines = lineMap(rfq);
    expect(lines.Ratio).toBe(`10:1${RFQ_STATUS_SUFFIX.REQUIRES_ENGINEER_REVIEW}`);
    expect(lines.Components).toBe(`1${RFQ_STATUS_SUFFIX.REQUIRES_ENGINEER_REVIEW}`);
    expect(rfq.reviewNotes.map((n) => n.id)).toContain('RATIO_COMPONENT_MISMATCH');
    expect(rfq.reviewNotes.find((n) => n.id === 'RATIO_COMPONENT_MISMATCH')?.message).toMatch(/^A single component was stated but the ratio 10:1 has 2 terms/);
  });

  it('three components get a Component C viscosity line', async () => {
    const lines = lineMap(rfqOf(await runInput('We have three components with a 1:1:1 ratio.')));
    expect(lines.Viscosity).toBe('Component A — Not provided | Component B — Not provided | Component C — Not provided');
  });

  it('the mix basis (by weight / by volume) is kept', async () => {
    expect(lineMap(rfqOf(await runInput('Two component epoxy, 10 to 1 by weight.'))).Ratio).toBe('10:1 (by weight)');
    expect(lineMap(rfqOf(await runInput('Two component epoxy, 4:1 by volume.'))).Ratio).toBe('4:1 (by volume)');
  });

  it('a hazardous environment is passed on for review, not assessed', async () => {
    const rfq = rfqOf(await runInput('The potting area is an explosive atmosphere, ATEX zone 1.'));
    expect(lineMap(rfq).Environment).toBe('Hazardous environment stated (requires engineer review)');
    expect(rfq.reviewNotes.some((n) => /No safety classification was assessed/.test(n.message))).toBe(true);
  });

  it('extra details a user mentions are kept under Additional Notes', async () => {
    const lines = lineMap(rfqOf(await runInput('The material is silicone, glass-filled, heated to 60 °C, with a shot of 1,5 g.')));
    expect(lines['Additional Notes']).toContain('Material temperature: 60 °C');
    expect(lines['Additional Notes']).toContain('Filled material: Yes');
    expect(lines['Shot Size']).toBe('1.5 g');
  });

  it('the description is kept verbatim in the notes', async () => {
    const text = 'We manually dispense silicone into electronic housings.';
    expect(lineMap(rfqOf(await runInput(text)))['Additional Notes']).toContain(`User description (verbatim): “${text}”`);
  });
});

describe('buildRFQ: company, contact and notes', () => {
  it('options win over the brief and are trimmed; blank means "Not provided"', async () => {
    const s = await runInput('We use epoxy.');
    s.setRfqDetail('company', 'Brief Co');
    s.setRfqDetail('contactName', 'Brief Person');
    expect(lineMap(rfqOf(s)).Company).toBe('Brief Co');
    expect(lineMap(rfqOf(s)).Contact).toBe('Brief Person');
    expect(lineMap(rfqOf(s, { company: '  Option Co  ', contact: ' Option Person ' }))).toMatchObject({ Company: 'Option Co', Contact: 'Option Person' });
    expect(lineMap(rfqOf(s, { company: '   ', contact: '' }))).toMatchObject({ Company: 'Brief Co', Contact: 'Brief Person' });
    s.setRfqDetail('company', '');
    expect(lineMap(rfqOf(s)).Company).toBe('Not provided');
  });

  it('notes typed by the user come first', async () => {
    const s = await runInput('We use epoxy.');
    s.setRfqDetail('additionalNotes', 'Please call before quoting.');
    const notes = rfqOf(s).lines.find((l) => l.label === 'Additional Notes')?.lines ?? [];
    expect(notes[0]).toBe('User notes: Please call before quoting.');
    expect(notes.some((n) => n.startsWith('User description (verbatim)'))).toBe(true);
    expect(rfqOf(s, { additionalNotes: 'From the form' }).lines.find((l) => l.label === 'Additional Notes')?.lines[0]).toBe('User notes: From the form');
  });

  it('company and contact count as provided only when given', async () => {
    const s = await runInput('We use epoxy.');
    expect(rfqOf(s).lines.find((l) => l.label === 'Company')?.provided).toBe(false);
    expect(rfqOf(s, { company: 'Acme' }).lines.find((l) => l.label === 'Company')?.provided).toBe(true);
  });
});

describe('getPlatformContext', () => {
  const contextFor = async (text: string) => getPlatformContext((await runInput(text)).brief);

  it('is silent without a component count', async () => {
    const ctx = await contextFor('We need to pot 500 modules per hour.');
    expect(ctx.available).toBe(false);
    expect(ctx.entries).toEqual([]);
    expect(ctx.reason).toMatch(/number of components is not known/);
  });

  it('is silent when the component count is only inferred', async () => {
    const ctx = await contextFor('We use a 10:1 epoxy.');
    expect(ctx.available).toBe(false);
    expect(ctx.reason).toMatch(/only inferred/);
  });

  it('is silent for two components with no ratio', async () => {
    const ctx = await contextFor('We use a two-component epoxy.');
    expect(ctx.available).toBe(false);
    expect(ctx.reason).toMatch(/mix ratio is not known/);
  });

  it('is silent for a single component', async () => {
    const ctx = await contextFor('We use a single component silicone.');
    expect(ctx.available).toBe(false);
    expect(ctx.reason).toMatch(/Single-component/);
  });

  it('is silent when the component count and ratio disagree', async () => {
    for (const text of ['We use a two-component epoxy with a 1:1:1 ratio.', 'We use a single component epoxy mixed 10:1.']) {
      const ctx = await contextFor(text);
      expect(ctx.available, text).toBe(false);
      expect(ctx.reason, text).toMatch(/do not agree/);
    }
  });

  it('two components and a ratio: PK1D and PK2D as "potentially relevant", with the ratio checked against the published range', async () => {
    const ctx = await contextFor('We use a two-component epoxy mixed 10:1.');
    expect(ctx.available).toBe(true);
    expect(ctx.entries.map((e) => e.id)).toEqual(['PK1D', 'PK2D']);
    for (const e of ctx.entries) expect(e.statement).toContain('Potentially relevant platform');
    expect(ctx.entries[1]?.statement).toContain('1:1 to 100:1');
    expect(ctx.entries[1]?.statement).toContain('lies within that published range');
    expect(ctx.entries[1]?.statement).toContain('not a confirmation of suitability');
  });

  it('a ratio outside the published range is not presented as relevant', async () => {
    const ctx = await contextFor('We use a two-component epoxy mixed 200:1.');
    const pk2 = ctx.entries.find((e) => e.id === 'PK2D');
    expect(pk2?.statement).toContain('outside that published range');
    expect(pk2?.statement).not.toContain('Potentially relevant');
  });

  it('a ratio written smaller-term-first is left for the engineer', async () => {
    const ctx = await contextFor('We use a two-component epoxy mixed 1:10.');
    expect(ctx.entries.find((e) => e.id === 'PK2D')?.statement).toContain('smaller term first');
  });

  it('three components: PK3D', async () => {
    const ctx = await contextFor('We have three components with a 1:1:1 ratio.');
    expect(ctx.entries.map((e) => e.id)).toEqual(['PK3D']);
  });

  it('four components: PK6D / Custom context only', async () => {
    const ctx = await contextFor('We have four components.');
    expect(ctx.entries.map((e) => e.name)).toEqual(['PK6D / Custom']);
    expect(ctx.entries[0]?.statement).toContain('higher-complexity or custom');
  });

  it('always carries the heading and the engineering-review disclaimer, and never claims a platform is correct', async () => {
    const texts = [
      '',
      'We use a two-component epoxy mixed 10:1.',
      'We use a two-component epoxy mixed 200:1.',
      'We use a two-component epoxy mixed 1:10.',
      'We have three components with a 1:1:1 ratio.',
      'We have four components.',
      'We use a single component silicone.',
      'We use a two-component epoxy with a 1:1:1 ratio.',
    ];
    for (const text of texts) {
      const s = new IntakeSession();
      if (text) await s.submit(text);
      const ctx = getPlatformContext(s.brief);
      expect(ctx.heading).toBe(PLATFORM_HEADING);
      expect(ctx.disclaimer).toBe(PLATFORM_DISCLAIMER);
      expect(ctx.disclaimer).toBe('Final system selection requires Fluidic engineering review.');
      const words = [ctx.reason ?? '', ...ctx.entries.flatMap((e) => [e.statement, e.basis])].join(' ');
      expect(words, text).not.toMatch(/\b(?:is|are)\s+(?:the\s+)?(?:correct|right|best|ideal|recommended|suitable)\b|guarantee|definitely|certainly|will work|we recommend/i);
    }
  });
});

describe('buildEngineeringBrief', () => {
  const rowsOf = (view: ReturnType<typeof buildEngineeringBrief>) => Object.fromEntries(view.rows.map((r) => [r.label, r]));

  it('has the fixed set of rows', () => {
    const view = buildEngineeringBrief(createEmptyBrief());
    expect(view.title).toBe('ENGINEERING BRIEF');
    expect(view.rows.map((r) => r.label)).toEqual([
      'Application',
      'Material',
      'Mix Ratio',
      'Production',
      'Shot Size',
      'Flow Rate',
      'Viscosity',
      'Automation',
      'Part',
      'Environment',
    ]);
  });

  it('an empty brief is Unknown everywhere (never a guess)', () => {
    const view = buildEngineeringBrief(createEmptyBrief());
    for (const row of view.rows) {
      if (row.label === 'Viscosity') {
        expect(row.children?.map((c) => [c.label, c.value, c.status])).toEqual([
          ['Component A', 'Unknown', 'UNKNOWN'],
          ['Component B', 'Unknown', 'UNKNOWN'],
        ]);
      } else {
        expect([row.label, row.value, row.status]).toEqual([row.label, 'Unknown', 'UNKNOWN']);
      }
    }
    expect(view.completeness.percent).toBe(0);
    expect(view.platformContext.available).toBe(false);
  });

  it('always requires engineer review and carries the safety notice', async () => {
    const view = buildEngineeringBrief((await runInput(DEMO_CASE_TEXT)).brief);
    expect(view.engineerReview).toEqual({ required: true, label: 'Required', statement: expect.stringContaining('qualified Fluidic engineer') });
    expect(view.disclaimer).toBe(SAFETY_NOTICE);
    expect(view.reviewFlags[0]?.id).toBe('ENGINEER_REQUIRED');
  });

  it('each row reports KNOWN / UNKNOWN / INFERRED / REQUIRES_ENGINEER_REVIEW honestly', async () => {
    const stated = rowsOf(buildEngineeringBrief((await runInput('We need to pot 500 electronic modules per hour using a two-component epoxy.')).brief));
    expect(stated.Material).toMatchObject({ value: '2-component epoxy', status: 'KNOWN' });
    expect(stated.Production).toMatchObject({ value: '500 parts/hour', status: 'KNOWN' });
    expect(stated['Mix Ratio']).toMatchObject({ value: 'Unknown', status: 'UNKNOWN' });
    expect(stated['Shot Size']).toMatchObject({ value: 'Unknown', status: 'UNKNOWN' });

    const inferred = rowsOf(buildEngineeringBrief((await runInput('We use a 10:1 epoxy and need 100 cc/min.')).brief));
    expect(inferred.Material?.status).toBe('INFERRED');
    expect(inferred.Material?.detail).toMatch(/Inferred from the 2-term ratio/);
    expect(inferred['Mix Ratio']).toMatchObject({ value: '10:1', status: 'KNOWN' });
    expect(inferred['Flow Rate']).toMatchObject({ value: '100 cc/min', status: 'KNOWN' });
    expect(inferred.Application?.status).toBe('INFERRED');

    const qualitative = rowsOf(buildEngineeringBrief((await runInput('The epoxy has high viscosity.')).brief));
    expect(qualitative.Viscosity?.children?.map((c) => c.status)).toEqual(['REQUIRES_ENGINEER_REVIEW', 'REQUIRES_ENGINEER_REVIEW']);
    expect(qualitative.Viscosity?.children?.[0]?.value).toBe('Unknown (user said: “high viscosity”)');

    const partial = rowsOf(buildEngineeringBrief((await runInput('We have two components.')).brief));
    expect(partial.Material?.status).toBe('PARTIAL');
  });

  it('a component count that contradicts the ratio is never shown as plain KNOWN', async () => {
    for (const text of ['We use a two-component epoxy with a 1:1:1 ratio.', 'We use a single component epoxy mixed 10:1.']) {
      const s = await runInput(text);
      const view = buildEngineeringBrief(s.brief);
      const rows = rowsOf(view);
      expect(rows.Material?.status, text).toBe('REQUIRES_ENGINEER_REVIEW');
      expect(rows['Mix Ratio']?.status, text).toBe('REQUIRES_ENGINEER_REVIEW');
      expect(rows['Mix Ratio']?.detail, text).toMatch(/terms — confirm which is correct/);
      expect(view.completeness.needsReview.map((f) => f.fieldId), text).toEqual(expect.arrayContaining(['material.componentCount', 'mixing.ratio']));
      expect(view.completeness.known.map((f) => f.fieldId), text).not.toContain('mixing.ratio');
      expect(view.reviewFlags.map((f) => f.id), text).toContain('RATIO_COMPONENT_MISMATCH');
    }
  });

  it('a single component shows the ratio as not applicable', async () => {
    const rows = rowsOf(buildEngineeringBrief((await runInput('We pot with a single component silicone.')).brief));
    expect(rows['Mix Ratio']).toMatchObject({ value: 'Not applicable (single component)', status: 'NOT_APPLICABLE' });
    expect(rows.Viscosity?.children?.map((c) => c.label)).toEqual(['Material']);
  });

  it('the field-level table lists every field with its status and source', async () => {
    const s = await runInput(DEMO_CASE_TEXT);
    const view = buildEngineeringBrief(s.brief);
    expect(view.fieldTable.length).toBeGreaterThan(20);
    const byId = Object.fromEntries(view.fieldTable.map((r) => [r.fieldId, r]));
    expect(byId['mixing.ratio']).toMatchObject({ value: '10:1', status: 'KNOWN' });
    expect(byId['mixing.ratio']?.provenance).toContain('Stated by the user');
    expect(byId['properties.viscosityA']).toMatchObject({ value: 'Unknown', status: 'UNKNOWN', provenance: 'Not provided' });
    for (const r of view.fieldTable) {
      expect(r.provenance.length, r.fieldId).toBeGreaterThan(0);
      expect(r.groupLabel.length, r.fieldId).toBeGreaterThan(0);
    }
    expect(view.fieldTable.some((r) => r.fieldId === 'contact.company')).toBe(false);
  });

  it('the completeness indicator never goes down when information is added', async () => {
    const s = new IntakeSession();
    const messages = [
      'We pot electronic modules.',
      'Two-component epoxy, mixed 10:1.',
      'We need 500 parts per hour.',
      'About 15 g per part.',
      'Component A viscosity is 5000 cP and component B is 200 cP.',
      '100 cc/min.',
      'The process is automated.',
    ];
    const percents: number[] = [buildEngineeringBrief(s.brief).completeness.percent];
    for (const m of messages) {
      await s.submit(m);
      percents.push(buildEngineeringBrief(s.brief).completeness.percent);
    }
    expect(percents[0]).toBe(0);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents.at(-1)).toBeGreaterThan(60);
    expect(percents.every((p) => p >= 0 && p <= 100)).toBe(true);
  });

  it('the completeness report lists what is known and what is missing, with the "not a measure" note', async () => {
    const view = buildEngineeringBrief((await runInput('We need to pot 500 electronic modules per hour using a two-component epoxy.')).brief);
    const known = view.completeness.known.map((f) => f.fieldId);
    expect(known).toEqual(expect.arrayContaining(['material.componentCount', 'material.chemistry', 'production.productionRate']));
    expect(view.completeness.missing.map((m) => m.fieldId)).toEqual(expect.arrayContaining(['mixing.ratio', 'production.shotSize']));
    expect(view.completeness.missing.map((m) => m.fieldId)).not.toContain('material.componentCount');
    expect(view.completeness.note).toMatch(/not a technical or scientific measure/);
    expect(view.completeness.required.provided).toBeLessThan(view.completeness.required.total);
  });
});

describe('buildExportText', () => {
  it('is the RFQ plus the status and source of every field', async () => {
    const s = await runInput('We use a 10:1 epoxy and need 100 cc/min. The viscosity is high.');
    const rfq = rfqOf(s);
    const text = buildExportText(s.brief, rfq, s.profile);
    expect(text.startsWith(rfqToText(rfq))).toBe(true);
    expect(text).toContain('ATTACHMENT — FIELD-LEVEL DETAIL');
    expect(text).toContain('[KNOWN] Mix ratio: 10:1');
    expect(text).toContain('[INFERRED] Number of components: 2');
    expect(text).toContain('[REQUIRES_ENGINEER_REVIEW] Viscosity — Component A');
    expect(text).toContain('[UNKNOWN] Shot size / dispensed volume: Unknown');
    expect(text).toMatch(/RFQ completeness indicator: \d+% \(.*not a technical or scientific measure/);
  });
});
