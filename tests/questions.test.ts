import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEmptyBrief, getNextQuestion, interpretAnswer } from '../src/engine/index.ts';
import type { Question } from '../src/engine/index.ts';
import { FIELD_IDS } from '../src/models/types.ts';
import type { FieldId } from '../src/models/types.ts';
import { getField, hasValue } from '../src/models/brief.ts';
import { buildAskQuestion, buildUnitQuestion } from '../src/questions/questionBank.ts';
import { questionSequence, runInput } from './helpers.ts';

interface CaseFile {
  cases: Array<{ id: string; name: string; input: string }>;
}
const CASES = (JSON.parse(readFileSync(new URL('../test-cases.json', import.meta.url), 'utf8')) as CaseFile).cases;

const ask = (id: FieldId): Question => {
  const q = buildAskQuestion(id, createEmptyBrief(), 'REQUIRED');
  if (!q) throw new Error(`No question template for ${id}`);
  return q;
};
const unitQuestion = (id: FieldId): Question => {
  const q = buildUnitQuestion(id, createEmptyBrief(), 'REQUIRED');
  if (!q) throw new Error(`No unit question template for ${id}`);
  return q;
};
const reply = (q: Question, text: string) => interpretAnswer(q, text, createEmptyBrief());

describe('getNextQuestion: order and focus', () => {
  it('starts with the component count on an empty brief', () => {
    const q = getNextQuestion(createEmptyBrief());
    expect(q).toMatchObject({ id: 'ask:material.componentCount', fieldId: 'material.componentCount', mode: 'ASK', kind: 'count', priority: 'REQUIRED' });
    expect(q?.prompt).toBe('How many components does the material have?');
  });

  it('with nothing technical in the description it asks the whole intake in a fixed order', async () => {
    expect(await questionSequence('hello')).toEqual([
      'material.componentCount',
      'material.chemistry',
      'mixing.ratio',
      'properties.viscosityA',
      'properties.viscosityB',
      'production.shotSize',
      'production.productionRate',
      'production.flowRate',
      'automation.automationLevel',
      'part.partDescription',
      'environment.operatingEnvironment',
      'properties.filled',
      'material.materialName',
      'part.cavityGeometry',
      'part.targetArea',
      'integration.existingEquipment',
      'integration.integrationRequirements',
      'notes.additionalNotes',
    ]);
  });

  it('spec example 1: skips what was stated and goes straight to the ratio', async () => {
    const sequence = await questionSequence('We need to pot 500 electronic modules per hour using a two-component epoxy.');
    expect(sequence.slice(0, 3)).toEqual(['mixing.ratio', 'properties.viscosityA', 'properties.viscosityB']);
    for (const stated of ['material.componentCount', 'material.chemistry', 'production.productionRate']) {
      expect(sequence).not.toContain(stated);
    }
  });

  it('asks REQUIRED fields before USEFUL before OPTIONAL', async () => {
    const s = await runInput('hello');
    const rank = { REQUIRED: 0, USEFUL: 1, OPTIONAL: 2, ENGINEER_REVIEW: 3 } as const;
    const priorities: number[] = [];
    while (s.currentQuestion) {
      priorities.push(rank[s.currentQuestion.priority]);
      await s.skip();
    }
    expect(priorities.length).toBeGreaterThan(10);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it('single component: never asks for a ratio or a second component', async () => {
    const sequence = await questionSequence('We pot with a single component silicone.');
    expect(sequence).not.toContain('mixing.ratio');
    expect(sequence).not.toContain('properties.viscosityB');
    expect(sequence).not.toContain('properties.viscosityC');
    expect(sequence).toContain('properties.viscosityA');
  });

  it('three components: also asks for the viscosity of component C', async () => {
    expect(await questionSequence('We have three components.')).toContain('properties.viscosityC');
  });

  it('asks about a robot only for an automated process', async () => {
    expect(await questionSequence('We dispense manually.')).not.toContain('automation.robotic');
    expect(await questionSequence('We need automated dispensing.')).toContain('automation.robotic');
  });

  it('never asks about fields reserved for the engineer', async () => {
    const sequence = await questionSequence('hello');
    for (const id of ['properties.abrasive', 'properties.thixotropic', 'environment.hazardousEnvironment']) {
      expect(sequence).not.toContain(id);
    }
  });

  it('"I don\'t know" is respected: the field is not asked again', async () => {
    const s = await runInput("We don't know the viscosity yet.");
    const asked: string[] = [];
    while (s.currentQuestion) {
      asked.push(s.currentQuestion.fieldId);
      await s.skip();
    }
    expect(asked).not.toContain('properties.viscosityA');
    expect(asked).not.toContain('properties.viscosityB');
  });

  it("a qualitative statement is followed up once, quoting the user's own words", async () => {
    const s = await runInput('The epoxy has high viscosity.');
    while (s.currentQuestion && s.currentQuestion.fieldId !== 'properties.viscosityA') await s.skip();
    expect(s.currentQuestion?.fieldId).toBe('properties.viscosityA');
    expect(s.currentQuestion?.hint).toContain('You mentioned “high viscosity”');
    expect(s.currentQuestion?.hint).toContain('qualitatively');
  });

  it('a range is followed up for a single value, quoting what the user said', async () => {
    const s = await runInput('We dispense between 10 and 20 grams per shot.');
    while (s.currentQuestion && s.currentQuestion.fieldId !== 'production.shotSize') await s.skip();
    expect(s.currentQuestion?.fieldId).toBe('production.shotSize');
    expect(s.currentQuestion?.hint).toContain('between 10 and 20 grams per shot');
    expect(s.currentQuestion?.hint).toContain('Range stated');
  });

  it('a viscosity stated without a component is followed up, saying why it was not assigned', async () => {
    const s = await runInput('The viscosity is 5000 cP.');
    while (s.currentQuestion && s.currentQuestion.fieldId !== 'properties.viscosityA') await s.skip();
    expect(s.currentQuestion?.hint).toContain('without naming the component');
  });
});

describe('getNextQuestion: no re-asking, ever', () => {
  it.each(CASES.map((c) => [c.id, c.input] as const))('%s: nothing already known is asked', async (_id, input) => {
    const s = await runInput(input);
    const knownAtStart = new Set(FIELD_IDS.filter((id) => hasValue(getField(s.brief, id))));
    const asked: FieldId[] = [];
    while (s.currentQuestion) {
      const q = s.currentQuestion;
      // A clarification may target a field that holds a flagged value (conflict / mismatch); nothing else may.
      if (q.mode === 'ASK') expect(knownAtStart.has(q.fieldId), `${q.id} was already known`).toBe(false);
      asked.push(q.fieldId);
      await s.skip();
    }
    expect(s.phase).toBe('COMPLETE');
    // One question per field (the ratio/component mismatch question names the component count once).
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('every question is asked once even when the user answers it', async () => {
    const s = await runInput('hello');
    const answers: Record<string, string> = {
      'material.componentCount': '2',
      'material.chemistry': 'epoxy',
      'mixing.ratio': '10:1',
      'properties.viscosityA': '5000 cP',
      'properties.viscosityB': '200 cP',
      'production.shotSize': '15 g',
      'production.productionRate': '500 parts per hour',
      'production.flowRate': '100 cc/min',
      'automation.automationLevel': 'automated',
    };
    const asked: string[] = [];
    while (s.currentQuestion) {
      const q = s.currentQuestion;
      asked.push(q.id);
      const answer = answers[q.fieldId];
      if (answer) await s.submit(answer);
      else await s.skip();
    }
    expect(new Set(asked).size).toBe(asked.length);
    expect(asked).not.toContain('unit:properties.viscosityUnit');
    expect(getField(s.brief, 'mixing.ratio').value).toBe('10:1');
    expect(getField(s.brief, 'properties.viscosityA').value).toBe(5000);
  });
});

describe('getNextQuestion: clarifications come first', () => {
  it('a conflict in the description is asked before anything else, with its candidates as choices', async () => {
    const s = await runInput('We mix it 10:1, actually maybe 5:1, not sure.');
    expect(s.currentQuestion).toMatchObject({ id: 'clarify:mixing.ratio', fieldId: 'mixing.ratio', mode: 'CLARIFY', kind: 'clarify' });
    expect(s.currentQuestion?.choices?.map((c) => c.value).sort()).toEqual(['10:1', '5:1']);
  });

  it('answering a conflict with one of the candidates settles it', async () => {
    const s = await runInput('We mix it 10:1, actually maybe 5:1, not sure.');
    await s.submit('5:1');
    const ratio = getField(s.brief, 'mixing.ratio');
    expect(ratio.value).toBe('5:1');
    expect(ratio.status).toBe('KNOWN');
    expect(ratio.candidates).toBeUndefined();
    expect(s.currentQuestion?.fieldId).not.toBe('mixing.ratio');
  });

  it('a skipped conflict is flagged for the engineer and is not asked a second time', async () => {
    const s = await runInput('We mix it 10:1, actually maybe 5:1, not sure.');
    await s.skip();
    const rest: string[] = [];
    while (s.currentQuestion) {
      rest.push(s.currentQuestion.id);
      await s.skip();
    }
    expect(rest).not.toContain('clarify:mixing.ratio');
    expect(rest).not.toContain('ask:mixing.ratio');
    expect(getField(s.brief, 'mixing.ratio').status).toBe('REQUIRES_ENGINEER_REVIEW');
    expect(getField(s.brief, 'mixing.ratio').value).toBeNull();
  });

  it('two different component counts are a conflict too', async () => {
    const s = await runInput('We use a two-component epoxy, actually three components.');
    expect(s.currentQuestion).toMatchObject({ id: 'clarify:material.componentCount', mode: 'CLARIFY' });
    expect(s.currentQuestion?.choices?.map((c) => c.value).sort()).toEqual(['2', '3']);
  });

  it('component count and ratio that disagree are asked about once', async () => {
    const s = await runInput('We use a two-component epoxy with a 1:1:1 ratio.');
    expect(s.currentQuestion).toMatchObject({ id: 'clarify:ratio-components', fieldId: 'material.componentCount', mode: 'CLARIFY' });
    expect(s.currentQuestion?.prompt).toContain('2 components');
    expect(s.currentQuestion?.prompt).toContain('1:1:1');
    await s.skip();
    expect(s.currentQuestion?.id).not.toBe('clarify:ratio-components');
  });

  it('the mismatch is resolved by giving the correct component count', async () => {
    const s = await runInput('We use a two-component epoxy with a 1:1:1 ratio.');
    await s.submit('3');
    expect(getField(s.brief, 'material.componentCount').value).toBe(3);
    expect(getNextQuestion(s.brief, s.profile)?.id).not.toBe('clarify:ratio-components');
  });
});

describe('unit follow-ups', () => {
  it('a bare number is accepted as stated; the unit is then asked, never assumed', async () => {
    const s = await runInput('hello');
    while (s.currentQuestion && s.currentQuestion.fieldId !== 'properties.viscosityA') await s.skip();
    expect(s.currentQuestion?.fieldId).toBe('properties.viscosityA');

    await s.submit('5000');
    const viscosity = getField(s.brief, 'properties.viscosityA');
    expect(viscosity.value).toBe(5000);
    expect(viscosity.note).toContain('without a unit');
    expect(hasValue(getField(s.brief, 'properties.viscosityUnit'))).toBe(false);

    expect(s.currentQuestion).toMatchObject({ id: 'unit:properties.viscosityUnit', mode: 'UNIT', kind: 'unit' });
    expect(s.currentQuestion?.choices?.map((c) => c.value)).toEqual(['cP', 'mPa·s', 'Pa·s']);
    expect(s.currentQuestion?.hint).toContain('5000');

    await s.submit('cP');
    expect(getField(s.brief, 'properties.viscosityUnit').value).toBe('cP');
    expect(s.currentQuestion?.fieldId).not.toBe('properties.viscosityUnit');
  });

  it('a unit that was skipped is flagged and not asked again', async () => {
    const s = await runInput('hello');
    while (s.currentQuestion && s.currentQuestion.fieldId !== 'production.shotSize') await s.skip();
    await s.submit('15');
    expect(s.currentQuestion?.id).toBe('unit:production.shotSizeUnit');
    await s.skip();
    const rest: string[] = [];
    while (s.currentQuestion) {
      rest.push(s.currentQuestion.id);
      await s.skip();
    }
    expect(rest).not.toContain('unit:production.shotSizeUnit');
    expect(hasValue(getField(s.brief, 'production.shotSizeUnit'))).toBe(false);
  });

  it('a value given with its unit needs no follow-up', async () => {
    const s = await runInput('hello');
    while (s.currentQuestion && s.currentQuestion.fieldId !== 'production.shotSize') await s.skip();
    await s.submit('15 g');
    expect(s.currentQuestion?.mode).not.toBe('UNIT');
    expect(getField(s.brief, 'production.shotSizeUnit').value).toBe('g');
  });
});

describe('interpretAnswer', () => {
  describe('component count', () => {
    it.each([
      ['2', 2],
      ['two', 2],
      ['One', 1],
      ['single component', 1],
      ['it is 3', 3],
      ['3 components', 3],
    ])('"%s" -> %i', (text, n) => {
      const outcome = reply(ask('material.componentCount'), text);
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') expect(outcome.values.find((v) => v.fieldId === 'material.componentCount')?.value).toBe(n);
    });

    it('rejects an answer that is not a number', () => {
      expect(reply(ask('material.componentCount'), 'a few').type).toBe('invalid');
    });
  });

  describe('mix ratio', () => {
    it.each([
      ['10:1', '10:1'],
      ['10 to 1', '10:1'],
      ['10/1', '10:1'],
      ['1 1 1', '1:1:1'],
      ['100:35 by weight', '100:35'],
    ])('"%s" -> %s', (text, ratio) => {
      const outcome = reply(ask('mixing.ratio'), text);
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') expect(outcome.values.find((v) => v.fieldId === 'mixing.ratio')?.value).toBe(ratio);
    });

    it.each(['a lot of hardener', '0:1', 'ten'])('"%s" is not a ratio', (text) => {
      expect(reply(ask('mixing.ratio'), text).type).toBe('invalid');
    });
  });

  describe('chemistry', () => {
    it('reads a known chemistry as stated', () => {
      const outcome = reply(ask('material.chemistry'), 'Polyurethane');
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') expect(outcome.values[0]).toMatchObject({ value: 'polyurethane', status: 'KNOWN' });
    });

    it('a chemistry outside the vocabulary is kept verbatim for the engineer, not guessed', () => {
      const outcome = reply(ask('material.chemistry'), 'vinyl ester');
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') expect(outcome.values[0]).toMatchObject({ value: 'vinyl ester', status: 'REQUIRES_ENGINEER_REVIEW' });
    });

    it('rejects text that is too long or has no letters', () => {
      expect(reply(ask('material.chemistry'), '12').type).toBe('invalid');
      expect(reply(ask('material.chemistry'), 'x'.repeat(60)).type).toBe('invalid');
    });
  });

  describe('automation level', () => {
    it.each([
      ['automated', 'Automated'],
      ['Automatic', 'Automated'],
      ['semi-automatic', 'Semi-automatic'],
      ['semi', 'Semi-automatic'],
      ['manual', 'Manual'],
      ['by hand', 'Manual'],
    ])('"%s" -> %s', (text, level) => {
      const outcome = reply(ask('automation.automationLevel'), text);
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') expect(outcome.values.find((v) => v.fieldId === 'automation.automationLevel')?.value).toBe(level);
    });

    it('rejects anything else', () => {
      expect(reply(ask('automation.automationLevel'), 'sometimes').type).toBe('invalid');
    });
  });

  describe('yes / no', () => {
    it.each([
      ['Yes', true],
      ['yeah', true],
      ['No', false],
      ['nope', false],
    ])('"%s" -> %s', (text, value) => {
      const outcome = reply(ask('automation.robotic'), text);
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') expect(outcome.values[0]?.value).toBe(value);
    });

    it('"maybe" is not an answer', () => {
      expect(reply(ask('automation.robotic'), 'maybe').type).toBe('invalid');
    });
  });

  describe('numbers with units', () => {
    it('viscosity with a unit fills both the value and the unit', () => {
      const outcome = reply(ask('properties.viscosityA'), '5000 cP');
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') {
        expect(outcome.values.find((v) => v.fieldId === 'properties.viscosityA')).toMatchObject({ value: 5000, status: 'KNOWN' });
        expect(outcome.values.find((v) => v.fieldId === 'properties.viscosityUnit')?.value).toBe('cP');
      }
    });

    it('viscosity for component B goes to B only', () => {
      const outcome = reply(ask('properties.viscosityB'), '200 mPa·s');
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') {
        expect(outcome.values.map((v) => v.fieldId)).toContain('properties.viscosityB');
        expect(outcome.values.map((v) => v.fieldId)).not.toContain('properties.viscosityA');
      }
    });

    it('a qualitative viscosity is recorded for review, never as a number', () => {
      const outcome = reply(ask('properties.viscosityA'), 'very high');
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') expect(outcome.values[0]).toMatchObject({ status: 'REQUIRES_ENGINEER_REVIEW', value: null });
    });

    it('shot size, production rate and flow rate reuse the extraction rules', () => {
      const shot = reply(ask('production.shotSize'), '15 g');
      const rate = reply(ask('production.productionRate'), '500 parts per hour');
      const flow = reply(ask('production.flowRate'), '100 cc/min');
      for (const [outcome, id, value] of [
        [shot, 'production.shotSize', 15],
        [rate, 'production.productionRate', 500],
        [flow, 'production.flowRate', 100],
      ] as const) {
        expect(outcome.type).toBe('values');
        if (outcome.type === 'values') expect(outcome.values.find((v) => v.fieldId === id)).toMatchObject({ value, status: 'KNOWN' });
      }
    });

    it('a bare number is kept as stated, flagged "without a unit"', () => {
      const outcome = reply(ask('production.shotSize'), '15');
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') {
        expect(outcome.values).toHaveLength(1);
        expect(outcome.values[0]).toMatchObject({ fieldId: 'production.shotSize', value: 15, status: 'KNOWN', note: 'Stated without a unit.' });
      }
    });

    it('a range for a single-value question is not a value', () => {
      const outcome = reply(ask('production.shotSize'), 'between 10 and 20 g');
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') {
        const shot = outcome.values.find((v) => v.fieldId === 'production.shotSize');
        expect(shot?.value).toBeNull();
        expect(shot?.status).toBe('REQUIRES_ENGINEER_REVIEW');
      }
    });

    it('text with no number is not an answer', () => {
      expect(reply(ask('production.shotSize'), 'quite small').type).toBe('invalid');
    });
  });

  describe('"I don\'t know", skip, empty', () => {
    it.each(["I don't know", 'I dont know', 'idk', 'not sure', 'Unknown', 'no idea', 'TBD', 'to be determined', 'N/A', "can't say"])('"%s" is unknown', (text) => {
      expect(reply(ask('production.flowRate'), text).type).toBe('unknown');
    });

    it.each(['skip', 'Skip this', 'pass', 'next', 'later', 'not now'])('"%s" skips', (text) => {
      expect(reply(ask('production.flowRate'), text).type).toBe('skip');
    });

    it.each(['', '   ', '\n'])('"%j" asks for an answer', (text) => {
      expect(reply(ask('production.flowRate'), text).type).toBe('invalid');
    });

    it('"none" or "nothing else" closes a free-text question', () => {
      for (const text of ['no', 'none', 'Nothing else', 'no thanks']) {
        expect(reply(ask('notes.additionalNotes'), text).type, text).toBe('skip');
      }
    });

    it('free text that merely starts with a skip-like word is still an answer', () => {
      for (const text of ['Pass-through connector housings', 'Next-generation dispensing head', 'Later models have a lid']) {
        const outcome = reply(ask('part.partDescription'), text);
        expect(outcome.type, text).toBe('values');
      }
    });

    it('free text is kept verbatim as the user\'s own statement', () => {
      const outcome = reply(ask('part.partDescription'), 'a control module in a plastic housing');
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') expect(outcome.values[0]).toMatchObject({ value: 'a control module in a plastic housing', status: 'KNOWN', origin: 'USER_STATED' });
    });
  });

  describe('unit questions', () => {
    it.each([
      ['properties.viscosityUnit', 'cP', 'cP'],
      ['properties.viscosityUnit', 'mPa·s', 'mPa·s'],
      ['production.shotSizeUnit', 'grams', 'g'],
      ['production.shotSizeUnit', 'ml', 'ml'],
      ['production.flowUnit', 'cc per minute', 'cc/min'],
      ['production.productionUnit', 'per hour', 'parts/hour'],
      ['properties.temperatureUnit', 'celsius', '°C'],
      ['production.cycleTimeUnit', 'seconds', 's'],
    ] as const)('%s: "%s" -> %s', (fieldId, text, canonical) => {
      const outcome = reply(unitQuestion(fieldId), text);
      expect(outcome.type).toBe('values');
      if (outcome.type === 'values') expect(outcome.values[0]).toMatchObject({ fieldId, value: canonical, status: 'KNOWN' });
    });

    it('rejects something that is not a unit', () => {
      expect(reply(unitQuestion('properties.viscosityUnit'), 'thick').type).toBe('invalid');
    });
  });

  describe('every offered choice can be answered by clicking it', () => {
    const questions: Question[] = [];
    for (const id of FIELD_IDS) {
      const asked = buildAskQuestion(id, createEmptyBrief(), 'REQUIRED');
      if (asked) questions.push(asked);
      const unit = buildUnitQuestion(id, createEmptyBrief(), 'REQUIRED');
      if (unit) questions.push(unit);
    }

    it('there are questions with choices to check', () => {
      expect(questions.filter((q) => q.choices?.length).length).toBeGreaterThan(10);
    });

    it.each(questions.flatMap((q) => (q.choices ?? []).map((c) => [q.id, c.value, q] as const)))('%s: "%s"', (_id, value, q) => {
      const outcome = reply(q, value);
      expect(outcome.type === 'values' || outcome.type === 'unknown', `${q.id} choice "${value}" -> ${outcome.type}`).toBe(true);
    });
  });
});
