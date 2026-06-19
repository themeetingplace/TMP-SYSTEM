// 統一金額/帳務顯示 — 全系統 (finance / unsettled / contracts / dashboard / reports / occupancy) 共用
//
// 設計原則:
//   - 全部金額一律走 toLocaleString() 千分位
//   - 收支方向用色: in = success (品牌綠), out = danger (品牌紅), neutral = text-main
//   - 折扣/加收: discount > 0 = 折扣 (warning橘色, '-$X'), discount < 0 = 加收 (info藍色, '+$X')
//   - label 用詞統一: 「應收總額」「已收金額」「月租金」「應收調整」(避免 due/total/原價 等別稱)
//
// 用法:
//   moneyAmount(1500)                            → "$1,500"
//   moneyAmount(1500, { sign: '+' })             → "+$1,500"
//   moneyAmount(1500, { sign: 'in' })            → "+$1,500" (綠色)
//   moneyAmount(2000, { sign: 'out' })           → "-$2,000" (紅色)
//   moneyAmount(null)                            → "$0"
//
//   moneyCell({ amount: 8500, paid: 8500 })      → "$8,500" + 已收訖 chip
//   moneyCell({ amount: 8500, paid: 3000 })      → "$3,000 / $8,500" + 部分繳款 chip
//   moneyCell({ amount: 8500, paid: 0 })         → "$0 / $8,500" + 欠繳 chip
//
//   adjustmentBadge(-1000)                       → "+ $1,000" 加收 (info 藍)
//   adjustmentBadge(500)                         → "- $500" 折扣 (warning 橘)
//   adjustmentBadge(0)                           → ""
//
//   paymentStatusBadge('paid')                   → ✓ 已繳清 (green chip)
//   paymentStatusBadge('partial')                → ◐ 部分繳款 (orange chip)
//   paymentStatusBadge('unpaid')                 → ! 欠繳 (red chip)

/** 千分位數字 — null/undefined/NaN 視為 0 */
function fmt(n) {
    const num = Number(n);
    return Number.isFinite(num) ? num.toLocaleString() : '0';
}

/**
 * 金額純文字 (帶 $ 符號 + 千分位 + 可選正負號 + 可選顏色 wrapper)
 * @param {number} amount
 * @param {object} opts
 *   sign: '+' | '-' | 'in' | 'out' | 'auto' | null
 *   color: 'success' | 'danger' | 'warning' | 'info' | 'muted' | 'main' | null (auto from sign)
 *   bold: bool
 * @returns {string} HTML
 */
export function moneyAmount(amount, { sign = null, color = null, bold = false } = {}) {
    const abs = Math.abs(Number(amount) || 0);
    let prefix = '$';
    let resolvedColor = color;
    if (sign === '+' || sign === 'in') {
        prefix = '+$';
        if (!resolvedColor) resolvedColor = 'success';
    } else if (sign === '-' || sign === 'out') {
        prefix = '-$';
        if (!resolvedColor) resolvedColor = 'danger';
    } else if (sign === 'auto') {
        const n = Number(amount) || 0;
        if (n > 0) { prefix = '+$'; resolvedColor = resolvedColor || 'success'; }
        else if (n < 0) { prefix = '-$'; resolvedColor = resolvedColor || 'danger'; }
    }
    const cssColor = colorVar(resolvedColor);
    const weight = bold ? ' font-weight: 700;' : '';
    if (!cssColor && !bold) return `${prefix}${fmt(abs)}`;
    return `<span style="${cssColor}${weight}">${prefix}${fmt(abs)}</span>`;
}

/** label → 統一 CSS 變數 */
function colorVar(name) {
    if (!name) return '';
    const map = {
        success: 'color: var(--color-success);',
        danger: 'color: var(--color-danger);',
        warning: 'color: var(--color-warning);',
        warningText: 'color: var(--color-warning-text);',
        info: 'color: var(--color-info);',
        muted: 'color: var(--text-muted);',
        main: 'color: var(--text-main);',
        secondary: 'color: var(--text-secondary);'
    };
    return map[name] || '';
}

