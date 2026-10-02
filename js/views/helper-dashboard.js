import { supabase } from '../supabase.js';
import { mockData } from '../data.js';
import { currentModeBuildingIdSet } from '../utils/modeFilter.js';
import { buildMonthCells, buildPettyCashSnapshot, buildStayEvents } from '../utils/helperDashboardData.js';
import { buildRentCollectionRows, rentCollectionCounts } from '../utils/helperRentCollectionData.js';
import { queueExpensePrefill } from '../utils/expensePrefill.js';
import { escapeHtml as esc, escapeAttr } from '../utils/escape.js';
import { moneyAmount } from '../utils/moneyDisplay.js';
import { enhanceAmountInput } from '../utils/amountInput.js';
import { getSession } from '../auth.js';
import { openFormModal, showToast } from '../utils/ui.js';

const QUICK_ACTIONS = [
    { category: 'energy', funding: 'personal', label: '能源費', hint: '水、電、瓦斯等館務費用', icon: 'ph-lightning', tone: 'amber' },
    { category: 'daily_supplies', funding: 'personal', label: '日用品', hint: '紙品、清潔品與館內補給', icon: 'ph-shopping-bag-open', tone: 'aqua' },
    { category: 'daily_supplies', funding: 'petty_cash', label: '零用金支出', hint: '以館內現有零用金支付', icon: 'ph-coins', tone: 'blue' },
    { type: 'income', label: '新增收入', hint: '烘衣機等收入存入零用金', icon: 'ph-money', tone: 'coral' }
];

const CURRENT_MONTH = new Date().toISOString().slice(0, 7);
let selectedMonth = CURRENT_MONTH;
let accountingClaims = [];
let cashLoading = true;
let paymentReports = [];
let rentLoading = true;
let rentFilter = 'need_payment';
let helperSession = null;
let paymentReportChannel = null;

function allowedBuildingIds() {
    return currentModeBuildingIdSet('cohousing');
}

function monthLabel(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    return `${year} 年 ${month} 月`;
}

