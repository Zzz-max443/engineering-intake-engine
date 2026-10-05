import { APPROXIMATE_NOTE, decimalCommaNote, NUM, parseNumber } from '../../utils/text.ts';
import { originFor } from '../scan.ts';
import type { Scan } from '../scan.ts';
import {
  MASS_VOL_SRC,
  normalizeMassVol,
  normalizePeriod,
  normalizeTimeShort,
  PERIOD_SRC,
  PRODUCTION_NOUN_UNITS,
  TIME_SHORT_SRC,
} from '../units.ts';
import { BOUND_SRC, boundOf, RANGE_LEAD, RANGE_SEP } from './patterns.ts';
import type { Rule } from './types.ts';

const APPROX = String.raw`(?<approx>approximately|approx\.?|about|around|roughly|circa|~)`;
const LEAD_IN = String.raw`(?:of|is|are|:|=|around|about|approximately|approx\.?|~)?`;
const NOT_MID_NUMBER = String.raw`(?<![\d.,])`;
const PER_NOUN =
  String.raw`(?:part|unit|module|piece|pc|shot|cycle|housing|assembly|cavity|dispense|pcb|board|cell|pack|device|product|sensor|connector|component|item)s?`;
const ANY_PERIOD = String.raw`(?:${TIME_SHORT_SRC}|day|shift|week|month|year)`;

function joinNotes(...parts: Array<string | undefined>): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length > 0 ? kept.join(' ') : undefined;
}

function numberNote(token: string, approx: string | undefined): string | undefined {
  return joinNotes(approx ? APPROXIMATE_NOTE : undefined, decimalCommaNote(token));
}

/** "up to 100 cc/min": a bound is recorded for the engineer, never as a value. */
function reviewBound(scan: Scan, fieldId: Parameters<Scan['review']>[0], raw: string, what: string): void {
  scan.review(fieldId, null, raw, `Bound stated (“${raw}”); ${what}`);
}

// ---- flow rate ----------------------------------------------------------------------------

export const flowRateRule: Rule = (scan) => {
  // Range: "50-100 cc/min" -> never pick a number for the user.
  const rangeRe = new RegExp(
    String.raw`${RANGE_LEAD}${NOT_MID_NUMBER}(?<n1>${NUM})${RANGE_SEP}(?<n2>${NUM})\s*(?<uexpr>(?<unit>${MASS_VOL_SRC})\s*(?:\/|per)\s*(?<time>${TIME_SHORT_SRC}))\b`,
    'gi',
  );
  for (const m of scan.matches(rangeRe)) {
    const g = m.groups;
    if (!g) continue;
    const unit = `${normalizeMassVol(g.unit ?? '')}/${normalizeTimeShort(g.time ?? '')}`;
    scan.review(
      'production.flowRate',
      null,
      m[0].trim(),
      `Range stated (${g.n1}–${g.n2} ${unit}); no single target value was given.`,
    );
    scan.knownAs('production.flowUnit', unit, g.uexpr ?? unit, originFor(g.uexpr ?? unit, unit));
    scan.consume(m);
  }

  // "100 cc/min", "100 cc per minute", "flow rate of 2 g/s"
  const re = new RegExp(
    String.raw`(?:(?:flow\s*rate|flow|dispens(?:e|ing)\s+rate)\s*${LEAD_IN}\s*)?${BOUND_SRC}(?:${APPROX}\s*)?${NOT_MID_NUMBER}(?<num>${NUM})\s*(?<uexpr>(?<unit>${MASS_VOL_SRC})\s*(?:\/|per)\s*(?<time>${TIME_SHORT_SRC}))\b`,
    'gi',
  );
  for (const m of scan.matches(re)) {
    const g = m.groups;
    const value = parseNumber(g?.num ?? '');
    if (!g || value === null) continue;
    const unit = `${normalizeMassVol(g.unit ?? '')}/${normalizeTimeShort(g.time ?? '')}`;
    const bound = boundOf(scan.text, m);
    if (bound) reviewBound(scan, 'production.flowRate', bound.raw, 'no single target flow rate was given.');
    else scan.known('production.flowRate', value, m[0].trim(), { typed: g.num, note: numberNote(g.num ?? '', g.approx) });
    scan.knownAs('production.flowUnit', unit, g.uexpr ?? unit, originFor(g.uexpr ?? unit, unit));
    scan.consume(m);
  }
};

