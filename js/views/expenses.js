// 館務報帳：小幫手送審日用／清潔／零用金／代墊支出，管理員核准後入正式帳。
import { supabase } from '../supabase.js';
import { mockData } from '../data.js';
import { getSession } from '../auth.js';
import { getMode } from '../utils/appMode.js';
import { currentModeBuildingIdSet } from '../utils/modeFilter.js';
import { openConfirm, openDetailModal, openFormModal, showToast } from '../utils/ui.js';
import { escapeHtml as esc, escapeAttr } from '../utils/escape.js';
import { moneyAmount } from '../utils/moneyDisplay.js';

const TODAY = new Date().toISOString().slice(0, 10);
const CATEGORY_META = {
    daily_supplies:    { label: '日用品', icon: 'ph-shopping-bag-open', tone: 'amber' },
    cleaning_supplies: { label: '清潔用品', icon: 'ph-sparkle', tone: 'aqua' },
    repair_supplies:   { label: '維修耗材', icon: 'ph-toolbox', tone: 'slate' },
    transport:         { label: '交通費', icon: 'ph-bus', tone: 'blue' },
    other:             { label: '其他支出', icon: 'ph-dots-three-circle', tone: 'slate' }
};
const FUNDING_META = {
    company:    { label: '公司支付', icon: 'ph-buildings' },
    petty_cash: { label: '零用金', icon: 'ph-coins' },
    personal:   { label: '個人代墊', icon: 'ph-hand-coins' }
};

let claims = [];
let isLoading = true;
let loadError = '';
let activeFilter = 'all';
let currentSession = null;
let realtimeChannel = null;

function isReviewer() {
    return ['owner', 'admin'].includes(window.__currentRole);
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
    if (claim.status === 'submitted') return { label: '待審核', cls: 'warning', icon: 'ph-clock-countdown' };
    if (claim.status === 'rejected') return { label: '已退回', cls: 'danger', icon: 'ph-arrow-u-up-left' };
    if (claim.status === 'reimbursed') return { label: '已撥款', cls: 'success', icon: 'ph-check-circle' };
    if (claim.status === 'approved' && claim.fundingSource === 'personal') {
        return { label: '待撥款', cls: 'info', icon: 'ph-hand-coins' };
    }
    return { label: '已核准', cls: 'success', icon: 'ph-check-circle' };
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
        { category: 'daily_supplies', funding: 'company', label: '日用品', hint: '紙品、燈泡、館內補給', icon: 'ph-shopping-bag-open', tone: 'amber' },
        { category: 'cleaning_supplies', funding: 'company', label: '清潔用品', hint: '清潔劑、垃圾袋、耗材', icon: 'ph-sparkle', tone: 'aqua' },
        { category: 'other', funding: 'petty_cash', label: '零用金支出', hint: '從館別零用金支付', icon: 'ph-coins', tone: 'blue' },
        { category: 'other', funding: 'personal', label: '個人代墊報帳', hint: '送審後等待核准撥款', icon: 'ph-hand-coins', tone: 'coral' }
    ];
    return actions.map(a => `
        <button type="button" class="expense-quick-card tone-${a.tone} helper-authorized-write"
                data-expense-create data-category="${a.category}" data-funding="${a.funding}">
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
    if (isReviewer() && claim.status === 'submitted') {
        buttons.push(`<button type="button" class="btn btn-outline btn-xs btn-success" data-expense-action="approve" data-id="${escapeAttr(claim.id)}" title="核准"><i class="ph ph-check"></i><span>核准</span></button>`);
        buttons.push(`<button type="button" class="btn btn-outline btn-xs btn-danger" data-expense-action="reject" data-id="${escapeAttr(claim.id)}" title="退回"><i class="ph ph-arrow-u-up-left"></i><span>退回</span></button>`);
    }
    if (isReviewer() && claim.status === 'approved' && claim.fundingSource === 'personal') {
        buttons.push(`<button type="button" class="btn btn-outline btn-xs btn-primary-soft" data-expense-action="reimburse" data-id="${escapeAttr(claim.id)}" title="標記已撥款"><i class="ph ph-hand-coins"></i><span>已撥款</span></button>`);
    }
    return `<div class="row-action-group">${buttons.join('')}</div>`;
}

function filteredClaims() {
    const modeIds = currentModeBuildingIdSet(getMode());
    return claims.filter(c => modeIds.has(c.buildingId)).filter(c => {
        if (activeFilter === 'all') return true;
        if (activeFilter === 'pending') return c.status === 'submitted';
        if (activeFilter === 'payout') return c.status === 'approved' && c.fundingSource === 'personal';
        return c.status === activeFilter;
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
                <td><strong>${esc(c.merchant || '未填商家')}</strong><small class="expense-cell-sub expense-clamp">${esc(c.description || '無備註')}</small></td>
                <td class="expense-amount">${moneyAmount(c.amount)}</td>
                <td><span class="status-badge ${status.cls}"><i class="ph ${status.icon}"></i> ${status.label}</span>${c.invoiceId ? `<small class="expense-cell-sub">${esc(c.invoiceId)}</small>` : ''}</td>
                <td>${claimActionHtml(c)}</td>
            </tr>`;
    }).join('');
}

