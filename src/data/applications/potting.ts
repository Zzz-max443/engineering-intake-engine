import { getField, hasValue, numberOf, stringOf } from '../../models/brief.ts';
import type { ApplicationBrief, FieldId } from '../../models/types.ts';
import type { ApplicationProfile, FieldRule } from './types.ts';

// ---- small predicates over the brief ------------------------------------------------------

/** Component count if known, otherwise null. */
const components = (b: ApplicationBrief): number | null => numberOf(b, 'material.componentCount');
/** Two or more components — or not known yet (so we must not rule mixing out). */
const mayBeMultiComponent = (b: ApplicationBrief): boolean => {
  const n = components(b);
  return n === null || n >= 2;
};
const atLeastThreeComponents = (b: ApplicationBrief): boolean => {
  const n = components(b);
  return n !== null && n >= 3;
};
const has = (b: ApplicationBrief, id: FieldId): boolean => hasValue(getField(b, id));
const signal = (b: ApplicationBrief, name: string): boolean => b.metadata.signals.includes(name);
const automationIsPresent = (b: ApplicationBrief): boolean => {
  const level = stringOf(b, 'automation.automationLevel');
  return level === 'Automated' || level === 'Semi-automatic';
};
const anyViscosity = (b: ApplicationBrief): boolean =>
  has(b, 'properties.viscosityA') || has(b, 'properties.viscosityB') || has(b, 'properties.viscosityC');

// ---- rules --------------------------------------------------------------------------------

const rules: Partial<Record<FieldId, FieldRule>> = {
  'application.category': { priority: 'REQUIRED', askable: false },
  'application.subcategory': { priority: 'OPTIONAL', askable: false },
  'application.description': { priority: 'OPTIONAL', derived: true },

  'material.componentCount': { priority: 'REQUIRED' },
  'material.chemistry': { priority: 'REQUIRED' },
  'material.materialName': { priority: 'OPTIONAL' },

  'mixing.ratio': { priority: 'REQUIRED', applicable: mayBeMultiComponent },
  'mixing.ratioKnown': { priority: 'OPTIONAL', derived: true },

  'properties.viscosityA': { priority: 'REQUIRED' },
  'properties.viscosityB': { priority: 'REQUIRED', applicable: mayBeMultiComponent },
  'properties.viscosityC': { priority: 'REQUIRED', applicable: atLeastThreeComponents },
  'properties.viscosityUnit': { priority: 'REQUIRED', applicable: anyViscosity },
  // Temperature only matters when the user brings it up (relevance is conditional, not assumed).
  'properties.temperature': {
    priority: 'USEFUL',
    applicable: (b) => signal(b, 'MENTIONS_TEMPERATURE') || has(b, 'properties.temperature'),
  },
  'properties.temperatureUnit': { priority: 'USEFUL', applicable: (b) => has(b, 'properties.temperature') },
  'properties.filled': { priority: 'USEFUL' },
  // The tool never judges these; if the user mentions them they are flagged for the engineer.
  'properties.abrasive': { priority: 'ENGINEER_REVIEW' },
  'properties.thixotropic': { priority: 'ENGINEER_REVIEW' },

  'production.productionRate': { priority: 'REQUIRED' },
  'production.productionUnit': { priority: 'REQUIRED', applicable: (b) => has(b, 'production.productionRate') },
  'production.shotSize': { priority: 'REQUIRED' },
  'production.shotSizeUnit': { priority: 'REQUIRED', applicable: (b) => has(b, 'production.shotSize') },
  // Flow rate stays REQUIRED unless shot size and cycle time are both provided.
  'production.flowRate': {
    priority: (b) => (has(b, 'production.shotSize') && has(b, 'production.cycleTime') ? 'USEFUL' : 'REQUIRED'),
  },
  'production.flowUnit': { priority: 'REQUIRED', applicable: (b) => has(b, 'production.flowRate') },
  'production.cycleTime': { priority: 'OPTIONAL', askable: false },
  'production.cycleTimeUnit': { priority: 'OPTIONAL', applicable: (b) => has(b, 'production.cycleTime') },

  'automation.automationLevel': { priority: 'REQUIRED' },
  // Asking about a robot only makes sense once the process is (semi-)automated.
  'automation.robotic': { priority: 'USEFUL', applicable: automationIsPresent },
  'automation.conveyor': { priority: 'OPTIONAL', askable: false },
  'automation.existingAutomation': { priority: 'OPTIONAL', askable: false },

  'environment.operatingEnvironment': { priority: 'USEFUL' },
  'environment.hazardousEnvironment': { priority: 'ENGINEER_REVIEW' },
  'environment.operatingTemperature': { priority: 'OPTIONAL', askable: false },
  'environment.operatingTemperatureUnit': { priority: 'OPTIONAL', applicable: (b) => has(b, 'environment.operatingTemperature') },

  'part.partDescription': { priority: 'USEFUL' },
  'part.cavityGeometry': { priority: 'OPTIONAL' },
  'part.targetArea': { priority: 'OPTIONAL' },

  'integration.existingEquipment': { priority: 'OPTIONAL' },
  'integration.integrationRequirements': { priority: 'OPTIONAL' },

  'contact.company': { priority: 'OPTIONAL', derived: true },
  'contact.contactName': { priority: 'OPTIONAL', derived: true },
  // Last question of the intake: free text for the engineer.
  'notes.additionalNotes': { priority: 'OPTIONAL' },
};

export const POTTING_PROFILE: ApplicationProfile = {
  id: 'potting',
  name: 'Potting & Encapsulation',
  scope: {
    // "pot life" is a material property, not the application.
    inScope: /\b(?:pot(?!\s+life)(?:s|ted|ting)?|encapsulat\w*|embedd?ing)\b/i,
    subcategories: [
      { label: 'Potting', pattern: /\b(?:pot(?!\s+life)(?:s|ted|ting)?)\b/i },
      { label: 'Encapsulation', pattern: /\bencapsulat\w*\b/i },
    ],
    otherApplication:
      /\b(?:bond(?:ing)?|adhesives?|glu(?:e|ing)|gasket\w*|fipg|cipg|foam(?:ing)?|conformal\s+coat\w*|coating|sealant\s+bead|bead\s+dispens\w*|glazing|laminat\w*|thread\s*lock\w*|underfill|die\s*attach)\b/i,
  },
  rules,
  questionOrder: [
    'material.componentCount',
    'material.chemistry',
    'mixing.ratio',
    'properties.viscosityA',
    'properties.viscosityB',
    'properties.viscosityC',
    'production.shotSize',
    'production.productionRate',
    'production.flowRate',
    'automation.automationLevel',
    'part.partDescription',
    'environment.operatingEnvironment',
    'properties.filled',
    'properties.temperature',
    'automation.robotic',
    'material.materialName',
    'part.cavityGeometry',
    'part.targetArea',
    'integration.existingEquipment',
    'integration.integrationRequirements',
    'notes.additionalNotes',
  ],
};
