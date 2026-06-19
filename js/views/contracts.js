import {
    mockData, store,
    getContractLifecycle, daysUntilExpiry, needsDecision, contractLifecycleLabel,
    activeContractFor, activeContractOfTenant,
    findOverlappingBedContracts, findOverlappingTenantContracts,
    getSortedBuildings
} from '../data.js';
import { openFormModal, openConfirm, openDetailModal, showToast, showUndoToast, refreshView } from '../utils/ui.js';
import { escapeHtml as esc, escapeAttr } from '../utils/escape.js';
import { fillContractPdf, downloadPdfBytes, formatRentalPeriod } from '../utils/pdfGen.js';
import { showCheckinAssignmentForm } from './properties.js';
import { pushToTenant, uploadPdfToStorage, resolveSignedPdfUrl, triggerRenewalPoll } from '../utils/line.js';
import { filterContractsByMode } from '../utils/modeFilter.js';
import { getMode } from '../utils/appMode.js';

const CONTRACT_STATUSES = ['已簽署', '待簽署', '即將到期', '已終止'];
const TODAY_DATE = new Date();
const TODAY = TODAY_DATE.toISOString().split('T')[0];

// 從合約的首張帳單抓加減項目 (季繳優惠 / 能源費等)，給合約 PDF 填入用
function getContractAdjustments(contract) {
    if (!contract?.id) return [];
    const invoice = mockData.invoices
        .filter(i => i.contractId === contract.id)
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0];
    if (!invoice || !invoice.discountReason) return [];
    try {
        const arr = JSON.parse(invoice.discountReason);
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

// 把加減項目格式化成多行文字塞進 PDF (一行一項)，計算:
//   total_amount   = 租金總額 (整個合約期，加減後)  = 月租 × term + 加 − 折
//   monthly_amount = 月付金額                       = total_amount ÷ term
function buildAdjustmentValues(contract) {
    const adjustments = getContractAdjustments(contract);
    const base = Number(contract?.amount) || 0;
    const term = Number(contract?.termMonths) || 1;
    const net = adjustments.reduce((s, a) => {
        const v = Number(a.amount) || 0;
        return s + (a.kind === 'add' ? v : -v);
    }, 0);
    const termTotal = base * term + net;            // 整個合約期、加減後的總額
    const monthlyAmount = Math.round(termTotal / term);  // 月付金額 (四捨五入到整數)
    const adjustmentsText = adjustments.length
        ? adjustments.map(a => {
            const sign = a.kind === 'add' ? '+' : '−';
            const label = a.label || (a.kind === 'add' ? '加收項目' : '折扣');
            const amount = Number(a.amount) || 0;
            return `${sign} ${label}：${sign}$${amount.toLocaleString()}`;
          }).join('\n')
        : '';
    return {
        adjustments: adjustmentsText,
        total_amount: termTotal.toLocaleString(),
        monthly_amount: monthlyAmount.toLocaleString()
    };
}

// 每欄的排序 comparator (升冪)
const SORT_COLS = {
    info:   { cmp: (a, b) => (a.id || '').localeCompare(b.id || '') },
    tenant: { cmp: (a, b) => (a.tenant || '').localeCompare(b.tenant || '', 'zh-Hant') },
    amount: { cmp: (a, b) => (a.amount || 0) - (b.amount || 0) },
    start:  { cmp: (a, b) => (a.startDate || '').localeCompare(b.startDate || '') },
    end:    { cmp: (a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999') },
};
const SORT_STORAGE_KEY = 'bms-contracts-sort'; // 存 "col-dir" e.g. "amount-desc" / "" = 預設 lifecycle
function getCurrentSort() {
    const raw = localStorage.getItem(SORT_STORAGE_KEY) || '';
    const [col, dir] = raw.split('-');
    if (SORT_COLS[col] && (dir === 'asc' || dir === 'desc')) return { col, dir };
    return { col: '', dir: '' };
}
function sortArrow(thisCol, current) {
    const isActive = current.col === thisCol;
    const icon = isActive ? (current.dir === 'desc' ? 'ph-caret-down' : 'ph-caret-up') : 'ph-caret-up-down';
    const opacity = isActive ? 1 : 0.35;
    const color = isActive ? 'color: var(--color-warning);' : '';
    return `<span style="display: inline-block; width: 1.1em; text-align: center; margin-left: 3px; opacity: ${opacity}; ${color}"><i class="ph ${icon}" style="font-size: var(--text-2xs); vertical-align: middle;"></i></span>`;
}

function lifecycleBadge(state) {
    const { text, cls } = contractLifecycleLabel(state);
    return `<span class="status-badge ${cls}">${text}</span>`;
}

// 續租意願 badge (LINE 自動詢問結果)
function renewIntentBadge(contract) {
    const intent = contract.renewIntent;
    if (!intent) return '';
    const map = {
        asking:  { text: '⏳ 已問', cls: 'warning',  title: contract.renewAskedAt ? `已詢問於 ${contract.renewAskedAt.slice(0, 10)}` : '已詢問，等待回覆' },
        renew:   { text: '✅ 要續', cls: 'success',  title: '租客已表達續租意願' },
        decline: { text: '❌ 不續', cls: 'danger',   title: '租客已表達不續租' },
        inquiry: { text: '❓ 有問題', cls: 'info',   title: '租客有問題，需聯絡' }
    };
    const m = map[intent];
    if (!m) return '';
    return ` <span class="status-badge ${m.cls}" style="font-size: var(--text-2xs); margin-left: 0.2rem;" title="${m.title}">${m.text}</span>`;
}

function daysLabel(days) {
    if (days == null) return '';
    if (days > 0) return `剩 ${days} 天`;
    if (days === 0) return '今天到期';
    return `已過期 ${-days} 天`;
}

export function renderContracts() {
    const contracts = filterContractsByMode(mockData.contracts);

    // 加上 lifecycle 標籤排序：需要決策的優先
    const enriched = contracts.map(c => ({
        ...c,
        _state: getContractLifecycle(c, TODAY_DATE),
        _daysLeft: daysUntilExpiry(c, TODAY_DATE)
    }));

    // 排序：點表頭切換 / 預設用 lifecycle 優先
    const currentSort = getCurrentSort();
    if (currentSort.col && SORT_COLS[currentSort.col]) {
        const cmp = SORT_COLS[currentSort.col].cmp;
        enriched.sort(currentSort.dir === 'desc' ? (a, b) => -cmp(a, b) : cmp);
    } else {
        const priority = { awaiting_decision: 0, expired: 1, expiring_soon: 2, active: 3, snoozed: 4, renewed: 5, terminated: 6 };
        enriched.sort((a, b) => (priority[a._state] ?? 99) - (priority[b._state] ?? 99));
    }

    const totalContracts = enriched.length;
    const decisionCount = enriched.filter(c => needsDecision(c, TODAY_DATE)).length;
    const expiringSoonCount = enriched.filter(c => c._state === 'expiring_soon').length;
    const activeCount = enriched.filter(c => c._state === 'active' || c._state === 'snoozed' || c._state === 'expiring_soon' || c._state === 'awaiting_decision' || c._state === 'expired').length;
    const archivedCount = enriched.filter(c => c._state === 'renewed' || c._state === 'terminated').length;

    // 續租意願計數 (LINE 自動詢問結果)
    const renewCounts = {
        asking:  enriched.filter(c => c.renewIntent === 'asking').length,
        renew:   enriched.filter(c => c.renewIntent === 'renew').length,
        decline: enriched.filter(c => c.renewIntent === 'decline').length,
        inquiry: enriched.filter(c => c.renewIntent === 'inquiry').length
    };
    const anyRenewIntent = renewCounts.asking + renewCounts.renew + renewCounts.decline + renewCounts.inquiry;

    // 從 propertyName 抽館別 (e.g. "聚空間 - 松山館 R1-A" → "松山館")
    function extractArea(propName) {
        if (!propName) return '';
        const m = propName.match(/^聚空間\s*[-–]\s*(\S+?)\s/);
        return m ? m[1] : (propName.split(' ')[0] || '');
    }
    const areaCounts = {};
    enriched.forEach(c => {
        const a = extractArea(c.propertyName);
        if (!a) return;
        areaCounts[a] = (areaCounts[a] || 0) + 1;
    });
    // 依系統設定的館別順序排 (依當前 mode 篩)
    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    const sortedAreaList = getSortedBuildings({ activeOnly: true })
        .filter(b => (b.mode || 'cohousing') === targetMode)
        .map(b => `${b.name}館`);
    const areaNames = [
        ...sortedAreaList.filter(n => areaCounts[n]),
        ...Object.keys(areaCounts).filter(n => !sortedAreaList.includes(n))
    ];

    const tableRows = enriched.map(c => {
        const lifecycle = c._state;
        // 租客已透過 LINE 表達意願 → 也算「該決策」(就算還沒進 awaiting_decision)，讓小編能立刻動作
        const hasIntent = ['renew', 'decline', 'inquiry'].includes(c.renewIntent);
        const isDecision = lifecycle === 'awaiting_decision' || lifecycle === 'expired' || hasIntent;
        const isArchived = lifecycle === 'renewed' || lifecycle === 'terminated';

        const searchText = [c.id, c.propertyName, c.tenant].join(' ').toLowerCase();
        const days = c._daysLeft;

        // 操作按鈕：未決策的合約優先顯示決策按鈕
        const decisionButtons = isDecision ? `
            <button class="btn btn-success contract-action" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);" data-action="renew" data-id="${c.id}" title="續租">
                <i class="ph ph-arrow-clockwise"></i> 續租
            </button>
            <button class="btn btn-outline contract-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs); color: var(--color-danger);" data-action="terminate" data-id="${c.id}" title="退租">
                <i class="ph ph-door-open"></i>
            </button>
            <button class="btn btn-outline contract-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" data-action="snooze" data-id="${c.id}" title="暫緩">
                <i class="ph ph-clock-clockwise"></i>
            </button>
        ` : '';

        const signedButton = c.signedFileUrl
            ? `<button class="btn btn-outline contract-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs); color: var(--color-success); border-color: var(--color-success);" data-action="view-signed" data-id="${c.id}" title="租客已回傳簽署檔，點此檢視">
                   <i class="ph-fill ph-check-square"></i>
               </button>`
            : '';

        const standardButtons = `
            <button class="btn btn-outline contract-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" data-action="view" data-id="${c.id}" title="檢視合約">
                <i class="ph ph-eye"></i>
            </button>
            <button class="btn btn-outline contract-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" data-action="edit" data-id="${c.id}" title="編輯合約">
                <i class="ph ph-pencil"></i>
            </button>
            ${isArchived ? '' : `<button class="btn btn-outline contract-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" data-action="download" data-id="${c.id}" title="下載 PDF">
                <i class="ph ph-download"></i>
            </button>`}
            ${isArchived ? '' : `<button class="btn btn-outline btn-xs contract-action" style="color: var(--color-line);" data-action="send-line" data-id="${c.id}" title="LINE 寄合約 PDF">
                <i class="ph ph-paper-plane-tilt"></i>
            </button>`}
            ${signedButton}
            <button class="btn btn-outline contract-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs); color: var(--color-danger);" data-action="delete" data-id="${c.id}" title="刪除">
                <i class="ph ph-trash"></i>
            </button>
        `;

        const rowClass = isDecision ? 'is-decision-row' : (isArchived ? 'is-archived-row' : '');

        const areaName = extractArea(c.propertyName);
        // bundle group 標示: 主合約 = 該合約有 child；子合約 = 該合約有 bundleParentContractId
        const childCount = mockData.contracts.filter(x => x.bundleParentContractId === c.id).length;
        const isBundleParent = childCount > 0;
        const isBundleChild = !!c.bundleParentContractId;
        const bundleBadge = isBundleParent
            ? `<span class="status-badge info contract-action" data-action="unbundle-group" data-id="${c.id}" style="font-size: var(--text-2xs); margin-left: 0.25rem; cursor: pointer;" title="此為合併收款主合約 (含 ${childCount} 份子合約)，點擊解除綁定">🔗 主 +${childCount}</span>`
            : (isBundleChild
                ? `<span class="status-badge info contract-action" data-action="unbundle-self" data-id="${c.id}" style="font-size: var(--text-2xs); margin-left: 0.25rem; cursor: pointer;" title="此合約已併入 ${esc(c.bundleParentContractId)} 收款，點擊解除">🔗 子 → ${esc(c.bundleParentContractId)}</span>`
                : '');
        const cbDisabled = isArchived || c.paymentChannel === 'platform';
        return `
            <tr data-row-id="${esc(c.id)}" data-status="${esc(lifecycle)}" data-area="${esc(areaName)}" data-renew="${c.renewIntent || 'none'}" data-channel="${esc(c.paymentChannel || 'self')}" data-tenant="${escapeAttr(c.tenant || '')}" data-building="${esc(mockData.properties.find(p => p.name === c.propertyName)?.buildingId || '')}" data-search="${escapeAttr(searchText)}" class="${rowClass}">
                <td style="text-align: center;">
                    ${cbDisabled
                        ? ''
                        : `<input type="checkbox" class="contract-bundle-cb" data-id="${esc(c.id)}" aria-label="選取合約 ${esc(c.id)}">`}
                </td>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <strong style="font-size: var(--text-base);">${esc(c.id)}${c.parentContractId ? ` <span style="font-size: var(--text-2xs); color: var(--text-muted);">續自 ${esc(c.parentContractId)}</span>` : ''}${c.paymentChannel === 'platform' ? ` <span class="status-badge info" style="font-size: var(--text-2xs); margin-left: 0.25rem;" title="外部平台代收，不開帳單">🌐 ${esc(c.platformName || '外部平台')}</span>` : ''}${c.contractType === 'managed-owner' ? ` <span class="status-badge info" style="font-size: var(--text-2xs); margin-left: 0.25rem;" title="代管 — 屋主委託合約">📋 屋主委託</span>` : ''}${c.contractType === 'managed-tenant' ? ` <span class="status-badge info" style="font-size: var(--text-2xs); margin-left: 0.25rem;" title="代管 — 住客租賃合約">🏠 代管租賃</span>` : ''}${bundleBadge}</strong>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">${esc(c.propertyName || (c.buildingId ? mockData.buildings.find(b => b.id === c.buildingId)?.name + ' (整棟)' : '') || '')}</span>
                    </div>
                </td>
                <td><strong>${esc(c.tenant || '')}</strong></td>
                <td>
                    <div style="font-size: var(--text-base); font-weight: 500;">$${(c.amount || 0).toLocaleString()}</div>
                    <div style="font-size: var(--text-xs); color: var(--text-muted);">${c.termMonths === 3 ? '3 個月期' : '1 個月期'}</div>
                </td>
                <td>${c.startDate ? `<span style="font-weight: 500;">${c.startDate}</span>` : '<span style="color: var(--text-muted)">—</span>'}</td>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        ${c.endDate ? `<span style="font-weight: 500;">${c.endDate}</span>` : '<span style="color: var(--text-muted)">—</span>'}
                        ${!isArchived && days != null ? `<span style="font-size: var(--text-xs); color: ${days < 0 ? 'var(--color-danger)' : days <= 14 ? 'var(--color-warning)' : 'var(--text-muted)'};">${daysLabel(days)}</span>` : ''}
                        ${lifecycle === 'snoozed' && c.snoozeUntil ? `<span style="font-size: var(--text-2xs); color: var(--color-info);">⏸ ${c.snoozeUntil} 再提醒</span>` : ''}
                    </div>
                </td>
                <td>${lifecycleBadge(lifecycle)}${renewIntentBadge(c)}</td>
                <td style="text-align: right;">
                    <div style="display: inline-flex; gap: 0.4rem; flex-wrap: wrap; justify-content: flex-end;">
                        ${decisionButtons}
                        ${standardButtons}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="metrics-grid">
            <div class="card metric-card"><div class="metric-header"><span>進行中合約</span><div class="metric-icon success"><i class="ph ph-file-text"></i></div></div><div class="metric-value">${activeCount}</div><div class="metric-subtext">含即將到期/待決策</div></div>
            <div class="card metric-card ${decisionCount > 0 ? 'highlight-danger' : ''}"><div class="metric-header"><span>待決策</span><div class="metric-icon danger"><i class="ph ph-warning-circle"></i></div></div><div class="metric-value" style="color: ${decisionCount > 0 ? 'var(--color-danger)' : 'var(--text-main)'};">${decisionCount}</div><div class="metric-subtext">需要續租 / 退租決定</div></div>
            <div class="card metric-card"><div class="metric-header"><span>即將到期</span><div class="metric-icon warning"><i class="ph ph-clock"></i></div></div><div class="metric-value">${expiringSoonCount}</div><div class="metric-subtext">10 天內到期</div></div>
            <div class="card metric-card"><div class="metric-header"><span>歷史合約</span><div class="metric-icon primary"><i class="ph ph-archive"></i></div></div><div class="metric-value">${archivedCount}</div><div class="metric-subtext">已續約 / 已終止</div></div>
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-file-text"></i> 合約管理</h2>
                <div class="flex gap-2">
                    <div class="search-bar" style="width: 250px;">
                        <i class="ph ph-magnifying-glass"></i>
                        <input type="text" placeholder="搜尋合約編號或租客..." style="font-size: var(--text-base);">
                    </div>
                    <button class="btn btn-outline" id="btn-ask-renewal" title="掃描 10 天內到期的合約，自動發 LINE 問租客要不要續租">
                        <i class="ph ph-chat-circle-dots"></i> 詢問續租
                    </button>
                    <button class="btn btn-primary" id="btn-new-contract" data-fab="ph-file-plus">
                        <i class="ph ph-plus"></i> 建立合約
                    </button>
                </div>
            </div>

            <!-- 館別篩選 -->
            <div class="area-filter-row mb-4">
                <button class="area-filter-btn active" data-filter-value="all" data-filter-group="area">
                    <span class="area-name">全部館別</span>
                    <span class="area-stats">共 ${enriched.length} 合約</span>
                </button>
                ${areaNames.map(name => `
                    <button class="area-filter-btn" data-filter-value="${name}" data-filter-group="area">
                        <span class="area-name">${name}</span>
                        <span class="area-stats">共 ${areaCounts[name]} 合約</span>
                    </button>
                `).join('')}
            </div>

            ${renewCounts.renew > 0 ? `
                <div class="renew-intent-banner" data-jump-filter="renew" data-jump-value="renew">
                    <div class="renew-intent-banner-icon"><i class="ph ph-confetti"></i></div>
                    <div class="renew-intent-banner-body">
                        <strong>🎉 ${renewCounts.renew} 位租客已表達續租意願</strong>
                        <small>點此只看這些合約，準備建立續租</small>
                    </div>
                    <i class="ph ph-arrow-right" style="font-size: 1.1rem; color: var(--color-success);"></i>
                </div>
            ` : ''}

            ${anyRenewIntent > 0 ? `
                <div class="filter-tabs mb-2">
                    <span class="filter-tab-label">續租意願</span>
                    <button class="filter-tab active" data-filter-value="all" data-filter-group="renew">全部 (${enriched.length})</button>
                    ${renewCounts.asking > 0 ? `<button class="filter-tab" data-filter-value="asking" data-filter-group="renew">⏳ 待回覆 (${renewCounts.asking})</button>` : ''}
                    ${renewCounts.renew > 0 ? `<button class="filter-tab" data-filter-value="renew" data-filter-group="renew">✅ 要續租 (${renewCounts.renew})</button>` : ''}
                    ${renewCounts.decline > 0 ? `<button class="filter-tab" data-filter-value="decline" data-filter-group="renew">❌ 不續租 (${renewCounts.decline})</button>` : ''}
                    ${renewCounts.inquiry > 0 ? `<button class="filter-tab" data-filter-value="inquiry" data-filter-group="renew">❓ 有問題 (${renewCounts.inquiry})</button>` : ''}
                </div>
            ` : ''}

            <div class="filter-tabs mb-4">
                <span class="filter-tab-label">狀態</span>
                <button class="filter-tab active" data-filter-value="all">全部 (${enriched.length})</button>
                <button class="filter-tab" data-filter-value="awaiting_decision">待決策 (${enriched.filter(c => c._state === 'awaiting_decision').length})</button>
                <button class="filter-tab" data-filter-value="expired">已過期 (${enriched.filter(c => c._state === 'expired').length})</button>
                <button class="filter-tab" data-filter-value="expiring_soon">即將到期 (${expiringSoonCount})</button>
                <button class="filter-tab" data-filter-value="active">進行中 (${enriched.filter(c => c._state === 'active').length})</button>
                <button class="filter-tab" data-filter-value="snoozed">已暫緩 (${enriched.filter(c => c._state === 'snoozed').length})</button>
                <button class="filter-tab" data-filter-value="renewed">已續約 (${enriched.filter(c => c._state === 'renewed').length})</button>
                <button class="filter-tab" data-filter-value="terminated">已終止 (${enriched.filter(c => c._state === 'terminated').length})</button>
                ${getMode() === 'cohousing'
                    ? `<button class="filter-tab" data-filter-value="platform" data-filter-group="channel">🌐 外部平台 (${enriched.filter(c => c.paymentChannel === 'platform').length})</button>`
                    : ''}
            </div>

            <div class="table-container">
                <!-- bundle 多選 bulk bar (只在 2+ 選擇時顯示) -->
                <div id="contracts-bulk-bar" class="contracts-bulk-bar" style="display: none; align-items: center; gap: 0.75rem; padding: 0.55rem 0.85rem; margin-bottom: 0.75rem; background: var(--color-info-bg, #e0f2fe); border: 1px solid var(--color-info, #0369a1); border-radius: 6px; font-size: var(--text-sm);">
                    <span id="contracts-bulk-count" style="font-weight: 600;">已選 0 份</span>
                    <span id="contracts-bulk-hint" style="color: var(--text-muted); font-size: var(--text-xs);"></span>
                    <div style="flex: 1;"></div>
                    <button class="btn btn-primary" id="btn-bundle-contracts" disabled style="padding: 0.3rem 0.8rem;">
                        <i class="ph ph-link"></i> 綁定為同一筆收款
                    </button>
                    <button class="btn btn-outline" id="btn-bulk-clear" style="padding: 0.3rem 0.6rem;">
                        清除
                    </button>
                </div>
                <table class="data-table contracts-table">
                    <colgroup>
                        <col style="width: 36px;">
                        <col style="width: 220px;">
                        <col style="width: 110px;">
                        <col style="width: 110px;">
                        <col style="width: 115px;">
                        <col style="width: 115px;">
                        <col style="width: 100px;">
                        <col>
                    </colgroup>
                    <thead><tr>
                        <th style="text-align: center;"><input type="checkbox" id="contracts-select-all" aria-label="全選" title="全選"></th>
                        <th class="sortable-col" data-sort-col="info" title="點擊排序">合約資訊 ${sortArrow('info', currentSort)}</th>
                        <th class="sortable-col" data-sort-col="tenant" title="點擊排序">租客 ${sortArrow('tenant', currentSort)}</th>
                        <th class="sortable-col" data-sort-col="amount" title="點擊排序">租金 ${sortArrow('amount', currentSort)}</th>
                        <th class="sortable-col" data-sort-col="start" title="點擊排序">起始日 ${sortArrow('start', currentSort)}</th>
                        <th class="sortable-col" data-sort-col="end" title="點擊排序">到期日 ${sortArrow('end', currentSort)}</th>
                        <th>狀態</th>
                        <th style="text-align: right;">操作</th>
                    </tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>

            <div class="pagination-container" style="display: flex; justify-content: center; margin-top: 2rem;">
                <div class="pagination">
                    <button class="btn btn-outline" disabled><i class="ph ph-caret-left"></i></button>
                    <span class="pagination-info">第 1 頁，共 1 頁</span>
                    <button class="btn btn-outline" disabled><i class="ph ph-caret-right"></i></button>
                </div>
            </div>
        </div>
    `;
}

// 編輯既有合約 — 視覺對齊建立流程 (showCheckinAssignmentForm)
// 區分 5 區: 床位 / 租客 / 合約期間 / 押金 / 簽署狀態 — 含 section 分隔
// 額外: 連動更新租客主檔 (phone/email/緊急聯絡人)；提示帳單由總收支表反向同步
function showContractForm(contract) {
    // 編輯時 dropdown 依當前 mode 篩 (避免共居/代管 properties 混在一起)
    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    const modeBuildingIds = new Set(mockData.buildings.filter(b => (b.mode || 'cohousing') === targetMode).map(b => b.id));
    const propertyOptions = mockData.properties
        .filter(p => modeBuildingIds.has(p.buildingId))
        .slice()
        .sort((a, b) => {
            const ba = a.buildingId || '', bb = b.buildingId || '';
            if (ba !== bb) return ba.localeCompare(bb);
            const ra = Number(a.roomNumber ?? 999), rb = Number(b.roomNumber ?? 999);
            if (ra !== rb) return ra - rb;
            return (a.bedLetter || '').localeCompare(b.bedLetter || '');
        })
        .map(p => {
            const active = activeContractFor(p.name);
            const tag = active && active.id !== contract.id
                ? ` · ⚠ ${active.tenant}住至${active.endDate}`
                : ' · 空床';
            return { value: p.name, label: `${p.name.replace('聚空間 - ', '')}${tag}` };
        });
    const tenantOptions = mockData.tenants.map(t => {
        const active = activeContractOfTenant(t.name);
        const tag = active && active.id !== contract.id
            ? ` (現住 ${active.propertyName?.replace('聚空間 - ', '') || ''} 至 ${active.endDate})`
            : '';
        return { value: t.name, label: `${t.name}${tag}` };
    });
    // 拉現任租客主檔，prefill phone/email/緊急聯絡人 (跟建立流程對齊)
    const linkedTenant = mockData.tenants.find(t => t.name === contract.tenant) || null;

    function buildTermOptions(startDate) {
        const fmt = (iso) => iso ? iso.slice(5).replace('-', '/') : '?';
        const addDays = (s, n) => {
            const d = new Date(s);
            d.setDate(d.getDate() + n);
            return d.toISOString().split('T')[0];
        };
        const end1 = startDate ? addDays(startDate, 30) : '';
        const end3 = startDate ? addDays(startDate, 90) : '';
        return [
            { value: 1, label: `1 個月${end1 ? ` · ${fmt(end1)} 到期` : ''}` },
            { value: 3, label: `3 個月${end3 ? ` · ${fmt(end3)} 到期` : ''}` }
        ];
    }
    const initialStart = contract.startDate ?? TODAY;

    openFormModal({
        title: `編輯合約：${contract.id}`,
        maxWidth: 640,
        fields: [
            // 1. 床位
            { name: '__sep_bed', type: 'section', label: '床位' },
            { name: 'propertyName', label: '床位', type: 'select', required: true, span: 2, options: propertyOptions },

            // 2. 租客
            { name: '__sep_tenant', type: 'section', label: '租客資料' },
            { name: 'tenant', label: '租客姓名', type: 'select', required: true, span: 2, options: tenantOptions, searchable: true },
            { name: 'tenantPhone', label: '電話', type: 'text', value: linkedTenant?.phone || '' },
            { name: 'tenantEmail', label: 'Email', type: 'text', value: linkedTenant?.email || '' },
            { name: 'tenantEmergency', label: '緊急聯絡人', type: 'text', span: 2, value: linkedTenant?.emergencyContact || '', placeholder: '例：王媽媽 0911-222-333' },

            // 3. 合約期間 (純日期)
            { name: '__sep_contract', type: 'section', label: '合約期間' },
            { name: 'startDate', label: '入住日期 (= 合約起始日)', type: 'date', required: true, value: initialStart },
            { name: 'termMonths', label: '合約期', type: 'select', required: true, options: buildTermOptions(initialStart), value: contract.termMonths ?? 1 },
            { name: 'endDate', label: '到期日 (留空自動算)', type: 'date', span: 2 },

            // 4. 收費方式 (先決定要不要開帳單)
            { name: '__sep_channel', type: 'section', label: '收費方式' },
            { name: 'paymentChannel', label: '收費對象', type: 'select', required: true, span: 2,
              options: [
                  { value: 'self',     label: '建立帳單' },
                  { value: 'platform', label: '外部平台代收' }
              ] },
            { name: 'platformName', label: '平台名稱', type: 'text', span: 2, placeholder: 'Airbnb / 591 / KKday' },

            // 5. 租金 + 折扣加收 + 收款 (要建帳單時才填得到)
            { name: '__sep_rent', type: 'section', label: '租金' },
            { name: 'amount', label: '月租金', type: 'number', required: true },
            { name: 'totalDue', label: '應收總額', type: 'number' },
            { name: 'adjustments', type: 'placeholder' },
            { name: 'discount', type: 'hidden', value: 0 },
            { name: 'discountReason', type: 'hidden', value: '' },
            { name: 'paidAmount', label: '已收金額', type: 'number' },
            { name: 'paymentMethod', label: '付款方式', type: 'select', options: (mockData.paymentMethods || []).map(p => ({ value: p.name, label: p.name })) },

            // 6. 押金 / 狀態
            { name: '__sep_misc', type: 'section', label: '押金 / 狀態' },
            { name: 'depositAmount', label: '押金金額', type: 'number', value: contract.depositAmount ?? 0 },
            { name: 'status', label: '簽署狀態', type: 'select', required: true, options: CONTRACT_STATUSES, value: contract.status ?? '待簽署' }
        ],
        values: (() => {
            // 找該合約的首張房租 invoice (prefill 加減項目)
            const rentInv = mockData.invoices.find(inv =>
                inv.direction === 'in' && inv.type === '房租' && inv.contractId === contract.id
            );
            let initAdjItems = [];
            try { initAdjItems = rentInv?.discountReason ? JSON.parse(rentInv.discountReason) : []; } catch {}
            const initDiscount = rentInv?.discount ?? 0;
            return {
                ...contract,
                paymentChannel: contract.paymentChannel || 'self',
                platformName: contract.platformName || '',
                tenantPhone: linkedTenant?.phone || '',
                tenantEmail: linkedTenant?.email || '',
                tenantEmergency: linkedTenant?.emergencyContact || '',
                totalDue: Math.max(0, (Number(contract.amount) || 0) * (contract.termMonths || 1) - (Number(initDiscount) || 0)),
                discount: initDiscount,
                discountReason: initAdjItems.length ? JSON.stringify(initAdjItems) : '',
                paidAmount: rentInv?.paidAmount ?? 0,
                paymentMethod: rentInv?.paymentMethod || (mockData.paymentMethods || [])[0]?.name || '匯款'
            };
        })(),
        submitLabel: '儲存變更',
        onFormMount: (form) => {
            // 模仿建立流程：合約 ID + 租客 sticky 在標題下 subtitle
            const overlay = form.closest('.modal-overlay');
            const headerEl = overlay?.querySelector('.modal-header h3');
            if (headerEl && !headerEl.parentElement.querySelector('.modal-subtitle')) {
                const sub = document.createElement('div');
                sub.className = 'modal-subtitle';
                sub.innerHTML = `合約 <span class="mono">${esc(contract.id)}</span> · 租客 <strong>${esc(contract.tenant || '—')}</strong> <span class="modal-subtitle__faded">· ${esc(contract.propertyName?.replace('聚空間 - ', '') || '')}</span>`;
                headerEl.insertAdjacentElement('afterend', sub);
            }

            // === 收費方式切換 — platform → 隱藏 platformName 以外的收款相關 ===
            const channelInput = form.querySelector('[name="paymentChannel"]');
            const platformNameWrap = form.querySelector('[name="platformName"]')?.closest('.form-group');
            // 平台代收時隱藏帳單相關欄位
            const adjustPhWrap = form.querySelector('#ph-adjustments');
            const totalDueWrap2 = form.querySelector('[name="totalDue"]')?.closest('.form-group');
            const paidAmountWrap = form.querySelector('[name="paidAmount"]')?.closest('.form-group');
            const paymentMethodWrap = form.querySelector('[name="paymentMethod"]')?.closest('.form-group');
            function syncChannelVisibility() {
                const v = channelInput?.value || 'self';
                const isPlatform = v === 'platform';
                if (platformNameWrap) platformNameWrap.style.display = isPlatform ? '' : 'none';
                [adjustPhWrap, totalDueWrap2, paidAmountWrap, paymentMethodWrap].forEach(el => {
                    if (el) el.style.display = isPlatform ? 'none' : '';
                });
            }
            syncChannelVisibility();
            channelInput?.addEventListener('change', syncChannelVisibility);

            // 起始日變更時：(1) 重算簽約期下拉的到期日標籤  (2) 若 endDate 空著自動填
            const startInput = form.querySelector('[name="startDate"]');
            const endInput = form.querySelector('[name="endDate"]');
            const termWrap = form.querySelector('.custom-select[data-name="termMonths"]');
            const amountInput = form.querySelector('[name="amount"]');
            const termInput = form.querySelector('[name="termMonths"]');
            const totalDueInput = form.querySelector('[name="totalDue"]');
            const discountInput = form.querySelector('[name="discount"]');
            const discountReasonInput = form.querySelector('[name="discountReason"]');
            const refreshTotal = () => {
                if (!totalDueInput) return;
                const amt = Number(amountInput?.value) || 0;
                const t = parseInt(termInput?.value, 10) || 1;
                const disc = Number(discountInput?.value) || 0;
                totalDueInput.value = Math.max(0, amt * t - disc);
            };

            // === 加減項目子表單 (跟新增入住流程同款) ===
            const adjustPh = form.querySelector('#ph-adjustments');
            const recalcAdjustments = () => {
                if (!adjustPh) return;
                const items = Array.from(adjustPh.querySelectorAll('.adj-row')).map(row => ({
                    kind: row.querySelector('[data-adj="kind"]').value,
                    label: row.querySelector('[data-adj="label"]').value.trim(),
                    amount: Number(row.querySelector('[data-adj="amount"]').value) || 0
                })).filter(x => x.amount > 0);
                let sub = 0, add = 0;
                items.forEach(x => x.kind === 'sub' ? (sub += x.amount) : (add += x.amount));
                const net = sub - add;
                if (discountInput) discountInput.value = net;
                if (discountReasonInput) discountReasonInput.value = items.length ? JSON.stringify(items) : '';
                refreshTotal();
            };
            const adjRowHtml = (row = { kind: 'sub', label: '', amount: '' }) => `
                <div class="adj-row" style="display: grid; grid-template-columns: 130px 1fr 120px 32px; gap: 0.5rem; align-items: center; padding: 0.55rem; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 0.4rem;">
                    <div class="adj-kind-toggle">
                        <button type="button" class="adj-kind-btn ${row.kind === 'sub' ? 'is-active' : ''}" data-kind="sub" title="折扣 / 減項">− 折扣</button>
                        <button type="button" class="adj-kind-btn ${row.kind === 'add' ? 'is-active' : ''}" data-kind="add" title="加收 / 額外費用">+ 加收</button>
                    </div>
                    <input type="hidden" data-adj="kind" value="${row.kind || 'sub'}">
                    <input data-adj="label" type="text" class="form-input" placeholder="說明 (例：季繳優惠 / 能源費)" value="${row.label || ''}" style="font-size: var(--text-sm);">
                    <input data-adj="amount" type="number" class="form-input" placeholder="金額" value="${row.amount || ''}" style="font-size: var(--text-sm); text-align: right;">
                    <button type="button" class="adj-del" title="移除這筆" style="background: none; border: none; cursor: pointer; color: var(--color-danger); font-size: 1rem; padding: 0.2rem;"><i class="ph ph-x"></i></button>
                </div>
            `;
            if (adjustPh) {
                adjustPh.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <label style="font-weight: 500; font-size: var(--text-base);">折扣 / 加收項目 <small style="color: var(--text-muted); font-weight: 400;">(可多筆)</small></label>
                        <button type="button" id="adj-add" class="btn btn-outline" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);">
                            <i class="ph ph-plus"></i> 新增項目
                        </button>
                    </div>
                    <div id="adj-list"></div>
                `;
                const listEl = adjustPh.querySelector('#adj-list');
                const addRow = (row) => {
                    const div = document.createElement('div');
                    div.innerHTML = adjRowHtml(row).trim();
                    const rowEl = div.firstChild;
                    listEl.appendChild(rowEl);
                    rowEl.querySelectorAll('input').forEach(inp => inp.addEventListener('input', recalcAdjustments));
                    rowEl.querySelector('.adj-del').addEventListener('click', () => { rowEl.remove(); recalcAdjustments(); });
                    rowEl.querySelectorAll('.adj-kind-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const kind = btn.dataset.kind;
                            rowEl.querySelectorAll('.adj-kind-btn').forEach(b => b.classList.toggle('is-active', b.dataset.kind === kind));
                            rowEl.querySelector('[data-adj="kind"]').value = kind;
                            recalcAdjustments();
                        });
                    });
                };
                adjustPh.querySelector('#adj-add').addEventListener('click', () => addRow());
                // Prefill 既有 adjustments
                let prefillItems = [];
                try { prefillItems = discountReasonInput?.value ? JSON.parse(discountReasonInput.value) : []; } catch {}
                prefillItems.forEach(it => addRow(it));
                recalcAdjustments();
            }
            const refresh = () => {
                if (termWrap?.__setOptions) termWrap.__setOptions(buildTermOptions(startInput.value));
                if (!endInput.value && startInput.value) {
                    const termRaw = form.querySelector('[name="termMonths"]').value;
                    const term = parseInt(termRaw, 10);
                    if (term) {
                        const d = new Date(startInput.value);
                        d.setDate(d.getDate() + (term === 3 ? 90 : 30));
                        endInput.value = d.toISOString().split('T')[0];
                    }
                }
                refreshTotal();
            };
            startInput.addEventListener('change', refresh);
            startInput.addEventListener('input', refresh);
            amountInput?.addEventListener('input', refreshTotal);
            termInput?.addEventListener('change', refreshTotal);
        },
        onSubmit: (values) => {
            const property = mockData.properties.find(p => p.name === values.propertyName);
            if (!property) {
                showToast('找不到對應的物件', 'danger');
                return false;
            }
            let endDate = values.endDate;
            if (!endDate && values.startDate && values.termMonths) {
                const days = parseInt(values.termMonths, 10) === 3 ? 90 : 30;
                const d = new Date(values.startDate);
                d.setDate(d.getDate() + days);  // 6/8 + 30 = 7/8 (離開日)
                endDate = d.toISOString().split('T')[0];
            }

            // 抽離 tenant 子欄位 + totalDue (顯示用) + adjustments + paidAmount/paymentMethod (寫到 invoice)
            const { tenantPhone, tenantEmail, tenantEmergency, totalDue: _td,
                    discount: adjDiscount, discountReason: adjReason,
                    paidAmount: _pa, paymentMethod: _pm,
                    ...contractValues } = values;

            const payload = {
                ...contractValues,
                termMonths: parseInt(values.termMonths, 10),
                depositAmount: parseInt(values.depositAmount, 10) || 0,
                endDate,
                signDate: values.startDate,
                propertyId: property.id,
                renewalState: contract.renewalState ?? 'active'
            };

            // 交叉防呆：床位 / 租客的合約期間不能跟既有合約重疊
            const bedOverlaps = findOverlappingBedContracts(values.propertyName, values.startDate, endDate, { excludeId: contract.id });
            if (bedOverlaps.length > 0) {
                const c = bedOverlaps[0];
                showToast(`合約期間衝突：床位 ${values.propertyName} 在 ${c.startDate} ~ ${c.endDate} 已有合約 ${c.id}（${c.tenant}）`, 'danger', 8000);
                return false;
            }
            // 同名多床合法 (一個聯絡人代表整間房) — 不擋，只 info 提醒
            const tenantOverlaps = findOverlappingTenantContracts(values.tenant, values.startDate, endDate, { excludeId: contract.id });
            if (tenantOverlaps.length > 0) {
                const c = tenantOverlaps[0];
                showToast(`提醒：${values.tenant} 還有另一份合約 ${c.id}（${c.propertyName}）`, 'info', 4000);
            }

            // 換床位 → 先釋放原床位
            if (contract.propertyName && contract.propertyName !== values.propertyName) {
                const oldProp = mockData.properties.find(p => p.name === contract.propertyName);
                if (oldProp) {
                    store.updateProperty(oldProp.id, {
                        status: '待租', tenant: null, contractId: null, contractEnd: null
                    });
                }
            }
            // 同步更新租客主檔 phone/email/緊急聯絡人 (若有變動)
            const targetTenant = mockData.tenants.find(t => t.name === values.tenant);
            if (targetTenant) {
                const patch = {};
                if (tenantPhone !== (targetTenant.phone || '')) patch.phone = tenantPhone;
                if (tenantEmail !== (targetTenant.email || '')) patch.email = tenantEmail;
                if (tenantEmergency !== (targetTenant.emergencyContact || '')) patch.emergencyContact = tenantEmergency;
                if (Object.keys(patch).length) store.updateTenant(targetTenant.id, patch);
            }
            const saved = store.updateContract(contract.id, payload);
            showToast('已更新合約', 'success');

            // 把加減項目 + 收款 寫到對應的房租 invoice — 平台代收沒帳單就不動
            if (values.paymentChannel !== 'platform') {
                const rentInv = mockData.invoices.find(inv =>
                    inv.direction === 'in' && inv.type === '房租' && inv.contractId === contract.id
                );
                if (rentInv) {
                    const newDiscount = Number(adjDiscount) || 0;
                    const newReason = adjReason || '';
                    const newPaidAmount = Number(values.paidAmount) || 0;
                    const newPaymentMethod = values.paymentMethod || rentInv.paymentMethod || '';
                    const patch = {};
                    if (newDiscount !== (rentInv.discount || 0)) patch.discount = newDiscount;
                    if (newReason !== (rentInv.discountReason || '')) patch.discountReason = newReason;
                    if (newPaidAmount !== (rentInv.paidAmount || 0)) patch.paidAmount = newPaidAmount;
                    if (newPaymentMethod !== (rentInv.paymentMethod || '')) patch.paymentMethod = newPaymentMethod;
                    // 已收金額 = 應收 → invoice status 自動轉「已繳清」
                    if ('paidAmount' in patch) {
                        const due = (Number(values.amount) || 0) * (contract.termMonths || 1) - newDiscount;
                        patch.status = newPaidAmount >= due && due > 0 ? '已繳清' : (newPaidAmount > 0 ? '部分繳' : '未繳');
                        if (newPaidAmount > 0 && !rentInv.paidDate) patch.paidDate = new Date().toISOString().slice(0, 10);
                    }
                    if (Object.keys(patch).length) store.updateInvoice(rentInv.id, patch);
                }
            }

            if (saved) {
                store.updateProperty(property.id, {
                    status: '已出租',
                    tenant: values.tenant,
                    contractId: saved.id,
                    contractEnd: endDate
                });
            }
            refreshView();
        }
    });
}

export function showContractDetails(id) {
    const c = mockData.contracts.find(x => x.id === id);
    if (!c) return;
    const state = getContractLifecycle(c, TODAY_DATE);
    const days = daysUntilExpiry(c, TODAY_DATE);
    openDetailModal({
        title: `合約 ${c.id}`,
        items: [
            { label: '生命週期', value: lifecycleBadge(state) + (days != null && state !== 'renewed' && state !== 'terminated' ? ` <span style="color: var(--text-muted); font-size: var(--text-sm);">${daysLabel(days)}</span>` : '') },
            { label: '物件', value: c.propertyName },
            { label: '租客', value: c.tenant },
            { label: '租金', value: `$${(c.amount || 0).toLocaleString()} / 月` },
            { label: '簽約期', value: c.termMonths === 3 ? '3 個月' : '1 個月' },
            { label: '起始日', value: c.startDate || '—' },
            { label: '到期日', value: c.endDate || '—' },
            { label: '簽署狀態', value: c.status },
            { label: '租客簽署檔', value: c.signedFileUrl
                ? `<button class="btn btn-outline" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs); color: var(--color-success); border-color: var(--color-success);" onclick="window.openSignedContractByPath('${c.signedFileUrl.replace(/'/g, '\\\'')}')"><i class="ph-fill ph-check-square"></i> 已收到 — 點此檢視</button>`
                : '<span style="color: var(--text-muted);">尚未收到（租客可從 LINE 傳檔回來）</span>' },
            { label: '續自', value: c.parentContractId || '—' },
            ...(c.renewalState === 'terminated' ? [{ label: '終止日', value: c.terminatedDate || '—' }] : []),
            ...(c.snoozeUntil ? [{ label: '暫緩至', value: c.snoozeUntil }] : [])
        ],
        footerHtml: `
            <button class="btn btn-outline" data-action="close-detail" type="button">關閉</button>
            <button class="btn btn-primary" data-action="edit-from-detail" type="button" data-write>
                <i class="ph ph-pencil"></i> 編輯合約
            </button>
        `,
        onMount: (overlay, closeModal) => {
            overlay.querySelector('[data-action="close-detail"]')?.addEventListener('click', closeModal);
            overlay.querySelector('[data-action="edit-from-detail"]')?.addEventListener('click', () => {
                closeModal();
                showContractForm(c);
            });
        }
    });
}

function confirmDelete(id) {
    const c = mockData.contracts.find(x => x.id === id);
    if (!c) return;
    // P0 護欄：阻擋有 invoice 連動的合約直接刪 (避免帳款消失)
    const relatedInvoices = mockData.invoices.filter(inv => inv.contractId === id);
    const blockedReason = relatedInvoices.length > 0
        ? `<div style="margin-top: 0.75rem; padding: 0.75rem; background: rgba(220, 38, 38, 0.08); border-radius: 6px; border-left: 3px solid var(--color-danger); font-size: var(--text-sm);">
              <strong>⚠ 此合約有 ${relatedInvoices.length} 筆連動帳單</strong>，會一起被刪除。
              <div style="color: var(--text-muted); font-size: var(--text-xs); margin-top: 0.3rem;">建議先「退租」保留歷史，或到帳務管理確認帳單。</div>
           </div>`
        : '';

    openConfirm({
        title: '刪除合約',
        message: `確定要刪除合約 <strong>${c.id}</strong>（${c.tenant}）嗎？歷史紀錄會永久消失，建議用「退租」而非「刪除」。${blockedReason}`,
        danger: true,
        confirmLabel: '確定刪除',
        onConfirm: () => {
            // 軟刪除：先在本機暫存 snapshot，5 秒後才推到雲端
            const contractSnap = JSON.parse(JSON.stringify(c));
            const invoicesSnap = JSON.parse(JSON.stringify(relatedInvoices));
            const propBefore = mockData.properties.find(p => p.name === c.propertyName && p.contractId === id);
            const propSnap = propBefore ? JSON.parse(JSON.stringify(propBefore)) : null;
            const tenantBefore = mockData.tenants.find(t => t.name === c.tenant);
            const tenantSnap = tenantBefore ? JSON.parse(JSON.stringify(tenantBefore)) : null;

            // 本機立刻移除 (不發 bms:delete → 不打雲端)
            mockData.contracts = mockData.contracts.filter(x => x.id !== id);
            mockData.invoices = mockData.invoices.filter(inv => inv.contractId !== id);
            if (propBefore) {
                propBefore.tenant = null;
                propBefore.contractId = null;
                propBefore.contractEnd = null;
                propBefore.status = '待租';
            }
            if (tenantBefore) {
                const stillActive = mockData.contracts.some(x => x.tenant === c.tenant && x.renewalState === 'active');
                if (!stillActive) {
                    tenantBefore.currentProperty = null;
                    tenantBefore.status = '已退租';
                }
            }
            refreshView();

            showUndoToast({
                message: `已刪除合約 ${c.id}（${c.tenant}）`,
                durationMs: 5000,
                onUndo: () => {
                    // 復原 snapshot
                    mockData.contracts.push(contractSnap);
                    invoicesSnap.forEach(inv => mockData.invoices.push(inv));
                    if (propSnap && propBefore) Object.assign(propBefore, propSnap);
                    if (tenantSnap && tenantBefore) Object.assign(tenantBefore, tenantSnap);
                    refreshView();
                    showToast('已復原', 'success');
                },
                onCommit: () => {
                    // 5 秒過後才真正推到雲端 DELETE
                    window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'contracts', id: contractSnap.id } }));
                    invoicesSnap.forEach(inv => {
                        window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'invoices', id: inv.id } }));
                    });
                    // properties/tenants 改動走 persist (UPSERT)
                    window.dispatchEvent(new CustomEvent('bms:persist'));
                }
            });
        }
    });
}

