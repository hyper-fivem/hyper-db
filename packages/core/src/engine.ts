/** Query pipeline. Static queries are registered once (codegen output) and
 *  executed by queryId + flat params — the only payload crossing the FiveM
 *  runtime boundary. Dynamic ASTs get a shape-hash → compiled-SQL cache.
 *  On PG, both paths reuse server-side prepared statements named per shape. */
import { compileMysql, compilePg, queryIdFor, type QueryNode } from '@hyper-db/schema';
import type { SqlDriver, SqlRow } from './drivers/types';
import { HyperDbError } from './errors';
import { Stats } from './stats';

interface RegisteredQuery {
  sql: string;
  paramCount: number;
}

export type RegisterEntry = { ast: QueryNode } | { sql: string; paramCount?: number };

export interface QueryEngineOptions {
  stats?: Stats;
}

export class QueryEngine {
  private readonly driver: SqlDriver;
  private readonly stats: Stats;
  private readonly registry = new Map<string, RegisteredQuery>();
  private readonly dynamicCache = new Map<string, RegisteredQuery>();

  constructor(driver: SqlDriver, options: QueryEngineOptions = {}) {
    this.driver = driver;
    this.stats = options.stats ?? new Stats();
  }

  get dynamicCacheSize(): number {
    return this.dynamicCache.size;
  }

  get statsSnapshot() {
    return this.stats.snapshot();
  }

  private compile(ast: QueryNode): RegisteredQuery {
    const compiled = this.driver.dialect === 'pg' ? compilePg(ast) : compileMysql(ast);
    return { sql: compiled.sql, paramCount: compiled.paramCount };
  }

  register(queryId: string, entry: RegisterEntry): void {
    if ('ast' in entry) {
      this.registry.set(queryId, this.compile(entry.ast));
    } else {
      this.registry.set(queryId, { sql: entry.sql, paramCount: entry.paramCount ?? -1 });
    }
  }

  async execute(queryId: string, params: unknown[]): Promise<SqlRow[]> {
    const entry = this.registry.get(queryId);
    if (!entry) {
      throw new HyperDbError('unknown_query_id', `no query registered for id '${queryId}'`, { queryId });
    }
    return this.run(queryId, entry, params);
  }

  async executeDynamic(ast: QueryNode, params: unknown[]): Promise<SqlRow[]> {
    const shapeId = queryIdFor(ast);
    let entry = this.dynamicCache.get(shapeId);
    if (!entry) {
      entry = this.compile(ast);
      this.dynamicCache.set(shapeId, entry);
    }
    return this.run(shapeId, entry, params);
  }

  private async run(queryId: string, entry: RegisteredQuery, params: unknown[]): Promise<SqlRow[]> {
    if (entry.paramCount >= 0 && params.length !== entry.paramCount) {
      throw new HyperDbError('bad_params', `query '${queryId}' expects ${entry.paramCount} params, got ${params.length}`, {
        queryId,
        expected: entry.paramCount,
        got: params.length,
      });
    }
    const start = performance.now();
    try {
      const rows =
        this.driver.dialect === 'pg'
          ? await this.driver.prepared(`hdb_${queryId}`, entry.sql, params)
          : await this.driver.query(entry.sql, params);
      this.stats.recordQuery(queryId, performance.now() - start);
      return rows;
    } catch (err) {
      this.stats.recordQuery(queryId, performance.now() - start);
      throw HyperDbError.wrap(err);
    }
  }
}
