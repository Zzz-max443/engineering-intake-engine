import { decimalCommaNote, NUM, parseNumber } from '../../utils/text.ts';
import { originFor } from '../scan.ts';
import type { Scan } from '../scan.ts';
import { normalizeTempUnit, TEMP_UNIT_SRC } from '../units.ts';
import { SIGNALS } from '../types.ts';
import type { Rule } from './types.ts';
import type { FieldId } from '../../models/types.ts';

const LEAD_IN = String.raw`(?:of|is|:|=|around|about|approximately|approx\.?|~)?`;
const NUMBER_WITH_SIGN = String.raw`(?<![\d.,])(?<sign>-)?(?<num>${NUM})\s*(?<unit>${TEMP_UNIT_SRC})`;

function emit(scan: Scan, m: RegExpExecArray, valueId: FieldId, unitId: FieldId): void {
  const g = m.groups;
  const parsed = parseNumber(g?.num ?? '');
  if (!g || parsed === null) return;
  const value = g.sign ? -parsed : parsed;
  const unit = normalizeTempUnit(g.unit ?? '');
  scan.known(valueId, value, m[0].trim(), { typed: `${g.sign ?? ''}${g.num}`, note: decimalCommaNote(g.num ?? '') });
  scan.knownAs(unitId, unit, g.unit ?? '', originFor(g.unit ?? '', unit));
  scan.consume(m);
}

/**
 * Temperatures are only read when the text says WHICH temperature it is:
 * material/process, ambient/operating, or cure. A bare "80 C" is ignored on purpose.
 */
export const temperatureRule: Rule = (scan) => {
  // Cure temperature has no field in v0.1 -> passed to the engineer as a verbatim note.
  const cure = new RegExp(String.raw`cure[sd]?\s*(?:at|temperature|temp|to)?\s*${LEAD_IN}\s*${NUMBER_WITH_SIGN}`, 'gi');
  for (const m of scan.matches(cure)) {
    scan.capture(`Cure temperature mentioned: "${m[0].trim()}" (not mapped to a field in v0.1).`);
    scan.consume(m);
  }

  const operating = new RegExp(
    String.raw`(?:ambient|operating|environment(?:al)?|room|shop|plant|cleanroom|workshop)\s*temp(?:erature)?\s*${LEAD_IN}\s*${NUMBER_WITH_SIGN}`,
    'gi',
  );
  for (const m of scan.matches(operating)) emit(scan, m, 'environment.operatingTemperature', 'environment.operatingTemperatureUnit');

  const materialLabel = new RegExp(
    String.raw`(?:material|resin|epoxy|polyurethane|silicone|compound|mix(?:ture)?|product|fluid|process|dispens(?:e|ing))\s*temp(?:erature)?\s*${LEAD_IN}\s*${NUMBER_WITH_SIGN}`,
    'gi',
  );
  for (const m of scan.matches(materialLabel)) emit(scan, m, 'properties.temperature', 'properties.temperatureUnit');

  const heated = new RegExp(
    String.raw`(?:heated|preheat(?:ed)?|warm(?:ed)?|dispens(?:e|ed|ing))\s+(?:the\s+)?(?:material\s+|resin\s+|epoxy\s+|compound\s+)?(?:to|at)\s*${NUMBER_WITH_SIGN}`,
    'gi',
  );
  for (const m of scan.matches(heated)) emit(scan, m, 'properties.temperature', 'properties.temperatureUnit');

  // Conditional relevance: only dispensing-related heat words turn the temperature question on.
  if (/\b(?:heated|heating|preheat\w*|warmed|hot\b|temperature[\s-]controlled|(?:material|process|dispens\w*|resin|mix\w*)\s+temp\w*)\b/i.test(scan.text)) {
    scan.signal(SIGNALS.MENTIONS_TEMPERATURE);
  }
};
