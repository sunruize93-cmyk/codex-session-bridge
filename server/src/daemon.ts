import { createServer } from 'node:net';
import { chmodSync, existsSync, fstatSync, lstatSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Coordinator } from './coordinator.js';
import { Store, statePath } from './store.js';
import { BrowserAdapter } from './adapters/browser.js';
import { WechatAdapter } from './adapters/wechat.js';
import { input } from './schemas.js';
import { BridgeError } from './model.js';
process.umask(0o077);
const fd = Number(process.env.SESSION_BRIDGE_LOCK_FD);
if (!Number.isInteger(fd) || fd < 3) throw new Error('必须通过 OS 锁启动');
fstatSync(fd);
const root = fileURLToPath(new URL('../../', import.meta.url));
const path = statePath();
const store = new Store(path);
store.recover();
store.purge();
const coordinator = new Coordinator(store, {
  xiaohongshu_web: new BrowserAdapter(root),
  wechat_macos: new WechatAdapter(root),
});
const socket = join(path, 'bridge.sock');
if (existsSync(socket)) {
  if (lstatSync(socket).isSymbolicLink() || !lstatSync(socket).isSocket())
    throw new Error('不安全的 IPC 路径');
  unlinkSync(socket);
}
const server = createServer((client) => {
  let body = '';
  let handled = false;
  client.setTimeout(22000, () => client.destroy());
  client.on('error', () => {});
  client.on('data', async (chunk) => {
    if (handled) return;
    body += chunk;
    if (body.length > 262144) {
      client.destroy();
      return;
    }
    const nl = body.indexOf('\n');
    if (nl < 0) return;
    handled = true;
    try {
      const r = JSON.parse(body.slice(0, nl));
      const args = input(r.tool, r.args);
      if (
        process.env.SESSION_BRIDGE_ISOLATED_TEST === '1' &&
        !['bridge_doctor', 'bridge_get_task'].includes(r.tool)
      )
        throw new BridgeError('TEST_MODE_READ_ONLY');
      const data = await coordinator.call(r.tool, args);
      client.end(JSON.stringify({ ok: true, data }) + '\n');
    } catch (e) {
      client.end(
        JSON.stringify({
          ok: false,
          error:
            e instanceof BridgeError
              ? e.code
              : (e as any)?.name === 'ZodError'
                ? 'INVALID_INPUT'
                : 'INTERNAL_ERROR',
        }) + '\n',
      );
    }
  });
});
server.listen(socket, () => chmodSync(socket, 0o600));
// 正常退出也先等执行队列；异常退出由 flock 继承保护尚未结束的 AX 工作者。
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close();
    void coordinator.queue.run(async () => {
      store.close();
      try {
        unlinkSync(socket);
      } catch {}
      process.exit(0);
    });
  });
