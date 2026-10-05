import type { ViewStatus } from '../../rfq/engineeringBrief.ts';
import { h } from '../dom.ts';

const LABELS: Record<ViewStatus, string> = {
  KNOWN: 'Known',
  UNKNOWN: 'Unknown',
  INFERRED: 'Inferred',
  REQUIRES_ENGINEER_REVIEW: 'Review',
  PARTIAL: 'Partial',
  NOT_APPLICABLE: 'n/a',
};

const TITLES: Record<ViewStatus, string> = {
  KNOWN: 'Stated by the user',
  UNKNOWN: 'Not provided',
  INFERRED: 'Inferred by the tool — not confirmed by the user',
  REQUIRES_ENGINEER_REVIEW: 'Requires engineer review',
  PARTIAL: 'Partly provided',
  NOT_APPLICABLE: 'Does not apply to this case',
};

export function statusModifier(status: ViewStatus): string {
  switch (status) {
    case 'KNOWN':
      return 'known';
    case 'INFERRED':
      return 'inferred';
    case 'REQUIRES_ENGINEER_REVIEW':
      return 'review';
    case 'NOT_APPLICABLE':
      return 'na';
    default:
      return 'unknown'; // UNKNOWN and PARTIAL share the neutral grey
  }
}

/** Small shape that encodes the state without relying on colour alone. */
export function statusMark(status: ViewStatus): HTMLElement {
  return h('i', { class: `mark mark--${statusModifier(status)}`, 'aria-hidden': 'true' });
}

/** Mark + word. The word is always present so colour is never the only signal. */
export function statusChip(status: ViewStatus, label?: string): HTMLElement {
  return h(
    'span',
    { class: `chip chip--${statusModifier(status)}`, title: TITLES[status] },
    statusMark(status),
    h('span', { class: 'chip__text' }, label ?? LABELS[status]),
  );
}

export function statusLabel(status: ViewStatus): string {
  return LABELS[status];
}
