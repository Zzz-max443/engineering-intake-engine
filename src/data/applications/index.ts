import { POTTING_PROFILE } from './potting.ts';
import type { ApplicationProfile } from './types.ts';

export type { ApplicationProfile, FieldRule, ScopeRules } from './types.ts';
export { POTTING_PROFILE } from './potting.ts';

/** Registry of application profiles. v0.1 supports exactly one. */
export const APPLICATION_PROFILES: Record<string, ApplicationProfile> = {
  [POTTING_PROFILE.id]: POTTING_PROFILE,
};

export const DEFAULT_PROFILE: ApplicationProfile = POTTING_PROFILE;
