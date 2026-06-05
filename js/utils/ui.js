// 共用 UI 元件：modal、form、toast、confirm
//
// 使用範例：
//   openFormModal({
//     title: '新增物件',
//     fields: [
//       { name: 'name', label: '物件名稱', type: 'text', required: true },
//       { name: 'rent', label: '租金', type: 'number', required: true },
//       { name: 'status', label: '狀態', type: 'select', options: ['已出租','待租','待簽約'], value: '待租' }
//     ],
//     submitLabel: '建立',
//     onSubmit: (values) => { ... }
//   });

// modal 堆疊：支援 modal 內再開 modal
const modalStack = [];

export function openModal({ title, bodyHtml, footerHtml = '', maxWidth = 600, onMount, onClose }) {
    // 開新 modal 前，先清掉孤兒下拉面板（穩定 portal 狀態）
    sweepOrphanSelectPanels();

    const depth = modalStack.length;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = String(1000 + depth * 20);
    overlay.innerHTML = `
        <div class="modal-content" style="max-width: ${maxWidth}px;">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" type="button">&times;</button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
        </div>
    `;
    document.body.appendChild(overlay);
    modalStack.push(overlay);

    function close() {
        const idx = modalStack.indexOf(overlay);
        if (idx >= 0) modalStack.splice(idx, 1);
        // QW-AP7: modal 退場動畫 (對稱於進場 modalOverlayIn / modalContentIn)
        overlay.classList.add('is-closing');
        document.removeEventListener('keydown', escClose);
        setTimeout(() => {
            overlay.remove();
            sweepOrphanSelectPanels();
            if (onClose) onClose();
        }, 180);
    }

    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    function escClose(e) {
        if (e.key !== 'Escape') return;
        // 只有最上層 modal 響應 Esc
        if (modalStack[modalStack.length - 1] !== overlay) return;
        close();
    }
    document.addEventListener('keydown', escClose);

    if (onMount) onMount(overlay, close);

    // T3R-#7: 手機軟鍵盤彈起時動態縮 modal 高度，讓 footer / submit 按鈕仍在視野內
    attachKeyboardAdjustment(overlay);

    return { overlay, close };
}

// === Modal 在手機軟鍵盤彈起時自動調整 ===
// iOS Safari + Android Chrome 都支援 visualViewport API
function attachKeyboardAdjustment(overlay) {
    if (!window.visualViewport) return;
    const content = overlay.querySelector('.modal-content');
    if (!content) return;

    const onResize = () => {
        if (!document.body.contains(overlay)) {
            window.visualViewport.removeEventListener('resize', onResize);
            window.visualViewport.removeEventListener('scroll', onResize);
            return;
        }
        // 只在小螢幕 (bottom sheet 模式) 處理；桌面 modal 居中不需要
        if (window.innerWidth > 600) {
            content.style.maxHeight = '';
            return;
        }
        const vv = window.visualViewport;
        // visualViewport.height = 可見區高度 (鍵盤彈起時會變小)
        // 我們把 modal max-height 設成 visualViewport.height，並把 modal 推上去靠 viewport top
        content.style.maxHeight = `${vv.height}px`;
        content.style.transform = `translateY(${vv.offsetTop}px)`;
    };

    window.visualViewport.addEventListener('resize', onResize);
    window.visualViewport.addEventListener('scroll', onResize);
    // 初始化一次
    requestAnimationFrame(onResize);
}

function sweepOrphanSelectPanels() {
    document.querySelectorAll('body > .custom-select-panel').forEach(p => {
        const id = p.dataset.csPanelId;
        const matching = id ? document.querySelector(`.custom-select[data-cs-panel-id="${id}"]`) : null;
        if (!matching) p.remove();
    });
}

export function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
}

