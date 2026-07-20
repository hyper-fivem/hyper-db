import { describe, expect, test } from 'bun:test';
import {
  hyperTable,
  varchar,
  int,
  bigint,
  text,
  boolean,
  datetime,
  json,
  double,
  TableMeta,
  type InferSelect,
} from '../src/mysql-core';

const users = hyperTable('users', {
  id: varchar(36).primaryKey(),
  name: varchar(64).notNull(),
  money: bigint().notNull().default(0),
  bio: text(),
  active: boolean().notNull().default(true),
  lastSeen: datetime(),
  inventory: json<{ items: string[] }>(),
  ratio: double(),
  level: int().notNull().default(1),
});

describe('mysql-core hyperTable', () => {
  test('table meta + dialect', () => {
    const meta = users[TableMeta];
    expect(meta.name).toBe('users');
    expect(meta.dialect).toBe('mysql');
  });

  test('varchar carries length in typeArgs', () => {
    expect(users[TableMeta].columns.id!.sqlType).toBe('varchar');
    expect(users[TableMeta].columns.id!.typeArgs).toEqual([36]);
    expect(users[TableMeta].columns.name!.typeArgs).toEqual([64]);
  });

  test('sql types', () => {
    const c = users[TableMeta].columns;
    expect(c.money!.sqlType).toBe('bigint');
    expect(c.bio!.sqlType).toBe('text');
    expect(c.active!.sqlType).toBe('boolean');
    expect(c.lastSeen!.sqlType).toBe('datetime');
    expect(c.inventory!.sqlType).toBe('json');
    expect(c.ratio!.sqlType).toBe('double');
    expect(c.level!.sqlType).toBe('int');
  });

  test('flags & defaults', () => {
    const c = users[TableMeta].columns;
    expect(c.id!.primaryKey).toBe(true);
    expect(c.id!.notNull).toBe(true);
    expect(c.money!.default).toBe(0);
    expect(c.bio!.notNull).toBe(false);
  });

  test('column refs', () => {
    expect(users.money.table).toBe('users');
    expect(users.money.name).toBe('money');
  });

  test('type inference (compile-time)', () => {
    type Sel = InferSelect<typeof users>;
    const sel: Sel = {
      id: 'a', name: 'n', money: 5, bio: null, active: true,
      lastSeen: null, inventory: null, ratio: null, level: 2,
    };
    expect(sel.level).toBe(2);
  });
});
