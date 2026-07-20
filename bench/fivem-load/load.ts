/** FiveM-realistic load generator. Runs on a separate bencher machine and
 *  hammers a remote PG/MariaDB with the query mix of a large RP server,
 *  through hyper-db's own QueryEngine (registered queries, prepared reuse).
 *
 *  Multi-process: a single JS thread saturates one core at ~12k ops/s, so
 *  the master forks WORKERS copies of itself (ROLE=worker), splits the
 *  client count between them, and merges fixed-bucket latency histograms
 *  (0.05ms resolution). All workers share the same hot set (HOTBASE).
 *
 *  Op mix (weights ~ what a busy ESX/QB server does):
 *    readInventory 30%, playerSave 20%, saveItem 20%, vehiclesByOwner 10%,
 *    vehicleSave 8%, playerLoad (login: player+inventory+vehicles) 5%,
 *    addItem 5%, topRich 2%.
 *  90% of ops hit a "hot set" of HOT online players (default 2048 — a full
 *  FiveM server), 10% hit the whole 1M-player table (cold, disk-bound).
 *
 *  Env: DIALECT=pg|mysql  HOST=…  PORT  CONC=1024,4096  DUR=30
 *       WORKERS=14  POOL=4096  PLAYERS=1000000  VEHICLES=1200000  HOT=2048
 *  Run: DIALECT=pg HOST=10.0.0.5 WORKERS=14 bun bench/fivem-load/load.ts */
import { createHash } from 'node:crypto';
import { PgDriver, MysqlDriver, QueryEngine } from '../../packages/core/src/index';
import type { SqlDriver } from '../../packages/core/src/index';

const DIALECT = (process.env.DIALECT ?? 'pg') as 'pg' | 'mysql';
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? (DIALECT === 'pg' ? 5432 : 3306));
const DUR = Number(process.env.DUR ?? '30');
const PLAYERS = Number(process.env.PLAYERS ?? '1000000');
const VEHICLES = Number(process.env.VEHICLES ?? '1200000');
const HOT = Number(process.env.HOT ?? '2048');

const OP_NAMES = ['readInventory', 'playerSave', 'saveItem', 'vehiclesByOwner', 'vehicleSave', 'playerLoad', 'addItem', 'topRich'] as const;
type OpName = (typeof OP_NAMES)[number];

/** 0.05ms buckets up to 1000ms — merged across workers, exact to ±0.05ms. */
const BUCKETS = 20000;
const bucketOf = (ms: number) => Math.min(BUCKETS - 1, Math.round(ms * 20));
const bucketMs = (b: number) => b / 20;

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const identifierOf = (id: number) => `license:${md5(String(id))}`;
const plateOf = (id: number) => id.toString(16).toUpperCase().padStart(8, '0');
const ri = (n: number) => Math.floor(Math.random() * n);

const position = () => JSON.stringify({ x: +(Math.random() * 8000 - 4000).toFixed(2), y: +(Math.random() * 8000 - 4000).toFixed(2), z: +(Math.random() * 100).toFixed(2), heading: +(Math.random() * 360).toFixed(1) });
const itemMeta = () => JSON.stringify({ durability: ri(100), serial: md5(String(ri(1e9))) });
const vehicleProps = () => JSON.stringify({
  engine: ri(4), brakes: ri(3), transmission: ri(3), suspension: ri(4), armor: ri(5), turbo: Math.random() < 0.5,
  colorPrimary: ri(160), colorSecondary: ri(160), pearlescent: ri(160), wheels: ri(12), wheelColor: ri(160),
  windowTint: ri(6), neon: [false, false, false, false], neonColor: [ri(255), ri(255), ri(255)],
  plateIndex: ri(5), fuelLevel: +(Math.random() * 100).toFixed(1),
  bodyHealth: +(900 + Math.random() * 100).toFixed(1), engineHealth: +(900 + Math.random() * 100).toFixed(1),
  extras: { '1': true, '2': false }, livery: ri(5), xenonColor: ri(13),
});
const ITEMS = ['bread', 'water', 'bandage', 'medkit', 'phone', 'radio', 'lockpick', 'weapon_pistol', 'ammo_9mm', 'repairkit'];