// 表單 modal：自動產出欄位與按鈕，回傳值給 onSubmit
export function openFormModal({ title, fields = [], values = {}, submitLabel = '儲存', cancelLabel = '取消', onSubmit, onFormMount, maxWidth = 600, headerHtml = '' }) {
    const fieldsHtml = fields.map(f => renderField(f, values[f.name] ?? f.value ?? '')).join('');
    const datalistsHtml = fields
        .filter(f => Array.isArray(f.suggestions) && f.suggestions.length)
        .map(f => `<datalist id="dl-${f.name}">${f.suggestions.map(s => `<option value="${escapeAttr(s)}"></option>`).join('')}</datalist>`)
        .join('');

    const bodyHtml = `
        ${headerHtml || ''}
        <form class="form-grid" id="form-modal-form" novalidate>
            ${fieldsHtml}
        </form>
        ${datalistsHtml}
    `;
    const footerHtml = `
        <button type="button" class="btn btn-outline" data-action="cancel">${cancelLabel}</button>
        <button type="submit" form="form-modal-form" class="btn btn-primary">${submitLabel}</button>
    `;

    return openModal({
        title,
        bodyHtml,
        footerHtml,
        maxWidth,
        onMount: (overlay, close) => {
            const form = overlay.querySelector('#form-modal-form');
            overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
            initCustomSelects(form);
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const data = {};
                let firstInvalid = null;
                let firstInvalidLabel = '';
                fields.forEach(f => {
                    const el = form.querySelector(`[name="${f.name}"]`);
                    if (!el) return;
                    let val = f.type === 'checkbox' ? el.checked : el.value.trim();
                    if (f.type === 'number' && val !== '') val = Number(val);
                    const targetForError = el.closest('.custom-select') || el;
                    if (f.required && (val === '' || val == null)) {
                        if (!firstInvalid) {
                            firstInvalid = targetForError;
                            firstInvalidLabel = f.label || f.name;
                        }
                        targetForError.classList.add('input-error');
                    } else {
                        targetForError.classList.remove('input-error');
                    }
                    data[f.name] = val === '' ? null : val;
                });
                if (firstInvalid) {
                    const focusTarget = firstInvalid.classList.contains('custom-select')
                        ? firstInvalid.querySelector('.custom-select-trigger')
                        : firstInvalid;
                    focusTarget?.focus();
                    // 帶上具體欄位名 + 捲到視野內 (P1-17)
                    if (focusTarget?.scrollIntoView) focusTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    showToast(`「${firstInvalidLabel}」必填，請補上`, 'danger', 4000);
                    return;
                }
                Promise.resolve(onSubmit(data)).then(result => {
                    if (result !== false) close();
                });
            });
            if (onFormMount) onFormMount(form);
            // 自動把所有 date input 升級成 Flatpickr (繁中、漂亮)
            initFlatpickr(form);
            const first = form.querySelector('.custom-select-trigger, input:not([type="hidden"]), textarea');
            if (first) first.focus();
        }
    });
}

// === Flatpickr 日期選擇器 ===
function initFlatpickr(scope) {
    if (typeof window.flatpickr !== 'function') return;
    const baseLocale = window.flatpickr.l10ns?.zh_tw || {};
    const tightLocale = {
        ...baseLocale,
        weekdays: {
            shorthand: ['日', '一', '二', '三', '四', '五', '六'],
            longhand: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
        },
        months: {
            shorthand: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
            longhand: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
        },
        firstDayOfWeek: 1 // 從週一開始
    };
    scope.querySelectorAll('input[type="date"]').forEach(input => {
        if (input.dataset.fpAttached === '1') return;
        input.dataset.fpAttached = '1';
        window.flatpickr(input, {
            locale: tightLocale,
            dateFormat: 'Y-m-d',
            allowInput: true,
            disableMobile: true,
            position: 'auto',
            monthSelectorType: 'static' // 用 < 月 > 樣式，不用 dropdown
        });
    });
}

