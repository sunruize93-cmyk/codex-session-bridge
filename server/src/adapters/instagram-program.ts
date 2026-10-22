// Fixed rendered-DOM program. It never reads cookies, storage, private APIs or page app state.
export async function instagramProgram(p: any): Promise<any> {
  try {
    if (!['inspect', 'search_start', 'search_result', 'post_open', 'post_read'].includes(p.action))
      throw new Error('INSTAGRAM_READ_ONLY');
    const origins = ['https://www.instagram.com', 'https://instagram.com'];
    if (!origins.includes(location.origin)) throw new Error('TARGET_CHANGED');
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.visibility !== 'hidden' &&
        s.display !== 'none' &&
        !e.closest('[hidden],[aria-hidden="true"]')
      );
    };
    const list = (selector: string, root: ParentNode = document) =>
      Array.from(root.querySelectorAll(selector)).filter(visible) as HTMLElement[];
    const text = (e: Element) => (e.textContent || '').trim();
    const renderedText = (e: Element): string => {
      const visit = (node: Element): string =>
        !visible(node)
          ? ''
          : Array.from(node.childNodes)
              .map((n) =>
                n.nodeType === Node.TEXT_NODE
                  ? n.textContent || ''
                  : n instanceof Element
                    ? n.tagName === 'BR'
                      ? '\n'
                      : visit(n)
                    : '',
              )
              .join('');
      return visit(e).trim();
    };
    const parsePost = (raw: string) => {
      try {
        const u = new URL(raw, location.href);
        const m = u.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]{1,64})\/$/);
        if (!origins.includes(u.origin) || u.username || u.password || !m) return undefined;
        return {
          shortcode: m[2],
          kind: m[1],
          post_url: `https://www.instagram.com/${m[1]}/${m[2]}/`,
        };
      } catch {
        return undefined;
      }
    };
    const accountRaw = () => {
      const candidates = list('a[href]').filter(
        (a) =>
          ['Profile', '个人主页', '个人资料', '프로필'].includes(text(a)) ||
          !!a.querySelector(
            'svg[aria-label="Profile"],svg[aria-label="个人主页"],svg[aria-label="个人资料"],svg[aria-label="프로필"]',
          ),
      );
      const names = candidates
        .map((a) => {
          try {
            const u = new URL(a.getAttribute('href') || '', location.href);
            return origins.includes(u.origin) && !u.username && !u.password
              ? u.pathname.match(/^\/([A-Za-z0-9._]+)\/$/)?.[1]
              : undefined;
          } catch {
            return undefined;
          }
        })
        .filter(Boolean);
      return names.length === 1 ? names[0] : undefined;
    };
    const blocker = () => {
      if (
        /^\/(challenge|checkpoint)\//.test(location.pathname) ||
        list('iframe[src*="captcha"], [data-testid="captcha"]').length
      )
        return 'HUMAN_VERIFICATION_REQUIRED';
      if (location.pathname.startsWith('/accounts/login') || list('input[type="password"]').length)
        return 'AUTH_REQUIRED';
      for (const dialog of list('[role="dialog"], [role="alert"]')) {
        const outsideArticle = (node: Node): string =>
          node.nodeType === Node.TEXT_NODE
            ? node.textContent || ''
            : node instanceof Element &&
                (!visible(node) || node.matches('article,[data-testid="post-caption"]'))
              ? ''
              : Array.from(node.childNodes).map(outsideArticle).join('');
        const t = outsideArticle(dialog);
        if (/确认.*身份|安全验证|security check|confirm.*identity/i.test(t))
          return 'HUMAN_VERIFICATION_REQUIRED';
        if (/请稍后重试|Try again later/i.test(t)) return 'POLICY_LIMITED';
        if (/登录|Log in/i.test(t) && list('a[href*="/accounts/login"]', dialog).length)
          return 'AUTH_REQUIRED';
      }
      return undefined;
    };
    const w = window as any;
    const state =
      w.__codexInstagramBridge || (w.__codexInstagramBridge = { document: crypto.randomUUID() });
    const raw = accountRaw();
    const account = raw
      ? Array.from(
          new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(raw))),
          ),
        )
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')
      : undefined;
    // Re-read synchronously after every await; never act on a stale account/overlay.
    const guard = () => {
      if (!origins.includes(location.origin)) throw new Error('TARGET_CHANGED');
      const block = blocker();
      if (block) throw new Error(block);
      if (raw !== accountRaw()) throw new Error('ACCOUNT_MISMATCH');
      if (p.deadline && Date.now() > p.deadline) throw new Error('TIMEOUT_BEFORE_DISPATCH');
      if (p.guard && (p.guard.document !== state.document || p.guard.origin !== location.origin))
        throw new Error('TARGET_CHANGED');
      if (p.guard?.account && p.guard.account !== account) throw new Error('ACCOUNT_MISMATCH');
    };
    if (p.action === 'inspect')
      return {
        document: state.document,
        origin: location.origin,
        account,
        blocker: blocker(),
        evidence: { source: 'instagram_visible_dom', partial: true },
      };
    guard();
    const main = () => {
      const roots = list('main, [role="main"]');
      if (roots.length !== 1) throw new Error('UI_CHANGED');
      return roots[0];
    };
    const cards = () => {
      const seen = new Set<string>();
      return list('a[href]', main()).flatMap((a) => {
        const post = parsePost(a.getAttribute('href') || '');
        if (!post || seen.has(post.post_url)) return [];
        seen.add(post.post_url);
        const img = list('img[alt]', a)[0];
        return [
          {
            type: 'post',
            ...post,
            preview: (img?.getAttribute('alt') || renderedText(a)).slice(0, 500),
          },
        ];
      });
    };
    const searchFields = () =>
      list(
        'input[aria-label="搜索输入"], input[aria-label="Search input"], input[placeholder="搜索"], input[placeholder="Search"]',
      ) as HTMLInputElement[];
    if (p.action === 'search_start') {
      if (typeof p.request_id !== 'string' || !p.request_id) throw new Error('UI_CHANGED');
      const fields = searchFields();
      if (!fields.length) {
        if (state.openingSearch !== p.request_id) {
          const links = list('a[href]').filter((a) => {
            try {
              const u = new URL(a.getAttribute('href') || '', location.href);
              return (
                origins.includes(u.origin) &&
                u.pathname === '/explore/' &&
                /^(搜索|Search)$/.test(text(a))
              );
            } catch {
              return false;
            }
          });
          if (links.length !== 1) throw new Error('UI_CHANGED');
          guard();
          state.openingSearch = p.request_id;
          links[0].click();
        }
        return { pending: true };
      }
      if (fields.length !== 1 || fields[0].disabled || fields[0].readOnly)
        throw new Error('UI_CHANGED');
      const field = fields[0];
      const buttons = list('button,[role="button"]', field.parentElement!).filter(
        (b) =>
          /^(搜索|Search)$/.test(text(b)) ||
          !!b.querySelector('svg[aria-label="搜索"],svg[aria-label="Search"]'),
      );
      if (buttons.length !== 1) throw new Error('UI_CHANGED');
      const query = String(p.query);
      if (
        state.search?.request_id === p.request_id &&
        state.search.submitted &&
        state.search.query === query &&
        field.value === query
      )
        return { submitted: true };
      state.search = {
        request_id: p.request_id,
        query,
        old: JSON.stringify(cards().map((c) => c.post_url)),
        submitted: false,
      };
      guard();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, query);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      guard();
      const freshFields = searchFields();
      if (
        freshFields.length !== 1 ||
        freshFields[0] !== field ||
        field.disabled ||
        field.readOnly ||
        !field.isConnected ||
        field.value !== query
      )
        throw new Error('UI_CHANGED');
      state.search.submitted = true;
      field.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
        }),
      );
      field.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
        }),
      );
      return { submitted: true };
    }
    if (p.action === 'search_result') {
      const fields = searchFields();
      if (
        !state.search ||
        state.search.request_id !== p.request_id ||
        state.search.query !== p.query ||
        fields.length !== 1 ||
        fields[0].value !== p.query
      )
        throw new Error('UI_CHANGED');
      const url = new URL(location.href);
      if (url.pathname !== '/explore/search/keyword/' || url.searchParams.get('q') !== p.query)
        return { pending: true };
      const results = cards();
      if (!results.length || JSON.stringify(results.map((c) => c.post_url)) === state.search.old)
        return { pending: true };
      return {
        query: p.query,
        results: results.slice(0, Math.min(p.limit || 3, 10)),
        source: 'instagram_visible_dom',
        partial: true,
        observed_at: Date.now(),
      };
    }
    const desired = parsePost(p.post_url);
    if (
      !desired ||
      desired.post_url !==
        p.post_url.replace('https://instagram.com/', 'https://www.instagram.com/')
    )
      throw new Error('INVALID_POST_URL');
    const current = parsePost(location.href);
    if (p.action === 'post_open') {
      if (current?.post_url === desired.post_url) return { opened: true };
      const links = list('a[href]', main()).filter(
        (a) => parsePost(a.getAttribute('href') || '')?.post_url === desired.post_url,
      );
      if (links.length !== 1) throw new Error('POST_NOT_VISIBLE');
      guard();
      links[0].click();
      return { opened: true };
    }
    if (current?.post_url !== desired.post_url) return { pending: true };
    const articles = list('article');
    if (!articles.length) return { pending: true };
    if (articles.length !== 1) throw new Error('UI_CHANGED');
    const permalink = list('a[href]', articles[0])
      .filter((a) => list('time[datetime]', a).length > 0)
      .map((a) => parsePost(a.getAttribute('href') || '')?.post_url)
      .filter(Boolean);
    if (permalink.length !== 1 || permalink[0] !== desired.post_url) return { pending: true };
    const captions = list('h1, [data-testid="post-caption"]', articles[0]);
    if (!captions.length) return { pending: true };
    if (captions.length !== 1) throw new Error('UI_CHANGED');
    const caption = renderedText(captions[0]);
    if (!caption) throw new Error('POST_TEXT_UNAVAILABLE');
    guard();
    return {
      ...desired,
      caption: caption.slice(0, 20000),
      source: 'instagram_visible_dom',
      partial: true,
      comments: [],
      observed_at: Date.now(),
    };
  } catch (e) {
    const code = (e as Error).message;
    const known = [
      'INSTAGRAM_READ_ONLY',
      'TARGET_CHANGED',
      'ACCOUNT_MISMATCH',
      'AUTH_REQUIRED',
      'HUMAN_VERIFICATION_REQUIRED',
      'POLICY_LIMITED',
      'UI_CHANGED',
      'TIMEOUT_BEFORE_DISPATCH',
      'INVALID_POST_URL',
      'POST_NOT_VISIBLE',
      'POST_TEXT_UNAVAILABLE',
    ];
    return { bridge_error: known.includes(code) ? code : 'UI_CHANGED' };
  }
}