// ---- shot size / dispensed volume ----------------------------------------------------------

const SHOT_LABEL = String.raw`(?:shot\s*size|(?:shots?|doses?)\s+of|dispens(?:e|ed|ing)\s*(?:volume|amount|quantity|weight)|dose(?:\s*size)?|dosage|(?:volume|amount|weight|quantity)\s*per\s*(?:part|shot|unit|cycle)|fill\s*(?:volume|weight|amount))`;
const SHOT_VERB = String.raw`(?:dispens(?:e|ed|es|ing)|fill(?:ing|s)?|pour(?:ing)?|dos(?:e|ing)|deposit(?:ing)?|apply(?:ing)?|inject(?:ing)?)`;

export const shotSizeRule: Rule = (scan) => {
  const emit = (value: number, token: string, unitToken: string, raw: string, note: string | undefined, inferred = false): void => {
    const unit = normalizeMassVol(unitToken);
    if (inferred) {
      scan.inferred('production.shotSize', value, raw, note ?? 'Inferred.');
      scan.values.push({
        fieldId: 'production.shotSizeUnit',
        value: unit,
        status: 'INFERRED',
        origin: 'INFERRED',
        raw: unitToken,
        note: 'Unit read from a quantity that was not explicitly tied to one part or shot.',
      });
      return;
    }
    scan.known('production.shotSize', value, raw, { typed: token, note });
    scan.knownAs('production.shotSizeUnit', unit, unitToken, originFor(unitToken, unit));
  };

  // Range: "10-20 g per part" / "shot size 10 to 20 g"
  const rangePatterns = [
    // "10-20 g per part"
    new RegExp(
      String.raw`${RANGE_LEAD}${NOT_MID_NUMBER}(?<n1>${NUM})${RANGE_SEP}(?<n2>${NUM})\s*(?<unit>${MASS_VOL_SRC})\s*(?:\/|per|each|a)\s*${PER_NOUN}\b`,
      'gi',
    ),
    // "shot size 10 to 20 g"
    new RegExp(
      String.raw`${SHOT_LABEL}\s*${LEAD_IN}\s*${RANGE_LEAD}${NOT_MID_NUMBER}(?<n1>${NUM})${RANGE_SEP}(?<n2>${NUM})\s*(?<unit>${MASS_VOL_SRC})\b`,
      'gi',
    ),
    // "we dispense 10 to 20 g"
    new RegExp(
      String.raw`${SHOT_VERB}\s+${RANGE_LEAD}${NOT_MID_NUMBER}(?<n1>${NUM})${RANGE_SEP}(?<n2>${NUM})\s*(?<unit>${MASS_VOL_SRC})\b(?!\s*(?:\/|per|a)\s*${ANY_PERIOD}\b)`,
      'gi',
    ),
  ];
  for (const rangeRe of rangePatterns) {
    for (const m of scan.matches(rangeRe)) {
      const g = m.groups;
      if (!g) continue;
      const unit = normalizeMassVol(g.unit ?? '');
      scan.review('production.shotSize', null, m[0].trim(), `Range stated (${g.n1}–${g.n2} ${unit}); no single shot size was given.`);
      scan.knownAs('production.shotSizeUnit', unit, g.unit ?? '', originFor(g.unit ?? '', unit));
      scan.consume(m);
    }
  }

  // "15 grams per part", "15 g/part", "approximately 15 g per shot"
  const perRe = new RegExp(
    String.raw`${BOUND_SRC}(?:${APPROX}\s*)?${NOT_MID_NUMBER}(?<num>${NUM})\s*(?<unit>${MASS_VOL_SRC})\s*(?:\/|per|each|a)\s*(?<per>${PER_NOUN})\b`,
    'gi',
  );
  for (const m of scan.matches(perRe)) {
    const g = m.groups;
    const value = parseNumber(g?.num ?? '');
    if (!g || value === null) continue;
    const per = (g.per ?? '').toLowerCase().replace(/s$/, '');
    const bound = boundOf(scan.text, m);
    if (bound) {
      reviewBound(scan, 'production.shotSize', bound.raw, 'no single shot size was given.');
      scan.knownAs('production.shotSizeUnit', normalizeMassVol(g.unit ?? ''), g.unit ?? '', originFor(g.unit ?? '', normalizeMassVol(g.unit ?? '')));
    } else {
      emit(value, g.num ?? '', g.unit ?? '', m[0].trim(), joinNotes(numberNote(g.num ?? '', g.approx), `Stated per ${per}.`));
    }
    scan.consume(m);
  }

  // "a 15 g shot", "15 g doses"
  const suffixRe = new RegExp(
    String.raw`${BOUND_SRC}(?:${APPROX}\s*)?${NOT_MID_NUMBER}(?<num>${NUM})\s*(?<unit>${MASS_VOL_SRC})\s+(?:shots?|doses?)\b`,
    'gi',
  );
  for (const m of scan.matches(suffixRe)) {
    const g = m.groups;
    const value = parseNumber(g?.num ?? '');
    if (!g || value === null) continue;
    const bound = boundOf(scan.text, m);
    if (bound) {
      reviewBound(scan, 'production.shotSize', bound.raw, 'no single shot size was given.');
      scan.knownAs('production.shotSizeUnit', normalizeMassVol(g.unit ?? ''), g.unit ?? '', originFor(g.unit ?? '', normalizeMassVol(g.unit ?? '')));
    } else {
      emit(value, g.num ?? '', g.unit ?? '', m[0].trim(), joinNotes(numberNote(g.num ?? '', g.approx), 'Stated as the size of one shot.'));
    }
    scan.consume(m);
  }

  // "shot size of 15 g", "dispense volume: 30 ml"
  const labelRe = new RegExp(
    String.raw`${SHOT_LABEL}\s*${LEAD_IN}\s*${BOUND_SRC}(?:${APPROX}\s*)?${NOT_MID_NUMBER}(?<num>${NUM})\s*(?<unit>${MASS_VOL_SRC})\b(?!\s*(?:\/|per)\s*${ANY_PERIOD}\b)`,
    'gi',
  );
  for (const m of scan.matches(labelRe)) {
    const g = m.groups;
    const value = parseNumber(g?.num ?? '');
    if (!g || value === null) continue;
    const bound = boundOf(scan.text, m);
    if (bound) {
      reviewBound(scan, 'production.shotSize', bound.raw, 'no single shot size was given.');
      scan.knownAs('production.shotSizeUnit', normalizeMassVol(g.unit ?? ''), g.unit ?? '', originFor(g.unit ?? '', normalizeMassVol(g.unit ?? '')));
    } else {
      emit(value, g.num ?? '', g.unit ?? '', m[0].trim(), numberNote(g.num ?? '', g.approx));
    }
    scan.consume(m);
  }

  // "we dispense 15 grams", "filling 30 ml"
  const verbRe = new RegExp(
    String.raw`${SHOT_VERB}\s+${BOUND_SRC}(?:(?:about|approximately|approx\.?|around|roughly|~)\s*)?${NOT_MID_NUMBER}(?<num>${NUM})\s*(?<unit>${MASS_VOL_SRC})\b(?!\s*(?:\/|per|a)\s*${ANY_PERIOD}\b)`,
    'gi',
  );
  for (const m of scan.matches(verbRe)) {
    const g = m.groups;
    const value = parseNumber(g?.num ?? '');
    if (!g || value === null) continue;
    const bound = boundOf(scan.text, m);
    if (bound) {
      reviewBound(scan, 'production.shotSize', bound.raw, 'no single shot size was given.');
      scan.knownAs('production.shotSizeUnit', normalizeMassVol(g.unit ?? ''), g.unit ?? '', originFor(g.unit ?? '', normalizeMassVol(g.unit ?? '')));
    } else {
      emit(value, g.num ?? '', g.unit ?? '', m[0].trim(), joinNotes(numberNote(g.num ?? '', undefined), 'Stated as the dispensed amount.'));
    }
    scan.consume(m);
  }

  // "15 g of epoxy" — quantity of material, but not explicitly per part: INFERRED, never a fact.
  const looseRe = new RegExp(
    String.raw`${NOT_MID_NUMBER}(?<num>${NUM})\s*(?<unit>${MASS_VOL_SRC})\s+of\s+(?:the\s+|our\s+)?(?:epoxy|polyurethane|urethane|silicone|resin|material|compound|potting\s+compound|mix(?:ture)?)\b`,
    'gi',
  );
  for (const m of scan.matches(looseRe)) {
    const g = m.groups;
    const value = parseNumber(g?.num ?? '');
    if (!g || value === null) continue;
    emit(
      value,
      g.num ?? '',
      g.unit ?? '',
      m[0].trim(),
      "Quantity stated without 'per part' — confirm this is the amount dispensed per part or shot.",
      true,
    );
    scan.consume(m);
  }
};

