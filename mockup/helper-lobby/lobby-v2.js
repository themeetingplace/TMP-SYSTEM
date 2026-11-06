(() => {
  const viewport = document.querySelector('[data-game-viewport]');
  const player = document.querySelector('[data-player]');
  const dollCanvas = document.querySelector('[data-player-doll]');
  const marker = document.querySelector('[data-move-marker]');
  const toast = document.querySelector('[data-game-toast]');
  const wardrobe = document.querySelector('[data-wardrobe]');
  const previewCanvas = document.querySelector('[data-preview-doll]');
  const storageKey = 'tmp-pixel-lobby-look-v2';
  const tourStorageKey = 'tmp-pixel-lobby-tours-v1';
  const tourModal = document.querySelector('[data-tour-modal]');
  const tourList = document.querySelector('[data-tour-list]');
  const outfitIds = ['knight', 'mage', 'rogue', 'royal', 'novice'];
  const hairIds = ['hair-1', 'hair-2', 'hair-3', 'hair-4'];
  const defaults = { gender: 'female', hair: 'hair-3', outfit: 'novice', palette: 'palette-coral', accessory: 'none', status: '值班中' };
  const directions = { down: 'is-front', right: 'is-right', up: 'is-back', left: 'is-left' };
  const bounds = { minX: 16, maxX: 86, minY: 38, maxY: 88 };
  const state = { x: 48, y: 69, targetX: null, targetY: null, lastTime: 0, frame: 0, frameClock: 0, moving: false, pressed: new Set(), direction: 'down' };
  let currentLook = loadLook();
  let draftLook = { ...currentLook };
  let toastTimer;
  let bubbleTimer;
  let tours = loadTours();

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function normalizeLook(look) {
    const normalized = { ...defaults, ...look };
    if (!outfitIds.includes(normalized.outfit)) normalized.outfit = defaults.outfit;
    if (!hairIds.includes(normalized.hair)) normalized.hair = defaults.hair;
    return normalized;
  }
  function loadLook() { try { return normalizeLook(JSON.parse(localStorage.getItem(storageKey) || '{}')); } catch { return { ...defaults }; } }
  function dateOffset(days) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0,10); }
  function loadTours() {
    try {
      const saved = JSON.parse(localStorage.getItem(tourStorageKey) || 'null');
      if (Array.isArray(saved)) return saved;
    } catch {}
    return [
      { id:'demo-1', date:dateOffset(1), time:'14:30', building:'信義館', room:'R2-B', visitor:'林小姐', contact:'LINE 已聯繫', helper:'我', status:'已確認', note:'想看採光與公共空間' },
      { id:'demo-2', date:dateOffset(3), time:'11:00', building:'古亭二館', room:'R4-A', visitor:'陳先生', contact:'電話聯繫', helper:'安安', status:'待確認', note:'入住時間預計下個月' }
    ];
  }
  function saveTours() { localStorage.setItem(tourStorageKey, JSON.stringify(tours)); }
  function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
  function showToast(message) { toast.textContent = message; toast.classList.add('is-visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2300); }
  function speak(message) { const bubble = document.querySelector('[data-player-bubble]'); bubble.textContent = message; bubble.classList.add('is-visible'); clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => bubble.classList.remove('is-visible'), 1800); }
  const outfitColors = { 'palette-coral':'#ef7c45', 'palette-mint':'#3e9c91', 'palette-blue':'#4d77a8', 'palette-gold':'#d69b3d' };
  const directionIndex = { down:0, right:1, up:2, left:3 };
  const assetRoot = './assets/paper-doll/';
  const assetFiles = {
    male:'base-male-v1.png', female:'base-female-v1.png',
    hairMale:'hair-male-v1.png', hairFemale:'hair-female-v1.png', outfits:'outfits-rpg-v1.png'
  };
  const spriteAssets = {};
  const cropCache = new Map();
  let spriteAssetsReady = false;

  function loadSpriteAsset(key, file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => { spriteAssets[key] = image; resolve(); };
      image.onerror = reject;
      image.src = `${assetRoot}${file}`;
    });
  }
  function cleanCrop(image, columns, rows, column, row, keyMode) {
    const key = `${image.src}|${columns}|${rows}|${column}|${row}|${keyMode}`;
    if (cropCache.has(key)) return cropCache.get(key);
    const crop = document.createElement('canvas'); crop.width = 128; crop.height = 128;
    const cropCtx = crop.getContext('2d', { willReadFrequently:true }); cropCtx.imageSmoothingEnabled = false;
    const sw = image.naturalWidth / columns; const sh = image.naturalHeight / rows;
    cropCtx.drawImage(image, column * sw, row * sh, sw, sh, 0, 0, 128, 128);
    const pixels = cropCtx.getImageData(0, 0, 128, 128); const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      const removeWhite = keyMode === 'white' && r > 234 && g > 234 && b > 234;
      const removeGreen = keyMode === 'green' && g > 95 && g > r * 1.08 && g > b * 1.08;
      if (removeWhite || removeGreen) data[i+3] = 0;
    }
    cropCtx.putImageData(pixels, 0, 0);
    let minX = 128, minY = 128, maxX = -1, maxY = -1;
    for (let y = 0; y < 128; y += 1) for (let x = 0; x < 128; x += 1) {
      if (data[(y * 128 + x) * 4 + 3] > 20) { minX = Math.min(minX,x); minY = Math.min(minY,y); maxX = Math.max(maxX,x); maxY = Math.max(maxY,y); }
    }
    if (maxX < minX || maxY < minY) { cropCache.set(key,crop); return crop; }
    const trimmed = document.createElement('canvas'); trimmed.width = maxX - minX + 1; trimmed.height = maxY - minY + 1;
    trimmed.getContext('2d').drawImage(crop,minX,minY,trimmed.width,trimmed.height,0,0,trimmed.width,trimmed.height);
    cropCache.set(key, trimmed); return trimmed;
  }
  function drawLayer(ctx, image, columns, rows, column, row, keyMode, x = 0, y = 0, width = 128, height = 128, tint = null) {
    const crop = cleanCrop(image, columns, rows, column, row, keyMode);
    if (!tint) { ctx.drawImage(crop, x, y, width, height); return; }
    const tinted = document.createElement('canvas'); tinted.width = crop.width; tinted.height = crop.height;
    const tintedCtx = tinted.getContext('2d'); tintedCtx.imageSmoothingEnabled = false; tintedCtx.drawImage(crop, 0, 0);
    tintedCtx.globalCompositeOperation = 'source-atop'; tintedCtx.globalAlpha = .22; tintedCtx.fillStyle = tint; tintedCtx.fillRect(0,0,crop.width,crop.height);
    ctx.drawImage(tinted, x, y, width, height);
  }
  function block(ctx, x, y, width, height, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height)); }
  function drawPaperDoll(canvas, look, direction = 'down', frame = 0) {
    const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); ctx.imageSmoothingEnabled = false;
    if (!spriteAssetsReady) return;
    const dir = directionIndex[direction] ?? 0;
    const body = look.gender === 'male' ? spriteAssets.male : spriteAssets.female;
    const hair = look.gender === 'male' ? spriteAssets.hairMale : spriteAssets.hairFemale;
    const hairRow = Math.max(0, hairIds.indexOf(look.hair));
    const outfitRow = Math.max(0, outfitIds.indexOf(look.outfit));
    const hairBoxes = look.gender === 'male'
      ? [[29,-18,70,66],[24,-20,80,70],[27,-18,74,74],[28,-18,72,66]]
      : [[20,-19,88,90],[25,-18,78,102],[28,-18,72,70],[22,-21,84,84]];
    const outfitBoxes = [[23,25,82,100],[19,20,90,105],[25,27,78,96],[22,24,84,100],[26,27,76,96]];
    drawLayer(ctx, body, 4, 4, frame % 4, dir, 'white', 31, 2, 66, 122);
    drawLayer(ctx, spriteAssets.outfits, 4, 5, dir, outfitRow, 'white', ...outfitBoxes[outfitRow], outfitColors[look.palette]);
    drawLayer(ctx, hair, 4, 4, dir, hairRow, 'green', ...hairBoxes[hairRow]);
    if (look.accessory === 'glasses' && direction !== 'up') {
      if (direction === 'down') { block(ctx,48,37,13,8,'#31251f'); block(ctx,67,37,13,8,'#31251f'); block(ctx,61,39,6,3,'#31251f'); block(ctx,51,39,7,3,'#f6d9bd'); block(ctx,70,39,7,3,'#f6d9bd'); }
      else { const x = direction === 'right' ? 72 : 43; block(ctx,x,37,15,8,'#31251f'); block(ctx,x+3,39,8,3,'#f6d9bd'); }
    }
    if (look.accessory === 'cap') { block(ctx,43,14,43,12,'#31251f'); block(ctx,47,16,35,8,outfitColors[look.palette]); block(ctx,direction === 'left' ? 34 : 76,23,18,5,'#31251f'); }
  }
  function renderOptionThumbnails() {
    if (!spriteAssetsReady) return;
    const hairAsset = draftLook.gender === 'male' ? spriteAssets.hairMale : spriteAssets.hairFemale;
    document.querySelectorAll('[data-hair-thumb]').forEach(canvas => {
      const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,64,64); ctx.imageSmoothingEnabled = false;
      drawLayer(ctx, hairAsset, 4, 4, 0, Number(canvas.dataset.hairThumb), 'green', 5, 2, 54, 58);
    });
    document.querySelectorAll('[data-outfit-thumb]').forEach(canvas => {
      const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,64,64); ctx.imageSmoothingEnabled = false;
      drawLayer(ctx, spriteAssets.outfits, 4, 5, 0, Number(canvas.dataset.outfitThumb), 'white', 4, 2, 56, 60, outfitColors[draftLook.palette]);
    });
  }
  Promise.all(Object.entries(assetFiles).map(([key,file]) => loadSpriteAsset(key,file))).then(() => {
    spriteAssetsReady = true; applyLook(currentLook); renderOptionThumbnails(); if (!wardrobe.hidden) updatePreview();
  }).catch(() => showToast('角色素材載入失敗，請重新整理頁面'));
  function setDirection(direction) { if (state.direction === direction) return; state.direction = direction; drawPaperDoll(dollCanvas, currentLook, direction, state.frame); }
  function setFrame(frame) { drawPaperDoll(dollCanvas, currentLook, state.direction, frame); }
  function renderPlayer() { player.style.setProperty('--x', state.x.toFixed(2)); player.style.setProperty('--y', state.y.toFixed(2)); player.style.zIndex = String(20 + Math.round(state.y)); }
  function chooseDirection(dx, dy) { if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'; return dy > 0 ? 'down' : 'up'; }

  function step(timestamp) {
    const dt = Math.min((timestamp - (state.lastTime || timestamp)) / 1000, .04);
    state.lastTime = timestamp;
    let dx = 0, dy = 0;
    if (state.pressed.has('ArrowLeft')) dx -= 1;
    if (state.pressed.has('ArrowRight')) dx += 1;
    if (state.pressed.has('ArrowUp')) dy -= 1;
    if (state.pressed.has('ArrowDown')) dy += 1;
    if (dx || dy) {
      state.targetX = null; state.targetY = null; marker.classList.remove('is-visible');
      const length = Math.hypot(dx, dy) || 1; const speed = 18;
      state.x = clamp(state.x + dx / length * speed * dt, bounds.minX, bounds.maxX);
      state.y = clamp(state.y + dy / length * speed * dt, bounds.minY, bounds.maxY);
      setDirection(chooseDirection(dx, dy)); state.moving = true;
    } else if (state.targetX !== null) {
      dx = state.targetX - state.x; dy = state.targetY - state.y; const distance = Math.hypot(dx, dy);
      if (distance < .55) { state.x = state.targetX; state.y = state.targetY; state.targetX = state.targetY = null; state.moving = false; marker.classList.remove('is-visible'); }
      else { const speed = 20; state.x += dx / distance * Math.min(distance, speed * dt); state.y += dy / distance * Math.min(distance, speed * dt); setDirection(chooseDirection(dx, dy)); state.moving = true; }
    } else state.moving = false;
    if (state.moving) { state.frameClock += dt; if (state.frameClock > .13) { state.frame = (state.frame + 1) % 4; state.frameClock = 0; setFrame(state.frame); } }
    else if (state.frame !== 0) { state.frame = 0; setFrame(0); }
    renderPlayer(); requestAnimationFrame(step);
  }

  function moveTo(x, y) {
    state.targetX = clamp(x, bounds.minX, bounds.maxX); state.targetY = clamp(y, bounds.minY, bounds.maxY);
    marker.style.left = `${state.targetX}%`; marker.style.top = `${state.targetY}%`; marker.classList.add('is-visible'); viewport.focus({ preventScroll: true });
  }
  viewport.addEventListener('pointerdown', event => { if (event.target.closest('button')) return; const rect = viewport.getBoundingClientRect(); moveTo((event.clientX - rect.left) / rect.width * 100, (event.clientY - rect.top) / rect.height * 100); });
  window.addEventListener('keydown', event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); state.pressed.add(event.key); viewport.focus({ preventScroll: true }); } });
  window.addEventListener('keyup', event => state.pressed.delete(event.key));
  window.addEventListener('blur', () => state.pressed.clear());
  document.querySelectorAll('[data-move]').forEach(button => {
    const key = `Arrow${button.dataset.move[0].toUpperCase()}${button.dataset.move.slice(1)}`;
    const down = event => { event.preventDefault(); state.pressed.add(key); };
    const up = event => { event.preventDefault(); state.pressed.delete(key); };
    button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up); button.addEventListener('pointercancel', up); button.addEventListener('pointerleave', up);
  });
  document.querySelectorAll('[data-name]').forEach(person => person.addEventListener('click', event => { event.stopPropagation(); showToast(`${person.dataset.name}｜${person.dataset.status}`); }));
  document.querySelectorAll('[data-hotspot]').forEach(item => item.addEventListener('click', event => { event.stopPropagation(); showToast(item.dataset.hotspot); }));

  function selectPanel(name) {
    document.querySelectorAll('[data-panel-tab]').forEach(tab => { const active = tab.dataset.panelTab === name; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', String(active)); });
    document.querySelectorAll('[data-panel]').forEach(panel => { const active = panel.dataset.panel === name; panel.hidden = !active; panel.classList.toggle('is-active', active); });
    document.querySelector('[data-hud-panel]').classList.remove('is-collapsed');
    document.querySelector('[data-hud-panel]').classList.add('is-open');
  }
  document.querySelectorAll('[data-panel-tab]').forEach(tab => tab.addEventListener('click', () => selectPanel(tab.dataset.panelTab)));
  document.querySelectorAll('[data-open-panel]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); selectPanel(button.dataset.openPanel); }));
  document.querySelector('[data-close-panel]').addEventListener('click', () => {
    const panel = document.querySelector('[data-hud-panel]');
    panel.classList.remove('is-open');
    panel.classList.add('is-collapsed');
  });
  document.querySelectorAll('[data-find-person]').forEach(button => button.addEventListener('click', () => { const [x,y] = button.dataset.findPerson.split(',').map(Number); moveTo(x,y); showToast('正在走向該角色的位置'); }));

  function renderTours() {
    const sorted = [...tours].sort((a,b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    document.querySelectorAll('[data-tour-count]').forEach(node => { node.textContent = String(sorted.filter(item => item.status !== '已完成').length); });
    if (!sorted.length) { tourList.innerHTML = '<div class="tour-empty">目前沒有帶看安排。<br>新增後會出現在大家共用的行程板。</div>'; return; }
    tourList.innerHTML = sorted.map(item => {
      const date = new Date(`${item.date}T00:00:00`); const month = `${date.getMonth()+1}月`; const day = String(date.getDate()).padStart(2,'0');
      const confirmed = item.status === '已確認';
      return `<article class="tour-day" data-tour-id="${escapeHtml(item.id)}"><div class="tour-date-tile"><strong>${day}</strong><small>${month}</small></div><div class="tour-copy"><header><h3>${escapeHtml(item.time)} · ${escapeHtml(item.building)} ${escapeHtml(item.room)}</h3><span class="tour-state ${confirmed ? 'is-confirmed' : ''}">${escapeHtml(item.status)}</span></header><p><b>${escapeHtml(item.visitor)}</b>｜${escapeHtml(item.contact || '未填聯絡方式')}<br>${escapeHtml(item.note || '沒有其他備註')}</p><footer><span>負責：${escapeHtml(item.helper)}</span><button type="button" data-tour-next>${item.status === '待確認' ? '標示已確認' : item.status === '已確認' ? '完成帶看' : '已完成'}</button></footer></div></article>`;
    }).join('');
    tourList.querySelectorAll('[data-tour-next]').forEach(button => button.addEventListener('click', () => {
      const item = tours.find(tour => tour.id === button.closest('[data-tour-id]').dataset.tourId); if (!item || item.status === '已完成') return;
      item.status = item.status === '待確認' ? '已確認' : '已完成'; saveTours(); renderTours(); showToast(item.status === '已確認' ? '帶看已標示為確認' : '帶看已完成');
    }));
  }
  function openTourForm() {
    const form = document.querySelector('[data-tour-form]'); form.reset(); form.elements.date.value = dateOffset(1); form.elements.time.value = '14:00'; tourModal.hidden = false; document.documentElement.style.overflow = 'hidden'; form.elements.date.focus();
  }
  function closeTourForm() { tourModal.hidden = true; document.documentElement.style.overflow = ''; document.querySelector('[data-open-tour-form]')?.focus(); }
  document.querySelectorAll('[data-open-tour-form]').forEach(button => button.addEventListener('click', openTourForm));
  document.querySelectorAll('[data-close-tour-form]').forEach(button => button.addEventListener('click', closeTourForm));
  tourModal.addEventListener('click', event => { if (event.target === tourModal) closeTourForm(); });
  document.querySelector('[data-tour-form]').addEventListener('submit', event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    tours.push({ id:`tour-${Date.now()}`, date:data.get('date'), time:data.get('time'), building:data.get('building'), room:data.get('room').trim(), visitor:data.get('visitor').trim(), contact:data.get('contact').trim(), helper:data.get('helper'), status:data.get('status'), note:data.get('note').trim() });
    saveTours(); renderTours(); closeTourForm(); selectPanel('tours'); speak('新的帶看安排！'); showToast('帶看安排已儲存在本機');
  });
  document.querySelectorAll('[data-quick]').forEach(button => button.addEventListener('click', () => { const input = document.querySelector('#game-message'); input.value = button.dataset.quick; input.focus(); }));
  document.querySelector('[data-message-form]').addEventListener('submit', event => {
    event.preventDefault(); const input = event.currentTarget.querySelector('textarea'); const text = input.value.trim(); if (!text) return;
    const article = document.createElement('article'); article.className = 'chat-line mine'; article.innerHTML = '<div><header><strong>你</strong><time>剛剛</time></header><p></p></div><span class="portrait coral">我</span>'; article.querySelector('p').textContent = text; document.querySelector('[data-message-list]').append(article); input.value = ''; article.scrollIntoView({ behavior:'smooth', block:'nearest' }); speak(text.length > 11 ? `${text.slice(0,11)}…` : text); showToast('已加入本機測試留言');
  });
  document.querySelectorAll('.chat-line footer button').forEach(button => button.addEventListener('click', () => { button.classList.toggle('is-reacted'); showToast(button.classList.contains('is-reacted') ? '已加入回應' : '已取消回應'); }));
  document.querySelectorAll('.quest button,.new-quest').forEach(button => button.addEventListener('click', () => showToast('正式版會在這裡更新交班狀態')));

  function applyLook(look) {
    drawPaperDoll(dollCanvas, look, state.direction, state.frame);
    player.querySelector('.nameplate small').textContent = look.status;
  }
  function updatePreview() {
    drawPaperDoll(previewCanvas, draftLook, 'down', 0);
    const gender = draftLook.gender === 'male' ? '男生' : '女生';
    const outfit = ({ knight:'騎士鎧甲', mage:'法師斗篷', rogue:'盜賊皮裝', royal:'皇家禮服', novice:'新手布衣' })[draftLook.outfit];
    const hairLabels = draftLook.gender === 'male'
      ? ['蓬鬆短髮','刺蝟短髮','狼尾剪','後梳']
      : ['雙馬尾','長直髮','短鮑伯','高馬尾'];
    document.querySelectorAll('[data-hair-label]').forEach((node,index) => { node.textContent = hairLabels[index]; });
    renderOptionThumbnails();
    document.querySelector('[data-preview-label]').textContent = `${gender} · ${outfit}`;
    document.querySelectorAll('[data-look]').forEach(button => button.classList.toggle('is-selected', draftLook[button.dataset.look] === button.dataset.value));
  }
  function openWardrobe() { draftLook = { ...currentLook }; updatePreview(); wardrobe.hidden = false; document.documentElement.style.overflow = 'hidden'; wardrobe.querySelector('[data-close-wardrobe]').focus(); }
  function closeWardrobe() { wardrobe.hidden = true; document.documentElement.style.overflow = ''; document.querySelector('[data-open-wardrobe]').focus(); }
  document.querySelector('[data-open-wardrobe]').addEventListener('click', openWardrobe);
  document.querySelector('[data-close-wardrobe]').addEventListener('click', closeWardrobe);
  wardrobe.addEventListener('click', event => { if (event.target === wardrobe) closeWardrobe(); });
  document.querySelectorAll('[data-look]').forEach(button => button.addEventListener('click', () => { draftLook[button.dataset.look] = button.dataset.value; updatePreview(); }));
  document.querySelector('[data-reset-look]').addEventListener('click', () => { draftLook = { ...defaults }; updatePreview(); });
  document.querySelector('[data-save-look]').addEventListener('click', () => { currentLook = { ...draftLook }; localStorage.setItem(storageKey, JSON.stringify(currentLook)); applyLook(currentLook); closeWardrobe(); speak('換裝完成！'); showToast('角色外觀已儲存在這台裝置'); });
  document.addEventListener('keydown', event => { if (event.key !== 'Escape') return; if (!wardrobe.hidden) closeWardrobe(); else if (!tourModal.hidden) closeTourForm(); });
  applyLook(currentLook); renderTours(); renderPlayer(); setFrame(0); requestAnimationFrame(step); setTimeout(() => speak('早安！'), 450);
})();
