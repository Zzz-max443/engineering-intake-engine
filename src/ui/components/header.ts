import { SAFETY_NOTICE } from '../../data/products.ts';
import type { Controller } from '../controller.ts';
import { h } from '../dom.ts';

export interface Component {
  el: HTMLElement;
  update(): void;
}

/** Product bar: name, scope, and the two global actions. */
export function createHeader(controller: Controller): Component {
  const demoButton = h(
    'button',
    { type: 'button', class: 'btn btn--secondary', onclick: () => void controller.loadDemo() },
    'LOAD DEMO CASE',
  );

  let confirming = false;
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  const resetButton = h('button', { type: 'button', class: 'btn btn--ghost' }, 'NEW INTAKE');

  const stopConfirming = () => {
    confirming = false;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = undefined;
  };

  // Two clicks to discard work: the first arms the button, the second resets.
  resetButton.addEventListener('click', () => {
    if (!controller.hasContent()) return;
    if (!confirming) {
      confirming = true;
      confirmTimer = setTimeout(() => {
        stopConfirming();
        update();
      }, 4000);
      update();
      return;
    }
    stopConfirming();
    controller.newIntake();
  });

  const el = h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      { class: 'brand' },
      h('span', { class: 'brand__mark', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'brand__text' },
        h('h1', { class: 'brand__name' }, 'Engineering Intake Engine'),
        h('p', { class: 'brand__scope' }, 'Potting & Encapsulation · v0.1'),
      ),
    ),
    h('div', { class: 'topbar__actions' }, demoButton, resetButton),
  );

  function update(): void {
    demoButton.disabled = controller.busy;
    resetButton.disabled = controller.busy || !controller.hasContent();
    resetButton.textContent = confirming ? 'CLICK AGAIN TO DISCARD' : 'NEW INTAKE';
    resetButton.classList.toggle('btn--danger', confirming);
    if (!controller.hasContent() && confirming) stopConfirming();
  }

  return { el, update };
}

/** Always-visible scope notice (the exact text comes from the data layer). */
export function createNotice(): HTMLElement {
  const cut = SAFETY_NOTICE.indexOf('. ') + 1;
  const lead = cut > 0 ? SAFETY_NOTICE.slice(0, cut) : SAFETY_NOTICE;
  const rest = cut > 0 ? SAFETY_NOTICE.slice(cut).trim() : '';
  return h(
    'div',
    { class: 'notice', role: 'note' },
    h('span', { class: 'notice__tag' }, 'SCOPE'),
    h('p', { class: 'notice__text' }, h('strong', {}, lead), rest ? ` ${rest}` : ''),
  );
}
