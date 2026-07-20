/** Typed pub/sub over Redis channels. Used for cache-tag invalidation today;
 *  the same channel discipline is the future multi-server distribution layer. */
import type { RedisDriver } from './drivers/types';

export class PubSub {
  private readonly redis: RedisDriver;
  private readonly prefix: string;

  constructor(redis: RedisDriver, prefix = 'hyperdb') {
    this.redis = redis;
    this.prefix = prefix;
  }

  private channel(name: string): string {
    return `${this.prefix}:${name}`;
  }

  async publish<T>(channel: string, payload: T): Promise<void> {
    await this.redis.publish(this.channel(channel), JSON.stringify(payload));
  }

  async subscribe<T>(channel: string, handler: (payload: T) => void): Promise<() => Promise<void>> {
    return this.redis.subscribe(this.channel(channel), (message) => {
      handler(JSON.parse(message) as T);
    });
  }
}
