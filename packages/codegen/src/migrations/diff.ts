/** Structural diff between two schema snapshots → ordered migration ops. */
import type { ColumnSnapshot, SchemaSnapshot } from './snapshot';

export type MigrationOp =
  | { op: 'create_table'; table: string; columns: Record<string, ColumnSnapshot> }
  | { op: 'drop_table'; table: string }
  | { op: 'add_column'; table: string; name: string; column: ColumnSnapshot }
  | { op: 'drop_column'; table: string; name: string }
  | { op: 'alter_column'; table: string; name: string; from: ColumnSnapshot; to: ColumnSnapshot };

const sameColumn = (a: ColumnSnapshot, b: ColumnSnapshot): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function diffSnapshots(prev: SchemaSnapshot, next: SchemaSnapshot): MigrationOp[] {
  const ops: MigrationOp[] = [];

  for (const [table, columns] of Object.entries(next.tables)) {
    if (!(table in prev.tables)) {
      ops.push({ op: 'create_table', table, columns });
      continue;
    }
    const prevCols = prev.tables[table]!;
    for (const [name, column] of Object.entries(columns)) {
      const prevCol = prevCols[name];
      if (!prevCol) ops.push({ op: 'add_column', table, name, column });
      else if (!sameColumn(prevCol, column)) ops.push({ op: 'alter_column', table, name, from: prevCol, to: column });
    }
    for (const name of Object.keys(prevCols)) {
      if (!(name in columns)) ops.push({ op: 'drop_column', table, name });
    }
  }

  for (const table of Object.keys(prev.tables)) {
    if (!(table in next.tables)) ops.push({ op: 'drop_table', table });
  }

  return ops;
}
