// 待結帳款頁
// 集中追蹤所有「欠繳 / 未付」帳款
// 階段 2 新增：末 5 碼核對 / 批次結帳 / 一鍵產生本月帳單
import { mockData, store, isUnsettled, ensureContractInvoices, previewContractInvoices, getSortedBuildings, deriveInvoiceStatus, formatDiscountReason } from '../data.js';
import { openFormModal, openConfirm, showToast, refreshView } from '../utils/ui.js';
import { renderFinanceSubTabs } from '../utils/financeSubTabs.js';
import { escapeHtml } from '../utils/escape.js';
import { filterInvoicesByMode } from '../utils/modeFilter.js';
import { initAdjustmentsWidget } from '../utils/adjustmentsWidget.js';
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

    // 各館未結筆數
    const allBuildings = getSortedBuildings({ activeOnly: true });
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

        return `
            <tr data-row-id="${inv.id}" data-status="${statusAttr}" data-building="${buildingName(inv.buildingId)}" data-search="${searchText}" class="row-desktop ${overdue ? 'is-overdue-row' : ''} ${inv.bankLast5 && !inv.bankVerified ? 'is-await-verify-row' : ''}">
                <td><input type="checkbox" class="row-check" data-id="${inv.id}"></td>
                <td>${dirBadge}</td>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <strong style="font-size: var(--text-base);">${inv.id}</strong>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">${buildingName(inv.buildingId)} · ${inv.type}</span>
                    </div>
                </td>
                <td>${target}</td>
                <td>
                    ${moneyCell({ amount: due, paid, direction: inv.direction, showStatus: false })}
                    ${inv.discount ? `<div style="margin-top: 0.2rem;">${adjustmentBadge(inv.discount)}</div>` : ''}
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
                        + rowAction({ action: 'remind', id: inv.id, icon: 'ph-bell', title: inv.direction === 'in' ? '催繳' : '記錄通知', className: 'unsettled-action' })
                        + rowAction({ action: 'edit', id: inv.id, icon: 'ph-pencil', title: '編輯', className: 'unsettled-action' })
                        + rowAction({ action: 'delete', id: inv.id, icon: 'ph-trash', title: '刪除', variant: 'danger', className: 'unsettled-action' })
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
                <table class="data-table cards-with-hero" style="table-layout: fixed;">
                    <colgroup>
                        <col style="width: 36px;">
                        <col style="width: 7%;">
                        <col style="width: 14%;">
                        <col style="width: 22%;">
                        <col style="width: 14%;">
                        <col style="width: 12%;">
                        <col style="width: 9%;">
                        <col style="width: 22%;">
                    </colgroup>
                    <thead><tr>
                        <th><input type="checkbox" id="check-all"></th>
                        <th>方向</th><th>帳單</th><th>對象</th><th>金額</th><th>應結日</th><th>銀行末 5 碼</th><th>操作</th>
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

// === 末 5 碼核對流程 ===
function showVerifyModal(id) {
    const inv = mockData.invoices.find(x => x.id === id);
    if (!inv) return;

    openFormModal({
        title: '🛡 核對銀行末 5 碼',
        maxWidth: 480,
        fields: [
            { name: 'bankLast5_displayed', label: '租客回報的末 5 碼', type: 'text', value: inv.bankLast5, hint: '⚠ 客戶宣稱的末 5 碼，下方填入銀行 App 顯示的對照', span: 2 },
            { name: 'bankActual', label: '請輸入銀行 App 顯示的末 5 碼', type: 'text', required: true, span: 2 },
            { name: 'paidDate', label: '入帳日', type: 'date', required: true, value: TODAY, span: 2 }
        ],
        values: {},
        submitLabel: '核對 + 結帳',
        onFormMount: (form) => {
            // 第一個欄位設成 readonly
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
            const actual = (values.bankActual || '').trim();
            if (actual !== inv.bankLast5) {
                showToast(`末 5 碼不符！客戶提供 ${inv.bankLast5}，您輸入 ${actual}`, 'danger');
                return false; // 不關閉 modal
            }
            const due = (inv.amount || 0) - (inv.discount || 0);
            const patched = { ...inv, paidAmount: due, paidDate: values.paidDate, bankVerified: true };
            store.updateInvoice(id, {
                paidAmount: due,
                paidDate: values.paidDate,
                bankVerified: true,
                status: deriveInvoiceStatus(patched)
            });
            showToast(`✅ 核對通過：${inv.id} 已結帳`, 'success');
            refreshView();
        }
    });
}

function settleInvoice(id) {
    const inv = mockData.invoices.find(x => x.id === id);
    if (!inv) return;
    const due = (inv.amount || 0) - (inv.discount || 0);
    const balance = Math.max(0, due - (inv.paidAmount || 0));
    const newStatus = inv.direction === 'in' ? '已繳清' : '已付';
    openConfirm({
        title: '結帳確認',
        message: `確定要將 <strong>${inv.id}</strong>（餘額 $${balance.toLocaleString()}）標記為「${newStatus}」？<br><br>結帳後會自動移到「帳務管理」頁的已結帳目。`,
        confirmLabel: `確認${newStatus}`,
        onConfirm: () => {
            const patched = { ...inv, paidAmount: due, paidDate: TODAY };
            store.updateInvoice(id, {
                paidAmount: due,
                paidDate: TODAY,
                status: deriveInvoiceStatus(patched)
            });
            showToast(`已結帳：${inv.id}`, 'success');
            refreshView();
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
    // 有要新增 → preview 列出每一筆
    const previewRows = wouldCreate.slice(0, 50).map(({ invoice, contract }) => `
        <tr>
            <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-family: monospace; font-size: var(--text-xs);">${contract.id}</td>
            <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs);">${contract.tenant || '—'}</td>
            <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs);">${(contract.propertyName || '').replace('聚空間 - ', '')}</td>
            <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); text-align: right; font-weight: 600; color: var(--color-primary);">$${(invoice.amount || 0).toLocaleString()}</td>
        </tr>
    `).join('');
    const previewHtml = `
        <div style="margin-bottom: 1rem; padding: 0.75rem; background-color: var(--bg-secondary); border-radius: 6px; border-left: 3px solid var(--color-warning); font-size: var(--text-sm); line-height: 1.7;">
            <div style="font-weight: 600; color: var(--text-main); margin-bottom: 0.4rem;">
                <i class="ph ph-info"></i> 將建立 <strong style="color: var(--color-primary);">${wouldCreate.length}</strong> 筆帳單${wouldSkip.length > 0 ? `（已跳過 ${wouldSkip.length} 筆已存在）` : ''}：
            </div>
        </div>
        <div style="max-height: 320px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px;">
            <table style="width: 100%; border-collapse: collapse; font-size: var(--text-sm);">
                <thead style="position: sticky; top: 0; background: var(--bg-secondary);">
                    <tr>
                        <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">合約</th>
                        <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">租客</th>
                        <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">床位</th>
                        <th style="padding: 0.5rem 0.6rem; text-align: right; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">金額</th>
                    </tr>
                </thead>
                <tbody>${previewRows}${wouldCreate.length > 50 ? `<tr><td colspan="4" style="padding: 0.5rem; text-align: center; color: var(--text-muted); font-size: var(--text-xs);">… 還有 ${wouldCreate.length - 50} 筆未列出</td></tr>` : ''}</tbody>
            </table>
        </div>
        <div style="margin-top: 0.75rem; font-size: var(--text-xs); color: var(--text-muted); line-height: 1.6;">
            一份合約 = 一張全期帳單。已存在的不重複建立。如果列表有不該補產的，請取消、先去合約頁調整再來。
        </div>
    `;
    openConfirm({
        title: '🛡️ 補產缺漏帳單 — 預覽',
        message: previewHtml,
        confirmLabel: `確認新增 ${wouldCreate.length} 筆`,
        maxWidth: 720,
        onConfirm: () => {
            const { created, skipped } = ensureContractInvoices();
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

    const buildingOptions = getSortedBuildings({ activeOnly: true }).map(b => ({ value: b.id, label: b.name }));
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
                    const newOpts = buildPropertyOptions(bid);
                    propertyWrap.__setOptions(newOpts);
                    // 換館後若原本床位不屬於這個館, 清空 (避免送出時帶錯)
                    if (propertyHidden && propertyHidden.value && !newOpts.find(o => o.value === propertyHidden.value)) {
                        propertyHidden.value = '';
                        const trigger = propertyWrap.querySelector('.custom-select-trigger');
                        if (trigger) trigger.textContent = '請選擇...';
                    }
                }
            });
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

function remindUnsettled(id) {
    const inv = mockData.invoices.find(x => x.id === id);
    if (!inv) return;
    const target = inv.direction === 'in' ? inv.tenant : (inv.contractId || '對方');
    showToast(`已記錄通知：${target}（之後串 LINE 即可實際發送）`, 'info');
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
