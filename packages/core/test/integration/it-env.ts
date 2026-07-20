/** Shared connection config for the integration suite. Defaults match
 *  docker-compose.yml (host ports 5433/3307/6379 to avoid clashing with
 *  locally installed PostgreSQL/XAMPP services). Override via env. */

export const IT = process.env.HYPERDB_IT === '1';

export const PG = {
  host: process.env.HYPERDB_PG_HOST ?? 'localhost',
  port: Number(process.env.HYPERDB_PG_PORT ?? '5433'),
  database: process.env.HYPERDB_PG_DB ?? 'hyperdb',
  username: process.env.HYPERDB_PG_USER ?? 'hyper',
  password: process.env.HYPERDB_PG_PASSWORD ?? 'hyper',
};

export const MYSQL = {
  host: process.env.HYPERDB_MYSQL_HOST ?? 'localhost',
  port: Number(process.env.HYPERDB_MYSQL_PORT ?? '3307'),
  database: process.env.HYPERDB_MYSQL_DB ?? 'hyperdb',
  user: process.env.HYPERDB_MYSQL_USER ?? 'hyper',
  password: process.env.HYPERDB_MYSQL_PASSWORD ?? 'hyper',
};

export const REDIS = {
  host: process.env.HYPERDB_REDIS_HOST ?? 'localhost',
  port: Number(process.env.HYPERDB_REDIS_PORT ?? '6379'),
};
