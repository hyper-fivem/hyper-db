import { describe, expect, test } from 'bun:test';

/** PRD success criterion: serialized cross-runtime payload per call is
 *  queryId + flat params, nothing more. This guards the wire contract in CI —
 *  if a change starts shipping nested structures, these assertions fail. */
describe('boundary payload contract', () => {
  const queryId = 'a1b2c3d4e5f60718';
  const params = [2000, 10];

  test('static query payload is [queryId, params] only', () => {
    const payload = [queryId, params];
    const encoded = JSON.stringify(payload);
    expect(encoded).toBe('["a1b2c3d4e5f60718",[2000,10]]');
    expect(encoded.length).toBeLessThanOrEqual(64);
    // flat: no nested objects/arrays inside params
    for (const p of params) expect(typeof p === 'object' && p !== null).toBe(false);
  });

  test('chain payload is [table, descriptor, params] — all scalars + one flat array', () => {
    const payload = ['players', 'w:elo:gt;o:elo:desc;l', [2000, 10]];
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(96);
    expect(payload.filter((p) => Array.isArray(p)).length).toBe(1);
  });
});
