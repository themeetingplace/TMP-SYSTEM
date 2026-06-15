// 各館營運報告匯出 — 房東導向 PDF (用瀏覽器列印產生)
//
// 流程：點 BMS「📄 匯出 PDF」→ 開新分頁顯示報告 → 點上方「列印」→ 瀏覽器存 PDF
// CJK 字體用系統字 (Noto Sans TC / 微軟正黑)；A4 portrait

import { mockData, activeContractFor, isSettled, invoiceMonth, formatMonthLabel } from '../data.js';

function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function fmtMoney(n) { return (n || 0).toLocaleString(); }
function fmtDate(s) { return s || '—'; }

// 收集該館 + 該月的所有資料
function gatherReportData(building, ym) {
    const beds = mockData.properties.filter(p => p.buildingId === building.id);
    const totalBeds = beds.length;

    // 排序床位
    beds.sort((a, b) => {
        const ra = Number(a.roomNumber ?? 999), rb = Number(b.roomNumber ?? 999);
        if (ra !== rb) return ra - rb;
        return (a.bedLetter || '').localeCompare(b.bedLetter || '');
    });

    // 居住中房客
    const tenantRows = beds.map(bed => {
        const c = activeContractFor(bed.name);
        if (!c) return { bed, tenant: null };
        return { bed, tenant: c };
    });
    const rented = tenantRows.filter(r => r.tenant).length;
    const vacant = totalBeds - rented;
    const occRate = totalBeds ? rented / totalBeds : 0;

    // 收入：該館 該月已繳清 房租
    const incomeInvoices = mockData.invoices.filter(inv =>
        inv.buildingId === building.id &&
        inv.direction === 'in' &&
        isSettled(inv) &&
        invoiceMonth(inv) === ym
    );
    // 實收金額 — 用 paidAmount，跟 BMS 內部報表對齊
    const actualAmt = (i) => i.paidAmount != null && i.paidAmount > 0 ? i.paidAmount : (i.amount || 0);
    const actualIncome = incomeInvoices.reduce((s, i) => s + actualAmt(i), 0);
    const potentialIncome = tenantRows
        .filter(r => r.tenant)
        .reduce((s, r) => s + (r.tenant.amount || 0), 0);

    // 支出 (按類型分)
    const expenseInvoices = mockData.invoices.filter(inv =>
        inv.buildingId === building.id &&
        inv.direction === 'out' &&
        isSettled(inv) &&
        invoiceMonth(inv) === ym
    );
    const byType = {};
    expenseInvoices.forEach(inv => {
        byType[inv.type] = (byType[inv.type] || 0) + actualAmt(inv);
    });
    const expenseTotal = expenseInvoices.reduce((s, i) => s + actualAmt(i), 0);

    // 本月入退住
    const monthStart = ym + '-01';
    const nextMonth = new Date(ym + '-01');
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const monthEnd = nextMonth.toISOString().slice(0, 10);

    const moveIns = mockData.contracts.filter(c =>
        beds.some(b => b.name === c.propertyName) &&
        c.startDate >= monthStart && c.startDate < monthEnd
    );
    const moveOuts = mockData.contracts.filter(c =>
        beds.some(b => b.name === c.propertyName) &&
        c.terminatedDate && c.terminatedDate >= monthStart && c.terminatedDate < monthEnd
    );

    // 維修
    const maintenances = mockData.maintenances.filter(m =>
        beds.some(b => b.name === m.propertyName) &&
        m.reportDate >= monthStart && m.reportDate < monthEnd
    );

    return {
        building,
        ym,
        totalBeds, rented, vacant, occRate,
        actualIncome, potentialIncome, vacancyLoss: Math.max(0, potentialIncome - actualIncome),
        byType, expenseTotal,
        net: actualIncome - expenseTotal,
        grossMargin: actualIncome > 0 ? (actualIncome - expenseTotal) / actualIncome : 0,
        tenantRows, moveIns, moveOuts, maintenances
    };
}

