/* 로그인 UI 없는 기기 연결. 로컬 저장과 클라우드 반영을 구분하며 충돌 시 사용자 선택을 기다립니다. */
(() => {
  'use strict';
  const S = window.CXStore, P = window.CXPractice, $ = id => document.getElementById(id);
  const CONFIG_KEY = 'cx-interview-lab:firebase-config', META_KEY = 'cx-interview-lab:sync';
  let config = window.CX_FIREBASE_CONFIG, meta = null, provider = null, providerPromise = null;
  let stopWatch = null, stopRequests = null, stopApproval = null, approvalTimer = null, timer = null, remotePending = null;
  let busy = false, writing = false, generation = 0, invitationToken = '', reconnectError = '', receiveQueue = Promise.resolve();
  const status = text => { $('sync-status').textContent = text;$('sync-status').classList.toggle('save-warning',/실패|오류|거부|초과/.test(text));const indicator=$('sync-indicator');indicator.textContent=!meta?'기기 저장':remotePending||/실패|오류|충돌/.test(text)?'동기화 확인':!navigator.onLine?'오프라인':meta.dirty||writing?'동기화 대기':'동기화 연결';indicator.title=text; };
  const digest = async payload => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const payload = () => JSON.stringify(S.state);
  function validConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.private_key || value.type === 'service_account') throw Error('Firebase 웹 앱의 공개 firebaseConfig만 입력해 주세요. 서비스 계정 키는 사용할 수 없습니다.');
    const result = {};
    for (const k of ['apiKey', 'authDomain', 'projectId', 'appId']) { if (typeof value[k] !== 'string' || !value[k].trim()) throw Error(k + '가 필요합니다.'); result[k] = value[k].trim(); }
    if (!/^[a-z0-9-]+$/.test(result.projectId) || !/^[a-z0-9.-]+$/.test(result.authDomain)) throw Error('프로젝트 ID 또는 인증 도메인을 확인해 주세요.');
    for (const k of ['storageBucket', 'messagingSenderId']) if (typeof value[k] === 'string') result[k] = value[k];
    return result;
  }
  try { const saved = localStorage.getItem(CONFIG_KEY); if (saved) config = validConfig(JSON.parse(saved)); if (config) config = validConfig(config); const linked = localStorage.getItem(META_KEY); if (linked) { meta = JSON.parse(linked); if (!meta || typeof meta.id !== 'string' || !Number.isInteger(meta.revision) || typeof meta.baseHash !== 'string' || typeof meta.uid !== 'string' || typeof meta.projectId !== 'string') throw Error('기기 연결 정보 형식이 올바르지 않습니다.'); } }
  catch (e) { reconnectError = '연결 설정을 불러오지 못했습니다. 로컬 자료는 그대로입니다. ' + e.message; meta = null; }
  function saveMeta() { if (meta) localStorage.setItem(META_KEY, JSON.stringify(meta)); }
  function controls() {
    $('sync-create').hidden = !!meta;
    $('sync-invite').hidden = $('sync-stop').hidden = !meta;
    $('sync-join-form').hidden = !!meta;
    $('sync-actions').hidden = !meta;
    for (const id of ['sync-create', 'sync-invite', 'sync-join', 'sync-push', 'sync-pull']) $(id).disabled = busy || writing;
    if(stopApproval){$('sync-create').disabled=true;$('sync-join').disabled=true;}
    $('sync-device').textContent = provider ? '이 기기 식별: ' + provider.uid.slice(0, 12) + (meta ? ' · 연결된 기기끼리만 접근' : '') : '';
  }
  async function withBusy(action) {
    if (busy) return;
    busy = true; controls();
    let success=false;
    try { await action(); success=true; } catch (e) { status('동기화를 완료하지 못했습니다. 로컬 자료는 유지됩니다. ' + e.message); }
    finally { busy = false; controls(); if(success && meta?.dirty && !remotePending && !writing)schedule(); }
  }
  async function connect() {
    if (S.fatal) throw Error('저장된 로컬 자료 오류를 먼저 확인해 주세요.');
    if (S.pendingLegacy) throw Error('기존 기록 이전 또는 나중에를 먼저 선택해 주세요.');
    if (!config) throw Error('Firebase 공개 웹 설정을 먼저 등록해 주세요.');
    if (!navigator.onLine) throw Error('인터넷 연결이 필요합니다.');
    if (!crypto.subtle) throw Error('HTTPS 주소에서 동기화를 사용해 주세요.');
    if (!providerPromise) providerPromise = (async () => {
      status('Firebase에 기기를 자동 인증하고 있습니다…');
      const factory = window.CXSyncProviderFactory || (await import('./firebase-provider.mjs')).createFirebaseProvider;
      const p = await factory(config); provider = p; return p;
    })().catch(e => { providerPromise = null; throw e; });
    const p = await providerPromise;
    if (meta && (meta.projectId !== config.projectId || meta.uid !== p.uid)) throw Error('프로젝트 또는 브라우저 인증이 달라졌습니다. 동기화를 중지한 뒤 기존 기기에서 새 연결 코드를 받아 주세요.');
    controls(); return p;
  }
  function checkedPayload() {
    const text = payload(); S.validateRemote(JSON.parse(text));
    if (new TextEncoder().encode(text).length > 850000) throw Error('자료가 단일 동기화 문서의 안전 크기(850KB)를 초과했습니다. 전체 자료는 로컬에 보존됩니다. 백업 후 기록 정리가 필요합니다.');
    return text;
  }
  function listen() {
    stopWatch?.();
    const epoch = generation;
    stopWatch = provider.watch(meta.id, incoming => {
      if (epoch !== generation || !meta) return;
      receiveQueue=receiveQueue.then(()=>{if(epoch===generation && meta)return receive(incoming);}).catch(e=>status('클라우드 자료 확인 실패: '+e.message));
    }, e => { if (epoch === generation) status('클라우드 연결 오류 · 이 기기에 저장 중. ' + e.message); });
  }
  async function receive(remote) {
    if (!meta || remote.id !== meta.id) return;
    if (!Number.isInteger(remote.revision) || typeof remote.payload !== 'string') throw Error('클라우드 자료 형식을 확인할 수 없습니다.');
    S.validateRemote(JSON.parse(remote.payload));
    const local = payload(), localHash = await digest(local), remoteHash = await digest(remote.payload);
    if (localHash === remoteHash) {
      if (remote.revision >= meta.revision) { meta.revision = remote.revision; meta.baseHash = remoteHash; meta.dirty = false; saveMeta(); remotePending = null; status('동기화 완료 · 연결된 기기와 자료가 같습니다.'); }
      return;
    }
    if (remote.revision <= meta.revision) {
      if (localHash !== meta.baseHash) { meta.dirty = true; saveMeta(); schedule(); }
      return;
    }
    // 작성/연습 중이거나 로컬 변경이 있으면 원격 자료를 자동 적용하지 않습니다.
    if (busy || writing || $('home-view').hidden || meta.dirty || localHash !== meta.baseHash || P.snapshot().questionId || !$('manager').hidden) {
      remotePending = remote; status('다른 기기의 변경이 있습니다. 백업 후 클라우드 자료 적용 또는 이 기기 자료 보내기를 선택해 주세요.'); controls(); return;
    }
    await apply(remote);
  }
  async function apply(remote) {
    if(remote.revision<meta.revision)throw Error('더 최신 변경이 있습니다. 클라우드 자료를 다시 확인해 주세요.');
    const next = JSON.parse(remote.payload); S.validateRemote(next);
    S.replaceRemote(next); P.refresh(); window.dispatchEvent(new Event('cx-progress'));
    meta.revision = remote.revision; meta.baseHash = await digest(payload()); meta.dirty = false; saveMeta(); remotePending = null;
    status('클라우드 자료를 이 기기에 적용했습니다.'); controls();
  }
  function schedule() {
    clearTimeout(timer);
    if (!meta || remotePending || busy) return;
    timer = setTimeout(() => { push(false).catch(e => status('전송 실패 · 로컬 저장은 유지됩니다. ' + e.message)); }, 2500);
  }
  async function push(force) {
    if (!meta || writing || remotePending && !force) return;
    if (!navigator.onLine) { status('오프라인 · 이 기기에 저장 중. 연결이 복구되면 다시 확인합니다.'); return; }
    const p = await connect(), epoch = generation, text = checkedPayload(), hash = await digest(text);
    if (!force && hash === meta.baseHash) { meta.dirty = false; saveMeta(); return; }
    const expected = force && remotePending ? remotePending.revision : meta.revision;
    const id = meta.id; let committed=false; writing = true; status('변경 내용을 동기화하고 있습니다…');
    try {
      const revision = await p.put(id, expected, text);
      if (epoch !== generation || !meta || meta.id !== id) return;
      committed=true;meta.revision = revision; meta.baseHash = hash; meta.dirty = await digest(payload()) !== hash; saveMeta();
      if (remotePending?.revision <= revision) remotePending = null;
      status(meta.dirty ? '추가 변경이 있어 이어서 저장합니다.' : '동기화 완료 · 클라우드 저장을 확인했습니다.');
    } catch (e) {
      if (epoch !== generation || !meta) return;
      meta.dirty = true; saveMeta();
      if (e.code === 'sync/conflict') { remotePending = await p.get(id); status('동시에 수정한 자료가 있습니다. 사용할 자료를 직접 선택해 주세요.'); }
      else status('동기화 실패 · 로컬 자료는 유지됩니다. 인터넷·Firebase 권한·무료 할당량을 확인해 주세요. ' + e.message);
    } finally { writing = false; if (committed && meta?.dirty && !remotePending) schedule(); controls(); }
  }
  async function beginCreated() {
    if (!P.pause()) throw Error('현재 답변을 로컬에 저장하지 못했습니다.');
    const p = await connect(), text = checkedPayload();
    // 동기화 시작 전 로컬 사본을 저장해 둡니다.
    S.transaction(() => {});
    const remote = await p.create(text);
    meta = { id: remote.id, projectId: config.projectId, uid: p.uid, revision: remote.revision, baseHash: await digest(text), dirty: false };
    saveMeta(); listen(); status('동기화 공간을 만들었습니다. 다른 기기에서는 연결 코드를 입력해 주세요.'); controls();
  }
  async function join(token) {
    const p = await connect();
    if (!/^[a-f0-9]{48}$/.test(token)) throw Error('48자리 연결 코드를 확인해 주세요.');
    const epoch = generation, request = await p.request(token); clearTimeout(approvalTimer);
    stopApproval?.(); status('기존 기기에서 연결 승인을 기다리고 있습니다. 기기 식별 앞부분이 같은지 확인해 주세요.');
    stopApproval = p.watchApproval(token, () => {
      setTimeout(()=>withBusy(async () => {
        if (epoch !== generation || meta) return;
        const remote = await p.get(request.workspaceId); S.validateRemote(JSON.parse(remote.payload));
        meta = { id: remote.id, projectId: config.projectId, uid: p.uid, revision: remote.revision, baseHash: await digest(remote.payload), dirty: await digest(payload()) !== await digest(remote.payload) };
        saveMeta(); clearTimeout(approvalTimer); stopApproval?.(); stopApproval = null;
        if (meta.dirty) { remotePending = remote; status('기기 연결을 승인받았습니다. 두 자료가 달라 자동 덮어쓰지 않습니다. 클라우드 자료 적용 또는 이 기기 자료 보내기를 선택해 주세요.'); }
        else status('기기를 연결했습니다. 자료가 같습니다.');
        listen(); controls();
      }),0);
    }, e => status('연결 승인 확인 실패: ' + e.message));
    approvalTimer=setTimeout(()=>{if(!meta&&epoch===generation){stopApproval?.();stopApproval=null;status('연결 요청이 만료됐습니다. 기존 기기에서 새 코드를 받아 주세요.');controls();}},Math.max(0,(request.expiresAt||Date.now()+480000)-Date.now()));
  }
  $('sync-indicator').onclick=()=>{$('open-settings').click();if(!$('settings-view').hidden)$('sync-panel').scrollIntoView({block:'start'});};
  $('sync-config-form').onsubmit = e => {
    e.preventDefault();
    try {
      if (meta || stopApproval) throw Error('동기화를 중지하거나 연결 요청 대기를 끝낸 후 설정해 주세요.');
      const next = validConfig(JSON.parse($('sync-config-input').value));
      localStorage.setItem(CONFIG_KEY, JSON.stringify(next)); config = next; provider = null; providerPromise = null;
      status('공개 웹 설정을 저장했습니다. Firebase에서 익명 인증과 Firestore 보안 규칙도 설정해 주세요.'); controls();
    } catch (err) { status('설정 저장 실패: ' + err.message); }
  };
  $('sync-create').onclick = () => withBusy(beginCreated);
  $('sync-join-form').onsubmit = e => { e.preventDefault(); withBusy(() => join($('sync-join-code').value.trim())); };
  $('sync-invite').onclick = () => withBusy(async () => {
    const p = await connect(); const invitation = await p.invite(meta.id); invitationToken = invitation.token;
    $('sync-code').value = invitation.token; $('sync-expiry').textContent = '만료: ' + new Date(invitation.expiresAt).toLocaleString('ko-KR') + ' · 코드는 다른 사람에게 공유하지 마세요.';
    $('sync-invitation').hidden = false; stopRequests?.();
    stopRequests = p.watchRequests(invitation.token, requests => {
      $('sync-requests').replaceChildren();
      for (const request of requests) {
        const item = document.createElement('p'); item.textContent = '연결 요청 기기: ' + request.uid.slice(0, 12) + ' ';
        const b = document.createElement('button'); b.className = 'outline-button'; b.textContent = '내 기기 승인'; b.onclick = () => withBusy(async () => {
          if (!confirm('다른 기기 화면의 식별 값이 ' + request.uid.slice(0, 12) + '인지 확인했나요? 승인하면 이 공간의 모든 자료에 접근할 수 있습니다.')) return;
          await p.approve(meta.id, invitationToken, request.uid); status('기기 연결을 승인했습니다.');
        }); item.append(b); $('sync-requests').append(item);
      }
    }, e => status('기기 요청 확인 실패: ' + e.message));
    status('기존 기기에서 코드를 입력하고 요청하면 여기에서 승인할 수 있습니다.');
  });
  $('sync-copy').onclick = async () => { try { await navigator.clipboard.writeText($('sync-code').value); status('연결 코드를 복사했습니다.'); } catch { $('sync-code').select(); status('코드를 선택했습니다. 직접 복사해 주세요.'); } };
  $('sync-pull').onclick = () => withBusy(async () => {
    const p = await connect(), remote = await p.get(meta.id);
    if (!confirm('클라우드 자료로 이 기기의 모든 기업·답변·기록을 교체합니다. 현재 연습도 종료합니다. 필요한 로컬 자료를 백업했나요?')) return;
    clearTimeout(timer); await apply(remote);
  });
  $('sync-push').onclick = () => withBusy(async () => {
    if (!P.pause()) throw Error('로컬 답변을 저장하지 못했습니다.');
    const p = await connect(); remotePending = await p.get(meta.id);
    if (!confirm('이 기기의 전체 자료로 클라우드를 교체합니다. 다른 기기에도 이 자료가 전달됩니다. 계속할까요?')) return;
    await push(true);
  });
  $('sync-stop').onclick = () => {
    if (writing || busy) { status('진행 중인 작업이 끝난 후 중지해 주세요.'); return; }
    if (!confirm('이 기기의 자동 동기화를 중지합니다. 로컬 자료와 클라우드 자료는 유지되며, 클라우드 접근 권한 자체를 회수하는 기능은 아닙니다. 계속할까요?')) return;
    try { localStorage.removeItem(META_KEY); } catch (e) { status('연결 정보를 지우지 못했습니다. ' + e.message); return; }
    generation++; clearTimeout(timer); clearTimeout(approvalTimer); stopWatch?.(); stopRequests?.(); stopApproval?.(); meta = null; remotePending = null; $('sync-invitation').hidden = true; $('sync-join-code').value = ''; controls(); status('이 기기 동기화를 중지했습니다. 로컬과 클라우드 자료는 유지됩니다.');
  };
  window.addEventListener('cx-data-change', e => {
    if (!meta || e.detail?.reason === 'remote') return;
    meta.dirty = true;
    try { saveMeta(); } catch { status('동기화 대기 상태를 저장하지 못했습니다. 로컬 자료를 백업해 주세요.'); return; }
    status(remotePending ? '양쪽 기기의 변경이 있습니다. 사용할 자료를 직접 선택해 주세요.' : '이 기기에 저장됨 · 클라우드 동기화 대기 중'); schedule();
  });
  window.addEventListener('offline', () => { if (meta) status('오프라인 · 로컬에 저장 중. 온라인 복구 후 다시 확인합니다.'); });
  window.addEventListener('online', () => { if (meta) withBusy(async () => { await connect(); listen(); if (meta.dirty && !remotePending) await push(false); }); });
  window.CXSync = { get isLinked() { return !!meta; } };
  if (config) $('sync-config-input').value = JSON.stringify(config, null, 2);
  controls();
  if (reconnectError) status(reconnectError);
  else if (meta && config) withBusy(async () => { await connect(); meta.dirty = await digest(payload()) !== meta.baseHash; saveMeta(); listen(); const remote = await provider.get(meta.id); await receive(remote); });
  else status(config ? 'Firebase 설정 있음 · 동기화 시작 또는 다른 기기 연결을 선택해 주세요.' : 'Firebase 설정 전 · 현재는 이 기기에만 저장합니다.');
})();
