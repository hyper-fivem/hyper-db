/** MariaDB/MySQL dialect module — independent surface from pg-core, so the
 *  PG side never pays a common-denominator tax (and vice versa). */
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

class MysqlColumnBuilder<TData, TNotNull extends boolean = false, THasDefault extends boolean = false>
  extends ColumnBuilder<TData, TNotNull, THasDefault> {
  declare notNull: () => MysqlColumnBuilder<TData, true, THasDefault>;
  declare primaryKey: () => MysqlColumnBuilder<TData, true, THasDefault>;
  declare default: (value: TData) => MysqlColumnBuilder<TData, TNotNull, true>;
  declare defaultSql: (expr: string) => MysqlColumnBuilder<TData, TNotNull, true>;

  defaultNow(this: MysqlColumnBuilder<Date, TNotNull, THasDefault>): MysqlColumnBuilder<Date, TNotNull, true> {
    return this.defaultSql('CURRENT_TIMESTAMP') as MysqlColumnBuilder<Date, TNotNull, true>;
  }
}

export const varchar = (length: number) => new MysqlColumnBuilder<string>('varchar', [length]);
export const int = () => new MysqlColumnBuilder<number>('int');
export const bigint = () => new MysqlColumnBuilder<bigint | number>('bigint');
export const text = () => new MysqlColumnBuilder<string>('text');
export const boolean = () => new MysqlColumnBuilder<boolean>('boolean');
export const datetime = () => new MysqlColumnBuilder<Date>('datetime');
export const double = () => new MysqlColumnBuilder<number>('double');
export const json = <T = unknown>() => new MysqlColumnBuilder<T>('json');

export type MysqlTable<TCols extends Record<string, AnyColumnBuilder> = Record<string, AnyColumnBuilder>> =
  Table<TCols, 'mysql'>;

export function hyperTable<TCols extends Record<string, AnyColumnBuilder>>(
  name: string,
  columns: TCols,
): Table<TCols, 'mysql'> {
  return makeTable('mysql', name, columns);
}

export type InferSelect<T> = InferSelectFrom<T>;
export type InferInsert<T> = InferInsertFrom<T>;
