// 待結帳款頁
// 集中追蹤所有「欠繳 / 未付」帳款
// 階段 2 新增：末 5 碼核對 / 批次結帳 / 一鍵產生本月帳單
import { mockData, store, isUnsettled, ensureContractInvoices, previewContractInvoices, getSortedBuildings, deriveInvoiceStatus } from '../data.js';
import { openFormModal, openModal, openConfirm, showToast, refreshView } from '../utils/ui.js';
import { renderFinanceSubTabs } from '../utils/financeSubTabs.js';
import { escapeHtml } from '../utils/escape.js';
import { filterInvoicesByMode } from '../utils/modeFilter.js';
import { getMode } from '../utils/appMode.js';
import { initAdjustmentsWidget } from '../utils/adjustmentsWidget.js';
import { pushToTenant } from '../utils/line.js';
import { sendContractToLine, buildAdjustmentValues } from './contracts.js';
import { moneyAmount, moneyCell, adjustmentBadge } from '../utils/moneyDisplay.js';
import { rowAction, rowActionGroup } from '../utils/rowActions.js';
import { emptyState } from '../utils/emptyState.js';

// 類別 → type-chip class (語意色 — 跟 finance.js 同套)
// 房租 (in) vs 租金 (out) 用 direction 分色
function typeChip(type, direction) {
    const t = String(type || '');
    if (direction === 'out') {
        if (/水|電|瓦斯|能源|管理費|網路|寬頻/.test(t)) return { cls: 'utility', icon: 'ph-lightning' };
        return { cls: 'misc', icon: 'ph-tag' };
    }
    if (/房租|^租$/.test(t)) return { cls: 'rent', icon: 'ph-house' };
    if (/押/.test(t))         return { cls: 'deposit', icon: 'ph-vault' };
    return { cls: 'misc', icon: 'ph-tag' };
}

const TODAY = new Date().toISOString().split('T')[0];

function buildingName(id) {
    return mockData.buildings.find(b => b.id === id)?.name || '—';
}

function isOverdue(inv) {
    return inv.dueDate && new Date(inv.dueDate) < new Date(TODAY);
}