function contentHtml() {
    const visible = filteredClaims();
    const scoped = claims.filter(c => currentModeBuildingIdSet(getMode()).has(c.buildingId));
    const monthKey = TODAY.slice(0, 7);
    const monthTotal = scoped.filter(c => c.expenseDate?.startsWith(monthKey) && c.status !== 'rejected').reduce((sum, c) => sum + c.amount, 0);
    const pendingCount = scoped.filter(c => c.status === 'submitted').length;
    const payoutTotal = scoped.filter(c => c.status === 'approved' && c.fundingSource === 'personal').reduce((sum, c) => sum + c.amount, 0);
    const pettyCashTotal = scoped.filter(c => c.expenseDate?.startsWith(monthKey) && c.fundingSource === 'petty_cash' && c.status !== 'rejected').reduce((sum, c) => sum + c.amount, 0);

    if (loadError) {
        return `<div class="card expense-load-error"><i class="ph ph-warning-circle"></i><strong>報帳資料載入失敗</strong><span>${esc(loadError)}</span><button type="button" class="btn btn-outline" data-expense-retry>重新載入</button></div>`;
    }

    return `
        <section class="expense-intro">
            <div>
                <span class="expense-eyebrow">小幫手工作台</span>
                <h2>拍下單據，把每筆館務花費說清楚。</h2>
                <p>選擇館別與付款方式，上傳發票後送審；核准前不會進入正式財務報表。</p>
            </div>
            <div class="expense-intro-mark" aria-hidden="true"><i class="ph ph-receipt"></i><span>CLAIM</span></div>
        </section>

        <section class="expense-quick-grid" aria-label="快速建立報帳">
            ${quickActionHtml()}
        </section>

        <section class="expense-metrics">
            <div><span>待審核</span><strong>${pendingCount}</strong><small>筆申請</small></div>
            <div><span>本月已報</span><strong>${moneyAmount(monthTotal)}</strong><small>不含已退回</small></div>
            <div><span>本月零用金</span><strong>${moneyAmount(pettyCashTotal)}</strong><small>已記錄支出</small></div>
            <div><span>待撥代墊</span><strong>${moneyAmount(payoutTotal)}</strong><small>核准後待撥款</small></div>
        </section>

        <section class="card expense-ledger-card">
            <div class="expense-ledger-head">
                <div><span class="expense-eyebrow">送審紀錄</span><h3>${isReviewer() ? '館務支出審核' : '我的報帳紀錄'}</h3></div>
                <button type="button" class="btn btn-primary helper-authorized-write" id="expense-create-btn" data-expense-create data-category="daily_supplies" data-funding="company" data-fab="ph-camera-plus"><i class="ph ph-plus"></i> 新增報帳</button>
            </div>
            <div class="filter-tabs expense-filter-tabs">
                <button class="filter-tab ${activeFilter === 'all' ? 'active' : ''}" data-expense-filter="all">全部</button>
                <button class="filter-tab ${activeFilter === 'pending' ? 'active' : ''}" data-expense-filter="pending">待審核 (${pendingCount})</button>
                <button class="filter-tab ${activeFilter === 'payout' ? 'active' : ''}" data-expense-filter="payout">待撥款</button>
                <button class="filter-tab ${activeFilter === 'approved' ? 'active' : ''}" data-expense-filter="approved">已核准</button>
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
    const buildings = scopedBuildings();
    if (!buildings.length) {
        showToast('目前沒有可報帳的授權館別，請聯絡管理員', 'warning', 5000);
        return;
    }
    let receiptFile = null;
    let formRef = null;
    const title = prefill.funding === 'personal' ? '個人代墊報帳' : prefill.funding === 'petty_cash' ? '零用金支出' : '新增館務支出';

    openFormModal({
        title,
        maxWidth: 620,
        fields: [
            { name: 'buildingId', label: '館別', type: 'select', required: true, span: 2, options: buildings.map(b => ({ value: b.id, label: b.name })), value: buildings[0].id },
            { name: 'expenseDate', label: '支出日期', type: 'date', required: true, value: TODAY },
            { name: 'amount', label: '金額 (TWD)', type: 'number', required: true, placeholder: '例：350' },
            { name: 'category', label: '支出類別', type: 'select', required: true, options: Object.entries(CATEGORY_META).map(([value, meta]) => ({ value, label: meta.label })), value: prefill.category || 'daily_supplies' },
            { name: 'fundingSource', label: '付款方式', type: 'select', required: true, options: Object.entries(FUNDING_META).map(([value, meta]) => ({ value, label: meta.label })), value: prefill.funding || 'company' },
            { name: 'merchant', label: '商家／購買處', type: 'text', span: 2, placeholder: '例：全聯、寶雅' },
            { name: 'description', label: '用途說明', type: 'textarea', required: true, span: 2, rows: 3, placeholder: '例：松山館公共區域垃圾袋 3 包' },
            { name: 'receiptUpload', type: 'placeholder', span: 2 }
        ],
        submitLabel: '送出審核',
        onFormMount: form => {
            formRef = form;
            const ph = form.querySelector('#ph-receiptUpload');
            if (!ph) return;
            ph.innerHTML = `
                <label class="expense-upload" for="expense-receipt-input">
                    <input id="expense-receipt-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden>
                    <span class="expense-upload-icon"><i class="ph ph-camera-plus"></i></span>
                    <span><strong>上傳發票／收據</strong><small>可直接拍照，支援 JPG、PNG、WebP、PDF，上限 10 MB</small></span>
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
                showToast('報帳已送出，等待管理員審核', 'success', 4500);
                await loadClaims(document.querySelector('.view-section.active'));
            } catch (error) {
                if (uploaded?.path) await supabase.storage.from('expense-receipts').remove([uploaded.path]);
                showToast(`送出失敗：${error.message}`, 'danger', 7000);
                return false;
            }
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
        title: `報帳單 ${claim.id.slice(0, 8).toUpperCase()}`,
        items: [
            { label: '狀態', value: `<span class="status-badge ${status.cls}">${status.label}</span>` },
            { label: '館別', value: esc(buildingName(claim.buildingId)) },
            { label: '支出日期', value: esc(claim.expenseDate) },
            { label: '類別', value: esc(category.label) },
            { label: '付款方式', value: esc(funding.label) },
            { label: '金額', value: `<strong>${moneyAmount(claim.amount)}</strong>` },
            { label: '商家', value: esc(claim.merchant || '—') },
            { label: '申請人', value: esc(claim.submittedByName || '—') },
            { label: '正式帳目', value: esc(claim.invoiceId || '尚未建立') }
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
    const messages = { approve: '已核准並建立正式支出', reject: '已退回報帳', reimburse: '已標記撥款並結清支出' };
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
    const approve = action === 'approve';
    const title = approve ? '核准報帳' : '確認已撥款';
    const message = approve
        ? `核准 <strong>${esc(buildingName(claim.buildingId))} · ${moneyAmount(claim.amount)}</strong>？<br><small style="color:var(--text-muted);">核准後會自動建立正式支出，不會重複入帳。</small>`
        : `確認已撥付 <strong>${moneyAmount(claim.amount)}</strong> 給 ${esc(claim.submittedByName)}？<br><small style="color:var(--text-muted);">對應的正式支出將標記為已付。</small>`;
    openConfirm({
        title,
        message,
        confirmLabel: approve ? '核准並入帳' : '標記已撥款',
        onConfirm: () => reviewClaim(claim, approve ? 'approve' : 'reimburse')
    });
}

function bindActions(root) {
    root.querySelectorAll('[data-expense-create]').forEach(btn => btn.addEventListener('click', () => openClaimForm({
        category: btn.dataset.category,
        funding: btn.dataset.funding
    })));
    root.querySelectorAll('[data-expense-filter]').forEach(btn => btn.addEventListener('click', () => {
        activeFilter = btn.dataset.expenseFilter;
        paint(root.closest('.view-section'));
    }));
    root.querySelector('[data-expense-retry]')?.addEventListener('click', () => loadClaims(root.closest('.view-section')));
    root.querySelectorAll('[data-expense-action]').forEach(btn => btn.addEventListener('click', () => {
        const claim = claims.find(c => c.id === btn.dataset.id);
        if (!claim) return;
        const action = btn.dataset.expenseAction;
        if (action === 'receipt') openReceipt(claim);
        if (action === 'detail') showClaimDetail(claim);
        if (['approve', 'reject', 'reimburse'].includes(action)) startReview(claim, action);
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
}
