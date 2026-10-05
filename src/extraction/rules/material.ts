import { CHEMISTRY_LABELS } from '../../data/fields.ts';
import type { Scan } from '../scan.ts';
import { SIGNALS } from '../types.ts';
import type { Rule } from './types.ts';

// ---- number of components -----------------------------------------------------------------

const COUNT_WORDS: Record<string, number> = {
  one: 1,
  single: 1,
  two: 2,
  dual: 2,
  double: 2,
  bi: 2,
  three: 3,
  triple: 3,
  tri: 3,
  four: 4,
  five: 5,
  six: 6,
};
const COUNT_TOKEN = '(one|single|two|dual|double|bi|three|triple|tri|four|five|six|[1-6])';

export function countFromToken(token: string): number | null {
  const t = token.toLowerCase();
  if (/^[1-6]$/.test(t)) return Number(t);
  return COUNT_WORDS[t] ?? null;
}

const MATERIAL_WORDS =
  /^\s*(?:[-\s]*)(?:mix(?:ture)?|system|product|compound|resin|material|epoxy|polyurethane|urethane|silicone|acrylic|polyester|potting|encapsulant|adhesive|sealant|pu\b)/i;

export const componentCountRule: Rule = (scan) => {
  // "two component", "2-component", "three components", "bicomponent", "single-component"
  const componentRe = new RegExp(String.raw`\b${COUNT_TOKEN}[\s-]*comp(?:onent)?s?\b\.?`, 'gi');
  for (const m of scan.matches(componentRe)) {
    const after = scan.text.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (/^\s+(?:per|each|every|in|on|into)\b/i.test(after)) continue; // "two components per cycle"
    const n = countFromToken(m[1] ?? '');
    if (n === null) continue;
    scan.known('material.componentCount', n, m[0].trim());
    scan.consume(m);
  }

  // "two-part epoxy", "2 part mix" — but never "2 parts per hour"
  const partRe = new RegExp(String.raw`\b${COUNT_TOKEN}([\s-]*)parts?\b`, 'gi');
  for (const m of scan.matches(partRe)) {
    const after = scan.text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    if (/^\s*(?:per|\/|each|every|a\s+(?:hour|day|minute|shift|week))\b/i.test(after)) continue;
    const hyphenated = (m[2] ?? '').includes('-');
    if (!hyphenated && !MATERIAL_WORDS.test(after)) continue;
    const n = countFromToken(m[1] ?? '');
    if (n === null) continue;
    scan.known('material.componentCount', n, m[0].trim());
    scan.consume(m);
  }

  // "2K epoxy" (only when followed by a material word, so "2K parts per week" is untouched)
  const kRe = /\b([1-3])\s?K\b(?=\s+(?:epoxy|polyurethane|urethane|pu\b|silicone|resin|material|system|potting|compound|adhesive|mix))/g;
  for (const m of scan.matches(kRe)) {
    scan.knownAs('material.componentCount', Number(m[1]), m[0], 'NORMALIZED');
    scan.consume(m);
  }

  // Mentions of "Component B" / "Part C" etc. are used later as weak evidence (INFERRED only).
  if (/\b(?:component|comp\.?|part|side)\s*b\b|\bb[\s-]*side\b/i.test(scan.text)) scan.signal(SIGNALS.MENTIONS_COMPONENT_B);
  if (/\b(?:component|comp\.?|part|side)\s*c\b|\bc[\s-]*side\b/i.test(scan.text)) scan.signal(SIGNALS.MENTIONS_COMPONENT_C);
};

// ---- chemistry -----------------------------------------------------------------------------

const CHEMISTRY_PATTERNS: Array<[string, RegExp]> = [
  ['epoxy', /\bepox(?:y|ies|ide)\b/gi],
  ['polyurethane', /\b(?:poly)?urethanes?\b/gi],
  ['polyurethane', /\bPUR?\b/g], // case-sensitive on purpose: "pu" in running text is noise
  ['silicone', /\bsilicones?\b|\bPDMS\b|\bRTV\b/gi],
  ['acrylic', /\bacrylics?\b|\bmethacrylates?\b/gi],
  ['polyester', /\bpolyesters?\b/gi],
  ['polysulfide', /\bpolysulfides?\b/gi],
];

export const chemistryRule: Rule = (scan) => {
  for (const [key, re] of CHEMISTRY_PATTERNS) {
    for (const m of scan.matches(re)) {
      if (!(key in CHEMISTRY_LABELS)) continue;
      scan.known('material.chemistry', key, m[0]);
    }
  }
};

// ---- mix ratio -----------------------------------------------------------------------------

const TERM = String.raw`\d+(?:\.\d+)?`;
const RATIO_CONTEXT = /\b(?:ratio|mix(?:ed|ing|es)?|by\s+(?:weight|volume|mass)|w\/w|v\/v)\b/i;
const FOLLOWED_BY_UNIT =
  /^\s*(?:%|percent|minutes?|mins?|seconds?|secs?|hours?|hrs?|days?|weeks?|months?|years?|g\b|grams?|kg|ml|cc|cm|mm|l\b|liters?|litres?|parts?\b|units?|pcs|pieces|modules|cps?\b|mpa|pa\b|°|degrees?|c\b|f\b|psi|bar|mbar|inch|in\b)/i;

