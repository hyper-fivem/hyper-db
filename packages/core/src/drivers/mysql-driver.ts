/** mariadb adapter (connection pool, positional ? params). */
import mariadb, { type Pool } from 'mariadb';
import type { SqlDriver, SqlRow } from './types';
import { HyperDbError } from '../errors';

export interface MysqlDriverOptions {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  connectionLimit?: number;
}

export class MysqlDriver implements SqlDriver {
  readonly dialect = 'mysql' as const;
  private readonly pool: Pool;

  constructor(options: MysqlDriverOptions) {
    this.pool = mariadb.createPool({
      host: options.host,
      port: options.port ?? 3306,
      database: options.database,
      user: options.user,
      password: options.password,
      connectionLimit: options.connectionLimit ?? 10,
    });
  }

  async query(sql: string, params: unknown[]): Promise<SqlRow[]> {
    try {
      const rows = await this.pool.query({ sql, rowsAsArray: false }, params);
      return Array.isArray(rows) ? (rows as SqlRow[]) : [];
    } catch (err) {
      throw HyperDbError.wrap(err);
    }
  }

  async prepared(_name: string, sql: string, params: unknown[]): Promise<SqlRow[]> {
    return this.query(sql, params); // mariadb pipelines/caches internally
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
