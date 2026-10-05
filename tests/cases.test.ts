import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { calculateCompleteness, calculateMissingFields, computeReviewFlags, getPlatformContext } from '../src/engine/index.ts';
import type { IntakeSession } from '../src/engine/index.ts';
import { getField, hasValue, isConflicted } from '../src/models/brief.ts';
import type { FieldId } from '../src/models/types.ts';
import { draft, knownFieldIds, questionSequence, rfqPlain, runInput } from './helpers.ts';

type Scalar = string | number | boolean;

interface Expectations {
  known?: Record<string, Scalar>;
  inferred?: Record<string, Scalar>;
  review?: Record<string, Scalar | null>;
  unknown?: string[];
  userUnknown?: string[];
  conflict?: string[];
  next?: { field: string | null; mode?: string };
  notAsked?: string[];
  missing?: Record<string, string>;
  missingRequiredEmpty?: boolean;
  platforms?: 'none' | string[];
  flags?: string[];
  rfq?: { contains?: string[]; notProvided?: string[] };
  knownCount?: number;
  completeness?: { min: number; max: number };
  notice?: string;
}

interface TestCase {
  id: string;
  name: string;
  input: string;
  expect: Expectations;
}

const file = JSON.parse(readFileSync(new URL('../test-cases.json', import.meta.url), 'utf8')) as { cases: TestCase[] };

function describeField(session: IntakeSession, id: string): string {
  const f = getField(session.brief, id as FieldId);
  return `${f.status} ${JSON.stringify(f.value)}`;
}

