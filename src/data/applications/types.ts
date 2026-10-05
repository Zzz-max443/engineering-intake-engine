import type { ApplicationBrief, FieldId, Priority } from '../../models/types.ts';

/** A value that is either fixed or computed from what is already known about the brief. */
export type Dynamic<T> = T | ((brief: ApplicationBrief) => T);

/** How an application profile treats one field. */
export interface FieldRule {
  /** Importance of the field. Can depend on the brief (not everything is required for every case). */
  priority: Dynamic<Priority>;
  /** When false the field does not apply to this case and is neither asked nor counted. Default: true. */
  applicable?: (brief: ApplicationBrief) => boolean;
  /**
   * Whether the engine may ask for this field. Default: true unless the field is derived
   * or has ENGINEER_REVIEW priority. Capture-only fields are filled only when the user mentions them.
   */
  askable?: Dynamic<boolean>;
  /** Filled by the system (never asked, never counted in completeness). */
  derived?: boolean;
}

export interface ScopeRules {
  /** Words that confirm the description is about this application. */
  inScope: RegExp;
  /** Sub-category detectors, checked in order; several may match. */
  subcategories: { label: string; pattern: RegExp }[];
  /** Words that suggest a DIFFERENT application (not supported in this version). */
  otherApplication: RegExp;
}

/**
 * An application profile is the only place that knows what matters for one kind of application.
 * v0.1 ships a single profile (Potting & Encapsulation); see README to add more.
 */
export interface ApplicationProfile {
  id: string;
  /** Display name, also stored as application.category. */
  name: string;
  scope: ScopeRules;
  rules: Partial<Record<FieldId, FieldRule>>;
  /** Order in which askable fields are asked inside each priority tier. */
  questionOrder: FieldId[];
}
