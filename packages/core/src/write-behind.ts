/** Write-behind queue: hot-store writes enqueue here; a timer (or explicit
 *  flushNow) delivers batches to a flusher (SQL upsert in production).
 *  Delivery is at-least-once: a failed batch re-merges into pending, but
 *  never overwrites values written after the failed snapshot was taken. */

export interface WriteBehindEntry {
  key: string;
  row: Record<string, unknown>;
}

export type WriteBehindFlusher = (batch: WriteBehindEntry[]) => Promise<void>;

export interface WriteBehindOptions {
  intervalMs?: number;
  maxBatch?: number;
}

export class WriteBehindQueue {
  private readonly flusher: WriteBehindFlusher;
  private readonly intervalMs: number;
  private readonly maxBatch: number;
  private queue = new Map<string, Record<string, unknown>>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(flusher: WriteBehindFlusher, options: WriteBehindOptions = {}) {
    this.flusher = flusher;
    this.intervalMs = options.intervalMs ?? 1000;
    this.maxBatch = options.maxBatch ?? 500;
  }

  get pending(): number {
    return this.queue.size;
  }

  enqueue(key: string, row: Record<string, unknown>): void {
    const existing = this.queue.get(key);
    this.queue.set(key, existing ? { ...existing, ...row } : { ...row });
  }

  async flushNow(): Promise<void> {
    while (this.queue.size > 0) {
      const snapshot: WriteBehindEntry[] = [];
      for (const [key, row] of this.queue) {
        snapshot.push({ key, row });
        if (snapshot.length >= this.maxBatch) break;
      }
      for (const entry of snapshot) this.queue.delete(entry.key);
      try {
        await this.flusher(snapshot);
      } catch (err) {
        // re-merge under newer writes: pending values win over the snapshot
        for (const entry of snapshot) {
          const newer = this.queue.get(entry.key);
          this.queue.set(entry.key, newer ? { ...entry.row, ...newer } : entry.row);
        }
        throw err;
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flushNow().catch(() => {
        // failed batches stay queued; next tick retries (at-least-once)
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
