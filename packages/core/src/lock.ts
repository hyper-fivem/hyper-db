/** Distributed primitives over Redis: withLock (SET NX PX + owner-token
 *  release via EVAL — double-spend protection), fixed-window rateLimit and
 *  atomic counters. All server-side atomic; no read-modify-write races. */
import { randomUUID } from 'node:crypto';
import type { RedisDriver } from './drivers/types';
import { RELEASE_LOCK_SCRIPT, RATE_LIMIT_SCRIPT } from './drivers/scripts';
import { HyperDbError } from './errors';

export interface AtomicCounter {
  incr(by?: number): Promise<number>;
  get(): Promise<number>;
}

export class Locks {
  private readonly redis: RedisDriver;
  private readonly prefix: string;

  constructor(redis: RedisDriver, prefix = 'hyperdb') {
    this.redis = redis;
    this.prefix = prefix;
  }

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const lockKey = `${this.prefix}:lock:${key}`;
    const token = randomUUID();
    const acquired = await this.redis.set(lockKey, token, { nx: true, pxMs: ttlMs });
    if (acquired !== 'OK') {
      throw new HyperDbError('lock_held', `lock '${key}' is held`, { key });
    }
    try {
      return await fn();
    } finally {
      // only the owner token releases; an expired/stolen lock is left alone
      await this.redis.eval(RELEASE_LOCK_SCRIPT, [lockKey], [token]);
    }
  }

  /** fixed-window rate limit: true = allowed */
  async rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const count = (await this.redis.eval(
      RATE_LIMIT_SCRIPT,
      [`${this.prefix}:rl:${key}`],
      [String(windowMs)],
    )) as number;
    return count <= limit;
  }

  counter(key: string): AtomicCounter {
    const counterKey = `${this.prefix}:ctr:${key}`;
    return {
      incr: (by = 1) => this.redis.incrby(counterKey, by),
      get: async () => Number((await this.redis.get(counterKey)) ?? '0'),
    };
  }
}
