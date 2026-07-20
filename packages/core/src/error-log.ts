/** Markdown error formatter for the server console. One self-contained block
 *  per failure — code, message, context table, SQL, params, actionable hint —
 *  so AI agents (and humans) reading console output can diagnose without
 *  digging through the resource. Keep the shape stable: tools parse it. */
import { HyperDbError, type ErrorCode } from './errors';

export interface ErrorLogContext {
  source?: string;
  queryId?: string;
  sql?: string;
  params?: unknown[];
}

const HINTS: Record<ErrorCode, string> = {
  connection_failed:
    'Check the hyperdb_* convars (host/port/credentials) and that the database/redis container is up (`docker-compose up -d`).',
  query_failed:
    'The SQL below failed on the database. Verify the schema matches (`hyperdb generate`/`push`) and inspect the message for the failing relation/column.',
  unknown_query_id:
    'The queryId is not registered in this hyper-db instance. Call `registerQueries(manifest)` with your generated manifest before executing, or regenerate codegen output if the schema changed.',
  bad_params:
    'Param count/shape does not match the compiled query. Compare the call site with the manifest `paramCount` — regenerate codegen output if the schema changed.',
  timeout: 'The operation exceeded its deadline. Check database load and the slow-query log (`hyperdb_stats`).',
  lock_held: 'Another holder owns this lock. Retry with backoff — do not bypass the lock; it protects against double-spend.',
  rate_limited: 'The fixed-window rate limit rejected this call. Slow the caller or raise the declared limit.',
  unsupported_feature:
    'This feature is unavailable on the current dialect/configuration (e.g. RETURNING on mysql, cache without redis).',
};

const MAX_VALUE_LEN = 200;
const MAX_PARAMS_LEN = 500;

const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}… (truncated)` : s);

const cell = (v: unknown): string => truncate(typeof v === 'string' ? v : JSON.stringify(v), MAX_VALUE_LEN);

export function formatErrorMarkdown(error: unknown, ctx: ErrorLogContext = {}): string {
  const err = HyperDbError.wrap(error);
  const lines: string[] = [];

  // engine failures carry sql/params in details — surface them as sections
  const details = err.details ?? {};
  const sql = ctx.sql ?? (typeof details.sql === 'string' ? details.sql : undefined);
  const params = ctx.params ?? (Array.isArray(details.params) ? details.params : undefined);

  lines.push(`### ❌ hyper-db error — \`${err.code}\``);
  lines.push('');
  lines.push(`**Message:** ${err.message}`);
  lines.push('');

  const fields: [string, unknown][] = [];
  if (ctx.source !== undefined) fields.push(['source', ctx.source]);
  if (ctx.queryId !== undefined) fields.push(['queryId', ctx.queryId]);
  for (const [key, value] of Object.entries(details)) {
    if (key === 'sql' || key === 'params') continue; // rendered as sections below
    if (!fields.some(([k]) => k === key)) fields.push([key, value]);
  }
  if (fields.length > 0) {
    lines.push('| Field | Value |');
    lines.push('|---|---|');
    for (const [key, value] of fields) lines.push(`| ${key} | \`${cell(value)}\` |`);
    lines.push('');
  }

  if (sql !== undefined) {
    lines.push('```sql');
    lines.push(truncate(sql, MAX_PARAMS_LEN));
    lines.push('```');
    lines.push('');
  }

  if (params !== undefined) {
    lines.push(`**Params:** \`${truncate(JSON.stringify(params), MAX_PARAMS_LEN)}\``);
    lines.push('');
  }

  lines.push(`**Hint:** ${HINTS[err.code]}`);
  return lines.join('\n');
}
