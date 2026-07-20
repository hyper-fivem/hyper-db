/** Stable queryId: sha256 over canonical (recursively key-sorted) JSON of the
 *  finalized AST. Params are `{ param: i }` refs — values never enter the
 *  hash, so the id identifies the query *shape*. 16 hex chars. */
import { createHash } from 'node:crypto';
import type { QueryNode } from './ast';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export function queryIdFor(ast: QueryNode): string {
  return createHash('sha256').update(canonical(ast)).digest('hex').slice(0, 16);
}
