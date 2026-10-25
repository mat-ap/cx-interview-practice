/* 한 문항씩 진행하는 학습 화면. 기업/질문 관리는 manage.js, 영속 저장은 store.js가 담당합니다. */
(() => {
  'use strict';
  const S = window.CXStore;
  const $ = id => document.getElementById(id);
  const clone = S.clone;
  const labels = { good: '잘 답변했어요', okay: '조금 아쉬워요', retry: '다시 연습할래요' };
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let companyId = S.state.companies.find(c => !c.archived)?.id || '';
  let scope = 'mixed', records = S.records(companyId), session = null, current = null, followIndex = -1;
  let seconds = 0, target = 60, timerId = null, startedAt = 0, autoStarted = false;
  let recognition = null, speechVersion = 0, listening = false, savingError = '';
  const notice = message => { $('notice').textContent = message; };
  const node = (tag, text, className) => { const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; return n; };
  const viewIds = ['home-view', 'lesson-view', 'result-view', 'settings-view', 'manager'];
  function showView(id) {
    for (const view of viewIds) $(view).hidden = view !== id;
    document.body.classList.toggle('in-lesson', id === 'lesson-view');
    $('header-context').textContent = { 'home-view': '학습 준비', 'lesson-view': '한 질문씩 연습', 'result-view': '이번 학습 돌아보기', 'settings-view': '설정 및 데이터', manager: '준비 자료 관리' }[id];
    window.scrollTo(0, 0);
  }
  function blank() { return { text: '', completed: false, rating: '', seconds: 0, history: [] }; }
  function record(q = current) {
    if (!records[q.id]) records[q.id] = { ...blank(), followUps: [] };
    const r = records[q.id];
    r.history ||= [];
    r.followUps ||= [];
    q.followUps.forEach((_, i) => { r.followUps[i] ||= blank(); r.followUps[i].history ||= []; });
    return r;
  }
  function activeRecord() { const r = record(); return followIndex < 0 ? r : r.followUps[followIndex]; }
  function activeKey() { return current.id + ':' + followIndex; }
  function persist() {
    try {
      S.saveRecords(companyId, { ...S.records(companyId), ...records });
      $('save-status').textContent = '기기에 임시 저장됨'; savingError = '';
      window.dispatchEvent(new Event('cx-progress')); updateStats(); return true;
    } catch (e) {
      savingError = '저장하지 못했습니다. 입력한 답변을 복사하거나 데이터 백업을 내려받아 주세요. ' + e.message;
      $('save-status').textContent = '저장 실패 · 답변을 복사해 주세요'; notice(savingError); return false;
    }
  }
  function elapsed() { if (timerId) seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000)); }
  function flush() {
    if (!current) return true;
    elapsed(); const r = activeRecord(); r.text = $('answer-input').value; r.seconds = seconds;
    return persist();
  }
  function stopTimer() { elapsed(); clearInterval(timerId); timerId = null; $('timer-toggle').textContent = '시작'; paintTimer(); }
  function startTimer() {
    if (!current || timerId) return;
    autoStarted = true; startedAt = Date.now() - seconds * 1000;
    $('timer-toggle').textContent = '일시정지';
    timerId = setInterval(() => { elapsed(); paintTimer(); if (seconds % 5 === 0) flush(); }, 1000);
  }
  function paintTimer() {
    $('timer').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    $('timer-target-label').textContent = `목표 ${target}초${seconds >= target ? ' · 목표 시간 도달' : ''}`;
    $('time-fill').style.width = Math.min(100, seconds / target * 100) + '%';
  }
  function stopVoice() {
    speechVersion++;
    if (recognition) { recognition.onend = null; try { recognition.abort(); } catch {} recognition = null; }
    listening = false; $('mic-button').textContent = '● 음성으로 답변'; $('mic-button').setAttribute('aria-pressed', 'false');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
  function pause() { stopTimer(); stopVoice(); return flush(); }
  function selectedQuestions() {
    const term = $('search').value.trim().toLocaleLowerCase();
    const range = $('study-range').value;
    return S.questions(companyId, scope).filter(q => {
      const r = records[q.id];
      return (range !== 'retry' || q.retry || r?.rating === 'retry') &&
        (range !== 'new' || !(r?.history?.length || r?.completed)) &&
        (range !== 'category' || q.category === $('study-category').value) &&
        (!term || [q.question, ...q.keywords, q.answer, ...q.followUps.flatMap(f => [f.question, f.answer])].join(' ').toLocaleLowerCase().includes(term));
    });
  }
  const countAttempts = map => Object.values(map).reduce((n, r) => n + (r.history?.length || 0), 0);
  function updateStats() {
    const qs = S.questions(companyId, scope);
    $('total-count').textContent = qs.length;
    $('done-count').textContent = qs.filter(q => records[q.id]?.completed).length;
    $('retry-count').textContent = $('retry-badge').textContent = qs.filter(q => q.retry || records[q.id]?.rating === 'retry').length;
    $('company-attempts').textContent = countAttempts(records) + '회';
    const companyMaps = S.state.companies.map(c => c.id === companyId ? records : c.records);
    $('all-attempts').textContent = [companyId ? S.state.commonRecords : records, ...companyMaps].reduce((n, map) => n + countAttempts(map), 0) + '회';
    $('eligible-count').textContent = selectedQuestions().length;
    $('start-button').disabled = !selectedQuestions().length || S.pendingLegacy;
    $('empty-state').hidden = selectedQuestions().length > 0;
    $('category-field').hidden = $('study-range').value !== 'category';
    $('order-hint').textContent = $('question-order').value === 'random' ? '세션 내 중복 없이 출제' : '등록된 순서대로 차근차근';
    $('settings-restart').disabled = !session;
  }
  function shuffle(ids) {
    const out = [...ids];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  function makeSession(baseIds, order) {
    return { baseIds: [...baseIds], ids: order === 'random' ? shuffle(baseIds) : [...baseIds], index: 0, order, completed: new Set(), attemptIds: new Map() };
  }
  function startSession() {
    if (S.pendingLegacy) return;
    if (!pause()) return;
    const ids = selectedQuestions().map(q => q.id);
    if (!ids.length) { updateStats(); return; }
    target = Number(document.querySelector('[name="target"]:checked').value);
    $('timer-target').value = String(target);
    session = makeSession(ids, $('question-order').value); followIndex = -1; openQuestion();
  }
  function openQuestion() {
    stopTimer(); stopVoice(); followIndex = -1;
    current = S.questions(companyId, scope).find(q => q.id === session.ids[session.index]);
    if (!current) { notice('이 질문이 삭제되었습니다. 학습 설정에서 다시 시작해 주세요.'); showHome(); return; }
    showView('lesson-view'); displayActive();
    $('question-text').focus({ preventScroll: true });
  }
  function renderProgress() {
    const done = session.completed.size;
    const name = S.state.companies.find(c => c.id === companyId)?.name || '전체 공통 질문';
    $('lesson-company').textContent = name;
    $('question-position').textContent = `${session.index + 1} / ${session.ids.length}`;
    $('session-progress').textContent = `이번 학습 완료 ${done}개 · 전체 ${session.ids.length}개`;
    const percent = Math.round(done / session.ids.length * 100);
    $('session-fill').style.width = percent + '%'; $('session-bar').setAttribute('aria-valuenow', String(percent));
    $('previous-button').disabled = session.index === 0;
    $('next-button').textContent = session.index === session.ids.length - 1 ? '학습 마무리 ✓' : '다음 질문 →';
  }
  function referenceText() { return followIndex < 0 ? current.answer : current.followUps[followIndex].answer; }
  function hideReference() {
    $('reference-panel').hidden = true; $('reference-form').hidden = true;
    $('reference-toggle').textContent = '참고 답변 보기'; $('reference-toggle').setAttribute('aria-expanded', 'false');
  }
  function renderHistory() {
    const history = activeRecord().history || []; $('history-count').textContent = history.length;
    const recent = history.at(-1);
    $('recent-practice').textContent = recent ? '최근 연습: ' + (recent.date && !Number.isNaN(Date.parse(recent.date)) ? new Date(recent.date).toLocaleString('ko-KR') : '이전 버전 기록 · 날짜 없음') : '아직 완료한 연습 기록이 없어요.';
    $('history-list').replaceChildren();
    for (const h of [...history].reverse()) {
      const article = node('article', '', 'history-item');
      const date = h.date && !Number.isNaN(Date.parse(h.date)) ? new Date(h.date).toLocaleString('ko-KR') : '이전 버전 기록 · 날짜 없음';
      article.append(node('p', `${date} · ${h.seconds}초${labels[h.rating] ? ' · ' + labels[h.rating] : ''}`, 'help'), node('p', h.text, 'prose'));
      $('history-list').append(article);
    }
    if (!history.length) $('history-list').append(node('p', '아직 완료한 답변 기록이 없어요.', 'help'));
  }
  function displayActive() {
    const r = activeRecord(); seconds = r.seconds || 0; autoStarted = seconds > 0; paintTimer();
    $('question-category').textContent = current.category + ' · ' + (current.scope === 'common' ? '공통' : '회사 전용');
    $('question-kind').textContent = followIndex < 0 ? '나의 경험을 들려주세요' : `꼬리질문 ${followIndex + 1} / ${current.followUps.length}`;
    $('question-text').textContent = followIndex < 0 ? current.question : current.followUps[followIndex].question;
    $('question-hint').textContent = followIndex < 0 ? '완벽하지 않아도 괜찮아요. 나의 생각부터 시작해 보세요.' : '앞선 답변을 조금 더 구체적으로 이야기해 보세요.';
    $('answer-input').value = r.text || '';
    $('input-status').textContent = r.text ? '작성 중인 답변 · ' + r.text.length + '자' : '편하게 적어 보세요';
    $('save-status').textContent = savingError ? '저장 상태를 확인해 주세요' : r.text ? '저장된 답변을 이어서 작성' : '입력하면 자동 임시 저장';
    $('read-question').disabled = !('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
    $('mic-button').disabled = !Recognition;
    $('speech-status').textContent = Recognition ? '음성인식은 브라우저 제공 기능이며 외부 처리 서비스가 사용될 수 있어요. HTTPS와 마이크 권한이 필요할 수 있습니다.' : '이 브라우저는 음성인식을 지원하지 않아요. 텍스트로 답변해 주세요.';
    $('evaluation').hidden = !r.completed;
    $('complete-button').disabled = session.attemptIds.has(activeKey());
    $('complete-button').textContent = session.attemptIds.has(activeKey()) ? '답변 완료됨 ✓' : '답변 완료 ✓';
    $('completion-time').textContent = r.completed ? `이 답변의 소요 시간 ${seconds}초` : '';
    for (const b of document.querySelectorAll('[data-rating]')) b.setAttribute('aria-pressed', String(r.rating === b.dataset.rating));
    $('model-answer').textContent = referenceText() || '아직 참고 답변이 없어요. 직접 수정하기에서 이 공간에 맞는 예시를 작성해 보세요.';
    $('keywords').replaceChildren(...current.keywords.map(k => node('span', k)));
    $('preparation-notes').textContent = current.notes || '';
    hideReference();
    $('followup-button').hidden = !current.followUps.length || followIndex >= 0;
    $('followup-button').disabled = !record().completed || !record().text?.trim();
    $('followup-button').title = record().completed ? '' : '본 질문의 답변을 완료하면 꼬리질문을 연습할 수 있어요.';
    $('followup-navigation').hidden = followIndex < 0;
    $('previous-followup').textContent = followIndex === 0 ? '← 본 질문' : '← 이전 꼬리질문';
    $('followup-progress').textContent = `${followIndex + 1} / ${current.followUps.length}`;
    $('next-followup').disabled = followIndex >= current.followUps.length - 1;
    $('answer-history').querySelector('details').open = false;
    renderHistory(); renderProgress(); notice(savingError);
  }
  function markEdited() {
    const r = activeRecord(); r.text = $('answer-input').value; r.completed = false;
    session.attemptIds.delete(activeKey());
    if (followIndex < 0) session.completed.delete(current.id);
    $('evaluation').hidden = true; $('complete-button').disabled = false; $('complete-button').textContent = '답변 완료 ✓';
    $('input-status').textContent = `작성 중인 답변 · ${r.text.length}자`;
    $('followup-button').disabled = !record().completed;
    renderProgress();
  }
  function navigateMain(delta) {
    if (!pause()) return;
    if (session.index + delta >= session.ids.length) { showResult(); return; }
    session.index = Math.max(0, session.index + delta); openQuestion();
  }
  function navigateFollow(index) {
    if (!pause()) return;
    if (index >= current.followUps.length) return;
    followIndex = Math.max(-1, index); displayActive(); $('question-text').focus({ preventScroll: true });
  }
  function complete() {
    if (!$('answer-input').value.trim()) { notice('나의 답변을 먼저 입력해 주세요.'); $('answer-input').focus(); return; }
    stopTimer(); stopVoice();
    const snapshot = clone(record()); const r = activeRecord();
    const entry = { id: S.uid(), date: new Date().toISOString(), text: $('answer-input').value, seconds, rating: '', source: 'self-practice' };
    r.text = entry.text; r.seconds = seconds; r.completed = true; r.history ||= []; r.history.push(entry); r.lastPracticedAt = entry.date;
    if (!persist()) { records[current.id] = snapshot; return; }
    session.attemptIds.set(activeKey(), entry.id); if (followIndex < 0) session.completed.add(current.id);
    $('evaluation').hidden = false; $('completion-time').textContent = `답변 완료 · 소요 시간 ${seconds}초`;
    $('complete-button').disabled = true; $('complete-button').textContent = '답변 완료됨 ✓';
    $('followup-button').disabled = false; renderProgress(); renderHistory(); notice('답변을 기록했어요. 나의 답변을 스스로 돌아보세요.');
  }
  function showResult() {
    stopTimer(); stopVoice(); showView('result-view');
    const done = session?.completed.size || 0, total = session?.ids.length || 0;
    $('result-summary').textContent = `이번 학습 ${total}개 중 ${done}개 답변 완료 · ${total - done}개 미완료. 작성한 답변과 완료 기록은 그대로 남아 있어요.`;
    $('settings-restart').disabled = !session;
  }
  function showHome() { showView('home-view'); document.querySelector('.workspace').hidden = false; document.querySelector('.workspace-heading').hidden = false; updateStats(); }
  function restart() {
    if (!session) { showHome(); return; }
    if (!confirm('질문 순서와 이번 세션 진행률만 초기화합니다. 입력한 답변·참고 답변·과거 기록은 유지합니다. 다시 시작할까요?')) return;
    if (!pause()) return;
    session = makeSession(session.baseIds.filter(id => S.questions(companyId, scope).some(q => q.id === id)), session.order);
    if (!session.ids.length) { current = null; showHome(); return; }
    openQuestion();
  }
  $('start-form').onsubmit = e => { e.preventDefault(); startSession(); };
  for (const id of ['study-range', 'study-category', 'question-order', 'search']) $(id).addEventListener(id === 'search' ? 'input' : 'change', updateStats);
  for (const c of S.categories) { const o = node('option', c); o.value = c; $('study-category').append(o); }
  $('all-mode').onclick = () => { if (!pause()) return; $('study-range').value = 'all'; showHome(); };
  $('retry-mode').onclick = () => { if (!pause()) return; $('study-range').value = 'retry'; showHome(); };
  $('previous-button').onclick = () => navigateMain(-1);
  $('next-button').onclick = () => navigateMain(1);
  $('end-session').onclick = () => { if (pause()) showResult(); };
  $('back-home').onclick = () => { current = null; showHome(); };
  $('restart-session').onclick = restart;
  $('settings-restart').onclick = restart;
  $('answer-input').oninput = () => {
    if (!current) return;
    if (!autoStarted && $('answer-input').value) startTimer();
    markEdited(); flush();
  };
  $('timer-toggle').onclick = () => { if (timerId) { stopTimer(); autoStarted = true; flush(); } else startTimer(); };
  $('timer-reset').onclick = () => { stopTimer(); seconds = 0; autoStarted = false; activeRecord().seconds = 0; paintTimer(); flush(); };
  $('timer-target').onchange = e => { target = Number(e.target.value); paintTimer(); };
  $('reset-answer').onclick = () => {
    if (!confirm('현재 질문의 작성 중인 답변만 비웁니다. 타이머·참고 답변·질문 원본·완료한 과거 답변 기록은 유지합니다. 초기화할까요?')) return;
    stopVoice(); $('answer-input').value = ''; markEdited(); flush(); $('answer-input').focus();
  };
  $('complete-button').onclick = complete;
  for (const b of document.querySelectorAll('[data-rating]')) b.onclick = () => {
    const r = activeRecord(); if (!r.completed) return;
    const old = clone(r); const entryId = session.attemptIds.get(activeKey()) || r.history?.at(-1)?.id;
    r.rating = b.dataset.rating; const h = r.history?.find(h => h.id === entryId); if (h) h.rating = r.rating;
    if (!persist()) { Object.assign(r, old); return; }
    for (const btn of document.querySelectorAll('[data-rating]')) btn.setAttribute('aria-pressed', String(btn === b));
    notice('자기 평가를 저장했어요: ' + labels[r.rating]);
  };
  $('reference-toggle').onclick = () => {
    const open = $('reference-panel').hidden; $('reference-panel').hidden = !open;
    $('reference-toggle').setAttribute('aria-expanded', String(open)); $('reference-toggle').textContent = open ? '참고 답변 숨기기' : '참고 답변 보기';
  };
  $('edit-reference').onclick = () => { $('reference-form').hidden = false; $('reference-input').value = referenceText(); $('reference-input').focus(); };
  $('cancel-reference').onclick = () => { $('reference-form').hidden = true; };
  $('reference-form').onsubmit = e => {
    e.preventDefault(); if (!flush()) return;
    const answer = $('reference-input').value;
    try {
      S.transaction(s => {
        const q = s.library.find(q => q.id === current.id); if (!q) throw Error('질문을 찾을 수 없습니다.');
        const destination = companyId ? s.companies.find(c => c.id === companyId).links[current.id] : q;
        if (followIndex < 0) destination.answer = answer;
        else { destination.followUps = clone(current.followUps); destination.followUps[followIndex].answer = answer; }
      });
      current = S.questions(companyId, scope).find(q => q.id === current.id);
      $('model-answer').textContent = referenceText() || '아직 참고 답변이 없어요.'; $('reference-form').hidden = true; notice('이 공간의 참고 답변을 저장했어요. 나의 답변은 그대로예요.');
    } catch (err) { notice('참고 답변을 저장하지 못했습니다. ' + err.message); }
  };
  $('followup-button').onclick = () => { if (record().completed) navigateFollow(0); };
  $('previous-followup').onclick = () => navigateFollow(followIndex - 1);
  $('next-followup').onclick = () => navigateFollow(followIndex + 1);
  $('return-main').onclick = () => navigateFollow(-1);
  $('read-question').onclick = () => {
    if ($('read-question').disabled) return;
    stopVoice();
    const utterance = new SpeechSynthesisUtterance($('question-text').textContent); utterance.lang = 'ko-KR'; utterance.rate = .95;
    utterance.onerror = e => { if (!['canceled', 'interrupted'].includes(e.error)) $('speech-status').textContent = '질문을 읽지 못했어요. 기기의 한국어 음성 설정을 확인해 주세요.'; };
    window.speechSynthesis.speak(utterance);
  };
  $('mic-button').onclick = () => {
    if (!Recognition || !current) return;
    if (listening) { try { recognition.stop(); } catch { stopVoice(); } return; }
    stopVoice(); const version = speechVersion, processed = new Set();
    try {
      const instance = new Recognition(); recognition = instance; instance.lang = 'ko-KR'; instance.continuous = true; instance.interimResults = true;
      instance.onresult = event => {
        if (version !== speechVersion) return;
        let addition = '', interim = '';
        for (let i = event.resultIndex || 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal && !processed.has(i)) { processed.add(i); addition += result[0].transcript + ' '; }
          else if (!result.isFinal) interim += result[0].transcript;
        }
        if (addition.trim()) { const input = $('answer-input'); input.value += (input.value && !/\s$/.test(input.value) ? ' ' : '') + addition.trim(); input.oninput(); }
        $('speech-status').textContent = interim ? '인식 중: ' + interim : '듣고 있어요. 확정된 문장은 기존 답변 뒤에 추가돼요.';
      };
      instance.onerror = event => {
        const messages = { 'not-allowed': '마이크 권한이 거부됐어요. 브라우저 권한을 확인하거나 텍스트로 답변해 주세요.', 'service-not-allowed': '이 브라우저에서 음성 서비스를 사용할 수 없어요. 텍스트로 답변해 주세요.', 'audio-capture': '마이크를 찾지 못했어요. 연결을 확인하거나 텍스트로 답변해 주세요.', 'no-speech': '음성을 감지하지 못했어요. 다시 시도하거나 텍스트로 답변해 주세요.', network: '음성인식 연결에 실패했어요. 텍스트로 계속 답변할 수 있어요.' };
        $('speech-status').textContent = messages[event.error] || '음성인식이 중단됐어요. 텍스트 입력으로 계속할 수 있어요.';
      };
      instance.onend = () => { if (version !== speechVersion) return; recognition = null; listening = false; $('mic-button').textContent = '● 음성으로 답변'; $('mic-button').setAttribute('aria-pressed', 'false'); };
      listening = true; $('mic-button').textContent = '■ 음성 입력 중지'; $('mic-button').setAttribute('aria-pressed', 'true'); $('speech-status').textContent = '듣고 있어요. 마이크 권한을 허용해 주세요.';
      instance.start(); if (listening && !autoStarted) startTimer();
    } catch { stopVoice(); $('speech-status').textContent = '음성인식을 시작하지 못했어요. 텍스트 입력을 이용해 주세요.'; }
  };
  $('open-settings').onclick = () => { if (pause()) { showView('settings-view'); $('settings-restart').disabled = !session; } };
  $('close-settings').onclick = showHome;
  $('settings-export').onclick = () => $('export-data').click();
  $('delete-all').onclick = () => { $('wipe-confirm').value = ''; $('wipe-status').textContent = ''; $('wipe-dialog').showModal(); };
  $('cancel-wipe').onclick = () => $('wipe-dialog').close();
  $('wipe-form').onsubmit = e => {
    e.preventDefault();
    if ($('wipe-confirm').value !== '전체 삭제') { $('wipe-status').textContent = '‘전체 삭제’를 정확히 입력해 주세요.'; return; }
    try { stopTimer(); stopVoice(); S.clearAll(); current = null; session = null; records = {}; companyId = ''; $('wipe-dialog').close(); applyTheme('light'); refresh(); window.dispatchEvent(new Event('cx-progress')); $('management-status').textContent = '모든 준비 데이터를 삭제했습니다. 기업과 질문을 새로 등록할 수 있어요.'; }
    catch (err) { $('wipe-status').textContent = err.message; }
  };
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('theme-toggle').textContent = theme === 'dark' ? '☀' : '☾';
    $('theme-toggle').setAttribute('aria-label', theme === 'dark' ? '밝은 테마로 전환' : '다크 테마로 전환');
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#151b18' : '#f6f7f2';
  }
  try { applyTheme(localStorage.getItem('cx-interview-lab:theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch { applyTheme('light'); }
  $('theme-toggle').onclick = () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(theme);
    try { localStorage.setItem('cx-interview-lab:theme', theme); } catch { $('management-status').textContent = '테마는 적용했지만 저장하지 못했어요. 다음 접속 시 다시 선택해 주세요.'; }
  };
  function refresh() {
    stopTimer(); stopVoice(); current = null; session = null; followIndex = -1;
    if (companyId && !S.state.companies.some(c => c.id === companyId && !c.archived)) companyId = '';
    records = S.records(companyId); savingError = S.fatal; showHome();
  }
  window.CXPractice = {
    flush, pause, get companyId() { return companyId; },
    setContext(id, mode = 'mixed') { if (!pause()) return false; companyId = id; scope = mode; refresh(); return true; },
    refresh, showHome, openManagement() { showView('manager'); },
    snapshot() { return { companyId, questionId: current?.id || null, followIndex, seconds, records: clone(records), currentText: current ? $('answer-input').value : '' }; }
  };
  window.addEventListener('pagehide', () => { pause(); });
  window.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  showHome(); notice(S.fatal);
})();
