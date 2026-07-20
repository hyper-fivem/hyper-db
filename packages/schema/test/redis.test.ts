import { describe, expect, test } from 'bun:test';
import { redisTable, rString, rNumber, rBoolean, rJson, RedisTableMeta, type InferRedis } from '../src/redis';

const sessions = redisTable('sessions', {
  keyBy: 'playerId',
  fields: {
    playerId: rString(),
    elo: rNumber(),
    alive: rBoolean(),
    loadout: rJson<{ weapons: string[] }>(),
  },
  ttl: 3600,
  writeBehind: { table: 'sessions_archive', intervalMs: 5000, maxBatch: 100 },
});

describe('redisTable', () => {
  test('meta shape', () => {
    const meta = sessions[RedisTableMeta];
    expect(meta.name).toBe('sessions');
    expect(meta.keyBy).toBe('playerId');
    expect(meta.ttl).toBe(3600);
    expect(meta.writeBehind).toEqual({ table: 'sessions_archive', intervalMs: 5000, maxBatch: 100 });
    expect(meta.fields.playerId!.kind).toBe('string');
    expect(meta.fields.elo!.kind).toBe('number');
    expect(meta.fields.alive!.kind).toBe('boolean');
    expect(meta.fields.loadout!.kind).toBe('json');
  });

  test('keyBy must name an existing field', () => {
    expect(() =>
      redisTable('bad', { keyBy: 'nope' as never, fields: { id: rString() } }),
    ).toThrow(/keyBy/);
  });

  test('type inference', () => {
    type S = InferRedis<typeof sessions>;
    const s: S = { playerId: 'p1', elo: 1200, alive: true, loadout: { weapons: ['deagle'] } };
    expect(s.elo).toBe(1200);
  });
});
