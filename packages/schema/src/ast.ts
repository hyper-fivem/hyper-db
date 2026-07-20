/** Query AST: plain JSON-serializable nodes. Builders collect literal values
 *  as `{ lit }` leaves; `finalize()` numbers them into `{ param: i }` refs in
 *  a defined traversal order and returns the flat params array — the only
 *  payload that ever crosses the runtime boundary. */
import { TableMeta, type ColumnRef } from './internal/column';

export interface ColRefNode { table: string; column: string }
export interface ParamRef { param: number }
interface Lit { lit: unknown }
type ValueNode = ParamRef | Lit;

export type Condition =
  | { op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like'; col: ColRefNode; value: ValueNode }
  | { op: 'in'; col: ColRefNode; values: ValueNode[] }
  | { op: 'isNull' | 'isNotNull'; col: ColRefNode }
  | { op: 'and' | 'or'; conditions: Condition[] }
  | { op: 'not'; condition: Condition };

export interface OrderByNode { col: ColRefNode; dir: 'asc' | 'desc' }

export interface SelectNode {
  kind: 'select';
  table: string;
  columns?: ColRefNode[];
  where?: Condition;
  orderBy?: OrderByNode[];
  limit?: ValueNode;
  offset?: ValueNode;
}

export interface InsertNode {
  kind: 'insert';
  table: string;
  columns: string[];
  rows: ValueNode[][];
  onConflict?: { target: string[]; set?: Record<string, ValueNode> };
  returning?: '*' | ColRefNode[];
}

export interface UpdateNode {
  kind: 'update';
  table: string;
  set: Record<string, ValueNode>;
  where?: Condition;
  returning?: '*' | ColRefNode[];
}

export interface DeleteNode {
  kind: 'delete';
  table: string;
  where?: Condition;
  returning?: '*' | ColRefNode[];
}

export type QueryNode = SelectNode | InsertNode | UpdateNode | DeleteNode;

const colRef = (c: ColumnRef<unknown>): ColRefNode => ({ table: c.table, column: c.name });
const lit = (v: unknown): Lit => ({ lit: v });

// ---- condition helpers ----
type Cmp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like';
const cmp = (op: Cmp) => <T>(col: ColumnRef<T>, value: T): Condition =>
  ({ op, col: colRef(col), value: lit(value) });

export const eq = cmp('eq');
export const ne = cmp('ne');
export const gt = cmp('gt');
export const gte = cmp('gte');
export const lt = cmp('lt');
export const lte = cmp('lte');
export const like = (col: ColumnRef<string>, pattern: string): Condition =>
  ({ op: 'like', col: colRef(col), value: lit(pattern) });
export const inArray = <T>(col: ColumnRef<T>, values: readonly T[]): Condition =>
  ({ op: 'in', col: colRef(col), values: values.map(lit) });
export const isNull = (col: ColumnRef<unknown>): Condition => ({ op: 'isNull', col: colRef(col) });
export const isNotNull = (col: ColumnRef<unknown>): Condition => ({ op: 'isNotNull', col: colRef(col) });
export const and = (...conditions: Condition[]): Condition => ({ op: 'and', conditions });
export const or = (...conditions: Condition[]): Condition => ({ op: 'or', conditions });
export const not = (condition: Condition): Condition => ({ op: 'not', condition });

// ---- builders ----
interface TableLike { [TableMeta]: { name: string } }
const tableName = (t: TableLike) => t[TableMeta].name;

export class SelectBuilder {
  readonly node: SelectNode;
  constructor(table: TableLike, columns?: ColumnRef<unknown>[]) {
    this.node = { kind: 'select', table: tableName(table) };
    if (columns) this.node.columns = columns.map(colRef);
  }
  where(condition: Condition): this {
    this.node.where = condition;
    return this;
  }
  orderBy(col: ColumnRef<unknown>, dir: 'asc' | 'desc' = 'asc'): this {
    (this.node.orderBy ??= []).push({ col: colRef(col), dir });
    return this;
  }
  limit(n: number): this {
    this.node.limit = lit(n);
    return this;
  }
  offset(n: number): this {
    this.node.offset = lit(n);
    return this;
  }
}

export class InsertBuilder {
  readonly node: InsertNode;
  constructor(table: TableLike) {
    this.node = { kind: 'insert', table: tableName(table), columns: [], rows: [] };
  }
  values(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    const list = Array.isArray(rows) ? rows : [rows];
    if (list.length === 0) throw new Error('insert.values(): empty row list');
    this.node.columns = Object.keys(list[0]!);
    this.node.rows = list.map((row) => this.node.columns.map((c) => lit(row[c])));
    return this;
  }
  onConflictDoNothing(target: ColumnRef<unknown>[]): this {
    this.node.onConflict = { target: target.map((c) => c.name) };
    return this;
  }
  onConflictDoUpdate(target: ColumnRef<unknown>[], set: Record<string, unknown>): this {
    this.node.onConflict = {
      target: target.map((c) => c.name),
      set: Object.fromEntries(Object.entries(set).map(([k, v]) => [k, lit(v)])),
    };
    return this;
  }
  returning(cols?: ColumnRef<unknown>[]): this {
    this.node.returning = cols ? cols.map(colRef) : '*';
    return this;
  }
}

export class UpdateBuilder {
  readonly node: UpdateNode;
  constructor(table: TableLike) {
    this.node = { kind: 'update', table: tableName(table), set: {} };
  }
  set(values: Record<string, unknown>): this {
    this.node.set = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, lit(v)]));
    return this;
  }
  where(condition: Condition): this {
    this.node.where = condition;
    return this;
  }
  returning(cols?: ColumnRef<unknown>[]): this {
    this.node.returning = cols ? cols.map(colRef) : '*';
    return this;
  }
}

