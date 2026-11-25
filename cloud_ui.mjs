const moduleBuild=new URL(import.meta.url).searchParams.get('build')||'dev';
const {createCloudClient,decodeRecovery,canSyncAccount,canAutoEnroll,autoParticipant,identifyLegacyEvents,randomCode,reconcileProfile}=await import('./cloud_client.mjs?build='+moduleBuild);
const {portalConfig}=await import('./portal_config.mjs?build='+moduleBuild);
const {username,teacherKey,parseInvitation}=await import('./portal_identity.mjs?build='+moduleBuild);
// The host owns game state; this module owns network state and the management dialog.
export function mountCloudUI(host){
 if(moduleBuild!==document.querySelector('meta[name="app-build"]').content)throw Error('页面组件版本已变化，请刷新后继续');
 const syncScope=document.querySelector('meta[name="nt-protected-runtime"]')?.content;
 const client=createCloudClient({storage:localStorage,syncScope});
 let timer,scheduledAt=Infinity,retryAt=0,lastActivity=0;
 let active=false,paused=false,attempt=0,saveVersion=0,managing=false,disposed=false,releaseLock,hasLock=false;
 let initialRoster=null,historyAfter=null;
 const pendingProfiles=new Set();
 const dialog=document.createElement('div');dialog.className='modal';dialog.id='cloudModal';
 dialog.innerHTML=`<div class="sheet"><h2 id="cloudTitle">云端账户</h2>
 <p class="hint" id="cloudIntro">教师使用用户名和教师密钥登录。首次使用请先注册。</p>
 <p id="cloudStatus" role="status">尚未连接，练习记录仍保存在本机。</p>
 <div id="cloudEntryTabs" class="cloud-tabs">
 <button class="secondary-btn" id="cloudLoginTab" aria-pressed="true">教师登录</button>
 <button class="secondary-btn" id="cloudRegisterTab" aria-pressed="false">教师注册</button>
 <button class="ghost-btn" id="cloudRecoveryTab" aria-pressed="false">学生激活 / 旧账户恢复</button></div>
 <section id="cloudLoginPanel">
 <label class="field"><span>用户名</span><input id="cloudLoginName" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" placeholder="仅英文字母和数字"></label>
 <label class="field"><span>教师密钥</span><textarea id="cloudLoginKey" rows="3" autocomplete="off" spellcheck="false" placeholder="粘贴 NT2- 开头的教师密钥"></textarea></label>
 <button class="secondary-btn" id="cloudLogin">登录教师账户</button>
 <p class="hint">密钥丢失请联系管理员。用户名不能单独恢复账户。</p></section>
 <section id="cloudRegisterPanel" hidden>
 <label class="field"><span>管理员给你的邀请码</span><textarea id="cloudInvitation" rows="2" autocomplete="off" spellcheck="false" placeholder="粘贴 INV- 开头的邀请码"></textarea></label>
 <label class="field"><span>设置用户名</span><input id="cloudRegisterName" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="32" placeholder="3–32 位英文字母或数字"></label>
 <p class="hint">用户名不区分大小写。注册后系统会生成你的专属教师密钥，不需要邮箱。</p>
 <button class="secondary-btn" id="cloudRegister">注册教师账户</button></section>
 <section id="cloudRecoveryPanel" hidden>
 <label class="field"><span>学生激活码或旧版账户恢复码</span><textarea id="cloudRecovery" rows="3" autocomplete="off" spellcheck="false" placeholder="粘贴 nt1. 开头的完整恢复码"></textarea></label>
 <button class="secondary-btn" id="cloudRecover">激活或恢复账户</button>
 <details><summary>我保存的是恢复码文件</summary>
 <label class="field"><span>选择恢复码文件</span><input id="cloudRecoveryFile" type="file" accept=".json,application/json"></label></details>
 <details id="cloudLegacySetup"><summary>旧版首次开通班级（教师） · 管理员协助</summary>
 <label class="field"><span>云服务配置文件</span><input id="cloudConfig" type="file" accept=".json,application/json"></label>
 <label class="field"><span>旧版一次性开通码</span><input id="cloudBootstrap" autocomplete="off" spellcheck="false"></label>
 <button class="secondary-btn" id="cloudCreate">开通班级</button></details></section>
 <details id="cloudLocalPinBox" open><summary>本机 PIN / 载入学生</summary><label class="field"><span>本机四位 PIN（新设备教师登录，或载入学生时使用）</span><input id="cloudLocalPin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label>
 <p class="hint">PIN 只保护这台设备，不能代替教师密钥。</p></details>
 <section id="cloudPacket" hidden><h3 id="cloudIssuedTitle">保存恢复码</h3>
 <p class="hint" id="cloudIssuedHelp">这是一段文字，请复制到你私下保管的位置。换设备时粘贴即可，下载文件是可选的。</p>
 <textarea id="cloudIssued" aria-label="新生成的恢复码" aria-describedby="cloudIssuedHelp" rows="4" readonly></textarea>
 <button class="secondary-btn" id="cloudCopyCode">复制密钥 / 恢复码</button>
 <button class="ghost-btn" id="cloudDownloadCode">另存为文件（可选）</button>
 <button class="secondary-btn" id="cloudSavedCode">我已妥善保存</button></section>
 <div id="cloudManagement" hidden>
 <div id="cloudLearnerDevice" hidden>
 <p class="hint">在新设备打开游戏，选择「学生激活或添加设备」，输入这里生成的配对码。</p>
 <button class="secondary-btn" id="cloudPair">添加练习设备</button>
 </div>
 <div id="cloudTeacher" hidden>
 <details id="cloudSafety" open><summary>备份与授权</summary>
 <button class="secondary-btn" id="cloudTeacherCode">生成备用教师恢复码</button>
 <button class="secondary-btn" id="cloudResearchCode">生成研究者只读授权码</button>
 <button class="secondary-btn" id="cloudBackup">导出班级云端灾备</button>
 <button class="secondary-btn" id="cloudDevices">查看或撤销设备</button>
 <button class="secondary-btn" id="cloudCodes">查看或撤销授权</button><div id="cloudGrantList"></div>
 <details id="cloudLegacyMigration" hidden><summary>从旧版迁移学生</summary>
 <p class="hint">选择旧版的完整名册备份，加入尚未绑定的学生和练习记录。</p>
 <input id="cloudLegacyFile" type="file" accept="application/json,.json" aria-label="旧版完整名册备份"></details>
 <details id="cloudLegacyBind"><summary>旧版档案兼容工具</summary>
 <label class="field"><span>选择本机学生</span><select id="cloudLocal"></select></label>
 <label class="field"><span>旧研究编号（可选的兼容流程）</span><input id="cloudParticipant" placeholder="例如 P001" maxlength="40"></label>
 <button class="secondary-btn" id="cloudBind">备份并绑定学生</button></details></details></div>
 <section id="cloudRosterSection"><h3>学生记录</h3><button class="ghost-btn" id="cloudRefresh">刷新学生记录</button>
 <button class="secondary-btn" id="cloudRetry">立即同步 / 重试</button>
 <div id="cloudRoster"></div><div id="cloudReadReport"></div></section>
 <p class="hint" id="cloudLegacyConflict">另一设备继续练习前，请先确认原设备已同步。进度冲突不会自动覆盖，请先备份本机记录。</p>
 <button class="ghost-btn" id="cloudSwitch">登录 / 恢复其他账户</button></div>
 <div class="sheet-foot"><button class="secondary-btn" id="cloudClose">关闭</button></div></div>`;
 document.body.append(dialog);
 const $=id=>dialog.querySelector('#'+id);
 const status=text=>{
  $('cloudStatus').textContent=text;
  if(!syncScope)host.cloudStatus?.(text);
 };
 const syncStatus=text=>{
  if(!syncScope||!dialog.classList.contains('open'))status(text);
  if(syncScope)host.cloudStatus?.(text);
 };
 function entry(mode){
  dialog.querySelector('.sheet').scrollTop=0;
  for(const [name,panel] of [['login','cloudLoginPanel'],['register','cloudRegisterPanel'],['recover','cloudRecoveryPanel']])$(panel).hidden=mode!==name;
  for(const [name,tab] of [['login','cloudLoginTab'],['register','cloudRegisterTab'],['recover','cloudRecoveryTab']])$(tab).setAttribute('aria-pressed',String(mode===name));
 }
 $('cloudLoginTab').onclick=()=>entry('login');$('cloudRegisterTab').onclick=()=>entry('register');$('cloudRecoveryTab').onclick=()=>entry('recover');
 const protectedRuntime=!!syncScope;
 if(protectedRuntime){
  for(const id of ['cloudSwitch','cloudLegacyBind','cloudRefresh'])$(id).style.display='none';
  $('cloudLegacyConflict').style.display='none';
  $('cloudLegacyMigration').hidden=false;
  $('cloudRetry').hidden=true;
  $('cloudRetry').textContent='重试云端连接';
 }else{
  $('cloudSafety').open=false;
  $('cloudSafety').querySelector('summary').textContent='高级设置';
 }
 $('cloudSwitch').onclick=()=>{
  if(active){status('正在同步，请稍后再切换账户。');return;}
  $('cloudManagement').hidden=true;$('cloudEntryTabs').hidden=false;$('cloudLocalPinBox').hidden=false;entry('login');
  $('cloudIntro').textContent='登录其他账户前，请先确认当前账户的记录已同步。';
 };
 function download(name,value){host.download(name,typeof value==='string'?value:JSON.stringify(value),'application/json');}
 async function action(fn){
  if(managing)return;managing=true;dialog.setAttribute('aria-busy','true');
  try{await fn();}catch(e){status(e.message || '操作未完成，请保留本机数据并重试');}
  finally{managing=false;dialog.removeAttribute('aria-busy');}
 }
 async function writer(){
  if(hasLock)return;
  if(!navigator.locks)throw Error('云同步需要支持 Web Locks 的新版 Safari 或 Chrome');
  await new Promise((resolve,reject)=>{
   navigator.locks.request('nt.cloud.game',{ifAvailable:true},async lock=>{
    if(!lock){reject(Error('云端练习已在另一个标签页打开，请关闭其他游戏页后重试'));return;}
    hasLock=true;host.setWriter(true);resolve();
    await new Promise(done=>{releaseLock=done;});hasLock=false;host.setWriter(false);
   }).catch(reject);
  });
 }
 function showAccess(){
  const connected=!!client.access;
  $('cloudManagement').hidden=!connected;$('cloudEntryTabs').hidden=connected;
  $('cloudTitle').textContent=protectedRuntime
   ? (client.access?.role==='learner'?'练习设备':'账户与设备'):'云端账户';
  $('cloudIntro').textContent=connected
   ? (client.access.username?'已登录 '+client.access.username:'')
   :'教师使用用户名和教师密钥登录。首次使用请先注册。';
  $('cloudIntro').hidden=!$('cloudIntro').textContent;
  $('cloudLocalPinBox').hidden=protectedRuntime||(!connected&&host.isTeacher());$('cloudLocalPinBox').open=!connected&&!host.isTeacher();
  if(connected){for(const id of ['cloudLoginPanel','cloudRegisterPanel','cloudRecoveryPanel'])$(id).hidden=true;}
  else entry('login');
  $('cloudTeacher').hidden=client.access?.role!=='teacher';
  const learner=protectedRuntime&&client.access?.role==='learner';
  $('cloudLearnerDevice').hidden=!learner;
  const cloudTeacher=protectedRuntime&&client.access?.role==='teacher';
  for(const element of $('cloudRosterSection').children){
   if(element.id!=='cloudRetry')element.hidden=cloudTeacher;
  }
  $('cloudRosterSection').hidden=learner;
  $('cloudLocal').replaceChildren(...host.accounts().filter(a=>!a.cloudStudent).map(a=>{const o=document.createElement('option');o.value=a.id;o.textContent=a.name;return o;}));
 }
 function showIssued(value,title='保存恢复码'){$('cloudIssuedHelp').textContent='请私下保存这段代码。';$('cloudIssued').value=value;$('cloudIssuedTitle').textContent=title;$('cloudPacket').hidden=false;}
 async function issue(role,student){
  host.requireLocalTeacher();const out=await client.issue(role,student);
  showIssued(role==='teacher'&&client.access?.username?teacherKey(decodeRecovery(out.packet).secret):out.packet,role==='learner'?'保存学生激活码':'保存恢复码');
  if(protectedRuntime&&role==='learner')$('cloudIssuedHelp').textContent='复制这段激活码，发给这位学生。学生在游戏首页输入即可。';
  status(role==='learner'?'学生激活码已生成，请仅发给该学生。':'恢复码已生成，请复制并私下保存。');
 }
 async function roster(){
  if(!client.access)throw Error('请先恢复账户或开通班级');
  if(client.access.role!=='learner')host.requireLocalTeacher();
  if(client.access.role==='teacher'){host.enableCloudDefault(client.access.workspace);schedule(0);}
  const students=await client.students();$('cloudRoster').replaceChildren();showAccess();
  for(const student of students){
   const row=document.createElement('div');row.className='cloud-row';
   const label=document.createElement('strong');label.textContent=student.display_name||student.code;row.append(label);
   const button=(text,fn)=>{const b=document.createElement('button');b.className='ghost-btn';b.textContent=text;b.onclick=()=>action(fn);row.append(b);};
   button('只读报告',async()=>{
    const events=await client.readEvents(student.id),box=$('cloudReadReport');box.replaceChildren();
    const heading=document.createElement('p');const first=events.filter(e=>e.first).length;
    heading.textContent=student.code+'：'+events.length+' 题；首次正确率 '+(events.length?Math.round(100*first/events.length)+'%':'暂无数据');box.append(heading);
    const b=document.createElement('button');b.className='secondary-btn';b.textContent='导出去标识记录';b.onclick=()=>download('note-trainer_'+student.code+'.json',{schema_version:1,workspace_id:student.workspace_id,student_id:student.id,participant:student.code,events});box.append(b);
   });
   if(!protectedRuntime&&client.access.role!=='researcher')button('载入本机 / 云端进度',async()=>{
    const pin=$('cloudLocalPin').value;if(!/^\d{4}$/.test(pin))throw Error('请先填写四位本地 PIN');
    const profile=await client.profile(student.id),events=await client.readEvents(student.id);
    if(!confirm('载入 '+student.code+' 的云端进度？本机当前名册将保留快照。请先同步或导出本机未上传的记录。'))return;
    await writer();
    // Save local durable data before the receipt metadata; a metadata failure can only cause a retry.
    host.importRemote(profile,events,pin,client.access);
    client.markPulled(student.id,profile,events);location.reload();
   });
   if(client.access.role==='teacher')button('学生激活码 / 补发',()=>issue('learner',student.id));
   $('cloudRoster').append(row);
  }
  status('当前云端角色：'+({teacher:'教师',learner:'学生',researcher:'研究者只读'}[client.access.role])+'；名册 '+students.length+' 人。');
 }
 const profileRetries=new Map();
 function delayProfile(id,error){
  const tries=(profileRetries.get(id)?.tries||0)+1;
  const delay=error.permanent?60000:Math.max(error.retryAfter||0,Math.min(60000,2000*2**Math.min(tries,5)));
  profileRetries.set(id,{tries,until:Date.now()+delay});
 }
 function waiting(id){return (profileRetries.get(id)?.until||0)>Date.now();}
 async function pullProfile(head,local,fetched,readHistory){
  const stored=local&&host.storedState(local.id);
  const meta=client.meta(head.id);
  const cursor=stored?(meta.eventCursor||'0'):'0';
  const stateChanged=!stored||meta.revision!==head.revision||meta.lastState===undefined;
  const historyChanged=cursor!==head.event_cursor;
  if(!stateChanged&&!historyChanged)return 'unchanged';
  if(!stateChanged&&!readHistory)return 'more';
  if(local&&!host.canApplyCloudProfile(local.id))return 'deferred';
  const before=local&&host.readState(local.id);
  const memory=local&&host.memoryToken(local.id);
  const base=JSON.parse(meta.lastState||'{}');
  if(stateChanged&&!fetched)throw Error('学生档案暂不可读');
  const remote=stateChanged?{...head,...fetched}:{...head,state:base};
  const page=historyChanged&&readHistory?await client.readEventPage(head.id,cursor,head.event_cursor):null;
  if(!host.runtimeActive())return 'deferred';
  const events=page?.events||[];
  const profile=before?{...remote,state:reconcileProfile(base,before,remote.state,events)}:remote;
  const applied=host.applyCloudProfile(profile,profile.state.events||events,local?.id,before,memory);
  if(!applied)return 'deferred';
  client.markPulled(head.id,{...remote,event_cursor:page?.cursor||cursor},events,before||remote.revision?remote.state:applied);
  return historyChanged&&(!page||page.more)?'more':'applied';
 }
 async function refreshProfiles({rosterOnly=false}={}){
  const access=client.access;
  const deferred=new Set();
  if(!access||!host.runtimeActive?.()||document.hidden||!navigator.onLine)return deferred;
  const roster=!rosterOnly&&initialRoster ? initialRoster : await client.syncHeads();
  initialRoster=rosterOnly ? roster : null;
  if(!host.runtimeActive())return deferred;
  const known=new Set(roster.map(row=>row.id));
  const accounts=host.accounts();
  const byStudent=new Map(accounts.map(account=>[account.cloudStudent,account]));
  const pendingKeys=new Set(accounts.filter(account=>canAutoEnroll(access,account)).map(account=>account.id));
  for(const id of profileRetries.keys())if(!known.has(id)&&!pendingKeys.has(id))profileRetries.delete(id);
  const candidates=roster.filter(head=>canSyncAccount(access,{cloudStudent:head.id,cloudWorkspace:head.workspace_id})&&!pendingKeys.has(head.local_id));
  const work=candidates.flatMap(head=>{
   const local=byStudent.get(head.id);
   const stored=local&&host.storedState(local.id);
   const meta=client.meta(head.id);
   const state=!stored||meta.revision!==head.revision||meta.lastState===undefined;
   const history=(stored?(meta.eventCursor||'0'):'0')!==head.event_cursor;
   return state||history?[{head,state,history}]:[];
  });
  const previous=new Set(pendingProfiles);
  pendingProfiles.clear();
  for(const {head} of work)pendingProfiles.add(head.id);
  host.updateCloudRoster(roster);
  if(rosterOnly)return deferred;
  // Resolve local IDs again because the head response can add roster entries.
  for(const account of host.accounts())byStudent.set(account.cloudStudent,account);
  const eligible=work.filter(({head})=>{
   const local=byStudent.get(head.id);
   return !waiting(head.id)&&(!local||host.canApplyCloudProfile(local.id));
  });
  const changedState=eligible.filter(item=>item.state);
  const fetched=new Map();
  if(changedState.length&&host.runtimeActive()){
   const ids=changedState.slice(0,20).map(({head})=>head.id);
   try{
    for(const [id,profile] of await client.profileStates(ids))fetched.set(id,profile);
   }catch(error){
    if(error.status===429||error.retryAfter)throw error;
    for(const id of ids)delayProfile(id,error);
   }
  }
  const ready=eligible.filter(({head,state})=>!waiting(head.id)&&(!state||fetched.has(head.id)));
  for(const {head} of changedState.slice(0,20)){
   if(!waiting(head.id)&&!fetched.has(head.id))delayProfile(head.id,Error('学生档案暂不可读'));
  }
  // Rotate history work across students so one long history cannot hold up the class.
  const history=ready.filter(item=>item.history);
  const start=history.findIndex(({head})=>head.id===historyAfter)+1;
  const historyBatch=history.slice(start).concat(history.slice(0,start)).slice(0,4);
  let changed=false,more=changedState.length>20||history.length>historyBatch.length;
  const readsHistory=new Set(historyBatch.map(({head})=>head.id));
  const applyWork=ready.filter(item=>!item.history||item.state&&!readsHistory.has(item.head.id)).concat(historyBatch);
  for(const {head,state} of applyWork){
   if(!host.runtimeActive())break;
   const readHistory=readsHistory.has(head.id);
   if(readHistory)historyAfter=head.id;
   try{
    const result=await pullProfile(head,byStudent.get(head.id),fetched.get(head.id),readHistory);
    if(result==='unchanged'||result==='applied')pendingProfiles.delete(head.id);
    if(result==='applied'||result==='more'&&(state||readHistory))changed=true;
    if(result==='more')more=true;
   }catch(error){
    if(error.status===429||error.retryAfter)throw error;
    delayProfile(head.id,error);deferred.add(head.id);
   }
  }
  for(const id of pendingProfiles)deferred.add(id);
  if(host.runtimeActive()&&(changed||previous.size!==pendingProfiles.size||[...previous].some(id=>!pendingProfiles.has(id))))host.refreshClassroom();
  if(more)schedule(1500);
  return deferred;
 }
 const cleanAccounts=new Map();
 async function uploadAccount(account,answersOnly){
  if(canAutoEnroll(client.access,account)){
   const source=host.readState(account.id);
   if(!source||!Array.isArray(source.events))throw Object.assign(Error('本机学生档案缺失，已停止同步'),{permanent:true});
   const prepared={rosterToken:host.rosterToken(),original:JSON.stringify(source),memoryToken:host.memoryToken(account.id)};
   const remote=await client.addStudent(account.id,await autoParticipant(account.id));
   prepared.events=await identifyLegacyEvents(remote,source.events);
   host.attachAuto(account.id,remote,client.access.workspace,prepared);
   account=host.accounts().find(row=>row.id===account.id);
  }
  if(account.cloudUnavailable||!canSyncAccount(client.access,account))return 0;
  const token=protectedRuntime?host.storedState(account.id):null;
  if(answersOnly&&!token)return 0;
  const label=JSON.stringify([account.name,account.color]);
  const clean=cleanAccounts.get(account.id);
  if(token&&clean?.token===token&&clean.label===label)return 0;
  const state=host.readState(account.id);
  if(!state||!Array.isArray(state.events))throw Object.assign(Error('本机存档缺失，已停止同步'),{permanent:true});
  if(!answersOnly&&client.access.role==='teacher'&&(!protectedRuntime||account.cloudAuto))await client.pushLabel(account.cloudStudent,account);
  const receipt=await client.push(account.cloudStudent,state,client.meta(account.cloudStudent),{background:protectedRuntime,answersOnly});
  if(token&&!answersOnly&&!receipt.pendingCount)cleanAccounts.set(account.id,{token,label});
  return receipt.pendingCount||0;
 }
 function clearSchedule(){clearTimeout(timer);timer=null;scheduledAt=Infinity;}
 function schedule(ms=10000){
  if(disposed||paused||(protectedRuntime&&(document.hidden||!navigator.onLine)))return;
  const now=Date.now(),at=Math.max(now+ms,retryAt);
  if(timer!=null&&scheduledAt<=at&&scheduledAt>=retryAt)return;
  clearSchedule();
  scheduledAt=at;
  timer=setTimeout(()=>{clearSchedule();sync();},at-now);
 }
 function nextPoll(){
  if(Date.now()-lastActivity<20000)return 4000;
  return client.access?.role==='teacher'?12000:20000;
 }
 async function sync(){
  if(active||paused||disposed||!client.access||client.access.role==='researcher'||(host.runtimeActive&&!host.runtimeActive()))return;
  // Credential changes and sync must not interleave on the shared client.
  if(managing){schedule();return;}
  if(!navigator.onLine){status('当前离线，答题仍保存在本机。联网后继续同步。');return;}
  active=true;const startedVersion=saveVersion;
  let followUp;
  try{
   await writer();
   const deferred=await refreshProfiles();
   let pending=0;
   for(const account of host.accounts()){
    if(host.runtimeActive&&!host.runtimeActive())return;
    const id=account.cloudStudent||account.id;
    if(waiting(id))continue;
    const answersOnly=protectedRuntime&&deferred.has(id);
    try{
     pending+=await uploadAccount(account,answersOnly);
     profileRetries.delete(id);
    }catch(error){
     if(!protectedRuntime)throw error;
     if(error.status===429||error.retryAfter)throw error;
     if(!error.conflict)delayProfile(id,error);
     else followUp=1500;
     cleanAccounts.delete(account.id);
     deferred.add(id);
    }
   }
   attempt=0;retryAt=0;
   if(pending)followUp=1500;
   if(protectedRuntime)$('cloudRetry').hidden=true;
   syncStatus(!protectedRuntime?'本机记录已同步；服务器确认后仍保留本机副本。':
    profileRetries.size?'已保存在本机，稍后自动同步':deferred.size||pending?'正在同步…':'已同步到云端');
  }catch(e){
   if(e.permanent&&!protectedRuntime){paused=true;syncStatus(e.message+'；同步已暂停，本机副本保留。');}
   else{
    syncStatus(protectedRuntime?'已保存在本机，稍后自动重试':'同步未完成，本机副本保留，稍后重试。');
    followUp=Math.max(e.retryAfter||0,Math.min(60000,2000*2**Math.min(attempt++,5))*(0.8+Math.random()*0.4));
    retryAt=Date.now()+followUp;
   }
  }finally{
   active=false;
   if(protectedRuntime&&host.runtimeActive())schedule(followUp??(saveVersion!==startedVersion?1500:nextPoll()));
   else if(!protectedRuntime&&(followUp!==undefined||saveVersion!==startedVersion))schedule(followUp??10000);
  }
 }
 $('cloudClose').onclick=()=>dialog.classList.remove('open');
 $('cloudRegister').onclick=()=>action(async()=>{
  if(client.access)throw Error('这台设备已经连接账户。请在独立浏览器中注册其他教师，避免混用本机档案。');
  const name=username($('cloudRegisterName').value),invitation=parseInvitation($('cloudInvitation').value);
  if(!host.isTeacher())host.authorizeManagement('teacher',$('cloudLocalPin').value);
  host.requireLocalTeacher();
  let pending=JSON.parse(localStorage.getItem('nt.cloud.registrationPending')||'null');
  if(!pending||pending.name!==name||pending.invitation!==invitation){pending={name,invitation,secret:randomCode()};localStorage.setItem('nt.cloud.registrationPending',JSON.stringify(pending));}
  client.configure(portalConfig);await writer();
  await client.registerTeacher(invitation,name,pending.secret);
  $('cloudInvitation').value='';await roster();
  host.teacherDashboard();
  showIssued(teacherKey(pending.secret),'保存教师密钥 · '+name);
  status('教师账户已创建。请复制并保存教师密钥；以后换设备仍使用它。');
 });
 $('cloudLogin').onclick=()=>action(async()=>{
  if(active)throw Error('正在同步，请稍后再登录');
  const name=username($('cloudLoginName').value);
  if(!host.isTeacher()&&!/^\d{4}$/.test($('cloudLocalPin').value))throw Error('新设备请先填写四位本机 PIN');
  client.configure(portalConfig);await writer();
  const access=await client.loginTeacher(name,$('cloudLoginKey').value);
  host.authorizeManagement(access.role,$('cloudLocalPin').value);$('cloudLoginKey').value='';
  $('cloudIssued').value='';$('cloudPacket').hidden=true;paused=false;await roster();host.teacherDashboard();schedule();
 });
 $('cloudConfig').onchange=()=>action(async()=>{const f=$('cloudConfig').files[0];if(f)client.configure(JSON.parse(await f.text()));status('配置已加载；尚未绑定或上传本机学生。');});
 $('cloudRecover').onclick=()=>action(async()=>{
  if(active)throw Error('正在同步，请稍后再恢复账户');
  const packet=$('cloudRecovery').value.trim();decodeRecovery(packet);await writer();
  const access=await client.recover(packet);host.authorizeManagement(access.role,$('cloudLocalPin').value);$('cloudRecovery').value='';paused=false;await roster();schedule();
 });
 $('cloudCreate').onclick=()=>action(async()=>{host.requireLocalTeacher();await writer();await client.create($('cloudBootstrap').value.trim());$('cloudBootstrap').value='';await roster();await issue('teacher');});
 $('cloudLegacyFile').onchange=()=>action(async()=>{
  const file=$('cloudLegacyFile').files[0];
  $('cloudLegacyFile').value='';
  if(!file)return;
  const imported=await host.importLegacyRoster(file);
  status(imported?'已加入 '+imported+' 位学生，正在保存到云端。':'没有添加学生。');
 });
 $('cloudPair').onclick=()=>action(async()=>{
  const packet=await client.transferDevice();
  showIssued(packet,'练习设备配对码');
  $('cloudIssuedHelp').textContent='请在新设备输入此码。有效期最多 10 分钟，只能添加一台设备。';
  $('cloudDownloadCode').hidden=true;
  $('cloudSavedCode').textContent='完成';
  status('配对码已生成');
 });
 $('cloudTeacherCode').onclick=()=>action(()=>issue('teacher'));
 $('cloudResearchCode').onclick=()=>action(()=>issue('researcher'));
 $('cloudDownloadCode').onclick=()=>{download('note-trainer_recovery.json',{username:client.access?.username,recovery:$('cloudIssued').value});};
 $('cloudSavedCode').onclick=()=>{
  localStorage.removeItem('nt.cloud.registrationPending');client.forgetPendingCode();
  $('cloudIssued').value='';$('cloudPacket').hidden=true;status('请妥善保管密钥 / 恢复码。本机登录状态会保留。');
 };
 $('cloudCopyCode').onclick=()=>action(async()=>{
  try{await navigator.clipboard.writeText($('cloudIssued').value);status('恢复码已复制，请粘贴到你私下保管的位置。');}
  catch{$('cloudIssued').focus();$('cloudIssued').select();status('无法自动复制，已选中恢复码。请手动复制并私下保存。');}
 });
 $('cloudBind').onclick=()=>action(async()=>{
  if(client.access?.role!=='teacher')throw Error('需要云端教师权限');
  const id=$('cloudLocal').value,code=$('cloudParticipant').value.trim();
  if(!/^[A-Za-z0-9_-]{1,40}$/.test(code))throw Error('请输入参与者编号');
  if(!confirm('先完整备份本机名册，再将所选学生绑定到云端 '+code+'？只上传练习与进度，不上传姓名或本地 PIN。'))return;
  await writer();const rosterToken=host.beforeBind(),source=host.readState(id);
  if(!source||!Array.isArray(source.events))throw Error('本机存档缺失，已停止绑定');
  const remote=await client.addStudent(id,code);
  const events=await identifyLegacyEvents(remote,source.events);
  host.bind(id,remote,client.access.workspace,{rosterToken,original:JSON.stringify(source),events});location.reload();
 });
 $('cloudBackup').onclick=()=>action(async()=>{host.requireLocalTeacher();const backup=await client.backup();download('note-trainer_cloud_backup.json',backup);status('云端灾备已导出，含恢复码哈希；请离线保管。此备份由管理员恢复，不含认证会话。');});
 $('cloudDevices').onclick=()=>action(async()=>{
  host.requireLocalTeacher();const devices=await client.devices();$('cloudGrantList').replaceChildren();
  for(const device of devices){const row=document.createElement('p');row.textContent=device.role+' / '+(device.current?'当前设备':'其他设备')+' / '+(device.revoked?'已撤销':'有效');
   if(!device.revoked){const b=document.createElement('button');b.className='ghost-btn';b.textContent='撤销设备';b.onclick=()=>action(async()=>{if(!confirm('撤销此设备的访问？这不删除答题记录；持有效恢复码仍可重新恢复，需要永久撤销时也请撤销对应恢复码。'))return;await client.revokeDevice(device.id);row.textContent+=' / 已撤销';});row.append(b);}$('cloudGrantList').append(row);}
 });
 $('cloudCodes').onclick=()=>action(async()=>{
  const codes=await client.codes();$('cloudGrantList').replaceChildren();
  for(const code of codes){const row=document.createElement('p');row.textContent=code.role+' / '+(code.student||'全班')+' / '+(code.revoked?'已撤销':code.expires==='infinity'?'长期有效':'有效至 '+code.expires.slice(0,10));
   if(!code.revoked){const b=document.createElement('button');b.className='ghost-btn';b.textContent='撤销';b.onclick=()=>action(async()=>{if(!confirm('撤销此恢复码及通过它恢复的所有设备？教师可重新生成授权码。'))return;await client.revoke(code.id);row.textContent+=' / 已撤销';});row.append(b);}$('cloudGrantList').append(row);}
 });
 $('cloudRefresh').onclick=()=>action(roster);
 $('cloudRetry').onclick=()=>{paused=false;schedule(0);};
 const onSave=()=>{saveVersion++;lastActivity=Date.now();schedule(protectedRuntime?1500:10000);};
 const onRoster=()=>{saveVersion++;lastActivity=Date.now();if(client.access?.role==='teacher')schedule(0);};
 const onOnline=()=>schedule(0);
 const onVisibility=()=>{if(document.hidden)clearSchedule();};
 window.addEventListener('nt-local-saved',onSave);window.addEventListener('online',onOnline);
 window.addEventListener('nt-roster-saved',onRoster);
 if(protectedRuntime)document.addEventListener('visibilitychange',onVisibility);
 async function openStudentCode(student,name){
  if(!protectedRuntime||!host.runtimeActive()||client.access?.role!=='teacher')return;
  if(managing){host.notify('请等当前操作完成后重试。');return;}
  dialog.classList.add('open');
  showAccess();
  $('cloudTitle').textContent='发激活码';
  $('cloudIntro').textContent='学生：'+name;
  $('cloudIntro').hidden=false;
  status('正在生成激活码…');
  $('cloudManagement').hidden=true;
  $('cloudPacket').hidden=true;
  $('cloudIssued').value='';
  await action(()=>issue('learner',student));
 }
 async function open(){
  if(managing){host.notify('请等当前操作完成后重试。');return;}
  if(client.access?.role!=='learner' && client.access && !host.isTeacher()){host.notify('请先从老师入口验证本机 PIN，再打开云端管理');return;}
  dialog.classList.add('open');
  $('cloudPacket').hidden=true;
  $('cloudIssued').value='';
  status('');
  showAccess();
  if(client.access&&!protectedRuntime)await action(roster);
  const pending=JSON.parse(localStorage.getItem('nt.cloud.registrationPending')||'null');
  if(pending&&pending.name===client.access?.username)showIssued(teacherKey(pending.secret),'保存教师密钥 · '+pending.name);
 }
 $('cloudRecoveryFile').onchange=()=>action(async()=>{const file=$('cloudRecoveryFile').files[0];if(file){const value=JSON.parse(await file.text());if(value.recovery?.startsWith('NT2-')){$('cloudLoginName').value=username(value.username);$('cloudLoginKey').value=value.recovery;entry('login');}else{decodeRecovery(value.recovery);$('cloudRecovery').value=value.recovery;}}});
 // Bindings are durable before a reload; take the writer lock before the game boots.
 function teacherReady(){
  if(client.access?.role!=='teacher'||!host.isTeacher())return;
  try{host.enableCloudDefault(client.access.workspace);schedule(0);}catch(error){status(error.message);}
 }
 const ready=!protectedRuntime&&client.access&&client.access.role!=='researcher'?writer().then(()=>{
  syncStatus('云端自动同步已开启。离线时先保存在本机。');
  teacherReady();schedule(0);
 }):Promise.resolve();
 return {open,openStudentCode,ready,client,teacherReady,refreshProfiles,prepareRuntime:writer,
  profilePending:id=>pendingProfiles.has(id),requestSync:()=>schedule(0),dispose(){
  disposed=true;clearSchedule();releaseLock?.();
  window.removeEventListener('nt-local-saved',onSave);window.removeEventListener('nt-roster-saved',onRoster);window.removeEventListener('online',onOnline);
  document.removeEventListener('visibilitychange',onVisibility);
 }};
}
