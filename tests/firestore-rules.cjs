/* Firebase Emulator 전용. 실제 프로젝트나 서비스 계정 키를 사용하지 않습니다. */
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('미실행: FIRESTORE_EMULATOR_HOST를 지정하고 Firestore Emulator를 시작해 주세요.');
 const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const {doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp,Timestamp}=require('firebase/firestore');
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
 const env=await initializeTestEnvironment({projectId:'demo-cx-interview-sync',firestore:{host,port:Number(port),rules:fs.readFileSync(path.join(__dirname,'..','firestore.rules'),'utf8')}});
 let n=0;const check=t=>{n++;console.log('PASS '+t)};
 try{
  await env.clearFirestore();const owner=env.authenticatedContext('owner').firestore(),candidate=env.authenticatedContext('candidate').firestore(),stranger=env.authenticatedContext('stranger').firestore(),anonymous=env.unauthenticatedContext().firestore();
  const space=db=>doc(db,'cxWorkspaces','one');const member=(db,id)=>doc(db,'cxWorkspaces','one','members',id);const token='ab'.repeat(24);const invite=db=>doc(db,'cxInvites',token);const request=(db,id)=>doc(db,'cxInvites',token,'requests',id);
  const initial=writeBatch(owner);initial.set(space(owner),{owner:'owner',revision:0,payload:'{}',updatedAt:serverTimestamp()});initial.set(member(owner,'owner'),{uid:'owner',role:'owner',approvedAt:serverTimestamp()});await assertSucceeds(initial.commit());await assertSucceeds(getDoc(space(owner)));check('공간과 소유 기기 원자적 생성');
  await assertFails(getDoc(space(anonymous)));await assertFails(getDoc(space(stranger)));await assertFails(getDocs(collection(owner,'cxWorkspaces')));check('비인증·미승인 기기 읽기 및 공간 열거 차단');
  await assertFails(updateDoc(space(owner),{payload:'tamper',updatedAt:serverTimestamp()}));await assertFails(updateDoc(space(owner),{owner:'stranger',revision:1,updatedAt:serverTimestamp()}));await assertFails(deleteDoc(space(owner)));check('버전 누락·소유자 변경·문서 삭제 차단');
  await assertSucceeds(setDoc(invite(owner),{workspaceId:'one',createdBy:'owner',createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+480000)}));await assertSucceeds(getDoc(invite(candidate)));await assertFails(getDocs(collection(candidate,'cxInvites')));check('연결 코드 개별 조회 허용·열거 차단');
  await assertFails(setDoc(doc(stranger,'cxInvites','cd'.repeat(24)),{workspaceId:'one',createdBy:'stranger',createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+480000)}));await assertFails(setDoc(doc(owner,'cxInvites','ef'.repeat(24)),{workspaceId:'one',createdBy:'owner',createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+3600000)}));check('미승인 기기의 코드 생성·과도한 만료 시간 차단');
  await assertSucceeds(setDoc(request(candidate,'candidate'),{uid:'candidate',status:'pending',createdAt:serverTimestamp()}));await assertFails(setDoc(member(candidate,'candidate'),{uid:'candidate',role:'member',approvedAt:serverTimestamp()}));await assertFails(updateDoc(request(candidate,'candidate'),{status:'approved',approvedAt:serverTimestamp()}));await assertFails(getDocs(collection(candidate,'cxInvites',token,'requests')));check('연결 요청 허용·자기 승인/자기 권한 부여·요청 목록 열람 차단');
  const approval=writeBatch(owner);approval.set(member(owner,'candidate'),{uid:'candidate',role:'member',approvedAt:serverTimestamp()});approval.update(request(owner,'candidate'),{status:'approved',approvedAt:serverTimestamp()});await assertSucceeds(approval.commit());await assertSucceeds(getDoc(space(candidate)));check('승인 후에만 공간 접근');
  await assertSucceeds(updateDoc(space(candidate),{revision:1,payload:'{"saved":true}',updatedAt:serverTimestamp()}));await assertSucceeds(updateDoc(space(owner),{revision:2,payload:'{"newer":true}',updatedAt:serverTimestamp()}));await assertFails(updateDoc(space(candidate),{revision:2,payload:'{"stale":true}',updatedAt:serverTimestamp()}));assert.equal((await getDoc(space(owner))).data().revision,2);check('승인 기기의 저장·오래된 버전 덮어쓰기 차단');
  await assertFails(updateDoc(member(candidate,'candidate'),{role:'owner'}));await assertFails(deleteDoc(member(candidate,'owner')));await assertSucceeds(deleteDoc(member(candidate,'candidate')));await assertFails(getDoc(space(candidate)));check('소유자 탈취 차단·기기 권한 회수 후 접근 차단');
  console.log(`완료: ${n}개 Firestore 보안 규칙 검증 통과`);
 }finally{await env.cleanup();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
