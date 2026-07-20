/** Migration ops → dialect SQL statements. */
import type { ColumnSnapshot } from './snapshot';
import type { MigrationOp } from './diff';

type Dialect = 'pg' | 'mysql';

const q = (dialect: Dialect, name: string): string => {
  const quote = dialect === 'pg' ? '"' : '`';
  if (name.includes(quote)) throw new Error(`invalid identifier: ${name}`);
  return `${quote}${name}${quote}`;
};

function renderType(dialect: Dialect, col: ColumnSnapshot): string {
  if (col.typeArgs.length > 0) return `${col.sqlType}(${col.typeArgs.join(', ')})`;
  return col.sqlType;
}

function renderDefault(col: ColumnSnapshot): string | undefined {
  if (!col.hasDefault) return undefined;
  if (col.defaultSql !== undefined) return col.defaultSql === '<serial>' ? undefined : col.defaultSql;
  const v = col.default;
  if (typeof v === 'string') return `'${v.replaceAll("'", "''")}'`;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${JSON.stringify(v)}'`;
}

function columnDef(dialect: Dialect, name: string, col: ColumnSnapshot): string {
  let def = `${q(dialect, name)} ${renderType(dialect, col)}`;
  if (col.primaryKey) def += ' primary key';
  else {
    if (col.notNull) def += ' not null';
    if (col.unique) def += ' unique';
  }
  const dflt = renderDefault(col);
  if (dflt !== undefined) def += ` default ${dflt}`;
  return def;
}

export function sqlForOps(ops: MigrationOp[], dialect: Dialect): string[] {
  const statements: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'create_table': {
        const cols = Object.entries(op.columns).map(([name, col]) => columnDef(dialect, name, col));
        statements.push(`create table ${q(dialect, op.table)} (${cols.join(', ')});`);
        break;
      }
      case 'drop_table':
        statements.push(`drop table ${q(dialect, op.table)};`);
        break;
      case 'add_column':
        statements.push(`alter table ${q(dialect, op.table)} add column ${columnDef(dialect, op.name, op.column)};`);
        break;
      case 'drop_column':
        statements.push(`alter table ${q(dialect, op.table)} drop column ${q(dialect, op.name)};`);
        break;
      case 'alter_column': {
        if (dialect === 'mysql') {
          statements.push(`alter table ${q(dialect, op.table)} modify column ${columnDef(dialect, op.name, op.to)};`);
          break;
        }
        const table = q(dialect, op.table);
        const name = q(dialect, op.name);
        if (renderType(dialect, op.from) !== renderType(dialect, op.to)) {
          statements.push(`alter table ${table} alter column ${name} type ${renderType(dialect, op.to)};`);
        }
        if (op.from.notNull !== op.to.notNull) {
          statements.push(`alter table ${table} alter column ${name} ${op.to.notNull ? 'set' : 'drop'} not null;`);
        }
        const fromDefault = renderDefault(op.from);
        const toDefault = renderDefault(op.to);
        if (fromDefault !== toDefault) {
          statements.push(
            toDefault === undefined
              ? `alter table ${table} alter column ${name} drop default;`
              : `alter table ${table} alter column ${name} set default ${toDefault};`,
          );
        }
        break;
      }
    }
  }
  return statements;
}
