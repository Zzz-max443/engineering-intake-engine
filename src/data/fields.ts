import type { FieldId } from '../models/types.ts';

export type FieldKind = 'text' | 'number' | 'boolean' | 'ratio' | 'count' | 'choice' | 'unit';

export type GroupId =
  | 'application'
  | 'material'
  | 'mixing'
  | 'properties'
  | 'production'
  | 'automation'
  | 'environment'
  | 'part'
  | 'integration'
  | 'contact'
  | 'notes';

export interface FieldDef {
  id: FieldId;
  group: GroupId;
  /** Full label, used in the detailed field table. */
  label: string;
  /** Short label, used in Known / Missing lists. */
  shortLabel: string;
  kind: FieldKind;
  /** For numeric fields: the field that stores their unit. */
  unitField?: FieldId;
  /** For unit fields: the numeric fields the unit belongs to. */
  unitFor?: FieldId[];
}

export const GROUP_LABELS: Record<GroupId, string> = {
  application: 'Application',
  material: 'Material',
  mixing: 'Mixing',
  properties: 'Material properties',
  production: 'Production',
  automation: 'Automation',
  environment: 'Environment',
  part: 'Part',
  integration: 'Integration',
  contact: 'Contact',
  notes: 'Notes',
};

function def(
  id: FieldId,
  label: string,
  shortLabel: string,
  kind: FieldKind,
  extra: { unitField?: FieldId; unitFor?: FieldId[] } = {},
): FieldDef {
  const group = id.slice(0, id.indexOf('.')) as GroupId;
  return { id, group, label, shortLabel, kind, ...extra };
}

export const FIELD_DEFS: FieldDef[] = [
  def('application.category', 'Application category', 'Application', 'text'),
  def('application.subcategory', 'Subcategory', 'Subcategory', 'text'),
  def('application.description', 'Description (user wording)', 'Description', 'text'),

  def('material.materialName', 'Material name / product', 'Material name', 'text'),
  def('material.chemistry', 'Chemistry', 'Chemistry', 'choice'),
  def('material.componentCount', 'Number of components', 'Components', 'count'),

  def('mixing.ratio', 'Mix ratio', 'Mix ratio', 'ratio'),
  def('mixing.ratioKnown', 'Ratio known', 'Ratio known', 'boolean'),

  def('properties.viscosityA', 'Viscosity — Component A', 'Viscosity A', 'number', { unitField: 'properties.viscosityUnit' }),
  def('properties.viscosityB', 'Viscosity — Component B', 'Viscosity B', 'number', { unitField: 'properties.viscosityUnit' }),
  def('properties.viscosityC', 'Viscosity — Component C', 'Viscosity C', 'number', { unitField: 'properties.viscosityUnit' }),
  def('properties.viscosityUnit', 'Viscosity unit', 'Viscosity unit', 'unit', {
    unitFor: ['properties.viscosityA', 'properties.viscosityB', 'properties.viscosityC'],
  }),
  def('properties.temperature', 'Material / process temperature', 'Material temperature', 'number', {
    unitField: 'properties.temperatureUnit',
  }),
  def('properties.temperatureUnit', 'Temperature unit', 'Temperature unit', 'unit', {
    unitFor: ['properties.temperature'],
  }),
  def('properties.filled', 'Filled material', 'Filled material', 'boolean'),
  def('properties.abrasive', 'Abrasive material', 'Abrasive material', 'boolean'),
  def('properties.thixotropic', 'Thixotropic material', 'Thixotropic', 'boolean'),

  def('production.productionRate', 'Production rate', 'Production', 'number', { unitField: 'production.productionUnit' }),
  def('production.productionUnit', 'Production unit', 'Production unit', 'unit', {
    unitFor: ['production.productionRate'],
  }),
  def('production.shotSize', 'Shot size / dispensed volume', 'Shot size', 'number', { unitField: 'production.shotSizeUnit' }),
  def('production.shotSizeUnit', 'Shot size unit', 'Shot size unit', 'unit', { unitFor: ['production.shotSize'] }),
  def('production.flowRate', 'Flow rate', 'Flow rate', 'number', { unitField: 'production.flowUnit' }),
  def('production.flowUnit', 'Flow rate unit', 'Flow rate unit', 'unit', { unitFor: ['production.flowRate'] }),
  def('production.cycleTime', 'Cycle time', 'Cycle time', 'number', { unitField: 'production.cycleTimeUnit' }),
  def('production.cycleTimeUnit', 'Cycle time unit', 'Cycle time unit', 'unit', { unitFor: ['production.cycleTime'] }),

  def('automation.automationLevel', 'Automation level', 'Automation', 'choice'),
  def('automation.robotic', 'Robotic handling', 'Robotic', 'boolean'),
  def('automation.conveyor', 'Conveyor', 'Conveyor', 'boolean'),
  def('automation.existingAutomation', 'Existing automation', 'Existing automation', 'text'),

  def('environment.operatingEnvironment', 'Operating environment', 'Operating environment', 'text'),
  def('environment.hazardousEnvironment', 'Hazardous environment', 'Hazardous environment', 'boolean'),
  def('environment.operatingTemperature', 'Operating (ambient) temperature', 'Operating temperature', 'number', {
    unitField: 'environment.operatingTemperatureUnit',
  }),
  def('environment.operatingTemperatureUnit', 'Operating temperature unit', 'Operating temperature unit', 'unit', {
    unitFor: ['environment.operatingTemperature'],
  }),

  def('part.partDescription', 'Part description', 'Part description', 'text'),
  def('part.cavityGeometry', 'Cavity geometry', 'Cavity geometry', 'text'),
  def('part.targetArea', 'Target area / fill zone', 'Target area', 'text'),

  def('integration.existingEquipment', 'Existing equipment', 'Existing equipment', 'text'),
  def('integration.integrationRequirements', 'Integration requirements', 'Integration requirements', 'text'),

  def('contact.company', 'Company', 'Company', 'text'),
  def('contact.contactName', 'Contact', 'Contact', 'text'),
  def('notes.additionalNotes', 'Additional notes', 'Additional notes', 'text'),
];

const BY_ID = new Map<FieldId, FieldDef>(FIELD_DEFS.map((d) => [d.id, d]));

export function getFieldDef(id: FieldId): FieldDef {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`No field definition for ${id}`);
  return found;
}

/** Chemistry vocabulary: canonical key -> display label. */
export const CHEMISTRY_LABELS: Record<string, string> = {
  epoxy: 'Epoxy',
  polyurethane: 'Polyurethane',
  silicone: 'Silicone',
  acrylic: 'Acrylic',
  polyester: 'Polyester',
  polysulfide: 'Polysulfide',
};

export const AUTOMATION_LEVELS = ['Automated', 'Semi-automatic', 'Manual'] as const;
