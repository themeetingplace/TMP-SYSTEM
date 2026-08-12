// 合約期選擇器共用 widget
// 用在: 新增入住 wizard (properties.js) / 編輯合約 (contracts.js)
//
// 規約:
//   termMonths select options 自動含 1/3 個月 + __custom (自訂月數)
//   opts.includeCustomDate=true 時再多一個 __customdate (自訂到期日)
//   __custom     → 顯示 termMonthsCustom number input
//   __customdate → 顯示 termEndDate date input，月數由起訖天數換算 (1 月 = 30 天)
//   其他值 / 沒選 custom → 兩個自訂欄位都隱藏
//   起租日變更 → 自動重新算 dropdown label 上的到期日 (例「3 個月 · 9/15 到期」)
//
// 用法:
//   form fields:
//     { name: 'termMonths', type: 'select', options: buildTermOptions(startISO, leaseEndISO, { includeCustomDate }), value: initial }
//     { name: 'termMonthsCustom', type: 'number' }   // 自訂月數
//     { name: 'termEndDate', type: 'date' }          // 自訂到期日 (includeCustomDate 時才需要)
//   onFormMount:
//     initTermSelector({ form, leaseEndISO, startName: 'scheduledDate', includeCustomDate: true, isVisible: () => currentStep === 2 })

// 依起租日算合約期 dropdown 標籤，例如「1 個月 · 7/15 到期」
// startDate 為 ISO (YYYY-MM-DD)；leaseEndISO 由外部注入 (避免 utils 反向依賴 data.js)
export function buildTermOptions(startDate, leaseEndISO, opts = {}) {
    const fmt = (iso) => iso ? iso.slice(5).replace('-', '/') : '?';
    const list = [
        { value: '1', label: `1 個月${startDate ? ` · ${fmt(leaseEndISO(startDate, 1))} 到期` : ''}` },
        { value: '3', label: `3 個月${startDate ? ` · ${fmt(leaseEndISO(startDate, 3))} 到期` : ''}` },
        { value: '__custom', label: '自訂月數...' }
    ];
    if (opts.includeCustomDate) list.push({ value: '__customdate', label: '自訂到期日...' });
    return list;
}

// 起訖日換算月數 (1 個月 = 30 天, 四捨五入, 最少 1)
function monthsBetween(startISO, endISO) {
    if (!startISO || !endISO || endISO <= startISO) return 0;
    const days = (new Date(endISO) - new Date(startISO)) / 86400000;
    return Math.max(1, Math.round(days / 30));
}

// opts:
//   form: form element
//   leaseEndISO: (startISO, months) => endISO  (從 data.js 注入)
//   startName: 起租日 input name (預設 'startDate')
//   termName:  合約期 select name (預設 'termMonths')
//   customName: 自訂月數 input name (預設 'termMonthsCustom')
//   endDateName: 自訂到期日 input name (預設 'termEndDate')
//   includeCustomDate: 是否啟用「自訂到期日」選項 (預設 false)
//   isVisible: () => bool  — 自訂欄位是否該顯示 (給 wizard step 用，預設一律可見)
//   onTermChange: () => void  — 月數有效變動時 (含 __custom / __customdate 切換 / 輸入) 觸發
//
// 回傳: { getEffectiveTerm, getEffectiveEndDate, syncCustomVisibility, refreshLabels }
export function initTermSelector(opts) {
    const {
        form,
        leaseEndISO,
        startName = 'startDate',
        termName = 'termMonths',
        customName = 'termMonthsCustom',
        endDateName = 'termEndDate',
        includeCustomDate = false,
        isVisible = () => true,
        onTermChange
    } = opts;
    if (!form || typeof leaseEndISO !== 'function') return null;

    const startInput = form.querySelector(`[name="${startName}"]`);
    const termHidden = form.querySelector(`[name="${termName}"]`);
    const termWrap = form.querySelector(`.custom-select[data-name="${termName}"]`);
    const customInput = form.querySelector(`[name="${customName}"]`);
    const customWrap = customInput?.closest('.form-group');
    const endDateInput = form.querySelector(`[name="${endDateName}"]`);
    const endDateWrap = endDateInput?.closest('.form-group');

    // 自訂欄位顯隱 — __custom 顯示月數欄、__customdate 顯示到期日欄 (且 isVisible() 為 true)
    const syncCustomVisibility = () => {
        const v = termHidden?.value;
        if (customWrap) customWrap.style.display = (v === '__custom' && isVisible()) ? '' : 'none';
        if (endDateWrap) endDateWrap.style.display = (v === '__customdate' && isVisible()) ? '' : 'none';
    };

    // 起租日變更 → 重新算 dropdown label 上的到期日
    const refreshLabels = () => {
        if (termWrap?.__setOptions) {
            termWrap.__setOptions(buildTermOptions(startInput?.value || '', leaseEndISO, { includeCustomDate }));
        }
    };

    // 取得當前生效月數 (含 __custom / __customdate)
    const getEffectiveTerm = () => {
        if (termHidden?.value === '__custom') {
            return parseInt(customInput?.value, 10) || 1;
        }
        if (termHidden?.value === '__customdate') {
            return monthsBetween(startInput?.value, endDateInput?.value) || 1;
        }
        return parseInt(termHidden?.value, 10) || 1;
    };

    // 取得當前生效到期日 ISO — __customdate 用選的日期; 其他用 leaseEndISO(起, 月數)
    const getEffectiveEndDate = () => {
        if (termHidden?.value === '__customdate' && endDateInput?.value) {
            return endDateInput.value;
        }
        return startInput?.value ? leaseEndISO(startInput.value, getEffectiveTerm()) : '';
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
    endDateInput?.addEventListener('input', () => {
        if (typeof onTermChange === 'function') onTermChange();
    });
    endDateInput?.addEventListener('change', () => {
        if (typeof onTermChange === 'function') onTermChange();
    });
    startInput?.addEventListener('change', refreshLabels);
    startInput?.addEventListener('input', refreshLabels);

    return { getEffectiveTerm, getEffectiveEndDate, syncCustomVisibility, refreshLabels };
}
