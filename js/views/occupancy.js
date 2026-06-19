// 住房一覽 — 分館 tabs + 矩陣式月收租日
//
// 設計：
//   * 每館一個 tab，點 tab 切換
//   * 該館所有床位都顯示 (空床 / 居住中 / 已退房 都列)
//   * 月份欄數依視窗寬度自動算 (從上個月起，向後填滿空間)
//   * 顏色：今天=綠 / 本月=橘 / 過去=灰 / 未來=藍 / 已退房 row 整列灰

import { mockData, formatRoomType, getSortedBuildings, isSettled, needsDecision } from '../data.js';
import { showTenantNoteEditor, showTenantDetails } from './tenants.js';
import { getMode } from '../utils/appMode.js';
import { showPropertyDetails, showCheckinAssignmentForm } from './properties.js';
import { showContractDetails, confirmTerminate, confirmRenew, confirmSnooze } from './contracts.js';
import { emptyState } from '../utils/emptyState.js';

const START_OFFSET = -1; // 顯示從上個月開始
const END_OFFSET = 8;    // 最後顯示到「今天 + 8 個月」(e.g. 5月 → 顯示到隔年 1 月) — 每月自動向後滾
const COL_WIDTH = 55;    // 每月格目標寬度 (用來決定要塞幾個月)
const FIXED_COLS = 425;  // 75+120+130+100 = 425 — 與 thead 的 width 完全對齊
const CARD_PADDING = 80; // card padding (1.5rem×2) + container padding 預留
const MAX_MONTHS = END_OFFSET - START_OFFSET + 1; // 10

// 模組層狀態：當前 active tab
let currentBuildingId = null;

// === M-R-3：手機垂直導航狀態 ===
// 三層 drilldown：buildings → rooms → beds
// 只在 ≤ 768px 顯示；桌面照常用矩陣表
let mobileNavState = { level: 'buildings', buildingId: null, room: null };

