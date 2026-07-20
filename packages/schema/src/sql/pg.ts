/** AST → PostgreSQL SQL. $n placeholders, double-quoted identifiers,
 *  RETURNING / ON CONFLICT first-class. */
import type { Condition, QueryNode, ColRefNode } from '../ast';

export interface CompiledSql {
  sql: string;
  paramCount: number;
}

interface ParamRefNode { param: number }

const ident = (name: string): string => {
  if (name.includes('"')) throw new Error(`invalid identifier: ${name}`);
  return `"${name}"`;
};

const col = (c: ColRefNode) => ident(c.column);

export function compilePg(ast: QueryNode): CompiledSql {
  let maxParam = -1;
  const p = (v: ParamRefNode): string => {
    if (typeof v.param !== 'number') throw new Error('compilePg: unfinalized AST (lit leaf)');
    maxParam = Math.max(maxParam, v.param);
    return `$${v.param + 1}`;
  };

  const cond = (c: Condition): string => {
    switch (c.op) {
      case 'and':
      case 'or':
        return `(${c.conditions.map(cond).join(` ${c.op} `)})`;
      case 'not': {
        const inner = cond(c.condition);
        return inner.startsWith('(') ? `not ${inner}` : `not (${inner})`;
      }
      case 'in':
        return `${col(c.col)} in (${c.values.map((v) => p(v as ParamRefNode)).join(', ')})`;
      case 'isNull':
        return `${col(c.col)} is null`;
      case 'isNotNull':
        return `${col(c.col)} is not null`;
      case 'eq': return `${col(c.col)} = ${p(c.value as ParamRefNode)}`;
      case 'ne': return `${col(c.col)} <> ${p(c.value as ParamRefNode)}`;
      case 'gt': return `${col(c.col)} > ${p(c.value as ParamRefNode)}`;
      case 'gte': return `${col(c.col)} >= ${p(c.value as ParamRefNode)}`;
      case 'lt': return `${col(c.col)} < ${p(c.value as ParamRefNode)}`;
      case 'lte': return `${col(c.col)} <= ${p(c.value as ParamRefNode)}`;
      case 'like': return `${col(c.col)} like ${p(c.value as ParamRefNode)}`;
    }
  };

  const returning = (r: '*' | ColRefNode[] | undefined): string =>
    r === undefined ? '' : r === '*' ? ' returning *' : ` returning ${r.map(col).join(', ')}`;

  let sql: string;
  switch (ast.kind) {
    case 'select': {
      const cols = ast.columns ? ast.columns.map(col).join(', ') : '*';
      sql = `select ${cols} from ${ident(ast.table)}`;
      if (ast.where) sql += ` where ${cond(ast.where)}`;
      if (ast.orderBy?.length) sql += ` order by ${ast.orderBy.map((o) => `${col(o.col)} ${o.dir}`).join(', ')}`;
      if (ast.limit) sql += ` limit ${p(ast.limit as ParamRefNode)}`;
      if (ast.offset) sql += ` offset ${p(ast.offset as ParamRefNode)}`;
      break;
    }
    case 'insert': {
      const rows = ast.rows.map((row) => `(${row.map((v) => p(v as ParamRefNode)).join(', ')})`).join(', ');
      sql = `insert into ${ident(ast.table)} (${ast.columns.map(ident).join(', ')}) values ${rows}`;
      if (ast.onConflict) {
        sql += ` on conflict (${ast.onConflict.target.map(ident).join(', ')})`;
        sql += ast.onConflict.set
          ? ` do update set ${Object.entries(ast.onConflict.set).map(([k, v]) => `${ident(k)} = ${p(v as ParamRefNode)}`).join(', ')}`
          : ' do nothing';
      }
      sql += returning(ast.returning);
      break;
    }
    case 'update': {
      const set = Object.entries(ast.set).map(([k, v]) => `${ident(k)} = ${p(v as ParamRefNode)}`).join(', ');
      sql = `update ${ident(ast.table)} set ${set}`;
      if (ast.where) sql += ` where ${cond(ast.where)}`;
      sql += returning(ast.returning);
      break;
    }
    case 'delete': {
      sql = `delete from ${ident(ast.table)}`;
      if (ast.where) sql += ` where ${cond(ast.where)}`;
      sql += returning(ast.returning);
      break;
    }
  }
  return { sql, paramCount: maxParam + 1 };
}
