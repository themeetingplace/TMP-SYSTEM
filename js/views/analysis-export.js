// 財務分析 PDF 匯出 — 用區間 (不是單月)，含 4 KPI + 各館 P&L 對比 + 支出 Pareto + 分類交叉表
import { mockData, isSettled, getSortedBuildings, invoiceActualAmount as actualAmount } from '../data.js';

function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function fmtMoney(n) { return (n || 0).toLocaleString(); }
const pct = v => `${(v * 100).toFixed(1)}%`;
const fmtDate = iso => iso ? iso.replace(/-/g, '/') : '';

function invoiceInRange(inv, range) {
    const date = inv.paidDate || inv.dueDate;
    if (!date) return false;
    return date >= range.start && date <= range.end;
}

function settledInRange(range) {
    return mockData.invoices.filter(i => isSettled(i) && invoiceInRange(i, range));
}

// 房東租金 fuzzy match (跟畫面一致)
function detectLandlordRent(invoices) {
    return invoices.filter(i =>
        i.direction === 'out' &&
        typeof i.type === 'string' &&
        /租金|房租|房東/.test(i.type)
    );
}

function computeAgg(invoices) {
    const inAll = invoices.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
    const outAll = invoices.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
    const landlordRent = detectLandlordRent(invoices).reduce((s, i) => s + actualAmount(i), 0);
    const otherExpense = outAll - landlordRent;
    const net = inAll - outAll;
    const grossMargin = inAll > 0 ? (inAll - landlordRent) / inAll : 0;
    const netMargin = inAll > 0 ? net / inAll : 0;
    const opexRatio = inAll > 0 ? outAll / inAll : 0;
    return { inAll, outAll, landlordRent, otherExpense, net, grossMargin, netMargin, opexRatio };
}

function computeExpensePareto(invoices) {
    const expense = invoices.filter(i => i.direction === 'out');
    const total = expense.reduce((s, i) => s + actualAmount(i), 0);
    const byType = {};
    expense.forEach(i => { byType[i.type || '其他'] = (byType[i.type || '其他'] || 0) + actualAmount(i); });
    const sorted = Object.entries(byType).sort((a, b) => b[1] - a[1]);
    let cum = 0;
    return sorted.map(([type, amount]) => {
        cum += amount;
        return {
            type, amount,
            pct: total > 0 ? amount / total : 0,
            cumPct: total > 0 ? cum / total : 0
        };
    });
}

