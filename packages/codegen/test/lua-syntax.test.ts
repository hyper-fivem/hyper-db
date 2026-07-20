import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
// @ts-expect-error luaparse ships no types
import luaparse from 'luaparse';
import { hyperTable, uuid, text, integer } from '@hyper-db/schema/pg-core';
import { select, gt } from '@hyper-db/schema';
import { defineCodegenSchema } from '../src/schema-model';
import { emitLua } from '../src/emit-lua';

const parse = (code: string) => luaparse.parse(code, { luaVersion: '5.3' });

describe('lua syntax', () => {
  test('client runtime hyperdb.lua parses', async () => {
    const src = await readFile(join(import.meta.dir, '..', '..', 'client-lua', 'hyperdb.lua'), 'utf8');
    expect(() => parse(src)).not.toThrow();
  });

  test('generated lua parses', () => {
    const players = hyperTable('players', {
      id: uuid().primaryKey(),
      name: text().notNull(),
      elo: integer().notNull(),
    });
    const schema = defineCodegenSchema({
      dialect: 'pg',
      tables: [players],
      queries: { top: select(players).where(gt(players.elo, 0)).limit(0) },
    });
    expect(() => parse(emitLua(schema))).not.toThrow();
  });
});
