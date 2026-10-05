import { IntakeSession } from '../src/engine/index.ts';
import type { RFQDraft } from '../src/engine/index.ts';
import { buildRFQ, rfqToText } from '../src/engine/index.ts';
import { FIELD_IDS } from '../src/models/types.ts';
import type { ApplicationBrief, FieldId } from '../src/models/types.ts';
import { getField, hasValue } from '../src/models/brief.ts';

/** A fresh session that has received one free-text description. */
export async function runInput(text: string): Promise<IntakeSession> {
  const session = new IntakeSession();
  await session.submit(text);
  return session;
}

/**
 * Every question the engine would ask, in order, if the user skipped each one.
 * Used to prove that known data is never asked again and that the question flow terminates.
 */
export async function questionSequence(text: string, cap = 80): Promise<string[]> {
  const session = await runInput(text);
  const asked: string[] = [];
  while (session.currentQuestion && asked.length < cap) {
    asked.push(session.currentQuestion.fieldId);
    await session.skip();
  }
  if (session.currentQuestion) throw new Error(`Question flow did not terminate within ${cap} questions`);
  return asked;
}

export function draft(session: IntakeSession, options: Parameters<typeof buildRFQ>[1] = {}): RFQDraft {
  return buildRFQ(session.brief, options, session.profile);
}

/** RFQ plain text with runs of spaces collapsed, so tests do not depend on column padding. */
export function rfqPlain(session: IntakeSession, options: Parameters<typeof buildRFQ>[1] = {}): string {
  return rfqToText(draft(session, options)).replace(/ {2,}/g, ' ');
}

/** Fields that currently hold a user-stated value (the description itself is not a technical datum). */
export function knownFieldIds(brief: ApplicationBrief): FieldId[] {
  return FIELD_IDS.filter((id) => {
    if (id === 'application.description') return false;
    const field = getField(brief, id);
    return field.status === 'KNOWN' && hasValue(field);
  });
}

/** Lower-case alphanumeric tokens of a text. */
export function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
