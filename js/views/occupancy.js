// 住房一覽 — 分館 tabs + 矩陣式月收租日
//
// 設計：
//   * 每館一個 tab，點 tab 切換
//   * 該館所有床位都顯示 (空床 / 居住中 / 已退房 都列)
//   * 月份欄數依視窗寬度自動算 (從上個月起，向後填滿空間)
//   * 顏色：今天=綠 / 本月=橘 / 過去=灰 / 未來=藍 / 已退房 row 整列灰

import { mockData, formatRoomType, getSortedBuildings, isSettled } from '../data.js';
import { showTenantNoteEditor } from './tenants.js';
import { showPropertyDetails, showCheckinAssignmentForm } from './properties.js';
import { showContractDetails, confirmTerminate } from './contracts.js';

const START_OFFSET = -1; // 顯示從上個月開始
const END_OFFSET = 8;    // 最後顯示到「今天 + 8 個月」(e.g. 5月 → 顯示到隔年 1 月) — 每月自動向後滾
const COL_WIDTH = 55;    // 每月格目標寬度 (用來決定要塞幾個月)
const FIXED_COLS = 385;  // 75+120+130+60 = 385 — 與 thead 的 width 完全對齊
const CARD_PADDING = 80; // card padding (1.5rem×2) + container padding 預留
const MAX_MONTHS = END_OFFSET - START_OFFSET + 1; // 10

// 模組層狀態：當前 active tab
let currentBuildingId = null;

function calculateMonthCount() {
    // 用實際 main-content 寬度算 (排除 sidebar)，找不到才 fallback window
    // 上限 MAX_MONTHS — 即使螢幕再寬也不會超過 (今天 + 8 個月)
    const main = document.querySelector('.main-content');
    const availableArea = main?.offsetWidth || window.innerWidth;
    const space = Math.max(300, availableArea - FIXED_COLS - CARD_PADDING);
    return Math.max(4, Math.min(MAX_MONTHS, Math.floor(space / COL_WIDTH)));
}

function buildMonths(today, count) {
    const months = [];
    for (let i = 0; i < count; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + START_OFFSET + i, 1);
        months.push({
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            label: `${d.getFullYear()}/${d.getMonth() + 1}`,
            isCurrent: d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
        });
    }
    return months;
}

function clampToMonthEnd(year, month, day) {
    const lastDay = new Date(year, month, 0).getDate();
    return Math.min(day, lastDay);
}

// 判斷某合約該月房租是否已繳 (用於住房一覽月份格右上小圖示)
// 回傳: 'paid' | 'partial' | 'unpaid' | null  (null = 無對應 invoice，可能是新月份還沒建)
function paymentStatusFor(contract, month) {
    const monthKey = `${month.year}-${String(month.month).padStart(2, '0')}`;
    const relevant = mockData.invoices.filter(inv => {
        if (inv.direction !== 'in') return false;
        if (inv.type !== '房租' && inv.type !== '租金') return false;
        const matched = (inv.contractId === contract.id) || (inv.tenant && contract.tenant && inv.tenant === contract.tenant);
        if (!matched) return false;
        const m = (inv.paidDate || inv.dueDate || '').substring(0, 7);
        return m === monthKey;
    });
    if (!relevant.length) return null;
    if (relevant.some(isSettled)) return 'paid';
    if (relevant.some(inv => (inv.paidAmount || 0) > 0)) return 'partial';
    return 'unpaid';
}

function paymentBadge(status, isFuture) {
    if (status === 'paid')    return `<span class="occ-pay-badge occ-pay-paid" title="已繳清">✓</span>`;
    if (status === 'partial') return `<span class="occ-pay-badge occ-pay-partial" title="部分繳款">◐</span>`;
    if (status === 'unpaid' && !isFuture) return `<span class="occ-pay-badge occ-pay-unpaid" title="未繳/欠繳">!</span>`;
    return '';
}