// 取得合約對應的床位 → 推出 buildingId
function getContractBuildingId(c) {
    const property = mockData.properties.find(p => p.name === c.propertyName);
    return property?.buildingId || null;
}

// 取出床號（例：'聚空間 - 松山館 R1-A' → 'R1-A'）
function getBedNo(c) {
    const m = (c.propertyName || '').match(/R\d+-[A-Z]/);
    return m ? m[0] : '';
}

// 點 ✅ 綠色簽署檔按鈕 → 動態產 signed URL → 開新分頁
async function openSignedFile(c) {
    if (!c.signedFileUrl) return;
    try {
        const url = await resolveSignedPdfUrl(c.signedFileUrl);
        window.open(url, '_blank', 'noopener');
    } catch (e) {
        showToast(`開啟失敗：${e.message}`, 'danger', 5000);
    }
}

// 暴露給 detail modal 的 inline onclick 用 (HTML 內 onclick 沒辦法 import)
window.openSignedContractByPath = async (pathOrUrl) => {
    if (!pathOrUrl) return;
    try {
        const url = await resolveSignedPdfUrl(pathOrUrl);
        window.open(url, '_blank', 'noopener');
    } catch (e) {
        alert(`開啟失敗：${e.message}`);
    }
};

async function downloadContractPdf(id) {
    const c = mockData.contracts.find(x => x.id === id);
    if (!c) return;

    const buildingId = getContractBuildingId(c);
    const tpl = store.getContractTemplate(buildingId);
    if (!tpl) {
        const building = mockData.buildings.find(b => b.id === buildingId);
        showToast(`「${building?.name || '此館'}」尚未上傳合約樣板，請至 系統設定 → 合約範本 上傳`, 'warning', 5000);
        return;
    }
    if (!tpl.pdfBase64) {
        showToast(`合約樣板資料不完整 (PDF 內容缺失)，請至 系統設定 → 合約範本 重新上傳`, 'danger', 5000);
        return;
    }

    try {
        const adj = buildAdjustmentValues(c);
        const values = {
            bed_no: getBedNo(c),
            tenant_name: c.tenant || '',
            rental_period: formatRentalPeriod(c.startDate, c.endDate),
            rent_amount: (c.amount || 0).toLocaleString(),
            deposit_amount: (c.depositAmount || 0).toLocaleString(),
            adjustments: adj.adjustments,        // 折扣 / 加收 多行明細
            total_amount: adj.total_amount,      // 租金總額 = 月租 × term + 加 − 折
            monthly_amount: adj.monthly_amount   // 月付金額 = 租金總額 ÷ term
        };
        const { bytes, filledFields, missingFields } = await fillContractPdf(tpl.pdfBase64, values);

        if (filledFields.length === 0) {
            showToast(`樣板沒有任何可填入欄位，請至 系統設定 → 合約範本 → 檢查欄位`, 'danger', 5000);
            return;
        }

        const filename = `合約_${c.id}_${c.tenant}_${c.startDate || ''}.pdf`;
        downloadPdfBytes(bytes, filename);

        if (missingFields.length > 0) {
            showToast(`✅ 已下載 (${filledFields.length} 個欄位填入，${missingFields.length} 個未在樣板中)`, 'success');
        } else {
            showToast(`✅ 合約 PDF 已下載：${filename}`, 'success');
        }
    } catch (e) {
        showToast(`產生 PDF 失敗：${e.message}`, 'danger', 5000);
    }
}

