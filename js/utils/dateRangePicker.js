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

// 綁定事件 — 區間改變時呼叫 onChange()
export function initRangePicker(scope, onChange) {
    const root = scope.querySelector('.range-picker');
    if (!root) return;
    const trigger = root.querySelector('[data-action="open-presets"]');
    const panel = root.querySelector('.range-picker-preset-panel');
    const startInput = root.querySelector('[data-rp-input="start"]');
    const endInput = root.querySelector('[data-rp-input="end"]');

    // 開 / 關 panel
    const closePanel = () => panel.hidden = true;
    const openPanel = () => panel.hidden = false;
    trigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.hidden ? openPanel() : closePanel();
    });
    // 點外面關
    document.addEventListener('click', (e) => {
        if (!root.contains(e.target)) closePanel();
    });

    // 預設選項 click
    panel.querySelectorAll('.rp-preset-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.preset;
            applyRangePreset(key);
            closePanel();
            onChange?.();
        });
    });

    // 自訂日期 change
    const onDateChange = () => {
        const start = startInput.value;
        const end = endInput.value;
        if (!start || !end) return;
        // 若 start > end 自動 swap
        const [s, e] = start <= end ? [start, end] : [end, start];
        reportState.viewRange = { start: s, end: e, preset: 'custom' };
        onChange?.();
    };
    startInput?.addEventListener('change', onDateChange);
    endInput?.addEventListener('change', onDateChange);
}
