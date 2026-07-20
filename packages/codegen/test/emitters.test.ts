import { describe, expect, test } from 'bun:test';
import { hyperTable, uuid, text, integer, boolean, jsonb } from '@hyper-db/schema/pg-core';
import { select, gt, finalize, queryIdFor } from '@hyper-db/schema';
import { defineCodegenSchema } from '../src/schema-model';
import { emitTs } from '../src/emit-ts';
import { emitLua } from '../src/emit-lua';
import { emitCs } from '../src/emit-cs';

const players = hyperTable('players', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  elo: integer().notNull().default(1000),
  banned: boolean().notNull().default(false),
  loadout: jsonb<{ w: string[] }>(),
});

const schema = defineCodegenSchema({
  dialect: 'pg',
  tables: [players],
  queries: {
    topPlayers: select(players).where(gt(players.elo, 0)).orderBy(players.elo, 'desc').limit(0),
  },
});

describe('defineCodegenSchema', () => {
  test('collects tables and finalized queries', () => {
    expect(schema.tables.map((t) => t.name)).toEqual(['players']);
    expect(schema.queries.length).toBe(1);
    const q = schema.queries[0]!;
    expect(q.name).toBe('topPlayers');
    expect(q.paramCount).toBe(2);
    expect(q.sql).toBe('select * from "players" where "elo" > $1 order by "elo" desc limit $2');
    const { ast } = finalize(select(players).where(gt(players.elo, 123)).orderBy(players.elo, 'desc').limit(0));
    expect(q.queryId).toBe(queryIdFor(ast)); // id is shape-stable
  });
});

describe('emitters', () => {
  test('ts snapshot', () => {
    expect(emitTs(schema)).toMatchSnapshot();
  });

  test('lua snapshot', () => {
    expect(emitLua(schema)).toMatchSnapshot();
  });

  test('cs snapshot', () => {
    expect(emitCs(schema)).toMatchSnapshot();
  });

  test('ts output contains typed row + manifest entry', () => {
    const ts = emitTs(schema);
    expect(ts).toContain('export interface PlayersRow {');
    expect(ts).toContain('loadout: unknown | null;');
    expect(ts).toContain('paramCount: 2,');
  });

  test('lua output has EmmyLua annotations and boundary-safe calls', () => {
    const lua = emitLua(schema);
    expect(lua).toContain('---@class PlayersRow');
    expect(lua).toContain('---@field loadout table|nil');
    expect(lua).toContain(`HyperDb.execute('${schema.queries[0]!.queryId}', { p1, p2 }, cb)`);
    expect(lua).toContain("HyperDb.chain('players')");
  });

  test('cs output has DTO, columns, coroutine signature (no Task)', () => {
    const cs = emitCs(schema);
    expect(cs).toContain('public sealed class PlayersRow');
    expect(cs).toContain('public static readonly Column Elo = new Column("elo");');
    expect(cs).toContain('Coroutine<List<PlayersRow>> TopPlayers(object p1, object p2)');
    expect(cs).not.toContain('Task<');
  });
});
