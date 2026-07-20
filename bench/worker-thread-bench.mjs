// Why hyper-db does NOT use the loaf_bcrypt worker-thread pattern.
//
// loaf_bcrypt moves bcrypt (CPU-bound, ~80ms per hash, ~60-byte payloads)
// off the FiveM main thread via node:worker_threads — correct for that shape
// of work. A DB pipeline has the opposite shape: the heavy lifting happens
// in the database server process, Node's socket I/O is already off-thread
// (libuv), and the payload (the result set) is the expensive part.
//
// This bench measures what a worker thread would actually cost us:
//   1. postMessage roundtrip overhead vs an inline resolved promise
//   2. structured-clone cost of shipping N-row result sets across threads
//      (the deserialize half runs on the MAIN thread — the hitch survives)
//   3. the inline main-thread CPU cost of the same work for comparison
//   4. max event-loop drift: worker transfer vs building rows inline
//
// Run: node bench/worker-thread-bench.mjs   (or: bun bench/worker-thread-bench.mjs)
import { Worker } from 'node:worker_threads';

const workerSrc = `
import { parentPort } from 'node:worker_threads';
function makeRows(n) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = { id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'),
                name: 'player_' + i, elo: 1000 + (i % 500), banned: false,
                meta: { level: i % 100, clan: 'clan' + (i % 7) } };
  }
  return rows;
}
parentPort.on('message', (m) => {
  if (m.action === 'echo') parentPort.postMessage({ id: m.id, rows: [] });
  else parentPort.postMessage({ id: m.id, rows: makeRows(m.n) });
});
`;

const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(workerSrc)}`));
const queue = new Map();
let nextId = 0;
worker.on('message', (m) => {
  const cb = queue.get(m.id);
  queue.delete(m.id);
  cb(m);
});
const ask = (msg) =>
  new Promise((res) => {
    const id = nextId++;
    queue.set(id, res);
    worker.postMessage({ ...msg, id });
  });

function makeRows(n) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = {
      id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'),
      name: 'player_' + i,
      elo: 1000 + (i % 500),
      banned: false,
      meta: { level: i % 100, clan: 'clan' + (i % 7) },
    };
  }
  return rows;
}

function report(label, samples) {
  samples.sort((a, b) => a - b);
  const at = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  console.log(`${label.padEnd(46)} p50=${(at(0.5) * 1000).toFixed(1)}us  p99=${(at(0.99) * 1000).toFixed(1)}us`);
}

async function measure(label, warmup, n, op) {
  for (let i = 0; i < warmup; i++) await op();
  const s = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await op();
    s.push(performance.now() - t);
  }
  report(label, s);
}

function measureSync(label, warmup, n, op) {
  for (let i = 0; i < warmup; i++) op();
  const s = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    op();
    s.push(performance.now() - t);
  }
  report(label, s);
}

async function maxDrift(work) {
  let max = 0;
  let last = performance.now();
  const iv = setInterval(() => {
    const now = performance.now();
    const d = now - last - 1;
    if (d > max) max = d;
    last = now;
  }, 1);
  await work();
  clearInterval(iv);
  return max;
}

console.log(`runtime ${process.version ?? 'bun'}\n`);

console.log('--- 1. roundtrip overhead (empty payload) ---');
await measure('inline resolved promise', 1000, 20000, () => Promise.resolve([]));
await measure('worker postMessage roundtrip', 1000, 20000, () => ask({ action: 'echo' }));

console.log('\n--- 2. shipping result sets across threads (main thread pays deserialize) ---');
for (const n of [10, 100, 1000, 10000]) {
  await measure(`worker returns ${String(n).padStart(5)} rows`, 50, n >= 10000 ? 200 : 1000, () => ask({ action: 'rows', n }));
}

console.log('\n--- 3. the same work done inline on the main thread ---');
for (const n of [10, 100, 1000, 10000]) {
  const rows = makeRows(n);
  measureSync(`JSON.stringify ${String(n).padStart(5)} rows (boundary)`, 50, n >= 10000 ? 200 : 1000, () => JSON.stringify(rows));
}
const rows10k = makeRows(10000);
measureSync('map/copy 10000 rows (driver row mapping)', 50, 200, () => rows10k.map((r) => ({ ...r })));

console.log('\n--- 4. event-loop hitch: pulling 10k rows x20 ---');
const workerDrift = await maxDrift(async () => {
  for (let i = 0; i < 20; i++) await ask({ action: 'rows', n: 10000 });
});
console.log(`max event-loop drift receiving from worker: ${workerDrift.toFixed(2)}ms`);
const inlineDrift = await maxDrift(async () => {
  for (let i = 0; i < 20; i++) {
    makeRows(10000);
    await new Promise((r) => setImmediate(r));
  }
});
console.log(`max event-loop drift building inline:        ${inlineDrift.toFixed(2)}ms`);

await worker.terminate();
