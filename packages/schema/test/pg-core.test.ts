import { describe, expect, test } from 'bun:test';
import {
  hyperTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamptz,
  jsonb,
  real,
  serial,
  TableMeta,
  type InferSelect,
  type InferInsert,
} from '../src/pg-core';

const players = hyperTable('players', {
  id: uuid().primaryKey(),
  name: text().notNull().unique(),
  elo: integer().notNull().default(1000),
  bio: text(),
  wealth: bigint(),
  banned: boolean().notNull().default(false),
  createdAt: timestamptz().notNull().defaultNow(),
  loadout: jsonb<{ weapons: string[] }>(),
  accuracy: real(),
  seq: serial(),
});

describe('pg-core hyperTable', () => {
  test('exposes table meta', () => {
    const meta = players[TableMeta];
    expect(meta.name).toBe('players');
    expect(meta.dialect).toBe('pg');
    expect(Object.keys(meta.columns)).toEqual([
      'id', 'name', 'elo', 'bio', 'wealth', 'banned', 'createdAt', 'loadout', 'accuracy', 'seq',
    ]);
  });

  test('column flags', () => {
    const c = players[TableMeta].columns;
    expect(c.id!.primaryKey).toBe(true);
    expect(c.id!.notNull).toBe(true); // pk implies notNull
    expect(c.name!.unique).toBe(true);
    expect(c.elo!.hasDefault).toBe(true);
    expect(c.elo!.default).toBe(1000);
    expect(c.bio!.notNull).toBe(false);
    expect(c.createdAt!.defaultSql).toBe('now()');
    expect(c.seq!.hasDefault).toBe(true); // serial self-defaults
  });

  test('sql types', () => {
    const c = players[TableMeta].columns;
    expect(c.id!.sqlType).toBe('uuid');
    expect(c.name!.sqlType).toBe('text');
    expect(c.elo!.sqlType).toBe('integer');
    expect(c.wealth!.sqlType).toBe('bigint');
    expect(c.banned!.sqlType).toBe('boolean');
    expect(c.createdAt!.sqlType).toBe('timestamptz');
    expect(c.loadout!.sqlType).toBe('jsonb');
    expect(c.accuracy!.sqlType).toBe('real');
    expect(c.seq!.sqlType).toBe('serial');
  });

  test('columns are refs usable in queries', () => {
    expect(players.elo.table).toBe('players');
    expect(players.elo.name).toBe('elo');
    expect(players.loadout.name).toBe('loadout');
  });

  test('references()', () => {
    const matches = hyperTable('matches', {
      id: uuid().primaryKey(),
      winnerId: uuid().notNull().references(() => players.id),
    });
    const ref = matches[TableMeta].columns.winnerId!.references!();
    expect(ref.table).toBe('players');
    expect(ref.name).toBe('id');
  });

  test('type inference (compile-time)', () => {
    type Sel = InferSelect<typeof players>;
    type Ins = InferInsert<typeof players>;
    const sel: Sel = {
      id: 'a', name: 'b', elo: 1, bio: null, wealth: null, banned: false,
      createdAt: new Date(), loadout: { weapons: ['ak'] }, accuracy: null, seq: 1,
    };
    // insert: defaults & nullables optional, notNull-without-default required
    const ins: Ins = { id: 'a', name: 'b' };
    // @ts-expect-error name is required
    const bad: Ins = { id: 'a' };
    expect(sel.elo).toBe(1);
    expect(ins.id).toBe('a');
    expect(bad).toBeDefined();
  });
});
