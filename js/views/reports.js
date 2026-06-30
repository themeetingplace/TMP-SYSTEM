// 報表 hub — 頂部區間 picker + 4 tab：總覽 / 各館報表 / 交叉分析 / 對帳單
//
// 區間狀態:  reportState.viewRange = { start, end, preset }
// 切換 tab:  reportState.activeTab = 'overview' | 'buildings' | 'analysis' | 'statement'
// 跟舊版差異：所有計算都改用「區間」聚合，不再寫死月份；分析 / 各館報表都依區間切片

import {
    mockData, store,
    getSortedBuildings,
    activeContractFor,
    bedOccupied,
    isSettled, isPreCutoff, FINANCE_CUTOFF_DATE,
    invoiceActualAmount as actualAmount
} from '../data.js';
import { escapeHtml as esc } from '../utils/escape.js';
import { refreshView } from '../utils/ui.js';
import { renderRangePicker, initRangePicker } from '../utils/dateRangePicker.js';
import { reportState, invoiceInRange, getRangeLabel } from './report-state.js';
import { exportLandlordReport } from './report-export.js';
import { exportAnalysisReport } from './analysis-export.js';
import { modeFilteredData } from '../utils/modeFilter.js';
import { getMode } from '../utils/appMode.js';
import { GROUP_CUM_BASELINES } from '../constants.js';
import { moneyAmount } from '../utils/moneyDisplay.js';
import { emptyState } from '../utils/emptyState.js';

// 模組層快取 — 每次 renderReports 開頭 reset，內部 helper 都讀這個避免 14 處 mockData 散落各處
let _modeData = null;
function _md() {
    if (!_modeData) _modeData = modeFilteredData();
    return _modeData;
}
function _resetModeCache() { _modeData = null; }
function _modeBuildings() {
    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    // ⚠ 不能用 _modeBuildings() 否則無限遞迴 (歷史 replace_all 誤傷)
    return getSortedBuildings({ activeOnly: true })
        .filter(b => (b.mode || 'cohousing') === targetMode);
}
// 注意: reports.js 不從 chartTheme 讀色 — 全部 hex literal，跟 dashboard.js 一致避開 Chart.js v4.5 動畫 bug

// ───────────────────── 共用 helpers ─────────────────────
const pct = v => `${(v * 100).toFixed(1)}%`;

function settledInRange(range = reportState.viewRange) {
    // 起算自 FINANCE_CUTOFF_DATE, pre-cutoff invoices 不算進報表統計 (保留在 DB 但隱藏)
    return _md().invoices.filter(i => !isPreCutoff(i) && isSettled(i) && invoiceInRange(i, range));
}

