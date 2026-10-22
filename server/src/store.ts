import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Binding, Task, Operation } from './model.js';
export const statePath = () =>
  process.env.SESSION_BRIDGE_HOME ||
  join(homedir(), 'Library', 'Application Support', 'codex-session-bridge');
export function secureDir(path: string) {
  if (
    existsSync(path) &&
    (lstatSync(path).isSymbolicLink() ||
      !lstatSync(path).isDirectory() ||
      lstatSync(path).uid !== process.getuid?.())
  )
    throw new Error('不安全的数据目录');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}
export class Store {
  db: DatabaseSync;
  constructor(public path: string) {
    secureDir(path);
    const file = join(path, 'tasks.sqlite');
    if (
      existsSync(file) &&
      (lstatSync(file).isSymbolicLink() || lstatSync(file).uid !== process.getuid?.())
    )
      throw new Error('不安全的数据库');
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    const version = (this.db.prepare('PRAGMA user_version').get() as any).user_version;
    if (version > 1) {
      this.db.close();
      throw new Error('STORAGE_SCHEMA_UNSUPPORTED');
    }
    this.db.exec(
      'PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); PRAGMA user_version=1;',
    );
  }
  get<T>(kind: string, id: string): T | undefined {
    const r = this.db
      .prepare('SELECT data FROM records WHERE kind=? AND id=?')
      .get(kind, id) as any;
    return r ? JSON.parse(r.data) : undefined;
  }
  all<T>(kind: string): T[] {
    return (this.db.prepare('SELECT data FROM records WHERE kind=?').all(kind) as any[]).map((r) =>
      JSON.parse(r.data),
    );
  }
  put(kind: string, v: any) {
    const key =
      kind === 'binding'
        ? 'binding_id'
        : kind === 'task'
          ? 'task_id'
          : kind === 'operation'
            ? 'operation_id'
            : 'id';
    const old = this.get<any>(kind, v[key]);
    if (kind === 'operation' && (old?.payload_forgotten || old?.payload_purged)) {
      v.payload = null;
      v.prepared = undefined;
      v.payload_forgotten = true;
      if (old.status === 'EXPIRED') v.status = 'EXPIRED';
    }
    if (kind === 'task' && old?.payload_forgotten) {
      v.args = {};
      v.result = { payload_forgotten: true };
      v.payload_forgotten = true;
    }
    this.db
      .prepare(
        'INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
      )
      .run(kind, v[key], JSON.stringify(v));
  }
  atomic<T>(f: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = f();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  recover() {
    this.atomic(() => {
      for (const b of this.all<Binding>('binding')) {
        if (b.state !== 'CLOSED') {
          if (b.state !== 'PAUSED') b.state = 'NEEDS_REBIND';
          b.generation++;
          this.put('binding', b);
        }
      }
      for (const op of this.all<Operation>('operation'))
        if (['DISPATCHING', 'VERIFYING'].includes(op.status)) {
          op.status = 'OUTCOME_UNKNOWN';
          this.put('operation', op);
        }
      for (const t of this.all<Task>('task'))
        if (['QUEUED', 'PRECHECK', 'RUNNING', 'VERIFYING'].includes(t.status)) {
          t.status =
            t.operation_id &&
            this.get<Operation>('operation', t.operation_id)?.status === 'OUTCOME_UNKNOWN'
              ? 'OUTCOME_UNKNOWN'
              : 'NEEDS_REBIND';
          this.put('task', t);
        }
    });
  }
  purge(days = 7) {
    const cutoff = Date.now() - days * 86400000;
    let removed = 0;
    this.atomic(() => {
      for (const kind of ['task', 'operation'])
        for (const row of this.all<any>(kind))
          if (
            Date.parse(row.updated_at) < cutoff &&
            ['SUCCEEDED', 'FAILED', 'CANCELLED', 'CONFIRMED', 'FAILED_BEFORE_DISPATCH'].includes(
              row.status,
            )
          ) {
            if (row.payload_purged) continue;
            if (kind === 'task') {
              row.args = {};
              row.result = { payload_purged: true };
            } else {
              row.payload = null;
              row.prepared = undefined;
            }
            row.payload_purged = true;
            this.put(kind, row);
            removed++;
          }
    });
    return removed;
  }
  forgetPayload(operation_id: string) {
    this.atomic(() => {
      const op = this.get<any>('operation', operation_id);
      if (!op) throw new Error('OPERATION_NOT_FOUND');
      if (['DISPATCHING', 'VERIFYING'].includes(op.status)) throw new Error('RESOURCE_BUSY');
      op.payload = null;
      op.prepared = undefined;
      op.payload_forgotten = true;
      if (op.status === 'PREPARED') op.status = 'EXPIRED';
      this.put('operation', op);
      for (const task of this.all<any>('task'))
        if (
          task.result?.operation?.operation_id === operation_id ||
          task.operation_id === operation_id
        ) {
          task.args = {};
          task.result = { payload_forgotten: true };
          task.payload_forgotten = true;
          this.put('task', task);
        }
    });
  }
  close() {
    this.db.close();
  }
}
