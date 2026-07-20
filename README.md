# hyper-db

**PostgreSQL + Redis hybrid, type-safe, Drizzle-like driver + ORM for FiveM.**

One TypeScript (Node 22) core resource owns every database connection. Lua, C#
(Mono v2) and TypeScript consumers run queries through codegen-produced typed
APIs — the only thing that ever crosses the runtime boundary is
`queryId + flat params` (or a flat chain descriptor for dynamic queries).

Part of the [hyper-framework](https://github.com/hyper-framework) org. License: GPL-3.0.

## Why

FiveM DB access today is effectively locked to oxmysql: string SQL, no type
safety, no cache layer, no PostgreSQL. hyper-db gives you:

- **Type safety** — one TS schema, typed APIs in three languages, compile-time
  schema mismatch errors.
- **Performance** — static queries compile to SQL ahead of time, PG prepared
  statements are reused, hot data lives in Redis (sub-ms).
- **PostgreSQL first-class** — JSONB, `RETURNING`, `ON CONFLICT`; MariaDB
  supported as a separate dialect module (no common-denominator tax).
- **Explicit caching** — TTL + tag invalidation, fully declarative. No magic.

## Repo layout

| Package | What it is |
|---|---|
| `packages/schema` | Schema DSL (`pg-core`, `mysql-core`), query AST, SQL compilers, `redisTable` hot-store DSL, stable queryId hashing |
| `packages/core` | Engine: query pipeline, declarative cache, hot-store + write-behind, locks/rate-limit, pub/sub, stats, drivers (postgres.js / mariadb / ioredis + in-memory fakes) |
| `packages/codegen` | `hyperdb` CLI: TS/Lua/C# emitters + migrations (snapshot → diff → SQL) |
| `packages/client-lua` | Lua runtime (`:await()` coroutines, chain builder) |
| `packages/client-cs` | C# Mono v2 runtime (`Coroutine<T>`, isolated + convar-gated) |
| `resource/` | The FiveM resource: fxmanifest + esbuild bundle |

## Quickstart

```bash
bun install
bun test                 # unit + golden + snapshot tests
docker-compose up -d     # postgres :5433, mariadb :3307, redis :6379
HYPERDB_IT=1 bun test packages/core/test/integration   # incl. benchmark stage
```

Compose maps host ports 5433/3307 so locally installed PostgreSQL/XAMPP
services on 5432/3306 keep working. Override via `HYPERDB_PG_PORT`,
`HYPERDB_MYSQL_PORT`, `HYPERDB_REDIS_PORT` etc. (see
`packages/core/test/integration/it-env.ts`).

### 1. Define your schema (single source of truth)

```ts
// schema.ts
import { hyperTable, uuid, text, integer } from '@hyper-db/schema/pg-core';
import { redisTable, rString, rNumber } from '@hyper-db/schema';
import { select, gt } from '@hyper-db/schema';

export const players = hyperTable('players', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  elo: integer().notNull().default(1000),
});

export const sessions = redisTable('sessions', {
  keyBy: 'playerId',
  fields: { playerId: rString(), elo: rNumber() },
  ttl: 3600,
  writeBehind: { table: 'sessions_archive', intervalMs: 5000 },
});

export default {
  dialect: 'pg' as const,
  tables: [players],
  queries: {
    topPlayers: select(players).where(gt(players.elo, 0)).orderBy(players.elo, 'desc').limit(0),
  },
};
```

### 2. Generate typed APIs + migrations

```bash
bunx hyperdb codegen  --schema schema.ts --out generated/
bunx hyperdb generate --schema schema.ts --out migrations/
bunx hyperdb push     --schema schema.ts   # dev: apply schema directly
```

### 3. Query from any runtime

```lua
-- Lua (generated, EmmyLua-typed)
local top = Players.where('elo', '>', 2000):orderBy('elo', 'desc'):limit(10):await()
local rows = Players.topPlayers(2000, 10):await()
```

```csharp
// C# Mono v2 (generated DTO + builder; keep a Lua/TS fallback!)
var top = await Db.Players.Where(Players.Elo.Gt(2000)).OrderByDesc(Players.Elo).Limit(10).Execute();
```

```ts
// TS consumer resource: register the generated manifest once, then execute
exports['hyper-db'].registerQueries(queries);
exports['hyper-db'].execute(queries.topPlayers.queryId, [2000, 10], cb);
```

### FiveM server config

```cfg
ensure hyper-db
set hyperdb_dialect "pg"
set hyperdb_pg_host "localhost"
set hyperdb_pg_db "hyperdb"
set hyperdb_pg_user "hyper"
set hyperdb_pg_password "hyper"
set hyperdb_redis_host "localhost"
```

Build the resource bundle with `bun run build` (writes `resource/dist/server.js`).
Stats: `hyperdb_stats` console command or the `hyperdbStats` export.

### Error logs

Failures print one structured markdown block to the server console (code,
message, context table, SQL, params, actionable hint) — designed to be
directly parseable by AI agents reading console output:

```markdown
### ❌ hyper-db error — `query_failed`

**Message:** relation "players" does not exist

| Field | Value |
|---|---|
| source | `execute` |
| queryId | `a1b2c3d4e5f60718` |

​```sql
select * from "players" where "elo" > $1 limit $2
​```

**Params:** `[2000,10]`

**Hint:** The SQL below failed on the database. Verify the schema matches ...
```

Disable with `set hyperdb_log_errors 0`.

## Benchmarks

```bash
bun run bench/boundary-bench.ts               # engine overhead
HYPERDB_BENCH_PG=1 bun run bench/boundary-bench.ts   # with live PG
HYPERDB_IT=1 bun test packages/core/test/integration/benchmark.test.ts
```

The integration benchmark asserts the PRD latency targets against live
services and prints a PostgreSQL vs MariaDB comparison.
`HYPERDB_BENCH_ONLY=pg|mysql|redis` runs one stage in isolation (the other
services stopped) for clean numbers.

Reference numbers — dedicated server (Ryzen 9950X 4 vCPU, 8GB DDR5, NVMe,
Ubuntu 24.04, PostgreSQL 18.4 / MariaDB 11.4 / Redis 7, tuned configs,
each DB benchmarked in isolation, N=2000):

| Benchmark | p50 | p99 | ops/s |
|---|---|---|---|
| pg registered select (prepared reuse) | 0.06ms | 0.27ms | 14,416 |
| pg upsert (`on conflict`) | 0.10ms | 0.40ms | 8,848 |
| mysql registered select | 0.04ms | 0.57ms | 17,514 |
| mysql upsert (`on duplicate key`) | 0.03ms | 0.25ms | 20,448 |
| hot-store write | 0.04ms | 0.12ms | 20,211 |
| hot-store read | 0.01ms | 0.05ms | 53,301 |
| cache hit | 0.02ms | 0.09ms | 45,035 |
| withLock roundtrip | 0.04ms | 0.18ms | 19,969 |

Every path is deep under the PRD targets (hot-store sub-ms hit at 10–40µs;
the Docker-era PG upsert gap collapsed from 2.6ms to 0.10ms on real NVMe).

For comparison, the same suite on a dev box (Windows 11, Docker Desktop,
all services concurrently, N=2000):

| Benchmark | p50 | p99 | ops/s |
|---|---|---|---|
| pg registered select (prepared reuse) | 0.31ms | 0.95ms | 2,610 |
| mysql registered select | 0.29ms | 0.50ms | 3,378 |
| pg upsert (`on conflict`) | 2.61ms | 5.12ms | 366 |
| mysql upsert (`on duplicate key`) | 0.31ms | 0.76ms | 3,038 |
| hot-store write | 0.60ms | 2.37ms | 1,528 |
| hot-store read | 0.21ms | 0.45ms | 4,626 |
| cache hit | 0.14ms | 0.49ms | 5,563 |
| withLock roundtrip | 0.44ms | 1.56ms | 2,006 |

Reads are equivalent across dialects everywhere. The Docker PG upsert number
is durability cost under Docker Desktop's filesystem (`synchronous_commit=on`
fsync per commit); on real NVMe it drops to 0.10ms. Hot writes still belong
in the Redis hot-store + write-behind batches — 2–3× faster than even tuned
SQL upserts, and immune to checkpoint stalls.

The boundary-payload contract (`queryId + params` only) is asserted in CI by
`resource/test/boundary-payload.test.ts`.

## Status

v1 foundation (M0–M2 core + M4/M5 scaffolds). Not yet done: live FiveM e2e
resource, oxmysql comparative report, PvP-server adoption (M3).