function rentCellFor(contract, month, today) {
    if (!contract?.startDate || !contract?.endDate) return { value: '', className: '', contractId: null };
    // 用字串切割避開時區坑 (contract.startDate 是 "YYYY-MM-DD")
    const [, , startDayStr] = contract.startDate.split('-');
    const dueDay = parseInt(startDayStr, 10);
    const actualDay = clampToMonthEnd(month.year, month.month, dueDay);
    const cellDateStr = `${month.year}-${String(month.month).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
    const cellDate = new Date(month.year, month.month - 1, actualDay);

    // 合約結束的當月：在「應結日已過、合約已到期」的格子位置顯示「到期 X/Y」標記
    const [endYearStr, endMonthStr, endDayStr] = contract.endDate.split('-');
    const endYear = parseInt(endYearStr, 10);
    const endMonth = parseInt(endMonthStr, 10);
    const endDay = parseInt(endDayStr, 10);
    if (month.year === endYear && month.month === endMonth && cellDateStr > contract.endDate) {
        return {
            value: `${endMonth}/${endDay} 到期`,
            className: 'occ-cell occ-end-marker',
            contractId: contract.id,
            tooltip: `合約 ${contract.id} 到期\n${contract.tenant} · ${contract.startDate} ~ ${contract.endDate}`
        };
    }

    // 收租週期：cellDate 必須在 startDate ~ endDate 之間 (含起訖日)
    // 用 YYYY-MM-DD 字串直接比大小（lexicographic = chronological）— 避免時區誤差
    if (cellDateStr < contract.startDate || cellDateStr > contract.endDate) return { value: '', className: '', contractId: null };

    const todayStr = today.toDateString();
    const cellStr = cellDate.toDateString();
    let className = 'occ-cell';
    if (cellStr === todayStr) className += ' occ-today';
    else if (month.isCurrent) className += ' occ-this-month';
    else if (cellDate < today) className += ' occ-past';
    else className += ' occ-future';

    // 繳費狀態 badge (只標還在合約期內的月份)
    const payStatus = paymentStatusFor(contract, month);
    const isFutureCell = cellDate > today;
    const badge = paymentBadge(payStatus, isFutureCell);
    const statusLabel = payStatus === 'paid' ? '已繳' : payStatus === 'partial' ? '部分繳' : payStatus === 'unpaid' ? '未繳' : '尚無收款紀錄';
    const tooltip = `合約 ${contract.id} · ${contract.tenant}\n租期 ${contract.startDate} ~ ${contract.endDate}\n月租 $${(contract.amount || 0).toLocaleString()}\n${month.year}/${month.month} ${statusLabel}`;
    return { value: `${month.month}/${actualDay}${badge}`, className, contractId: contract.id, tooltip };
}

// 取得某床位所有 active / snoozed 合約，依 start_date 升冪排列
// 一床可能同時有：現任(已 active 中) + 接續(未來 active，例如續租 or 換人)
function getBedContracts(bed) {
    return mockData.contracts
        .filter(c => c.propertyName === bed.name)
        .filter(c => c.renewalState === 'active' || c.renewalState === 'snoozed')
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}

// 渲染「單一合約」的列 — 每份合約獨立一列，床位 label 一律完整顯示
function renderContractRow(bed, contract, months, today, stripeClass, todayStr) {
    const bedLabel = bed.roomNumber && bed.bedLetter ? `R${bed.roomNumber}-${bed.bedLetter}` : bed.name;
    const bedLabelHtml = `<button class="occ-link" data-action="show-bed" data-bed-id="${bed.id}" title="點擊看床位資料">${bedLabel}</button>`;

    const tenantObj = mockData.tenants.find(t => t.name === contract.tenant);
    const tenantInner = tenantObj
        ? `<button class="occ-link" data-action="show-tenant" data-tenant-id="${tenantObj.id}" title="點擊編輯備註">${contract.tenant}</button>`
        : contract.tenant;

    // 未來合約 (start_date > today) 標記為「預入住」
    const isFuture = contract.startDate && contract.startDate > todayStr;
    const isSnoozed = contract.renewalState === 'snoozed';

    let tenantCell;
    if (isSnoozed) {
        tenantCell = `<span style="color: var(--color-warning);">${tenantInner}</span>`;
    } else if (isFuture) {
        tenantCell = `<span class="occ-future-tenant">${tenantInner}</span>`;
    } else {
        tenantCell = `<strong>${tenantInner}</strong>`;
    }
    // 備註欄：最多 2 行，超過顯示 … hover 看全文
    const noteCell = tenantObj?.note
        ? `<span class="occ-note-clamp" title="${tenantObj.note.replace(/"/g, '&quot;')}">${tenantObj.note}</span>`
        : (isSnoozed ? `<span style="font-size: 0.7rem;">暫緩中</span>` : '');

    const cells = months.map(m => {
        const cell = rentCellFor(contract, m, today);
        if (!cell.value) return '<td></td>';
        return `<td class="${cell.className} occ-clickable" data-action="show-contract" data-contract-id="${cell.contractId}" title="${cell.tooltip}">${cell.value}</td>`;
    }).join('');

    const rowClass = [stripeClass, isFuture ? 'occ-row-future' : ''].filter(Boolean).join(' ');

    return `
        <tr class="${rowClass}">
            <td class="occ-bed-label">${bedLabelHtml}</td>
            <td>${tenantCell}</td>
            <td><span style="font-size: 0.75rem; color: var(--text-muted);">${noteCell}</span></td>
            <td style="text-align: center;">
                <input type="checkbox" class="occ-terminate-check" data-action="terminate-contract" data-contract-id="${contract.id}" title="勾選後啟動退房流程" />
            </td>
            ${cells}
        </tr>
    `;
}