function shiftMonth(monthKey, delta) {
    const [year, month] = monthKey.split('-').map(Number);
    const d = new Date(year, month - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function quickActionsHtml() {
    const canExpense = !Array.isArray(window.__helperViews) || window.__helperViews.includes('expenses');
    return QUICK_ACTIONS.map(action => `
        <button type="button" class="helper-home-quick tone-${action.tone}" data-helper-expense
                data-entry-type="${escapeAttr(action.type || 'expense')}"
                data-category="${escapeAttr(action.category || '')}" data-funding="${escapeAttr(action.funding || '')}"
                ${canExpense ? '' : 'disabled'}>
            <span class="helper-home-quick-icon"><i class="ph ${action.icon}" aria-hidden="true"></i></span>
            <span><strong>${action.label}</strong><small>${canExpense ? action.hint : '尚未開放報帳權限'}</small></span>
            <i class="ph ph-arrow-up-right" aria-hidden="true"></i>
        </button>
    `).join('');
}

function cashHtml() {
    const buildingIds = allowedBuildingIds();
    const snapshot = buildPettyCashSnapshot({
        buildings: mockData.buildings,
        claims: accountingClaims,
        buildingIds,
        monthKey: CURRENT_MONTH
    });
    const remainingClass = snapshot.balance < 0 ? 'is-over' : '';

    return `
        <div class="helper-cash-head">
            <div>
                <span class="helper-section-kicker"><i class="ph ph-chart-donut"></i> ${esc(monthLabel(CURRENT_MONTH))}</span>
                <h2>帳務</h2>
            </div>
            <a href="#expenses" class="helper-text-link">查看紀錄 <i class="ph ph-arrow-right"></i></a>
        </div>
        <div class="helper-cash-balance ${remainingClass}">
            <span>零用金目前金額</span>
            <strong>${moneyAmount(snapshot.balance)}</strong>
            <small>累計收入 ${moneyAmount(snapshot.income)} − 累計使用 ${moneyAmount(snapshot.pettyCashSpent)}</small>
        </div>
        <div class="helper-cash-ledger">
            <div><span>當月支出（總計）</span><strong>${moneyAmount(snapshot.monthExpenseTotal)}</strong></div>
            <div><span>代撥代墊總金額</span><strong>${moneyAmount(snapshot.outstandingPersonal)}</strong></div>
            <div><span>零用金</span><strong>${moneyAmount(snapshot.balance)}</strong><small>本月使用 ${moneyAmount(snapshot.monthSpent)}</small></div>
        </div>
        ${cashLoading ? '<div class="helper-cash-loading"><i class="ph ph-spinner-gap"></i> 正在核對館務帳務…</div>' : ''}
        <div class="helper-cash-buildings">
            ${snapshot.rows.map(row => `
                <div>
                    <span>${esc(row.buildingName)}</span>
                    <span>餘額 ${moneyAmount(row.balance)}<small>本月使用 ${moneyAmount(row.monthSpent)}</small></span>
                </div>
            `).join('') || '<p>目前沒有授權館別。</p>'}
        </div>
    `;
}

function rentRows() {
    return buildRentCollectionRows({
        invoices: mockData.invoices,
        reports: paymentReports,
        contracts: mockData.contracts,
        buildings: mockData.buildings,
        buildingIds: allowedBuildingIds()
    });
}

function rentStatusMeta(row) {
    if (row.status === 'overdue') return { label: '逾期未繳', icon: 'ph-warning-circle', cls: 'danger' };
    if (row.status === 'reported') return { label: '已回報・待核帳', icon: 'ph-hourglass-medium', cls: 'reported' };
    if (row.status === 'paid') return { label: '已入帳', icon: 'ph-check-circle', cls: 'paid' };
    if (row.status === 'due_soon') return { label: '即將到期', icon: 'ph-clock-countdown', cls: 'soon' };
    return { label: '待繳費', icon: 'ph-calendar-blank', cls: 'upcoming' };
}

function rentCollectionHtml() {
    const rows = rentRows();
    const counts = rentCollectionCounts(rows);
    const visible = rows.filter(row => {
        if (rentFilter === 'all') return true;
        if (rentFilter === 'need_payment') return ['overdue', 'due_soon', 'upcoming'].includes(row.status);
        return row.status === rentFilter;
    });
    const needCount = counts.overdue + counts.due_soon + counts.upcoming;

    return `
        <div class="helper-rent-head">
            <div><span class="helper-section-kicker"><i class="ph ph-wallet"></i> 收租進度</span><h2>誰要繳、繳多少、是否入帳</h2></div>
            <a href="#unsettled" class="helper-text-link">房租查帳 <i class="ph ph-arrow-right"></i></a>
        </div>
        <div class="helper-rent-summary">
            <button class="is-danger ${rentFilter === 'need_payment' ? 'active' : ''}" data-rent-filter="need_payment"><strong>${needCount}</strong><span>待繳費</span></button>
            <button class="is-warning ${rentFilter === 'reported' ? 'active' : ''}" data-rent-filter="reported"><strong>${counts.reported}</strong><span>待核帳</span></button>
            <button class="is-success ${rentFilter === 'paid' ? 'active' : ''}" data-rent-filter="paid"><strong>${counts.paid}</strong><span>本月已入帳</span></button>
            <button class="${rentFilter === 'all' ? 'active' : ''}" data-rent-filter="all"><strong>${rows.length}</strong><span>全部</span></button>
        </div>
        ${rentLoading ? '<div class="helper-rent-loading"><i class="ph ph-spinner-gap"></i> 正在整理收租進度…</div>' : `
        <div class="helper-rent-list">
            ${visible.map(row => {
                const status = rentStatusMeta(row);
                const reportAmount = Number(row.report?.amount) || 0;
                return `<article class="helper-rent-row is-${status.cls}">
                    <div class="helper-rent-person">
                        <span class="helper-rent-status"><i class="ph ${status.icon}"></i> ${status.label}</span>
                        <strong>${esc(row.tenant)}</strong>
                        <small>${esc(row.buildingName)} · ${esc(row.property)}${row.contractId ? ` · ${esc(row.contractId)}` : ''}</small>
                    </div>
                    <div class="helper-rent-date"><span>到期日</span><strong>${esc(row.dueDate || '未設定')}</strong></div>
                    <div class="helper-rent-money">
                        <span>最後應收</span><strong>${moneyAmount(row.due)}</strong>
                        ${row.paid > 0 ? `<small>已入帳 ${moneyAmount(row.paid)}</small>` : ''}
                    </div>
                    <div class="helper-rent-balance">
                        <span>${row.status === 'paid' ? '完成' : '尚待收'}</span><strong>${moneyAmount(row.remaining)}</strong>
                        ${row.status === 'reported' ? `<small>小幫手回報 ${moneyAmount(reportAmount)}</small>` : ''}
                    </div>
                    <div class="helper-rent-action">
                        ${['overdue', 'due_soon', 'upcoming'].includes(row.status)
                            ? `<button type="button" class="btn btn-primary" data-report-payment="${escapeAttr(row.id)}"><i class="ph ph-receipt"></i> 回報住客已繳</button>`
                            : row.status === 'reported'
                                ? '<span><i class="ph ph-hourglass-medium"></i> 等待管理員核帳</span>'
                                : `<span class="is-done"><i class="ph ph-check-circle"></i> ${esc(row.paidDate || '已完成')}</span>`}
                    </div>
                </article>`;
            }).join('') || `<div class="helper-rent-empty"><i class="ph ph-check-circle"></i><strong>${rentFilter === 'need_payment' ? '目前沒有待繳費項目' : '目前沒有符合的收款紀錄'}</strong></div>`}
        </div>`}
    `;
}

function calendarHtml() {
    const buildingIds = allowedBuildingIds();
    const events = buildStayEvents({
        contracts: mockData.contracts,
        properties: mockData.properties,
        buildingIds,
        monthKey: selectedMonth
    });
    const byDate = new Map();
    events.forEach(event => {
        const list = byDate.get(event.date) || [];
        list.push(event);
        byDate.set(event.date, list);
    });
    const cells = buildMonthCells(selectedMonth);
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = events.filter(event => event.date >= today).slice(0, 5);
    const compactDate = value => String(value || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2/$3');
    const compactPeriod = period => String(period || '').split(' ～ ').map(compactDate).join('–');

    const eventHtml = event => {
        const isIn = event.type === 'checkin';
        const building = mockData.buildings.find(b => b.id === event.buildingId)?.name || '';
        const periods = event.leasePeriods || [];
        const periodText = periods.join('、');
        return `<a href="#occupancy" class="helper-calendar-event is-${event.type}" title="${escapeAttr(`${isIn ? '入住' : '退房'} ${event.tenant} · ${building} ${event.beds.join('、')} · 租約 ${periodText}`)}">
            <b>${isIn ? '入' : '退'}</b>
            <span class="helper-calendar-event-copy"><strong>${esc(event.tenant)}</strong><em>${esc(building)} · ${esc(event.beds.join('、'))}</em></span>
            <small><i class="ph ph-calendar-blank"></i> ${esc(periods.map(compactPeriod).join('、'))}</small>
        </a>`;
    };

    return `
        <div class="helper-calendar-head">
            <div>
                <span class="helper-section-kicker"><i class="ph ph-calendar-dots"></i> 住客行程</span>
                <h2>${esc(monthLabel(selectedMonth))}</h2>
            </div>
            <div class="helper-calendar-nav" aria-label="切換月份">
                <button type="button" data-calendar-shift="-1" aria-label="上個月"><i class="ph ph-caret-left"></i></button>
                <button type="button" data-calendar-today>本月</button>
                <button type="button" data-calendar-shift="1" aria-label="下個月"><i class="ph ph-caret-right"></i></button>
            </div>
        </div>
        <div class="helper-calendar-legend"><span><i class="is-checkin"></i>入住</span><span><i class="is-checkout"></i>退房</span><a href="#occupancy">開啟住房一覽</a></div>
        <div class="helper-calendar-scroll">
            <div class="helper-calendar-grid">
                ${['日','一','二','三','四','五','六'].map(day => `<div class="helper-calendar-weekday">${day}</div>`).join('')}
                ${cells.map(date => date ? `
                    <div class="helper-calendar-day ${date === today ? 'is-today' : ''}">
                        <time datetime="${date}">${Number(date.slice(-2))}</time>
                        <div>${(byDate.get(date) || []).map(eventHtml).join('')}</div>
                    </div>` : '<div class="helper-calendar-day is-empty"></div>').join('')}
            </div>
        </div>
        <div class="helper-upcoming">
            <strong>接下來的行程</strong>
            ${upcoming.length ? upcoming.map(event => `
                <a href="#occupancy">
                    <time>${event.date.slice(5).replace('-', '/')}</time>
                    <b class="is-${event.type}">${event.type === 'checkin' ? '入住' : '退房'}</b>
                    <span class="helper-upcoming-copy">
                        <strong>${esc(event.tenant)} · ${esc(event.beds.join('、'))}</strong>
                        <small><i class="ph ph-calendar-blank"></i> 租約 ${esc((event.leasePeriods || []).join('、'))}</small>
                    </span>
                </a>
            `).join('') : '<p>本月目前沒有待辦的入住或退房。</p>'}
        </div>
    `;
}

export function renderHelperDashboard() {
    const name = document.querySelector('.user-profile .user-name')?.textContent?.trim() || '小幫手';
    return `
        <div class="helper-home">
            <section class="helper-home-hero">
                <div>
                    <span class="helper-home-shift"><i class="ph ph-sun-horizon"></i> 今日值班台</span>
                    <h1>${esc(name)}，早安</h1>
                    <p>記錄館務花費、核對零用金，並掌握最近的入住與退房。</p>
                </div>
                <div class="helper-home-date"><b>${new Date().getDate()}</b><span>${new Intl.DateTimeFormat('zh-TW', { month: 'long', weekday: 'short' }).format(new Date())}</span></div>
            </section>

            <section class="helper-home-actions" aria-labelledby="helper-quick-title">
                <div class="helper-home-section-head"><div><span>常用作業</span><h2 id="helper-quick-title">快速新增記帳</h2></div><small>選擇用途後直接帶入報帳單</small></div>
                <div class="helper-home-quick-grid">${quickActionsHtml()}</div>
            </section>

            <div class="helper-home-workspace">
                <section class="helper-cash-card" data-helper-cash>${cashHtml()}</section>
                <section class="helper-calendar-card" data-helper-calendar>${calendarHtml()}</section>
            </div>
            <section class="helper-rent-card" data-helper-rent>${rentCollectionHtml()}</section>
        </div>`;
}

async function uploadPaymentProof(file) {
    if (!file) return null;
    if (!helperSession?.user?.id) throw new Error('登入狀態已過期，請重新登入後再試');
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    if (!allowed.has(file.type)) throw new Error('付款證明只支援 JPG、PNG、WebP 或 PDF');
    if (file.size > 10 * 1024 * 1024) throw new Error('付款證明不能超過 10 MB');
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const key = `${helperSession.user.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('rent-payment-proofs').upload(key, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(`付款證明上傳失敗：${error.message}`);
    return { path: key, name: file.name, mime: file.type };
}

function openPaymentReportForm(invoiceId, scope) {
    const row = rentRows().find(item => item.id === invoiceId);
    if (!row || row.remaining <= 0) return;
    let proofFile = null;
    openFormModal({
        title: `回報住客已繳 · ${row.tenant}`,
        maxWidth: 560,
        fields: [
            { name: 'invoiceSummary', type: 'placeholder', span: 2 },
            { name: 'amount', label: '本次住客繳費金額', type: 'number', required: true, span: 2, value: row.remaining },
            { name: 'paymentDate', label: '繳費日期', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
            { name: 'paymentMethod', label: '付款方式', type: 'select', required: true, options: [
                { value: 'transfer', label: '匯款' }, { value: 'cash_deposit', label: '無摺存款' }, { value: 'other', label: '其他' }
            ], value: 'transfer' },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 2, placeholder: '例：住客已將匯款畫面傳給我' },
            { name: 'proofUpload', type: 'placeholder', span: 2 }
        ],
        submitLabel: '回報已繳・等待核帳',
        onFormMount: form => {
            enhanceAmountInput(form, { readbackLabel: '本次回報金額' });
            const summary = form.querySelector('#ph-invoiceSummary');
            if (summary) summary.innerHTML = `<div class="helper-report-summary"><span>${esc(row.buildingName)} · ${esc(row.property)}</span><strong>尚待收 ${moneyAmount(row.remaining)}</strong><small>${esc(row.id)} · 到期 ${esc(row.dueDate || '未設定')}</small></div>`;
            const ph = form.querySelector('#ph-proofUpload');
            if (!ph) return;
            ph.innerHTML = `<label class="expense-upload" for="rent-proof-input"><input id="rent-proof-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden><span class="expense-upload-icon"><i class="ph ph-camera-plus"></i></span><span><strong>付款或存款證明（選填）</strong><small>可上傳住客匯款畫面或無摺存款單，檔案上限 10 MB。</small></span><span class="expense-upload-state">選擇檔案</span></label>`;
            const input = ph.querySelector('input');
            input.addEventListener('change', () => {
                proofFile = input.files?.[0] || null;
                ph.querySelector('.expense-upload-state').textContent = proofFile ? proofFile.name : '選擇檔案';
                ph.querySelector('.expense-upload')?.classList.toggle('has-file', !!proofFile);
            });
        },
        onSubmit: async values => {
            const amount = Math.round(Number(values.amount) || 0);
            if (amount <= 0 || amount > row.remaining) {
                showToast(`本次回報金額需介於 1～${row.remaining.toLocaleString()} 元`, 'warning', 5000);
                return false;
            }
            let uploaded = null;
            try {
                uploaded = await uploadPaymentProof(proofFile);
                const { error } = await supabase.from('rent_payment_reports').insert({
                    invoice_id: row.id,
                    building_id: row.buildingId,
                    amount,
                    payment_date: values.paymentDate,
                    payment_method: values.paymentMethod,
                    note: values.note || null,
                    evidence_path: uploaded?.path || null,
                    evidence_name: uploaded?.name || null,
                    evidence_mime: uploaded?.mime || null
                });
                if (error) throw new Error(error.message);
                showToast('已回報住客繳費，等待管理員核帳', 'success', 4500);
                await loadPaymentReports(scope);
            } catch (error) {
                if (uploaded?.path) await supabase.storage.from('rent-payment-proofs').remove([uploaded.path]);
                showToast(`回報失敗：${error.message}`, 'danger', 7000);
                return false;
            }
        }
    });
}

