import { z } from 'zod';
const ref=z.string().min(1).max(256);const text=z.string().min(1).max(10000);const binding={binding_id:ref};const task={...binding,client_request_id:ref};
const scope=z.object({scope_ref:ref,action:ref,target_ref:ref,payload_digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const commit=z.object({...task,operation_id:ref,payload_version:z.number().int().positive(),scope}).strict();
const chat=ref;const note=z.string().regex(/^[a-f0-9]{24}$/);
export const schemas:Record<string,z.ZodTypeAny>={
 bridge_doctor:z.object({}).strict(),
 bridge_bind:z.object({channel:z.enum(['xiaohongshu_web','wechat_macos']),profile:ref.optional(),expected_account:ref.optional(),user_bound:z.boolean().default(false)}).strict(),
 bridge_inspect_session:z.object(binding).strict(),bridge_unbind:z.object(binding).strict(),
 bridge_get_task:z.object({task_id:ref.optional(),binding_id:ref.optional(),client_request_id:ref.optional()}).strict().refine(a=>!!a.task_id||!!(a.binding_id&&a.client_request_id),'需要 task_id 或绑定与请求 ID'),
 bridge_cancel_task:z.object({task_id:ref}).strict(),bridge_resume_task:z.object({task_id:ref}).strict(),bridge_reconcile_operation:z.object({operation_id:ref}).strict(),
 xhs_search:z.object({...task,query:z.string().min(1).max(100),limit:z.number().int().min(1).max(20).default(5)}).strict(),
 xhs_read_note:z.object({...task,note_id:note,comment_limit:z.number().int().min(0).max(20).default(0)}).strict(),
 xhs_prepare_post:z.object({...task,payload:z.object({title:z.string().min(1).max(20),body:text,images:z.array(z.string().min(1).max(4096)).min(1).max(9)}).strict()}).strict(),
 xhs_prepare_comment:z.object({...task,payload:z.object({note_id:note,body:z.string().min(1).max(500)}).strict()}).strict(),
 wechat_find_chat:z.object({...task,name:z.string().min(1).max(100)}).strict(),
 wechat_read_messages:z.object({...task,chat_ref:chat,limit:z.number().int().min(1).max(50).default(10)}).strict(),
 wechat_prepare_message:z.object({...task,payload:z.object({chat_ref:chat,body:text}).strict()}).strict(),
 xhs_publish_post:commit,xhs_submit_comment:commit,wechat_send_message:commit,
};
export const descriptions:Record<string,string>={bridge_doctor:'检查本机环境、桥接和权限；不登录、不打开新页面。',bridge_bind:'绑定用户当前选择的已有 Chrome 页或微信窗口；先检查 doctor。',bridge_inspect_session:'核对已有绑定的目标与账号证据。',bridge_unbind:'解除绑定，保留用户窗口。',bridge_get_task:'按任务 ID 或稳定请求 ID 查询任务。',bridge_cancel_task:'停止后续步骤；不会撤销已经提交的副作用。',bridge_resume_task:'人工完成后显式重新核验并恢复；重复调用幂等。',bridge_reconcile_operation:'仅观察未知提交结果，不重新提交。',xhs_search:'在绑定页进行站内搜索，有限读取新结果。',xhs_read_note:'读取当前页或当前结果中明确笔记的可见正文。',xhs_prepare_post:'在用户已打开的创作中心准备图文草稿；不发布。',xhs_prepare_comment:'准备明确笔记的评论草稿；不提交。',wechat_find_chat:'定位唯一可见聊天；同名候选拒绝选择。',wechat_read_messages:'读取指定聊天中有限可访问消息；返回部分结果。',wechat_prepare_message:'在已核验聊天中准备文字草稿；不发送。',xhs_publish_post:'在用户明确授权下发布已准备的版本；需本地 trusted-host 模式。',xhs_submit_comment:'在用户明确授权下提交已准备的评论；结果未知禁止重发。',wechat_send_message:'在用户明确授权下发送已准备的文字；只确认界面证据。'};
export const input = (tool:string,args:unknown)=>{const schema=schemas[tool];if(!schema)throw new Error('UNKNOWN_TOOL');return schema.parse(args);};