const Q: Record<string, { pg: string; mysql: string; n: number }> = {
  playerByIdentifier: {
    pg: 'select * from players where identifier = $1',
    mysql: 'select * from players where identifier = ?',
    n: 1,
  },
  inventoryByOwner: {
    pg: 'select item, count, slot, metadata from inventory_items where owner = $1 order by slot',
    mysql: 'select item, count, slot, metadata from inventory_items where owner = ? order by slot',
    n: 1,
  },
  vehiclesByOwner: {
    pg: 'select plate, model, props, stored, garage from owned_vehicles where owner = $1',
    mysql: 'select plate, model, props, stored, garage from owned_vehicles where owner = ?',
    n: 1,
  },
  playerSave: {
    pg: 'update players set cash = $2, bank = $3, position = $4::jsonb, last_seen = now() where id = $1',
    mysql: 'update players set cash = ?, bank = ?, position = ?, last_seen = now() where id = ?',
    n: 4,
  },
  saveItem: {
    pg: 'update inventory_items set count = $3 where owner = $1 and slot = $2',
    mysql: 'update inventory_items set count = ? where owner = ? and slot = ?',
    n: 3,
  },
  addItem: {
    pg: 'insert into inventory_items (owner, item, count, slot, metadata) values ($1, $2, $3, $4, $5::jsonb) on conflict (owner, slot) do update set item = excluded.item, count = excluded.count, metadata = excluded.metadata',
    mysql: 'insert into inventory_items (owner, item, count, slot, metadata) values (?, ?, ?, ?, ?) on duplicate key update item = values(item), count = values(count), metadata = values(metadata)',
    n: 5,
  },
  vehicleSave: {
    pg: 'update owned_vehicles set props = $2::jsonb, stored = $3, garage = $4 where plate = $1',
    mysql: 'update owned_vehicles set props = ?, stored = ?, garage = ? where plate = ?',
    n: 4,
  },
  topRich: {
    pg: 'select name, bank from players order by bank desc limit 10',
    mysql: 'select name, bank from players order by bank desc limit 10',
    n: 0,
  },
};

interface WorkerResult {
  hist: Record<OpName, number[]>; // sparse [bucket, count, bucket, count, ...]
  counts: Record<OpName, number>;
  errors: number;
  firstError: string | null;
}

function makeOps(hotBase: number): { name: OpName; weight: number; run: (e: QueryEngine) => Promise<unknown> }[] {
  const pickPlayer = () => (Math.random() < 0.9 ? hotBase + Math.floor(Math.random() * HOT) : 1 + Math.floor(Math.random() * PLAYERS));
  const pickVehicle = () => 1 + Math.floor(Math.random() * VEHICLES);
  return [
    { name: 'readInventory', weight: 30, run: (e) => e.execute('inventoryByOwner', [pickPlayer()]) },
    {
      name: 'playerSave', weight: 20,
      run: (e) => {
        const id = pickPlayer();
        const p = [ri(5000), ri(500000), position()];
        return e.execute('playerSave', DIALECT === 'pg' ? [id, ...p] : [...p, id]);
      },
    },
    {
      name: 'saveItem', weight: 20,
      run: (e) => {
        const owner = pickPlayer();
        const slot = 1 + ri(20);
        const count = 1 + ri(10);
        return e.execute('saveItem', DIALECT === 'pg' ? [owner, slot, count] : [count, owner, slot]);
      },
    },
    { name: 'vehiclesByOwner', weight: 10, run: (e) => e.execute('vehiclesByOwner', [pickPlayer()]) },
    {
      name: 'vehicleSave', weight: 8,
      run: (e) => {
        const plate = plateOf(pickVehicle());
        const p = [vehicleProps(), Math.random() < 0.7 ? (DIALECT === 'pg' ? true : 1) : (DIALECT === 'pg' ? false : 0), 'legion'];
        return e.execute('vehicleSave', DIALECT === 'pg' ? [plate, ...p] : [...p, plate]);
      },
    },
    {
      name: 'playerLoad', weight: 5,
      run: async (e) => {
        const id = pickPlayer();
        await e.execute('playerByIdentifier', [identifierOf(id)]);
        await e.execute('inventoryByOwner', [id]);
        await e.execute('vehiclesByOwner', [id]);
      },
    },
    {
      name: 'addItem', weight: 5,
      run: (e) => e.execute('addItem', [pickPlayer(), ITEMS[ri(ITEMS.length)]!, 1 + ri(5), 1 + ri(40), itemMeta()]),
    },
    { name: 'topRich', weight: 2, run: (e) => e.execute('topRich', []) },
  ];
}

function makeDriver(pool: number): SqlDriver {
  return DIALECT === 'pg'
    ? new PgDriver({ host: HOST, port: PORT, database: 'hyperdb', username: 'hyper', password: 'hyper', max: pool })
    : new MysqlDriver({ host: HOST, port: PORT, database: 'hyperdb', user: 'hyper', password: 'hyper', connectionLimit: pool });
}

