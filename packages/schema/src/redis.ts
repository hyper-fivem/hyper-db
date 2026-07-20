/** Hot-store schema: typed structures that live entirely in Redis (sessions,
 *  live match state, ELO sessions). Optional write-behind persists batches to
 *  a SQL table. Cache behavior stays fully declarative — no magic. */

export const RedisTableMeta = Symbol.for('hyperdb:redis-table');

export type RedisFieldKind = 'string' | 'number' | 'boolean' | 'json';

export interface RedisField<T = unknown> {
  kind: RedisFieldKind;
  readonly _type?: T;
}

export const rString = (): RedisField<string> => ({ kind: 'string' });
export const rNumber = (): RedisField<number> => ({ kind: 'number' });
export const rBoolean = (): RedisField<boolean> => ({ kind: 'boolean' });
export const rJson = <T>(): RedisField<T> => ({ kind: 'json' });

export interface WriteBehindOptions {
  /** SQL table receiving batched persistence */
  table: string;
  intervalMs?: number;
  maxBatch?: number;
}

export interface RedisTableMetaValue<F extends Record<string, RedisField> = Record<string, RedisField>> {
  name: string;
  keyBy: keyof F & string;
  fields: F;
  /** upper-bound TTL in seconds; entries may be invalidated earlier */
  ttl?: number;
  writeBehind?: WriteBehindOptions;
}

export type RedisTable<F extends Record<string, RedisField> = Record<string, RedisField>> = {
  readonly [RedisTableMeta]: RedisTableMetaValue<F>;
};

export interface RedisTableConfig<F extends Record<string, RedisField>> {
  keyBy: keyof F & string;
  fields: F;
  ttl?: number;
  writeBehind?: WriteBehindOptions;
}

export function redisTable<F extends Record<string, RedisField>>(
  name: string,
  config: RedisTableConfig<F>,
): RedisTable<F> {
  if (!(config.keyBy in config.fields)) {
    throw new Error(`redisTable(${name}): keyBy '${String(config.keyBy)}' is not a declared field`);
  }
  const meta: RedisTableMetaValue<F> = { name, keyBy: config.keyBy, fields: config.fields };
  if (config.ttl !== undefined) meta.ttl = config.ttl;
  if (config.writeBehind !== undefined) meta.writeBehind = config.writeBehind;
  return { [RedisTableMeta]: meta };
}

export type InferRedis<T> = T extends RedisTable<infer F>
  ? { [K in keyof F]: F[K] extends RedisField<infer V> ? V : never }
  : never;