export function buildLandlordReportHtml(building, ym) {
    const d = gatherReportData(building, ym);
    const today = new Date().toISOString().slice(0, 10);
    const periodLabel = formatMonthLabel(ym);

    const kpiCards = [
        { label: '出租率', value: `${(d.occRate * 100).toFixed(0)}%`, sub: `${d.rented} / ${d.totalBeds} 床` },
        { label: '月收入', value: `$${fmtMoney(d.actualIncome)}`, sub: `預期 $${fmtMoney(d.potentialIncome)}`, color: '#22946e' },
        { label: '月支出', value: `$${fmtMoney(d.expenseTotal)}`, sub: `${Object.keys(d.byType).length} 項`, color: '#b13535' },
        { label: '淨利', value: `${d.net >= 0 ? '' : '-'}$${fmtMoney(Math.abs(d.net))}`, sub: `毛利率 ${(d.grossMargin * 100).toFixed(0)}%`, color: d.net >= 0 ? '#22946e' : '#b13535' }
    ].map(k => `
        <div class="kpi">
            <div class="kpi-label">${k.label}</div>
            <div class="kpi-value" style="color: ${k.color || '#1a1c23'};">${k.value}</div>
            <div class="kpi-sub">${k.sub}</div>
        </div>
    `).join('');

    const tenantRowsHtml = d.tenantRows.map(r => {
        const bedLabel = r.bed.roomNumber && r.bed.bedLetter ? `R${r.bed.roomNumber}-${r.bed.bedLetter}` : r.bed.name;
        if (!r.tenant) {
            return `<tr class="vacant"><td>${esc(bedLabel)}</td><td><i>空床</i></td><td></td><td></td></tr>`;
        }
        return `<tr>
            <td>${esc(bedLabel)}</td>
            <td>${esc(r.tenant.tenant)}</td>
            <td style="text-align: right;">$${fmtMoney(r.tenant.amount)}</td>
            <td>${fmtDate(r.tenant.startDate)} ~ ${fmtDate(r.tenant.endDate)}</td>
        </tr>`;
    }).join('');

    const expenseRowsHtml = Object.entries(d.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, amt]) => `<tr><td>${esc(type)}</td><td style="text-align: right;">$${fmtMoney(amt)}</td></tr>`)
        .join('') || '<tr><td colspan="2" class="empty">本月無支出紀錄</td></tr>';

    const moveInsHtml = d.moveIns.length === 0
        ? '<li class="empty">本月無新入住</li>'
        : d.moveIns.map(c => `<li>➕ <strong>${esc(c.tenant)}</strong> 入住 ${esc((c.propertyName || '').replace('聚空間 - ', ''))} (${fmtDate(c.startDate)})</li>`).join('');
    const moveOutsHtml = d.moveOuts.length === 0
        ? '<li class="empty">本月無退租</li>'
        : d.moveOuts.map(c => `<li>➖ <strong>${esc(c.tenant)}</strong> 退租 ${esc((c.propertyName || '').replace('聚空間 - ', ''))} (${fmtDate(c.terminatedDate)})</li>`).join('');

    const maintHtml = d.maintenances.length === 0
        ? '<li class="empty">本月無維修紀錄</li>'
        : d.maintenances.map(m => `<li>${esc(m.reportDate)} ${esc((m.propertyName || '').replace('聚空間 - ', ''))} — ${esc(m.issue)} ${m.cost ? `$${fmtMoney(m.cost)}` : ''} <span class="status-pill">${esc(m.status)}</span></li>`).join('');

    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>${esc(building.name)} ${periodLabel} 營運報告</title>