function calculateMonthCount() {
    // 手機 (≤768px): 強制 6 個月，讓使用者橫向捲動發現未來月份
    // 桌機: 依 main-content 寬度算 (上限 MAX_MONTHS)
    if (window.innerWidth <= 768) return 6;
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
            shortLabel: `${d.getMonth() + 1}月`,   // 手機用短版 label
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
    // 同租客在當月可能有多份合約 (e.g. 一人租兩床)
    // 收款常常一筆涵蓋多份合約 → 用合計判斷, 任一付款可分攤
    // 限制: 同 building (避免跨館同名串色), 同期間重疊
    const thisBuildingId = mockData.properties.find(p => p.name === contract.propertyName)?.buildingId;
    const sameTenantContractIds = new Set(
        mockData.contracts
            .filter(c => c.tenant === contract.tenant && (c.renewalState === 'active' || c.renewalState === 'snoozed'))
            .filter(c => {
                if (!c.startDate || !c.endDate) return false;
                const start = c.startDate.substring(0, 7);
                const end = c.endDate.substring(0, 7);
                if (!(start <= monthKey && monthKey <= end)) return false;
                // 同 building (反查 propertyName)
                const cBuildingId = mockData.properties.find(p => p.name === c.propertyName)?.buildingId;
                return cBuildingId === thisBuildingId;
            })
            .map(c => c.id)
    );
    const relevant = mockData.invoices.filter(inv => {
        if (inv.direction !== 'in') return false;
        if (inv.type !== '房租') return false;
        if (!sameTenantContractIds.has(inv.contractId)) return false;
        const m = (inv.paidDate || inv.dueDate || '').substring(0, 7);
        return m === monthKey;
    });
    if (!relevant.length) return null;
    // 合計判斷：總已收 >= 總應收 → 全 paid (這樣一張床位的多收能 cover 另一張的未收)
    const totalDue = relevant.reduce((s, inv) => s + ((Number(inv.amount) || 0) - (Number(inv.discount) || 0)), 0);
    const totalPaid = relevant.reduce((s, inv) => s + (Number(inv.paidAmount) || 0), 0);
    if (totalDue <= 0) return 'paid';
    if (totalPaid >= totalDue) return 'paid';
    if (totalPaid > 0) return 'partial';
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

// 兩個日期差 N 天內 = 視為接續 (xlsx 匯入 / 同日 / +1 天 都算)
function daysBetween(d1, d2) {
    if (!d1 || !d2) return Infinity;
    const a = new Date(d1).getTime();
    const b = new Date(d2).getTime();
    return Math.abs(a - b) / 86400000;
}

// 把續租鏈合併成一條 chain
// 合併條件 (滿足任一即合併):
//   1. parentContractId 直接指向上一份 (走 renew 流程建的)
//   2. 同租客 + 上一份的 endDate ≈ 下一份的 startDate (≤ 1 天) — xlsx 匯入或手動沒設 parent 也能合
// 不同租客換人 → 一定不合併
function buildContractChains(contracts) {
    const byId = new Map(contracts.map(c => [c.id, c]));
    // 已成為某條 chain 的 child (避免重複)
    const consumed = new Set();
    const chains = [];
    for (const c of contracts) {
        if (consumed.has(c.id)) continue;
        const chain = [c];
        consumed.add(c.id);
        // 往後找接續合約
        let cur = c;
        while (true) {
            const next = contracts.find(x => {
                if (consumed.has(x.id)) return false;
                if (x.tenant !== cur.tenant) return false;
                // 條件 1: parent 直連
                if (x.parentContractId === cur.id) return true;
                // 條件 2: 日期接續 (差 ≤ 1 天) + 同租客
                if (cur.endDate && x.startDate && daysBetween(cur.endDate, x.startDate) <= 1) return true;
                return false;
            });
            if (!next) break;
            chain.push(next);
            consumed.add(next.id);
            cur = next;
        }
        chains.push(chain);
    }
    return chains;
}

// 渲染「續租鏈」的列 — 同租客接續續租合併成一列
// chain[0] = 原始合約, chain[chain.length-1] = 最新/當前合約 (操作按鈕對應這個)
function renderContractRow(bed, chain, months, today, stripeClass, todayStr) {
    const head = chain[0];
    const latest = chain[chain.length - 1];

    const bedLabel = bed.roomNumber && bed.bedLetter ? `R${bed.roomNumber}-${bed.bedLetter}` : bed.name;
    const bedLabelHtml = `<button class="occ-link" data-action="show-bed" data-bed-id="${bed.id}" title="點擊看床位資料">${bedLabel}</button>`;

    const tenantObj = mockData.tenants.find(t => t.name === latest.tenant);
    const tenantInner = tenantObj
        ? `<button class="occ-link" data-action="show-tenant" data-tenant-id="${tenantObj.id}" title="點擊看租客詳細資料">${latest.tenant}</button>`
        : latest.tenant;

    // 未來合約 (start_date > today) — 用 head 判斷 (整鏈起點)
    const isFuture = head.startDate && head.startDate > todayStr;
    const isSnoozed = latest.renewalState === 'snoozed';

    let tenantCell;
    if (isSnoozed) {
        tenantCell = `<span style="color: var(--color-warning);">${tenantInner}</span>`;
    } else if (isFuture) {
        tenantCell = `<span class="occ-future-tenant">${tenantInner}</span>`;
    } else {
        tenantCell = `<strong>${tenantInner}</strong>`;
    }
    // 鏈長 > 1 顯示「續 N」標記，提示這是合併過的多份合約
    if (chain.length > 1) {
        tenantCell += ` <span class="occ-chain-badge" title="續租鏈：共 ${chain.length} 份合約合併顯示\n${chain.map(c => `${c.id} ${c.startDate} ~ ${c.endDate}`).join('\n')}">續${chain.length}</span>`;
    }
    // 外部平台代收 → 加個小 badge 標示 (Airbnb / 591 等)，看 latest 那筆
    if (latest.paymentChannel === 'platform') {
        const platformLabel = latest.platformName || '外部平台';
        tenantCell += ` <span style="display: inline-block; font-size: 0.65rem; padding: 1px 4px; background: var(--color-info-light); color: var(--color-info); border-radius: 3px; vertical-align: middle;" title="外部平台代收，不開帳單">🌐 ${platformLabel}</span>`;
    }
    // 備註欄
    const noteContent = tenantObj?.note
        ? `<span class="occ-note-clamp">${tenantObj.note}</span>`
        : `<span class="occ-note-empty">+ 編輯</span>`;
    const noteCell = tenantObj
        ? `<button class="occ-note-btn" data-action="edit-note" data-tenant-id="${tenantObj.id}" title="${tenantObj.note ? tenantObj.note.replace(/"/g, '&quot;') : '點擊新增備註'}">${noteContent}</button>`
        : (isSnoozed ? `<span style="font-size: var(--text-2xs);">暫緩中</span>` : '');

    // Cell rendering: 逐月找鏈中哪個合約覆蓋這個月，從最新往回找 (新合約優先)
    const cells = months.map(m => {
        for (let i = chain.length - 1; i >= 0; i--) {
            const cell = rentCellFor(chain[i], m, today);
            if (cell.value) return `<td class="${cell.className} occ-clickable" data-action="show-contract" data-contract-id="${cell.contractId}" title="${cell.tooltip}">${cell.value}</td>`;
        }
        return '<td></td>';
    }).join('');

    const rowClass = [stripeClass, isFuture ? 'occ-row-future' : ''].filter(Boolean).join(' ');

    // 決策按鈕看最新那筆 (續租鏈中只有最後一份還在跑)
    const hasIntent = ['renew', 'decline', 'inquiry'].includes(latest.renewIntent);
    const showDecisionButtons = needsDecision(latest, today) || hasIntent;
    const actionCell = showDecisionButtons
        ? `
            <div class="occ-decision-btns" title="續租 / 退租 / 暫緩">
                <button class="occ-action-btn occ-action-renew" data-action="renew-contract" data-contract-id="${latest.id}" title="續租"><i class="ph ph-arrow-clockwise"></i></button>
                <button class="occ-action-btn occ-action-terminate" data-action="terminate-contract-btn" data-contract-id="${latest.id}" title="退租"><i class="ph ph-door-open"></i></button>
                <button class="occ-action-btn occ-action-snooze" data-action="snooze-contract" data-contract-id="${latest.id}" title="暫緩"><i class="ph ph-clock-clockwise"></i></button>
            </div>
        `
        : `<input type="checkbox" class="occ-terminate-check" data-action="terminate-contract" data-contract-id="${latest.id}" title="勾選後啟動退房流程" />`;

    return `
        <tr class="${rowClass}">
            <td class="occ-bed-label">${bedLabelHtml}</td>
            <td>${tenantCell}</td>
            <td><span style="font-size: var(--text-xs); color: var(--text-muted);">${noteCell}</span></td>
            <td style="text-align: center;">${actionCell}</td>
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
            <td><span style="color: var(--text-muted); font-size: var(--text-xs);">空床</span></td>
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
    // 把續租鏈合併成一條 chain — 每條 chain 渲染一列
    const chains = buildContractChains(contracts);
    return chains
        .map(chain => renderContractRow(bed, chain, months, today, stripeClass, todayStr))
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
        return `<div class="card">${emptyState({ mode: 'block', icon: 'ph-house-line', title: `${building.name} 尚無床位`, hint: '請先到房源管理新增床位' })}</div>`;
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
        // 該房間有幾床是「實際有人住」— 跟 display 邏輯對齊
        // 「床位上有名字 = 居住」: 有 active/snoozed 合約且 startDate <= today (合約是否過期不論)
        // (P2 用戶 2026-06-16: 之前 spans-today 嚴格判定漏掉合約已過期但 bed.tenant 還在的情況)
        const todayStrForCount = today.toISOString().slice(0, 10);
        const rentedInRoom = roomBeds.filter(b => {
            const cs = getBedContracts(b);
            return cs.some(c => c.startDate && c.startDate <= todayStrForCount);
        }).length;
        const stripeClass = idx % 2 === 0 ? 'occ-room-stripe-a' : 'occ-room-stripe-b';

        const headerRow = `
            <tr class="occ-room-header">
                <td colspan="${colCount}">
                    <div class="occ-room-header-inner">
                        <span class="occ-room-title">R${rn}</span>
                        <span class="occ-room-type">${roomTypeLabel}</span>
                        <span class="occ-room-meta">${roomBeds.length} 床 · 居住 ${rentedInRoom} / 空 ${roomBeds.length - rentedInRoom}</span>
                    </div>
                </td>
            </tr>
        `;

        const bedRows = roomBeds.map(b => {
            try {
                return renderRow(b, months, today, stripeClass);
            } catch (e) {
                console.error(`[occupancy] 床位 ${b.id} / ${b.name} 渲染失敗:`, e, b);
                return `<tr><td colspan="${colCount}" style="color: var(--color-danger); padding: 0.5rem; font-size: var(--text-xs);">⚠ ${b.id || '(no id)'} - ${b.name || '(no name)'}: ${e.message}</td></tr>`;
            }
        }).join('');

        return headerRow + bedRows;
    }).join('');
    const monthHeader = months.map(m =>
        `<th class="${m.isCurrent ? 'occ-this-month-header' : ''}"><span class="occ-month-full">${m.label}</span><span class="occ-month-short">${m.shortLabel}</span></th>`
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
                <div style="font-size: var(--text-xs); color: var(--text-muted); display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
                    <span>共 <strong>${beds.length}</strong> 床</span>
                    <span style="color: var(--color-success);">居住 ${stats.active || 0}</span>
                    ${stats.snoozed ? `<span style="color: var(--color-warning);">暫緩 ${stats.snoozed}</span>` : ''}
                    <span>空床 ${stats.vacant || 0}</span>
                    <!-- audit: 月份格 badge legend ─ 讓新用戶看得懂 ✓◐! 是什麼 -->
                    <span style="display: inline-flex; gap: 0.4rem; align-items: center; padding-left: 1rem; border-left: 1px solid var(--border-color);" title="月份格繳費狀態說明">
                        <span class="occ-pay-badge occ-pay-paid">✓</span><small>已繳</small>
                        <span class="occ-pay-badge occ-pay-partial">◐</span><small>部分</small>
                        <span class="occ-pay-badge occ-pay-unpaid">!</span><small>逾期</small>
                    </span>
                </div>
            </div>
            <div class="table-container occ-table-wrap">
                <table class="data-table occ-table">
                    <thead>
                        <tr>
                            <th style="width: 75px;">床位</th>
                            <th style="width: 120px;">房客</th>
                            <th style="width: 130px;">備註</th>
                            <th style="width: 100px;">操作</th>
                            ${monthHeader}
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

// === M-R-3：手機垂直導航三層 render ===

function renderMobileBuildingsList() {
    const buildings = getSortedBuildings({ activeOnly: true });
    const today = new Date().toISOString().slice(0, 10);
    if (!buildings.length) {
        return emptyState({ mode: 'block', icon: 'ph-buildings', title: '尚無館別資料', hint: '請先到房源管理新增館別' });
    }
    const cards = buildings.map(b => {
        const beds = mockData.properties.filter(p => p.buildingId === b.id);
        const rented = beds.filter(bed => {
            const cs = getBedContracts(bed);
            return cs.some(c => c.startDate <= today && c.endDate >= today);
        }).length;
        const occRate = beds.length ? Math.round(rented / beds.length * 100) : 0;
        const occColor = occRate >= 80 ? 'var(--color-success)'
            : occRate >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
        return `
            <button class="omn-card" type="button" data-mn-action="open-building" data-id="${b.id}">
                <div class="omn-card-main">
                    <div class="omn-card-title"><i class="ph ph-buildings" aria-hidden="true"></i> ${b.name}</div>
                    ${b.baseAddress ? `<div class="omn-card-sub">${b.baseAddress}</div>` : ''}
                </div>
                <div class="omn-card-stats">
                    <div class="omn-stat"><strong style="color: ${occColor};">${occRate}%</strong><small>出租率</small></div>
                    <div class="omn-stat"><strong>${rented}/${beds.length}</strong><small>已租 / 總床</small></div>
                </div>
                <i class="ph ph-caret-right omn-chevron" aria-hidden="true"></i>
            </button>
        `;
    }).join('');
    return `
        <div class="omn-level-header">
            <h3 class="omn-title"><i class="ph ph-list" aria-hidden="true"></i> 各館概況</h3>
            <small class="omn-sub">${buildings.length} 個館別 · 點選查看房間</small>
        </div>
        <div class="omn-cards">${cards}</div>
    `;
}

function renderMobileRoomsList(buildingId) {
    const building = mockData.buildings.find(b => b.id === buildingId);
    if (!building) return emptyState({ mode: 'block', icon: 'ph-buildings', title: '館別不存在', hint: '請返回上一層重新選擇' });
    const beds = mockData.properties.filter(p => p.buildingId === buildingId);
    const roomMap = new Map();
    beds.forEach(b => {
        if (!roomMap.has(b.roomNumber)) roomMap.set(b.roomNumber, []);
        roomMap.get(b.roomNumber).push(b);
    });
    const roomNumbers = Array.from(roomMap.keys()).sort((a, b) => a - b);
    const today = new Date().toISOString().slice(0, 10);

    const cards = roomNumbers.map(rn => {
        const rmBeds = roomMap.get(rn);
        const rented = rmBeds.filter(p => {
            const cs = getBedContracts(p);
            return cs.some(c => c.startDate <= today && c.endDate >= today);
        }).length;
        const sample = rmBeds[0];
        const typeLabel = formatRoomType(sample?.gender, sample?.capacity);
        return `
            <button class="omn-card" type="button" data-mn-action="open-room" data-room="${rn}">
                <div class="omn-card-main">
                    <div class="omn-card-title">R${rn}</div>
                    <div class="omn-card-sub">${typeLabel}</div>
                </div>
                <div class="omn-card-stats">
                    <div class="omn-stat"><strong>${rented}/${rmBeds.length}</strong><small>已租 / 總床</small></div>
                </div>
                <i class="ph ph-caret-right omn-chevron" aria-hidden="true"></i>
            </button>
        `;
    }).join('');

    return `
        <div class="omn-level-header">
            <button class="omn-back" type="button" data-mn-action="back-to-buildings">
                <i class="ph ph-caret-left" aria-hidden="true"></i> 各館概況
            </button>
            <h3 class="omn-title"><i class="ph ph-buildings" aria-hidden="true"></i> ${building.name}</h3>
            <small class="omn-sub">${roomNumbers.length} 間房 · ${beds.length} 床</small>
        </div>
        <div class="omn-cards">${cards}</div>
    `;
}

function renderMobileBedsList(buildingId, roomNumber) {
    const building = mockData.buildings.find(b => b.id === buildingId);
    if (!building) return emptyState({ mode: 'block', icon: 'ph-buildings', title: '館別不存在', hint: '請返回上一層重新選擇' });
    const beds = mockData.properties
        .filter(p => p.buildingId === buildingId && p.roomNumber === Number(roomNumber))
        .sort((a, b) => (a.bedLetter || '').localeCompare(b.bedLetter || ''));
    const today = new Date().toISOString().slice(0, 10);

    const cards = beds.map(b => {
        const cs = getBedContracts(b);
        const current = cs.find(c => c.startDate <= today && c.endDate >= today);
        const future = cs.find(c => c.startDate > today);
        const statusBadge = current
            ? `<span class="status-badge success">居住中</span>`
            : (future
                ? `<span class="status-badge warning">已預約</span>`
                : `<span class="status-badge">空床</span>`);
        const mainInfo = current
            ? `<div class="omn-card-sub"><i class="ph-fill ph-user" aria-hidden="true"></i> ${current.tenant} · 至 ${current.endDate} 到期</div>`
            : (future
                ? `<div class="omn-card-sub">即將入住：${future.tenant} (${future.startDate})</div>`
                : `<div class="omn-card-sub">$${(b.rent || 0).toLocaleString()}/月 · 待租</div>`);
        return `
            <div class="omn-card omn-bed-card ${current ? 'is-rented' : 'is-vacant'}">
                <div class="omn-card-main">
                    <div class="omn-card-title">R${b.roomNumber}-${b.bedLetter}</div>
                    ${mainInfo}
                </div>
                <div class="omn-bed-meta">
                    ${statusBadge}
                </div>
                <div class="omn-bed-actions">
                    <button class="btn btn-outline btn-sm" type="button" data-mn-action="bed-detail" data-bed-id="${b.id}">
                        <i class="ph ph-eye" aria-hidden="true"></i> 床位
                    </button>
                    ${current
                        ? `<button class="btn btn-outline btn-sm" type="button" data-mn-action="open-contract" data-contract-id="${current.id}">
                            <i class="ph ph-file-text" aria-hidden="true"></i> 合約
                        </button>`
                        : `<button class="btn btn-primary btn-sm" type="button" data-mn-action="checkin" data-bed-id="${b.id}">
                            <i class="ph ph-key" aria-hidden="true"></i> 入住
                        </button>`}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="omn-level-header">
            <button class="omn-back" type="button" data-mn-action="back-to-rooms">
                <i class="ph ph-caret-left" aria-hidden="true"></i> ${building.name}
            </button>
            <h3 class="omn-title">R${roomNumber} · 床位</h3>
            <small class="omn-sub">${beds.length} 床</small>
        </div>
        <div class="omn-cards omn-cards-beds">${cards}</div>
    `;
}

function renderMobileNav() {
    let body = '';
    if (mobileNavState.level === 'rooms' && mobileNavState.buildingId) {
        body = renderMobileRoomsList(mobileNavState.buildingId);
    } else if (mobileNavState.level === 'beds' && mobileNavState.buildingId && mobileNavState.room) {
        body = renderMobileBedsList(mobileNavState.buildingId, mobileNavState.room);
    } else {
        // 預設或無效狀態 → 回 buildings
        mobileNavState = { level: 'buildings', buildingId: null, room: null };
        body = renderMobileBuildingsList();
    }
    return `<div class="occ-mobile-nav">${body}</div>`;
}

export function renderOccupancy() {
    // 不再條件切手機版 — 用戶要求保留矩陣表（最直觀），手機改靠橫向捲動 + sticky 床位欄
    // 三層 nav (renderMobileBuildingsList 等) 暫不用，留作未來「切換顯示模式」備用
    const today = new Date();
    const monthCount = calculateMonthCount();
    const months = buildMonths(today, monthCount);
    // 跟 mode 切開：共居 mode 只列共居館，代管同理
    const mode = getMode();
    const buildings = getSortedBuildings({ activeOnly: true })
        .filter(b => (b.mode || 'cohousing') === (mode === 'managed' ? 'managed' : 'cohousing'));

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

    // 通用 data-action 委派 — 床位/租客/合約點擊 + 退房 checkbox (桌面矩陣用)
    scope.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target || !scope.contains(target)) return;
        const action = target.dataset.action;
        try {
            if (action === 'show-tenant') {
                showTenantDetails(target.dataset.tenantId);
            } else if (action === 'edit-note') {
                showTenantNoteEditor(target.dataset.tenantId);
            } else if (action === 'show-bed') {
                showPropertyDetails(target.dataset.bedId);
            } else if (action === 'show-contract') {
                showContractDetails(target.dataset.contractId);
            } else if (action === 'terminate-contract') {
                e.preventDefault();
                target.checked = false;
                confirmTerminate(target.dataset.contractId);
            } else if (action === 'renew-contract') {
                e.preventDefault();
                confirmRenew(target.dataset.contractId);
            } else if (action === 'terminate-contract-btn') {
                e.preventDefault();
                confirmTerminate(target.dataset.contractId);
            } else if (action === 'snooze-contract') {
                e.preventDefault();
                confirmSnooze(target.dataset.contractId);
            } else if (action === 'checkin-bed') {
                showCheckinAssignmentForm({ preselectBedId: target.dataset.bedId });
            }
        } catch (err) {
            console.error('[occupancy] action 失敗:', action, err);
        }
    });

    // === M-R-3：手機 nav 三層 drilldown 事件委派 ===
    scope.addEventListener('click', (e) => {
        const t = e.target.closest('[data-mn-action]');
        if (!t || !scope.contains(t)) return;
        const action = t.dataset.mnAction;
        try {
            if (action === 'open-building') {
                mobileNavState = { level: 'rooms', buildingId: t.dataset.id, room: null };
                window.refreshCurrentView?.();
            } else if (action === 'open-room') {
                mobileNavState = { ...mobileNavState, level: 'beds', room: t.dataset.room };
                window.refreshCurrentView?.();
            } else if (action === 'back-to-buildings') {
                mobileNavState = { level: 'buildings', buildingId: null, room: null };
                window.refreshCurrentView?.();
            } else if (action === 'back-to-rooms') {
                mobileNavState = { ...mobileNavState, level: 'rooms', room: null };
                window.refreshCurrentView?.();
            } else if (action === 'bed-detail') {
                showPropertyDetails(t.dataset.bedId);
            } else if (action === 'open-contract') {
                showContractDetails(t.dataset.contractId);
            } else if (action === 'checkin') {
                showCheckinAssignmentForm({ preselectBedId: t.dataset.bedId });
            }
        } catch (err) {
            console.error('[occupancy mobile-nav] action 失敗:', action, err);
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
