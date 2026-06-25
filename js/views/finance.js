// 總收支表 — 只顯示「已結帳目」的條目清單
// 各館分析 / 交叉表 → 移到「收支分析」分頁
// 待結帳款 → 「待結帳款」分頁
import { mockData, store, invoiceMonth, shiftMonth, currentMonth, formatMonthLabel, isSettled, getSortedBuildings, invoiceActualAmount as actualAmount, formatDiscountReason, leaseEndISO, isPreCutoff, FINANCE_CUTOFF_DATE } from '../data.js';
import { initAdjustmentsWidget } from '../utils/adjustmentsWidget.js';
import { renderFinanceSubTabs } from '../utils/financeSubTabs.js';
import { openFormModal, openConfirm, openDetailModal, showToast, showUndoToast, refreshView } from '../utils/ui.js';
import { showTenantForm } from './tenants.js';
import { financeState } from './finance-state.js';
import { exportFinanceReport } from './finance-export.js';
import { escapeHtml } from '../utils/escape.js';
import { filterInvoicesByMode } from '../utils/modeFilter.js';
import { getMode } from '../utils/appMode.js';
import { moneyAmount, adjustmentBadge } from '../utils/moneyDisplay.js';
import { rowAction, rowActionGroup } from '../utils/rowActions.js';
import { emptyState } from '../utils/emptyState.js';

const TODAY = new Date().toISOString().split('T')[0];

// 把 invoice.note 裡的合約 ID (例: "C001" / "C-001") 換成可點擊連結
// note 內容是內部產生 (e.g. buildContractInvoice 帶 contract.id 進去) — 不用怕 XSS，但仍 escape
function linkifyNoteContracts(rawNote) {
    if (!rawNote) return '<span style="color: var(--text-muted)">—</span>';
    const escaped = escapeHtml(rawNote);
    return escaped.replace(/\b(C-?\d{3,})\b/g, (m, cid) =>
        `<button type="button" class="contract-link" data-action="open-contract" data-cid="${cid}" title="跳到合約 ${cid}" style="background: none; border: none; padding: 0; color: var(--color-primary); cursor: pointer; font: inherit; text-decoration: underline;">${cid}</button>`
    );
}
// 表格排序狀態 (各欄位通用)
let sortField = 'date';  // 'date' | 'building' | 'type' | 'item' | 'amount' | 'note'
let sortDesc = true;     // true = 大→小 / 新→舊 / Z→A

function buildingName(buildingId) {
    return mockData.buildings.find(b => b.id === buildingId)?.name || '—';
}

function plusDays(dateStr, days) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

// 聚合多筆 invoices 成 { inAll, outAll, landlordRent, net, grossMargin, netMargin }
// 用「實收金額」(paidAmount) 計算，無 paidAmount 的舊資料退回 amount
// actualAmount 從 data.js import (P1-13 抽共用)
function computeAgg(invoices) {
    const inAll = invoices.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
    const outAll = invoices.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
    const landlordRent = invoices.filter(i => i.direction === 'out' && i.type === '房東租金').reduce((s, i) => s + actualAmount(i), 0);
    const net = inAll - outAll;
    const grossMargin = inAll > 0 ? (inAll - landlordRent) / inAll : 0;
    const netMargin = inAll > 0 ? net / inAll : 0;
    return { inAll, outAll, landlordRent, net, grossMargin, netMargin };
}

function pct(v) {
    return `${(v * 100).toFixed(1)}%`;
}

// 表格 header — 可排序欄位
// icon 包進固定寬度 span，避免不同 caret 圖示寬度不同造成 header 抖動
function sortHeader(label, field, align = 'left') {
    const isActive = sortField === field;
    const icon = isActive ? (sortDesc ? 'ph-caret-down' : 'ph-caret-up') : 'ph-caret-up-down';
    const opacity = isActive ? 1 : 0.35;
    const color = isActive ? 'color: var(--color-warning);' : '';
    return `
        <th style="cursor: pointer; user-select: none; text-align: ${align}; ${color}" data-action="sort" data-sort-field="${field}" title="點擊排序">
            ${label}<span style="display: inline-block; width: 1.1em; text-align: center; margin-left: 3px; opacity: ${opacity};"><i class="ph ${icon}" style="font-size: var(--text-2xs); vertical-align: middle;"></i></span>
        </th>
    `;
}

