import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  BridgeError,
  hash,
  type Adapter,
  type Binding,
  type Operation,
  type Observation,
} from '../model.js';
import { secureDir, statePath } from '../store.js';
export class WechatAdapter implements Adapter {
  constructor(public root: string) {}
  async worker(input: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const fd = Number(process.env.SESSION_BRIDGE_LOCK_FD);
      const inherited = Number.isInteger(fd) && fd >= 3;
      // AX 工作者继承锁，Node 意外退出时仍阻止新执行者，直至旧工作者结束。
      const child = spawn(
        join(this.root, 'wechat-worker/.venv/bin/python'),
        [join(this.root, 'wechat-worker/worker.py')],
        {
          stdio: inherited ? ['pipe', 'pipe', 'pipe', fd] : ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, SESSION_BRIDGE_LOCK_FD: inherited ? '3' : '' },
          shell: false,
        },
      );
      let output = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, 12000);
      child.stdout!.on('data', (d) => {
        output += d;
        if (output.length > 262144) {
          child.kill('SIGKILL');
        }
      });
      child.stderr!.resume();
      child.on('error', () => {
        clearTimeout(timer);
        reject(new BridgeError('WORKER_NOT_INSTALLED'));
      });
      child.on('close', () => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new BridgeError('TIMEOUT_BEFORE_DISPATCH'));
          return;
        }
        try {
          const r = JSON.parse(output);
          if (r.ok) resolve(r.data);
          else reject(new BridgeError(r.error));
        } catch {
          reject(new BridgeError('WECHAT_AX_UNAVAILABLE'));
        }
      });
      child.stdin!.end(JSON.stringify({ ...input, deadline: Date.now() + 10000 }));
    });
  }
  async doctor() {
    if (process.platform !== 'darwin')
      return { channel: 'wechat_macos', status: 'unsupported', error: 'UNSUPPORTED_PLATFORM' };
    try {
      return await this.worker({ action: 'doctor' });
    } catch (e) {
      return {
        channel: 'wechat_macos',
        status: 'unavailable',
        error: e instanceof BridgeError ? e.code : 'WECHAT_AX_UNAVAILABLE',
      };
    }
  }
  async bind(a: any) {
    const screen = a.read_only_backend === 'screen';
    const o = await this.worker({
      action: 'bind',
      ...(screen ? { backend: 'screen-readonly', screen_chat_name: a.expected_chat } : {}),
    });
    if (o.blocker) throw new BridgeError(o.blocker);
    if (a.expected_account && o.account !== hash(a.expected_account))
      throw new BridgeError('ACCOUNT_MISMATCH');
    if (!o.account && !a.user_bound) throw new BridgeError('ACCOUNT_UNVERIFIED');
    return {
      channel: 'wechat_macos' as const,
      backend: screen ? 'screen-readonly' : 'native-ax',
      backend_version: '0.1.0',
      connection: o.connection,
      target: o.target,
      account: o.account,
      assurance: o.account ? ('verified' as const) : ('user_bound' as const),
      ...(screen
        ? {
            screen_chat_name: a.expected_chat,
            screen_chat_ref: hashScreenRef(o.target, a.expected_chat),
          }
        : {}),
    };
  }
  async inspect(b: Binding): Promise<Observation> {
    return this.worker({ action: 'inspect', binding: b });
  }
  async execute(
    tool: string,
    a: any,
    b: Binding,
    _checkpoint: (s: string) => void,
    check: () => void,
  ) {
    check();
    if (tool === 'wechat_find_chat')
      return this.worker({ action: 'find_chat', name: a.name, binding: b });
    if (tool === 'wechat_read_messages')
      return this.worker({ action: 'read', chat_ref: a.chat_ref, limit: a.limit, binding: b });
    throw new BridgeError('UNSUPPORTED_TOOL');
  }
  async prepare(kind: Operation['kind'], payload: any, b: Binding, check: () => void) {
    if (b.backend === 'screen-readonly') throw new BridgeError('SCREEN_MODE_READ_ONLY');
    if (kind !== 'message') throw new BridgeError('UNSUPPORTED_TOOL');
    check();
    return this.worker({ action: 'prepare', ...payload, binding: b });
  }
  receipt(op: Operation) {
    const dir = join(statePath(), 'receipts');
    secureDir(dir);
    return {
      operation_id: op.operation_id,
      payload_digest: op.digest,
      receipt_path: join(dir, op.operation_id + '.json'),
    };
  }
  async dispatch(op: Operation, b: Binding, check: () => void) {
    if (b.backend === 'screen-readonly') throw new BridgeError('SCREEN_MODE_READ_ONLY');
    check();
    return this.worker({
      action: 'dispatch',
      ...op.payload,
      prepared: op.prepared,
      ...this.receipt(op),
      binding: b,
    });
  }
  async reconcile(op: Operation, b: Binding) {
    if (b.backend === 'screen-readonly') throw new BridgeError('SCREEN_MODE_READ_ONLY');
    return this.worker({
      action: 'reconcile',
      ...op.payload,
      prepared: op.prepared,
      ...this.receipt(op),
      binding: b,
    });
  }
}
function hashScreenRef(target: string, chat: string) {
  // Match Python's insertion-ordered compact JSON; this is a read reference, not authorization.
  return createHash('sha256')
    .update(JSON.stringify({ target, chat, backend: 'screen-readonly' }))
    .digest('hex');
}