// ---- production rate -----------------------------------------------------------------------

const BLOCKED_NOUN_TOKENS = new Set([
  ...PRODUCTION_NOUN_UNITS,
  'at', 'and', 'to', 'of', 'for', 'or', 'with', 'than', 'is', 'are', 'by', 'every', 'each',
  'second', 'seconds', 'sec', 'secs', 'minute', 'minutes', 'min', 'mins', 'hour', 'hours', 'hr', 'hrs',
  'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years', 'shift', 'shifts',
  'cp', 'cps', 'mm', 'cm', 'psi', 'bar',
]);

function nounIsPlausible(noun: string): boolean {
  const tokens = noun.toLowerCase().split(/[\s]+/).filter(Boolean);
  return tokens.every((t) => !BLOCKED_NOUN_TOKENS.has(t));
}

function periodUnit(period: string): string {
  return `parts/${normalizePeriod(period)}`;
}

export const productionRateRule: Rule = (scan) => {
  // Range: "400-600 parts per hour"
  const rangeRe = new RegExp(
    String.raw`${RANGE_LEAD}${NOT_MID_NUMBER}(?<n1>${NUM})${RANGE_SEP}(?<n2>${NUM})\s*(?<noun>(?:[a-z][a-z\-]*\s*){1,4}?)(?:\/|\b(?:per|an?|each)\b)\s*(?<period>${PERIOD_SRC})\b`,
    'gi',
  );
  for (const m of scan.matches(rangeRe)) {
    const g = m.groups;
    if (!g || !nounIsPlausible(g.noun ?? '')) continue;
    const unit = periodUnit(g.period ?? '');
    scan.review('production.productionRate', null, m[0].trim(), `Range stated (${g.n1}–${g.n2} ${unit}); no single rate was given.`);
    scan.knownAs('production.productionUnit', unit, m[0].trim(), 'NORMALIZED');
    scan.consume(m);
  }

  // "500 parts per hour", "500 electronic modules per hour", "2,000 parts per week", "100k units/year"
  const re = new RegExp(
    String.raw`${BOUND_SRC}${NOT_MID_NUMBER}(?<num>${NUM})\s*(?<k>k\b)?\s*(?<noun>(?:[a-z][a-z\-]*\s*){1,4}?)(?:\/|\b(?:per|an?|each)\b)\s*(?<period>${PERIOD_SRC})\b`,
    'gi',
  );
  for (const m of scan.matches(re)) {
    const g = m.groups;
    let value = parseNumber(g?.num ?? '');
    if (!g || value === null || !nounIsPlausible(g.noun ?? '')) continue;
    const thousands = Boolean(g.k);
    if (thousands) value *= 1000;
    const unit = periodUnit(g.period ?? '');
    const typedUnit = `${(g.noun ?? '').trim()}/${(g.period ?? '').trim()}`;
    const bound = boundOf(scan.text, m);
    if (bound) {
      reviewBound(scan, 'production.productionRate', bound.raw, 'no single production rate was given.');
    } else {
      scan.known('production.productionRate', value, m[0].trim(), {
        typed: thousands ? `${g.num}k` : g.num,
        note: joinNotes(
          scan.approximateBefore(m.index) ? APPROXIMATE_NOTE : undefined,
          decimalCommaNote(g.num ?? ''),
          thousands ? `"${g.num}k" read as ${value}.` : undefined,
        ),
      });
    }
    scan.knownAs('production.productionUnit', unit, typedUnit, originFor(typedUnit, unit));
    scan.consume(m);
  }

  // "annual volume of 100,000", "weekly production 2000 parts"
  const volumeRe = new RegExp(
    String.raw`(?<span>annual|yearly|monthly|weekly|daily|hourly)\s+(?:volume|production|output|demand|quantity|rate)\s*${LEAD_IN}\s*${NOT_MID_NUMBER}(?<num>${NUM})\s*(?<k>k\b)?`,
    'gi',
  );
  const spanToPeriod: Record<string, string> = { annual: 'year', yearly: 'year', monthly: 'month', weekly: 'week', daily: 'day', hourly: 'hour' };
  for (const m of scan.matches(volumeRe)) {
    const g = m.groups;
    let value = parseNumber(g?.num ?? '');
    if (!g || value === null) continue;
    if (g.k) value *= 1000;
    const unit = `parts/${spanToPeriod[(g.span ?? '').toLowerCase()] ?? 'year'}`;
    scan.knownAs('production.productionRate', value, m[0].trim(), 'NORMALIZED');
    scan.knownAs('production.productionUnit', unit, m[0].trim(), 'NORMALIZED');
    scan.consume(m);
  }

  // "500 per hour" with no noun: the number is stated, what is counted is not -> INFERRED.
  const bareRe = new RegExp(String.raw`${NOT_MID_NUMBER}(?<num>${NUM})\s*(?:\/|per)\s*(?<period>${PERIOD_SRC})\b`, 'gi');
  for (const m of scan.matches(bareRe)) {
    const g = m.groups;
    const value = parseNumber(g?.num ?? '');
    if (!g || value === null) continue;
    const before = scan.text.slice(Math.max(0, m.index - 40), m.index);
    if (!/(?:produc|mak(?:e|ing)|run|process|build|need|require|want|target|output|throughput|volume)\w*[^.]{0,30}$/i.test(before)) continue;
    const unit = periodUnit(g.period ?? '');
    scan.inferred('production.productionRate', value, m[0].trim(), 'Number stated without saying what is counted; assumed to be parts — confirm.');
    scan.values.push({
      fieldId: 'production.productionUnit',
      value: unit,
      status: 'INFERRED',
      origin: 'INFERRED',
      raw: m[0].trim(),
      note: 'Unit noun assumed to be "parts".',
    });
    scan.consume(m);
  }
};

