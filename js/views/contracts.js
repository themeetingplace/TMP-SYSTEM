import {
    mockData, store,
    getContractLifecycle, daysUntilExpiry, needsDecision, contractLifecycleLabel,
    activeContractFor, activeContractOfTenant,
    findOverlappingBedContracts, findOverlappingTenantContracts,
    getSortedBuildings, leaseEndISO
} from '../data.js';
import { openFormModal, openConfirm, openDetailModal, openModal, showToast, showUndoToast, refreshView } from '../utils/ui.js';
import { escapeHtml as esc, escapeAttr } from '../utils/escape.js';
import { fillContractPdf, downloadPdfBytes, formatRentalPeriod } from '../utils/pdfGen.js';
import { showCheckinAssignmentForm } from './properties.js';
import { pushToTenant, uploadPdfToStorage, resolveSignedPdfUrl, triggerRenewalPoll } from '../utils/line.js';
import { buildPaymentNoticeMessage, previewRenewalFor } from '../utils/paymentNoticeMessage.js';
import { findRenewalConfirmCandidates, confirmAndProcessRenewals } from '../utils/autoRenewalProcessor.js';
import { filterContractsByMode } from '../utils/modeFilter.js';
import { getMode } from '../utils/appMode.js';
import { moneyAmount } from '../utils/moneyDisplay.js';
import { rowAction, rowActionGroup } from '../utils/rowActions.js';
import { entityCard } from '../utils/entityCard.js';
import { emptyState } from '../utils/emptyState.js';
import { initAdjustmentsWidget } from '../utils/adjustmentsWidget.js';
import { buildTermOptions as buildTermOptionsUtil, initTermSelector } from '../utils/termSelector.js';

const CONTRACT_STATUSES = ['已簽署', '待簽署', '即將到期', '已終止'];
const TODAY_DATE = new Date();
const TODAY = TODAY_DATE.toISOString().split('T')[0];

// 「要續租」banner dismiss — 用 localStorage 記住已關過的最大 renew count
// 如果 renew count 增加了 (有新的要續租) 再跳出來
const RENEW_BANNER_KEY = 'pms-renew-banner-dismissed-count';
function isRenewBannerDismissed() {
    try {
        const dismissed = parseInt(localStorage.getItem(RENEW_BANNER_KEY) || '0', 10);
        const current = mockData.contracts.filter(c => c.renewIntent === 'renew' && c.renewalState === 'active').length;
        return current > 0 && current <= dismissed;
    } catch { return false; }
}
function dismissRenewBanner() {
    try {
        const current = mockData.contracts.filter(c => c.renewIntent === 'renew' && c.renewalState === 'active').length;
        localStorage.setItem(RENEW_BANNER_KEY, String(current));
    } catch {}
}

// 合約的首張房租帳單 (money 相關欄位的唯一真相來源 — 建立當下算好存住的)
function getContractInvoice(contract) {
    if (!contract?.id) return null;
    return mockData.invoices
        .filter(i => i.contractId === contract.id && i.direction === 'in' && i.type === '房租')
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0] || null;
}

