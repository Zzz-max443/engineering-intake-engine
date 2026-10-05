/**
 * Shared regex fragments for the quantity rules.
 *
 * A range ("10-20 g", "between 10 and 20 g") or a bound ("up to 20 g", "at least 50 parts/hour") is
 * NOT a value. The rules turn both into REQUIRES_ENGINEER_REVIEW with no number, so the tool never
 * picks one end of what the user said.
 */

/** Optional lead-in before the first number of a range: "between 10 and 20", "from 10 to 20". */
export const RANGE_LEAD = String.raw`(?:(?:between|from)\s+)?`;

/** Separator between the two numbers of a range: "-", "–", "to", "and". */
export const RANGE_SEP = String.raw`(?:\s*(?:-|–|—|to)\s*|\s+and\s+)`;

/** Words that turn the number that follows into a bound rather than a value. */
const BOUND_BEFORE =
  /(?:up\s+to|at\s+(?:most|least)|no\s+(?:more|less|fewer)\s+than|(?:more|less|greater|fewer|higher|lower)\s+than|(?:a\s+)?(?:max(?:imum)?|min(?:imum)?)\.?(?:\s+of)?|over|under|below|above|exceeding)\s*(?:about\s+|approximately\s+|approx\.?\s*|around\s+|roughly\s+|~\s*)?$/i;

export interface Bound {
  /** The bound wording, e.g. "up to". */
  phrase: string;
  /** Index in the text where the bound wording starts (so the evidence can include it). */
  start: number;
}

/** If the number at `index` is introduced by "up to", "at least", "maximum"... return that wording. */
export function boundBefore(text: string, index: number): Bound | null {
  const from = Math.max(0, index - 32);
  const before = text.slice(from, index);
  const m = BOUND_BEFORE.exec(before);
  if (!m) return null;
  // Word boundary on the left: "county to" must not count as "up to".
  const at = from + m.index;
  if (at > 0 && /[A-Za-z]/.test(text.charAt(at - 1))) return null;
  return { phrase: m[0].replace(/\s+/g, ' ').trim(), start: at };
}

/** A bound written right before the number, captured as the named group "bound". */
export const BOUND_SRC = String.raw`(?:(?<bound>up\s+to|at\s+most|at\s+least|no\s+more\s+than|no\s+less\s+than|(?:more|less)\s+than|max(?:imum)?|min(?:imum)?)\s+(?:of\s+)?)?`;

export interface BoundInfo {
  phrase: string;
  /** What the user wrote, bound wording included. */
  raw: string;
}

/** Finds a bound for the match `m`, either captured inside it ("bound" group) or written just before it. */
export function boundOf(text: string, m: RegExpExecArray): BoundInfo | null {
  const inside = m.groups?.['bound'];
  if (inside) return { phrase: inside.replace(/\s+/g, ' ').trim().toLowerCase(), raw: m[0].trim() };
  const before = boundBefore(text, m.index);
  if (!before) return null;
  return { phrase: before.phrase.toLowerCase(), raw: text.slice(before.start, m.index + m[0].length).trim() };
}
