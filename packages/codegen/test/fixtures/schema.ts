import { hyperTable, uuid, text, integer } from '@hyper-db/schema/pg-core';
import { select, gt } from '@hyper-db/schema';

export const players = hyperTable('players', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  elo: integer().notNull().default(1000),
});

export default {
  dialect: 'pg' as const,
  tables: [players],
  queries: {
    topPlayers: select(players).where(gt(players.elo, 0)).orderBy(players.elo, 'desc').limit(0),
  },
};
