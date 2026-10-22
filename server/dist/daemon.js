// server/src/daemon.ts
import { createServer } from "node:net";
import { chmodSync as chmodSync2, existsSync as existsSync2, fstatSync, lstatSync as lstatSync2, unlinkSync } from "node:fs";
import { join as join4 } from "node:path";
import { fileURLToPath } from "node:url";

// server/src/model.ts
import { createHash, randomUUID } from "node:crypto";
var id = (prefix) => `${prefix}_${randomUUID()}`;
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var hash = (v) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v).sort().map((k) => [k, canonical(v[k])])
    );
  return v;
}
var BridgeError = class extends Error {
  constructor(code, detail = code) {
    super(code === detail ? code : `${code}: ${detail}`);
    this.code = code;
    this.detail = detail;
  }
  code;
  detail;
};
var browserOrigins = {
  xiaohongshu_web: ["https://www.xiaohongshu.com", "https://creator.xiaohongshu.com"],
  instagram_web: ["https://www.instagram.com", "https://instagram.com"]
};
function assertObservation(b, o) {
  if (o.connection !== b.connection)
    throw new BridgeError("TARGET_CHANGED", "\u63A7\u5236\u8FDE\u63A5\u5DF2\u66F4\u6362\uFF0C\u8BF7\u91CD\u65B0\u7ED1\u5B9A");
  if (o.target !== b.target) throw new BridgeError("TARGET_CHANGED", "\u6267\u884C\u76EE\u6807\u5DF2\u6539\u53D8");
  if (o.blocker) throw new BridgeError(o.blocker);
  if (b.account && o.account !== b.account)
    throw new BridgeError("ACCOUNT_MISMATCH", "\u8D26\u53F7\u8BC1\u636E\u6539\u53D8\u6216\u6D88\u5931");
  if (browserOrigins[b.channel] && !browserOrigins[b.channel].includes(o.origin ?? ""))
    throw new BridgeError("TARGET_CHANGED", "\u9875\u9762\u79BB\u5F00\u5141\u8BB8\u7684\u6765\u6E90");
}

// server/src/queue.ts
var Scheduler = class {
  tail = Promise.resolve();
  pending = 0;
  run(f) {
    this.pending++;
    const p = this.tail.then(f);
    this.tail = p.then(
      () => {
      },
      () => {
      }
    );
    return p.finally(() => {
      this.pending--;
    });
  }
};

