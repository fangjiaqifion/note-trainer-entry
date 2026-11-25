import {createCloudClient,randomCode} from './cloud_client.mjs?build=5525ddec9a';
import {parseInvitation,teacherKey,username} from './portal_identity.mjs?build=5525ddec9a';
import {portalConfig} from './portal_config.mjs?build=5525ddec9a';

const status=document.querySelector('#status');
const client=createCloudClient({storage:localStorage});
const pendingKey='nt.cloud.registrationPending';
const issued=document.querySelector('#issued');
const entryBuild=new URL(import.meta.url).searchParams.get('build');
let busy=false;

async function action(work){
 if(busy)return;
 busy=true;
 const buttons=document.querySelectorAll('button');
 for(const button of buttons)button.disabled=true;
 try{status.textContent='正在验证云端授权…';await work();}
 catch(error){status.textContent=error.message||'暂时无法验证，请联网后重试。';}
 finally{busy=false;for(const button of buttons)button.disabled=false;}
}

function showKey(pending){
 const key=document.querySelector('#key');
 key.value=teacherKey(pending.secret);
 issued.hidden=false;
 status.textContent='教师账户已开通。';
 key.focus();
}

async function launch({saveKey=false}={}){
 if(!navigator.onLine)throw Error('请联网后启动练习。');
 const {release,access}=await client.authorizeRuntime(true);
 const scope=[access.role,access.workspace,access.student||''].join(':');
 if(release.build!==entryBuild || !/^(teacher|learner):[a-f0-9-]{36}:(?:[a-f0-9-]{36})?$/i.test(scope) ||
    !release.html.includes('<meta name="app-build" content="'+release.build+'">')){
  throw Error('练习版本或授权信息不匹配，请刷新后重试。');
 }
 if(saveKey)localStorage.removeItem(pendingKey);
 history.replaceState(null,'',new URL('./',location.href));
 const html=release.html.replace('<head>','<head><meta name="nt-protected-runtime" content="'+scope+'">');
 document.open();
 document.write(html);
 document.close();
}

function bind(id,handler){
 const form=document.getElementById(id);
 form.addEventListener('submit',event=>{
  event.preventDefault();
  // Unnamed controls keep credentials out of native form submissions.
  action(()=>handler(form.elements));
 });
 form.querySelector('button').disabled=false;
}

bind('login',async fields=>{
 client.configure(portalConfig);
 const key=fields.namedItem('teacherKeyInput').value.trim();
 if(key.startsWith('nt1.'))await client.recover(key,null,'teacher');
 else await client.loginTeacher(fields.namedItem('teacherUsername').value,key);
 await launch();
});
bind('register',async fields=>{
 const invitation=parseInvitation(fields.namedItem('invitationCode').value);
 const name=username(fields.namedItem('newTeacherUsername').value);
 let pending=JSON.parse(localStorage.getItem(pendingKey)||'null');
 if(pending?.invitation!==invitation||pending.name!==name){
  pending={invitation,name,secret:randomCode()};
  localStorage.setItem(pendingKey,JSON.stringify(pending));
 }
 client.configure(portalConfig);
 await client.registerTeacher(invitation,name,pending.secret);
 showKey(pending);
});
bind('learner',async fields=>{
 await client.recover(fields.namedItem('learnerCode').value.trim(),null,'learner');
 await launch();
});
document.querySelector('#continue').onclick=()=>action(()=>launch({saveKey:true}));

// Replace any historical offline worker. This worker serves no cached runtime.
if('serviceWorker' in navigator && location.protocol==='https:'){
 navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>{});
}

const pending=JSON.parse(localStorage.getItem(pendingKey)||'null');
const query=new URLSearchParams(location.search);
status.textContent='';
if(pending&&pending.name===client.access?.username)showKey(pending);
else if(client.access&&!query.has('signed-out'))action(launch);
