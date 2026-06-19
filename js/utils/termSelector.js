// 合約期選擇器共用 widget
// 用在: 新增入住 wizard (properties.js) / 編輯合約 (contracts.js)
//
// 規約:
//   termMonths select options 自動含 1/3 個月 + __custom (自訂月數)
//   __custom → 顯示 termMonthsCustom number input；其他值 → 隱藏
//   起租日變更 → 自動重新算 dropdown label 上的到期日 (例「3 個月 · 9/15 到期」)
//
// 用法:
//   form fields:
//     { name: 'termMonths', type: 'select', options: buildTermOptions(startISO), value: initial }
//     { name: 'termMonthsCustom', type: 'number' }   // 自訂月數
//   onFormMount:
//     initTermSelector({ form, leaseEndISO, startName: 'scheduledDate', isVisible: () => currentStep === 2 })

// 依起租日算合約期 dropdown 標籤，例如「1 個月 · 7/15 到期」
// startDate 為 ISO (YYYY-MM-DD)；leaseEndISO 由外部注入 (避免 utils 反向依賴 data.js)
export function buildTermOptions(startDate, leaseEndISO) {
    const fmt = (iso) => iso ? iso.slice(5).replace('-', '/') : '?';
    return [
        { value: '1', label: `1 個月${startDate ? ` · ${fmt(leaseEndISO(startDate, 1))} 到期` : ''}` },
        { value: '3', label: `3 個月${startDate ? ` · ${fmt(leaseEndISO(startDate, 3))} 到期` : ''}` },
        { value: '__custom', label: '自訂月數...' }
    ];
}

// opts:
//   form: form element
//   leaseEndISO: (startISO, months) => endISO  (從 data.js 注入)
//   startName: 起租日 input name (預設 'startDate')
//   termName:  合約期 select name (預設 'termMonths')
//   customName: 自訂月數 input name (預設 'termMonthsCustom')
//   isVisible: () => bool  — 自訂月數欄位是否該顯示 (給 wizard step 用，預設一律可見)
//   onTermChange: () => void  — 月數有效變動時 (含 __custom 切換 / 自訂數字輸入) 觸發
//
// 回傳: { getEffectiveTerm, syncCustomVisibility, refreshLabels }
export function initTermSelector(opts) {
    const {
        form,
        leaseEndISO,
        startName = 'startDate',
        termName = 'termMonths',
        customName = 'termMonthsCustom',
        isVisible = () => true,
        onTermChange
    } = opts;
    if (!form || typeof leaseEndISO !== 'function') return null;

    const startInput = form.querySelector(`[name="${startName}"]`);
    const termHidden = form.querySelector(`[name="${termName}"]`);
    const termWrap = form.querySelector(`.custom-select[data-name="${termName}"]`);
    const customInput = form.querySelector(`[name="${customName}"]`);
    const customWrap = customInput?.closest('.form-group');

    // 自訂月數欄位顯隱 — termMonths === '__custom' 且 isVisible() 為 true 才顯示
    const syncCustomVisibility = () => {
        if (!customWrap) return;
        const isCustom = termHidden?.value === '__custom';
        customWrap.style.display = (isCustom && isVisible()) ? '' : 'none';
    };

    // 起租日變更 → 重新算 dropdown label 上的到期日
    const refreshLabels = () => {
        if (termWrap?.__setOptions) {
            termWrap.__setOptions(buildTermOptions(startInput?.value || '', leaseEndISO));
        }
    };

    // 取得當前生效月數 (含 __custom)
    const getEffectiveTerm = () => {
        if (termHidden?.value === '__custom') {
            return parseInt(customInput?.value, 10) || 1;
        }
        return parseInt(termHidden?.value, 10) || 1;
    };

    // 初始 sync
    syncCustomVisibility();

    // 事件繫結
    termHidden?.addEventListener('change', () => {
        syncCustomVisibility();
        if (typeof onTermChange === 'function') onTermChange();
    });
    customInput?.addEventListener('input', () => {
        if (typeof onTermChange === 'function') onTermChange();
    });
    customInput?.addEventListener('change', () => {
        if (typeof onTermChange === 'function') onTermChange();
    });
    startInput?.addEventListener('change', refreshLabels);
    startInput?.addEventListener('input', refreshLabels);

    return { getEffectiveTerm, syncCustomVisibility, refreshLabels };
}
