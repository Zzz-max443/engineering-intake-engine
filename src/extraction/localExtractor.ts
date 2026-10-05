import { normalizeInput } from '../utils/text.ts';
import { Scan } from './scan.ts';
import { automationRule } from './rules/automation.ts';
import { environmentRule, materialFlagsRule } from './rules/flags.ts';
import { chemistryRule, componentCountRule, materialNameRule, ratioRule } from './rules/material.ts';
import { partRule } from './rules/part.ts';
import { cycleTimeRule, flowRateRule, productionRateRule, shotSizeRule } from './rules/quantities.ts';
import { scopeRule } from './rules/scope.ts';
import { temperatureRule } from './rules/temperature.ts';
import type { Rule } from './rules/types.ts';
import { declaredUnknownRule } from './rules/unknowns.ts';
import { viscosityRule } from './rules/viscosity.ts';
import type { ExtractedValue, ExtractionInput, ExtractionResult, Extractor } from './types.ts';

/**
 * Rules run in this order. Order matters: a rule "consumes" the text it reads, so stronger,
 * more specific patterns (ratio, flow rate, shot size) go before weaker ones (production rate).
 * To add a rule: write a `Rule` function, then insert it here.
 */
export const RULES: Rule[] = [
  scopeRule,
  declaredUnknownRule,
  componentCountRule,
  chemistryRule,
  ratioRule,
  flowRateRule,
  shotSizeRule,
  productionRateRule,
  cycleTimeRule,
  viscosityRule,
  temperatureRule,
  automationRule,
  materialFlagsRule,
  environmentRule,
  partRule,
  materialNameRule,
];

function dedupe(values: ExtractedValue[]): ExtractedValue[] {
  const seen = new Set<string>();
  const out: ExtractedValue[] = [];
  for (const v of values) {
    const key = `${v.fieldId}|${String(v.value)}|${v.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Local, rule-based, synchronous extraction. No network, no model. */
export function extractWithRules(input: ExtractionInput): ExtractionResult {
  const scan = new Scan(normalizeInput(input.text));
  const ctx = input.expecting ? { profile: input.profile, expecting: input.expecting } : { profile: input.profile };
  for (const rule of RULES) rule(scan, ctx);
  return {
    values: dedupe(scan.values),
    signals: Array.from(scan.signals),
    capturedNotes: scan.capturedNotes,
  };
}

export const localExtractor: Extractor = {
  name: 'local-rules-v0.1',
  extract: extractWithRules,
};
