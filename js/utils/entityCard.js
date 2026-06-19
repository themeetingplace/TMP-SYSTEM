// 統一 mobile / list entity card — 抽自 finance.js / unsettled.js 的 .entity-mobile-card
//
// 用法 (給列表頁的 mobile fallback row 用):
//   entityCard({
//       title: '王曉明',           // 主標 (例: 租客名 / 合約 ID)
//       subtitle: '古亭1館 R5-A',  // 副標 (例: 物件名 / 來源)
//       hero: {                    // 右上 hero (例: 金額 / 狀態)
//           value: moneyAmount(8500, { sign: 'in' }),
//           badge: paymentStatusBadge('paid')
//       },
//       chips: [                   // dot-separator chips (橫排)
//           { icon: 'ph-calendar', label: '2026-06-15' },
//           { icon: 'ph-file-text', label: 'C001' }
//       ],
//       meta: [                    // 雙欄 meta (caption + value)
//           { cap: '應收調整', val: '+ $500' },
//           { cap: '付款方式', val: '匯款' }
//       ],
//       note: '本月已調整',         // 備註 footer (可選)
//       actions: rowActions(...)   // row action buttons HTML (由 rowActions util 產生)
//   })
//
// 套上去前提: caller 的 <tr> 已有 class="row-mobile-card" + colspan = 總欄數
// 例:
//   <tr class="row-mobile-card"><td colspan="9">${entityCard({...})}</td></tr>

export function entityCard({
    title = '',
    subtitle = '',
    hero = null,         // { value, badge?, valueClass? }
    chips = [],          // [{ icon, label, type?: 'default'|'success'|'warning'|'danger' }]
    meta = [],           // [{ cap, val }]
    note = '',
    actions = '',
    typeChip = null      // { label, icon, cls } — 給 finance type 用 (income/expense/deposit)
} = {}) {
    const heroHtml = hero ? `
        <div class="c-hero-side">
            <div class="c-hero-amt ${hero.valueClass || ''}">${hero.value || ''}</div>
            ${hero.badge ? hero.badge : ''}
        </div>
    ` : '';

    const tagsHtml = (subtitle || typeChip) ? `
        <div class="c-hero-tags">
            ${subtitle ? `<span class="c-hero-place">${subtitle}</span>` : ''}
            ${(subtitle && typeChip) ? '<span class="dot"></span>' : ''}
            ${typeChip ? `<span class="type-chip ${typeChip.cls || ''}"><i class="ph ${typeChip.icon || ''}"></i> ${typeChip.label || ''}</span>` : ''}
        </div>
    ` : '';

    const chipsHtml = chips.length ? `
        <div class="c-chips">
            ${chips.filter(Boolean).map(c => {
                const cls = c.type ? ` c-chip-${c.type}` : '';
                const icon = c.icon ? `<i class="ph ${c.icon}"></i>` : '';
                return `<span class="c-chip${cls}">${icon} ${c.label || ''}</span>`;
            }).join('')}
        </div>
    ` : '';

    const metaHtml = meta.length ? `
        <div class="c-meta-grid">
            ${meta.filter(Boolean).map(m => `
                <div class="c-meta-cell">
                    <span class="c-meta-cap">${m.cap || ''}</span>
                    <span class="c-meta-val">${m.val || '—'}</span>
                </div>
            `).join('')}
        </div>
    ` : '';

    const noteHtml = note ? `
        <div class="c-note"><i class="ph ph-note"></i> ${note}</div>
    ` : '';

    const actionsHtml = actions ? `<div class="c-actions">${actions}</div>` : '';

    return `
        <div class="entity-mobile-card">
            <div class="c-hero-equal">
                <div class="c-hero-who">
                    ${title ? `<div class="c-hero-tenant">${title}</div>` : ''}
                    ${tagsHtml}
                </div>
                ${heroHtml}
            </div>
            ${(chipsHtml || metaHtml || noteHtml) ? '<div class="c-divider"></div>' : ''}
            ${chipsHtml}
            ${metaHtml}
            ${noteHtml}
            ${actionsHtml}
        </div>
    `;
}

/**
 * Helper: 完整的 mobile row wrapper — 給 dual-row pattern 用
 * @param {object} opts
 *   tr: { dataAttrs: 'data-row-id="..." data-status="..."', className: 'extra-class' }
 *   colspan: 桌機表格的總欄數
 *   card: entityCard 參數
 */
export function mobileRow({ tr = {}, colspan = 1, card }) {
    const cls = `row-mobile-card${tr.className ? ' ' + tr.className : ''}`;
    return `
        <tr ${tr.dataAttrs || ''} class="${cls}">
            <td colspan="${colspan}">${entityCard(card)}</td>
        </tr>
    `;
}
