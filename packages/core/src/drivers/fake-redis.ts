/** In-memory RedisDriver with real semantics (TTL via injectable clock,
 *  NX, hashes, sets, pub/sub, EVAL dispatch for our known scripts).
 *  Share one instance between components to simulate one Redis server. */
import type { RedisDriver, RedisSetOptions, RedisSubscriber } from './types';
import { RATE_LIMIT_SCRIPT, RELEASE_LOCK_SCRIPT } from './scripts';

interface Entry {
  value: string | Map<string, string> | Set<string>;
  expiresAt?: number;
}

export interface FakeRedisOptions {
  now?: () => number;
}

export class FakeRedis implements RedisDriver {
  private store = new Map<string, Entry>();
  private subscribers = new Map<string, Set<RedisSubscriber>>();
  private readonly now: () => number;

  constructor(options: FakeRedisOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.live(key);
    return typeof entry?.value === 'string' ? entry.value : null;
  }

  async set(key: string, value: string, options: RedisSetOptions = {}): Promise<'OK' | null> {
    if (options.nx && this.live(key)) return null;
    const entry: Entry = { value };
    if (options.pxMs !== undefined) entry.expiresAt = this.now() + options.pxMs;
    this.store.set(key, entry);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const key of keys) if (this.live(key) && this.store.delete(key)) n += 1;
    return n;
  }

  async pexpire(key: string, ms: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) return 0;
    entry.expiresAt = this.now() + ms;
    return 1;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const entry = this.live(key);
    if (!(entry?.value instanceof Map)) return {};
    return Object.fromEntries(entry.value);
  }

  async hset(key: string, fields: Record<string, string>): Promise<number> {
    let entry = this.live(key);
    if (!(entry?.value instanceof Map)) {
      entry = { value: new Map() };
      this.store.set(key, entry);
    }
    const hash = entry.value as Map<string, string>;
    let added = 0;
    for (const [k, v] of Object.entries(fields)) {
      if (!hash.has(k)) added += 1;
      hash.set(k, v);
    }
    return added;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    let entry = this.live(key);
    if (!(entry?.value instanceof Set)) {
      entry = { value: new Set() };
      this.store.set(key, entry);
    }
    const set = entry.value as Set<string>;
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added += 1;
      }
    }
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    const entry = this.live(key);
    return entry?.value instanceof Set ? [...entry.value] : [];
  }

  async incrby(key: string, by: number): Promise<number> {
    const entry = this.live(key);
    const current = typeof entry?.value === 'string' ? Number(entry.value) : 0;
    const next = current + by;
    const updated: Entry = { value: String(next) };
    if (entry?.expiresAt !== undefined) updated.expiresAt = entry.expiresAt;
    this.store.set(key, updated);
    return next;
  }

  async publish(channel: string, message: string): Promise<number> {
    const subs = this.subscribers.get(channel);
    if (!subs) return 0;
    for (const handler of subs) queueMicrotask(() => handler(message));
    return subs.size;
  }

  async subscribe(channel: string, handler: RedisSubscriber): Promise<() => Promise<void>> {
    let subs = this.subscribers.get(channel);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(channel, subs);
    }
    subs.add(handler);
    return async () => {
      subs.delete(handler);
    };
  }

  /** Redis EVAL emulation — dispatches on exact known script constants only;
   *  nothing is executed as code (no JS eval). */
  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    if (script === RELEASE_LOCK_SCRIPT) {
      const [key] = keys;
      const [token] = args;
      if (key !== undefined && (await this.get(key)) === token) return this.del(key);
      return 0;
    }
    if (script === RATE_LIMIT_SCRIPT) {
      const key = keys[0]!;
      const windowMs = Number(args[0]);
      const count = await this.incrby(key, 1);
      if (count === 1) await this.pexpire(key, windowMs);
      return count;
    }
    throw new Error('FakeRedis.eval: unknown script');
  }

  async close(): Promise<void> {
    this.store.clear();
    this.subscribers.clear();
  }
}
