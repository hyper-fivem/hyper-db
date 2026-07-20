import { describe, expect, test } from 'bun:test';
import { Stats } from '../src/stats';

describe('Stats', () => {
  test('per-query histogram buckets + count', () => {
    const s = new Stats();
    s.recordQuery('q1', 3);
    s.recordQuery('q1', 3);
    s.recordQuery('q1', 700);
    const snap = s.snapshot();
    expect(snap.queries.q1!.count).toBe(3);
    expect(snap.queries.q1!.totalMs).toBe(706);
    // 3ms falls in the <=5 bucket, 700ms in <=1000
    expect(snap.queries.q1!.buckets['5']).toBe(2);
    expect(snap.queries.q1!.buckets['1000']).toBe(1);
  });

  test('cache hit/miss counters', () => {
    const s = new Stats();
    s.recordCache(true);
    s.recordCache(true);
    s.recordCache(false);
    expect(s.snapshot().cache).toEqual({ hits: 2, misses: 1 });
  });

  test('slow query ring buffer', () => {
    const s = new Stats({ slowQueryThresholdMs: 100, slowQueryLogSize: 2 });
    s.recordQuery('fast', 5);
    s.recordQuery('a', 150);
    s.recordQuery('b', 200);
    s.recordQuery('c', 300);
    const slow = s.snapshot().slowQueries;
    expect(slow.map((q) => q.queryId)).toEqual(['b', 'c']); // capped at 2, oldest evicted
    expect(slow[1]!.durationMs).toBe(300);
  });

  test('snapshot is a copy', () => {
    const s = new Stats();
    s.recordQuery('q', 1);
    const a = s.snapshot();
    s.recordQuery('q', 1);
    expect(a.queries.q!.count).toBe(1);
  });
});
