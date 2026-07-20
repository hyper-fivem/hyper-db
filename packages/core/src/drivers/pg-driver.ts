/** postgres.js adapter. `prepare: true` gives server-side prepared-statement
 *  reuse keyed by query text — our stable per-shape SQL makes that effective. */
import postgres from 'postgres';
import type { SqlDriver, SqlRow } from './types';
import { HyperDbError } from '../errors';

export interface PgDriverOptions {
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  max?: number;
}

export class PgDriver implements SqlDriver {
  readonly dialect = 'pg' as const;
  private readonly sql: ReturnType<typeof postgres>;

  constructor(options: PgDriverOptions) {
    this.sql = postgres({
      host: options.host,
      port: options.port ?? 5432,
      database: options.database,
      username: options.username,
      password: options.password,
      max: options.max ?? 10,
      prepare: true,
    });
  }

  async query(sql: string, params: unknown[]): Promise<SqlRow[]> {
    try {
      return await this.sql.unsafe(sql, params as never[]);
    } catch (err) {
      throw HyperDbError.wrap(err);
    }
  }

  /** postgres.js keys its prepared-statement cache on query text; the name is
   *  informational here but kept for the SqlDriver contract. */
  async prepared(_name: string, sql: string, params: unknown[]): Promise<SqlRow[]> {
    return this.query(sql, params);
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
