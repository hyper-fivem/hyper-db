import { describe, expect, test } from 'bun:test';
import { FakeRedis } from '../src/drivers/fake-redis';
import { RELEASE_LOCK_SCRIPT, RATE_LIMIT_SCRIPT } from '../src/drivers/scripts';

describe('FakeRedis', () => {
  test('get/set/del', async () => {
    const r = new FakeRedis();
    expect(await r.get('k')).toBeNull();
    expect(await r.set('k', 'v')).toBe('OK');
    expect(await r.get('k')).toBe('v');
    expect(await r.del('k')).toBe(1);
    expect(await r.get('k')).toBeNull();
  });

  test('set nx only when absent', async () => {
    const r = new FakeRedis();
    expect(await r.set('k', 'a', { nx: true })).toBe('OK');
    expect(await r.set('k', 'b', { nx: true })).toBeNull();
    expect(await r.get('k')).toBe('a');
  });

  test('px expiry honours injected clock', async () => {
    let now = 0;
    const r = new FakeRedis({ now: () => now });
    await r.set('k', 'v', { pxMs: 100 });
    expect(await r.get('k')).toBe('v');
    now = 101;
    expect(await r.get('k')).toBeNull();
  });

  test('hset/hgetall roundtrip', async () => {
    const r = new FakeRedis();
    await r.hset('h', { a: '1', b: '2' });
    await r.hset('h', { b: '3' });
    expect(await r.hgetall('h')).toEqual({ a: '1', b: '3' });
    expect(await r.hgetall('missing')).toEqual({});
  });

  test('sadd/smembers', async () => {
    const r = new FakeRedis();
    await r.sadd('s', 'a', 'b');
    await r.sadd('s', 'b', 'c');
    expect((await r.smembers('s')).sort()).toEqual(['a', 'b', 'c']);
  });

  test('incrby', async () => {
    const r = new FakeRedis();
    expect(await r.incrby('n', 2)).toBe(2);
    expect(await r.incrby('n', 3)).toBe(5);
  });

  test('pub/sub delivers to subscribers, unsubscribe stops', async () => {
    const r = new FakeRedis();
    const seen: string[] = [];
    const unsub = await r.subscribe('ch', (msg) => void seen.push(msg));
    await r.publish('ch', 'one');
    await Bun.sleep(0);
    expect(seen).toEqual(['one']);
    await unsub();
    await r.publish('ch', 'two');
    await Bun.sleep(0);
    expect(seen).toEqual(['one']);
  });

  test('eval RELEASE_LOCK only deletes when token matches', async () => {
    const r = new FakeRedis();
    await r.set('lock', 'token-1');
    expect(await r.eval(RELEASE_LOCK_SCRIPT, ['lock'], ['wrong'])).toBe(0);
    expect(await r.get('lock')).toBe('token-1');
    expect(await r.eval(RELEASE_LOCK_SCRIPT, ['lock'], ['token-1'])).toBe(1);
    expect(await r.get('lock')).toBeNull();
  });

  test('eval RATE_LIMIT counts within window and resets after', async () => {
    let now = 0;
    const r = new FakeRedis({ now: () => now });
    expect(await r.eval(RATE_LIMIT_SCRIPT, ['rl'], ['1000'])).toBe(1);
    expect(await r.eval(RATE_LIMIT_SCRIPT, ['rl'], ['1000'])).toBe(2);
    now = 1001;
    expect(await r.eval(RATE_LIMIT_SCRIPT, ['rl'], ['1000'])).toBe(1);
  });
});
