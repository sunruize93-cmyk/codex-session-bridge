import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Coordinator } from '../server/src/coordinator.js';
import { Store } from '../server/src/store.js';
import { input } from '../server/src/schemas.js';

test('默认与浏览器专属 doctor 不触碰微信；微信诊断必须显式选择', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'csb-doctor-scope-'));
  const store = new Store(dir);
  let wx = 0;
  const coordinator = new Coordinator(store, {
    xiaohongshu_web: { doctor: async () => ({ channel: 'xiaohongshu_web' }) } as any,
    instagram_web: { doctor: async () => ({ channel: 'instagram_web' }) } as any,
    wechat_macos: {
      doctor: async () => {
        wx++;
        return { channel: 'wechat_macos' };
      },
    } as any,
  });
  try {
    assert.deepEqual(
      (await coordinator.call('bridge_doctor', input('bridge_doctor', {}))).adapters,
      [{ channel: 'xiaohongshu_web' }, { channel: 'instagram_web' }],
    );
    await coordinator.call('bridge_doctor', input('bridge_doctor', { channel: 'xiaohongshu_web' }));
    assert.equal(wx, 0);
    assert.deepEqual(
      (
        await coordinator.call(
          'bridge_doctor',
          input('bridge_doctor', { channel: 'instagram_web' }),
        )
      ).adapters,
      [{ channel: 'instagram_web' }],
    );
    assert.equal(wx, 0);
    assert.deepEqual(
      (await coordinator.call('bridge_doctor', input('bridge_doctor', { channel: 'wechat_macos' })))
        .adapters,
      [{ channel: 'wechat_macos' }],
    );
    assert.equal(wx, 1);
    assert.throws(() => input('bridge_doctor', { channel: 'arbitrary' }));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
