// 館務報帳：依館別獨立記錄支出、代墊與零用金收入，不併入主帳務。
import { supabase } from '../supabase.js';
import { mockData } from '../data.js';
import { getSession } from '../auth.js';
import { getMode } from '../utils/appMode.js';
import { currentModeBuildingIdSet } from '../utils/modeFilter.js';
import { openConfirm, openDetailModal, openFormModal, showToast } from '../utils/ui.js';
import { escapeHtml as esc, escapeAttr } from '../utils/escape.js';
import { moneyAmount } from '../utils/moneyDisplay.js';
import { consumeExpensePrefill } from '../utils/expensePrefill.js';
import { enhanceAmountInput } from '../utils/amountInput.js';

const TODAY = new Date().toISOString().slice(0, 10);
const CATEGORY_META = {
    energy:            { label: '能源費', icon: 'ph-lightning', tone: 'amber' },
    daily_supplies:    { label: '日用品', icon: 'ph-shopping-bag-open', tone: 'aqua' },
    petty_cash_income: { label: '零用金收入', icon: 'ph-money', tone: 'green' },
    cleaning_supplies: { label: '清潔用品（舊）', icon: 'ph-sparkle', tone: 'aqua' },
    repair_supplies:   { label: '維修耗材', icon: 'ph-toolbox', tone: 'slate' },
    transport:         { label: '交通費', icon: 'ph-bus', tone: 'blue' },
    other:             { label: '其他支出', icon: 'ph-dots-three-circle', tone: 'slate' }
};
const EXPENSE_CATEGORY_OPTIONS = ['energy', 'daily_supplies'];
const FUNDING_META = {
    petty_cash: { label: '零用金', icon: 'ph-coins' },
    personal:   { label: '個人代墊', icon: 'ph-hand-coins' },
    company:    { label: '公司支付（舊）', icon: 'ph-buildings' }
};
const FUNDING_OPTIONS = ['personal', 'petty_cash'];

let claims = [];
let isLoading = true;
let loadError = '';
let activeFilter = 'all';
let activeBuilding = 'all';
let currentSession = null;
let realtimeChannel = null;

function isReviewer() {
    return ['owner', 'admin'].includes(window.__currentRole);
}

function isIncome(claim) {
    return claim?.category === 'petty_cash_income';
}

function buildingName(id) {
    return mockData.buildings.find(b => b.id === id)?.name || id || '—';
}

function scopedBuildings() {
    const ids = currentModeBuildingIdSet(getMode());
    return (mockData.buildings || [])
        .filter(b => ids.has(b.id) && b.status !== 'inactive')
        .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
}

function normalizeClaim(row) {
    return {
        id: row.id,
        buildingId: row.building_id,
        expenseDate: row.expense_date,
        category: row.category,
        fundingSource: row.funding_source,
        amount: Number(row.amount) || 0,
        merchant: row.merchant || '',
        description: row.description || '',
        receiptPath: row.receipt_path || '',
        receiptName: row.receipt_name || '',
        receiptMime: row.receipt_mime || '',
        status: row.status,
        submittedBy: row.submitted_by,
        submittedByEmail: row.submitted_by_email || '',
        submittedByName: row.submitted_by_name || row.submitted_by_email || '',
        submittedAt: row.submitted_at,
        reviewedByEmail: row.reviewed_by_email || '',
        reviewedAt: row.reviewed_at,
        reviewNote: row.review_note || '',
        invoiceId: row.invoice_id || ''
    };
}

function statusMeta(claim) {
    if (claim.status === 'submitted' || claim.status === 'approved') return { label: isIncome(claim) ? '待確認' : '待付款', cls: 'warning', icon: 'ph-clock-countdown' };
    if (claim.status === 'rejected') return { label: '已退回', cls: 'danger', icon: 'ph-arrow-u-up-left' };
    return { label: isIncome(claim) ? '已入帳' : '已付款', cls: 'success', icon: 'ph-check-circle' };
}

function formatDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-TW', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
}