// 產生 PDF → 上傳 Supabase Storage → 推到租客 LINE
async function sendContractToLine(id) {
    const c = mockData.contracts.find(x => x.id === id);
    if (!c) return;
    const tenant = mockData.tenants.find(t => t.name === c.tenant);
    if (!tenant) { showToast(`找不到租客 ${c.tenant}`, 'danger'); return; }
    if (!tenant.lineUserId) {
        showToast(`${tenant.name} 尚未綁定 LINE，請先請他加 LINE 官方帳號並回覆手機號`, 'warning', 7000);
        return;
    }

    const buildingId = getContractBuildingId(c);
    const tpl = store.getContractTemplate(buildingId);
    if (!tpl) {
        showToast(`此館尚未上傳合約樣板`, 'warning');
        return;
    }
    if (!tpl.pdfBase64) {
        showToast(`合約樣板資料不完整 (PDF 內容缺失)，請重新上傳`, 'danger', 5000);
        return;
    }

    showToast('產生 PDF 中…', 'info');
    try {
        const adj = buildAdjustmentValues(c);
        const values = {
            bed_no: getBedNo(c),
            tenant_name: c.tenant || '',
            rental_period: formatRentalPeriod(c.startDate, c.endDate),
            rent_amount: (c.amount || 0).toLocaleString(),
            deposit_amount: (c.depositAmount || 0).toLocaleString(),
            adjustments: adj.adjustments,
            total_amount: adj.total_amount,
            monthly_amount: adj.monthly_amount
        };
        const { bytes } = await fillContractPdf(tpl.pdfBase64, values);
        const filename = `合約_${c.id}_${c.tenant}.pdf`;

        showToast('上傳到雲端…', 'info');
        const { url: fileUrl } = await uploadPdfToStorage(filename, bytes);

        showToast('推送到 LINE…', 'info');
        await pushToTenant(tenant.id, {
            message: `${c.tenant} 您好，這是您的合約 (${c.id})\n租期：${c.startDate} ~ ${c.endDate}\n月租：$${(c.amount || 0).toLocaleString()}\n\n連結 24 小時內有效`,
            fileUrl,
            fileName: filename
        });

        showToast(`✅ 已傳送到 ${tenant.name} 的 LINE`, 'success', 4000);
    } catch (e) {
        showToast(`發送失敗：${e.message}`, 'danger', 7000);
    }
}

