/** Source of a number token: thousands separators or digits with optional decimals. */
export const NUM_SRC = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?`;
/** Non-capturing group version, safe to embed in larger patterns. */
export const NUM = `(?:${NUM_SRC})`;

/**
 * Parse a number as people write it: "2,000" -> 2000, "1,5" -> 1.5, "15" -> 15.
 * Returns null when the token is not a number.
 */
export function parseNumber(token: string): number | null {
  const t = token.trim();
  let s = t;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) s = t.replace(/,/g, '');
  else if (/^\d+,\d+$/.test(t)) s = t.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A comma followed by 1–2 digits is read as a decimal comma ("1,5"); say so in the note. */
export function decimalCommaNote(token: string): string | undefined {
  return /^\d+,\d{1,2}$/.test(token.trim()) ? 'Comma interpreted as a decimal separator.' : undefined;
}

/** Note attached to a number the user qualified with "about", "approximately"... Shown as "(approximate)". */
export const APPROXIMATE_NOTE = 'Approximate value stated.';

/** True when the words just before a number (or inside the evidence) say it is only approximate. */
export function isApproximate(text: string): boolean {
  return /(?:^|[^a-z])(?:approximately|approx\.?|about|around|roughly|circa|nearly)(?![a-z])|~/i.test(text);
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Join the notes that exist, skipping undefined/empty ones. */
export function joinNotes(...parts: Array<string | undefined>): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length > 0 ? kept.join(' ') : undefined;
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/** "a, b and c" */
export function joinList(items: string[], conjunction = 'and'): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

/** Normalise typography that trips up regexes (smart quotes, dashes, nbsp, multiplication sign). */
export function normalizeInput(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/×/g, 'x');
}

export function stripTrailingPunctuation(s: string): string {
  return s.replace(/[\s.,;:!?]+$/g, '').trim();
}
