import { build } from 'esbuild';
await build({
  entryPoints: ['server/src/index.ts', 'server/src/daemon.ts', 'server/src/cli.ts'],
  outdir: 'server/dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
});
console.log('已构建 server/dist');
