import { describe, expect, test } from 'bun:test';
import { redisTable, rString, rNumber, rBoolean, rJson, RedisTableMeta } from '@hyper-db/schema';
import { FakeRedis } from '../src/drivers/fake-redis';
import { HotStore } from '../src/hot-store';
import { WriteBehindQueue } from '../src/write-behind';

const sessions = redisTable('sessions', {
  keyBy: 'playerId',
  fields: {
    playerId: rString(),
    elo: rNumber(),
    alive: rBoolean(),
    loadout: rJson<{ weapons: string[] }>(),
  },
  ttl: 3600,
});

describe('HotStore', () => {
  test('typed set/get roundtrip', async () => {
    const redis = new FakeRedis();
    const store = new HotStore(redis, sessions[RedisTableMeta]);
    await store.set('p1', { playerId: 'p1', elo: 1200, alive: true, loadout: { weapons: ['deagle'] } });
    const row = await store.get('p1');
    expect(row).toEqual({ playerId: 'p1', elo: 1200, alive: true, loadout: { weapons: ['deagle'] } });
    expect(await store.get('missing')).toBeNull();
  });

  test('patch merges fields', async () => {
    const redis = new FakeRedis();
    const store = new HotStore(redis, sessions[RedisTableMeta]);
    await store.set('p1', { playerId: 'p1', elo: 1200, alive: true, loadout: null });
    await store.patch('p1', { elo: 1250, alive: false });
    const row = await store.get('p1');
    expect(row!.elo).toBe(1250);
    expect(row!.alive).toBe(false);
    expect(row!.playerId).toBe('p1');
  });

  test('ttl expires entries', async () => {
    let now = 0;
    const redis = new FakeRedis({ now: () => now });
    const store = new HotStore(redis, sessions[RedisTableMeta]);
    await store.set('p1', { playerId: 'p1', elo: 1, alive: true, loadout: null });
    now = 3600_001;
    expect(await store.get('p1')).toBeNull();
  });

  test('del removes', async () => {
    const redis = new FakeRedis();
    const store = new HotStore(redis, sessions[RedisTableMeta]);
    await store.set('p1', { playerId: 'p1', elo: 1, alive: true, loadout: null });
    await store.del('p1');
    expect(await store.get('p1')).toBeNull();
  });
});

describe('WriteBehindQueue', () => {
  test('flushNow delivers one merged row per key (latest wins)', async () => {
    const flushed: Record<string, unknown>[][] = [];
    const q = new WriteBehindQueue(async (batch) => void flushed.push(batch.map((e) => e.row)));
    q.enqueue('p1', { playerId: 'p1', elo: 1000 });
    q.enqueue('p1', { elo: 1100 });
    q.enqueue('p2', { playerId: 'p2', elo: 900 });
    await q.flushNow();
    expect(flushed).toEqual([[{ playerId: 'p1', elo: 1100 }, { playerId: 'p2', elo: 900 }]]);
    expect(q.pending).toBe(0);
  });

  test('failed flush re-enqueues (at-least-once)', async () => {
    let fail = true;
    const flushed: string[] = [];
    const q = new WriteBehindQueue(async (batch) => {
      if (fail) throw new Error('pg down');
      for (const e of batch) flushed.push(e.key);
    });
    q.enqueue('p1', { elo: 1 });
    await expect(q.flushNow()).rejects.toThrow('pg down');
    expect(q.pending).toBe(1);
    fail = false;
    await q.flushNow();
    expect(flushed).toEqual(['p1']);
  });

  test('newer writes during failed flush win over re-enqueued values', async () => {
    let fail = true;
    const rows: unknown[] = [];
    const q = new WriteBehindQueue(async (batch) => {
      if (fail) throw new Error('down');
      for (const e of batch) rows.push(e.row);
    });
    q.enqueue('p1', { elo: 1 });
    const attempt = q.flushNow().catch(() => {});
    q.enqueue('p1', { elo: 2 }); // arrives while flush is failing
    await attempt;
    fail = false;
    await q.flushNow();
    expect(rows).toEqual([{ elo: 2 }]);
  });

  test('maxBatch splits flushes', async () => {
    const sizes: number[] = [];
    const q = new WriteBehindQueue(async (batch) => void sizes.push(batch.length), { maxBatch: 2 });
    q.enqueue('a', {});
    q.enqueue('b', {});
    q.enqueue('c', {});
    await q.flushNow();
    expect(sizes).toEqual([2, 1]);
  });

  test('interval timer flushes automatically', async () => {
    let flushes = 0;
    const q = new WriteBehindQueue(async () => void (flushes += 1), { intervalMs: 5 });
    q.enqueue('a', {});
    q.start();
    await Bun.sleep(20);
    q.stop();
    expect(flushes).toBeGreaterThanOrEqual(1);
  });

  test('hot-store writes feed the queue', async () => {
    const redis = new FakeRedis();
    const batches: string[] = [];
    const q = new WriteBehindQueue(async (batch) => void batches.push(...batch.map((e) => e.key)));
    const store = new HotStore(redis, sessions[RedisTableMeta], { writeBehind: q });
    await store.set('p1', { playerId: 'p1', elo: 1, alive: true, loadout: null });
    await store.patch('p1', { elo: 2 });
    await q.flushNow();
    expect(batches).toEqual(['p1']);
  });
});
