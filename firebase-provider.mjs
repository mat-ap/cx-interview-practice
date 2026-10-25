/* 공식 Firebase Web SDK. SDK는 동기화를 시작할 때만 불러옵니다. */
const VERSION = '12.0.0';
export async function createFirebaseProvider(config) {
  const [appSDK, authSDK, dbSDK] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-firestore.js`)
  ]);
  const name = 'cx-interview-sync-' + config.projectId;
  const app = appSDK.getApps().find(a => a.name === name) || appSDK.initializeApp(config, name);
  const auth = authSDK.getAuth(app);
  await authSDK.setPersistence(auth, authSDK.browserLocalPersistence);
  await auth.authStateReady();
  if (!auth.currentUser) await authSDK.signInAnonymously(auth);
  const uid = auth.currentUser.uid, db = dbSDK.getFirestore(app);
  const { doc, collection, writeBatch, getDocFromServer, runTransaction, onSnapshot, serverTimestamp, Timestamp } = dbSDK;
  const spaceRef = id => doc(db, 'cxWorkspaces', id);
  const inviteRef = token => doc(db, 'cxInvites', token);
  const memberRef = (id, member) => doc(db, 'cxWorkspaces', id, 'members', member);
  const random = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
  async function verifyIsolation(id) {
    // 실제 개인 자료 업로드 전에 빈 공간으로 기본 읽기/쓰기 격리를 점검합니다.
    const probeApp=appSDK.initializeApp(config,'cx-sync-probe-'+random());
    const probeAuth=authSDK.getAuth(probeApp), probeDb=dbSDK.getFirestore(probeApp);
    const denied=async action=>{try{await action();}catch(e){if(e.code==='permission-denied')return;throw e;}throw Error('Firestore 접근 규칙이 열려 있습니다. 개인 자료는 업로드하지 않았습니다. firestore.rules를 게시해 주세요.');};
    try {
      await authSDK.setPersistence(probeAuth,authSDK.inMemoryPersistence);
      await probeAuth.authStateReady();
      await denied(()=>getDocFromServer(doc(probeDb,'cxWorkspaces',id)));
      await authSDK.signInAnonymously(probeAuth);
      await denied(()=>getDocFromServer(doc(probeDb,'cxWorkspaces',id)));
      await denied(()=>dbSDK.setDoc(doc(probeDb,'cxWorkspaces',id,'members',probeAuth.currentUser.uid),{uid:probeAuth.currentUser.uid,role:'member',approvedAt:serverTimestamp()}));
      await denied(()=>dbSDK.updateDoc(doc(probeDb,'cxWorkspaces',id),{revision:1,payload:'{}',updatedAt:serverTimestamp()}));
    } finally {
      try{if(probeAuth.currentUser)await authSDK.deleteUser(probeAuth.currentUser);}catch{}
      try{await dbSDK.terminate(probeDb);}catch{}
      try{await appSDK.deleteApp(probeApp);}catch{}
    }
  }
  const read = snapshot => { if (!snapshot.exists()) throw Error('동기화 공간을 찾을 수 없습니다.'); return { ...snapshot.data(), id: snapshot.id }; };
  return {
    uid,
    async create(payload) {
      const id = random(), batch = writeBatch(db);
      const empty=JSON.stringify({version:2,companies:[],library:[],commonRecords:{},migration:{legacyImported:true},features:{learningShell:true}});
      batch.set(spaceRef(id), { owner: uid, revision: 0, payload:empty, updatedAt: serverTimestamp() });
      batch.set(memberRef(id, uid), { uid, role: 'owner', approvedAt: serverTimestamp() });
      await batch.commit();
      await verifyIsolation(id);
      await runTransaction(db,async transaction=>{const existing=read(await transaction.get(spaceRef(id)));if(existing.revision!==0)throw Error('초기 공간이 변경되었습니다. 다시 시작해 주세요.');transaction.update(spaceRef(id),{revision:1,payload,updatedAt:serverTimestamp()});});
      return { id, revision: 1, payload };
    },
    async get(id) { return read(await getDocFromServer(spaceRef(id))); },
    watch(id, next, error) {
      return onSnapshot(spaceRef(id), { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        try { next(read(snapshot)); } catch (e) { error(e); }
      }, error);
    },
    async put(id, expectedRevision, payload) {
      return runTransaction(db, async transaction => {
        const ref = spaceRef(id), existing = read(await transaction.get(ref));
        if (existing.revision !== expectedRevision) { const error = Error('다른 기기에서 먼저 변경했습니다. 클라우드 자료를 확인해 주세요.'); error.code = 'sync/conflict'; throw error; }
        const revision = expectedRevision + 1;
        transaction.update(ref, { revision, payload, updatedAt: serverTimestamp() }); return revision;
      });
    },
    async invite(id) {
      const token = random(), expiresAt = Date.now() + 8 * 60 * 1000;
      const batch = writeBatch(db);
      batch.set(inviteRef(token), { workspaceId: id, createdBy: uid, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(expiresAt) });
      await batch.commit(); return { token, expiresAt };
    },
    watchRequests(token, next, error) {
      return onSnapshot(collection(db, 'cxInvites', token, 'requests'), snapshot => next(snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.status === 'pending')), error);
    },
    async request(token) {
      let invitation;
      try { invitation=read(await getDocFromServer(inviteRef(token))); }
      catch(e){if(e.code==='permission-denied')throw Error('연결 코드를 읽을 수 없습니다. 코드 만료·프로젝트·보안 규칙을 확인해 주세요.');throw e;}
      const membership=await getDocFromServer(memberRef(invitation.workspaceId,uid));
      if(!membership.exists()){try{await getDocFromServer(spaceRef(invitation.workspaceId));throw Error('UNSAFE_PUBLIC_SPACE');}catch(e){if(e.message==='UNSAFE_PUBLIC_SPACE')throw Error('미승인 기기가 자료를 읽을 수 있습니다. 보안 규칙을 먼저 확인해 주세요.');if(e.code!=='permission-denied')throw e;}}
      if (invitation.expiresAt.toMillis() <= Date.now()) throw Error('연결 코드가 만료됐습니다. 기존 기기에서 새 코드를 만들어 주세요.');
      const ref = doc(db, 'cxInvites', token, 'requests', uid), previous = await getDocFromServer(ref);
      if (!previous.exists()) { const batch = writeBatch(db); batch.set(ref, { uid, status: 'pending', createdAt: serverTimestamp() }); await batch.commit(); }
      return { workspaceId: invitation.workspaceId, expiresAt: invitation.expiresAt.toMillis() };
    },
    watchApproval(token, next, error) {
      return onSnapshot(doc(db, 'cxInvites', token, 'requests', uid), snapshot => {
        if (!snapshot.metadata.fromCache && snapshot.exists() && snapshot.data().status === 'approved') next();
      }, error);
    },
    async approve(id, token, member) {
      const batch = writeBatch(db);
      batch.set(memberRef(id, member), { uid: member, role: 'member', approvedAt: serverTimestamp() });
      batch.update(doc(db, 'cxInvites', token, 'requests', member), { status: 'approved', approvedAt: serverTimestamp() });
      await batch.commit();
    }
  };
}
