import { describe, expect, test } from 'bun:test';
import { hyperTable, uuid, text, integer, boolean } from '../src/pg-core';
import {
  select, insert, update, del,
  eq, ne, gt, gte, lt, lte, like, inArray, isNull, isNotNull, and, or, not,
  finalize,
} from '../src/ast';

const players = hyperTable('players', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  elo: integer().notNull().default(1000),
  banned: boolean().notNull().default(false),
});

describe('query AST', () => {
  test('select with where/orderBy/limit produces AST + ordered params', () => {
    const q = select(players)
      .where(and(gt(players.elo, 2000), eq(players.banned, false)))
      .orderBy(players.elo, 'desc')
      .limit(10);
    const { ast, params } = finalize(q);
    expect(ast.kind).toBe('select');
    expect(ast.table).toBe('players');
    expect(params).toEqual([2000, false, 10]);
    if (ast.kind !== 'select') throw new Error('unreachable');
    expect(ast.where).toEqual({
      op: 'and',
      conditions: [
        { op: 'gt', col: { table: 'players', column: 'elo' }, value: { param: 0 } },
        { op: 'eq', col: { table: 'players', column: 'banned' }, value: { param: 1 } },
      ],
    });
    expect(ast.orderBy).toEqual([{ col: { table: 'players', column: 'elo' }, dir: 'desc' }]);
    expect(ast.limit).toEqual({ param: 2 });
  });

  test('select specific columns', () => {
    const { ast } = finalize(select(players, [players.id, players.elo]));
    if (ast.kind !== 'select') throw new Error('unreachable');
    expect(ast.columns).toEqual([
      { table: 'players', column: 'id' },
      { table: 'players', column: 'elo' },
    ]);
  });

  test('inArray keeps one param per element', () => {
    const { ast, params } = finalize(select(players).where(inArray(players.name, ['a', 'b', 'c'])));
    if (ast.kind !== 'select') throw new Error('unreachable');
    expect(params).toEqual(['a', 'b', 'c']);
    expect(ast.where).toEqual({
      op: 'in',
      col: { table: 'players', column: 'name' },
      values: [{ param: 0 }, { param: 1 }, { param: 2 }],
    });
  });

  test('or / not / null ops', () => {
    const { ast } = finalize(
      select(players).where(or(isNull(players.name), not(isNotNull(players.elo)), ne(players.elo, 1), lte(players.elo, 2), gte(players.elo, 0), lt(players.elo, 9), like(players.name, 'x%'))),
    );
    if (ast.kind !== 'select') throw new Error('unreachable');
    expect(ast.where!.op).toBe('or');
  });

  test('insert with values + returning', () => {
    const q = insert(players).values({ id: 'u1', name: 'ata' }).returning();
    const { ast, params } = finalize(q);
    expect(ast.kind).toBe('insert');
    if (ast.kind !== 'insert') throw new Error('unreachable');
    expect(ast.columns).toEqual(['id', 'name']);
    expect(ast.rows).toEqual([[{ param: 0 }, { param: 1 }]]);
    expect(params).toEqual(['u1', 'ata']);
    expect(ast.returning).toBe('*');
  });

  test('insert multiple rows + onConflict update', () => {
    const q = insert(players)
      .values([{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }])
      .onConflictDoUpdate([players.id], { name: 'z' });
    const { ast, params } = finalize(q);
    if (ast.kind !== 'insert') throw new Error('unreachable');
    expect(ast.rows.length).toBe(2);
    // param order: rows row-major, then onConflict set values
    expect(params).toEqual(['a', 'x', 'b', 'y', 'z']);
    expect(ast.onConflict).toEqual({
      target: ['id'],
      set: { name: { param: 4 } },
    });
  });

  test('update with set + where', () => {
    const { ast, params } = finalize(update(players).set({ elo: 1500 }).where(eq(players.id, 'u1')).returning([players.elo]));
    if (ast.kind !== 'update') throw new Error('unreachable');
    expect(ast.set).toEqual({ elo: { param: 0 } });
    expect(params).toEqual([1500, 'u1']);
    expect(ast.returning).toEqual([{ table: 'players', column: 'elo' }]);
  });

  test('delete with where', () => {
    const { ast, params } = finalize(del(players).where(eq(players.id, 'u1')));
    expect(ast.kind).toBe('delete');
    expect(params).toEqual(['u1']);
  });

  test('finalize is deterministic and pure', () => {
    const q = select(players).where(gt(players.elo, 5));
    const a = finalize(q);
    const b = finalize(q);
    expect(a.ast).toEqual(b.ast);
    expect(a.params).toEqual(b.params);
  });
});
