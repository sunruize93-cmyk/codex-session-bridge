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
test('新版搜索忽略隐藏旧输入与镜像，只点击普通搜索按钮', async () => {
  const p = page(
    '<input id="search-input" style="display:none"><div class="search-box-in-content"><textarea aria-hidden="true" placeholder="搜索小红书"></textarea><textarea id="search-input-in-feeds"></textarea><button class="wendian-btn">问点点</button><div class="submit-button-wrapper"></div></div>' +
      cards,
  );
  try {
    let searched = 0;
    let asked = 0;
    p.w.document.querySelector('.submit-button-wrapper').onclick = () => searched++;
    p.w.document.querySelector('.wendian-btn').onclick = () => asked++;
    const o = await p.fn({ action: 'inspect' });
    const guard = { document: o.document, origin: o.origin };
    const result = await p.fn({ action: 'search_start', query: '合成查询', guard });
    assert.equal(result.submitted, true);
    assert.equal(p.w.document.querySelector('#search-input-in-feeds').value, '合成查询');
    assert.equal(searched, 1);
    assert.equal(asked, 0);
    p.w.history.pushState({}, '', '?keyword=' + encodeURIComponent('合成查询'));
    assert.equal(
      (await p.fn({ action: 'search_result', query: '合成查询', limit: 3, guard })).pending,
      true,
    );
    p.w.document.querySelector('.note-item a').textContent = 'new result';
    assert.equal(
      (await p.fn({ action: 'search_result', query: '合成查询', limit: 3, guard })).results.length,
      1,
    );
  } finally {
    p.close();
  }
});
test('新版搜索没有可用的唯一普通提交按钮时不回退到 AI 控件', async () => {
  for (const button of [
    '<div class="submit-button-wrapper" style="display:none"></div>',
    '<button class="submit-button-wrapper" disabled></button>',
    '<div class="submit-button-wrapper" aria-disabled="true"></div>',
    '<div class="submit-button-wrapper"></div><div class="submit-button-wrapper"></div>',
  ]) {
    const p = page(
      '<div class="search-box-in-content"><textarea id="search-input-in-feeds"></textarea><button class="input-button">问点点</button>' +
        button +
        '</div>',
    );
    try {
      let clicks = 0;
      p.w.document.querySelector('.input-button').onclick = () => clicks++;
      const o = await p.fn({ action: 'inspect' });
      const r = await p.fn({
        action: 'search_start',
        query: '合成查询',
        guard: { document: o.document, origin: o.origin },
      });
      assert.equal(r.bridge_error, 'UI_CHANGED');
      assert.equal(clicks, 0);
    } finally {
      p.close();
    }
  }
});
test('新版路由只额外解码一次并核对新结果与输入', async () => {
  const p = page(
    '<textarea id="search-input-ai"></textarea><button aria-label="搜索"></button>' + cards,
  );
  try {
    const o = await p.fn({ action: 'inspect' });
    const guard = { document: o.document, origin: o.origin };
    const query = '合成查询';
    await p.fn({ action: 'search_start', query, guard });
    p.w.history.pushState(
      {},
      '',
      '/search_result_ai?keyword=' + encodeURIComponent(encodeURIComponent(query)),
    );
    assert.equal((await p.fn({ action: 'search_result', query, limit: 3, guard })).pending, true);
    p.w.document.querySelector('.note-item a').textContent = 'new result';
    assert.equal(
      (await p.fn({ action: 'search_result', query, limit: 3, guard })).results.length,
      1,
    );
    p.w.history.pushState({}, '', '?keyword=' + encodeURIComponent(encodeURIComponent('另一查询')));
    assert.equal((await p.fn({ action: 'search_result', query, limit: 3, guard })).pending, true);
  } finally {
    p.close();
  }
});
test('同一卡片封面标题链接消歧，重复卡片与外站链接拒绝点击', async () => {
  const note = '0123456789abcdef01234567';
  const card = `<section class="note-item"><a class="cover" href="/search_result/${note}">cover</a><a class="title" href="/search_result/${note}">title</a></section>`;
  for (const [body, success] of [
    [card, true],
    [card + card, false],
    [
      `<section class="note-item"><a href="https://example.com/explore/${note}">external</a></section>`,
      false,
    ],
  ] as const) {
    const p = page(body);
    try {
      let clicks = 0;
      for (const a of p.w.document.querySelectorAll('a'))
        a.onclick = (e: Event) => {
          e.preventDefault();
          clicks++;
        };
      const o = await p.fn({ action: 'inspect' });
      const r = await p.fn({
        action: 'note_open',
        note_id: note,
        guard: { document: o.document, origin: o.origin },
      });
      assert.equal(r.opened, success ? true : undefined);
      assert.equal(clicks, success ? 1 : 0);
      if (!success) assert.equal(r.bridge_error, 'UI_CHANGED');
    } finally {
      p.close();
    }
  }
});
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
test('笔记路由先更新时等待正文挂载，重复正文拒绝读取', async () => {
  const p = page('');
  try {
    const note = '0123456789abcdef01234567';
    p.w.history.pushState({}, '', '/explore/' + note);
    const o = await p.fn({ action: 'inspect' });
    const args = {
      action: 'note_read',
      note_id: note,
      comment_limit: 0,
      guard: { document: o.document, origin: o.origin },
    };
    assert.equal((await p.fn(args)).pending, true);
    p.w.document.body.innerHTML = '<div id="detail-desc">合成正文</div>';
    assert.equal((await p.fn(args)).body, '合成正文');
    p.w.document.body.innerHTML += '<div data-testid="note-body">另一正文</div>';
    assert.equal((await p.fn(args)).bridge_error, 'UI_CHANGED');
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
test('旧卡片点赞、图片或属性变化不冒充新搜索结果', async () => {
  const p = page(
    '<input id="search-input"><button aria-label="搜索"></button><section class="note-item"><a href="/explore/0123456789abcdef01234567">old result</a><span class="likes">8</span><img src="old.png"></section>',
  );
  try {
    const o = await p.fn({ action: 'inspect' });
    const guard = { document: o.document, origin: o.origin };
    await p.fn({ action: 'search_start', query: 'new query', guard });
    p.w.history.pushState({}, '', '?keyword=new%20query');
    p.w.document.querySelector('.likes').textContent = '9';
    p.w.document.querySelector('img').src = 'loaded.png';
    p.w.document.querySelector('.note-item').dataset.loaded = 'true';
    assert.equal(
      (await p.fn({ action: 'search_result', query: 'new query', limit: 3, guard })).pending,
      true,
    );
    p.w.document.querySelector('.note-item a').textContent = 'new result';
    assert.equal(
      (await p.fn({ action: 'search_result', query: 'new query', limit: 3, guard })).results.length,
      1,
    );
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
