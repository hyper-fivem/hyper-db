import { describe, expect, test } from 'bun:test';
import { hyperTable, uuid, integer } from '@hyper-db/schema/pg-core';
import { select, gt, finalize, queryIdFor } from '@hyper-db/schema';
import { QueryEngine } from '../src/engine';
import { FakeSql } from '../src/drivers/fake-sql';
import { Stats } from '../src/stats';
import { HyperDbError } from '../src/errors';

const players = hyperTable('players', {
  id: uuid().primaryKey(),
  elo: integer().notNull(),
});

const topPlayers = finalize(select(players).where(gt(players.elo, 0)).limit(0));
const topId = queryIdFor(topPlayers.ast);

describe('QueryEngine', () => {
  test('registered query executes via prepared statement with stable name', async () => {
    const driver = new FakeSql('pg');
    driver.handler = () => [{ id: 'a', elo: 2400 }];
    const engine = new QueryEngine(driver);
    engine.register(topId, { ast: topPlayers.ast });

    const rows = await engine.execute(topId, [2000, 10]);
    await engine.execute(topId, [1500, 5]);

    expect(rows).toEqual([{ id: 'a', elo: 2400 }]);
    expect(driver.calls.length).toBe(2);
    expect(driver.calls[0]!.kind).toBe('prepared');
    expect(driver.calls[0]!.name).toBe(`hdb_${topId}`);
    expect(driver.calls[1]!.name).toBe(`hdb_${topId}`);
    expect(driver.calls[0]!.sql).toBe('select * from "players" where "elo" > $1 limit $2');
    expect(driver.calls[0]!.params).toEqual([2000, 10]);
  });

  test('unknown queryId -> unknown_query_id', async () => {
    const engine = new QueryEngine(new FakeSql('pg'));
    expect(engine.execute('nope', [])).rejects.toMatchObject({ code: 'unknown_query_id' });
  });

  test('param count mismatch -> bad_params', async () => {
    const engine = new QueryEngine(new FakeSql('pg'));
    engine.register(topId, { ast: topPlayers.ast });
    expect(engine.execute(topId, [1])).rejects.toMatchObject({ code: 'bad_params' });
  });

  test('mysql dialect also goes through prepared (binary protocol, stmt cache)', async () => {
    const driver = new FakeSql('mysql');
    const engine = new QueryEngine(driver);
    engine.register('q1', { sql: 'select 1 from `users` where `id` = ?', paramCount: 1 });
    await engine.execute('q1', ['a']);
    expect(driver.calls[0]!.kind).toBe('prepared');
  });

  test('executeDynamic caches compiled sql per shape', async () => {
    const driver = new FakeSql('pg');
    const engine = new QueryEngine(driver);
    const q1 = finalize(select(players).where(gt(players.elo, 100)));
    const q2 = finalize(select(players).where(gt(players.elo, 999)));
    await engine.executeDynamic(q1.ast, q1.params);
    await engine.executeDynamic(q2.ast, q2.params);
    expect(engine.dynamicCacheSize).toBe(1); // same shape compiled once
    expect(driver.calls.length).toBe(2);
  });

  test('driver failures wrap as HyperDbError query_failed and stats record timing', async () => {
    const driver = new FakeSql('pg');
    const stats = new Stats();
    const engine = new QueryEngine(driver, { stats });
    engine.register('boom', { sql: 'select 1', paramCount: 0 });
    driver.handler = () => {
      throw new Error('connection reset');
    };
    try {
      await engine.execute('boom', []);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HyperDbError);
      expect((e as HyperDbError).code).toBe('query_failed');
      // failure carries full context for error logging
      expect((e as HyperDbError).details).toEqual({ queryId: 'boom', sql: 'select 1', params: [] });
    }
    driver.handler = () => [];
    await engine.execute('boom', []);
    expect(stats.snapshot().queries.boom!.count).toBeGreaterThanOrEqual(1);
  });
});