<style>
    @page { size: A4 portrait; margin: 1.5cm; }
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
        .report-page { box-shadow: none !important; padding: 0 !important; }
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
        max-width: 21cm;
        margin: 0 auto;
        background: white;
        padding: 2rem;
        box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    header.report-header {
        border-bottom: 3px solid #b8871f;
        padding-bottom: 1rem;
        margin-bottom: 1.5rem;
    }
    h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
    .meta { font-size: 0.85rem; color: #6b7280; }
    section { margin-bottom: 1.5rem; page-break-inside: avoid; }
    h2 { font-size: 1rem; margin: 0 0 0.6rem; color: #334155; border-left: 4px solid #b8871f; padding-left: 0.6rem; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; }
    .kpi { padding: 0.75rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; text-align: center; }
    .kpi-label { font-size: 0.7rem; color: #6b7280; margin-bottom: 0.25rem; }
    .kpi-value { font-size: 1.3rem; font-weight: 700; }
    .kpi-sub { font-size: 0.7rem; color: #6b7280; margin-top: 0.2rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { background: #f1f5f9; padding: 0.4rem 0.6rem; text-align: left; font-weight: 600; color: #475569; }
    td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #e2e8f0; }
    tr.vacant td { color: #6b7280; }
    .empty { color: #6b7280; font-style: italic; }
    ul { margin: 0; padding-left: 1.25rem; font-size: 0.85rem; }
    ul li { margin-bottom: 0.3rem; }
    .status-pill { font-size: 0.7rem; padding: 0.1rem 0.5rem; background: #e0f2fe; color: #0369a1; border-radius: 999px; margin-left: 0.3rem; }
    .notes-area {
        min-height: 6rem;
        border: 1px dashed #d6dae1;
        border-radius: 6px;
        padding: 0.75rem;
        font-size: 0.85rem;
        color: #6b7280;
    }
    .notes-area:empty::before { content: '（管理員可手寫補充：本月觀察、下期重點、待溝通事項…）'; }
    footer.report-footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; font-size: 0.75rem; color: #6b7280; display: flex; justify-content: space-between; }
</style>
</head>
<body>
<div class="toolbar">
    <button class="btn-print" onclick="window.print()">📄 列印 / 儲存為 PDF</button>
    <button class="btn-close" onclick="window.close()">關閉</button>
</div>

<div class="report-page">
    <header class="report-header">
        <h1>${esc(building.name)} · ${esc(periodLabel)} 營運報告</h1>
        <div class="meta">${esc(building.baseAddress || '')} · 製表 ${today}</div>
    </header>

    <section>
        <h2>📊 核心指標</h2>
        <div class="kpi-grid">${kpiCards}</div>
        ${d.vacancyLoss > 0 ? `<p style="margin-top: 0.5rem; font-size: 0.8rem; color: #6b7280;">⚠ 空床損失：$${fmtMoney(d.vacancyLoss)}（預期 vs 實收差距，多為待繳或部分繳款）</p>` : ''}
    </section>

    <section>
        <h2>💸 支出明細</h2>
        <table>
            <thead><tr><th>類別</th><th style="text-align: right;">金額</th></tr></thead>
            <tbody>${expenseRowsHtml}</tbody>
            ${d.expenseTotal > 0 ? `<tfoot><tr><td><strong>合計</strong></td><td style="text-align: right;"><strong>$${fmtMoney(d.expenseTotal)}</strong></td></tr></tfoot>` : ''}
        </table>
    </section>

    <section>
        <h2>🔧 維修紀錄</h2>
        <ul>${maintHtml}</ul>
    </section>

    <section>
        <h2>📝 管理員備註</h2>
        <div class="notes-area" contenteditable="true"></div>
    </section>

    <footer class="report-footer">
        <span>聚空間共生公寓</span>
        <span>${today}</span>
    </footer>
</div>
</body>
</html>`;
}

export function exportLandlordReport(building, ym) {
    const html = buildLandlordReportHtml(building, ym);
    const win = window.open('', '_blank');
    if (!win) {
        alert('瀏覽器擋住了彈窗。請允許彈窗後再試。');
        return;
    }
    win.document.write(html);
    win.document.close();
}
