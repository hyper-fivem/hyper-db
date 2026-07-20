import { describe, expect, test } from 'bun:test';
import { hyperTable, varchar, int, boolean } from '../src/mysql-core';
import { select, insert, update, del, eq, gt, and, inArray, finalize } from '../src/ast';
import { compileMysql } from '../src/sql/mysql';

const users = hyperTable('users', {
  id: varchar(36).primaryKey(),
  name: varchar(64).notNull(),
  level: int().notNull().default(1),
  active: boolean().notNull().default(true),
});

const compile = (b: Parameters<typeof finalize>[0]) => compileMysql(finalize(b).ast);

describe('compileMysql golden', () => {
  test('select with where/order/limit', () => {
    const q = select(users, [users.id, users.level])
      .where(and(gt(users.level, 5), eq(users.active, true)))
      .orderBy(users.level, 'desc')
      .limit(10);
    const { sql, paramCount } = compile(q);
    expect(sql).toBe('select `id`, `level` from `users` where (`level` > ? and `active` = ?) order by `level` desc limit ?');
    expect(paramCount).toBe(3);
  });

  test('inArray', () => {
    expect(compile(select(users).where(inArray(users.id, ['a', 'b']))).sql).toBe(
      'select * from `users` where `id` in (?, ?)',
    );
  });

  test('insert + on duplicate key update', () => {
    const q = insert(users).values({ id: 'a', name: 'x' }).onConflictDoUpdate([users.id], { name: 'y' });
    expect(compile(q).sql).toBe(
      'insert into `users` (`id`, `name`) values (?, ?) on duplicate key update `name` = ?',
    );
  });

  test('update / delete', () => {
    expect(compile(update(users).set({ level: 2 }).where(eq(users.id, 'a'))).sql).toBe(
      'update `users` set `level` = ? where `id` = ?',
    );
    expect(compile(del(users).where(eq(users.id, 'a'))).sql).toBe('delete from `users` where `id` = ?');
  });

  test('returning is rejected with unsupported_feature', () => {
    const q = insert(users).values({ id: 'a' }).returning();
    expect(() => compile(q)).toThrow(/unsupported_feature/);
  });

  test('params must stay in placeholder order', () => {
    // mysql uses positional ?; compiled order must match finalize() numbering
    const q = update(users).set({ level: 9 }).where(eq(users.id, 'z'));
    const { ast, params } = finalize(q);
    expect(params).toEqual([9, 'z']);
    expect(compileMysql(ast).paramCount).toBe(2);
  });
});
