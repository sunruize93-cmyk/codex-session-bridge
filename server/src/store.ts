import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Binding,Task,Operation } from './model.js';
export const statePath=()=>process.env.SESSION_BRIDGE_HOME || join(homedir(),'Library','Application Support','codex-session-bridge');
export function secureDir(path:string) { if(existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory() || lstatSync(path).uid!==process.getuid?.())) throw new Error('不安全的数据目录'); mkdirSync(path,{recursive:true,mode:0o700}); chmodSync(path,0o700); }
export class Store {
 db:DatabaseSync;
 constructor(public path:string) { secureDir(path); const file=join(path,'tasks.sqlite'); if(existsSync(file) && (lstatSync(file).isSymbolicLink() || lstatSync(file).uid!==process.getuid?.())) throw new Error('不安全的数据库'); this.db=new DatabaseSync(file); chmodSync(file,0o600); this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); PRAGMA user_version=1;'); }
 get<T>(kind:string,id:string):T|undefined { const r=this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id) as any; return r?JSON.parse(r.data):undefined; }
 all<T>(kind:string):T[] { return (this.db.prepare('SELECT data FROM records WHERE kind=?').all(kind) as any[]).map(r=>JSON.parse(r.data)); }
 put(kind:string,v:any) { const key=kind==='binding'?'binding_id':kind==='task'?'task_id':kind==='operation'?'operation_id':'id'; this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,v[key],JSON.stringify(v)); }
 atomic<T>(f:()=>T):T { this.db.exec('BEGIN IMMEDIATE'); try { const r=f(); this.db.exec('COMMIT'); return r; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
 recover() { this.atomic(()=>{ for(const b of this.all<Binding>('binding')) { if(b.state!=='CLOSED') { if(b.state!=='PAUSED')b.state='NEEDS_REBIND'; b.generation++; this.put('binding',b); } } for(const op of this.all<Operation>('operation')) if(['DISPATCHING','VERIFYING'].includes(op.status)) {op.status='OUTCOME_UNKNOWN';this.put('operation',op);} for(const t of this.all<Task>('task')) if(['QUEUED','PRECHECK','RUNNING','VERIFYING'].includes(t.status)) {t.status=t.operation_id && this.get<Operation>('operation',t.operation_id)?.status==='OUTCOME_UNKNOWN'?'OUTCOME_UNKNOWN':'NEEDS_REBIND';this.put('task',t);} }); }
 purge(days=7) { const cutoff=Date.now()-days*86400000; let removed=0; this.atomic(()=>{ for(const kind of ['task','operation']) for(const row of this.all<any>(kind)) if(Date.parse(row.updated_at)<cutoff && ['SUCCEEDED','FAILED','CANCELLED','CONFIRMED','FAILED_BEFORE_DISPATCH'].includes(row.status)) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,row.task_id||row.operation_id);removed++; } }); return removed; }
 close(){this.db.close();}
}
