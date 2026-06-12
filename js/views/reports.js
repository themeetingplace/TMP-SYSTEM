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

// ───────────────────── Tab 1: 總覽 (老闆視角: NOI / 收款率 / 出租率 / 到期) ─────────────────────
function computeOverviewKPIs(range) {
    const allIncome = mockData.invoices.filter(i => i.direction === 'in' && invoiceInRange(i, range));
    const settledOnly = settledInRange(range);
    const receivableTotal = allIncome.reduce((s, i) => s + ((Number(i.amount) || 0) - (Number(i.discount) || 0)), 0);
    const paidTotal = allIncome.reduce((s, i) => s + (Number(i.paidAmount) || 0), 0);
    const outstanding = Math.max(0, receivableTotal - paidTotal);
    const collectionRate = receivableTotal > 0 ? paidTotal / receivableTotal : 0;
    const expenseTotal = settledOnly.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
    // NOI = 已收 − 已付支出 (Net Operating Income)
    const noi = paidTotal - expenseTotal;

    // 整體出租率 (snapshot)
    const allBeds = mockData.properties || [];
    const rentedBeds = allBeds.filter(p => activeContractFor(p.name)).length;
    const occRate = allBeds.length ? rentedBeds / allBeds.length : 0;

    // 30 天內到期合約數
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const expiringCount = mockData.contracts.filter(c =>
        c.renewalState === 'active' && c.endDate && c.endDate >= today && c.endDate <= in30
    ).length;

    return {
        receivableTotal, paidTotal, outstanding, collectionRate,
        expenseTotal, noi,
        occRate, totalBeds: allBeds.length, rentedBeds,
        expiringCount,
        unpaidCount: allIncome.filter(i => (Number(i.paidAmount) || 0) < ((Number(i.amount) || 0) - (Number(i.discount) || 0))).length
    };
}

