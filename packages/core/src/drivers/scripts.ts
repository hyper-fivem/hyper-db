/** Atomic Redis Lua scripts. Real drivers EVAL these on the server; FakeRedis
 *  dispatches on the exact script text to run equivalent JS semantics — keep
 *  both in sync when editing. */

/** KEYS[1]=lock key, ARGV[1]=owner token. Deletes only if caller owns it. */
export const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end`.trim();

/** KEYS[1]=counter key, ARGV[1]=window ms. Returns count in current window;
 *  first hit arms the window expiry (fixed-window rate limit). */
export const RATE_LIMIT_SCRIPT = `
local count = redis.call('incr', KEYS[1])
if count == 1 then
  redis.call('pexpire', KEYS[1], ARGV[1])
end
return count`.trim();
