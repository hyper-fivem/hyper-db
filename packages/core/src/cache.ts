/** Declarative read-through cache. Entries live in Redis (shared across
 *  nodes) keyed by queryId + params hash; tag index sets map tags → entry
 *  keys. Writes declare which tags they invalidate; invalidation deletes the
 *  entries and broadcasts on pub/sub. TTL is always an upper bound — nothing
 *  here is implicit or magic (PvP economy data must never be stale-surprise). */
import { createHash } from 'node:crypto';
import type { RedisDriver } from './drivers/types';
import type { SqlRow } from './drivers/types';
import { PubSub } from './pubsub';
import { Stats } from './stats';

export interface CacheQueryOptions {
  ttlMs: number;
  tags: string[];
}

export interface QueryCacheOptions {
  stats?: Stats;
  prefix?: string;
}

const INVALIDATION_CHANNEL = 'inv';

export class QueryCache {
  private readonly redis: RedisDriver;
  private readonly stats: Stats;
  private readonly prefix: string;
  private readonly pubsub: PubSub;

  constructor(redis: RedisDriver, options: QueryCacheOptions = {}) {
    this.redis = redis;
    this.stats = options.stats ?? new Stats();
    this.prefix = options.prefix ?? 'hyperdb';
    this.pubsub = new PubSub(redis, this.prefix);
  }

  private entryKey(queryId: string, params: unknown[]): string {
    const hash = createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16);
    return `${this.prefix}:c:${queryId}:${hash}`;
  }

  private tagKey(tag: string): string {
    return `${this.prefix}:t:${tag}`;
  }

  async cached(
    queryId: string,
    params: unknown[],
    options: CacheQueryOptions,
    fetch: () => Promise<SqlRow[]>,
  ): Promise<SqlRow[]> {
    const key = this.entryKey(queryId, params);
    const hit = await this.redis.get(key);
    if (hit !== null) {
      this.stats.recordCache(true);
      return JSON.parse(hit) as SqlRow[];
    }
    this.stats.recordCache(false);
    const rows = await fetch();
    await this.redis.set(key, JSON.stringify(rows), { pxMs: options.ttlMs });
    for (const tag of options.tags) {
      const tagKey = this.tagKey(tag);
      await this.redis.sadd(tagKey, key);
      // tag index outlives its longest entry; harmless dangling keys expire on read
      await this.redis.pexpire(tagKey, options.ttlMs * 2);
    }
    return rows;
  }

  /** Delete every cached entry under the given tags and broadcast so all
   *  nodes (and future local layers) drop them too. */
  async invalidateTags(tags: string[]): Promise<void> {
    for (const tag of tags) {
      const tagKey = this.tagKey(tag);
      const keys = await this.redis.smembers(tagKey);
      if (keys.length > 0) await this.redis.del(...keys);
      await this.redis.del(tagKey);
    }
    await this.pubsub.publish(INVALIDATION_CHANNEL, { tags });
  }

  async onInvalidation(handler: (tags: string[]) => void): Promise<() => Promise<void>> {
    return this.pubsub.subscribe<{ tags: string[] }>(INVALIDATION_CHANNEL, (p) => handler(p.tags));
  }
}
