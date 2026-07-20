/** Codegen input model: dialect + table metas + finalized static queries.
 *  Built from user schema modules via defineCodegenSchema(). */
import {
  TableMeta,
  finalize,
  queryIdFor,
  compilePg,
  compileMysql,
  type AnyBuilder,
  type QueryNode,
  type TableMetaValue,
} from '@hyper-db/schema';

export interface StaticQuery {
  name: string;
  queryId: string;
  ast: QueryNode;
  sql: string;
  paramCount: number;
  /** table whose row type the query returns */
  table: string;
}

export interface CodegenSchema {
  dialect: 'pg' | 'mysql';
  tables: TableMetaValue[];
  queries: StaticQuery[];
}

interface TableLike {
  [TableMeta]: TableMetaValue;
}

export interface CodegenInput {
  dialect: 'pg' | 'mysql';
  tables: TableLike[];
  queries?: Record<string, AnyBuilder>;
}

export function defineCodegenSchema(input: CodegenInput): CodegenSchema {
  const tables = input.tables.map((t) => t[TableMeta]);
  const queries: StaticQuery[] = Object.entries(input.queries ?? {}).map(([name, builder]) => {
    const { ast } = finalize(builder);
    const compiled = input.dialect === 'pg' ? compilePg(ast) : compileMysql(ast);
    return {
      name,
      queryId: queryIdFor(ast),
      ast,
      sql: compiled.sql,
      paramCount: compiled.paramCount,
      table: ast.table,
    };
  });
  return { dialect: input.dialect, tables, queries };
}
