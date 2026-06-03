// 空狀態通用 helper — 對應 UIUX_AUDIT M-4
//
// 取代純文字「暫無待辦事項」之類冷冰冰文字，給溫度的空狀態。
//
// 用法：
//   emptyState({ icon: 'ph-confetti', title: '本月合約都安全', hint: '沒有即將到期的合約 ✓' })

export function emptyState({ icon = 'ph-check-circle', title = '沒有資料', hint = '' } = {}) {
    return `
        <div class="empty-state-friendly">
            <i class="ph-fill ${icon} esf-icon" aria-hidden="true"></i>
            <div class="esf-title">${title}</div>
            ${hint ? `<div class="esf-hint">${hint}</div>` : ''}
        </div>
    `;
}