function quickActionHtml() {
    const actions = [
        { category: 'energy', funding: 'personal', label: '能源費', hint: '水、電、瓦斯等費用', icon: 'ph-lightning', tone: 'amber' },
        { category: 'daily_supplies', funding: 'personal', label: '日用品', hint: '清潔品與館內補給', icon: 'ph-shopping-bag-open', tone: 'aqua' },
        { category: 'daily_supplies', funding: 'petty_cash', label: '零用金支出', hint: '以館內零用金付款', icon: 'ph-coins', tone: 'blue' },
        { type: 'income', label: '新增收入', hint: '烘衣機等收入存入零用金', icon: 'ph-money', tone: 'coral' }
    ];
    return actions.map(a => `
        <button type="button" class="expense-quick-card tone-${a.tone} helper-authorized-write"
                data-expense-create data-entry-type="${a.type || 'expense'}" data-category="${a.category || ''}" data-funding="${a.funding || ''}">
            <span class="expense-quick-icon"><i class="ph ${a.icon}" aria-hidden="true"></i></span>
            <span class="expense-quick-copy"><strong>${a.label}</strong><small>${a.hint}</small></span>
            <i class="ph ph-arrow-right expense-quick-arrow" aria-hidden="true"></i>
        </button>
    `).join('');
}

function claimActionHtml(claim) {
    const buttons = [];
    if (claim.receiptPath) {
        buttons.push(`<button type="button" class="btn btn-outline btn-xs" data-expense-action="receipt" data-id="${escapeAttr(claim.id)}" title="開啟發票／收據"><i class="ph ph-file-image"></i><span>發票</span></button>`);
    }
    buttons.push(`<button type="button" class="btn btn-outline btn-xs" data-expense-action="detail" data-id="${escapeAttr(claim.id)}" title="查看報帳內容"><i class="ph ph-eye"></i><span>詳情</span></button>`);
    if (isReviewer() && ['submitted', 'approved'].includes(claim.status)) {
        buttons.push(`<button type="button" class="btn btn-outline btn-xs btn-success" data-expense-action="pay" data-id="${escapeAttr(claim.id)}" title="${isIncome(claim) ? '確認收入已入帳' : '標示已付款'}"><i class="ph ph-check-circle"></i><span>${isIncome(claim) ? '確認入帳' : '標示已付款'}</span></button>`);
        buttons.push(`<button type="button" class="btn btn-outline btn-xs btn-danger" data-expense-action="reject" data-id="${escapeAttr(claim.id)}" title="退回"><i class="ph ph-arrow-u-up-left"></i><span>退回</span></button>`);
    }
    if (isReviewer() || claim.submittedBy === currentSession?.user?.id) {
        buttons.push(`<button type="button" class="btn btn-outline btn-xs btn-danger" data-expense-action="delete" data-id="${escapeAttr(claim.id)}" title="刪除紀錄"><i class="ph ph-trash"></i><span>刪除</span></button>`);
    }
    return `<div class="row-action-group">${buttons.join('')}</div>`;
}

function filteredClaims() {
    const modeIds = currentModeBuildingIdSet(getMode());
    return claims.filter(c => modeIds.has(c.buildingId) && (activeBuilding === 'all' || c.buildingId === activeBuilding)).filter(c => {
        if (activeFilter === 'all') return true;
        if (activeFilter === 'pending') return ['submitted', 'approved'].includes(c.status);
        if (activeFilter === 'paid') return c.status === 'reimbursed';
        return c.status === 'rejected';
    });
}

function claimsTableHtml(rows) {
    if (!rows.length) {
        return `<tr><td colspan="7"><div class="expense-empty"><i class="ph ph-receipt"></i><strong>目前沒有符合的報帳</strong><span>點上方快速入口建立第一筆。</span></div></td></tr>`;
    }
    return rows.map(c => {
        const category = CATEGORY_META[c.category] || CATEGORY_META.other;
        const funding = FUNDING_META[c.fundingSource] || FUNDING_META.company;
        const status = statusMeta(c);
        return `
            <tr data-status="${esc(c.status)}" data-search="${escapeAttr([c.merchant, c.description, c.submittedByName, buildingName(c.buildingId)].join(' ').toLowerCase())}">
                <td><strong>${esc(c.expenseDate)}</strong><small class="expense-cell-sub">${esc(formatDateTime(c.submittedAt))} 送出</small></td>
                <td><strong>${esc(buildingName(c.buildingId))}</strong><small class="expense-cell-sub">${esc(c.submittedByName || '—')}</small></td>
                <td><span class="expense-category-chip tone-${category.tone}"><i class="ph ${category.icon}"></i>${category.label}</span><small class="expense-cell-sub"><i class="ph ${funding.icon}"></i> ${funding.label}</small></td>
                <td><strong>${esc(c.merchant || (isIncome(c) ? '未填收入來源' : '未填商家'))}</strong><small class="expense-cell-sub expense-clamp">${esc(c.description || '無備註')}</small></td>
                <td class="expense-amount ${isIncome(c) ? 'is-income' : ''}">${isIncome(c) ? '+' : ''}${moneyAmount(c.amount)}</td>
                <td><span class="status-badge ${status.cls}"><i class="ph ${status.icon}"></i> ${status.label}</span></td>
                <td>${claimActionHtml(c)}</td>
            </tr>`;
    }).join('');
}

