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
docker-compose up -d     # postgres + mariadb + redis
HYPERDB_IT=1 bun test packages/core/test/integration
```

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

## Benchmarks

```bash
bun run bench/boundary-bench.ts               # engine overhead
HYPERDB_BENCH_PG=1 bun run bench/boundary-bench.ts   # with live PG
```

The boundary-payload contract (`queryId + params` only) is asserted in CI by
`resource/test/boundary-payload.test.ts`.

## Status

v1 foundation (M0–M2 core + M4/M5 scaffolds). Not yet done: live FiveM e2e
resource, oxmysql comparative report, PvP-server adoption (M3).
