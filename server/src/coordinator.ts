import {
  BridgeError,
  assertObservation,
  hash,
  id,
  now,
  type Adapter,
  type Binding,
  type Operation,
  type Task,
} from './model.js';
import { Scheduler } from './queue.js';
import { Store } from './store.js';
export class Coordinator {
  readonly queue = new Scheduler();
  constructor(
    public store: Store,
    public adapters: Record<string, Adapter>,
  ) {}
  binding(key: string) {
    const b = this.store.get<Binding>('binding', key);
    if (!b || b.state === 'CLOSED') throw new BridgeError('TARGET_CLOSED');
    return b;
  }
  task(key: string) {
    const t = this.store.get<Task>('task', key);
    if (!t) throw new BridgeError('TASK_NOT_FOUND');
    return t;
  }
  operation(key: string) {
    const op = this.store.get<Operation>('operation', key);
    if (!op) throw new BridgeError('OPERATION_NOT_FOUND');
    return op;
  }
  adapter(b: Binding) {
    return this.adapters[b.channel];
  }
  paused() {
    return this.store.all<Binding>('binding').some((b) => b.state === 'PAUSED');
  }
  save(t: Task) {
    if (this.store.get<Task>('task', t.task_id)?.cancelled) {
      t.cancelled = true;
      if (['QUEUED', 'PRECHECK', 'RUNNING', 'VERIFYING'].includes(t.status))
        t.status =
          t.operation_id &&
          ['DISPATCHING', 'VERIFYING', 'OUTCOME_UNKNOWN'].includes(
            this.operation(t.operation_id).status,
          )
            ? 'OUTCOME_UNKNOWN'
            : 'CANCELLED';
    }
    t.updated_at = now();
    this.store.put('task', t);
  }
  envelope(t: Task) {
    return {
      schema_version: '1',
      ...t,
      args: undefined,
      fingerprint: undefined,
      human_action: ['NEEDS_HUMAN', 'NEEDS_LOGIN'].includes(t.status)
        ? {
            message: '请在绑定窗口处理验证或登录，然后调用 bridge_resume_task。',
            resume_tool: 'bridge_resume_task',
          }
        : undefined,
    };
  }
  async call(tool: string, a: any): Promise<any> {
    if (tool === 'bridge_doctor')
      return {
        schema_version: '1',
        coordinator_pid: process.pid,
        platform: process.platform,
        node: process.version,
        write_mode: this.store.get<any>('config', 'write')?.enabled ? 'trusted-host' : 'disabled',
        adapters: await Promise.all(
          Object.entries(this.adapters)
            .filter(([channel]) => (a.channel ? channel === a.channel : channel !== 'wechat_macos'))
            .map(([, adapter]) => adapter.doctor()),
        ),
        pending: this.queue.pending,
      };
    if (tool === 'bridge_bind')
      return this.queue.run(async () => {
        if (this.paused()) throw new BridgeError('RESOURCE_BUSY', '人工接管未解除');
        const adapter = this.adapters[a.channel];
        const existing = this.store
          .all<Binding>('binding')
          .find((b) => b.channel === a.channel && b.state !== 'CLOSED');
        if (existing) throw new BridgeError('RESOURCE_BUSY', '同渠道已有绑定，请先核对或解除');
        const data = await adapter.bind(a);
        const b: Binding = {
          ...data,
          binding_id: id('binding'),
          generation: 1,
          state: 'READY',
          created_at: now(),
        };
        this.store.put('binding', b);
        return { schema_version: '1', binding: b };
      });
    if (tool === 'bridge_get_task') {
      const t = a.task_id
        ? this.task(a.task_id)
        : this.store
            .all<Task>('task')
            .find(
              (t) => t.binding_id === a.binding_id && t.client_request_id === a.client_request_id,
            );
      if (!t) throw new BridgeError('TASK_NOT_FOUND');
      return this.envelope(t);
    }
    if (tool === 'bridge_inspect_session')
      return this.queue.run(async () => {
        const b = this.binding(a.binding_id);
        const o = await this.adapter(b).inspect(b);
        assertObservation(b, o);
        return { schema_version: '1', binding: b, observation: o };
      });
    if (tool === 'bridge_unbind')
      return this.queue.run(async () => {
        const b = this.binding(a.binding_id);
        if (
          this.store
            .all<Task>('task')
            .some(
              (t) =>
                t.binding_id === b.binding_id &&
                ['RUNNING', 'VERIFYING', 'PRECHECK'].includes(t.status),
            )
        )
          throw new BridgeError('RESOURCE_BUSY');
        await this.adapter(b).unbind?.(b);
        b.state = 'CLOSED';
        b.generation++;
        this.store.put('binding', b);
        for (const t of this.store
          .all<Task>('task')
          .filter(
            (t) =>
              t.binding_id === b.binding_id &&
              ['QUEUED', 'NEEDS_HUMAN', 'NEEDS_LOGIN', 'NEEDS_REBIND'].includes(t.status),
          )) {
          t.status = 'CANCELLED';
          t.cancelled = true;
          this.save(t);
        }
        this.scheduleQueued();
        return { schema_version: '1', unbound: true, user_window_closed: false };
      });
    if (tool === 'bridge_cancel_task') {
      const t = this.task(a.task_id);
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(t.status)) return this.envelope(t);
      t.cancelled = true;
      t.status =
        t.operation_id &&
        ['DISPATCHING', 'VERIFYING', 'OUTCOME_UNKNOWN'].includes(
          this.operation(t.operation_id).status,
        )
          ? 'OUTCOME_UNKNOWN'
          : 'CANCELLED';
      this.save(t);
      return this.envelope(t);
    }
    if (tool === 'bridge_resume_task')
      return this.queue.run(async () => {
        let t = this.task(a.task_id);
        if (
          !['NEEDS_LOGIN', 'NEEDS_HUMAN', 'NEEDS_REBIND', 'OUTCOME_UNKNOWN', 'CANCELLED'].includes(
            t.status,
          )
        )
          return this.envelope(t);
        const b = this.binding(t.binding_id);
        if (b.state === 'READY' && ['OUTCOME_UNKNOWN', 'CANCELLED'].includes(t.status))
          return this.envelope(t);
        const o = await this.adapter(b).inspect(b);
        assertObservation(b, o);
        b.state = 'READY';
        b.generation++;
        this.store.put('binding', b);
        t = this.task(t.task_id);
        t.assisted = true;
        if (!t.cancelled && t.status !== 'OUTCOME_UNKNOWN') t.status = 'QUEUED';
        this.save(t);
        this.scheduleQueued();
        return this.envelope(t);
      });
    if (tool === 'bridge_reconcile_operation')
      return this.queue.run(async () => {
        const op = this.operation(a.operation_id);
        const b = this.binding(op.binding_id);
        if (op.status === 'CONFIRMED') return { schema_version: '1', operation: this.publicOp(op) };
        if (!['OUTCOME_UNKNOWN', 'VERIFYING'].includes(op.status))
          throw new BridgeError('INVALID_OPERATION_STATE');
        const o = await this.adapter(b).inspect(b);
        assertObservation(b, o);
        if (!op.payload) throw new BridgeError('PAYLOAD_EXPIRED');
        const r = await this.adapter(b).reconcile(op, b);
        op.history.push({ at: now(), confirmed: r.confirmed === true });
        if (r.confirmed === true) {
          op.status = 'CONFIRMED';
          op.evidence = r;
          if (op.dispatch_task_id) {
            const t = this.task(op.dispatch_task_id);
            t.status = 'SUCCEEDED';
            t.result = { operation: this.publicOp(op) };
            this.save(t);
          }
        }
        op.updated_at = now();
        this.store.put('operation', op);
        return { schema_version: '1', operation: this.publicOp(op) };
      });
    const b = this.binding(a.binding_id);
    if (
      (tool.startsWith('xhs_') && b.channel !== 'xiaohongshu_web') ||
      (tool.startsWith('wechat_') && b.channel !== 'wechat_macos')
    )
      throw new BridgeError('CHANNEL_MISMATCH');
    const fp = hash({ tool, args: a });
    const prior = this.store
      .all<Task>('task')
      .find((t) => t.binding_id === b.binding_id && t.client_request_id === a.client_request_id);
    if (prior) {
      if (prior.fingerprint !== fp) throw new BridgeError('REQUEST_ID_CONFLICT');
      return this.envelope(prior);
    }
    const submitting =
      tool === 'xhs_publish_post' ||
      tool === 'xhs_submit_comment' ||
      tool === 'wechat_send_message';
    if (submitting) {
      const op = this.operation(a.operation_id);
      if (
        op.binding_id !== b.binding_id ||
        op.kind !==
          (
            {
              xhs_publish_post: 'post',
              xhs_submit_comment: 'comment',
              wechat_send_message: 'message',
            } as any
          )[tool]
      )
        throw new BridgeError('SCOPE_MISMATCH');
      if (op.payload_version !== a.payload_version) throw new BridgeError('PAYLOAD_CHANGED');
      if (op.dispatch_task_id) return this.envelope(this.task(op.dispatch_task_id));
      if (op.status !== 'PREPARED') throw new BridgeError('INVALID_OPERATION_STATE');
      if (!this.store.get<any>('config', 'write')?.enabled)
        throw new BridgeError('WRITES_DISABLED', '请在本地开启 trusted-host 写入模式');
      if (
        a.scope.action !== tool ||
        a.scope.target_ref !== op.target_ref ||
        a.scope.payload_digest !== op.digest
      )
        throw new BridgeError('SCOPE_MISMATCH');
      if (op.binding_generation !== b.generation)
        throw new BridgeError('STALE_PREVIEW', '绑定代次改变，请重新准备草稿');
    }
    const t: Task = {
      task_id: id('task'),
      binding_id: b.binding_id,
      client_request_id: a.client_request_id,
      fingerprint: fp,
      tool,
      args: a,
      status: 'QUEUED',
      checkpoint: 'accepted',
      created_at: now(),
      updated_at: now(),
      ...(submitting ? { operation_id: a.operation_id } : {}),
    };
    this.store.atomic(() => {
      if (submitting) {
        const op = this.operation(a.operation_id);
        op.dispatch_task_id = t.task_id;
        op.scope = a.scope;
        this.store.put('operation', op);
      }
      this.store.put('task', t);
    });
    this.enqueue(t);
    return this.envelope(t);
  }
  publicOp(op: Operation) {
    return { ...op, payload: undefined, prepared: undefined };
  }
  scheduleQueued() {
    for (const t of this.store.all<Task>('task').filter((t) => t.status === 'QUEUED'))
      this.enqueue(t);
  }
  enqueue(original: Task) {
    void this.queue
      .run(async () => {
        const t = this.task(original.task_id);
        if (t.status !== 'QUEUED' || t.cancelled || this.paused()) return;
        const b = this.binding(t.binding_id);
        if (b.state !== 'READY') {
          t.status = 'NEEDS_REBIND';
          this.save(t);
          return;
        }
        const check = () => {
          if (this.task(t.task_id).cancelled) throw new BridgeError('CANCELLED');
          if (this.binding(t.binding_id).state !== 'READY') throw new BridgeError('TARGET_CHANGED');
        };
        try {
          t.status = 'PRECHECK';
          this.save(t);
          const adapter = this.adapter(b);
          const obs = await adapter.inspect(b);
          assertObservation(b, obs);
          check();
          t.status = 'RUNNING';
          this.save(t);
          if (t.operation_id) {
            const op = this.operation(t.operation_id);
            if (op.status !== 'PREPARED' || op.binding_generation !== b.generation)
              throw new BridgeError('STALE_PREVIEW');
            // 最终预检在同一队列锁下完成；之后先落盘再做任何提交动作。
            this.store.atomic(() => {
              const current = this.operation(op.operation_id);
              if (current.status !== 'PREPARED' || !current.payload)
                throw new BridgeError('STALE_PREVIEW');
              Object.assign(op, current);
              if (!this.store.get<any>('config', 'write')?.enabled)
                throw new BridgeError('WRITES_DISABLED');
              if (
                op.scope?.action !== t.tool ||
                op.scope?.target_ref !== op.target_ref ||
                op.scope?.payload_digest !== op.digest
              )
                throw new BridgeError('SCOPE_MISMATCH');
              check();
              op.status = 'DISPATCHING';
              op.updated_at = now();
              this.store.put('operation', op);
            });
            t.checkpoint = 'dispatch_persisted';
            this.save(t);
            const r = await adapter.dispatch(op, b, check);
            op.status = 'VERIFYING';
            this.store.put('operation', op);
            t.status = 'VERIFYING';
            this.save(t);
            if (r.confirmed !== true) throw new BridgeError('OUTCOME_UNKNOWN');
            op.status = 'CONFIRMED';
            op.evidence = r;
            op.updated_at = now();
            this.store.put('operation', op);
            t.result = { operation: this.publicOp(op) };
          } else if (t.tool.includes('_prepare_')) {
            const kind =
              t.tool === 'xhs_prepare_post'
                ? 'post'
                : t.tool === 'xhs_prepare_comment'
                  ? 'comment'
                  : 'message';
            const r = await adapter.prepare(kind, t.args.payload, b, check);
            check();
            const op: Operation = {
              operation_id: id('operation'),
              binding_id: b.binding_id,
              kind,
              payload: t.args.payload,
              prepared: r.checkpoint,
              payload_version: 1,
              digest: hash(t.args.payload),
              target_ref: r.target_ref,
              binding_generation: b.generation,
              status: 'PREPARED',
              history: [],
              created_at: now(),
              updated_at: now(),
            };
            this.store.put('operation', op);
            t.result = { operation: this.publicOp(op), preview: r.preview };
          } else
            t.result = await adapter.execute(
              t.tool,
              t.args,
              b,
              (step) => {
                t.checkpoint = step;
                this.save(t);
              },
              check,
            );
          check();
          t.status = 'SUCCEEDED';
          t.checkpoint = 'completed';
          delete t.error;
          this.save(t);
        } catch (e) {
          const code = e instanceof BridgeError ? e.code : 'BACKEND_ERROR';
          let unknown = false;
          if (t.operation_id) {
            const op = this.operation(t.operation_id);
            unknown = ['DISPATCHING', 'VERIFYING', 'OUTCOME_UNKNOWN'].includes(op.status);
            if (unknown) {
              op.status = 'OUTCOME_UNKNOWN';
              op.updated_at = now();
              this.store.put('operation', op);
            }
          }
          if (unknown) {
            t.status = 'OUTCOME_UNKNOWN';
            b.state = 'PAUSED';
          } else if (code === 'CANCELLED') t.status = 'CANCELLED';
          else if (
            [
              'HUMAN_VERIFICATION_REQUIRED',
              'RECIPIENT_AMBIGUOUS',
              'ACCOUNT_UNVERIFIED',
              'POLICY_LIMITED',
            ].includes(code)
          ) {
            t.status = 'NEEDS_HUMAN';
            b.state = 'PAUSED';
          } else if (code === 'AUTH_REQUIRED') {
            t.status = 'NEEDS_LOGIN';
            b.state = 'PAUSED';
          } else if (
            ['TARGET_CHANGED', 'TARGET_CLOSED', 'ACCOUNT_MISMATCH', 'BRIDGE_DISCONNECTED'].includes(
              code,
            )
          ) {
            t.status = 'NEEDS_REBIND';
            b.state = 'NEEDS_REBIND';
          } else t.status = 'FAILED';
          t.error = { code: unknown ? 'OUTCOME_UNKNOWN' : code, retryable: false };
          this.store.put('binding', b);
          this.save(t);
        }
      })
      .catch(() => {
        const t = this.task(original.task_id);
        if (t.status === 'QUEUED') {
          t.status = 'FAILED';
          t.error = { code: 'COORDINATOR_ERROR', retryable: false };
          this.save(t);
        }
      });
  }
}
