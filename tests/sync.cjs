/* 기기 2개를 격리 브라우저로 재현합니다. 이 전송 모형은 Firebase 보안 규칙 검증을 대체하지 않습니다. */
const assert=require('node:assert/strict');const {run,start}=require('./helpers.cjs');
run(async({browser,url,check})=>{
 const pages=new Map(),spaces=new Map(),invites=new Map();let puts=0;
 const clone=x=>JSON.parse(JSON.stringify(x));
 function notify(type,value){setTimeout(()=>{for(const p of pages.values())p.evaluate(({type,value})=>window.__syncEmit?.(type,value),{type,value}).catch(()=>{});},20);}
 async function rpc(uid,op,args){
  const s=spaces.get(args.id);
  if(op==='create'){const id='space-one';spaces.set(id,{id,owner:uid,revision:0,payload:args.payload,members:[uid]});return clone(spaces.get(id));}
  if(op==='get'){if(!s?.members.includes(uid))throw Error('permission-denied');return clone(s);}
  if(op==='put'){if(!s?.members.includes(uid))throw Error('permission-denied');if(s.revision!==args.revision)return {conflict:true};s.revision++;s.payload=args.payload;puts++;notify('space',clone(s));return s.revision;}
  if(op==='invite'){if(!s?.members.includes(uid))throw Error('permission-denied');const token='ab'.repeat(24);const i={token,workspaceId:s.id,expiresAt:Date.now()+480000,requests:[]};invites.set(token,i);return {token,expiresAt:i.expiresAt};}
  const i=invites.get(args.token);
  if(op==='request'){if(!i||i.expiresAt<Date.now())throw Error('연결 코드가 만료됐습니다.');if(!i.requests.some(r=>r.uid===uid))i.requests.push({uid,status:'pending'});notify('requests',clone(i));return {workspaceId:i.workspaceId};}
  if(op==='requests')return clone(i);
  if(op==='approval')return i?.requests.find(r=>r.uid===uid)?.status||'pending';
  if(op==='approve'){const workspace=spaces.get(args.id);if(!workspace?.members.includes(uid))throw Error('permission-denied');workspace.members.push(args.member);i.requests.find(r=>r.uid===args.member).status='approved';notify('approval',{token:args.token,uid:args.member});notify('requests',clone(i));return;}
  throw Error('Unknown operation');
 }
 async function device(uid){const p=await browser.newPage();pages.set(uid,p);await p.exposeFunction('syncBridge',(op,args)=>rpc(uid,op,args));await p.addInitScript(({uid})=>{
  const watches={space:null,requests:null,approval:null};
  window.__syncEmit=(type,value)=>{if(!navigator.onLine)return;if(type==='space'&&watches.space?.id===value.id)watches.space.cb(value);if(type==='requests'&&watches.requests?.token===value.token)watches.requests.cb(value.requests.filter(r=>r.status==='pending'));if(type==='approval'&&watches.approval?.token===value.token&&value.uid===uid)watches.approval.cb();};
  window.CXSyncProviderFactory=async()=>({uid,
   create:payload=>syncBridge('create',{payload}),get:id=>syncBridge('get',{id}),
   put:async(id,revision,payload)=>{const result=await syncBridge('put',{id,revision,payload});if(result?.conflict){const e=Error('conflict');e.code='sync/conflict';throw e;}return result;},
   watch:(id,cb,error)=>{watches.space={id,cb};syncBridge('get',{id}).then(cb,error);return()=>watches.space=null;},
   invite:id=>syncBridge('invite',{id}),request:token=>syncBridge('request',{token}),
   watchRequests:(token,cb,error)=>{watches.requests={token,cb};syncBridge('requests',{token}).then(i=>cb(i.requests.filter(r=>r.status==='pending')),error);return()=>watches.requests=null;},
   watchApproval:(token,cb,error)=>{watches.approval={token,cb};syncBridge('approval',{token}).then(s=>{if(s==='approved')cb();},error);return()=>watches.approval=null;},
   approve:(id,token,member)=>syncBridge('approve',{id,token,member})
  });
 },{uid});await p.goto(url);await p.locator('#open-settings').click();return p;}
 const config=JSON.stringify({apiKey:'public-test-key',authDomain:'cx-sync-test.firebaseapp.com',projectId:'cx-sync-test',appId:'public-app'});
 async function configure(p){await p.locator('#sync-config-details').evaluate(n=>n.open=true);await p.locator('#sync-config-input').fill(config);await p.locator('#sync-config-form button').click();}
 const a=await device('device-owner-12345');const errors=[];a.on('pageerror',e=>errors.push(e.message));assert.match(await a.locator('#sync-status').textContent(),/설정 전/);await a.locator('#sync-config-details').evaluate(n=>n.open=true);await a.locator('#sync-config-input').fill(JSON.stringify({type:'service_account',private_key:'not-a-real-key'}));await a.locator('#sync-config-form button').click();assert.match(await a.locator('#sync-status').textContent(),/서비스 계정/);check('설정 전 로컬 모드·관리자 키 입력 차단');
 await configure(a);await a.locator('#sync-create').click();await a.waitForFunction(()=>CXSync.isLinked);assert.equal(spaces.size,1);assert.equal(spaces.get('space-one').members.length,1);check('익명 기기로 공간 생성·자료 최초 업로드');
 await a.locator('#sync-invite').click();await a.locator('#sync-code').waitFor({state:'visible'});const code=await a.locator('#sync-code').inputValue();assert.match(code,/^[a-f0-9]{48}$/);check('연결 코드 및 만료 안내');
 const b=await device('device-mobile-67890');await configure(b);await b.evaluate(()=>CXStore.transaction(s=>s.companies[0].memo='모바일에만 있는 자료'));await b.locator('#sync-join-code').fill(code);await b.locator('#sync-join-form button').click();await a.locator('#sync-requests button').waitFor({state:'visible'});assert.equal(spaces.get('space-one').members.length,1);a.once('dialog',d=>d.accept());await a.locator('#sync-requests button').click();await b.waitForFunction(()=>CXSync.isLinked);await b.waitForFunction(()=>document.getElementById('sync-status').textContent.includes('자동 덮어쓰지'));assert.equal(await b.evaluate(()=>CXStore.state.companies[0].memo),'모바일에만 있는 자료');check('다른 기기 승인 전 접근 불가·승인 후 초기 자료 자동 덮어쓰기 방지');
 b.once('dialog',d=>d.accept());await b.locator('#sync-pull').click();await b.waitForFunction(()=>document.getElementById('home-view').hidden===false);assert.equal(await b.evaluate(()=>CXStore.state.companies[0].memo),'');check('명시적으로 클라우드 자료 적용');
 await a.evaluate(()=>CXStore.transaction(s=>s.companies[0].memo='PC에서 수정한 메모'));await b.waitForFunction(()=>CXStore.state.companies[0].memo==='PC에서 수정한 메모',null,{timeout:10000});assert.equal(puts,1);check('PC 수정 → 모바일 대기 화면 자동 동기화·지연 저장');
 await start(b);await b.locator('#answer-input').fill('모바일 작성 중인 답변');await a.evaluate(()=>CXStore.transaction(s=>s.companies[0].memo='PC의 두 번째 수정'));a.once('dialog',d=>d.accept());await a.locator('#sync-push').click();await b.waitForFunction(()=>document.getElementById('sync-status').textContent.includes('다른 기기')||document.getElementById('sync-status').textContent.includes('동시에')||document.getElementById('sync-status').textContent.includes('양쪽'),null,{timeout:10000});assert.equal(await b.locator('#answer-input').inputValue(),'모바일 작성 중인 답변');assert.equal(JSON.parse(spaces.get('space-one').payload).companies[0].memo,'PC의 두 번째 수정');check('동시 수정 충돌 시 작성 중 답변과 원격 자료 보존');
 await b.locator('#end-session').click();await b.locator('#back-home').click();await b.locator('#open-settings').click();b.once('dialog',d=>d.accept());await b.locator('#sync-pull').click();assert.equal(await b.evaluate(()=>CXStore.state.companies[0].memo),'PC의 두 번째 수정');check('충돌 후 사용할 자료를 직접 선택');
 await b.context().setOffline(true);await b.evaluate(()=>CXStore.transaction(s=>s.companies[0].memo='오프라인 메모'));await b.waitForTimeout(2800);assert.equal(await b.evaluate(()=>CXStore.state.companies[0].memo),'오프라인 메모');assert.notEqual(JSON.parse(spaces.get('space-one').payload).companies[0].memo,'오프라인 메모');await b.context().setOffline(false);await b.waitForFunction(()=>document.getElementById('sync-status').textContent.includes('완료'),null,{timeout:10000});assert.equal(JSON.parse(spaces.get('space-one').payload).companies[0].memo,'오프라인 메모');check('오프라인 로컬 보관·온라인 복구 후 전송');
 await b.locator('#open-settings').click();await b.locator('#delete-all').click();await b.locator('#wipe-confirm').fill('전체 삭제');await b.locator('#wipe-form button[type=submit]').click();assert.match(await b.locator('#wipe-status').textContent(),/동기화를 중지/);await b.locator('#cancel-wipe').click();check('연결 중 전체 삭제가 다른 기기로 전파되지 않도록 차단');
 b.once('dialog',d=>d.accept());await b.locator('#sync-stop').click();assert.equal(await b.evaluate(()=>CXSync.isLinked),false);const revision=spaces.get('space-one').revision;await b.evaluate(()=>CXStore.transaction(s=>s.companies[0].memo='중지 후 로컬 변경'));await b.waitForTimeout(2800);assert.equal(spaces.get('space-one').revision,revision);assert.equal(await b.evaluate(()=>CXStore.state.companies[0].memo),'중지 후 로컬 변경');check('동기화 중지 후 로컬/클라우드 보존·전송 중지');
 const c=await device('device-third');await configure(c);await c.locator('#sync-join-code').fill('잘못된 코드');await c.locator('#sync-join-form button').click();assert.match(await c.locator('#sync-status').textContent(),/48자리/);invites.get(code).expiresAt=Date.now()-1;await c.locator('#sync-join-code').fill(code);await c.locator('#sync-join-form button').click();assert.match(await c.locator('#sync-status').textContent(),/만료/);check('잘못된 코드·만료된 코드 처리');
 const reload=await a.evaluate(()=>JSON.parse(localStorage.getItem('cx-interview-lab:sync')));assert.equal(reload.projectId,'cx-sync-test');assert.ok(reload.baseHash);assert.deepEqual(errors,[]);check('기기 연결 정보·기준 해시 보존 및 실행 오류 없음');
}).catch(e=>{console.error(e);process.exitCode=1});
