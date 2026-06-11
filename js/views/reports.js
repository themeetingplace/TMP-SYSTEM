// 報表 hub — 頂部區間 picker + 4 tab：總覽 / 各館報表 / 交叉分析 / 對帳單
//
// 區間狀態:  reportState.viewRange = { start, end, preset }
// 切換 tab:  reportState.activeTab = 'overview' | 'buildings' | 'analysis' | 'statement'
// 跟舊版差異：所有計算都改用「區間」聚合，不再寫死月份；分析 / 各館報表都依區間切片

import {
    mockData,
    getSortedBuildings,
    activeContractFor,
    isSettled,
    invoiceActualAmount as actualAmount
} from '../data.js';
import { refreshView } from '../utils/ui.js';
import { renderRangePicker, initRangePicker } from '../utils/dateRangePicker.js';
import { reportState, invoiceInRange, getRangeLabel } from './report-state.js';
import { exportLandlordReport } from './report-export.js';
import { exportAnalysisReport } from './analysis-export.js';

// ───────────────────── 共用 helpers ─────────────────────
const pct = v => `${(v * 100).toFixed(1)}%`;

function settledInRange(range = reportState.viewRange) {
    return mockData.invoices.filter(i => isSettled(i) && invoiceInRange(i, range));
}

function rangeDayCount(range = reportState.viewRange) {
    const s = new Date(range.start);
    const e = new Date(range.end);
    return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

// ───────────────────── Tab 1: 總覽 ─────────────────────
function computeOverviewKPIs(range) {
    const invoices = settledInRange(range);
    // 應收 = 所有 income invoices 的 amount - discount 加總
    const receivableTotal = invoices
        .filter(i => i.direction === 'in')
        .reduce((s, i) => s + ((Number(i.amount) || 0) - (Number(i.discount) || 0)), 0);
    // 已收 = 所有 income invoices 的 paidAmount 加總 (用 actualAmount)
    const paidTotal = invoices
        .filter(i => i.direction === 'in')
        .reduce((s, i) => s + actualAmount(i), 0);
    // 淨利 = 已收 - 已付 (out invoices actualAmount)
    const expenseTotal = invoices
        .filter(i => i.direction === 'out')
        .reduce((s, i) => s + actualAmount(i), 0);
    const net = paidTotal - expenseTotal;
    // 出租率 (current snapshot — not range-based)
    const allBeds = mockData.properties || [];
    const rentedBeds = allBeds.filter(p => activeContractFor(p.name));
    const occRate = allBeds.length ? rentedBeds.length / allBeds.length : 0;
    return {
        receivableTotal,
        paidTotal,
        expenseTotal,
        net,
        occRate,
        totalBeds: allBeds.length,
        rentedBeds: rentedBeds.length,
        invoiceCount: invoices.length
    };
}

// 收入結構 (by type) — donut data
function computeIncomeByType(range) {
    const invoices = settledInRange(range).filter(i => i.direction === 'in');
    const byType = {};
    invoices.forEach(i => {
        const t = i.type || '其他';
        byType[t] = (byType[t] || 0) + actualAmount(i);
    });
    const total = Object.values(byType).reduce((s, v) => s + v, 0);
    return Object.entries(byType)
        .map(([type, amount]) => ({ type, amount, pct: total ? amount / total : 0 }))
        .sort((a, b) => b.amount - a.amount);
}

// 各館收入 (bar data)
function computeIncomeByBuilding(range) {
    const buildings = getSortedBuildings({ activeOnly: true });
    const invoices = settledInRange(range).filter(i => i.direction === 'in');
    return buildings.map(b => {
        const amount = invoices.filter(i => i.buildingId === b.id).reduce((s, i) => s + actualAmount(i), 0);
        return { label: b.name, amount };
    }).sort((a, b) => b.amount - a.amount);
}

// 月度趨勢 (last 6 months ending at range end)
function computeMonthlyTrend(range) {
    const end = new Date(range.end);
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const monthKey = `${yyyy}-${mm}`;
        const monthStart = `${monthKey}-01`;
        const lastDay = new Date(yyyy, d.getMonth() + 1, 0).getDate();
        const monthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
        const monthRange = { start: monthStart, end: monthEnd, preset: 'custom' };
        const monthInvoices = settledInRange(monthRange);
        const income = monthInvoices.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
        const expense = monthInvoices.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
        months.push({
            label: `${d.getMonth() + 1}月`,
            monthKey,
            income,
            expense,
            net: income - expense
        });
    }
    return months;
}

