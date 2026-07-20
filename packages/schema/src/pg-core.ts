/** PostgreSQL dialect module. First-class PG features (jsonb, RETURNING,
 *  partial indexes, advisory locks) live here — never shared with mysql-core. */
import {
  ColumnBuilder,
  makeTable,
  TableMeta,
  type AnyColumnBuilder,
  type ColumnRef,
  type InferInsertFrom,
  type InferSelectFrom,
  type Table,
} from './internal/column';

export { TableMeta };
export type { ColumnRef };

class PgColumnBuilder<TData, TNotNull extends boolean = false, THasDefault extends boolean = false>
  extends ColumnBuilder<TData, TNotNull, THasDefault> {
  declare notNull: () => PgColumnBuilder<TData, true, THasDefault>;
  declare primaryKey: () => PgColumnBuilder<TData, true, THasDefault>;
  declare default: (value: TData) => PgColumnBuilder<TData, TNotNull, true>;
  declare defaultSql: (expr: string) => PgColumnBuilder<TData, TNotNull, true>;

  defaultNow(this: PgColumnBuilder<Date, TNotNull, THasDefault>): PgColumnBuilder<Date, TNotNull, true> {
    return this.defaultSql('now()') as PgColumnBuilder<Date, TNotNull, true>;
  }

  defaultRandomUuid(this: PgColumnBuilder<string, TNotNull, THasDefault>): PgColumnBuilder<string, TNotNull, true> {
    return this.defaultSql('gen_random_uuid()') as PgColumnBuilder<string, TNotNull, true>;
  }
}

export const uuid = () => new PgColumnBuilder<string>('uuid');
export const text = () => new PgColumnBuilder<string>('text');
export const integer = () => new PgColumnBuilder<number>('integer');
export const bigint = () => new PgColumnBuilder<bigint | number>('bigint');
export const boolean = () => new PgColumnBuilder<boolean>('boolean');
export const timestamptz = () => new PgColumnBuilder<Date>('timestamptz');
export const real = () => new PgColumnBuilder<number>('real');
export const doublePrecision = () => new PgColumnBuilder<number>('double precision');
export const jsonb = <T = unknown>() => new PgColumnBuilder<T>('jsonb');

/** serial: integer with an implicit sequence default */
export const serial = () =>
  new PgColumnBuilder<number, false, true>('serial', [], { hasDefault: true, defaultSql: '<serial>' });

export type PgTable<TCols extends Record<string, AnyColumnBuilder> = Record<string, AnyColumnBuilder>> =
  Table<TCols, 'pg'>;

export function hyperTable<TCols extends Record<string, AnyColumnBuilder>>(
  name: string,
  columns: TCols,
): Table<TCols, 'pg'> {
  return makeTable('pg', name, columns);
}

export type InferSelect<T> = InferSelectFrom<T>;
export type InferInsert<T> = InferInsertFrom<T>;
