import { request } from './ipc.js';
import { Store,statePath } from './store.js';
const [command,...args]=process.argv.slice(2);
try {
 if(command==='doctor')console.log(JSON.stringify(await request('bridge_doctor',{}),null,2));
 else if(command==='write-mode'){if(!['trusted-host','disabled'].includes(args[0]))throw new Error('用法: write-mode trusted-host|disabled');const s=new Store(statePath());s.put('config',{id:'write',enabled:args[0]==='trusted-host',trust:'trusted_personal_codex_host'});s.close();console.log('写入模式: '+args[0]+'；scope_ref 不是用户授权证明。');}
 else if(command==='diagnostics'){const s=new Store(statePath());const tasks=s.all<any>('task');const counts:Record<string,number>={};for(const t of tasks)counts[t.status]=(counts[t.status]||0)+1;console.log(JSON.stringify({schema_version:'1',task_count:tasks.length,status_counts:counts,operation_count:s.all('operation').length,binding_count:s.all('binding').length,baseline:'未建立可比较基线',raw_content_included:false},null,2));s.close();}
 else if(command==='purge'){const s=new Store(statePath());console.log(JSON.stringify({removed:s.purge()}));s.close();}
 else if(command==='task')console.log(JSON.stringify(await request('bridge_get_task',{task_id:args[0]}),null,2));
 else {console.log('中文会话桥: doctor | diagnostics | task TASK_ID | purge | write-mode trusted-host|disabled');process.exitCode=command?1:0;}
}catch(e){console.error(e instanceof Error?e.message:'失败');process.exitCode=1;}