// ---- cycle time ----------------------------------------------------------------------------

export const cycleTimeRule: Rule = (scan) => {
  const emit = (num: string, unitToken: string, raw: string, extraNote?: string): void => {
    const value = parseNumber(num);
    if (value === null) return;
    const unit = normalizeTimeShort(unitToken) === 's' ? 's' : 'min';
    scan.known('production.cycleTime', value, raw, { typed: num, note: joinNotes(decimalCommaNote(num), extraNote) });
    scan.knownAs('production.cycleTimeUnit', unit, unitToken, originFor(unitToken, unit));
  };

  const cycleRe = new RegExp(
    String.raw`cycle\s*time\s*${LEAD_IN}\s*${NOT_MID_NUMBER}(?<num>${NUM})\s*(?<unit>seconds?|secs?|s|minutes?|mins?)\b`,
    'gi',
  );
  for (const m of scan.matches(cycleRe)) {
    emit(m.groups?.num ?? '', m.groups?.unit ?? '', m[0].trim());
    scan.consume(m);
  }

  const everyRe = new RegExp(
    String.raw`(?:one|1|a)\s+(?:part|unit|module|piece|shot|board|housing|assembly)\s+(?:every|each)\s+${NOT_MID_NUMBER}(?<num>${NUM})\s*(?<unit>seconds?|secs?|s|minutes?|mins?)\b`,
    'gi',
  );
  for (const m of scan.matches(everyRe)) {
    emit(m.groups?.num ?? '', m.groups?.unit ?? '', m[0].trim(), 'Stated as one part every N time units.');
    scan.consume(m);
  }
};
