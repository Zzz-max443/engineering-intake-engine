import type { FieldId } from '../../models/types.ts';
import type { ApplicationProfile } from '../../data/applications/types.ts';
import type { Scan } from '../scan.ts';

export interface RuleContext {
  profile: ApplicationProfile;
  /** Set when the text is the answer to a question about one specific field. */
  expecting?: FieldId;
}

/** An extraction rule reads the scan's text and reports what it finds. */
export type Rule = (scan: Scan, ctx: RuleContext) => void;
