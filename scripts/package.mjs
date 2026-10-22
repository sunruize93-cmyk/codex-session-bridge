import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const stage = join(root, 'artifacts', 'distribution');
const dest = join(stage, 'codex-session-bridge');
rmSync(stage, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const name of [
  'server',
  'tsconfig.json',
  'tests',
  '.prettierrc.json',
  'scripts',
  'skills',
  'docs',
  'wechat-worker',
  '.codex-plugin',
  '.agents',
  'plugin.json',
  'mcp.json',
  '.mcp.json',
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
])
  cpSync(join(root, name), join(dest, name), {
    recursive: true,
    filter: (p) => !p.includes('/.venv') && !p.includes('/__pycache__'),
  });
if (existsSync(join(root, 'artifacts/wheelhouse')))
  cpSync(join(root, 'artifacts/wheelhouse'), join(dest, 'wheelhouse'), { recursive: true });
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: dest,
  stdio: 'inherit',
});
if (existsSync(join(root, 'artifacts/browser-bridge-1.0.26.zip')))
  cpSync(
    join(root, 'artifacts/browser-bridge-1.0.26.zip'),
    join(dest, 'browser-bridge-1.0.26.zip'),
  );
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const basename = `codex-session-bridge-${version}-${process.platform}-${process.arch}.tar.gz`;
const out = join(root, 'artifacts', basename);
execFileSync('tar', ['-czf', out, '-C', stage, 'codex-session-bridge']);
const sha = createHash('sha256').update(readFileSync(out)).digest('hex');
writeFileSync(join(root, 'artifacts/SHA256SUMS'), `${sha}  ${basename}\n`);
console.log(JSON.stringify({ artifact: out, sha256: sha }));