// 紅黃綠燈狀態
function statusLight(rate, healthy, warn) {
    if (rate >= healthy) return { color: 'var(--color-success)', light: '🟢', label: '健康' };
    if (rate >= warn) return { color: 'var(--color-warning-text)', light: '🟡', label: '注意' };
    return { color: 'var(--color-danger)', light: '🔴', label: '警示' };
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

// 月度趨勢 — 改成 grouped bar (收入/支出 雙柱，不重疊)，淨利改用 KPI tile 表達
function renderTrendChart(months) {
    if (months.length === 0) return '';
    const w = 640, h = 200;
    const padL = 48, padR = 12, padT = 24, padB = 30;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;

    const allValues = months.flatMap(m => [m.income, m.expense]);
    const maxRaw = Math.max(1, ...allValues);
    const niceMax = niceCeil(maxRaw);

    const slotW = innerW / months.length;
    const barW = Math.min(18, (slotW - 8) / 2);
    const yFor = v => padT + innerH - (v / niceMax) * innerH;
    const xCenter = i => padL + slotW * i + slotW / 2;

    // 4 條 Y 軸網格 + 刻度
    const gridLines = [];
    for (let i = 0; i <= 4; i++) {
        const v = (niceMax * i) / 4;
        const y = yFor(v);
        gridLines.push(`<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${i === 0 ? '#cbd5e1' : '#eef0f3'}" stroke-width="1" ${i > 0 && i < 4 ? 'stroke-dasharray="3,3"' : ''}/>`);
        gridLines.push(`<text x="${padL - 6}" y="${y + 4}" font-size="10" text-anchor="end" fill="#9ca3af" font-family="Inter, system-ui, sans-serif">$${formatYAxis(v)}</text>`);
    }

    const renderBars = (key, color, offsetX) => months.map((m, i) => {
        const v = m[key];
        const x = xCenter(i) + offsetX;
        const y = yFor(v);
        const barH = padT + innerH - y;
        const label = v === 0
            ? ''
            : `<text x="${x + barW/2}" y="${y - 5}" font-size="10" text-anchor="middle" fill="${color}" font-weight="700" font-family="Inter, system-ui, sans-serif">${formatYAxis(v)}</text>`;
        return `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(0.5, barH)}" fill="${color}" rx="2"/>${label}`;
    }).join('');

    const xLabels = months.map((m, i) =>
        `<text x="${xCenter(i)}" y="${h - 10}" font-size="11" text-anchor="middle" fill="#6b7280" font-family="Inter, system-ui, sans-serif">${m.label}</text>`
    ).join('');

    return `
        <div class="trend-chart-wrap">
            <div class="trend-chart-legend">
                <span class="trend-chart-legend-item"><span class="trend-chart-legend-dot" style="background: #22946e;"></span>收入</span>
                <span class="trend-chart-legend-item"><span class="trend-chart-legend-dot" style="background: #b13535;"></span>支出</span>
            </div>
            <svg class="trend-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
                ${gridLines.join('')}
                ${renderBars('income', '#22946e', -barW - 2)}
                ${renderBars('expense', '#b13535', 2)}
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
    const collection = statusLight(k.collectionRate, 0.95, 0.85);
    const occupancy = statusLight(k.occRate, 0.95, 0.80);
    const expiringStatus = k.expiringCount === 0
        ? { color: 'var(--color-success)', light: '🟢' }
        : k.expiringCount <= 3 ? { color: 'var(--color-warning-text)', light: '🟡' }
        : { color: 'var(--color-danger)', light: '🔴' };

    return `
        <div class="stat-tile-grid">
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-trend-up"></i> NOI 淨營運收入</div>
                <div class="stat-tile-value" style="color: ${k.noi >= 0 ? 'var(--text-main)' : 'var(--color-danger)'};">$${k.noi.toLocaleString()}</div>
                <div class="stat-tile-sub">已收 $${k.paidTotal.toLocaleString()} − 已付 $${k.expenseTotal.toLocaleString()}</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-percent"></i> 收款率 <span style="margin-left: auto; font-size: 0.85em;">${collection.light}</span></div>
                <div class="stat-tile-value" style="color: ${collection.color};">${(k.collectionRate * 100).toFixed(1)}%</div>
                <div class="stat-tile-sub">待收 $${k.outstanding.toLocaleString()} · 目標 ≥ 95%</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-house-line"></i> 出租率 <span style="margin-left: auto; font-size: 0.85em;">${occupancy.light}</span></div>
                <div class="stat-tile-value" style="color: ${occupancy.color};">${pct(k.occRate)}</div>
                <div class="stat-tile-sub">${k.rentedBeds} / ${k.totalBeds} 床 · 目標 ≥ 95%</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-clock-countdown"></i> 30 天內到期 <span style="margin-left: auto; font-size: 0.85em;">${expiringStatus.light}</span></div>
                <div class="stat-tile-value" style="color: ${expiringStatus.color};">${k.expiringCount}</div>
                <div class="stat-tile-sub">${k.expiringCount > 0 ? `<a href="#contracts" style="color: var(--color-primary-text); text-decoration: none;">前往合約管理 →</a>` : '無需追蹤'}</div>
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

// ───────────────────── Tab 2: 營運分析 ─────────────────────
// 計算營運面 KPI (出租率 / 平均空置天數 / 續租率 / 入住-退租)
// building = null 表示全館合計
function computeOperationalKPIs(building, range) {
    const beds = building
        ? mockData.properties.filter(p => p.buildingId === building.id)
        : (mockData.properties || []);
    const totalBeds = beds.length;
    const rentedBeds = beds.filter(p => activeContractFor(p.name)).length;
    const vacantBeds = totalBeds - rentedBeds;
    const occRate = totalBeds ? rentedBeds / totalBeds : 0;

    // 平均空置天數 — 從 contracts 推算：對每個床位，找它最近的合約結束日，到下一個合約開始日的差
    // 簡化作法：對所有「目前空的床位」, 算自上一個合約結束 (或 created date) 到今天的天數，取平均
    const todayMs = Date.now();
    const vacantDaysArr = [];
    beds.forEach(p => {
        const active = activeContractFor(p.name);
        if (active) return; // 已出租跳過
        // 找這個床位最近一次的合約 (有 terminatedDate 或 endDate < today)
        const lastContract = mockData.contracts
            .filter(c => c.propertyName === p.name)
            .sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''))[0];
        if (lastContract && lastContract.endDate) {
            const days = Math.floor((todayMs - new Date(lastContract.endDate).getTime()) / 86400000);
            if (days > 0) vacantDaysArr.push(days);
        }
    });
    const avgVacancyDays = vacantDaysArr.length
        ? Math.round(vacantDaysArr.reduce((s, d) => s + d, 0) / vacantDaysArr.length)
        : 0;

    // 續租率 — 過去區間內到期 (endDate 落在 range) 的合約中，renewalState='renewed' 的比例
    const expiredInRange = mockData.contracts.filter(c => {
        if (!c.endDate) return false;
        if (building && !beds.some(b => b.name === c.propertyName)) return false;
        return c.endDate >= range.start && c.endDate <= range.end;
    });
    const renewedCount = expiredInRange.filter(c => c.renewalState === 'renewed').length;
    const renewalRate = expiredInRange.length > 0 ? renewedCount / expiredInRange.length : null;

    // 本期入住 / 退租 (區間內 startDate / terminatedDate)
    const moveInCount = mockData.contracts.filter(c => {
        if (!c.startDate) return false;
        if (building && !beds.some(b => b.name === c.propertyName)) return false;
        return c.startDate >= range.start && c.startDate <= range.end;
    }).length;
    const moveOutCount = mockData.contracts.filter(c => {
        if (c.renewalState !== 'terminated') return false;
        if (!c.terminatedDate) return false;
        if (building && !beds.some(b => b.name === c.propertyName)) return false;
        return c.terminatedDate >= range.start && c.terminatedDate <= range.end;
    }).length;

    // 30 天內到期合約數
    const todayIso = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const expiringSoonCount = mockData.contracts.filter(c => {
        if (c.renewalState !== 'active') return false;
        if (!c.endDate) return false;
        if (building && !beds.some(b => b.name === c.propertyName)) return false;
        return c.endDate >= todayIso && c.endDate <= in30;
    }).length;

    return {
        totalBeds, rentedBeds, vacantBeds, occRate,
        avgVacancyDays,
        renewalRate, renewedCount, expiredInRangeCount: expiredInRange.length,
        moveInCount, moveOutCount,
        expiringSoonCount
    };
}

