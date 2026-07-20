import { describe, expect, test } from 'bun:test';
import { FakeRedis } from '../src/drivers/fake-redis';
import { PubSub } from '../src/pubsub';
import { QueryCache } from '../src/cache';
import { Stats } from '../src/stats';

describe('PubSub', () => {
  test('typed publish/subscribe roundtrip', async () => {
    const redis = new FakeRedis();
    const ps = new PubSub(redis);
    const seen: { tags: string[] }[] = [];
    await ps.subscribe<{ tags: string[] }>('inv', (p) => void seen.push(p));
    await ps.publish('inv', { tags: ['players'] });
    await Bun.sleep(0);
    expect(seen).toEqual([{ tags: ['players'] }]);
  });
});

describe('QueryCache', () => {
  const opts = { ttlMs: 60_000, tags: ['players'] };

  test('read-through: miss fetches, hit skips fetch', async () => {
    const redis = new FakeRedis();
    const stats = new Stats();
    const cache = new QueryCache(redis, { stats });
    let fetches = 0;
    const fetch = async () => {
      fetches += 1;
      return [{ id: 'a', elo: 1 }];
    };
    const first = await cache.cached('q1', [2000], opts, fetch);
    const second = await cache.cached('q1', [2000], opts, fetch);
    expect(first).toEqual([{ id: 'a', elo: 1 }]);
    expect(second).toEqual([{ id: 'a', elo: 1 }]);
    expect(fetches).toBe(1);
    expect(stats.snapshot().cache).toEqual({ hits: 1, misses: 1 });
  });

  test('different params -> different cache entries', async () => {
    const redis = new FakeRedis();
    const cache = new QueryCache(redis);
    let fetches = 0;
    const fetch = async () => [{ n: ++fetches }];
    await cache.cached('q1', [1], opts, fetch);
    await cache.cached('q1', [2], opts, fetch);
    expect(fetches).toBe(2);
  });

  test('ttl is an upper bound', async () => {
    let now = 0;
    const redis = new FakeRedis({ now: () => now });
    const cache = new QueryCache(redis);
    let fetches = 0;
    const fetch = async () => [{ n: ++fetches }];
    await cache.cached('q1', [], { ttlMs: 100, tags: [] }, fetch);
    now = 101;
    await cache.cached('q1', [], { ttlMs: 100, tags: [] }, fetch);
    expect(fetches).toBe(2);
  });

  test('invalidateTags clears shared entries and notifies other instances', async () => {
    const redis = new FakeRedis(); // one fake = one shared redis server
    const a = new QueryCache(redis);
    const b = new QueryCache(redis);
    const notified: string[][] = [];
    await b.onInvalidation((tags) => void notified.push(tags));

    let fetches = 0;
    const fetch = async () => [{ n: ++fetches }];
    await b.cached('q1', [], opts, fetch);
    expect(fetches).toBe(1);

    await a.invalidateTags(['players']);
    await Bun.sleep(0);

    await b.cached('q1', [], opts, fetch); // entry gone -> refetch
    expect(fetches).toBe(2);
    expect(notified).toEqual([['players']]);
  });

  test('invalidating an unrelated tag keeps entries', async () => {
    const redis = new FakeRedis();
    const cache = new QueryCache(redis);
    let fetches = 0;
    const fetch = async () => [{ n: ++fetches }];
    await cache.cached('q1', [], opts, fetch);
    await cache.invalidateTags(['matches']);
    await cache.cached('q1', [], opts, fetch);
    expect(fetches).toBe(1);
  });
});
