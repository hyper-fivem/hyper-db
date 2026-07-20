/** hyper-db core server: owns every DB/Redis connection (single-owner
 *  principle) and exposes the boundary API to consumer resources.
 *
 *  Boundary exports (payloads are always scalars + flat arrays):
 *    execute(queryId, params, cb)                 registered static queries
 *    executeChain(table, descriptor, params, cb)  dynamic chain queries
 *    registerQueries(manifest)                    codegen manifest registration
 *    registerTable(tableMeta)                     enable chain queries for a table
 *    invalidateTags(tags)                         declarative cache invalidation
 *    hyperdbStats()                               observability snapshot
 *  Callbacks receive (err: BoundaryError|null, rows: SqlRow[]|null). */
import {
  HyperDbError,
  Locks,
  PubSub,
  QueryCache,
  QueryEngine,
  Stats,
  parseChain,
  type RedisDriver,
  type SqlDriver,
  type SqlRow,
} from '@hyper-db/core';
import { queryIdFor, type TableMetaValue } from '@hyper-db/schema';

export interface QueryManifestEntry {
  queryId: string;
  sql: string;
  paramCount: number;
}

export type BoundaryCallback = (err: { code: string; message: string } | null, rows: SqlRow[] | null) => void;

export interface ServerDeps {
  sql: SqlDriver;
  redis?: RedisDriver;
}

export function createServer(deps: ServerDeps) {
  const stats = new Stats();
  const engine = new QueryEngine(deps.sql, { stats });
  const cache = deps.redis ? new QueryCache(deps.redis, { stats }) : undefined;
  const locks = deps.redis ? new Locks(deps.redis) : undefined;
  const pubsub = deps.redis ? new PubSub(deps.redis) : undefined;
  const tables = new Map<string, TableMetaValue>();

  const run = (work: Promise<SqlRow[]>, cb: BoundaryCallback): void => {
    work.then(
      (rows) => cb(null, rows),
      (err) => cb(HyperDbError.wrap(err).toBoundary(), null),
    );
  };

  return {
    engine,
    stats,
    cache,
    locks,
    pubsub,

    execute(queryId: string, params: unknown[], cb: BoundaryCallback): void {
      run(engine.execute(queryId, params ?? []), cb);
    },

    executeChain(tableName: string, descriptor: string, params: unknown[], cb: BoundaryCallback): void {
      const meta = tables.get(tableName);
      if (!meta) {
        cb(new HyperDbError('bad_params', `chain: unregistered table '${tableName}'`).toBoundary(), null);
        return;
      }
      run(
        (async () => {
          const ast = parseChain(meta, descriptor);
          return engine.executeDynamic(ast, params ?? []);
        })(),
        cb,
      );
    },

    registerQueries(manifest: Record<string, QueryManifestEntry>): void {
      for (const entry of Object.values(manifest)) {
        engine.register(entry.queryId, { sql: entry.sql, paramCount: entry.paramCount });
      }
    },

    registerTable(meta: TableMetaValue): void {
      tables.set(meta.name, meta);
    },

    /** convenience: register a finalized AST directly (TS consumers) */
    registerAst(ast: Parameters<typeof queryIdFor>[0]): string {
      const id = queryIdFor(ast);
      engine.register(id, { ast });
      return id;
    },

    invalidateTags(tags: string[], cb?: (err: unknown) => void): void {
      if (!cache) {
        cb?.(new HyperDbError('unsupported_feature', 'cache requires redis').toBoundary());
        return;
      }
      cache.invalidateTags(tags).then(
        () => cb?.(null),
        (err) => cb?.(HyperDbError.wrap(err).toBoundary()),
      );
    },

    hyperdbStats() {
      return stats.snapshot();
    },
  };
}

export type HyperDbServer = ReturnType<typeof createServer>;