// server/src/coordinator.ts
var Coordinator = class {
  constructor(store2, adapters) {
    this.store = store2;
    this.adapters = adapters;
  }
  store;
  adapters;
  queue = new Scheduler();
  binding(key) {
    const b = this.store.get("binding", key);
    if (!b || b.state === "CLOSED") throw new BridgeError("TARGET_CLOSED");
    return b;
  }
  task(key) {
    const t = this.store.get("task", key);
    if (!t) throw new BridgeError("TASK_NOT_FOUND");
    return t;
  }
  operation(key) {
    const op = this.store.get("operation", key);
    if (!op) throw new BridgeError("OPERATION_NOT_FOUND");
    return op;
  }
  adapter(b) {
    return this.adapters[b.channel];
  }
  paused() {
    return this.store.all("binding").some((b) => b.state === "PAUSED");
  }
  save(t) {
    if (this.store.get("task", t.task_id)?.cancelled) {
      t.cancelled = true;
      if (["QUEUED", "PRECHECK", "RUNNING", "VERIFYING"].includes(t.status))
        t.status = t.operation_id && ["DISPATCHING", "VERIFYING", "OUTCOME_UNKNOWN"].includes(
          this.operation(t.operation_id).status
        ) ? "OUTCOME_UNKNOWN" : "CANCELLED";
    }
    t.updated_at = now();
    this.store.put("task", t);
  }
  envelope(t) {
    return {
      schema_version: "1",
      ...t,
      args: void 0,
      fingerprint: void 0,
      human_action: ["NEEDS_HUMAN", "NEEDS_LOGIN"].includes(t.status) ? {
        message: "\u8BF7\u5728\u7ED1\u5B9A\u7A97\u53E3\u5904\u7406\u9A8C\u8BC1\u6216\u767B\u5F55\uFF0C\u7136\u540E\u8C03\u7528 bridge_resume_task\u3002",
        resume_tool: "bridge_resume_task"
      } : void 0
    };
  }
  async call(tool, a) {
    if (tool === "bridge_doctor")
      return {
        schema_version: "1",
        coordinator_pid: process.pid,
        platform: process.platform,
        node: process.version,
        write_mode: this.store.get("config", "write")?.enabled ? "trusted-host" : "disabled",
        adapters: await Promise.all(
          Object.entries(this.adapters).filter(([channel]) => a.channel ? channel === a.channel : channel !== "wechat_macos").map(([, adapter]) => adapter.doctor())
        ),
        pending: this.queue.pending
      };
    if (tool === "bridge_bind")
      return this.queue.run(async () => {
        if (this.paused()) throw new BridgeError("RESOURCE_BUSY", "\u4EBA\u5DE5\u63A5\u7BA1\u672A\u89E3\u9664");
        const adapter = this.adapters[a.channel];
        const existing = this.store.all("binding").find((b3) => b3.channel === a.channel && b3.state !== "CLOSED");
        if (existing) throw new BridgeError("RESOURCE_BUSY", "\u540C\u6E20\u9053\u5DF2\u6709\u7ED1\u5B9A\uFF0C\u8BF7\u5148\u6838\u5BF9\u6216\u89E3\u9664");
        const data = await adapter.bind(a);
        if (data.channel !== a.channel) throw new BridgeError("CHANNEL_MISMATCH");
        const b2 = {
          ...data,
          binding_id: id("binding"),
          generation: 1,
          state: "READY",
          created_at: now()
        };
        this.store.put("binding", b2);
        return { schema_version: "1", binding: b2 };
      });
    if (tool === "bridge_get_task") {
      const t2 = a.task_id ? this.task(a.task_id) : this.store.all("task").find(
        (t3) => t3.binding_id === a.binding_id && t3.client_request_id === a.client_request_id
      );
      if (!t2) throw new BridgeError("TASK_NOT_FOUND");
      return this.envelope(t2);
    }
    if (tool === "bridge_inspect_session")
      return this.queue.run(async () => {
        const b2 = this.binding(a.binding_id);
        const o = await this.adapter(b2).inspect(b2);
        assertObservation(b2, o);
        return { schema_version: "1", binding: b2, observation: o };
      });
    if (tool === "bridge_unbind")
      return this.queue.run(async () => {
        const b2 = this.binding(a.binding_id);
        if (this.store.all("task").some(
          (t2) => t2.binding_id === b2.binding_id && ["RUNNING", "VERIFYING", "PRECHECK"].includes(t2.status)
        ))
          throw new BridgeError("RESOURCE_BUSY");
        await this.adapter(b2).unbind?.(b2);
        b2.state = "CLOSED";
        b2.generation++;
        this.store.put("binding", b2);
        for (const t2 of this.store.all("task").filter(
          (t3) => t3.binding_id === b2.binding_id && ["QUEUED", "NEEDS_HUMAN", "NEEDS_LOGIN", "NEEDS_REBIND"].includes(t3.status)
        )) {
          t2.status = "CANCELLED";
          t2.cancelled = true;
          this.save(t2);
        }
        this.scheduleQueued();
        return { schema_version: "1", unbound: true, user_window_closed: false };
      });
    if (tool === "bridge_cancel_task") {
      const t2 = this.task(a.task_id);
      if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(t2.status)) return this.envelope(t2);
      t2.cancelled = true;
      t2.status = t2.operation_id && ["DISPATCHING", "VERIFYING", "OUTCOME_UNKNOWN"].includes(
        this.operation(t2.operation_id).status
      ) ? "OUTCOME_UNKNOWN" : "CANCELLED";
      this.save(t2);
      return this.envelope(t2);
    }
    if (tool === "bridge_resume_task")
      return this.queue.run(async () => {
        let t2 = this.task(a.task_id);
        if (!["NEEDS_LOGIN", "NEEDS_HUMAN", "NEEDS_REBIND", "OUTCOME_UNKNOWN", "CANCELLED"].includes(
          t2.status
        ))
          return this.envelope(t2);
        const b2 = this.binding(t2.binding_id);
        if (b2.state === "READY" && ["OUTCOME_UNKNOWN", "CANCELLED"].includes(t2.status))
          return this.envelope(t2);
        const o = await this.adapter(b2).inspect(b2);
        assertObservation(b2, o);
        b2.state = "READY";
        b2.generation++;
        this.store.put("binding", b2);
        t2 = this.task(t2.task_id);
        t2.assisted = true;
        if (!t2.cancelled && t2.status !== "OUTCOME_UNKNOWN") t2.status = "QUEUED";
        this.save(t2);
        this.scheduleQueued();
        return this.envelope(t2);
      });
    if (tool === "bridge_reconcile_operation")
      return this.queue.run(async () => {
        const op = this.operation(a.operation_id);
        const b2 = this.binding(op.binding_id);
        if (op.status === "CONFIRMED") return { schema_version: "1", operation: this.publicOp(op) };
        if (!["OUTCOME_UNKNOWN", "VERIFYING"].includes(op.status))
          throw new BridgeError("INVALID_OPERATION_STATE");
        const o = await this.adapter(b2).inspect(b2);
        assertObservation(b2, o);
        if (!op.payload) throw new BridgeError("PAYLOAD_EXPIRED");
        const r = await this.adapter(b2).reconcile(op, b2);
        op.history.push({ at: now(), confirmed: r.confirmed === true });
        if (r.confirmed === true) {
          op.status = "CONFIRMED";
          op.evidence = r;
          if (op.dispatch_task_id) {
            const t2 = this.task(op.dispatch_task_id);
            t2.status = "SUCCEEDED";
            t2.result = { operation: this.publicOp(op) };
            this.save(t2);
          }
        }
        op.updated_at = now();
        this.store.put("operation", op);
        return { schema_version: "1", operation: this.publicOp(op) };
      });
    const b = this.binding(a.binding_id);
    if (tool.startsWith("xhs_") && b.channel !== "xiaohongshu_web" || tool.startsWith("ig_") && b.channel !== "instagram_web" || tool.startsWith("wechat_") && b.channel !== "wechat_macos")
      throw new BridgeError("CHANNEL_MISMATCH");
    const fp = hash({ tool, args: a });
    const prior = this.store.all("task").find((t2) => t2.binding_id === b.binding_id && t2.client_request_id === a.client_request_id);
    if (prior) {
      if (prior.fingerprint !== fp) throw new BridgeError("REQUEST_ID_CONFLICT");
      return this.envelope(prior);
    }
    const submitting = tool === "xhs_publish_post" || tool === "xhs_submit_comment" || tool === "wechat_send_message";
    if (submitting) {
      const op = this.operation(a.operation_id);
      if (op.binding_id !== b.binding_id || op.kind !== {
        xhs_publish_post: "post",
        xhs_submit_comment: "comment",
        wechat_send_message: "message"
      }[tool])
        throw new BridgeError("SCOPE_MISMATCH");
      if (op.payload_version !== a.payload_version) throw new BridgeError("PAYLOAD_CHANGED");
      if (op.dispatch_task_id) return this.envelope(this.task(op.dispatch_task_id));
      if (op.status !== "PREPARED") throw new BridgeError("INVALID_OPERATION_STATE");
      if (!this.store.get("config", "write")?.enabled)
        throw new BridgeError("WRITES_DISABLED", "\u8BF7\u5728\u672C\u5730\u5F00\u542F trusted-host \u5199\u5165\u6A21\u5F0F");
      if (a.scope.action !== tool || a.scope.target_ref !== op.target_ref || a.scope.payload_digest !== op.digest)
        throw new BridgeError("SCOPE_MISMATCH");
      if (op.binding_generation !== b.generation)
        throw new BridgeError("STALE_PREVIEW", "\u7ED1\u5B9A\u4EE3\u6B21\u6539\u53D8\uFF0C\u8BF7\u91CD\u65B0\u51C6\u5907\u8349\u7A3F");
    }
    const t = {
      task_id: id("task"),
      binding_id: b.binding_id,
      client_request_id: a.client_request_id,
      fingerprint: fp,
      tool,
      args: a,
      status: "QUEUED",
      checkpoint: "accepted",
      created_at: now(),
      updated_at: now(),
      ...submitting ? { operation_id: a.operation_id } : {}
    };
    this.store.atomic(() => {
      if (submitting) {
        const op = this.operation(a.operation_id);
        op.dispatch_task_id = t.task_id;
        op.scope = a.scope;
        this.store.put("operation", op);
      }
      this.store.put("task", t);
    });
    this.enqueue(t);
    return this.envelope(t);
  }
  publicOp(op) {
    return { ...op, payload: void 0, prepared: void 0 };
  }
  scheduleQueued() {
    for (const t of this.store.all("task").filter((t2) => t2.status === "QUEUED"))
      this.enqueue(t);
  }
  enqueue(original) {
    void this.queue.run(async () => {
      const t = this.task(original.task_id);
      if (t.status !== "QUEUED" || t.cancelled || this.paused()) return;
      const b = this.binding(t.binding_id);
      if (b.state !== "READY") {
        t.status = "NEEDS_REBIND";
        this.save(t);
        return;
      }
      const check = () => {
        if (this.task(t.task_id).cancelled) throw new BridgeError("CANCELLED");
        if (this.binding(t.binding_id).state !== "READY") throw new BridgeError("TARGET_CHANGED");
      };
      try {
        t.status = "PRECHECK";
        this.save(t);
        const adapter = this.adapter(b);
        const obs = await adapter.inspect(b);
        assertObservation(b, obs);
        check();
        t.status = "RUNNING";
        this.save(t);
        if (t.operation_id) {
          const op = this.operation(t.operation_id);
          if (op.status !== "PREPARED" || op.binding_generation !== b.generation)
            throw new BridgeError("STALE_PREVIEW");
          this.store.atomic(() => {
            const current = this.operation(op.operation_id);
            if (current.status !== "PREPARED" || !current.payload)
              throw new BridgeError("STALE_PREVIEW");
            Object.assign(op, current);
            if (!this.store.get("config", "write")?.enabled)
              throw new BridgeError("WRITES_DISABLED");
            if (op.scope?.action !== t.tool || op.scope?.target_ref !== op.target_ref || op.scope?.payload_digest !== op.digest)
              throw new BridgeError("SCOPE_MISMATCH");
            check();
            op.status = "DISPATCHING";
            op.updated_at = now();
            this.store.put("operation", op);
          });
          t.checkpoint = "dispatch_persisted";
          this.save(t);
          const r = await adapter.dispatch(op, b, check);
          op.status = "VERIFYING";
          this.store.put("operation", op);
          t.status = "VERIFYING";
          this.save(t);
          if (r.confirmed !== true) throw new BridgeError("OUTCOME_UNKNOWN");
          op.status = "CONFIRMED";
          op.evidence = r;
          op.updated_at = now();
          this.store.put("operation", op);
          t.result = { operation: this.publicOp(op) };
        } else if (t.tool.includes("_prepare_")) {
          const kind = t.tool === "xhs_prepare_post" ? "post" : t.tool === "xhs_prepare_comment" ? "comment" : "message";
          const r = await adapter.prepare(kind, t.args.payload, b, check);
          check();
          const op = {
            operation_id: id("operation"),
            binding_id: b.binding_id,
            kind,
            payload: t.args.payload,
            prepared: r.checkpoint,
            payload_version: 1,
            digest: hash(t.args.payload),
            target_ref: r.target_ref,
            binding_generation: b.generation,
            status: "PREPARED",
            history: [],
            created_at: now(),
            updated_at: now()
          };
          this.store.put("operation", op);
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
            check
          );
        check();
        t.status = "SUCCEEDED";
        t.checkpoint = "completed";
        delete t.error;
        this.save(t);
      } catch (e) {
        const code = e instanceof BridgeError ? e.code : "BACKEND_ERROR";
        let unknown = false;
        if (t.operation_id) {
          const op = this.operation(t.operation_id);
          unknown = ["DISPATCHING", "VERIFYING", "OUTCOME_UNKNOWN"].includes(op.status);
          if (unknown) {
            op.status = "OUTCOME_UNKNOWN";
            op.updated_at = now();
            this.store.put("operation", op);
          }
        }
        if (unknown) {
          t.status = "OUTCOME_UNKNOWN";
          b.state = "PAUSED";
        } else if (code === "CANCELLED") t.status = "CANCELLED";
        else if ([
          "HUMAN_VERIFICATION_REQUIRED",
          "RECIPIENT_AMBIGUOUS",
          "ACCOUNT_UNVERIFIED",
          "POLICY_LIMITED"
        ].includes(code)) {
          t.status = "NEEDS_HUMAN";
          b.state = "PAUSED";
        } else if (code === "AUTH_REQUIRED") {
          t.status = "NEEDS_LOGIN";
          b.state = "PAUSED";
        } else if (["TARGET_CHANGED", "TARGET_CLOSED", "ACCOUNT_MISMATCH", "BRIDGE_DISCONNECTED"].includes(
          code
        )) {
          t.status = "NEEDS_REBIND";
          b.state = "NEEDS_REBIND";
        } else t.status = "FAILED";
        t.error = { code: unknown ? "OUTCOME_UNKNOWN" : code, retryable: false };
        this.store.put("binding", b);
        this.save(t);
      }
    }).catch(() => {
      const t = this.task(original.task_id);
      if (t.status === "QUEUED") {
        t.status = "FAILED";
        t.error = { code: "COORDINATOR_ERROR", retryable: false };
        this.save(t);
      }
    });
  }
};

