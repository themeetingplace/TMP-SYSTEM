// 列表 row action 按鈕 — 統一全系統 inline icon button
//
// 之前: 6 個 view 各自 inline `style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);"`
//      還有 .finance-action / .contract-action / .maintenance-action 三套 class 名稱
// 現在: 統一走 .btn .btn-outline .btn-xs .btn-icon-only [+ .btn-danger / .btn-success]
//
// 用法:
//   rowAction({ action: 'edit', id: c.id, icon: 'ph-pencil', title: '編輯' })
//   rowAction({ action: 'delete', id: c.id, icon: 'ph-trash', title: '刪除', variant: 'danger' })
//   rowAction({ action: 'view', id: c.id, icon: 'ph-eye', title: '檢視' })
//
// 多個按鈕:
//   rowActions([
//     { action: 'view', icon: 'ph-eye', title: '檢視' },
//     { action: 'edit', icon: 'ph-pencil', title: '編輯' },
//     { action: 'delete', icon: 'ph-trash', title: '刪除', variant: 'danger' }
//   ], c.id)
//
// 容器 (rightside):
//   rowActionGroup(htmlString) → 包成 inline-flex / 右側對齊容器

const VARIANT_CLASS = {
    default: '',         // outline 黑線
    primary: 'btn-primary-soft',
    success: 'btn-success',
    danger:  'btn-danger',
    warning: 'btn-warning',
    info:    'btn-info'
};

/**
 * 單個 row action button
 * @param {object} opts
 *   action: string (給 data-action 委派 click handler 用) — required
 *   id: string (data-id) — required if hooked to handler
 *   icon: phosphor icon class (e.g. 'ph-pencil')
 *   title: hover tooltip
 *   label: 可選 — 顯示文字 (預設 icon-only)
 *   variant: 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'info'
 *   className: 'contract-action' | 'finance-action' (給現有 click handler 抓 — 過渡期保留)
 *   color: 自訂顏色 (避免, 走 variant)
 *   disabled: bool
 *   ariaLabel: 可選, 預設用 title
 * @returns {string} HTML
 */
export function rowAction({
    action,
    id,
    icon = 'ph-dots-three',
    title = '',
    label = '',
    variant = 'default',
    className = '',
    disabled = false,
    ariaLabel = ''
} = {}) {
    const variantCls = VARIANT_CLASS[variant] || '';
    const iconOnly = !label;
    const classes = [
        'btn', 'btn-outline', 'btn-xs',
        iconOnly ? 'btn-icon-only' : '',
        variantCls,
        className
    ].filter(Boolean).join(' ');
    const ariaAttr = (ariaLabel || title) ? ` aria-label="${escapeAttr(ariaLabel || title)}"` : '';
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    const dataAttrs = [
        action ? `data-action="${escapeAttr(action)}"` : '',
        id     ? `data-id="${escapeAttr(id)}"` : ''
    ].filter(Boolean).join(' ');
    const disabledAttr = disabled ? ' disabled' : '';
    const content = label
        ? `<i class="ph ${icon}" aria-hidden="true"></i><span>${label}</span>`
        : `<i class="ph ${icon}" aria-hidden="true"></i>`;
    return `<button type="button" class="${classes}" ${dataAttrs}${titleAttr}${ariaAttr}${disabledAttr}>${content}</button>`;
}

/** 多個 row actions → 串成 HTML string */
export function rowActions(buttons, sharedId = null) {
    if (!Array.isArray(buttons)) return '';
    return buttons
        .filter(Boolean)
        .map(btn => rowAction({ ...btn, id: btn.id ?? sharedId }))
        .join('');
}

/** 右側對齊 inline-flex 容器 (取代各 view 手寫 div style) */
export function rowActionGroup(html) {
    return `<div class="row-action-group">${html}</div>`;
}

function escapeAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
