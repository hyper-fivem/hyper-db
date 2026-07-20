/** Bundle the core resource into a single dist/server.js (esbuild via
 *  Bun.build). FiveM's built-in webpack/yarn pipeline is deprecated. */
import { fileURLToPath } from 'node:url';

const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL('./server/index.ts', import.meta.url))],
  outdir: fileURLToPath(new URL('./dist', import.meta.url)),
  naming: 'server.js',
  target: 'node',
  format: 'cjs',
  minify: false,
  sourcemap: 'linked',
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log('bundled resource/dist/server.js');
