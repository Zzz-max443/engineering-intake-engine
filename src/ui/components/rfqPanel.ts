import { NOT_PROVIDED } from '../../engine/format.ts';
import { stringOf } from '../../models/brief.ts';
import { buildExportText, buildRFQ, RFQ_STATUS_SUFFIX, rfqToText } from '../../rfq/index.ts';
import type { RFQDraft, RFQLine } from '../../rfq/index.ts';
import { copyText } from '../../utils/clipboard.ts';
import { downloadTextFile, timestampedName } from '../../utils/download.ts';
import type { Controller } from '../controller.ts';
import { h } from '../dom.ts';
import type { Component } from './header.ts';

type Mode = 'structured' | 'text';

/** Splits the "(inferred — unconfirmed)" / "(requires engineer review)" wording off a value so it can be highlighted. */
function splitSuffix(text: string): { base: string; tag?: { text: string; modifier: string } } {
  if (text.endsWith(RFQ_STATUS_SUFFIX.INFERRED)) {
    return { base: text.slice(0, -RFQ_STATUS_SUFFIX.INFERRED.length), tag: { text: 'Inferred — unconfirmed', modifier: 'inferred' } };
  }
  if (text.endsWith(RFQ_STATUS_SUFFIX.REQUIRES_ENGINEER_REVIEW)) {
    return {
      base: text.slice(0, -RFQ_STATUS_SUFFIX.REQUIRES_ENGINEER_REVIEW.length),
      tag: { text: 'Requires engineer review', modifier: 'review' },
    };
  }
  return { base: text };
}

function valueLine(text: string): HTMLElement {
  const { base, tag } = splitSuffix(text);
  return h(
    'span',
    { class: `rfq__line${text.startsWith(NOT_PROVIDED) ? ' is-empty' : ''}` },
    base,
    tag ? h('span', { class: `tag tag--${tag.modifier}` }, tag.text) : null,
  );
}

function rfqRow(line: RFQLine): HTMLElement {
  return h(
    'div',
    { class: `rfq__row${line.provided ? '' : ' is-missing'}` },
    h('dt', { class: 'rfq__label' }, line.label),
    h('dd', { class: 'rfq__value' }, ...line.lines.map(valueLine)),
  );
}

function structuredDocument(rfq: RFQDraft): HTMLElement {
  const ctx = rfq.platformContext;
  return h(
    'article',
    { class: 'doc' },
    h(
      'header',
      { class: 'doc__head' },
      h('h3', { class: 'doc__title' }, rfq.title),
      h('p', { class: 'doc__meta' }, `Status: ${rfq.status}`, h('br', {}), `Generated: ${rfq.generatedAt}`),
    ),
    h('dl', { class: 'rfq' }, ...rfq.lines.map(rfqRow)),
    h(
      'section',
      { class: 'doc__section' },
      h('h4', { class: 'doc__heading' }, ctx.heading),
      ctx.available
        ? h('ul', { class: 'doc__list' }, ...ctx.entries.map((entry) => h('li', {}, h('strong', {}, `${entry.name}: `), entry.statement)))
        : h('p', { class: 'doc__none' }, `No platform context shown. ${ctx.reason ?? ''}`.trim()),
      h('p', { class: 'doc__note' }, ctx.disclaimer),
    ),
    h(
      'section',
      { class: 'doc__section' },
      h('h4', { class: 'doc__heading' }, 'Engineer review notes'),
      h('ul', { class: 'doc__list' }, ...rfq.reviewNotes.map((flag) => h('li', {}, flag.message))),
    ),
    h('p', { class: 'doc__disclaimer' }, rfq.disclaimer),
  );
}

