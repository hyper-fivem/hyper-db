/** Schema snapshot: canonical JSON of table metas, stored alongside generated
 *  migrations (drizzle-kit model: snapshot → diff → SQL). */
import type { ColumnMeta, TableMetaValue } from '@hyper-db/schema';

export interface ColumnSnapshot {
  sqlType: string;
  typeArgs: (number | string)[];
  notNull: boolean;
  primaryKey: boolean;
  unique: boolean;
  hasDefault: boolean;
  default?: unknown;
  defaultSql?: string;
}

export interface SchemaSnapshot {
  version: 1;
  dialect: 'pg' | 'mysql';
  tables: Record<string, Record<string, ColumnSnapshot>>;
}

function columnSnapshot(meta: ColumnMeta): ColumnSnapshot {
  const snap: ColumnSnapshot = {
    sqlType: meta.sqlType,
    typeArgs: [...meta.typeArgs],
    notNull: meta.notNull,
    primaryKey: meta.primaryKey,
    unique: meta.unique,
    hasDefault: meta.hasDefault,
  };
  if (meta.default !== undefined) snap.default = meta.default;
  if (meta.defaultSql !== undefined) snap.defaultSql = meta.defaultSql;
  return snap;
}

export function snapshotOf(dialect: 'pg' | 'mysql', tables: TableMetaValue[]): SchemaSnapshot {
  const out: SchemaSnapshot = { version: 1, dialect, tables: {} };
  for (const table of tables) {
    out.tables[table.name] = Object.fromEntries(
      Object.entries(table.columns).map(([name, col]) => [name, columnSnapshot(col)]),
    );
  }
  return out;
}

export const emptySnapshot = (dialect: 'pg' | 'mysql'): SchemaSnapshot => ({ version: 1, dialect, tables: {} });
