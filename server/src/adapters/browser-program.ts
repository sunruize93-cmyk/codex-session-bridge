// 固定页面程序。所有外部参数只通过 JSON 数据传入；返回文本仍属于不可信来源。
export async function browserProgram(p:any):Promise<any>{try {
 const visible=(e:Element)=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
 const list=(s:string)=>Array.from(document.querySelectorAll(s)).filter(visible) as HTMLElement[];
 const one=(s:string)=>{const es=list(s);if(es.length!==1)throw new Error('UI_CHANGED');return es[0];};
 const value=(e:any)=>String(e.value??e.innerText??'');
 const profile=list('a.user[href*="/user/profile/"], .user a[href*="/user/profile/"], .side-bar a[href*="/user/profile/"]');
 const account=profile.length===1?profile[0].getAttribute('href')?.match(/\/user\/profile\/([a-f0-9]{24})/)?.[1]:undefined;
 const verification=list('.captcha-container, #captcha, [role="dialog"][aria-label*="验证"], iframe[src*="captcha"], .verify-modal').length>0;
 const login=list('.login-container, .login-modal, .qrcode-login').length>0;
 const blocker=verification?'HUMAN_VERIFICATION_REQUIRED':login?'AUTH_REQUIRED':undefined;
 const w=window as any;const documentKey='__codexSessionBridgeDocument';
 if(!w[documentKey])w[documentKey]=crypto.randomUUID();
 const accountHash=account?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(account))))).map(n=>n.toString(16).padStart(2,'0')).join(''):undefined;
 const observation={origin:location.origin,account:accountHash,document:w[documentKey],blocker};
 if(p.action==='inspect')return observation;
 if(blocker)throw new Error(blocker);
 if(p.guard?.document!==w[documentKey]||p.guard?.origin!==location.origin||(p.guard?.account && p.guard.account!==accountHash))throw new Error('TARGET_CHANGED');
 const fresh=()=>{if(Date.now()>p.deadline)throw new Error('TARGET_CHANGED');};
 const set=(el:any,text:string)=>{fresh();if(el.isContentEditable){el.textContent=text;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));}else{const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}if(value(el)!==text)throw new Error('UI_CHANGED');};
 const noteId=()=>location.pathname.match(/\/(?:explore|discovery\/item)\/([a-f0-9]{24})/)?.[1]||list('.note-detail-mask a[href*="/explore/"]').map(e=>e.getAttribute('href')?.match(/\/explore\/([a-f0-9]{24})/)?.[1]).find(Boolean);
 const buttons=(label:string)=>list('button,[role="button"],.publishBtn').filter(e=>e.innerText.trim()===label && !(e as HTMLButtonElement).disabled);
 const press=(label:string)=>{fresh();const b=buttons(label);if(b.length!==1)throw new Error('UI_CHANGED');b[0].click();};
 if(p.action==='search_start'){
  const field=one('input#search-input, input[placeholder="搜索小红书"]');set(field,p.query);
  const old=list('section.note-item, .note-item, [data-testid="note-card"]');w.__csbSearch={query:p.query,old:old.map(e=>e.outerHTML).join(''),changed:false};
  const observer=new MutationObserver(records=>{if(records.some(r=>Array.from(r.addedNodes).concat(Array.from(r.removedNodes)).some(n=>n instanceof Element&&(n.matches('section.note-item,.note-item,[data-testid="note-card"]')||n.querySelector('section.note-item,.note-item,[data-testid="note-card"]')))))w.__csbSearch.changed=true;});observer.observe(document.body,{childList:true,subtree:true});w.__csbObserver?.disconnect();w.__csbObserver=observer;
  const submit=list('.search-icon, .input-button, button[aria-label="搜索"]');if(submit.length!==1)throw new Error('UI_CHANGED');fresh();submit[0].click();return {submitted:true};
 }
 if(p.action==='search_result'){
  const state=w.__csbSearch;const field=one('input#search-input, input[placeholder="搜索小红书"]');const cards=list('section.note-item, .note-item, [data-testid="note-card"]');
  if(!state||state.query!==p.query||value(field)!==p.query||new URL(location.href).searchParams.get('keyword')!==p.query||cards.map(e=>e.outerHTML).join('')===state.old)return {pending:true};
  const results=cards.map(e=>{const a=e.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"]');const href=a?.getAttribute('href')||'';return {note_id:href.match(/\/(?:explore|discovery\/item)\/([a-f0-9]{24})/)?.[1],title:(e.querySelector('.title')?.textContent||e.textContent||'').trim().slice(0,500)};}).filter(x=>x.note_id).slice(0,p.limit);
  if(!results.length)return {pending:true};return {query:p.query,results,partial:true,source:'visible_dom',observed_at:new Date().toISOString()};
 }
 if(p.action==='note_open'){
  if(noteId()===p.note_id)return {opened:true};const a=list('a[href*="/explore/"],a[href*="/discovery/item/"]').filter(e=>e.getAttribute('href')?.match(/\/(?:explore|discovery\/item)\/([a-f0-9]{24})/)?.[1]===p.note_id);if(a.length!==1)throw new Error('UI_CHANGED');fresh();a[0].click();return {opened:true};
 }
 if(p.action==='note_read'){
  if(noteId()!==p.note_id)return {pending:true};const body=one('#detail-desc, .note-scroller .desc, [data-testid="note-body"]');return {note_id:p.note_id,title:list('#detail-title,.note-scroller .title')[0]?.textContent?.trim()||'',body:body.innerText.slice(0,30000),comments:list('.comment-item .content').slice(0,p.comment_limit).map(e=>e.innerText.slice(0,3000)),partial:true,source:'visible_dom',observed_at:new Date().toISOString()};
 }
 if(p.action==='prepare_comment'){
  if(noteId()!==p.note_id)throw new Error('TARGET_CHANGED');const field=one('.comment-input [contenteditable="true"], textarea.comment-input, #content-textarea');set(field,p.body);return {target_ref:p.note_id,preview:{note_id:p.note_id,body:value(field)},checkpoint:{before_ids:list('.comment-item[id],.comment-item[data-comment-id]').map(e=>e.getAttribute('data-comment-id')||e.id)}};
 }
 if(p.action==='prepare_post'){
  if(location.origin!=='https://creator.xiaohongshu.com')throw new Error('TARGET_CHANGED');set(one('input[placeholder*="标题"]'),p.title);set(one('.tiptap[contenteditable="true"],.ql-editor[contenteditable="true"]'),p.body);const images=list('.img-preview-area img, .upload-img-item img');if(images.length!==p.image_count)throw new Error('UI_CHANGED');return {target_ref:'creator_post',preview:{title:p.title,body:p.body,image_count:images.length},checkpoint:{image_sources:images.map(e=>(e as HTMLImageElement).src),before_ids:list('.publish-success [data-note-id]').map(e=>e.getAttribute('data-note-id'))}};
 }
 if(p.action==='dispatch'){
  // 原子页面任务内再次核验草稿和目标，然后只点击一次。
  if(p.kind==='comment') {if(noteId()!==p.note_id||value(one('.comment-input [contenteditable="true"],textarea.comment-input,#content-textarea'))!==p.body)throw new Error('PAYLOAD_CHANGED');press('发送');}
  else {if(location.origin!=='https://creator.xiaohongshu.com'||value(one('input[placeholder*="标题"]'))!==p.title||value(one('.tiptap[contenteditable="true"],.ql-editor[contenteditable="true"]'))!==p.body||JSON.stringify(list('.img-preview-area img,.upload-img-item img').map(e=>(e as HTMLImageElement).src))!==JSON.stringify(p.prepared?.image_sources))throw new Error('PAYLOAD_CHANGED');press('发布');}
  return {dispatched:true};
 }
 if(p.action==='reconcile'){
  // 正文相同不能证明这次操作成功；仅使用此次提交后出现的明确成功标识。
  const before=p.prepared?.before_ids;if(!Array.isArray(before))return {confirmed:false,reason:'缺少提交前快照'};
  if(p.kind==='comment'){
   if(noteId()!==p.note_id)throw new Error('TARGET_CHANGED');const matched=list('.comment-item[id],.comment-item[data-comment-id]').filter(e=>{const key=e.getAttribute('data-comment-id')||e.id;const author=e.querySelector('a[href*="/user/profile/"]')?.getAttribute('href')?.match(/\/user\/profile\/([a-f0-9]{24})/)?.[1];return key&&!before.includes(key)&&author===account&&e.querySelector('.content')?.textContent?.trim()===p.body;});
   if(matched.length===1)return {confirmed:true,confirmation:'ui_only',comment_id:matched[0].getAttribute('data-comment-id')||matched[0].id};
  }else{
   const matched=list('.publish-success [data-note-id]').filter(e=>{const key=e.getAttribute('data-note-id');return key&&/^[a-f0-9]{24}$/.test(key)&&!before.includes(key)&&e.getAttribute('data-title')===p.title;});
   if(matched.length===1)return {confirmed:true,confirmation:'ui_only',note_id:matched[0].getAttribute('data-note-id')};
  }
  return {confirmed:false,reason:'未观察到可归属于本次操作的新稳定标识'};
 }
 throw new Error('UNSUPPORTED_ACTION');
}catch(e){const code=e instanceof Error?e.message:'';return {bridge_error:['UI_CHANGED','TARGET_CHANGED','HUMAN_VERIFICATION_REQUIRED','AUTH_REQUIRED','PAYLOAD_CHANGED','UNSUPPORTED_ACTION'].includes(code)?code:'UI_CHANGED'};}
}
