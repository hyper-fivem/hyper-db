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
  formatErrorMarkdown,
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

export interface ServerOptions {
  /** Receives one markdown block per failure (default: none). The FiveM
   *  bootstrap wires this to console.error so agents reading the server
   *  console get structured, parseable error reports. */
  logError?: (markdown: string) => void;
}

export function createServer(deps: ServerDeps, options: ServerOptions = {}) {
  const stats = new Stats();
  const engine = new QueryEngine(deps.sql, { stats });
  const cache = deps.redis ? new QueryCache(deps.redis, { stats }) : undefined;
  const locks = deps.redis ? new Locks(deps.redis) : undefined;
  const pubsub = deps.redis ? new PubSub(deps.redis) : undefined;
  const tables = new Map<string, TableMetaValue>();

  const report = (source: string, err: unknown): HyperDbError => {
    const wrapped = HyperDbError.wrap(err);
    options.logError?.(formatErrorMarkdown(wrapped, { source }));
    return wrapped;
  };

  const run = (source: string, work: Promise<SqlRow[]>, cb: BoundaryCallback): void => {
    work.then(
      (rows) => cb(null, rows),
      (err) => cb(report(source, err).toBoundary(), null),
    );
  };

  return {
    engine,
    stats,
    cache,
    locks,
    pubsub,

    execute(queryId: string, params: unknown[], cb: BoundaryCallback): void {
      run('execute', engine.execute(queryId, params ?? []), cb);
    },

    executeChain(tableName: string, descriptor: string, params: unknown[], cb: BoundaryCallback): void {
      const meta = tables.get(tableName);
      if (!meta) {
        const err = report(
          'executeChain',
          new HyperDbError('bad_params', `chain: unregistered table '${tableName}'`, { table: tableName, descriptor }),
        );
        cb(err.toBoundary(), null);
        return;
      }
      run(
        'executeChain',
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
        cb?.(report('invalidateTags', new HyperDbError('unsupported_feature', 'cache requires redis')).toBoundary());
        return;
      }
      cache.invalidateTags(tags).then(
        () => cb?.(null),
        (err) => cb?.(report('invalidateTags', err).toBoundary()),
      );
    },

    hyperdbStats() {
      return stats.snapshot();
    },
  };
}

export type HyperDbServer = ReturnType<typeof createServer>;
