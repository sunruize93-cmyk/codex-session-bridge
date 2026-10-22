import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { browserProgram } from '../server/src/adapters/browser-program.js';
import { BrowserAdapter } from '../server/src/adapters/browser.js';
import { BridgeError } from '../server/src/model.js';
function page(body: string, cryptoImpl: any = webcrypto) {
  const dom = new JSDOM(body, {
    url: 'https://www.xiaohongshu.com/search_result',
    runScripts: 'outside-only',
  });
  const w = dom.window as any;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 20, height: 20 });
  Object.defineProperty(w, 'crypto', { value: cryptoImpl });
  w.TextEncoder = TextEncoder;
  w.__name = (f: any) => f;
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent;
    },
    set(v) {
      this.textContent = v;
    },
  });
  const fn = w.eval(`(${browserProgram.toString()})`);
  return { w, fn, close: () => w.close() };
}
const cards =
  '<section class="note-item"><a href="/explore/0123456789abcdef01234567">old result</a></section>';
test('遮罩优先于背景旧卡片，正文验证码文字不误报', async () => {
  const p = page('<article>验证码介绍</article>' + cards);
  try {
    assert.equal((await p.fn({ action: 'inspect' })).blocker, undefined);
    const d = p.w.document.createElement('div');
    d.className = 'captcha-container';
    p.w.document.body.append(d);
    assert.equal((await p.fn({ action: 'inspect' })).blocker, 'HUMAN_VERIFICATION_REQUIRED');
    const r = await p.fn({ action: 'note_read', note_id: '0123456789abcdef01234567', guard: {} });
    assert.equal(r.bridge_error, 'HUMAN_VERIFICATION_REQUIRED');
  } finally {
    p.close();
  }
});
test('旧结果未变化不返回为本次搜索，输入作为数据传递', async () => {
  const p = page('<input id="search-input"><button aria-label="搜索">search</button>' + cards);
  try {
    const o = await p.fn({ action: 'inspect' });
    const guard = { document: o.document, origin: o.origin };
    p.w.history.pushState(
      {},
      '',
      `?keyword=${encodeURIComponent('x"); globalThis.pwned=true; //')}`,
    );
    const query = 'x"); globalThis.pwned=true; //';
    await p.fn({ action: 'search_start', query, guard });
    const r = await p.fn({ action: 'search_result', query, limit: 5, guard });
    assert.equal(r.pending, true);
    assert.equal(p.w.pwned, undefined);
    p.w.document.querySelector('.note-item a').textContent = 'new result';
    const r2 = await p.fn({ action: 'search_result', query, limit: 5, guard });
    assert.equal(r2.query, query);
    assert.equal(r2.results[0].title, 'new result');
  } finally {
    p.close();
  }
});
test('旧文档、账号改变不点击', async () => {
  const p = page(
    '<a class="user" href="/user/profile/0123456789abcdef01234567">me</a><input id="search-input"><button aria-label="搜索">search</button>',
  );
  try {
    const o = await p.fn({ action: 'inspect' });
    const r = await p.fn({
      action: 'search_start',
      query: 'q',
      guard: { document: 'stale', origin: o.origin, account: o.account },
    });
    assert.equal(r.bridge_error, 'TARGET_CHANGED');
    p.w.document.querySelector('.user').href = '/user/profile/1123456789abcdef01234567';
    const r2 = await p.fn({
      action: 'search_start',
      query: 'q',
      guard: { document: o.document, origin: o.origin, account: o.account },
    });
    assert.equal(r2.bridge_error, 'TARGET_CHANGED');
  } finally {
    p.close();
  }
});
test('浏览器传输未知只调用一次，不运行上游 retry loop', async () => {
  let calls = 0;
  const b = new BrowserAdapter('/unused');
  b.upstream = async () => ({
    requestDaemon: async () => {
      calls++;
      throw new Error('lost');
    },
  });
  await assert.rejects(
    b.command('exec', { code: 'x' }),
    (e) => e instanceof BridgeError && e.code === 'BRIDGE_DISCONNECTED',
  );
  assert.equal(calls, 1);
});
test('登录墙突现通过固定结构返回分类', async () => {
  const p = page('<div class="login-modal">登录</div>');
  try {
    const r = await p.fn({ action: 'search_start', query: 'q', guard: {} });
    assert.equal(r.bridge_error, 'AUTH_REQUIRED');
  } finally {
    p.close();
  }
});

