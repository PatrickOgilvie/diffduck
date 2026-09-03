/** Own SDK setup, UI callbacks and asynchronous teardown across React mounts. */
export class AppLifetime {
  private readonly abort = new AbortController();
  private readonly tasks = new Set<Promise<void>>();
  private disposed = false;

  /** Report safe UI failures only while this lifetime remains mounted. */
  constructor(private readonly onFailure: () => void) {}

  /** Supervise an async operation and pass down the owning lifetime's cancellation. */
  run(operation: (signal: AbortSignal) => Promise<void>): void {
    if (this.disposed) return;
    this.own(async () => operation(this.abort.signal));
  }

  /** Abort setup, await outstanding work, then close owned external resources. */
  dispose(cleanup: () => Promise<void>): void {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort();
    const outstanding = [...this.tasks];
    this.own(async () => { await Promise.allSettled(outstanding); await cleanup(); });
  }

  private own(operation: () => Promise<void>): void {
    const task = operation().catch(() => { if (!this.disposed) this.onFailure(); }).finally(() => { this.tasks.delete(task); });
    this.tasks.add(task);
  }
}
