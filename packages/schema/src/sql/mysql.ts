/** AST → MariaDB/MySQL SQL. Positional `?` placeholders, backtick identifiers.
 *  finalize()'s param numbering order matches SQL appearance order for every
 *  node kind; the compiler asserts this so a future AST change cannot silently
 *  scramble positional params. RETURNING is not supported on this dialect. */
import type { Condition, QueryNode, ColRefNode } from '../ast';

export interface CompiledSql {
  sql: string;
  paramCount: number;
}

interface ParamRefNode { param: number }

const ident = (name: string): string => {
  if (name.includes('`')) throw new Error(`invalid identifier: ${name}`);
  return `\`${name}\``;
};

const col = (c: ColRefNode) => ident(c.column);

export function compileMysql(ast: QueryNode): CompiledSql {
  let next = 0;
  const p = (v: ParamRefNode): string => {
    if (typeof v.param !== 'number') throw new Error('compileMysql: unfinalized AST (lit leaf)');
    if (v.param !== next) throw new Error(`compileMysql: param order mismatch (expected ${next}, got ${v.param})`);
    next += 1;
    return '?';
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

  const rejectReturning = (r: unknown): void => {
    if (r !== undefined) throw new Error('unsupported_feature: RETURNING is not available on the mysql dialect');
  };

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
      rejectReturning(ast.returning);
      const rows = ast.rows.map((row) => `(${row.map((v) => p(v as ParamRefNode)).join(', ')})`).join(', ');
      sql = `insert into ${ident(ast.table)} (${ast.columns.map(ident).join(', ')}) values ${rows}`;
      if (ast.onConflict) {
        if (ast.onConflict.set) {
          sql += ` on duplicate key update ${Object.entries(ast.onConflict.set)
            .map(([k, v]) => `${ident(k)} = ${p(v as ParamRefNode)}`)
            .join(', ')}`;
        } else {
          // emulate "do nothing": a no-op self-assignment on the first conflict target
          const target = ast.onConflict.target[0] ?? ast.columns[0]!;
          sql += ` on duplicate key update ${ident(target)} = ${ident(target)}`;
        }
      }
      break;
    }
    case 'update': {
      rejectReturning(ast.returning);
      const set = Object.entries(ast.set).map(([k, v]) => `${ident(k)} = ${p(v as ParamRefNode)}`).join(', ');
      sql = `update ${ident(ast.table)} set ${set}`;
      if (ast.where) sql += ` where ${cond(ast.where)}`;
      break;
    }
    case 'delete': {
      rejectReturning(ast.returning);
      sql = `delete from ${ident(ast.table)}`;
      if (ast.where) sql += ` where ${cond(ast.where)}`;
      break;
    }
  }
  return { sql, paramCount: next };
}
