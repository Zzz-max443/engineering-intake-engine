import { DEFAULT_PROFILE } from '../data/applications/index.ts';
import type { ApplicationProfile } from '../data/applications/types.ts';
import { FIELD_DEFS, GROUP_LABELS } from '../data/fields.ts';
import type { GroupId } from '../data/fields.ts';
import { SAFETY_NOTICE } from '../data/products.ts';
import { calculateCompleteness } from '../engine/completeness.ts';
import type { CompletenessReport } from '../engine/completeness.ts';
import { fieldViewStatus } from '../engine/viewStatus.ts';
import { describeProvenance, formatFieldValue, formatMaterial } from '../engine/format.ts';
import { getPriority } from '../engine/profileRules.ts';
import { computeReviewFlags, ENGINEER_REVIEW_STATEMENT } from '../engine/review.ts';
import type { ReviewFlag } from '../engine/review.ts';
import { getField, hasValue, numberOf, stringOf } from '../models/brief.ts';
import type { ApplicationBrief, FieldId, FieldStatus } from '../models/types.ts';
import { getPlatformContext } from './platformContext.ts';
import type { PlatformContext } from './platformContext.ts';

/** The four data states plus two presentation-only states. */
export type ViewStatus = FieldStatus | 'PARTIAL' | 'NOT_APPLICABLE';

export interface BriefRow {
  id: string;
  label: string;
  value: string;
  status: ViewStatus;
  /** Secondary line: where the value came from or why it is flagged. */
  detail?: string;
  /** Child rows (e.g. the viscosity of each component). */
  children?: BriefRow[];
}

export interface FieldTableRow {
  fieldId: FieldId;
  group: GroupId;
  groupLabel: string;
  label: string;
  value: string;
  status: FieldStatus;
  provenance: string;
}

export interface EngineeringBriefView {
  title: 'ENGINEERING BRIEF';
  rows: BriefRow[];
  fieldTable: FieldTableRow[];
  completeness: CompletenessReport;
  reviewFlags: ReviewFlag[];
  engineerReview: { required: true; label: 'Required'; statement: string };
  platformContext: PlatformContext;
  disclaimer: string;
}

const UNKNOWN_LABEL = 'Unknown';

export { fieldViewStatus };

/** One row summarising several fields: worst concern wins; a mix of known and unknown is PARTIAL. */
export function aggregateStatus(brief: ApplicationBrief, ids: FieldId[]): ViewStatus {
  const statuses = ids.map((id) => fieldViewStatus(brief, id));
  if (statuses.includes('REQUIRES_ENGINEER_REVIEW')) return 'REQUIRES_ENGINEER_REVIEW';
  if (statuses.every((s) => s === 'KNOWN')) return 'KNOWN';
  if (statuses.every((s) => s === 'UNKNOWN')) return 'UNKNOWN';
  if (statuses.includes('UNKNOWN')) return 'PARTIAL';
  return 'INFERRED';
}

function detailFor(brief: ApplicationBrief, ids: FieldId[]): string | undefined {
  for (const id of ids) {
    const view = fieldViewStatus(brief, id);
    if (view === 'REQUIRES_ENGINEER_REVIEW' || view === 'INFERRED') return describeProvenance(brief, id);
  }
  return undefined;
}

/** Applicable to this brief, or the user stated it anyway (a stated value is never hidden). */
function shown(brief: ApplicationBrief, profile: ApplicationProfile, id: FieldId): boolean {
  return getPriority(profile, brief, id) !== null || hasValue(getField(brief, id));
}

function row(brief: ApplicationBrief, id: string, label: string, value: string, ids: FieldId[], extra: Partial<BriefRow> = {}): BriefRow {
  const detail = detailFor(brief, ids);
  return { id, label, value, status: aggregateStatus(brief, ids), ...(detail ? { detail } : {}), ...extra };
}

function viscosityRows(brief: ApplicationBrief, profile: ApplicationProfile): BriefRow[] {
  const count = numberOf(brief, 'material.componentCount');
  const parts: Array<{ id: FieldId; label: string }> = [
    { id: 'properties.viscosityA', label: count === 1 ? 'Material' : 'Component A' },
    { id: 'properties.viscosityB', label: 'Component B' },
    { id: 'properties.viscosityC', label: 'Component C' },
  ];
  return parts
    .filter((p) => shown(brief, profile, p.id))
    .map((p) => {
      const unit: FieldId = 'properties.viscosityUnit';
      const field = getField(brief, p.id);
      const ids: FieldId[] = hasValue(field) ? [p.id, unit] : [p.id];
      return row(brief, p.id, p.label, formatFieldValue(brief, p.id, UNKNOWN_LABEL), ids);
    });
}

