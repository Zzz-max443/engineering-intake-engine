import { PLATFORM_DISCLAIMER, PLATFORM_HEADING, PLATFORMS } from '../data/products.ts';
import type { PlatformInfo } from '../data/products.ts';
import { componentRatioMismatch } from '../engine/derive.ts';
import { getField, numberOf, stringOf } from '../models/brief.ts';
import type { ApplicationBrief } from '../models/types.ts';

export interface PlatformEntry {
  id: string;
  name: string;
  /** Always worded as "potentially relevant" — never "correct", "recommended" or "suitable". */
  statement: string;
  /** Public product description the statement is based on. */
  basis: string;
}

export interface PlatformContext {
  heading: string;
  /** False when there is not enough information: then NO platform is shown. */
  available: boolean;
  entries: PlatformEntry[];
  /** Why nothing is shown (only when available is false). */
  reason?: string;
  disclaimer: string;
}

function platform(id: string): PlatformInfo {
  const found = PLATFORMS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown platform ${id}`);
  return found;
}

function unavailable(reason: string): PlatformContext {
  return { heading: PLATFORM_HEADING, available: false, entries: [], reason, disclaimer: PLATFORM_DISCLAIMER };
}

/** "10:1" -> larger-to-smaller ratio 10, or null when it cannot be compared with x:1 notation. */
function ratioAsMultiple(ratio: string): { multiple: number; smallerFirst: boolean } | null {
  const terms = ratio.split(':').map(Number);
  if (terms.length !== 2 || terms.some((t) => !(t > 0))) return null;
  const [a, b] = terms as [number, number];
  return a >= b ? { multiple: a / b, smallerFirst: false } : { multiple: b / a, smallerFirst: true };
}

/**
 * getPlatformContext(): preliminary context from public product information.
 * It needs a STATED component count (an inferred one is not enough) and, for two components,
 * a stated ratio. With less than that, it shows nothing — never a guess.
 */
export function getPlatformContext(brief: ApplicationBrief): PlatformContext {
  const countField = getField(brief, 'material.componentCount');
  const count = numberOf(brief, 'material.componentCount');

  if (count === null) {
    return unavailable('Not enough information yet: the number of components is not known.');
  }
  const mismatch = componentRatioMismatch(brief);
  if (mismatch) {
    return unavailable(
      `The stated number of components (${mismatch.components}) and the ratio ${mismatch.ratio} (${mismatch.terms} terms) do not agree. Confirm them to see preliminary platform context.`,
    );
  }
  if (countField.status === 'INFERRED') {
    return unavailable('The number of components is only inferred. Confirm it to see preliminary platform context.');
  }
  if (count === 1) {
    return unavailable(
      'Single-component material stated. The multi-component platforms in the public information do not apply; an engineer must determine which equipment type applies.',
    );
  }

  if (count === 2) {
    const ratio = stringOf(brief, 'mixing.ratio');
    if (!ratio) return unavailable('Two components stated, but the mix ratio is not known yet.');
    const pk1 = platform('PK1D');
    const pk2 = platform('PK2D');
    const range = pk2.ratio.type === 'variable' ? pk2.ratio : { min: 1, max: 100 };
    const parsed = ratioAsMultiple(ratio);

    let pk2Statement: string;
    if (!parsed) {
      pk2Statement = `Potentially relevant platform. Published variable ratio range: ${range.min}:1 to ${range.max}:1. The stated ratio (${ratio}) could not be compared with that range.`;
    } else if (parsed.smallerFirst) {
      pk2Statement = `Potentially relevant platform. Published variable ratio range: ${range.min}:1 to ${range.max}:1. The stated ratio (${ratio}) is written with the smaller term first; how it maps to the published range must be confirmed by an engineer.`;
    } else if (parsed.multiple >= range.min && parsed.multiple <= range.max) {
      pk2Statement = `Potentially relevant platform. Published variable ratio range: ${range.min}:1 to ${range.max}:1; the stated ratio (${ratio}) lies within that published range. This is not a confirmation of suitability.`;
    } else {
      pk2Statement = `Published variable ratio range: ${range.min}:1 to ${range.max}:1. The stated ratio (${ratio}) is outside that published range; engineering review is needed before any platform is considered.`;
    }

    return {
      heading: PLATFORM_HEADING,
      available: true,
      entries: [
        { id: pk1.id, name: pk1.name, statement: `Potentially relevant platform. Fixed published ratios; whether the stated ratio (${ratio}) is available was not verified.`, basis: pk1.summary },
        { id: pk2.id, name: pk2.name, statement: pk2Statement, basis: pk2.summary },
      ],
      disclaimer: PLATFORM_DISCLAIMER,
    };
  }

  if (count === 3) {
    const pk3 = platform('PK3D');
    return {
      heading: PLATFORM_HEADING,
      available: true,
      entries: [{ id: pk3.id, name: pk3.name, statement: 'Potentially relevant platform for a 3-component material.', basis: pk3.summary }],
      disclaimer: PLATFORM_DISCLAIMER,
    };
  }

  const pk6 = platform('PK6D');
  return {
    heading: PLATFORM_HEADING,
    available: true,
    entries: [
      {
        id: pk6.id,
        name: pk6.name,
        statement: `Potentially relevant context: ${count} components stated, which points to higher-complexity or custom configurations.`,
        basis: pk6.summary,
      },
    ],
    disclaimer: PLATFORM_DISCLAIMER,
  };
}
