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

// ───────────────────── Tab 1: 總覽 (現金流為主) ─────────────────────
function computeOverviewKPIs(range) {
    // 區間內所有 income invoice (含未結算的，才能算「應收 vs 已收」)
    const allIncome = mockData.invoices.filter(i => i.direction === 'in' && invoiceInRange(i, range));
    const settledOnly = settledInRange(range);
    // 應收總額 = 所有 income invoice 的 (amount − discount)
    const receivableTotal = allIncome.reduce((s, i) => s + ((Number(i.amount) || 0) - (Number(i.discount) || 0)), 0);
    // 已收 = 所有 income invoice 的 paidAmount 總和 (含部分繳款)
    const paidTotal = allIncome.reduce((s, i) => s + (Number(i.paidAmount) || 0), 0);
    // 待收 = 應收 − 已收 (該收還沒收的)
    const outstanding = Math.max(0, receivableTotal - paidTotal);
    // 收款率
    const collectionRate = receivableTotal > 0 ? paidTotal / receivableTotal : 0;
    // 已付支出 (已結算)
    const expenseTotal = settledOnly.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
    const net = paidTotal - expenseTotal;
    return {
        receivableTotal,
        paidTotal,
        outstanding,
        collectionRate,
        expenseTotal,
        net,
        invoiceCount: allIncome.length,
        unpaidCount: allIncome.filter(i => (Number(i.paidAmount) || 0) < ((Number(i.amount) || 0) - (Number(i.discount) || 0))).length
    };
}

