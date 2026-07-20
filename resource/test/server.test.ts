import { describe, expect, test } from 'bun:test';
import { FakeRedis, FakeSql } from '@hyper-db/core';
import { hyperTable, uuid, integer, TableMeta } from '@hyper-db/schema/pg-core';
import { createServer, type BoundaryCallback } from '../server/server';

const players = hyperTable('players', {
  id: uuid().primaryKey(),
  elo: integer().notNull(),
});

const call = <T>(fn: (cb: BoundaryCallback) => void) =>
  new Promise<{ err: { code: string } | null; rows: T | null }>((resolve) =>
    fn((err, rows) => resolve({ err, rows: rows as T })),
  );

describe('resource server wiring', () => {
  test('registerQueries + execute over the boundary', async () => {
    const sql = new FakeSql('pg');
    sql.handler = () => [{ id: 'a', elo: 2400 }];
    const server = createServer({ sql });
    server.registerQueries({
      top: { queryId: 'q_top', sql: 'select * from "players" limit $1', paramCount: 1 },
    });
    const { err, rows } = await call((cb) => server.execute('q_top', [10], cb));
    expect(err).toBeNull();
    expect(rows).toEqual([{ id: 'a', elo: 2400 }]);
  });

  test('boundary error shape for unknown queryId', async () => {
    const server = createServer({ sql: new FakeSql('pg') });
    const { err, rows } = await call((cb) => server.execute('nope', [], cb));
    expect(rows).toBeNull();
    expect(err!.code).toBe('unknown_query_id');
  });

  test('executeChain end-to-end: descriptor -> sql', async () => {
    const sql = new FakeSql('pg');
    sql.handler = () => [];
    const server = createServer({ sql });
    server.registerTable(players[TableMeta]);
    const { err } = await call((cb) => server.executeChain('players', 'w:elo:gt;o:elo:desc;l', [2000, 10], cb));
    expect(err).toBeNull();
    expect(sql.calls[0]!.sql).toBe('select * from "players" where "elo" > $1 order by "elo" desc limit $2');
    expect(sql.calls[0]!.params).toEqual([2000, 10]);
  });

  test('chain on unregistered table -> bad_params', async () => {
    const server = createServer({ sql: new FakeSql('pg') });
    const { err } = await call((cb) => server.executeChain('ghost', '', [], cb));
    expect(err!.code).toBe('bad_params');
  });

  test('invalidateTags requires redis, works with it', async () => {
    const noRedis = createServer({ sql: new FakeSql('pg') });
    const errNoRedis = await new Promise((resolve) => noRedis.invalidateTags(['x'], resolve));
    expect((errNoRedis as { code: string }).code).toBe('unsupported_feature');

    const withRedis = createServer({ sql: new FakeSql('pg'), redis: new FakeRedis() });
    const errOk = await new Promise((resolve) => withRedis.invalidateTags(['x'], resolve));
    expect(errOk).toBeNull();
  });

  test('stats snapshot exposed', async () => {
    const sql = new FakeSql('pg');
    const server = createServer({ sql });
    server.registerQueries({ q: { queryId: 'q1', sql: 'select 1', paramCount: 0 } });
    await call((cb) => server.execute('q1', [], cb));
    expect(server.hyperdbStats().queries.q1!.count).toBe(1);
  });
});