// === 客製化下拉選單 ===
function initCustomSelects(scope) {
    scope.querySelectorAll('.custom-select').forEach(sel => {
        const trigger = sel.querySelector('.custom-select-trigger');
        const valueEl = sel.querySelector('.custom-select-value');
        const hidden = sel.querySelector('input[type="hidden"]');
        const panel = sel.querySelector('.custom-select-panel');
        const optionsWrap = panel.querySelector('.custom-select-options-wrap') || panel;
        const searchInput = panel.querySelector('.custom-select-search-input');
        const emptyEl = panel.querySelector('.custom-select-empty');
        const placeholderText = valueEl.classList.contains('placeholder') ? valueEl.textContent : (optionsWrap.querySelector('[data-value=""] span')?.textContent || '請選擇...');

        let isOpen = false;

        function position() {
            const rect = trigger.getBoundingClientRect();
            panel.style.minWidth = `${rect.width}px`;
            panel.style.left = `${rect.left}px`;
            panel.style.top = `${rect.bottom + 4}px`;
            // 翻到上方若空間不足
            const ph = panel.offsetHeight;
            if (rect.bottom + ph + 8 > window.innerHeight) {
                panel.style.top = `${rect.top - ph - 4}px`;
            }
        }

        function open() {
            if (isOpen) return;
            isOpen = true;
            sel.classList.add('is-open');
            // 標一個 ID 讓 modal 關閉時能識別孤兒
            const panelId = `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            sel.dataset.csPanelId = panelId;
            panel.dataset.csPanelId = panelId;
            // portal 到 body 避免 modal overflow 裁切
            document.body.appendChild(panel);
            panel.hidden = false;
            position();
            document.addEventListener('click', onOutsideClick, true);
            document.addEventListener('keydown', onKeyDown);
            window.addEventListener('resize', position);
            window.addEventListener('scroll', position, true);
            // 開啟時若可搜尋 → 自動 focus + 清空之前的 query
            if (searchInput) {
                searchInput.value = '';
                applyFilter('');
                requestAnimationFrame(() => searchInput.focus());
            }
        }

        function close() {
            if (!isOpen) return;
            isOpen = false;
            sel.classList.remove('is-open');
            panel.hidden = true;
            sel.appendChild(panel); // 收回原本位置
            document.removeEventListener('click', onOutsideClick, true);
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', position);
            window.removeEventListener('scroll', position, true);
        }

        function selectValue(value, label) {
            hidden.value = value;
            valueEl.textContent = value ? label : placeholderText;
            valueEl.classList.toggle('placeholder', !value);
            sel.classList.remove('input-error');
            panel.querySelectorAll('.custom-select-option').forEach(o => {
                o.classList.toggle('is-selected', o.dataset.value === value);
            });
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
            close();
            trigger.focus();
        }

        function onOutsideClick(e) {
            if (!sel.contains(e.target) && !panel.contains(e.target)) close();
        }
        function onKeyDown(e) {
            if (e.key === 'Escape') {
                close();
                trigger.focus();
            }
        }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            isOpen ? close() : open();
        });

        function bindOptionClicks() {
            optionsWrap.querySelectorAll('.custom-select-option').forEach(opt => {
                if (opt.__bound) return;
                opt.__bound = true;
                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const v = opt.dataset.value;
                    const lbl = opt.querySelector('span').textContent;
                    selectValue(v, lbl);
                });
            });
        }
        bindOptionClicks();

        // 搜尋過濾
        function applyFilter(q) {
            const query = (q || '').trim().toLowerCase();
            let visibleCount = 0;
            optionsWrap.querySelectorAll('.custom-select-option').forEach(opt => {
                if (opt.dataset.value === '') {
                    // placeholder 選項在搜尋時隱藏
                    opt.style.display = query ? 'none' : '';
                    return;
                }
                const text = opt.textContent.toLowerCase();
                const match = !query || text.includes(query);
                opt.style.display = match ? '' : 'none';
                if (match) visibleCount++;
            });
            if (emptyEl) emptyEl.hidden = visibleCount > 0;
        }

        if (searchInput) {
            searchInput.addEventListener('input', e => applyFilter(e.target.value));
            searchInput.addEventListener('keydown', e => {
                // 防止 Enter 觸發表單送出
                if (e.key === 'Enter') {
                    e.preventDefault();
                    // 若只剩一個結果，自動選它
                    const visible = Array.from(optionsWrap.querySelectorAll('.custom-select-option'))
                        .filter(o => o.style.display !== 'none' && o.dataset.value);
                    if (visible.length === 1) visible[0].click();
                }
                if (e.key === 'Escape') {
                    close();
                    trigger.focus();
                }
            });
            // 點搜尋框時不要關閉 panel
            searchInput.addEventListener('click', e => e.stopPropagation());
        }

        // 對外暴露：動態替換選項清單（用於級聯 select）
        sel.__setOptions = function(newOptions, newPlaceholder) {
            if (isOpen) close();
            const ph = newPlaceholder || placeholderText;
            optionsWrap.innerHTML = `
                <button type="button" class="custom-select-option is-selected" data-value="">
                    <span>${ph}</span>
                </button>
                ${newOptions.map(o => `
                    <button type="button" class="custom-select-option" data-value="${String(o.value).replace(/"/g, '&quot;')}">
                        <span>${o.label}</span>
                        <i class="ph ph-check"></i>
                    </button>
                `).join('')}
            `;
            hidden.value = '';
            valueEl.textContent = ph;
            valueEl.classList.add('placeholder');
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
            if (searchInput) searchInput.value = '';
            if (emptyEl) emptyEl.hidden = true;
            bindOptionClicks();
        };
    });
}

function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
}

function renderField(field, currentValue) {
    const { name, label, type = 'text', required = false, placeholder = '', options = [], rows = 3, hint = '', span = 1 } = field;
    const req = required ? '<span style="color: var(--color-danger);">*</span>' : '';
    const labelHtml = label ? `<label for="f-${name}">${label} ${req}</label>` : '';
    const hintHtml = hint ? `<small class="form-hint">${hint}</small>` : '';
    const wrapStyle = `style="grid-column: span ${span};"`;

    if (type === 'section') {
        return `<div class="form-section-divider" style="grid-column: 1 / -1; margin-top: 0.5rem; padding-top: 0.75rem; border-top: 1px dashed var(--border-color);">
            <div style="font-weight: 600; color: var(--text-main); font-size: 0.95rem;">${label}</div>
            ${hint ? `<small class="form-hint" style="display:block; margin-top:0.25rem;">${hint}</small>` : ''}
        </div>`;
    }

    // 'placeholder' 類型：渲染一個空的 div，給 onFormMount 動態注入內容 (例如可多筆的子表單)
    if (type === 'placeholder') {
        return `<div id="ph-${name}" style="grid-column: 1 / -1;"></div>`;
    }

    // 'hidden' 類型：純資料 input，不顯示 (給 placeholder 子表單算完後寫回用)
    if (type === 'hidden') {
        return `<input type="hidden" name="${name}" id="f-${name}" value="${escapeAttr(currentValue ?? field.value ?? '')}">`;
    }

    if (type === 'select') {
        const placeholderText = field.placeholder || '請選擇...';
        const searchable = !!field.searchable;
        const opts = options.map(opt => {
            const v = typeof opt === 'object' ? opt.value : opt;
            const lbl = typeof opt === 'object' ? opt.label : opt;
            return { value: String(v), label: String(lbl) };
        });
        const selected = opts.find(o => o.value === String(currentValue ?? ''));
        const displayLabel = selected ? selected.label : placeholderText;
        const placeholderCls = selected ? '' : 'placeholder';

        const optionsHtml = `
            <button type="button" class="custom-select-option ${selected ? '' : 'is-selected'}" data-value="">
                <span>${placeholderText}</span>
            </button>
            ${opts.map(o => `
                <button type="button" class="custom-select-option ${selected && selected.value === o.value ? 'is-selected' : ''}" data-value="${escapeAttr(o.value)}">
                    <span>${o.label}</span>
                    <i class="ph ph-check"></i>
                </button>
            `).join('')}
        `;

        const searchHtml = searchable
            ? `<div class="custom-select-search">
                    <i class="ph ph-magnifying-glass"></i>
                    <input type="text" class="custom-select-search-input" placeholder="輸入關鍵字搜尋..." autocomplete="off">
               </div>`
            : '';

        return `<div class="form-group" ${wrapStyle}>
            ${labelHtml}
            <div class="custom-select ${searchable ? 'is-searchable' : ''}" data-name="${name}">
                <button type="button" class="custom-select-trigger" id="f-${name}">
                    <span class="custom-select-value ${placeholderCls}">${displayLabel}</span>
                    <i class="ph ph-caret-down custom-select-icon"></i>
                </button>
                <input type="hidden" name="${name}" value="${selected ? escapeAttr(selected.value) : ''}">
                <div class="custom-select-panel" hidden>
                    ${searchHtml}
                    <div class="custom-select-options-wrap">${optionsHtml}</div>
                    <div class="custom-select-empty" hidden>查無符合項目</div>
                </div>
            </div>
            ${hintHtml}
        </div>`;
    }

    if (type === 'textarea') {
        return `<div class="form-group" ${wrapStyle}>
            ${labelHtml}
            <textarea id="f-${name}" name="${name}" class="form-input" rows="${rows}" placeholder="${placeholder}" ${required ? 'required' : ''}>${currentValue ?? ''}</textarea>
            ${hintHtml}
        </div>`;
    }

    if (type === 'checkbox') {
        const checked = currentValue ? 'checked' : '';
        return `<div class="form-group form-checkbox" ${wrapStyle}>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                <input type="checkbox" name="${name}" ${checked}>
                <span>${label}</span>
            </label>
            ${hintHtml}
        </div>`;
    }

    const listAttr = Array.isArray(field.suggestions) && field.suggestions.length ? `list="dl-${name}"` : '';
    return `<div class="form-group" ${wrapStyle}>
        ${labelHtml}
        <input id="f-${name}" type="${type}" name="${name}" class="form-input"
            value="${currentValue ?? ''}" placeholder="${placeholder}" ${listAttr} ${required ? 'required' : ''}>
        ${hintHtml}
    </div>`;
}

// 確認對話框
export function openConfirm({ title = '確認操作', message, confirmLabel = '確認', cancelLabel = '取消', danger = false, onConfirm, maxWidth = 420, hideCancel = false }) {
    const bodyHtml = `<div style="margin: 0; color: var(--text-main); line-height: 1.6;">${message}</div>`;
    const footerHtml = `
        ${hideCancel ? '' : `<button type="button" class="btn btn-outline" data-action="cancel">${cancelLabel}</button>`}
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${confirmLabel}</button>
    `;
    return openModal({
        title,
        bodyHtml,
        footerHtml,
        maxWidth,
        onMount: (overlay, close) => {
            overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
            overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
                Promise.resolve(onConfirm?.()).then(result => {
                    if (result !== false) close();
                });
            });
        }
    });
}

// 詳情檢視（唯讀）
export function openDetailModal({ title, items = [], extraHtml = '', maxWidth = 560, footerHtml = '', onMount }) {
    const grid = items.map(it => `
        <div class="detail-item">
            <label>${it.label}</label>
            <span>${it.value ?? '<span style="color: var(--text-muted)">—</span>'}</span>
        </div>
    `).join('');
    const bodyHtml = `<div class="property-detail-grid">${grid}</div>${extraHtml || ''}`;
    return openModal({ title, bodyHtml, maxWidth, footerHtml, onMount });
}

// Toast 提示
let toastContainer = null;
function ensureToastContainer() {
    if (toastContainer) return toastContainer;
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    // QW-M3: 加 ARIA — 螢幕閱讀器會自動朗讀 polite 區的新訊息
    toastContainer.setAttribute('role', 'region');
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('aria-label', '系統通知');
    document.body.appendChild(toastContainer);
    return toastContainer;
}

export function showToast(message, type = 'success', duration = 2500) {
    ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // danger 類額外標 alert (打斷現在朗讀，立刻播)
    if (type === 'danger') toast.setAttribute('role', 'alert');
    const icon = type === 'success' ? 'ph-check-circle' : type === 'danger' ? 'ph-x-circle' : type === 'warning' ? 'ph-warning' : 'ph-info';
    toast.innerHTML = `<i class="ph-fill ${icon}" aria-hidden="true"></i> <span>${message}</span>`;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        // QW-AM3: dismiss timer 200 → 260，配合 CSS transition 0.25s 完整跑完
        setTimeout(() => toast.remove(), 260);
    }, duration);
}

// UIUX #3: 危險操作護欄 — 5 秒倒數 undo toast
// 用法: showUndoToast({ message: '已刪除合約 C012', onUndo: () => restore(), onCommit: () => actualCloudDelete(), durationMs: 5000 })
// - 倒數期間點 toast 上「復原」→ 觸發 onUndo
// - 5 秒過後 toast 消失 → 觸發 onCommit (例如真的推 cloud DELETE)
export function showUndoToast({ message, onUndo, onCommit, durationMs = 5000 }) {
    ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = 'toast toast-undo';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
        <i class="ph-fill ph-arrow-counter-clockwise" aria-hidden="true"></i>
        <span class="undo-msg">${message}</span>
        <button class="undo-btn" type="button">復原</button>
        <span class="undo-countdown" aria-hidden="true">${Math.ceil(durationMs / 1000)}</span>
        <span class="undo-progress" aria-hidden="true"><span class="undo-progress-fill"></span></span>
    `;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => {
        toast.classList.add('show');
        // QW: 啟動底部進度條 (從 100% → 0%)
        const fill = toast.querySelector('.undo-progress-fill');
        if (fill) {
            fill.style.transition = `width ${durationMs}ms linear`;
            requestAnimationFrame(() => { fill.style.width = '0%'; });
        }
    });

    let secondsLeft = Math.ceil(durationMs / 1000);
    const countdownEl = toast.querySelector('.undo-countdown');
    const tick = setInterval(() => {
        secondsLeft--;
        if (countdownEl) countdownEl.textContent = String(Math.max(0, secondsLeft));
    }, 1000);

    let isUndone = false;
    const dismiss = () => {
        clearInterval(tick);
        clearTimeout(timer);
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 260);
    };

    toast.querySelector('.undo-btn').addEventListener('click', () => {
        if (isUndone) return;
        isUndone = true;
        try { onUndo && onUndo(); } catch (e) { console.error('[undo] onUndo failed:', e); }
        dismiss();
    });

    const timer = setTimeout(() => {
        if (isUndone) return;
        try { onCommit && onCommit(); } catch (e) { console.error('[undo] onCommit failed:', e); }
        dismiss();
    }, durationMs);
}

export function refreshView() {
    if (typeof window.refreshCurrentView === 'function') {
        window.refreshCurrentView();
    }
}