// server/src/store.ts
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
var statePath = () => process.env.SESSION_BRIDGE_HOME || join(homedir(), "Library", "Application Support", "codex-session-bridge");
function secureDir(path2) {
  if (existsSync(path2) && (lstatSync(path2).isSymbolicLink() || !lstatSync(path2).isDirectory() || lstatSync(path2).uid !== process.getuid?.()))
    throw new Error("\u4E0D\u5B89\u5168\u7684\u6570\u636E\u76EE\u5F55");
  mkdirSync(path2, { recursive: true, mode: 448 });
  chmodSync(path2, 448);
}
var Store = class {
  constructor(path2) {
    this.path = path2;
    secureDir(path2);
    const file = join(path2, "tasks.sqlite");
    if (existsSync(file) && (lstatSync(file).isSymbolicLink() || lstatSync(file).uid !== process.getuid?.()))
      throw new Error("\u4E0D\u5B89\u5168\u7684\u6570\u636E\u5E93");
    this.db = new DatabaseSync(file);
    chmodSync(file, 384);
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    if (version > 1) {
      this.db.close();
      throw new Error("STORAGE_SCHEMA_UNSUPPORTED");
    }
    this.db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); PRAGMA user_version=1;"
    );
  }
  path;
  db;
  get(kind, id2) {
    const r = this.db.prepare("SELECT data FROM records WHERE kind=? AND id=?").get(kind, id2);
    return r ? JSON.parse(r.data) : void 0;
  }
  all(kind) {
    return this.db.prepare("SELECT data FROM records WHERE kind=?").all(kind).map(
      (r) => JSON.parse(r.data)
    );
  }
  put(kind, v) {
    const key = kind === "binding" ? "binding_id" : kind === "task" ? "task_id" : kind === "operation" ? "operation_id" : "id";
    const old = this.get(kind, v[key]);
    if (kind === "operation" && (old?.payload_forgotten || old?.payload_purged)) {
      v.payload = null;
      v.prepared = void 0;
      v.payload_forgotten = true;
      if (old.status === "EXPIRED") v.status = "EXPIRED";
    }
    if (kind === "task" && old?.payload_forgotten) {
      v.args = {};
      v.result = { payload_forgotten: true };
      v.payload_forgotten = true;
    }
    this.db.prepare(
      "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data"
    ).run(kind, v[key], JSON.stringify(v));
  }
  atomic(f) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = f();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  recover() {
    this.atomic(() => {
      for (const b of this.all("binding")) {
        if (b.state !== "CLOSED") {
          if (b.state !== "PAUSED") b.state = "NEEDS_REBIND";
          b.generation++;
          this.put("binding", b);
        }
      }
      for (const op of this.all("operation"))
        if (["DISPATCHING", "VERIFYING"].includes(op.status)) {
          op.status = "OUTCOME_UNKNOWN";
          this.put("operation", op);
        }
      for (const t of this.all("task"))
        if (["QUEUED", "PRECHECK", "RUNNING", "VERIFYING"].includes(t.status)) {
          t.status = t.operation_id && this.get("operation", t.operation_id)?.status === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "NEEDS_REBIND";
          this.put("task", t);
        }
    });
  }
  purge(days = 7) {
    const cutoff = Date.now() - days * 864e5;
    let removed = 0;
    this.atomic(() => {
      for (const kind of ["task", "operation"])
        for (const row of this.all(kind))
          if (Date.parse(row.updated_at) < cutoff && ["SUCCEEDED", "FAILED", "CANCELLED", "CONFIRMED", "FAILED_BEFORE_DISPATCH"].includes(
            row.status
          )) {
            if (row.payload_purged) continue;
            if (kind === "task") {
              row.args = {};
              row.result = { payload_purged: true };
            } else {
              row.payload = null;
              row.prepared = void 0;
            }
            row.payload_purged = true;
            this.put(kind, row);
            removed++;
          }
    });
    return removed;
  }
  forgetPayload(operation_id) {
    this.atomic(() => {
      const op = this.get("operation", operation_id);
      if (!op) throw new Error("OPERATION_NOT_FOUND");
      if (["DISPATCHING", "VERIFYING"].includes(op.status)) throw new Error("RESOURCE_BUSY");
      op.payload = null;
      op.prepared = void 0;
      op.payload_forgotten = true;
      if (op.status === "PREPARED") op.status = "EXPIRED";
      this.put("operation", op);
      for (const task2 of this.all("task"))
        if (task2.result?.operation?.operation_id === operation_id || task2.operation_id === operation_id) {
          task2.args = {};
          task2.result = { payload_forgotten: true };
          task2.payload_forgotten = true;
          this.put("task", task2);
        }
    });
  }
  close() {
    this.db.close();
  }
};

