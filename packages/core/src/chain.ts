/** Chain descriptor: the flat-string query protocol generated Lua/C# builders
 *  send across the runtime boundary for dynamic queries. The payload stays
 *  `descriptor + flat params[]`; the server parses it into an AST once and
 *  caches compiled SQL keyed by (table, descriptor) — shape-hash semantics.
 *
 *  Grammar (segments joined by ';'):
 *    w:<col>:<op>   where clause, op ∈ eq ne gt gte lt lte like  (one param)
 *    o:<col>:<dir>  order by, dir ∈ asc desc                     (no param)
 *    l              limit                                        (one param)
 *    of             offset                                       (one param)
 *  Multiple `w` segments AND together. Param order = segment order. */
import type { TableMetaValue } from '@hyper-db/schema';
import type { Condition, SelectNode } from '@hyper-db/schema';
import { HyperDbError } from './errors';

const WHERE_OPS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like']);

export function parseChain(table: TableMetaValue, descriptor: string): SelectNode {
  const ast: SelectNode = { kind: 'select', table: table.name };
  const wheres: Condition[] = [];
  let param = 0;

  const checkColumn = (name: string): string => {
    if (!(name in table.columns)) {
      throw new HyperDbError('bad_params', `chain: unknown column '${name}' on '${table.name}'`);
    }
    return name;
  };

  for (const segment of descriptor.split(';')) {
    if (segment === '') continue;
    const parts = segment.split(':');
    switch (parts[0]) {
      case 'w': {
        const [, colName, op] = parts;
        if (!colName || !op || !WHERE_OPS.has(op)) {
          throw new HyperDbError('bad_params', `chain: unknown where segment '${segment}'`);
        }
        wheres.push({
          op: op as 'eq',
          col: { table: table.name, column: checkColumn(colName) },
          value: { param: param++ },
        });
        break;
      }
      case 'o': {
        const [, colName, dir] = parts;
        if (!colName || (dir !== 'asc' && dir !== 'desc')) {
          throw new HyperDbError('bad_params', `chain: unknown order segment '${segment}'`);
        }
        (ast.orderBy ??= []).push({ col: { table: table.name, column: checkColumn(colName) }, dir });
        break;
      }
      case 'l':
        ast.limit = { param: param++ };
        break;
      case 'of':
        ast.offset = { param: param++ };
        break;
      default:
        throw new HyperDbError('bad_params', `chain: unknown segment '${segment}'`);
    }
  }

  if (wheres.length === 1) ast.where = wheres[0]!;
  else if (wheres.length > 1) ast.where = { op: 'and', conditions: wheres };
  return ast;
}
