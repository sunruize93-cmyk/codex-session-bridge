import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.platform !== 'darwin') throw new Error('微信原生工作者仅支持 macOS');
const offline = existsSync(join(root, 'wheelhouse'));
execFileSync(
  'uv',
  [
    'sync',
    '--frozen',
    '--project',
    join(root, 'wechat-worker'),
    '--python',
    '3.12',
    ...(offline ? ['--no-index', '--find-links', join(root, 'wheelhouse')] : []),
  ],
  { stdio: 'inherit' },
);
console.log('已安装工作者；请对实际 Python 进程检查辅助功能权限。');
