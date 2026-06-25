// 總收支表 PDF 匯出 — 用瀏覽器列印產生 (A4 landscape，盡量一頁完成)
//
// 流程：點 BMS「📄 匯出 PDF」→ 開新分頁顯示報告 → 點上方「列印」→ 瀏覽器存 PDF

import { mockData, isSettled, invoiceMonth, formatMonthLabel, invoiceActualAmount as actualAmount, formatDiscountReason, isPreCutoff } from '../data.js';

function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function fmtMoney(n) { return (n || 0).toLocaleString(); }
function buildingName(buildingId) {
    return mockData.buildings.find(b => b.id === buildingId)?.name || '—';
}

export function buildFinanceReportHtml(ym) {
    const today = new Date().toISOString().slice(0, 10);
    const periodLabel = formatMonthLabel(ym);

    const invoices = mockData.invoices
        .filter(inv => !isPreCutoff(inv))  // pre-cutoff 不算進 PDF 匯出
        .filter(inv => isSettled(inv) && invoiceMonth(inv) === ym)
        .sort((a, b) => {
            // 日期升冪 (1 號最早, 月底最晚) — 用戶慣例: 從月初翻到月底
            const da = a.paidDate || a.dueDate || '';
            const db = b.paidDate || b.dueDate || '';
            return da.localeCompare(db);
        });

    const inAll  = invoices.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
    const outAll = invoices.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
    const net = inAll - outAll;
    const inCount = invoices.filter(i => i.direction === 'in').length;
    const outCount = invoices.filter(i => i.direction === 'out').length;

    const rows = invoices.map(inv => {
        const sign = inv.direction === 'out' ? '-' : '+';
        const color = inv.direction === 'out' ? '#b13535' : '#22946e';
        const item = inv.direction === 'in'
            ? (inv.tenant || '—')
            : (inv.contractId ? `合約 ${inv.contractId}` : '整館共用');
        const periodSub = inv.periodStart && inv.periodEnd
            ? `<div class="sub">租期 ${inv.periodStart.slice(5)}~${inv.periodEnd.slice(5)}</div>`
            : (inv.propertyName ? `<div class="sub">${esc(inv.propertyName.replace('聚空間 - ', ''))}</div>` : '');
        const shown = actualAmount(inv);
        const hasDiscount = inv.discount && inv.discount > 0;

        return `
            <tr class="${inv.direction === 'in' ? 'row-in' : 'row-out'}">
                <td class="nowrap">${esc(inv.paidDate || inv.dueDate || '—')}</td>
                <td class="nowrap">${esc(buildingName(inv.buildingId))}</td>
                <td class="nowrap"><span class="tag">${esc(inv.type)}</span></td>
                <td>${esc(item)}${periodSub}</td>
                <td class="right nowrap">
                    <div class="amount" style="color: ${color};">${sign}$${fmtMoney(shown)}</div>
                    ${hasDiscount ? `<div class="sub">原價 $${fmtMoney(inv.amount)}</div>` : ''}
                </td>
                <td class="right nowrap">${hasDiscount
                    ? `<div style="color: #b8871f; font-weight: 600;">-$${fmtMoney(inv.discount)}</div>
                       ${inv.discountReason ? `<div class="sub">${esc(formatDiscountReason(inv.discountReason))}</div>` : ''}`
                    : '<span class="muted">—</span>'}</td>
                <td class="nowrap">${esc(inv.paymentMethod || '—')}</td>
                <td>${esc(inv.note || '—')}</td>
            </tr>
        `;
    }).join('');

    const emptyRow = invoices.length === 0
        ? `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: #6b7280;">${esc(periodLabel)} 尚無已結帳目</td></tr>`
        : '';

    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>${esc(periodLabel)} 總收支表</title>
<style>
    /* A4 直式 + CSS Paged Media 自動印頁碼 (Chrome 列印 preview 支援) */
    @page {
        size: A4 portrait;
        margin: 1.2cm 1cm 1.5cm 1cm;
        @bottom-right {
            content: "第 " counter(page) " 頁 / 共 " counter(pages) " 頁";
            font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
            font-size: 9pt;
            color: #6b7280;
        }
        @bottom-left {
            content: "聚空間 PMS · 總收支表";
            font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
            font-size: 8pt;
            color: #9ca3af;
        }
    }
    * { box-sizing: border-box; }
    body {
        font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
        color: #1a1c23;
        margin: 0;
        padding: 1.5rem;
        background: #f1f5f9;
    }
    @media print {
        body { background: white; padding: 0; }
        .toolbar { display: none !important; }
        .report-page { box-shadow: none !important; padding: 0 !important; max-width: none !important; }
        /* 分頁: tbody row 不要在中間斷開 */
        tr { page-break-inside: avoid; }
        /* thead 每頁重複 */
        thead { display: table-header-group; }
        tfoot { display: table-row-group; }
    }
    .toolbar {
        position: sticky;
        top: 0;
        z-index: 100;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(8px);
        padding: 1rem;
        margin: -1.5rem -1.5rem 1.5rem;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        justify-content: center;
        gap: 0.75rem;
    }
    .toolbar button {
        padding: 0.6rem 1.25rem;
        font-size: 0.9rem;
        font-weight: 600;
        border: none;
        border-radius: 6px;
        cursor: pointer;
    }
    .toolbar .btn-print {
        background: linear-gradient(135deg, #b8871f, #d97706);
        color: white;
    }
    .toolbar .btn-close {
        background: #e2e8f0;
        color: #475569;
    }
    .report-page {
        max-width: 21cm;   /* A4 portrait 寬度 */
        margin: 0 auto;
        background: white;
        padding: 1.5rem;
        box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    header.report-header {
        border-bottom: 3px solid #b8871f;
        padding-bottom: 0.75rem;
        margin-bottom: 1rem;
    }
    h1 { margin: 0 0 0.2rem; font-size: 1.35rem; }
    .meta { font-size: 0.8rem; color: #6b7280; }

    .kpi-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.6rem;
        margin-bottom: 1rem;
    }
    .kpi {
        padding: 0.65rem 0.85rem;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
    }
    .kpi-label { font-size: 0.7rem; color: #6b7280; }
    .kpi-value { font-size: 1.2rem; font-weight: 700; }
    .kpi-sub { font-size: 0.7rem; color: #6b7280; }

    table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 0.74rem;
    }
    /* 欄寬比例 (A4 直式 ~19cm 可用寬度): 日期 / 館別 / 類別 / 項目 / 實收 / 折扣 / 付款 / 備註 */
    col.c-date     { width: 11%; }   /* 1.8cm — 容 2026-06-01 八字 */
    col.c-building { width: 8%; }
    col.c-type     { width: 7%; }
    col.c-item     { width: 17%; }
    col.c-amount   { width: 11%; }
    col.c-discount { width: 9%; }
    col.c-method   { width: 7%; }
    col.c-note     { width: 30%; }

    th {
        background: #f1f5f9;
        padding: 0.4rem 0.5rem;
        text-align: left;
        font-weight: 600;
        color: #475569;
        font-size: 0.72rem;
        border-bottom: 2px solid #d6dae1;
    }
    td {
        padding: 0.35rem 0.5rem;
        border-bottom: 1px solid #e2e8f0;
        vertical-align: top;
        word-break: break-word;
    }
    td.nowrap, th.nowrap { white-space: nowrap; }
    td.right, th.right { text-align: right; }
    .amount { font-weight: 700; }
    .sub { font-size: 0.66rem; color: #6b7280; margin-top: 0.1rem; }
    .muted { color: #d6dae1; }
    .tag {
        display: inline-block;
        background: #e0f2fe;
        color: #0369a1;
        font-size: 0.66rem;
        padding: 0.08rem 0.45rem;
        border-radius: 4px;
    }
    .row-in  { background: rgba(34, 197, 94, 0.04); }
    .row-out { background: rgba(220, 38, 38, 0.04); }

    tfoot td {
        padding: 0.55rem 0.5rem;
        border-top: 2px solid #d6dae1;
        border-bottom: none;
        font-weight: 600;
        background: #f8fafc;
    }

    footer.report-footer {
        margin-top: 1rem;
        padding-top: 0.75rem;
        border-top: 1px solid #e2e8f0;
        font-size: 0.7rem;
        color: #6b7280;
        display: flex;
        justify-content: space-between;
    }
</style>
</head>
<body>
<div class="toolbar">
    <button class="btn-print" onclick="window.print()">📄 列印 / 儲存為 PDF</button>
    <button class="btn-close" onclick="window.close()">關閉</button>
</div>

<div class="report-page">
    <header class="report-header">
        <h1>聚空間 · ${esc(periodLabel)} 總收支表</h1>
        <div class="meta">製表 ${today} · 共 ${invoices.length} 筆已結帳目</div>
    </header>

    <div class="kpi-grid">
        <div class="kpi">
            <div class="kpi-label">已收金額</div>
            <div class="kpi-value" style="color: #22946e;">$${fmtMoney(inAll)}</div>
            <div class="kpi-sub">${inCount} 筆收入</div>
        </div>
        <div class="kpi">
            <div class="kpi-label">支出金額</div>
            <div class="kpi-value" style="color: #b13535;">$${fmtMoney(outAll)}</div>
            <div class="kpi-sub">${outCount} 筆支出</div>
        </div>
        <div class="kpi">
            <div class="kpi-label">本月淨收益</div>
            <div class="kpi-value" style="color: ${net >= 0 ? '#22946e' : '#b13535'};">${net < 0 ? '-' : ''}$${fmtMoney(Math.abs(net))}</div>
            <div class="kpi-sub">淨利率 ${inAll > 0 ? (net / inAll * 100).toFixed(1) + '%' : '—'}</div>
        </div>
    </div>

    <table>
        <colgroup>
            <col class="c-date">
            <col class="c-building">
            <col class="c-type">
            <col class="c-item">
            <col class="c-amount">
            <col class="c-discount">
            <col class="c-method">
            <col class="c-note">
        </colgroup>
        <thead>
            <tr>
                <th class="nowrap">日期</th>
                <th class="nowrap">館別</th>
                <th class="nowrap">類別</th>
                <th>項目</th>
                <th class="right nowrap">實收 / 實付</th>
                <th class="right nowrap">應收調整</th>
                <th class="nowrap">付款</th>
                <th>備註</th>
            </tr>
        </thead>
        <tbody>${rows}${emptyRow}</tbody>
        ${invoices.length > 0 ? `<tfoot>
            <tr>
                <td colspan="4" style="text-align: right;">本月合計</td>
                <td class="right" style="color: #22946e;">+$${fmtMoney(inAll)}</td>
                <td class="right" style="color: #b13535;">-$${fmtMoney(outAll)}</td>
                <td colspan="2" style="text-align: right;">淨 <span style="color: ${net >= 0 ? '#22946e' : '#b13535'};">${net < 0 ? '-' : ''}$${fmtMoney(Math.abs(net))}</span></td>
            </tr>
        </tfoot>` : ''}
    </table>

    <footer class="report-footer">
        <span>聚空間共生公寓 · 總收支表</span>
        <span>${today}</span>
    </footer>
</div>
</body>
</html>`;
}

export function exportFinanceReport(ym) {
    const html = buildFinanceReportHtml(ym);
    const win = window.open('', '_blank');
    if (!win) {
        alert('瀏覽器擋住了彈窗。請允許彈窗後再試。');
        return;
    }
    win.document.write(html);
    win.document.close();
}
