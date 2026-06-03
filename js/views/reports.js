// 各館收入報表 — 房東/管理者導向的營運摘要
//
// 每館顯示：
//   - 出租率 (居住床數 / 總床數)
//   - 月收入 (從租客收的房租，已繳清)
//   - 月支出 (房東租金 + 水電費 + 管理費等，已付)
//   - 淨利 (收 - 支)
//   - 支出明細展開
//
// 之後可加：
//   - 匯出 PDF (用 pdf-lib 包成 A4)
//   - 房東主檔 (settings 新增 owners 表，把房東 email/LINE 串上)
//   - 按月/季/年切換

import {
    mockData, getSortedBuildings,
    activeContractFor, isSettled,
    invoiceMonth, currentMonth, shiftMonth, formatMonthLabel
} from '../data.js';
import { exportLandlordReport } from './report-export.js';

let viewMonth = currentMonth();

const actualAmt = (i) => i.paidAmount != null && i.paidAmount > 0 ? i.paidAmount : (i.amount || 0);

// 拆出輕量版「只算 income/expense/net」— 給趨勢圖跑多月份用 (不算佔床率/空床損失節省 CPU)
function incomeExpenseFor(buildingId, ym) {
    const income = mockData.invoices
        .filter(i => i.buildingId === buildingId && i.direction === 'in' && isSettled(i) && invoiceMonth(i) === ym)
        .reduce((s, i) => s + actualAmt(i), 0);
    const expense = mockData.invoices
        .filter(i => i.buildingId === buildingId && i.direction === 'out' && isSettled(i) && invoiceMonth(i) === ym)
        .reduce((s, i) => s + actualAmt(i), 0);
    return { income, expense, net: income - expense };
}

function statsForBuilding(building, ym) {
    const beds = mockData.properties.filter(p => p.buildingId === building.id);
    const totalBeds = beds.length;
    const rentedBeds = beds.filter(p => activeContractFor(p.name)).length;
    const vacantBeds = totalBeds - rentedBeds;
    const occRate = totalBeds ? (rentedBeds / totalBeds) : 0;

    // 預期房租收入 (該月所有 active 合約的月租加總)
    const potentialIncome = beds
        .map(p => activeContractFor(p.name))
        .filter(Boolean)
        .reduce((s, c) => s + (c.amount || 0), 0);

    // 實收 = 已繳清的「房租」帳單 (該館 該月入帳)
    const incomeInvoices = mockData.invoices.filter(inv =>
        inv.buildingId === building.id &&
        inv.direction === 'in' &&
        isSettled(inv) &&
        invoiceMonth(inv) === ym
    );
    // 實收金額 — 用 paidAmount (含部分繳款 / 折扣)，跟 finance.js / analysis.js 對齊
    const actualIncome = incomeInvoices.reduce((s, i) => s + actualAmt(i), 0);

    // 已付支出 (按類別分組)
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

    const net = actualIncome - expenseTotal;
    const grossMargin = actualIncome > 0 ? net / actualIncome : 0;

    // === 趨勢 / 比較 (新需求 #2) ===
    // 過去 6 個月 (含本月) net 數列，給 sparkline 用
    const trend = [];
    for (let i = 5; i >= 0; i--) {
        const m = shiftMonth(ym, -i);
        trend.push({ month: m, ...incomeExpenseFor(building.id, m) });
    }
    // 上月、去年同月 比較
    const lastMonth = incomeExpenseFor(building.id, shiftMonth(ym, -1));
    const yearAgo = incomeExpenseFor(building.id, shiftMonth(ym, -12));
    const momIncomeDelta = pctDelta(actualIncome, lastMonth.income);
    const yoyIncomeDelta = pctDelta(actualIncome, yearAgo.income);

    return {
        building,
        totalBeds,
        rentedBeds,
        vacantBeds,
        occRate,
        potentialIncome,
        actualIncome,
        vacancyLoss: Math.max(0, potentialIncome - actualIncome),
        byType,
        expenseTotal,
        net,
        grossMargin,
        trend,
        momIncomeDelta,
        yoyIncomeDelta
    };
}