// 月度入住 vs 退租 — 過去 N 個月每月計數
function computeMoveInOutTrend(building, endDate, monthCount = 6) {
    const beds = building
        ? mockData.properties.filter(p => p.buildingId === building.id)
        : (mockData.properties || []);
    const end = new Date(endDate);
    const months = [];
    for (let i = monthCount - 1; i >= 0; i--) {
        const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const monthKey = `${yyyy}-${mm}`;
        const monthStart = `${monthKey}-01`;
        const lastDay = new Date(yyyy, d.getMonth() + 1, 0).getDate();
        const monthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`;

        const moveIn = mockData.contracts.filter(c => {
            if (!c.startDate) return false;
            if (building && !beds.some(b => b.name === c.propertyName)) return false;
            return c.startDate >= monthStart && c.startDate <= monthEnd;
        }).length;
        const moveOut = mockData.contracts.filter(c => {
            if (c.renewalState !== 'terminated') return false;
            if (!c.terminatedDate) return false;
            if (building && !beds.some(b => b.name === c.propertyName)) return false;
            return c.terminatedDate >= monthStart && c.terminatedDate <= monthEnd;
        }).length;
        months.push({ label: `${d.getMonth() + 1}月`, moveIn, moveOut, net: moveIn - moveOut });
    }
    return months;
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

// 4 個營運 KPI tiles 共用渲染
function renderOperationalKpiTiles(k) {
    const occ = statusLight(k.occRate, 0.95, 0.80);
    const renewalRateColor = k.renewalRate == null
        ? 'var(--text-main)'
        : k.renewalRate >= 0.75 ? 'var(--color-success)'
        : k.renewalRate >= 0.5 ? 'var(--color-warning-text)'
        : 'var(--color-danger)';
    const vacColor = k.avgVacancyDays === 0 ? 'var(--text-main)'
        : k.avgVacancyDays <= 30 ? 'var(--color-success)'
        : k.avgVacancyDays <= 60 ? 'var(--color-warning-text)'
        : 'var(--color-danger)';
    return `
        <div class="stat-tile-grid">
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-house-line"></i> 出租率 <span style="margin-left: auto; font-size: 0.85em;">${occ.light}</span></div>
                <div class="stat-tile-value" style="color: ${occ.color};">${pct(k.occRate)}</div>
                <div class="stat-tile-sub">${k.rentedBeds} / ${k.totalBeds} 床 · 目標 ≥ 95%</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-bed"></i> 平均空置天數</div>
                <div class="stat-tile-value" style="color: ${vacColor};">${k.avgVacancyDays}<small style="font-size: 0.55em; font-weight: 500; margin-left: 0.2rem;">天</small></div>
                <div class="stat-tile-sub">${k.vacantBeds} 床空著 (招租能力指標)</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-arrows-counter-clockwise"></i> 續租率</div>
                <div class="stat-tile-value" style="color: ${renewalRateColor};">${k.renewalRate == null ? '—' : pct(k.renewalRate)}</div>
                <div class="stat-tile-sub">${k.expiredInRangeCount > 0 ? `${k.renewedCount} 續 / ${k.expiredInRangeCount} 到期` : '區間內無到期合約'} · 目標 75-85%</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-user-switch"></i> 本期入住 / 退租</div>
                <div class="stat-tile-value"><span style="color: var(--color-success);">+${k.moveInCount}</span> <span style="color: var(--text-muted); font-weight: 500;">/</span> <span style="color: var(--color-danger);">-${k.moveOutCount}</span></div>
                <div class="stat-tile-sub">淨變動 ${k.moveInCount - k.moveOutCount >= 0 ? '+' : ''}${k.moveInCount - k.moveOutCount} 位</div>
            </div>
        </div>
    `;
}

function renderBuildingsTab() {
    const range = reportState.viewRange;
    const buildings = getSortedBuildings({ activeOnly: true });
    const active = reportState.activeBuilding || 'all';
    const subTabs = renderBuildingSubTabs();

    if (active === 'all') {
        const totals = computeOperationalKPIs(null, range);
        const perBuilding = buildings.map(b => ({ building: b, ...computeOperationalKPIs(b, range) }));
        const moveTrend = computeMoveInOutTrend(null, range.end, 6);
        const maxMoveVal = Math.max(1, ...moveTrend.flatMap(m => [m.moveIn, m.moveOut]));
        const maxVacancyDays = Math.max(1, ...perBuilding.map(p => p.avgVacancyDays));

        return `
            ${subTabs}
            ${renderOperationalKpiTiles(totals)}

            ${totals.expiringSoonCount > 0 ? `
                <div class="connector-card">
                    <div class="connector-card-icon"><i class="ph ph-clock-countdown"></i></div>
                    <div class="connector-card-body">
                        <strong>${totals.expiringSoonCount} 份合約 30 天內到期</strong>
                        <small>需追蹤續約意願</small>
                    </div>
                    <a class="connector-card-link" href="#contracts">前往合約管理 <i class="ph ph-arrow-right"></i></a>
                </div>
            ` : ''}

            <div class="report-chart-grid">
                <div class="report-chart-card">
                    <div class="report-chart-title">
                        <span><i class="ph ph-ranking"></i> 各館出租率</span>
                        <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500;">虛線 = 目標 95%</span>
                    </div>
                    <div>${perBuilding.sort((a, b) => b.occRate - a.occRate).map(p => renderOccBarRow(p)).join('')}</div>
                </div>

                <div class="report-chart-card">
                    <div class="report-chart-title">
                        <span><i class="ph ph-bed"></i> 各館平均空置天數</span>
                        <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500;">越少越好</span>
                    </div>
                    <div>${perBuilding.sort((a, b) => a.avgVacancyDays - b.avgVacancyDays).map(p => {
                        const w = (p.avgVacancyDays / maxVacancyDays) * 100;
                        const c = p.avgVacancyDays === 0 ? 'var(--color-success)' : p.avgVacancyDays <= 30 ? 'var(--color-success)' : p.avgVacancyDays <= 60 ? 'var(--color-warning-text)' : 'var(--color-danger)';
                        return `
                            <div class="bar-chart-row" style="cursor: pointer;" data-building-sub="${p.building.id}">
                                <span class="bar-chart-label">${p.building.name}</span>
                                <div class="bar-chart-bar-wrap"><div class="bar-chart-bar" style="width: ${w}%; background: ${c};"></div></div>
                                <span class="bar-chart-value"><strong>${p.avgVacancyDays}</strong><small style="color: var(--text-muted); margin-left: 0.2rem;">天</small></span>
                            </div>
                        `;
                    }).join('')}</div>
                </div>
            </div>

            <div class="report-chart-card">
                <div class="report-chart-title"><i class="ph ph-user-switch"></i> 月度入住 vs 退租 (過去 6 個月)</div>
                ${renderMoveInOutChart(moveTrend, maxMoveVal)}
            </div>
        `;
    }

    // 單館 view
    const building = buildings.find(b => b.id === active);
    if (!building) {
        reportState.activeBuilding = 'all';
        return renderBuildingsTab();
    }
    const k = computeOperationalKPIs(building, range);
    const moveTrend = computeMoveInOutTrend(building, range.end, 6);
    const maxMoveVal = Math.max(1, ...moveTrend.flatMap(m => [m.moveIn, m.moveOut]));

    return `${subTabs}
        <div class="bldg-hero">
            <div class="bldg-hero-info">
                <h2>${building.name}</h2>
            </div>
            <button class="btn btn-outline" data-action="export-pdf" data-building-id="${building.id}">
                <i class="ph ph-file-pdf"></i> 匯出 PDF
            </button>
        </div>

        ${renderOperationalKpiTiles(k)}

        ${k.expiringSoonCount > 0 ? `
            <div class="connector-card">
                <div class="connector-card-icon"><i class="ph ph-clock-countdown"></i></div>
                <div class="connector-card-body">
                    <strong>${k.expiringSoonCount} 份合約 30 天內到期</strong>
                    <small>${building.name} 需追蹤續約</small>
                </div>
                <a class="connector-card-link" href="#contracts">前往合約管理 <i class="ph ph-arrow-right"></i></a>
            </div>
        ` : ''}

        <div class="connector-card">
            <div class="connector-card-icon"><i class="ph ph-grid-four"></i></div>
            <div class="connector-card-body">
                <strong>查看 ${building.name} 床位狀態</strong>
                <small>各床位租客 / 到期日 / 月租明細</small>
            </div>
            <a class="connector-card-link" href="#occupancy">前往住房一覽 <i class="ph ph-arrow-right"></i></a>
        </div>

        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-user-switch"></i> ${building.name} 月度入住 vs 退租 (過去 6 個月)</div>
            ${renderMoveInOutChart(moveTrend, maxMoveVal)}
        </div>
    `;
}

// 出租率橫條 (含 95% 目標虛線)
function renderOccBarRow(p) {
    const w = p.occRate * 100;
    const c = p.occRate >= 0.95 ? 'var(--color-success)'
        : p.occRate >= 0.80 ? 'var(--color-warning-text)'
        : 'var(--color-danger)';
    return `
        <div class="bar-chart-row" style="cursor: pointer;" data-building-sub="${p.building.id}">
            <span class="bar-chart-label">${p.building.name}</span>
            <div class="bar-chart-bar-wrap" style="position: relative;">
                <div class="bar-chart-bar" style="width: ${w}%; background: ${c};"></div>
                <div class="bar-target-line" style="left: 95%;" title="目標 95%"></div>
            </div>
            <span class="bar-chart-value">
                <strong>${pct(p.occRate)}</strong>
                <small style="color: var(--text-muted); font-weight: 500; margin-left: 0.3rem;">${p.rentedBeds}/${p.totalBeds}</small>
            </span>
        </div>
    `;
}

// 入住 vs 退租 雙線圖
function renderMoveInOutChart(months, maxVal) {
    if (months.length === 0) return '';
    const w = 640, h = 220;
    const padL = 36, padR = 16, padT = 18, padB = 36;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const stepX = innerW / (months.length - 1 || 1);
    const niceMax = niceCeil(maxVal);
    const yFor = v => padT + innerH - (v / niceMax) * innerH;
    const xFor = i => padL + i * stepX;

    const gridLines = [];
    for (let i = 0; i <= 4; i++) {
        const v = (niceMax * i) / 4;
        const y = yFor(v);
        gridLines.push(`<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${i === 0 ? '#cbd5e1' : '#e5e7eb'}" stroke-width="1" ${i > 0 && i < 4 ? 'stroke-dasharray="3,3"' : ''}/>`);
        gridLines.push(`<text x="${padL - 8}" y="${y + 4}" font-size="10" text-anchor="end" fill="#6b7280" font-family="Inter, system-ui, sans-serif">${Math.round(v)}</text>`);
    }
    const line = (key, color) => {
        const points = months.map((m, i) => `${xFor(i)},${yFor(m[key])}`).join(' ');
        const dots = months.map((m, i) => `<circle cx="${xFor(i)}" cy="${yFor(m[key])}" r="3.5" fill="white" stroke="${color}" stroke-width="2"/>`).join('');
        const labels = months.map((m, i) => m[key] === 0 ? '' : `<text x="${xFor(i)}" y="${yFor(m[key]) - 8}" font-size="10" text-anchor="middle" fill="${color}" font-weight="700">${m[key]}</text>`).join('');
        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>${dots}${labels}`;
    };
    const xLabels = months.map((m, i) => `<text x="${xFor(i)}" y="${h - 12}" font-size="11" text-anchor="middle" fill="#6b7280">${m.label}</text>`).join('');

    return `
        <div class="trend-chart-wrap">
            <div class="trend-chart-legend">
                <span class="trend-chart-legend-item"><span class="trend-chart-legend-dot" style="background: #22946e;"></span>入住</span>
                <span class="trend-chart-legend-item"><span class="trend-chart-legend-dot" style="background: #b13535;"></span>退租</span>
            </div>
            <svg class="trend-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
                ${gridLines.join('')}
                ${line('moveIn', '#22946e')}
                ${line('moveOut', '#b13535')}
                ${xLabels}
            </svg>
        </div>
    `;
}

// ───────────────────── Tab 3: 財務分析 (獲利面) ─────────────────────
// 偵測「房東租金」支出 — 房東租金是「租金」這個分類底下，direction='out' 的那種
// 抓所有 direction='out' 且 type 含「租金 / 房租 / 房東」字眼的 invoice，全部加總視為房東租金
function detectLandlordRentInvoices(invoices) {
    return invoices.filter(i =>
        i.direction === 'out' &&
        typeof i.type === 'string' &&
        /租金|房租|房東/.test(i.type)
    );
}

function computeAggForInvoices(invoices) {
    const inAll = invoices.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
    const outAll = invoices.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
    const landlordInvoices = detectLandlordRentInvoices(invoices);
    const landlordRent = landlordInvoices.reduce((s, i) => s + actualAmount(i), 0);
    const detectedTypes = [...new Set(landlordInvoices.map(i => i.type))];
    const otherExpense = outAll - landlordRent;
    const net = inAll - outAll;
    const grossMargin = inAll > 0 ? (inAll - landlordRent) / inAll : 0;
    const netMargin = inAll > 0 ? net / inAll : 0;
    const landlordRatio = inAll > 0 ? landlordRent / inAll : 0;
    const opexRatio = inAll > 0 ? outAll / inAll : 0;
    const allExpenseTypes = [...new Set(invoices.filter(i => i.direction === 'out').map(i => i.type))].filter(Boolean);
    return {
        inAll, outAll, landlordRent, detectedTypes, otherExpense, net,
        grossMargin, netMargin, landlordRatio, opexRatio,
        noi: net,
        allExpenseTypes
    };
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
    const total = items.reduce((s, it) => s + it.amount, 0);
    const firstOver80 = items.findIndex(it => it.cumPct > 0.8);
    const lastIn80 = firstOver80 < 0 ? items.length - 1 : firstOver80 - 1;
    const key80Count = lastIn80 + 1;
    const key80Pct = items[lastIn80]?.cumPct ?? 0;

    // 太細的 tile 會壓縮文字 — 用 min-width + flex-grow 平衡。極小的 (<3%) 用 width: 60px 不要再縮。
    return `
        <div class="pareto-summary-mini">
            前 <strong>${key80Count}</strong> 類 = 支出的 <strong>${(key80Pct * 100).toFixed(0)}%</strong>
        </div>
        <div class="pareto-tiles">
            ${items.map((it, idx) => {
                const isKey = idx <= lastIn80;
                const ratio = it.amount / total;
                const flexGrow = Math.max(1, ratio * 100);
                return `
                    <div class="pareto-tile ${isKey ? 'is-key' : ''}" style="flex-grow: ${flexGrow.toFixed(2)};">
                        <div class="pareto-tile-pct">${(it.pct * 100).toFixed(0)}%</div>
                        <div class="pareto-tile-label">${it.type}</div>
                        <div class="pareto-tile-amount">$${it.amount.toLocaleString()}</div>
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

// 共用 4 個財務面 KPI tile
function renderFinancialKpiTiles(agg) {
    const grossMarginColor = agg.grossMargin >= 0.30 ? 'var(--color-success)'
        : agg.grossMargin >= 0.15 ? 'var(--color-warning-text)'
        : agg.grossMargin > 0 ? 'var(--color-danger)' : 'var(--text-main)';
    const opexColor = agg.opexRatio <= 0.80 ? 'var(--color-success)'
        : agg.opexRatio <= 0.95 ? 'var(--color-warning-text)'
        : 'var(--color-danger)';
    const landlordRatioColor = agg.landlordRatio >= 0.60 && agg.landlordRatio <= 0.80 ? 'var(--text-main)'
        : agg.landlordRatio > 0 ? 'var(--color-warning-text)' : 'var(--text-main)';
    return `
        <div class="stat-tile-grid">
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-trend-up"></i> NOI 淨營運收入</div>
                <div class="stat-tile-value" style="color: ${agg.noi >= 0 ? 'var(--text-main)' : 'var(--color-danger)'};">$${agg.noi.toLocaleString()}</div>
                <div class="stat-tile-sub">收 $${agg.inAll.toLocaleString()} − 付 $${agg.outAll.toLocaleString()}</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-chart-pie-slice"></i> 毛利率</div>
                <div class="stat-tile-value" style="color: ${grossMarginColor};">${agg.inAll > 0 ? pct(agg.grossMargin) : '—'}</div>
                <div class="stat-tile-sub">(收 − 房東租金) ÷ 收 · 業界 20-40%</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-receipt"></i> OpEx 營業費用率</div>
                <div class="stat-tile-value" style="color: ${opexColor};">${agg.inAll > 0 ? pct(agg.opexRatio) : '—'}</div>
                <div class="stat-tile-sub">已付 ÷ 已收 · 目標 ≤ 80%</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-buildings"></i> 房東租金佔比</div>
                <div class="stat-tile-value" style="color: ${landlordRatioColor};">${agg.inAll > 0 ? pct(agg.landlordRatio) : '—'}</div>
                <div class="stat-tile-sub">$${agg.landlordRent.toLocaleString()} · 業界 60-80%</div>
            </div>
        </div>
    `;
}

// 房東租金 偵測結果說明
function renderLandlordWarning(agg) {
    if (agg.outAll === 0) return '';

    // 有抓到 → 一行 info 條（極簡，不囉嗦）
    if (agg.landlordRent > 0) {
        return `
            <div class="report-info-card">
                <i class="ph ph-info report-info-icon-inline"></i>
                <span>房東租金 <strong>$${agg.landlordRent.toLocaleString()}</strong> · type: ${agg.detectedTypes.map(t => `<span class="report-info-type">${t}</span>`).join('')}</span>
            </div>
        `;
    }

    // 真的沒抓到 → 警告
    const types = agg.allExpenseTypes;
    if (types.length === 0) return '';
    return `
        <div class="report-warning-card">
            <div class="report-warning-icon"><i class="ph ph-warning-circle"></i></div>
            <div class="report-warning-body">
                <strong>未偵測到房東租金支出</strong>
                <small>毛利率會算成 100%。當期支出 type：</small>
                <div class="report-warning-types">
                    ${types.map(t => `<span class="report-warning-type">${t}</span>`).join('')}
                </div>
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
        ${renderLandlordWarning(agg)}

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
        ${renderLandlordWarning(summary)}

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