function automationValue(brief: ApplicationBrief): string {
  const level = stringOf(brief, 'automation.automationLevel');
  const extras: string[] = [];
  if (getField(brief, 'automation.robotic').value === true) extras.push('robotic handling');
  if (getField(brief, 'automation.conveyor').value === true) extras.push('conveyor');
  if (!level && extras.length === 0) return UNKNOWN_LABEL;
  return [level ?? 'Level not stated', ...extras].join(' · ');
}

function quantityRow(brief: ApplicationBrief, id: string, label: string, valueId: FieldId, unitId: FieldId): BriefRow {
  const hasNumber = hasValue(getField(brief, valueId));
  return row(brief, id, label, formatFieldValue(brief, valueId, UNKNOWN_LABEL), hasNumber ? [valueId, unitId] : [valueId]);
}

function summaryRows(brief: ApplicationBrief, profile: ApplicationProfile): BriefRow[] {
  const rows: BriefRow[] = [];

  const category = stringOf(brief, 'application.category');
  const sub = stringOf(brief, 'application.subcategory');
  rows.push(
    row(brief, 'application', 'Application', category ? (sub ? `${category} (${sub})` : category) : UNKNOWN_LABEL, ['application.category']),
  );

  const materialIds: FieldId[] = ['material.componentCount', 'material.chemistry'];
  rows.push(row(brief, 'material', 'Material', formatMaterial(brief, UNKNOWN_LABEL), materialIds));

  if (!shown(brief, profile, 'mixing.ratio')) {
    rows.push({ id: 'ratio', label: 'Mix Ratio', value: 'Not applicable (single component)', status: 'NOT_APPLICABLE' });
  } else {
    const ratio = getField(brief, 'mixing.ratio');
    const basis = ratio.note && /^By /.test(ratio.note) ? ` (${ratio.note.replace(/\.$/, '').toLowerCase()})` : '';
    rows.push(row(brief, 'ratio', 'Mix Ratio', `${formatFieldValue(brief, 'mixing.ratio', UNKNOWN_LABEL)}${hasValue(ratio) ? basis : ''}`, ['mixing.ratio']));
  }

  rows.push(quantityRow(brief, 'production', 'Production', 'production.productionRate', 'production.productionUnit'));
  rows.push(quantityRow(brief, 'shot', 'Shot Size', 'production.shotSize', 'production.shotSizeUnit'));
  rows.push(quantityRow(brief, 'flow', 'Flow Rate', 'production.flowRate', 'production.flowUnit'));

  const viscosity = viscosityRows(brief, profile);
  rows.push({
    id: 'viscosity',
    label: 'Viscosity',
    value: '',
    status: 'UNKNOWN',
    children: viscosity,
  });

  const automationIds: FieldId[] = ['automation.automationLevel'];
  rows.push(row(brief, 'automation', 'Automation', automationValue(brief), automationIds));

  rows.push(row(brief, 'part', 'Part', formatFieldValue(brief, 'part.partDescription', UNKNOWN_LABEL), ['part.partDescription']));

  const envIds: FieldId[] = hasValue(getField(brief, 'environment.hazardousEnvironment'))
    ? ['environment.operatingEnvironment', 'environment.hazardousEnvironment']
    : ['environment.operatingEnvironment'];
  const hazard = getField(brief, 'environment.hazardousEnvironment').value === true ? ' · hazardous environment stated' : '';
  const envBase = formatFieldValue(brief, 'environment.operatingEnvironment', UNKNOWN_LABEL);
  rows.push(row(brief, 'environment', 'Environment', `${envBase}${hazard}`, envIds));

  return rows;
}

function fieldTable(brief: ApplicationBrief, profile: ApplicationProfile): FieldTableRow[] {
  const out: FieldTableRow[] = [];
  for (const def of FIELD_DEFS) {
    if (!shown(brief, profile, def.id)) continue;
    if (def.group === 'contact' || def.id === 'mixing.ratioKnown' || def.id === 'application.description') continue;
    out.push({
      fieldId: def.id,
      group: def.group,
      groupLabel: GROUP_LABELS[def.group],
      label: def.label,
      value: formatFieldValue(brief, def.id, UNKNOWN_LABEL),
      status: fieldViewStatus(brief, def.id),
      provenance: describeProvenance(brief, def.id),
    });
  }
  return out;
}

/** buildEngineeringBrief(): everything the Engineering Brief screen shows, as plain data. */
export function buildEngineeringBrief(brief: ApplicationBrief, profile: ApplicationProfile = DEFAULT_PROFILE): EngineeringBriefView {
  return {
    title: 'ENGINEERING BRIEF',
    rows: summaryRows(brief, profile),
    fieldTable: fieldTable(brief, profile),
    completeness: calculateCompleteness(brief, profile),
    reviewFlags: computeReviewFlags(brief, profile),
    engineerReview: { required: true, label: 'Required', statement: ENGINEER_REVIEW_STATEMENT },
    platformContext: getPlatformContext(brief),
    disclaimer: SAFETY_NOTICE,
  };
}
