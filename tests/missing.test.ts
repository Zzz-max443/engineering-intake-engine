import { describe, expect, it } from 'vitest';
import { calculateMissingFields, createEmptyBrief, IntakeSession } from '../src/engine/index.ts';
import { missingRequiredIds } from '../src/engine/missing.ts';
import { getFieldDef } from '../src/data/fields.ts';
import { getField, hasValue } from '../src/models/brief.ts';
import type { FieldId, Priority } from '../src/models/types.ts';
import { runInput } from './helpers.ts';

const ids = (brief: Parameters<typeof calculateMissingFields>[0], priority?: Priority): FieldId[] =>
  calculateMissingFields(brief)
    .filter((m) => (priority ? m.priority === priority : true))
    .map((m) => m.fieldId);

describe('calculateMissingFields: an empty brief', () => {
  const brief = createEmptyBrief();
  const missing = calculateMissingFields(brief);

  it('reports every required field', () => {
    expect(ids(brief, 'REQUIRED')).toEqual(
      expect.arrayContaining([
        'material.componentCount',
        'material.chemistry',
        'mixing.ratio',
        'properties.viscosityA',
        'properties.viscosityB',
        'production.shotSize',
        'production.productionRate',
        'production.flowRate',
        'automation.automationLevel',
      ]),
    );
  });

  it('is sorted: REQUIRED, then USEFUL, then OPTIONAL', () => {
    const rank: Record<Priority, number> = { REQUIRED: 0, USEFUL: 1, OPTIONAL: 2, ENGINEER_REVIEW: 3 };
    const ranks = missing.map((m) => rank[m.priority]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(missing[0]?.priority).toBe('REQUIRED');
  });

  it('never lists unit fields, derived fields or fields reserved for the engineer', () => {
    for (const m of missing) {
      expect(getFieldDef(m.fieldId).kind, m.fieldId).not.toBe('unit');
      expect(m.priority, m.fieldId).not.toBe('ENGINEER_REVIEW');
    }
    const listed = new Set(ids(brief));
    for (const id of [
      'properties.abrasive',
      'properties.thixotropic',
      'environment.hazardousEnvironment',
      'mixing.ratioKnown',
      'application.description',
      'contact.company',
      'contact.contactName',
    ] as FieldId[]) {
      expect(listed.has(id), id).toBe(false);
    }
  });

  it('lists a field at most once', () => {
    expect(new Set(ids(brief)).size).toBe(ids(brief).length);
  });

  it('marks every item as "not provided", with no invented detail', () => {
    for (const m of missing) {
      expect(m.reason, m.fieldId).toBe('NOT_PROVIDED');
      expect(m.detail, m.fieldId).toBeUndefined();
      expect(m.label.length, m.fieldId).toBeGreaterThan(0);
    }
  });
});

describe('calculateMissingFields: dynamic rules', () => {
  it('single component: ratio and components B/C no longer apply', async () => {
    const s = await runInput('We pot with a single component silicone.');
    const listed = ids(s.brief);
    expect(listed).not.toContain('mixing.ratio');
    expect(listed).not.toContain('properties.viscosityB');
    expect(listed).not.toContain('properties.viscosityC');
    expect(listed).toContain('properties.viscosityA');
  });

  it('two components: ratio and viscosity of A and B are required, C is not', async () => {
    const s = await runInput('We pot with a two-component epoxy.');
    const required = ids(s.brief, 'REQUIRED');
    expect(required).toEqual(expect.arrayContaining(['mixing.ratio', 'properties.viscosityA', 'properties.viscosityB']));
    expect(ids(s.brief)).not.toContain('properties.viscosityC');
  });

  it('three components: viscosity of C is required too', async () => {
    const s = await runInput('We have three components.');
    expect(ids(s.brief, 'REQUIRED')).toContain('properties.viscosityC');
  });

  it('component count unknown: mixing is not ruled out, so ratio and B stay required', async () => {
    const s = await runInput('We need to pot circuit boards.');
    expect(ids(s.brief, 'REQUIRED')).toEqual(expect.arrayContaining(['mixing.ratio', 'properties.viscosityB']));
    expect(ids(s.brief)).not.toContain('properties.viscosityC');
  });

  it('flow rate is REQUIRED while shot size or cycle time is missing', async () => {
    for (const text of ['Shot size is 15 g per part.', 'The cycle time is 30 seconds.', 'We use epoxy.']) {
      const s = await runInput(text);
      expect(ids(s.brief, 'REQUIRED'), text).toContain('production.flowRate');
    }
  });

  it('flow rate drops to USEFUL once shot size and cycle time are both given', async () => {
    const s = await runInput('Shot size is 15 g per part and the cycle time is 30 seconds.');
    expect(ids(s.brief, 'REQUIRED')).not.toContain('production.flowRate');
    expect(ids(s.brief, 'USEFUL')).toContain('production.flowRate');
  });

  it('a stated flow rate is no longer missing', async () => {
    const s = await runInput('We need 100 cc/min.');
    expect(ids(s.brief)).not.toContain('production.flowRate');
  });

  it('robotic handling is only asked about once the process is (semi-)automated', async () => {
    const manual = await runInput('We dispense manually.');
    expect(ids(manual.brief)).not.toContain('automation.robotic');
    const automated = await runInput('We need automated dispensing.');
    expect(ids(automated.brief)).toContain('automation.robotic');
    const semi = await runInput('We need semi-automatic dispensing.');
    expect(ids(semi.brief)).toContain('automation.robotic');
  });

  it('temperature is only relevant when the user brings it up', async () => {
    const quiet = await runInput('We pot with epoxy.');
    expect(ids(quiet.brief)).not.toContain('properties.temperature');
    const mentioned = await runInput('The material is heated before dispensing.');
    expect(ids(mentioned.brief)).toContain('properties.temperature');
  });

  it('a viscosity unit is only required once a viscosity value exists', async () => {
    const without = await runInput('We use epoxy.');
    expect(missingRequiredIds(without.brief)).not.toContain('properties.viscosityUnit');
    const withValue = await runInput('The viscosity is 5000 cP.');
    expect(missingRequiredIds(withValue.brief)).not.toContain('properties.viscosityUnit');
  });
});

describe('calculateMissingFields: reasons', () => {
  it('NEEDS_DETAIL: a qualitative description is not a value', async () => {
    const s = await runInput('The epoxy has high viscosity.');
    const item = calculateMissingFields(s.brief).find((m) => m.fieldId === 'properties.viscosityA');
    expect(item?.reason).toBe('NEEDS_DETAIL');
    expect(item?.detail).toContain('qualitatively');
  });

  it('NEEDS_DETAIL: a range is not a value', async () => {
    const s = await runInput('We dispense between 10 and 20 grams per shot.');
    expect(calculateMissingFields(s.brief).find((m) => m.fieldId === 'production.shotSize')?.reason).toBe('NEEDS_DETAIL');
  });

  it('USER_UNKNOWN: the user said they do not know', async () => {
    const s = await runInput("We don't know the viscosity yet.");
    for (const id of ['properties.viscosityA', 'properties.viscosityB'] as FieldId[]) {
      expect(calculateMissingFields(s.brief).find((m) => m.fieldId === id)?.reason, id).toBe('USER_UNKNOWN');
    }
  });

  it('CONFLICT: contradictory statements stay missing until clarified', async () => {
    const s = await runInput('We mix it 10:1, actually maybe 5:1, not sure.');
    const item = calculateMissingFields(s.brief).find((m) => m.fieldId === 'mixing.ratio');
    expect(item?.reason).toBe('CONFLICT');
  });

  it('values that were only inferred are not reported as missing', async () => {
    const s = await runInput('We use a 10:1 epoxy and need 100 cc/min.');
    expect(getField(s.brief, 'material.componentCount').status).toBe('INFERRED');
    expect(ids(s.brief)).not.toContain('material.componentCount');
  });
});

describe('calculateMissingFields: consistency', () => {
  const inputs = [
    '',
    'hello',
    'We need to pot 500 electronic modules per hour using a two-component epoxy.',
    'We use a 10:1 epoxy and need 100 cc/min.',
    'We have three components with a 1:1:1 ratio.',
    'We manually dispense silicone into electronic housings.',
    'We pot 500 control modules per hour with an automated robotic cell. The two-component epoxy is mixed 10:1 by volume. Component A viscosity is 8000 cP and component B is 200 cP. We dispense 15 g per part, 100 cc/min.',
  ];

  it.each(inputs)('nothing that has a value is listed as missing: "%s"', async (text) => {
    const s = new IntakeSession();
    if (text) await s.submit(text);
    for (const id of ids(s.brief)) expect(hasValue(getField(s.brief, id)), id).toBe(false);
  });

  it.each(inputs)('the brief metadata matches the required-missing list: "%s"', async (text) => {
    const s = new IntakeSession();
    if (text) await s.submit(text);
    expect(s.brief.metadata.missingRequiredFields).toEqual(missingRequiredIds(s.brief, s.profile));
  });

  it('a complete description leaves no required field missing', async () => {
    const s = await runInput(
      'We pot 500 control modules per hour with an automated robotic cell. The two-component epoxy is mixed 10:1 by volume. Component A viscosity is 8000 cP and component B is 200 cP. We dispense 15 g per part, 100 cc/min.',
    );
    expect(missingRequiredIds(s.brief, s.profile)).toEqual([]);
  });
});
