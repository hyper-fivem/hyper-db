import { describe, expect, test } from 'bun:test';
import { FakeRedis } from '../src/drivers/fake-redis';
import { Locks } from '../src/lock';
import { HyperDbError } from '../src/errors';

describe('Locks.withLock', () => {
  test('runs fn under lock and releases after', async () => {
    const redis = new FakeRedis();
    const locks = new Locks(redis);
    const result = await locks.withLock('elo:p1', 1000, async () => 42);
    expect(result).toBe(42);
    // released: a second acquire must succeed
    expect(await locks.withLock('elo:p1', 1000, async () => 'again')).toBe('again');
  });

  test('concurrent holder -> lock_held (double-spend protection)', async () => {
    const redis = new FakeRedis();
    const locks = new Locks(redis);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = locks.withLock('wallet:p1', 5000, async () => {
      await gate;
      return 'first';
    });
    await Bun.sleep(0); // let first acquire
    try {
      await locks.withLock('wallet:p1', 5000, async () => 'second');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as HyperDbError).code).toBe('lock_held');
    }
    release();
    expect(await first).toBe('first');
  });

  test('lock released even when fn throws', async () => {
    const redis = new FakeRedis();
    const locks = new Locks(redis);
    await expect(locks.withLock('k', 1000, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await locks.withLock('k', 1000, async () => 'ok')).toBe('ok');
  });

  test('expired lock does not get released by stale owner', async () => {
    let now = 0;
    const redis = new FakeRedis({ now: () => now });
    const locks = new Locks(redis);
    await locks.withLock('k', 100, async () => {
      now = 150; // our lock expired mid-flight
      // someone else takes it
      await redis.set('hyperdb:lock:k', 'other-token');
    });
    // stale release must not have removed the other holder's lock
    expect(await redis.get('hyperdb:lock:k')).toBe('other-token');
  });
});

describe('Locks.rateLimit', () => {
  test('allows up to limit within window, then rejects', async () => {
    let now = 0;
    const redis = new FakeRedis({ now: () => now });
    const locks = new Locks(redis);
    expect(await locks.rateLimit('buy:p1', 2, 1000)).toBe(true);
    expect(await locks.rateLimit('buy:p1', 2, 1000)).toBe(true);
    expect(await locks.rateLimit('buy:p1', 2, 1000)).toBe(false);
    now = 1001; // window reset
    expect(await locks.rateLimit('buy:p1', 2, 1000)).toBe(true);
  });
});

describe('Locks.counter', () => {
  test('atomic increments', async () => {
    const redis = new FakeRedis();
    const locks = new Locks(redis);
    const kills = locks.counter('kills:p1');
    expect(await kills.incr()).toBe(1);
    expect(await kills.incr(4)).toBe(5);
    expect(await kills.get()).toBe(5);
  });
});
