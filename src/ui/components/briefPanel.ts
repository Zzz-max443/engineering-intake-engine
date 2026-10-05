import type { MissingField } from '../../engine/index.ts';
import type { BriefRow, EngineeringBriefView } from '../../rfq/index.ts';
import { buildEngineeringBrief } from '../../rfq/index.ts';
import type { Controller } from '../controller.ts';
import { h } from '../dom.ts';
import type { Component } from './header.ts';
import { statusChip, statusModifier } from './statusChip.ts';

const REASON_TEXT: Record<MissingField['reason'], string> = {
  NOT_PROVIDED: '',
  USER_UNKNOWN: 'user does not know yet',
  NEEDS_DETAIL: 'only a qualitative or ranged answer',
  CONFLICT: 'conflicting statements',
};

function block(title: string, count: number | null, ...children: Array<HTMLElement | null>): HTMLElement {
  return h(
    'section',
    { class: 'block' },
    h('h3', { class: 'block__title' }, title, count === null ? null : h('span', { class: 'block__count' }, String(count))),
    ...children,
  );
}

function ledgerRow(row: BriefRow, nested = false): HTMLElement {
  const empty = row.status === 'UNKNOWN';
  return h(
    'div',
    { class: `ledger__row ledger__row--${statusModifier(row.status)}${nested ? ' ledger__row--nested' : ''}`, role: 'listitem' },
    h('span', { class: 'ledger__label' }, row.label),
    h('span', { class: `ledger__value${empty ? ' is-empty' : ''}` }, row.value || 'Unknown'),
    h('span', { class: 'ledger__status' }, statusChip(row.status)),
    row.detail ? h('span', { class: 'ledger__detail' }, row.detail) : null,
  );
}

function ledger(rows: BriefRow[]): HTMLElement {
  const wrap = h('div', { class: 'ledger', role: 'list' });
  for (const row of rows) {
    if (row.children) {
      wrap.append(
        h(
          'div',
          { class: 'ledger__group', role: 'listitem' },
          h('div', { class: 'ledger__group-label' }, row.label),
          row.children.length > 0
            ? h('div', { class: 'ledger__children', role: 'list' }, ...row.children.map((child) => ledgerRow(child, true)))
            : h('p', { class: 'ledger__value is-empty' }, 'Unknown'),
        ),
      );
    } else {
      wrap.append(ledgerRow(row));
    }
  }
  return wrap;
}

function missingBlock(view: EngineeringBriefView): HTMLElement {
  const missing = view.completeness.missing;
  const tiers: Array<{ priority: MissingField['priority']; label: string }> = [
    { priority: 'REQUIRED', label: 'Required' },
    { priority: 'USEFUL', label: 'Useful' },
    { priority: 'OPTIONAL', label: 'Optional' },
  ];
  const lines = tiers
    .map((tier) => ({ tier, items: missing.filter((m) => m.priority === tier.priority) }))
    .filter((group) => group.items.length > 0)
    .map(({ tier, items }) =>
      h(
        'div',
        { class: 'missing__line' },
        h('span', { class: `tag tag--${tier.priority.toLowerCase()}` }, tier.label),
        h(
          'ul',
          { class: 'pills' },
          ...items.map((item) => {
            const why = REASON_TEXT[item.reason];
            return h(
              'li',
              { class: `pill${why ? ' pill--note' : ''}`, ...(item.detail ? { title: item.detail } : {}) },
              item.label,
              why ? h('span', { class: 'pill__why' }, why) : null,
            );
          }),
        ),
      ),
    );
  return block(
    'Missing information',
    missing.length,
    lines.length > 0
      ? h('div', { class: 'missing' }, ...lines)
      : h('p', { class: 'block__empty' }, 'Nothing is missing for this application profile.'),
  );
}

function reviewBlock(view: EngineeringBriefView): HTMLElement {
  const flags = view.reviewFlags.filter((flag) => flag.id !== 'ENGINEER_REQUIRED');
  return block(
    'Engineer review',
    null,
    h(
      'p',
      { class: 'review__lead' },
      h('span', { class: 'badge badge--review' }, `${view.engineerReview.label.toUpperCase()}`),
      view.engineerReview.statement,
    ),
    flags.length > 0
      ? h(
          'ul',
          { class: 'flags' },
          ...flags.map((flag) =>
            h(
              'li',
              { class: `flag flag--${flag.severity}` },
              h('i', { class: `mark mark--${flag.severity === 'warning' ? 'review' : 'unknown'}`, 'aria-hidden': 'true' }),
              h('span', { class: 'flag__text' }, flag.message),
            ),
          ),
        )
      : null,
  );
}

function platformBlock(view: EngineeringBriefView): HTMLElement {
  const ctx = view.platformContext;
  return block(
    ctx.heading,
    null,
    ctx.available
      ? h(
          'div',
          { class: 'platforms' },
          ...ctx.entries.map((entry) =>
            h(
              'div',
              { class: 'platform' },
              h('div', { class: 'platform__name' }, entry.name),
              h('p', { class: 'platform__statement' }, entry.statement),
              h('p', { class: 'platform__basis' }, `Public description: ${entry.basis}`),
            ),
          ),
        )
      : h('p', { class: 'platform__none' }, `No platform context is shown. ${ctx.reason ?? ''}`.trim()),
    h('p', { class: 'platform__disclaimer' }, ctx.disclaimer),
  );
}

function fieldDetail(view: EngineeringBriefView, open: boolean, onToggle: (open: boolean) => void): HTMLElement {
  const list = h('div', { class: 'fields', role: 'list' });
  let lastGroup = '';
  for (const row of view.fieldTable) {
    if (row.groupLabel !== lastGroup) {
      lastGroup = row.groupLabel;
      list.append(h('div', { class: 'fields__group' }, row.groupLabel));
    }
    list.append(
      h(
        'div',
        { class: `fields__row fields__row--${statusModifier(row.status)}`, role: 'listitem' },
        h('span', { class: 'fields__label' }, row.label),
        h('span', { class: `fields__value${row.status === 'UNKNOWN' ? ' is-empty' : ''}` }, row.value),
        statusChip(row.status),
        h('span', { class: 'fields__source' }, row.provenance),
      ),
    );
  }
  const details = h(
    'details',
    { class: 'detail', ...(open ? { open: true } : {}) },
    h('summary', { class: 'detail__summary' }, `Field-level detail — status and source of each datum (${view.fieldTable.length})`),
    list,
  );
  details.addEventListener('toggle', () => onToggle(details.open));
  return details;
}

/** Centre column: the live Engineering Brief. Rebuilt from buildEngineeringBrief() on every change. */
export function createBriefPanel(controller: Controller): Component {
  const body = h('div', { class: 'panel__body' });
  let detailOpen = false;

  const el = h(
    'section',
    { class: 'panel panel--brief', 'aria-labelledby': 'brief-title' },
    h(
      'div',
      { class: 'panel__head panel__head--split' },
      h('div', {}, h('h2', { class: 'panel__title', id: 'brief-title' }, 'Engineering Brief'), h('p', { class: 'panel__sub' }, 'Live — updates with every message')),
      h('span', { class: 'badge badge--review' }, 'Engineer review: REQUIRED'),
    ),
    body,
  );

  return {
    el,
    update(): void {
      const view = buildEngineeringBrief(controller.session.brief, controller.session.profile);
      body.replaceChildren(
        ledger(view.rows),
        missingBlock(view),
        reviewBlock(view),
        platformBlock(view),
        fieldDetail(view, detailOpen, (open) => {
          detailOpen = open;
        }),
      );
    },
  };
}
