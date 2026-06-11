// 區間選擇器 — 報表頁頂部用
// 桌面：橫向 inline (預設下拉 + 起 / 迄 + 套用)
// 手機：bottom-sheet style (預設 chip + 自訂日期)
//
// 使用：
//   const html = renderRangePicker({ presets, current, onChange })
//   onChange({ start, end, preset }) 區間改變時呼叫

import { RANGE_PRESETS, applyRangePreset, reportState, getRangeLabel } from '../views/report-state.js';

export function renderRangePicker() {
    const r = reportState.viewRange;
    const presetLabel = (RANGE_PRESETS.find(p => p.key === r.preset)?.label) || '自訂區間';
    return `
        <div class="range-picker">
            <div class="range-picker-presets">
                <i class="ph ph-calendar-blank range-picker-icon"></i>
                <div class="range-picker-preset-trigger" data-action="open-presets" tabindex="0">
                    <span class="rp-preset-label">${presetLabel}</span>
                    <i class="ph ph-caret-down"></i>
                </div>
                <div class="range-picker-preset-panel" hidden>
                    ${RANGE_PRESETS.map(p => `
                        <button type="button" class="rp-preset-option ${p.key === r.preset ? 'is-active' : ''}" data-preset="${p.key}">
                            ${p.label}
                        </button>
                    `).join('')}
                </div>
            </div>
            <div class="range-picker-dates">
                <input type="date" class="rp-date" data-rp-input="start" value="${r.start}">
                <span class="rp-sep">~</span>
                <input type="date" class="rp-date" data-rp-input="end" value="${r.end}">
            </div>
        </div>
    `;
}

// 全域只註冊一次的「點外面關閉」(避免 refreshView 後 listener 累積 + 卡舊 DOM)
let _globalDocClickInitialized = false;
function initGlobalDocClick() {
    if (_globalDocClickInitialized) return;
    _globalDocClickInitialized = true;
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.range-picker').forEach(picker => {
            const panel = picker.querySelector('.range-picker-preset-panel');
            if (!panel || panel.hidden) return;
            if (!picker.contains(e.target)) panel.hidden = true;
        });
    });
    // 也讓 Esc 關
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.range-picker-preset-panel').forEach(p => p.hidden = true);
    });
}

// 套 Flatpickr 在 range picker 的兩個 date input 上 (跟其他表單 date input 一致的視覺)
function attachFlatpickr(input, onChange) {
    if (!input || typeof window.flatpickr !== 'function') return;
    if (input.dataset.fpAttached === '1') return;
    input.dataset.fpAttached = '1';
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
        firstDayOfWeek: 1
    };
    window.flatpickr(input, {
        locale: tightLocale,
        dateFormat: 'Y-m-d',
        allowInput: true,
        disableMobile: true,
        position: 'auto',
        monthSelectorType: 'static',
        onChange: () => onChange?.()
    });
}

// 綁定事件 — 區間改變時呼叫 onChange()
export function initRangePicker(scope, onChange) {
    initGlobalDocClick();
    const root = scope.querySelector('.range-picker');
    if (!root) return;
    const trigger = root.querySelector('[data-action="open-presets"]');
    const panel = root.querySelector('.range-picker-preset-panel');
    const startInput = root.querySelector('[data-rp-input="start"]');
    const endInput = root.querySelector('[data-rp-input="end"]');

    // 開 / 關 panel
    trigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.range-picker-preset-panel').forEach(p => {
            if (p !== panel) p.hidden = true;
        });
        panel.hidden = !panel.hidden;
    });

    // 預設選項 click
    panel.querySelectorAll('.rp-preset-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset.preset;
            applyRangePreset(key);
            panel.hidden = true;
            onChange?.();
        });
    });

    // 自訂日期 change (Flatpickr 也會觸發 input 的 change 事件)
    const handleDateChange = () => {
        const start = startInput.value;
        const end = endInput.value;
        if (!start || !end) return;
        const [s, e] = start <= end ? [start, end] : [end, start];
        // 避免重複觸發 (Flatpickr + change event)
        if (reportState.viewRange.start === s && reportState.viewRange.end === e) return;
        reportState.viewRange = { start: s, end: e, preset: 'custom' };
        onChange?.();
    };
    // 套 Flatpickr 取代瀏覽器預設醜醜的 native date picker
    attachFlatpickr(startInput, handleDateChange);
    attachFlatpickr(endInput, handleDateChange);
}
