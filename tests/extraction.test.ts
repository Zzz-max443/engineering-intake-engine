import { describe, expect, it } from 'vitest';
import { extractRequirements } from '../src/extraction/index.ts';
import type { ExtractedValue, ExtractionResult } from '../src/extraction/index.ts';

const all = (r: ExtractionResult, id: string): ExtractedValue[] => r.values.filter((v) => v.fieldId === id);
const first = (r: ExtractionResult, id: string): ExtractedValue | undefined => all(r, id)[0];
const valueOf = (text: string, id: string): unknown => first(extractRequirements(text), id)?.value;

describe('extractRequirements: component count', () => {
  it.each([
    ['We need a two component epoxy', 2],
    ['We need a 2 component epoxy', 2],
    ['a 2-component epoxy', 2],
    ['a two-part epoxy', 2],
    ['a 2 part epoxy mix', 2],
    ['a bi-component silicone', 2],
    ['2K epoxy', 2],
    ['a three component polyurethane', 3],
    ['we have three components', 3],
    ['a single component silicone', 1],
    ['one-component polyurethane', 1],
  ])('%s -> %i components', (text, expected) => {
    const found = first(extractRequirements(text), 'material.componentCount');
    expect(found?.value).toBe(expected);
    expect(found?.status).toBe('KNOWN');
  });

  it.each([
    'We make 2 parts per hour',
    'We pot 2 parts a minute',
    'two components per cycle are dispensed',
    'Ship 3 parts to the customer',
  ])('"%s" is not a component count', (text) => {
    expect(all(extractRequirements(text), 'material.componentCount')).toEqual([]);
  });
});

describe('extractRequirements: chemistry', () => {
  it.each([
    ['two-component epoxy', 'epoxy'],
    ['epoxies from two suppliers', 'epoxy'],
    ['polyurethane', 'polyurethane'],
    ['a PU system', 'polyurethane'],
    ['a urethane compound', 'polyurethane'],
    ['RTV silicone', 'silicone'],
    ['an acrylic adhesive', 'acrylic'],
    ['polyester resin', 'polyester'],
    ['polysulfide sealant', 'polysulfide'],
  ])('%s -> %s', (text, expected) => {
    expect(valueOf(text, 'material.chemistry')).toBe(expected);
  });

  it('does not read "pu" in running text as polyurethane', () => {
    expect(all(extractRequirements('we pu the parts in a tray'), 'material.chemistry')).toEqual([]);
  });
});

describe('extractRequirements: mix ratio', () => {
  it.each([
    ['The mix ratio is 10:1', '10:1'],
    ['a 10:1 epoxy', '10:1'],
    ['mixed 10 to 1', '10:1'],
    ['mixed 10-to-1', '10:1'],
    ['a 10 to 1 epoxy', '10:1'],
    ['mix ratio 2.5:1', '2.5:1'],
    ['a 1:1:1 ratio', '1:1:1'],
    ['10 parts resin to 1 part hardener', '10:1'],
    ['100:35 by weight', '100:35'],
  ])('%s -> %s', (text, expected) => {
    const found = first(extractRequirements(text), 'mixing.ratio');
    expect(found?.value).toBe(expected);
    expect(found?.status).toBe('KNOWN');
  });

  it('keeps the basis (by weight / by volume) as a note', () => {
    expect(first(extractRequirements('10:1 by weight'), 'mixing.ratio')?.note).toBe('By weight.');
    expect(first(extractRequirements('mixed 4 to 1 by volume'), 'mixing.ratio')?.note).toBe('By volume.');
  });

  it.each([
    'The shift starts at 10:30',
    'The meeting is at 10:30 pm',
    'We make 500 to 600 parts per hour',
    'between 10 to 20 minutes',
    'a pressure of 3 to 5 bar',
  ])('"%s" is not a ratio', (text) => {
    expect(all(extractRequirements(text), 'mixing.ratio')).toEqual([]);
  });
});

describe('extractRequirements: production rate', () => {
  it.each([
    ['500 parts/hour', 500, 'parts/hour'],
    ['500 parts per hour', 500, 'parts/hour'],
    ['500 electronic modules per hour', 500, 'parts/hour'],
    ['We pot 500 modules an hour', 500, 'parts/hour'],
    ['2,000 parts per week', 2000, 'parts/week'],
    ['30 parts per minute', 30, 'parts/minute'],
    ['100k parts per year', 100000, 'parts/year'],
    ['annual volume of 250,000', 250000, 'parts/year'],
    ['20 shots a minute', 20, 'parts/minute'],
  ])('%s -> %d %s', (text, value, unit) => {
    const r = extractRequirements(text);
    expect(first(r, 'production.productionRate')?.value).toBe(value);
    expect(first(r, 'production.productionRate')?.status).toBe('KNOWN');
    expect(first(r, 'production.productionUnit')?.value).toBe(unit);
  });

  it('keeps the user-stated number, normalizes only the unit', () => {
    const r = extractRequirements('500 electronic modules per hour');
    expect(first(r, 'production.productionRate')?.origin).toBe('USER_STATED');
    expect(first(r, 'production.productionUnit')?.origin).toBe('NORMALIZED');
  });

  it('a bare "500 per hour" is INFERRED, not KNOWN', () => {
    const r = extractRequirements('We need about 500 per hour');
    expect(first(r, 'production.productionRate')?.status).toBe('INFERRED');
    expect(first(r, 'production.productionUnit')?.status).toBe('INFERRED');
  });

  it('ranges and bounds are not values', () => {
    for (const text of ['400-600 parts per hour', 'between 400 and 600 parts per hour', 'up to 600 parts per hour', 'at least 100 parts per hour']) {
      const found = first(extractRequirements(text), 'production.productionRate');
      expect(found?.status, text).toBe('REQUIRES_ENGINEER_REVIEW');
      expect(found?.value, text).toBeNull();
    }
  });
});

