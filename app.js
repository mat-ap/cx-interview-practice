(() => {
  'use strict';
  const CATEGORIES = ['자기소개', '지원동기', '직무 이해', '성공/실패', '컬처핏', '협업', '실무 상황', 'AX 자동화'];
  const KEY = 'cx-interview-lab:v1';
  const $ = id => document.getElementById(id);
  const valid = q => q && typeof q.id === 'string' && q.id && CATEGORIES.includes(q.category) && typeof q.question === 'string' && typeof q.answer === 'string' && Array.isArray(q.keywords) && q.keywords.every(k => typeof k === 'string') && Array.isArray(q.followUps) && q.followUps.length >= 1 && q.followUps.length <= 3 && q.followUps.every(f => f && typeof f.question === 'string' && typeof f.answer === 'string');
  const seenIds = new Set();
  const raw = Array.isArray(window.CX_QUESTIONS) ? window.CX_QUESTIONS : [];
  const questions = raw.filter(q => { if (!valid(q) || seenIds.has(q.id)) return false; seenIds.add(q.id); return true; });
  let records = Object.create(null), storageError = '', current = null, followIndex = -1, category = '', retryOnly = false, visited = new Set(), seconds = 0, timerId = null, recognition = null, listening = false, speechVersion = 0;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ratingLabels = { good: '잘함', okay: '보통', retry: '다시 연습' };
  function notice(message) { $('notice').textContent = message; }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error();
      for (const q of questions) {
        const r = saved[q.id];
        if (!r || typeof r !== 'object') continue;
        records[q.id] = { text: typeof r.text === 'string' ? r.text : '', completed: r.completed === true, rating: Object.hasOwn(ratingLabels, r.rating) ? r.rating : '', seconds: Number.isFinite(r.seconds) ? Math.max(0, r.seconds) : 0, followUps: q.followUps.map((_, i) => { const f = r.followUps?.[i]; return { text: typeof f?.text === 'string' ? f.text : '', completed: f?.completed === true, seconds: Number.isFinite(f?.seconds) ? Math.max(0, f.seconds) : 0 }; }) };
      }
    } catch { storageError = '기록을 불러오지 못했습니다. 이 창에서는 연습할 수 있지만 기존 기록을 확인하려면 브라우저 저장 설정을 확인하세요.'; }
  }
  function record(q = current) {
    if (!records[q.id]) records[q.id] = { text: '', completed: false, rating: '', seconds: 0, followUps: q.followUps.map(() => ({ text: '', completed: false, seconds: 0 })) };
    return records[q.id];
  }
  function activeRecord() { const r = record(); return followIndex < 0 ? r : r.followUps[followIndex]; }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(records)); $('save-status').textContent = '기기에 저장됨'; storageError = ''; }
    catch { storageError = '저장하지 못했습니다. 저장 공간 또는 개인정보 보호 설정을 확인하세요. 창을 닫기 전에 답변을 복사해 두세요.'; $('save-status').textContent = '저장 실패 · 답변을 복사해 주세요'; notice(storageError); }
  }
  function saveActive() { if (!current) return; const r = activeRecord(); r.text = $('answer-input').value; r.seconds = seconds; persist(); }
  function pool() { const term = $('search').value.trim().toLocaleLowerCase(); return questions.filter(q => (!category || q.category === category) && (!retryOnly || records[q.id]?.rating === 'retry') && (!term || [q.question, q.answer, ...q.keywords, ...q.followUps.flatMap(f => [f.question, f.answer])].join(' ').toLocaleLowerCase().includes(term))); }
  function render() {
    $('total-count').textContent = questions.length;
    $('done-count').textContent = questions.filter(q => records[q.id]?.completed).length;
    const retryCount = questions.filter(q => records[q.id]?.rating === 'retry').length;
    $('retry-count').textContent = $('retry-badge').textContent = retryCount;
    $('all-mode').classList.toggle('active', !retryOnly); $('retry-mode').classList.toggle('active', retryOnly);
    $('all-mode').setAttribute('aria-pressed', String(!retryOnly)); $('retry-mode').setAttribute('aria-pressed', String(retryOnly));
    $('workspace-title').textContent = retryOnly ? '다시 연습할 질문' : '면접 연습';
    $('categories').replaceChildren();
    for (const c of ['', ...CATEGORIES]) {
      const button = document.createElement('button'); button.className = 'category-button'; button.classList.toggle('active', category === c); button.setAttribute('aria-pressed', String(category === c));
      const label = document.createElement('span'); label.textContent = c || '전체 카테고리'; label.style.color = 'inherit';
      const count = document.createElement('span'); count.textContent = questions.filter(q => !c || q.category === c).length;
      button.append(label, count); button.onclick = () => { category = c; render(); }; $('categories').append(button);
    }
    const filtered = pool(); $('filtered-count').textContent = filtered.length + '개'; $('question-list').replaceChildren();
    for (const q of filtered) {
      const button = document.createElement('button'); button.className = 'question-item'; button.classList.toggle('selected', current?.id === q.id); button.setAttribute('aria-pressed', String(current?.id === q.id));
      const c = document.createElement('small'); c.textContent = q.category;
      const title = document.createElement('strong'); title.textContent = q.question; button.append(c, title);
      if (records[q.id]?.completed) { const state = document.createElement('em'); state.textContent = '연습 완료' + (records[q.id].rating ? ' · ' + ratingLabels[records[q.id].rating] : ''); button.append(state); }
      button.onclick = () => select(q); $('question-list').append(button);
    }
    if (!filtered.length) { const p = document.createElement('p'); p.className = 'help'; p.textContent = questions.length ? '조건에 맞는 질문이 없습니다. 검색어나 카테고리를 변경해 주세요.' : '아직 질문이 없습니다. questions.js에 질문을 추가해 주세요.'; $('question-list').append(p); }
    const remaining = filtered.filter(q => !visited.has(q.id)).length;
    $('session-progress').textContent = `현재 조건 ${filtered.length}개 · 미출제 ${remaining}개`;
    $('next-button').disabled = filtered.length === 0;
    $('next-button').textContent = !current ? '무작위 연습 시작 →' : remaining ? '다음 질문 →' : '새 세션 시작 →';
    document.querySelectorAll('[data-rating]').forEach(b => b.setAttribute('aria-pressed', String(current && record().rating === b.dataset.rating)));
  }
  function stopTimer() { clearInterval(timerId); timerId = null; $('timer-toggle').textContent = '타이머 시작'; }
  function paintTimer() { $('timer').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'); $('time-fill').style.width = Math.min(100, seconds / 90 * 100) + '%'; }
  function stopVoice() { speechVersion++; if (recognition) { recognition.onend = null; recognition.abort(); recognition = null; } listening = false; $('mic-button').textContent = '● 음성으로 답변'; $('mic-button').setAttribute('aria-pressed', 'false'); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
  function updateReview(completed) {
    $('review').hidden = !completed; $('model-details').open = false;
    $('model-answer').textContent = followIndex < 0 ? current.answer : current.followUps[followIndex].answer;
    $('keywords').replaceChildren(...current.keywords.map(k => { const s = document.createElement('span'); s.textContent = k; return s; }));
    $('evaluation').hidden = followIndex >= 0;
    const remaining = current.followUps.length - (followIndex + 1);
    $('followup-progress').textContent = followIndex < 0 ? `꼬리질문 ${current.followUps.length}개 준비됨` : `꼬리질문 ${followIndex + 1} / ${current.followUps.length}`;
    $('followup-button').textContent = followIndex < 0 ? '꼬리질문 시작 →' : remaining ? '다음 꼬리질문 →' : '기본 질문으로 돌아가기';
  }
  function displayActive() {
    const r = activeRecord(); seconds = r.seconds || 0; paintTimer();
    $('question-category').textContent = current.category + (followIndex >= 0 ? ' · 꼬리질문' : '');
    $('question-text').textContent = followIndex < 0 ? current.question : current.followUps[followIndex].question;
    $('question-hint').textContent = followIndex < 0 ? '실제 면접처럼, 먼저 나의 답변을 만들어 보세요.' : `꼬리질문 ${followIndex + 1} / ${current.followUps.length} · 앞선 답변을 더 구체적으로 설명해 보세요.`;
    $('answer-input').value = r.text; $('answer-input').disabled = false;
    $('timer-toggle').disabled = $('complete-button').disabled = false;
    $('read-question').disabled = !('speechSynthesis' in window);
    $('mic-button').disabled = !Recognition;
    $('save-status').textContent = storageError ? '저장 상태 확인 필요' : r.text ? '이전 답변 불러옴' : '입력하면 자동 저장';
    updateReview(r.completed); render();
  }
  function select(q) { if (current) saveActive(); stopTimer(); stopVoice(); current = q; followIndex = -1; visited.add(q.id); notice(storageError); displayActive(); }
  $('next-button').onclick = () => { const candidates = pool(); if (!candidates.length) return; let remaining = candidates.filter(q => !visited.has(q.id)); if (!remaining.length) { visited = new Set(); remaining = candidates; } select(remaining[Math.floor(Math.random() * remaining.length)]); };
  $('all-mode').onclick = () => { retryOnly = false; render(); };
  $('retry-mode').onclick = () => { retryOnly = true; render(); };
  $('search').oninput = render;
  $('answer-input').oninput = () => { if (!current) return; const r = activeRecord(); r.completed = false; if (followIndex < 0) record().rating = ''; $('review').hidden = true; saveActive(); render(); };
  $('timer-toggle').onclick = () => { if (timerId) { stopTimer(); saveActive(); return; } const started = Date.now() - seconds * 1000; $('timer-toggle').textContent = '일시 정지'; timerId = setInterval(() => { seconds = Math.floor((Date.now() - started) / 1000); paintTimer(); if (seconds % 5 === 0) saveActive(); }, 1000); };
  $('complete-button').onclick = () => { if (!$('answer-input').value.trim()) { notice('답변을 입력한 후 완료해 주세요.'); $('answer-input').focus(); return; } stopTimer(); stopVoice(); activeRecord().completed = true; saveActive(); updateReview(true); render(); if (!storageError) notice('답변을 완료했습니다. 참고 답변을 펼쳐보고 스스로 평가해 보세요.'); };
  document.querySelectorAll('[data-rating]').forEach(b => b.onclick = () => { if (!current || !record().completed || followIndex >= 0) return; record().rating = b.dataset.rating; persist(); render(); if (!storageError) notice(`자기 평가: ${ratingLabels[b.dataset.rating]} · 저장했습니다.`); });
  $('followup-button').onclick = () => { if (!current || !activeRecord().completed) return; saveActive(); stopTimer(); stopVoice(); followIndex++; if (followIndex >= current.followUps.length) followIndex = -1; notice(storageError); displayActive(); };
  $('read-question').onclick = () => { if (!current || !('speechSynthesis' in window)) return; stopVoice(); const utterance = new SpeechSynthesisUtterance($('question-text').textContent); utterance.lang = 'ko-KR'; utterance.rate = .95; utterance.onerror = e => { if (e.error !== 'canceled' && e.error !== 'interrupted') $('speech-status').textContent = '질문을 읽지 못했습니다. 기기의 한국어 음성 설정을 확인해 주세요.'; }; window.speechSynthesis.speak(utterance); };
  $('mic-button').onclick = () => {
    if (!Recognition || !current) return;
    if (listening) { recognition.stop(); return; }
    stopVoice(); const version = speechVersion; const base = $('answer-input').value; recognition = new Recognition(); const instance = recognition;
    instance.lang = 'ko-KR'; instance.continuous = true; instance.interimResults = false;
    instance.onresult = event => { if (version !== speechVersion) return; let transcript = ''; for (let i = 0; i < event.results.length; i++) if (event.results[i].isFinal) transcript += event.results[i][0].transcript + ' '; $('answer-input').value = [base, transcript.trim()].filter(Boolean).join('\n'); $('answer-input').oninput(); };
    instance.onerror = event => { const messages = { 'not-allowed': '마이크 권한이 거부되었습니다. 브라우저 권한 설정을 확인하거나 텍스트로 답변해 주세요.', 'service-not-allowed': '이 브라우저에서 음성인식을 사용할 수 없습니다. 텍스트로 답변해 주세요.', 'audio-capture': '마이크를 찾지 못했습니다. 연결을 확인하거나 텍스트로 답변해 주세요.', 'no-speech': '음성이 감지되지 않았습니다. 다시 시도하거나 텍스트로 답변해 주세요.', network: '음성인식 연결에 실패했습니다. 텍스트로 답변해 주세요.' }; $('speech-status').textContent = messages[event.error] || '음성인식이 중단되었습니다. 텍스트 입력으로 계속할 수 있습니다.'; };
    instance.onend = () => { listening = false; recognition = null; $('mic-button').textContent = '● 음성으로 답변'; $('mic-button').setAttribute('aria-pressed', 'false'); };
    try { listening = true; $('mic-button').textContent = '■ 음성 입력 중지'; $('mic-button').setAttribute('aria-pressed', 'true'); $('speech-status').textContent = '듣고 있습니다. 인식이 확정된 문장이 답변에 추가됩니다.'; instance.start(); } catch { stopVoice(); $('speech-status').textContent = '음성인식을 시작하지 못했습니다. 텍스트로 답변해 주세요.'; }
  };
  window.addEventListener('pagehide', () => { if (current) saveActive(); stopTimer(); stopVoice(); });
  load(); render();
  $('speech-status').textContent = Recognition ? '음성인식은 브라우저 제공 기능입니다. 브라우저의 외부 음성 처리 서비스로 전송될 수 있으며, HTTPS와 마이크 권한이 필요할 수 있습니다.' : '이 브라우저는 한국어 음성인식을 지원하지 않습니다. 텍스트로 답변해 주세요.';
  if (!questions.length) { $('question-text').textContent = '등록된 질문이 없습니다.'; $('question-hint').textContent = 'questions.js에 올바른 질문 데이터를 추가해 주세요.'; }
  notice(storageError || (questions.length < raw.length ? '형식이 올바르지 않거나 ID가 중복된 질문은 제외했습니다.' : ''));
})();
