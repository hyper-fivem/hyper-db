/** Boundary-cost benchmark (M0 target: measure the hyper-db pipeline overhead
 *  around the driver, independent of the database).
 *
 *  Run: bun run bench/boundary-bench.ts
 *  With a real PG (docker-compose up -d postgres):
 *    HYPERDB_BENCH_PG=1 bun run bench/boundary-bench.ts
 *
 *  oxmysql comparison requires a live FiveM server; this harness reports the
 *  engine-side numbers the comparison will use. */
import { FakeSql, PgDriver, QueryEngine, type SqlDriver } from '@hyper-db/core';

const ITERATIONS = 50_000;

function report(label: string, samples: number[]): void {
  samples.sort((a, b) => a - b);
  const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!;
  const total = samples.reduce((a, b) => a + b, 0);
  console.log(
    `${label.padEnd(28)} ops=${samples.length} ` +
      `p50=${(p(0.5) * 1000).toFixed(1)}µs p99=${(p(0.99) * 1000).toFixed(1)}µs ` +
      `throughput=${Math.round(samples.length / (total / 1000)).toLocaleString()} ops/s`,
  );
}

async function bench(label: string, driver: SqlDriver, iterations: number): Promise<void> {
  const engine = new QueryEngine(driver);
  engine.register('bench', { sql: 'select 1 as one', paramCount: 0 });
  // warmup
  for (let i = 0; i < 1000; i++) await engine.execute('bench', []);
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await engine.execute('bench', []);
    samples.push(performance.now() - start);
  }
  report(label, samples);
}

await bench('engine overhead (fake sql)', new FakeSql('pg'), ITERATIONS);

if (process.env.HYPERDB_BENCH_PG === '1') {
  const pg = new PgDriver({
    host: process.env.HYPERDB_PG_HOST ?? 'localhost',
    port: Number(process.env.HYPERDB_PG_PORT ?? '5433'),
    database: process.env.HYPERDB_PG_DB ?? 'hyperdb',
    username: process.env.HYPERDB_PG_USER ?? 'hyper',
    password: process.env.HYPERDB_PG_PASSWORD ?? 'hyper',
  });
  await bench('end-to-end (postgres)', pg, 5_000);
  await pg.close();
}