async function workerMain(): Promise<void> {
  const conc = Number(process.env.W_CONC);
  const pool = Number(process.env.W_POOL);
  const hotBase = Number(process.env.HOTBASE);
  const driver = makeDriver(pool);
  const engine = new QueryEngine(driver);
  for (const [id, q] of Object.entries(Q)) engine.register(id, { sql: q[DIALECT], paramCount: q.n });

  const ops = makeOps(hotBase);
  const totalWeight = ops.reduce((a, o) => a + o.weight, 0);
  const pickOp = () => {
    let r = Math.random() * totalWeight;
    for (const o of ops) { r -= o.weight; if (r <= 0) return o; }
    return ops[0]!;
  };

  const hist = new Map<OpName, Uint32Array>(OP_NAMES.map((n) => [n, new Uint32Array(BUCKETS)]));
  const counts = Object.fromEntries(OP_NAMES.map((n) => [n, 0])) as Record<OpName, number>;
  let errors = 0;
  let firstError: string | null = null;

  const warmEnd = performance.now() + 2000;
  await Promise.all(
    Array.from({ length: Math.min(conc, 32) }, async () => {
      while (performance.now() < warmEnd) {
        try { await pickOp().run(engine); } catch { /* warmup */ }
      }
    }),
  );

  const end = performance.now() + DUR * 1000;
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (performance.now() < end) {
        const op = pickOp();
        const t = performance.now();
        try {
          await op.run(engine);
          const h = hist.get(op.name)!;
          const b = bucketOf(performance.now() - t);
          h[b] = (h[b] ?? 0) + 1;
          counts[op.name]++;
        } catch (err) {
          errors++;
          if (!firstError) firstError = err instanceof Error ? err.message : String(err);
        }
      }
    }),
  );
  await driver.close();

  const sparse = {} as Record<OpName, number[]>;
  for (const n of OP_NAMES) {
    const h = hist.get(n)!;
    const s: number[] = [];
    for (let b = 0; b < BUCKETS; b++) if (h[b]! > 0) s.push(b, h[b]!);
    sparse[n] = s;
  }
  console.log(JSON.stringify({ hist: sparse, counts, errors, firstError } satisfies WorkerResult));
}

function pctFromHist(h: Uint32Array, total: number, q: number): number {
  if (total === 0) return 0;
  const target = Math.max(1, Math.ceil(q * total));
  let cum = 0;
  for (let b = 0; b < BUCKETS; b++) {
    cum += h[b]!;
    if (cum >= target) return bucketMs(b);
  }
  return bucketMs(BUCKETS - 1);
}

async function main(): Promise<void> {
  const CONC = (process.env.CONC ?? '1024,4096').split(',').map(Number);
  const WORKERS = Number(process.env.WORKERS ?? '14');
  const POOL = Number(process.env.POOL ?? '4096');
  const hotBase = 1 + Math.floor(Math.random() * (PLAYERS - HOT));

  console.log(`fivem-load → ${DIALECT}@${HOST}:${PORT}, players=${PLAYERS.toLocaleString()}, hot=${HOT}, workers=${WORKERS}, stages=${CONC.join('/')}`);

  for (const conc of CONC) {
    const w = Math.min(WORKERS, conc);
    const per = Math.ceil(conc / w);
    const poolPer = Math.min(per, Math.ceil(Math.min(POOL, conc) / w));
    const procs = Array.from({ length: w }, () =>
      Bun.spawn({
        cmd: [process.execPath, import.meta.path],
        env: {
          ...process.env,
          ROLE: 'worker',
          W_CONC: String(per),
          W_POOL: String(poolPer),
          HOTBASE: String(hotBase),
        },
        stdout: 'pipe',
        stderr: 'inherit',
      }),
    );
    const outputs = await Promise.all(procs.map(async (p) => ({ text: await new Response(p.stdout).text(), code: await p.exited })));

    const hist = new Map<OpName, Uint32Array>(OP_NAMES.map((n) => [n, new Uint32Array(BUCKETS)]));
    const counts = Object.fromEntries(OP_NAMES.map((n) => [n, 0])) as Record<OpName, number>;
    let errors = 0;
    let firstError: string | null = null;
    let dead = 0;
    for (const o of outputs) {
      if (o.code !== 0 || !o.text.trim()) { dead++; continue; }
      const r = JSON.parse(o.text) as WorkerResult;
      for (const n of OP_NAMES) {
        const h = hist.get(n)!;
        const s = r.hist[n];
        for (let k = 0; k < s.length; k += 2) h[s[k]!] = h[s[k]!]! + s[k + 1]!;
        counts[n] += r.counts[n];
      }
      errors += r.errors;
      firstError ??= r.firstError;
    }

    let total = 0;
    console.log(`\n### ${DIALECT} — clients ${conc} (${w} workers × ${per}, pool ${w * poolPer}, ${DUR}s)`);
    console.log('| op | count | p50 | p95 | p99 |');
    console.log('|---|---|---|---|---|');
    for (const n of OP_NAMES) {
      const h = hist.get(n)!;
      const c = counts[n];
      total += c;
      console.log(`| ${n} | ${c.toLocaleString()} | ${pctFromHist(h, c, 0.5).toFixed(2)}ms | ${pctFromHist(h, c, 0.95).toFixed(2)}ms | ${pctFromHist(h, c, 0.99).toFixed(2)}ms |`);
    }
    console.log(`**total: ${Math.round(total / DUR).toLocaleString()} ops/s**, errors: ${errors}${dead ? `, dead workers: ${dead}` : ''}`);
    if (firstError) console.log(`first error: ${firstError}`);
  }
}

if (process.env.ROLE === 'worker') await workerMain();
else await main();