// 從合約的首張帳單抓加減項目 (季繳優惠 / 能源費等)，給合約 PDF 填入用
function getContractAdjustments(contract) {
    const invoice = getContractInvoice(contract);
    if (!invoice || !invoice.discountReason) return [];
    try {
        const arr = JSON.parse(invoice.discountReason);
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

// 用起訖日反推真正的合約期數 (月) — 不依賴 contract.termMonths 這個欄位本身
// (該欄位在部分建立/續約流程中曾經沒同步寫入, 但 startDate/endDate 一定準;
// 系統「1 個月 = 30 天」的慣例讓這個反推是精確整數, 不會有進位誤差)
function deriveTermMonths(contract) {
    if (contract?.startDate && contract?.endDate) {
        const days = (new Date(contract.endDate) - new Date(contract.startDate)) / 86400000;
        const derived = Math.round(days / 30);
        if (derived > 0) return derived;
    }
    return Number(contract?.termMonths) || 1;
}

// 把加減項目格式化成多行文字塞進 PDF (一行一項)，計算:
//   total_amount   = 租金總額 (整個合約期，加減後) = 月租 × term + 加 − 折
//   monthly_amount = 月付金額                       = total_amount ÷ term
// ⚠ 2026-07-24: total_amount 一律用 contract.amount × term 現場算, 不要信任
// invoice.amount — 曾試過改成直接讀帳單金額, 結果抓到另一個更早的真相: 「編輯
// 合約」modal 改動租金 / 合約期時, 從來沒把重算後的總額寫回帳單 (下面 onSubmit
// 已經補上這段同步), 導致舊帳單金額可能永遠停在建立當下的錯誤值 (C218 案例:
// 續約當下用錯期數建了 1 個月的帳單金額). PDF 現場算才能保證跟 modal 看到的
// 應收總額一致, 不受帳單裡可能過期的 amount 影響。
function buildAdjustmentValues(contract) {
    const adjustments = getContractAdjustments(contract);
    const base = Number(contract?.amount) || 0;
    const term = deriveTermMonths(contract);
    const net = adjustments.reduce((s, a) => {
        const v = Number(a.amount) || 0;
        return s + (a.kind === 'add' ? v : -v);
    }, 0);
    const termTotal = base * term + net;
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

// 合約 PDF 範本要填入的「所有欄位值」— 下載 PDF / LINE 寄合約共用同一份, 保證一致。
// 範本裡的表單欄位「名稱」要跟這裡的 key 一模一樣才會被填入 (大小寫、底線都要對)。
//   欄位名            意義
//   ─────────────    ─────────────────────────────
//   issue_date       生成當天日期 (今天, YYYY/MM/DD)
//   address          物件地址 (床位地址, 沒有就退回館別地址)
//   bed_no           床位編號 (例 R2-A)
//   tenant_name      承租人姓名
//   rental_period    租賃期間 (起 ~ 迄 合併一格)
//   start_date       租約開始日 (YYYY/MM/DD)
//   end_date         租約結束日 (YYYY/MM/DD)
//   total_days       租約共幾日 (起訖日相差天數; 本系統 1 個月=30 天)
//   rent_amount      每月租金
//   deposit_amount   押金
//   total_amount     租金總額 (月租 × 期數 + 加項 − 折扣)
//   monthly_amount   月付金額 (總額 ÷ 期數)
//   adjustments      折扣 / 加收 明細 (多行文字)
function buildPdfFieldValues(c) {
    const adj = buildAdjustmentValues(c);
    const slash = (d) => d ? String(d).replace(/-/g, '/') : '';
    const todayISO = new Date().toISOString().slice(0, 10);
    const prop = mockData.properties.find(p => p.name === c.propertyName);
    const bld = mockData.buildings.find(b => b.id === getContractBuildingId(c));
    const address = prop?.address || bld?.address || '';
    let totalDays = '';
    if (c.startDate && c.endDate) {
        const d = Math.round((new Date(c.endDate) - new Date(c.startDate)) / 86400000);
        if (d > 0) totalDays = String(d);
    }
    return {
        issue_date: slash(todayISO),
        address,
        bed_no: getBedNo(c),
        tenant_name: c.tenant || '',
        rental_period: formatRentalPeriod(c.startDate, c.endDate),
        start_date: slash(c.startDate),
        end_date: slash(c.endDate),
        total_days: totalDays,
        rent_amount: (c.amount || 0).toLocaleString(),
        deposit_amount: (c.depositAmount || 0).toLocaleString(),
        adjustments: adj.adjustments,
        total_amount: adj.total_amount,
        monthly_amount: adj.monthly_amount
    };
}

// total_amount (租金總額) 是金額類重大欄位 — 樣板裡沒這個欄位, PDF 上「租金總額」
// 的位置多半只能顯示跟 rent_amount (月租金) 共用/相同的值, 多期合約看起來會少收錢
// 卻完全沒有錯誤訊息, 只會混在「已下載 (N 個欄位填入)」這種容易被忽略的小 toast 裡。
// 2026-07-24 事故: 追了好幾輪才發現根因其實是樣板本身缺這個欄位, 不是算法錯。
function warnMissingMoneyFields(missingFields) {
    if (!Array.isArray(missingFields) || !missingFields.includes('total_amount')) return;
    showToast('⚠ 合約樣板缺少「total_amount」(租金總額) 欄位！多期合約的 PDF 總額會誤植成跟月租金一樣，請用 PDF 編輯工具在樣板加上這個欄位後，到 系統設定 → 合約範本 重新上傳', 'warning', 10000);
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

// 合約流程進度條 — 5 階段 (對齊用戶流程)
// 1. 催繳 → 2. 客回末5碼 → 3. 核對入帳 → 4. 寄合約 → 5. 收簽署檔 (簽署完成)
// 收簽署檔的同時 webhook 自動把 status 改成「已簽署」, 所以 step 5 = 全流程完成
function contractProgressChip(c, lifecycle) {
    if (lifecycle === 'renewed' || lifecycle === 'terminated') return '';
    if (c.contractType && c.contractType !== 'cohousing') return '';
    if (c.paymentChannel === 'platform') return '';

    const inv = mockData.invoices.find(i =>
        i.contractId === c.id && i.direction === 'in' && i.type === '房租'
    );
    const due = inv ? ((Number(inv.amount) || 0) - (Number(inv.discount) || 0)) : 0;
    const paid = inv ? (Number(inv.paidAmount) || 0) : 0;
    const fullPaid = inv && paid >= due && due > 0;

    const steps = [
        { key: 'reminded', label: '催繳',     done: !!(inv?.lastReminderAt) || fullPaid || !!inv?.bankLast5 },
        { key: 'last5',    label: '客回末5碼', done: !!inv?.bankLast5 || fullPaid },
        { key: 'verified', label: '核對入帳',  done: !!inv?.bankVerified || fullPaid },
        { key: 'sent',     label: '寄合約',   done: !!c.contractSentAt },
        { key: 'returned', label: '收簽署檔', done: !!c.signedFileUrl }
    ];
    const doneCount = steps.filter(s => s.done).length;
    const currentStep = steps.find(s => !s.done);
    const tooltipParts = steps.map(s => `${s.done ? '✓' : '○'} ${s.label}`);
    const tooltip = `進度 ${doneCount}/5 · ${currentStep ? '當前: ' + currentStep.label : '✅ 完成'}\n\n${tooltipParts.join('\n')}`;
    const dots = steps.map(s =>
        `<span class="prog-dot${s.done ? ' is-done' : ''}"></span>`
    ).join('');
    const completeClass = doneCount === 5 ? ' is-complete' : '';
    return `<span class="contract-progress${completeClass}" title="${esc(tooltip)}">${dots}</span>`;
}

// 合約流程全版時間軸 — detail modal 頂部用
// 每步驟一個圓圈 + 日期 + 標籤, 已完成 ✓ green / 進行中 (current step) ⏳ warn / 未來 grey
function contractProgressTimeline(c, lifecycle) {
    if (lifecycle === 'renewed' || lifecycle === 'terminated') return '';
    if (c.contractType && c.contractType !== 'cohousing') return '';
    if (c.paymentChannel === 'platform') return '';

    const inv = mockData.invoices.find(i =>
        i.contractId === c.id && i.direction === 'in' && i.type === '房租'
    );
    const due = inv ? ((Number(inv.amount) || 0) - (Number(inv.discount) || 0)) : 0;
    const paid = inv ? (Number(inv.paidAmount) || 0) : 0;
    const fullPaid = inv && paid >= due && due > 0;

    const fmtDate = (iso) => iso ? iso.slice(0, 10) : '';
    const steps = [
        { key: 'reminded', label: '催繳', icon: 'ph-bell',
          done: !!(inv?.lastReminderAt) || fullPaid || !!inv?.bankLast5,
          at: inv?.lastReminderAt || null,
          skipped: fullPaid && !inv?.lastReminderAt && !inv?.bankLast5 },
        { key: 'last5', label: '客回末5碼', icon: 'ph-keyhole',
          done: !!inv?.bankLast5 || fullPaid,
          at: null,
          skipped: fullPaid && !inv?.bankLast5 },
        { key: 'verified', label: '核對入帳', icon: 'ph-shield-check',
          done: !!inv?.bankVerified || fullPaid,
          at: inv?.paidDate || null },
        { key: 'sent', label: '寄合約', icon: 'ph-paper-plane-tilt',
          done: !!c.contractSentAt,
          at: c.contractSentAt },
        { key: 'returned', label: '收簽署檔', icon: 'ph-check-square',
          done: !!c.signedFileUrl,
          at: null }
    ];

    const doneCount = steps.filter(s => s.done).length;
    const currentIdx = steps.findIndex(s => !s.done);
    const isComplete = doneCount === 5;

    const items = steps.map((s, i) => {
        let stateCls = 'is-future';
        let iconSymbol = '';
        if (s.done) {
            stateCls = s.skipped ? 'is-skipped' : 'is-done';
            iconSymbol = s.skipped ? '–' : '✓';
        } else if (i === currentIdx) {
            stateCls = 'is-current';
            iconSymbol = '⏳';
        } else {
            iconSymbol = '○';
        }
        const dateLabel = s.at ? `<div class="ctl-date">${fmtDate(s.at)}</div>` : '';
        return `
            <div class="ctl-step ${stateCls}" role="button" tabindex="0"
                 data-step-edit="${s.key}" data-contract-id="${esc(c.id)}"
                 title="點擊手動編輯此步驟">
                <div class="ctl-circle">${iconSymbol}</div>
                <div class="ctl-label">${s.label}</div>
                ${dateLabel}
            </div>
        `;
    }).join('<div class="ctl-line"></div>');

    const headLabel = isComplete
        ? '✅ 流程完成'
        : currentIdx >= 0
            ? `⏳ 目前到 ${steps[currentIdx].label} (${doneCount}/5)`
            : '';

    return `
        <div class="contract-timeline-wrap">
            <div class="ctl-head">
                <span class="ctl-title"><i class="ph ph-list-checks"></i> 合約流程</span>
                <span class="ctl-progress">${headLabel}</span>
            </div>
            <div class="ctl-track">${items}</div>
        </div>
    `;
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
        const priority = { awaiting_decision: 0, expired: 1, expiring_soon: 2, active: 3, pending_termination: 4, snoozed: 5, renewed: 6, terminated: 7 };
        enriched.sort((a, b) => (priority[a._state] ?? 99) - (priority[b._state] ?? 99));
    }

    const totalContracts = enriched.length;
    const decisionCount = enriched.filter(c => needsDecision(c, TODAY_DATE)).length;
    const expiringSoonCount = enriched.filter(c => c._state === 'expiring_soon').length;
    const activeCount = enriched.filter(c => c._state === 'active' || c._state === 'snoozed' || c._state === 'expiring_soon' || c._state === 'awaiting_decision' || c._state === 'expired' || c._state === 'pending_termination').length;
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
        const isArchived = lifecycle === 'renewed' || lifecycle === 'terminated';
        // archived (已續約 / 已終止) 的合約已經處理完, 不該再出現決策按鈕
        const isDecision = !isArchived && (lifecycle === 'awaiting_decision' || lifecycle === 'expired' || hasIntent);

        const searchText = [c.id, c.propertyName, c.tenant].join(' ').toLowerCase();
        const days = c._daysLeft;

        // 操作按鈕：未決策的合約優先顯示決策按鈕
        const decisionButtons = isDecision
            ? rowAction({ action: 'renew', id: c.id, icon: 'ph-arrow-clockwise', title: '續租', label: '續租', variant: 'success', className: 'contract-action' })
              + rowAction({ action: 'terminate', id: c.id, icon: 'ph-door-open', title: '退租', variant: 'danger', className: 'contract-action' })
              + rowAction({ action: 'snooze', id: c.id, icon: 'ph-clock-clockwise', title: '暫緩', className: 'contract-action' })
            : '';

        const signedButton = c.signedFileUrl
            ? rowAction({ action: 'view-signed', id: c.id, icon: 'ph-check-square', title: '租客已回傳簽署檔，點此檢視', variant: 'success', className: 'contract-action' })
            : '';

        const standardButtons =
            rowAction({ action: 'view', id: c.id, icon: 'ph-eye', title: '檢視合約', className: 'contract-action' })
            + rowAction({ action: 'edit', id: c.id, icon: 'ph-pencil', title: '編輯合約', className: 'contract-action' })
            // 下載 PDF: 已結束合約 (已續約/已終止) 也開放, 方便事後調閱存檔 (2026-08-01 用戶要求)
            + rowAction({ action: 'download', id: c.id, icon: 'ph-download', title: '下載 PDF', className: 'contract-action' })
            // LINE 寄合約: 只對進行中的合約 (寄給已退租的人不合理)
            + (isArchived ? '' : rowAction({ action: 'send-line', id: c.id, icon: 'ph-paper-plane-tilt', title: 'LINE 寄合約 PDF', className: 'contract-action' }))
            + signedButton
            + rowAction({ action: 'delete', id: c.id, icon: 'ph-trash', title: '刪除', variant: 'danger', className: 'contract-action' });

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
        const sharedDataAttrs = `data-row-id="${esc(c.id)}" data-status="${esc(lifecycle)}" data-area="${esc(areaName)}" data-renew="${c.renewIntent || 'none'}" data-channel="${esc(c.paymentChannel || 'self')}" data-tenant="${escapeAttr(c.tenant || '')}" data-building="${esc(mockData.properties.find(p => p.name === c.propertyName)?.buildingId || '')}" data-search="${escapeAttr(searchText)}"`;

        // ===== Mobile card 共用資料 =====
        const mobileChips = [
            c.startDate ? { icon: 'ph-calendar-blank', label: `起 ${c.startDate}` } : null,
            c.endDate ? { icon: 'ph-calendar-check', label: `到 ${c.endDate}`, type: !isArchived && days != null && days < 0 ? 'danger' : (!isArchived && days != null && days <= 14 ? 'warning' : undefined) } : null,
            c.parentContractId ? { icon: 'ph-link', label: `續自 ${c.parentContractId}` } : null,
            lifecycle === 'snoozed' && c.snoozeUntil ? { icon: 'ph-pause', label: `${c.snoozeUntil} 再提醒` } : null
        ].filter(Boolean);

        const mobileActions = rowActionGroup(`${decisionButtons}${standardButtons}`);

        return `
            <tr ${sharedDataAttrs} class="${rowClass} row-desktop">
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
                    <div style="font-size: var(--text-base); font-weight: 500;">${moneyAmount(c.amount || 0)}</div>
                    <div style="font-size: var(--text-xs); color: var(--text-muted);">${c.termMonths || 1} 個月期</div>
                </td>
                <td>${c.startDate ? `<span style="font-weight: 500;">${c.startDate}</span>` : '<span style="color: var(--text-muted)">—</span>'}</td>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        ${c.endDate ? `<span style="font-weight: 500;">${c.endDate}</span>` : '<span style="color: var(--text-muted)">—</span>'}
                        ${!isArchived && days != null ? `<span style="font-size: var(--text-xs); color: ${days < 0 ? 'var(--color-danger)' : days <= 14 ? 'var(--color-warning)' : 'var(--text-muted)'};">${daysLabel(days)}</span>` : ''}
                        ${lifecycle === 'snoozed' && c.snoozeUntil ? `<span style="font-size: var(--text-2xs); color: var(--color-info);">⏸ ${c.snoozeUntil} 再提醒</span>` : ''}
                    </div>
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 0.3rem; align-items: flex-start;">
                        <div>${lifecycleBadge(lifecycle)}${renewIntentBadge(c)}</div>
                        ${contractProgressChip(c, lifecycle)}
                    </div>
                </td>
                <td style="text-align: right;">
                    ${rowActionGroup(`${decisionButtons}${standardButtons}`)}
                </td>
            </tr>
            <tr ${sharedDataAttrs} class="${rowClass} row-mobile-card">
                <td colspan="8">
                    ${entityCard({
                        title: `${esc(c.id)}${c.paymentChannel === 'platform' ? ` <span class="status-badge info" style="font-size: var(--text-2xs);">🌐 ${esc(c.platformName || '外部平台')}</span>` : ''}${c.contractType === 'managed-owner' ? ' <span class="status-badge info" style="font-size: var(--text-2xs);">📋 屋主委託</span>' : ''}${c.contractType === 'managed-tenant' ? ' <span class="status-badge info" style="font-size: var(--text-2xs);">🏠 代管租賃</span>' : ''}${bundleBadge}`,
                        subtitle: esc(c.propertyName || (c.buildingId ? (mockData.buildings.find(b => b.id === c.buildingId)?.name + ' (整棟)') : '') || ''),
                        hero: {
                            value: moneyAmount(c.amount || 0),
                            badge: `${lifecycleBadge(lifecycle)}${renewIntentBadge(c)}`
                        },
                        chips: mobileChips,
                        meta: [
                            { cap: '租客', val: `<strong>${esc(c.tenant || '—')}</strong>` },
                            { cap: '合約期', val: `${c.termMonths || 1} 個月期` }
                        ],
                        note: !isArchived && days != null ? daysLabel(days) : '',
                        actions: mobileActions
                    })}
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="metrics-grid">
            <div class="card metric-card"><div class="metric-header"><span>進行中合約</span><div class="metric-icon success"><i class="ph ph-file-text"></i></div></div><div class="metric-value">${activeCount}</div><div class="metric-subtext">含即將到期/待決策</div></div>
            <div class="card metric-card ${decisionCount > 0 ? 'highlight-danger' : ''}"><div class="metric-header"><span>待決策</span><div class="metric-icon danger"><i class="ph ph-warning-circle"></i></div></div><div class="metric-value" style="color: ${decisionCount > 0 ? 'var(--color-danger)' : 'var(--text-main)'};">${decisionCount}</div><div class="metric-subtext">需要續租 / 退租決定</div></div>
            <div class="card metric-card"><div class="metric-header"><span>即將到期</span><div class="metric-icon warning"><i class="ph ph-clock"></i></div></div><div class="metric-value">${expiringSoonCount}</div><div class="metric-subtext">14 天內到期</div></div>
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
                    <button class="btn btn-outline" id="btn-ask-renewal" title="掃描 14 天內到期的合約，可勾選要問誰">
                        <i class="ph ph-chat-circle-dots"></i> 詢問續租
                    </button>
                    <button class="btn btn-outline" id="btn-confirm-renewals" title="已在 LINE 回覆續租但還沒建約的, 勾選確認後建約+發繳款通知">
                        <i class="ph ph-check-circle"></i> 確認續約
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

            ${renewCounts.renew > 0 && !isRenewBannerDismissed() ? `
                <div class="renew-intent-banner" data-jump-filter="renew" data-jump-value="renew">
                    <div class="renew-intent-banner-icon"><i class="ph ph-confetti"></i></div>
                    <div class="renew-intent-banner-body">
                        <strong>🎉 ${renewCounts.renew} 位租客已表達續租意願</strong>
                        <small>點此只看這些合約，準備建立續租</small>
                    </div>
                    <i class="ph ph-arrow-right" style="font-size: 1.1rem; color: var(--color-success);"></i>
                    <button type="button" class="renew-banner-close" data-action="dismiss-renew-banner" title="關閉此提示" aria-label="關閉">
                        <i class="ph ph-x"></i>
                    </button>
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
                <button class="filter-tab" data-filter-value="pending_termination">退租中 (${enriched.filter(c => c._state === 'pending_termination').length})</button>
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
                    <tbody>${tableRows || emptyState({ mode: 'table-row', colspan: 8, icon: 'ph-file-text', title: '尚無合約', hint: '點右上「建立合約」開始新增' })}</tbody>
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
function showContractForm(contract, opts = {}) {
    // 編輯時 dropdown 依當前 mode 篩 (避免共居/代管 properties 混在一起)
    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    const modeBuildingIds = new Set(mockData.buildings.filter(b => (b.mode || 'cohousing') === targetMode).map(b => b.id));
    // 館別 options (對齊 finance.js 樣式)
    const buildingOptions = mockData.buildings
        .filter(b => (b.mode || 'cohousing') === targetMode)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(b => ({ value: b.id, label: b.name }));
    // 當前合約對應床位的 buildingId, 供初始 prefill 用
    const currentProperty = mockData.properties.find(p => p.name === contract.propertyName);
    const initialBuildingId = currentProperty?.buildingId || buildingOptions[0]?.value || '';
    // 床位 options builder: 依 buildingId filter
    const buildPropertyOptions = (buildingId) => mockData.properties
        .filter(p => buildingId ? p.buildingId === buildingId : modeBuildingIds.has(p.buildingId))
        .slice()
        .sort((a, b) => {
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
    const propertyOptions = buildPropertyOptions(initialBuildingId);
    const tenantOptions = mockData.tenants.map(t => {
        const active = activeContractOfTenant(t.name);
        const tag = active && active.id !== contract.id
            ? ` (現住 ${active.propertyName?.replace('聚空間 - ', '') || ''} 至 ${active.endDate})`
            : '';
        return { value: t.name, label: `${t.name}${tag}` };
    });
    // 拉現任租客主檔，prefill phone/email/緊急聯絡人 (跟建立流程對齊)
    const linkedTenant = mockData.tenants.find(t => t.name === contract.tenant) || null;

    // 共用 utils/termSelector.js → buildTermOptionsUtil(start, leaseEndISO)
    const buildTermOptions = (startDate) => buildTermOptionsUtil(startDate, leaseEndISO);
    const initialStart = contract.startDate ?? TODAY;
    // termMonths 不是 1 或 3 → 視為自訂; 帶入 __custom + termMonthsCustom 顯示
    const ctermNum = Number(contract.termMonths) || 1;
    const isCustomTerm = ctermNum !== 1 && ctermNum !== 3;
    const initialTerm = isCustomTerm ? '__custom' : String(ctermNum);

    openFormModal({
        title: `編輯合約：${contract.id}`,
        maxWidth: 640,
        fields: [
            // 1. 床位 (館別 → 物件 兩段, 對齊 finance 編輯 modal)
            { name: '__sep_bed', type: 'section', label: '床位' },
            { name: 'buildingId', label: '館別', type: 'select', required: true, options: buildingOptions, value: initialBuildingId },
            { name: 'propertyName', label: '物件', type: 'select', required: true, options: propertyOptions },

            // 2. 租客
            { name: '__sep_tenant', type: 'section', label: '租客資料' },
            { name: 'tenant', label: '租客姓名', type: 'select', required: true, span: 2, options: tenantOptions, searchable: true },
            { name: 'tenantPhone', label: '電話', type: 'text', value: linkedTenant?.phone || '' },
            { name: 'tenantEmail', label: 'Email', type: 'text', value: linkedTenant?.email || '' },
            { name: 'tenantEmergency', label: '緊急聯絡人', type: 'text', span: 2, value: linkedTenant?.emergencyContact || '', placeholder: '例：王媽媽 0911-222-333' },

            // 3. 合約期間 (純日期)
            { name: '__sep_contract', type: 'section', label: '合約期間' },
            { name: 'startDate', label: '入住日期 (= 合約起始日)', type: 'date', required: true, value: initialStart },
            { name: 'termMonths', label: '合約期', type: 'select', required: true, options: buildTermOptions(initialStart), value: initialTerm },
            { name: 'termMonthsCustom', label: '自訂月數', type: 'number', value: isCustomTerm ? ctermNum : '', placeholder: '例: 6' },
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
            { name: 'paidDate', label: '入帳日', type: 'date', span: 2, hint: '實際收到款項的日期 (留空 = 有收款時預設今天)' },

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
            // bundle 偵測
            const isBundleParent = mockData.contracts.some(c => c.bundleParentContractId === contract.id);
            const bundleChildren = isBundleParent
                ? mockData.contracts.filter(c => c.bundleParentContractId === contract.id)
                : [];
            const childRentSum = bundleChildren.reduce((s, c) => s + (Number(c.amount) || 0), 0);

            // 應收總額 init:
            // - bundle parent: 強制重算 (parent.amount + children rents) × term − discount (避免 invoice 漂移)
            // - 一般: 讀 rentInv.amount − discount, 沒 invoice fallback contract.amount × term − discount
            let initTotalDue;
            if (isBundleParent) {
                const term = contract.termMonths || 1;
                initTotalDue = Math.max(0, ((Number(contract.amount) || 0) + childRentSum) * term - (Number(initDiscount) || 0));
            } else if (rentInv) {
                initTotalDue = Math.max(0, (Number(rentInv.amount) || 0) - (Number(initDiscount) || 0));
            } else {
                initTotalDue = Math.max(0, (Number(contract.amount) || 0) * (contract.termMonths || 1) - (Number(initDiscount) || 0));
            }
            return {
                ...contract,
                paymentChannel: contract.paymentChannel || 'self',
                platformName: contract.platformName || '',
                tenantPhone: linkedTenant?.phone || '',
                tenantEmail: linkedTenant?.email || '',
                tenantEmergency: linkedTenant?.emergencyContact || '',
                totalDue: initTotalDue,
                discount: initDiscount,
                discountReason: initAdjItems.length ? JSON.stringify(initAdjItems) : '',
                paidAmount: rentInv?.paidAmount ?? 0,
                paymentMethod: rentInv?.paymentMethod || (mockData.paymentMethods || [])[0]?.name || '匯款',
                paidDate: rentInv?.paidDate || '',
                _isBundleParent: isBundleParent,
                _childRentSum: childRentSum,
                _bundleChildIds: bundleChildren.map(c => c.id)
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

            // 館別變更 → 重 build 物件下拉 (filter 該館床位)
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
            const amountInput = form.querySelector('[name="amount"]');
            const termInput = form.querySelector('[name="termMonths"]');
            const totalDueInput = form.querySelector('[name="totalDue"]');
            const discountInput = form.querySelector('[name="discount"]');
            const discountReasonInput = form.querySelector('[name="discountReason"]');
            // 應收總額 readonly + 灰底橘字 (跟新增入住 / 收支編輯一致)
            if (totalDueInput) {
                totalDueInput.readOnly = true;
                totalDueInput.style.backgroundColor = 'var(--bg-tertiary)';
                totalDueInput.style.cursor = 'not-allowed';
                totalDueInput.style.fontWeight = '700';
                totalDueInput.style.color = 'var(--color-primary)';
            }
            // bundle child / parent 偵測
            const isBundleChild = !!contract.bundleParentContractId;
            const bundleChildrenLocal = mockData.contracts.filter(c => c.bundleParentContractId === contract.id);
            const isBundleParent = bundleChildrenLocal.length > 0;
            const childRentSumLocal = bundleChildrenLocal.reduce((s, c) => s + (Number(c.amount) || 0), 0);
            const refreshTotal = () => {
                if (!totalDueInput) return;
                // bundle child 強制 0, 不算公式 (避免覆蓋掉歸零後的 invoice 顯示)
                if (isBundleChild) {
                    totalDueInput.value = 0;
                    return;
                }
                const amt = Number(amountInput?.value) || 0;
                // term: __custom 讀 termMonthsCustom; 其他 parseInt termMonths
                let t;
                if (termInput?.value === '__custom') {
                    const tc = form.querySelector('[name="termMonthsCustom"]');
                    t = parseInt(tc?.value, 10) || 1;
                } else {
                    t = parseInt(termInput?.value, 10) || 1;
                }
                const disc = Number(discountInput?.value) || 0;
                // bundle parent: 應收 = (主月租 + 子月租加總) × 期數 − 折扣
                const baseAmt = isBundleParent ? amt + childRentSumLocal : amt;
                totalDueInput.value = Math.max(0, baseAmt * t - disc);
            };

            // bundle parent: 加提示, 列出子合約
            if (isBundleParent) {
                const totalWrap = totalDueInput?.closest('.form-group');
                if (totalWrap && !totalWrap.querySelector('.bundle-parent-hint')) {
                    const childList = bundleChildrenLocal.map(c =>
                        `<strong style="font-family: monospace; background: var(--color-success-light); padding: 0.05rem 0.35rem; border-radius: var(--radius-sm); margin: 0 0.15rem;">${c.id}</strong>`
                    ).join('');
                    const hint = document.createElement('div');
                    hint.className = 'bundle-parent-hint';
                    hint.style.cssText = 'font-size: var(--text-xs); color: var(--color-success); margin-top: 0.4rem; line-height: 1.6;';
                    hint.innerHTML = `<i class="ph ph-link" style="vertical-align: -2px; margin-right: 0.25rem;"></i>此為合併收款主合約，含 ${bundleChildrenLocal.length} 份子合約 ${childList}（月租合計含子合約共 $${(Number(contract.amount) + childRentSumLocal).toLocaleString()}）。`;
                    totalWrap.appendChild(hint);
                }
            }

            // bundle child: 鎖收款欄位 + 加提示
            if (isBundleChild) {
                const paidInput = form.querySelector('[name="paidAmount"]');
                const adjustPhEl = form.querySelector('#ph-adjustments');
                [totalDueInput, paidInput].forEach(el => {
                    if (!el) return;
                    el.setAttribute('readonly', '');
                    el.disabled = true;
                    el.style.background = 'var(--bg-tertiary)';
                    el.style.cursor = 'not-allowed';
                    el.value = 0;
                });
                if (discountInput) discountInput.value = 0;
                if (discountReasonInput) discountReasonInput.value = '';
                if (adjustPhEl) {
                    adjustPhEl.style.opacity = '0.5';
                    adjustPhEl.style.pointerEvents = 'none';
                }
                // 在 totalDue 欄位下方塞 hint
                const totalWrap = totalDueInput?.closest('.form-group');
                if (totalWrap && !totalWrap.querySelector('.bundle-child-hint')) {
                    const hint = document.createElement('div');
                    hint.className = 'bundle-child-hint';
                    hint.style.cssText = 'font-size: var(--text-xs); color: var(--color-info); margin-top: 0.4rem; line-height: 1.6;';
                    hint.innerHTML = `<i class="ph ph-link" style="vertical-align: -2px; margin-right: 0.25rem;"></i>收款已併入主合約 <strong style="font-family: monospace; background: var(--color-info-light); padding: 0.05rem 0.35rem; border-radius: var(--radius-sm);">${contract.bundleParentContractId}</strong>，要編輯請從主合約處理或先解除綁定。`;
                    totalWrap.appendChild(hint);
                }
            }

            // === 加減項目子表單 — 跟 finance.js / unsettled.js 同款 util (寫 JSON 進 discountReason) ===
            const adjustPh = form.querySelector('#ph-adjustments');
            if (adjustPh) {
                initAdjustmentsWidget({
                    container: adjustPh,
                    discountInput,
                    discountReasonInput,
                    initialReason: discountReasonInput?.value || '',
                    onChange: () => refreshTotal()
                });
            }
            // 自訂月數欄位顯隱 + termMonths/termMonthsCustom 變動 → refreshTotal
            // 共用 utils/termSelector.js (跟 properties.js 新增入住 wizard 同源)
            const termSelector = initTermSelector({
                form,
                leaseEndISO,
                startName: 'startDate',
                termName: 'termMonths',
                customName: 'termMonthsCustom',
                onTermChange: refreshTotal
            });
            const getEffectiveTerm = () => termSelector?.getEffectiveTerm() ?? 1;

            // refresh: startDate 變動 → 重算 dropdown label (termSelector 已處理) + endInput 空著自動填 + refreshTotal
            const refresh = () => {
                if (!endInput.value && startInput.value) {
                    const term = getEffectiveTerm();
                    if (term) endInput.value = leaseEndISO(startInput.value, term);
                }
                refreshTotal();
            };
            startInput.addEventListener('change', refresh);
            startInput.addEventListener('input', refresh);
            amountInput?.addEventListener('input', refreshTotal);
        },
        onSubmit: (values) => {
            const property = mockData.properties.find(p => p.name === values.propertyName);
            if (!property) {
                showToast('找不到對應的物件', 'danger');
                return false;
            }
            // termMonths: __custom → 讀 termMonthsCustom 的整數值, 寫回 values.termMonths
            if (values.termMonths === '__custom') {
                const customMonths = parseInt(values.termMonthsCustom, 10);
                if (!customMonths || customMonths < 1) {
                    showToast('自訂月數請填 ≥ 1 的整數', 'danger');
                    return false;
                }
                values.termMonths = customMonths;
            } else {
                values.termMonths = parseInt(values.termMonths, 10) || 1;
            }
            delete values.termMonthsCustom;
            delete values.buildingId;  // 只用於 form 內篩物件下拉, 不寫進合約 (合約透過 propertyName 反查 building)
            let endDate = values.endDate;
            if (!endDate && values.startDate && values.termMonths) {
                endDate = leaseEndISO(values.startDate, values.termMonths);  // 起租 + N 月 − 1 天
            }

            // 抽離 tenant 子欄位 + totalDue (顯示用) + adjustments + paidAmount/paymentMethod/paidDate (寫到 invoice)
            const { tenantPhone, tenantEmail, tenantEmergency, totalDue: _td,
                    discount: adjDiscount, discountReason: adjReason,
                    paidAmount: _pa, paymentMethod: _pm, paidDate: _pd,
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
                    const newPaidDate = values.paidDate || '';
                    // ⚠ 2026-07-24 修 bug: 月租金 / 合約期改了之後, 帳單的 amount (租金總額)
                    // 之前完全沒跟著重算寫回去 — 「編輯合約」modal 的應收總額只是畫面即時
                    // 算好看, 帳單本身金額沒同步更新, 之後 PDF / 房租查帳 / 報表全部還是
                    // 看編輯前的舊金額 (C218 案例: 續約當下用錯期數建了 1 個月的帳單金額,
                    // 之後合約期數改對了, 帳單金額卻永遠停在錯的那筆).
                    const bundleChildRentSum = mockData.contracts
                        .filter(c => c.bundleParentContractId === contract.id)
                        .reduce((s, c) => s + (Number(c.amount) || 0), 0);
                    const newAmount = Math.max(0, (Number(values.amount) || 0) + bundleChildRentSum) * (Number(values.termMonths) || 1);
                    const patch = {};
                    if (newAmount !== (rentInv.amount || 0)) patch.amount = newAmount;
                    if (newDiscount !== (rentInv.discount || 0)) patch.discount = newDiscount;
                    if (newReason !== (rentInv.discountReason || '')) patch.discountReason = newReason;
                    if (newPaidAmount !== (rentInv.paidAmount || 0)) patch.paidAmount = newPaidAmount;
                    if (newPaymentMethod !== (rentInv.paymentMethod || '')) patch.paymentMethod = newPaymentMethod;
                    // 使用者手選的入帳日 → 直接寫回 (2026-07-31: 合約端編輯收支也能改入帳日)
                    if (newPaidDate && newPaidDate !== (rentInv.paidDate || '')) patch.paidDate = newPaidDate;
                    // 應收 (租金總額 − 折扣) 有變、或已收金額有變 → invoice status 要重判
                    if ('paidAmount' in patch || 'amount' in patch || 'discount' in patch) {
                        const due = newAmount - newDiscount;
                        patch.status = newPaidAmount >= due && due > 0 ? '已繳清' : (newPaidAmount > 0 ? '部分繳' : '未繳');
                        // 沒手選入帳日、又有收款、原本也沒入帳日 → 預設今天
                        if (newPaidAmount > 0 && !rentInv.paidDate && !patch.paidDate) patch.paidDate = new Date().toISOString().slice(0, 10);
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
            if (typeof opts.onSaved === 'function') opts.onSaved(saved);
        }
    });
}

// 合約中途換床位 — 房客住到一半換另一張床, 價格通常不變
// 保留「同一份合約」直接換物件 (不建新合約) — 見 store.quickChangeBed
// 價格若要改, 換完床位後自己另外編輯合約即可
function showChangeBedForm(contract) {
    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    const modeBuildingIds = new Set(mockData.buildings.filter(b => (b.mode || 'cohousing') === targetMode).map(b => b.id));
    const buildingOptions = mockData.buildings
        .filter(b => (b.mode || 'cohousing') === targetMode)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(b => ({ value: b.id, label: b.name }));
    const currentProperty = mockData.properties.find(p => p.name === contract.propertyName);
    const initialBuildingId = currentProperty?.buildingId || buildingOptions[0]?.value || '';
    const buildPropertyOptions = (buildingId) => mockData.properties
        .filter(p => p.name !== contract.propertyName)
        .filter(p => buildingId ? p.buildingId === buildingId : modeBuildingIds.has(p.buildingId))
        .slice()
        .sort((a, b) => {
            const ra = Number(a.roomNumber ?? 999), rb = Number(b.roomNumber ?? 999);
            if (ra !== rb) return ra - rb;
            return (a.bedLetter || '').localeCompare(b.bedLetter || '');
        })
        .map(p => {
            const active = activeContractFor(p.name);
            const tag = active ? ` · ⚠ ${active.tenant}住至${active.endDate}` : ' · 空床';
            return { value: p.name, label: `${p.name.replace('聚空間 - ', '')}${tag}` };
        });
    const newPropertyOptions = buildPropertyOptions(initialBuildingId);

    openFormModal({
        title: `🔀 更換床位 — ${contract.id}`,
        maxWidth: 520,
        headerHtml: `
            <div style="margin-bottom: 1rem; padding: 0.75rem 1rem; background-color: var(--color-background); border-radius: var(--radius-md); font-size: var(--text-sm); line-height: 1.7;">
                <div><strong>目前：</strong>${contract.tenant} · ${(contract.propertyName || '').replace('聚空間 - ', '')} · $${(contract.amount || 0).toLocaleString()}/月</div>
                <div><strong>租期：</strong>${contract.startDate || '—'} ~ ${contract.endDate || '—'}</div>
                <hr style="margin: 0.5rem 0; border: none; border-top: 1px dashed var(--border-color);">
                <div style="color: var(--text-muted); font-size: var(--text-xs); line-height: 1.6;">
                    保留同一份合約 ${contract.id}, 只換物件 (租期/租金不變). 舊床位釋放、新床位佔用、帳單物件欄位都會自動更新.
                    <br>⚠ 若這次換床要調整租金, 換完後請自行「編輯合約」改月租.
                </div>
            </div>
        `,
        fields: [
            { name: 'buildingId', label: '館別', type: 'select', required: true, options: buildingOptions, value: initialBuildingId },
            { name: 'propertyName', label: '新床位', type: 'select', required: true, options: newPropertyOptions }
        ],
        values: {},
        submitLabel: '確認換床',
        onFormMount: (form) => {
            const buildingHidden = form.querySelector('[name="buildingId"]');
            const propertyWrap = form.querySelector('.custom-select[data-name="propertyName"]');
            buildingHidden?.addEventListener('change', () => {
                if (propertyWrap?.__setOptions) {
                    propertyWrap.__setOptions(buildPropertyOptions(buildingHidden.value));
                }
            });
        },
        onSubmit: (values) => {
            if (!values.propertyName) {
                showToast('請選新床位', 'danger');
                return false;
            }
            const result = store.quickChangeBed(contract.id, values.propertyName);
            if (result.error) {
                const msgMap = {
                    bed_conflict: '新床位在合約剩餘期間已有其他合約',
                    same_property: '新床位跟原床位相同, 不需要換床',
                    not_active: '此合約目前非進行中狀態, 無法換床',
                    property_not_found: '找不到該床位資料'
                };
                showToast(msgMap[result.error] || `換床失敗：${result.error}`, 'danger', 6000);
                return false;
            }
            showToast(`✅ 已換床到 ${values.propertyName.replace('聚空間 - ', '')}`, 'success', 4000);
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
        topHtml: contractProgressTimeline(c, state),
        items: [
            { label: '生命週期', value: lifecycleBadge(state) + (
                state === 'pending_termination'
                    ? ` <span style="color: var(--text-muted); font-size: var(--text-sm);">預計 ${c.pendingTerminationDate} 退租, 床位到那天前仍顯示在住</span>`
                    : (days != null && state !== 'renewed' && state !== 'terminated' ? ` <span style="color: var(--text-muted); font-size: var(--text-sm);">${daysLabel(days)}</span>` : '')
            ) },
            { label: '物件', value: c.propertyName },
            { label: '租客', value: c.tenant },
            { label: '租金', value: `$${(c.amount || 0).toLocaleString()} / 月` },
            { label: '簽約期', value: `${c.termMonths || 1} 個月` },
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
        footerHtml: (() => {
            const t = mockData.tenants.find(x => x.name === c.tenant && x.lineUserId);
            const hasLine = !!t?.lineUserId;
            const canChangeBed = state === 'active' || state === 'expiring_soon' || state === 'awaiting_decision';
            return `
                <button class="btn btn-outline" data-action="close-detail" type="button">關閉</button>
                ${canChangeBed ? `<button class="btn btn-outline" data-action="change-bed" type="button" data-write title="房客住到一半換另一張床 (保留同一份合約, 只換物件)"><i class="ph ph-arrows-left-right"></i> 更換床位</button>` : ''}
                ${hasLine ? `<button class="btn btn-outline" data-action="resend-notice" type="button" data-write title="用當下合約資料重發 LINE 繳款通知 (修 date 錯掉的 case)"><i class="ph ph-arrow-clockwise"></i> 重發繳款通知</button>` : ''}
                <button class="btn btn-primary" data-action="edit-from-detail" type="button" data-write>
                    <i class="ph ph-pencil"></i> 編輯合約
                </button>
            `;
        })(),
        onMount: (overlay, closeModal) => {
            overlay.querySelector('[data-action="close-detail"]')?.addEventListener('click', closeModal);
            overlay.querySelector('[data-action="edit-from-detail"]')?.addEventListener('click', () => {
                closeModal();
                showContractForm(c);
            });
            overlay.querySelector('[data-action="change-bed"]')?.addEventListener('click', () => {
                closeModal();
                showChangeBedForm(c);
            });
            overlay.querySelector('[data-action="resend-notice"]')?.addEventListener('click', () => {
                const t = mockData.tenants.find(x => x.name === c.tenant && x.lineUserId);
                if (!t?.lineUserId) { showToast('租客未綁 LINE, 無法重發', 'warning'); return; }
                const { message, dueAmount, dueDate } = buildPaymentNoticeMessage(c, { includeRenewalGreeting: false });
                openConfirm({
                    title: '重發繳款通知？',
                    message: `即將用「合約當下」資料重發 LINE 給 <strong>${c.tenant}</strong>:<br><br>
                        <div style="background: var(--bg-secondary); padding: 0.75rem; border-radius: 6px; font-size: var(--text-sm); white-space: pre-wrap; max-height: 300px; overflow-y: auto;">${message.replace(/</g, '&lt;')}</div>`,
                    confirmLabel: '確認重發',
                    maxWidth: 640,
                    onConfirm: async () => {
                        try {
                            const rentInv = mockData.invoices.find(inv => inv.contractId === c.id && inv.direction === 'in' && inv.type === '房租');
                            await pushToTenant(t.id, { message, invoiceId: rentInv?.id });
                            showToast(`✅ 已重發繳款通知給 ${c.tenant}`, 'success', 4000);
                        } catch (e) {
                            showToast(`重發失敗: ${e.message}`, 'danger', 6000);
                            console.error('[resend-notice]', e);
                        }
                    }
                });
            });
            // 時間軸圓圈可點 → 開手動編輯 modal
            overlay.querySelectorAll('[data-step-edit]').forEach(el => {
                const open = () => editProgressStep(c.id, el.dataset.stepEdit, () => {
                    closeModal();
                    setTimeout(() => showContractDetails(c.id), 100);
                });
                el.addEventListener('click', open);
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
                });
            });
        }
    });
}

// 手動編輯合約流程某一步 — 開小 modal 設「標記完成 (帶日期) / 取消標記」
function editProgressStep(contractId, stepKey, onDone) {
    const c = mockData.contracts.find(x => x.id === contractId);
    if (!c) return;
    const inv = mockData.invoices.find(i =>
        i.contractId === c.id && i.direction === 'in' && i.type === '房租'
    );
    // 6 個 step 的 metadata
    const STEP_META = {
        reminded: { label: '催繳',     hasDate: true,  isDone: !!inv?.lastReminderAt, date: inv?.lastReminderAt,
                    note: '記錄手動 (打電話 / 當面提醒) 的催繳時間。LINE 自動催繳會自動填這個欄位。' },
        last5:    { label: '客回末5碼', hasDate: false, isDone: !!inv?.bankLast5,
                    note: '線下收到末5碼時手動填。標記後 LINE 自動收到的末5碼會被忽略 (要重設先清標記)。',
                    needInput: 'bankLast5' },
        verified: { label: '核對入帳',  hasDate: true,  isDone: !!inv?.bankVerified, date: inv?.paidDate,
                    note: '確認入帳後手動勾。會同時把 invoice paidAmount 設為應收, 標記為已繳清。' },
        sent:     { label: '寄合約',   hasDate: true,  isDone: !!c.contractSentAt, date: c.contractSentAt,
                    note: '線下傳合約 PDF 給租客時手動填。LINE 自動寄合約也會自動填這個。' },
        returned: { label: '收簽署檔', hasDate: false, isDone: !!c.signedFileUrl,
                    note: '收到實體簽署檔 (line/email/紙本)時手動標記。若 LINE 自動傳檔, 系統會自動填 URL + 把 status 改成已簽署。' }
    };
    const meta = STEP_META[stepKey];
    if (!meta) return;
    if (!inv && (stepKey === 'reminded' || stepKey === 'last5' || stepKey === 'verified')) {
        showToast('此合約沒對應的房租 invoice, 無法編輯這步', 'warning');
        return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const fields = [
        { name: '__note', type: 'placeholder' },
        ...(meta.hasDate ? [{ name: 'date', label: '日期', type: 'date', value: meta.date ? meta.date.slice(0, 10) : today, required: true }] : []),
        ...(meta.needInput === 'bankLast5' && !meta.isDone
            ? [{ name: 'bankLast5', label: '末 5 碼', type: 'text', placeholder: '5 位數字, 例如 12345', required: true, hint: '空白 = 標記「客戶口頭告知, 線下收款」' }]
            : [])
    ];

    openFormModal({
        title: `手動編輯: ${meta.label}`,
        maxWidth: 480,
        fields,
        values: {},
        submitLabel: meta.isDone ? '✗ 取消標記' : '✓ 標記完成',
        onFormMount: (form) => {
            const ph = form.querySelector('#ph-__note');
            if (ph) ph.innerHTML = `
                <div style="padding: 0.7rem 0.85rem; background: var(--bg-tertiary); border-radius: var(--radius-md); font-size: var(--text-xs); line-height: 1.6; color: var(--text-secondary);">
                    <strong style="color: var(--text-main);">當前狀態:</strong> ${meta.isDone ? '<span style="color: var(--color-success);">✓ 已完成</span>' : '<span style="color: var(--text-muted);">○ 未完成</span>'}<br>
                    <strong style="color: var(--text-main);">說明:</strong> ${meta.note}
                </div>
            `;
        },
        onSubmit: (values) => {
            if (meta.isDone) {
                // 取消標記 — 清掉對應欄位
                if (stepKey === 'reminded') store.updateInvoice(inv.id, { lastReminderAt: null });
                else if (stepKey === 'last5') store.updateInvoice(inv.id, { bankLast5: null, bankVerified: false });
                else if (stepKey === 'verified') store.updateInvoice(inv.id, { bankVerified: false });
                else if (stepKey === 'sent') store.updateContract(c.id, { contractSentAt: null });
                else if (stepKey === 'returned') store.updateContract(c.id, { signedFileUrl: null, status: '待簽署' });
                showToast(`已清除「${meta.label}」標記`, 'info');
            } else {
                // 標記完成
                const dateISO = values.date ? new Date(values.date).toISOString() : new Date().toISOString();
                if (stepKey === 'reminded') store.updateInvoice(inv.id, { lastReminderAt: dateISO });
                else if (stepKey === 'last5') {
                    const last5 = (values.bankLast5 || 'MANUAL').toString().trim();
                    store.updateInvoice(inv.id, { bankLast5: last5 });
                }
                else if (stepKey === 'verified') {
                    const due = (Number(inv.amount) || 0) - (Number(inv.discount) || 0);
                    store.updateInvoice(inv.id, {
                        bankVerified: true,
                        paidAmount: due,
                        paidDate: values.date || today,
                        status: '已繳清'
                    });
                }
                else if (stepKey === 'sent') store.updateContract(c.id, { contractSentAt: dateISO });
                else if (stepKey === 'returned') store.updateContract(c.id, { signedFileUrl: 'MANUAL_MARKED', status: '已簽署' });
                showToast(`✓ 已標記「${meta.label}」完成`, 'success');
            }
            if (typeof onDone === 'function') onDone();
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
        const values = buildPdfFieldValues(c);
        const { bytes, filledFields, missingFields } = await fillContractPdf(tpl.pdfBase64, values);

        if (filledFields.length === 0) {
            showToast(`樣板沒有任何可填入欄位，請至 系統設定 → 合約範本 → 檢查欄位`, 'danger', 5000);
            return;
        }

        const filename = `合約_${c.id}_${c.tenant}_${c.startDate || ''}.pdf`;
        downloadPdfBytes(bytes, filename);

        if (missingFields.length > 0) {
            warnMissingMoneyFields(missingFields);
            showToast(`✅ 已下載 (${filledFields.length} 個欄位填入，${missingFields.length} 個未在樣板中)`, 'success');
        } else {
            showToast(`✅ 合約 PDF 已下載：${filename}`, 'success');
        }
    } catch (e) {
        showToast(`產生 PDF 失敗：${e.message}`, 'danger', 5000);
    }
}

// 產生 PDF → 上傳 Supabase Storage → 推到租客 LINE
export async function sendContractToLine(id) {
    const c = mockData.contracts.find(x => x.id === id);
    if (!c) return;
    // 同名租客可能有多筆 (歷史殘留 / LINE 綁定建的新 record) → 優先找已綁 LINE 的, fallback first match
    const tenantName = (c.tenant || '').trim();
    const tenant = mockData.tenants.find(t => (t.name || '').trim() === tenantName && t.lineUserId)
                || mockData.tenants.find(t => (t.name || '').trim() === tenantName);
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
        const values = buildPdfFieldValues(c);
        const { bytes, missingFields } = await fillContractPdf(tpl.pdfBase64, values);
        warnMissingMoneyFields(missingFields);
        const filename = `合約_${c.id}_${c.tenant}.pdf`;

        showToast('上傳到雲端…', 'info');
        const { url: fileUrl } = await uploadPdfToStorage(filename, bytes);

        showToast('推送到 LINE…', 'info');
        await pushToTenant(tenant.id, {
            message: `${c.tenant} 您好，這是您的合約 (${c.id})\n租期：${c.startDate} ~ ${c.endDate}\n月租：$${(c.amount || 0).toLocaleString()}\n\n連結 24 小時內有效`,
            fileUrl,
            fileName: filename
        });

        // 記錄合約已寄出時間 (給「進度條」chip + 防 auto-send 重複寄)
        store.updateContract(c.id, { contractSentAt: new Date().toISOString() });

        showToast(`✅ 已傳送到 ${tenant.name} 的 LINE`, 'success', 4000);
    } catch (e) {
        showToast(`發送失敗：${e.message}`, 'danger', 7000);
    }
}

// === 三種決策動作 ===

export function confirmRenew(id) {
    const c = mockData.contracts.find(x => x.id === id);
    if (!c) return;
    // 續租: 新合約起 = 舊到期日 (同一天交接, endDate=下期起算日 convention)
    //       新合約止 = leaseEndISO(新起, 同期數) = 新起 + N 月
    const newStartStr = c.endDate;
    const newEndStr = leaseEndISO(newStartStr, c.termMonths || 1);

    openModal({
        title: '🔄 確認續租',
        maxWidth: 640,
        bodyHtml: `
            <div style="margin: 0; color: var(--text-main); line-height: 1.6;">
                將為 <strong>${esc(c.tenant)}</strong> 自動建立下一期合約：
                <div style="margin-top: 1rem; padding: 0.875rem; background-color: var(--color-background); border-radius: var(--radius-md); font-size: var(--text-base); line-height: 1.8;">
                    <div><strong>物件：</strong>${esc(c.propertyName)}</div>
                    <div><strong>租金：</strong>$${(c.amount || 0).toLocaleString()} / 月（沿用）</div>
                    <div><strong>新期間：</strong>${newStartStr} ~ ${newEndStr}（${c.termMonths || 1} 個月）</div>
                </div>
                <p style="margin-top: 1rem; font-size: var(--text-xs); color: var(--text-muted);">舊合約 ${esc(c.id)} 將標記為「已續約」。</p>
            </div>
        `,
        footerHtml: (() => {
            // 該租客有沒有綁 LINE → 決定「續租並寄出」按鈕能不能按
            const t = mockData.tenants.find(x => x.name === c.tenant && x.lineUserId);
            const hasLine = !!t?.lineUserId;
            return `
                <button type="button" class="btn btn-outline" data-action="cancel">取消</button>
                <button type="button" class="btn btn-outline" data-action="edit-renew" style="color: var(--color-primary); border-color: var(--color-primary); margin-left: auto;"><i class="ph ph-pencil"></i> 編輯續租資訊</button>
                <button type="button" class="btn btn-outline" data-action="renew-only" style="color: var(--color-primary); border-color: var(--color-primary);"><i class="ph ph-file-plus"></i> 直接續租</button>
                <button type="button" class="btn btn-primary" data-action="renew-and-notify" ${hasLine ? '' : 'disabled title="租客未綁 LINE, 無法自動推繳款通知"'}><i class="ph ph-bell"></i> 續租並發繳款通知</button>
            `;
        })(),
        lockOutsideClose: true,
        onMount: (overlay, close) => {
            overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', close);

            // 建續租合約 (不寄合約 — 寄合約走「入帳後自動觸發」路線, maybeAutoSendContract)
            // notify: true → 建約後 LINE 推繳款通知; false → 純建約靜默
            const doRenew = (notify) => {
                const result = store.renewContract(id);
                if (result.error) {
                    showToast(`續租失敗：${result.error}`, 'danger');
                    return;
                }
                const newC = result.newContract;
                showToast(`已建立續租合約 ${newC.id}`, 'success');
                close();
                refreshView();
                if (!notify) return;
                const t = mockData.tenants.find(x => x.name === newC.tenant && x.lineUserId)
                       || mockData.tenants.find(x => x.name === newC.tenant);
                if (!t?.lineUserId) {
                    showToast(`${newC.tenant} 未綁 LINE, 無法自動推繳款通知`, 'warning', 5000);
                    return;
                }
                // 一律用合約當下資料組訊息 (見 utils/paymentNoticeMessage.js)
                const rentInv = mockData.invoices.find(inv =>
                    inv.contractId === newC.id && inv.direction === 'in' && inv.type === '房租'
                );
                const { message } = buildPaymentNoticeMessage(newC, { includeRenewalGreeting: true });
                setTimeout(() => {
                    showToast(`推繳款通知給 ${newC.tenant}…`, 'info', 3000);
                    pushToTenant(t.id, { message, invoiceId: rentInv?.id })
                        .then(() => showToast(`✅ 已推繳款通知給 ${newC.tenant}`, 'success', 4000))
                        .catch(e => {
                            console.warn('[auto-notify-after-renew]', e);
                            showToast(`推繳款通知失敗：${e.message}`, 'warning', 6000);
                        });
                }, 800);
            };

            overlay.querySelector('[data-action="renew-only"]')?.addEventListener('click', () => doRenew(false));
            overlay.querySelector('[data-action="renew-and-notify"]')?.addEventListener('click', () => doRenew(true));

            overlay.querySelector('[data-action="edit-renew"]')?.addEventListener('click', () => {
                const result = store.renewContract(id);
                if (result.error) {
                    showToast(`續租失敗：${result.error}`, 'danger');
                    return;
                }
                showToast(`已建立新合約 ${result.newContract.id}，請編輯細節`, 'success');
                close();
                setTimeout(() => {
                    showContractForm(result.newContract);
                }, 150);
            });
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
    scope.querySelector('.renew-intent-banner')?.addEventListener('click', (e) => {
        // X 按鈕另外處理 (dismiss), 點 banner 主體才跳 filter
        if (e.target.closest('[data-action="dismiss-renew-banner"]')) return;
        const chip = scope.querySelector('[data-filter-value="renew"][data-filter-group="renew"]');
        if (chip) chip.click();
    });
    // banner X 關閉 → 記到 localStorage, 下次有新「要續租」會重新跳出
    scope.querySelector('[data-action="dismiss-renew-banner"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissRenewBanner();
        const banner = scope.querySelector('.renew-intent-banner');
        if (banner) banner.style.display = 'none';
    });

    // 詢問續租 — 觸發 Edge Function renewal-poll (14 天前發)
    // UI: 列出符合條件的合約, 讓 admin 勾選要問誰
    scope.querySelector('#btn-ask-renewal')?.addEventListener('click', async () => {
        const todayStr = new Date().toISOString().slice(0, 10);
        const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
        const expiringSoon = filterContractsByMode(mockData.contracts).filter(c => {
            if (c.renewalState !== 'active') return false;
            if (!c.endDate) return false;
            return c.endDate >= todayStr && c.endDate <= in14;
        });
        if (expiringSoon.length === 0) {
            showToast('14 天內沒有要到期的合約, 不用發', 'info', 3000);
            return;
        }
        // 帶租客 LINE 綁定狀態 + 5 天內問過標記
        const enriched = expiringSoon.map(c => {
            const t = mockData.tenants.find(x => x.name === c.tenant);
            const hasLine = !!(t && t.lineUserId);
            const askedAt = c.renewAskedAt ? new Date(c.renewAskedAt) : null;
            const askedRecently = askedAt && (Date.now() - askedAt.getTime()) < 5 * 86400000;
            const daysLeft = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000);
            return { c, hasLine, askedRecently, daysLeft, tenantId: t?.id };
        }).sort((a, b) => a.daysLeft - b.daysLeft);

        const rowsHtml = enriched.map(({ c, hasLine, askedRecently, daysLeft }) => {
            const badges = [];
            if (!hasLine) badges.push('<span class="status-badge danger" style="font-size: var(--text-2xs);">未綁 LINE</span>');
            if (askedRecently) badges.push('<span class="status-badge warning" style="font-size: var(--text-2xs);">5天內問過</span>');
            if (c.renewIntent === 'renew') badges.push('<span class="status-badge success" style="font-size: var(--text-2xs);">已回續租</span>');
            if (c.renewIntent === 'decline') badges.push('<span class="status-badge info" style="font-size: var(--text-2xs);">已回不續</span>');
            const propShort = String(c.propertyName || '').replace('聚空間 - ', '');
            const disabled = !hasLine || c.renewIntent === 'renew' || c.renewIntent === 'decline';
            const defaultChecked = !disabled && !askedRecently;
            return `
                <tr data-row-cid="${c.id}">
                    <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border-color); text-align: center;">
                        <input type="checkbox" class="ask-pick" data-cid="${c.id}" ${defaultChecked ? 'checked' : ''} ${disabled ? 'disabled' : ''} style="cursor: ${disabled ? 'not-allowed' : 'pointer'}; width: 16px; height: 16px;">
                    </td>
                    <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-family: monospace; font-size: var(--text-xs);">${c.id}</td>
                    <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs); font-weight: 600;">${c.tenant || '—'}</td>
                    <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs);">${propShort}</td>
                    <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs); color: var(--text-muted);">
                        ${c.endDate || '—'} <span style="color: ${daysLeft <= 7 ? 'var(--color-warning)' : 'var(--text-muted)'}; font-weight: ${daysLeft <= 7 ? '600' : '400'};">(${daysLeft} 天後)</span>
                    </td>
                    <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs);">
                        ${badges.join(' ') || '<span style="color:var(--text-muted);">—</span>'}
                    </td>
                </tr>
            `;
        }).join('');

        const defaultPickedCount = enriched.filter(x => x.hasLine && !x.askedRecently && x.c.renewIntent !== 'renew' && x.c.renewIntent !== 'decline').length;

        openConfirm({
            title: '📮 詢問續租意願 — 選擇要發送的合約',
            confirmLabel: '🚀 發送給打勾的',
            maxWidth: 900,
            message: `
                <div style="margin-bottom: 0.75rem; padding: 0.65rem 0.8rem; background: var(--bg-secondary); border-radius: 6px; border-left: 3px solid var(--color-primary); font-size: var(--text-sm); line-height: 1.5;">
                    <div><strong>14 天內到期</strong>的合約共 <strong style="color: var(--color-primary);">${enriched.length}</strong> 筆.</div>
                    <div style="font-size: var(--text-xs); color: var(--text-muted); margin-top: 0.25rem;">
                        預設打勾: 已綁 LINE + 5 天內未問過 + 尚未表態的 (${defaultPickedCount} 筆). 你可自行調整.
                    </div>
                </div>
                <div class="search-bar" style="margin-bottom: 0.5rem; width: 100%;">
                    <i class="ph ph-magnifying-glass"></i>
                    <input type="text" id="ask-search" placeholder="搜尋合約/租客/床位..." autocomplete="off" style="font-size: var(--text-base);">
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; font-size: var(--text-xs);">
                    <button type="button" class="btn btn-outline" id="ask-select-all" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);">全選 (可選)</button>
                    <button type="button" class="btn btn-outline" id="ask-select-none" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);">全不選</button>
                    <span id="ask-count" style="margin-left: auto; color: var(--text-muted);">已選 ${defaultPickedCount} 筆</span>
                </div>
                <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: var(--text-sm);">
                        <thead style="position: sticky; top: 0; background: var(--bg-secondary); z-index: 1;">
                            <tr>
                                <th style="padding: 0.5rem 0.5rem; width: 32px;"></th>
                                <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">合約</th>
                                <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">租客</th>
                                <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">床位</th>
                                <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">到期日</th>
                                <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">狀態</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            `,
            onMount: (overlay) => {
                const checks = () => overlay.querySelectorAll('.ask-pick:not(:disabled)');
                const countEl = overlay.querySelector('#ask-count');
                const confirmBtn = overlay.querySelector('[data-action="confirm"]');
                const updateCount = () => {
                    const picked = Array.from(checks()).filter(c => c.checked).length;
                    if (countEl) countEl.textContent = `已選 ${picked} 筆`;
                    if (confirmBtn) {
                        confirmBtn.textContent = picked === 0 ? '沒選就沒發' : `🚀 發送給 ${picked} 位租客`;
                        confirmBtn.disabled = (picked === 0);
                    }
                };
                overlay.addEventListener('change', (e) => {
                    if (e.target.classList?.contains('ask-pick')) updateCount();
                });
                overlay.querySelector('#ask-select-all')?.addEventListener('click', () => {
                    checks().forEach(c => { c.checked = true; }); updateCount();
                });
                overlay.querySelector('#ask-select-none')?.addEventListener('click', () => {
                    checks().forEach(c => { c.checked = false; }); updateCount();
                });
                overlay.querySelector('#ask-search')?.addEventListener('input', (e) => {
                    const kw = e.target.value.trim().toLowerCase();
                    overlay.querySelectorAll('tr[data-row-cid]').forEach(row => {
                        if (!kw) { row.style.display = ''; return; }
                        row.style.display = row.textContent.toLowerCase().includes(kw) ? '' : 'none';
                    });
                });
                updateCount();
            },
            onConfirm: async () => {
                // 只掃還開著的 modal 內的 checkbox
                const openOverlay = document.querySelector('.modal-overlay:not(.is-closing)');
                const picked = openOverlay
                    ? Array.from(openOverlay.querySelectorAll('.ask-pick')).filter(c => c.checked && !c.disabled).map(c => c.dataset.cid)
                    : [];
                if (picked.length === 0) {
                    showToast('沒選任何合約, 未發送', 'info');
                    return;
                }
                showToast(`發送 ${picked.length} 筆中…`, 'info', 2000);
                try {
                    const result = await triggerRenewalPoll({ daysAhead: 14, contractIds: picked, force: true });
                    const lines = [
                        `✅ 發送完成`,
                        `· 已發 ${result.sent || 0} 筆`,
                        ...((result.skipped_no_line || 0) > 0 ? [`· 未綁 LINE 跳過 ${result.skipped_no_line}`] : []),
                        ...((result.failed || 0) > 0 ? [`· ⚠ 失敗 ${result.failed} (見 console)`] : [])
                    ];
                    showToast(lines.join('  '), result.failed > 0 ? 'warning' : 'success', 6000);
                    console.log('[renewal-poll] 結果:', result);
                    setTimeout(() => refreshView(), 1500);
                } catch (e) {
                    showToast(`發送失敗: ${e.message}`, 'danger', 6000);
                    console.error('[renewal-poll]', e);
                }
            }
        });
    });

    // 確認續約 — 列出「已在 LINE 回覆續租但還沒建約」的合約, 勾選確認後才建約+發繳款通知
    // (2026-07-19: 從全自動建約改成手動確認, 避免跟手動建的合約重複衝突)
    scope.querySelector('#btn-confirm-renewals')?.addEventListener('click', () => {
        const candidates = findRenewalConfirmCandidates();
        if (candidates.length === 0) {
            showToast('目前沒有已回覆續租、待確認建約的合約', 'info', 3000);
            return;
        }
        const enriched = candidates.map(c => {
            const t = mockData.tenants.find(x => x.name === c.tenant);
            const hasLine = !!(t && t.lineUserId);
            const respondedAt = c.renewResponseAt ? new Date(c.renewResponseAt) : null;
            return { c, hasLine, respondedAt };
        }).sort((a, b) => (b.respondedAt?.getTime() || 0) - (a.respondedAt?.getTime() || 0));

        const rowsHtml = enriched.map(({ c, hasLine, respondedAt }) => {
            const propShort = String(c.propertyName || '').replace('聚空間 - ', '');
            const respondedLabel = respondedAt
                ? respondedAt.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '—';
            const disabled = !hasLine;
            const { dueAmount } = previewRenewalFor(c);
            return `
                <tr data-row-cid="${c.id}">
                    <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border-color); text-align: center;">
                        <input type="checkbox" class="confirm-pick" data-cid="${c.id}" ${disabled ? '' : 'checked'} ${disabled ? 'disabled' : ''} style="cursor: ${disabled ? 'not-allowed' : 'pointer'}; width: 16px; height: 16px;">
                    </td>
                    <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-family: monospace; font-size: var(--text-xs);">${c.id}</td>
                    <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs); font-weight: 600;">${c.tenant || '—'}</td>
                    <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs);">${propShort}</td>
                    <td style="padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs);">
                        <input type="number" class="confirm-amount" data-cid="${c.id}" value="${c.amount || 0}" ${disabled ? 'disabled' : ''} style="width: 75px; padding: 0.2rem 0.35rem; font-size: var(--text-xs); border: 1px solid var(--border-color); border-radius: 4px; background: var(--color-surface); color: var(--text-main);">
                        <div style="font-size: var(--text-2xs); color: var(--text-muted); margin-top: 0.15rem; white-space: nowrap;">應繳 <strong class="confirm-due-preview" data-cid-due="${c.id}" style="color: var(--color-success);">$${dueAmount.toLocaleString()}</strong></div>
                    </td>
                    <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs); color: var(--text-muted);">${c.endDate || '—'} 到期</td>
                    <td style="padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); font-size: var(--text-xs);">
                        ${!hasLine ? '<span class="status-badge danger" style="font-size: var(--text-2xs);">未綁 LINE</span>' : `<span style="color: var(--text-muted);">${respondedLabel}</span>`}
                    </td>
                    <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border-color); text-align: center;">
                        <button type="button" class="btn btn-outline confirm-edit-contract" data-cid="${c.id}" title="編輯這份原合約" style="padding: 0.2rem 0.4rem; font-size: var(--text-xs);"><i class="ph ph-pencil-simple"></i></button>
                    </td>
                </tr>
            `;
        }).join('');

        const defaultPickedCount = enriched.filter(x => x.hasLine).length;

        openConfirm({
            title: '✅ 確認續約 — 已回覆續租的合約',
            confirmLabel: '🔄 建約並發送',
            maxWidth: 900,
            message: `
                <div style="margin-bottom: 0.75rem; padding: 0.65rem 0.8rem; background: var(--bg-secondary); border-radius: 6px; border-left: 3px solid var(--color-success); font-size: var(--text-sm); line-height: 1.5;">
                    <div>已在 LINE 回覆「續租」的合約共 <strong style="color: var(--color-success);">${enriched.length}</strong> 筆.</div>
                    <div style="font-size: var(--text-xs); color: var(--text-muted); margin-top: 0.25rem;">
                        勾選後按「建約並發送」會: 建立續租合約 → 套用租金加項規則 → LINE 發繳款通知. 租金可直接改, 需要調整其他細節請按 ✏ 編輯原合約. 請確認沒有跟你已手動建的合約重複再送出.
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; font-size: var(--text-xs);">
                    <button type="button" class="btn btn-outline" id="confirm-select-all" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);">全選</button>
                    <button type="button" class="btn btn-outline" id="confirm-select-none" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);">全不選</button>
                    <span id="confirm-count" style="margin-left: auto; color: var(--text-muted);">已選 ${defaultPickedCount} 筆</span>
                </div>
                <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: var(--text-sm);">
                        <thead style="position: sticky; top: 0; background: var(--bg-secondary); z-index: 1;">
                            <tr>
                                <th style="padding: 0.5rem 0.5rem; width: 32px;"></th>
                                <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">原合約</th>
                                <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">租客</th>
                                <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">床位</th>
                                <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">租金 <span style="font-weight: 400; text-transform: none;">(下方應繳含加項)</span></th>
                                <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">到期日</th>
                                <th style="padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; font-size: var(--text-xs); color: var(--text-muted);">回覆時間</th>
                                <th style="padding: 0.5rem 0.5rem; width: 40px;"></th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            `,
            onMount: (overlay, close) => {
                const checks = () => overlay.querySelectorAll('.confirm-pick:not(:disabled)');
                const countEl = overlay.querySelector('#confirm-count');
                const confirmBtn = overlay.querySelector('[data-action="confirm"]');
                const updateCount = () => {
                    const picked = Array.from(checks()).filter(c => c.checked).length;
                    if (countEl) countEl.textContent = `已選 ${picked} 筆`;
                    if (confirmBtn) {
                        confirmBtn.textContent = picked === 0 ? '沒選就不動作' : `🔄 建約並發送給 ${picked} 位`;
                        confirmBtn.disabled = (picked === 0);
                    }
                };
                overlay.addEventListener('change', (e) => {
                    if (e.target.classList?.contains('confirm-pick')) updateCount();
                });
                overlay.querySelector('#confirm-select-all')?.addEventListener('click', () => {
                    checks().forEach(c => { c.checked = true; }); updateCount();
                });
                overlay.querySelector('#confirm-select-none')?.addEventListener('click', () => {
                    checks().forEach(c => { c.checked = false; }); updateCount();
                });
                // 租金欄位改動 → 即時重算「應繳」預覽 (含租金加項規則), 避免 admin 誤以為
                // 租金欄位本身該等於應繳總額 (兩者不同: 租金是月租基數, 應繳是套完規則後的總額)
                overlay.querySelectorAll('.confirm-amount').forEach(input => {
                    input.addEventListener('input', () => {
                        const cid = input.dataset.cid;
                        const target = enriched.find(x => x.c.id === cid)?.c;
                        const dueEl = overlay.querySelector(`.confirm-due-preview[data-cid-due="${cid}"]`);
                        if (!target || !dueEl) return;
                        const overrideAmount = Number(input.value);
                        const { dueAmount } = previewRenewalFor(target, { overrideAmount: Number.isFinite(overrideAmount) ? overrideAmount : undefined });
                        dueEl.textContent = `$${dueAmount.toLocaleString()}`;
                    });
                });
                // 編輯原合約 — 關掉這個 modal, 開合約編輯表單, 存檔後自動跳回「確認續約」
                // (帶最新資料重開, 不會卡在編輯表單那邊要自己再點一次)
                overlay.querySelectorAll('.confirm-edit-contract').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const cid = btn.dataset.cid;
                        const target = mockData.contracts.find(x => x.id === cid);
                        if (!target) return;
                        close();
                        setTimeout(() => showContractForm(target, {
                            onSaved: () => {
                                setTimeout(() => scope.querySelector('#btn-confirm-renewals')?.click(), 250);
                            }
                        }), 200);
                    });
                });
                updateCount();
            },
            onConfirm: async () => {
                const openOverlay = document.querySelector('.modal-overlay:not(.is-closing)');
                const renewals = openOverlay
                    ? Array.from(openOverlay.querySelectorAll('.confirm-pick')).filter(c => c.checked && !c.disabled).map(chk => {
                        const cid = chk.dataset.cid;
                        const amountInput = openOverlay.querySelector(`.confirm-amount[data-cid="${cid}"]`);
                        const parsed = amountInput ? Number(amountInput.value) : NaN;
                        // 金額欄位被清空/打錯字 → 不傳 override, renewContract 自動 fallback 用舊合約金額
                        return { id: cid, amount: (Number.isFinite(parsed) && parsed > 0) ? parsed : undefined };
                    })
                    : [];
                if (renewals.length === 0) {
                    showToast('沒選任何合約, 未建約', 'info');
                    return;
                }
                showToast(`建約中 (${renewals.length} 筆)…`, 'info', 3000);
                try {
                    const { successCount, failed } = await confirmAndProcessRenewals(renewals);
                    if (successCount > 0) {
                        showToast(`✅ 已建立 ${successCount} 份續租合約並發送繳款通知`, 'success', 5000);
                    }
                    if (failed.length > 0) {
                        console.warn('[confirm-renewals] failed:', failed);
                        showToast(`⚠ ${failed.length} 筆失敗 (見 console)`, 'warning', 6000);
                    }
                    refreshView();
                } catch (e) {
                    showToast(`建約失敗: ${e.message}`, 'danger', 6000);
                    console.error('[confirm-renewals]', e);
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
                    <div style="font-size: var(--text-xs); color: var(--text-muted);">月租 ${moneyAmount(c.amount || 0)} · ${c.startDate || '—'} ~ ${c.endDate || '—'}</div>
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
                    <div>合併後主合約應收 = <strong>${moneyAmount(total * term)}</strong> <span style="color: var(--text-muted); font-size: var(--text-xs);">(月租合計 ${moneyAmount(total)} × ${term} 期)</span></div>
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
