import type { Rule } from './types.ts';

/**
 * Application scope: does the description talk about this application (potting & encapsulation)?
 *  - yes            -> category KNOWN
 *  - another app    -> category flagged for engineer review
 *  - nothing at all -> category INFERRED from the tool scope (never presented as a fact)
 * Skipped for answers to questions; scope is judged on free-text descriptions only.
 */
export const scopeRule: Rule = (scan, ctx) => {
  if (ctx.expecting) return;
  const { scope, name } = ctx.profile;

  const inScope = scan.matches(scope.inScope)[0];
  const other = scan.matches(scope.otherApplication)[0];

  if (inScope) {
    scan.knownAs('application.category', name, inScope[0], 'NORMALIZED');
    const subs = scope.subcategories
      .map((s) => ({ label: s.label, hit: scan.matches(s.pattern)[0] }))
      .filter((s) => s.hit);
    if (subs.length > 0) {
      scan.knownAs(
        'application.subcategory',
        subs.map((s) => s.label).join(' / '),
        subs.map((s) => s.hit![0]).join(' / '),
        'NORMALIZED',
      );
    }
    if (other) {
      scan.capture(
        `Description also mentions "${other[0]}", which may indicate another application — confirm the process is ${name.toLowerCase()}.`,
      );
    }
    return;
  }

  if (other) {
    scan.signal('OTHER_APPLICATION');
    scan.review(
      'application.category',
      name,
      other[0],
      `Description mentions "${other[0]}", which may belong to a different application. This prototype only supports ${name}.`,
    );
    return;
  }

  scan.inferred(
    'application.category',
    name,
    '',
    `Not stated by the user — assumed from the tool scope (v0.1 supports ${name} only).`,
  );
};