function rangeDayCount(range = reportState.viewRange) {
    const s = new Date(range.start);
    const e = new Date(range.end);
    return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

// 月度趨勢圖要顯示幾個月 — 按區間動態：
//   區間 = 1 個月 → 顯示 6 個月 (避免單欄圖太空，給歷史對照)
//   區間 2~12 個月 → 顯示「區間實際月數」(本季 = 3 / 本年 = 6 YTD / 上年 = 12...)
//   區間 > 12 個月 → cap 在 12 個月
function rangeMonthCount(range = reportState.viewRange) {
    const s = new Date(range.start);
    const e = new Date(range.end);
    const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
    if (months <= 1) return 6;        // 單月區間 → 給 6 個月歷史對照
    return Math.min(12, months);      // 多月區間 → 跟區間一致 (上限 12)
}

// ───────────────────── Tab 1: 總覽 (老闆視角: NOI / 收款率 / 出租率 / 到期) ─────────────────────
function computeOverviewKPIs(range) {
    const allIncome = _md().invoices.filter(i => i.direction === 'in' && invoiceInRange(i, range));
    const settledOnly = settledInRange(range);
    const receivableTotal = allIncome.reduce((s, i) => s + ((Number(i.amount) || 0) - (Number(i.discount) || 0)), 0);
    const paidTotal = allIncome.reduce((s, i) => s + (Number(i.paidAmount) || 0), 0);
    const outstanding = Math.max(0, receivableTotal - paidTotal);
    const collectionRate = receivableTotal > 0 ? paidTotal / receivableTotal : 0;
    const expenseTotal = settledOnly.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
    // NOI = 已收 − 已付支出 (Net Operating Income)
    const noi = paidTotal - expenseTotal;

    // 整體出租率 (snapshot)
    const allBeds = _md().properties || [];
    const rentedBeds = allBeds.filter(p => bedOccupied(p.name)).length;
    const occRate = allBeds.length ? rentedBeds / allBeds.length : 0;

    // 30 天內到期合約數
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const expiringCount = _md().contracts.filter(c =>
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
    const buildings = _modeBuildings();
    const allIncome = _md().invoices.filter(i => i.direction === 'in' && invoiceInRange(i, range));
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

// 月度趨勢 — monthCount 由區間動態決定 (6 / 6~12 / 12)
function computeMonthlyTrend(range, buildingId = null) {
    const end = new Date(range.end);
    const monthCount = rangeMonthCount(range);
    const months = [];
    for (let i = monthCount - 1; i >= 0; i--) {
        const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const monthKey = `${yyyy}-${mm}`;
        const monthStart = `${monthKey}-01`;
        const lastDay = new Date(yyyy, d.getMonth() + 1, 0).getDate();
        const monthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
        const monthRange = { start: monthStart, end: monthEnd, preset: 'custom' };
        let monthInvoices = settledInRange(monthRange);
        if (buildingId) monthInvoices = monthInvoices.filter(i => i.buildingId === buildingId);
        const income = monthInvoices.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
        const expense = monthInvoices.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
        // 月份 label：跨年時加西元
        const labelTxt = i >= monthCount - 1 || d.getMonth() === 0
            ? `${yyyy}/${d.getMonth() + 1}月`
            : `${d.getMonth() + 1}月`;
        months.push({ label: labelTxt, monthKey, income, expense, net: income - expense });
    }
    return months;
}

// 各館 應收 vs 已收 stacked bar (取代 donut — 顯示現金流缺口)
function renderReceivableStackedBars(items) {
    if (items.length === 0 || items.every(it => it.receivable === 0)) {
        return emptyState({ mode: 'block', icon: 'ph-coin', title: '區間內無應收資料', hint: '調整上方區間試試' });
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
                            <span class="sb-val-paid">已收 ${moneyAmount(it.paid)}</span>
                            ${it.outstanding > 0 ? `<span class="sb-val-out">待收 ${moneyAmount(it.outstanding)}</span>` : ''}
                            <span class="sb-val-total">/ 應收 ${moneyAmount(it.receivable)}</span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ───────────────────── Chart.js 工廠 (取代手寫 SVG，跟 dashboard 同套渲染) ─────────────────────
// 每個 render 函數產出 `<canvas id="${id}">`，並把 Chart.js config 推到 _pendingCharts；
// view render 完 → initReportsActions(scope) → initReportsCharts(scope) 一次性 init 所有 canvas。
// 切 tab / 切館 → refreshView() → 整個 view 重新 render，舊 Chart instance 在 destroyAllCharts() 被清掉。
let _chartCounter = 0;
const _pendingCharts = [];
const _chartInstances = new Map();

function destroyAllCharts() {
    _chartInstances.forEach(c => { try { c.destroy(); } catch {} });
    _chartInstances.clear();
}

export function initReportsCharts(scope) {
    destroyAllCharts();
    // ⚠ 同步 init 時 browser layout 還沒做 → canvas parent width=0 → Chart.js 渲染 0x0 失敗
    //    用 requestAnimationFrame 延後 1 frame, 讓 .pie-chart-canvas-wrap / .trend-chart-wrap 量到實際尺寸再 init
    //    (使用者實測: 報表頁圓餅圖+折線圖很常空白 — 就是這個 race)
    const initOne = (spec) => {
        const canvas = scope.querySelector(`#${spec.canvasId}`);
        if (!canvas || typeof Chart === 'undefined') return;
        // double check 父層真的有寬度才 init, 沒有就再 defer 一次 (插在 hidden tab 內或 layout 還沒收斂)
        const parent = canvas.parentElement;
        if (parent && parent.offsetWidth === 0) {
            requestAnimationFrame(() => initOne(spec));
            return;
        }
        try {
            const inst = new Chart(canvas, spec.config);
            _chartInstances.set(spec.canvasId, inst);
        } catch (e) {
            console.warn('[reports] chart init failed', spec.canvasId, e);
        }
    };
    const queue = _pendingCharts.splice(0);
    requestAnimationFrame(() => queue.forEach(initOne));
}

// 月度趨勢 — 收支雙線 (smooth + fill)
// config 1:1 跟 dashboard.js (line 376-465) 對齊，避開 Chart.js v4.5 內部炸鍋
// 寫死 hex 跟 dashboard 一樣，不從 CSS var 讀 (--chart-* 留給 categorical 用)
function renderTrendChart(months) {
    if (months.length === 0) return '';
    const id = `report-chart-${++_chartCounter}`;
    _pendingCharts.push({
        canvasId: id,
        config: {
            type: 'line',
            data: {
                labels: months.map(m => m.label),
                datasets: [
                    {
                        label: '收入',
                        data: months.map(m => m.income),
                        borderColor: '#22946e',
                        backgroundColor: 'rgba(34, 148, 110, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: '支出',
                        data: months.map(m => m.expense),
                        borderColor: '#b13535',
                        backgroundColor: 'rgba(177, 53, 53, 0.08)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 14, padding: 16 } },
                    tooltip: {
                        callbacks: {
                            label: (item) => `${item.dataset.label}：$${item.parsed.y.toLocaleString()}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0, 0, 0, 0.05)' },
                        ticks: { callback: (v) => '$' + v.toLocaleString() }
                    },
                    x: { grid: { display: false } }
                }
            }
        }
    });
    return `<div class="trend-chart-wrap"><canvas id="${id}"></canvas></div>`;
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
                <div class="stat-tile-value" style="color: ${k.noi >= 0 ? 'var(--text-main)' : 'var(--color-danger)'};">${moneyAmount(k.noi)}</div>
                <div class="stat-tile-sub">已收 ${moneyAmount(k.paidTotal)} − 已付 ${moneyAmount(k.expenseTotal)}</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-percent"></i> 收款率 <span style="margin-left: auto; font-size: 0.85em;">${collection.light}</span></div>
                <div class="stat-tile-value" style="color: ${collection.color};">${(k.collectionRate * 100).toFixed(1)}%</div>
                <div class="stat-tile-sub">待收 ${moneyAmount(k.outstanding)} · 目標 ≥ 95%</div>
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
                <span style="font-size: var(--text-2xs); color: var(--text-muted); font-weight: 500;">深色=已收 · 淺色=待收</span>
            </div>
            ${renderReceivableStackedBars(byBuilding)}
        </div>

        <div class="report-chart-card">
            <div class="report-chart-title"><span><i class="ph ph-chart-line"></i> 月度趨勢 · 近 ${trend.length} 個月</span></div>
            ${renderTrendChart(trend)}
        </div>
    `;
}

// ───────────────────── Tab 2: 營運分析 ─────────────────────
// 計算營運面 KPI (出租率 / 平均空置天數 / 續租率 / 入住-退租)
// building = null 表示全館合計
function computeOperationalKPIs(building, range) {
    const beds = building
        ? _md().properties.filter(p => p.buildingId === building.id)
        : (_md().properties || []);
    const totalBeds = beds.length;
    const rentedBeds = beds.filter(p => bedOccupied(p.name)).length;
    const vacantBeds = totalBeds - rentedBeds;
    const occRate = totalBeds ? rentedBeds / totalBeds : 0;

    // 平均空置天數 — 從 contracts 推算：對每個床位，找它最近的合約結束日，到下一個合約開始日的差
    // 簡化作法：對所有「目前空的床位」, 算自上一個合約結束 (或 created date) 到今天的天數，取平均
    const todayMs = Date.now();
    const vacantDaysArr = [];
    beds.forEach(p => {
        if (bedOccupied(p.name)) return; // 已出租跳過 (對齊住房一覽)
        // 找這個床位最近一次的合約 (有 terminatedDate 或 endDate < today)
        const lastContract = _md().contracts
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
    const expiredInRange = _md().contracts.filter(c => {
        if (!c.endDate) return false;
        if (building && !beds.some(b => b.name === c.propertyName)) return false;
        return c.endDate >= range.start && c.endDate <= range.end;
    });
    const renewedCount = expiredInRange.filter(c => c.renewalState === 'renewed').length;
    const renewalRate = expiredInRange.length > 0 ? renewedCount / expiredInRange.length : null;

    // 本期入住 / 退租 (區間內 startDate / terminatedDate)
    const moveInCount = _md().contracts.filter(c => {
        if (!c.startDate) return false;
        if (building && !beds.some(b => b.name === c.propertyName)) return false;
        return c.startDate >= range.start && c.startDate <= range.end;
    }).length;
    const moveOutCount = _md().contracts.filter(c => {
        if (c.renewalState !== 'terminated') return false;
        if (!c.terminatedDate) return false;
        if (building && !beds.some(b => b.name === c.propertyName)) return false;
        return c.terminatedDate >= range.start && c.terminatedDate <= range.end;
    }).length;

    // 30 天內到期合約數
    const todayIso = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const expiringSoonCount = _md().contracts.filter(c => {
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
        ? _md().properties.filter(p => p.buildingId === building.id)
        : (_md().properties || []);
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

        const moveIn = _md().contracts.filter(c => {
            if (!c.startDate) return false;
            if (building && !beds.some(b => b.name === c.propertyName)) return false;
            return c.startDate >= monthStart && c.startDate <= monthEnd;
        }).length;
        const moveOut = _md().contracts.filter(c => {
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
    const buildings = _modeBuildings();
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
    const buildings = _modeBuildings();
    const active = reportState.activeBuilding || 'all';
    const subTabs = renderBuildingSubTabs();

    if (active === 'all') {
        const totals = computeOperationalKPIs(null, range);
        const perBuilding = buildings.map(b => ({ building: b, ...computeOperationalKPIs(b, range) }));
        const moveCount = rangeMonthCount(range);
        const moveTrend = computeMoveInOutTrend(null, range.end, moveCount);
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
                        <span style="font-size: var(--text-2xs); color: var(--text-muted); font-weight: 500;">虛線 = 目標 95%</span>
                    </div>
                    <div>${perBuilding.sort((a, b) => b.occRate - a.occRate).map(p => renderOccBarRow(p)).join('')}</div>
                </div>

                <div class="report-chart-card">
                    <div class="report-chart-title">
                        <span><i class="ph ph-bed"></i> 各館平均空置天數</span>
                        <span style="font-size: var(--text-2xs); color: var(--text-muted); font-weight: 500;">越少越好</span>
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
                <div class="report-chart-title"><i class="ph ph-user-switch"></i> 月度入住 vs 退租 · 近 ${moveCount} 個月</div>
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
    const moveMonthCount = rangeMonthCount(range);
    const moveTrend = computeMoveInOutTrend(building, range.end, moveMonthCount);
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
            <div class="report-chart-title"><i class="ph ph-user-switch"></i> ${building.name} 月度入住 vs 退租 · 近 ${moveMonthCount} 個月</div>
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

// 入住 vs 退租 雙線圖 — config 1:1 跟 dashboard 對齊
function renderMoveInOutChart(months /* , maxVal */) {
    if (months.length === 0) return '';
    const id = `report-chart-${++_chartCounter}`;
    _pendingCharts.push({
        canvasId: id,
        config: {
            type: 'line',
            data: {
                labels: months.map(m => m.label),
                datasets: [
                    {
                        label: '入住',
                        data: months.map(m => m.moveIn),
                        borderColor: '#22946e',
                        backgroundColor: 'rgba(34, 148, 110, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: '退租',
                        data: months.map(m => m.moveOut),
                        borderColor: '#b13535',
                        backgroundColor: 'rgba(177, 53, 53, 0.08)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 14, padding: 16 } },
                    tooltip: { callbacks: { label: (i) => `${i.dataset.label}：${i.parsed.y} 位` } }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0, 0, 0, 0.05)' },
                        ticks: { precision: 0 }
                    },
                    x: { grid: { display: false } }
                }
            }
        }
    });
    return `<div class="trend-chart-wrap"><canvas id="${id}"></canvas></div>`;
}

// ───────────────────── Tab 3: 財務分析 (獲利面) ─────────────────────
// 偵測房東租金支出 — 嚴格只看 type === '房東租金' (精準字串比對, 不用 regex 模糊)
// (audit: 原本 /租金|房租|房東/ 模糊配對會把住客「房租」誤抓到 — 收支邊界破洞)
// 用戶強約定: 房租=in / 房東租金=out, 絕對不混用 (見 utils/terminology.js)
function detectLandlordRentInvoices(invoices) {
    return invoices.filter(i => i.direction === 'out' && i.type === '房東租金');
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

// 支出結構 — doughnut，config 1:1 跟 dashboard emptyBedsChart 對齊
// 色票直接寫陣列 literal (不繞 getChartColors)
const PIE_PALETTE = ['#ff8859', '#3f7c8a', '#d4a574', '#7a9a6a', '#b67d7d', '#9c8aaa', '#c4a486', '#7a7c80'];

function renderExpensePie(items) {
    if (items.length === 0 || items.every(it => it.amount === 0)) {
        return emptyState({ mode: 'block', icon: 'ph-coin', title: '區間內無支出資料', hint: '調整上方區間試試' });
    }
    const id = `report-chart-${++_chartCounter}`;
    const colors = items.map((_, i) => PIE_PALETTE[i % PIE_PALETTE.length]);
    _pendingCharts.push({
        canvasId: id,
        config: {
            type: 'doughnut',
            data: {
                labels: items.map(it => it.type),
                datasets: [{
                    data: items.map(it => it.amount),
                    backgroundColor: colors,
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '55%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (item) => {
                                const total = items.reduce((s, x) => s + x.amount, 0);
                                const pct = total > 0 ? ((item.parsed / total) * 100).toFixed(1) : '0';
                                return `${item.label}：$${item.parsed.toLocaleString()} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        }
    });

    const legend = items.map((it, idx) => `
        <div class="pie-legend-item">
            <span class="pie-legend-dot" style="background: ${colors[idx]};"></span>
            <div class="pie-legend-body">
                <span class="pie-legend-label">${it.type}</span>
                <span class="pie-legend-meta">${(it.pct * 100).toFixed(0)}% · ${moneyAmount(it.amount)}</span>
            </div>
        </div>
    `).join('');

    return `
        <div class="pie-chart-wrap">
            <div class="pie-chart-canvas-wrap"><canvas id="${id}"></canvas></div>
            <div class="pie-chart-legend">${legend}</div>
        </div>
    `;
}

function renderAnalysisTab() {
    // 代管 mode 走專屬內容 (屋主結算 / 代管費 / 押金)；共居走原本 P&L
    if (getMode() === 'managed') return renderManagedAnalysis();
    const active = reportState.activeBuilding || 'all';
    const subTabs = renderBuildingSubTabs();
    if (active !== 'all') {
        return `${subTabs}${renderSingleBuildingAnalysis(active)}`;
    }
    return `${subTabs}${renderAnalysisAllBuildings()}`;
}

// === 代管財務分析 ===
// 代管房租不是我們的收入，主軸:
//   1. KPI: 本期屋主應收總額 / 代管費收入 (我們抽成) / 持有押金總額 / 房屋數
//   2. 各屋主結算 (per owner)
//   3. 各代管房屋本期結算明細
function renderManagedAnalysis() {
    const range = reportState.viewRange;
    const md = _md();
    const buildings = md.properties.length
        ? mockData.buildings.filter(b => b.mode === 'managed' && b.status === 'active')
        : [];
    const settlements = (mockData.settlements || []).filter(s => {
        const m = s.month || '';
        const r = range;
        return m >= (r.start || '').slice(0, 7) && m <= (r.end || '').slice(0, 7);
    });

    // KPI 算
    let ownerReceivableTotal = 0;
    let mgmtFeeTotal = 0;
    settlements.forEach(s => {
        ownerReceivableTotal += s.ownerReceivable || 0;
        // 代管費 = items 內 kind === 'mgmt_fee' 或 key === 'mgmtFee'
        (s.items || []).forEach(it => {
            if (it.type === 'mgmt_fee' || it.key === 'mgmtFee') {
                mgmtFeeTotal += Math.abs(it.amount || 0);
            }
        });
    });
    const holdingDepositTotal = buildings.reduce((sum, b) =>
        sum + (store.ownerHoldingDepositTotal?.(b.id) ?? 0), 0
    );
    const houseCount = buildings.length;

    // 各屋主匯總
    const ownerMap = new Map();
    settlements.forEach(s => {
        if (!s.ownerId) return;
        if (!ownerMap.has(s.ownerId)) ownerMap.set(s.ownerId, { receivable: 0, mgmtFee: 0, count: 0 });
        const o = ownerMap.get(s.ownerId);
        o.receivable += s.ownerReceivable || 0;
        o.count += 1;
        (s.items || []).forEach(it => {
            if (it.type === 'mgmt_fee' || it.key === 'mgmtFee') {
                o.mgmtFee += Math.abs(it.amount || 0);
            }
        });
    });

    const ownerRows = [...ownerMap.entries()].map(([ownerId, agg]) => {
        const owner = mockData.owners?.find(o => o.id === ownerId);
        return { owner, ...agg };
    }).filter(r => r.owner)
      .sort((a, b) => b.receivable - a.receivable);

    return `
        <div class="stat-tile-grid">
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-hand-coins"></i> 屋主應收總額</div>
                <div class="stat-tile-value">${moneyAmount(ownerReceivableTotal)}</div>
                <div class="stat-tile-sub">本期 ${settlements.length} 張月結算</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-coin"></i> 代管費收入 (我們)</div>
                <div class="stat-tile-value" style="color: var(--color-primary-text);">${moneyAmount(mgmtFeeTotal)}</div>
                <div class="stat-tile-sub">我們的抽成 / 服務費</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-vault"></i> 屋主持有押金</div>
                <div class="stat-tile-value">${moneyAmount(holdingDepositTotal)}</div>
                <div class="stat-tile-sub">已移交給屋主保管的押金總額</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-buildings"></i> 代管房屋</div>
                <div class="stat-tile-value">${houseCount}</div>
                <div class="stat-tile-sub">啟用中的代管房屋數</div>
            </div>
        </div>

        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-user-circle"></i> 各屋主結算 (本期)</div>
            ${ownerRows.length === 0
                ? emptyState({ mode: 'block', icon: 'ph-user-circle', title: '本期尚無屋主結算紀錄', hint: '至各代管房屋的「費用計算」tab 產生' })
                : `<table class="data-table is-compact">
                    <thead><tr><th>屋主</th><th style="text-align: right; width: 100px;">結算次數</th><th style="text-align: right; width: 160px;">屋主應收</th><th style="text-align: right; width: 160px;">代管費</th></tr></thead>
                    <tbody>
                        ${ownerRows.map(r => `
                            <tr>
                                <td><strong>${esc(r.owner.name)}</strong></td>
                                <td style="text-align: right;">${r.count}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums; font-weight: 600;">${moneyAmount(r.receivable)}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums; color: var(--color-primary-text);">${moneyAmount(r.mgmtFee)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>`
            }
        </div>

        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-receipt"></i> 本期月結算清單</div>
            ${settlements.length === 0
                ? emptyState({ mode: 'block', icon: 'ph-receipt', title: '本期尚無月結算紀錄', hint: '至各代管房屋的「費用計算」tab 產生' })
                : `<table class="data-table is-compact">
                    <thead><tr><th>結算月</th><th>房屋</th><th>屋主</th><th style="text-align: right;">屋主應收</th><th style="text-align: right;">本月新收押</th><th style="text-align: right;">移交押金</th><th>狀態</th></tr></thead>
                    <tbody>
                        ${settlements.slice().sort((a, b) => (b.month || '').localeCompare(a.month || '')).map(s => {
                            const b = mockData.buildings.find(x => x.id === s.buildingId);
                            const o = mockData.owners?.find(x => x.id === s.ownerId);
                            return `<tr>
                                <td><strong>${esc(s.month)}</strong></td>
                                <td>${esc(b?.name || '—')}</td>
                                <td>${esc(o?.name || '—')}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums; font-weight: 600;">${moneyAmount(s.ownerReceivable || 0)}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums;">${moneyAmount(s.depositCollectedThisMonth || 0)}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums;">${moneyAmount(s.depositTransferredThisMonth || 0)}</td>
                                <td><span class="status-badge ${s.status === 'settled' ? 'success' : s.status === 'sent' ? 'info' : 'muted'}">${s.status || 'draft'}</span></td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>`
            }
        </div>
    `;
}

// 共用 4 個財務面 KPI tile — NOI / 毛利率 / 淨利率 / OpEx
function renderFinancialKpiTiles(agg) {
    const grossMarginColor = agg.grossMargin >= 0.30 ? 'var(--color-success)'
        : agg.grossMargin >= 0.15 ? 'var(--color-warning-text)'
        : agg.grossMargin > 0 ? 'var(--color-danger)' : 'var(--text-main)';
    const netMarginColor = agg.netMargin >= 0.15 ? 'var(--color-success)'
        : agg.netMargin >= 0.05 ? 'var(--color-warning-text)'
        : agg.netMargin > 0 ? 'var(--color-danger)' : 'var(--text-main)';
    const opexColor = agg.opexRatio <= 0.80 ? 'var(--color-success)'
        : agg.opexRatio <= 0.95 ? 'var(--color-warning-text)'
        : 'var(--color-danger)';
    return `
        <div class="stat-tile-grid">
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-trend-up"></i> NOI 淨營運收入</div>
                <div class="stat-tile-value" style="color: ${agg.noi >= 0 ? 'var(--text-main)' : 'var(--color-danger)'};">${moneyAmount(agg.noi)}</div>
                <div class="stat-tile-sub">收 ${moneyAmount(agg.inAll)} − 付 ${moneyAmount(agg.outAll)}</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-chart-pie-slice"></i> 毛利率</div>
                <div class="stat-tile-value" style="color: ${grossMarginColor};">${agg.inAll > 0 ? pct(agg.grossMargin) : '—'}</div>
                <div class="stat-tile-sub">(收 − 租金) ÷ 收 · 業界 20-40%</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-percent"></i> 淨利率</div>
                <div class="stat-tile-value" style="color: ${netMarginColor};">${agg.inAll > 0 ? pct(agg.netMargin) : '—'}</div>
                <div class="stat-tile-sub">淨利 ÷ 收 · 目標 ≥ 15%</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-label"><i class="ph ph-receipt"></i> OpEx 營業費用率</div>
                <div class="stat-tile-value" style="color: ${opexColor};">${agg.inAll > 0 ? pct(agg.opexRatio) : '—'}</div>
                <div class="stat-tile-sub">已付 ÷ 已收 · 目標 ≤ 80%</div>
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
                <span>租金 <strong>${moneyAmount(agg.landlordRent)}</strong> · type: ${agg.detectedTypes.map(t => `<span class="report-info-type">${t}</span>`).join('')}</span>
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
                <strong>未偵測到租金支出</strong>
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
    const buildings = _modeBuildings();
    const building = buildings.find(b => b.id === buildingId);
    if (!building) {
        reportState.activeBuilding = 'all';
        return renderAnalysisAllBuildings();
    }
    const invoices = settledInRange(range).filter(i => i.buildingId === buildingId);
    const agg = computeAggForInvoices(invoices);
    const pareto = computeExpensePareto(invoices);
    const months = computeMonthlyTrend(range, buildingId);
    const monthCount = months.length;

    const buckets = bucketExpensesOf(invoices);

    return `
        <div class="bldg-hero">
            <div class="bldg-hero-info">
                <h2>${building.name}</h2>
            </div>
            <button class="btn btn-outline" data-action="export-analysis-pdf" data-building-id="${building.id}" title="只匯出 ${building.name} 的財務報表">
                <i class="ph ph-file-pdf"></i> 匯出 ${building.name} PDF
            </button>
        </div>

        ${renderFinancialKpiTiles(agg)}

        <div class="charts-side-by-side">
            <div class="report-chart-card">
                <div class="report-chart-title"><span><i class="ph ph-chart-pie"></i> 支出結構</span></div>
                ${renderExpensePie(pareto)}
            </div>
            <div class="report-chart-card">
                <div class="report-chart-title"><span><i class="ph ph-chart-bar"></i> 月度趨勢 · 近 ${monthCount} 個月</span></div>
                ${renderTrendChart(months)}
            </div>
        </div>

        <!-- 該館支出分項 — KPI 卡片組 + 下方精簡 subtotal 表 -->
        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-list-numbers"></i> ${building.name} 支出分項</div>
            <div class="expense-bucket-grid">
                ${EXPENSE_BUCKETS.map(b => {
                    const v = buckets[b.key] || 0;
                    return `
                        <div class="expense-bucket-tile ${v === 0 ? 'is-empty' : ''}">
                            <div class="expense-bucket-label">${b.label}</div>
                            <div class="expense-bucket-value">${v === 0 ? '—' : moneyAmount(v)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="expense-subtotal-list">
                <div class="expense-subtotal-row">
                    <span class="label">支出合計</span>
                    <span class="value">${moneyAmount(bucketSubtotal(buckets))}</span>
                </div>
                <div class="expense-subtotal-row">
                    <span class="label">紅利發放</span>
                    <span class="value">${buckets.bonus === 0 ? '—' : moneyAmount(buckets.bonus)}</span>
                </div>
                <div class="expense-subtotal-row is-total">
                    <span class="label">總合計</span>
                    <span class="value">${moneyAmount(bucketGrandTotal(buckets))}</span>
                </div>
            </div>
        </div>
    `;
}

// === 支出分類桶 (對齊用戶 excel 表) ===
// 對應 invoice.type；未匹配的歸到「其他」
const EXPENSE_BUCKETS = [
    { key: 'rent',     label: '房東租金', matchTypes: ['房東租金'] },
    { key: 'mgmt',     label: '管理費',  matchTypes: ['管理費'] },
    { key: '591',      label: '591',     matchTypes: ['591'] },
    { key: 'water',    label: '水費',    matchTypes: ['水費'] },
    { key: 'electric', label: '電費',    matchTypes: ['電費'] },
    { key: 'network',  label: '網路費',  matchTypes: ['網路費'] },
    { key: 'gas',      label: '瓦斯費',  matchTypes: ['瓦斯費'] },
    { key: 'misc',     label: '雜支',    matchTypes: ['修繕雜支', '雜支'] },
    { key: 'salary',   label: '薪水',    matchTypes: ['薪水'] },
    { key: 'other',    label: '其他',    matchTypes: ['其他支出', '其他', '清潔用品'] }
];
const BONUS_MATCH = ['紅利發放'];

function bucketExpensesOf(invoices) {
    const buckets = {};
    EXPENSE_BUCKETS.forEach(b => buckets[b.key] = 0);
    buckets.bonus = 0;
    invoices.filter(i => i.direction === 'out').forEach(inv => {
        const t = inv.type || '';
        const amt = actualAmount(inv);
        const bucket = EXPENSE_BUCKETS.find(b => b.matchTypes.includes(t));
        if (bucket) buckets[bucket.key] += amt;
        else if (BONUS_MATCH.includes(t)) buckets.bonus += amt;
        else buckets.other += amt;  // 未匹配 type 歸到「其他」
    });
    return buckets;
}
function bucketSubtotal(b) { return EXPENSE_BUCKETS.reduce((s, x) => s + (b[x.key] || 0), 0); }
function bucketGrandTotal(b) { return bucketSubtotal(b) + (b.bonus || 0); }

// === 群組累金 (R2 — 2026-06-17) ===
// 公式: 上期累金 + 群組結餘 - 群組紅利發放
//   結餘已含紅利支出 → 等價於 baseline + sum(月 net)
// 2026/05 baseline (寫死在 constants.js) → 2026/06 起每月自動累加
// building.group → 累金 key 映射 (中溫 包含舊溫州 收掉後 = 中山 only)
const GROUP_TO_CUM_KEY = {
    '松師': '松師',
    '中山': '中溫',
    '古亭': '古亭'
    // 信義 不算 cum bar
};

function ymRangeAfter(startYM, endYM) {
    // 回 ['2026-06', '2026-07', ...] startYM 之後到 endYM (含)
    const out = [];
    let [y, m] = startYM.split('-').map(Number);
    m++;
    if (m > 12) { m = 1; y++; }
    const [ey, em] = endYM.split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return out;
}

function computeGroupCumulatives() {
    const baselineYM = GROUP_CUM_BASELINES.asOf;
    const todayYM = new Date().toISOString().slice(0, 7);
    const months = ymRangeAfter(baselineYM, todayYM);
    // groupKey → array of buildingIds
    const groupBuildings = {};
    Object.keys(GROUP_CUM_BASELINES.groups).forEach(g => groupBuildings[g] = []);
    mockData.buildings.forEach(b => {
        const cumKey = GROUP_TO_CUM_KEY[b.group];
        if (cumKey && groupBuildings[cumKey]) groupBuildings[cumKey].push(b.id);
    });
    const allInvoices = mockData.invoices.filter(i => !isPreCutoff(i) && isSettled(i));
    const result = {};
    Object.entries(GROUP_CUM_BASELINES.groups).forEach(([groupKey, baseline]) => {
        const buildingIds = new Set(groupBuildings[groupKey] || []);
        let delta = 0;
        months.forEach(ym => {
            const monthInvs = allInvoices.filter(i =>
                buildingIds.has(i.buildingId) && (i.paidDate || i.dueDate || '').startsWith(ym)
            );
            const inSum = monthInvs.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
            const outSum = monthInvs.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
            delta += (inSum - outSum);  // 結餘 (已含紅利扣減)
        });
        result[groupKey] = { amount: baseline + delta, baseline, delta, asOf: todayYM };
    });
    return result;
}

function renderGroupCumulativeBar() {
    const cums = computeGroupCumulatives();
    const chips = Object.entries(cums).map(([key, c]) => {
        const deltaSign = c.delta >= 0 ? '+' : '−';
        const deltaColor = c.delta >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
        // ⚠ title= 內必須是純文字, 不能放 moneyAmount() (它回傳含 " 的 <span>, 會破壞 attribute 解析)
        const baselinePlain = `$${(c.baseline || 0).toLocaleString()}`;
        return `
            <span class="cum-chip" title="${key} 累金 = baseline ${baselinePlain} (${GROUP_CUM_BASELINES.asOf}) + 結餘 − 紅利">
                <span class="cum-chip-label">${key} 累金</span>
                <span class="cum-chip-value">${moneyAmount(c.amount)}</span>
                ${c.delta !== 0 ? `<span class="cum-chip-delta" style="color: ${deltaColor};">${deltaSign}$${Math.abs(c.delta).toLocaleString()}</span>` : ''}
            </span>
        `;
    }).join('');
    return `<div class="cum-bar" title="自 ${GROUP_CUM_BASELINES.asOf} 月底為基底，每月加上群組結餘 (扣紅利後留存)">${chips}</div>`;
}

// === 報表單位: 各館 (building) 或 群組 (group like 松師=松山+師大) ===
function getReportUnits() {
    const buildings = _modeBuildings();
    const grouping = reportState.viewGrouping || 'building';
    if (grouping === 'group') {
        const map = new Map();
        buildings.forEach(b => {
            const g = b.group || b.name;
            if (!map.has(g)) map.set(g, { id: g, name: g, buildingIds: [] });
            map.get(g).buildingIds.push(b.id);
        });
        return [...map.values()];
    }
    return buildings.map(b => ({ id: b.id, name: b.name, buildingIds: [b.id] }));
}
function invoicesForUnit(unit, invoices) {
    return invoices.filter(i => unit.buildingIds.includes(i.buildingId));
}

// 金額 cell — 0 顯示空白，跟 excel 一致
function moneyCell(v, opts = {}) {
    const v0 = Number(v) || 0;
    const txt = v0 === 0 ? '' : moneyAmount(v0);
    const w = opts.bold ? 'font-weight: 700;' : '';
    const c = opts.color ? `color: ${opts.color};` : '';
    return `<td style="text-align: right; font-variant-numeric: tabular-nums; ${w}${c}">${txt}</td>`;
}

function renderAnalysisAllBuildings() {
    const range = reportState.viewRange;
    const rangeInvoices = settledInRange(range);
    const summary = computeAggForInvoices(rangeInvoices);
    const pareto = computeExpensePareto(rangeInvoices);
    const months = computeMonthlyTrend(range);
    const monthCount = months.length;
    // 統計單位固定為館別 (2026-06-17 拿掉群組 toggle，照用戶要求)
    reportState.viewGrouping = 'building';
    const grouping = 'building';

    // 計算各 unit (館/群組) 的 agg + expense buckets
    const units = getReportUnits();
    const perUnit = units.map(u => {
        const inv = invoicesForUnit(u, rangeInvoices);
        return { unit: u, agg: computeAggForInvoices(inv), buckets: bucketExpensesOf(inv) };
    });
    const totalBuckets = bucketExpensesOf(rangeInvoices);

    return `
        ${renderFinancialKpiTiles(summary)}

        ${getMode() === 'cohousing' ? renderGroupCumulativeBar() : ''}

        <div class="charts-side-by-side">
            <div class="report-chart-card">
                <div class="report-chart-title"><span><i class="ph ph-chart-pie"></i> 支出結構</span></div>
                ${renderExpensePie(pareto)}
            </div>
            <div class="report-chart-card">
                <div class="report-chart-title"><span><i class="ph ph-chart-bar"></i> 月度趨勢 · 近 ${monthCount} 個月</span></div>
                ${renderTrendChart(months)}
            </div>
        </div>

        <!-- P&L 對比表 (5 cols: 收入/支出/結餘/毛利率/淨利率) -->
        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-table"></i> 各館 收支損益表</div>
            <div style="overflow-x: auto;">
                <table class="report-table report-pnl-table">
                    <thead>
                        <tr>
                            <th>${grouping === 'group' ? '群組' : '館別'}</th>
                            <th style="text-align: right;">收入</th>
                            <th style="text-align: right;">支出</th>
                            <th style="text-align: right;">結餘</th>
                            <th style="text-align: right;">毛利率</th>
                            <th style="text-align: right;">淨利率</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${perUnit.map(r => `
                            <tr ${grouping === 'building' ? `style="cursor: pointer;" data-building-sub="${r.unit.id}"` : ''}>
                                <td style="font-weight: 600;">${r.unit.name}</td>
                                ${moneyCell(r.agg.inAll)}
                                ${moneyCell(r.agg.outAll)}
                                ${moneyCell(r.agg.net, { bold: true, color: r.agg.net >= 0 ? 'var(--text-main)' : 'var(--color-danger)' })}
                                <td style="text-align: right; font-variant-numeric: tabular-nums;">${r.agg.inAll > 0 ? pct(r.agg.grossMargin) : '—'}</td>
                                <td style="text-align: right; font-variant-numeric: tabular-nums; color: ${r.agg.netMargin >= 0 ? 'var(--text-main)' : 'var(--color-danger)'};">${r.agg.inAll > 0 ? pct(r.agg.netMargin) : '—'}</td>
                            </tr>
                        `).join('')}
                        <tr class="pnl-total-row">
                            <td><strong>合計</strong></td>
                            ${moneyCell(summary.inAll, { bold: true })}
                            ${moneyCell(summary.outAll, { bold: true })}
                            ${moneyCell(summary.net, { bold: true, color: summary.net >= 0 ? 'var(--text-main)' : 'var(--color-danger)' })}
                            <td style="text-align: right; font-variant-numeric: tabular-nums; font-weight: 700;">${summary.inAll > 0 ? pct(summary.grossMargin) : '—'}</td>
                            <td style="text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; color: ${summary.netMargin >= 0 ? 'var(--text-main)' : 'var(--color-danger)'};">${summary.inAll > 0 ? pct(summary.netMargin) : '—'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- ${grouping === 'group' ? '各群組' : '各館'} 支出分項表 (rows = 項目, cols = 各${grouping === 'group' ? '群組' : '館'} + 全館合計) -->
        <div class="report-chart-card">
            <div class="report-chart-title"><i class="ph ph-list-numbers"></i> 本月總支出分析</div>
            <div style="overflow-x: auto;">
                <table class="report-table report-itemized-table">
                    <thead>
                        <tr>
                            <th style="background: rgba(255,200,200,0.4);">項目</th>
                            ${perUnit.map(u => `<th style="text-align: right;">${u.unit.name}</th>`).join('')}
                            <th style="text-align: right; background: rgba(255,235,180,0.4);">全館合計</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${EXPENSE_BUCKETS.map(b => `
                            <tr>
                                <td style="font-weight: 500;">${b.label}</td>
                                ${perUnit.map(u => moneyCell(u.buckets[b.key])).join('')}
                                ${moneyCell(totalBuckets[b.key], { bold: true })}
                            </tr>
                        `).join('')}
                        <tr style="background: rgba(255,200,200,0.25);">
                            <td><strong>支出合計</strong></td>
                            ${perUnit.map(u => moneyCell(bucketSubtotal(u.buckets), { bold: true })).join('')}
                            ${moneyCell(bucketSubtotal(totalBuckets), { bold: true })}
                        </tr>
                        <tr>
                            <td>紅利發放</td>
                            ${perUnit.map(u => moneyCell(u.buckets.bonus)).join('')}
                            ${moneyCell(totalBuckets.bonus, { bold: true })}
                        </tr>
                        <tr style="background: rgba(255,235,180,0.4);">
                            <td><strong>總合計</strong></td>
                            ${perUnit.map(u => moneyCell(bucketGrandTotal(u.buckets), { bold: true })).join('')}
                            ${moneyCell(bucketGrandTotal(totalBuckets), { bold: true })}
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div style="display: flex; justify-content: flex-end; margin-top: 1rem;">
            <button class="btn btn-outline" data-action="export-analysis-pdf" title="匯出全館合計財務報表">
                <i class="ph ph-file-pdf"></i> 匯出全館合計 PDF
            </button>
        </div>
    `;
}

// ───────────────────── 年度總表 (R3: 館×類型 cross-grid + 熱度 + MoM + Sparkline) ─────────────────────
const MONTHS_LABEL = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const BONUS_TYPE = '紅利發放';
// 顯示用房名 (去掉「館」字)
function bShort(name) { return (name || '').replace(/館$/, ''); }

function computeYearlyData(year) {
    const yearStr = String(year);
    const md = _md();
    // 走系統共用排序 — id 升冪，跟其他頁面一致
    const buildings = getSortedBuildings({ activeOnly: true })
        .filter(b => (md.mode === 'managed' ? b.mode === 'managed' : b.mode !== 'managed'));

    const invs = md.invoices.filter(i =>
        !isPreCutoff(i) && isSettled(i) && (i.paidDate || i.dueDate || '').startsWith(yearStr)
    );

    function monthly(filterFn) {
        const arr = new Array(12).fill(0);
        invs.filter(filterFn).forEach(i => {
            const m = parseInt((i.paidDate || i.dueDate || '').slice(5, 7), 10);
            if (m >= 1 && m <= 12) arr[m - 1] += actualAmount(i);
        });
        return arr;
    }
    function monthlyBuilding(bId, filterFn) {
        return monthly(i => i.buildingId === bId && filterFn(i));
    }

    // 所有支出類型 (排除紅利，紅利當獨立列)
    const allOutTypes = [...new Set(invs.filter(i => i.direction === 'out').map(i => i.type))].filter(Boolean);
    const expenseTypes = allOutTypes.filter(t => t !== BONUS_TYPE);

    const monIncomeTotal  = monthly(i => i.direction === 'in');
    const monExpenseAll   = monthly(i => i.direction === 'out');                  // 含紅利
    const monExpenseNoBonus = monthly(i => i.direction === 'out' && i.type !== BONUS_TYPE);
    const monBonus        = monthly(i => i.direction === 'out' && i.type === BONUS_TYPE);
    const monNet          = monIncomeTotal.map((v, i) => v - monExpenseAll[i]);

    const rows = [];

    // === Section A: 收入 (per building 房租 + 其它) ===
    // section 已標「收入」，label 只留館名即可
    buildings.forEach(b => {
        rows.push({
            section: '收入', kind: 'income',
            label: bShort(b.name),
            monthlyValues: monthlyBuilding(b.id, i => i.direction === 'in' && i.type === '房租')
        });
    });
    rows.push({
        section: '收入', kind: 'income', label: '其它',
        monthlyValues: monthly(i => i.direction === 'in' && i.type !== '房租')
    });

    // === Section B: 收支總計 (3 subtotal rows) ===
    rows.push({ section: '收支總計', kind: 'income-total',  label: '收入', monthlyValues: monIncomeTotal,  isSubtotal: true });
    rows.push({ section: '收支總計', kind: 'expense-total', label: '支出', monthlyValues: monExpenseAll,   isSubtotal: true });
    rows.push({ section: '收支總計', kind: 'net',           label: '結餘', monthlyValues: monNet,          isSubtotal: true });

    // === Section C: 花費總表 (per type × per building) ===
    // label 保留「館名+類型」(這 section 跨多類型，需要區分)
    expenseTypes.forEach(t => {
        buildings.forEach(b => {
            const mv = monthlyBuilding(b.id, i => i.direction === 'out' && i.type === t);
            if (mv.every(v => v === 0)) return;
            rows.push({
                section: '花費總表', kind: 'expense',
                label: `${bShort(b.name)}・${t}`,
                monthlyValues: mv
            });
        });
    });
    rows.push({ section: '花費總表', kind: 'expense-total', label: '總計',     monthlyValues: monExpenseNoBonus, isSubtotal: true });
    rows.push({ section: '花費總表', kind: 'bonus',         label: BONUS_TYPE, monthlyValues: monBonus });

    // === Section D: 各館成本支出 (per building 支出合計 + 每月小計) ===
    buildings.forEach(b => {
        rows.push({
            section: '各館成本支出', kind: 'expense',
            label: bShort(b.name),
            monthlyValues: monthlyBuilding(b.id, i => i.direction === 'out' && i.type !== BONUS_TYPE)
        });
    });
    rows.push({ section: '各館成本支出', kind: 'expense-total', label: '小計', monthlyValues: monExpenseNoBonus, isSubtotal: true });

    // === Section E: 各館結餘 (per building net) ===
    buildings.forEach(b => {
        const inc = monthlyBuilding(b.id, i => i.direction === 'in');
        const exp = monthlyBuilding(b.id, i => i.direction === 'out' && i.type !== BONUS_TYPE);
        rows.push({
            section: '各館結餘', kind: 'net',
            label: bShort(b.name),
            monthlyValues: inc.map((v, idx) => v - exp[idx])
        });
    });
    rows.push({ section: '各館結餘', kind: 'net', label: '小計', monthlyValues: monNet, isSubtotal: true });

    // === Section F: 各館利率 (% = 結餘 / 收入) ===
    buildings.forEach(b => {
        const inc = monthlyBuilding(b.id, i => i.direction === 'in');
        const exp = monthlyBuilding(b.id, i => i.direction === 'out' && i.type !== BONUS_TYPE);
        const rate = inc.map((v, idx) => v > 0 ? (v - exp[idx]) / v : 0);
        rows.push({
            section: '各館利率', kind: 'rate',
            label: bShort(b.name),
            monthlyValues: rate,
            valueFormat: 'percent'
        });
    });

    // === aggregates: total / avg / pct ===
    const grandIncome = sum(monIncomeTotal);
    const grandExpense = sum(monExpenseAll);
    rows.forEach(r => {
        if (r.valueFormat === 'percent') {
            // 利率 row — total/avg/pct 都顯示為年度平均利率
            const inc = sum(r.monthlyValues.map((_, idx) => {
                // 重算這 row 對應的年度 income (用 label 反查)
                return 0; // 不用，下面用 monthly 重算
            }));
            // 簡化：年度利率 = 全年結餘 / 全年收入 (再從 buildings 推回)
            // 已經在 monthlyValues 算過 monthly rate；total 用 monthlyValues 平均
            const nonZero = r.monthlyValues.filter(v => v !== 0);
            r.total = nonZero.length ? nonZero.reduce((s, v) => s + v, 0) / nonZero.length : 0;
            r.avg = r.total;
            r.pct = null;
            return;
        }
        const total = sum(r.monthlyValues);
        r.total = total;
        const filled = r.monthlyValues.filter(v => v !== 0).length;
        r.avg = filled > 0 ? total / filled : 0;
        if (r.kind === 'income' || r.kind === 'income-total') r.pct = grandIncome > 0 ? total / grandIncome : 0;
        else if (r.kind === 'expense' || r.kind === 'expense-total' || r.kind === 'bonus') r.pct = grandExpense > 0 ? total / grandExpense : 0;
        else r.pct = null;
    });
    return rows;
}

function sum(arr) { return arr.reduce((s, v) => s + v, 0); }
function pctStr(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }

// 熱度色階 — 走系統 token (success / danger / info)
function heatBgFor(value, max, kind) {
    if (max === 0 || value === 0) return '';
    const intensity = Math.min(1, value / max);
    // 系統 token RGB: success #22946e, danger #b13535, info #1e56a3
    let rgb;
    if (kind === 'income' || kind === 'income-total') rgb = '34, 148, 110';
    else if (kind === 'net') rgb = '30, 86, 163';
    else rgb = '177, 53, 53';
    return `background: rgba(${rgb}, ${(intensity * 0.14).toFixed(3)});`;
}

// MoM 箭頭：current 月跟前一月比
function momArrow(values, monthIdx) {
    if (monthIdx === 0) return '';
    const cur = values[monthIdx];
    const prev = values[monthIdx - 1];
    if (cur === 0 || prev === 0) return '';
    const delta = ((cur - prev) / Math.abs(prev)) * 100;
    if (Math.abs(delta) < 0.5) return '';
    const isUp = delta > 0;
    const color = isUp ? 'var(--color-success)' : 'var(--color-danger)';
    const arrow = isUp ? '↑' : '↓';
    return `<span style="font-size: 0.65rem; color: ${color}; margin-left: 2px;">${arrow}${Math.abs(delta).toFixed(0)}%</span>`;
}

// Sparkline SVG mini line chart
function sparkline(values, stroke = 'currentColor') {
    const w = 80, h = 22;
    const max = Math.max(...values, 1);
    const padding = 2;
    const points = values.map((v, i) => {
        const x = (i / 11) * (w - 2 * padding) + padding;
        const y = h - padding - (v / max) * (h - 2 * padding);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg width="${w}" height="${h}" style="display: block; vertical-align: middle;"><polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// section → 走系統 semantic token（不再彩虹 6 色）
// 收入=success / 支出=danger / 中性=primary
const SECTION_META = {
    '收入':         { token: 'success' },   // 綠
    '收支總計':     { token: 'neutral' },   // 中性灰
    '花費總表':     { token: 'danger' },    // 紅
    '各館成本支出': { token: 'danger' },    // 紅
    '各館結餘':     { token: 'primary' },   // 橘
    '各館利率':     { token: 'primary' }    // 橘
};
function sectionVar(section) {
    const t = SECTION_META[section]?.token || 'neutral';
    if (t === 'neutral') return 'var(--text-secondary)';
    return `var(--color-${t})`;
}

function formatRowValue(r, v) {
    if (v === 0) return '';
    if (r.valueFormat === 'percent') return (v * 100).toFixed(1) + '%';
    return v.toLocaleString();
}

// Sparkline 升級 — 帶 area fill + 高低點 dot
function sparklineV2(values, accent) {
    const w = 70, h = 22;
    const padding = 2;
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const points = values.map((v, i) => {
        const x = (i / 11) * (w - 2 * padding) + padding;
        const y = h - padding - ((v - min) / span) * (h - 2 * padding);
        return { x, y, v };
    });
    const pathLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const pathArea = pathLine + ` L${points[points.length-1].x.toFixed(1)},${h} L${points[0].x.toFixed(1)},${h} Z`;
    const maxPt = points.reduce((acc, p) => p.v > acc.v ? p : acc, points[0]);
    return `
        <svg width="${w}" height="${h}" style="display: block; vertical-align: middle;">
            <path d="${pathArea}" fill="${accent}" fill-opacity="0.12"/>
            <path d="${pathLine}" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            ${maxPt.v > 0 ? `<circle cx="${maxPt.x.toFixed(1)}" cy="${maxPt.y.toFixed(1)}" r="2.2" fill="${accent}"/>` : ''}
        </svg>
    `;
}

function renderYearlyRow(r, currentMonth1based) {
    const isPercent = r.valueFormat === 'percent';
    const values = r.monthlyValues.map(Math.abs);
    const max = Math.max(...values);
    // 只在 top tier (≥ 60%) 上色 — 避免每行整個發燒
    const heatThreshold = 0.6;
    const zeroChar = '<span class="yearly-zero">·</span>';

    const cells = r.monthlyValues.map((v, idx) => {
        const ratio = max > 0 ? Math.abs(v) / max : 0;
        const bg = (!isPercent && ratio >= heatThreshold) ? heatBgFor(Math.abs(v), max, r.kind) : '';
        const valColor = (r.kind === 'net' && v < 0) ? 'color: var(--color-danger);' : '';
        const txt = v === 0 ? zeroChar : formatRowValue(r, v);
        return `<td class="yearly-cell" style="${valColor}${bg}">${txt}</td>`;
    }).join('');

    let sparkColor = sectionVar(r.section);
    if (r.kind === 'net' && r.total < 0) sparkColor = 'var(--color-danger)';

    const totalTxt = r.total === 0 ? zeroChar : formatRowValue(r, r.total);
    const avgTxt = (r.avg === 0 || r.avg == null) ? zeroChar : formatRowValue(r, r.avg);
    const rowCls = `yearly-row${r.isSubtotal ? ' is-subtotal' : ''} kind-${r.kind}`;

    return `
        <tr class="${rowCls}">
            <td class="yearly-label">${esc(r.label)}</td>
            ${cells}
            <td class="yearly-cell yearly-total">${totalTxt}</td>
            <td class="yearly-cell yearly-avg">${avgTxt}</td>
            <td class="yearly-cell yearly-pct">${pctStr(r.pct)}</td>
            <td class="yearly-cell yearly-spark">${sparklineV2(r.monthlyValues.map(v => isPercent ? v * 100 : v), sparkColor)}</td>
        </tr>
    `;
}

// section divider row (簡潔灰底 + 左 token 條 + section 名)
function renderYearlySectionBanner(section, rowCount) {
    const color = sectionVar(section);
    return `
        <tr class="yearly-section-banner" style="--section-color: ${color};">
            <td colspan="17">
                <div class="yearly-section-banner-inner">
                    <span class="yearly-section-name">${esc(section)}</span>
                    <span class="yearly-section-meta">${rowCount} 項</span>
                </div>
            </td>
        </tr>
    `;
}

// esc 改成從 utils/escape.js import (line 15)

function renderYearlyTab() {
    const year = reportState.yearlyYear || new Date().getFullYear();
    const today = new Date();
    const isCurrentYear = year === today.getFullYear();
    const currentMonth1based = isCurrentYear ? today.getMonth() + 1 : 12;
    const rows = computeYearlyData(year);
    const hasAnyData = rows.some(r => r.total !== 0);
    const headerMonths = MONTHS_LABEL.map(label =>
        `<th style="text-align: right;">${label}</th>`
    ).join('');

    // section 分組
    const sectionGroups = [];
    let currentGroup = null;
    rows.forEach(r => {
        if (!currentGroup || currentGroup.section !== r.section) {
            currentGroup = { section: r.section, rows: [] };
            sectionGroups.push(currentGroup);
        }
        currentGroup.rows.push(r);
    });

    const minYear = today.getFullYear() - 5;
    const maxYear = today.getFullYear() + 1;
    const canPrev = year > minYear;
    const canNext = year < maxYear;

    // section banner + rows 交錯
    const tbodyHtml = sectionGroups.map(g => {
        const banner = renderYearlySectionBanner(g.section, g.rows.length);
        const rows = g.rows.map(r => renderYearlyRow(r, currentMonth1based)).join('');
        return banner + rows;
    }).join('');

    return `
        <div class="yearly-toolbar">
            <div class="yearly-toolbar-meta">
                <div class="yearly-toolbar-subtitle">年度總表</div>
                <div class="yearly-year-nav">
                    <button type="button" class="yearly-year-arrow ${canPrev ? '' : 'is-disabled'}" data-yearly-year="${year - 1}" ${canPrev ? '' : 'disabled'} title="上一年">
                        <i class="ph ph-caret-left"></i>
                    </button>
                    <span class="yearly-year-display">${year}</span>
                    <button type="button" class="yearly-year-arrow ${canNext ? '' : 'is-disabled'}" data-yearly-year="${year + 1}" ${canNext ? '' : 'disabled'} title="下一年">
                        <i class="ph ph-caret-right"></i>
                    </button>
                </div>
            </div>
            <div class="yearly-toolbar-actions">
                <button type="button" class="btn btn-outline" data-action="export-yearly-pdf" title="匯出整張年度總表為 PDF">
                    <i class="ph ph-file-pdf"></i> 匯出 PDF
                </button>
            </div>
        </div>

        <div class="yearly-table-wrap">
            <table class="yearly-table">
                <thead>
                    <tr>
                        <th class="yearly-th-label">項目</th>
                        ${headerMonths}
                        <th class="yearly-th-total">年度總計</th>
                        <th>每月平均</th>
                        <th>占比</th>
                        <th class="yearly-th-spark">趨勢</th>
                    </tr>
                </thead>
                <tbody>
                    ${tbodyHtml}
                </tbody>
            </table>
        </div>
    `;
}

// ───────────────────── Hub: tab bar + entry ─────────────────────
// 2026-06-17 移除 overview tab (跟其他 tab 內容重複)
const TABS = [
    { key: 'buildings', icon: 'ph-buildings',     label: '物件營運' },
    { key: 'analysis',  icon: 'ph-chart-pie',     label: '財務分析' },
    { key: 'yearly',    icon: 'ph-calendar',      label: '年度總表' }
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
    // 每次 render 開頭 reset mode filter 快取 (用戶可能切過 mode)
    _resetModeCache();
    // 舊 tab 名強制 redirect (2026-06-17 拿掉 overview/statement)
    if (reportState.activeTab === 'statement' || reportState.activeTab === 'overview') reportState.activeTab = 'buildings';
    let tabContent;
    switch (reportState.activeTab) {
        case 'analysis': tabContent = renderAnalysisTab(); break;
        case 'yearly':   tabContent = renderYearlyTab(); break;
        case 'buildings':
        default:         tabContent = renderBuildingsTab(); break;
    }
    // 年度總表自帶年份 picker，不需要區間日期
    const showRangePicker = reportState.activeTab !== 'yearly';
    return `
        ${renderTabBar()}
        <div class="cutoff-banner" title="${FINANCE_CUTOFF_DATE} 之前的舊資料保留在 DB 但不算進統計">
            <i class="ph ph-pin"></i> 起算自 <strong>${FINANCE_CUTOFF_DATE}</strong> · 之前的歷史不算進報表
        </div>
        ${showRangePicker ? `<div style="margin-bottom: 1rem;">${renderRangePicker()}</div>` : ''}
        ${tabContent}
    `;
}

export function initReportsActions(scope) {
    initRangePicker(scope, () => refreshView());
    // Chart.js init — 取代手寫 SVG + hover tooltip handler，hover/tooltip 由 Chart.js 內建
    initReportsCharts(scope);

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
    // 財務分析 PDF 匯出 (Tab 3 單館 / 全館 共用 [data-action="export-analysis-pdf"])
    // 有 data-building-id 就只匯出該館，沒有就匯出全館合計
    scope.querySelectorAll('[data-action="export-analysis-pdf"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const buildingId = btn.dataset.buildingId || null;
            exportAnalysisReport(reportState.viewRange, buildingId);
        });
    });

    // 交叉分析的 grouping 切換
    scope.querySelectorAll('[data-grouping]').forEach(btn => {
        btn.addEventListener('click', () => {
            reportState.viewGrouping = btn.dataset.grouping;
            refreshView();
        });
    });

    // R3: 年度總表年份切換 (◀ ▶ 箭頭)
    scope.querySelectorAll('[data-yearly-year]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            reportState.yearlyYear = parseInt(btn.dataset.yearlyYear, 10);
            refreshView();
        });
    });

    // R3: 年度總表 匯出 PDF — 用瀏覽器原生 print (帶 @page landscape)
    scope.querySelectorAll('[data-action="export-yearly-pdf"]').forEach(btn => {
        btn.addEventListener('click', () => exportYearlyAsPdf());
    });
}

// 年度總表匯出 — 原地 window.print()，靠 @media print 隱藏其他 UI
// 樣式跟畫面一模一樣 (token / CSS / 字型都是同 document)
function exportYearlyAsPdf() {
    const year = reportState.yearlyYear || new Date().getFullYear();
    const tableWrap = document.querySelector('.yearly-table-wrap');
    if (!tableWrap) return;
    // 注入 print header (只在列印時顯示)
    let header = document.querySelector('.yearly-print-header');
    if (!header) {
        header = document.createElement('div');
        header.className = 'yearly-print-header print-only';
        tableWrap.parentNode.insertBefore(header, tableWrap);
    }
    header.innerHTML = `
        <h1>${year} 年度總表</h1>
        <span class="meta">聚空間 PMS · ${new Date().toLocaleString('zh-TW')}</span>
    `;
    // 標記 body 進入列印模式 → @media print 規則生效
    document.body.classList.add('is-printing-yearly');
    // print 完還原
    const cleanup = () => {
        document.body.classList.remove('is-printing-yearly');
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 100);
}
