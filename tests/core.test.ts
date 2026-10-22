import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Coordinator } from '../server/src/coordinator.js';
import { Store } from '../server/src/store.js';
import {
  BridgeError,
  hash,
  type Adapter,
  type Binding,
  type Operation,
} from '../server/src/model.js';
import { input } from '../server/src/schemas.js';
class Mock implements Adapter {
  binds = 0;
  dispatches = 0;
  reads = 0;
  active = 0;
  max = 0;
  blocker?: string;
  gate?: Promise<void>;
  rejectDispatch?: string;
  account = 'a';
  target = 'target';
  async doctor() {
    return { status: 'synthetic' };
  }
  async bind(a: any) {
    this.binds++;
    return {
      channel: a.channel,
      backend: 'mock',
      backend_version: '1',
      connection: 'c',
      target: this.target,
      account: this.account,
      assurance: 'verified' as const,
    };
  }
  async inspect(b: Binding) {
    return {
      connection: 'c',
      target: this.target,
      account: this.account,
      blocker: this.blocker,
      origin: 'https://www.xiaohongshu.com',
    };
  }
  async execute() {
    this.reads++;
    this.active++;
    this.max = Math.max(this.max, this.active);
    await this.gate;
    this.active--;
    return { source: 'synthetic', body: 'private fixture body' };
  }
  async prepare(_kind: any, payload: any) {
    return { target_ref: payload.chat_ref || payload.note_id || 'post', preview: payload };
  }
  async dispatch(_op: Operation, _b: Binding, check: () => void) {
    check();
    this.dispatches++;
    if (this.rejectDispatch) throw new BridgeError(this.rejectDispatch);
    return { confirmed: true, source: 'synthetic' };
  }
  async reconcile() {
    return { confirmed: true, source: 'synthetic' };
  }
}
async function setup() {
  const path = mkdtempSync(join(tmpdir(), 'csb-test-'));
  const s = new Store(path);
  const m = new Mock();
  const c = new Coordinator(s, { wechat_macos: m, xiaohongshu_web: m });
  const r = await c.call('bridge_bind', { channel: 'wechat_macos' });
  s.put('config', { id: 'write', enabled: true });
  return {
    path,
    s,
    m,
    c,
    b: r.binding.binding_id,
    cleanup() {
      s.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}
const settle = async (c: Coordinator) => {
  await c.queue.run(async () => {});
};
async function prepared(x: Awaited<ReturnType<typeof setup>>) {
  const t = await x.c.call('wechat_prepare_message', {
    binding_id: x.b,
    client_request_id: 'prep',
    payload: { chat_ref: 'chat', body: 'hello' },
  });
  await settle(x.c);
  return x.c.task(t.task_id).result.operation;
}
function send(b: string, op: any, request = 'send') {
  return {
    binding_id: b,
    client_request_id: request,
    operation_id: op.operation_id,
    payload_version: 1,
    scope: {
      scope_ref: 'trusted-host:test',
      action: 'wechat_send_message',
      target_ref: op.target_ref,
      payload_digest: op.digest,
    },
  };
}
test('重复请求与不同请求 ID 的同一 operation 只提交一次', async () => {
  const x = await setup();
  try {
    const op = await prepared(x);
    const a = send(x.b, op);
    const t = await x.c.call('wechat_send_message', a);
    const t2 = await x.c.call('wechat_send_message', a);
    const t3 = await x.c.call('wechat_send_message', send(x.b, op, 'new-id'));
    await settle(x.c);
    assert.equal(t.task_id, t2.task_id);
    assert.equal(t.task_id, t3.task_id);
    assert.equal(x.m.dispatches, 1);
    await assert.rejects(
      x.c.call('wechat_send_message', { ...a, payload_version: 2 }),
      /REQUEST_ID_CONFLICT/,
    );
  } finally {
    x.cleanup();
  }
});
test('受理与执行之间关闭写入，实际提交为零', async () => {
  const x = await setup();
  try {
    const op = await prepared(x);
    await x.c.call('wechat_send_message', send(x.b, op));
    x.s.put('config', { id: 'write', enabled: false });
    await settle(x.c);
    assert.equal(x.m.dispatches, 0);
  } finally {
    x.cleanup();
  }
});
test('重复绑定在触碰后端前拒绝', async () => {
  const x = await setup();
  try {
    await assert.rejects(x.c.call('bridge_bind', { channel: 'wechat_macos' }), /RESOURCE_BUSY/);
    assert.equal(x.m.binds, 1);
  } finally {
    x.cleanup();
  }
});
test('提交遇验证码：保留未知结果、冻结队列、不重发', async () => {
  const x = await setup();
  try {
    const op = await prepared(x);
    x.m.rejectDispatch = 'HUMAN_VERIFICATION_REQUIRED';
    const t = await x.c.call('wechat_send_message', send(x.b, op));
    await settle(x.c);
    assert.equal(x.c.task(t.task_id).status, 'OUTCOME_UNKNOWN');
    assert.equal(x.c.binding(x.b).state, 'PAUSED');
    const q = await x.c.call('wechat_read_messages', {
      binding_id: x.b,
      client_request_id: 'read',
      chat_ref: 'chat',
      limit: 1,
    });
    await settle(x.c);
    assert.equal(x.c.task(q.task_id).status, 'QUEUED');
    assert.equal(x.m.reads, 0);
    await x.c.call('wechat_send_message', send(x.b, op, 'second'));
    await settle(x.c);
    assert.equal(x.m.dispatches, 1);
  } finally {
    x.cleanup();
  }
});
test('重启保持人工接管；DISPATCHING 恢复为未知', async () => {
  const x = await setup();
  try {
    const op = await prepared(x);
    const stored = x.c.operation(op.operation_id);
    stored.status = 'DISPATCHING';
    x.s.put('operation', stored);
    const b = x.c.binding(x.b);
    b.state = 'PAUSED';
    x.s.put('binding', b);
    x.s.recover();
    assert.equal(x.c.operation(op.operation_id).status, 'OUTCOME_UNKNOWN');
    assert.equal(x.c.paused(), true);
    assert.equal(x.m.dispatches, 0);
  } finally {
    x.cleanup();
  }
});
test('成功终态取消不抹去确认', async () => {
  const x = await setup();
  try {
    const t = await x.c.call('wechat_read_messages', {
      binding_id: x.b,
      client_request_id: 'read',
      chat_ref: 'chat',
    });
    await settle(x.c);
    const r = await x.c.call('bridge_cancel_task', { task_id: t.task_id });
    assert.equal(r.status, 'SUCCEEDED');
  } finally {
    x.cleanup();
  }
});
test('账号或目标改变时不调用发送', async () => {
  for (const key of ['account', 'target'] as const) {
    const x = await setup();
    try {
      const op = await prepared(x);
      x.m[key] = 'changed';
      await x.c.call('wechat_send_message', send(x.b, op));
      await settle(x.c);
      assert.equal(x.m.dispatches, 0);
    } finally {
      x.cleanup();
    }
  }
});
test('授权范围与未知状态独立：错误范围拒绝提交', async () => {
  const x = await setup();
  try {
    const op = await prepared(x);
    const a = send(x.b, op);
    a.scope.target_ref = 'different';
    await assert.rejects(x.c.call('wechat_send_message', a), /SCOPE_MISMATCH/);
    assert.equal(x.m.dispatches, 0);
  } finally {
    x.cleanup();
  }
});
test('读取遇验证，重复恢复只执行一次；账号改变不恢复', async () => {
  const x = await setup();
  try {
    x.m.blocker = 'HUMAN_VERIFICATION_REQUIRED';
    const r = await x.c.call('wechat_read_messages', {
      binding_id: x.b,
      client_request_id: 'r',
      chat_ref: 'chat',
    });
    await settle(x.c);
    x.m.account = 'other';
    delete x.m.blocker;
    await assert.rejects(
      x.c.call('bridge_resume_task', { task_id: r.task_id }),
      /ACCOUNT_MISMATCH/,
    );
    x.m.account = 'a';
    await x.c.call('bridge_resume_task', { task_id: r.task_id });
    await x.c.call('bridge_resume_task', { task_id: r.task_id });
    await settle(x.c);
    assert.equal(x.m.reads, 1);
  } finally {
    x.cleanup();
  }
});
test('不同渠道共享同一前台锁', async () => {
  const x = await setup();
  try {
    const b2 = await x.c.call('bridge_bind', { channel: 'xiaohongshu_web' });
    await Promise.all([
      x.c.call('wechat_read_messages', {
        binding_id: x.b,
        client_request_id: '1',
        chat_ref: 'chat',
      }),
      x.c.call('xhs_search', {
        binding_id: b2.binding.binding_id,
        client_request_id: '2',
        query: 'x',
      }),
    ]);
    await settle(x.c);
    assert.equal(x.m.max, 1);
    assert.equal(x.m.reads, 2);
  } finally {
    x.cleanup();
  }
});
test('跨渠道工具与任意参数拒绝', async () => {
  const x = await setup();
  try {
    await assert.rejects(
      x.c.call('xhs_search', { binding_id: x.b, client_request_id: 'q', query: 'x' }),
      /CHANNEL_MISMATCH/,
    );
    assert.throws(() =>
      input('wechat_read_messages', {
        binding_id: 'b',
        client_request_id: 'r',
        chat_ref: 'c',
        limit: 999,
      }),
    );
    assert.throws(() =>
      input('wechat_send_message', {
        ...send('b', { operation_id: 'o', target_ref: 'c', digest: hash('x') }),
        body: 'injected',
      }),
    );
    assert.throws(() => input('eval', { code: 'bad' }));
  } finally {
    x.cleanup();
  }
});
test('提交前取消不发送，取消后不宣称撤回', async () => {
  const x = await setup();
  try {
    const op = await prepared(x);
    const t = await x.c.call('wechat_send_message', send(x.b, op));
    await x.c.call('bridge_cancel_task', { task_id: t.task_id });
    await settle(x.c);
    assert.equal(x.m.dispatches, 0);
    assert.equal(x.c.task(t.task_id).status, 'CANCELLED');
  } finally {
    x.cleanup();
  }
});

test('清理敏感正文保留去重墓碑；忘记未知正文后不重发', async () => {
  const x = await setup();
  try {
    const op = await prepared(x);
    const t = await x.c.call('wechat_send_message', send(x.b, op));
    await settle(x.c);
    const old = x.c.task(t.task_id);
    old.updated_at = '2000-01-01T00:00:00Z';
    x.s.put('task', old);
    const stored = x.c.operation(op.operation_id);
    stored.updated_at = old.updated_at;
    x.s.put('operation', stored);
    assert.ok(x.s.purge() > 0);
    const again = await x.c.call('wechat_send_message', send(x.b, op, 'later'));
    assert.equal(again.task_id, t.task_id);
    assert.equal(x.m.dispatches, 1);
    x.s.forgetPayload(op.operation_id);
    assert.equal(x.c.operation(op.operation_id).payload, null);
    assert.equal(x.m.dispatches, 1);
  } finally {
    x.cleanup();
  }
});

test('删除正文墓碑不会被旧内存操作对象恢复', async () => {
  const x = await setup();
  try {
    const op = await prepared(x);
    const stale = x.c.operation(op.operation_id);
    x.s.forgetPayload(op.operation_id);
    stale.status = 'PREPARED';
    x.s.put('operation', stale);
    const saved = x.c.operation(op.operation_id);
    assert.equal(saved.payload, null);
    assert.equal(saved.status, 'EXPIRED');
  } finally {
    x.cleanup();
  }
});
test('未知任务重复 resume 不改代次、不再次提交', async () => {
  const x = await setup();
  try {
    const op = await prepared(x);
    x.m.rejectDispatch = 'BRIDGE_DISCONNECTED';
    const t = await x.c.call('wechat_send_message', send(x.b, op));
    await settle(x.c);
    await x.c.call('bridge_resume_task', { task_id: t.task_id });
    const gen = x.c.binding(x.b).generation;
    await x.c.call('bridge_resume_task', { task_id: t.task_id });
    assert.equal(x.c.binding(x.b).generation, gen);
    assert.equal(x.c.task(t.task_id).status, 'OUTCOME_UNKNOWN');
    assert.equal(x.m.dispatches, 1);
  } finally {
    x.cleanup();
  }
});

test('resume 等待检查期间取消，返回后仍保持取消终态', async () => {
  const x = await setup();
  try {
    x.m.blocker = 'HUMAN_VERIFICATION_REQUIRED';
    const t = await x.c.call('wechat_read_messages', {
      binding_id: x.b,
      client_request_id: 'wait',
      chat_ref: 'chat',
    });
    await settle(x.c);
    delete x.m.blocker;
    let release!: () => void;
    const wait = new Promise<void>((r) => (release = r));
    const inspect = x.m.inspect.bind(x.m);
    x.m.inspect = async (b) => {
      await wait;
      return inspect(b);
    };
    const resume = x.c.call('bridge_resume_task', { task_id: t.task_id });
    await new Promise((r) => setImmediate(r));
    await x.c.call('bridge_cancel_task', { task_id: t.task_id });
    release();
    await resume;
    await settle(x.c);
    assert.equal(x.c.task(t.task_id).status, 'CANCELLED');
    assert.equal(x.m.reads, 0);
  } finally {
    x.cleanup();
  }
});
test('核对与删除正文并发，旧对象无法把正文写回 SQLite', async () => {
  const x = await setup();
  try {
    const op = await prepared(x);
    x.m.rejectDispatch = 'BRIDGE_DISCONNECTED';
    await x.c.call('wechat_send_message', send(x.b, op));
    await settle(x.c);
    let release!: () => void;
    const wait = new Promise<void>((r) => (release = r));
    x.m.reconcile = async () => {
      await wait;
      return { confirmed: false, source: 'synthetic' };
    };
    const reconcile = x.c.call('bridge_reconcile_operation', { operation_id: op.operation_id });
    await new Promise((r) => setImmediate(r));
    x.s.forgetPayload(op.operation_id);
    release();
    await reconcile;
    assert.equal(x.c.operation(op.operation_id).payload, null);
  } finally {
    x.cleanup();
  }
});
