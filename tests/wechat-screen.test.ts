import test from 'node:test';
import assert from 'node:assert/strict';
import { WechatAdapter } from '../server/src/adapters/wechat.js';
import { input } from '../server/src/schemas.js';
import type { Binding, Operation } from '../server/src/model.js';

test('屏幕只读绑定必须显式选择聊天及 user_bound，跨语言引用一致', async () => {
  const args = {
    channel: 'wechat_macos',
    read_only_backend: 'screen',
    expected_chat: '文件传输助手',
    user_bound: true,
  };
  for (const invalid of [
    { ...args, user_bound: false },
    { ...args, expected_chat: undefined },
    { ...args, channel: 'xiaohongshu_web' },
    { ...args, expected_account: 'account' },
  ])
    assert.throws(() => input('bridge_bind', invalid));
  const adapter = new WechatAdapter('/unused');
  adapter.worker = async (request) => {
    assert.equal(request.backend, 'screen-readonly');
    return { connection: '42:start', target: '42:start:screen:9', account: null };
  };
  const binding = await adapter.bind(input('bridge_bind', args));
  assert.equal(binding.backend, 'screen-readonly');
  assert.equal(binding.assurance, 'user_bound');
  // Fixture generated independently by Python's compact UTF-8 JSON implementation.
  assert.equal(
    binding.screen_chat_ref,
    '05bb0139df67934b3d058a3b16e90dba26e0ec4083b75cd7c7f20b453cd3b9dd',
  );
});

test('屏幕绑定拒绝所有写入与核对，不调用工作者', async () => {
  const adapter = new WechatAdapter('/unused');
  adapter.worker = async () => assert.fail('screen write reached worker');
  const binding: Binding = {
    binding_id: 'b',
    channel: 'wechat_macos',
    backend: 'screen-readonly',
    backend_version: '0.1.0',
    connection: 'c',
    target: 't',
    assurance: 'user_bound',
    generation: 1,
    state: 'READY',
    created_at: 'synthetic',
  };
  for (const call of [
    () => adapter.prepare('message', { body: 'synthetic' }, binding, () => {}),
    () => adapter.dispatch({} as Operation, binding, () => {}),
    () => adapter.reconcile({} as Operation, binding),
  ])
    await assert.rejects(call(), /SCREEN_MODE_READ_ONLY/);
});
