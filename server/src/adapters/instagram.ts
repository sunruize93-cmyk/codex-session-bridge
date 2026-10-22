import { BrowserAdapter } from './browser.js';
import { instagramProgram } from './instagram-program.js';
import { BridgeError, type Binding, type Operation } from '../model.js';
export class InstagramAdapter extends BrowserAdapter {
  constructor(root: string) {
    super(root, 'instagram_web', instagramProgram);
  }
  override async execute(
    tool: string,
    a: any,
    b: Binding,
    checkpoint: (s: string) => void,
    check: () => void,
  ) {
    if (b.channel !== 'instagram_web') throw new BridgeError('CHANNEL_MISMATCH');
    check();
    if (tool === 'ig_search') {
      const snapshot = await this.program(b, {
        action: 'search_start',
        query: a.query,
        request_id: a.client_request_id,
      });
      const url = new URL(snapshot.navigation_url);
      checkpoint('instagram_search_snapshot_ready');
      if (
        !['https://www.instagram.com', 'https://instagram.com'].includes(url.origin) ||
        url.pathname !== '/explore/search/keyword/' ||
        url.searchParams.get('q') !== a.query
      )
        throw new BridgeError('TARGET_CHANGED');
      check();
      let navigationUnknown = false;
      try {
        const navigated = await this.command('navigate', {
          session: b.session,
          contextId: b.profile,
          page: b.target,
          url: url.href,
        });
        if (navigated.page !== b.target) throw new BridgeError('TARGET_CHANGED');
      } catch (e) {
        if (!(e instanceof BridgeError) || e.backend_code !== 'command_result_unknown') throw e;
        navigationUnknown = true;
      }
      checkpoint('instagram_search_navigated');
      const result = await this.poll(
        b,
        {
          action: 'search_result',
          query: a.query,
          limit: a.limit,
          request_id: a.client_request_id,
          snapshot,
        },
        check,
      );
      return { ...result, ...(navigationUnknown ? { navigation_reconciled: true } : {}) };
    }
    if (tool === 'ig_read_post') {
      await this.program(b, { action: 'post_open', post_url: a.post_url });
      checkpoint('instagram_post_opened');
      return this.poll(b, { action: 'post_read', post_url: a.post_url }, check);
    }
    throw new BridgeError('INSTAGRAM_READ_ONLY');
  }
  override async prepare(
    _kind: Operation['kind'],
    _payload: any,
    _b: Binding,
    _check: () => void,
  ): Promise<any> {
    throw new BridgeError('INSTAGRAM_READ_ONLY');
  }
  override async dispatch(_op: Operation, _b: Binding, _check: () => void): Promise<any> {
    throw new BridgeError('INSTAGRAM_READ_ONLY');
  }
  override async reconcile(_op: Operation, _b: Binding): Promise<any> {
    throw new BridgeError('INSTAGRAM_READ_ONLY');
  }
}
