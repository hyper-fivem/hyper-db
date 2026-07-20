import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodegen, runGenerate } from '../src/cli';

const schemaPath = join(import.meta.dir, 'fixtures', 'schema.ts');

describe('cli', () => {
  test('runCodegen writes ts/lua/cs files', async () => {
    const out = await mkdtemp(join(tmpdir(), 'hyperdb-codegen-'));
    const files = await runCodegen(schemaPath, out);
    expect(files.length).toBe(3);
    const ts = await readFile(join(out, 'hyperdb.generated.ts'), 'utf8');
    expect(ts).toContain('export interface PlayersRow');
    const lua = await readFile(join(out, 'hyperdb.generated.lua'), 'utf8');
    expect(lua).toContain('---@class PlayersRow');
    const cs = await readFile(join(out, 'HyperDb.Generated.cs'), 'utf8');
    expect(cs).toContain('public sealed class PlayersRow');
  });

  test('runGenerate writes migration once, then reports no changes', async () => {
    const out = await mkdtemp(join(tmpdir(), 'hyperdb-mig-'));
    const first = await runGenerate(schemaPath, out);
    expect(first).toMatch(/0001_migration\.sql$/);
    const sql = await readFile(first!, 'utf8');
    expect(sql).toContain('create table "players"');
    const second = await runGenerate(schemaPath, out);
    expect(second).toBeNull();
    const files = await readdir(out);
    expect(files.sort()).toEqual(['0001_migration.sql', 'snapshot.json']);
  });
});
