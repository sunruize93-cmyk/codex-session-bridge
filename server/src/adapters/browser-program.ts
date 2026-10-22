// 固定页面程序。所有外部参数只通过 JSON 数据传入；返回文本仍属于不可信来源。
export async function browserProgram(p: any): Promise<any> {
  try {
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const list = (s: string) =>
      Array.from(document.querySelectorAll(s)).filter(visible) as HTMLElement[];
    const one = (s: string) => {
      const es = list(s);
      if (es.length !== 1) throw new Error('UI_CHANGED');
      return es[0];
    };
    const value = (e: any) => String(e.value ?? e.innerText ?? '');
    const searchField = () => {
      const fields = list(
        'input#search-input, input[placeholder="搜索小红书"], textarea#search-input-ai, textarea#search-input-in-feeds',
      ).filter(
        (e) =>
          e.getAttribute('aria-hidden') !== 'true' &&
          !(e as HTMLInputElement).disabled &&
          !(e as HTMLInputElement).readOnly,
      );
      if (fields.length !== 1) throw new Error('UI_CHANGED');
      return fields[0];
    };
    const noteLinkId = (el: Element) => {
      try {
        const url = new URL(el.getAttribute('href') || '', location.href);
        if (url.origin !== 'https://www.xiaohongshu.com') return undefined;
        return url.pathname.match(
          /^\/(?:explore|search_result|note|discovery\/item)\/([a-f0-9]{24})\/?$/,
        )?.[1];
      } catch {
        return undefined;
      }
    };
    const readAccount = () => {
      const links = list(
        'a.user[href*="/user/profile/"], .user a[href*="/user/profile/"], .side-bar a[href*="/user/profile/"]',
      );
      return links.length === 1
        ? links[0].getAttribute('href')?.match(/\/user\/profile\/([a-f0-9]{24})/)?.[1]
        : undefined;
    };
    const blocked = () =>
      location.pathname.startsWith('/website-login/captcha') ||
      list(
        '.captcha-container, #captcha, [role="dialog"][aria-label*="验证"], iframe[src*="captcha"], .verify-modal',
      ).length > 0
        ? 'HUMAN_VERIFICATION_REQUIRED'
        : list('.login-container, .login-modal, .qrcode-login, #login-btn').length > 0
          ? 'AUTH_REQUIRED'
          : undefined;
    const account = readAccount();
    const w = window as any;
    const documentKey = '__codexSessionBridgeDocument';
    if (!w[documentKey]) w[documentKey] = crypto.randomUUID();
    const accountHash = account
      ? Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(JSON.stringify(account)),
            ),
          ),
        )
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('')
      : undefined;
    const observation = {
      origin: location.origin,
      account: accountHash,
      document: w[documentKey],
      blocker: blocked(),
    };
    if (readAccount() !== account) throw new Error('TARGET_CHANGED');
    if (p.action === 'inspect') return observation;
    if (observation.blocker) throw new Error(observation.blocker);
    if (
      p.guard?.document !== w[documentKey] ||
      p.guard?.origin !== location.origin ||
      (p.guard?.account && p.guard.account !== accountHash)
    )
      throw new Error('TARGET_CHANGED');
    const fresh = () => {
      if (
        Date.now() > p.deadline ||
        readAccount() !== account ||
        p.guard?.document !== w[documentKey] ||
        p.guard?.origin !== location.origin
      )
        throw new Error('TARGET_CHANGED');
      const reason = blocked();
      if (reason) throw new Error(reason);
    };
    fresh();
    const set = (el: any, text: string) => {
      fresh();
      if (el.isContentEditable) {
        el.textContent = text;
        el.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
        );
      } else {
        const proto =
          el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (value(el) !== text) throw new Error('UI_CHANGED');
    };
    const noteId = () =>
      location.pathname.match(
        /\/(?:explore|search_result|note|discovery\/item)\/([a-f0-9]{24})/,
      )?.[1] ||
      list('.note-detail-mask a[href*="/explore/"]')
        .map((e) => e.getAttribute('href')?.match(/\/explore\/([a-f0-9]{24})/)?.[1])
        .find(Boolean);
    const buttons = (label: string) =>
      list('button,[role="button"],.publishBtn').filter(
        (e) => e.innerText.trim() === label && !(e as HTMLButtonElement).disabled,
      );
    const press = (label: string) => {
      fresh();
      const b = buttons(label);
      if (b.length !== 1) throw new Error('UI_CHANGED');
      b[0].click();
    };
    if (p.action === 'search_start') {
      const field = searchField();
      set(field, p.query);
      const old = list('section.note-item, .note-item, [data-testid="note-card"]');
      w.__csbSearch = { query: p.query, old: old.map((e) => e.outerHTML).join(''), changed: false };
      const observer = new MutationObserver((records) => {
        if (
          records.some((r) =>
            Array.from(r.addedNodes)
              .concat(Array.from(r.removedNodes))
              .some(
                (n) =>
                  n instanceof Element &&
                  (n.matches('section.note-item,.note-item,[data-testid="note-card"]') ||
                    n.querySelector('section.note-item,.note-item,[data-testid="note-card"]')),
              ),
          )
        )
          w.__csbSearch.changed = true;
      });
      observer.observe(document.body, { childList: true, subtree: true });
      w.__csbObserver?.disconnect();
      w.__csbObserver = observer;
      const primary = list('.search-icon');
      const modernBox = field.closest('.search-box-in-content, .search-area-in-header');
      const modern = modernBox
        ? Array.from(modernBox.querySelectorAll<HTMLElement>('.submit-button-wrapper')).filter(
            visible,
          )
        : [];
      const submit = modernBox
        ? modern
        : primary.length
          ? primary
          : list('.input-button, button[aria-label="搜索"]');
      if (
        submit.length !== 1 ||
        (submit[0] as HTMLButtonElement).disabled ||
        submit[0].getAttribute('aria-disabled') === 'true'
      )
        throw new Error('UI_CHANGED');
      fresh();
      submit[0].click();
      return { submitted: true };
    }
    if (p.action === 'search_result') {
      const state = w.__csbSearch;
      const field = searchField();
      const cards = list('section.note-item, .note-item, [data-testid="note-card"]');
      const rawKeyword = new URL(location.href).searchParams.get('keyword');
      let keywordMatches = rawKeyword === p.query;
      if (!keywordMatches && rawKeyword !== null) {
        try {
          keywordMatches = decodeURIComponent(rawKeyword) === p.query;
        } catch {}
      }
      if (
        !state ||
        state.query !== p.query ||
        value(field) !== p.query ||
        !keywordMatches ||
        cards.map((e) => e.outerHTML).join('') === state.old
      )
        return { pending: true };
      const results = cards
        .map((e) => {
          const a = Array.from(e.querySelectorAll('a[href]')).find(noteLinkId);
          return {
            note_id: a && noteLinkId(a),
            title: (e.querySelector('.title')?.textContent || e.textContent || '')
              .trim()
              .slice(0, 500),
          };
        })
        .filter((x) => x.note_id)
        .slice(0, p.limit);
      if (!results.length) return { pending: true };
      return {
        query: p.query,
        results,
        partial: true,
        source: 'visible_dom',
        observed_at: new Date().toISOString(),
      };
    }
    if (p.action === 'note_open') {
      if (noteId() === p.note_id) return { opened: true };
      const links = list('a[href]').filter((e) => noteLinkId(e) === p.note_id);
      const cardSelector = 'section.note-item, .note-item, [data-testid="note-card"]';
      const card = links[0]?.closest(cardSelector);
      if (
        !links.length ||
        (links.length > 1 && (!card || links.some((e) => e.closest(cardSelector) !== card)))
      )
        throw new Error('UI_CHANGED');
      const covers = links.filter((e) => e.matches('.cover'));
      if (covers.length > 1) throw new Error('UI_CHANGED');
      const a = covers[0] || links[0];
      fresh();
      a.click();
      return { opened: true };
    }
    if (p.action === 'note_read') {
      if (noteId() !== p.note_id) return { pending: true };
      const bodies = list('#detail-desc, .note-scroller .desc, [data-testid="note-body"]');
      if (!bodies.length) return { pending: true };
      if (bodies.length !== 1) throw new Error('UI_CHANGED');
      const body = bodies[0];
      return {
        note_id: p.note_id,
        title: list('#detail-title,.note-scroller .title')[0]?.textContent?.trim() || '',
        body: body.innerText.slice(0, 30000),
        comments: list('.comment-item .content')
          .slice(0, p.comment_limit)
          .map((e) => e.innerText.slice(0, 3000)),
        partial: true,
        source: 'visible_dom',
        observed_at: new Date().toISOString(),
      };
    }
    if (p.action === 'prepare_comment') {
      if (noteId() !== p.note_id) throw new Error('TARGET_CHANGED');
      const field = one(
        '.comment-input [contenteditable="true"], textarea.comment-input, #content-textarea',
      );
      set(field, p.body);
      return {
        target_ref: p.note_id,
        preview: { note_id: p.note_id, body: value(field) },
        checkpoint: {
          before_ids: list('.comment-item[id],.comment-item[data-comment-id]').map(
            (e) => e.getAttribute('data-comment-id') || e.id,
          ),
        },
      };
    }
    if (p.action === 'prepare_post') {
      if (location.origin !== 'https://creator.xiaohongshu.com') throw new Error('TARGET_CHANGED');
      set(one('input[placeholder*="标题"]'), p.title);
      set(one('.tiptap[contenteditable="true"],.ql-editor[contenteditable="true"]'), p.body);
      const images = list('.img-preview-area img, .upload-img-item img');
      if (images.length !== p.image_count) throw new Error('UI_CHANGED');
      return {
        target_ref: 'creator_post',
        preview: { title: p.title, body: p.body, image_count: images.length },
        checkpoint: {
          image_sources: images.map((e) => (e as HTMLImageElement).src),
          before_ids: list('.publish-success [data-note-id]').map((e) =>
            e.getAttribute('data-note-id'),
          ),
        },
      };
    }
    if (p.action === 'dispatch') {
      if (!p.operation_id || !p.payload_digest) throw new Error('PAYLOAD_CHANGED');
      w.__csbReceipts ||= {};
      if (w.__csbReceipts[p.operation_id]) return { dispatched: true };
      const before =
        p.kind === 'comment'
          ? list('.comment-item[id],.comment-item[data-comment-id]').map(
              (e) => e.getAttribute('data-comment-id') || e.id,
            )
          : list('.publish-success [data-note-id]').map((e) => e.getAttribute('data-note-id'));
      // 以下预检和点击之间没有 await，用户输入不能插入同一 JS turn。

      if (p.kind === 'comment') {
        if (
          noteId() !== p.note_id ||
          value(
            one('.comment-input [contenteditable="true"],textarea.comment-input,#content-textarea'),
          ) !== p.body
        )
          throw new Error('PAYLOAD_CHANGED');
        press('发送');
      } else {
        if (
          location.origin !== 'https://creator.xiaohongshu.com' ||
          value(one('input[placeholder*="标题"]')) !== p.title ||
          value(one('.tiptap[contenteditable="true"],.ql-editor[contenteditable="true"]')) !==
            p.body ||
          JSON.stringify(
            list('.img-preview-area img,.upload-img-item img').map(
              (e) => (e as HTMLImageElement).src,
            ),
          ) !== JSON.stringify(p.prepared?.image_sources)
        )
          throw new Error('PAYLOAD_CHANGED');
        press('发布');
      }
      const receipt: any = {
        operation_id: p.operation_id,
        payload_digest: p.payload_digest,
        document: w[documentKey],
        account: accountHash,
        confirmed: false,
      };
      w.__csbReceipts[p.operation_id] = receipt;
      // 仅允许同一次点击的同步/微任务 UI 回执；不把日后加载的历史内容当回执。
      await Promise.resolve();
      fresh();
      if (p.kind === 'comment') {
        if (noteId() !== p.note_id) throw new Error('TARGET_CHANGED');
        const matches = list('.comment-item[id],.comment-item[data-comment-id]').filter((e) => {
          const key = e.getAttribute('data-comment-id') || e.id;
          const author = e
            .querySelector('a[href*="/user/profile/"]')
            ?.getAttribute('href')
            ?.match(/\/user\/profile\/([a-f0-9]{24})/)?.[1];
          return (
            key &&
            !before.includes(key) &&
            author === account &&
            e.querySelector('.content')?.textContent?.trim() === p.body
          );
        });
        if (matches.length === 1)
          Object.assign(receipt, {
            confirmed: true,
            confirmation: 'ui_only',
            comment_id: matches[0].getAttribute('data-comment-id') || matches[0].id,
          });
      } else {
        const matches = list('.publish-success [data-note-id]').filter((e) => {
          const key = e.getAttribute('data-note-id');
          return (
            key &&
            /^[a-f0-9]{24}$/.test(key) &&
            !before.includes(key) &&
            e.getAttribute('data-title') === p.title
          );
        });
        if (matches.length === 1)
          Object.assign(receipt, {
            confirmed: true,
            confirmation: 'ui_only',
            note_id: matches[0].getAttribute('data-note-id'),
          });
      }
      return { dispatched: true };
    }
    if (p.action === 'reconcile') {
      const receipt = w.__csbReceipts?.[p.operation_id];
      if (
        !receipt ||
        receipt.payload_digest !== p.payload_digest ||
        receipt.document !== w[documentKey] ||
        receipt.account !== accountHash
      )
        return { confirmed: false, reason: '缺少可归属于本次点击的回执' };
      return receipt.confirmed
        ? {
            confirmed: true,
            confirmation: 'ui_only',
            comment_id: receipt.comment_id,
            note_id: receipt.note_id,
          }
        : { confirmed: false, reason: '点击后未捕获可靠界面回执' };
    }
    throw new Error('UNSUPPORTED_ACTION');
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    return {
      bridge_error: [
        'UI_CHANGED',
        'TARGET_CHANGED',
        'HUMAN_VERIFICATION_REQUIRED',
        'AUTH_REQUIRED',
        'PAYLOAD_CHANGED',
        'UNSUPPORTED_ACTION',
      ].includes(code)
        ? code
        : 'UI_CHANGED',
    };
  }
}