function ratioTerms(match: RegExpExecArray): number[] {
  return match
    .slice(1, 4)
    .filter((t): t is string => typeof t === 'string')
    .map((t) => Number(t));
}

function canonicalRatio(terms: number[]): string {
  return terms.map((t) => String(t)).join(':');
}

function ratioBasis(scan: Scan, start: number, end: number): string | undefined {
  const after = scan.text.slice(end, end + 28);
  const before = scan.text.slice(Math.max(0, start - 20), start);
  const m = /^\s*(?:ratio\s*)?(?:by|per)\s*(weight|volume|mass)\b/i.exec(after) ?? /(?:by)\s*(weight|volume|mass)\s*$/i.exec(before);
  if (m) return `By ${m[1]?.toLowerCase()}.`;
  if (/^\s*w\/w\b/i.test(after)) return 'By weight.';
  if (/^\s*v\/v\b/i.test(after)) return 'By volume.';
  return undefined;
}

function emitRatio(scan: Scan, m: RegExpExecArray, terms: number[]): void {
  if (terms.length < 2 || terms.some((t) => !(t > 0) || t > 100000)) return;
  const note = ratioBasis(scan, m.index, m.index + m[0].length);
  scan.known('mixing.ratio', canonicalRatio(terms), m[0].trim(), note ? { note } : {});
  scan.consume(m);
}

export const ratioRule: Rule = (scan) => {
  // 10:1  /  1:1:1
  const colonRe = new RegExp(String.raw`(?<![\d.:])(${TERM})\s*:\s*(${TERM})(?:\s*:\s*(${TERM}))?(?![\d]|:\d)`, 'g');
  for (const m of scan.matches(colonRe)) {
    const end = m.index + m[0].length;
    const window = scan.text.slice(Math.max(0, m.index - 30), end + 30);
    const looksLikeTime =
      /^\d{1,2}$/.test(m[1] ?? '') && /^\d{2}$/.test(m[2] ?? '') && Number(m[1]) <= 24 && Number(m[2]) <= 59 && m[3] === undefined;
    if (looksLikeTime && (/^\s*(?:am|pm|a\.m|p\.m)/i.test(scan.text.slice(end, end + 6)) || !RATIO_CONTEXT.test(window))) continue;
    emitRatio(scan, m, ratioTerms(m));
  }

  // "10 parts resin to 1 part hardener"
  const partsRe = new RegExp(
    String.raw`(${TERM})\s+parts?\s+(?:(?:resin|base|hardener|catalyst|activator|curing\s+agent|epoxy|polyurethane|silicone|component\s+[ab]|part\s+[ab]|[ab])\s+)?(?:to|and|\+|:)\s*(${TERM})\s+parts?`,
    'gi',
  );
  for (const m of scan.matches(partsRe)) emitRatio(scan, m, ratioTerms(m));

  // "10 to 1", "10-to-1", "1 to 1 to 1" — only with ratio context, to avoid "500 to 600 parts per hour"
  const toRe = new RegExp(String.raw`(?<![\d.])(${TERM})\s*-?\s*to\s*-?\s*(${TERM})(?:\s*-?\s*to\s*-?\s*(${TERM}))?(?!\d|\.\d)`, 'gi');
  for (const m of scan.matches(toRe)) {
    const end = m.index + m[0].length;
    const after = scan.text.slice(end, end + 24);
    if (FOLLOWED_BY_UNIT.test(after)) continue;
    const window = scan.text.slice(Math.max(0, m.index - 40), end + 40);
    const nearMaterial = /^\s*(?:epoxy|polyurethane|urethane|silicone|resin|material|mix|system|acrylic|compound)/i.test(after);
    if (!RATIO_CONTEXT.test(window) && !nearMaterial) continue;
    emitRatio(scan, m, ratioTerms(m));
  }
};

// ---- material name -------------------------------------------------------------------------

export const materialNameRule: Rule = (scan) => {
  const re =
    /\b(?:called|named)\s+["']?([A-Za-z0-9][\w\-./]*(?:\s+[\w\-./]+){0,3}?)["']?(?=[.,;:]|\s+(?:and|with|which|that|for|from|in|at|to|using)\b|$)/gi;
  for (const m of scan.matches(re)) {
    const before = scan.text.slice(Math.max(0, m.index - 40), m.index);
    if (!/(?:epoxy|resin|polyurethane|urethane|silicone|acrylic|material|compound|product|grade|system)\s+(?:is\s+|are\s+|being\s+)?$/i.test(before)) continue;
    const name = (m[1] ?? '').trim();
    if (name.length >= 2) scan.known('material.materialName', name, name);
  }
};
