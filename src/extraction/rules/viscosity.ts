import type { FieldId } from '../../models/types.ts';
import { APPROXIMATE_NOTE, decimalCommaNote, isApproximate, NUM, parseNumber } from '../../utils/text.ts';
import { originFor } from '../scan.ts';
import type { Scan } from '../scan.ts';
import { normalizeViscosityUnit, VISCOSITY_UNIT_SRC } from '../units.ts';
import { RANGE_SEP } from './patterns.ts';
import type { Rule } from './types.ts';

const NOT_MID_NUMBER = String.raw`(?<![\d.,])`;
const LEAD_IN = String.raw`(?:(?:is|are|=|:|of|at|around|about|approximately|approx\.?|~|,|\(|ranges?|varies|between|from)\s*)*`;

/** Which component a phrase refers to: "component A", "B side", "resin", "hardener". */
const COMPONENT_SRC =
  String.raw`(?:(?:component|comp\.?|part|side)\s*(?<c1>[abc])\b|\b(?<c2>[abc])[\s-]*side\b|\b(?<w>resin|base|hardener|catalyst|curing\s+agent|activator)\b)`;

interface ComponentRef {
  fieldId: FieldId;
  /** True when the component was guessed from a role word ("resin" -> A). */
  guessed: boolean;
  label: string;
}

const VISC_FIELDS: Record<string, FieldId> = {
  a: 'properties.viscosityA',
  b: 'properties.viscosityB',
  c: 'properties.viscosityC',
};

function componentRef(g: Record<string, string | undefined>): ComponentRef | null {
  const letter = (g.c1 ?? g.c2)?.toLowerCase();
  if (letter && VISC_FIELDS[letter]) return { fieldId: VISC_FIELDS[letter], guessed: false, label: `Component ${letter.toUpperCase()}` };
  const word = g.w?.toLowerCase().replace(/\s+/g, ' ');
  if (word === 'resin' || word === 'base') return { fieldId: 'properties.viscosityA', guessed: true, label: `"${word}" read as Component A` };
  if (word) return { fieldId: 'properties.viscosityB', guessed: true, label: `"${word}" read as Component B` };
  return null;
}

function emitNumeric(scan: Scan, m: RegExpExecArray): void {
  const g = m.groups;
  if (!g) return;
  const raw = m[0].trim();
  const unit = normalizeViscosityUnit(g.unit ?? '');
  const ref = componentRef(g);
  const n1 = parseNumber(g.n1 ?? '');
  if (n1 === null) return;

  // The unit is explicit even when the value cannot be assigned.
  scan.knownAs('properties.viscosityUnit', unit, g.unit ?? '', originFor(g.unit ?? '', unit));

  if (g.n2) {
    const note = `Range stated (${g.n1}–${g.n2} ${unit}); no single value was given.`;
    scan.review(ref?.fieldId ?? 'properties.viscosityA', null, raw, note);
    if (!ref) scan.review('properties.viscosityB', null, raw, note);
    return;
  }

  if (!ref) {
    const note = `A viscosity of ${g.n1} ${unit} was stated without naming the component.`;
    scan.review('properties.viscosityA', null, raw, note);
    scan.review('properties.viscosityB', null, raw, note);
    return;
  }

  if (ref.guessed) {
    scan.inferred(ref.fieldId, n1, raw, `${ref.label}; confirm which component this is.`);
  } else {
    const approximate = isApproximate(raw.replace(/\bviscosity\b/gi, ''));
    scan.known(ref.fieldId, n1, raw, {
      typed: g.n1,
      ...(approximate || decimalCommaNote(g.n1 ?? '')
        ? { note: [approximate ? APPROXIMATE_NOTE : '', decimalCommaNote(g.n1 ?? '') ?? ''].filter(Boolean).join(' ') }
        : {}),
    });
  }
}

export const viscosityRule: Rule = (scan) => {
  const tail = String.raw`(?<n1>${NUM})(?:${RANGE_SEP}(?<n2>${NUM}))?\s*(?<unit>${VISCOSITY_UNIT_SRC})\b`;

  // "viscosity of component A is 5,000 cP", "viscosity 5000 cps"
  const viscosityFirst = new RegExp(
    String.raw`viscosity\s*(?:of|for)?\s*(?:${COMPONENT_SRC})?\s*${LEAD_IN}\s*${NOT_MID_NUMBER}${tail}`,
    'gi',
  );
  // A component named just before the word ("Resin viscosity is 5000 cP") is handled by the next pattern.
  const componentBefore = new RegExp(String.raw`${COMPONENT_SRC}\s*$`, 'i');
  for (const m of scan.matches(viscosityFirst)) {
    const namedInside = Boolean(m.groups?.c1 ?? m.groups?.c2 ?? m.groups?.w);
    if (!namedInside && componentBefore.test(scan.text.slice(Math.max(0, m.index - 24), m.index))) continue;
    emitNumeric(scan, m);
    scan.consume(m);
  }

  // "Component A: 5000 cP", "hardener at 200 cps"
  const componentFirst = new RegExp(
    String.raw`${COMPONENT_SRC}\s*(?:viscosity\s*)?${LEAD_IN}\s*${NOT_MID_NUMBER}${tail}`,
    'gi',
  );
  for (const m of scan.matches(componentFirst)) {
    emitNumeric(scan, m);
    scan.consume(m);
  }

  // Qualitative statements: never turned into numbers.
  const qualitative: Array<{ re: RegExp; pick: (m: RegExpExecArray) => string }> = [
    {
      re: /\b(very\s+high|extremely\s+high|high|medium|moderate|low|very\s+low)[\s-]+viscosity\b/gi,
      pick: (m) => `${m[1]} viscosity`,
    },
    {
      re: /\bviscosity\s*(?:is|:|=|seems|looks)?\s*(?:quite\s+|fairly\s+|rather\s+|very\s+)?(very\s+high|extremely\s+high|high|medium|moderate|low|very\s+low|thick|thin)\b/gi,
      pick: (m) => `viscosity ${m[1]}`,
    },
    {
      re: /\b(very\s+viscous|highly\s+viscous|paste-like|water-thin|honey-like|self-leveling|viscous\s+(?:resin|material|epoxy|compound|fluid|mix))\b/gi,
      pick: (m) => m[1] ?? m[0],
    },
  ];
  for (const { re, pick } of qualitative) {
    for (const m of scan.matches(re)) {
      const phrase = pick(m);
      const note = `Described qualitatively ("${phrase}"); no numeric value was provided.`;
      scan.review('properties.viscosityA', null, m[0].trim(), note);
      scan.review('properties.viscosityB', null, m[0].trim(), note);
      scan.consume(m);
    }
  }
};
