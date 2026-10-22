import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BridgeError,
  assertObservation,
  hash,
  id,
  type Adapter,
  type Binding,
  type Operation,
  type Observation,
} from '../model.js';
import { browserProgram } from './browser-program.js';
const run = promisify(execFile);
export class BrowserAdapter implements Adapter {
  constructor(
    public root: string,
    public channel: 'xiaohongshu_web' | 'instagram_web' = 'xiaohongshu_web',
    public pageProgram = browserProgram,
  ) {}
  async upstream() {
    return import(
      pathToFileURL(
        join(this.root, 'node_modules/@jackwener/opencli/dist/src/browser/daemon-transport.js'),
      ).href
    );
  }
  async health(profile?: string) {
    const api = await this.upstream();
    const h = await api.fetchDaemonStatus({ contextId: profile, timeout: 1000 });
    if (h?.pending > 0) throw new BridgeError('RESOURCE_BUSY');
    if (!h?.extensionConnected) throw new BridgeError('BRIDGE_DISCONNECTED');
    if (h.daemonVersion !== '2.0.2' || h.extensionVersion !== '1.0.26')
      throw new BridgeError('BACKEND_VERSION_UNSUPPORTED');
    const contexts = (h.profiles || []).filter((p: any) => p.extensionConnected);
    const chosen =
      profile || h.contextId || (contexts.length === 1 ? contexts[0].contextId : undefined);
    if (!chosen || !contexts.some((p: any) => p.contextId === chosen))
      throw new BridgeError('ACCOUNT_UNVERIFIED');
    const ps = await run('/bin/ps', ['-p', String(h.pid), '-o', 'lstart=']);
    return { h, profile: chosen, connection: `${h.pid}:${ps.stdout.trim()}` };
  }
  async command(action: string, params: any) {
    const api = await this.upstream();
    let r: any;
    try {
      const response = await api.requestDaemon('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: id('cmd'),
          action,
          surface: 'browser',
          timeout: 12,
          deadlineAt: Date.now() + 12000,
          ...params,
        }),
        timeout: 14000,
      });
      r = await response.json();
    } catch {
      throw new BridgeError('BRIDGE_DISCONNECTED');
    }
    if (!r.ok) {
      const code = String(r.errorCode ?? '');
      throw new BridgeError(
        /tab_gone|target_closed|bound_tab_closed/.test(code)
          ? 'TARGET_CLOSED'
          : /profile|extension|command_lost|command_result_unknown/.test(code)
            ? 'BRIDGE_DISCONNECTED'
            : 'UI_CHANGED',
      );
    }
    return r;
  }
  async doctor() {
    try {
      const h = await this.health();
      return {
        channel: this.channel,
        status: 'connected',
        backend: 'OpenCLI',
        version: '2.0.2',
        extension: '1.0.26',
        profiles: h.h.profiles?.map((p: any) => ({
          profile: p.contextId,
          connected: p.extensionConnected,
        })),
      };
    } catch (e) {
      let profiles: any[] = [];
      try {
        const api = await this.upstream();
        const status = await api.fetchDaemonStatus({ timeout: 1000 });
        profiles = (status?.profiles || []).map((p: any) => ({
          profile: p.contextId,
          connected: p.extensionConnected,
        }));
      } catch {}
      return {
        profiles,
        channel: this.channel,
        status: 'unavailable',
        error: e instanceof BridgeError ? e.code : 'BACKEND_NOT_INSTALLED',
        required: '本地 Chrome、OpenCLI 2.0.2、Browser Bridge 1.0.26',
      };
    }
  }
  async bind(a: any) {
    const h = await this.health(a.profile);
    const session = id('csb');
    const r = await this.command('bind', { session, contextId: h.profile });
    const target = r.page || r.data?.targetId || r.data?.page;
    if (!target)
      throw new BridgeError('BACKEND_CONTRACT_UNSUPPORTED', '绑定未返回可靠的 page 标识');
    const b: any = {
      channel: this.channel,
      backend: 'OpenCLI',
      backend_version: '2.0.2',
      profile: h.profile,
      connection: h.connection,
      target,
      session,
    };
    let o: Observation;
    try {
      o = await this.inspect(b);
      assertObservation(b, o);
      if (a.expected_account && o.account !== hash(a.expected_account))
        throw new BridgeError('ACCOUNT_MISMATCH');
      if (!o.account && !a.user_bound)
        throw new BridgeError('ACCOUNT_UNVERIFIED', '无法识别账号，需要用户明确选择当前账号');
    } catch (e) {
      try {
        await this.unbind(b);
      } catch {}
      throw e;
    }
    return {
      ...b,
      account: o.account,
      assurance: o.account ? ('verified' as const) : ('user_bound' as const),
      document: o.document,
    };
  }
  async inspect(b: Binding): Promise<Observation> {
    const h = await this.health(b.profile);
    if (h.connection !== b.connection) throw new BridgeError('TARGET_CHANGED');
    const r = await this.command('exec', {
      session: b.session,
      contextId: b.profile,
      page: b.target,
      code: `(${this.pageProgram.toString()})(${JSON.stringify({ action: 'inspect' })})`,
    });
    const d = r.data;
    if (d?.bridge_error) throw new BridgeError(d.bridge_error);
    if (!d || !d.document || !r.page) throw new BridgeError('BACKEND_CONTRACT_UNSUPPORTED');
    return { ...d, account: d.account, target: r.page, connection: h.connection };
  }
  async program(b: Binding, p: any) {
    const o = await this.inspect(b);
    assertObservation(b, o);
    const guard = { document: o.document, origin: o.origin, account: b.account };
    const r = await this.command('exec', {
      session: b.session,
      contextId: b.profile,
      page: b.target,
      code: `(${this.pageProgram.toString()})(${JSON.stringify({ ...p, guard, deadline: Date.now() + 10000 })})`,
    });
    if (r.page !== b.target) throw new BridgeError('TARGET_CHANGED');
    if (r.data?.bridge_error) throw new BridgeError(r.data.bridge_error);
    return r.data;
  }
  async poll(b: Binding, p: any, check: () => void) {
    for (let attempt = 0; attempt < 8; attempt++) {
      check();
      const r = await this.program(b, p);
      if (!r?.pending) return r;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new BridgeError('UI_CHANGED', '未观察到本次动作的新结果');
  }
  async execute(
    tool: string,
    a: any,
    b: Binding,
    checkpoint: (s: string) => void,
    check: () => void,
  ) {
    check();
    if (tool === 'xhs_search') {
      await this.program(b, { action: 'search_start', query: a.query });
      checkpoint('search_submitted');
      return this.poll(b, { action: 'search_result', query: a.query, limit: a.limit }, check);
    }
    if (tool === 'xhs_read_note') {
      await this.program(b, { action: 'note_open', note_id: a.note_id });
      checkpoint('note_opened');
      return this.poll(
        b,
        { action: 'note_read', note_id: a.note_id, comment_limit: a.comment_limit },
        check,
      );
    }
    throw new BridgeError('UNSUPPORTED_TOOL');
  }
  async prepare(kind: Operation['kind'], payload: any, b: Binding, check: () => void) {
    if (b.assurance !== 'verified') throw new BridgeError('ACCOUNT_UNVERIFIED');
    check();
    if (kind === 'comment') return this.program(b, { action: 'prepare_comment', ...payload });
    if (kind !== 'post') throw new BridgeError('UNSUPPORTED_TOOL');
    const fileDigests: string[] = [];
    for (const file of payload.images) {
      if (!file.startsWith('/')) throw new BridgeError('INVALID_FILE');
      const s = await stat(file);
      if (!s.isFile() || s.size > 20 * 1024 * 1024) throw new BridgeError('INVALID_FILE');
      const bytes = await readFile(file);
      fileDigests.push(hash(bytes.toString('base64')));
      if (
        !(
          (bytes[0] === 0xff && bytes[1] === 0xd8) ||
          (bytes[0] === 137 && bytes.subarray(1, 4).toString() === 'PNG')
        )
      )
        throw new BridgeError('INVALID_FILE');
    }
    const o = await this.inspect(b);
    assertObservation(b, o);
    if (o.origin !== 'https://creator.xiaohongshu.com')
      throw new BridgeError('TARGET_CHANGED', '请用户在绑定标签页打开创作中心，再重新核验账号');
    check();
    await this.command('set-file-input', {
      session: b.session,
      contextId: b.profile,
      page: b.target,
      selector: 'input[type=file]',
      files: payload.images,
    });
    const result = await this.program(b, {
      action: 'prepare_post',
      ...payload,
      image_count: payload.images.length,
    });
    const after = await Promise.all(
      payload.images.map(async (file: string) => hash((await readFile(file)).toString('base64'))),
    );
    if (JSON.stringify(after) !== JSON.stringify(fileDigests))
      throw new BridgeError('PAYLOAD_CHANGED');
    result.checkpoint.files = fileDigests;
    return result;
  }
  async dispatch(op: Operation, b: Binding, check: () => void) {
    check();
    if (op.kind === 'post') {
      const files = await Promise.all(
        op.payload.images.map(async (file: string) =>
          hash((await readFile(file)).toString('base64')),
        ),
      );
      if (JSON.stringify(files) !== JSON.stringify(op.prepared?.files))
        throw new BridgeError('PAYLOAD_CHANGED');
    }
    await this.program(b, {
      action: 'dispatch',
      kind: op.kind,
      ...op.payload,
      prepared: op.prepared,
      operation_id: op.operation_id,
      payload_digest: op.digest,
      image_count: op.payload.images?.length,
    });
    return this.reconcile(op, b);
  }
  async reconcile(op: Operation, b: Binding) {
    return this.program(b, {
      action: 'reconcile',
      kind: op.kind,
      ...op.payload,
      prepared: op.prepared,
      operation_id: op.operation_id,
      payload_digest: op.digest,
    });
  }
  async unbind(b: Binding) {
    await this.command('close-window', { session: b.session, contextId: b.profile });
  }
}
