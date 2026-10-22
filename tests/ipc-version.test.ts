import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from '../server/src/ipc.js';
test('新客户端只发送版本封套；旧协调器不能收到业务doctor或触发微信', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'csb-old-ipc-'));
  const previous = process.env.SESSION_BRIDGE_HOME;
  process.env.SESSION_BRIDGE_HOME = dir;
  const seen: any[] = [];
  const server = createServer((socket) =>
    socket.once('data', (data) => {
      seen.push(JSON.parse(data.toString()));
      socket.end(JSON.stringify({ ok: false, error: 'INVALID_INPUT' }) + '\n');
    }),
  );
  try {
    await new Promise<void>((r) => server.listen(join(dir, 'bridge.sock'), r));
    await assert.rejects(
      () => request('bridge_doctor', {}),
      (e: any) => e.code === 'COORDINATOR_UPGRADE_REQUIRED',
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0].tool, '__session_bridge_rpc_v2');
    assert.equal(seen[0].args.version, 2);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    if (previous === undefined) delete process.env.SESSION_BRIDGE_HOME;
    else process.env.SESSION_BRIDGE_HOME = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
