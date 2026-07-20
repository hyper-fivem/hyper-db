/** Recording SqlDriver fake: scripts results per call (or via handler) and
 *  keeps a full call log for assertions. */
import type { SqlDriver, SqlRow } from './types';

export interface SqlCall {
  kind: 'query' | 'prepared';
  name?: string;
  sql: string;
  params: unknown[];
}

export class FakeSql implements SqlDriver {
  readonly dialect: 'pg' | 'mysql';
  readonly calls: SqlCall[] = [];
  /** optional per-call result scripting; default returns [] */
  handler: (call: SqlCall) => SqlRow[] | Promise<SqlRow[]> = () => [];

  constructor(dialect: 'pg' | 'mysql' = 'pg') {
    this.dialect = dialect;
  }

  async query(sql: string, params: unknown[]): Promise<SqlRow[]> {
    const call: SqlCall = { kind: 'query', sql, params };
    this.calls.push(call);
    return this.handler(call);
  }

  async prepared(name: string, sql: string, params: unknown[]): Promise<SqlRow[]> {
    const call: SqlCall = { kind: 'prepared', name, sql, params };
    this.calls.push(call);
    return this.handler(call);
  }

  async close(): Promise<void> {}
}
