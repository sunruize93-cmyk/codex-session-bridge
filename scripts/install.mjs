import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (!existsSync(join(root, 'server/dist/index.js')))
  throw new Error('先运行 npm ci && npm run build');
const env = process.env;
let current;
try {
  current = JSON.parse(
    execFileSync('codex', ['mcp', 'get', 'session-bridge', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
} catch (e) {
  if (e.status !== 1) throw e;
}
if (current) {
  const t = current.transport;
  if (
    t?.command !== process.execPath ||
    JSON.stringify(t?.args) !== JSON.stringify([join(root, 'server/dist/index.js')])
  )
    throw new Error('已有不同 session-bridge 配置，已保留；请检查 codex mcp get session-bridge');
  console.log('同名 MCP 已正确注册');
} else {
  const config = join(env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
  const backup = join(
    homedir(),
    'Library',
    'Application Support',
    'codex-session-bridge',
    'config-backups',
  );
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  chmodSync(backup, 0o700);
  if (existsSync(config)) {
    const file = join(backup, `config-${Date.now()}.toml`);
    copyFileSync(config, file);
    chmodSync(file, 0o600);
  }
  execFileSync(
    'codex',
    ['mcp', 'add', 'session-bridge', '--', process.execPath, join(root, 'server/dist/index.js')],
    { stdio: 'inherit' },
  );
}
execFileSync('codex', ['mcp', 'get', 'session-bridge', '--json'], { stdio: 'inherit' });
console.log(
  '请在新 Codex 会话调用 bridge_doctor；当前会话不会热加载。中文技能可从本仓库本地插件源安装。',
);
