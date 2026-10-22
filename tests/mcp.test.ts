import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
test('实际 stdio MCP：两客户端共用协调进程、严格 schema、脱敏诊断与 OS 锁', async () => {
  const home = mkdtempSync(join(tmpdir(), 'csb-mcp-'));
  const env = {
    ...process.env,
    SESSION_BRIDGE_HOME: home,
    SESSION_BRIDGE_ISOLATED_TEST: '1',
  } as Record<string, string>;
  const clients: Client[] = [];
  let pid: number | undefined;
  try {
    for (let i = 0; i < 2; i++) {
      const client = new Client({ name: `test-${i}`, version: '1.0' });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [join(process.cwd(), 'server/dist/index.js')],
          env,
          stderr: 'pipe',
        }),
      );
      clients.push(client);
    }
    const tools = await clients[0].listTools();
    assert.equal(tools.tools.length, 18);
    assert.equal(
      tools.tools.find((t) => t.name === 'wechat_send_message')?.annotations?.destructiveHint,
      true,
    );
    const docs = await Promise.all(
      clients.map((c) => c.callTool({ name: 'bridge_doctor', arguments: {} })),
    );
    const values = docs.map((r: any) => JSON.parse(r.content[0].text));
    assert.equal(values[0].coordinator_pid, values[1].coordinator_pid);
    pid = values[0].coordinator_pid;
    assert.equal(typeof pid, 'number');
    assert.equal(statSync(join(home, 'bridge.sock')).mode & 0o777, 0o600);
    assert.equal(statSync(join(home, 'tasks.sqlite')).mode & 0o777, 0o600);
    const bad = await clients[0].callTool({
      name: 'xhs_search',
      arguments: { binding_id: 'b', client_request_id: 'id', query: 'q', limit: 100000 },
    });
    assert.equal(bad.isError, true);
    assert.equal(JSON.parse((bad.content as any)[0].text).error.code, 'INVALID_INPUT');
    await assert.rejects(
      run('python3', ['scripts/lock-daemon.py', process.cwd(), home, process.execPath], { env }),
      (e) => (e as any).code === 73,
    );
    const diag = await run(process.execPath, ['server/dist/cli.js', 'diagnostics'], { env });
    const safe = JSON.parse(diag.stdout);
    assert.equal(safe.raw_content_included, false);
    assert.equal(safe.task_count, 0);
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    if (pid) {
      process.kill(pid, 'SIGTERM');
      for (let i = 0; i < 50 && existsSync(join(home, 'bridge.sock')); i++) await setTimeout(50);
    }
    rmSync(home, { recursive: true, force: true });
  }
});
