import { randomUUID } from 'node:crypto';

export interface PauseContext {
  fileName?: string;
  scenario?: string;
  stepId?: string;
  attempt?: number;
  profile?: string;
  sourceLine?: number;
}

export interface PauseState extends PauseContext {
  id: string;
  message: string;
  cancelled?: boolean;
}

export const isPauseId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Controls only explicit waits and interactive pauses; it never changes browser visibility. */
export class ExecutionControl {
  private cancelled = false;
  private delays = new Set<() => void>();
  private pending: { state: PauseState; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(
    private onPaused?: (pause: PauseState) => void,
    private onResumed?: (pause: PauseState) => void,
  ) {}

  public get pendingPause(): PauseState | null {
    return this.pending ? { ...this.pending.state } : null;
  }

  public delay(ms: number): Promise<void> {
    if (!Number.isSafeInteger(ms) || ms < 0 || ms > 86400000) return Promise.reject(new Error('Wait duration must be a whole number between 0 and 86400000 milliseconds.'));
    if (this.cancelled) return Promise.reject(new Error('Execution cancelled.'));
    if (ms === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        this.delays.delete(cancel);
        reject(new Error('Execution cancelled.'));
      };
      const timer = setTimeout(() => { this.delays.delete(cancel); resolve(); }, ms);
      this.delays.add(cancel);
    });
  }

  public pause(message: string, context: PauseContext = {}): Promise<void> {
    if (this.cancelled) return Promise.reject(new Error('Execution cancelled.'));
    if (this.pending) return Promise.reject(new Error('Execution is already paused.'));
    const state: PauseState = { ...context, id: randomUUID(), message };
    return new Promise((resolve, reject) => {
      this.pending = { state, resolve, reject };
      try { this.onPaused?.({ ...state }); }
      catch (error) { this.pending = null; reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  public resume(id: string): boolean {
    if (!isPauseId(id) || !this.pending || this.pending.state.id !== id || this.cancelled) return false;
    const pending = this.pending;
    this.pending = null;
    // An observer failure must not keep the execution suspended after a valid resume.
    try { this.onResumed?.({ ...pending.state }); } catch { /* Execution must still resume if a telemetry observer disconnects. */ }
    pending.resolve();
    return true;
  }

  public cancel(): void {
    this.cancelled = true;
    for (const cancel of [...this.delays]) cancel();
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    try { this.onResumed?.({ ...pending.state, cancelled: true }); } catch { /* Cancellation must always settle pending work. */ }
    pending.reject(new Error('Execution cancelled.'));
  }

  public reset(): void {
    try { this.cancel(); } finally { this.cancelled = false; }
  }
}
