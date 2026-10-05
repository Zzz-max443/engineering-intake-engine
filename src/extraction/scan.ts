import type { FieldId, Origin, Primitive } from '../models/types.ts';
import { collapseWhitespace, isApproximate } from '../utils/text.ts';
import type { ExtractedValue } from './types.ts';

type Span = [number, number];

/** Compare what the user typed with the canonical form we store: same -> USER_STATED, else NORMALIZED. */
export function originFor(raw: string, canonical: string): 'USER_STATED' | 'NORMALIZED' {
  const clean = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  return clean(raw) === clean(canonical) ? 'USER_STATED' : 'NORMALIZED';
}

/**
 * Working state of one extraction pass. Rules run in priority order; text matched by a rule is
 * "consumed" so that weaker rules cannot read the same words twice (e.g. "100 cc/min" is a flow
 * rate and must never also be read as a production rate).
 */
export class Scan {
  readonly text: string;
  readonly values: ExtractedValue[] = [];
  readonly signals = new Set<string>();
  readonly capturedNotes: string[] = [];
  private spans: Span[] = [];

  constructor(text: string) {
    this.text = text;
  }

  private overlaps(start: number, end: number): boolean {
    return this.spans.some(([s, e]) => start < e && end > s);
  }

  /** All matches of `re` that do not overlap text consumed by an earlier rule. */
  matches(re: RegExp): RegExpExecArray[] {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    const g = new RegExp(re.source, flags);
    const out: RegExpExecArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = g.exec(this.text)) !== null) {
      if (m[0].length === 0) {
        g.lastIndex += 1;
        continue;
      }
      if (!this.overlaps(m.index, m.index + m[0].length)) out.push(m);
    }
    return out;
  }

  consume(m: RegExpExecArray): void {
    this.spans.push([m.index, m.index + m[0].length]);
  }

  /** True when the words just before `index` (same clause) contain a negation. */
  negatedBefore(index: number, maxWords = 3): boolean {
    const before = this.text.slice(Math.max(0, index - 48), index);
    const clause = before.split(/[.;,!?:]/).pop() ?? '';
    const tail = clause.trim().split(/\s+/).slice(-maxWords).join(' ');
    return /\b(?:not|no|non|without|never|neither|nor|isn't|aren't|don't|doesn't|didn't|cannot|can't)\b/i.test(tail);
  }

  /** The few words before `index` in the same clause plus the matched words: "is not automated". */
  phraseBefore(index: number, end: number, maxWords = 3): string {
    const before = this.text.slice(Math.max(0, index - 48), index);
    const clause = before.split(/[.;,!?:]/).pop() ?? '';
    const lead = clause.trim().split(/\s+/).filter(Boolean).slice(-maxWords).join(' ');
    return collapseWhitespace(`${lead} ${this.text.slice(index, end)}`);
  }

  /** True when the number starting at `index` is introduced by "about", "approximately", "~"... */
  approximateBefore(index: number): boolean {
    const before = this.text.slice(Math.max(0, index - 16), index).trimEnd();
    const word = /(?:[a-z.~]+)$/i.exec(before)?.[0] ?? '';
    return isApproximate(word);
  }

  signal(name: string): void {
    this.signals.add(name);
  }

  capture(note: string): void {
    if (!this.capturedNotes.includes(note)) this.capturedNotes.push(note);
  }

  /** Stated by the user. Origin is USER_STATED when stored as typed, NORMALIZED otherwise. */
  known(
    fieldId: FieldId,
    value: Primitive,
    raw: string,
    opts: { note?: string; canonical?: string; typed?: string } = {},
  ): void {
    this.values.push({
      fieldId,
      value,
      status: 'KNOWN',
      // `typed` = the part of the evidence that is compared with the stored form (e.g. just "1,000").
      origin: originFor(opts.typed ?? raw, opts.canonical ?? String(value)),
      raw,
      ...(opts.note ? { note: opts.note } : {}),
    });
  }

  /** Same as known() but the origin is forced (e.g. the user wrote "automatically", we store "Automated"). */
  knownAs(fieldId: FieldId, value: Primitive, raw: string, origin: Origin, note?: string): void {
    this.values.push({ fieldId, value, status: 'KNOWN', origin, raw, ...(note ? { note } : {}) });
  }

  /** Deduced by the system — never a fact until the user confirms it. */
  inferred(fieldId: FieldId, value: Primitive, raw: string, note: string): void {
    this.values.push({ fieldId, value, status: 'INFERRED', origin: 'INFERRED', raw, note });
  }

  /** The user gave something that only an engineer can interpret (qualitative, range, hazard...). */
  review(fieldId: FieldId, value: Primitive | null, raw: string, note: string): void {
    this.values.push({ fieldId, value, status: 'REQUIRES_ENGINEER_REVIEW', origin: 'USER_STATED', raw, note });
  }

  /** The user said they do not know / have not decided this yet. */
  declaredUnknown(fieldId: FieldId, raw: string, note?: string): void {
    this.values.push({
      fieldId,
      value: null,
      status: 'UNKNOWN',
      origin: 'USER_STATED',
      raw,
      userUnknown: true,
      ...(note ? { note } : {}),
    });
  }
}
