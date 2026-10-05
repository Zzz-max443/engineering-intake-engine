/**
 * PRELIMINARY PLATFORM CONTEXT — public, conservative information only.
 *
 * These entries must never be used to claim that a platform "is the correct system".
 * They only feed the "Preliminary platform context" block, and only when enough
 * information exists (see rfq/platformContext.ts).
 */

export interface PlatformInfo {
  id: string;
  name: string;
  /** Number of components, or 'custom' when it depends on the configuration. */
  components: number | 'custom';
  ratio:
    | { type: 'fixed' }
    | { type: 'variable'; min: number; max: number }
    | { type: 'custom' };
  /** Public one-line description. Keep it factual and conservative. */
  summary: string;
}

export const PLATFORMS: PlatformInfo[] = [
  {
    id: 'PK1D',
    name: 'PK1D',
    components: 2,
    ratio: { type: 'fixed' },
    summary: '2-component system with fixed published ratios, oriented to dispensing applications.',
  },
  {
    id: 'PK2D',
    name: 'PK2D',
    components: 2,
    ratio: { type: 'variable', min: 1, max: 100 },
    summary: '2-component system with a published variable ratio from 1:1 to 100:1, used for dispensing applications.',
  },
  {
    id: 'PK3D',
    name: 'PK3D',
    components: 3,
    ratio: { type: 'custom' },
    summary: '3-component system.',
  },
  {
    id: 'PK6D',
    name: 'PK6D / Custom',
    components: 'custom',
    ratio: { type: 'custom' },
    summary: 'Higher-complexity / custom configurations.',
  },
];

export const PLATFORM_DISCLAIMER = 'Final system selection requires Fluidic engineering review.';
export const PLATFORM_HEADING = 'Preliminary platform context';

export const SAFETY_NOTICE =
  'Preliminary engineering intake only. This tool does not determine final equipment selection. ' +
  'Final configuration and compatibility must be confirmed by a qualified Fluidic engineer.';