// server/src/adapters/browser.ts
import { pathToFileURL } from "node:url";
import { join as join2 } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// server/src/adapters/browser-program.ts
async function browserProgram(p) {
  try {
    const visible = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const list = (s) => Array.from(document.querySelectorAll(s)).filter(visible);
    const one = (s) => {
      const es = list(s);
      if (es.length !== 1) throw new Error("UI_CHANGED");
      return es[0];
    };
    const value = (e) => String(e.value ?? e.innerText ?? "");
    const searchField = () => {
      const fields = list(
        'input#search-input, input[placeholder="\u641C\u7D22\u5C0F\u7EA2\u4E66"], textarea#search-input-ai, textarea#search-input-in-feeds'
      ).filter(
        (e) => e.getAttribute("aria-hidden") !== "true" && !e.disabled && !e.readOnly
      );
      if (fields.length !== 1) throw new Error("UI_CHANGED");
      return fields[0];
    };
    const noteLinkId = (el) => {
      try {
        const url = new URL(el.getAttribute("href") || "", location.href);
        if (url.origin !== "https://www.xiaohongshu.com") return void 0;
        return url.pathname.match(
          /^\/(?:explore|search_result|note|discovery\/item)\/([a-f0-9]{24})\/?$/
        )?.[1];
      } catch {
        return void 0;
      }
    };
    const cardSummaries = () => list('section.note-item, .note-item, [data-testid="note-card"]').map((e) => {
      const a = Array.from(e.querySelectorAll("a[href]")).find(noteLinkId);
      return {
        note_id: a && noteLinkId(a),
        title: (e.querySelector(".title")?.textContent || a?.textContent || "").trim().slice(0, 500)
      };
    }).filter((x) => x.note_id);
    const readAccount = () => {
      const links = list(
        'a.user[href*="/user/profile/"], .user a[href*="/user/profile/"], .side-bar a[href*="/user/profile/"]'
      );
      return links.length === 1 ? links[0].getAttribute("href")?.match(/\/user\/profile\/([a-f0-9]{24})/)?.[1] : void 0;
    };
    const blocked = () => location.pathname.startsWith("/website-login/captcha") || list(
      '.captcha-container, #captcha, [role="dialog"][aria-label*="\u9A8C\u8BC1"], iframe[src*="captcha"], .verify-modal'
    ).length > 0 ? "HUMAN_VERIFICATION_REQUIRED" : list(".login-container, .login-modal, .qrcode-login, #login-btn").length > 0 ? "AUTH_REQUIRED" : void 0;
    const account = readAccount();
    const w = window;
    const documentKey = "__codexSessionBridgeDocument";
    if (!w[documentKey]) w[documentKey] = crypto.randomUUID();
    const accountHash = account ? Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(account))
        )
      )
    ).map((n) => n.toString(16).padStart(2, "0")).join("") : void 0;
    const observation = {
      origin: location.origin,
      account: accountHash,
      document: w[documentKey],
      blocker: blocked()
    };
    if (readAccount() !== account) throw new Error("TARGET_CHANGED");
    if (p.action === "inspect") return observation;
    if (observation.blocker) throw new Error(observation.blocker);
    if (p.guard?.document !== w[documentKey] || p.guard?.origin !== location.origin || p.guard?.account && p.guard.account !== accountHash)
      throw new Error("TARGET_CHANGED");
    const fresh = () => {
      if (Date.now() > p.deadline || readAccount() !== account || p.guard?.document !== w[documentKey] || p.guard?.origin !== location.origin)
        throw new Error("TARGET_CHANGED");
      const reason = blocked();
      if (reason) throw new Error(reason);
    };
    fresh();
    const set = (el, text2) => {
      fresh();
      if (el.isContentEditable) {
        el.textContent = text2;
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: text2 })
        );
      } else {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text2);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (value(el) !== text2) throw new Error("UI_CHANGED");
    };
    const noteId = () => location.pathname.match(
      /\/(?:explore|search_result|note|discovery\/item)\/([a-f0-9]{24})/
    )?.[1] || list('.note-detail-mask a[href*="/explore/"]').map((e) => e.getAttribute("href")?.match(/\/explore\/([a-f0-9]{24})/)?.[1]).find(Boolean);
    const buttons = (label) => list('button,[role="button"],.publishBtn').filter(
      (e) => e.innerText.trim() === label && !e.disabled
    );
    const press = (label) => {
      fresh();
      const b = buttons(label);
      if (b.length !== 1) throw new Error("UI_CHANGED");
      b[0].click();
    };
    if (p.action === "search_start") {
      const field = searchField();
      set(field, p.query);
      w.__csbSearch = {
        query: p.query,
        oldSemantic: JSON.stringify(cardSummaries()),
        changed: false
      };
      const observer = new MutationObserver((records) => {
        if (records.some(
          (r) => Array.from(r.addedNodes).concat(Array.from(r.removedNodes)).some(
            (n) => n instanceof Element && (n.matches('section.note-item,.note-item,[data-testid="note-card"]') || n.querySelector('section.note-item,.note-item,[data-testid="note-card"]'))
          )
        ))
          w.__csbSearch.changed = true;
      });
      observer.observe(document.body, { childList: true, subtree: true });
      w.__csbObserver?.disconnect();
      w.__csbObserver = observer;
      const primary = list(".search-icon");
      const modernBox = field.closest(".search-box-in-content, .search-area-in-header");
      const modern = modernBox ? Array.from(modernBox.querySelectorAll(".submit-button-wrapper")).filter(
        visible
      ) : [];
      const submit = modernBox ? modern : primary.length ? primary : list('.input-button, button[aria-label="\u641C\u7D22"]');
      if (submit.length !== 1 || submit[0].disabled || submit[0].getAttribute("aria-disabled") === "true")
        throw new Error("UI_CHANGED");
      fresh();
      submit[0].click();
      return { submitted: true };
    }
    if (p.action === "search_result") {
      const state = w.__csbSearch;
      const field = searchField();
      const cards = cardSummaries();
      const rawKeyword = new URL(location.href).searchParams.get("keyword");
      let keywordMatches = rawKeyword === p.query;
      if (!keywordMatches && rawKeyword !== null) {
        try {
          keywordMatches = decodeURIComponent(rawKeyword) === p.query;
        } catch {
        }
      }
      if (!state || state.query !== p.query || value(field) !== p.query || !keywordMatches || !state.oldSemantic || JSON.stringify(cards) === state.oldSemantic)
        return { pending: true };
      const results = cards.slice(0, p.limit);
      if (!results.length) return { pending: true };
      return {
        query: p.query,
        results,
        partial: true,
        source: "visible_dom",
        observed_at: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    if (p.action === "note_open") {
      if (noteId() === p.note_id) return { opened: true };
      const links = list("a[href]").filter((e) => noteLinkId(e) === p.note_id);
      const cardSelector = 'section.note-item, .note-item, [data-testid="note-card"]';
      const card = links[0]?.closest(cardSelector);
      if (!links.length || links.length > 1 && (!card || links.some((e) => e.closest(cardSelector) !== card)))
        throw new Error("UI_CHANGED");
      const covers = links.filter((e) => e.matches(".cover"));
      if (covers.length > 1) throw new Error("UI_CHANGED");
      const a = covers[0] || links[0];
      fresh();
      a.click();
      return { opened: true };
    }
    if (p.action === "note_read") {
      if (noteId() !== p.note_id) return { pending: true };
      const bodies = list('#detail-desc, .note-scroller .desc, [data-testid="note-body"]');
      if (!bodies.length) return { pending: true };
      if (bodies.length !== 1) throw new Error("UI_CHANGED");
      const body = bodies[0];
      return {
        note_id: p.note_id,
        title: list("#detail-title,.note-scroller .title")[0]?.textContent?.trim() || "",
        body: body.innerText.slice(0, 3e4),
        comments: list(".comment-item .content").slice(0, p.comment_limit).map((e) => e.innerText.slice(0, 3e3)),
        partial: true,
        source: "visible_dom",
        observed_at: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    if (p.action === "prepare_comment") {
      if (noteId() !== p.note_id) throw new Error("TARGET_CHANGED");
      const field = one(
        '.comment-input [contenteditable="true"], textarea.comment-input, #content-textarea'
      );
      set(field, p.body);
      return {
        target_ref: p.note_id,
        preview: { note_id: p.note_id, body: value(field) },
        checkpoint: {
          before_ids: list(".comment-item[id],.comment-item[data-comment-id]").map(
            (e) => e.getAttribute("data-comment-id") || e.id
          )
        }
      };
    }
    if (p.action === "prepare_post") {
      if (location.origin !== "https://creator.xiaohongshu.com") throw new Error("TARGET_CHANGED");
      set(one('input[placeholder*="\u6807\u9898"]'), p.title);
      set(one('.tiptap[contenteditable="true"],.ql-editor[contenteditable="true"]'), p.body);
      const images = list(".img-preview-area img, .upload-img-item img");
      if (images.length !== p.image_count) throw new Error("UI_CHANGED");
      return {
        target_ref: "creator_post",
        preview: { title: p.title, body: p.body, image_count: images.length },
        checkpoint: {
          image_sources: images.map((e) => e.src),
          before_ids: list(".publish-success [data-note-id]").map(
            (e) => e.getAttribute("data-note-id")
          )
        }
      };
    }
    if (p.action === "dispatch") {
      if (!p.operation_id || !p.payload_digest) throw new Error("PAYLOAD_CHANGED");
      w.__csbReceipts ||= {};
      if (w.__csbReceipts[p.operation_id]) return { dispatched: true };
      const before = p.kind === "comment" ? list(".comment-item[id],.comment-item[data-comment-id]").map(
        (e) => e.getAttribute("data-comment-id") || e.id
      ) : list(".publish-success [data-note-id]").map((e) => e.getAttribute("data-note-id"));
      if (p.kind === "comment") {
        if (noteId() !== p.note_id || value(
          one('.comment-input [contenteditable="true"],textarea.comment-input,#content-textarea')
        ) !== p.body)
          throw new Error("PAYLOAD_CHANGED");
        press("\u53D1\u9001");
      } else {
        if (location.origin !== "https://creator.xiaohongshu.com" || value(one('input[placeholder*="\u6807\u9898"]')) !== p.title || value(one('.tiptap[contenteditable="true"],.ql-editor[contenteditable="true"]')) !== p.body || JSON.stringify(
          list(".img-preview-area img,.upload-img-item img").map(
            (e) => e.src
          )
        ) !== JSON.stringify(p.prepared?.image_sources))
          throw new Error("PAYLOAD_CHANGED");
        press("\u53D1\u5E03");
      }
      const receipt = {
        operation_id: p.operation_id,
        payload_digest: p.payload_digest,
        document: w[documentKey],
        account: accountHash,
        confirmed: false
      };
      w.__csbReceipts[p.operation_id] = receipt;
      await Promise.resolve();
      fresh();
      if (p.kind === "comment") {
        if (noteId() !== p.note_id) throw new Error("TARGET_CHANGED");
        const matches = list(".comment-item[id],.comment-item[data-comment-id]").filter((e) => {
          const key = e.getAttribute("data-comment-id") || e.id;
          const author = e.querySelector('a[href*="/user/profile/"]')?.getAttribute("href")?.match(/\/user\/profile\/([a-f0-9]{24})/)?.[1];
          return key && !before.includes(key) && author === account && e.querySelector(".content")?.textContent?.trim() === p.body;
        });
        if (matches.length === 1)
          Object.assign(receipt, {
            confirmed: true,
            confirmation: "ui_only",
            comment_id: matches[0].getAttribute("data-comment-id") || matches[0].id
          });
      } else {
        const matches = list(".publish-success [data-note-id]").filter((e) => {
          const key = e.getAttribute("data-note-id");
          return key && /^[a-f0-9]{24}$/.test(key) && !before.includes(key) && e.getAttribute("data-title") === p.title;
        });
        if (matches.length === 1)
          Object.assign(receipt, {
            confirmed: true,
            confirmation: "ui_only",
            note_id: matches[0].getAttribute("data-note-id")
          });
      }
      return { dispatched: true };
    }
    if (p.action === "reconcile") {
      const receipt = w.__csbReceipts?.[p.operation_id];
      if (!receipt || receipt.payload_digest !== p.payload_digest || receipt.document !== w[documentKey] || receipt.account !== accountHash)
        return { confirmed: false, reason: "\u7F3A\u5C11\u53EF\u5F52\u5C5E\u4E8E\u672C\u6B21\u70B9\u51FB\u7684\u56DE\u6267" };
      return receipt.confirmed ? {
        confirmed: true,
        confirmation: "ui_only",
        comment_id: receipt.comment_id,
        note_id: receipt.note_id
      } : { confirmed: false, reason: "\u70B9\u51FB\u540E\u672A\u6355\u83B7\u53EF\u9760\u754C\u9762\u56DE\u6267" };
    }
    throw new Error("UNSUPPORTED_ACTION");
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    return {
      bridge_error: [
        "UI_CHANGED",
        "TARGET_CHANGED",
        "HUMAN_VERIFICATION_REQUIRED",
        "AUTH_REQUIRED",
        "PAYLOAD_CHANGED",
        "UNSUPPORTED_ACTION"
      ].includes(code) ? code : "UI_CHANGED"
    };
  }
}

// server/src/adapters/browser.ts
var run = promisify(execFile);
var BrowserAdapter = class {
  constructor(root2, channel = "xiaohongshu_web", pageProgram = browserProgram) {
    this.root = root2;
    this.channel = channel;
    this.pageProgram = pageProgram;
  }
  root;
  channel;
  pageProgram;
  async upstream() {
    return import(pathToFileURL(
      join2(this.root, "node_modules/@jackwener/opencli/dist/src/browser/daemon-transport.js")
    ).href);
  }
  async health(profile) {
    const api = await this.upstream();
    const h = await api.fetchDaemonStatus({ contextId: profile, timeout: 1e3 });
    if (h?.pending > 0) throw new BridgeError("RESOURCE_BUSY");
    if (!h?.extensionConnected) throw new BridgeError("BRIDGE_DISCONNECTED");
    if (h.daemonVersion !== "2.0.2" || h.extensionVersion !== "1.0.26")
      throw new BridgeError("BACKEND_VERSION_UNSUPPORTED");
    const contexts = (h.profiles || []).filter((p) => p.extensionConnected);
    const chosen = profile || h.contextId || (contexts.length === 1 ? contexts[0].contextId : void 0);
    if (!chosen || !contexts.some((p) => p.contextId === chosen))
      throw new BridgeError("ACCOUNT_UNVERIFIED");
    const ps = await run("/bin/ps", ["-p", String(h.pid), "-o", "lstart="]);
    return { h, profile: chosen, connection: `${h.pid}:${ps.stdout.trim()}` };
  }
  async command(action, params) {
    const api = await this.upstream();
    let r;
    try {
      const response = await api.requestDaemon("/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: id("cmd"),
          action,
          surface: "browser",
          timeout: 12,
          deadlineAt: Date.now() + 12e3,
          ...params
        }),
        timeout: 14e3
      });
      r = await response.json();
    } catch {
      throw new BridgeError("BRIDGE_DISCONNECTED");
    }
    if (!r.ok) {
      const code = String(r.errorCode ?? "");
      throw new BridgeError(
        /tab_gone|target_closed|bound_tab_closed/.test(code) ? "TARGET_CLOSED" : /profile|extension|command_lost|command_result_unknown/.test(code) ? "BRIDGE_DISCONNECTED" : "UI_CHANGED"
      );
    }
    return r;
  }
  async doctor() {
    try {
      const h = await this.health();
      return {
        channel: this.channel,
        status: "connected",
        backend: "OpenCLI",
        version: "2.0.2",
        extension: "1.0.26",
        profiles: h.h.profiles?.map((p) => ({
          profile: p.contextId,
          connected: p.extensionConnected
        }))
      };
    } catch (e) {
      let profiles = [];
      try {
        const api = await this.upstream();
        const status = await api.fetchDaemonStatus({ timeout: 1e3 });
        profiles = (status?.profiles || []).map((p) => ({
          profile: p.contextId,
          connected: p.extensionConnected
        }));
      } catch {
      }
      return {
        profiles,
        channel: this.channel,
        status: "unavailable",
        error: e instanceof BridgeError ? e.code : "BACKEND_NOT_INSTALLED",
        required: "\u672C\u5730 Chrome\u3001OpenCLI 2.0.2\u3001Browser Bridge 1.0.26"
      };
    }
  }
  async bind(a) {
    const h = await this.health(a.profile);
    const session = id("csb");
    const r = await this.command("bind", { session, contextId: h.profile });
    const target = r.page || r.data?.targetId || r.data?.page;
    if (!target)
      throw new BridgeError("BACKEND_CONTRACT_UNSUPPORTED", "\u7ED1\u5B9A\u672A\u8FD4\u56DE\u53EF\u9760\u7684 page \u6807\u8BC6");
    const b = {
      channel: this.channel,
      backend: "OpenCLI",
      backend_version: "2.0.2",
      profile: h.profile,
      connection: h.connection,
      target,
      session
    };
    let o;
    try {
      o = await this.inspect(b);
      assertObservation(b, o);
      if (a.expected_account && o.account !== hash(a.expected_account))
        throw new BridgeError("ACCOUNT_MISMATCH");
      if (!o.account && !a.user_bound)
        throw new BridgeError("ACCOUNT_UNVERIFIED", "\u65E0\u6CD5\u8BC6\u522B\u8D26\u53F7\uFF0C\u9700\u8981\u7528\u6237\u660E\u786E\u9009\u62E9\u5F53\u524D\u8D26\u53F7");
    } catch (e) {
      try {
        await this.unbind(b);
      } catch {
      }
      throw e;
    }
    return {
      ...b,
      account: o.account,
      assurance: o.account ? "verified" : "user_bound",
      document: o.document
    };
  }
  async inspect(b) {
    const h = await this.health(b.profile);
    if (h.connection !== b.connection) throw new BridgeError("TARGET_CHANGED");
    const r = await this.command("exec", {
      session: b.session,
      contextId: b.profile,
      page: b.target,
      code: `(${this.pageProgram.toString()})(${JSON.stringify({ action: "inspect" })})`
    });
    const d = r.data;
    if (d?.bridge_error) throw new BridgeError(d.bridge_error);
    if (!d || !d.document || !r.page) throw new BridgeError("BACKEND_CONTRACT_UNSUPPORTED");
    return { ...d, account: d.account, target: r.page, connection: h.connection };
  }
  async program(b, p) {
    const o = await this.inspect(b);
    assertObservation(b, o);
    const guard = { document: o.document, origin: o.origin, account: b.account };
    const r = await this.command("exec", {
      session: b.session,
      contextId: b.profile,
      page: b.target,
      code: `(${this.pageProgram.toString()})(${JSON.stringify({ ...p, guard, deadline: Date.now() + 1e4 })})`
    });
    if (r.page !== b.target) throw new BridgeError("TARGET_CHANGED");
    if (r.data?.bridge_error) throw new BridgeError(r.data.bridge_error);
    return r.data;
  }
  async poll(b, p, check) {
    for (let attempt = 0; attempt < 8; attempt++) {
      check();
      const r = await this.program(b, p);
      if (!r?.pending) return r;
      await new Promise((r2) => setTimeout(r2, 400));
    }
    throw new BridgeError("UI_CHANGED", "\u672A\u89C2\u5BDF\u5230\u672C\u6B21\u52A8\u4F5C\u7684\u65B0\u7ED3\u679C");
  }
  async execute(tool, a, b, checkpoint, check) {
    check();
    if (tool === "xhs_search") {
      await this.program(b, { action: "search_start", query: a.query });
      checkpoint("search_submitted");
      return this.poll(b, { action: "search_result", query: a.query, limit: a.limit }, check);
    }
    if (tool === "xhs_read_note") {
      await this.program(b, { action: "note_open", note_id: a.note_id });
      checkpoint("note_opened");
      return this.poll(
        b,
        { action: "note_read", note_id: a.note_id, comment_limit: a.comment_limit },
        check
      );
    }
    throw new BridgeError("UNSUPPORTED_TOOL");
  }
  async prepare(kind, payload, b, check) {
    if (b.assurance !== "verified") throw new BridgeError("ACCOUNT_UNVERIFIED");
    check();
    if (kind === "comment") return this.program(b, { action: "prepare_comment", ...payload });
    if (kind !== "post") throw new BridgeError("UNSUPPORTED_TOOL");
    const fileDigests = [];
    for (const file of payload.images) {
      if (!file.startsWith("/")) throw new BridgeError("INVALID_FILE");
      const s = await stat(file);
      if (!s.isFile() || s.size > 20 * 1024 * 1024) throw new BridgeError("INVALID_FILE");
      const bytes = await readFile(file);
      fileDigests.push(hash(bytes.toString("base64")));
      if (!(bytes[0] === 255 && bytes[1] === 216 || bytes[0] === 137 && bytes.subarray(1, 4).toString() === "PNG"))
        throw new BridgeError("INVALID_FILE");
    }
    const o = await this.inspect(b);
    assertObservation(b, o);
    if (o.origin !== "https://creator.xiaohongshu.com")
      throw new BridgeError("TARGET_CHANGED", "\u8BF7\u7528\u6237\u5728\u7ED1\u5B9A\u6807\u7B7E\u9875\u6253\u5F00\u521B\u4F5C\u4E2D\u5FC3\uFF0C\u518D\u91CD\u65B0\u6838\u9A8C\u8D26\u53F7");
    check();
    await this.command("set-file-input", {
      session: b.session,
      contextId: b.profile,
      page: b.target,
      selector: "input[type=file]",
      files: payload.images
    });
    const result = await this.program(b, {
      action: "prepare_post",
      ...payload,
      image_count: payload.images.length
    });
    const after = await Promise.all(
      payload.images.map(async (file) => hash((await readFile(file)).toString("base64")))
    );
    if (JSON.stringify(after) !== JSON.stringify(fileDigests))
      throw new BridgeError("PAYLOAD_CHANGED");
    result.checkpoint.files = fileDigests;
    return result;
  }
  async dispatch(op, b, check) {
    check();
    if (op.kind === "post") {
      const files = await Promise.all(
        op.payload.images.map(
          async (file) => hash((await readFile(file)).toString("base64"))
        )
      );
      if (JSON.stringify(files) !== JSON.stringify(op.prepared?.files))
        throw new BridgeError("PAYLOAD_CHANGED");
    }
    await this.program(b, {
      action: "dispatch",
      kind: op.kind,
      ...op.payload,
      prepared: op.prepared,
      operation_id: op.operation_id,
      payload_digest: op.digest,
      image_count: op.payload.images?.length
    });
    return this.reconcile(op, b);
  }
  async reconcile(op, b) {
    return this.program(b, {
      action: "reconcile",
      kind: op.kind,
      ...op.payload,
      prepared: op.prepared,
      operation_id: op.operation_id,
      payload_digest: op.digest
    });
  }
  async unbind(b) {
    await this.command("close-window", { session: b.session, contextId: b.profile });
  }
};