function contentHtml() {
    const visible = filteredClaims();
    const scoped = claims.filter(c => currentModeBuildingIdSet(getMode()).has(c.buildingId) && (activeBuilding === 'all' || c.buildingId === activeBuilding));
    const monthKey = TODAY.slice(0, 7);
    const valid = scoped.filter(c => c.status !== 'rejected');
    const monthTotal = valid.filter(c => !isIncome(c) && c.expenseDate?.startsWith(monthKey)).reduce((sum, c) => sum + c.amount, 0);
    const pendingCount = scoped.filter(c => ['submitted', 'approved'].includes(c.status)).length;
    const payoutTotal = valid.filter(c => !isIncome(c) && c.fundingSource === 'personal' && c.status !== 'reimbursed').reduce((sum, c) => sum + c.amount, 0);
    const pettyIncome = valid.filter(isIncome).reduce((sum, c) => sum + c.amount, 0);
    const pettySpent = valid.filter(c => !isIncome(c) && c.fundingSource === 'petty_cash').reduce((sum, c) => sum + c.amount, 0);
    const buildingOptions = scopedBuildings();

    if (loadError) {
        return `<div class="card expense-load-error"><i class="ph ph-warning-circle"></i><strong>報帳資料載入失敗</strong><span>${esc(loadError)}</span><button type="button" class="btn btn-outline" data-expense-retry>重新載入</button></div>`;
    }

    return `
        <section class="expense-intro">
            <div>
                <span class="expense-eyebrow">小幫手工作台</span>
                <h2>各館獨立記帳，支出與零用金一眼看清楚。</h2>
                <p>館務報帳使用獨立報表，不會併入主帳務；收入會直接列入該館零用金。</p>
            </div>
            <div class="expense-intro-mark" aria-hidden="true"><i class="ph ph-receipt"></i><span>CLAIM</span></div>
        </section>

        <section class="expense-quick-section" aria-labelledby="expense-quick-title">
            <h3 class="expense-quick-title" id="expense-quick-title">快速新增記帳</h3>
            <div class="expense-quick-grid">
                ${quickActionHtml()}
            </div>
        </section>

        <section class="expense-metrics">
            <div><span>待處理</span><strong>${pendingCount}</strong><small>筆紀錄</small></div>
            <div><span>本月支出</span><strong>${moneyAmount(monthTotal)}</strong><small>不含已退回</small></div>
            <div><span>零用金餘額</span><strong>${moneyAmount(pettyIncome - pettySpent)}</strong><small>收入扣除使用</small></div>
            <div><span>代撥代墊</span><strong>${moneyAmount(payoutTotal)}</strong><small>尚未標示付款</small></div>
        </section>

        <section class="card expense-ledger-card">
            <div class="expense-ledger-head">
                <div><span class="expense-eyebrow">各館獨立報表</span><h3>${isReviewer() ? '館務報帳管理' : '館務報帳紀錄'}</h3></div>
                <div class="expense-ledger-actions"><button type="button" class="btn btn-outline helper-authorized-write" data-expense-create data-entry-type="income"><i class="ph ph-plus-circle"></i> 新增收入</button><button type="button" class="btn btn-primary helper-authorized-write" id="expense-create-btn" data-expense-create data-entry-type="expense" data-category="daily_supplies" data-funding="personal" data-fab="ph-camera-plus"><i class="ph ph-plus"></i> 新增支出</button></div>
            </div>
            <div class="expense-building-filter" aria-label="選擇館別報表">
                <button class="${activeBuilding === 'all' ? 'active' : ''}" data-expense-building="all">全部館別</button>
                ${buildingOptions.map(building => `<button class="${activeBuilding === building.id ? 'active' : ''}" data-expense-building="${escapeAttr(building.id)}">${esc(building.name)}</button>`).join('')}
            </div>
            <div class="filter-tabs expense-filter-tabs">
                <button class="filter-tab ${activeFilter === 'all' ? 'active' : ''}" data-expense-filter="all">全部</button>
                <button class="filter-tab ${activeFilter === 'pending' ? 'active' : ''}" data-expense-filter="pending">待處理 (${pendingCount})</button>
                <button class="filter-tab ${activeFilter === 'paid' ? 'active' : ''}" data-expense-filter="paid">已付款</button>
                <button class="filter-tab ${activeFilter === 'rejected' ? 'active' : ''}" data-expense-filter="rejected">已退回</button>
            </div>
            <div class="table-container expense-table-wrap">
                <table class="data-table expense-table">
                    <thead><tr><th>日期</th><th>館別／申請人</th><th>類別／付款</th><th>內容</th><th>金額</th><th>狀態</th><th>操作</th></tr></thead>
                    <tbody>${isLoading ? `<tr><td colspan="7"><div class="expense-empty"><i class="ph ph-circle-notch expense-spin"></i><strong>正在載入報帳…</strong></div></td></tr>` : claimsTableHtml(visible)}</tbody>
                </table>
            </div>
        </section>`;
}

