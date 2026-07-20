/** Driver abstractions. The engine only sees these interfaces — real adapters
 *  (postgres.js / mariadb / ioredis) and in-memory fakes are interchangeable,
 *  which keeps every engine feature unit-testable without live services. */

export type SqlRow = Record<string, unknown>;

export interface SqlDriver {
  readonly dialect: 'pg' | 'mysql';
  query(sql: string, params: unknown[]): Promise<SqlRow[]>;
  /** Prepared-statement execution; pg reuses server-side plans by name,
   *  mysql adapters may fall back to plain query. */
  prepared(name: string, sql: string, params: unknown[]): Promise<SqlRow[]>;
  close(): Promise<void>;
}

export interface RedisSetOptions {
  pxMs?: number;
  nx?: boolean;
}

export type RedisSubscriber = (message: string) => void;

export interface RedisDriver {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<'OK' | null>;
  del(...keys: string[]): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, fields: Record<string, string>): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  incrby(key: string, by: number): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  /** returns an unsubscribe function */
  subscribe(channel: string, handler: RedisSubscriber): Promise<() => Promise<void>>;
  /** Redis EVAL command (server-side Lua script) — not JS eval(). Scripts are
   *  fixed constants from drivers/scripts.ts, never user input. */
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  close(): Promise<void>;
}