test('同数量替换预览图片或改变顺序不发布', async () => {
  const dom = new JSDOM(
    '<a class="user" href="/user/profile/0123456789abcdef01234567">me</a><input placeholder="输入标题"><div class="tiptap" contenteditable="true"></div><div class="img-preview-area"><img src="https://example.org/a.png"></div><button>发布</button>',
    { url: 'https://creator.xiaohongshu.com', runScripts: 'outside-only' },
  );
  const w = dom.window as any;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 20, height: 20 });
  Object.defineProperty(w, 'crypto', { value: webcrypto });
  w.TextEncoder = TextEncoder;
  w.__name = (f: any) => f;
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent;
    },
    set(v) {
      this.textContent = v;
    },
  });
  Object.defineProperty(w.HTMLElement.prototype, 'isContentEditable', {
    get() {
      return this.getAttribute('contenteditable') === 'true';
    },
  });
  try {
    const fn = w.eval(`(${browserProgram.toString()})`);
    const o = await fn({ action: 'inspect' });
    const guard = { document: o.document, origin: o.origin, account: o.account };
    const prepared = await fn({
      action: 'prepare_post',
      title: '标题',
      body: '内容',
      image_count: 1,
      guard,
    });
    assert.equal(prepared.preview.title, '标题');
    let clicks = 0;
    w.document.querySelector('button').onclick = () => clicks++;
    w.document.querySelector('img').src = 'https://example.org/replaced.png';
    const result = await fn({
      action: 'dispatch',
      operation_id: 'op_image',
      payload_digest: 'digest',
      kind: 'post',
      title: '标题',
      body: '内容',
      prepared: prepared.checkpoint,
      guard,
    });
    assert.equal(result.bridge_error, 'PAYLOAD_CHANGED');
    assert.equal(clicks, 0);
  } finally {
    w.close();
  }
});

test('哈希 await 期间切账号并出现验证，点击次数保持零', async () => {
  let p: ReturnType<typeof page>;
  let change = false;
  const cryptoImpl = {
    randomUUID: () => webcrypto.randomUUID(),
    subtle: {
      digest: async (...args: any[]) => {
        const result = await (webcrypto.subtle.digest as any)(...args);
        if (change) {
          p.w.document.querySelector('.user').href = '/user/profile/1123456789abcdef01234567';
          p.w.document.body.insertAdjacentHTML(
            'beforeend',
            '<div class="captcha-container">验证</div>',
          );
        }
        return result;
      },
    },
  };
  p = page(
    '<a class="user" href="/user/profile/0123456789abcdef01234567">me</a><textarea id="content-textarea">hello</textarea><button>发送</button>',
    cryptoImpl,
  );
  try {
    p.w.history.pushState({}, '', '/explore/0123456789abcdef01234567');
    const o = await p.fn({ action: 'inspect' });
    change = true;
    let clicks = 0;
    p.w.document.querySelector('button').onclick = () => clicks++;
    const r = await p.fn({
      action: 'dispatch',
      kind: 'comment',
      operation_id: 'op',
      payload_digest: 'digest',
      note_id: '0123456789abcdef01234567',
      body: 'hello',
      guard: { document: o.document, origin: o.origin, account: o.account },
    });
    assert.ok(['TARGET_CHANGED', 'HUMAN_VERIFICATION_REQUIRED'].includes(r.bridge_error));
    assert.equal(clicks, 0);
  } finally {
    p.close();
  }
});
test('没有本次点击回执，准备后出现的同文评论不算成功', async () => {
  const p = page(
    '<a class="user" href="/user/profile/0123456789abcdef01234567">me</a><textarea id="content-textarea">hello</textarea>',
  );
  try {
    p.w.history.pushState({}, '', '/explore/0123456789abcdef01234567');
    const o = await p.fn({ action: 'inspect' });
    const guard = { document: o.document, origin: o.origin, account: o.account };
    p.w.document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="comment-item" id="previously-unseen"><a href="/user/profile/0123456789abcdef01234567">me</a><div class="content">hello</div></div>',
    );
    const r = await p.fn({
      action: 'reconcile',
      operation_id: 'never-clicked',
      payload_digest: 'digest',
      kind: 'comment',
      note_id: '0123456789abcdef01234567',
      body: 'hello',
      prepared: { before_ids: [] },
      guard,
    });
    assert.equal(r.confirmed, false);
  } finally {
    p.close();
  }
});
