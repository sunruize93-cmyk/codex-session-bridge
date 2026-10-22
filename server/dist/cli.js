// server/src/ipc.ts
import { connect } from "node:net";
import { spawn } from "node:child_process";
import { join as join2 } from "node:path";
import { fileURLToPath } from "node:url";

// server/src/model.ts
var BridgeError = class extends Error {
  constructor(code, detail = code) {
    super(code === detail ? code : `${code}: ${detail}`);
    this.code = code;
    this.detail = detail;
  }
  code;
  detail;
};

// server/src/store.ts
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
var statePath = () => process.env.SESSION_BRIDGE_HOME || join(homedir(), "Library", "Application Support", "codex-session-bridge");
function secureDir(path) {
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory() || lstatSync(path).uid !== process.getuid?.()))
    throw new Error("\u4E0D\u5B89\u5168\u7684\u6570\u636E\u76EE\u5F55");
  mkdirSync(path, { recursive: true, mode: 448 });
  chmodSync(path, 448);
}
var Store = class {
  constructor(path) {
    this.path = path;
    secureDir(path);
    const file = join(path, "tasks.sqlite");
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
  get(kind, id) {
    const r = this.db.prepare("SELECT data FROM records WHERE kind=? AND id=?").get(kind, id);
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
      for (const task of this.all("task"))
        if (task.result?.operation?.operation_id === operation_id || task.operation_id === operation_id) {
          task.args = {};
          task.result = { payload_forgotten: true };
          task.payload_forgotten = true;
          this.put("task", task);
        }
    });
  }
  close() {
    this.db.close();
  }
};

// server/src/ipc.ts
var root = fileURLToPath(new URL("../../", import.meta.url));
async function request(tool, args2, autostart = true) {
  const state = statePath();
  secureDir(state);
  const attempt = () => new Promise((resolve, reject) => {
    const socket = connect(join2(state, "bridge.sock"));
    let output = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new BridgeError("IPC_TIMEOUT"));
    }, 2e4);
    socket.once(
      "connect",
      () => socket.write(
        JSON.stringify({ tool: "__session_bridge_rpc_v2", args: { version: 2, tool, args: args2 } }) + "\n"
      )
    );
    socket.on("data", (d) => {
      output += d;
      if (output.length > 1048576) {
        socket.destroy();
        clearTimeout(timer);
        reject(new BridgeError("IPC_SIZE_LIMIT"));
        return;
      }
      const end = output.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        const r = JSON.parse(output.slice(0, end));
        if (r.protocol_version !== 2)
          throw new BridgeError(
            "COORDINATOR_UPGRADE_REQUIRED",
            "\u65E7\u534F\u8C03\u8FDB\u7A0B\u4E0D\u517C\u5BB9\uFF1B\u8BF7\u5148\u7ED3\u675F\u672A\u51B3\u4EFB\u52A1\u5E76\u5B89\u5168\u91CD\u542F\u672C\u63D2\u4EF6\uFF0C\u4E0D\u4F1A\u56DE\u9000\u65E7\u534F\u8BAE"
          );
        if (r.ok) resolve(r.data);
        else reject(new BridgeError(r.error));
      } catch (e) {
        reject(e);
      }
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.on("end", () => {
      clearTimeout(timer);
      if (!output.includes("\n")) reject(new BridgeError("IPC_DISCONNECTED"));
    });
  });
  try {
    return await attempt();
  } catch (e) {
    if (!autostart || !["ENOENT", "ECONNREFUSED"].includes(e.code)) throw e;
  }
  const child = spawn(
    process.env.SESSION_BRIDGE_PYTHON || "python3",
    [join2(root, "scripts/lock-daemon.py"), root, state, process.execPath],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, SESSION_BRIDGE_HOME: state },
      shell: false
    }
  );
  let spawnFailed = false;
  child.on("error", () => {
    spawnFailed = true;
  });
  child.unref();
  for (let n = 0; n < 25; n++) {
    if (spawnFailed) throw new BridgeError("COORDINATOR_START_FAILED");
    await new Promise((r) => setTimeout(r, 100));
    try {
      return await attempt();
    } catch (e) {
      if (!["ENOENT", "ECONNREFUSED"].includes(e.code)) throw e;
    }
  }
  throw new BridgeError("RESOURCE_BUSY", "\u534F\u8C03\u8FDB\u7A0B\u672A\u5C31\u7EEA\u6216\u65E7\u6267\u884C\u8005\u4ECD\u6301\u6709 OS \u9501");
}

// server/src/cli.ts
var [command, ...args] = process.argv.slice(2);
try {
  if (command === "doctor")
    console.log(JSON.stringify(await request("bridge_doctor", {}), null, 2));
  else if (command === "write-mode") {
    if (!["trusted-host", "disabled"].includes(args[0]))
      throw new Error("\u7528\u6CD5: write-mode trusted-host|disabled");
    const s = new Store(statePath());
    s.put("config", {
      id: "write",
      enabled: args[0] === "trusted-host",
      trust: "trusted_personal_codex_host"
    });
    s.close();
    console.log("\u5199\u5165\u6A21\u5F0F: " + args[0] + "\uFF1Bscope_ref \u4E0D\u662F\u7528\u6237\u6388\u6743\u8BC1\u660E\u3002");
  } else if (command === "diagnostics") {
    const s = new Store(statePath());
    const tasks = s.all("task");
    const counts = {};
    for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
    console.log(
      JSON.stringify(
        {
          schema_version: "1",
          task_count: tasks.length,
          status_counts: counts,
          operation_count: s.all("operation").length,
          binding_count: s.all("binding").length,
          baseline: "\u672A\u5EFA\u7ACB\u53EF\u6BD4\u8F83\u57FA\u7EBF",
          raw_content_included: false
        },
        null,
        2
      )
    );
    s.close();
  } else if (command === "forget-payload") {
    if (!args[0]) throw new Error("\u9700\u8981 operation_id");
    const s = new Store(statePath());
    s.forgetPayload(args[0]);
    s.close();
    console.log("\u5DF2\u5220\u9664\u6B63\u6587\u5E76\u4FDD\u7559\u64CD\u4F5C\u8D26\u672C\uFF1B\u65E7\u64CD\u4F5C\u4E0D\u4F1A\u91CD\u53D1\u3002");
  } else if (command === "purge") {
    const s = new Store(statePath());
    console.log(JSON.stringify({ removed: s.purge() }));
    s.close();
  } else if (command === "task")
    console.log(JSON.stringify(await request("bridge_get_task", { task_id: args[0] }), null, 2));
  else {
    console.log(
      "\u4E2D\u6587\u4F1A\u8BDD\u6865: doctor | diagnostics | task TASK_ID | purge | forget-payload OPERATION_ID | write-mode trusted-host|disabled"
    );
    process.exitCode = command ? 1 : 0;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : "\u5931\u8D25");
  process.exitCode = 1;
}