describe('extractRequirements: shot size', () => {
  it.each([
    ['15 grams per part', 15, 'g'],
    ['15 g per part', 15, 'g'],
    ['15 g/part', 15, 'g'],
    ['12 cc per part', 12, 'cc'],
    ['30 ml per shot', 30, 'ml'],
    ['shot size of 30 ml', 30, 'ml'],
    ['we dispense 8 g', 8, 'g'],
    ['a 15 g shot', 15, 'g'],
    ['1,5 g per part', 1.5, 'g'],
  ])('%s -> %d %s', (text, value, unit) => {
    const r = extractRequirements(text);
    expect(first(r, 'production.shotSize')?.value).toBe(value);
    expect(first(r, 'production.shotSize')?.status).toBe('KNOWN');
    expect(first(r, 'production.shotSizeUnit')?.value).toBe(unit);
  });

  it('notes that a value is approximate', () => {
    expect(first(extractRequirements('approximately 15 grams per part'), 'production.shotSize')?.note).toContain('Approximate');
  });

  it('"15 g of epoxy" is INFERRED because it is not tied to one part', () => {
    const found = first(extractRequirements('We use 15 g of epoxy'), 'production.shotSize');
    expect(found?.status).toBe('INFERRED');
    expect(found?.value).toBe(15);
  });

  it('a range is not a shot size', () => {
    for (const text of ['10-20 g per part', 'between 10 and 20 grams per shot', 'shot size 10 to 20 g']) {
      const found = first(extractRequirements(text), 'production.shotSize');
      expect(found?.status, text).toBe('REQUIRES_ENGINEER_REVIEW');
      expect(found?.value, text).toBeNull();
    }
  });

  it('a shot size is not mistaken for a flow rate or a production rate', () => {
    const r = extractRequirements('15 grams per part');
    expect(all(r, 'production.flowRate')).toEqual([]);
    expect(all(r, 'production.productionRate')).toEqual([]);
  });
});

describe('extractRequirements: flow rate', () => {
  it.each([
    ['100 cc/min', 100, 'cc/min'],
    ['100 cc per minute', 100, 'cc/min'],
    ['flow rate of 2 g/s', 2, 'g/s'],
    ['5 ml/min', 5, 'ml/min'],
    ['we need 250 g per minute', 250, 'g/min'],
  ])('%s -> %d %s', (text, value, unit) => {
    const r = extractRequirements(text);
    expect(first(r, 'production.flowRate')?.value).toBe(value);
    expect(first(r, 'production.flowRate')?.status).toBe('KNOWN');
    expect(first(r, 'production.flowUnit')?.value).toBe(unit);
  });

  it('a flow rate is not a production rate', () => {
    const r = extractRequirements('We need 100 cc/min');
    expect(all(r, 'production.productionRate')).toEqual([]);
    expect(all(r, 'production.shotSize')).toEqual([]);
  });

  it('ranges and bounds are not values', () => {
    for (const text of ['50-100 cc/min', 'between 50 and 100 cc/min', 'up to 100 cc/min', 'at least 50 cc/min']) {
      const found = first(extractRequirements(text), 'production.flowRate');
      expect(found?.status, text).toBe('REQUIRES_ENGINEER_REVIEW');
      expect(found?.value, text).toBeNull();
    }
  });
});