// server/src/adapters/wechat.ts
import { spawn } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";
import { join as join3 } from "node:path";
var WechatAdapter = class {
  constructor(root2) {
    this.root = root2;
  }
  root;
  async worker(input2) {
    return new Promise((resolve, reject) => {
      const fd2 = Number(process.env.SESSION_BRIDGE_LOCK_FD);
      const inherited = Number.isInteger(fd2) && fd2 >= 3;
      const child = spawn(
        join3(this.root, "wechat-worker/.venv/bin/python"),
        [join3(this.root, "wechat-worker/worker.py")],
        {
          stdio: inherited ? ["pipe", "pipe", "pipe", fd2] : ["pipe", "pipe", "pipe"],
          env: { ...process.env, SESSION_BRIDGE_LOCK_FD: inherited ? "3" : "" },
          shell: false
        }
      );
      let output = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 12e3);
      child.stdout.on("data", (d) => {
        output += d;
        if (output.length > 262144) {
          child.kill("SIGKILL");
        }
      });
      child.stderr.resume();
      child.on("error", () => {
        clearTimeout(timer);
        reject(new BridgeError("WORKER_NOT_INSTALLED"));
      });
      child.on("close", () => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new BridgeError("TIMEOUT_BEFORE_DISPATCH"));
          return;
        }
        try {
          const r = JSON.parse(output);
          if (r.ok) resolve(r.data);
          else reject(new BridgeError(r.error));
        } catch {
          reject(new BridgeError("WECHAT_AX_UNAVAILABLE"));
        }
      });
      child.stdin.end(JSON.stringify({ ...input2, deadline: Date.now() + 1e4 }));
    });
  }
  async doctor() {
    if (process.platform !== "darwin")
      return { channel: "wechat_macos", status: "unsupported", error: "UNSUPPORTED_PLATFORM" };
    try {
      return await this.worker({ action: "doctor" });
    } catch (e) {
      return {
        channel: "wechat_macos",
        status: "unavailable",
        error: e instanceof BridgeError ? e.code : "WECHAT_AX_UNAVAILABLE"
      };
    }
  }
  async bind(a) {
    const screen = a.read_only_backend === "screen";
    const o = await this.worker({
      action: "bind",
      ...screen ? { backend: "screen-readonly", screen_chat_name: a.expected_chat } : {}
    });
    if (o.blocker) throw new BridgeError(o.blocker);
    if (a.expected_account && o.account !== hash(a.expected_account))
      throw new BridgeError("ACCOUNT_MISMATCH");
    if (!o.account && !a.user_bound) throw new BridgeError("ACCOUNT_UNVERIFIED");
    return {
      channel: "wechat_macos",
      backend: screen ? "screen-readonly" : "native-ax",
      backend_version: "0.1.0",
      connection: o.connection,
      target: o.target,
      account: o.account,
      assurance: o.account ? "verified" : "user_bound",
      ...screen ? {
        screen_chat_name: a.expected_chat,
        screen_chat_ref: hashScreenRef(o.target, a.expected_chat)
      } : {}
    };
  }
  async inspect(b) {
    return this.worker({ action: "inspect", binding: b });
  }
  async execute(tool, a, b, _checkpoint, check) {
    check();
    if (tool === "wechat_find_chat")
      return this.worker({ action: "find_chat", name: a.name, binding: b });
    if (tool === "wechat_read_messages")
      return this.worker({ action: "read", chat_ref: a.chat_ref, limit: a.limit, binding: b });
    throw new BridgeError("UNSUPPORTED_TOOL");
  }
  async prepare(kind, payload, b, check) {
    if (b.backend === "screen-readonly") throw new BridgeError("SCREEN_MODE_READ_ONLY");
    if (kind !== "message") throw new BridgeError("UNSUPPORTED_TOOL");
    check();
    return this.worker({ action: "prepare", ...payload, binding: b });
  }
  receipt(op) {
    const dir = join3(statePath(), "receipts");
    secureDir(dir);
    return {
      operation_id: op.operation_id,
      payload_digest: op.digest,
      receipt_path: join3(dir, op.operation_id + ".json")
    };
  }
  async dispatch(op, b, check) {
    if (b.backend === "screen-readonly") throw new BridgeError("SCREEN_MODE_READ_ONLY");
    check();
    return this.worker({
      action: "dispatch",
      ...op.payload,
      prepared: op.prepared,
      ...this.receipt(op),
      binding: b
    });
  }
  async reconcile(op, b) {
    if (b.backend === "screen-readonly") throw new BridgeError("SCREEN_MODE_READ_ONLY");
    return this.worker({
      action: "reconcile",
      ...op.payload,
      prepared: op.prepared,
      ...this.receipt(op),
      binding: b
    });
  }
};
function hashScreenRef(target, chat2) {
  return createHash2("sha256").update(JSON.stringify({ target, chat: chat2, backend: "screen-readonly" })).digest("hex");
}

