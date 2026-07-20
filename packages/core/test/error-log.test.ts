import { describe, expect, test } from 'bun:test';
import { HyperDbError } from '../src/errors';
import { formatErrorMarkdown } from '../src/error-log';

describe('formatErrorMarkdown', () => {
  test('renders code, message and context fields as markdown', () => {
    const err = new HyperDbError('query_failed', 'relation "players" does not exist', {
      queryId: 'abc123',
    });
    const md = formatErrorMarkdown(err, {
      queryId: 'abc123',
      sql: 'select * from "players" where "elo" > $1',
      params: [2000],
      source: 'execute',
    });
    expect(md).toContain('### ❌ hyper-db error — `query_failed`');
    expect(md).toContain('**Message:** relation "players" does not exist');
    expect(md).toContain('| source | `execute` |');
    expect(md).toContain('| queryId | `abc123` |');
    expect(md).toContain('```sql\nselect * from "players" where "elo" > $1\n```');
    expect(md).toContain('**Params:** `[2000]`');
  });

  test('includes an actionable hint per error code', () => {
    const unknown = formatErrorMarkdown(new HyperDbError('unknown_query_id', 'no query', { queryId: 'x' }));
    expect(unknown).toContain('**Hint:**');
    expect(unknown).toContain('registerQueries');

    const badParams = formatErrorMarkdown(new HyperDbError('bad_params', 'expects 2 params, got 1'));
    expect(badParams).toContain('**Hint:**');
    expect(badParams).toContain('paramCount');
  });

  test('details from the error itself are merged into the field table', () => {
    const err = new HyperDbError('bad_params', 'mismatch', { expected: 2, got: 1 });
    const md = formatErrorMarkdown(err);
    expect(md).toContain('| expected | `2` |');
    expect(md).toContain('| got | `1` |');
  });

  test('long params are truncated', () => {
    const err = new HyperDbError('query_failed', 'boom');
    const md = formatErrorMarkdown(err, { params: ['x'.repeat(2000)] });
    expect(md).toContain('… (truncated)');
    expect(md.length).toBeLessThan(1500);
  });

  test('non-HyperDbError values are wrapped safely', () => {
    const md = formatErrorMarkdown(new Error('raw driver crash'));
    expect(md).toContain('`query_failed`');
    expect(md).toContain('raw driver crash');
  });

  test('no sql/params sections when context absent', () => {
    const md = formatErrorMarkdown(new HyperDbError('timeout', 't'));
    expect(md).not.toContain('```sql');
    expect(md).not.toContain('**Params:**');
  });
});
