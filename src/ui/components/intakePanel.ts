import type { Question } from '../../questions/types.ts';
import type { Controller } from '../controller.ts';
import { h } from '../dom.ts';
import type { Component } from './header.ts';
import { renderEntry } from './logEntries.ts';

const EXAMPLES = [
  'We use a 10:1 epoxy and need 100 cc/min.',
  'We manually dispense silicone into electronic housings.',
  'We need a robotic potting system.',
];

const MAX_INPUT_HEIGHT = 168;

function autoGrow(area: HTMLTextAreaElement): void {
  area.style.height = 'auto';
  area.style.height = `${Math.min(area.scrollHeight + 2, MAX_INPUT_HEIGHT)}px`;
}

/** Left column: the intake log and the single input the user answers in. */
export function createIntakePanel(controller: Controller): Component {
  const session = controller.session;

  const log = h('div', { class: 'log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const dock = h('div', { class: 'dock' });
  const errorLine = h('p', { class: 'dock__error', role: 'alert', hidden: true });

  let renderedIds: number[] = [];
  let dockKey = '';
  let input: HTMLTextAreaElement | null = null;
  let focusWhenReady = false;

  // ---- intro (shown until the first message) -----------------------------------------------

  const intro = h(
    'div',
    { class: 'intro' },
    h('p', { class: 'intro__lead' }, 'Describe the application in your own words.'),
    h(
      'p',
      { class: 'intro__body' },
      'The tool extracts what you state, shows what it understood, and asks only for what is missing — one question at a time. ' +
        'Whatever it cannot read stays “Unknown”. Nothing is estimated or filled in for you.',
    ),
    h('p', { class: 'intro__label' }, 'TRY AN EXAMPLE'),
    h(
      'div',
      { class: 'examples' },
      ...EXAMPLES.map((text) =>
        h(
          'button',
          {
            type: 'button',
            class: 'example',
            onclick: () => {
              if (!input || session.phase !== 'AWAITING_DESCRIPTION') return;
              input.value = text;
              autoGrow(input);
              input.focus();
            },
          },
          text,
        ),
      ),
    ),
  );
  log.append(intro);

  // ---- actions -----------------------------------------------------------------------------

  function send(text: string): void {
    const value = text.trim();
    if (!value || controller.busy) return;
    if (input) {
      input.value = '';
      autoGrow(input);
    }
    focusWhenReady = true;
    void controller.submit(value);
  }

  function act(task: () => Promise<void>): void {
    if (controller.busy) return;
    focusWhenReady = true;
    void task();
  }

  function textArea(rows: number, placeholder: string, label: string, numeric = false): HTMLTextAreaElement {
    const area = h('textarea', {
      class: 'field',
      id: 'intake-input',
      rows,
      placeholder,
      'aria-label': label,
      autocomplete: 'off',
      spellcheck: false,
      ...(numeric ? { inputmode: 'decimal' } : {}),
    });
    area.addEventListener('input', () => autoGrow(area));
    return area;
  }

  /** Enter sends (Shift+Enter = new line) unless `needsModifier`, where Ctrl/Cmd+Enter sends. */
  function wireEnter(area: HTMLTextAreaElement, needsModifier: boolean): void {
    area.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      const wantsSend = needsModifier ? event.ctrlKey || event.metaKey : !event.shiftKey;
      if (!wantsSend) return;
      event.preventDefault();
      send(area.value);
    });
  }

  // ---- docks (the area under the log) -------------------------------------------------------

  function descriptionDock(): HTMLElement {
    const area = textArea(
      4,
      'Describe your application. Example: We need to automatically pot 500 electronic modules per hour using a two-component epoxy.',
      'Application description',
    );
    wireEnter(area, true);
    input = area;
    return h(
      'form',
      { class: 'dock__form', onsubmit: (e: Event) => { e.preventDefault(); send(area.value); } },
      h('label', { class: 'dock__label', for: 'intake-input' }, 'APPLICATION DESCRIPTION', h('span', { class: 'dock__keys' }, 'Ctrl+Enter to analyze')),
      area,
      h(
        'div',
        { class: 'dock__actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'ANALYZE DESCRIPTION'),
        h('button', { type: 'button', class: 'btn btn--secondary', onclick: () => act(() => controller.loadDemo()) }, 'LOAD DEMO CASE'),
      ),
    );
  }

  function questionDock(question: Question): HTMLElement {
    const numeric = question.kind === 'number' || question.kind === 'count';
    const area = textArea(1, question.placeholder ?? 'Type your answer', question.prompt, numeric);
    wireEnter(area, false);
    input = area;
    const choices = question.choices ?? [];
    return h(
      'form',
      { class: 'dock__form', onsubmit: (e: Event) => { e.preventDefault(); send(area.value); } },
      h('label', { class: 'dock__label', for: 'intake-input' }, 'YOUR ANSWER', h('span', { class: 'dock__keys' }, 'Enter to send · Shift+Enter for a new line')),
      choices.length > 0
        ? h(
            'div',
            { class: 'choices', role: 'group', 'aria-label': 'Suggested answers' },
            ...choices.map((choice) => h('button', { type: 'button', class: 'choice', onclick: () => send(choice.value) }, choice.label)),
          )
        : null,
      h('div', { class: 'dock__row' }, area, h('button', { type: 'submit', class: 'btn btn--primary' }, 'SEND')),
      h(
        'div',
        { class: 'dock__actions' },
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => act(() => controller.markUnknown()) }, "I DON'T KNOW"),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => act(() => controller.skip()) }, 'SKIP'),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn--link', onclick: () => act(() => controller.finish()) }, 'FINISH INTAKE'),
      ),
    );
  }

  function completeDock(): HTMLElement {
    const area = textArea(2, 'Add or correct information, e.g. “The viscosity of component A is 5000 cP.”', 'Additional information');
    wireEnter(area, true);
    input = area;
    return h(
      'form',
      { class: 'dock__form', onsubmit: (e: Event) => { e.preventDefault(); send(area.value); } },
      h('label', { class: 'dock__label', for: 'intake-input' }, 'ADD OR CORRECT INFORMATION', h('span', { class: 'dock__keys' }, 'Ctrl+Enter to add')),
      area,
      h('div', { class: 'dock__actions' }, h('button', { type: 'submit', class: 'btn btn--primary' }, 'ADD TO BRIEF')),
    );
  }

  function rebuildDock(): void {
    input = null;
    dock.replaceChildren();
    const question = session.currentQuestion;
    if (session.phase === 'AWAITING_DESCRIPTION') dock.append(descriptionDock());
    else if (session.phase === 'ASKING' && question) dock.append(questionDock(question));
    else dock.append(completeDock());
  }

  // ---- rendering ---------------------------------------------------------------------------

  function syncLog(): void {
    const entries = session.transcript;
    if (entries.length < renderedIds.length || (renderedIds.length > 0 && entries[0]?.id !== renderedIds[0])) {
      for (const node of Array.from(log.querySelectorAll('[data-entry]'))) node.remove();
      renderedIds = [];
    }
    let added = false;
    for (const entry of entries.slice(renderedIds.length)) {
      log.append(renderEntry(entry));
      renderedIds.push(entry.id);
      added = true;
    }
    intro.hidden = entries.length > 0;

    // Only the question currently waiting for an answer is highlighted.
    const lastQuestion = [...entries].reverse().find((entry) => entry.type === 'question');
    const activeId = session.currentQuestion && lastQuestion ? String(lastQuestion.id) : null;
    for (const node of Array.from(log.querySelectorAll('.entry--question'))) {
      node.classList.toggle('is-active', node.getAttribute('data-entry') === activeId);
    }
    if (added) requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }

  function syncDock(): void {
    const key = `${session.phase}|${session.currentQuestion?.id ?? ''}`;
    if (key !== dockKey) {
      dockKey = key;
      rebuildDock();
    }
    const busy = controller.busy;
    dock.toggleAttribute('aria-busy', busy);
    for (const control of Array.from(dock.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea'))) {
      control.disabled = busy;
    }
    errorLine.hidden = controller.error === null;
    errorLine.textContent = controller.error === null ? '' : `That message could not be processed: ${controller.error}`;
    if (focusWhenReady && !busy && input) {
      focusWhenReady = false;
      input.focus({ preventScroll: true });
    }
  }

  const el = h(
    'section',
    { class: 'panel panel--intake', 'aria-labelledby': 'intake-title' },
    h(
      'div',
      { class: 'panel__head' },
      h('h2', { class: 'panel__title', id: 'intake-title' }, 'Intake'),
      h('p', { class: 'panel__sub' }, 'Application description and follow-up questions'),
    ),
    log,
    errorLine,
    dock,
  );

  return {
    el,
    update(): void {
      syncLog();
      syncDock();
    },
  };
}