export class DeleteBuilder {
  readonly node: DeleteNode;
  constructor(table: TableLike) {
    this.node = { kind: 'delete', table: tableName(table) };
  }
  where(condition: Condition): this {
    this.node.where = condition;
    return this;
  }
  returning(cols?: ColumnRef<unknown>[]): this {
    this.node.returning = cols ? cols.map(colRef) : '*';
    return this;
  }
}

export const select = (table: TableLike, columns?: ColumnRef<unknown>[]) => new SelectBuilder(table, columns);
export const insert = (table: TableLike) => new InsertBuilder(table);
export const update = (table: TableLike) => new UpdateBuilder(table);
export const del = (table: TableLike) => new DeleteBuilder(table);

export type AnyBuilder = SelectBuilder | InsertBuilder | UpdateBuilder | DeleteBuilder;

// ---- finalize: number lit leaves into param refs, collect flat params ----
/** Traversal order (defines param numbering):
 *  select: where → limit → offset
 *  insert: rows (row-major) → onConflict.set
 *  update: set → where
 *  delete: where */
export function finalize(builder: AnyBuilder | QueryNode): { ast: QueryNode; params: unknown[] } {
  const source = 'node' in builder ? (builder as AnyBuilder).node : (builder as QueryNode);
  const params: unknown[] = [];
  const value = (v: ValueNode): ParamRef => {
    if ('param' in v) return { param: v.param };
    params.push(v.lit);
    return { param: params.length - 1 };
  };
  const cond = (c: Condition): Condition => {
    switch (c.op) {
      case 'and':
      case 'or':
        return { op: c.op, conditions: c.conditions.map(cond) };
      case 'not':
        return { op: 'not', condition: cond(c.condition) };
      case 'in':
        return { op: 'in', col: c.col, values: c.values.map(value) };
      case 'isNull':
      case 'isNotNull':
        return { op: c.op, col: c.col };
      default:
        return { op: c.op, col: c.col, value: value(c.value) };
    }
  };
  const setClause = (s: Record<string, ValueNode>): Record<string, ParamRef> =>
    Object.fromEntries(Object.entries(s).map(([k, v]) => [k, value(v)]));

  switch (source.kind) {
    case 'select': {
      const ast: SelectNode = { kind: 'select', table: source.table };
      if (source.columns) ast.columns = source.columns;
      if (source.where) ast.where = cond(source.where);
      if (source.orderBy) ast.orderBy = source.orderBy;
      if (source.limit) ast.limit = value(source.limit);
      if (source.offset) ast.offset = value(source.offset);
      return { ast, params };
    }
    case 'insert': {
      const ast: InsertNode = {
        kind: 'insert',
        table: source.table,
        columns: source.columns,
        rows: source.rows.map((row) => row.map(value)),
      };
      if (source.onConflict) {
        ast.onConflict = { target: source.onConflict.target };
        if (source.onConflict.set) ast.onConflict.set = setClause(source.onConflict.set);
      }
      if (source.returning) ast.returning = source.returning;
      return { ast, params };
    }
    case 'update': {
      const ast: UpdateNode = { kind: 'update', table: source.table, set: setClause(source.set) };
      if (source.where) ast.where = cond(source.where);
      if (source.returning) ast.returning = source.returning;
      return { ast, params };
    }
    case 'delete': {
      const ast: DeleteNode = { kind: 'delete', table: source.table };
      if (source.where) ast.where = cond(source.where);
      if (source.returning) ast.returning = source.returning;
      return { ast, params };
    }
  }
}