// === 三種決策動作 ===

export function confirmRenew(id) {
    const c = mockData.contracts.find(x => x.id === id);
    if (!c) return;
    const days = c.termMonths === 3 ? 90 : 30;
    const newStart = new Date(c.endDate);
    newStart.setDate(newStart.getDate() + 1);
    const newEnd = new Date(newStart);
    newEnd.setDate(newEnd.getDate() + days - 1);
    const newStartStr = newStart.toISOString().split('T')[0];
    const newEndStr = newEnd.toISOString().split('T')[0];

    openConfirm({
        title: '🔄 確認續租',
        message: `將為 <strong>${c.tenant}</strong> 自動建立下一期合約：
            <div style="margin-top: 1rem; padding: 0.875rem; background-color: var(--color-background); border-radius: var(--radius-md); font-size: var(--text-base); line-height: 1.8;">
                <div><strong>物件：</strong>${c.propertyName}</div>
                <div><strong>租金：</strong>$${(c.amount || 0).toLocaleString()} / 月（沿用）</div>
                <div><strong>新期間：</strong>${newStartStr} ~ ${newEndStr}（${c.termMonths === 3 ? '3 個月' : '1 個月'}）</div>
            </div>
            <p style="margin-top: 1rem; font-size: var(--text-xs); color: var(--text-muted);">舊合約 ${c.id} 將標記為「已續約」。</p>`,
        confirmLabel: '確認續租',
        onConfirm: () => {
            const result = store.renewContract(id);
            if (result.error) {
                showToast(`續租失敗：${result.error}`, 'danger');
                return;
            }
            showToast(`已續租，新合約 ${result.newContract.id}`, 'success');
            refreshView();
        }
    });
}