export function renderExpenses() {
    return `<div id="expenses-page-root" class="expenses-page">${contentHtml()}</div>`;
}

function paint(scope) {
    const root = scope?.querySelector?.('#expenses-page-root') || document.querySelector('#expenses-page-root');
    if (!root) return;
    root.innerHTML = contentHtml();
    bindActions(root);
}

async function loadClaims(scope) {
    isLoading = true;
    loadError = '';
    paint(scope);
    const { data, error } = await supabase.from('expense_claims').select('*').order('submitted_at', { ascending: false });
    if (error) {
        loadError = error.message;
        claims = [];
    } else {
        claims = (data || []).map(normalizeClaim);
    }
    isLoading = false;
    paint(scope);
}

async function uploadReceipt(file) {
    if (!file) return null;
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    if (!allowed.has(file.type)) throw new Error('發票只支援 JPG、PNG、WebP 或 PDF');
    if (file.size > 10 * 1024 * 1024) throw new Error('發票檔案不能超過 10 MB');
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const key = `${currentSession.user.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('expense-receipts').upload(key, file, {
        contentType: file.type,
        upsert: false
    });
    if (error) throw new Error(`發票上傳失敗：${error.message}`);
    return { path: key, name: file.name, mime: file.type };
}

function openClaimForm(prefill = {}) {
    if (prefill.type === 'income') {
        openIncomeForm();
        return;
    }
    const buildings = scopedBuildings();
    if (!buildings.length) {
        showToast('目前沒有可報帳的授權館別，請聯絡管理員', 'warning', 5000);
        return;
    }
    let receiptFile = null;
    let formRef = null;
    const title = prefill.funding === 'petty_cash' ? '新增零用金支出' : '新增館務支出';

    openFormModal({
        title,
        maxWidth: 620,
        fields: [
            { name: 'buildingId', label: '館別', type: 'select', required: true, span: 2, options: buildings.map(b => ({ value: b.id, label: b.name })), value: buildings[0].id },
            { name: 'expenseDate', label: '支出日期', type: 'date', required: true, span: 2, value: TODAY },
            { name: 'amount', label: '本次支出金額', type: 'number', required: true, span: 2, hint: '請輸入發票或收據上的實付總額' },
            { name: 'category', label: '主要支出項目', type: 'select', required: true, options: EXPENSE_CATEGORY_OPTIONS.map(value => ({ value, label: CATEGORY_META[value].label })), value: EXPENSE_CATEGORY_OPTIONS.includes(prefill.category) ? prefill.category : 'daily_supplies' },
            { name: 'fundingSource', label: '付款方式', type: 'select', required: true, options: FUNDING_OPTIONS.map(value => ({ value, label: FUNDING_META[value].label })), value: FUNDING_OPTIONS.includes(prefill.funding) ? prefill.funding : 'personal' },
            { name: 'merchant', label: '商家／購買處', type: 'text', span: 2, placeholder: '例：全聯、寶雅' },
            { name: 'description', label: '用途說明', type: 'textarea', required: true, span: 2, rows: 3, placeholder: '例：松山館公共區域垃圾袋 3 包' },
            { name: 'receiptUpload', type: 'placeholder', span: 2 }
        ],
        submitLabel: '新增支出',
        onFormMount: form => {
            formRef = form;
            enhanceAmountInput(form, { readbackLabel: '這筆送審金額' });
            const ph = form.querySelector('#ph-receiptUpload');
            if (!ph) return;
            ph.innerHTML = `
                <label class="expense-upload" for="expense-receipt-input">
                    <input id="expense-receipt-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden>
                    <span class="expense-upload-icon"><i class="ph ph-camera-plus"></i></span>
                    <span><strong>上傳發票／收據</strong><small>可直接拍照，支援 JPG、PNG、WebP、PDF，上限 10 MB。發票要記得收好喔！</small></span>
                    <span class="expense-upload-state">選擇檔案</span>
                </label>`;
            const input = ph.querySelector('input');
            input.addEventListener('change', () => {
                receiptFile = input.files?.[0] || null;
                const state = ph.querySelector('.expense-upload-state');
                state.textContent = receiptFile ? receiptFile.name : '選擇檔案';
                ph.querySelector('.expense-upload')?.classList.toggle('has-file', !!receiptFile);
            });
        },
        onSubmit: async values => {
            if (!currentSession?.user) {
                showToast('登入狀態已過期，請重新登入', 'danger');
                return false;
            }
            if (!Number.isFinite(values.amount) || values.amount <= 0) {
                showToast('金額必須大於 0', 'danger');
                return false;
            }
            if (values.fundingSource === 'personal' && !receiptFile) {
                showToast('個人代墊報帳請上傳發票或收據', 'warning');
                formRef?.querySelector('#ph-receiptUpload')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return false;
            }

            let uploaded = null;
            try {
                uploaded = await uploadReceipt(receiptFile);
                const payload = {
                    building_id: values.buildingId,
                    expense_date: values.expenseDate,
                    category: values.category,
                    funding_source: values.fundingSource,
                    amount: Math.round(values.amount),
                    merchant: values.merchant || null,
                    description: values.description || null,
                    receipt_path: uploaded?.path || null,
                    receipt_name: uploaded?.name || null,
                    receipt_mime: uploaded?.mime || null,
                    submitted_by: currentSession.user.id,
                    submitted_by_email: currentSession.user.email || ''
                };
                const { error } = await supabase.from('expense_claims').insert(payload);
                if (error) throw new Error(error.message);
                showToast('館務支出已新增', 'success', 4500);
                await loadClaims(document.querySelector('.view-section.active'));
            } catch (error) {
                if (uploaded?.path) await supabase.storage.from('expense-receipts').remove([uploaded.path]);
                showToast(`送出失敗：${error.message}`, 'danger', 7000);
                return false;
            }
        }
    });
}

function openIncomeForm() {
    const buildings = scopedBuildings();
    if (!buildings.length) {
        showToast('目前沒有可記帳的授權館別，請聯絡管理員', 'warning', 5000);
        return;
    }
    openFormModal({
        title: '新增零用金收入',
        maxWidth: 560,
        fields: [
            { name: 'buildingId', label: '館別', type: 'select', required: true, span: 2, options: buildings.map(b => ({ value: b.id, label: b.name })), value: buildings[0].id },
            { name: 'expenseDate', label: '收入日期', type: 'date', required: true, span: 2, value: TODAY },
            { name: 'amount', label: '本次收入金額', type: 'number', required: true, span: 2, hint: '收入新增後會直接增加該館零用金目前金額' },
            { name: 'merchant', label: '收入來源', type: 'select', required: true, span: 2, options: [
                { value: '烘衣機收入', label: '烘衣機收入' },
                { value: '其他收入', label: '其他收入' }
            ], value: '烘衣機收入' },
            { name: 'description', label: '備註', type: 'textarea', span: 2, rows: 3, placeholder: '例：9 月烘衣機現金收入' }
        ],
        submitLabel: '新增收入',
        onFormMount: form => enhanceAmountInput(form, { readbackLabel: '這筆零用金收入' }),
        onSubmit: async values => {
            if (!currentSession?.user) {
                showToast('登入狀態已過期，請重新登入', 'danger');
                return false;
            }
            if (!Number.isFinite(values.amount) || values.amount <= 0) {
                showToast('金額必須大於 0', 'danger');
                return false;
            }
            const { error } = await supabase.from('expense_claims').insert({
                building_id: values.buildingId,
                expense_date: values.expenseDate,
                category: 'petty_cash_income',
                funding_source: 'petty_cash',
                amount: Math.round(values.amount),
                merchant: values.merchant,
                description: values.description || null,
                submitted_by: currentSession.user.id,
                submitted_by_email: currentSession.user.email || ''
            });
            if (error) {
                showToast(`新增收入失敗：${error.message}`, 'danger', 7000);
                return false;
            }
            showToast('零用金收入已新增', 'success');
            await loadClaims(document.querySelector('.view-section.active'));
        }
    });
}

async function openReceipt(claim) {
    if (!claim?.receiptPath) return;
    const { data, error } = await supabase.storage.from('expense-receipts').createSignedUrl(claim.receiptPath, 300);
    if (error || !data?.signedUrl) {
        showToast(`開啟發票失敗：${error?.message || '無法取得連結'}`, 'danger');
        return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
}

function showClaimDetail(claim) {
    const status = statusMeta(claim);
    const category = CATEGORY_META[claim.category] || CATEGORY_META.other;
    const funding = FUNDING_META[claim.fundingSource] || FUNDING_META.company;
    openDetailModal({
        title: `${isIncome(claim) ? '收入紀錄' : '報帳單'} ${claim.id.slice(0, 8).toUpperCase()}`,
        items: [
            { label: '狀態', value: `<span class="status-badge ${status.cls}">${status.label}</span>` },
            { label: '館別', value: esc(buildingName(claim.buildingId)) },
            { label: isIncome(claim) ? '收入日期' : '支出日期', value: esc(claim.expenseDate) },
            { label: '類別', value: esc(category.label) },
            { label: isIncome(claim) ? '歸入帳戶' : '付款方式', value: esc(funding.label) },
            { label: '金額', value: `<strong>${moneyAmount(claim.amount)}</strong>` },
            { label: isIncome(claim) ? '收入來源' : '商家', value: esc(claim.merchant || '—') },
            { label: '記錄人', value: esc(claim.submittedByName || '—') }
        ],
        extraHtml: `
            <div class="expense-detail-note"><span>用途說明</span><p>${esc(claim.description || '無備註')}</p></div>
            ${claim.reviewNote ? `<div class="expense-detail-note is-review"><span>審核備註</span><p>${esc(claim.reviewNote)}</p></div>` : ''}
            ${claim.receiptPath ? `<button type="button" class="btn btn-outline" data-detail-receipt style="width:100%; margin-top:1rem;"><i class="ph ph-file-image"></i> 開啟 ${esc(claim.receiptName || '發票／收據')}</button>` : ''}`,
        onMount: overlay => overlay.querySelector('[data-detail-receipt]')?.addEventListener('click', () => openReceipt(claim))
    });
}

async function reviewClaim(claim, action, note = '') {
    const { error } = await supabase.rpc('review_expense_claim', {
        p_claim_id: claim.id,
        p_action: action,
        p_note: note || null
    });
    if (error) {
        showToast(`處理失敗：${error.message}`, 'danger', 7000);
        return false;
    }
    const messages = { pay: isIncome(claim) ? '已確認收入入帳' : '已標示付款', reject: '已退回報帳' };
    showToast(messages[action], 'success');
    await loadClaims(document.querySelector('.view-section.active'));
    return true;
}

function startReview(claim, action) {
    if (action === 'reject') {
        openFormModal({
            title: '退回報帳',
            maxWidth: 460,
            fields: [{ name: 'note', label: '退回原因', type: 'textarea', rows: 3, required: true, span: 2, placeholder: '例：請補上完整發票照片' }],
            submitLabel: '確認退回',
            onSubmit: async ({ note }) => (await reviewClaim(claim, 'reject', note)) || false
        });
        return;
    }
    const title = isIncome(claim) ? '確認收入入帳' : '標示已付款';
    const message = isIncome(claim)
        ? `確認 <strong>${esc(buildingName(claim.buildingId))} · ${moneyAmount(claim.amount)}</strong> 已收入零用金？`
        : `確認 <strong>${esc(buildingName(claim.buildingId))} · ${moneyAmount(claim.amount)}</strong> 已付款？<br><small style="color:var(--text-muted);">這只會更新館務報帳狀態，不會寫入主帳務。</small>`;
    openConfirm({
        title,
        message,
        confirmLabel: isIncome(claim) ? '確認入帳' : '標示已付款',
        onConfirm: () => reviewClaim(claim, 'pay')
    });
}

function startDelete(claim) {
    const label = `${buildingName(claim.buildingId)} · ${moneyAmount(claim.amount)}`;
    openConfirm({
        title: '第一次確認：刪除紀錄',
        message: `要刪除 <strong>${esc(label)}</strong> 嗎？<br><small style="color:var(--text-muted);">刪除後將不再列入各館報表。</small>`,
        confirmLabel: '繼續刪除',
        danger: true,
        onConfirm: () => openConfirm({
            title: '第二次確認：正式刪除',
            message: `請再次確認刪除這筆${isIncome(claim) ? '收入' : '報帳'}。此動作無法復原。`,
            confirmLabel: '正式刪除',
            danger: true,
            onConfirm: () => deleteClaim(claim)
        })
    });
}

async function deleteClaim(claim) {
    const { error } = await supabase.rpc('delete_expense_claim', { p_claim_id: claim.id });
    if (error) {
        showToast(`刪除失敗：${error.message}`, 'danger', 7000);
        return false;
    }
    if (claim.receiptPath) {
        const { error: receiptError } = await supabase.storage.from('expense-receipts').remove([claim.receiptPath]);
        if (receiptError) console.warn('Receipt cleanup failed:', receiptError.message);
    }
    showToast('館務報帳紀錄已刪除', 'success');
    await loadClaims(document.querySelector('.view-section.active'));
    return true;
}

function bindActions(root) {
    root.querySelectorAll('[data-expense-create]').forEach(btn => btn.addEventListener('click', () => openClaimForm({
        type: btn.dataset.entryType,
        category: btn.dataset.category,
        funding: btn.dataset.funding
    })));
    root.querySelectorAll('[data-expense-filter]').forEach(btn => btn.addEventListener('click', () => {
        activeFilter = btn.dataset.expenseFilter;
        paint(root.closest('.view-section'));
    }));
    root.querySelectorAll('[data-expense-building]').forEach(btn => btn.addEventListener('click', () => {
        activeBuilding = btn.dataset.expenseBuilding;
        paint(root.closest('.view-section'));
    }));
    root.querySelector('[data-expense-retry]')?.addEventListener('click', () => loadClaims(root.closest('.view-section')));
    root.querySelectorAll('[data-expense-action]').forEach(btn => btn.addEventListener('click', () => {
        const claim = claims.find(c => c.id === btn.dataset.id);
        if (!claim) return;
        const action = btn.dataset.expenseAction;
        if (action === 'receipt') openReceipt(claim);
        if (action === 'detail') showClaimDetail(claim);
        if (['pay', 'reject'].includes(action)) startReview(claim, action);
        if (action === 'delete') startDelete(claim);
    }));
}

function subscribeToClaims(scope) {
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);
    realtimeChannel = supabase.channel('expense-claims-page')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_claims' }, () => loadClaims(scope))
        .subscribe();
}

export async function initExpensesActions(scope) {
    currentSession = await getSession();
    bindActions(scope);
    await loadClaims(scope);
    subscribeToClaims(scope);
    const prefill = consumeExpensePrefill();
    if (prefill) requestAnimationFrame(() => openClaimForm(prefill));
}