export function renderFinance() {
    const getSortVal = (inv) => {
        switch (sortField) {
            case 'date':     return inv.paidDate || inv.dueDate || '';
            case 'building': return buildingName(inv.buildingId);
            case 'type':     return inv.type || '';
            case 'item':     return inv.tenant || inv.contractId || '';
            case 'amount':   return inv.direction === 'out' ? -(inv.amount || 0) : (inv.amount || 0);
            case 'note':     return inv.note || '';
            default:         return '';
        }
    };
    const monthInvoices = filterInvoicesByMode(mockData.invoices)
        .filter(inv => !isPreCutoff(inv))  // 起算自 FINANCE_CUTOFF_DATE, pre-cutoff 不算
        .filter(inv => isSettled(inv) && invoiceMonth(inv) === financeState.viewMonth)
        .sort((a, b) => {
            const va = getSortVal(a), vb = getSortVal(b);
            let cmp = 0;
            if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
            else cmp = String(va).localeCompare(String(vb));
            return sortDesc ? -cmp : cmp;
        });

    const summary = computeAgg(monthInvoices);
    const inCount = monthInvoices.filter(i => i.direction === 'in').length;
    const outCount = monthInvoices.filter(i => i.direction === 'out').length;
    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    const activeBuildings = getSortedBuildings({ activeOnly: true })
        .filter(b => (b.mode || 'cohousing') === targetMode);

    // 類別 → type-chip class (語意色)
    // ⚠ 用戶硬規則: 房租=in (住客付給我們) ≠ 租金=out (我們付給房東) 絕對不能同色
    // direction 判斷讓 typeChip 分流: in→橘(房租) / out→灰(misc)，免得審帳被視覺混淆
    function typeChip(type, direction) {
        const t = String(type || '');
        if (direction === 'out') {
            // 支出類: 不管 type 名字是「租金」/「房東租金」一律走 misc 灰
            if (/水|電|瓦斯|能源|管理費|網路|寬頻/.test(t)) return { cls: 'utility', icon: 'ph-lightning' };
            return { cls: 'misc', icon: 'ph-tag' };
        }
        // 收入類 (direction === 'in' 或 undefined)
        if (/房租|^租$/.test(t)) return { cls: 'rent', icon: 'ph-house' };
        if (/押/.test(t))         return { cls: 'deposit', icon: 'ph-vault' };
        return { cls: 'misc', icon: 'ph-tag' };
    }

    // 表格列 — 直覺排序：日期 / 館別 / 類別 / 項目 / 金額 / 備註 / 操作
    // 列底色用顏色區分收入(綠)/支出(紅) — 不再單獨一欄寫「方向」
    const tableRows = monthInvoices.map(inv => {
        const statusAttr = inv.direction;
        const areaAttr = buildingName(inv.buildingId);
        // 項目 = 收入時顯示租客 / 支出時顯示合約 ID 或「整館共用」
        const itemText = inv.direction === 'in'
            ? (inv.tenant ? `<strong>${inv.tenant}</strong>` : '<span style="color: var(--text-muted)">—</span>')
            : (inv.contractId
                ? `<strong>合約 <button type="button" class="contract-link" data-action="open-contract" data-cid="${inv.contractId}" title="跳到合約 ${inv.contractId}" style="background: none; border: none; padding: 0; color: var(--color-primary); cursor: pointer; font: inherit; text-decoration: underline;">${inv.contractId}</button></strong>`
                : '<span style="color: var(--text-muted);">整館共用</span>');
        const periodText = inv.periodStart && inv.periodEnd
            ? `<div style="font-size: var(--text-2xs); color: var(--text-muted);">租期 ${inv.periodStart.slice(5)}~${inv.periodEnd.slice(5)}</div>`
            : '';
        const propertyText = inv.propertyName
            ? `<div style="font-size: var(--text-2xs); color: var(--text-muted);">${inv.propertyName.replace('聚空間 - ', '')}</div>`
            : '';
        const searchText = [inv.id, inv.propertyName || '', inv.tenant || '', inv.type, areaAttr, inv.note || '', inv.contractId || '', inv.paymentMethod || ''].join(' ').toLowerCase();
        const amountSign = inv.direction === 'out' ? '-' : '+';
        const amountColor = inv.direction === 'out' ? 'var(--color-danger)' : 'var(--color-success)';
        const shown = actualAmount(inv);
        // discount > 0 = 折扣 (顯 -$X 紅減)；discount < 0 = 加收 (顯 +$X 黃加)
        const hasAdjustment = inv.discount != null && Number(inv.discount) !== 0;
        const isAddOn = Number(inv.discount) < 0;
        const adjAbs = Math.abs(Number(inv.discount) || 0).toLocaleString();
        const adjSign = isAddOn ? '+' : '-';
        const adjColor = isAddOn ? 'var(--color-info)' : 'var(--color-warning)';
        const discountCell = hasAdjustment
            ? `<div style="display: flex; flex-direction: column; gap: 1px; align-items: flex-end;">
                   ${adjustmentBadge(inv.discount)}
                   ${inv.discountReason ? `<span style="font-size: var(--text-2xs); color: var(--text-muted);">${formatDiscountReason(inv.discountReason, { labelsOnly: true })}</span>` : ''}
               </div>`
            : '<span style="color: var(--text-muted); font-size: var(--text-xs);">—</span>';
        const methodCell = inv.paymentMethod
            ? `<span style="font-size: var(--text-xs);">${inv.paymentMethod}</span>`
            : '<span style="color: var(--text-muted); font-size: var(--text-xs);">—</span>';

        // v3 卡片 (mobile-only): 租客 + 金額 hero / type 語意色 chip / 副資訊區 chip 列 / 備註獨立區
        const tc = typeChip(inv.type, inv.direction);
        const tenantName = inv.direction === 'in'
            ? (inv.tenant || '—')
            : (inv.contractId ? `合約 ${inv.contractId}` : '整館共用');
        const placeName = inv.propertyName ? inv.propertyName.replace('聚空間 - ', '') : areaAttr;
        const dateText = inv.paidDate || inv.dueDate || '—';
        const periodChip = (inv.periodStart && inv.periodEnd)
            ? `<span class="c-chip"><i class="ph ph-clock"></i> 租期 ${inv.periodStart.slice(5)} ~ ${inv.periodEnd.slice(5)}</span>`
            : '';
        const contractChip = inv.contractId
            ? `<span class="c-chip"><i class="ph ph-hash"></i> ${inv.contractId}</span>`
            : '';
        const directionBadge = inv.direction === 'in'
            ? '<span class="status-badge success">收入</span>'
            : '<span class="status-badge danger">支出</span>';
        const heroAmtClass = inv.direction === 'in' ? 'income' : 'expense';
        const discountVal = hasAdjustment
            ? `${adjustmentBadge(inv.discount)}${inv.discountReason ? ` <span class="c-meta-val-sub">${formatDiscountReason(inv.discountReason, { labelsOnly: true })}</span>` : ''}`
            : '<span class="c-meta-val-muted">—</span>';
        const paymentVal = inv.paymentMethod || '<span class="c-meta-val-muted">—</span>';
        const noteSection = (inv.note && inv.note.trim())
            ? `<div class="c-note">
                  <span class="c-meta-cap">備註</span>
                  <div class="c-note-text">${escapeHtml(inv.note)}</div>
               </div>`
            : '';

        return `
            <tr data-row-id="${inv.id}" data-status="${statusAttr}" data-area="${areaAttr}" data-search="${searchText}" class="finance-row row-desktop ${inv.direction === 'in' ? 'finance-row-in' : 'finance-row-out'}">
                <td><span style="font-weight: 500;">${dateText}</span></td>
                <td>${areaAttr}</td>
                <td><span class="status-badge info" style="font-size: var(--text-2xs);">${inv.type}</span></td>
                <td>${itemText}${periodText || propertyText}</td>
                <td style="text-align: right;">
                    <div style="font-weight: 700;">${moneyAmount(shown, { sign: inv.direction === 'out' ? 'out' : 'in' })}</div>
                    ${hasAdjustment ? `<div style="font-size: var(--text-2xs); color: var(--text-muted);">原價 ${moneyAmount(inv.amount || 0)}</div>` : ''}
                </td>
                <td style="text-align: right;">${discountCell}</td>
                <td>${methodCell}</td>
                <td style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${(inv.note || '').replace(/"/g, '&quot;')}"><span style="font-size: var(--text-xs); color: var(--text-muted);">${linkifyNoteContracts(inv.note)}</span></td>
                <td>
                    ${rowActionGroup([
                        rowAction({ action: 'view', id: inv.id, icon: 'ph-eye', title: '明細', className: 'finance-action' }),
                        rowAction({ action: 'edit', id: inv.id, icon: 'ph-pencil', title: '編輯', className: 'finance-action' }),
                        rowAction({ action: 'delete', id: inv.id, icon: 'ph-trash', title: '刪除', className: 'finance-action', variant: 'danger' })
                    ].join(''))}
                </td>
            </tr>
            <tr data-row-id="${inv.id}" data-status="${statusAttr}" data-area="${areaAttr}" data-search="${searchText}" class="finance-row row-mobile-card ${inv.direction === 'in' ? 'finance-row-in' : 'finance-row-out'}">
                <td colspan="9">
                    <div class="entity-mobile-card">
                        <div class="c-hero-equal">
                            <div class="c-hero-who">
                                <div class="c-hero-tenant">${tenantName}</div>
                                <div class="c-hero-tags">
                                    <span class="c-hero-place">${placeName}</span>
                                    <span class="dot"></span>
                                    <span class="type-chip ${tc.cls}"><i class="ph ${tc.icon}"></i> ${inv.type}</span>
                                </div>
                            </div>
                            <div class="c-hero-side">
                                <div class="c-hero-amt ${heroAmtClass}">${moneyAmount(shown, { sign: inv.direction === 'out' ? 'out' : 'in' })}</div>
                                ${directionBadge}
                            </div>
                        </div>
                        <div class="c-divider"></div>
                        <div class="c-chips">
                            <span class="c-chip"><i class="ph ph-calendar"></i> ${dateText}</span>
                            ${periodChip}
                            ${contractChip}
                        </div>
                        <div class="c-meta-grid">
                            <div class="c-meta-cell">
                                <span class="c-meta-cap">應收調整</span>
                                <span class="c-meta-val">${discountVal}</span>
                            </div>
                            <div class="c-meta-cell">
                                <span class="c-meta-cap">付款</span>
                                <span class="c-meta-val">${paymentVal}</span>
                            </div>
                        </div>
                        ${noteSection}
                        <div class="c-actions">
                            <button class="btn-icon finance-action" data-action="view" data-id="${inv.id}" title="明細"><i class="ph ph-eye"></i></button>
                            <button class="btn-icon finance-action" data-action="edit" data-id="${inv.id}" title="編輯"><i class="ph ph-pencil"></i></button>
                            <button class="btn-icon finance-action danger" data-action="delete" data-id="${inv.id}" title="刪除"><i class="ph ph-trash"></i></button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        ${renderFinanceSubTabs('finance')}
        <div class="cutoff-banner" title="${FINANCE_CUTOFF_DATE} 之前的舊資料保留在 DB 但不算進統計 (例外: 房租查帳的舊欠款照樣追)">
            <i class="ph ph-pin"></i> 起算自 <strong>${FINANCE_CUTOFF_DATE}</strong> · 之前的歷史不算進統計
        </div>
        <div class="month-switcher">
            <button class="btn btn-outline btn-sm" data-month-action="prev">
                <i class="ph ph-caret-left"></i> 上個月
            </button>
            <div class="month-switcher__label">
                <strong>${formatMonthLabel(financeState.viewMonth)}</strong>
            </div>
            <div class="month-switcher__right">
                <button class="btn btn-outline btn-sm" data-month-action="this">本月</button>
                <button class="btn btn-outline btn-sm" data-month-action="next">
                    下個月 <i class="ph ph-caret-right"></i>
                </button>
            </div>
        </div>

        <!-- 3 張總覽 metric -->
        <div class="metrics-grid">
            <div class="card metric-card">
                <div class="metric-header"><span>已收金額</span><div class="metric-icon success"><i class="ph ph-arrow-down-right"></i></div></div>
                <div class="metric-value" style="color: var(--color-success);">$${summary.inAll.toLocaleString()}</div>
                <div class="metric-subtext">本月實際入帳 (${inCount} 筆)</div>
            </div>
            <div class="card metric-card">
                <div class="metric-header"><span>支出金額</span><div class="metric-icon warning"><i class="ph ph-arrow-up-right"></i></div></div>
                <div class="metric-value" style="color: var(--color-warning);">$${summary.outAll.toLocaleString()}</div>
                <div class="metric-subtext">本月實際付出 (${outCount} 筆)</div>
            </div>
            <div class="card metric-card">
                <div class="metric-header"><span>本月淨收益</span><div class="metric-icon ${summary.net >= 0 ? 'success' : 'danger'}"><i class="ph ph-wallet"></i></div></div>
                <div class="metric-value" style="color: ${summary.net >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${summary.net < 0 ? '-' : ''}$${Math.abs(summary.net).toLocaleString()}</div>
                <div class="metric-subtext">淨利率 ${summary.inAll > 0 ? pct(summary.netMargin) : '—'}</div>
            </div>
        </div>

        <!-- 帳目明細 -->
        <div class="card">
            <div class="finance-toolbar">
                <h2 class="card-title finance-toolbar__title"><i class="ph ph-receipt"></i> 已結帳目</h2>
                <div class="finance-toolbar__actions">
                    <div class="search-bar finance-toolbar__search">
                        <i class="ph ph-magnifying-glass"></i>
                        <input type="text" placeholder="搜尋帳單編號 / 對象 / 備註..." style="font-size: var(--text-base);">
                    </div>
                    <button class="btn btn-outline" id="btn-export-pdf" title="匯出當月已結帳目為 PDF">
                        <i class="ph ph-file-pdf"></i> 匯出 PDF
                    </button>
                    <button class="btn btn-outline" id="btn-new-expense">
                        <i class="ph ph-arrow-up-right"></i> 新增支出
                    </button>
                    <button class="btn btn-primary" id="btn-new-income">
                        <i class="ph ph-arrow-down-right"></i> 新增收入
                    </button>
                </div>
            </div>

            <div class="filter-tabs mb-4">
                <button class="filter-tab active" data-filter-value="all" data-filter-group="status">全部 (${monthInvoices.length})</button>
                <button class="filter-tab" data-filter-value="in" data-filter-group="status">收入 (${inCount})</button>
                <button class="filter-tab" data-filter-value="out" data-filter-group="status">支出 (${outCount})</button>
            </div>

            <div class="area-quick-filter" style="display: none;">
                <button class="filter-tab active" data-filter-value="all" data-filter-group="area">全部</button>
                ${activeBuildings.map(b => `<button class="filter-tab" data-filter-value="${b.name}" data-filter-group="area">${b.name}</button>`).join('')}
            </div>

            <div class="table-container">
                <table class="data-table finance-table cards-with-hero">
                    <colgroup>
                        <col style="width: 100px;">
                        <col style="width: 90px;">
                        <col style="width: 100px;">
                        <col style="width: 150px;">
                        <col style="width: 130px;">
                        <col style="width: 96px;">
                        <col style="width: 88px;">
                        <col>
                        <col style="width: 138px;">
                    </colgroup>
                    <thead><tr>
                        ${sortHeader('日期', 'date')}
                        ${sortHeader('館別', 'building')}
                        ${sortHeader('項目', 'type')}
                        ${sortHeader('項目', 'item')}
                        ${sortHeader('實收 / 實付', 'amount', 'right')}
                        <th style="text-align: right;">應收調整</th>
                        <th>付款</th>
                        ${sortHeader('備註', 'note')}
                        <th>操作</th>
                    </tr></thead>
                    <tbody>${tableRows || emptyState({ mode: 'table-row', colspan: 9, icon: 'ph-coin', title: `${formatMonthLabel(financeState.viewMonth)} 尚無已結帳目`, hint: '未結租金請至「房租查帳」頁追蹤' })}</tbody>
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

function showInvoiceForm(invoice = null, defaultDirection = 'in') {
    const isEdit = !!invoice;
    const direction = invoice?.direction || defaultDirection;
    const isExpense = direction === 'out';

    // 依當前模式 filter (共居/代管) — 不讓代管館跑進共居 form 反之亦然
    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    const buildingOptions = getSortedBuildings({ activeOnly: true })
        .filter(b => (b.mode || 'cohousing') === targetMode)
        .map(b => ({ value: b.id, label: b.name }));
    // 物件下拉依館 filter (對齊 contracts 編輯模式)
    const buildPropertyOptions = (buildingId) => mockData.properties
        .filter(p => buildingId ? p.buildingId === buildingId : true)
        .slice()
        .sort((a, b) => {
            const ra = Number(a.roomNumber ?? 999), rb = Number(b.roomNumber ?? 999);
            if (ra !== rb) return ra - rb;
            return (a.bedLetter || '').localeCompare(b.bedLetter || '');
        })
        .map(p => ({ value: p.name, label: p.name.replace('聚空間 - ', '') }));
    // 編輯時用該 invoice 的 buildingId 預先 filter; 新增時用第一個館
    const initialBuildingId = invoice?.buildingId || buildingOptions[0]?.value || '';
    const propertyOptions = buildPropertyOptions(initialBuildingId);
    const tenantOptions = mockData.tenants.map(t => t.name);
    const contractOptions = mockData.contracts.map(c => ({
        value: c.id,
        label: `${c.id} · ${c.tenant} · ${(c.propertyName || '').replace('聚空間 - ', '')}`
    }));
    const typeOptions = mockData.invoiceTypes
        .filter(t => isExpense ? t.direction !== 'in' : t.direction !== 'out')
        .map(t => t.name);
    const paymentMethodOptions = (mockData.paymentMethods || []).map(p => ({ value: p.name, label: p.name }));
    const defaultPaymentMethod = paymentMethodOptions[0]?.value || '匯款';

    const fields = isExpense
        ? [
            { name: 'buildingId', label: '館別', type: 'select', required: true, options: buildingOptions },
            { name: 'type', label: '項目', type: 'select', required: true, options: typeOptions },
            { name: 'contractId', label: '對應合約 (可選)', type: 'select', options: contractOptions, hint: '只屬於某合約的支出才需要綁；整館共用支出留空', span: 2, searchable: true, placeholder: '選擇合約或留空...' },
            { name: 'amount', label: '金額', type: 'number', required: true },
            { name: 'paymentMethod', label: '付款方式', type: 'select', options: paymentMethodOptions, value: invoice?.paymentMethod ?? defaultPaymentMethod },
            { name: 'paidDate', label: '付款日', type: 'date', required: true, value: TODAY },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 2 }
          ]
        : [
            // 館別 | 物件 | 租客 (物件非必填, 租客可手打新名)
            { name: 'buildingId', label: '館別', type: 'select', required: true, options: buildingOptions },
            { name: 'propertyName', label: '物件', type: 'select', options: propertyOptions, hint: '無對應床位可留空' },
            { name: 'tenant', label: '租客', type: 'select', required: true, span: 2,
              options: [
                  ...tenantOptions.map(name => ({ value: name, label: name })),
                  { value: '__new', label: '✨ 新增新租客...' }
              ],
              searchable: true, placeholder: '選擇租客 / 輸入關鍵字搜尋...' },
            { name: 'periodStart', label: '租期起', type: 'date' },
            { name: 'periodEnd', label: '租期止', type: 'date' },
            { name: '__sep_payment', type: 'section', label: '' },
            { name: 'paidDate', label: '入帳日', type: 'date', required: true, value: TODAY },
            { name: 'type', label: '項目', type: 'select', required: true, options: typeOptions, value: invoice?.type ?? '房租' },
            { name: 'amount', label: '租金金額', type: 'number', required: true, span: 2 },
            // 折扣 / 加收 widget
            { name: 'adjustments', type: 'placeholder' },
            { name: 'discount', type: 'hidden', value: invoice?.discount ?? 0 },
            { name: 'discountReason', type: 'hidden', value: invoice?.discountReason ?? '' },
            { name: 'totalDue', label: '應收總額', type: 'number', span: 2, hint: '租金金額 + 加收 − 折扣 (自動計算)' },
            { name: 'paidAmount', label: '已收金額', type: 'number' },
            { name: 'paymentMethod', label: '付款方式', type: 'select', options: paymentMethodOptions, value: invoice?.paymentMethod ?? defaultPaymentMethod },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 2 }
          ];

    openFormModal({
        title: isEdit
            ? `編輯${isExpense ? '支出' : '收入'}：${invoice.id}`
            : (isExpense ? '新增支出' : '新增收入'),
        maxWidth: 700,
        fields,
        values: invoice ?? {},
        submitLabel: isEdit ? '儲存變更' : '建立',
        onFormMount: (form) => {
            // === bundle 子合約偵測 — readonly + hint ===
            // 若 invoice.contractId 對應的合約有 bundleParentContractId, 則該 invoice 為子合約 invoice,
            // 收款金額應在主合約 invoice 上編輯 (避免雙重記帳)
            const _bundleContract = mockData.contracts.find(c => c.id === invoice?.contractId);
            const isBundleChildInv = !!_bundleContract?.bundleParentContractId;
            if (isBundleChildInv) {
                const parentId = _bundleContract.bundleParentContractId;
                const childId = _bundleContract.id;
                // 鎖金額相關欄位 (readonly + 灰底 + 禁止 cursor)
                ['amount', 'paidAmount', 'discount'].forEach(name => {
                    const el = form.querySelector(`[name="${name}"]`);
                    if (!el) return;
                    el.readOnly = true;
                    el.disabled = true;
                    el.style.backgroundColor = 'var(--bg-tertiary)';
                    el.style.cursor = 'not-allowed';
                    el.style.opacity = '0.7';
                });
                // 也鎖加減項目 widget (避免改 widget 反寫 discount)
                const _adjustPh = form.querySelector('#ph-adjustments');
                if (_adjustPh) {
                    _adjustPh.style.opacity = '0.5';
                    _adjustPh.style.pointerEvents = 'none';
                }
                // 表單最上方塞顯眼 hint (含主合約 ID 可點)
                const hint = document.createElement('div');
                hint.className = 'bundle-child-invoice-hint';
                hint.style.cssText = 'background: var(--color-info-light); border-left: 3px solid var(--color-info); padding: 0.75rem 1rem; margin-bottom: 1rem; border-radius: var(--radius-sm); font-size: var(--text-sm); line-height: 1.6; color: var(--text-primary);';
                hint.innerHTML = `<i class="ph ph-link" style="vertical-align: -2px; margin-right: 0.35rem; color: var(--color-info);"></i>此 invoice 屬於 bundle 子合約 <strong style="font-family: monospace;">${childId}</strong>，收款請編輯主合約 <button type="button" class="bundle-parent-jump" data-pid="${parentId}" style="background: var(--color-info); border: none; color: white; font-family: monospace; padding: 0.1rem 0.45rem; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--text-sm); font-weight: 600;" title="跳到主合約 ${parentId}">${parentId}</button> 的 invoice。`;
                form.prepend(hint);
                // 點主合約 ID → 關掉 modal + 跳合約頁打開該合約 detail
                hint.querySelector('.bundle-parent-jump')?.addEventListener('click', () => {
                    const pid = parentId;
                    // 關掉所有 modal (對齊 closeAllModals 行為)
                    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
                    if (typeof window.openEntity === 'function') {
                        window.openEntity('contract', pid);
                    } else {
                        window.location.hash = 'contracts';
                    }
                });
            }

            // 館別變更 → 物件下拉重新依館 filter (對齊 contracts 編輯)
            const buildingHidden = form.querySelector('[name="buildingId"]');
            const propertyWrap = form.querySelector('.custom-select[data-name="propertyName"]');
            const propertyHidden = form.querySelector('[name="propertyName"]');
            buildingHidden?.addEventListener('change', () => {
                const bid = buildingHidden.value;
                if (propertyWrap?.__setOptions) {
                    // __setOptions 內部已自動清 hidden.value + 重設 trigger 文字, 不需手動重置
                    propertyWrap.__setOptions(buildPropertyOptions(bid));
                }
            });

            // 「✨ 新增新租客」option — 攔截 __new value, 開租客 form (跟租客清單同款), 建檔後自動 select
            if (!isExpense) {
                const tenantHiddenInv = form.querySelector('[name="tenant"]');
                const tenantWrap = form.querySelector('.custom-select[data-name="tenant"]');
                tenantHiddenInv?.addEventListener('change', () => {
                    if (tenantHiddenInv.value !== '__new') return;
                    // 先清掉 __new (避免關掉 modal 後值還是 __new)
                    tenantHiddenInv.value = '';
                    // 直接重用租客清單頁的「新增租客」form (showTenantForm), 建檔後自動帶回
                    showTenantForm(null, {
                        onCreated: (created) => {
                            if (tenantWrap?.__setOptions) {
                                const newOpts = [
                                    ...mockData.tenants.map(t => ({ value: t.name, label: t.name })),
                                    { value: '__new', label: '✨ 新增新租客...' }
                                ];
                                tenantWrap.__setOptions(newOpts);
                                tenantWrap.__setValue?.(created.name);
                            }
                        }
                    });
                });
            }

            // 折扣 / 加收 widget — 跟合約 form 同款
            // 收入: widget net (sub-add) 直接 = invoice.discount (正=折扣, 負=加收)
            // 支出: 翻轉，正=多付, 負=少付 (對齊原本支出 onSubmit 慣例)
            const initialReason = invoice?.discountReason || '';
            // 編輯模式但 discountReason 是純文字 (legacy) → 拿 invoice.discount 自動生一筆預填項
            let prefillReason = initialReason;
            if (invoice && Number(invoice.discount) !== 0 && (!initialReason || !initialReason.trim().startsWith('['))) {
                // income: discount<0=加收, discount>0=折扣 ; expense: discount>0=多付(加), discount<0=少付(折)
                const d = Number(invoice.discount);
                const isAddOn = isExpense ? (d > 0) : (d < 0);
                prefillReason = JSON.stringify([{
                    kind: isAddOn ? 'add' : 'sub',
                    label: initialReason || '',
                    amount: Math.abs(d)
                }]);
            }
            // amount + widget → 即時算 totalDue (實際應收)
            const amountInput = form.querySelector('[name="amount"]');
            const totalDueInput = form.querySelector('[name="totalDue"]');
            const paidAmountInput = form.querySelector('[name="paidAmount"]');
            const recomputeTotalDue = (widgetNet) => {
                if (!totalDueInput) return;
                const amt = Number(amountInput?.value) || 0;
                // widget net 正 = 折扣 / 負 = 加收 → 實際應收 = amount - net
                const due = amt - (widgetNet || 0);
                totalDueInput.value = String(due);
            };
            initAdjustmentsWidget({
                container: form.querySelector('#ph-adjustments'),
                discountInput: form.querySelector('[name="discount"]'),
                discountReasonInput: form.querySelector('[name="discountReason"]'),
                initialReason: prefillReason,
                onChange: (net) => recomputeTotalDue(net)
            });
            amountInput?.addEventListener('input', () => {
                const widgetNet = Number(form.querySelector('[name="discount"]')?.value) || 0;
                recomputeTotalDue(widgetNet);
            });
            // 初始值: 用 invoice 既有 paidAmount, 沒有則填 amount - discount (預設全收)
            if (paidAmountInput && !paidAmountInput.value) {
                const initPaid = invoice?.paidAmount != null
                    ? invoice.paidAmount
                    : (Number(invoice?.amount || 0) - Number(invoice?.discount || 0));
                paidAmountInput.value = String(initPaid);
            }
            // 應收總額 — readonly 灰底橘字 (跟入住合約收款步驟一致)
            if (totalDueInput) {
                totalDueInput.readOnly = true;
                totalDueInput.style.backgroundColor = 'var(--bg-tertiary)';
                totalDueInput.style.cursor = 'not-allowed';
                totalDueInput.style.fontWeight = '700';
                totalDueInput.style.color = 'var(--color-primary)';
            }

            if (!isExpense) {
                // 收入: 填了 periodStart 自動帶 periodEnd = leaseEndISO(start, 1)
                const psInput = form.querySelector('[name="periodStart"]');
                const peInput = form.querySelector('[name="periodEnd"]');
                const tenantHidden = form.querySelector('[name="tenant"]');
                const propertyHiddenInv = form.querySelector('[name="propertyName"]');
                const amountInputInv = form.querySelector('[name="amount"]');

                psInput?.addEventListener('change', () => {
                    if (psInput.value && !peInput.value) {
                        peInput.value = leaseEndISO(psInput.value, 1);
                    }
                });

                // 物件 + 租客 鎖定 → 自動帶該合約的 startDate / endDate / 月租 (沒手動改才覆寫)
                const syncFromContract = () => {
                    const propName = propertyHiddenInv?.value;
                    const tenantName = tenantHidden?.value;
                    if (!propName || !tenantName) return;
                    // 找符合的 active 合約 (propertyName + tenant)
                    const c = mockData.contracts.find(x =>
                        x.propertyName === propName && x.tenant === tenantName
                        && (x.renewalState === 'active' || x.renewalState === 'snoozed')
                    );
                    if (!c) return;
                    // 租期起 / 止 沒填才自動帶 (user 有手動填就尊重)
                    if (psInput && !psInput.value && c.startDate) psInput.value = c.startDate;
                    if (peInput && !peInput.value && c.endDate) peInput.value = c.endDate;
                    // 月租金沒填或 0 才自動帶
                    if (amountInputInv && (!amountInputInv.value || Number(amountInputInv.value) === 0) && c.amount) {
                        amountInputInv.value = c.amount;
                        amountInputInv.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                };
                propertyHiddenInv?.addEventListener('change', syncFromContract);
                tenantHidden?.addEventListener('change', syncFromContract);
                // 編輯模式進來 invoice 已有 contractId 但 period* 空白 → 立即補
                if (invoice && !psInput?.value && !peInput?.value) {
                    setTimeout(syncFromContract, 50);
                }
            }
        },
        onSubmit: (values) => {
            // 租客 (收入 form 才有): 打了新名字 → 自動建檔
            if (!isExpense && values.tenant) {
                const tenantName = String(values.tenant).trim();
                const exists = mockData.tenants.some(t => (t.name || '').trim() === tenantName);
                if (!exists) {
                    store.addTenant({
                        name: tenantName,
                        phone: '',
                        email: '',
                        currentProperty: values.propertyName || null,
                        status: '待入住',
                        source: '帳務新增'
                    });
                    showToast(`已自動建立新租客「${tenantName}」`, 'info', 4000);
                }
                values.tenant = tenantName;
            }
            // widget 寫進 discount (net = sub - add): 正=折扣, 負=加收
            // 收入 invoice: discount 直接用 widget 值 (DB 正=折扣 / 負=加收, 跟 due = amount - discount 公式對得起來)
            // 支出 invoice: 翻轉 (DB 正=多付 / 負=少付)
            const widgetNet = Number(values.discount) || 0;
            const discount = isExpense ? -widgetNet : widgetNet;
            const amt = Number(values.amount) || 0;
            // 已收金額: user 明確填了用該值 / 沒填則預設全收 (amt - discount)
            const paidAmount = (values.paidAmount != null && values.paidAmount !== '')
                ? Number(values.paidAmount)
                : (amt - discount);
            // 拋掉 totalDue (顯示用, 非 DB 欄位)
            const { totalDue: _td, ...cleanValues } = values;
            // 自動 derive status: 已收 >= 應收 → 已繳清, paidAmount > 0 → 部分繳款, 否則 欠繳/未付
            const due = amt - discount;
            let status;
            if (isExpense) {
                status = paidAmount >= due ? '已付' : (paidAmount > 0 ? '部分支付' : '未付');
            } else {
                status = paidAmount >= due ? '已繳清' : (paidAmount > 0 ? '部分繳款' : '欠繳');
            }
            const payload = {
                ...cleanValues,
                direction,
                status,
                dueDate: values.paidDate,
                discount,
                paidAmount,
                paymentMethod: values.paymentMethod || defaultPaymentMethod
            };
            if (isEdit) {
                store.updateInvoice(invoice.id, payload);
                showToast('已更新帳目', 'success');
            } else {
                const created = store.addInvoice(payload);
                showToast(`已新增${isExpense ? '支出' : '收入'}：${created.id}`, 'success');
            }
            refreshView();
        }
    });
}

function showInvoiceDetails(id) {
    const inv = mockData.invoices.find(x => x.id === id);
    if (!inv) return;
    const dirLabel = inv.direction === 'in' ? '收入' : '支出';
    const items = [
        { label: '方向', value: dirLabel },
        { label: '館別', value: buildingName(inv.buildingId) },
        { label: '物件', value: inv.propertyName || '（整館共用）' },
        { label: inv.direction === 'in' ? '租客' : '對應合約', value: inv.direction === 'in' ? (inv.tenant || '—') : (inv.contractId || '—') },
        { label: '項目', value: inv.type },
        { label: '金額', value: `$${(inv.amount || 0).toLocaleString()}` },
        { label: '入帳/付款日', value: inv.paidDate || '—' }
    ];
    if (inv.direction === 'in') {
        items.push({ label: '租期', value: inv.periodStart && inv.periodEnd ? `${inv.periodStart} ~ ${inv.periodEnd}` : '—' });
    }
    items.push({ label: '狀態', value: `<span class="status-badge success">${inv.status}</span>` });
    items.push({ label: '備註', value: inv.note || '—' });
    openDetailModal({ title: `帳單 ${inv.id}`, items });
}

function confirmDelete(id) {
    const inv = mockData.invoices.find(x => x.id === id);
    if (!inv) return;
    openConfirm({
        title: '刪除帳目',
        message: `確定要刪除 <strong>${inv.id}</strong>（$${(inv.amount || 0).toLocaleString()}）嗎？`,
        danger: true,
        confirmLabel: '確定刪除',
        onConfirm: () => {
            const snap = JSON.parse(JSON.stringify(inv));
            mockData.invoices = mockData.invoices.filter(x => x.id !== id);
            refreshView();
            showUndoToast({
                message: `已刪除帳目 ${inv.id}`,
                durationMs: 5000,
                onUndo: () => {
                    mockData.invoices.push(snap);
                    refreshView();
                    showToast('已復原', 'success');
                },
                onCommit: () => {
                    window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'invoices', id: snap.id } }));
                }
            });
        }
    });
}

export function initFinanceActions(scope) {
    // 點 header 排序：同欄位 → 切方向；換欄位 → 換欄位 + 預設方向
    scope.querySelectorAll('[data-action="sort"]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sortField;
            if (sortField === field) {
                sortDesc = !sortDesc;
            } else {
                sortField = field;
                // 日期/金額預設大→小，文字預設 A→Z
                sortDesc = (field === 'date' || field === 'amount');
            }
            refreshView();
        });
    });

    scope.querySelectorAll('[data-month-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.monthAction;
            if (action === 'prev') financeState.viewMonth = shiftMonth(financeState.viewMonth, -1);
            else if (action === 'next') financeState.viewMonth = shiftMonth(financeState.viewMonth, 1);
            else if (action === 'this') financeState.viewMonth = currentMonth();
            refreshView();
        });
    });

    scope.querySelectorAll('[data-grouping]').forEach(btn => {
        btn.addEventListener('click', () => {
            financeState.viewGrouping = btn.dataset.grouping;
            refreshView();
        });
    });

    scope.querySelector('#btn-new-income')?.addEventListener('click', () => showInvoiceForm(null, 'in'));
    scope.querySelector('#btn-new-expense')?.addEventListener('click', () => showInvoiceForm(null, 'out'));
    scope.querySelector('#btn-export-pdf')?.addEventListener('click', () => exportFinanceReport(financeState.viewMonth));

    scope.querySelectorAll('.finance-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const id = e.currentTarget.dataset.id;
            const inv = mockData.invoices.find(x => x.id === id);
            if (!inv) return;
            if (action === 'view') showInvoiceDetails(id);
            if (action === 'edit') showInvoiceForm(inv);
            if (action === 'delete') confirmDelete(id);
        });
    });

    // 備註 / 項目欄裡的合約 ID button → 跳去合約 detail
    scope.addEventListener('click', (e) => {
        const link = e.target.closest('[data-action="open-contract"]');
        if (!link) return;
        e.preventDefault();
        const cid = link.dataset.cid;
        if (cid && window.openEntity) window.openEntity('contract', cid);
    });

    scope.querySelectorAll('[data-area-link]').forEach(el => {
        el.addEventListener('click', () => {
            const area = el.dataset.areaLink;
            const target = scope.querySelector(`.area-quick-filter [data-filter-value="${area}"]`);
            if (target) target.click();
            scope.querySelectorAll('[data-area-link]').forEach(x => x.classList.remove('is-selected'));
            el.classList.add('is-selected');
        });
    });
}