// server/src/adapters/instagram-program.ts
async function instagramProgram(p) {
  try {
    if (!["inspect", "search_start", "search_result", "post_open", "post_read"].includes(p.action))
      throw new Error("INSTAGRAM_READ_ONLY");
    const origins = ["https://www.instagram.com", "https://instagram.com"];
    if (!origins.includes(location.origin)) throw new Error("TARGET_CHANGED");
    const visible = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !e.closest('[hidden],[aria-hidden="true"]');
    };
    const list = (selector, root2 = document) => Array.from(root2.querySelectorAll(selector)).filter(visible);
    const text2 = (e) => (e.textContent || "").trim();
    const renderedText = (e) => {
      const visit = (node) => !visible(node) ? "" : Array.from(node.childNodes).map(
        (n) => n.nodeType === Node.TEXT_NODE ? n.textContent || "" : n instanceof Element ? n.tagName === "BR" ? "\n" : visit(n) : ""
      ).join("");
      return visit(e).trim();
    };
    const parsePost = (raw2) => {
      try {
        const u = new URL(raw2, location.href);
        const m = u.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]{1,64})\/$/);
        if (!origins.includes(u.origin) || u.username || u.password || !m) return void 0;
        return {
          shortcode: m[2],
          kind: m[1],
          post_url: `https://www.instagram.com/${m[1]}/${m[2]}/`
        };
      } catch {
        return void 0;
      }
    };
    const accountRaw = () => {
      const candidates = list("a[href]").filter(
        (a) => ["Profile", "\u4E2A\u4EBA\u4E3B\u9875", "\u4E2A\u4EBA\u8D44\u6599", "\uD504\uB85C\uD544"].includes(text2(a)) || !!a.querySelector(
          'svg[aria-label="Profile"],svg[aria-label="\u4E2A\u4EBA\u4E3B\u9875"],svg[aria-label="\u4E2A\u4EBA\u8D44\u6599"],svg[aria-label="\uD504\uB85C\uD544"]'
        )
      );
      const names = candidates.map((a) => {
        try {
          const u = new URL(a.getAttribute("href") || "", location.href);
          return origins.includes(u.origin) && !u.username && !u.password ? u.pathname.match(/^\/([A-Za-z0-9._]+)\/$/)?.[1] : void 0;
        } catch {
          return void 0;
        }
      }).filter(Boolean);
      return names.length === 1 ? names[0] : void 0;
    };
    const blocker = () => {
      if (/^\/(challenge|checkpoint)\//.test(location.pathname) || list('iframe[src*="captcha"], [data-testid="captcha"]').length)
        return "HUMAN_VERIFICATION_REQUIRED";
      if (location.pathname.startsWith("/accounts/login") || list('input[type="password"]').length)
        return "AUTH_REQUIRED";
      for (const dialog of list('[role="dialog"], [role="alert"]')) {
        const outsideArticle = (node) => node.nodeType === Node.TEXT_NODE ? node.textContent || "" : node instanceof Element && (!visible(node) || node.matches('article,[data-testid="post-caption"]')) ? "" : Array.from(node.childNodes).map(outsideArticle).join("");
        const t = outsideArticle(dialog);
        if (/确认.*身份|安全验证|security check|confirm.*identity/i.test(t))
          return "HUMAN_VERIFICATION_REQUIRED";
        if (/请稍后重试|Try again later/i.test(t)) return "POLICY_LIMITED";
        if (/登录|Log in/i.test(t) && list('a[href*="/accounts/login"]', dialog).length)
          return "AUTH_REQUIRED";
      }
      return void 0;
    };
    const w = window;
    const state = w.__codexInstagramBridge || (w.__codexInstagramBridge = { document: crypto.randomUUID() });
    const raw = accountRaw();
    const account = raw ? Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(raw)))
      )
    ).map((v) => v.toString(16).padStart(2, "0")).join("") : void 0;
    const guard = () => {
      if (!origins.includes(location.origin)) throw new Error("TARGET_CHANGED");
      const block = blocker();
      if (block) throw new Error(block);
      if (raw !== accountRaw()) throw new Error("ACCOUNT_MISMATCH");
      if (p.deadline && Date.now() > p.deadline) throw new Error("TIMEOUT_BEFORE_DISPATCH");
      if (p.guard && (p.guard.document !== state.document || p.guard.origin !== location.origin))
        throw new Error("TARGET_CHANGED");
      if (p.guard?.account && p.guard.account !== account) throw new Error("ACCOUNT_MISMATCH");
    };
    if (p.action === "inspect")
      return {
        document: state.document,
        origin: location.origin,
        account,
        blocker: blocker(),
        evidence: { source: "instagram_visible_dom", partial: true }
      };
    guard();
    const main = () => {
      const roots = list('main, [role="main"]');
      if (roots.length !== 1) throw new Error("UI_CHANGED");
      return roots[0];
    };
    const cards = () => {
      const seen = /* @__PURE__ */ new Set();
      return list("a[href]", main()).flatMap((a) => {
        const post = parsePost(a.getAttribute("href") || "");
        if (!post || seen.has(post.post_url)) return [];
        seen.add(post.post_url);
        const img = list("img[alt]", a)[0];
        return [
          {
            type: "post",
            ...post,
            preview: (img?.getAttribute("alt") || renderedText(a)).slice(0, 500)
          }
        ];
      });
    };
    const searchFields = () => list(
      'input[aria-label="\u641C\u7D22\u8F93\u5165"], input[aria-label="Search input"], input[placeholder="\u641C\u7D22"], input[placeholder="Search"]'
    );
    if (p.action === "search_start") {
      if (typeof p.request_id !== "string" || !p.request_id) throw new Error("UI_CHANGED");
      const fields = searchFields();
      if (!fields.length) {
        if (state.openingSearch !== p.request_id) {
          const links = list("a[href]").filter((a) => {
            try {
              const u = new URL(a.getAttribute("href") || "", location.href);
              return origins.includes(u.origin) && u.pathname === "/explore/" && /^(搜索|Search)$/.test(text2(a));
            } catch {
              return false;
            }
          });
          if (links.length !== 1) throw new Error("UI_CHANGED");
          guard();
          state.openingSearch = p.request_id;
          links[0].click();
        }
        return { pending: true };
      }
      if (fields.length !== 1 || fields[0].disabled || fields[0].readOnly)
        throw new Error("UI_CHANGED");
      const field = fields[0];
      const buttons = list('button,[role="button"]', field.parentElement).filter(
        (b) => /^(搜索|Search)$/.test(text2(b)) || !!b.querySelector('svg[aria-label="\u641C\u7D22"],svg[aria-label="Search"]')
      );
      if (buttons.length !== 1) throw new Error("UI_CHANGED");
      const query = String(p.query);
      if (state.search?.request_id === p.request_id && state.search.submitted && state.search.query === query && field.value === query)
        return { submitted: true };
      state.search = {
        request_id: p.request_id,
        query,
        old: JSON.stringify(cards().map((c) => c.post_url)),
        submitted: false
      };
      guard();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, query);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      guard();
      const freshFields = searchFields();
      if (freshFields.length !== 1 || freshFields[0] !== field || field.disabled || field.readOnly || !field.isConnected || field.value !== query)
        throw new Error("UI_CHANGED");
      state.search.submitted = true;
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true
        })
      );
      field.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true
        })
      );
      return { submitted: true };
    }
    if (p.action === "search_result") {
      const fields = searchFields();
      if (!state.search || state.search.request_id !== p.request_id || state.search.query !== p.query || fields.length !== 1 || fields[0].value !== p.query)
        throw new Error("UI_CHANGED");
      const url = new URL(location.href);
      if (url.pathname !== "/explore/search/keyword/" || url.searchParams.get("q") !== p.query)
        return { pending: true };
      const results = cards();
      if (!results.length || JSON.stringify(results.map((c) => c.post_url)) === state.search.old)
        return { pending: true };
      return {
        query: p.query,
        results: results.slice(0, Math.min(p.limit || 3, 10)),
        source: "instagram_visible_dom",
        partial: true,
        observed_at: Date.now()
      };
    }
    const desired = parsePost(p.post_url);
    if (!desired || desired.post_url !== p.post_url.replace("https://instagram.com/", "https://www.instagram.com/"))
      throw new Error("INVALID_POST_URL");
    const current = parsePost(location.href);
    if (p.action === "post_open") {
      if (current?.post_url === desired.post_url) return { opened: true };
      const links = list("a[href]", main()).filter(
        (a) => parsePost(a.getAttribute("href") || "")?.post_url === desired.post_url
      );
      if (links.length !== 1) throw new Error("POST_NOT_VISIBLE");
      guard();
      links[0].click();
      return { opened: true };
    }
    if (current?.post_url !== desired.post_url) return { pending: true };
    const articles = list("article");
    if (!articles.length) return { pending: true };
    if (articles.length !== 1) throw new Error("UI_CHANGED");
    const permalink = list("a[href]", articles[0]).filter((a) => list("time[datetime]", a).length > 0).map((a) => parsePost(a.getAttribute("href") || "")?.post_url).filter(Boolean);
    if (permalink.length !== 1 || permalink[0] !== desired.post_url) return { pending: true };
    const captions = list('h1, [data-testid="post-caption"]', articles[0]);
    if (!captions.length) return { pending: true };
    if (captions.length !== 1) throw new Error("UI_CHANGED");
    const caption = renderedText(captions[0]);
    if (!caption) throw new Error("POST_TEXT_UNAVAILABLE");
    guard();
    return {
      ...desired,
      caption: caption.slice(0, 2e4),
      source: "instagram_visible_dom",
      partial: true,
      comments: [],
      observed_at: Date.now()
    };
  } catch (e) {
    const code = e.message;
    const known = [
      "INSTAGRAM_READ_ONLY",
      "TARGET_CHANGED",
      "ACCOUNT_MISMATCH",
      "AUTH_REQUIRED",
      "HUMAN_VERIFICATION_REQUIRED",
      "POLICY_LIMITED",
      "UI_CHANGED",
      "TIMEOUT_BEFORE_DISPATCH",
      "INVALID_POST_URL",
      "POST_NOT_VISIBLE",
      "POST_TEXT_UNAVAILABLE"
    ];
    return { bridge_error: known.includes(code) ? code : "UI_CHANGED" };
  }
}

