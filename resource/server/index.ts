/** FiveM bootstrap: reads convars, opens the owned connections, registers the
 *  boundary exports. Config via convars:
 *    set hyperdb_dialect "pg"            pg | mysql
 *    set hyperdb_pg_host "localhost"     (+ _port _db _user _password)
 *    set hyperdb_mysql_host "localhost"  (+ _port _db _user _password)
 *    set hyperdb_redis_host "localhost"  (+ _port _password; empty host disables redis)
 */
import { IoRedisDriver, MysqlDriver, PgDriver, type RedisDriver, type SqlDriver } from '@hyper-db/core';
import { createServer } from './server';

function boot(): void {
  const convar = (name: string, dflt: string) => GetConvar(name, dflt);

  const dialect = convar('hyperdb_dialect', 'pg');
  const sql: SqlDriver =
    dialect === 'mysql'
      ? new MysqlDriver({
          host: convar('hyperdb_mysql_host', 'localhost'),
          port: Number(convar('hyperdb_mysql_port', '3306')),
          database: convar('hyperdb_mysql_db', 'hyperdb'),
          user: convar('hyperdb_mysql_user', 'hyper'),
          password: convar('hyperdb_mysql_password', 'hyper'),
        })
      : new PgDriver({
          host: convar('hyperdb_pg_host', 'localhost'),
          port: Number(convar('hyperdb_pg_port', '5432')),
          database: convar('hyperdb_pg_db', 'hyperdb'),
          username: convar('hyperdb_pg_user', 'hyper'),
          password: convar('hyperdb_pg_password', 'hyper'),
        });

  const redisHost = convar('hyperdb_redis_host', 'localhost');
  let redis: RedisDriver | undefined;
  if (redisHost !== '') {
    const redisPassword = convar('hyperdb_redis_password', '');
    redis = new IoRedisDriver({
      host: redisHost,
      port: Number(convar('hyperdb_redis_port', '6379')),
      ...(redisPassword !== '' ? { password: redisPassword } : {}),
    });
  }

  // markdown error reports in the server console (set hyperdb_log_errors 0 to disable)
  const logError =
    convar('hyperdb_log_errors', '1') !== '0'
      ? (markdown: string) => console.error(`^1[hyper-db]^0\n${markdown}`)
      : undefined;

  const server = createServer(redis ? { sql, redis } : { sql }, logError ? { logError } : {});

  const register = globalThis.exports;
  if (typeof register !== 'function') throw new Error('hyper-db must run inside the FiveM server runtime');
  register('execute', server.execute.bind(server) as never);
  register('executeChain', server.executeChain.bind(server) as never);
  register('registerQueries', server.registerQueries.bind(server) as never);
  register('registerTable', server.registerTable.bind(server) as never);
  register('invalidateTags', server.invalidateTags.bind(server) as never);
  register('hyperdbStats', server.hyperdbStats.bind(server) as never);

  RegisterCommand(
    'hyperdb_stats',
    () => {
      console.log(JSON.stringify(server.hyperdbStats(), null, 2));
    },
    true,
  );

  console.log(`[hyper-db] up — dialect=${dialect} redis=${redis ? 'on' : 'off'}`);
}

boot();
