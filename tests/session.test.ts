import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRFQ, calculateMissingFields, computeReviewFlags, getExtractor, IntakeSession, setExtractor } from '../src/engine/index.ts';
import type { ExtractionResult, Extractor, TranscriptEntry } from '../src/engine/index.ts';
import { DEMO_CASE_TEXT } from '../src/data/demo.ts';
import { getField, hasValue } from '../src/models/brief.ts';
import { runInput } from './helpers.ts';

const SPEC_1 = 'We need to pot 500 electronic modules per hour using a two-component epoxy.';
const TC28 = (JSON.parse(readFileSync(new URL('../test-cases.json', import.meta.url), 'utf8')) as { cases: Array<{ id: string; input: string }> }).cases.find((c) => c.id === 'TC-28')?.input ?? '';

const types = (s: IntakeSession): string[] => s.transcript.map((t) => t.type);
const questionsIn = (s: IntakeSession): number => s.transcript.filter((t) => t.type === 'question').length;
const last = <T extends TranscriptEntry['type']>(s: IntakeSession, type: T): Extract<TranscriptEntry, { type: T }> | undefined =>
  [...s.transcript].reverse().find((t): t is Extract<TranscriptEntry, { type: T }> => t.type === type);

describe('IntakeSession: initial state', () => {
  it('starts empty, waiting for a description, with honest metadata', () => {
    const s = new IntakeSession();
    expect(s.phase).toBe('AWAITING_DESCRIPTION');
    expect(s.transcript).toEqual([]);
    expect(s.currentQuestion).toBeNull();
    expect(s.brief.metadata).toMatchObject({ engineerReviewRequired: true, confidence: 'LOW', messageCount: 0 });
    expect(s.brief.metadata.missingRequiredFields).toEqual(expect.arrayContaining(['material.componentCount', 'material.chemistry', 'production.shotSize']));
  });

  it('ignores empty messages', async () => {
    const s = new IntakeSession();
    let notified = 0;
    s.subscribe(() => (notified += 1));
    await s.submit('');
    await s.submit('   \n ');
    expect(s.transcript).toEqual([]);
    expect(s.phase).toBe('AWAITING_DESCRIPTION');
    expect(notified).toBe(0);
  });
});