// 空床列 — 全部 cells 留空，操作欄放「+入住」按鈕
function renderVacantRow(bed, months, stripeClass = '') {
    const bedLabel = bed.roomNumber && bed.bedLetter ? `R${bed.roomNumber}-${bed.bedLetter}` : bed.name;
    const bedLabelHtml = `<button class="occ-link" data-action="show-bed" data-bed-id="${bed.id}" title="點擊看床位資料">${bedLabel}</button>`;
    const cells = months.map(() => '<td></td>').join('');
    return `
        <tr class="occ-row-vacant ${stripeClass}">
            <td class="occ-bed-label">${bedLabelHtml}</td>
            <td><span style="color: var(--text-muted); font-size: 0.75rem;">空床</span></td>
            <td></td>
            <td style="text-align: center;">
                <button class="occ-checkin-btn" data-action="checkin-bed" data-bed-id="${bed.id}" title="新增入住"><i class="ph ph-plus"></i> 入住</button>
            </td>
            ${cells}
        </tr>
    `;
}

function renderRow(bed, months, today, stripeClass = '') {
    const contracts = getBedContracts(bed);
    if (contracts.length === 0) return renderVacantRow(bed, months, stripeClass);
    const todayStr = today.toISOString().slice(0, 10);
    return contracts
        .map(c => renderContractRow(bed, c, months, today, stripeClass, todayStr))
        .join('');
}

