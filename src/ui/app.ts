import type { Controller, View } from './controller.ts';
import { createBriefPanel } from './components/briefPanel.ts';
import { createHeader, createNotice } from './components/header.ts';
import { createIntakePanel } from './components/intakePanel.ts';
import { createRfqPanel } from './components/rfqPanel.ts';
import { createStatusBar } from './components/statusBar.ts';
import { h } from './dom.ts';

const TABS: Array<{ view: View; label: string }> = [
  { view: 'brief', label: 'ENGINEERING BRIEF' },
  { view: 'rfq', label: 'RFQ DRAFT' },
];

/**
 * Builds the page and wires one re-render to the controller. The UI only calls the engine through
 * the IntakeSession and the build* functions; it contains no extraction or business rules.
 *
 * Layout: intake | brief | RFQ on wide screens, intake | tabbed (brief or RFQ) on laptops,
 * and intake -> brief -> RFQ stacked on phones (see styles/layout.css).
 */
export function mountApp(root: HTMLElement, controller: Controller): void {
  const header = createHeader(controller);
  const intake = createIntakePanel(controller);
  const brief = createBriefPanel(controller);
  const rfq = createRfqPanel(controller);
  const status = createStatusBar(controller);

  const tabButtons = TABS.map((tab) =>
    h('button', { type: 'button', class: 'tab', onclick: () => controller.setView(tab.view) }, tab.label),
  );
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Right column view' }, ...tabButtons);

  const stack = h('div', { class: 'stack' }, tabs, brief.el, rfq.el);
  const workspace = h('main', { class: 'workspace' }, intake.el, stack);

  const app = h('div', { class: 'app' }, header.el, createNotice(), workspace, status.el);
  root.replaceChildren(app);

  const render = (): void => {
    header.update();
    intake.update();
    brief.update();
    rfq.update();
    status.update();
    workspace.dataset['view'] = controller.view;
    TABS.forEach((tab, i) => {
      const button = tabButtons[i];
      if (!button) return;
      const active = tab.view === controller.view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  controller.subscribe(render);
  render();
}