describe('test-cases.json', () => {
  it('has at least 20 cases with unique ids', () => {
    expect(file.cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(file.cases.map((c) => c.id)).size).toBe(file.cases.length);
  });

  for (const tc of file.cases) {
    describe(`${tc.id} ${tc.name}`, () => {
      const e = tc.expect;
      let session: IntakeSession;
      beforeAll(async () => {
        session = await runInput(tc.input);
      });

      if (e.known) {
        const spec = e.known;
        it('stated values are KNOWN with the right value', () => {
          const problems = Object.entries(spec).flatMap(([id, value]) => {
            const f = getField(session.brief, id as FieldId);
            return f.status === 'KNOWN' && f.value === value ? [] : [`${id}: expected KNOWN ${JSON.stringify(value)}, got ${describeField(session, id)}`];
          });
          expect(problems).toEqual([]);
        });
      }

      if (e.inferred) {
        const spec = e.inferred;
        it('deduced values are INFERRED, never KNOWN', () => {
          const problems = Object.entries(spec).flatMap(([id, value]) => {
            const f = getField(session.brief, id as FieldId);
            const ok = f.status === 'INFERRED' && f.value === value && Boolean(f.note);
            return ok ? [] : [`${id}: expected INFERRED ${JSON.stringify(value)} with a note, got ${describeField(session, id)}`];
          });
          expect(problems).toEqual([]);
        });
      }

      if (e.review) {
        const spec = e.review;
        it('ambiguous statements are REQUIRES_ENGINEER_REVIEW (no number invented)', () => {
          const problems = Object.entries(spec).flatMap(([id, value]) => {
            const f = getField(session.brief, id as FieldId);
            const ok = f.status === 'REQUIRES_ENGINEER_REVIEW' && f.value === value;
            return ok ? [] : [`${id}: expected REQUIRES_ENGINEER_REVIEW ${JSON.stringify(value)}, got ${describeField(session, id)}`];
          });
          expect(problems).toEqual([]);
        });
      }

      if (e.unknown) {
        const spec = e.unknown;
        it('everything not mentioned stays UNKNOWN', () => {
          const problems = spec.filter((id) => {
            const f = getField(session.brief, id as FieldId);
            return hasValue(f) || f.status !== 'UNKNOWN';
          }).map((id) => `${id}: expected UNKNOWN, got ${describeField(session, id)}`);
          expect(problems).toEqual([]);
        });
      }

      if (e.userUnknown) {
        const spec = e.userUnknown;
        it('"I don\'t know" is recorded as such, not as a value', () => {
          const problems = spec.filter((id) => {
            const f = getField(session.brief, id as FieldId);
            return !(f.userUnknown === true && !hasValue(f));
          });
          expect(problems).toEqual([]);
        });
      }

      if (e.conflict) {
        const spec = e.conflict;
        it('contradicting statements are kept as candidates with no value', () => {
          const problems = spec.filter((id) => {
            const f = getField(session.brief, id as FieldId);
            return !(isConflicted(f) && f.value === null && (f.candidates?.length ?? 0) >= 2);
          });
          expect(problems).toEqual([]);
        });
      }

      if (e.next) {
        const spec = e.next;
        it('asks the right next question', () => {
          const q = session.currentQuestion;
          expect(q ? q.fieldId : null).toBe(spec.field);
          if (spec.mode) expect(q?.mode).toBe(spec.mode);
        });
      }

      if (e.notAsked) {
        const spec = e.notAsked;
        it('never asks for these, even when every question is skipped', async () => {
          const asked = await questionSequence(tc.input);
          expect(asked.filter((id) => spec.includes(id))).toEqual([]);
        });
      }

      if (e.missing) {
        const spec = e.missing;
        it('lists them as missing with the right reason', () => {
          const missing = calculateMissingFields(session.brief, session.profile);
          const problems = Object.entries(spec).flatMap(([id, reason]) => {
            const found = missing.find((m) => m.fieldId === id);
            return found?.reason === reason ? [] : [`${id}: expected missing (${reason}), got ${found ? found.reason : 'not missing'}`];
          });
          expect(problems).toEqual([]);
        });
      }

      if (e.missingRequiredEmpty) {
        it('has no missing REQUIRED field', () => {
          const required = calculateMissingFields(session.brief, session.profile).filter((m) => m.priority === 'REQUIRED');
          expect(required.map((m) => m.fieldId)).toEqual([]);
        });
      }

      if (e.platforms !== undefined) {
        const spec = e.platforms;
        it('shows platform context only when there is enough information', () => {
          const ctx = getPlatformContext(session.brief);
          if (spec === 'none') {
            expect(ctx.available).toBe(false);
            expect(ctx.entries).toEqual([]);
            expect(ctx.reason).toBeTruthy();
          } else {
            expect(ctx.available).toBe(true);
            expect(ctx.entries.map((entry) => entry.name)).toHaveLength(spec.length);
            spec.forEach((prefix, i) => expect(ctx.entries[i]?.name.startsWith(prefix)).toBe(true));
          }
          expect(ctx.disclaimer).toBe('Final system selection requires Fluidic engineering review.');
        });
      }

      if (e.flags) {
        const spec = e.flags;
        it('lists the right engineer-review notes', () => {
          const ids = computeReviewFlags(session.brief, session.profile).map((f) => f.id);
          expect(spec.filter((id) => !ids.includes(id))).toEqual([]);
        });
      }

      if (e.rfq) {
        const spec = e.rfq;
        it('produces the expected RFQ draft', () => {
          const text = rfqPlain(session);
          expect((spec.contains ?? []).filter((snippet) => !text.includes(snippet))).toEqual([]);
          const rfq = draft(session);
          const notProvided = (spec.notProvided ?? []).filter((label) => rfq.lines.find((l) => l.label === label)?.provided !== false);
          expect(notProvided).toEqual([]);
        });
      }

      if (e.knownCount !== undefined) {
        const spec = e.knownCount;
        it('has the expected number of KNOWN fields', () => {
          expect(knownFieldIds(session.brief)).toHaveLength(spec);
        });
      }

      if (e.completeness) {
        const spec = e.completeness;
        it('keeps the completeness indicator in range', () => {
          const { percent } = calculateCompleteness(session.brief, session.profile);
          expect(percent).toBeGreaterThanOrEqual(spec.min);
          expect(percent).toBeLessThanOrEqual(spec.max);
        });
      }

      if (e.notice) {
        const spec = e.notice;
        it('tells the user what happened', () => {
          const notices = session.transcript.flatMap((t) => (t.type === 'notice' ? [t.text] : []));
          expect(notices.some((n) => n.includes(spec))).toBe(true);
        });
      }
    });
  }
});
