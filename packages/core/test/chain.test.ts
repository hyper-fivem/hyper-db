import { describe, expect, test } from 'bun:test';
import { hyperTable, uuid, integer, text, TableMeta } from '@hyper-db/schema/pg-core';
import { compilePg } from '@hyper-db/schema';
import { parseChain } from '../src/chain';

const players = hyperTable('players', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  elo: integer().notNull(),
});
const meta = players[TableMeta];

describe('parseChain', () => {
  test('where + orderBy + limit descriptor -> AST', () => {
    const ast = parseChain(meta, 'w:elo:gt;w:name:eq;o:elo:desc;l');
    const { sql, paramCount } = compilePg(ast);
    expect(sql).toBe('select * from "players" where ("elo" > $1 and "name" = $2) order by "elo" desc limit $3');
    expect(paramCount).toBe(3);
  });

  test('single where, no extras', () => {
    const ast = parseChain(meta, 'w:elo:gte');
    expect(compilePg(ast).sql).toBe('select * from "players" where "elo" >= $1');
  });

  test('empty descriptor selects all', () => {
    expect(compilePg(parseChain(meta, '')).sql).toBe('select * from "players"');
  });

  test('offset segment', () => {
    expect(compilePg(parseChain(meta, 'l;of')).sql).toBe('select * from "players" limit $1 offset $2');
  });

  test('unknown column rejected', () => {
    expect(() => parseChain(meta, 'w:hax:eq')).toThrow(/unknown column/);
  });

  test('unknown op or segment rejected', () => {
    expect(() => parseChain(meta, 'w:elo:regex')).toThrow(/unknown/);
    expect(() => parseChain(meta, 'x:elo')).toThrow(/unknown/);
  });
});
