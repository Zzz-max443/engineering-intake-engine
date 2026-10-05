import { capitalize, collapseWhitespace, stripTrailingPunctuation } from '../../utils/text.ts';
import type { Rule } from './types.ts';

/**
 * Automation level, robotic handling, conveyor, existing automation/equipment.
 * Negations ("not automated", "no robot", "without a conveyor") are respected.
 */
export const automationRule: Rule = (scan) => {
  // Semi-automatic first, so "semi-automatic" is never read as "automatic".
  const semi = /\b(?:semi[\s-]?automat(?:ic|ed)|partially\s+automated|half[\s-]automated)\b/gi;
  for (const m of scan.matches(semi)) {
    scan.knownAs('automation.automationLevel', 'Semi-automatic', m[0], 'NORMALIZED');
    scan.consume(m);
  }

  const automated = /\b(?:fully[\s-]+)?automat(?:ed|ic|ically)\b|\bautomation\b/gi;
  for (const m of scan.matches(automated)) {
    if (scan.negatedBefore(m.index)) {
      scan.inferred(
        'automation.automationLevel',
        'Manual',
        m[0],
        `Inferred from a negation ("${scan.phraseBefore(m.index, m.index + m[0].length)}"); may be partly automated — confirm.`,
      );
    } else {
      const raw = m[0];
      const exact = /^automated$/i.test(raw);
      scan.knownAs('automation.automationLevel', 'Automated', raw, exact ? 'USER_STATED' : 'NORMALIZED');
    }
    scan.consume(m);
  }

  // "we want to automate ..." is a wish, not a statement of the current level.
  const automate = /\bautomat(?:e|ing)\b/gi;
  for (const m of scan.matches(automate)) {
    if (scan.negatedBefore(m.index)) continue;
    scan.inferred('automation.automationLevel', 'Automated', m[0], `Inferred from "${m[0]}"; confirm the intended automation level.`);
    scan.consume(m);
  }

  const manual = /\b(?:manual(?:ly)?|by\s+hand|hand[\s-]?(?:held|dispens\w*|poured?|mix\w*|operated)|operator[\s-]operated)\b/gi;
  for (const m of scan.matches(manual)) {
    if (scan.negatedBefore(m.index)) continue;
    scan.knownAs('automation.automationLevel', 'Manual', m[0], /^manual$/i.test(m[0]) ? 'USER_STATED' : 'NORMALIZED');
    scan.consume(m);
  }

  const robot = /\b(?:robot(?:ic|s)?|robot\s*arm|cobots?|collaborative\s+robots?|scara)\b/gi;
  for (const m of scan.matches(robot)) {
    scan.knownAs('automation.robotic', !scan.negatedBefore(m.index), m[0], 'NORMALIZED');
    scan.consume(m);
  }

  const conveyor = /\b(?:conveyors?|conveyer|belt\s+line)\b/gi;
  for (const m of scan.matches(conveyor)) {
    scan.knownAs('automation.conveyor', !scan.negatedBefore(m.index), m[0], 'NORMALIZED');
    scan.consume(m);
  }

  // "existing robot cell", "existing mixer" — user's own words, split by what they describe.
  const existing = /\bexisting\s+(?<np>[a-z0-9][a-z0-9\-/ ]{2,60}?)(?=\s+(?:and|but|with|that|which|we|to|for|from|so)\b|[.,;:!?]|$)/gi;
  for (const m of scan.matches(existing)) {
    const np = collapseWhitespace(m.groups?.np ?? '');
    if (!np) continue;
    const text = capitalize(`existing ${stripTrailingPunctuation(np)}`);
    const isAutomation = /\b(?:robot|robots|conveyor|line|cell|plc|automation|fixture|station|gantry|cobot|handling|indexing|rotary)\b/i.test(np);
    scan.knownAs(isAutomation ? 'automation.existingAutomation' : 'integration.existingEquipment', text, m[0].trim(), 'USER_STATED');
    scan.consume(m);
  }

  // Integration wording, kept verbatim.
  const integrate =
    /\b(?:integrat(?:e|ed|es|ion|ing)|interface|interfacing|connect(?:ed|ing)?|communicat(?:e|es|ion|ing))\s+(?:with|to|into)\s+[^.;:!?]{3,80}?(?=[.;:!?]|$|\s+(?:but)\b)/gi;
  for (const m of scan.matches(integrate)) {
    scan.knownAs('integration.integrationRequirements', capitalize(collapseWhitespace(m[0])), m[0].trim(), 'USER_STATED');
    scan.consume(m);
  }

  const protocols = Array.from(
    new Set(
      Array.from(
        scan.text.matchAll(/\b(PLC|Profinet|Profibus|EtherNet\/IP|Ethernet\/IP|Modbus|OPC[\s-]?UA|EtherCAT|CC-Link|digital\s+I\/O)\b/gi),
        (m) => m[1] ?? '',
      ).filter(Boolean),
    ),
  );
  if (protocols.length > 0 && !scan.values.some((v) => v.fieldId === 'integration.integrationRequirements')) {
    scan.knownAs('integration.integrationRequirements', `Mentioned: ${protocols.join(', ')}`, protocols.join(', '), 'NORMALIZED');
  }
};