describe('extractRequirements: viscosity', () => {
  it('"high viscosity" is qualitative: review, no number', () => {
    const r = extractRequirements('The epoxy has high viscosity');
    for (const id of ['properties.viscosityA', 'properties.viscosityB']) {
      expect(first(r, id)?.status).toBe('REQUIRES_ENGINEER_REVIEW');
      expect(first(r, id)?.value).toBeNull();
    }
  });

  it.each(['very viscous resin', 'the viscosity is quite high', 'a paste-like material'])('"%s" is qualitative', (text) => {
    const found = first(extractRequirements(text), 'properties.viscosityA');
    expect(found?.status).toBe('REQUIRES_ENGINEER_REVIEW');
    expect(found?.value).toBeNull();
  });

  it('numeric viscosity of a named component is KNOWN', () => {
    const r = extractRequirements('The viscosity of component A is 5,000 cP and component B is 200 cP');
    expect(first(r, 'properties.viscosityA')?.value).toBe(5000);
    expect(first(r, 'properties.viscosityB')?.value).toBe(200);
    expect(first(r, 'properties.viscosityUnit')?.value).toBe('cP');
  });

  it('a role word (resin / hardener) is only a guess: INFERRED', () => {
    const r = extractRequirements('Resin viscosity is 5000 cP and hardener viscosity is 200 cP');
    expect(first(r, 'properties.viscosityA')).toMatchObject({ value: 5000, status: 'INFERRED' });
    expect(first(r, 'properties.viscosityB')).toMatchObject({ value: 200, status: 'INFERRED' });
  });

  it('a viscosity without a component name is not assigned to either', () => {
    const r = extractRequirements('The viscosity is 5000 cP');
    expect(first(r, 'properties.viscosityA')).toMatchObject({ value: null, status: 'REQUIRES_ENGINEER_REVIEW' });
    expect(first(r, 'properties.viscosityB')).toMatchObject({ value: null, status: 'REQUIRES_ENGINEER_REVIEW' });
    expect(first(r, 'properties.viscosityUnit')?.value).toBe('cP');
  });

  it.each([
    ['viscosity of component A is 12000 mPa·s', 'mPa·s'],
    ['component A viscosity 5 Pa·s', 'Pa·s'],
    ['component A: 5000 cps', 'cP'],
  ])('%s -> unit %s', (text, unit) => {
    expect(first(extractRequirements(text), 'properties.viscosityUnit')?.value).toBe(unit);
  });

  it('a viscosity range is not a value', () => {
    const found = first(extractRequirements('Viscosity between 3000 and 5000 cP'), 'properties.viscosityA');
    expect(found?.status).toBe('REQUIRES_ENGINEER_REVIEW');
    expect(found?.value).toBeNull();
  });
});

describe('extractRequirements: automation', () => {
  it.each([
    ['We need automated dispensing', 'Automated'],
    ['We want to dispense automatically', 'Automated'],
    ['a fully automatic line', 'Automated'],
    ['We dispense manually', 'Manual'],
    ['operators work by hand', 'Manual'],
    ['semi-automatic dispensing', 'Semi-automatic'],
    ['a semi automated process', 'Semi-automatic'],
  ])('%s -> %s', (text, level) => {
    expect(valueOf(text, 'automation.automationLevel')).toBe(level);
  });

  it('"robotic" is robotic handling; the automation level is not stated', () => {
    const r = extractRequirements('We need a robotic potting system');
    expect(first(r, 'automation.robotic')?.value).toBe(true);
    expect(all(r, 'automation.automationLevel')).toEqual([]);
  });

  it('"not automated" is only an inference of Manual', () => {
    const found = first(extractRequirements('The process is not automated'), 'automation.automationLevel');
    expect(found).toMatchObject({ value: 'Manual', status: 'INFERRED' });
  });

  it('semi-automatic is never read as automatic', () => {
    expect(all(extractRequirements('semi-automatic'), 'automation.automationLevel')).toHaveLength(1);
  });

  it('negated robot / conveyor', () => {
    const r = extractRequirements('no robot and no conveyor');
    expect(first(r, 'automation.robotic')?.value).toBe(false);
    expect(first(r, 'automation.conveyor')?.value).toBe(false);
  });
});

describe('extractRequirements: "I don\'t know"', () => {
  it('records that the user does not know, with no value', () => {
    const found = first(extractRequirements("We don't know the viscosity yet"), 'properties.viscosityA');
    expect(found).toMatchObject({ value: null, status: 'UNKNOWN', userUnknown: true });
  });
});

describe('extractRequirements: nothing to extract', () => {
  it.each(['', '   ', 'hello', 'asdf qwerty 123', 'Necesitamos encapsular 500 módulos por hora'])('"%s" yields no technical values', (text) => {
    const r = extractRequirements(text);
    const technical = r.values.filter((v) => v.fieldId !== 'application.category');
    expect(technical).toEqual([]);
  });

  it('every value reports its evidence and a valid state', () => {
    const r = extractRequirements(
      'We need to automatically pot 500 electronic modules per hour using a two-component epoxy. The material is mixed at 10:1 and we dispense approximately 15 grams per part.',
    );
    expect(r.values.length).toBeGreaterThan(5);
    for (const v of r.values) {
      expect(v.raw.length).toBeGreaterThan(0);
      expect(['KNOWN', 'UNKNOWN', 'INFERRED', 'REQUIRES_ENGINEER_REVIEW']).toContain(v.status);
      expect(['USER_STATED', 'NORMALIZED', 'INFERRED', 'NONE']).toContain(v.origin);
    }
  });

  it('does not touch the input text or share state between calls', () => {
    const text = 'We use a 10:1 epoxy';
    const a = extractRequirements(text);
    const b = extractRequirements(text);
    expect(b).toEqual(a);
    expect(text).toBe('We use a 10:1 epoxy');
  });
});
