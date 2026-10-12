/**
 * Limits concurrent outbound HTTP calls to 1C and coalesces identical in-flight
 * requests (single-flight). Shared by FitGO Integration and Analytics providers.
 */

export class RequestGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(key: string | null, fn: () => Promise<T>): Promise<T> {
    if (key) {
      const existing = this.inflight.get(key);
      if (existing) return existing as Promise<T>;
    }

    const run = (async () => {
      await this.acquire();
      try {
        return await fn();
      } finally {
        this.release();
      }
    })();

    if (key) {
      this.inflight.set(key, run);
      // finally() returns a NEW promise that re-rejects on failure — voiding it
      // without .catch() is an unhandled rejection and kills Nest (Node 15+).
      void run
        .finally(() => {
          if (this.inflight.get(key) === run) this.inflight.delete(key);
        })
        .catch(() => undefined);
    }
    return run;
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release() {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}