function bindRentCollection(scope) {
    scope.querySelectorAll('[data-rent-filter]').forEach(button => button.addEventListener('click', () => {
        rentFilter = button.dataset.rentFilter;
        const card = scope.querySelector('[data-helper-rent]');
        if (card) card.innerHTML = rentCollectionHtml();
        bindRentCollection(scope);
    }));
    scope.querySelectorAll('[data-report-payment]').forEach(button => button.addEventListener('click', () => openPaymentReportForm(button.dataset.reportPayment, scope)));
}

async function loadPaymentReports(scope) {
    const { data, error } = await supabase.from('rent_payment_reports').select('*').order('submitted_at', { ascending: false });
    if (!error) {
        paymentReports = (data || []).map(row => ({
            id: row.id, invoiceId: row.invoice_id, buildingId: row.building_id, amount: Number(row.amount) || 0,
            paymentDate: row.payment_date, paymentMethod: row.payment_method, note: row.note || '', status: row.status,
            evidencePath: row.evidence_path || '', submittedAt: row.submitted_at
        }));
    }
    rentLoading = false;
    const card = scope.querySelector('[data-helper-rent]');
    if (card) card.innerHTML = rentCollectionHtml();
    bindRentCollection(scope);
}

function bindCalendar(scope) {
    scope.querySelectorAll('[data-calendar-shift]').forEach(button => button.addEventListener('click', () => {
        selectedMonth = shiftMonth(selectedMonth, Number(button.dataset.calendarShift));
        scope.querySelector('[data-helper-calendar]').innerHTML = calendarHtml();
        bindCalendar(scope);
    }));
    scope.querySelector('[data-calendar-today]')?.addEventListener('click', () => {
        selectedMonth = CURRENT_MONTH;
        scope.querySelector('[data-helper-calendar]').innerHTML = calendarHtml();
        bindCalendar(scope);
    });
}

