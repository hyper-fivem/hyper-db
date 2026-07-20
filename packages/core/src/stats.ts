/** Observability: per-query timing histograms, cache hit/miss counters and a
 *  slow-query ring buffer. Snapshot is exposed via the `hyperdbStats` export
 *  and the console command — resmon-friendly (no allocation on hot path
 *  beyond a few counter bumps). */

const BUCKET_BOUNDS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000] as const;
const INF_BUCKET = 'inf';

interface QueryStat {
  count: number;
  totalMs: number;
  buckets: Record<string, number>;
}

export interface SlowQueryEntry {
  queryId: string;
  durationMs: number;
  at: number;
}

export interface StatsSnapshot {
  queries: Record<string, QueryStat>;
  cache: { hits: number; misses: number };
  slowQueries: SlowQueryEntry[];
}

export interface StatsOptions {
  slowQueryThresholdMs?: number;
  slowQueryLogSize?: number;
}

export class Stats {
  private queries = new Map<string, QueryStat>();
  private hits = 0;
  private misses = 0;
  private slow: SlowQueryEntry[] = [];
  private readonly slowThreshold: number;
  private readonly slowLogSize: number;

  constructor(options: StatsOptions = {}) {
    this.slowThreshold = options.slowQueryThresholdMs ?? 100;
    this.slowLogSize = options.slowQueryLogSize ?? 100;
  }

  recordQuery(queryId: string, durationMs: number): void {
    let stat = this.queries.get(queryId);
    if (!stat) {
      stat = { count: 0, totalMs: 0, buckets: {} };
      this.queries.set(queryId, stat);
    }
    stat.count += 1;
    stat.totalMs += durationMs;
    const bound = BUCKET_BOUNDS.find((b) => durationMs <= b);
    const key = bound === undefined ? INF_BUCKET : String(bound);
    stat.buckets[key] = (stat.buckets[key] ?? 0) + 1;

    if (durationMs >= this.slowThreshold) {
      this.slow.push({ queryId, durationMs, at: Date.now() });
      if (this.slow.length > this.slowLogSize) this.slow.shift();
    }
  }

  recordCache(hit: boolean): void {
    if (hit) this.hits += 1;
    else this.misses += 1;
  }

  snapshot(): StatsSnapshot {
    return {
      queries: Object.fromEntries(
        [...this.queries].map(([id, s]) => [id, { count: s.count, totalMs: s.totalMs, buckets: { ...s.buckets } }]),
      ),
      cache: { hits: this.hits, misses: this.misses },
      slowQueries: this.slow.map((e) => ({ ...e })),
    };
  }
}
