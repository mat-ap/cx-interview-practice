(() => {
 'use strict';
 const S=window.CXStore, P=window.CXPractice, $=id=>document.getElementById(id);
 let panel='', libraryMode='company', deletingId=null, returnFocus=null;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,action,cls='outline-button')=>{const b=el('button',text,cls);b.type='button';b.onclick=action;return b;};
 function status(text,error=false){$('management-status').textContent=text;$('management-status').classList.toggle('save-warning',error);}
 function error(e){status(e.message||String(e),true);}
 function company(){return S.state.companies.find(c=>c.id===P.companyId);}
 function mutate(edit,after){
  if(!P.flush()){status('현재 답변을 저장하지 못했습니다. 답변을 복사하고 저장 설정을 확인해 주세요.',true);return false;}
  try{const managerOpen=!$('manager').hidden;S.transaction(edit);P.refresh();if(managerOpen)P.openManagement();updateChrome();status('기기에 저장했습니다.');if(after)after();return true;}catch(e){error(e);return false;}
 }
 function field(form,label,id,type='text',value='',options=[]){
  const wrap=el('label',label,'form-field');wrap.htmlFor=id;let input;
  if(type==='textarea'){input=el('textarea');input.rows=4;input.value=value||'';}
  else if(type==='select'){input=el('select');for(const opt of options){const o=el('option',typeof opt==='string'?opt:opt.label);o.value=typeof opt==='string'?opt:opt.value;input.append(o);}input.value=value;}
  else{input=el('input');input.type=type;if(type==='checkbox')input.checked=!!value;else input.value=value||'';}
  input.id=id;input.name=id;wrap.append(input);form.append(wrap);return input;
 }
 function formSubmit(form,text,fn){const b=el('button',text,'primary-button');b.type='submit';form.append(b);form.onsubmit=e=>{e.preventDefault();if(!form.reportValidity())return;try{fn();}catch(err){error(err);}};}
 function hideManager(){P.showHome();}
 function open(which){if(!P.pause()){status('현재 답변을 저장하지 못했습니다. 답변을 먼저 복사해 주세요.',true);return;}P.openManagement();returnFocus=document.activeElement;panel=which;$('manager').hidden=false;$('manager-title').textContent={companies:'기업 관리',library:'질문 관리',debriefs:'면접 복기'}[which];renderPanel();$('manager').focus();$('manager').scrollIntoView({block:'start',behavior:'instant'});}
 function renderPanel(){const root=$('manager-content');root.replaceChildren();if(panel==='companies')renderCompanies(root);else if(panel==='library')renderLibrary(root);else if(panel==='debriefs')renderDebriefs(root);}
 function updateChrome(){
  const select=$('company-select');select.replaceChildren();const all=el('option','전체 공통 질문 연습');all.value='';select.append(all);
  for(const c of S.state.companies.filter(c=>!c.archived)){const o=el('option',c.name+' · '+c.role);o.value=c.id;select.append(o);}select.value=P.companyId;
  const c=company();$('company-title').textContent=c?c.name+' · '+c.role:'공통 질문 라이브러리';
  const questions=S.questions(P.companyId),records=S.records(P.companyId),done=questions.filter(q=>records[q.id]?.completed).length;
  const progress=questions.length?Math.round(done/questions.length*100):0;
  $('company-summary').textContent=c?`${c.status} · 면접 ${c.schedule?c.schedule.replace('T',' '):'일정 미등록'} (입력한 현지 시각) · 예상 ${questions.length}문항 · 완료 ${done}문항 · 진도율 ${progress}% · 답변 완료 ${Object.values(records).reduce((n,r)=>n+(r.history?.length||0),0)}회`:`전체 기업이 공유하는 ${questions.length}개 문항 · 완료 ${done}개 · 진도율 ${progress}%. 회사별 모범답변과 기록은 기업을 선택하면 볼 수 있습니다.`;
  $('edit-current-company').hidden=!c;$('practice-scope').disabled=!c;
  $('migration-panel').hidden=!S.pendingLegacy;
  for(const b of [$('migrate-records'),$('postpone-migration')])b.disabled=!!S.fatal;
 }
 function renderCompanies(root){
  root.append(button('새 기업 등록',()=>companyForm(root)));
  root.append(el('p','보관한 기업은 연습 선택에서 숨겨지며 모든 자료가 유지됩니다. 언제든 복원할 수 있습니다.','help'));
  const list=el('div');root.append(list);
  if(!S.state.companies.length)list.append(el('p','등록된 기업이 없습니다. 새 기업을 추가해 주세요.'));
  for(const c of S.state.companies){
   const item=el('article',undefined,'management-item');item.dataset.companyId=c.id;
   item.append(el('h3',c.name+' · '+c.role+(c.archived?' (보관됨)':'')));
   const qs=S.questions(c.id), done=qs.filter(q=>c.records[q.id]?.completed).length, percent=qs.length?Math.round(done/qs.length*100):0;
   item.append(el('p',`${c.status} · ${c.schedule?c.schedule.replace('T',' '):'일정 미등록'} · 예상 ${qs.length}문항 · 연습 ${done}/${qs.length} · 진도율 ${percent}%`,'help'));
   const bar=el('div',undefined,'progress-bar');const fill=el('span');fill.style.width=percent+'%';bar.setAttribute('role','img');bar.setAttribute('aria-label',`진도율 ${percent}%`);bar.append(fill);item.append(bar);
   if(c.memo)item.append(el('p',c.memo,'help'));
   if(!c.archived)item.append(button('이 기업 연습',()=>{if(P.setContext(c.id)){updateChrome();hideManager();}}));
   item.append(button('수정',()=>companyForm(root,c)),button(c.archived?'복원':'보관',()=>mutate(s=>{s.companies.find(x=>x.id===c.id).archived=!c.archived;},renderPanel)),button('삭제',()=>{
    deletingId=c.id;$('delete-description').textContent=`${c.name}의 기업 정보, 채용공고, 일정·메모, 전용 질문 ${S.state.library.filter(q=>q.companyId===c.id).length}개, 공통 질문 연결과 회사별 모범답변, 모든 연습 기록 및 면접 복기 ${c.debriefs.length}건을 삭제합니다.${c.id==='lawcompany'?' 기록 이전에 사용한 v1 원본 백업은 자동 삭제하지 않으며 데이터 백업에 포함됩니다.':''}`;$('delete-dialog').showModal();
   },'outline-button danger-button'));list.append(item);
  }
 }
 function companyForm(root,c){
  root.querySelector('form')?.remove();const form=el('form');form.id='company-form';root.prepend(form);form.append(el('h3',c?'기업 정보 수정':'새 기업 등록'));
  const name=field(form,'회사명','company-name','text',c?.name);name.required=true;name.maxLength=100;
  const role=field(form,'지원 직무','company-role','text',c?.role);role.required=true;role.maxLength=100;
  const posting=field(form,'채용공고 텍스트','company-posting','textarea',c?.posting);
  const application=field(form,'지원 상태','company-status','select',c?.status||S.statuses[0],S.statuses);
  const schedule=field(form,'면접 일정 (입력한 현지 시각 그대로 저장)','company-schedule','datetime-local',c?.schedule);
  const memo=field(form,'면접 메모','company-memo','textarea',c?.memo);
  formSubmit(form,'기업 저장',()=>{if(!name.value.trim()||!role.value.trim())throw Error('회사명과 지원 직무를 입력해 주세요.');mutate(s=>{
   const details={name:name.value.trim(),role:role.value.trim(),posting:posting.value,status:application.value,schedule:schedule.value,memo:memo.value};
   if(c)Object.assign(s.companies.find(x=>x.id===c.id),details);else s.companies.push({id:S.uid(),...details,archived:false,links:{},records:{},debriefs:[]});
  },renderPanel);});form.append(button('취소',renderPanel));name.focus();
 }
 function renderLibrary(root){
  const tabs=el('div',undefined,'manager-tabs');
  for(const [mode,label] of [['common','공통 질문 라이브러리'],['company','선택 기업 질문']]){const b=button(label,()=>{libraryMode=mode;renderPanel();});b.setAttribute('aria-pressed',String(libraryMode===mode));tabs.append(b);}root.append(tabs);
  const c=company();if(libraryMode==='company'&&!c){root.append(el('p','먼저 상단에서 기업을 선택해 주세요. 공통 질문은 공통 라이브러리에서 관리할 수 있습니다.'));return;}
  root.append(el('p',libraryMode==='common'?'공통 질문의 문항·카테고리는 연결된 모든 기업에서 공유됩니다. 기본 모범답변은 공통 연습용이며 회사별 답변은 선택 기업 질문에서 따로 편집합니다.':'회사별 모범답변·꼬리질문·키워드·중요도·다시 연습 표시는 이 기업에만 저장됩니다.','help'));
  root.append(button(libraryMode==='common'?'새 공통 질문':'새 회사 전용 질문',()=>questionForm(root,null,libraryMode)));
  if(libraryMode==='company'){
   const form=el('form');form.id='link-form';const available=S.state.library.filter(q=>q.scope==='common'&&!Object.hasOwn(c.links,q.id));
   const pick=field(form,'연결할 공통 질문','link-question','select',available[0]?.id||'',available.map(q=>({value:q.id,label:q.question})));
   const submit=el('button','이 기업에 공통 질문 연결','outline-button');submit.type='submit';submit.disabled=!available.length;form.append(submit);
   form.onsubmit=e=>{e.preventDefault();if(!pick.value)return;mutate(s=>{s.companies.find(x=>x.id===c.id).links[pick.value]={importance:'보통',retry:false};},renderPanel);};root.append(form);
  }
  const list=libraryMode==='common'?S.questions(''):S.questions(c.id);
  if(!list.length)root.append(el('p','아직 질문이 없습니다. 질문을 만들거나 공통 질문을 연결해 주세요.','help'));
  for(const q of list){const item=el('article',undefined,'management-item');item.dataset.questionId=q.id;
   item.append(el('h3',q.question),el('p',`${q.category} · ${q.scope==='common'?'공통':'회사 전용'} · 중요도 ${q.importance||'보통'}${q.retry?' · 다시 연습':''}`,'help'));
   item.append(button('편집',()=>questionForm(root,q,libraryMode)));
   if(libraryMode==='company'&&q.scope==='common')item.append(button('연결 해제',()=>{
    if(!confirm('이 기업의 연결, 회사별 모범답변, 해당 연습 기록을 삭제합니다. 공통 원본과 다른 기업 자료는 유지됩니다. 연결을 해제할까요?'))return;
    mutate(s=>{const target=s.companies.find(x=>x.id===c.id);delete target.links[q.id];delete target.records[q.id];},renderPanel);
   }));
   else item.append(button('질문 삭제',()=>{
    if(!confirm(q.scope==='common'?'공통 질문 원본과 모든 기업의 해당 질문 연결·답변·연습 기록을 삭제합니다. 계속할까요?':'이 기업의 전용 질문과 해당 연습 기록을 삭제합니다. 계속할까요?'))return;
    mutate(s=>{s.library=s.library.filter(x=>x.id!==q.id);delete s.commonRecords[q.id];for(const co of s.companies){delete co.links[q.id];delete co.records[q.id];}},renderPanel);
   },'outline-button danger-button'));root.append(item);
  }
 }
 function questionForm(root,q,mode){
  const c=company();root.querySelector('#question-form')?.remove();const form=el('form');form.id='question-form';root.prepend(form);
  const companyOverride=mode==='company'&&q?.scope==='common';
  form.append(el('h3',companyOverride?'회사별 답변 편집':q?'질문 편집':'새 질문 등록'));
  const question=field(form,'본 질문','edit-question','textarea',q?.question);question.required=true;question.disabled=companyOverride;
  const cat=field(form,'카테고리','edit-category','select',q?.category||S.categories[0],S.categories);cat.disabled=companyOverride;
  const answer=field(form,mode==='company'?'이 회사용 모범답변':'공통 연습용 모범답변','edit-answer','textarea',q?.answer);
  const keywords=field(form,'핵심 키워드 (쉼표로 구분)','edit-keywords','text',q?.keywords.join(', '));
  const importance=field(form,'중요도','edit-importance','select',q?.importance||'보통',['낮음','보통','높음']);
  const retry=field(form,'다시 연습할 질문','edit-retry','checkbox',q?.retry);
  const notes=field(form,'준비 메모','edit-notes','textarea',q?.notes);
  const follows=el('div');form.append(follows);let rows=[];
  function addFollow(f={question:'',answer:''}){const wrap=el('div',undefined,'followup-editor');const id=S.uid();const fq=field(wrap,'꼬리질문','follow-question-'+id,'textarea',f.question);const fa=field(wrap,'꼬리질문 참고 답변','follow-answer-'+id,'textarea',f.answer);const row={wrap,fq,fa,meta:{id:f.id||id,source:f.source||'manual'}};rows.push(row);wrap.append(button('이 꼬리질문 삭제',()=>{rows=rows.filter(x=>x!==row);wrap.remove();}));follows.append(wrap);}
  for(const f of q?.followUps||[])addFollow(f);
  form.append(button('꼬리질문 추가',()=>addFollow()));
  if(q)form.append(el('p','모범답변이나 꼬리질문을 수정하면 이 범위의 해당 질문 완료·자기 평가를 초기화합니다. 작성한 기본 답변은 보존하며, 순서가 바뀔 수 있는 꼬리질문 연습 기록은 초기화합니다.','help'));
  formSubmit(form,'질문 저장',()=>{
   if(!question.value.trim())throw Error('본 질문을 입력해 주세요.');
   const followUps=rows.map(r=>({...r.meta,question:r.fq.value.trim(),answer:r.fa.value}));if(followUps.some(f=>!f.question))throw Error('꼬리질문을 입력하거나 비어 있는 항목을 삭제해 주세요. 참고 답변은 나중에 작성할 수 있습니다.');
   const content={answer:answer.value,keywords:keywords.value.split(',').map(x=>x.trim()).filter(Boolean),followUps,importance:importance.value,retry:retry.checked,notes:notes.value};
   mutate(s=>{
    const id=q?.id||S.uid();
    if(mode==='common'){
     if(q){
      const original=s.library.find(x=>x.id===id);
      for(const co of s.companies){const link=co.links[id];if(!link||!co.records[id])continue;
       const sharedChanged=original.question!==question.value.trim()||original.category!==cat.value;
       const inheritedChanged=(!Object.hasOwn(link,'answer')&&original.answer!==content.answer)||(!Object.hasOwn(link,'followUps')&&JSON.stringify(original.followUps)!==JSON.stringify(content.followUps));
       if(sharedChanged||inheritedChanged)co.records[id]={...co.records[id],completed:false,rating:'',followUps:[]};
      }
      Object.assign(original,{...content,question:question.value.trim(),category:cat.value});
     }
     else s.library.push({id,...content,question:question.value.trim(),category:cat.value,scope:'common',companyId:null});
     if(s.commonRecords[id])s.commonRecords[id]={...s.commonRecords[id],completed:false,rating:'',followUps:[]};
    }else{
     const target=s.companies.find(x=>x.id===c.id);
     if(!companyOverride){if(q)Object.assign(s.library.find(x=>x.id===id),{...content,question:question.value.trim(),category:cat.value});else s.library.push({id,...content,question:question.value.trim(),category:cat.value,scope:'company',companyId:c.id});}
     target.links[id]=content;if(target.records[id])target.records[id]={...target.records[id],completed:false,rating:'',followUps:[]};
    }
   },renderPanel);
  });form.append(button('취소',renderPanel));question.focus();
 }
 function renderDebriefs(root){
  const c=company();if(!c){root.append(el('p','면접 복기를 기록할 기업을 먼저 선택해 주세요.'));return;}
  root.append(el('p',c.name+'의 실제 면접 질문과 답변을 기록합니다. 저장된 복기를 수정하거나 다음 연습 질문으로 등록할 수 있습니다.','help'));
  root.append(button('새 면접 복기',()=>debriefForm(root,c)));
  if(!c.debriefs.length)root.append(el('p','아직 복기 기록이 없습니다.','help'));
  for(const d of c.debriefs){const item=el('article',undefined,'management-item');item.dataset.debriefId=d.id;item.append(el('h3',d.question));
   for(const [label,value] of [['당시 답변',d.answer],['아쉬운 점',d.regret],['개선할 답변',d.improved]])item.append(el('h4',label),el('p',value||'미작성','prose'));
   item.append(button('복기 수정',()=>debriefForm(root,c,d)),button('다음 연습 질문으로 등록',()=>{
    const form=el('form');item.querySelector('form')?.remove();const kind=field(form,'등록 범위','reuse-'+d.id,'select','company',[{value:'company',label:'이 회사 전용 질문'},{value:'common',label:'공통 라이브러리 + 이 회사 연결'}]);
    formSubmit(form,'연습 질문 등록',()=>{if(!d.improved.trim()){status('복기를 수정하여 개선할 답변을 먼저 작성해 주세요.',true);return;}
     mutate(s=>{const id=S.uid();s.library.push({id,scope:kind.value,companyId:kind.value==='company'?c.id:null,category:'실무 상황',question:d.question,answer:d.improved,followUps:[],keywords:[],notes:'실제 면접 복기에서 등록',importance:'높음',retry:true});s.companies.find(x=>x.id===c.id).links[id]={answer:d.improved,importance:'높음',retry:true};},renderPanel);
    });item.append(form);
   }),button('복기 삭제',()=>{if(confirm('이 면접 복기만 삭제합니다. 이미 등록한 연습 질문은 유지됩니다. 삭제할까요?'))mutate(s=>{const target=s.companies.find(x=>x.id===c.id);target.debriefs=target.debriefs.filter(x=>x.id!==d.id);},renderPanel);},'outline-button danger-button'));root.append(item);
  }
 }
 function debriefForm(root,c,d){
  root.querySelector('#debrief-form')?.remove();const form=el('form');form.id='debrief-form';root.prepend(form);
  const q=field(form,'실제 면접에서 받은 질문','debrief-question','textarea',d?.question);q.required=true;
  const a=field(form,'당시 답변','debrief-answer','textarea',d?.answer);
  const regret=field(form,'아쉬운 점','debrief-regret','textarea',d?.regret);
  const improved=field(form,'개선할 답변','debrief-improved','textarea',d?.improved);
  formSubmit(form,'복기 저장',()=>{if(!q.value.trim())throw Error('면접 질문을 입력해 주세요.');mutate(s=>{const target=s.companies.find(x=>x.id===c.id);const value={id:d?.id||S.uid(),question:q.value.trim(),answer:a.value,regret:regret.value,improved:improved.value};if(d)target.debriefs[target.debriefs.findIndex(x=>x.id===d.id)]=value;else target.debriefs.push(value);},renderPanel);});form.append(button('취소',renderPanel));q.focus();
 }
 $('company-select').onchange=e=>{if(!P.setContext(e.target.value,$('practice-scope').value)){updateChrome();return;}updateChrome();hideManager();};
 $('practice-scope').onchange=e=>{if(!P.setContext(P.companyId,e.target.value))return;updateChrome();hideManager();};
 $('open-companies').onclick=()=>open('companies');$('open-library').onclick=()=>open('library');$('open-debriefs').onclick=()=>open('debriefs');
 $('edit-current-company').onclick=()=>{open('companies');companyForm($('manager-content'),company());};
 $('close-manager').onclick=()=>{hideManager();returnFocus?.focus();};

 $('confirm-delete-company').onclick=e=>{e.preventDefault();if(!deletingId)return;const id=deletingId;
  if(mutate(s=>{s.companies=s.companies.filter(c=>c.id!==id);s.library=s.library.filter(q=>q.companyId!==id);},renderPanel)){$('delete-dialog').close();deletingId=null;}
 };
 $('migrate-records').onclick=()=>{try{S.migrate();P.refresh();updateChrome();status(S.message);}catch(e){error(e);}};
 $('postpone-migration').onclick=()=>{S.postpone();P.refresh();updateChrome();status(S.message);};
 $('export-data').onclick=()=>{try{const backup=JSON.parse(S.exportRaw());backup.practiceDraft=P.snapshot();const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download='cx-interview-lab-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('백업 파일을 내려받았습니다. 개인정보가 포함될 수 있으니 안전하게 보관하세요.');}catch(e){error(e);}};
 window.addEventListener('cx-progress',updateChrome);
 updateChrome();if(S.fatal)status(S.fatal,true);
})();
