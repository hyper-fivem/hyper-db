/** Shared column/table machinery. Each dialect module composes its own
 *  column set from this — the dialect APIs stay independent (no common-
 *  denominator surface), only the plumbing is shared. */

export interface ColumnRefTarget {
  readonly table: string;
  readonly name: string;
}

export interface ColumnMeta {
  sqlType: string;
  /** dialect-specific type args, e.g. varchar length */
  typeArgs: readonly (number | string)[];
  notNull: boolean;
  primaryKey: boolean;
  unique: boolean;
  hasDefault: boolean;
  default?: unknown;
  /** raw SQL default (e.g. now()) — takes precedence over `default` */
  defaultSql?: string;
  references?: () => ColumnRefTarget;
}

export const TableMeta = Symbol.for('hyperdb:table');

export interface TableMetaValue {
  name: string;
  dialect: 'pg' | 'mysql';
  columns: Record<string, ColumnMeta>;
}

/** Phantom-typed column builder. TData: TS type; TNotNull/THasDefault drive
 *  select/insert inference. */
export class ColumnBuilder<TData, TNotNull extends boolean = false, THasDefault extends boolean = false> {
  declare readonly _type: TData;
  declare readonly _notNull: TNotNull;
  declare readonly _hasDefault: THasDefault;
  readonly meta: ColumnMeta;

  constructor(sqlType: string, typeArgs: readonly (number | string)[] = [], meta?: Partial<ColumnMeta>) {
    this.meta = {
      sqlType,
      typeArgs,
      notNull: false,
      primaryKey: false,
      unique: false,
      hasDefault: false,
      ...meta,
    };
  }

  notNull(): ColumnBuilder<TData, true, THasDefault> {
    this.meta.notNull = true;
    return this as unknown as ColumnBuilder<TData, true, THasDefault>;
  }

  primaryKey(): ColumnBuilder<TData, true, THasDefault> {
    this.meta.primaryKey = true;
    this.meta.notNull = true;
    return this as unknown as ColumnBuilder<TData, true, THasDefault>;
  }

  unique(): this {
    this.meta.unique = true;
    return this;
  }

  default(value: TData): ColumnBuilder<TData, TNotNull, true> {
    this.meta.hasDefault = true;
    this.meta.default = value;
    return this as unknown as ColumnBuilder<TData, TNotNull, true>;
  }

  /** raw SQL default expression */
  defaultSql(expr: string): ColumnBuilder<TData, TNotNull, true> {
    this.meta.hasDefault = true;
    this.meta.defaultSql = expr;
    return this as unknown as ColumnBuilder<TData, TNotNull, true>;
  }

  references(target: () => ColumnRef<unknown>): this {
    this.meta.references = () => {
      const t = target();
      return { table: t.table, name: t.name };
    };
    return this;
  }
}

/** A column bound to its table — what query builders consume. */
export interface ColumnRef<TData = unknown> {
  readonly table: string;
  readonly name: string;
  readonly meta: ColumnMeta;
  readonly _type?: TData;
}

export type AnyColumnBuilder = ColumnBuilder<any, boolean, boolean>;

export type Table<TCols extends Record<string, AnyColumnBuilder>, TDialect extends 'pg' | 'mysql'> = {
  readonly [K in keyof TCols]: ColumnRef<TCols[K]['_type']>;
} & {
  readonly [TableMeta]: TableMetaValue & { dialect: TDialect };
};

export function makeTable<TCols extends Record<string, AnyColumnBuilder>, TDialect extends 'pg' | 'mysql'>(
  dialect: TDialect,
  name: string,
  columns: TCols,
): Table<TCols, TDialect> {
  const metaColumns: Record<string, ColumnMeta> = {};
  const table: Record<string | symbol, unknown> = {};
  for (const [key, builder] of Object.entries(columns)) {
    metaColumns[key] = builder.meta;
    table[key] = { table: name, name: key, meta: builder.meta } satisfies ColumnRef;
  }
  table[TableMeta] = { name, dialect, columns: metaColumns };
  return table as Table<TCols, TDialect>;
}

type SelectValue<C> = C extends ColumnBuilder<infer T, infer NN, boolean>
  ? NN extends true ? T : T | null
  : never;

export type InferSelectFrom<T> = T extends Table<infer C, any>
  ? { [K in keyof C]: SelectValue<C[K]> }
  : never;

type InsertOptionalKeys<C> = {
  [K in keyof C]: C[K] extends ColumnBuilder<any, infer NN, infer HD>
    ? HD extends true ? K : NN extends true ? never : K
    : never;
}[keyof C];

export type InferInsertFrom<T> = T extends Table<infer C, any>
  ? {
      [K in Exclude<keyof C, InsertOptionalKeys<C>>]: C[K] extends ColumnBuilder<infer D, boolean, boolean> ? D : never;
    } & {
      [K in InsertOptionalKeys<C> & keyof C]?: (C[K] extends ColumnBuilder<infer D, infer NN, boolean> ? (NN extends true ? D : D | null) : never);
    }
  : never;
