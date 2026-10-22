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
      await this.poll(
        b,
        { action: 'search_start', query: a.query, request_id: a.client_request_id },
        check,
      );
      checkpoint('instagram_search_submitted');
      return this.poll(
        b,
        {
          action: 'search_result',
          query: a.query,
          limit: a.limit,
          request_id: a.client_request_id,
        },
        check,
      );
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
