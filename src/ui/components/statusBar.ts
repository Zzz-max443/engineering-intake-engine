import type { MissingField } from '../../engine/index.ts';
import { buildEngineeringBrief } from '../../rfq/index.ts';
import type { EngineeringBriefView, ViewStatus } from '../../rfq/index.ts';
import type { Controller } from '../controller.ts';
import { h } from '../dom.ts';
import type { Component } from './header.ts';
import { statusMark } from './statusChip.ts';

const CONFIDENCE_TEXT = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' } as const;

function count(status: ViewStatus, label: string, value: number): HTMLElement {
  return h('li', { class: 'count', title: `${label}: ${value}` }, statusMark(status), h('span', { class: 'count__label' }, label), h('strong', { class: 'count__value' }, String(value)));
}

function listColumn(title: string, status: ViewStatus, labels: string[], emptyText: string): HTMLElement {
  return h(
    'section',
    { class: 'drawer__col' },
    h('h4', { class: 'drawer__title' }, statusMark(status), title, h('span', { class: 'block__count' }, String(labels.length))),
    labels.length > 0
      ? h('ul', { class: 'drawer__list' }, ...labels.map((label) => h('li', {}, label)))
      : h('p', { class: 'drawer__empty' }, emptyText),
  );
}

function missingColumn(missing: MissingField[]): HTMLElement {
  return h(
    'section',
    { class: 'drawer__col' },
    h('h4', { class: 'drawer__title' }, statusMark('UNKNOWN'), 'Missing', h('span', { class: 'block__count' }, String(missing.length))),
    missing.length > 0
      ? h(
          'ul',
          { class: 'drawer__list' },
          ...missing.map((item) =>
            h('li', {}, item.label, h('span', { class: `tag tag--${item.priority.toLowerCase()}` }, item.priority === 'REQUIRED' ? 'Required' : item.priority === 'USEFUL' ? 'Useful' : 'Optional')),
          ),
        )
      : h('p', { class: 'drawer__empty' }, 'Nothing missing.'),
  );
}

function drawerContent(view: EngineeringBriefView): HTMLElement {
  const c = view.completeness;
  return h(
    'div',
    { class: 'drawer__inner' },
    h(
      'div',
      { class: 'drawer__cols' },
      listColumn('Known', 'KNOWN', c.known.map((f) => f.label), 'Nothing stated yet.'),
      listColumn('Inferred', 'INFERRED', c.inferred.map((f) => f.label), 'Nothing inferred.'),
      listColumn('Needs review', 'REQUIRES_ENGINEER_REVIEW', c.needsReview.map((f) => f.label), 'Nothing flagged.'),
      missingColumn(c.missing),
    ),
    h(
      'p',
      { class: 'drawer__note' },
      `${c.note} Required fields provided: ${c.required.provided} of ${c.required.total}. Qualitative intake level: ${CONFIDENCE_TEXT[c.confidence]} — based only on how many required fields have a value; it is not a technical assessment.`,
    ),
  );
}

/** Bottom bar: completeness indicator, counts, engineer-review status and the Known/Missing drawer. */
export function createStatusBar(controller: Controller): Component {
  let open = false;

  const fill = h('div', { class: 'meter__fill' });
  const track = h('div', { class: 'meter__track', role: 'progressbar', 'aria-label': 'RFQ completeness', 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill);
  const percent = h('strong', { class: 'meter__value' });
  const counts = h('ul', { class: 'counts' });
  const drawer = h('div', { class: 'drawer', id: 'completeness-drawer', hidden: true });
  const toggle = h('button', { type: 'button', class: 'btn btn--ghost drawer-toggle', 'aria-controls': 'completeness-drawer', 'aria-expanded': 'false' });
  toggle.addEventListener('click', () => {
    open = !open;
    sync();
  });

  const el = h(
    'footer',
    { class: 'statusbar' },
    drawer,
    h(
      'div',
      { class: 'statusbar__row' },
      h(
        'div',
        { class: 'meter', title: 'Visual indicator of how much of the form is filled in. Not a technical or scientific measure.' },
        h('span', { class: 'meter__label' }, 'RFQ completeness'),
        track,
        percent,
      ),
      counts,
      h('span', { class: 'badge badge--review statusbar__review' }, h('span', { class: 'badge__extra' }, 'Engineer '), 'review: REQUIRED'),
      toggle,
    ),
  );

  function sync(): void {
    drawer.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = 'KNOWN / MISSING';
  }

  return {
    el,
    update(): void {
      const view = buildEngineeringBrief(controller.session.brief, controller.session.profile);
      const c = view.completeness;
      fill.style.width = `${c.percent}%`;
      track.setAttribute('aria-valuenow', String(c.percent));
      percent.textContent = `${c.percent}%`;
      counts.replaceChildren(
        count('KNOWN', 'Known', c.known.length),
        count('INFERRED', 'Inferred', c.inferred.length),
        count('REQUIRES_ENGINEER_REVIEW', 'Review', c.needsReview.length),
        count('UNKNOWN', 'Missing', c.missing.length),
      );
      drawer.replaceChildren(drawerContent(view));
      sync();
    },
  };
}
