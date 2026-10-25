/* 로컬 데이터 모델과 버전 이전. 비밀키나 외부 저장소를 사용하지 않습니다. */
(() => {
 'use strict';
 const KEY='cx-interview-lab:v2', LEGACY='cx-interview-lab:v1';
 const categories=['자기소개','지원동기','직무 이해','성공/실패','컬처핏','협업','실무 상황','AX 자동화'];
 const statuses=['지원 예정','서류 지원','면접 예정','면접 완료','결과 대기','종료'];
 const clone=value=>JSON.parse(JSON.stringify(value));
 const uid=()=> 'id-'+(crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
 const commonNumbers=new Set([1,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,20,21,22,23,24,25,26]);
 const seed=Array.isArray(window.CX_QUESTIONS)?window.CX_QUESTIONS:[];
 const validQuestion=q=>q&&typeof q.id==='string'&&q.id&&categories.includes(q.category)&&typeof q.question==='string'&&q.question.trim()&&typeof q.answer==='string'&&Array.isArray(q.followUps)&&q.followUps.every(f=>f&&typeof f.question==='string'&&typeof f.answer==='string')&&Array.isArray(q.keywords)&&q.keywords.every(k=>typeof k==='string');
 const originals=seed.filter(validQuestion).filter((q,i,a)=>a.findIndex(x=>x.id===q.id)===i);
 function initial(){
  const company={id:'lawcompany',name:'로앤컴퍼니',role:'CX 매니저',posting:'',status:'지원 예정',schedule:'',memo:'',archived:false,links:{},records:{},debriefs:[]};
  const library=originals.map(q=>{
   const common=commonNumbers.has(Number(q.id.match(/q(\d+)$/)?.[1]));
   company.links[q.id]={...clone(q),importance:'보통',retry:false};
   return {...clone(q),scope:common?'common':'company',companyId:common?null:company.id,answer:common?'':q.answer,followUps:q.followUps.filter(f=>!common||!f.question.includes('로앤컴퍼니')).map(f=>({...f,answer:common?'':f.answer})),notes:common?'':q.notes||'',importance:'보통',retry:false};
  });
  return {version:2,companies:[company],library,commonRecords:{},migration:{legacyImported:false}};
 }
 let state, fatal='', pendingLegacy=null, message='', baseline=null;
 function validate(s){
  if(!s||s.version!==2||!Array.isArray(s.companies)||!Array.isArray(s.library)||!s.commonRecords||typeof s.commonRecords!=='object'||Array.isArray(s.commonRecords))throw Error('데이터 형식을 확인할 수 없습니다.');
  const ids=new Set(), cids=new Set();
  for(const c of s.companies){if(!c||typeof c.id!=='string'||!c.id||cids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||typeof c.role!=='string'||!c.role.trim()||!statuses.includes(c.status)||!c.links||typeof c.links!=='object'||Array.isArray(c.links)||!c.records||typeof c.records!=='object'||Array.isArray(c.records)||!Array.isArray(c.debriefs))throw Error('기업 데이터가 올바르지 않습니다.');cids.add(c.id);}
  for(const q of s.library){if(!validQuestion(q)||ids.has(q.id)||!['common','company'].includes(q.scope)||(q.scope==='company'&&!cids.has(q.companyId)))throw Error('질문 데이터가 올바르지 않습니다.');ids.add(q.id);}
  const recordMap=map=>{
   if(!map||typeof map!=='object'||Array.isArray(map))throw Error('연습 기록 형식이 올바르지 않습니다.');
   for(const r of Object.values(map)){
    if(!r||typeof r!=='object'||Array.isArray(r)||(r.text!==undefined&&typeof r.text!=='string')||(r.completed!==undefined&&typeof r.completed!=='boolean')||(r.rating!==undefined&&!['','good','okay','retry'].includes(r.rating))||(r.seconds!==undefined&&(!Number.isFinite(r.seconds)||r.seconds<0))||(r.followUps!==undefined&&(!Array.isArray(r.followUps)||!r.followUps.every(f=>f&&typeof f==='object'&&(f.text===undefined||typeof f.text==='string')&&(f.completed===undefined||typeof f.completed==='boolean')&&(f.seconds===undefined||(Number.isFinite(f.seconds)&&f.seconds>=0))))))throw Error('연습 기록이 손상되었습니다.');
   }
  };
  recordMap(s.commonRecords);
  for(const c of s.companies){
   if(!['posting','schedule','memo'].every(k=>typeof c[k]==='string')||typeof c.archived!=='boolean')throw Error('기업 상세 정보가 올바르지 않습니다.');
   recordMap(c.records);const dIds=new Set();
   for(const d of c.debriefs){if(!d||typeof d.id!=='string'||!d.id||dIds.has(d.id)||!['question','answer','regret','improved'].every(k=>typeof d[k]==='string')||!d.question.trim())throw Error('면접 복기가 손상되었습니다.');dIds.add(d.id);}
  }
  for(const c of s.companies)for(const [id,link] of Object.entries(c.links)){const q=s.library.find(q=>q.id===id);if(!q||!link||typeof link!=='object'||Array.isArray(link)||(link.keywords!==undefined&&(!Array.isArray(link.keywords)||!link.keywords.every(k=>typeof k==='string')))||(link.notes!==undefined&&typeof link.notes!=='string')||(link.importance!==undefined&&!['낮음','보통','높음'].includes(link.importance))||(link.retry!==undefined&&typeof link.retry!=='boolean')||(q.scope==='company'&&q.companyId!==c.id)||!link||typeof link!=='object'||(link.answer!==undefined&&typeof link.answer!=='string')||(link.followUps!==undefined&&(!Array.isArray(link.followUps)||!link.followUps.every(f=>f&&typeof f.question==='string'&&typeof f.answer==='string'))))throw Error('질문 연결 정보가 올바르지 않습니다.');}
 }
 try{
  const saved=localStorage.getItem(KEY);baseline=saved;state=saved?JSON.parse(saved):initial();validate(state);
  if(!state.migration?.legacyImported && state.companies.some(c=>c.id==='lawcompany')){const old=localStorage.getItem(LEGACY);if(old){const r=JSON.parse(old);if(!r||typeof r!=='object'||Array.isArray(r))throw Error('이전 연습 기록이 손상되었습니다.');if(Object.keys(r).length)pendingLegacy=r;}}
 }catch(e){state=initial();fatal='저장된 기록을 불러오지 못했습니다. 기존 데이터를 보호하기 위해 저장을 중지했습니다. 먼저 데이터 백업을 내려받아 확인해 주세요. '+e.message;}
 function write(next){
  if(fatal)throw Error(fatal);
  if(pendingLegacy)throw Error('먼저 기존 기록 이전 안내에서 이전 또는 나중에를 선택해 주세요.');
  if(localStorage.getItem(KEY)!==baseline)throw Error('다른 탭에서 데이터가 변경됐습니다. 답변을 복사한 후 새로고침해 주세요.');
  validate(next);localStorage.setItem(KEY,JSON.stringify(next));
  if(localStorage.getItem(KEY)!==JSON.stringify(next))throw Error('저장 결과를 확인하지 못했습니다.');
  baseline=JSON.stringify(next);state=next;
 }
 function transaction(edit){const next=clone(state);edit(next);try{write(next);return true;}catch(e){throw Error('저장하지 못했습니다. '+e.message);}}
 function migrate(){
  if(!pendingLegacy)return;
  const next=clone(state);const target=next.companies.find(c=>c.id==='lawcompany');const meaningful=Object.fromEntries(Object.entries(target.records).filter(([,r])=>r.text?.trim()||r.completed||r.rating||r.seconds>0||r.followUps?.some(f=>f.text?.trim()||f.completed)));target.records={...clone(pendingLegacy),...meaningful};next.migration={legacyImported:true};
  const old=pendingLegacy;pendingLegacy=null;
  try{write(next);message='기존 기록을 로앤컴퍼니로 이전했습니다. 이전 원본(v1)은 삭제하지 않았습니다.';}catch(e){pendingLegacy=old;throw e;}
 }
 const data={get state(){return state;},get fatal(){return fatal;},get pendingLegacy(){return !!pendingLegacy;},get message(){return message;},categories,statuses,uid,clone,transaction,migrate,
  postpone(){pendingLegacy=null;message='기존 기록은 v1 원본에 남아 있습니다. 다음 접속 때 이전 안내가 다시 표시됩니다. 나중에 이전해도 새로 작성한 기록을 우선 보존합니다.';},
  records(companyId){return clone(companyId?state.companies.find(c=>c.id===companyId)?.records||{}:state.commonRecords);},
  saveRecords(companyId,records){transaction(s=>{if(companyId){const c=s.companies.find(c=>c.id===companyId);if(!c)throw Error('기업을 찾을 수 없습니다.');c.records=clone(records);}else s.commonRecords=clone(records);});},
  questions(companyId,mode='mixed'){
   if(!companyId)return state.library.filter(q=>q.scope==='common').map(clone);
   const c=state.companies.find(c=>c.id===companyId);if(!c)return [];
   return state.library.filter(q=>Object.hasOwn(c.links,q.id)&&(mode==='mixed'||q.scope===mode)).map(q=>({...clone(q),...clone(c.links[q.id]),id:q.id,category:q.category,question:q.question,scope:q.scope,companyId:q.companyId}));
  },
  exportRaw(){return JSON.stringify({exportedAt:new Date().toISOString(),inMemory:state,current:localStorage.getItem(KEY),legacy:localStorage.getItem(LEGACY)},null,2);}
 };
 window.CXStore=data;
})();
