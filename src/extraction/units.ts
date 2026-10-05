/**
 * Unit vocabularies. Units are only ever NORMALIZED in spelling (grams -> g);
 * values are never converted between unit systems.
 */

/** Mass / volume units as people write them (shot size, flow rate). */
export const MASS_VOL_SRC =
  String.raw`(?:cc|cm3|cm³|ml|milliliters?|millilitres?|fl\.?\s*oz|fluid\s+ounces?|lit(?:er|re)s?|l|gal(?:lons?)?|kg|kilograms?|grams?|gr|g|lbs?|pounds?|oz|ounces?|in3|in³)`;

export function normalizeMassVol(token: string): string {
  const t = token.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (t === 'cc') return 'cc';
  if (t === 'cm3' || t === 'cm³') return 'cm³';
  if (t === 'ml' || t.startsWith('millil')) return 'ml';
  if (t === 'fl oz' || t === 'floz' || t.startsWith('fluid')) return 'fl oz';
  if (t === 'l' || t.startsWith('lit')) return 'L';
  if (t.startsWith('gal')) return 'gal';
  if (t === 'kg' || t.startsWith('kilo')) return 'kg';
  if (t === 'g' || t === 'gr' || t.startsWith('gram')) return 'g';
  if (t === 'lb' || t === 'lbs' || t.startsWith('pound')) return 'lb';
  if (t === 'oz' || t.startsWith('ounce')) return 'oz';
  if (t === 'in3' || t === 'in³') return 'in³';
  return token.trim();
}

/** Short time units used with flow rates and cycle times. */
export const TIME_SHORT_SRC = String.raw`(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|s|h)`;

export function normalizeTimeShort(token: string): 's' | 'min' | 'h' {
  const t = token.toLowerCase();
  if (t.startsWith('sec') || t === 's') return 's';
  if (t.startsWith('min')) return 'min';
  return 'h';
}

/** Periods used with production rates. */
export const PERIOD_SRC = String.raw`(?:hour|hr|h|minute|min|day|shift|week|wk|month|year|yr|annum)`;

export function normalizePeriod(token: string): string {
  const t = token.toLowerCase();
  if (t === 'hour' || t === 'hr' || t === 'h') return 'hour';
  if (t === 'minute' || t === 'min') return 'minute';
  if (t === 'wk') return 'week';
  if (t === 'yr' || t === 'annum') return 'year';
  return t; // day, shift, week, month, year
}

/** Viscosity units. */
export const VISCOSITY_UNIT_SRC =
  String.raw`(?:cps|cp|centipoises?|mpa\s*[·.*-]?\s*s|mpas|pa\s*[·.*-]?\s*s|poises?)`;

export function normalizeViscosityUnit(token: string): string {
  const t = token.toLowerCase().replace(/[\s·.*-]/g, '');
  if (t === 'cps' || t === 'cp' || t.startsWith('centipoise')) return 'cP';
  if (t === 'mpas') return 'mPa·s';
  if (t === 'pas') return 'Pa·s';
  if (t.startsWith('poise')) return 'P';
  return token.trim();
}

/** Temperature scale: "°C", "deg F", "celsius", or a bare C/F glued to the number ("60C"). Non-capturing. */
export const TEMP_UNIT_SRC =
  String.raw`(?:(?:°|º|deg(?:rees?)?\.?)\s*(?:celsius|fahrenheit|kelvin|[CFK])\b|\b(?:celsius|fahrenheit)\b|(?<=\d)\s?[CF]\b)`;

/** Read the scale out of matched unit text ("° C", "degrees fahrenheit", "60 F"). */
export function normalizeTempUnit(unitText: string): string {
  const m = /celsius|fahrenheit|kelvin|[CFK]/i.exec(unitText);
  const t = (m?.[0] ?? '').toUpperCase();
  if (t === 'C' || t === 'CELSIUS') return '°C';
  if (t === 'F' || t === 'FAHRENHEIT') return '°F';
  return 'K';
}

/** Generic singular nouns for things that are produced; used for production-rate wording. */
export const PRODUCTION_NOUN_UNITS = new Set(['g', 'kg', 'oz', 'lb', 'cc', 'ml', 'l', 'gal', 'gr', 'gram', 'grams', 'liter', 'liters', 'litre', 'litres']);
