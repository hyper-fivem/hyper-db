/** SQL type → per-language wire types. Values cross the FiveM boundary as
 *  msgpack scalars, so timestamps travel as strings and bigints as numbers. */

export function tsTypeOf(sqlType: string): string {
  switch (sqlType) {
    case 'uuid':
    case 'text':
    case 'varchar':
      return 'string';
    case 'integer':
    case 'int':
    case 'serial':
    case 'real':
    case 'double':
    case 'double precision':
    case 'bigint':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'timestamptz':
    case 'datetime':
      return 'string';
    case 'jsonb':
    case 'json':
      return 'unknown';
    default:
      return 'unknown';
  }
}

export function luaTypeOf(sqlType: string): string {
  switch (sqlType) {
    case 'uuid':
    case 'text':
    case 'varchar':
    case 'timestamptz':
    case 'datetime':
      return 'string';
    case 'integer':
    case 'int':
    case 'serial':
    case 'real':
    case 'double':
    case 'double precision':
    case 'bigint':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'jsonb':
    case 'json':
      return 'table';
    default:
      return 'any';
  }
}

export function csTypeOf(sqlType: string, notNull: boolean): string {
  const base = (() => {
    switch (sqlType) {
      case 'uuid':
      case 'text':
      case 'varchar':
      case 'timestamptz':
      case 'datetime':
        return 'string';
      case 'integer':
      case 'int':
      case 'serial':
        return 'int';
      case 'bigint':
        return 'long';
      case 'real':
      case 'double':
      case 'double precision':
        return 'double';
      case 'boolean':
        return 'bool';
      case 'jsonb':
      case 'json':
        return 'object';
      default:
        return 'object';
    }
  })();
  const valueType = base === 'int' || base === 'long' || base === 'double' || base === 'bool';
  return notNull ? base : valueType ? `${base}?` : base;
}