function buildAnalysisReportHtml(range, buildingId = null) {
    const today = new Date().toISOString().slice(0, 10);
    const periodLabel = `${fmtDate(range.start)} ~ ${fmtDate(range.end)}`;
    const allInRange = settledInRange(range);
    const activeBuildings = getSortedBuildings({ activeOnly: true });

    // 單館模式 → 只算這館的 invoice
    const targetBuilding = buildingId ? activeBuildings.find(b => b.id === buildingId) : null;
    const rangeInvoices = buildingId ? allInRange.filter(i => i.buildingId === buildingId) : allInRange;
    const summary = computeAgg(rangeInvoices);
    const pareto = computeExpensePareto(rangeInvoices);

    const reportTitle = targetBuilding ? `${targetBuilding.name} 財務分析報表` : '財務分析報表 · 全館合計';

    // 各館 P&L (僅全館模式顯示)
    const perBuilding = activeBuildings.map(b => ({
        building: b,
        ...computeAgg(allInRange.filter(inv => inv.buildingId === b.id))
    }));

    const buildingTableRows = perBuilding.map(r => `
        <tr>
            <td>${esc(r.building.name)}</td>
            <td class="right">$${fmtMoney(r.inAll)}</td>
            <td class="right" style="color: #6b7280;">$${fmtMoney(r.landlordRent)}</td>
            <td class="right" style="color: #6b7280;">$${fmtMoney(r.otherExpense)}</td>
            <td class="right" style="color: ${r.net >= 0 ? '#22946e' : '#b13535'}; font-weight: 700;">${r.net < 0 ? '-' : ''}$${fmtMoney(Math.abs(r.net))}</td>
            <td class="right">${r.inAll > 0 ? pct(r.grossMargin) : '—'}</td>
            <td class="right" style="color: ${r.netMargin >= 0 ? '#1a1c23' : '#b13535'};">${r.inAll > 0 ? pct(r.netMargin) : '—'}</td>
        </tr>
    `).join('') || '<tr><td colspan="7" class="empty">區間內無資料</td></tr>';

    // Pareto 表 (前 80% 標亮)
    const firstOver80 = pareto.findIndex(it => it.cumPct > 0.8);
    const lastIn80 = firstOver80 < 0 ? pareto.length - 1 : firstOver80 - 1;
    const paretoRows = pareto.length === 0
        ? '<tr><td colspan="4" class="empty">區間內無支出</td></tr>'
        : pareto.map((it, idx) => `
            <tr class="${idx <= lastIn80 ? 'pareto-key' : ''}">
                <td><strong>${idx + 1}</strong></td>
                <td>${esc(it.type)}</td>
                <td class="right">$${fmtMoney(it.amount)}</td>
                <td class="right">${(it.pct * 100).toFixed(1)}%</td>
                <td class="right">${(it.cumPct * 100).toFixed(0)}%</td>
            </tr>
        `).join('');

    // 分類交叉表 — 單館模式時 matrixCols 只有那一館 (其實就退化成單欄表)
    const incomeTypes = [...new Set(rangeInvoices.filter(i => i.direction === 'in').map(i => i.type))];
    const expenseTypes = [...new Set(rangeInvoices.filter(i => i.direction === 'out').map(i => i.type))];
    const matrixCols = targetBuilding ? [targetBuilding] : activeBuildings;
    const cellSum = (direction, type, buildingId) =>
        rangeInvoices.filter(i => i.direction === direction && i.type === type && i.buildingId === buildingId)
            .reduce((s, i) => s + actualAmount(i), 0);
    const rowTotal = (direction, type) =>
        rangeInvoices.filter(i => i.direction === direction && i.type === type).reduce((s, i) => s + actualAmount(i), 0);
    const colSum = (direction, buildingId) =>
        rangeInvoices.filter(i => i.direction === direction && i.buildingId === buildingId).reduce((s, i) => s + actualAmount(i), 0);
    const totalSum = (direction) =>
        rangeInvoices.filter(i => i.direction === direction).reduce((s, i) => s + actualAmount(i), 0);

    const renderMatrixRow = (direction, type, color) => {
        const cells = matrixCols.map(b => {
            const v = cellSum(direction, type, b.id);
            return `<td class="right" style="color: ${v > 0 ? color : '#d6dae1'};">${v > 0 ? '$' + fmtMoney(v) : '—'}</td>`;
        }).join('');
        const total = rowTotal(direction, type);
        return `<tr><td>${esc(type)}</td>${cells}<td class="right total-cell" style="color: ${color};">${total > 0 ? '$' + fmtMoney(total) : '—'}</td></tr>`;
    };

    const matrixHtml = rangeInvoices.length === 0
        ? '<div class="empty-block">區間內尚無已結帳目</div>'
        : `<table class="matrix">
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
                    ${incomeTypes.map(t => renderMatrixRow('in', t, '#22946e')).join('')}
                    <tr class="subtotal income">
                        <td>收入合計</td>
                        ${matrixCols.map(b => `<td class="right" style="color: #22946e; font-weight: 700;">${colSum('in', b.id) > 0 ? '$' + fmtMoney(colSum('in', b.id)) : '—'}</td>`).join('')}
                        <td class="right total-cell" style="color: #22946e; font-weight: 700;">$${fmtMoney(totalSum('in'))}</td>
                    </tr>
                ` : ''}
                ${expenseTypes.length > 0 ? `
                    <tr class="section-row expense"><td colspan="${matrixCols.length + 2}">↑ 支出</td></tr>
                    ${expenseTypes.map(t => renderMatrixRow('out', t, '#b13535')).join('')}
                    <tr class="subtotal expense">
                        <td>支出合計</td>
                        ${matrixCols.map(b => `<td class="right" style="color: #b13535; font-weight: 700;">${colSum('out', b.id) > 0 ? '$' + fmtMoney(colSum('out', b.id)) : '—'}</td>`).join('')}
                        <td class="right total-cell" style="color: #b13535; font-weight: 700;">$${fmtMoney(totalSum('out'))}</td>
                    </tr>
                ` : ''}
                <tr class="net-row">
                    <td><strong>淨收益</strong></td>
                    ${matrixCols.map(b => {
                        const net = colSum('in', b.id) - colSum('out', b.id);
                        return `<td class="right"><strong style="color: ${net >= 0 ? '#22946e' : '#b13535'};">${net < 0 ? '-' : ''}$${fmtMoney(Math.abs(net))}</strong></td>`;
                    }).join('')}
                    <td class="right total-cell"><strong style="color: ${summary.net >= 0 ? '#22946e' : '#b13535'};">${summary.net < 0 ? '-' : ''}$${fmtMoney(Math.abs(summary.net))}</strong></td>
                </tr>
            </tbody>
        </table>`;

    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>${esc(reportTitle)} · ${esc(periodLabel)}</title>
<style>
    @page { size: A4 landscape; margin: 1cm; }
    * { box-sizing: border-box; }
    body {
        font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
        color: #1a1c23; margin: 0; padding: 1.5rem; background: #f1f5f9;
    }
    @media print {
        body { background: white; padding: 0; }
        .toolbar { display: none !important; }
        .report-page { box-shadow: none !important; padding: 0 !important; max-width: none !important; }
        section { page-break-inside: avoid; }
    }
    .toolbar {
        position: sticky; top: 0; z-index: 100;
        background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(8px);
        padding: 1rem; margin: -1.5rem -1.5rem 1.5rem;
        border-bottom: 1px solid #e2e8f0;
        display: flex; justify-content: center; gap: 0.75rem;
    }
    .toolbar button {
        padding: 0.6rem 1.25rem; font-size: 0.9rem; font-weight: 600;
        border: none; border-radius: 6px; cursor: pointer;
    }
    .toolbar .btn-print { background: linear-gradient(135deg, #ff8859, #ff743d); color: white; }
    .toolbar .btn-close { background: #e2e8f0; color: #475569; }

    .report-page {
        max-width: 29.7cm; margin: 0 auto;
        background: white; padding: 1.5rem;
        box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    header.report-header {
        border-bottom: 3px solid #ff8859;
        padding-bottom: 0.75rem; margin-bottom: 1rem;
    }
    h1 { margin: 0 0 0.2rem; font-size: 1.4rem; }
    .meta { font-size: 0.8rem; color: #6b7280; }

    section { margin-bottom: 1.25rem; }
    h2 { font-size: 0.95rem; margin: 0 0 0.6rem; color: #334155; border-left: 4px solid #ff8859; padding-left: 0.6rem; }

    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; margin-bottom: 1rem; }
    .kpi {
        padding: 0.7rem 0.95rem; background: #f8fafc;
        border: 1px solid #e2e8f0; border-radius: 6px;
    }
    .kpi-label { font-size: 0.7rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
    .kpi-value { font-size: 1.3rem; font-weight: 800; margin: 0.25rem 0 0.1rem; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
    .kpi-sub { font-size: 0.7rem; color: #6b7280; }

    table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
    th, td { padding: 0.4rem 0.55rem; border-bottom: 1px solid #e2e8f0; text-align: left; }
    th { background: #f1f5f9; color: #475569; font-weight: 600; font-size: 0.74rem; }
    td.right, th.right { text-align: right; }
    .total-cell { background: #f8fafc; border-left: 1px solid #d6dae1; font-weight: 600; }
    .empty { color: #6b7280; font-style: italic; text-align: center; padding: 1.5rem; }
    .empty-block { text-align: center; padding: 2rem; color: #6b7280; }

    /* Pareto 表 */
    tr.pareto-key td { background: rgba(255, 136, 89, 0.06); }
    tr.pareto-key td:first-child strong { color: #c44e1c; }

    /* 交叉表 */
    .matrix tr.section-row td { font-weight: 700; font-size: 0.78rem; padding: 0.5rem 0.6rem; letter-spacing: 0.04em; }
    .matrix tr.section-row.income td { background: rgba(34, 197, 94, 0.12); color: #15803d; border-top: 2px solid rgba(34, 197, 94, 0.45); border-bottom: 1px solid rgba(34, 197, 94, 0.3); }
    .matrix tr.section-row.expense td { background: rgba(220, 38, 38, 0.10); color: #b91c1c; border-top: 3px solid rgba(220, 38, 38, 0.4); border-bottom: 1px solid rgba(220, 38, 38, 0.3); }
    .matrix tr.subtotal.income td { background: rgba(34, 197, 94, 0.06); border-bottom: 2px solid rgba(34, 197, 94, 0.5); }
    .matrix tr.subtotal.expense td { background: rgba(220, 38, 38, 0.06); border-bottom: 2px solid rgba(220, 38, 38, 0.5); }
    .matrix tr.net-row td { background: rgba(51, 65, 85, 0.08); border-top: 2px solid #475569; border-bottom: 2px solid #475569; font-size: 0.9rem; padding-top: 0.7rem; padding-bottom: 0.7rem; }

    footer.report-footer {
        margin-top: 1.5rem; padding-top: 0.75rem;
        border-top: 1px solid #e2e8f0;
        font-size: 0.7rem; color: #6b7280;
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
        <h1>聚空間 · ${esc(reportTitle)}</h1>
        <div class="meta">區間 ${esc(periodLabel)} · 製表 ${today} · 共 ${rangeInvoices.length} 筆已結帳目</div>
    </header>

    <section>
        <h2>核心指標</h2>
        <div class="kpi-grid">
            <div class="kpi">
                <div class="kpi-label">NOI 淨營運收入</div>
                <div class="kpi-value" style="color: ${summary.net >= 0 ? '#1a1c23' : '#b13535'};">$${fmtMoney(summary.net)}</div>
                <div class="kpi-sub">收 $${fmtMoney(summary.inAll)} − 付 $${fmtMoney(summary.outAll)}</div>
            </div>
            <div class="kpi">
                <div class="kpi-label">毛利率</div>
                <div class="kpi-value">${summary.inAll > 0 ? pct(summary.grossMargin) : '—'}</div>
                <div class="kpi-sub">扣租金 · 業界 20-40%</div>
            </div>
            <div class="kpi">
                <div class="kpi-label">淨利率</div>
                <div class="kpi-value" style="color: ${summary.netMargin >= 0 ? '#1a1c23' : '#b13535'};">${summary.inAll > 0 ? pct(summary.netMargin) : '—'}</div>
                <div class="kpi-sub">目標 ≥ 15%</div>
            </div>
            <div class="kpi">
                <div class="kpi-label">OpEx 營業費用率</div>
                <div class="kpi-value">${summary.inAll > 0 ? pct(summary.opexRatio) : '—'}</div>
                <div class="kpi-sub">已付 ÷ 已收 · 目標 ≤ 80%</div>
            </div>
        </div>
    </section>

    ${targetBuilding ? '' : `
    <section>
        <h2>各館 P&amp;L 對比</h2>
        <table>
            <thead>
                <tr>
                    <th>館別</th>
                    <th class="right">收入</th>
                    <th class="right">租金</th>
                    <th class="right">其他支出</th>
                    <th class="right">淨利</th>
                    <th class="right">毛利率</th>
                    <th class="right">淨利率</th>
                </tr>
            </thead>
            <tbody>${buildingTableRows}</tbody>
        </table>
    </section>`}

    <section>
        <h2>支出結構 Pareto (前 80% 標亮)</h2>
        <table>
            <thead>
                <tr>
                    <th style="width: 40px;">#</th>
                    <th>項目</th>
                    <th class="right">金額</th>
                    <th class="right">佔比</th>
                    <th class="right">累積</th>
                </tr>
            </thead>
            <tbody>${paretoRows}</tbody>
        </table>
    </section>

    <section>
        <h2>${targetBuilding ? '收支分類明細' : '分類交叉分析'}</h2>
        ${matrixHtml}
    </section>

    <footer class="report-footer">
        <span>聚空間共生公寓 · 財務分析報表</span>
        <span>${today}</span>
    </footer>
</div>
</body>
</html>`;
}

export function exportAnalysisReport(rangeOrYm, buildingId = null) {
    // 向後相容：若傳入字串 (YYYY-MM)，當成單月區間
    let range;
    if (typeof rangeOrYm === 'string' && /^\d{4}-\d{2}$/.test(rangeOrYm)) {
        const [y, m] = rangeOrYm.split('-').map(Number);
        const last = new Date(y, m, 0).getDate();
        range = { start: `${rangeOrYm}-01`, end: `${rangeOrYm}-${String(last).padStart(2, '0')}`, preset: 'custom' };
    } else {
        range = rangeOrYm;
    }
    const html = buildAnalysisReportHtml(range, buildingId);
    const win = window.open('', '_blank');
    if (!win) {
        alert('瀏覽器擋住了彈窗。請允許彈窗後再試。');
        return;
    }
    win.document.write(html);
    win.document.close();
}