// server/src/adapters/instagram.ts
var InstagramAdapter = class extends BrowserAdapter {
  constructor(root2) {
    super(root2, "instagram_web", instagramProgram);
  }
  async execute(tool, a, b, checkpoint, check) {
    if (b.channel !== "instagram_web") throw new BridgeError("CHANNEL_MISMATCH");
    check();
    if (tool === "ig_search") {
      await this.poll(
        b,
        { action: "search_start", query: a.query, request_id: a.client_request_id },
        check
      );
      checkpoint("instagram_search_submitted");
      return this.poll(
        b,
        {
          action: "search_result",
          query: a.query,
          limit: a.limit,
          request_id: a.client_request_id
        },
        check
      );
    }
    if (tool === "ig_read_post") {
      await this.program(b, { action: "post_open", post_url: a.post_url });
      checkpoint("instagram_post_opened");
      return this.poll(b, { action: "post_read", post_url: a.post_url }, check);
    }
    throw new BridgeError("INSTAGRAM_READ_ONLY");
  }
  async prepare(_kind, _payload, _b, _check) {
    throw new BridgeError("INSTAGRAM_READ_ONLY");
  }
  async dispatch(_op, _b, _check) {
    throw new BridgeError("INSTAGRAM_READ_ONLY");
  }
  async reconcile(_op, _b) {
    throw new BridgeError("INSTAGRAM_READ_ONLY");
  }
};