/** Right column (second tab): the RFQ draft, with COPY RFQ and DOWNLOAD / EXPORT. */
export function createRfqPanel(controller: Controller): Component {
  const session = controller.session;
  let mode: Mode = 'structured';

  // ---- optional details typed by the user -------------------------------------------------

  const company = h('input', { class: 'field', id: 'rfq-company', type: 'text', autocomplete: 'organization', placeholder: 'Company name' });
  const contact = h('input', { class: 'field', id: 'rfq-contact', type: 'text', autocomplete: 'name', placeholder: 'Contact name' });
  const notes = h('textarea', { class: 'field', id: 'rfq-notes', rows: 1, placeholder: 'Notes for the engineer' });
  company.addEventListener('input', () => session.setRfqDetail('company', company.value));
  contact.addEventListener('input', () => session.setRfqDetail('contactName', contact.value));
  notes.addEventListener('input', () => session.setRfqDetail('additionalNotes', notes.value));

  const form = h(
    'div',
    { class: 'rfq-form' },
    h('div', { class: 'rfq-form__field' }, h('label', { for: 'rfq-company' }, 'Company'), company),
    h('div', { class: 'rfq-form__field' }, h('label', { for: 'rfq-contact' }, 'Contact'), contact),
    h('div', { class: 'rfq-form__field' }, h('label', { for: 'rfq-notes' }, 'Additional notes'), notes),
  );

  // ---- output -------------------------------------------------------------------------------

  const documentHost = h('div', { class: 'doc-host' });

  const structuredButton = h('button', { type: 'button', class: 'segment', onclick: () => setMode('structured') }, 'Structured');
  const textButton = h(
    'button',
    { type: 'button', class: 'segment', title: 'Exactly the text that COPY RFQ puts on the clipboard', onclick: () => setMode('text') },
    'Plain text',
  );
  const segmented = h('div', { class: 'segmented', role: 'group', 'aria-label': 'RFQ view' }, structuredButton, textButton);

  function setMode(next: Mode): void {
    mode = next;
    render();
  }

  const status = h('span', { class: 'sr-only', role: 'status' });
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  const copyButton = h('button', { type: 'button', class: 'btn btn--primary' }, 'COPY RFQ');
  copyButton.addEventListener('click', async () => {
    const ok = await copyText(rfqToText(buildRFQ(session.brief, {}, session.profile)));
    copyButton.textContent = ok ? 'COPIED' : 'COPY FAILED';
    status.textContent = ok ? 'RFQ copied to the clipboard.' : 'Copying failed. Select the text and copy it manually.';
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copyButton.textContent = 'COPY RFQ';
      status.textContent = '';
    }, 2000);
  });

  const downloadButton = h('button', { type: 'button', class: 'btn btn--secondary' }, 'DOWNLOAD / EXPORT');
  downloadButton.addEventListener('click', () => {
    const rfq = buildRFQ(session.brief, {}, session.profile);
    downloadTextFile(timestampedName('rfq-draft', 'txt'), buildExportText(session.brief, rfq, session.profile));
  });

  function render(): void {
    structuredButton.setAttribute('aria-pressed', String(mode === 'structured'));
    textButton.setAttribute('aria-pressed', String(mode === 'text'));
    const rfq = buildRFQ(session.brief, {}, session.profile);
    documentHost.replaceChildren(
      mode === 'structured' ? structuredDocument(rfq) : h('pre', { class: 'doc__pre', tabindex: 0 }, rfqToText(rfq)),
    );
  }

  /** Keep the three inputs in step with the brief (e.g. after NEW INTAKE), without disturbing typing. */
  function syncInputs(): void {
    const values: Array<[HTMLInputElement | HTMLTextAreaElement, string]> = [
      [company, stringOf(session.brief, 'contact.company') ?? ''],
      [contact, stringOf(session.brief, 'contact.contactName') ?? ''],
      [notes, stringOf(session.brief, 'notes.additionalNotes') ?? ''],
    ];
    for (const [control, value] of values) {
      if (document.activeElement !== control && control.value !== value) control.value = value;
    }
  }

  const el = h(
    'section',
    { class: 'panel panel--rfq', 'aria-labelledby': 'rfq-title' },
    h(
      'div',
      { class: 'panel__head panel__head--split' },
      h('div', {}, h('h2', { class: 'panel__title', id: 'rfq-title' }, 'RFQ Draft'), h('p', { class: 'panel__sub' }, 'Draft for human review — not a quotation')),
      h('div', { class: 'panel__actions' }, copyButton, downloadButton),
    ),
    h(
      'div',
      { class: 'panel__body' },
      h('p', { class: 'rfq-tools__label' }, 'Optional details · typed by you'),
      form,
      h('div', { class: 'rfq-tools' }, h('p', { class: 'rfq-tools__label' }, 'Document view'), segmented),
      documentHost,
      status,
    ),
  );

  return {
    el,
    update(): void {
      syncInputs();
      render();
    },
  };
}
