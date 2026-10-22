import { createHash, randomUUID } from 'node:crypto';
export const id = (prefix:string) => `${prefix}_${randomUUID()}`;
export const now = () => new Date().toISOString();
export const hash = (v:unknown):string => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
function canonical(v:any):any { if(Array.isArray(v)) return v.map(canonical); if(v && typeof v==='object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])); return v; }
export class BridgeError extends Error { constructor(public code:string, public detail:string=code) { super(code===detail?code:`${code}: ${detail}`); } }
export type Channel = 'xiaohongshu_web'|'wechat_macos';
export type Binding = { binding_id:string; channel:Channel; backend:string; backend_version:string; profile?:string; connection:string; target:string; account?:string; assurance:'verified'|'user_bound'; generation:number; state:'READY'|'PAUSED'|'NEEDS_REBIND'|'CLOSED'; session?:string; document?:string; created_at:string; };
export type Observation = { connection:string; target:string; account?:string; origin?:string; document?:string; blocker?:string; evidence?:Record<string,unknown>; };
export type Task = { task_id:string; binding_id:string; client_request_id:string; fingerprint:string; tool:string; args:any; status:string; checkpoint:string; result?:any; error?:{code:string;retryable:boolean}; created_at:string; updated_at:string; assisted?:boolean; cancelled?:boolean; operation_id?:string; };
export type Operation = { operation_id:string; binding_id:string; kind:'post'|'comment'|'message'; payload:any; payload_version:number; digest:string; target_ref:string; binding_generation:number; status:string; dispatch_task_id?:string; scope?:{scope_ref:string; action:string; target_ref:string; payload_digest:string}; prepared?:any; evidence?:any; history:any[]; created_at:string; updated_at:string; };
export interface Adapter {
  doctor():Promise<any>;
  bind(input:any):Promise<Omit<Binding,'binding_id'|'created_at'|'generation'|'state'>>;
  inspect(binding:Binding):Promise<Observation>;
  execute(tool:string,args:any,binding:Binding,checkpoint:(step:string)=>void,check:()=>void):Promise<any>;
  prepare(kind:Operation['kind'],payload:any,binding:Binding,check:()=>void):Promise<{target_ref:string;preview:any;checkpoint?:any}>;
  dispatch(op:Operation,binding:Binding,check:()=>void):Promise<any>;
  reconcile(op:Operation,binding:Binding):Promise<any>;
  unbind?(binding:Binding):Promise<void>;
}
export function assertObservation(b:Binding,o:Observation) {
  if(o.connection!==b.connection) throw new BridgeError('TARGET_CHANGED','控制连接已更换，请重新绑定');
  if(o.target!==b.target) throw new BridgeError('TARGET_CHANGED','执行目标已改变');
  if(o.blocker) throw new BridgeError(o.blocker);
  if(b.account && o.account!==b.account) throw new BridgeError('ACCOUNT_MISMATCH','账号证据改变或消失');
  if(b.channel==='xiaohongshu_web' && !['https://www.xiaohongshu.com','https://creator.xiaohongshu.com'].includes(o.origin??'')) throw new BridgeError('TARGET_CHANGED','页面离开允许的来源');
}