// server/src/schemas.ts
import { z } from "zod";
var ref = z.string().min(1).max(256);
var text = z.string().min(1).max(1e4);
var binding = { binding_id: ref };
var task = { ...binding, client_request_id: ref };
var scope = z.object({
  scope_ref: ref,
  action: ref,
  target_ref: ref,
  payload_digest: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
var commit = z.object({ ...task, operation_id: ref, payload_version: z.number().int().positive(), scope }).strict();
var chat = ref;
var note = z.string().regex(/^[a-f0-9]{24}$/);
var schemas = {
  bridge_doctor: z.object({ channel: z.enum(["xiaohongshu_web", "instagram_web", "wechat_macos"]).optional() }).strict(),
  bridge_bind: z.object({
    channel: z.enum(["xiaohongshu_web", "instagram_web", "wechat_macos"]),
    profile: ref.optional(),
    expected_account: ref.optional(),
    user_bound: z.boolean().default(false),
    read_only_backend: z.literal("screen").optional(),
    expected_chat: z.string().min(1).max(100).optional()
  }).strict().refine(
    (a) => a.read_only_backend ? a.channel === "wechat_macos" && a.user_bound && !!a.expected_chat && !a.expected_account : !a.expected_chat,
    "\u5C4F\u5E55\u53EA\u8BFB\u6A21\u5F0F\u4EC5\u9650\u7528\u6237\u660E\u786E\u9009\u62E9\u7684\u5FAE\u4FE1\u804A\u5929\uFF0C\u9700\u8981 user_bound \u4E0E expected_chat"
  ),
  bridge_inspect_session: z.object(binding).strict(),
  bridge_unbind: z.object(binding).strict(),
  bridge_get_task: z.object({
    task_id: ref.optional(),
    binding_id: ref.optional(),
    client_request_id: ref.optional()
  }).strict().refine(
    (a) => !!a.task_id || !!(a.binding_id && a.client_request_id),
    "\u9700\u8981 task_id \u6216\u7ED1\u5B9A\u4E0E\u8BF7\u6C42 ID"
  ),
  bridge_cancel_task: z.object({ task_id: ref }).strict(),
  bridge_resume_task: z.object({ task_id: ref }).strict(),
  bridge_reconcile_operation: z.object({ operation_id: ref }).strict(),
  xhs_search: z.object({
    ...task,
    query: z.string().min(1).max(100),
    limit: z.number().int().min(1).max(20).default(5)
  }).strict(),
  xhs_read_note: z.object({ ...task, note_id: note, comment_limit: z.number().int().min(0).max(20).default(0) }).strict(),
  ig_search: z.object({
    ...task,
    query: z.string().trim().min(1).max(100),
    limit: z.number().int().min(1).max(10).default(3)
  }).strict(),
  ig_read_post: z.object({
    ...task,
    post_url: z.string().max(256).regex(/^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]{1,64}\/$/)
  }).strict(),
  xhs_prepare_post: z.object({
    ...task,
    payload: z.object({
      title: z.string().min(1).max(20),
      body: text,
      images: z.array(z.string().min(1).max(4096)).min(1).max(9)
    }).strict()
  }).strict(),
  xhs_prepare_comment: z.object({
    ...task,
    payload: z.object({ note_id: note, body: z.string().min(1).max(500) }).strict()
  }).strict(),
  wechat_find_chat: z.object({ ...task, name: z.string().min(1).max(100) }).strict(),
  wechat_read_messages: z.object({ ...task, chat_ref: chat, limit: z.number().int().min(1).max(50).default(10) }).strict(),
  wechat_prepare_message: z.object({ ...task, payload: z.object({ chat_ref: chat, body: text }).strict() }).strict(),
  xhs_publish_post: commit,
  xhs_submit_comment: commit,
  wechat_send_message: commit
};
var input = (tool, args) => {
  const schema = schemas[tool];
  if (!schema) throw new Error("UNKNOWN_TOOL");
  return schema.parse(args);
};

// server/src/daemon.ts
process.umask(63);
var fd = Number(process.env.SESSION_BRIDGE_LOCK_FD);
if (!Number.isInteger(fd) || fd < 3) throw new Error("\u5FC5\u987B\u901A\u8FC7 OS \u9501\u542F\u52A8");
fstatSync(fd);
var root = fileURLToPath(new URL("../../", import.meta.url));
var path = statePath();
var store = new Store(path);
store.recover();
store.purge();
var coordinator = new Coordinator(store, {
  xiaohongshu_web: new BrowserAdapter(root),
  instagram_web: new InstagramAdapter(root),
  wechat_macos: new WechatAdapter(root)
});
var socket = join4(path, "bridge.sock");
if (existsSync2(socket)) {
  if (lstatSync2(socket).isSymbolicLink() || !lstatSync2(socket).isSocket())
    throw new Error("\u4E0D\u5B89\u5168\u7684 IPC \u8DEF\u5F84");
  unlinkSync(socket);
}
var server = createServer((client) => {
  let body = "";
  let handled = false;
  client.setTimeout(22e3, () => client.destroy());
  client.on("error", () => {
  });
  client.on("data", async (chunk) => {
    if (handled) return;
    body += chunk;
    if (body.length > 262144) {
      client.destroy();
      return;
    }
    const nl = body.indexOf("\n");
    if (nl < 0) return;
    handled = true;
    try {
      const envelope = JSON.parse(body.slice(0, nl));
      if (envelope.tool !== "__session_bridge_rpc_v2" || envelope.args?.version !== 2)
        throw new BridgeError("COORDINATOR_UPGRADE_REQUIRED");
      const r = envelope.args;
      const args = input(r.tool, r.args);
      if (process.env.SESSION_BRIDGE_ISOLATED_TEST === "1" && !["bridge_doctor", "bridge_get_task"].includes(r.tool))
        throw new BridgeError("TEST_MODE_READ_ONLY");
      const data = await coordinator.call(r.tool, args);
      client.end(JSON.stringify({ protocol_version: 2, ok: true, data }) + "\n");
    } catch (e) {
      client.end(
        JSON.stringify({
          protocol_version: 2,
          ok: false,
          error: e instanceof BridgeError ? e.code : e?.name === "ZodError" ? "INVALID_INPUT" : "INTERNAL_ERROR"
        }) + "\n"
      );
    }
  });
});
server.listen(socket, () => chmodSync2(socket, 384));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    void coordinator.queue.run(async () => {
      store.close();
      try {
        unlinkSync(socket);
      } catch {
      }
      process.exit(0);
    });
  });