export async function initHelperDashboardActions(scope) {
    helperSession = await getSession();
    scope.querySelectorAll('[data-helper-expense]').forEach(button => button.addEventListener('click', () => {
        if (button.disabled) {
            showToast('這個帳號尚未開放館務報帳權限', 'warning');
            return;
        }
        queueExpensePrefill({ type: button.dataset.entryType, category: button.dataset.category, funding: button.dataset.funding });
        window.location.hash = 'expenses';
    }));
    bindCalendar(scope);
    bindRentCollection(scope);

    const { data, error } = await supabase
        .from('expense_claims')
        .select('building_id,expense_date,category,funding_source,amount,status');
    if (!error) {
        accountingClaims = (data || []).map(row => ({
            buildingId: row.building_id,
            expenseDate: row.expense_date,
            category: row.category,
            fundingSource: row.funding_source,
            amount: Number(row.amount) || 0,
            status: row.status
        }));
    }
    cashLoading = false;
    const cash = scope.querySelector('[data-helper-cash]');
    if (cash) cash.innerHTML = cashHtml();
    await loadPaymentReports(scope);
    if (!paymentReportChannel) {
        paymentReportChannel = supabase.channel('helper-rent-payment-reports')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rent_payment_reports' }, () => {
                const activeScope = document.querySelector('.view-section.active');
                if (activeScope?.querySelector('[data-helper-rent]')) loadPaymentReports(activeScope);
            })
            .subscribe();
    }
}