/**
 * 收/支帳目儲存格 — 顯示「已收 / 應收」雙行 + 狀態 chip
 * @param {object} opts
 *   amount: 應收金額 (number)
 *   paid: 已收金額 (number, optional, default 0)
 *   direction: 'in' (收) | 'out' (支) | null
 *   showStatus: bool (預設 true) — 是否帶狀態 chip
 *   compact: bool (預設 false) — 緊湊單行
 * @returns {string} HTML
 */
export function moneyCell({ amount, paid = 0, direction = 'in', showStatus = true, compact = false } = {}) {
    const due = Number(amount) || 0;
    const got = Number(paid) || 0;
    const sign = direction === 'out' ? 'out' : 'in';
    const status = derivePayStatus(due, got);
    const statusChip = showStatus ? paymentStatusBadge(status) : '';

    if (compact) {
        return `<span style="font-weight: 600;">${moneyAmount(due, { sign })}</span> ${statusChip}`;
    }
    if (got >= due && due > 0) {
        return `
            <div style="font-weight: 700;">${moneyAmount(due, { sign })}</div>
            ${statusChip ? `<div style="margin-top: 0.2rem;">${statusChip}</div>` : ''}
        `;
    }
    return `
        <div style="font-weight: 700;">${moneyAmount(got, { sign })}</div>
        <div style="font-size: var(--text-xs); color: var(--text-muted);">應收 $${fmt(due)}</div>
        ${statusChip ? `<div style="margin-top: 0.2rem;">${statusChip}</div>` : ''}
    `;
}

/**
 * 折扣/加收徽章 — discount > 0 = 折扣(扣應收), discount < 0 = 加收(加應收)
 * @param {number} discount
 * @param {object} opts
 *   showLabel: bool — 是否顯示「折扣」「加收」字
 * @returns {string} HTML (empty if discount === 0)
 */
export function adjustmentBadge(discount, { showLabel = true } = {}) {
    const d = Number(discount) || 0;
    if (d === 0) return '';
    if (d > 0) {
        // 折扣 (扣應收)
        const label = showLabel ? ' 折扣' : '';
        return `<span style="font-size: var(--text-xs); color: var(--color-warning-text); font-weight: 600;">- $${fmt(d)}${label}</span>`;
    }
    // 加收 (加應收)
    const label = showLabel ? ' 加收' : '';
    return `<span style="font-size: var(--text-xs); color: var(--color-info); font-weight: 600;">+ $${fmt(Math.abs(d))}${label}</span>`;
}

/**
 * 繳費狀態徽章 — paid / partial / unpaid / settled
 */
export function paymentStatusBadge(status) {
    const map = {
        paid:    { icon: '✓', label: '已繳清', cls: 'success' },
        settled: { icon: '✓', label: '已結清', cls: 'success' },
        partial: { icon: '◐', label: '部分繳款', cls: 'warning' },
        unpaid:  { icon: '!', label: '欠繳', cls: 'danger' },
        overdue: { icon: '!', label: '逾期', cls: 'danger' }
    };
    const m = map[status];
    if (!m) return '';
    return `<span class="status-badge ${m.cls}" style="font-size: var(--text-2xs);">${m.icon} ${m.label}</span>`;
}

/** paid vs due → status code */
export function derivePayStatus(due, paid) {
    const d = Number(due) || 0;
    const p = Number(paid) || 0;
    if (d <= 0 && p <= 0) return 'settled';
    if (p >= d) return 'paid';
    if (p > 0) return 'partial';
    return 'unpaid';
}

/**
 * 收支 row 顯示 — 用在 row 級別的「本筆收入/支出」標題
 * @param {object} opts
 *   amount, direction, type, label
 */
export function rowMoney({ amount, direction = 'in', strong = true }) {
    return moneyAmount(amount, { sign: direction, bold: strong });
}

/** 短碼: paymentStatusFromInvoice (給 invoice 用) */
export function invoiceStatusBadge(inv) {
    if (!inv) return '';
    const due = (Number(inv.amount) || 0) - (Number(inv.discount) || 0);
    const paid = Number(inv.paidAmount) || 0;
    return paymentStatusBadge(derivePayStatus(due, paid));
}