function renderBuildingTable(building, months, today) {
    const beds = mockData.properties
        .filter(p => p.buildingId === building.id)
        .sort((a, b) => {
            const ra = Number(a.roomNumber ?? 999);
            const rb = Number(b.roomNumber ?? 999);
            if (ra !== rb) return ra - rb;
            return (a.bedLetter || '').localeCompare(b.bedLetter || '');
        });

    if (beds.length === 0) {
        return `<div class="card"><p style="text-align: center; color: var(--text-muted); padding: 2rem;">${building.name} 尚無床位</p></div>`;
    }

    // 依房號 group，每個房間先放一條 header (顯示房型 / 床數 / 總租金)，再放該房床位
    const roomMap = new Map();
    beds.forEach(b => {
        const rn = b.roomNumber ?? 0;
        if (!roomMap.has(rn)) roomMap.set(rn, []);
        roomMap.get(rn).push(b);
    });
    const sortedRoomNumbers = [...roomMap.keys()].sort((a, b) => Number(a) - Number(b));
    const colCount = 4 + months.length;

    const rows = sortedRoomNumbers.map((rn, idx) => {
        const roomBeds = roomMap.get(rn);
        const sample = roomBeds[0];
        const roomTypeLabel = formatRoomType(sample?.gender, sample?.capacity);
        // 該房間有幾床是「現任」有人住 (排除純未來合約的床位)
        const todayStrForCount = today.toISOString().slice(0, 10);
        const rentedInRoom = roomBeds.filter(b => {
            const cs = getBedContracts(b);
            return cs.some(c => c.startDate <= todayStrForCount && c.endDate >= todayStrForCount);
        }).length;
        const stripeClass = idx % 2 === 0 ? 'occ-room-stripe-a' : 'occ-room-stripe-b';

        const headerRow = `
            <tr class="occ-room-header">
                <td colspan="${colCount}">
                    <span class="occ-room-title">R${rn}</span>
                    <span class="occ-room-type">${roomTypeLabel}</span>
                    <span class="occ-room-meta">${roomBeds.length} 床 · 居住 ${rentedInRoom} / 空 ${roomBeds.length - rentedInRoom}</span>
                </td>
            </tr>
        `;

        const bedRows = roomBeds.map(b => {
            try {
                return renderRow(b, months, today, stripeClass);
            } catch (e) {
                console.error(`[occupancy] 床位 ${b.id} / ${b.name} 渲染失敗:`, e, b);
                return `<tr><td colspan="${colCount}" style="color: var(--color-danger); padding: 0.5rem; font-size: 0.8rem;">⚠ ${b.id || '(no id)'} - ${b.name || '(no name)'}: ${e.message}</td></tr>`;
            }
        }).join('');

        return headerRow + bedRows;
    }).join('');
    const monthHeader = months.map(m =>
        `<th class="${m.isCurrent ? 'occ-this-month-header' : ''}">${m.label}</th>`
    ).join('');

    // 統計：active = 有現任合約，vacant = 沒任何 active/snoozed
    const todayStrStats = today.toISOString().slice(0, 10);
    const stats = beds.reduce((acc, b) => {
        const cs = getBedContracts(b);
        const hasCurrent = cs.some(c => c.startDate <= todayStrStats && c.endDate >= todayStrStats);
        const key = hasCurrent ? 'active' : (cs.length > 0 ? 'snoozed' : 'vacant');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    return `
        <div class="card occ-section">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
                <h3 class="card-title" style="margin: 0;">
                    <i class="ph ph-buildings"></i> ${building.name}
                </h3>
                <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 1rem;">
                    <span>共 <strong>${beds.length}</strong> 床</span>
                    <span style="color: var(--color-success);">居住 ${stats.active || 0}</span>
                    ${stats.snoozed ? `<span style="color: var(--color-warning);">暫緩 ${stats.snoozed}</span>` : ''}
                    <span>空床 ${stats.vacant || 0}</span>
                </div>
            </div>
            <div class="table-container occ-table-wrap">
                <table class="data-table occ-table">
                    <thead>
                        <tr>
                            <th style="width: 75px;">床位</th>
                            <th style="width: 120px;">房客</th>
                            <th style="width: 130px;">備註</th>
                            <th style="width: 60px;">退房</th>
                            ${monthHeader}
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

export function renderOccupancy() {
    const today = new Date();
    const monthCount = calculateMonthCount();
    const months = buildMonths(today, monthCount);
    const buildings = getSortedBuildings({ activeOnly: true });

    if (!currentBuildingId || !buildings.find(b => b.id === currentBuildingId)) {
        currentBuildingId = buildings[0]?.id;
    }
    const activeBuilding = buildings.find(b => b.id === currentBuildingId);

    const tabs = buildings.map(b => {
        const isActive = b.id === currentBuildingId;
        const count = mockData.properties.filter(p => p.buildingId === b.id).length;
        return `
            <button class="occ-tab ${isActive ? 'active' : ''}" data-building="${b.id}">
                <i class="ph ph-buildings"></i>
                <span>${b.name}</span>
                <span class="occ-tab-count">${count}</span>
            </button>
        `;
    }).join('');

    const section = activeBuilding ? renderBuildingTable(activeBuilding, months, today) : '';

    return `
        <div class="occupancy-page">
            <div class="card occ-intro">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                    <div class="occ-tabs">${tabs}</div>
                </div>
            </div>
            ${section}
        </div>
    `;
}

export function initOccupancyActions(scope) {
    // Tab 切換
    scope.querySelectorAll('.occ-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentBuildingId = tab.dataset.building;
            if (window.refreshCurrentView) window.refreshCurrentView();
        });
    });

    // 通用 data-action 委派 — 床位/租客/合約點擊 + 退房 checkbox
    scope.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target || !scope.contains(target)) return;
        const action = target.dataset.action;
        try {
            if (action === 'show-tenant') {
                // 在住房一覽點租客名字 → 快速編輯備註 (focused modal)
                showTenantNoteEditor(target.dataset.tenantId);
            } else if (action === 'show-bed') {
                showPropertyDetails(target.dataset.bedId);
            } else if (action === 'show-contract') {
                showContractDetails(target.dataset.contractId);
            } else if (action === 'terminate-contract') {
                // 不要直接退房 — 跳確認 modal；取消的話 checkbox 還原
                e.preventDefault();
                target.checked = false;
                confirmTerminate(target.dataset.contractId);
            } else if (action === 'checkin-bed') {
                // 空床 / 已退房 → 啟動入住流程 (預選此床位 → 一鍵建合約+指派+排程)
                showCheckinAssignmentForm({ preselectBedId: target.dataset.bedId });
            }
        } catch (err) {
            console.error('[occupancy] action 失敗:', action, err);
        }
    });
}

// 視窗 resize 時重新算月份欄數 (僅當前在住房一覽頁面)
let resizeTimer = null;
window.addEventListener('resize', () => {
    if (window.location.hash === '#occupancy') {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.refreshCurrentView) window.refreshCurrentView();
        }, 300);
    }
});
