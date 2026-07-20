#!/usr/bin/env bun
/** hyperdb CLI:
 *    hyperdb codegen  --schema <file> --out <dir>     emit ts/lua/cs
 *    hyperdb generate --schema <file> --out <dir>     snapshot diff → .sql migration
 *    hyperdb push     --schema <file>                 apply diff directly (dev)
 *  The schema file's default export is a CodegenInput:
 *    export default { dialect: 'pg', tables: [players], queries: { topPlayers } } */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineCodegenSchema, type CodegenInput, type CodegenSchema } from './schema-model';
import { emitTs } from './emit-ts';
import { emitLua } from './emit-lua';
import { emitCs } from './emit-cs';
import { snapshotOf, emptySnapshot, type SchemaSnapshot } from './migrations/snapshot';
import { diffSnapshots } from './migrations/diff';
import { sqlForOps } from './migrations/sqlgen';

async function loadSchema(schemaPath: string): Promise<CodegenSchema> {
  const mod = (await import(pathToFileURL(resolve(schemaPath)).href)) as { default?: CodegenInput };
  if (!mod.default) throw new Error(`schema file ${schemaPath} must default-export a CodegenInput`);
  return defineCodegenSchema(mod.default);
}

export async function runCodegen(schemaPath: string, outDir: string): Promise<string[]> {
  const schema = await loadSchema(schemaPath);
  await mkdir(outDir, { recursive: true });
  const files = [
    ['hyperdb.generated.ts', emitTs(schema)],
    ['hyperdb.generated.lua', emitLua(schema)],
    ['HyperDb.Generated.cs', emitCs(schema)],
  ] as const;
  for (const [name, content] of files) await writeFile(join(outDir, name), content);
  return files.map(([name]) => join(outDir, name));
}

const SNAPSHOT_FILE = 'snapshot.json';

export async function runGenerate(schemaPath: string, outDir: string): Promise<string | null> {
  const schema = await loadSchema(schemaPath);
  await mkdir(outDir, { recursive: true });
  const snapshotPath = join(outDir, SNAPSHOT_FILE);
  const prev: SchemaSnapshot = existsSync(snapshotPath)
    ? (JSON.parse(await readFile(snapshotPath, 'utf8')) as SchemaSnapshot)
    : emptySnapshot(schema.dialect);
  const next = snapshotOf(schema.dialect, schema.tables);
  const ops = diffSnapshots(prev, next);
  if (ops.length === 0) return null;
  const statements = sqlForOps(ops, schema.dialect);
  const existing = (await readdir(outDir)).filter((f) => f.endsWith('.sql'));
  const index = String(existing.length + 1).padStart(4, '0');
  const migrationPath = join(outDir, `${index}_migration.sql`);
  await writeFile(migrationPath, statements.join('\n') + '\n');
  await writeFile(snapshotPath, JSON.stringify(next, null, 2));
  return migrationPath;
}

export async function runPush(schemaPath: string): Promise<number> {
  const schema = await loadSchema(schemaPath);
  const next = snapshotOf(schema.dialect, schema.tables);
  const ops = diffSnapshots(emptySnapshot(schema.dialect), next);
  const statements = sqlForOps(ops, schema.dialect);
  const core = await import('@hyper-db/core');
  const driver =
    schema.dialect === 'pg'
      ? new core.PgDriver({
          host: process.env.HYPERDB_PG_HOST ?? 'localhost',
          database: process.env.HYPERDB_PG_DB ?? 'hyperdb',
          username: process.env.HYPERDB_PG_USER ?? 'hyper',
          password: process.env.HYPERDB_PG_PASSWORD ?? 'hyper',
        })
      : new core.MysqlDriver({
          host: process.env.HYPERDB_MYSQL_HOST ?? 'localhost',
          database: process.env.HYPERDB_MYSQL_DB ?? 'hyperdb',
          user: process.env.HYPERDB_MYSQL_USER ?? 'hyper',
          password: process.env.HYPERDB_MYSQL_PASSWORD ?? 'hyper',
        });
  try {
    for (const sql of statements) await driver.query(sql, []);
  } finally {
    await driver.close();
  }
  return statements.length;
}

function arg(args: string[], name: string): string {
  const i = args.indexOf(`--${name}`);
  const value = i >= 0 ? args[i + 1] : undefined;
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'codegen': {
      const files = await runCodegen(arg(args, 'schema'), arg(args, 'out'));
      console.log(`generated:\n  ${files.join('\n  ')}`);
      break;
    }
    case 'generate': {
      const file = await runGenerate(arg(args, 'schema'), arg(args, 'out'));
      console.log(file ? `migration written: ${file}` : 'no changes');
      break;
    }
    case 'push': {
      const n = await runPush(arg(args, 'schema'));
      console.log(`applied ${n} statement(s)`);
      break;
    }
    default:
      console.log('usage: hyperdb <codegen|generate|push> --schema <file> [--out <dir>]');
      process.exitCode = command ? 1 : 0;
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
