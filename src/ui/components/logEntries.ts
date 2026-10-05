import type { TranscriptEntry, UnderstoodItem } from '../../engine/index.ts';
import type { Question } from '../../questions/types.ts';
import { h } from '../dom.ts';
import { statusChip, statusModifier } from './statusChip.ts';

const PRIORITY_LABEL = {
  REQUIRED: 'Required',
  USEFUL: 'Useful',
  OPTIONAL: 'Optional',
  ENGINEER_REVIEW: 'Engineer review',
} as const;

/** Short label for a question: how important the answer is, or why it is being asked. */
export function questionTag(question: Question): { text: string; modifier: string } {
  if (question.mode === 'CLARIFY') return { text: 'Clarification', modifier: 'clarify' };
  if (question.mode === 'UNIT') return { text: 'Unit', modifier: 'unit' };
  return { text: PRIORITY_LABEL[question.priority], modifier: question.priority.toLowerCase().replace('_', '-') };
}

function understoodRow(item: UnderstoodItem): HTMLElement {
  return h(
    'li',
    { class: `understood__row understood__row--${statusModifier(item.status)}` },
    h('span', { class: 'understood__label' }, item.label),
    h('span', { class: 'understood__value' }, item.value),
    statusChip(item.status),
    item.note ? h('span', { class: 'understood__note' }, item.note) : null,
  );
}

/** One transcript entry as a log line (not a chat bubble). Text always goes in as text, never as markup. */
export function renderEntry(entry: TranscriptEntry): HTMLElement {
  switch (entry.type) {
    case 'user':
      return h(
        'article',
        { class: 'entry entry--user', 'data-entry': entry.id },
        h('div', { class: 'entry__who' }, 'You'),
        h('p', { class: 'entry__text' }, entry.text),
      );

    case 'understood':
      return h(
        'article',
        { class: 'entry entry--engine', 'data-entry': entry.id },
        h('div', { class: 'entry__who' }, 'Intake'),
        h('p', { class: 'entry__text' }, entry.intro),
        h('ul', { class: 'understood' }, ...entry.items.map(understoodRow)),
        entry.outro ? h('p', { class: 'entry__text entry__text--dim' }, entry.outro) : null,
      );

    case 'question': {
      const tag = questionTag(entry.question);
      return h(
        'article',
        { class: 'entry entry--question', 'data-entry': entry.id, 'data-question': entry.question.id },
        h('div', { class: 'entry__who' }, 'Question', h('span', { class: `tag tag--${tag.modifier}` }, tag.text)),
        h('p', { class: 'entry__prompt' }, entry.question.prompt),
        entry.question.hint ? h('p', { class: 'entry__hint' }, entry.question.hint) : null,
      );
    }

    case 'notice':
      return h(
        'p',
        {
          class: `entry-notice entry-notice--${entry.tone}`,
          'data-entry': entry.id,
          role: entry.tone === 'warning' ? 'alert' : undefined,
        },
        entry.text,
      );

    case 'complete':
      return h('p', { class: 'entry-complete', 'data-entry': entry.id }, entry.text);
  }
}
