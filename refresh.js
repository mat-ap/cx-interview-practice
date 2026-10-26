/* 최신 정적 파일을 다시 요청하되, 작성 중인 답변과 로컬 자료는 유지합니다. */
(() => {
  const button = document.getElementById('refresh-site');
  document.addEventListener('input', event => {
    const form = event.target.closest('#manager-content form, #reference-form');
    if (form) form.dataset.refreshDirty = 'true';
  });
  button.onclick = () => {
    const unsaved = [...document.querySelectorAll('form[data-refresh-dirty="true"]')].some(form => form.getClientRects().length > 0);
    if (unsaved && !confirm('저장하지 않은 질문·답변 편집 내용은 사라질 수 있습니다. 저장한 자료는 유지됩니다. 새로고침할까요?')) return;
    if (!window.CXPractice.pause()) {
      document.getElementById('management-status').textContent = '답변을 저장하지 못해 새로고침을 중지했습니다. 답변을 복사한 뒤 다시 시도해 주세요.';
      return;
    }
    button.disabled = true;
    button.setAttribute('aria-label', '최신 내용 불러오는 중');
    const url = new URL(location.href);
    url.searchParams.set('_refresh', String(Date.now()));
    url.hash = '';
    location.replace(url.href);
  };
})();
