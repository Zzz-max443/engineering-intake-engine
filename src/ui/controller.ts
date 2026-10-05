import { DEMO_CASE_TEXT } from '../data/demo.ts';
import type { IntakeSession } from '../engine/index.ts';

export type View = 'brief' | 'rfq';

/**
 * UI-only state (busy flag, active tab, last error) and the single re-render signal.
 * It never interprets text: every action is forwarded to the IntakeSession.
 */
export class Controller {
  readonly session: IntakeSession;
  busy = false;
  view: View = 'brief';
  error: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(session: IntakeSession) {
    this.session = session;
    session.subscribe(() => this.notify());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** Runs one action with the busy flag set, so controls are disabled while it is in flight. */
  async run(task: () => Promise<void> | void): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.notify();
    try {
      await task();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      console.error(error);
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  submit(text: string): Promise<void> {
    return this.run(() => this.session.submit(text));
  }

  skip(): Promise<void> {
    return this.run(() => this.session.skip());
  }

  markUnknown(): Promise<void> {
    return this.run(() => this.session.markUnknown());
  }

  finish(): Promise<void> {
    return this.run(() => this.session.finish());
  }

  /** LOAD DEMO CASE: start over and feed the demo description through the normal pipeline. */
  loadDemo(): Promise<void> {
    return this.run(async () => {
      this.session.reset();
      await this.session.submit(DEMO_CASE_TEXT);
    });
  }

  newIntake(): void {
    this.error = null;
    this.session.reset();
  }

  setView(view: View): void {
    if (this.view === view) return;
    this.view = view;
    this.notify();
  }

  /** True once the user has typed anything, i.e. there is something a reset would discard. */
  hasContent(): boolean {
    return this.session.transcript.length > 0;
  }
}
