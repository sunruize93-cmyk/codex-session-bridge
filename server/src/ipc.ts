import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeError } from './model.js';
import { statePath,secureDir } from './store.js';
export const root=fileURLToPath(new URL('../../',import.meta.url));
export async function request(tool:string,args:any,autostart=true):Promise<any>{
 const state=statePath();secureDir(state);
 const attempt=()=>new Promise<any>((resolve,reject)=>{const socket=connect(join(state,'bridge.sock'));let output='';const timer=setTimeout(()=>{socket.destroy();reject(new BridgeError('IPC_TIMEOUT'));},20000);socket.once('connect',()=>socket.write(JSON.stringify({tool,args})+'\n'));socket.on('data',d=>{output+=d;if(output.length>1048576){socket.destroy();clearTimeout(timer);reject(new BridgeError('IPC_SIZE_LIMIT'));return;}const end=output.indexOf('\n');if(end<0)return;clearTimeout(timer);socket.end();try{const r=JSON.parse(output.slice(0,end));if(r.ok)resolve(r.data);else reject(new BridgeError(r.error));}catch(e){reject(e);}});socket.on('error',e=>{clearTimeout(timer);reject(e);});socket.on('end',()=>{clearTimeout(timer);if(!output.includes('\n'))reject(new BridgeError('IPC_DISCONNECTED'));});});
 try{return await attempt();}catch(e:any){if(!autostart||!['ENOENT','ECONNREFUSED'].includes(e.code))throw e;}
 const child=spawn(process.env.SESSION_BRIDGE_PYTHON||'python3',[join(root,'scripts/lock-daemon.py'),root,state,process.execPath],{detached:true,stdio:'ignore',env:{...process.env,SESSION_BRIDGE_HOME:state},shell:false});let spawnFailed=false;child.on('error',()=>{spawnFailed=true;});child.unref();
 for(let n=0;n<25;n++){if(spawnFailed)throw new BridgeError('COORDINATOR_START_FAILED');await new Promise(r=>setTimeout(r,100));try{return await attempt();}catch(e:any){if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw e;}}
 throw new BridgeError('RESOURCE_BUSY','协调进程未就绪或旧执行者仍持有 OS 锁');
}