// 計算百分比差 (a 相較 b)；b 為 0 時回 null
function pctDelta(a, b) {
    if (!b || b === 0) return null;
    return (a - b) / b;
}

function fmtDelta(d) {
    if (d == null) return '<span style="color: var(--text-muted); font-size: var(--text-2xs);">—</span>';
    const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
    const color = d > 0.05 ? 'var(--color-success)' : d < -0.05 ? 'var(--color-danger)' : 'var(--text-muted)';
    const pct = (d * 100);
    return `<span style="color: ${color}; font-size: var(--text-2xs); font-weight: 600;">${arrow} ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</span>`;
}

// 6 點 SVG sparkline (net 值；正負分顏色)
function sparkline(points, width = 120, height = 32) {
    const values = points.map(p => p.net);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const range = max - min || 1;
    const stepX = width / (points.length - 1 || 1);
    const coords = values.map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const last = values[values.length - 1];
    const color = last >= 0 ? '#22946e' : '#b13535';
    // 0 軸 (若有跨正負)
    const zeroY = max > 0 && min < 0
        ? height - ((-min) / range) * (height - 4) - 2
        : null;
    const zeroLine = zeroY != null ? `<line x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}" stroke="rgba(0,0,0,0.1)" stroke-width="1" stroke-dasharray="2,2"/>` : '';
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="display: block;">
        ${zeroLine}
        <polyline points="${coords}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        ${values.map((v, i) => {
            const x = i * stepX;
            const y = height - ((v - min) / range) * (height - 4) - 2;
            const r = i === values.length - 1 ? 2.5 : 1.5;
            return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${color}"/>`;
        }).join('')}
    </svg>`;
}

function renderBuildingCard(s) {
    const netColor = s.net >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    const occColor = s.occRate >= 0.8 ? 'var(--color-success)'
        : s.occRate >= 0.5 ? 'var(--color-warning)' : 'var(--color-danger)';

    const expenseRows = Object.entries(s.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, amt]) => `
            <tr>
                <td>${type}</td>
                <td style="text-align: right; color: var(--color-danger); font-weight: 500;">$${amt.toLocaleString()}</td>
            </tr>
        `).join('');

    return `
        <div class="card report-card">
            <div class="report-card-header">
                <div class="report-card-title">
                    <h3>${s.building.name}</h3>
                    <p title="${s.building.baseAddress || ''}">${s.building.baseAddress || ''}</p>
                </div>
                <button class="btn btn-outline report-export-btn" data-action="export-pdf" data-building-id="${s.building.id}" title="匯出本館營運報告 PDF">
                    <i class="ph ph-file-pdf"></i> 匯出 PDF
                </button>
            </div>

            <div class="report-summary-grid">
                <div class="report-cell">
                    <div class="cell-label">出租率</div>
                    <div class="cell-value" style="color: ${occColor};">${(s.occRate * 100).toFixed(0)}%</div>
                    <div class="cell-sub">${s.rentedBeds}/${s.totalBeds} 床 · 空 ${s.vacantBeds}</div>
                </div>
                <div class="report-cell">
                    <div class="cell-label">月收入</div>
                    <div class="cell-value income">$${s.actualIncome.toLocaleString()}</div>
                    <div class="cell-sub">預期 $${s.potentialIncome.toLocaleString()}</div>
                    <div style="margin-top: 0.2rem; display: flex; gap: 0.4rem; flex-wrap: wrap;">
                        <span title="比上月">月 ${fmtDelta(s.momIncomeDelta)}</span>
                        <span title="比去年同月">年 ${fmtDelta(s.yoyIncomeDelta)}</span>
                    </div>
                </div>
                <div class="report-cell">
                    <div class="cell-label">月支出</div>
                    <div class="cell-value expense">$${s.expenseTotal.toLocaleString()}</div>
                    <div class="cell-sub">${Object.keys(s.byType).length} 項</div>
                </div>
                <div class="report-cell ${s.vacancyLoss > 0 ? 'report-cell-warning' : ''}">
                    <div class="cell-label">空床損失</div>
                    <div class="cell-value" style="color: ${s.vacancyLoss > 0 ? 'var(--color-warning)' : 'var(--text-muted)'};">${s.vacancyLoss > 0 ? '-$' + s.vacancyLoss.toLocaleString() : '$0'}</div>
                    <div class="cell-sub">${s.vacantBeds > 0 ? `${s.vacantBeds} 床空置` : '滿房 🎉'}</div>
                </div>
                <div class="report-cell report-cell-net">
                    <div class="cell-label">淨利 (毛利率 ${s.actualIncome > 0 ? ((s.grossMargin) * 100).toFixed(0) : 0}%)</div>
                    <div class="cell-value" style="color: ${netColor};">${s.net >= 0 ? '+' : ''}$${s.net.toLocaleString()}</div>
                    <div class="cell-sub">
                        <span title="近 6 個月淨利趨勢" style="display: inline-block; vertical-align: middle;">${sparkline(s.trend)}</span>
                    </div>
                </div>
            </div>

            ${expenseRows ? `
                <details class="report-expense-detail">
                    <summary>📋 支出明細 (${Object.keys(s.byType).length} 項)</summary>
                    <table class="report-expense-table">
                        <tbody>${expenseRows}</tbody>
                        <tfoot>
                            <tr>
                                <td><strong>合計</strong></td>
                                <td style="text-align: right; color: var(--color-danger); font-weight: 700;">$${s.expenseTotal.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </table>
                </details>
            ` : ''}
        </div>
    `;
}

export function renderReports() {
    const buildings = getSortedBuildings({ activeOnly: true });
    const allStats = buildings.map(b => statsForBuilding(b, viewMonth));

    // 整體加總
    const grand = allStats.reduce((acc, s) => ({
        totalBeds: acc.totalBeds + s.totalBeds,
        rentedBeds: acc.rentedBeds + s.rentedBeds,
        actualIncome: acc.actualIncome + s.actualIncome,
        potentialIncome: acc.potentialIncome + s.potentialIncome,
        expenseTotal: acc.expenseTotal + s.expenseTotal,
        net: acc.net + s.net,
        vacancyLoss: acc.vacancyLoss + s.vacancyLoss
    }), { totalBeds: 0, rentedBeds: 0, actualIncome: 0, potentialIncome: 0, expenseTotal: 0, net: 0, vacancyLoss: 0 });
    const grandOcc = grand.totalBeds ? grand.rentedBeds / grand.totalBeds : 0;
    const grandVacant = grand.totalBeds - grand.rentedBeds;
    // 等值多少個月房租 (用平均月租計算)
    const avgRent = grand.totalBeds > 0 ? grand.potentialIncome / grand.totalBeds : 0;
    const lossInBedMonths = avgRent > 0 ? (grand.vacancyLoss / avgRent).toFixed(1) : '0';
    const grandGrossMargin = grand.actualIncome > 0 ? grand.net / grand.actualIncome : 0;
    // 合計近 6 月趨勢
    const trendLen = allStats[0]?.trend?.length || 0;
    const grandTrend = Array.from({ length: trendLen }, (_, idx) => {
        const income = allStats.reduce((a, s) => a + (s.trend[idx]?.income || 0), 0);
        const expense = allStats.reduce((a, s) => a + (s.trend[idx]?.expense || 0), 0);
        return { month: allStats[0]?.trend[idx]?.month, income, expense, net: income - expense };
    });
    // 合計 MoM / YoY (用全館加總的收入算)
    const grandMomDelta = trendLen >= 2
        ? pctDelta(grandTrend[trendLen - 1].income, grandTrend[trendLen - 2].income)
        : null;
    const grandYoyDelta = (() => {
        const ya = buildings.reduce((a, b) => a + incomeExpenseFor(b.id, shiftMonth(viewMonth, -12)).income, 0);
        return pctDelta(grand.actualIncome, ya);
    })();

    return `
        <div class="reports-page">
            <div class="card">
                <div class="reports-toolbar">
                    <div>
                        <h2 class="card-title" style="margin-bottom: 0.25rem;"><i class="ph ph-chart-line-up"></i> 各館收入報表</h2>
                        <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0;">每館的營運成績單 — 適合給房東看的數字</p>
                    </div>
                    <div class="month-switcher">
                        <button class="btn btn-outline" data-action="month-prev"><i class="ph ph-caret-left"></i></button>
                        <strong style="font-size: 1rem;">${formatMonthLabel(viewMonth)}</strong>
                        <button class="btn btn-outline" data-action="month-next"><i class="ph ph-caret-right"></i></button>
                        <button class="btn btn-outline" data-action="month-today" style="margin-left: 0.5rem;">本月</button>
                    </div>
                </div>

                <div class="report-grand-summary">
                    <div class="report-cell">
                        <div class="cell-label">總出租率</div>
                        <div class="cell-value">${(grandOcc * 100).toFixed(0)}% <span style="font-size: 0.75rem; color: var(--text-muted);">(${grand.rentedBeds}/${grand.totalBeds})</span></div>
                    </div>
                    <div class="report-cell">
                        <div class="cell-label">總收入</div>
                        <div class="cell-value income">+$${grand.actualIncome.toLocaleString()}</div>
                        <div class="cell-sub">預期 $${grand.potentialIncome.toLocaleString()}</div>
                        <div style="margin-top: 0.2rem; display: flex; gap: 0.4rem; flex-wrap: wrap;">
                            <span title="比上月">月 ${fmtDelta(grandMomDelta)}</span>
                            <span title="比去年同月">年 ${fmtDelta(grandYoyDelta)}</span>
                        </div>
                    </div>
                    <div class="report-cell">
                        <div class="cell-label">總支出</div>
                        <div class="cell-value expense">-$${grand.expenseTotal.toLocaleString()}</div>
                    </div>
                    <div class="report-cell ${grand.vacancyLoss > 0 ? 'report-cell-warning' : ''}">
                        <div class="cell-label">空床損失</div>
                        <div class="cell-value" style="color: ${grand.vacancyLoss > 0 ? 'var(--color-warning)' : 'var(--text-muted)'};">${grand.vacancyLoss > 0 ? '-$' + grand.vacancyLoss.toLocaleString() : '$0'}</div>
                        <div class="cell-sub">${grandVacant > 0 ? `${grandVacant} 床空置 · 約 ${lossInBedMonths} 床·月` : '全館滿房 🎉'}</div>
                    </div>
                    <div class="report-cell report-cell-net">
                        <div class="cell-label">淨利 (毛利率 ${(grandGrossMargin * 100).toFixed(0)}%)</div>
                        <div class="cell-value" style="color: ${grand.net >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${grand.net >= 0 ? '+' : ''}$${grand.net.toLocaleString()}</div>
                        <div class="cell-sub">
                            <span title="近 6 個月全館淨利趨勢" style="display: inline-block; vertical-align: middle;">${sparkline(grandTrend)}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="reports-grid">
                ${allStats.map(renderBuildingCard).join('')}
            </div>
        </div>
    `;
}

export function initReportsActions(scope) {
    scope.querySelector('[data-action="month-prev"]')?.addEventListener('click', () => {
        viewMonth = shiftMonth(viewMonth, -1);
        window.refreshCurrentView?.();
    });
    scope.querySelector('[data-action="month-next"]')?.addEventListener('click', () => {
        viewMonth = shiftMonth(viewMonth, 1);
        window.refreshCurrentView?.();
    });
    scope.querySelector('[data-action="month-today"]')?.addEventListener('click', () => {
        viewMonth = currentMonth();
        window.refreshCurrentView?.();
    });

    // 匯出 PDF — 每張卡片右上的按鈕
    scope.querySelectorAll('[data-action="export-pdf"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const bid = btn.dataset.buildingId;
            const building = mockData.buildings.find(b => b.id === bid);
            if (!building) return;
            exportLandlordReport(building, viewMonth);
        });
    });
}