export function renderUnsettled() {
    // 待結帳款只追蹤「租客應收」(direction='in')
    // 公司支出 (水電/房東租金/薪水…) 通常是付完才登記，直接記在「總收支表」即可
    const unsettled = filterInvoicesByMode(mockData.invoices)
        .filter(i => isUnsettled(i) && i.direction === 'in')
        .sort((a, b) => {
            // 已回報末5碼待核對的排最前面 — 客戶已回應, 需要小編優先核對入帳
            const av = (a.bankLast5 && !a.bankVerified) ? 0 : 1;
            const bv = (b.bankLast5 && !b.bankVerified) ? 0 : 1;
            if (av !== bv) return av - bv;
            const ao = isOverdue(a) ? 0 : 1;
            const bo = isOverdue(b) ? 0 : 1;
            if (ao !== bo) return ao - bo;
            return new Date(a.dueDate || '9999-12-31') - new Date(b.dueDate || '9999-12-31');
        });

    const overdueCount = unsettled.filter(isOverdue).length;
    // 全部都是 direction='in' (上方已過濾)
    // 餘額 = (應收 - 折扣 - 已收) 總和
    const inSum = unsettled.reduce((s, i) => {
        const due = (i.amount || 0) - (i.discount || 0);
        return s + Math.max(0, due - (i.paidAmount || 0));
    }, 0);
    const awaitVerifyCount = unsettled.filter(i => i.bankLast5 && !i.bankVerified).length;

    // 各館未結筆數 (依當前 mode 篩 — 共居/代管不混)
    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    const allBuildings = getSortedBuildings({ activeOnly: true })
        .filter(b => (b.mode || 'cohousing') === targetMode);
    const buildingCounts = {};
    unsettled.forEach(inv => {
        const name = buildingName(inv.buildingId);
        buildingCounts[name] = (buildingCounts[name] || 0) + 1;
    });

    const tableRows = unsettled.map(inv => {
        const overdue = isOverdue(inv);
        const dirBadge = inv.direction === 'in'
            ? '<span class="status-badge danger" style="font-size: var(--text-2xs);"><i class="ph ph-arrow-down"></i> 應收</span>'
            : '<span class="status-badge warning" style="font-size: var(--text-2xs);"><i class="ph ph-arrow-up"></i> 應付</span>';
        const cLink = (cid) => `<button type="button" class="contract-link" data-action="open-contract" data-cid="${cid}" style="background: none; border: none; padding: 0; color: var(--color-primary); cursor: pointer; font: inherit; text-decoration: underline;">${cid}</button>`;
        const target = inv.direction === 'in'
            ? `${inv.tenant || ''} · ${(inv.propertyName || '').replace('聚空間 - ', '')}`
            : (inv.contractId ? `合約 ${cLink(inv.contractId)}` : '<span style="color: var(--text-muted);">整館共用</span>');
        const amountSign = inv.direction === 'out' ? '-' : '';
        const amountColor = inv.direction === 'out' ? 'var(--color-warning)' : 'var(--color-danger)';
        const due = (inv.amount || 0) - (inv.discount || 0);
        const paid = inv.paidAmount || 0;
        const balance = Math.max(0, due - paid);
        const isPartial = paid > 0 && paid < due;

        // 狀態 attr：方向 + (待核對 / 逾期)
        const statusAttrs = [inv.direction];
        if (overdue) statusAttrs.push('逾期');
        if (inv.bankLast5 && !inv.bankVerified) statusAttrs.push('待核對');
        const statusAttr = statusAttrs.join(' ');

        const searchText = [inv.id, inv.type, inv.tenant || '', inv.contractId || '', buildingName(inv.buildingId), inv.bankLast5 || ''].join(' ').toLowerCase();

        // 末 5 碼徽章
        const bankBadge = inv.bankLast5
            ? `<div class="bank-last5-badge ${inv.bankVerified ? 'verified' : 'pending'}">
                   <i class="ph ${inv.bankVerified ? 'ph-check-circle' : 'ph-warning'}"></i>
                   末5碼 <strong>${inv.bankLast5}</strong>
               </div>`
            : '<span style="font-size: var(--text-xs); color: var(--text-muted);">—</span>';

        // v3 卡片 (mobile-only)
        const tc = typeChip(inv.type, inv.direction);
        const tenantName = inv.direction === 'in'
            ? (inv.tenant || '—')
            : (inv.contractId ? `合約 ${inv.contractId}` : '整館共用');
        const placeName = inv.propertyName ? inv.propertyName.replace('聚空間 - ', '') : buildingName(inv.buildingId);
        const heroBadge = inv.direction === 'in'
            ? '<span class="status-badge danger">應收</span>'
            : '<span class="status-badge warning">應付</span>';
        const heroAmtClass = inv.direction === 'in' ? 'expense' : 'expense';  // 都用紅 (應收/應付都是「未到手」)
        const dueChipCls = overdue ? 'c-chip danger' : 'c-chip';
        const dueText = overdue
            ? `應結 ${inv.dueDate || '—'} · 逾期`
            : `應結 ${inv.dueDate || '—'}`;
        const bank5Chip = inv.bankLast5
            ? `<span class="c-chip ${inv.bankVerified ? 'success' : 'warn'}"><i class="ph ${inv.bankVerified ? 'ph-shield-check' : 'ph-shield-warning'}"></i> 末5碼 ${inv.bankLast5}${!inv.bankVerified ? ' · 待核' : ''}</span>`
            : '';
        const partialChip = isPartial
            ? `<span class="c-chip success"><i class="ph ph-check"></i> 已收 ${moneyAmount(paid)}</span>`
            : '';
        const discountChip = inv.discount
            ? `<span class="c-chip ${Number(inv.discount) < 0 ? 'info' : 'warn'}"><i class="ph ph-tag"></i> ${adjustmentBadge(inv.discount, { showLabel: false })}</span>`
            : '';
        const primaryBtn = (inv.bankLast5 && !inv.bankVerified)
            ? `<button class="btn-primary unsettled-action" data-action="verify" data-id="${inv.id}">
                  <i class="ph ph-shield-check"></i> 核對結帳
               </button>`
            : `<button class="btn-primary unsettled-action" data-action="settle" data-id="${inv.id}">
                  <i class="ph ph-check"></i> 結帳
               </button>`;

        const remaining = Math.max(0, due - paid);
        return `
            <tr data-row-id="${inv.id}" data-status="${statusAttr}" data-building="${buildingName(inv.buildingId)}" data-search="${searchText}" class="row-desktop ${overdue ? 'is-overdue-row' : ''} ${inv.bankLast5 && !inv.bankVerified ? 'is-await-verify-row' : ''}">
                <td><input type="checkbox" class="row-check" data-id="${inv.id}"></td>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <strong style="font-size: var(--text-base);">${inv.id}</strong>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">${buildingName(inv.buildingId)} · ${inv.type}</span>
                    </div>
                </td>
                <td>${target}</td>
                <td style="text-align: right;">
                    <div style="font-weight: 700; font-size: var(--text-base);">$${due.toLocaleString()}</div>
                    ${inv.discount ? `<div style="margin-top: 0.2rem;">${adjustmentBadge(inv.discount)}</div>` : ''}
                </td>
                <td style="text-align: right;">
                    ${paid > 0
                        ? `<div style="font-weight: 700; color: var(--color-success); font-size: var(--text-base);">$${paid.toLocaleString()}</div>
                           ${remaining > 0 ? `<div style="font-size: var(--text-xs); color: var(--color-danger); margin-top: 0.15rem; font-weight: 600;">差 $${remaining.toLocaleString()}</div>` : ''}`
                        : `<span style="color: var(--text-muted);">未收</span>`}
                </td>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-weight: 500;">${inv.dueDate || '—'}</span>
                        ${overdue ? '<span class="status-badge danger" style="font-size: var(--text-2xs); align-self: flex-start; margin-top: 2px;">逾期</span>' : ''}
                    </div>
                </td>
                <td>${bankBadge}</td>
                <td>
                    ${rowActionGroup(
                        (inv.bankLast5 && !inv.bankVerified
                            ? rowAction({ action: 'verify', id: inv.id, icon: 'ph-shield-check', title: '核對銀行末 5 碼後結帳', label: '核對結帳', variant: 'success', className: 'unsettled-action' })
                            : rowAction({ action: 'settle', id: inv.id, icon: 'ph-check', title: `標記為${inv.direction === 'in' ? '已收' : '已付'}`, label: '結帳', variant: 'success', className: 'unsettled-action' })
                        )
                        + rowAction({ action: 'remind', id: inv.id, icon: 'ph-bell', title: inv.direction === 'in' ? '催繳' : '記錄通知', label: inv.direction === 'in' ? '催繳' : '記錄通知', className: 'unsettled-action' })
                        + rowAction({ action: 'edit', id: inv.id, icon: 'ph-pencil', title: '編輯', label: '編輯', className: 'unsettled-action' })
                        + rowAction({ action: 'delete', id: inv.id, icon: 'ph-trash', title: '刪除', label: '刪除', variant: 'danger', className: 'unsettled-action' })
                    )}
                </td>
            </tr>
            <tr data-row-id="${inv.id}" data-status="${statusAttr}" data-building="${buildingName(inv.buildingId)}" data-search="${searchText}" class="row-mobile-card ${overdue ? 'is-overdue-row' : ''}">
                <td colspan="8">
                    <div class="entity-mobile-card">
                        <div class="c-hero-equal">
                            <div class="c-hero-who">
                                <div class="c-hero-tenant">${escapeHtml(tenantName)}</div>
                                <div class="c-hero-tags">
                                    <span class="c-hero-place">${escapeHtml(placeName)}</span>
                                    <span class="dot"></span>
                                    <span class="type-chip ${tc.cls}"><i class="ph ${tc.icon}"></i> ${inv.type}</span>
                                </div>
                            </div>
                            <div class="c-hero-side">
                                <div class="c-hero-amt ${heroAmtClass}">${amountSign}$${balance.toLocaleString()}</div>
                                ${heroBadge}
                            </div>
                        </div>
                        <div class="c-divider"></div>
                        <div class="c-chips">
                            <span class="c-chip"><i class="ph ph-hash"></i> ${inv.id}</span>
                            <span class="${dueChipCls}"><i class="ph ph-calendar"></i> ${dueText}</span>
                            ${bank5Chip}
                            ${partialChip}
                            ${discountChip}
                        </div>
                        <div class="c-actions">
                            ${primaryBtn}
                            <button class="btn-icon unsettled-action" data-action="remind" data-id="${inv.id}" title="${inv.direction === 'in' ? '催繳' : '記錄通知'}"><i class="ph ph-bell"></i></button>
                            <button class="btn-icon unsettled-action" data-action="edit" data-id="${inv.id}" title="編輯"><i class="ph ph-pencil"></i></button>
                            <button class="btn-icon unsettled-action danger" data-action="delete" data-id="${inv.id}" title="刪除"><i class="ph ph-trash"></i></button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        ${renderFinanceSubTabs('unsettled')}
        <div class="metrics-grid">
            <div class="card metric-card">
                <div class="metric-header"><span>應收未結</span><div class="metric-icon danger"><i class="ph ph-arrow-down-right"></i></div></div>
                <div class="metric-value" style="color: var(--color-danger);">$${inSum.toLocaleString()}</div>
                <div class="metric-subtext">${unsettled.length} 筆租客未繳</div>
            </div>
            <div class="card metric-card ${awaitVerifyCount > 0 ? 'highlight-warning' : ''}">
                <div class="metric-header"><span>待核對</span><div class="metric-icon warning"><i class="ph ph-shield-warning"></i></div></div>
                <div class="metric-value" style="color: ${awaitVerifyCount > 0 ? 'var(--color-warning)' : 'var(--text-main)'};">${awaitVerifyCount}</div>
                <div class="metric-subtext">客戶已回報末 5 碼</div>
            </div>
            <div class="card metric-card ${overdueCount > 0 ? 'highlight-danger' : ''}">
                <div class="metric-header"><span>逾期項目</span><div class="metric-icon danger"><i class="ph ph-clock-afternoon"></i></div></div>
                <div class="metric-value" style="color: ${overdueCount > 0 ? 'var(--color-danger)' : 'var(--text-main)'};">${overdueCount}</div>
                <div class="metric-subtext">需要立即處理</div>
            </div>
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <div>
                    <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-warning-circle"></i> 房租查帳</h2>
                </div>
                <div class="flex gap-2" style="flex-wrap: wrap;">
                    <div class="search-bar" style="width: 220px;">
                        <i class="ph ph-magnifying-glass"></i>
                        <input type="text" placeholder="搜尋編號 / 末 5 碼 / 對象..." style="font-size: var(--text-base);">
                    </div>
                    <button class="btn btn-outline" id="btn-gen-monthly" title="檢查所有進行中合約是否都有對應帳單，若無則補產">
                        <i class="ph ph-arrows-clockwise"></i> 補產缺帳單
                    </button>
                    <button class="btn btn-primary" id="btn-new-unsettled">
                        <i class="ph ph-plus"></i> 新增待結
                    </button>
                </div>
            </div>

            <!-- 批次操作列 (有勾選才顯示) -->
            <div id="bulk-action-bar" style="display: none; padding: 0.625rem 0.875rem; background-color: var(--color-primary-light); border-radius: var(--radius-md); margin-bottom: 1rem; align-items: center; justify-content: space-between;">
                <span style="font-size: var(--text-base); font-weight: 500;">已選 <strong id="bulk-count">0</strong> 筆</span>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-success" id="btn-bulk-settle" style="padding: 0.4rem 0.875rem; font-size: var(--text-xs);">
                        <i class="ph ph-check"></i> 批次結帳
                    </button>
                    <button class="btn btn-outline" id="btn-bulk-clear" style="padding: 0.4rem 0.875rem; font-size: var(--text-xs);">清除選取</button>
                </div>
            </div>

            <div class="filter-tabs mb-2">
                <span class="filter-tab-label">館別</span>
                <button class="filter-tab active" data-filter-value="all" data-filter-group="building">全部館 (${unsettled.length})</button>
                ${allBuildings.map(b => {
                    const cnt = buildingCounts[b.name] || 0;
                    return `<button class="filter-tab ${cnt === 0 ? 'is-empty' : ''}" data-filter-value="${b.name}" data-filter-group="building">${b.name} (${cnt})</button>`;
                }).join('')}
            </div>
            <div class="filter-tabs mb-4">
                <span class="filter-tab-label">狀態</span>
                <button class="filter-tab active" data-filter-value="all" data-filter-group="status">全部 (${unsettled.length})</button>
                <button class="filter-tab" data-filter-value="待核對" data-filter-group="status">⚠ 待核對 (${awaitVerifyCount})</button>
                <button class="filter-tab" data-filter-value="逾期" data-filter-group="status">逾期 (${overdueCount})</button>
            </div>

            <div class="table-container">
                <table class="data-table cards-with-hero unsettled-table" style="table-layout: fixed;">
                    <colgroup>
                        <col style="width: 36px;">
                        <col style="width: 13%;">
                        <col style="width: 21%;">
                        <col style="width: 10%;">
                        <col style="width: 10%;">
                        <col style="width: 10%;">
                        <col style="width: 13%;">
                        <col style="width: 22%;">
                    </colgroup>
                    <thead><tr>
                        <th><input type="checkbox" id="check-all"></th>
                        <th>帳單</th><th>對象</th><th style="text-align: right;">應收金額</th><th style="text-align: right;">已收金額</th><th>應結日</th><th>銀行末 5 碼</th><th>操作</th>
                    </tr></thead>
                    <tbody>${tableRows || emptyState({ mode: 'table-row', colspan: 8, icon: 'ph-check-circle', title: '所有帳款都已結清', hint: '目前沒有待結款項' })}</tbody>
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

// === 核對結帳 (2026-07-21 簡化: 拿掉重打末5碼的步驟, 只確認入帳金額) ===
function showVerifyModal(id) {
    const inv = mockData.invoices.find(x => x.id === id);
    if (!inv) return;

    const due = (inv.amount || 0) - (inv.discount || 0);
    const alreadyPaid = inv.paidAmount || 0;
    const remaining = Math.max(0, due - alreadyPaid);

    openFormModal({
        title: '🛡 核對結帳',
        maxWidth: 440,
        fields: [
            { name: 'bankLast5_displayed', label: '租客回報的末 5 碼', type: 'text', value: inv.bankLast5, hint: '對照銀行 App 用', span: 2 },
            { name: 'receivedAmount', label: '銀行 App 實際入帳金額', type: 'number', required: true, value: remaining, hint: `應收 $${due.toLocaleString()}${alreadyPaid > 0 ? ` · 已收 $${alreadyPaid.toLocaleString()} · 尚欠 $${remaining.toLocaleString()}` : ''}`, span: 2 },
            { name: 'paidDate', label: '入帳日', type: 'date', required: true, value: TODAY, span: 2 }
        ],
        values: {},
        submitLabel: '確認結帳',
        onFormMount: (form) => {
            const displayed = form.querySelector('[name="bankLast5_displayed"]');
            if (displayed) {
                displayed.setAttribute('readonly', 'readonly');
                displayed.style.backgroundColor = 'var(--color-background)';
                displayed.style.cursor = 'not-allowed';
                displayed.style.fontWeight = '700';
                displayed.style.letterSpacing = '0.15em';
            }
        },
        onSubmit: (values) => {
            const receivedThisTime = Number(values.receivedAmount);
            if (!Number.isFinite(receivedThisTime) || receivedThisTime < 0) {
                showToast('入帳金額不正確', 'danger');
                return false;
            }
            const newPaidAmount = alreadyPaid + receivedThisTime;
            if (newPaidAmount !== due) {
                showToast(`⚠ 入帳金額 $${newPaidAmount.toLocaleString()} 跟應收 $${due.toLocaleString()} 不一致, 請確認後再送出`, 'warning', 6000);
            }
            const patched = { ...inv, paidAmount: newPaidAmount, paidDate: values.paidDate, bankVerified: true };
            store.updateInvoice(id, {
                paidAmount: newPaidAmount,
                paidDate: values.paidDate,
                bankVerified: true,
                status: deriveInvoiceStatus(patched)
            });
            showToast(`✅ ${inv.id} 已入帳 $${receivedThisTime.toLocaleString()}`, 'success');
            // Q4 入帳即發 — 跟 settleInvoice 共用 helper
            maybeAutoSendContract(patched);
            refreshView();
        }
    });
}

function settleInvoice(id) {
    const inv = mockData.invoices.find(x => x.id === id);
    if (!inv) return;
    const isIncome = inv.direction === 'in';
    const due = (inv.amount || 0) - (inv.discount || 0);
    const alreadyPaid = inv.paidAmount || 0;
    const newStatus = isIncome ? '已繳清' : '已付';
    // 收入且合約可寄 → 全額結後跳「合約資訊確認」再發送
    const sendable = isIncome ? contractForSend(inv) : null;
    // 有合約待寄、但租客沒綁 LINE → 提示 (本次只結帳, 合約之後手動寄)
    const eligibleUnbound = (isIncome && !sendable) ? eligibleContractForSend(inv) : null;
    const unboundNote = (eligibleUnbound && !tenantForContract(eligibleUnbound)?.lineUserId)
        ? '此合約待寄，但租客尚未綁 LINE — 本次只結帳，之後可到合約頁手動寄' : '';
    const verb = isIncome ? '收到' : '支付';
    const noun = isIncome ? '收' : '付';

    // 結帳一律先問「實際入帳金額」→ 相符=全額結(+可發合約) / 不足=拆帳結
    openModal({
        title: '結帳 · 入帳金額',
        maxWidth: 480,
        bodyHtml: `
            <div style="line-height: 1.7;">
                <div style="font-size: 0.9rem; color: var(--text-secondary);">
                    <strong style="color: var(--text-main);">${inv.id}</strong>
                    · ${isIncome ? '收入' : '支出'}${(inv.tenantName || inv.tenant) ? ' · ' + escapeHtml(inv.tenantName || inv.tenant) : ''}
                </div>
                <div style="margin-top: 0.75rem; padding: 0.75rem; background: var(--color-background); border-radius: 8px; font-size: 0.9rem;">
                    <div>應${noun}總額：<strong>$${due.toLocaleString()}</strong></div>
                    ${alreadyPaid > 0 ? `<div style="color: #22946e;">已入帳：$${alreadyPaid.toLocaleString()}</div>` : ''}
                </div>
                ${unboundNote ? `<div style="margin-top: 0.5rem; font-size: 0.82rem; color: var(--color-warning);">⚠ ${unboundNote}</div>` : ''}
                <label for="settle-received" style="display: block; margin-top: 1rem; font-weight: 600; font-size: 0.9rem;">實際${verb}金額</label>
                <div style="position: relative; margin-top: 0.4rem;">
                    <span style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-weight: 700;">$</span>
                    <input id="settle-received" type="number" inputmode="numeric" min="0" step="1" value="${due}"
                        style="width: 100%; padding: 0.6rem 0.75rem 0.6rem 1.75rem; font-size: 1.2rem; font-weight: 700; border: 1px solid var(--border-color); border-radius: 8px; box-sizing: border-box;">
                </div>
                <div id="settle-hint" style="margin-top: 0.6rem; font-size: 0.85rem; min-height: 1.3em; line-height: 1.4;"></div>
            </div>
        `,
        footerHtml: `
            <button class="btn btn-secondary" data-action="cancel">取消</button>
            <button class="btn btn-primary" data-action="go"></button>
        `,
        onMount: (modal, close) => {
            const input = modal.querySelector('#settle-received');
            const hint = modal.querySelector('#settle-hint');
            const btn = modal.querySelector('[data-action="go"]');
            const refresh = () => {
                const v = Math.round(Number(input.value) || 0);
                if (v <= 0) {
                    hint.innerHTML = '<span style="color: var(--color-danger);">請輸入實際入帳金額</span>';
                    btn.disabled = true;
                    btn.textContent = '確認';
                    return;
                }
                btn.disabled = false;
                if (v >= due) {
                    hint.innerHTML = `<span style="color: #22946e;">✓ 金額相符，全額結清${sendable ? '並發送合約' : ''}</span>`;
                    btn.textContent = sendable ? '確認並發送合約' : `確認${newStatus}`;
                } else {
                    hint.innerHTML = `<span style="color: #b13535;">差額 $${(due - v).toLocaleString()} — 以實${noun} $${v.toLocaleString()} 拆帳結，剩 $${(due - v).toLocaleString()} 留待結</span>`;
                    btn.textContent = `以實${noun} $${v.toLocaleString()} 拆帳結`;
                }
            };
            input.addEventListener('input', refresh);
            refresh();
            setTimeout(() => { input.focus(); input.select(); }, 30);
            modal.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
            btn.addEventListener('click', () => {
                const v = Math.round(Number(input.value) || 0);
                if (v <= 0) return;
                close();
                if (v >= due) {
                    // 正確 → 全額結帳；doFullSettle 內 maybeAutoSendContract 會跳「合約資訊確認」再發送
                    doFullSettle(inv, due, newStatus);
                } else {
                    // 不正確 → 拆帳確認
                    confirmSplitSettle(inv, v, due - v);
                }
            });
        }
    });
}

// 拆帳確認：實收金額 < 應收 → 確認後把已收部分拆成獨立已結帳目
function confirmSplitSettle(inv, paidPortion, remainingBalance) {
    const isIncome = inv.direction === 'in';
    const noun = isIncome ? '收' : '付';
    const due = (inv.amount || 0) - (inv.discount || 0);
    openConfirm({
        title: '拆帳確認',
        message: `<strong>${inv.id}</strong> 實${noun} <strong>$${paidPortion.toLocaleString()}</strong>，與應${noun} $${due.toLocaleString()} 不符。<br><br>`
            + `將把已${noun}的 <strong>$${paidPortion.toLocaleString()}</strong> 拆成一筆獨立已結帳目，剩餘 <strong>$${remainingBalance.toLocaleString()}</strong> 留在原帳目待結。<br><br>`
            + `⚠ 未全額入帳，<strong>不會發送合約</strong>（需全額結帳後才寄）。`,
        confirmLabel: `確認拆帳結 $${paidPortion.toLocaleString()}`,
        onConfirm: () => doSplitSettle(inv, paidPortion, remainingBalance)
    });
}

// 全額結帳：餘額視為已收/付，整筆關
function doFullSettle(inv, due, newStatus) {
    const patched = { ...inv, paidAmount: due, paidDate: TODAY };
    store.updateInvoice(inv.id, {
        paidAmount: due,
        paidDate: TODAY,
        status: deriveInvoiceStatus(patched)
    });
    showToast(`已結帳：${inv.id}`, 'success');
    // 入帳即發 — 結帳後若對應合約還沒寄, 跳「合約資訊確認」讓管理員確認再發送
    maybeAutoSendContract(inv);
    refreshView();
}

// 拆帳結帳：已收部分拆成新帳目（已結），原帳目改為剩餘金額未收
function doSplitSettle(inv, paidPortion, remainingBalance) {
    const isIncome = inv.direction === 'in';
    const origDue = (inv.amount || 0) - (inv.discount || 0);

    // 1. 建新帳目（已結）— 金額 = paidPortion，完全結清, 不帶任何折扣/加收
    //    把 discount + discountReason + adjustments 全清掉 (新帳目代表「實收」乾淨一筆)
    const draft = {
        ...inv,
        amount: paidPortion,
        discount: 0,
        discountReason: '',
        paidAmount: paidPortion,
        paidDate: TODAY,
        dueDate: TODAY,
        note: `[拆帳結帳] 來源 ${inv.id}（原應${isIncome ? '收' : '付'} $${origDue.toLocaleString()}，本次結 $${paidPortion.toLocaleString()}）` + (inv.note ? ` · ${inv.note}` : ''),
        bankLast5: inv.bankLast5 || '',
        bankVerified: !!inv.bankVerified
    };
    // 拋掉這些欄位避免帶到新 invoice
    delete draft.id;
    delete draft._id;
    delete draft.createdAt;
    delete draft.updatedAt;
    delete draft.lastReminderAt;
    delete draft.adjustments;  // widget JSON 殘留, 防再次編輯時誤套
    // 明確 status (避免 addInvoice 漏 derive 或 deriveInvoiceStatus 邊緣 case)
    draft.status = isIncome ? '已繳清' : '已付';
    const created = store.addInvoice(draft);

    // 2. 原帳目：amount 改成剩餘 due（=remainingBalance + 原 discount），paidAmount 歸 0，清掉末5碼/核對狀態
    //    discount + discountReason 保留 (剩餘那筆的加收/折扣性質還在)
    const remainingPatch = {
        amount: remainingBalance + (inv.discount || 0),  // 還原 due = amount - discount
        paidAmount: 0,
        bankLast5: '',
        bankVerified: false,
        note: (inv.note ? inv.note + ' · ' : '') + `[已拆出 $${paidPortion.toLocaleString()} → ${created.id}]`
    };
    // 明確 status：剩餘那筆 paid=0 → 欠繳/未付
    remainingPatch.status = isIncome ? '欠繳' : '未付';
    store.updateInvoice(inv.id, remainingPatch);

    showToast(`已拆帳：已${isIncome ? '收' : '付'} $${paidPortion.toLocaleString()} → ${created.id}，餘 $${remainingBalance.toLocaleString()} 留待結`, 'success', 5000);
    // 拆帳結帳不寄合約 — 客戶還沒全付完, 合約應該等全額入帳後 (走全額結帳路徑) 才寄
    refreshView();
}

// 合約「層級」發送資格 (不含 LINE 綁定) — 回傳合約物件, 不合格回 null
// 寄合約 = 客戶簽署「前」要拿到的, 待簽署 / 已簽署 都該寄; 只擋已終止 / 已寄過 / 非共居 / 平台收款
function eligibleContractForSend(inv) {
    if (!inv?.contractId) return null;
    const c = mockData.contracts.find(x => x.id === inv.contractId);
    if (!c) return null;
    if (c.contractSentAt) return null;        // 已寄過, 不重發
    if (c.status === '已終止') return null;    // 終止合約不寄
    if (c.renewalState === 'terminated') return null;  // 只擋已終止; active/snoozed/renewed 當期合約仍可寄
    if (c.contractType && c.contractType !== 'cohousing') return null;
    if (c.paymentChannel === 'platform') return null;
    return c;
}

// 找合約對應的租客 (同名優先取已綁 LINE 的那筆) — 跟 sendContractToLine 同邏輯
function tenantForContract(c) {
    const name = (c?.tenant || '').trim();
    return mockData.tenants.find(x => (x.name || '').trim() === name && x.lineUserId)
        || mockData.tenants.find(x => (x.name || '').trim() === name);
}

// 真正「可寄」= 合約層級合格 + 租客有綁 LINE (跟新增入住/續租的發送按鈕一致, 有綁定才發)
function contractForSend(inv) {
    const c = eligibleContractForSend(inv);
    if (!c) return null;
    if (!tenantForContract(c)?.lineUserId) return null;   // 沒綁 LINE → 不算可寄
    return c;
}

// 共用: 入帳後發合約 (核對結帳 + 一般結帳 都呼叫; 批次結帳不呼叫避免連續彈窗)
// 改為「跳合約資訊確認 → 確認後才發送」(取代原本 500ms 靜默自動寄)
function maybeAutoSendContract(inv) {
    const c = contractForSend(inv);
    if (!c) return;
    confirmAndSendContract(c);
}

// 合約資訊確認框：發送前先讓管理員核對合約內容, 確認後才產生 PDF 推到租客 LINE
function confirmAndSendContract(c) {
    const place = [c.propertyName, c.bedNo && `床位 ${c.bedNo}`].filter(Boolean).map(escapeHtml).join(' · ');
    const { total_amount } = buildAdjustmentValues(c);   // 租金總額 (月租 × 期數 + 加 − 折)
    openConfirm({
        title: '確認發送合約',
        message: `即將把合約 PDF 推送到 <strong>${escapeHtml(c.tenant || '')}</strong> 的 LINE，請先核對合約資訊：`
            + `<div style="margin-top: 0.75rem; padding: 0.75rem 0.9rem; background: var(--color-background); border-radius: 8px; font-size: 0.9rem; line-height: 1.8;">`
            + `<div>合約編號：<strong>${c.id}</strong></div>`
            + (place ? `<div>物件：${place}</div>` : '')
            + `<div>租期：${c.startDate || '—'} ~ ${c.endDate || '—'}</div>`
            + `<div>總金額：<strong>$${total_amount}</strong></div>`
            + `<div>每月租金：$${(c.amount || 0).toLocaleString()}</div>`
            + `</div>`
            + `<div style="margin-top: 0.75rem; font-size: 0.85rem; color: var(--text-secondary);">確認後系統會產生合約 PDF 並發送，連結 24 小時內有效。</div>`,
        confirmLabel: '發送合約',
        onConfirm: () => {
            showToast(`發送合約 ${c.id} 給 ${c.tenant}…`, 'info', 3000);
            sendContractToLine(c.id).catch(e => {
                console.warn('[send-contract]', e);
                showToast(`發送合約失敗: ${e.message} (可手動到合約頁重寄)`, 'warning', 6000);
            });
        }
    });
}

// === 批次結帳 ===
function bulkSettle(ids) {
    if (!ids.length) return;
    openConfirm({
        title: '批次結帳確認',
        message: `將把選取的 <strong>${ids.length}</strong> 筆帳款一次標記為已結。<br><br>⚠ 此動作不會核對末 5 碼，請確認已比對過。`,
        confirmLabel: `確認結 ${ids.length} 筆`,
        onConfirm: () => {
            let okCount = 0;
            ids.forEach(id => {
                const inv = mockData.invoices.find(x => x.id === id);
                if (!inv) return;
                const due = (inv.amount || 0) - (inv.discount || 0);
                const patched = { ...inv, paidAmount: due, paidDate: TODAY };
                store.updateInvoice(id, {
                    paidAmount: due,
                    paidDate: TODAY,
                    bankVerified: inv.bankLast5 ? true : inv.bankVerified,
                    status: deriveInvoiceStatus(patched)
                });
                okCount++;
            });
            showToast(`已批次結帳 ${okCount} 筆`, 'success');
            refreshView();
        }
    });
}

// === 補產所有 active 合約缺少的帳單 ===
// (建立 / 續租合約時系統自動產生 1 張全期帳單；這顆按鈕是「救火用」)
// UIUX #3 危險操作護欄：先 dry-run preview 把要新增的逐筆列出，確認後才執行
function backfillContractInvoices() {
    const { wouldCreate, wouldSkip } = previewContractInvoices();
    // 沒有要新增的就直接告知
    if (wouldCreate.length === 0) {
        openConfirm({
            title: '檢查結果',
            message: `所有 ${wouldSkip.length} 份進行中合約都已有對應帳單，無需補產。`,
            confirmLabel: '知道了',
            hideCancel: true
        });
        return;
    }
    // 有要新增 → preview 列出每一筆 (每筆可勾選, 只補打勾的)
    const previewRows = wouldCreate.map(({ invoice, contract }) => `
        <tr data-row-cid="${contract.id}">
            <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border-color); text-align: center;">
                <input type="checkbox" class="backfill-pick" data-cid="${contract.id}" checked style="cursor: pointer; width: 16px; height: 16px;">
            </td>
            <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-family: monospace; font-size: var(--text-xs);">${contract.id}</td>
            <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs);">${contract.tenant || '—'}</td>
            <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs);">${(contract.propertyName || '').replace('聚空間 - ', '')}</td>
            <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs); color: var(--text-muted);">${contract.startDate || '—'} ~ ${contract.endDate || '—'}</td>
            <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); text-align: right; font-weight: 600; color: var(--color-primary);">$${(invoice.amount || 0).toLocaleString()}</td>
        </tr>
    `).join('');
    const previewHtml = `
        <div style="margin-bottom: 0.75rem; padding: 0.65rem 0.8rem; background-color: var(--bg-secondary); border-radius: 6px; border-left: 3px solid var(--color-warning); font-size: var(--text-sm); line-height: 1.5;">
            <div style="font-weight: 600; color: var(--text-main);">
                <i class="ph ph-info"></i> 找到 <strong style="color: var(--color-primary);">${wouldCreate.length}</strong> 筆可補${wouldSkip.length > 0 ? `（跳過 ${wouldSkip.length} 筆已存在）` : ''}
            </div>
            <div style="font-size: var(--text-xs); color: var(--text-muted); margin-top: 0.25rem;">
                預設全選, 可取消勾不想補的; 只補打勾的.
            </div>
        </div>
        <div class="search-bar" style="margin-bottom: 0.5rem; width: 100%;">
            <i class="ph ph-magnifying-glass"></i>
            <input type="text" id="backfill-search" placeholder="搜尋合約/租客/床位..." autocomplete="off" style="font-size: var(--text-base);">
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; font-size: var(--text-xs);">
            <button type="button" class="btn btn-outline" id="backfill-select-all" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);">全選</button>
            <button type="button" class="btn btn-outline" id="backfill-select-none" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);">全不選</button>
            <button type="button" class="btn btn-outline" id="backfill-select-visible" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);">只選當前顯示</button>
            <span id="backfill-count" style="margin-left: auto; color: var(--text-muted);">已選 ${wouldCreate.length} / ${wouldCreate.length}</span>
        </div>
        <div style="max-height: 380px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px;">
            <table style="width: 100%; border-collapse: collapse; font-size: var(--text-sm);">
                <thead style="position: sticky; top: 0; background: var(--bg-secondary); z-index: 1;">
                    <tr>
                        <th style="padding: 0.5rem 0.5rem; width: 32px;"><input type="checkbox" id="backfill-header-check" checked style="cursor: pointer;"></th>
                        <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">合約</th>
                        <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">租客</th>
                        <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">床位</th>
                        <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">合約期間</th>
                        <th style="padding: 0.5rem 0.6rem; text-align: right; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">金額</th>
                    </tr>
                </thead>
                <tbody>${previewRows}</tbody>
            </table>
        </div>
    `;
    openConfirm({
        title: '🛡️ 補產缺漏帳單 — 預覽',
        message: previewHtml,
        confirmLabel: `確認補產`,
        maxWidth: 800,
        onMount: (overlay) => {
            const checks = () => overlay.querySelectorAll('.backfill-pick');
            const countEl = overlay.querySelector('#backfill-count');
            const headerCheck = overlay.querySelector('#backfill-header-check');
            const confirmBtn = overlay.querySelector('[data-action="confirm"]');
            const updateCount = () => {
                const total = wouldCreate.length;
                const picked = Array.from(checks()).filter(c => c.checked).length;
                if (countEl) countEl.textContent = `已選 ${picked} / ${total}`;
                if (confirmBtn) {
                    confirmBtn.textContent = picked === 0 ? '沒選就沒得補' : `確認補產 ${picked} 筆`;
                    confirmBtn.disabled = (picked === 0);
                }
                // Header check: 若全打勾 → 打勾; 若全不勾 → 不勾; 部分 → indeterminate
                if (headerCheck) {
                    if (picked === total) { headerCheck.checked = true; headerCheck.indeterminate = false; }
                    else if (picked === 0) { headerCheck.checked = false; headerCheck.indeterminate = false; }
                    else { headerCheck.indeterminate = true; }
                }
            };
            overlay.addEventListener('change', (e) => {
                if (e.target.classList?.contains('backfill-pick')) updateCount();
            });
            overlay.querySelector('#backfill-select-all')?.addEventListener('click', () => {
                checks().forEach(c => { c.checked = true; }); updateCount();
            });
            overlay.querySelector('#backfill-select-none')?.addEventListener('click', () => {
                checks().forEach(c => { c.checked = false; }); updateCount();
            });
            overlay.querySelector('#backfill-select-visible')?.addEventListener('click', () => {
                checks().forEach(c => {
                    const row = c.closest('tr');
                    c.checked = row && row.style.display !== 'none';
                });
                updateCount();
            });
            headerCheck?.addEventListener('change', () => {
                checks().forEach(c => {
                    const row = c.closest('tr');
                    if (!row || row.style.display !== 'none') c.checked = headerCheck.checked;
                });
                updateCount();
            });
            // 搜尋過濾
            overlay.querySelector('#backfill-search')?.addEventListener('input', (e) => {
                const kw = e.target.value.trim().toLowerCase();
                overlay.querySelectorAll('tr[data-row-cid]').forEach(row => {
                    if (!kw) { row.style.display = ''; return; }
                    row.style.display = row.textContent.toLowerCase().includes(kw) ? '' : 'none';
                });
            });
        },
        onConfirm: () => {
            // 只掃還開著的 modal 內的 checkbox (避免抓到別的 modal 的同 class)
            const openOverlay = document.querySelector('.modal-overlay:not(.is-closing)');
            const picked = openOverlay
                ? Array.from(openOverlay.querySelectorAll('.backfill-pick')).filter(c => c.checked).map(c => c.dataset.cid)
                : [];
            if (picked.length === 0) {
                showToast('沒選任何合約, 未補產', 'info');
                return;
            }
            const { created, skipped } = ensureContractInvoices({ contractIds: picked });
            if (created.length === 0) {
                showToast('沒有需要補產的帳單', 'info');
            } else {
                showToast(`✅ 已補產 ${created.length} 筆，跳過 ${skipped} 筆已存在`, 'success', 4000);
            }
            refreshView();
        }
    });
}

function showUnsettledForm(invoice = null) {
    const isEdit = !!invoice;
    const direction = invoice?.direction || 'in';

    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    const buildingOptions = getSortedBuildings({ activeOnly: true })
        .filter(b => (b.mode || 'cohousing') === targetMode)
        .map(b => ({ value: b.id, label: b.name }));
    // 床位 options builder: 依 buildingId filter (跟 contracts.js showContractForm 同款 pattern)
    const buildPropertyOptions = (buildingId) => mockData.properties
        .filter(p => buildingId ? p.buildingId === buildingId : true)
        .slice()
        .sort((a, b) => {
            const ra = Number(a.roomNumber ?? 999), rb = Number(b.roomNumber ?? 999);
            if (ra !== rb) return ra - rb;
            return (a.bedLetter || '').localeCompare(b.bedLetter || '');
        })
        .map(p => ({ value: p.name, label: p.name.replace('聚空間 - ', '') }));
    // 編輯時依現有 propertyName 反查 buildingId 作為初始 filter; 新增時不預設, 顯示全部
    const initialBuildingId = invoice?.propertyName
        ? (mockData.properties.find(p => p.name === invoice.propertyName)?.buildingId || '')
        : '';
    const propertyOptions = buildPropertyOptions(initialBuildingId);
    const tenantOptions = mockData.tenants.map(t => t.name);
    const contractOptions = mockData.contracts.map(c => ({
        value: c.id,
        label: `${c.id} · ${c.tenant} · ${(c.propertyName || '').replace('聚空間 - ', '')}`
    }));
    const typeOptions = mockData.invoiceTypes
        .filter(t => direction === 'out' ? t.direction !== 'in' : t.direction !== 'out')
        .map(t => t.name);

    const paymentMethodOptions = (mockData.paymentMethods || []).map(p => ({ value: p.name, label: p.name }));
    const defaultPaymentMethod = paymentMethodOptions[0]?.value || '匯款';

    // 此頁只處理「向租客收的應收」，固定 direction='in'，公司支出不在這裡建
    // 排版對齊 finance.js 編輯收入 modal
    const fields = [
        { name: 'buildingId', label: '館別', type: 'select', required: true, options: buildingOptions },
        { name: 'propertyName', label: '物件', type: 'select', required: true, options: propertyOptions },
        { name: 'tenant', label: '租客', type: 'select', required: true, options: tenantOptions, searchable: true, placeholder: '輸入姓名搜尋...', span: 2 },
        { name: 'periodStart', label: '租期起', type: 'date' },
        { name: 'periodEnd', label: '租期止', type: 'date' },
        { name: '__sep_payment', type: 'section', label: '' },
        { name: 'dueDate', label: '應結日', type: 'date', required: true, value: TODAY },
        { name: 'type', label: '項目', type: 'select', required: true, options: typeOptions },
        { name: 'amount', label: '租金金額', type: 'number', required: true, span: 2 },
        // 折扣 / 加收 widget — 跟合約 form 同款
        { name: 'adjustments', type: 'placeholder' },
        { name: 'discount', type: 'hidden', value: invoice?.discount ?? 0 },
        { name: 'discountReason', type: 'hidden', value: invoice?.discountReason ?? '' },
        { name: 'totalDue', label: '應收總額', type: 'number', span: 2, hint: '租金金額 + 加收 − 折扣 (自動計算)' },
        { name: 'paidAmount', label: '已收金額', type: 'number', value: invoice?.paidAmount ?? 0 },
        { name: 'paymentMethod', label: '付款方式', type: 'select', options: paymentMethodOptions, value: invoice?.paymentMethod ?? defaultPaymentMethod },
        { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 2 }
    ];

    openFormModal({
        title: isEdit ? `編輯待結：${invoice.id}` : '新增租客應收帳款',
        maxWidth: 700,
        fields,
        values: invoice ? { ...invoice, buildingId: invoice.buildingId || initialBuildingId } : {},
        submitLabel: isEdit ? '儲存變更' : '建立',
        onFormMount: (form) => {
            // 折扣 / 加收 widget — 跟合約 / 編輯收入同款
            const initialReason = invoice?.discountReason || '';
            let prefillReason = initialReason;
            if (invoice && Number(invoice.discount) !== 0 && (!initialReason || !initialReason.trim().startsWith('['))) {
                const d = Number(invoice.discount);
                prefillReason = JSON.stringify([{
                    kind: d < 0 ? 'add' : 'sub',  // income: <0=加收, >0=折扣
                    label: initialReason || '',
                    amount: Math.abs(d)
                }]);
            }
            const amountInputUS = form.querySelector('[name="amount"]');
            const totalDueInputUS = form.querySelector('[name="totalDue"]');
            const recomputeUS = (net) => {
                if (!totalDueInputUS) return;
                const amt = Number(amountInputUS?.value) || 0;
                totalDueInputUS.value = String(amt - (net || 0));
            };
            initAdjustmentsWidget({
                container: form.querySelector('#ph-adjustments'),
                discountInput: form.querySelector('[name="discount"]'),
                discountReasonInput: form.querySelector('[name="discountReason"]'),
                initialReason: prefillReason,
                onChange: (net) => recomputeUS(net)
            });
            amountInputUS?.addEventListener('input', () => {
                const widgetNet = Number(form.querySelector('[name="discount"]')?.value) || 0;
                recomputeUS(widgetNet);
            });
            // 應收總額 readonly 灰底橘字
            if (totalDueInputUS) {
                totalDueInputUS.readOnly = true;
                totalDueInputUS.style.backgroundColor = 'var(--bg-tertiary)';
                totalDueInputUS.style.cursor = 'not-allowed';
                totalDueInputUS.style.fontWeight = '700';
                totalDueInputUS.style.color = 'var(--color-primary)';
            }

            // 館別變更 → 重 build 物件下拉 (跟 contracts.js showContractForm 同款 pattern)
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

            // === bundle 子合約偵測：此 invoice 對應的合約若是 bundle child, 鎖收款欄位 + 加提示 ===
            // (參考 contracts.js showContractForm bundle child 寫法)
            const linkedContract = mockData.contracts.find(c => c.id === invoice?.contractId);
            const isBundleChildInv = !!linkedContract?.bundleParentContractId;
            if (isBundleChildInv) {
                const parentId = linkedContract.bundleParentContractId;
                const discountInputUS = form.querySelector('[name="discount"]');
                const discountReasonInputUS = form.querySelector('[name="discountReason"]');
                const paidInputUS = form.querySelector('[name="paidAmount"]');
                const adjustPhEl = form.querySelector('#ph-adjustments');
                // amount / paidAmount / discount / totalDue 全部鎖
                [amountInputUS, paidInputUS, totalDueInputUS, discountInputUS].forEach(el => {
                    if (!el) return;
                    el.setAttribute('readonly', '');
                    el.disabled = true;
                    el.style.background = 'var(--bg-tertiary)';
                    el.style.cursor = 'not-allowed';
                });
                if (adjustPhEl) {
                    adjustPhEl.style.opacity = '0.5';
                    adjustPhEl.style.pointerEvents = 'none';
                }
                // 顯眼提示 (放在 form 最上方) — 點主合約 ID 可跳轉
                if (!form.querySelector('.bundle-child-inv-hint')) {
                    const hint = document.createElement('div');
                    hint.className = 'bundle-child-inv-hint';
                    hint.style.cssText = 'padding: 0.6rem 0.8rem; background: var(--color-info-light); border-left: 3px solid var(--color-info); border-radius: var(--radius-sm); margin-bottom: 0.9rem; font-size: var(--text-sm); line-height: 1.7; color: var(--text-main);';
                    hint.innerHTML = `<i class="ph ph-link" style="vertical-align: -2px; margin-right: 0.3rem; color: var(--color-info);"></i>此 invoice 屬於 bundle 子合約 <strong style="font-family: monospace; background: var(--bg-tertiary); padding: 0.05rem 0.35rem; border-radius: var(--radius-sm);">${escapeHtml(invoice.contractId)}</strong>，收款請編輯主合約 <button type="button" class="bundle-jump-parent" data-pid="${escapeHtml(parentId)}" style="font-family: monospace; background: var(--color-info-light); border: 1px solid var(--color-info); color: var(--color-info); padding: 0.05rem 0.45rem; border-radius: var(--radius-sm); cursor: pointer; font-weight: 700;">${escapeHtml(parentId)}</button> 的 invoice。`;
                    form.prepend(hint);
                    // 點主合約 ID → 跳合約 detail
                    hint.querySelector('.bundle-jump-parent')?.addEventListener('click', (e) => {
                        const pid = e.currentTarget.dataset.pid;
                        if (pid && window.openEntity) window.openEntity('contract', pid);
                    });
                }
            }
        },
        onSubmit: (values) => {
            const { totalDue: _td, ...cleanValues } = values;
            const discount = Number(values.discount) || 0;
            const paidAmount = Number(values.paidAmount) || 0;
            const draft = {
                ...cleanValues,
                direction: 'in',
                discount,
                paidAmount,
                paidDate: paidAmount > 0 ? TODAY : null
            };
            draft.status = deriveInvoiceStatus(draft);
            if (isEdit) {
                store.updateInvoice(invoice.id, draft);
                showToast('已更新帳款', 'success');
            } else {
                const created = store.addInvoice(draft);
                showToast(`已新增待結：${created.id}`, 'success');
            }
            refreshView();
        }
    });
}

function deleteUnsettled(id) {
    const inv = mockData.invoices.find(x => x.id === id);
    if (!inv) return;
    openConfirm({
        title: '刪除帳款',
        message: `確定要刪除 <strong>${inv.id}</strong> 嗎？`,
        danger: true,
        confirmLabel: '確定刪除',
        onConfirm: () => {
            store.deleteInvoice(id);
            showToast('已刪除', 'success');
            refreshView();
        }
    });
}

// 催繳: 發 LINE 推送給租客 + 7 天 cooldown 防 spam
async function remindUnsettled(id) {
    const inv = mockData.invoices.find(x => x.id === id);
    if (!inv) return;

    // 支出 (向房東付款) 沒 LINE 對象, 維持原行為只記錄
    if (inv.direction !== 'in') {
        showToast(`已記錄通知：合約 ${inv.contractId || '對方'}（支出類目前不發 LINE）`, 'info');
        return;
    }

    const tenantName = (inv.tenant || '').trim();
    if (!tenantName) {
        showToast('此筆 invoice 沒有租客資料, 無法催繳', 'danger');
        return;
    }
    // 找對應租客 — 優先綁定 LINE 的, fallback first match
    const tenant = mockData.tenants.find(t => (t.name || '').trim() === tenantName && t.lineUserId)
                || mockData.tenants.find(t => (t.name || '').trim() === tenantName);
    if (!tenant) {
        showToast(`找不到租客「${tenantName}」`, 'danger');
        return;
    }
    if (!tenant.lineUserId) {
        showToast(`${tenant.name} 還沒綁 LINE, 無法自動催繳。請先請他加 LINE 官方帳號`, 'warning', 6000);
        return;
    }

    // 7 天 cooldown — 同一筆 invoice 7 天內已催過 → 跳 confirm 才能再催
    const COOLDOWN_DAYS = 7;
    const lastReminderAt = inv.lastReminderAt ? new Date(inv.lastReminderAt) : null;
    const now = new Date();
    if (lastReminderAt) {
        const daysSince = Math.floor((now - lastReminderAt) / (86400 * 1000));
        if (daysSince < COOLDOWN_DAYS) {
            const ok = window.confirm(
                `這筆帳款 ${daysSince} 天前剛催過 (${inv.lastReminderAt.slice(0,10)}), 真的要再催一次嗎?\n\n建議至少間隔 ${COOLDOWN_DAYS} 天避免打擾。`
            );
            if (!ok) return;
        }
    }

    // 組訊息 (用戶最終確認版)
    const due = (Number(inv.amount) || 0) - (Number(inv.discount) || 0);
    const paid = Number(inv.paidAmount) || 0;
    const remaining = Math.max(0, due - paid);
    const typeLabel = inv.type || '房租';
    // 館別 / 床位 / 合約起訖日 — 從對應合約抓 (沒對應就秀帳單上的)
    const contract = inv.contractId ? mockData.contracts.find(c => c.id === inv.contractId) : null;
    const buildingName = mockData.buildings.find(b => b.id === inv.buildingId)?.name || '';
    const propertyName = (contract?.propertyName || inv.propertyName || '').replace('聚空間 - ', '').replace(buildingName, '').trim();
    const locationLine = [buildingName, propertyName, contract ? `${contract.startDate} ~ ${contract.endDate}` : null]
        .filter(Boolean).join(' / ');

    const message =
`${tenant.name} 你好 ☺️

