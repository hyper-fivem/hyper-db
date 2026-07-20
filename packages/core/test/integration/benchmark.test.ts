import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { redisTable, rString, rNumber, RedisTableMeta } from '@hyper-db/schema';
import { PgDriver, MysqlDriver, IoRedisDriver, QueryEngine, QueryCache, HotStore, Locks } from '../../src/index';
import { IT, PG, MYSQL, REDIS } from './it-env';

/** Benchmark stage of the integration suite (PRD F13 / M0 boundary-cost
 *  benchmark). Runs against live services, prints a p50/p99 report, and
 *  asserts the PRD latency targets with CI headroom:
 *    - hot-store read/write: sub-ms target (asserted p50 < 5ms for CI noise)
 *    - registered query via prepared reuse: p50 < 25ms
 *
 *  HYPERDB_BENCH_ONLY=pg|mysql|redis runs a single stage so each database
 *  can be benchmarked in isolation (other services stopped). Unset = all. */

const N = Number(process.env.HYPERDB_BENCH_N ?? '2000');
const ONLY = process.env.HYPERDB_BENCH_ONLY;

const runPg = IT && (!ONLY || ONLY === 'pg');
const runMysql = IT && (!ONLY || ONLY === 'mysql');
const runRedis = IT && (!ONLY || ONLY === 'redis');

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
  let pg: PgDriver | undefined;
  let mysql: MysqlDriver | undefined;
  let redis: IoRedisDriver | undefined;

  beforeAll(async () => {
    if (runPg) {
      pg = new PgDriver(PG);
      await pg.query('drop table if exists bench_players', []);
      await pg.query('create table bench_players (id uuid primary key, elo integer not null)', []);
      await pg.query("insert into bench_players values ('00000000-0000-4000-8000-000000000001', 1500)", []);
    }
    if (runMysql) {
      mysql = new MysqlDriver(MYSQL);
      await mysql.query('drop table if exists bench_players', []);
      await mysql.query('create table bench_players (id varchar(36) primary key, elo int not null)', []);
      await mysql.query("insert into bench_players values ('00000000-0000-4000-8000-000000000001', 1500)", []);
    }
    if (runRedis) {
      redis = new IoRedisDriver(REDIS);
    }
  }, 120_000);

  afterAll(async () => {
    // print the consolidated report table for the benchmark log
    console.log('\n| Benchmark | p50 | p99 | ops/s |');
    console.log('|---|---|---|---|');
    for (const r of reports) {
      console.log(`| ${r.label} | ${r.p50.toFixed(2)}ms | ${r.p99.toFixed(2)}ms | ${r.opsPerSec.toLocaleString()} |`);
    }
    await pg?.close();
    await mysql?.close();
    await redis?.close();
  }, 120_000);

  test.skipIf(!runPg)('registered select with prepared reuse (postgres)', async () => {
    const engine = new QueryEngine(pg!);
    engine.register('bench_sel', { sql: 'select * from "bench_players" where "elo" > $1', paramCount: 1 });
    const r = await measure('pg registered select', 200, N, () => engine.execute('bench_sel', [0]));
    expect(r.p50).toBeLessThan(25);
  }, 120_000);

  test.skipIf(!runPg)('upsert on conflict (postgres)', async () => {
    const engine = new QueryEngine(pg!);
    engine.register('bench_up', {
      sql: 'insert into "bench_players" ("id", "elo") values ($1, $2) on conflict ("id") do update set "elo" = $3',
      paramCount: 3,
    });
    const r = await measure('pg upsert', 200, N, () =>
      engine.execute('bench_up', ['00000000-0000-4000-8000-000000000002', 1000, 1001]),
    );
    expect(r.p50).toBeLessThan(25);
  }, 120_000);

  test.skipIf(!runMysql)('registered select (mariadb)', async () => {
    const engine = new QueryEngine(mysql!);
    engine.register('bench_sel', { sql: 'select * from `bench_players` where `elo` > ?', paramCount: 1 });
    const r = await measure('mysql registered select', 200, N, () => engine.execute('bench_sel', [0]));
    expect(r.p50).toBeLessThan(25);
  }, 120_000);

  test.skipIf(!runMysql)('upsert on duplicate key (mariadb)', async () => {
    const engine = new QueryEngine(mysql!);
    engine.register('bench_up', {
      sql: 'insert into `bench_players` (`id`, `elo`) values (?, ?) on duplicate key update `elo` = ?',
      paramCount: 3,
    });
    const r = await measure('mysql upsert', 200, N, () =>
      engine.execute('bench_up', ['00000000-0000-4000-8000-000000000002', 1000, 1001]),
    );
    expect(r.p50).toBeLessThan(25);
  }, 120_000);

  test.skipIf(!runRedis)('hot-store write + read (redis)', async () => {
    const sessions = redisTable('bench_sessions', {
      keyBy: 'playerId',
      fields: { playerId: rString(), elo: rNumber() },
      ttl: 60,
    });
    const store = new HotStore(redis!, sessions[RedisTableMeta]);
    const w = await measure('hot-store write', 200, N, () => store.set('p1', { playerId: 'p1', elo: 1500 }));
    const r = await measure('hot-store read', 200, N, () => store.get('p1'));
    expect(w.p50).toBeLessThan(5); // PRD target: sub-ms; CI headroom 5ms
    expect(r.p50).toBeLessThan(5);
  }, 120_000);

  test.skipIf(!runRedis)('cache hit path (redis read-through)', async () => {
    const cache = new QueryCache(redis!);
    const opts = { ttlMs: 60_000, tags: ['bench'] };
    // synthetic fetch: this measures the redis hit path, not the SQL miss path
    const fetch = async () => [{ id: '1', elo: 1500 }];
    await cache.cached('bench_q', [], opts, fetch); // prime
    const r = await measure('cache hit', 200, N, () => cache.cached('bench_q', [], opts, fetch));
    expect(r.p50).toBeLessThan(5);
    await cache.invalidateTags(['bench']);
  }, 120_000);

  test.skipIf(!runRedis)('withLock acquire/release (redis)', async () => {
    const locks = new Locks(redis!);
    const r = await measure('withLock roundtrip', 100, Math.min(N, 1000), () =>
      locks.withLock('bench:lock', 1000, async () => null),
    );
    expect(r.p50).toBeLessThan(10); // two redis roundtrips
  }, 120_000);
});
