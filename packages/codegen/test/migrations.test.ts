import { describe, expect, test } from 'bun:test';
import { hyperTable, uuid, text, integer, TableMeta } from '@hyper-db/schema/pg-core';
import { hyperTable as myTable, varchar, int, TableMeta as MyMeta } from '@hyper-db/schema/mysql-core';
import { snapshotOf, emptySnapshot } from '../src/migrations/snapshot';
import { diffSnapshots } from '../src/migrations/diff';
import { sqlForOps } from '../src/migrations/sqlgen';

const playersV1 = hyperTable('players', {
  id: uuid().primaryKey(),
  name: text().notNull(),
});

const playersV2 = hyperTable('players', {
  id: uuid().primaryKey(),
  name: text().notNull().unique(),
  elo: integer().notNull().default(1000),
});

describe('migrations pg', () => {
  test('empty -> v1 creates table', () => {
    const ops = diffSnapshots(emptySnapshot('pg'), snapshotOf('pg', [playersV1[TableMeta]]));
    expect(ops.map((o) => o.op)).toEqual(['create_table']);
    expect(sqlForOps(ops, 'pg')).toEqual([
      'create table "players" ("id" uuid primary key, "name" text not null);',
    ]);
  });

  test('v1 -> v2 adds column and alters unique', () => {
    const ops = diffSnapshots(snapshotOf('pg', [playersV1[TableMeta]]), snapshotOf('pg', [playersV2[TableMeta]]));
    expect(ops.map((o) => o.op).sort()).toEqual(['add_column', 'alter_column']);
    const sql = sqlForOps(ops, 'pg');
    expect(sql).toContain('alter table "players" add column "elo" integer not null default 1000;');
  });

  test('v2 -> v1 drops column', () => {
    const ops = diffSnapshots(snapshotOf('pg', [playersV2[TableMeta]]), snapshotOf('pg', [playersV1[TableMeta]]));
    const sql = sqlForOps(ops, 'pg');
    expect(sql).toContain('alter table "players" drop column "elo";');
  });

  test('dropping a table', () => {
    const ops = diffSnapshots(snapshotOf('pg', [playersV1[TableMeta]]), emptySnapshot('pg'));
    expect(sqlForOps(ops, 'pg')).toEqual(['drop table "players";']);
  });

  test('no changes -> no ops', () => {
    const snap = snapshotOf('pg', [playersV2[TableMeta]]);
    expect(diffSnapshots(snap, snap)).toEqual([]);
  });

  test('alter column type + notnull renders separate pg statements', () => {
    const a = hyperTable('t', { v: integer() });
    const b = hyperTable('t', { v: text().notNull() });
    const ops = diffSnapshots(snapshotOf('pg', [a[TableMeta]]), snapshotOf('pg', [b[TableMeta]]));
    expect(sqlForOps(ops, 'pg')).toEqual([
      'alter table "t" alter column "v" type text;',
      'alter table "t" alter column "v" set not null;',
    ]);
  });
});

describe('migrations mysql', () => {
  const usersV1 = myTable('users', { id: varchar(36).primaryKey(), lvl: int() });
  const usersV2 = myTable('users', { id: varchar(36).primaryKey(), lvl: int().notNull().default(1) });

  test('create table renders varchar length + backticks', () => {
    const ops = diffSnapshots(emptySnapshot('mysql'), snapshotOf('mysql', [usersV1[MyMeta]]));
    expect(sqlForOps(ops, 'mysql')).toEqual([
      'create table `users` (`id` varchar(36) primary key, `lvl` int);',
    ]);
  });

  test('alter column uses modify column', () => {
    const ops = diffSnapshots(snapshotOf('mysql', [usersV1[MyMeta]]), snapshotOf('mysql', [usersV2[MyMeta]]));
    expect(sqlForOps(ops, 'mysql')).toEqual([
      'alter table `users` modify column `lvl` int not null default 1;',
    ]);
  });
});
