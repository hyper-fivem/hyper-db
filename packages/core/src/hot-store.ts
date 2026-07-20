/** Hot-store runtime for redisTable() schemas: typed structures living
 *  entirely in Redis hashes (sessions, live match state). Sub-ms reads and
 *  writes; optional write-behind persists batches to SQL. */
import type { RedisTableMetaValue, RedisField } from '@hyper-db/schema';
import type { RedisDriver } from './drivers/types';
import type { WriteBehindQueue } from './write-behind';

export interface HotStoreOptions {
  writeBehind?: WriteBehindQueue;
  prefix?: string;
}

type Row = Record<string, unknown>;

/** invariant type params on RedisTableMetaValue make the concrete field maps
 *  non-assignable to Record<string, RedisField>; erase them at this boundary */
export type AnyRedisTableMeta = RedisTableMetaValue<any>;

export class HotStore<T extends Row = Row> {
  private readonly redis: RedisDriver;
  private readonly meta: AnyRedisTableMeta;
  private readonly prefix: string;
  private readonly writeBehind: WriteBehindQueue | undefined;

  constructor(redis: RedisDriver, meta: AnyRedisTableMeta, options: HotStoreOptions = {}) {
    this.redis = redis;
    this.meta = meta;
    this.prefix = options.prefix ?? 'hyperdb';
    this.writeBehind = options.writeBehind;
  }

  private key(id: string): string {
    return `${this.prefix}:h:${this.meta.name}:${id}`;
  }

  private encodeField(field: RedisField, value: unknown): string {
    switch (field.kind) {
      case 'string': return String(value);
      case 'number': return String(value);
      case 'boolean': return value ? '1' : '0';
      case 'json': return JSON.stringify(value);
    }
  }

  private decodeField(field: RedisField, raw: string): unknown {
    switch (field.kind) {
      case 'string': return raw;
      case 'number': return Number(raw);
      case 'boolean': return raw === '1';
      case 'json': return JSON.parse(raw);
    }
  }

  private encode(row: Partial<T>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(row)) {
      const field = this.meta.fields[name];
      if (!field) throw new Error(`hot-store ${this.meta.name}: unknown field '${name}'`);
      if (value === null || value === undefined) continue; // absent = null
      out[name] = this.encodeField(field, value);
    }
    return out;
  }

  async get(id: string): Promise<T | null> {
    const raw = await this.redis.hgetall(this.key(id));
    if (Object.keys(raw).length === 0) return null;
    const row: Row = {};
    for (const [name, field] of Object.entries(this.meta.fields as Record<string, RedisField>)) {
      const value = raw[name];
      row[name] = value === undefined ? null : this.decodeField(field, value);
    }
    return row as T;
  }

  async set(id: string, value: T): Promise<void> {
    await this.redis.del(this.key(id));
    await this.write(id, value);
  }

  async patch(id: string, partial: Partial<T>): Promise<void> {
    await this.write(id, partial);
  }

  private async write(id: string, row: Partial<T>): Promise<void> {
    const key = this.key(id);
    const encoded = this.encode(row);
    if (Object.keys(encoded).length > 0) await this.redis.hset(key, encoded);
    if (this.meta.ttl !== undefined) await this.redis.pexpire(key, this.meta.ttl * 1000);
    this.writeBehind?.enqueue(id, row as Row);
  }

  async del(id: string): Promise<void> {
    await this.redis.del(this.key(id));
  }
}
