import { describe, expect, test } from 'bun:test';
import { hyperTable, uuid, integer } from '../src/pg-core';
import { select, gt, eq, finalize } from '../src/ast';
import { queryIdFor } from '../src/query-id';

const players = hyperTable('players', {
  id: uuid().primaryKey(),
  elo: integer().notNull(),
});

describe('queryIdFor', () => {
  test('16 hex chars', () => {
    const { ast } = finalize(select(players));
    expect(queryIdFor(ast)).toMatch(/^[0-9a-f]{16}$/);
  });

  test('same shape, different param values -> same id', () => {
    const a = finalize(select(players).where(gt(players.elo, 100))).ast;
    const b = finalize(select(players).where(gt(players.elo, 9999))).ast;
    expect(queryIdFor(a)).toBe(queryIdFor(b));
  });

  test('different shape -> different id', () => {
    const a = finalize(select(players).where(gt(players.elo, 100))).ast;
    const b = finalize(select(players).where(eq(players.elo, 100))).ast;
    const c = finalize(select(players).where(gt(players.elo, 100)).limit(5)).ast;
    expect(queryIdFor(a)).not.toBe(queryIdFor(b));
    expect(queryIdFor(a)).not.toBe(queryIdFor(c));
  });

  test('key order independent (canonical json)', () => {
    const a = { kind: 'select', table: 'players' } as const;
    const b = { table: 'players', kind: 'select' } as const;
    expect(queryIdFor(a as never)).toBe(queryIdFor(b as never));
  });
});
