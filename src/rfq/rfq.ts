import { DEFAULT_PROFILE } from '../data/applications/index.ts';
import type { ApplicationProfile } from '../data/applications/types.ts';
import { SAFETY_NOTICE } from '../data/products.ts';
import { chemistryLabel, formatFieldValue, NOT_PROVIDED } from '../engine/format.ts';
import { getPriority } from '../engine/profileRules.ts';
import { computeReviewFlags } from '../engine/review.ts';
import type { ReviewFlag } from '../engine/review.ts';
import { getField, hasValue, numberOf, stringOf } from '../models/brief.ts';
import type { ApplicationBrief, FieldId } from '../models/types.ts';
import { capitalize } from '../utils/text.ts';
import { aggregateStatus, buildEngineeringBrief, fieldViewStatus } from './engineeringBrief.ts';
import type { ViewStatus } from './engineeringBrief.ts';
import { getPlatformContext } from './platformContext.ts';
import type { PlatformContext } from './platformContext.ts';

export interface RFQOptions {
  company?: string;
  contact?: string;
  additionalNotes?: string;
  /** Injected for deterministic output in tests. */
  now?: Date;
}

export interface RFQLine {
  label: string;
  /** One or more lines of text (viscosity and notes use several). */
  lines: string[];
  /** False when nothing was provided for this line. */
  provided: boolean;
}

export interface RFQDraft {
  title: 'REQUEST FOR QUOTE — DRAFT';
  status: string;
  generatedAt: string;
  lines: RFQLine[];
  platformContext: PlatformContext;
  reviewNotes: ReviewFlag[];
  disclaimer: string;
}

/** Wording appended to a value that is not a plain user statement. The UI highlights these. */
export const RFQ_STATUS_SUFFIX = {
  INFERRED: ' (inferred — unconfirmed)',
  REQUIRES_ENGINEER_REVIEW: ' (requires engineer review)',
} as const;

const SUFFIX: Partial<Record<ViewStatus, string>> = RFQ_STATUS_SUFFIX;

function suffixFor(brief: ApplicationBrief, ids: FieldId[]): string {
  const populated = ids.filter((id) => hasValue(getField(brief, id)));
  if (populated.length === 0) return '';
  return SUFFIX[aggregateStatus(brief, populated)] ?? '';
}

/** "Not provided" or "Component A — Not provided": nothing was given for that line. */
const EMPTY_LINE = new RegExp(`^(?:.+ — )?${NOT_PROVIDED}\\b`);

function line(label: string, lines: string[]): RFQLine {
  return { label, lines, provided: lines.some((l) => !EMPTY_LINE.test(l)) };
}

function quantity(brief: ApplicationBrief, valueId: FieldId, unitId: FieldId): string {
  const text = formatFieldValue(brief, valueId, NOT_PROVIDED);
  return hasValue(getField(brief, valueId)) ? `${text}${suffixFor(brief, [valueId, unitId])}` : text;
}