export function confirmTerminate(id) {
    const c = mockData.contracts.find(x => x.id === id);
    if (!c) return;
    // 計算影響範圍：剩下幾期未繳 invoice、原訂到期日剩幾天
    const today = TODAY;
    const pendingInvoices = mockData.invoices.filter(i =>
        i.direction === 'in' && i.tenant === c.tenant
        && (i.status === '欠繳' || i.status === '未付' || i.status === '部分繳款')
        && i.dueDate && i.dueDate >= today
    );
    const daysLeft = c.endDate
        ? Math.floor((new Date(c.endDate) - new Date(today)) / 86400000)
        : null;

    const summaryHtml = `
        <div style="margin-bottom: 1rem; padding: 0.875rem 1rem; background-color: var(--color-background); border-radius: var(--radius-md); font-size: var(--text-sm); line-height: 1.7;">
            <div style="font-weight: 600; margin-bottom: 0.5rem; color: var(--text-main);">
                <i class="ph ph-info" style="color: var(--color-warning);"></i> 退租會做這些事:
            </div>
            <div><strong>合約：</strong>${c.id} · ${c.propertyName?.replace('聚空間 - ', '') || '?'}</div>
            <div><strong>租客：</strong>${c.tenant}</div>
            <div><strong>原訂到期：</strong>${c.endDate || '—'}${daysLeft != null ? `（剩 ${daysLeft} 天）` : ''}</div>
            <hr style="margin: 0.5rem 0; border: none; border-top: 1px dashed var(--border-color);">
            <div style="color: var(--text-muted); font-size: var(--text-xs);">退租送出後會：</div>
            <ul style="margin: 0.25rem 0 0 1.25rem; padding: 0; color: var(--text-main); font-size: var(--text-xs);">
                <li>合約 ${c.id} 狀態 → <strong style="color: var(--color-danger);">已終止</strong></li>
                <li>床位 ${c.propertyName?.match(/R\d+-[A-Z]/)?.[0] || '?'} 變回 <strong>待租</strong></li>
                <li>租客 ${c.tenant} 若無其他合約 → 狀態 <strong>已退租</strong></li>
                ${pendingInvoices.length > 0
                    ? `<li style="color: var(--color-warning);"><strong>⚠ ${pendingInvoices.length} 筆未結帳款</strong>仍會保留 (不會自動作廢)</li>`
                    : '<li>無未結帳款</li>'}
            </ul>
        </div>
    `;

    openFormModal({
        title: '🚪 確認退租',
        maxWidth: 560,
        headerHtml: summaryHtml,
        fields: [
            { name: 'effectiveDate', label: '退租生效日', type: 'date', required: true, value: today, span: 2 },
            { name: 'note', label: '備註（選填）', type: 'textarea', span: 2, rows: 2, placeholder: '例：房況點交完成、無損壞' }
        ],
        values: {},
        submitLabel: '確認退租',
        onSubmit: (values) => {
            // P0 護欄: 退租前 snapshot 涉及的 contract + property + tenant 狀態
            const contractSnap = JSON.parse(JSON.stringify(c));
            const propBefore = mockData.properties.find(p => p.name === c.propertyName);
            const propSnap = propBefore ? JSON.parse(JSON.stringify(propBefore)) : null;
            const tenantBefore = mockData.tenants.find(t => t.name === c.tenant);
            const tenantSnap = tenantBefore ? JSON.parse(JSON.stringify(tenantBefore)) : null;

            const result = store.terminateContract(id, { effectiveDate: values.effectiveDate });
            if (result.error) {
                showToast(`退租失敗：${result.error}`, 'danger');
                return false;
            }
            refreshView();
            showUndoToast({
                message: `已退租 ${c.tenant} · ${c.propertyName?.replace('聚空間 - ', '') || ''}`,
                durationMs: 5000,
                onUndo: () => {
                    // 把 3 個物件的 snapshot 蓋回去
                    const cur = mockData.contracts.find(x => x.id === id);
                    if (cur) Object.assign(cur, contractSnap);
                    if (propBefore && propSnap) Object.assign(propBefore, propSnap);
                    if (tenantBefore && tenantSnap) Object.assign(tenantBefore, tenantSnap);
                    refreshView();
                    showToast('已復原退租', 'success');
                },
                onCommit: () => {
                    // commit 後才推到雲端
                    window.dispatchEvent(new CustomEvent('bms:persist'));
                }
            });
        }
    });
}

