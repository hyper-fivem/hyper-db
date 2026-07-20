import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { redisTable, rString, rNumber, RedisTableMeta } from '@hyper-db/schema';
import { PgDriver, IoRedisDriver, QueryEngine, QueryCache, HotStore, Locks } from '../../src/index';
import { IT, PG, REDIS } from './it-env';

/** Benchmark stage of the integration suite (PRD F13 / M0 boundary-cost
 *  benchmark). Runs against live docker-compose services, prints a p50/p99
 *  report, and asserts the PRD latency targets with generous CI headroom:
 *    - hot-store read/write: sub-ms target (asserted p50 < 5ms for CI noise)
 *    - registered query via prepared reuse: p50 < 25ms
 *  Numbers print to the console for the comparison report. */

const N = Number(process.env.HYPERDB_BENCH_N ?? '2000');

interface Report {
  label: string;
  p50: number;
  p99: number;
  opsPerSec: number;
}

const reports: Report[] = [];

async function measure(label: string, warmup: number, n: number, op: () => Promise<unknown>): Promise<Report> {
  for (let i = 0; i < warmup; i++) await op();
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    await op();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!;
  const total = samples.reduce((a, b) => a + b, 0);
  const report: Report = { label, p50: at(0.5), p99: at(0.99), opsPerSec: Math.round(n / (total / 1000)) };
  reports.push(report);
  return report;
}

describe.skipIf(!IT)('integration benchmark', () => {
  let pg: PgDriver;
  let redis: IoRedisDriver;

  beforeAll(async () => {
    pg = new PgDriver(PG);
    redis = new IoRedisDriver(REDIS);
    await pg.query('drop table if exists bench_players', []);
    await pg.query('create table bench_players (id uuid primary key, elo integer not null)', []);
    await pg.query("insert into bench_players values ('00000000-0000-4000-8000-000000000001', 1500)", []);
  });

  afterAll(async () => {
    // print the consolidated report table for the benchmark log
    console.log('\n| Benchmark | p50 | p99 | ops/s |');
    console.log('|---|---|---|---|');
    for (const r of reports) {
      console.log(`| ${r.label} | ${r.p50.toFixed(2)}ms | ${r.p99.toFixed(2)}ms | ${r.opsPerSec.toLocaleString()} |`);
    }
    await pg?.close();
    await redis?.close();
  });

  test('registered query with prepared reuse (postgres)', async () => {
    const engine = new QueryEngine(pg);
    engine.register('bench_sel', { sql: 'select * from "bench_players" where "elo" > $1', paramCount: 1 });
    const r = await measure('pg registered select', 200, N, () => engine.execute('bench_sel', [0]));
    expect(r.p50).toBeLessThan(25);
  });

  test('hot-store write + read (redis)', async () => {
    const sessions = redisTable('bench_sessions', {
      keyBy: 'playerId',
      fields: { playerId: rString(), elo: rNumber() },
      ttl: 60,
    });
    const store = new HotStore(redis, sessions[RedisTableMeta]);
    const w = await measure('hot-store write', 200, N, () => store.set('p1', { playerId: 'p1', elo: 1500 }));
    const r = await measure('hot-store read', 200, N, () => store.get('p1'));
    expect(w.p50).toBeLessThan(5); // PRD target: sub-ms; CI headroom 5ms
    expect(r.p50).toBeLessThan(5);
  });

  test('cache hit path (redis-backed read-through)', async () => {
    const cache = new QueryCache(redis);
    const opts = { ttlMs: 60_000, tags: ['bench'] };
    const fetch = async () => pg.query('select * from bench_players', []);
    await cache.cached('bench_q', [], opts, fetch); // prime
    const r = await measure('cache hit', 200, N, () => cache.cached('bench_q', [], opts, fetch));
    expect(r.p50).toBeLessThan(5);
    await cache.invalidateTags(['bench']);
  });

  test('withLock acquire/release (redis)', async () => {
    const locks = new Locks(redis);
    const r = await measure('withLock roundtrip', 100, Math.min(N, 1000), () =>
      locks.withLock('bench:lock', 1000, async () => null),
    );
    expect(r.p50).toBeLessThan(10); // two redis roundtrips
  });
});