function formatTimestamp(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function additionalNotes(brief: ApplicationBrief, userNotes: string | undefined): string[] {
  const notes: string[] = [];
  const free = userNotes?.trim() || stringOf(brief, 'notes.additionalNotes');
  if (free) notes.push(`User notes: ${free}`);

  const extras: Array<[string, FieldId]> = [
    ['Cavity geometry', 'part.cavityGeometry'],
    ['Target area', 'part.targetArea'],
    ['Material temperature', 'properties.temperature'],
    ['Operating temperature', 'environment.operatingTemperature'],
    ['Cycle time', 'production.cycleTime'],
    ['Filled material', 'properties.filled'],
    ['Abrasive material', 'properties.abrasive'],
    ['Thixotropic material', 'properties.thixotropic'],
    ['Existing equipment', 'integration.existingEquipment'],
    ['Existing automation', 'automation.existingAutomation'],
    ['Integration requirements', 'integration.integrationRequirements'],
  ];
  for (const [label, id] of extras) {
    if (!hasValue(getField(brief, id))) continue;
    const unitId = id === 'properties.temperature' ? 'properties.temperatureUnit' : id === 'environment.operatingTemperature' ? 'environment.operatingTemperatureUnit' : id === 'production.cycleTime' ? 'production.cycleTimeUnit' : null;
    notes.push(`${label}: ${formatFieldValue(brief, id)}${suffixFor(brief, unitId ? [id, unitId] : [id])}`);
  }

  for (const captured of brief.metadata.capturedNotes) notes.push(captured);

  const description = stringOf(brief, 'application.description');
  if (description) notes.push(`User description (verbatim): “${description}”`);
  return notes;
}

/**
 * buildRFQ(): a request-for-quote DRAFT from the brief. Every unknown field says "Not provided";
 * nothing is estimated, defaulted or filled in.
 */
export function buildRFQ(brief: ApplicationBrief, options: RFQOptions = {}, profile: ApplicationProfile = DEFAULT_PROFILE): RFQDraft {
  const lines: RFQLine[] = [];

  lines.push(line('Company', [options.company?.trim() || stringOf(brief, 'contact.company') || NOT_PROVIDED]));
  lines.push(line('Contact', [options.contact?.trim() || stringOf(brief, 'contact.contactName') || NOT_PROVIDED]));

  // Application
  const category = stringOf(brief, 'application.category');
  const sub = stringOf(brief, 'application.subcategory');
  const categoryField = getField(brief, 'application.category');
  let application: string = NOT_PROVIDED;
  if (category) {
    application = sub ? `${category} (${sub})` : category;
    if (categoryField.status === 'INFERRED') application += ' (assumed from tool scope — not stated by the user)';
    else if (categoryField.status === 'REQUIRES_ENGINEER_REVIEW') application += ' (may belong to a different application — engineer review)';
  }
  lines.push(line('Application', [application]));

  // Material and components
  const chemistry = stringOf(brief, 'material.chemistry');
  const name = stringOf(brief, 'material.materialName');
  let material: string = NOT_PROVIDED;
  if (chemistry) material = `${chemistryLabel(chemistry)}${name ? ` — ${name}` : ''}${suffixFor(brief, ['material.chemistry'])}`;
  else if (name) material = name;
  lines.push(line('Material', [material]));

  const count = numberOf(brief, 'material.componentCount');
  lines.push(line('Components', [count === null ? NOT_PROVIDED : `${count}${suffixFor(brief, ['material.componentCount'])}`]));

  // Ratio
  // Not applicable only when the user did not state a ratio: a stated value is never hidden.
  if (getPriority(profile, brief, 'mixing.ratio') === null && !hasValue(getField(brief, 'mixing.ratio'))) {
    lines.push({ label: 'Ratio', lines: ['Not applicable (single-component material)'], provided: true });
  } else {
    const ratio = stringOf(brief, 'mixing.ratio');
    const basis = getField(brief, 'mixing.ratio').note;
    const text = ratio ? `${ratio}${basis && /^By /.test(basis) ? ` (${basis.replace(/\.$/, '').toLowerCase()})` : ''}${suffixFor(brief, ['mixing.ratio'])}` : formatFieldValue(brief, 'mixing.ratio', NOT_PROVIDED);
    lines.push(line('Ratio', [text]));
  }

  // Viscosity, one line per applicable component
  const components: Array<{ id: FieldId; label: string }> = [
    { id: 'properties.viscosityA', label: count === 1 ? 'Material' : 'Component A' },
    { id: 'properties.viscosityB', label: 'Component B' },
    { id: 'properties.viscosityC', label: 'Component C' },
  ];
  const viscosityLines = components
    .filter((c) => getPriority(profile, brief, c.id) !== null || hasValue(getField(brief, c.id)))
    .map((c) => `${c.label} — ${quantity(brief, c.id, 'properties.viscosityUnit')}`);
  lines.push(line('Viscosity', viscosityLines.length > 0 ? viscosityLines : [NOT_PROVIDED]));

  lines.push(line('Flow Rate', [quantity(brief, 'production.flowRate', 'production.flowUnit')]));
  lines.push(line('Shot Size', [quantity(brief, 'production.shotSize', 'production.shotSizeUnit')]));
  lines.push(line('Production', [quantity(brief, 'production.productionRate', 'production.productionUnit')]));

  // Automation
  const level = stringOf(brief, 'automation.automationLevel');
  const extras: string[] = [];
  if (getField(brief, 'automation.robotic').value === true) extras.push('robotic handling');
  if (getField(brief, 'automation.conveyor').value === true) extras.push('conveyor');
  const automation = level ? `${[level, ...extras].join(', ')}${suffixFor(brief, ['automation.automationLevel'])}` : extras.length > 0 ? `Level not stated; ${extras.join(', ')} mentioned` : NOT_PROVIDED;
  lines.push(line('Automation', [automation]));

  const part = stringOf(brief, 'part.partDescription');
  lines.push(line('Part Description', [part ? capitalize(part) : NOT_PROVIDED]));

  const environment = stringOf(brief, 'environment.operatingEnvironment');
  const hazardous = getField(brief, 'environment.hazardousEnvironment').value === true;
  const envText = [environment ? capitalize(environment) : null, hazardous ? 'Hazardous environment stated (requires engineer review)' : null].filter(Boolean).join(' — ');
  lines.push(line('Environment', [envText || NOT_PROVIDED]));

  const notes = additionalNotes(brief, options.additionalNotes);
  lines.push(line('Additional Notes', notes.length > 0 ? notes : [NOT_PROVIDED]));

  return {
    title: 'REQUEST FOR QUOTE — DRAFT',
    status: 'DRAFT — engineer review required',
    generatedAt: formatTimestamp(options.now ?? new Date()),
    lines,
    platformContext: getPlatformContext(brief),
    reviewNotes: computeReviewFlags(brief, profile),
    disclaimer: SAFETY_NOTICE,
  };
}

const LABEL_WIDTH = 18;
const RULE = '-'.repeat(64);
const DOUBLE_RULE = '='.repeat(64);

/** Plain-text rendering of the RFQ draft: what COPY RFQ puts on the clipboard. */
export function rfqToText(rfq: RFQDraft): string {
  const out: string[] = [rfq.title, `Status: ${rfq.status}`, `Generated: ${rfq.generatedAt}`, DOUBLE_RULE, ''];

  for (const l of rfq.lines) {
    const label = `${l.label}:`.padEnd(LABEL_WIDTH);
    const multi = l.lines.length > 1 || l.label === 'Additional Notes';
    l.lines.forEach((text, i) => {
      const prefix = i === 0 ? label : ' '.repeat(LABEL_WIDTH);
      out.push(`${prefix}${multi && l.label === 'Additional Notes' ? '- ' : ''}${text}`);
    });
  }

  out.push('', RULE, rfq.platformContext.heading.toUpperCase());
  if (rfq.platformContext.available) {
    for (const e of rfq.platformContext.entries) out.push(`- ${e.name}: ${e.statement}`);
  } else {
    out.push(`No platform context shown. ${rfq.platformContext.reason ?? ''}`.trim());
  }
  out.push(rfq.platformContext.disclaimer);

  out.push('', RULE, 'ENGINEER REVIEW NOTES');
  for (const f of rfq.reviewNotes) out.push(`- ${f.message}`);

  out.push('', RULE, rfq.disclaimer);
  return out.join('\n');
}

/** Download/export text: the RFQ plus the status and source of every field, for the reviewing engineer. */
export function buildExportText(brief: ApplicationBrief, rfq: RFQDraft, profile: ApplicationProfile = DEFAULT_PROFILE): string {
  const view = buildEngineeringBrief(brief, profile);
  const out: string[] = [rfqToText(rfq), '', DOUBLE_RULE, 'ATTACHMENT — FIELD-LEVEL DETAIL (status and source of each datum)', DOUBLE_RULE];
  const known = (id: FieldId): ViewStatus => fieldViewStatus(brief, id);
  for (const r of view.fieldTable) {
    out.push(`[${known(r.fieldId)}] ${r.label}: ${r.value}`);
    out.push(`    ${r.provenance}`);
  }
  out.push('', `RFQ completeness indicator: ${view.completeness.percent}% (${view.completeness.note})`);
  return out.join('\n');
}