// 各館 應收/已收/待收 (取代收入結構 donut — 更有意義)
function computeReceivableByBuilding(range) {
    const buildings = getSortedBuildings({ activeOnly: true });
    const allIncome = mockData.invoices.filter(i => i.direction === 'in' && invoiceInRange(i, range));
    return buildings.map(b => {
        const rows = allIncome.filter(i => i.buildingId === b.id);
        const receivable = rows.reduce((s, i) => s + ((Number(i.amount) || 0) - (Number(i.discount) || 0)), 0);
        const paid = rows.reduce((s, i) => s + (Number(i.paidAmount) || 0), 0);
        const outstanding = Math.max(0, receivable - paid);
        return {
            label: b.name,
            receivable,
            paid,
            outstanding,
            collectionRate: receivable > 0 ? paid / receivable : 0
        };
    }).sort((a, b) => b.receivable - a.receivable);
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

// 各館 應收 vs 已收 stacked bar (取代 donut — 顯示現金流缺口)
function renderReceivableStackedBars(items) {
    if (items.length === 0 || items.every(it => it.receivable === 0)) {
        return `<div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">區間內無應收資料</div>`;
    }
    const maxReceivable = Math.max(...items.map(it => it.receivable), 1);
    return `
        <div class="stacked-bar-list">
            ${items.map(it => {
                const paidPct = it.receivable > 0 ? (it.paid / it.receivable) * 100 : 0;
                const totalW = (it.receivable / maxReceivable) * 100;
                const collectionPct = (it.collectionRate * 100).toFixed(0);
                return `
                    <div class="stacked-bar-row">
                        <div class="stacked-bar-head">
                            <span class="stacked-bar-label">${it.label}</span>
                            <span class="stacked-bar-rate ${it.collectionRate >= 0.95 ? 'good' : it.collectionRate >= 0.85 ? 'mid' : 'bad'}">收款 ${collectionPct}%</span>
                        </div>
                        <div class="stacked-bar-track" style="width: ${totalW}%;">
                            <div class="stacked-bar-paid" style="width: ${paidPct}%;"></div>
                        </div>
                        <div class="stacked-bar-vals">
                            <span class="sb-val-paid">已收 $${it.paid.toLocaleString()}</span>
                            ${it.outstanding > 0 ? `<span class="sb-val-out">待收 $${it.outstanding.toLocaleString()}</span>` : ''}
                            <span class="sb-val-total">/ 應收 $${it.receivable.toLocaleString()}</span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// 月度趨勢折線圖 — 含 Y 軸刻度 / 4 條網格線 / 每點數值標 / 圖例
function renderTrendChart(months) {
    if (months.length === 0) return '';
    const w = 640, h = 260;
    const padL = 60, padR = 16, padT = 24, padB = 36;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;

    const allValues = months.flatMap(m => [m.income, m.expense, m.net]);
    const rawMin = Math.min(0, ...allValues);
    const rawMax = Math.max(1, ...allValues);
    // 把 max 取整到「漂亮數字」(k 位)，讓 Y 軸刻度好讀
    const niceMax = niceCeil(rawMax);
    const niceMin = rawMin < 0 ? -niceCeil(Math.abs(rawMin)) : 0;
    const range = niceMax - niceMin || 1;

    const stepX = innerW / (months.length - 1 || 1);
    const yFor = (v) => padT + innerH - ((v - niceMin) / range) * innerH;
    const xFor = (i) => padL + i * stepX;

    // 4 條等距 Y 軸網格線 + 刻度標籤
    const gridLines = [];
    for (let i = 0; i <= 4; i++) {
        const v = niceMin + (range * i / 4);
        const y = yFor(v);
        gridLines.push(`<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${i === 0 || (niceMin < 0 && v === 0) ? '#cbd5e1' : '#e5e7eb'}" stroke-width="1" ${i > 0 && i < 4 ? 'stroke-dasharray="3,3"' : ''}/>`);
        gridLines.push(`<text x="${padL - 8}" y="${y + 4}" font-size="10" text-anchor="end" fill="#6b7280" font-family="Inter, system-ui, sans-serif">$${formatYAxis(v)}</text>`);
    }

    const line = (key, color, label) => {
        const points = months.map((m, i) => `${xFor(i)},${yFor(m[key])}`).join(' ');
        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    };
    const dots = (key, color) => months.map((m, i) =>
        `<circle cx="${xFor(i)}" cy="${yFor(m[key])}" r="3.5" fill="white" stroke="${color}" stroke-width="2"/>`
    ).join('');
    // 在每個點上方標數字
    const valueLabels = (key, color, dy) => months.map((m, i) => {
        const v = m[key];
        if (v === 0) return '';
        return `<text x="${xFor(i)}" y="${yFor(v) + dy}" font-size="9" text-anchor="middle" fill="${color}" font-family="Inter, system-ui, sans-serif" font-weight="600">$${formatYAxis(v)}</text>`;
    }).join('');

    const xLabels = months.map((m, i) =>
        `<text x="${xFor(i)}" y="${h - 12}" font-size="11" text-anchor="middle" fill="#6b7280" font-family="Inter, system-ui, sans-serif">${m.label}</text>`
    ).join('');

    return `
        <div class="trend-chart-wrap">
            <div class="trend-chart-legend">
                <span class="trend-chart-legend-item"><span class="trend-chart-legend-dot" style="background: #22946e;"></span>收入</span>
                <span class="trend-chart-legend-item"><span class="trend-chart-legend-dot" style="background: #b13535;"></span>支出</span>
                <span class="trend-chart-legend-item"><span class="trend-chart-legend-dot" style="background: #3b82f6;"></span>淨利</span>
            </div>
            <svg class="trend-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
                ${gridLines.join('')}
                ${line('income', '#22946e')}
                ${line('expense', '#b13535')}
                ${line('net', '#3b82f6')}
                ${dots('income', '#22946e')}
                ${dots('expense', '#b13535')}
                ${dots('net', '#3b82f6')}
                ${valueLabels('income', '#22946e', -10)}
                ${valueLabels('expense', '#b13535', 18)}
                ${xLabels}
            </svg>
        </div>
    `;
}

// 取整到「漂亮數字」(eg. 12300 → 15000) 給 Y 軸用
function niceCeil(n) {
    if (n <= 0) return 0;
    const pow = Math.pow(10, Math.floor(Math.log10(n)));
    const r = n / pow;
    if (r <= 1) return pow;
    if (r <= 2) return 2 * pow;
    if (r <= 5) return 5 * pow;
    return 10 * pow;
}

// 格式化 Y 軸數字 (≥1000 用 k，≥1000k 用 M)
function formatYAxis(v) {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
    return `${sign}${abs}`;
}

function renderOverviewTab() {
    const range = reportState.viewRange;
    const k = computeOverviewKPIs(range);
    const byBuilding = computeReceivableByBuilding(range);
    const trend = computeMonthlyTrend(range);
    const days = rangeDayCount(range);
    const collectionPct = (k.collectionRate * 100).toFixed(1);
    const collectionColor = k.collectionRate >= 0.95 ? 'var(--color-success)' : k.collectionRate >= 0.85 ? 'var(--color-warning-text)' : 'var(--color-danger)';

    return `
        <div class="stat-tile-grid">
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-currency-circle-dollar"></i> 應收總額</div>
                <div class="stat-tile-value">$${k.receivableTotal.toLocaleString()}</div>
                <div class="stat-tile-sub">區間 ${days} 天 · ${k.invoiceCount} 筆</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-wallet"></i> 已收金額</div>
                <div class="stat-tile-value">$${k.paidTotal.toLocaleString()}</div>
                <div class="stat-tile-sub">${k.unpaidCount > 0 ? `<strong style="color: var(--color-danger);">${k.unpaidCount}</strong> 筆未繳清` : '全部繳清'}</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-percent"></i> 收款率</div>
                <div class="stat-tile-value" style="color: ${collectionColor};">${collectionPct}%</div>
                <div class="stat-tile-sub">待收 $${k.outstanding.toLocaleString()}</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-trend-up"></i> 淨利</div>
                <div class="stat-tile-value">$${k.net.toLocaleString()}</div>
                <div class="stat-tile-sub">已收 $${k.paidTotal.toLocaleString()} − 已付 $${k.expenseTotal.toLocaleString()}</div>
            </div>
        </div>

        <div class="report-chart-card">
            <div class="report-chart-title">
                <span><i class="ph ph-buildings"></i> 各館應收 vs 已收</span>
                <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500;">深色=已收 · 淺色=待收</span>
            </div>
            ${renderReceivableStackedBars(byBuilding)}
        </div>

        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-chart-line"></i> 月度趨勢 (過去 6 個月)</div>
            ${renderTrendChart(trend)}
        </div>
    `;
}

// ───────────────────── Tab 2: 各館報表 (營運面) ─────────────────────
function statsForBuildingRange(building, range) {
    const beds = mockData.properties.filter(p => p.buildingId === building.id);
    const totalBeds = beds.length;
    const rentedBeds = beds.filter(p => activeContractFor(p.name)).length;
    const vacantBeds = totalBeds - rentedBeds;
    const occRate = totalBeds ? rentedBeds / totalBeds : 0;

    // 空房損失 = 空床數 × 平均床位月租 × 區間月數
    const avgBedRent = beds.length ? beds.reduce((s, b) => s + (Number(b.rent) || 0), 0) / beds.length : 0;
    const months = rangeDayCount(range) / 30;
    const vacancyLoss = vacantBeds * avgBedRent * months;

    // 30 天內到期 (active 合約 且 endDate 在 today ~ today+30)
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const expiringSoon = mockData.contracts.filter(c => {
        if (c.renewalState !== 'active') return false;
        if (!c.endDate) return false;
        if (!beds.some(b => b.name === c.propertyName)) return false;
        return c.endDate >= today && c.endDate <= in30;
    });

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
        building, totalBeds, rentedBeds, vacantBeds, occRate,
        avgBedRent, vacancyLoss, expiringSoon,
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

    // 全館合計 view (營運面)
    if (active === 'all') {
        const allStats = buildings.map(b => statsForBuildingRange(b, range));
        const totals = {
            totalBeds: allStats.reduce((s, x) => s + x.totalBeds, 0),
            rentedBeds: allStats.reduce((s, x) => s + x.rentedBeds, 0),
            vacantBeds: allStats.reduce((s, x) => s + x.vacantBeds, 0),
            vacancyLoss: allStats.reduce((s, x) => s + x.vacancyLoss, 0),
            expiringCount: allStats.reduce((s, x) => s + x.expiringSoon.length, 0)
        };
        const totalOccRate = totals.totalBeds ? totals.rentedBeds / totals.totalBeds : 0;
        const occColor = totalOccRate >= 0.8 ? 'var(--color-success)' : totalOccRate >= 0.5 ? 'var(--color-warning-text)' : 'var(--color-danger)';

        return `
            ${subTabs}
            <div class="stat-tile-grid">
                <div class="stat-tile">
                    <div class="stat-tile-label"><i class="ph ph-house-line"></i> 出租率</div>
                    <div class="stat-tile-value" style="color: ${occColor};">${pct(totalOccRate)}</div>
                    <div class="stat-tile-sub">${totals.rentedBeds} / ${totals.totalBeds} 床位</div>
                </div>
                <div class="stat-tile">
                    <div class="stat-tile-label"><i class="ph ph-bed"></i> 空床數</div>
                    <div class="stat-tile-value">${totals.vacantBeds}</div>
                    <div class="stat-tile-sub">床位待出租</div>
                </div>
                <div class="stat-tile">
                    <div class="stat-tile-label"><i class="ph ph-warning"></i> 空房損失</div>
                    <div class="stat-tile-value" style="color: var(--color-danger);">$${Math.round(totals.vacancyLoss).toLocaleString()}</div>
                    <div class="stat-tile-sub">區間機會成本</div>
                </div>
                <div class="stat-tile">
                    <div class="stat-tile-label"><i class="ph ph-clock-countdown"></i> 30 天內到期</div>
                    <div class="stat-tile-value" style="color: ${totals.expiringCount > 0 ? 'var(--color-warning-text)' : 'var(--text-main)'};">${totals.expiringCount}</div>
                    <div class="stat-tile-sub">需追蹤續約</div>
                </div>
            </div>

            <div class="report-chart-card">
                <div class="report-chart-title">
                    <span><i class="ph ph-ranking"></i> 各館出租率</span>
                    <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500;">點擊館別查看詳細</span>
                </div>
                <div>
                    ${allStats.sort((a, b) => b.occRate - a.occRate).map(s => {
                        const w = s.occRate * 100;
                        const c = s.occRate >= 0.8 ? 'var(--color-success)' : s.occRate >= 0.5 ? 'var(--color-warning-text)' : 'var(--color-danger)';
                        return `
                            <div class="bar-chart-row" style="cursor: pointer;" data-building-sub="${s.building.id}">
                                <span class="bar-chart-label">${s.building.name}</span>
                                <div class="bar-chart-bar-wrap"><div class="bar-chart-bar" style="width: ${w}%; background: ${c};"></div></div>
                                <span class="bar-chart-value">
                                    <strong>${pct(s.occRate)}</strong>
                                    <small style="color: var(--text-muted); font-weight: 500; margin-left: 0.3rem;">${s.rentedBeds}/${s.totalBeds}</small>
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    // 單館 view (營運面)
    const building = buildings.find(b => b.id === active);
    if (!building) {
        reportState.activeBuilding = 'all';
        return renderBuildingsTab();
    }
    const s = statsForBuildingRange(building, range);
    return `${subTabs}${renderSingleBuildingDashboard(s)}`;
}

// 單一館的營運儀表板 (Tab 2)
function renderSingleBuildingDashboard(s) {
    const occColor = s.occRate >= 0.8 ? 'var(--color-success)' : s.occRate >= 0.5 ? 'var(--color-warning-text)' : 'var(--color-danger)';
    // 床位狀態列表
    const beds = mockData.properties.filter(p => p.buildingId === s.building.id)
        .sort((a, b) => (a.roomNumber || 0) - (b.roomNumber || 0) || String(a.bedLetter || '').localeCompare(String(b.bedLetter || '')));
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const bedRows = beds.map(b => {
        const c = activeContractFor(b.name);
        const status = c ? '已出租' : '空床';
        const tenant = c ? c.tenant : '—';
        const endDate = c ? c.endDate : '';
        const expiringSoon = c && c.endDate >= today && c.endDate <= in30;
        return { bed: b, status, tenant, endDate, expiringSoon };
    });

    return `
        <div class="bldg-hero">
            <div class="bldg-hero-info">
                <h2>${s.building.name}</h2>
            </div>
            <button class="btn btn-outline" data-action="export-pdf" data-building-id="${s.building.id}">
                <i class="ph ph-file-pdf"></i> 匯出 PDF
            </button>
        </div>

        <div class="stat-tile-grid">
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-house-line"></i> 出租率</div>
                <div class="stat-tile-value" style="color: ${occColor};">${pct(s.occRate)}</div>
                <div class="stat-tile-sub">${s.rentedBeds} / ${s.totalBeds} 床位</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-bed"></i> 空床數</div>
                <div class="stat-tile-value">${s.vacantBeds}</div>
                <div class="stat-tile-sub">床位待出租</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-warning"></i> 空房損失</div>
                <div class="stat-tile-value" style="color: var(--color-danger);">$${Math.round(s.vacancyLoss).toLocaleString()}</div>
                <div class="stat-tile-sub">區間機會成本</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-clock-countdown"></i> 30 天內到期</div>
                <div class="stat-tile-value" style="color: ${s.expiringSoon.length > 0 ? 'var(--color-warning-text)' : 'var(--text-main)'};">${s.expiringSoon.length}</div>
                <div class="stat-tile-sub">需追蹤續約</div>
            </div>
        </div>

        ${s.expiringSoon.length > 0 ? `
        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-clock-countdown"></i> 即將到期 (30 天內)</div>
            <table class="report-table">
                <thead>
                    <tr>
                        <th>合約</th>
                        <th>床位</th>
                        <th>租客</th>
                        <th>到期日</th>
                        <th style="text-align: right;">剩餘</th>
                    </tr>
                </thead>
                <tbody>
                    ${s.expiringSoon.sort((a, b) => a.endDate.localeCompare(b.endDate)).map(c => {
                        const daysLeft = Math.ceil((new Date(c.endDate) - new Date(today)) / 86400000);
                        return `<tr>
                            <td style="font-family: monospace; font-size: 0.8rem;">${c.id}</td>
                            <td>${(c.propertyName || '').replace('聚空間 - ', '')}</td>
                            <td>${c.tenant || '—'}</td>
                            <td>${c.endDate}</td>
                            <td style="text-align: right; color: ${daysLeft <= 7 ? 'var(--color-danger)' : 'var(--color-warning-text)'}; font-weight: 600;">${daysLeft} 天</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>` : ''}

        <div class="report-chart-card">
            <div class="report-chart-title">
                <span><i class="ph ph-grid-four"></i> 床位狀態 (${beds.length} 床)</span>
                <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500;">已租 ${s.rentedBeds} · 空床 ${s.vacantBeds}</span>
            </div>
            <table class="report-table">
                <thead>
                    <tr>
                        <th>床位</th>
                        <th>狀態</th>
                        <th>租客</th>
                        <th>到期日</th>
                        <th style="text-align: right;">月租</th>
                    </tr>
                </thead>
                <tbody>
                    ${bedRows.map(r => `
                        <tr>
                            <td style="font-weight: 600;">R${r.bed.roomNumber}-${r.bed.bedLetter}</td>
                            <td>
                                <span class="bed-status ${r.status === '已出租' ? 'is-rented' : 'is-vacant'}">${r.status}</span>
                            </td>
                            <td>${r.tenant}</td>
                            <td>${r.endDate || '—'}${r.expiringSoon ? ' <i class="ph ph-warning" style="color: var(--color-warning-text); font-size: 0.85em;" title="30 天內到期"></i>' : ''}</td>
                            <td style="text-align: right; font-variant-numeric: tabular-nums;">$${(r.bed.rent || 0).toLocaleString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ───────────────────── Tab 3: 財務分析 (獲利面) ─────────────────────
function computeAggForInvoices(invoices) {
    const inAll = invoices.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
    const outAll = invoices.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
    const landlordRent = invoices.filter(i => i.direction === 'out' && i.type === '房東租金').reduce((s, i) => s + actualAmount(i), 0);
    const otherExpense = outAll - landlordRent;
    const net = inAll - outAll;
    const grossMargin = inAll > 0 ? (inAll - landlordRent) / inAll : 0;
    const netMargin = inAll > 0 ? net / inAll : 0;
    const landlordRatio = inAll > 0 ? landlordRent / inAll : 0;
    return { inAll, outAll, landlordRent, otherExpense, net, grossMargin, netMargin, landlordRatio };
}

// 支出 Pareto — 排序 + 累積 %
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

function renderParetoChart(items) {
    if (items.length === 0) {
        return `<div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">區間內無支出資料</div>`;
    }
    const maxAmt = items[0].amount;
    return `
        <div class="pareto-list">
            ${items.map((it, idx) => {
                const w = (it.amount / maxAmt) * 100;
                const is8020 = it.cumPct <= 0.8;
                return `
                    <div class="pareto-row">
                        <div class="pareto-rank">${idx + 1}</div>
                        <div class="pareto-body">
                            <div class="pareto-head">
                                <span class="pareto-label">${it.type}</span>
                                <span class="pareto-cum ${is8020 ? 'is-key' : ''}">累積 ${(it.cumPct * 100).toFixed(0)}%</span>
                            </div>
                            <div class="pareto-bar"><div class="pareto-bar-fill" style="width: ${w}%;"></div></div>
                            <div class="pareto-vals">
                                <span class="pareto-amount">$${it.amount.toLocaleString()}</span>
                                <span class="pareto-pct">${(it.pct * 100).toFixed(1)}%</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderAnalysisTab() {
    const active = reportState.activeBuilding || 'all';
    const subTabs = renderBuildingSubTabs();
    if (active !== 'all') {
        return `${subTabs}${renderSingleBuildingAnalysis(active)}`;
    }
    return `${subTabs}${renderAnalysisAllBuildings()}`;
}

// 共用 4 個獲利面 KPI tile
function renderFinancialKpiTiles(agg, extraOther) {
    return `
        <div class="stat-tile-grid">
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-chart-pie-slice"></i> 毛利率</div>
                <div class="stat-tile-value">${agg.inAll > 0 ? pct(agg.grossMargin) : '—'}</div>
                <div class="stat-tile-sub">收入 − 房東租金</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-trend-up"></i> 淨利率</div>
                <div class="stat-tile-value" style="color: ${agg.netMargin >= 0 ? 'var(--text-main)' : 'var(--color-danger)'};">${agg.inAll > 0 ? pct(agg.netMargin) : '—'}</div>
                <div class="stat-tile-sub">淨利 $${agg.net.toLocaleString()}</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-buildings"></i> 房東租金佔比</div>
                <div class="stat-tile-value">${agg.inAll > 0 ? pct(agg.landlordRatio) : '—'}</div>
                <div class="stat-tile-sub">$${agg.landlordRent.toLocaleString()}</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-receipt"></i> 其他支出</div>
                <div class="stat-tile-value">$${agg.otherExpense.toLocaleString()}</div>
                <div class="stat-tile-sub">${extraOther || '水電 / 維修 / 管理'}</div>
            </div>
        </div>
    `;
}

// 單一館的財務分析
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
    const pareto = computeExpensePareto(invoices);

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
            </div>
            <button class="btn btn-outline" id="btn-export-analysis-pdf">
                <i class="ph ph-file-pdf"></i> 匯出 PDF
            </button>
        </div>

        ${renderFinancialKpiTiles(agg)}

        <div class="report-chart-card">
            <div class="report-chart-title">
                <span><i class="ph ph-chart-bar-horizontal"></i> 支出結構 Pareto (前 80% 是哪幾類)</span>
                <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500;">標亮 = 佔前 80%</span>
            </div>
            ${renderParetoChart(pareto)}
        </div>

        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-chart-line"></i> 月度趨勢 (過去 6 個月)</div>
            ${renderTrendChart(months)}
        </div>
    `;
}

function renderAnalysisAllBuildings() {
    const range = reportState.viewRange;
    const rangeInvoices = settledInRange(range);
    const summary = computeAggForInvoices(rangeInvoices);
    const pareto = computeExpensePareto(rangeInvoices);
    const activeBuildings = getSortedBuildings({ activeOnly: true });

    // 各館 P&L 對比
    const perBuilding = activeBuildings.map(b => {
        const inv = rangeInvoices.filter(i => i.buildingId === b.id);
        return { building: b, ...computeAggForInvoices(inv) };
    });

    return `
        ${renderFinancialKpiTiles(summary)}

        <div class="report-chart-card">
            <div class="report-chart-title">
                <span><i class="ph ph-chart-bar-horizontal"></i> 支出結構 Pareto (前 80% 是哪幾類)</span>
                <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500;">標亮 = 佔前 80%</span>
            </div>
            ${renderParetoChart(pareto)}
        </div>

        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-table"></i> 各館 P&amp;L 對比</div>
            <div style="overflow-x: auto;">
                <table class="report-table report-pnl-table">
                    <thead>
                        <tr>
                            <th>館別</th>
                            <th style="text-align: right;">收入</th>
                            <th style="text-align: right;">房東租金</th>
                            <th style="text-align: right;">其他支出</th>
                            <th style="text-align: right;">淨利</th>
                            <th style="text-align: right;">毛利率</th>
                            <th style="text-align: right;">淨利率</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${perBuilding.map(r => `
                            <tr style="cursor: pointer;" data-building-sub="${r.building.id}">
                                <td style="font-weight: 600;">${r.building.name}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums;">$${r.inAll.toLocaleString()}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums; color: var(--text-muted);">$${r.landlordRent.toLocaleString()}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums; color: var(--text-muted);">$${r.otherExpense.toLocaleString()}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; color: ${r.net >= 0 ? 'var(--text-main)' : 'var(--color-danger)'};">$${r.net.toLocaleString()}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums;">${r.inAll > 0 ? pct(r.grossMargin) : '—'}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums; color: ${r.netMargin >= 0 ? 'var(--text-main)' : 'var(--color-danger)'};">${r.inAll > 0 ? pct(r.netMargin) : '—'}</td>
                            </tr>
                        `).join('')}
                        <tr class="pnl-total-row">
                            <td><strong>合計</strong></td>
                            <td style="text-align: right; font-variant-numeric: tabular-nums; font-weight: 700;">$${summary.inAll.toLocaleString()}</td>
                            <td style="text-align: right; font-variant-numeric: tabular-nums; font-weight: 700;">$${summary.landlordRent.toLocaleString()}</td>
                            <td style="text-align: right; font-variant-numeric: tabular-nums; font-weight: 700;">$${summary.otherExpense.toLocaleString()}</td>
                            <td style="text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; color: ${summary.net >= 0 ? 'var(--text-main)' : 'var(--color-danger)'};">$${summary.net.toLocaleString()}</td>
                            <td style="text-align: right; font-variant-numeric: tabular-nums; font-weight: 700;">${summary.inAll > 0 ? pct(summary.grossMargin) : '—'}</td>
                            <td style="text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; color: ${summary.netMargin >= 0 ? 'var(--text-main)' : 'var(--color-danger)'};">${summary.inAll > 0 ? pct(summary.netMargin) : '—'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div style="display: flex; justify-content: flex-end; margin-top: 1rem;">
            <button class="btn btn-outline" id="btn-export-analysis-pdf" style="padding: 0.4rem 0.75rem; font-size: 0.8rem;">
                <i class="ph ph-file-pdf"></i> 匯出 PDF
            </button>
        </div>
    `;
}

// ───────────────────── Hub: tab bar + entry ─────────────────────
const TABS = [
    { key: 'overview',  icon: 'ph-gauge',         label: '總覽' },
    { key: 'buildings', icon: 'ph-buildings',     label: '各館報表' },
    { key: 'analysis',  icon: 'ph-chart-pie',     label: '財務分析' }
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
