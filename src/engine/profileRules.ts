import type { ApplicationProfile, Dynamic } from '../data/applications/types.ts';
import type { ApplicationBrief, FieldId, Priority } from '../models/types.ts';

function resolve<T>(value: Dynamic<T>, brief: ApplicationBrief): T {
  return typeof value === 'function' ? (value as (b: ApplicationBrief) => T)(brief) : value;
}

/** Does the field apply to this case at all? (e.g. no ratio for a single-component material) */
export function isApplicable(profile: ApplicationProfile, brief: ApplicationBrief, id: FieldId): boolean {
  const rule = profile.rules[id];
  if (!rule) return false;
  return rule.applicable ? rule.applicable(brief) : true;
}

/** Importance of the field for THIS brief, or null when it does not apply. */
export function getPriority(profile: ApplicationProfile, brief: ApplicationBrief, id: FieldId): Priority | null {
  const rule = profile.rules[id];
  if (!rule || !isApplicable(profile, brief, id)) return null;
  return resolve(rule.priority, brief);
}

/** Filled by the system, never asked and never counted. */
export function isDerivedField(profile: ApplicationProfile, id: FieldId): boolean {
  return profile.rules[id]?.derived === true;
}

/** May the engine ask the user about this field right now? */
export function isAskable(profile: ApplicationProfile, brief: ApplicationBrief, id: FieldId): boolean {
  const rule = profile.rules[id];
  if (!rule || rule.derived || !isApplicable(profile, brief, id)) return false;
  if (resolve(rule.priority, brief) === 'ENGINEER_REVIEW') return false;
  return rule.askable === undefined ? true : resolve(rule.askable, brief);
}
