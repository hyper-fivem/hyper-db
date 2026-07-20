import { describe, expect, test } from 'bun:test';
import { hyperTable, uuid, text, integer, boolean, jsonb } from '../src/pg-core';
import { select, insert, update, del, eq, gt, and, or, inArray, isNull, not, finalize } from '../src/ast';
import { compilePg } from '../src/sql/pg';

const players = hyperTable('players', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  elo: integer().notNull().default(1000),
  banned: boolean().notNull().default(false),
  loadout: jsonb<{ w: string[] }>(),
});

const compile = (b: Parameters<typeof finalize>[0]) => compilePg(finalize(b).ast);

describe('compilePg golden', () => {
  test('select all', () => {
    expect(compile(select(players)).sql).toBe('select * from "players"');
  });

  test('select columns + where + order + limit + offset', () => {
    const q = select(players, [players.id, players.elo])
      .where(and(gt(players.elo, 2000), eq(players.banned, false)))
      .orderBy(players.elo, 'desc')
      .limit(10)
      .offset(5);
    const { sql, paramCount } = compile(q);
    expect(sql).toBe(
      'select "id", "elo" from "players" where ("elo" > $1 and "banned" = $2) order by "elo" desc limit $3 offset $4',
    );
    expect(paramCount).toBe(4);
  });

  test('nested or/and, not, isNull, inArray', () => {
    const q = select(players).where(
      or(and(gt(players.elo, 1), not(eq(players.banned, true))), isNull(players.loadout), inArray(players.name, ['a', 'b'])),
    );
    expect(compile(q).sql).toBe(
      'select * from "players" where (("elo" > $1 and not ("banned" = $2)) or "loadout" is null or "name" in ($3, $4))',
    );
  });

  test('insert with returning *', () => {
    const q = insert(players).values({ id: 'x', name: 'ata' }).returning();
    expect(compile(q).sql).toBe('insert into "players" ("id", "name") values ($1, $2) returning *');
  });

  test('insert multi-row + on conflict do update', () => {
    const q = insert(players)
      .values([{ id: 'a', elo: 1 }, { id: 'b', elo: 2 }])
      .onConflictDoUpdate([players.id], { elo: 3 });
    expect(compile(q).sql).toBe(
      'insert into "players" ("id", "elo") values ($1, $2), ($3, $4) on conflict ("id") do update set "elo" = $5',
    );
  });

  test('insert on conflict do nothing', () => {
    const q = insert(players).values({ id: 'a' }).onConflictDoNothing([players.id]);
    expect(compile(q).sql).toBe('insert into "players" ("id") values ($1) on conflict ("id") do nothing');
  });

  test('update with returning columns', () => {
    const q = update(players).set({ elo: 1500, banned: true }).where(eq(players.id, 'u1')).returning([players.elo]);
    expect(compile(q).sql).toBe('update "players" set "elo" = $1, "banned" = $2 where "id" = $3 returning "elo"');
  });

  test('delete', () => {
    expect(compile(del(players).where(eq(players.id, 'u1'))).sql).toBe('delete from "players" where "id" = $1');
  });

  test('identifier quoting rejects embedded quotes', () => {
    const evil = hyperTable('play"ers', { id: uuid() });
    expect(() => compile(select(evil))).toThrow();
  });
});