describe('IntakeSession: the first description', () => {
  it('says what it understood, then asks ONE question', async () => {
    const s = await runInput(SPEC_1);
    expect(types(s)).toEqual(['user', 'understood', 'question']);
    const understood = last(s, 'understood');
    expect(understood?.intro).toBe('Got it. I have identified:');
    expect(understood?.outro).toBe('I still need a few details.');
    const byField = Object.fromEntries((understood?.items ?? []).map((i) => [i.fieldId, i]));
    expect(byField['material.chemistry']).toMatchObject({ value: 'Epoxy', status: 'KNOWN' });
    expect(byField['material.componentCount']).toMatchObject({ value: '2', status: 'KNOWN' });
    expect(byField['production.productionRate']).toMatchObject({ value: '500 parts/hour', status: 'KNOWN' });
    expect(Object.keys(byField)).not.toContain('mixing.ratio');
    expect(s.phase).toBe('ASKING');
    expect(s.currentQuestion?.fieldId).toBe('mixing.ratio');
    expect(s.transcript.at(-1)).toMatchObject({ type: 'question', question: { fieldId: 'mixing.ratio' } });
  });

  it('what it says it understood matches what the brief shows: a contradicted count/ratio is "needs review", not "known"', async () => {
    const s = await runInput('We use a single component epoxy mixed 10:1.');
    const items = Object.fromEntries((last(s, 'understood')?.items ?? []).map((i) => [i.fieldId, i]));
    expect(items['material.chemistry']?.status).toBe('KNOWN');
    for (const id of ['material.componentCount', 'mixing.ratio']) {
      expect(items[id]?.status, id).toBe('REQUIRES_ENGINEER_REVIEW');
      expect(items[id]?.note, id).toMatch(/terms — confirm which is correct/);
    }
  });

  it('keeps the description verbatim and counts the message', async () => {
    const s = await runInput(SPEC_1);
    expect(getField(s.brief, 'application.description')).toMatchObject({ value: SPEC_1, status: 'KNOWN', origin: 'USER_STATED' });
    expect(s.brief.metadata.messageCount).toBe(1);
    expect(s.brief.metadata.engineerReviewRequired).toBe(true);
  });

  it('keeps the metadata in step with the brief', async () => {
    const s = await runInput(SPEC_1);
    expect(s.brief.metadata.missingRequiredFields).toEqual(calculateMissingFields(s.brief, s.profile).filter((m) => m.priority === 'REQUIRED').map((m) => m.fieldId));
    expect(s.brief.metadata.missingRequiredFields).not.toContain('material.componentCount');
    expect(s.brief.metadata.sourceOfInformation.length).toBeGreaterThan(0);
    expect(s.brief.metadata.sourceOfInformation.every((src) => src.raw.length > 0 && src.message === 1)).toBe(true);
  });

  it('says plainly when nothing technical could be extracted', async () => {
    const s = await runInput('hello');
    const notice = last(s, 'notice');
    expect(notice).toMatchObject({ tone: 'info' });
    expect(notice?.text).toContain('I could not extract technical details');
    expect(types(s)).toEqual(['user', 'notice', 'question']);
    expect(s.currentQuestion?.fieldId).toBe('material.componentCount');
  });

  it('gives every transcript entry a unique, increasing id', async () => {
    const s = await runInput(SPEC_1);
    await s.submit('10:1');
    await s.skip();
    const ids = s.transcript.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});

describe('IntakeSession: answering', () => {
  it('records the answer, says "Noted:", and asks the next single question', async () => {
    const s = await runInput(SPEC_1);
    const before = questionsIn(s);
    await s.submit('10:1');
    expect(getField(s.brief, 'mixing.ratio')).toMatchObject({ value: '10:1', status: 'KNOWN' });
    expect(last(s, 'understood')?.intro).toBe('Noted:');
    expect(questionsIn(s)).toBe(before + 1);
    expect(s.currentQuestion?.fieldId).toBe('properties.viscosityA');
    expect(s.brief.metadata.messageCount).toBe(2);
  });

  it('adds exactly one question per answer, whatever the user says', async () => {
    const s = await runInput('hello');
    const replies = ['2', 'epoxy', '10:1', '5000 cP', 'skip', "I don't know", '15 g', '500 parts per hour', 'banana', 'banana', 'automated'];
    for (const reply of replies) {
      const before = questionsIn(s);
      await s.submit(reply);
      expect(questionsIn(s) - before, reply).toBeLessThanOrEqual(1);
    }
    expect(getField(s.brief, 'material.componentCount').value).toBe(2);
    expect(getField(s.brief, 'properties.viscosityA').value).toBe(5000);
  });

  it('reads extra information inside an answer', async () => {
    const s = await runInput(SPEC_1);
    await s.submit('10:1, and the viscosity of component A is 5000 cP');
    expect(getField(s.brief, 'mixing.ratio').value).toBe('10:1');
    expect(getField(s.brief, 'properties.viscosityA')).toMatchObject({ value: 5000, status: 'KNOWN' });
    expect(getField(s.brief, 'properties.viscosityUnit').value).toBe('cP');
    expect(s.currentQuestion?.fieldId).toBe('properties.viscosityB');
  });

  it('answers by clicking a choice work the same as typing', async () => {
    const s = await runInput('hello');
    const choice = s.currentQuestion?.choices?.find((c) => c.label.startsWith('2'));
    expect(choice).toBeDefined();
    await s.submit(choice?.value ?? '');
    expect(getField(s.brief, 'material.componentCount')).toMatchObject({ value: 2, status: 'KNOWN' });
  });

  it('a clearly unreadable answer is retried once, then left as "Not provided" and flagged', async () => {
    const s = await runInput('hello');
    await s.submit('banana');
    expect(s.currentQuestion?.fieldId).toBe('material.componentCount'); // same question, one more try
    expect(last(s, 'notice')).toMatchObject({ tone: 'warning', text: 'Please give the number of components, for example 2.' });
    await s.submit('banana');
    expect(s.currentQuestion?.fieldId).toBe('material.chemistry'); // moved on
    expect(last(s, 'notice')?.text).toContain('stays "Not provided"');
    expect(hasValue(getField(s.brief, 'material.componentCount'))).toBe(false);
    expect(s.brief.metadata.missingRequiredFields).toContain('material.componentCount');
  });

  it('a valid answer after one unreadable try is accepted', async () => {
    const s = await runInput('hello');
    await s.submit('banana');
    await s.submit('2');
    expect(getField(s.brief, 'material.componentCount').value).toBe(2);
    expect(s.currentQuestion?.fieldId).toBe('material.chemistry');
  });

  it('a qualitative answer is recorded for the engineer and not asked again', async () => {
    const s = await runInput(SPEC_1);
    await s.submit('10:1');
    expect(s.currentQuestion?.fieldId).toBe('properties.viscosityA');
    await s.submit('very high');
    expect(getField(s.brief, 'properties.viscosityA')).toMatchObject({ value: null, status: 'REQUIRES_ENGINEER_REVIEW' });
    expect(s.currentQuestion?.fieldId).toBe('properties.viscosityB');
  });
});

describe('IntakeSession: skip and "I don\'t know"', () => {
  it('skip moves on and leaves the field unknown', async () => {
    const s = await runInput(SPEC_1);
    await s.skip();
    expect(s.currentQuestion?.fieldId).toBe('properties.viscosityA');
    expect(hasValue(getField(s.brief, 'mixing.ratio'))).toBe(false);
    expect(getField(s.brief, 'mixing.ratio').userUnknown).toBeUndefined();
    expect(s.transcript.filter((t) => t.type === 'user').at(-1)).toMatchObject({ text: 'skip' });
  });

  it('"I don\'t know" is remembered as the user\'s answer, never as a value', async () => {
    const s = await runInput(SPEC_1);
    await s.markUnknown();
    const ratio = getField(s.brief, 'mixing.ratio');
    expect(ratio).toMatchObject({ value: null, status: 'UNKNOWN', userUnknown: true });
    expect(s.currentQuestion?.fieldId).toBe('properties.viscosityA');
    expect(computeReviewFlags(s.brief, s.profile).find((f) => f.id === 'USER_UNKNOWN')?.message).toContain('Mix ratio');
    expect(buildRFQ(s.brief, {}, s.profile).lines.find((l) => l.label === 'Ratio')?.lines).toEqual(['Not provided']);
  });

  it('"I don\'t know" typed in words works too', async () => {
    const s = await runInput(SPEC_1);
    await s.submit("I really don't know");
    expect(getField(s.brief, 'mixing.ratio').userUnknown).toBe(true);
  });

  it('a value given later replaces "I don\'t know"', async () => {
    const s = await runInput(SPEC_1);
    await s.markUnknown();
    while (s.currentQuestion) await s.skip();
    await s.submit('The mix ratio is 4:1');
    expect(getField(s.brief, 'mixing.ratio')).toMatchObject({ value: '4:1', status: 'KNOWN' });
    expect(getField(s.brief, 'mixing.ratioKnown').value).toBe(true);
  });
});

describe('IntakeSession: finishing', () => {
  it('finish() closes the intake and says how much is still missing', async () => {
    const s = await runInput(DEMO_CASE_TEXT);
    s.finish();
    expect(s.phase).toBe('COMPLETE');
    expect(s.currentQuestion).toBeNull();
    const done = last(s, 'complete');
    expect(done?.text).toContain('Intake closed.');
    expect(done?.text).toMatch(/\d+ required fields are still missing/);
    expect(done?.text).toContain('Not provided');
  });

  it('finish() is a no-op before a description and after completion', async () => {
    const fresh = new IntakeSession();
    fresh.finish();
    expect(fresh.phase).toBe('AWAITING_DESCRIPTION');
    expect(fresh.transcript).toEqual([]);

    const s = await runInput(DEMO_CASE_TEXT);
    s.finish();
    const entries = s.transcript.length;
    s.finish();
    expect(s.transcript.length).toBe(entries);
  });

  it('after finish(), new information is merged but no further questions are asked', async () => {
    const s = await runInput(DEMO_CASE_TEXT);
    s.finish();
    const questions = questionsIn(s);
    await s.submit('The viscosity of component A is 5000 cP.');
    expect(getField(s.brief, 'properties.viscosityA').value).toBe(5000);
    expect(last(s, 'understood')?.intro).toBe('Noted:');
    expect(last(s, 'understood')?.outro).toBeUndefined();
    expect(questionsIn(s)).toBe(questions);
    expect(s.phase).toBe('COMPLETE');
    expect(s.currentQuestion).toBeNull();
  });

  it('a message with nothing technical in it is acknowledged, not guessed at', async () => {
    const s = await runInput(DEMO_CASE_TEXT);
    s.finish();
    const before = JSON.stringify(s.brief.production);
    await s.submit('thanks a lot');
    expect(last(s, 'notice')?.text).toBe('I did not find new technical data in that message.');
    expect(JSON.stringify(s.brief.production)).toBe(before);
  });

  it('answering every question completes the intake exactly once', async () => {
    const s = await runInput(SPEC_1);
    while (s.currentQuestion) await s.skip();
    expect(s.phase).toBe('COMPLETE');
    expect(s.transcript.filter((t) => t.type === 'complete')).toHaveLength(1);
    expect(last(s, 'complete')?.text).toContain('Intake complete.');
    await s.submit('The process is automated.');
    expect(s.transcript.filter((t) => t.type === 'complete')).toHaveLength(1);
    expect(getField(s.brief, 'automation.automationLevel').value).toBe('Automated');
  });

  it('says once that the remaining questions are optional when every required detail is addressed', async () => {
    const s = await runInput(TC28);
    expect(s.brief.metadata.missingRequiredFields).toEqual([]);
    const notices = s.transcript.filter((t) => t.type === 'notice' && t.text.startsWith('Every required detail has been addressed'));
    expect(notices).toHaveLength(1);
    while (s.currentQuestion) await s.skip();
    expect(s.transcript.filter((t) => t.type === 'notice' && t.text.startsWith('Every required detail has been addressed'))).toHaveLength(1);
  });
});

describe('IntakeSession: RFQ details and reset', () => {
  it('company, contact and notes typed into the RFQ panel are stored as the user\'s own', async () => {
    const s = await runInput(SPEC_1);
    s.setRfqDetail('company', '  Acme  ');
    s.setRfqDetail('contactName', 'J. Doe');
    s.setRfqDetail('additionalNotes', 'Call first.');
    expect(getField(s.brief, 'contact.company')).toMatchObject({ value: 'Acme', status: 'KNOWN', origin: 'USER_STATED' });
    expect(getField(s.brief, 'contact.contactName').value).toBe('J. Doe');
    expect(getField(s.brief, 'notes.additionalNotes').value).toBe('Call first.');
    s.setRfqDetail('company', '   ');
    expect(getField(s.brief, 'contact.company')).toMatchObject({ value: null, status: 'UNKNOWN' });
  });

  it('reset() clears everything and the intake can start again', async () => {
    const s = await runInput(DEMO_CASE_TEXT);
    s.finish();
    s.setRfqDetail('company', 'Acme');
    s.reset();
    expect(s.phase).toBe('AWAITING_DESCRIPTION');
    expect(s.transcript).toEqual([]);
    expect(s.currentQuestion).toBeNull();
    expect(hasValue(getField(s.brief, 'mixing.ratio'))).toBe(false);
    expect(hasValue(getField(s.brief, 'contact.company'))).toBe(false);
    expect(s.brief.metadata.messageCount).toBe(0);
    expect(s.brief.metadata.missingRequiredFields.length).toBeGreaterThan(5);
    expect(s.brief.metadata.signals).toEqual([]);

    await s.submit(SPEC_1);
    expect(s.phase).toBe('ASKING'); // not "closed" any more
    expect(s.currentQuestion?.fieldId).toBe('mixing.ratio');
  });

  it('two sessions never share state', async () => {
    const a = await runInput('We use a two-component epoxy mixed 10:1.');
    const b = await runInput('We use a single component silicone.');
    expect(getField(a.brief, 'mixing.ratio').value).toBe('10:1');
    expect(getField(b.brief, 'mixing.ratio').value).toBeNull();
    expect(getField(b.brief, 'material.chemistry').value).toBe('silicone');
    expect(getField(a.brief, 'material.chemistry').value).toBe('epoxy');
  });
});

describe('IntakeSession: subscription', () => {
  it('notifies on every change, and stops after unsubscribe', async () => {
    const s = new IntakeSession();
    let calls = 0;
    const off = s.subscribe(() => (calls += 1));
    await s.submit(SPEC_1);
    expect(calls).toBeGreaterThanOrEqual(2); // the user's message is shown first, then the engine's reply
    const afterFirst = calls;
    s.setRfqDetail('company', 'Acme');
    expect(calls).toBe(afterFirst + 1);
    s.reset();
    expect(calls).toBe(afterFirst + 2);
    off();
    await s.submit(SPEC_1);
    expect(calls).toBe(afterFirst + 2);
  });

  it('shows the user\'s message before a slow extractor answers', async () => {
    const original = getExtractor();
    let release: (r: ExtractionResult) => void = () => {};
    const slow: Extractor = {
      name: 'slow-test-extractor',
      extract: () => new Promise<ExtractionResult>((resolve) => (release = resolve)),
    };
    setExtractor(slow);
    try {
      const s = new IntakeSession();
      const seen: string[][] = [];
      s.subscribe(() => seen.push(types(s)));
      const pending = s.submit('We need something.');
      expect(seen[0]).toEqual(['user']); // visible immediately
      expect(s.phase).toBe('AWAITING_DESCRIPTION');
      release({ values: [], signals: [], capturedNotes: [] });
      await pending;
      expect(types(s)).toEqual(['user', 'notice', 'question']);
    } finally {
      setExtractor(original);
    }
  });
});

describe('IntakeSession: the extractor is replaceable', () => {
  const llmLike: Extractor = {
    name: 'test-llm',
    async extract() {
      return {
        values: [
          { fieldId: 'production.shotSize', value: 7, status: 'KNOWN', origin: 'USER_STATED', raw: 'seven grams' },
          { fieldId: 'production.shotSizeUnit', value: 'g', status: 'KNOWN', origin: 'NORMALIZED', raw: 'grams' },
          { fieldId: 'material.chemistry', value: 'epoxy', status: 'INFERRED', origin: 'INFERRED', raw: 'resin', note: 'Guessed from the word resin.' },
        ],
        signals: [],
        capturedNotes: ['The line runs two shifts.'],
      };
    },
  };

  it('the session uses whichever extractor is active, and the rest of the engine is unchanged', async () => {
    const original = getExtractor();
    expect(original.name).not.toBe('test-llm');
    setExtractor(llmLike);
    try {
      expect(getExtractor().name).toBe('test-llm');
      const s = await runInput('Seven grams of resin per part, two shifts.');
      expect(getField(s.brief, 'production.shotSize')).toMatchObject({ value: 7, status: 'KNOWN' });
      expect(getField(s.brief, 'production.shotSizeUnit').value).toBe('g');
      // an inference from an AI is still only an inference: marked as such, never "known"
      expect(getField(s.brief, 'material.chemistry')).toMatchObject({ value: 'epoxy', status: 'INFERRED' });
      expect(s.brief.metadata.capturedNotes).toEqual(['The line runs two shifts.']);
      expect(s.currentQuestion?.fieldId).toBe('material.componentCount');
      expect(buildRFQ(s.brief, {}, s.profile).lines.find((l) => l.label === 'Material')?.lines[0]).toContain('inferred');
    } finally {
      setExtractor(original);
    }
    expect(getExtractor()).toBe(original);
  });

  it('the default extractor is the local rule-based one', () => {
    expect(getExtractor().name).toMatch(/local|rule/i);
  });
});
