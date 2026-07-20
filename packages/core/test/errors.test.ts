import { describe, expect, test } from 'bun:test';
import { HyperDbError } from '../src/errors';

describe('HyperDbError', () => {
  test('carries code + details', () => {
    const e = new HyperDbError('unknown_query_id', 'no such query', { queryId: 'abc' });
    expect(e.code).toBe('unknown_query_id');
    expect(e.message).toBe('no such query');
    expect(e.details).toEqual({ queryId: 'abc' });
    expect(e).toBeInstanceOf(Error);
  });

  test('boundary roundtrip', () => {
    const e = new HyperDbError('rate_limited', 'slow down', { retryAfterMs: 250 });
    const wire = e.toBoundary();
    expect(wire).toEqual({ code: 'rate_limited', message: 'slow down', details: { retryAfterMs: 250 } });
    const back = HyperDbError.fromBoundary(wire);
    expect(back.code).toBe('rate_limited');
    expect(back.details).toEqual({ retryAfterMs: 250 });
  });

  test('wrap passes HyperDbError through and wraps unknowns', () => {
    const orig = new HyperDbError('timeout', 't');
    expect(HyperDbError.wrap(orig)).toBe(orig);
    const wrapped = HyperDbError.wrap(new Error('boom'));
    expect(wrapped.code).toBe('query_failed');
    expect(wrapped.message).toContain('boom');
  });
});