export function confirmSnooze(id) {
    const c = mockData.contracts.find(x => x.id === id);
    if (!c) return;
    openFormModal({
        title: '⏸ 暫緩決策',
        maxWidth: 420,
        fields: [
            { name: 'days', label: '暫緩天數', type: 'number', required: true, value: 3, hint: '到期後系統會重新跳出決策' }
        ],
        values: { days: 3 },
        submitLabel: '確認暫緩',
        onSubmit: (values) => {
            const days = parseInt(values.days, 10);
            if (isNaN(days) || days < 1) {
                showToast('天數需大於 0', 'danger');
                return false;
            }
            const result = store.snoozeContract(id, days);
            showToast(`已暫緩至 ${result.until}`, 'info');
            refreshView();
        }
    });
}

export function initContractActions(scope) {
    // 新增合約 → 走統一的「新增入住」流程 (建合約+帳單+床位+租客+checkin 一氣呵成)
    scope.querySelector('#btn-new-contract')?.addEventListener('click', () => showCheckinAssignmentForm());

    // 「N 位租客已表達續租意願」banner → 自動套上「✅ 要續租」filter
    scope.querySelector('.renew-intent-banner')?.addEventListener('click', () => {
        const chip = scope.querySelector('[data-filter-value="renew"][data-filter-group="renew"]');
        if (chip) chip.click();
    });

    // 詢問續租 — 觸發 Edge Function renewal-poll (10 天前發)
    scope.querySelector('#btn-ask-renewal')?.addEventListener('click', async () => {
        const expiringSoon = filterContractsByMode(mockData.contracts).filter(c => {
            if (c.renewalState !== 'active') return false;
            if (!c.endDate) return false;
            const today = new Date().toISOString().slice(0, 10);
            const in15 = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
            return c.endDate >= today && c.endDate <= in15;
        });
        if (expiringSoon.length === 0) {
            showToast('10 天內沒有要到期的合約，不用發', 'info', 3000);
            return;
        }
        openConfirm({
            title: '詢問續租意願',
            message: `將自動掃描 <strong>10 天內到期</strong>的合約，發 LINE 問租客是否續租。<br><br>` +
                     `目前符合條件的合約有 <strong>${expiringSoon.length}</strong> 筆。<br>` +
                     `<small style="color: var(--text-muted);">注意：5 天內已問過的會自動跳過。租客未綁 LINE 的也會跳過。</small>`,
            confirmLabel: `🚀 開始發送`,
            onConfirm: async () => {
                showToast('掃描中…', 'info', 2000);
                try {
                    const result = await triggerRenewalPoll({ daysAhead: 15 });
                    const lines = [
                        `✅ 發送完成`,
                        `· 已發 ${result.sent || 0} 筆`,
                        `· 未綁 LINE 跳過 ${result.skipped_no_line || 0} 筆`,
                        `· 近期問過跳過 ${result.skipped_already_asked || 0} 筆`,
                        ...((result.failed || 0) > 0 ? [`· ⚠ 失敗 ${result.failed} 筆 (見 console)`] : [])
                    ];
                    showToast(lines.join('  '), result.failed > 0 ? 'warning' : 'success', 6000);
                    console.log('[renewal-poll] 結果:', result);
                    setTimeout(() => refreshView(), 1500); // 等 realtime 同步回來
                } catch (e) {
                    showToast(`發送失敗：${e.message}`, 'danger', 6000);
                    console.error('[renewal-poll]', e);
                }
            }
        });
    });

    // 點表頭排序 — 同欄切換 asc/desc，再點一次切回預設 (lifecycle)；切其他欄重置 asc
    scope.querySelectorAll('.sortable-col').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sortCol;
            const cur = getCurrentSort();
            let next;
            if (cur.col !== col) next = `${col}-asc`;
            else if (cur.dir === 'asc') next = `${col}-desc`;
            else next = '';
            if (next) localStorage.setItem(SORT_STORAGE_KEY, next);
            else localStorage.removeItem(SORT_STORAGE_KEY);
            refreshView();
        });
    });
    scope.querySelectorAll('.contract-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const id = e.currentTarget.dataset.id;
            const c = mockData.contracts.find(x => x.id === id);
            if (!c) return;
            if (action === 'view') showContractDetails(id);
            if (action === 'edit') showContractForm(c);
            if (action === 'download') downloadContractPdf(id);
            if (action === 'send-line') sendContractToLine(id);
            if (action === 'view-signed') openSignedFile(c);
            if (action === 'delete') confirmDelete(id);
            if (action === 'renew') confirmRenew(id);
            if (action === 'terminate') confirmTerminate(id);
            if (action === 'snooze') confirmSnooze(id);
            if (action === 'unbundle-self') confirmUnbundle([id]);
            if (action === 'unbundle-group') {
                // 主合約被點 → 解除所有子合約
                const children = mockData.contracts.filter(x => x.bundleParentContractId === id).map(x => x.id);
                if (children.length) confirmUnbundle(children);
            }
        });
    });

    // === bundle 收款多選 + 綁定 modal ===
    const bulkBar = scope.querySelector('#contracts-bulk-bar');
    const bulkCount = scope.querySelector('#contracts-bulk-count');
    const bulkHint = scope.querySelector('#contracts-bulk-hint');
    const bundleBtn = scope.querySelector('#btn-bundle-contracts');
    const selectAllCb = scope.querySelector('#contracts-select-all');
    const checkboxes = scope.querySelectorAll('.contract-bundle-cb');

    const getSelectedIds = () => Array.from(scope.querySelectorAll('.contract-bundle-cb:checked')).map(cb => cb.dataset.id);

    const updateBulkBar = () => {
        const ids = getSelectedIds();
        if (ids.length === 0) {
            if (bulkBar) bulkBar.style.display = 'none';
            return;
        }
        if (bulkBar) bulkBar.style.display = 'flex';
        if (bulkCount) bulkCount.textContent = `已選 ${ids.length} 份`;
        // 驗證: 至少 2 份、同租客、同 building、都不是 platform
        const selectedRows = ids
            .map(id => scope.querySelector(`tr[data-row-id="${CSS.escape(id)}"]`))
            .filter(Boolean);
        const tenants = new Set(selectedRows.map(tr => tr.dataset.tenant));
        const buildings = new Set(selectedRows.map(tr => tr.dataset.building));
        const channels = new Set(selectedRows.map(tr => tr.dataset.channel));
        let reason = '';
        let canBundle = true;
        if (ids.length < 2) { canBundle = false; reason = '需至少選 2 份合約'; }
        else if (tenants.size > 1) { canBundle = false; reason = '需同租客 (目前選了 ' + tenants.size + ' 位)'; }
        else if (buildings.size > 1) { canBundle = false; reason = '需同館 (跨館不能綁同筆收款)'; }
        else if (channels.has('platform')) { canBundle = false; reason = '外部平台合約不能綁定'; }
        if (bundleBtn) bundleBtn.disabled = !canBundle;
        if (bulkHint) bulkHint.textContent = canBundle ? '✓ 可綁定 — 選一份為主合約' : `⚠ ${reason}`;
    };

    checkboxes.forEach(cb => cb.addEventListener('change', () => {
        // 任一手動點 → unmatch select-all
        if (selectAllCb) selectAllCb.checked = false;
        updateBulkBar();
    }));

    selectAllCb?.addEventListener('change', () => {
        const checked = selectAllCb.checked;
        checkboxes.forEach(cb => { cb.checked = checked; });
        updateBulkBar();
    });

    scope.querySelector('#btn-bulk-clear')?.addEventListener('click', () => {
        checkboxes.forEach(cb => { cb.checked = false; });
        if (selectAllCb) selectAllCb.checked = false;
        updateBulkBar();
    });

    bundleBtn?.addEventListener('click', () => {
        const ids = getSelectedIds();
        if (ids.length < 2) return;
        const contracts = ids.map(id => mockData.contracts.find(c => c.id === id)).filter(Boolean);
        // 選主合約 modal (用 openConfirm 客製內容)
        const radios = contracts.map((c, idx) => `
            <label style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem; border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 0.4rem; cursor: pointer;">
                <input type="radio" name="bundle-primary" value="${esc(c.id)}" ${idx === 0 ? 'checked' : ''}>
                <div style="flex: 1;">
                    <div style="font-weight: 600;">${esc(c.id)} <span style="color: var(--text-muted); font-size: var(--text-xs);">${esc(c.propertyName?.replace('聚空間 - ', '') || '')}</span></div>
                    <div style="font-size: var(--text-xs); color: var(--text-muted);">月租 $${(c.amount || 0).toLocaleString()} · ${c.startDate || '—'} ~ ${c.endDate || '—'}</div>
                </div>
            </label>
        `).join('');
        const total = contracts.reduce((s, c) => s + (Number(c.amount) || 0), 0);
        const term = contracts[0]?.termMonths || 1;
        openConfirm({
            title: '綁定為同一筆收款',
            message: `
                <div style="font-size: var(--text-sm); color: var(--text-muted); margin-bottom: 0.75rem;">
                    選一份為「主合約」(保留 invoice、收款記錄)，其餘變子合約 (invoice 併入主合約)
                </div>
                <div style="margin-bottom: 0.75rem;">${radios}</div>
                <div style="padding: 0.6rem; background: var(--bg-tertiary); border-radius: 6px; font-size: var(--text-sm);">
                    <div>合併後主合約應收 = <strong>$${(total * term).toLocaleString()}</strong> <span style="color: var(--text-muted); font-size: var(--text-xs);">(月租合計 $${total.toLocaleString()} × ${term} 期)</span></div>
                    <div style="color: var(--color-warning); font-size: var(--text-xs); margin-top: 0.3rem;">⚠ 子合約原本的 invoice / 收款記錄會被刪除。請確認以主合約 invoice 為準。</div>
                </div>
            `,
            confirmLabel: '確認綁定',
            onConfirm: () => {
                const overlay = document.querySelector('.modal-overlay');
                const selected = overlay?.querySelector('input[name="bundle-primary"]:checked')?.value;
                if (!selected) {
                    showToast('請選一份為主合約', 'warning', 3000);
                    return false;
                }
                const childIds = ids.filter(id => id !== selected);
                const result = store.bundleContracts(selected, childIds);
                if (!result.ok) {
                    showToast(`綁定失敗：${result.msg}`, 'danger', 4000);
                    return false;
                }
                showToast(`✅ 已綁定 ${childIds.length + 1} 份合約為同一筆收款`, 'success', 3500);
                refreshView();
            }
        });
    });

    // 初始 update (給 refresh 後 reattach 用)
    updateBulkBar();
}

function confirmUnbundle(childIds) {
    if (!childIds || !childIds.length) return;
    const labels = childIds.join('、');
    openConfirm({
        title: '解除收款綁定',
        message: `
            <div>確定要解除以下合約的收款綁定?</div>
            <div style="margin: 0.6rem 0; padding: 0.5rem; background: var(--bg-tertiary); border-radius: 6px; font-family: monospace;">${labels}</div>
            <div style="color: var(--color-warning); font-size: var(--text-xs);">⚠ 將為這些合約重新建立獨立 invoice (paid=0)，主合約 invoice 也會扣除這部份金額。</div>
        `,
        confirmLabel: '確認解除',
        confirmType: 'warning',
        onConfirm: () => {
            const result = store.unbundleContracts(childIds);
            if (!result.ok) {
                showToast(`解除失敗：${result.msg}`, 'danger', 4000);
                return false;
            }
            showToast(`✅ 已解除 ${childIds.length} 份合約的綁定`, 'success', 3500);
            refreshView();
        }
    });
}