const DONUT_COLORS = ['#ff8859', '#22946e', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#6b7280'];

function renderDonut(items, centerValue, centerLabel) {
    if (items.length === 0 || items.every(it => it.amount === 0)) {
        return `<div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">區間內無收入資料</div>`;
    }
    let cumulative = 0;
    const total = items.reduce((s, it) => s + it.amount, 0);
    const stops = items.map((it, idx) => {
        const startPct = (cumulative / total) * 100;
        cumulative += it.amount;
        const endPct = (cumulative / total) * 100;
        return `${DONUT_COLORS[idx % DONUT_COLORS.length]} ${startPct}% ${endPct}%`;
    }).join(', ');
    return `
        <div class="donut-chart-wrap">
            <div class="donut-chart" style="background: conic-gradient(${stops});">
                <div class="donut-chart-center">
                    <div class="donut-chart-center-value">$${(centerValue / 1000).toFixed(0)}k</div>
                    <div class="donut-chart-center-label">${centerLabel}</div>
                </div>
            </div>
            <div class="donut-chart-legend">
                ${items.map((it, idx) => `
                    <div class="donut-legend-item">
                        <span class="donut-legend-dot" style="background: ${DONUT_COLORS[idx % DONUT_COLORS.length]};"></span>
                        <span class="donut-legend-label">${it.type}</span>
                        <span class="donut-legend-value">${(it.pct * 100).toFixed(0)}%</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderBarChart(items, max) {
    if (items.length === 0 || items.every(it => it.amount === 0)) {
        return `<div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">區間內無資料</div>`;
    }
    const ceiling = Math.max(1, max || Math.max(...items.map(it => it.amount)));
    return items.map(it => {
        const w = (it.amount / ceiling) * 100;
        return `
            <div class="bar-chart-row">
                <span class="bar-chart-label">${it.label}</span>
                <div class="bar-chart-bar-wrap"><div class="bar-chart-bar" style="width: ${w}%;"></div></div>
                <span class="bar-chart-value">$${(it.amount || 0).toLocaleString()}</span>
            </div>
        `;
    }).join('');
}

function renderTrendChart(months) {
    if (months.length === 0) return '';
    const w = 600, h = 180, pad = 28;
    const allValues = months.flatMap(m => [m.income, m.expense, m.net]);
    const min = Math.min(0, ...allValues);
    const max = Math.max(1, ...allValues);
    const range = max - min || 1;
    const stepX = (w - pad * 2) / (months.length - 1 || 1);
    const yFor = (v) => h - pad - ((v - min) / range) * (h - pad * 2);
    const xFor = (i) => pad + i * stepX;

    const line = (key, color) => {
        const points = months.map((m, i) => `${xFor(i)},${yFor(m[key])}`).join(' ');
        const dots = months.map((m, i) => `<circle cx="${xFor(i)}" cy="${yFor(m[key])}" r="3" fill="${color}" />`).join('');
        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
    };
    const labels = months.map((m, i) => `<text x="${xFor(i)}" y="${h - 6}" font-size="10" text-anchor="middle" fill="#9ca3af">${m.label}</text>`).join('');
    const zeroLine = min < 0 && max > 0 ? `<line x1="${pad}" y1="${yFor(0)}" x2="${w - pad}" y2="${yFor(0)}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3,3"/>` : '';

    return `
        <div class="trend-chart-wrap">
            <svg class="trend-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
                ${zeroLine}
                ${line('income', '#22946e')}
                ${line('expense', '#b13535')}
                ${line('net', '#3b82f6')}
                ${labels}
            </svg>
            <div class="trend-chart-legend">
                <span class="trend-chart-legend-item"><span class="trend-chart-legend-dot" style="background: #22946e;"></span>收入</span>
                <span class="trend-chart-legend-item"><span class="trend-chart-legend-dot" style="background: #b13535;"></span>支出</span>
                <span class="trend-chart-legend-item"><span class="trend-chart-legend-dot" style="background: #3b82f6;"></span>淨利</span>
            </div>
        </div>
    `;
}

function renderOverviewTab() {
    const range = reportState.viewRange;
    const k = computeOverviewKPIs(range);
    const incomeByType = computeIncomeByType(range);
    const incomeByBuilding = computeIncomeByBuilding(range);
    const trend = computeMonthlyTrend(range);
    const days = rangeDayCount(range);

    return `
        <div class="kpi-grid">
            <div class="kpi-card">
                <span class="kpi-card-accent kpi-accent-income"></span>
                <div class="kpi-card-label"><i class="ph ph-currency-circle-dollar"></i> 應收總額</div>
                <div class="kpi-card-value">$${k.receivableTotal.toLocaleString()}</div>
                <div class="kpi-card-sub">區間 ${days} 天</div>
            </div>
            <div class="kpi-card">
                <span class="kpi-card-accent kpi-accent-paid"></span>
                <div class="kpi-card-label"><i class="ph ph-wallet"></i> 已收金額</div>
                <div class="kpi-card-value">$${k.paidTotal.toLocaleString()}</div>
                <div class="kpi-card-sub">${k.invoiceCount} 筆已結帳目</div>
            </div>
            <div class="kpi-card">
                <span class="kpi-card-accent kpi-accent-net"></span>
                <div class="kpi-card-label"><i class="ph ph-trend-up"></i> 淨利</div>
                <div class="kpi-card-value" style="color: ${k.net >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">$${k.net.toLocaleString()}</div>
                <div class="kpi-card-sub">已收 − 已付 = 淨利</div>
            </div>
            <div class="kpi-card">
                <span class="kpi-card-accent kpi-accent-occ"></span>
                <div class="kpi-card-label"><i class="ph ph-house-line"></i> 出租率</div>
                <div class="kpi-card-value">${pct(k.occRate)}</div>
                <div class="kpi-card-sub">${k.rentedBeds} / ${k.totalBeds} 床位</div>
            </div>
        </div>

        <div class="report-chart-grid">
            <div class="report-chart-card">
                <div class="report-chart-title"><i class="ph ph-chart-donut"></i> 收入結構</div>
                ${renderDonut(incomeByType, k.paidTotal, '已收')}
            </div>
            <div class="report-chart-card">
                <div class="report-chart-title"><i class="ph ph-buildings"></i> 各館收入</div>
                <div>${renderBarChart(incomeByBuilding)}</div>
            </div>
        </div>

        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-chart-line"></i> 月度趨勢 (過去 6 個月)</div>
            ${renderTrendChart(trend)}
        </div>
    `;
}

// ───────────────────── Tab 2: 各館報表 (按區間) ─────────────────────
function statsForBuildingRange(building, range) {
    const beds = mockData.properties.filter(p => p.buildingId === building.id);
    const totalBeds = beds.length;
    const rentedBeds = beds.filter(p => activeContractFor(p.name)).length;
    const occRate = totalBeds ? rentedBeds / totalBeds : 0;

    const inRangeInvoices = settledInRange(range).filter(i => i.buildingId === building.id);
    const incomeInvoices = inRangeInvoices.filter(i => i.direction === 'in');
    const expenseInvoices = inRangeInvoices.filter(i => i.direction === 'out');

    const actualIncome = incomeInvoices.reduce((s, i) => s + actualAmount(i), 0);
    const byType = {};
    expenseInvoices.forEach(inv => {
        byType[inv.type] = (byType[inv.type] || 0) + actualAmount(inv);
    });
    const expenseTotal = expenseInvoices.reduce((s, i) => s + actualAmount(i), 0);
    const net = actualIncome - expenseTotal;
    const grossMargin = actualIncome > 0 ? net / actualIncome : 0;

    return {
        building, totalBeds, rentedBeds, occRate,
        actualIncome, byType, expenseTotal, net, grossMargin
    };
}

// 各館子標籤列 — Tab 2 / Tab 3 共用
function renderBuildingSubTabs() {
    const buildings = getSortedBuildings({ activeOnly: true });
    const active = reportState.activeBuilding || 'all';
    return `
        <div class="bldg-subtab-row">
            <button type="button" class="bldg-subtab ${active === 'all' ? 'is-active' : ''}" data-building-sub="all">
                <i class="ph ph-stack"></i> 全館合計
            </button>
            ${buildings.map(b => `
                <button type="button" class="bldg-subtab ${active === b.id ? 'is-active' : ''}" data-building-sub="${b.id}">
                    ${b.name}
                </button>
            `).join('')}
        </div>
    `;
}

// 大數字 stat tile (Hero 樣式)
function renderStatTile(opts) {
    const { label, value, sub, accent, valueColor, iconClass } = opts;
    return `
        <div class="stat-tile" style="--accent: ${accent};">
            <div class="stat-tile-label"><i class="ph ${iconClass}"></i> ${label}</div>
            <div class="stat-tile-value" style="color: ${valueColor || 'var(--text-main)'};">$${value.toLocaleString()}</div>
            ${sub ? `<div class="stat-tile-sub">${sub}</div>` : ''}
        </div>
    `;
}

function renderBuildingsTab() {
    const range = reportState.viewRange;
    const buildings = getSortedBuildings({ activeOnly: true });
    const active = reportState.activeBuilding || 'all';

    const subTabs = renderBuildingSubTabs();

    // 全館合計 view
    if (active === 'all') {
        const allStats = buildings.map(b => statsForBuildingRange(b, range));
        const totals = allStats.reduce((acc, s) => ({
            income: acc.income + s.actualIncome,
            expense: acc.expense + s.expenseTotal,
            net: acc.net + s.net,
            totalBeds: acc.totalBeds + s.totalBeds,
            rentedBeds: acc.rentedBeds + s.rentedBeds
        }), { income: 0, expense: 0, net: 0, totalBeds: 0, rentedBeds: 0 });
        const totalOccRate = totals.totalBeds ? totals.rentedBeds / totals.totalBeds : 0;
        const maxIncome = Math.max(1, ...allStats.map(s => s.actualIncome));

        return `
            ${subTabs}
            <div class="stat-tile-grid">
                ${renderStatTile({ label: '總收入', value: totals.income, sub: `${buildings.length} 個館別`, accent: '#22946e', valueColor: 'var(--color-success)', iconClass: 'ph-arrow-down-right' })}
                ${renderStatTile({ label: '總支出', value: totals.expense, sub: '已付出帳', accent: '#b13535', valueColor: 'var(--color-danger)', iconClass: 'ph-arrow-up-right' })}
                ${renderStatTile({ label: '淨利', value: totals.net, sub: `毛利率 ${totals.income ? pct((totals.income - totals.expense) / totals.income) : '—'}`, accent: '#3b82f6', valueColor: totals.net >= 0 ? 'var(--color-success)' : 'var(--color-danger)', iconClass: 'ph-trend-up' })}
                <div class="stat-tile" style="--accent: #8b5cf6;">
                    <div class="stat-tile-label"><i class="ph ph-house-line"></i> 總出租率</div>
                    <div class="stat-tile-value">${pct(totalOccRate)}</div>
                    <div class="stat-tile-sub">${totals.rentedBeds} / ${totals.totalBeds} 床</div>
                </div>
            </div>

            <div class="report-chart-card">
                <div class="report-chart-title"><i class="ph ph-ranking"></i> 各館收入排行</div>
                <div>
                    ${allStats.sort((a, b) => b.actualIncome - a.actualIncome).map(s => {
                        const w = (s.actualIncome / maxIncome) * 100;
                        return `
                            <div class="bar-chart-row" style="cursor: pointer;" data-building-sub="${s.building.id}" title="點擊查看 ${s.building.name} 詳細">
                                <span class="bar-chart-label">${s.building.name}</span>
                                <div class="bar-chart-bar-wrap"><div class="bar-chart-bar" style="width: ${w}%;"></div></div>
                                <span class="bar-chart-value">$${s.actualIncome.toLocaleString()}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    // 單一館 view (重設計)
    const building = buildings.find(b => b.id === active);
    if (!building) {
        reportState.activeBuilding = 'all';
        return renderBuildingsTab();
    }
    const s = statsForBuildingRange(building, range);
    return `${subTabs}${renderSingleBuildingDashboard(s)}`;
}

// 單一館的儀表板版面 (Tab 2 用，重點：數字大、好讀)
function renderSingleBuildingDashboard(s) {
    const netColor = s.net >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    const occColor = s.occRate >= 0.8 ? 'var(--color-success)' : s.occRate >= 0.5 ? 'var(--color-warning)' : 'var(--color-danger)';

    // 收入分類 (從 invoices 重算，以細節展示)
    const range = reportState.viewRange;
    const inInvoices = settledInRange(range).filter(i => i.buildingId === s.building.id && i.direction === 'in');
    const incomeByType = {};
    inInvoices.forEach(i => {
        incomeByType[i.type || '其他'] = (incomeByType[i.type || '其他'] || 0) + actualAmount(i);
    });
    const incomeRows = Object.entries(incomeByType).sort((a, b) => b[1] - a[1]);
    const maxIncomeAmt = Math.max(1, ...incomeRows.map(r => r[1]));
    const maxExpenseAmt = Math.max(1, ...Object.values(s.byType));
    const expenseRows = Object.entries(s.byType).sort((a, b) => b[1] - a[1]);

    return `
        <!-- 館別 hero -->
        <div class="bldg-hero">
            <div class="bldg-hero-info">
                <h2>${s.building.name}</h2>
                <p>${s.building.baseAddress || ''}</p>
            </div>
            <button class="btn btn-outline" data-action="export-pdf" data-building-id="${s.building.id}">
                <i class="ph ph-file-pdf"></i> 匯出 PDF
            </button>
        </div>

        <!-- 4 stat tiles -->
        <div class="stat-tile-grid">
            ${renderStatTile({ label: '區間收入', value: s.actualIncome, sub: `${inInvoices.length} 筆`, accent: '#22946e', valueColor: 'var(--color-success)', iconClass: 'ph-arrow-down-right' })}
            ${renderStatTile({ label: '區間支出', value: s.expenseTotal, sub: `${Object.keys(s.byType).length} 類`, accent: '#b13535', valueColor: 'var(--color-danger)', iconClass: 'ph-arrow-up-right' })}
            ${renderStatTile({ label: '淨利', value: s.net, sub: `毛利率 ${s.actualIncome > 0 ? pct(s.grossMargin) : '—'}`, accent: '#3b82f6', valueColor: netColor, iconClass: 'ph-trend-up' })}
            <div class="stat-tile" style="--accent: #8b5cf6;">
                <div class="stat-tile-label"><i class="ph ph-house-line"></i> 出租率</div>
                <div class="stat-tile-value" style="color: ${occColor};">${pct(s.occRate)}</div>
                <div class="stat-tile-sub">${s.rentedBeds} / ${s.totalBeds} 床位</div>
            </div>
        </div>

        <!-- 收入 vs 支出 對照 -->
        <div class="io-compare-grid">
            <div class="io-card io-card-income">
                <div class="io-card-head">
                    <div class="io-card-title"><i class="ph ph-arrow-down-right"></i> 收入</div>
                    <div class="io-card-total">$${s.actualIncome.toLocaleString()}</div>
                </div>
                ${incomeRows.length === 0 ? `
                    <div class="io-empty">區間內無收入</div>
                ` : incomeRows.map(([type, amt]) => {
                    const w = (amt / maxIncomeAmt) * 100;
                    const ratio = s.actualIncome ? (amt / s.actualIncome * 100).toFixed(0) : '0';
                    return `
                        <div class="io-row">
                            <div class="io-row-label">${type}</div>
                            <div class="io-row-bar"><div class="io-row-bar-fill is-income" style="width: ${w}%;"></div></div>
                            <div class="io-row-amount">
                                <strong>$${amt.toLocaleString()}</strong>
                                <span class="io-row-pct">${ratio}%</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>

            <div class="io-card io-card-expense">
                <div class="io-card-head">
                    <div class="io-card-title"><i class="ph ph-arrow-up-right"></i> 支出</div>
                    <div class="io-card-total">$${s.expenseTotal.toLocaleString()}</div>
                </div>
                ${expenseRows.length === 0 ? `
                    <div class="io-empty">區間內無支出</div>
                ` : expenseRows.map(([type, amt]) => {
                    const w = (amt / maxExpenseAmt) * 100;
                    const ratio = s.expenseTotal ? (amt / s.expenseTotal * 100).toFixed(0) : '0';
                    return `
                        <div class="io-row">
                            <div class="io-row-label">${type}</div>
                            <div class="io-row-bar"><div class="io-row-bar-fill is-expense" style="width: ${w}%;"></div></div>
                            <div class="io-row-amount">
                                <strong>$${amt.toLocaleString()}</strong>
                                <span class="io-row-pct">${ratio}%</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

// ───────────────────── Tab 3: 交叉分析 (從 analysis.js 搬過來) ─────────────────────
function computeAggForInvoices(invoices) {
    const inAll = invoices.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
    const outAll = invoices.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
    const landlordRent = invoices.filter(i => i.direction === 'out' && i.type === '房東租金').reduce((s, i) => s + actualAmount(i), 0);
    const net = inAll - outAll;
    const grossMargin = inAll > 0 ? (inAll - landlordRent) / inAll : 0;
    const netMargin = inAll > 0 ? net / inAll : 0;
    return { inAll, outAll, landlordRent, net, grossMargin, netMargin };
}

function renderAnalysisTab() {
    const active = reportState.activeBuilding || 'all';
    const subTabs = renderBuildingSubTabs();
    if (active !== 'all') {
        return `${subTabs}${renderSingleBuildingAnalysis(active)}`;
    }
    return `${subTabs}${renderAnalysisAllBuildings()}`;
}

// 單一館的交叉分析 (按帳單類型細部 + 月度趨勢)
function renderSingleBuildingAnalysis(buildingId) {
    const range = reportState.viewRange;
    const buildings = getSortedBuildings({ activeOnly: true });
    const building = buildings.find(b => b.id === buildingId);
    if (!building) {
        reportState.activeBuilding = 'all';
        return renderAnalysisAllBuildings();
    }
    const invoices = settledInRange(range).filter(i => i.buildingId === buildingId);
    const agg = computeAggForInvoices(invoices);

    // 收入 / 支出按類型
    const incomeByType = {};
    const expenseByType = {};
    invoices.forEach(i => {
        const key = i.type || '其他';
        if (i.direction === 'in') incomeByType[key] = (incomeByType[key] || 0) + actualAmount(i);
        else expenseByType[key] = (expenseByType[key] || 0) + actualAmount(i);
    });
    const incomeRows = Object.entries(incomeByType).sort((a, b) => b[1] - a[1]);
    const expenseRows = Object.entries(expenseByType).sort((a, b) => b[1] - a[1]);
    const maxIn = Math.max(1, ...incomeRows.map(r => r[1]));
    const maxOut = Math.max(1, ...expenseRows.map(r => r[1]));

    // 月度趨勢 (6 個月)
    const end = new Date(range.end);
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const monthKey = `${yyyy}-${mm}`;
        const monthStart = `${monthKey}-01`;
        const lastDay = new Date(yyyy, d.getMonth() + 1, 0).getDate();
        const monthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
        const monthRange = { start: monthStart, end: monthEnd, preset: 'custom' };
        const monthInvoices = settledInRange(monthRange).filter(i => i.buildingId === buildingId);
        const inc = monthInvoices.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
        const exp = monthInvoices.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
        months.push({ label: `${d.getMonth() + 1}月`, income: inc, expense: exp, net: inc - exp });
    }

    return `
        <div class="bldg-hero">
            <div class="bldg-hero-info">
                <h2>${building.name}</h2>
                <p>${building.baseAddress || ''}</p>
            </div>
            <button class="btn btn-outline" id="btn-export-analysis-pdf">
                <i class="ph ph-file-pdf"></i> 匯出 PDF
            </button>
        </div>

        <div class="stat-tile-grid">
            ${renderStatTile({ label: '收入合計', value: agg.inAll, sub: `${incomeRows.length} 類`, accent: '#22946e', valueColor: 'var(--color-success)', iconClass: 'ph-arrow-down-right' })}
            ${renderStatTile({ label: '支出合計', value: agg.outAll, sub: `${expenseRows.length} 類`, accent: '#b13535', valueColor: 'var(--color-danger)', iconClass: 'ph-arrow-up-right' })}
            ${renderStatTile({ label: '淨收益', value: agg.net, sub: `淨利率 ${agg.inAll > 0 ? pct(agg.netMargin) : '—'}`, accent: '#3b82f6', valueColor: agg.net >= 0 ? 'var(--color-success)' : 'var(--color-danger)', iconClass: 'ph-trend-up' })}
            <div class="stat-tile" style="--accent: #f59e0b;">
                <div class="stat-tile-label"><i class="ph ph-chart-pie"></i> 毛利率</div>
                <div class="stat-tile-value">${agg.inAll > 0 ? pct(agg.grossMargin) : '—'}</div>
                <div class="stat-tile-sub">扣房東租金後</div>
            </div>
        </div>

        <div class="io-compare-grid">
            <div class="io-card io-card-income">
                <div class="io-card-head">
                    <div class="io-card-title"><i class="ph ph-arrow-down-right"></i> 收入分類</div>
                    <div class="io-card-total">$${agg.inAll.toLocaleString()}</div>
                </div>
                ${incomeRows.length === 0 ? `<div class="io-empty">無收入</div>` : incomeRows.map(([type, amt]) => {
                    const w = (amt / maxIn) * 100;
                    const ratio = agg.inAll ? (amt / agg.inAll * 100).toFixed(0) : '0';
                    return `
                        <div class="io-row">
                            <div class="io-row-label">${type}</div>
                            <div class="io-row-bar"><div class="io-row-bar-fill is-income" style="width: ${w}%;"></div></div>
                            <div class="io-row-amount"><strong>$${amt.toLocaleString()}</strong><span class="io-row-pct">${ratio}%</span></div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="io-card io-card-expense">
                <div class="io-card-head">
                    <div class="io-card-title"><i class="ph ph-arrow-up-right"></i> 支出分類</div>
                    <div class="io-card-total">$${agg.outAll.toLocaleString()}</div>
                </div>
                ${expenseRows.length === 0 ? `<div class="io-empty">無支出</div>` : expenseRows.map(([type, amt]) => {
                    const w = (amt / maxOut) * 100;
                    const ratio = agg.outAll ? (amt / agg.outAll * 100).toFixed(0) : '0';
                    return `
                        <div class="io-row">
                            <div class="io-row-label">${type}</div>
                            <div class="io-row-bar"><div class="io-row-bar-fill is-expense" style="width: ${w}%;"></div></div>
                            <div class="io-row-amount"><strong>$${amt.toLocaleString()}</strong><span class="io-row-pct">${ratio}%</span></div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>

        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-chart-line"></i> ${building.name} 月度趨勢 (過去 6 個月)</div>
            ${renderTrendChart(months)}
        </div>
    `;
}

function renderAnalysisAllBuildings() {
    const range = reportState.viewRange;
    const rangeInvoices = settledInRange(range);
    const summary = computeAggForInvoices(rangeInvoices);
    const activeBuildings = getSortedBuildings({ activeOnly: true });
    const grouping = reportState.viewGrouping;

    let unitRows;
    if (grouping === 'group') {
        const groups = {};
        activeBuildings.forEach(b => {
            const g = b.group || b.name;
            if (!groups[g]) groups[g] = { label: g, buildings: [], invoices: [] };
            groups[g].buildings.push(b);
        });
        rangeInvoices.forEach(inv => {
            const b = activeBuildings.find(x => x.id === inv.buildingId);
            if (!b) return;
            const g = b.group || b.name;
            if (groups[g]) groups[g].invoices.push(inv);
        });
        unitRows = Object.values(groups).map(g => ({
            label: g.label,
            sub: g.buildings.map(b => b.name).join(' + '),
            ...computeAggForInvoices(g.invoices)
        }));
    } else {
        unitRows = activeBuildings.map(b => ({
            label: b.name,
            sub: b.group ? `群組：${b.group}` : '',
            ...computeAggForInvoices(rangeInvoices.filter(inv => inv.buildingId === b.id))
        }));
    }
    const maxIn = Math.max(1, ...unitRows.map(r => r.inAll));

    const incomeTypes = [...new Set(rangeInvoices.filter(i => i.direction === 'in').map(i => i.type))];
    const expenseTypes = [...new Set(rangeInvoices.filter(i => i.direction === 'out').map(i => i.type))];
    const matrixCols = activeBuildings;

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
            return `<td class="m-cell ${v > 0 ? 'has-val' : ''}" style="color: ${v > 0 ? color : 'var(--text-muted)'};">${v > 0 ? '$' + v.toLocaleString() : '—'}</td>`;
        }).join('');
        const total = rowTotal(direction, type);
        return `<tr><td class="m-type">${type}</td>${cells}<td class="m-total" style="color: ${color};">${total > 0 ? '$' + total.toLocaleString() : '—'}</td></tr>`;
    };

    const matrixHtml = rangeInvoices.length === 0
        ? '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">區間內尚無已結帳目</div>'
        : `
        <div class="matrix-wrap">
            <table class="matrix-table">
                <thead>
                    <tr>
                        <th class="m-type">類型</th>
                        ${matrixCols.map(b => `<th>${b.name}</th>`).join('')}
                        <th class="m-total">合計</th>
                    </tr>
                </thead>
                <tbody>
                    ${incomeTypes.length > 0 ? `
                        <tr class="m-section-row is-income"><td colspan="${matrixCols.length + 2}"><i class="ph ph-arrow-down"></i> 收入</td></tr>
                        ${incomeTypes.map(t => renderMatrixRow('in', t, 'var(--color-success)')).join('')}
                        <tr class="m-subtotal is-income">
                            <td class="m-type">收入合計</td>
                            ${matrixCols.map(b => {
                                const v = colSum('in', b.id);
                                return `<td>${v > 0 ? '<strong style="color: var(--color-success);">$' + v.toLocaleString() + '</strong>' : '—'}</td>`;
                            }).join('')}
                            <td class="m-total"><strong style="color: var(--color-success);">$${totalSum('in').toLocaleString()}</strong></td>
                        </tr>
                    ` : ''}
                    ${expenseTypes.length > 0 ? `
                        <tr class="m-section-row is-expense"><td colspan="${matrixCols.length + 2}"><i class="ph ph-arrow-up"></i> 支出</td></tr>
                        ${expenseTypes.map(t => renderMatrixRow('out', t, 'var(--color-danger)')).join('')}
                        <tr class="m-subtotal is-expense">
                            <td class="m-type">支出合計</td>
                            ${matrixCols.map(b => {
                                const v = colSum('out', b.id);
                                return `<td>${v > 0 ? '<strong style="color: var(--color-danger);">$' + v.toLocaleString() + '</strong>' : '—'}</td>`;
                            }).join('')}
                            <td class="m-total"><strong style="color: var(--color-danger);">$${totalSum('out').toLocaleString()}</strong></td>
                        </tr>
                    ` : ''}
                    <tr class="m-net-row">
                        <td class="m-type"><strong>淨收益</strong></td>
                        ${matrixCols.map(b => {
                            const net = colSum('in', b.id) - colSum('out', b.id);
                            return `<td><strong style="color: ${net >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${net < 0 ? '-' : ''}$${Math.abs(net).toLocaleString()}</strong></td>`;
                        }).join('')}
                        <td class="m-total"><strong style="color: ${summary.net >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${summary.net < 0 ? '-' : ''}$${Math.abs(summary.net).toLocaleString()}</strong></td>
                    </tr>
                </tbody>
            </table>
        </div>`;

    return `
        <div class="card" style="margin-bottom: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-buildings"></i> ${grouping === 'group' ? '各群組' : '各館'}收支</h2>
                <div class="chart-mode-toggle" role="group">
                    <button type="button" class="chart-mode-btn ${grouping === 'building' ? 'active' : ''}" data-grouping="building">按館別</button>
                    <button type="button" class="chart-mode-btn ${grouping === 'group' ? 'active' : ''}" data-grouping="group">按群組</button>
                </div>
            </div>
            <div class="building-finance-grid">
                ${unitRows.length === 0
                    ? '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">尚無資料</div>'
                    : unitRows.map(r => {
                        const widthPct = r.inAll > 0 ? Math.round(r.inAll / maxIn * 100) : 0;
                        return `
                        <div class="bf-row">
                            <div class="bf-name">
                                <strong>${r.label}</strong>
                                <span class="bf-rate ${r.net >= 0 ? 'good' : 'low'}">${r.net >= 0 ? '獲利' : '虧損'} $${Math.abs(r.net).toLocaleString()}</span>
                                ${r.sub ? `<span style="font-size: 0.7rem; color: var(--text-muted);">${r.sub}</span>` : ''}
                            </div>
                            <div class="bf-bar"><div class="bf-bar-fill" style="width: ${widthPct}%;"></div></div>
                            <div class="bf-stats">
                                <span><span class="bf-label">收入</span><strong style="color: var(--color-success);">$${r.inAll.toLocaleString()}</strong></span>
                                <span><span class="bf-label">支出</span><strong style="color: var(--color-warning);">$${r.outAll.toLocaleString()}</strong></span>
                                <span><span class="bf-label">毛利率</span><strong>${r.inAll > 0 ? pct(r.grossMargin) : '—'}</strong></span>
                                <span><span class="bf-label">淨利率</span><strong style="color: ${r.netMargin >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${r.inAll > 0 ? pct(r.netMargin) : '—'}</strong></span>
                            </div>
                        </div>
                        `;
                    }).join('')}
            </div>
        </div>

        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-chart-bar"></i> 分類交叉分析</h2>
                <button class="btn btn-outline" id="btn-export-analysis-pdf" style="padding: 0.4rem 0.75rem; font-size: 0.8rem;">
                    <i class="ph ph-file-pdf"></i> 匯出 PDF
                </button>
            </div>
            ${matrixHtml}
        </div>
    `;
}

// ───────────────────── Hub: tab bar + entry ─────────────────────
const TABS = [
    { key: 'overview',  icon: 'ph-gauge',       label: '總覽' },
    { key: 'buildings', icon: 'ph-buildings',   label: '各館報表' },
    { key: 'analysis',  icon: 'ph-chart-bar',   label: '交叉分析' }
    // 對帳單已拿掉，等代管模式一起推出
];

function renderTabBar() {
    return `
        <div class="reports-hub-tabs" role="tablist">
            ${TABS.map(t => `
                <button type="button" class="reports-hub-tab ${t.key === reportState.activeTab ? 'is-active' : ''}" data-tab="${t.key}" role="tab">
                    <i class="ph ${t.icon}"></i> ${t.label}
                </button>
            `).join('')}
        </div>
    `;
}

export function renderReports() {
    // statement tab 被拿掉了，若 activeTab 還停在 statement 強制切回 overview
    if (reportState.activeTab === 'statement') reportState.activeTab = 'overview';
    let tabContent;
    switch (reportState.activeTab) {
        case 'buildings': tabContent = renderBuildingsTab(); break;
        case 'analysis':  tabContent = renderAnalysisTab(); break;
        case 'overview':
        default:          tabContent = renderOverviewTab(); break;
    }
    return `
        <div style="margin-bottom: 1rem;">
            ${renderRangePicker()}
        </div>
        ${renderTabBar()}
        ${tabContent}
    `;
}

export function initReportsActions(scope) {
    initRangePicker(scope, () => refreshView());

    // Tab 切換 (上層: 總覽 / 各館 / 交叉)
    scope.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            reportState.activeTab = btn.dataset.tab;
            // 切換上層 tab 時，重置子 tab 到「全館合計」
            reportState.activeBuilding = 'all';
            refreshView();
        });
    });

    // 子館 sub-tab 切換 (Tab 2 / Tab 3 共用)
    scope.querySelectorAll('[data-building-sub]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            reportState.activeBuilding = el.dataset.buildingSub;
            refreshView();
        });
    });

    // 匯出 PDF
    scope.querySelectorAll('[data-action="export-pdf"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const range = reportState.viewRange;
            const ym = range.end.slice(0, 7);
            exportLandlordReport(btn.dataset.buildingId, ym);
        });
    });
    const exportAnalysisBtn = scope.querySelector('#btn-export-analysis-pdf');
    if (exportAnalysisBtn) {
        exportAnalysisBtn.addEventListener('click', () => {
            const range = reportState.viewRange;
            const ym = range.end.slice(0, 7);
            exportAnalysisReport(ym);
        });
    }

    // 交叉分析的 grouping 切換
    scope.querySelectorAll('[data-grouping]').forEach(btn => {
        btn.addEventListener('click', () => {
            reportState.viewGrouping = btn.dataset.grouping;
            refreshView();
        });
    });
}
