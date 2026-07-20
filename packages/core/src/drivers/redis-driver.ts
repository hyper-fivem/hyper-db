/** ioredis adapter. Subscriptions need a dedicated connection (Redis protocol
 *  restriction), so a second client is created lazily for subscribe(). */
import { Redis, type RedisOptions } from 'ioredis';
import type { RedisDriver, RedisSetOptions, RedisSubscriber } from './types';

export interface IoRedisDriverOptions {
  host: string;
  port?: number;
  password?: string;
  db?: number;
}

export class IoRedisDriver implements RedisDriver {
  private readonly redis: Redis;
  private sub: Redis | undefined;
  private readonly handlers = new Map<string, Set<RedisSubscriber>>();
  private readonly options: IoRedisDriverOptions;

  constructor(options: IoRedisDriverOptions) {
    this.options = options;
    this.redis = this.connect();
  }

  private connect(): Redis {
    const opts: RedisOptions = {
      host: this.options.host,
      port: this.options.port ?? 6379,
      db: this.options.db ?? 0,
      lazyConnect: false,
    };
    if (this.options.password !== undefined) opts.password = this.options.password;
    return new Redis(opts);
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, options: RedisSetOptions = {}): Promise<'OK' | null> {
    if (options.pxMs !== undefined && options.nx) {
      return (await this.redis.set(key, value, 'PX', options.pxMs, 'NX')) as 'OK' | null;
    }
    if (options.pxMs !== undefined) return this.redis.set(key, value, 'PX', options.pxMs);
    if (options.nx) return (await this.redis.set(key, value, 'NX')) as 'OK' | null;
    return this.redis.set(key, value);
  }

  async del(...keys: string[]): Promise<number> {
    return this.redis.del(...keys);
  }

  async pexpire(key: string, ms: number): Promise<number> {
    return this.redis.pexpire(key, ms);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.redis.hgetall(key);
  }

  async hset(key: string, fields: Record<string, string>): Promise<number> {
    return this.redis.hset(key, fields);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.redis.sadd(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.redis.smembers(key);
  }

  async incrby(key: string, by: number): Promise<number> {
    return this.redis.incrby(key, by);
  }

  async publish(channel: string, message: string): Promise<number> {
    return this.redis.publish(channel, message);
  }

  async subscribe(channel: string, handler: RedisSubscriber): Promise<() => Promise<void>> {
    if (!this.sub) {
      this.sub = this.connect();
      this.sub.on('message', (ch: string, message: string) => {
        for (const h of this.handlers.get(ch) ?? []) h(message);
      });
    }
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(handler);
    return async () => {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(channel);
        await this.sub?.unsubscribe(channel);
      }
    };
  }

  /** Redis EVAL command (server-side Lua from drivers/scripts.ts) — not JS eval(). */
  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    return this.redis.eval(script, keys.length, ...keys, ...args);
  }

  async close(): Promise<void> {
    this.redis.disconnect();
    this.sub?.disconnect();
  }
}
