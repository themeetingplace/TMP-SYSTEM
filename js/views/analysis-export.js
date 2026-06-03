// 收支分析 PDF 匯出 — 含各館收支 + 分類交叉表

import { mockData, isSettled, invoiceMonth, formatMonthLabel, getSortedBuildings, invoiceActualAmount as actualAmount } from '../data.js';

function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function fmtMoney(n) { return (n || 0).toLocaleString(); }
const pct = v => `${(v * 100).toFixed(1)}%`;

function computeAgg(invoices) {
    const inAll = invoices.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
    const outAll = invoices.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
    const landlordRent = invoices.filter(i => i.direction === 'out' && i.type === '房東租金').reduce((s, i) => s + actualAmount(i), 0);
    const net = inAll - outAll;
    const grossMargin = inAll > 0 ? (inAll - landlordRent) / inAll : 0;
    const netMargin = inAll > 0 ? net / inAll : 0;
    return { inAll, outAll, landlordRent, net, grossMargin, netMargin };
}

export function buildAnalysisReportHtml(ym) {
    const today = new Date().toISOString().slice(0, 10);
    const periodLabel = formatMonthLabel(ym);
    const monthInvoices = mockData.invoices.filter(inv => isSettled(inv) && invoiceMonth(inv) === ym);
    const summary = computeAgg(monthInvoices);
    const activeBuildings = getSortedBuildings({ activeOnly: true });

    // 各館表
    const unitRows = activeBuildings.map(b => ({
        label: b.name,
        ...computeAgg(monthInvoices.filter(inv => inv.buildingId === b.id))
    }));

    const buildingTableRows = unitRows.map(r => `
        <tr>
            <td>${esc(r.label)}</td>
            <td class="right" style="color: #16a34a;">$${fmtMoney(r.inAll)}</td>
            <td class="right" style="color: #dc2626;">$${fmtMoney(r.outAll)}</td>
            <td class="right" style="color: ${r.net >= 0 ? '#16a34a' : '#dc2626'}; font-weight: 700;">${r.net < 0 ? '-' : ''}$${fmtMoney(Math.abs(r.net))}</td>
            <td class="right">${r.inAll > 0 ? pct(r.grossMargin) : '—'}</td>
            <td class="right">${r.inAll > 0 ? pct(r.netMargin) : '—'}</td>
        </tr>
    `).join('') || '<tr><td colspan="6" class="empty">本月無資料</td></tr>';

    // 交叉表
    const incomeTypes = [...new Set(monthInvoices.filter(i => i.direction === 'in').map(i => i.type))];
    const expenseTypes = [...new Set(monthInvoices.filter(i => i.direction === 'out').map(i => i.type))];
    const matrixCols = activeBuildings;

    const cellSum = (direction, type, buildingId) =>
        monthInvoices.filter(i => i.direction === direction && i.type === type && i.buildingId === buildingId)
            .reduce((s, i) => s + actualAmount(i), 0);
    const rowTotal = (direction, type) =>
        monthInvoices.filter(i => i.direction === direction && i.type === type)
            .reduce((s, i) => s + actualAmount(i), 0);
    const colSum = (direction, buildingId) =>
        monthInvoices.filter(i => i.direction === direction && i.buildingId === buildingId)
            .reduce((s, i) => s + actualAmount(i), 0);
    const totalSum = (direction) =>
        monthInvoices.filter(i => i.direction === direction)
            .reduce((s, i) => s + actualAmount(i), 0);

    const renderMatrixRow = (direction, type, color) => {
        const cells = matrixCols.map(b => {
            const v = cellSum(direction, type, b.id);
            return `<td class="right" style="color: ${v > 0 ? color : '#cbd5e1'};">${v > 0 ? '$' + fmtMoney(v) : '—'}</td>`;
        }).join('');
        const total = rowTotal(direction, type);
        return `<tr><td>${esc(type)}</td>${cells}<td class="right total-cell" style="color: ${color};">${total > 0 ? '$' + fmtMoney(total) : '—'}</td></tr>`;
    };

    const matrixHtml = monthInvoices.length === 0
        ? '<div class="empty-block">本月尚無已結帳目</div>'
        : `
        <table class="matrix">
            <thead>
                <tr>
                    <th>類型</th>
                    ${matrixCols.map(b => `<th class="right">${esc(b.name)}</th>`).join('')}
                    <th class="right total-cell">合計</th>
                </tr>
            </thead>
            <tbody>
                ${incomeTypes.length > 0 ? `
                    <tr class="section-row income"><td colspan="${matrixCols.length + 2}">↓ 收入</td></tr>
                    ${incomeTypes.map(t => renderMatrixRow('in', t, '#16a34a')).join('')}
                    <tr class="subtotal income">
                        <td>收入合計</td>
                        ${matrixCols.map(b => {
                            const v = colSum('in', b.id);
                            return `<td class="right" style="color: #16a34a; font-weight: 700;">${v > 0 ? '$' + fmtMoney(v) : '—'}</td>`;
                        }).join('')}
                        <td class="right total-cell" style="color: #16a34a; font-weight: 700;">$${fmtMoney(totalSum('in'))}</td>
                    </tr>
                ` : ''}
                ${expenseTypes.length > 0 ? `
                    <tr class="section-row expense"><td colspan="${matrixCols.length + 2}">↑ 支出</td></tr>
                    ${expenseTypes.map(t => renderMatrixRow('out', t, '#dc2626')).join('')}
                    <tr class="subtotal expense">
                        <td>支出合計</td>
                        ${matrixCols.map(b => {
                            const v = colSum('out', b.id);
                            return `<td class="right" style="color: #dc2626; font-weight: 700;">${v > 0 ? '$' + fmtMoney(v) : '—'}</td>`;
                        }).join('')}
                        <td class="right total-cell" style="color: #dc2626; font-weight: 700;">$${fmtMoney(totalSum('out'))}</td>
                    </tr>
                ` : ''}
                <tr class="net-row">
                    <td><strong>淨收益</strong></td>
                    ${matrixCols.map(b => {
                        const net = colSum('in', b.id) - colSum('out', b.id);
                        return `<td class="right"><strong style="color: ${net >= 0 ? '#16a34a' : '#dc2626'};">${net < 0 ? '-' : ''}$${fmtMoney(Math.abs(net))}</strong></td>`;
                    }).join('')}
                    <td class="right total-cell"><strong style="color: ${summary.net >= 0 ? '#16a34a' : '#dc2626'};">${summary.net < 0 ? '-' : ''}$${fmtMoney(Math.abs(summary.net))}</strong></td>
                </tr>
                <tr class="margin-row">
                    <td>毛利率</td>
                    ${matrixCols.map(b => {
                        const i = colSum('in', b.id);
                        const lr = monthInvoices.filter(x => x.direction === 'out' && x.type === '房東租金' && x.buildingId === b.id).reduce((s, x) => s + actualAmount(x), 0);
                        const gm = i > 0 ? (i - lr) / i : 0;
                        return `<td class="right" style="color: ${gm >= 0 ? '#64748b' : '#dc2626'};">${i > 0 ? pct(gm) : '—'}</td>`;
                    }).join('')}
                    <td class="right total-cell" style="color: ${summary.grossMargin >= 0 ? '#64748b' : '#dc2626'};">${summary.inAll > 0 ? pct(summary.grossMargin) : '—'}</td>
                </tr>
                <tr class="margin-row">
                    <td>淨利率</td>
                    ${matrixCols.map(b => {
                        const i = colSum('in', b.id);
                        const o = colSum('out', b.id);
                        const nm = i > 0 ? (i - o) / i : 0;
                        return `<td class="right" style="color: ${nm >= 0 ? '#16a34a' : '#dc2626'};">${i > 0 ? pct(nm) : '—'}</td>`;
                    }).join('')}
                    <td class="right total-cell" style="color: ${summary.netMargin >= 0 ? '#16a34a' : '#dc2626'};">${summary.inAll > 0 ? pct(summary.netMargin) : '—'}</td>
                </tr>
            </tbody>
        </table>`;

    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>${esc(periodLabel)} 收支分析</title>
<style>
    @page { size: A4 landscape; margin: 1cm; }
    * { box-sizing: border-box; }
    body {
        font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
        color: #0f172a;
        margin: 0;
        padding: 1.5rem;
        background: #f1f5f9;
    }
    @media print {
        body { background: white; padding: 0; }
        .toolbar { display: none !important; }
        .report-page { box-shadow: none !important; padding: 0 !important; max-width: none !important; }
        section { page-break-inside: avoid; }
    }
    .toolbar {
        position: sticky; top: 0; z-index: 100;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(8px);
        padding: 1rem; margin: -1.5rem -1.5rem 1.5rem;
        border-bottom: 1px solid #e2e8f0;
        display: flex; justify-content: center; gap: 0.75rem;
    }
    .toolbar button {
        padding: 0.6rem 1.25rem; font-size: 0.9rem; font-weight: 600;
        border: none; border-radius: 6px; cursor: pointer;
    }
    .toolbar .btn-print { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; }
    .toolbar .btn-close { background: #e2e8f0; color: #475569; }

    .report-page {
        max-width: 29.7cm; margin: 0 auto;
        background: white; padding: 1.5rem;
        box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    header.report-header {
        border-bottom: 3px solid #f59e0b;
        padding-bottom: 0.75rem; margin-bottom: 1rem;
    }
    h1 { margin: 0 0 0.2rem; font-size: 1.35rem; }
    .meta { font-size: 0.8rem; color: #64748b; }

    section { margin-bottom: 1.25rem; }
    h2 { font-size: 0.95rem; margin: 0 0 0.6rem; color: #334155; border-left: 4px solid #f59e0b; padding-left: 0.6rem; }

    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; margin-bottom: 1rem; }
    .kpi {
        padding: 0.65rem 0.85rem; background: #f8fafc;
        border: 1px solid #e2e8f0; border-radius: 6px;
    }
    .kpi-label { font-size: 0.7rem; color: #64748b; }
    .kpi-value { font-size: 1.2rem; font-weight: 700; margin: 0.1rem 0; }
    .kpi-sub { font-size: 0.7rem; color: #94a3b8; }

    table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
    th, td { padding: 0.4rem 0.55rem; border-bottom: 1px solid #e2e8f0; text-align: left; }
    th { background: #f1f5f9; color: #475569; font-weight: 600; font-size: 0.74rem; }
    td.right, th.right { text-align: right; }
    .total-cell { background: #f8fafc; border-left: 1px solid #cbd5e1; font-weight: 600; }
    .empty { color: #94a3b8; font-style: italic; text-align: center; padding: 1.5rem; }
    .empty-block { text-align: center; padding: 2rem; color: #94a3b8; }

    /* 交叉表分類顏色 */
    .matrix tr.section-row td {
        font-weight: 700; font-size: 0.78rem;
        padding: 0.5rem 0.6rem; letter-spacing: 0.04em;
    }
    .matrix tr.section-row.income td {
        background: rgba(34, 197, 94, 0.12); color: #15803d;
        border-top: 2px solid rgba(34, 197, 94, 0.45);
        border-bottom: 1px solid rgba(34, 197, 94, 0.3);
    }
    .matrix tr.section-row.expense td {
        background: rgba(220, 38, 38, 0.10); color: #b91c1c;
        border-top: 3px solid rgba(220, 38, 38, 0.4);
        border-bottom: 1px solid rgba(220, 38, 38, 0.3);
    }
    .matrix tr.subtotal.income td {
        background: rgba(34, 197, 94, 0.06);
        border-top: 1px dashed rgba(34, 197, 94, 0.4);
        border-bottom: 2px solid rgba(34, 197, 94, 0.5);
    }
    .matrix tr.subtotal.expense td {
        background: rgba(220, 38, 38, 0.06);
        border-top: 1px dashed rgba(220, 38, 38, 0.4);
        border-bottom: 2px solid rgba(220, 38, 38, 0.5);
    }
    .matrix tr.net-row td {
        background: rgba(51, 65, 85, 0.08);
        border-top: 2px solid #475569;
        border-bottom: 2px solid #475569;
        font-size: 0.9rem;
        padding-top: 0.7rem; padding-bottom: 0.7rem;
    }
    .matrix tr.margin-row td {
        background: transparent;
        color: #64748b;
        font-size: 0.72rem;
        padding-top: 0.35rem; padding-bottom: 0.35rem;
    }

    footer.report-footer {
        margin-top: 1.5rem; padding-top: 0.75rem;
        border-top: 1px solid #e2e8f0;
        font-size: 0.7rem; color: #94a3b8;
        display: flex; justify-content: space-between;
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
        <h1>聚空間 · ${esc(periodLabel)} 收支分析</h1>
        <div class="meta">製表 ${today} · 共 ${monthInvoices.length} 筆已結帳目</div>
    </header>

    <div class="kpi-grid">
        <div class="kpi">
            <div class="kpi-label">總收入</div>
            <div class="kpi-value" style="color: #16a34a;">$${fmtMoney(summary.inAll)}</div>
        </div>
        <div class="kpi">
            <div class="kpi-label">總支出</div>
            <div class="kpi-value" style="color: #dc2626;">$${fmtMoney(summary.outAll)}</div>
        </div>
        <div class="kpi">
            <div class="kpi-label">淨收益</div>
            <div class="kpi-value" style="color: ${summary.net >= 0 ? '#16a34a' : '#dc2626'};">${summary.net < 0 ? '-' : ''}$${fmtMoney(Math.abs(summary.net))}</div>
            <div class="kpi-sub">淨利率 ${summary.inAll > 0 ? pct(summary.netMargin) : '—'} · 毛利率 ${summary.inAll > 0 ? pct(summary.grossMargin) : '—'}</div>
        </div>
    </div>

    <section>
        <h2>🏢 各館收支</h2>
        <table>
            <thead>
                <tr>
                    <th>館別</th>
                    <th class="right">收入</th>
                    <th class="right">支出</th>
                    <th class="right">淨收益</th>
                    <th class="right">毛利率</th>
                    <th class="right">淨利率</th>
                </tr>
            </thead>
            <tbody>${buildingTableRows}</tbody>
        </table>
    </section>

    <section>
        <h2>📊 分類交叉分析</h2>
        ${matrixHtml}
    </section>

    <footer class="report-footer">
        <span>聚空間共生公寓 · 收支分析</span>
        <span>${today}</span>
    </footer>
</div>
</body>
</html>`;
}

export function exportAnalysisReport(ym) {
    const html = buildAnalysisReportHtml(ym);
    const win = window.open('', '_blank');
    if (!win) {
        alert('瀏覽器擋住了彈窗。請允許彈窗後再試。');
        return;
    }
    win.document.write(html);
    win.document.close();
}