🔔提醒你 「${typeLabel}」還有 NT$${remaining.toLocaleString()} 未繳清

${locationLine}

繳款完成後， 請回傳「銀行帳戶末 5 碼」(5 位數字就好，例如 12345)，
系統會自動記錄到您的帳單上 ✨

如有疑問請傳「找小編」 🙂`;

    showToast(`催繳 ${tenant.name}…`, 'info');
    try {
        await pushToTenant(tenant.id, {
            message,
            messageType: 'reminder',
            invoiceId: inv.id
        });
        // 記錄 lastReminderAt 到 invoice 上
        store.updateInvoice(inv.id, { lastReminderAt: now.toISOString() });
        showToast(`✅ 已催繳 ${tenant.name} ($${remaining.toLocaleString()})`, 'success', 4000);
        refreshView();
    } catch (e) {
        console.error('[remind]', e);
        showToast(`催繳失敗: ${e.message}`, 'danger', 5000);
    }
}

export function initUnsettledActions(scope) {
    scope.querySelector('#btn-new-unsettled')?.addEventListener('click', () => showUnsettledForm());
    scope.querySelector('#btn-gen-monthly')?.addEventListener('click', () => backfillContractInvoices());

    // 對象欄裡的合約 ID button → 跳合約 detail
    scope.addEventListener('click', (e) => {
        const link = e.target.closest('[data-action="open-contract"]');
        if (!link) return;
        e.preventDefault();
        const cid = link.dataset.cid;
        if (cid && window.openEntity) window.openEntity('contract', cid);
    });

    scope.querySelectorAll('.unsettled-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const id = e.currentTarget.dataset.id;
            const inv = mockData.invoices.find(x => x.id === id);
            if (!inv) return;
            if (action === 'settle') settleInvoice(id);
            if (action === 'verify') showVerifyModal(id);
            if (action === 'edit') showUnsettledForm(inv);
            if (action === 'delete') deleteUnsettled(id);
            if (action === 'remind') remindUnsettled(id);
        });
    });

    // 批次選取
    const checkAll = scope.querySelector('#check-all');
    const rowChecks = scope.querySelectorAll('.row-check');
    const bulkBar = scope.querySelector('#bulk-action-bar');
    const bulkCount = scope.querySelector('#bulk-count');

    function updateBulkBar() {
        const checked = scope.querySelectorAll('.row-check:checked');
        const count = checked.length;
        if (count > 0) {
            bulkBar.style.display = 'flex';
            bulkCount.textContent = count;
        } else {
            bulkBar.style.display = 'none';
        }
        // 同步全選狀態
        if (checkAll) {
            checkAll.checked = count > 0 && count === rowChecks.length;
            checkAll.indeterminate = count > 0 && count < rowChecks.length;
        }
    }
    rowChecks.forEach(cb => cb.addEventListener('change', updateBulkBar));
    checkAll?.addEventListener('change', () => {
        rowChecks.forEach(cb => { cb.checked = checkAll.checked; });
        updateBulkBar();
    });
    scope.querySelector('#btn-bulk-clear')?.addEventListener('click', () => {
        rowChecks.forEach(cb => { cb.checked = false; });
        updateBulkBar();
    });
    scope.querySelector('#btn-bulk-settle')?.addEventListener('click', () => {
        const ids = Array.from(scope.querySelectorAll('.row-check:checked')).map(cb => cb.dataset.id);
        bulkSettle(ids);
    });
}
