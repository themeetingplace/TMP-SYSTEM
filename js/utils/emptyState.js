// 空狀態通用 helper — 對應 UIUX_AUDIT M-4
//
// 取代純文字「暫無待辦事項」之類冷冰冰文字，給溫度的空狀態。
//
// 用法：
//   emptyState({ icon: 'ph-confetti', title: '本月合約都安全', hint: '沒有即將到期的合約 ✓' })
//   emptyState({ mode: 'table-row', colspan: 8, icon: 'ph-coin', title: '本月還沒有帳目' })
//   emptyState({ mode: 'inline', title: '尚未指派', hint: '可從上方按鈕指派' })

export function emptyState({
    icon = 'ph-check-circle',
    title = '沒有資料',
    hint = '',
    mode = 'block',
    colspan = 1,
    actionHtml = ''
} = {}) {
    const inner = `
        <i class="ph-fill ${icon} esf-icon" aria-hidden="true"></i>
        <div class="esf-title">${title}</div>
        ${hint ? `<div class="esf-hint">${hint}</div>` : ''}
        ${actionHtml ? `<div class="esf-action">${actionHtml}</div>` : ''}
    `;
    if (mode === 'table-row') {
        return `
            <tr class="empty-state-row">
                <td colspan="${colspan}">
                    <div class="empty-state-friendly is-table">${inner}</div>
                </td>
            </tr>
        `;
    }
    if (mode === 'inline') {
        return `<div class="empty-state-friendly is-inline">${inner}</div>`;
    }
    return `<div class="empty-state-friendly">${inner}</div>`;
}
