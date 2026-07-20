import { describe, expect, test } from 'bun:test';
import { PgDriver, MysqlDriver, IoRedisDriver, QueryEngine, Locks, HotStore } from '../../src/index';
import { redisTable, rString, rNumber, RedisTableMeta } from '@hyper-db/schema';

/** Integration suite against docker-compose services.
 *  Run: docker-compose up -d && HYPERDB_IT=1 bun test test/integration */
const IT = process.env.HYPERDB_IT === '1';

describe.skipIf(!IT)('integration: postgres', () => {
  test('roundtrip create/insert/select', async () => {
    const pg = new PgDriver({ host: 'localhost', database: 'hyperdb', username: 'hyper', password: 'hyper' });
    try {
      await pg.query('drop table if exists it_players', []);
      await pg.query('create table it_players (id uuid primary key, elo integer not null)', []);
      const engine = new QueryEngine(pg);
      engine.register('ins', {
        sql: 'insert into "it_players" ("id", "elo") values ($1, $2) returning *',
        paramCount: 2,
      });
      const rows = await engine.execute('ins', ['00000000-0000-4000-8000-000000000001', 1500]);
      expect(rows[0]!.elo).toBe(1500);
    } finally {
      await pg.close();
    }
  });
});

describe.skipIf(!IT)('integration: mariadb', () => {
  test('roundtrip', async () => {
    const my = new MysqlDriver({ host: 'localhost', database: 'hyperdb', user: 'hyper', password: 'hyper' });
    try {
      await my.query('drop table if exists it_users', []);
      await my.query('create table it_users (id varchar(36) primary key, lvl int not null)', []);
      const engine = new QueryEngine(my);
      engine.register('ins', { sql: 'insert into `it_users` (`id`, `lvl`) values (?, ?)', paramCount: 2 });
      await engine.execute('ins', ['u1', 3]);
      const rows = await my.query('select * from it_users', []);
      expect(rows.length).toBe(1);
    } finally {
      await my.close();
    }
  });
});

describe.skipIf(!IT)('integration: redis', () => {
  const sessions = redisTable('it_sessions', {
    keyBy: 'playerId',
    fields: { playerId: rString(), elo: rNumber() },
    ttl: 60,
  });

  test('hot-store + locks against real redis', async () => {
    const redis = new IoRedisDriver({ host: 'localhost' });
    try {
      const store = new HotStore(redis, sessions[RedisTableMeta]);
      await store.set('p1', { playerId: 'p1', elo: 1234 });
      expect((await store.get('p1'))!.elo).toBe(1234);

      const locks = new Locks(redis);
      const out = await locks.withLock('it:lock', 2000, async () => 'held');
      expect(out).toBe('held');
    } finally {
      await redis.close();
    }
  });
});
