(() => {
  const root = document.documentElement;
  const wardrobe = document.querySelector('[data-wardrobe]');
  const previewHuman = document.querySelector('[data-preview-avatar] .pixel-human');
  const liveHuman = document.querySelector('[data-live-avatar] .pixel-human');
  const toast = document.querySelector('[data-toast]');
  const storageKey = 'tmp-helper-lobby-look-v1';
  const defaults = { hair: 'hair-short', top: 'top-coral', skin: 'skin-1', accessory: 'accessory-none' };
  let draft = { ...defaults };
  let toastTimer;

  function safeLoad() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) || '{}') }; }
    catch { return { ...defaults }; }
  }

  function applyLook(target, look) {
    target.className = `pixel-human ${look.hair} ${look.top} ${look.skin} ${look.accessory}`;
  }

  function syncControls() {
    document.querySelectorAll('[data-style]').forEach(button => {
      button.classList.toggle('is-selected', draft[button.dataset.style] === button.dataset.value);
    });
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }

  function openWardrobe() {
    draft = safeLoad();
    applyLook(previewHuman, draft);
    syncControls();
    wardrobe.hidden = false;
    root.style.overflow = 'hidden';
    wardrobe.querySelector('[data-close-wardrobe]').focus();
  }

  function closeWardrobe() {
    wardrobe.hidden = true;
    root.style.overflow = '';
    document.querySelector('[data-open-wardrobe]').focus();
  }

  const storedLook = safeLoad();
  applyLook(liveHuman, storedLook);
  applyLook(previewHuman, storedLook);

  document.querySelector('[data-open-wardrobe]').addEventListener('click', openWardrobe);
  document.querySelector('[data-close-wardrobe]').addEventListener('click', closeWardrobe);
  wardrobe.addEventListener('click', event => { if (event.target === wardrobe) closeWardrobe(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !wardrobe.hidden) closeWardrobe(); });

  document.querySelectorAll('[data-style]').forEach(button => button.addEventListener('click', () => {
    draft[button.dataset.style] = button.dataset.value;
    applyLook(previewHuman, draft);
    syncControls();
  }));

  document.querySelector('[data-reset-look]').addEventListener('click', () => {
    draft = { ...defaults };
    applyLook(previewHuman, draft);
    syncControls();
  });

  document.querySelector('[data-save-look]').addEventListener('click', () => {
    localStorage.setItem(storageKey, JSON.stringify(draft));
    applyLook(liveHuman, draft);
    closeWardrobe();
    showToast('外觀已儲存在這台裝置');
  });

  document.querySelectorAll('[data-person]').forEach(person => person.addEventListener('click', () => {
    showToast(`${person.dataset.person}：${person.dataset.message}`);
  }));

  document.querySelector('[data-focus-wall]').addEventListener('click', () => {
    document.querySelector('[data-panel-tab="wall"]').click();
    document.querySelector('.handoff-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.querySelectorAll('[data-panel-tab]').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('[data-panel-tab]').forEach(item => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-panel]').forEach(panel => {
      const active = panel.dataset.panel === tab.dataset.panelTab;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
  }));

  document.querySelectorAll('[data-quick-reply]').forEach(button => button.addEventListener('click', () => {
    const input = document.querySelector('#lobby-message');
    input.value = button.dataset.quickReply;
    input.focus();
  }));

  document.querySelector('[data-message-form]').addEventListener('submit', event => {
    event.preventDefault();
    const input = event.currentTarget.querySelector('textarea');
    const text = input.value.trim();
    if (!text) return;
    const article = document.createElement('article');
    article.className = 'message mine';
    article.innerHTML = `<div><header><strong>你</strong><time>剛剛</time></header><p></p></div><span class="mini-avatar coral">我</span>`;
    article.querySelector('p').textContent = text;
    document.querySelector('[data-message-list]').appendChild(article);
    input.value = '';
    article.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast('已加入本機大廳留言');
  });

  document.querySelectorAll('.message footer button').forEach(button => button.addEventListener('click', () => {
    button.classList.toggle('is-reacted');
    showToast(button.classList.contains('is-reacted') ? '已加入回應' : '已取消回應');
  }));

  document.querySelector('.sound-toggle').addEventListener('click', event => {
    const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    event.currentTarget.setAttribute('aria-pressed', String(enabled));
    event.currentTarget.textContent = enabled ? '♫ 開啟' : '♫ 關閉';
    showToast(enabled ? '環境音為原型示意，尚未播放聲音' : '已關閉環境音');
  });

  document.querySelectorAll('.handoff-card button, .add-handoff').forEach(button => button.addEventListener('click', () => {
    showToast('這項操作會在正式版接上交班流程');
  }));
})();
