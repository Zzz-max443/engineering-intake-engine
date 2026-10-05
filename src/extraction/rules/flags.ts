import type { Rule } from './types.ts';

/** Material flags: filled / abrasive / thixotropic. The tool never judges them; it only records. */
export const materialFlagsRule: Rule = (scan) => {
  // "unfilled", "non-filled", "not filled"
  const unfilled = /\b(?:unfilled|non[\s-]filled)\b/gi;
  for (const m of scan.matches(unfilled)) {
    scan.knownAs('properties.filled', false, m[0], 'NORMALIZED');
    scan.consume(m);
  }

  // "filled" alone is too ambiguous ("modules are filled with epoxy"), so require material wording.
  const filled = [
    /\b(?:glass|mineral|ceramic|silica|alumina|talc|carbon|metal|aluminum|aluminium|silver|thermally[\s-]conductive)[\s-]filled\b/gi,
    /\bfilled\s+(?:epoxy|resin|material|compound|silicone|polyurethane|urethane|system)\b/gi,
    /\bfillers?\b/gi,
    /\b(?:alumina|silica|boron\s+nitride)\b/gi,
    /\bglass\s+(?:fib(?:er|re)s?|beads?)\b/gi,
  ];
  for (const re of filled) {
    for (const m of scan.matches(re)) {
      scan.knownAs('properties.filled', !scan.negatedBefore(m.index), m[0], 'NORMALIZED');
      scan.consume(m);
    }
  }

  const abrasive = /\b(?:non[\s-])?abrasive\b/gi;
  for (const m of scan.matches(abrasive)) {
    const negated = /^non/i.test(m[0]) || scan.negatedBefore(m.index);
    if (negated) scan.knownAs('properties.abrasive', false, m[0], 'NORMALIZED');
    else scan.review('properties.abrasive', true, m[0], 'Abrasive material mentioned — wear and compatibility implications are for the engineer to assess.');
    scan.consume(m);
  }

  const thixotropic = /\b(?:non[\s-])?(?:thixotropic|thixo)\b|\bshear[\s-]thinning\b/gi;
  for (const m of scan.matches(thixotropic)) {
    const negated = /^non/i.test(m[0]) || scan.negatedBefore(m.index);
    if (negated) scan.knownAs('properties.thixotropic', false, m[0], 'NORMALIZED');
    else scan.review('properties.thixotropic', true, m[0], 'Thixotropic / shear-thinning behaviour mentioned — for the engineer to assess.');
    scan.consume(m);
  }
};

const ENVIRONMENT_VOCABULARY: Array<[RegExp, string]> = [
  [/\bclean[\s-]?room\b/i, 'Cleanroom'],
  [/\b(?:factory|shop|plant|production|manufacturing)\s+floor\b/i, 'Factory floor'],
  [/\blab(?:oratory)?\b/i, 'Laboratory'],
  [/\boutdoors?\b/i, 'Outdoor'],
  [/\bhumid(?:ity)?\b/i, 'Humid'],
  [/\bdust(?:y)?\b/i, 'Dusty'],
  [/\bwash[\s-]?down\b/i, 'Wash-down'],
  [/\besd\b/i, 'ESD-controlled area'],
  [/\bvibrat(?:ion|ing)\b/i, 'Vibration'],
];

/** Operating environment (descriptive text) and hazardous-environment flag. */
export const environmentRule: Rule = (scan) => {
  const labels: string[] = [];
  const evidence: string[] = [];
  for (const [re, label] of ENVIRONMENT_VOCABULARY) {
    const m = scan.matches(re)[0];
    if (!m || scan.negatedBefore(m.index) || labels.includes(label)) continue;
    labels.push(label);
    evidence.push(m[0]);
  }
  if (labels.length > 0) scan.knownAs('environment.operatingEnvironment', labels.join('; '), evidence.join(', '), 'NORMALIZED');

  const hazardous =
    /\b(?:non[\s-])?(?:atex|iecex|explosi(?:on|ve)[\s-]?(?:proof|atmosphere|area)?|hazardous|flammable|classified\s+area|solvent\s+atmosphere)\b|\bclass\s+i{1,3}\s+div(?:ision)?\s*[12]\b|\bzone\s*[012]\b/gi;
  for (const m of scan.matches(hazardous)) {
    const negated = /^non/i.test(m[0]) || scan.negatedBefore(m.index);
    if (negated) scan.knownAs('environment.hazardousEnvironment', false, m[0], 'NORMALIZED');
    else {
      scan.review(
        'environment.hazardousEnvironment',
        true,
        m[0],
        'Hazardous or classified environment mentioned. No safety classification was assessed by this tool; engineer review required.',
      );
    }
    scan.consume(m);
  }
};
