import { supabase } from '../supabase.js';
import { mockData } from '../data.js';
import { currentModeBuildingIdSet } from '../utils/modeFilter.js';
import { buildMonthCells, buildPettyCashSnapshot, buildStayEvents } from '../utils/helperDashboardData.js';
import { queueExpensePrefill } from '../utils/expensePrefill.js';
import { escapeHtml as esc, escapeAttr } from '../utils/escape.js';
import { moneyAmount } from '../utils/moneyDisplay.js';
import { showToast } from '../utils/ui.js';

const QUICK_ACTIONS = [
    { category: 'daily_supplies', funding: 'company', label: '日用品', hint: '紙品、燈泡、館內補給', icon: 'ph-shopping-bag-open', tone: 'amber' },
    { category: 'cleaning_supplies', funding: 'company', label: '清潔用品', hint: '清潔劑、垃圾袋、耗材', icon: 'ph-sparkle', tone: 'aqua' },
    { category: 'other', funding: 'petty_cash', label: '零用金支出', hint: '從館別零用金支付', icon: 'ph-coins', tone: 'blue' },
    { category: 'other', funding: 'personal', label: '個人代墊報帳', hint: '送審後等待核准撥款', icon: 'ph-hand-coins', tone: 'coral' }
];

const CURRENT_MONTH = new Date().toISOString().slice(0, 7);
let selectedMonth = CURRENT_MONTH;
let pendingClaims = [];
let cashLoading = true;

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
                data-category="${escapeAttr(action.category)}" data-funding="${escapeAttr(action.funding)}"
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
        invoices: mockData.invoices,
        pendingClaims,
        buildingIds,
        monthKey: CURRENT_MONTH
    });
    const hasBudget = snapshot.budget > 0;
    const usage = hasBudget ? Math.min(100, Math.max(0, (snapshot.spent / snapshot.budget) * 100)) : 0;
    const remainingClass = snapshot.remaining < 0 ? 'is-over' : '';

    return `
        <div class="helper-cash-head">
            <div>
                <span class="helper-section-kicker"><i class="ph ph-coins"></i> ${esc(monthLabel(CURRENT_MONTH))}</span>
                <h2>零用金</h2>
            </div>
            <a href="#expenses" class="helper-text-link">查看紀錄 <i class="ph ph-arrow-right"></i></a>
        </div>
        <div class="helper-cash-balance ${remainingClass}">
            <span>${hasBudget ? '目前餘額' : '目前支出'}</span>
            <strong>${moneyAmount(hasBudget ? snapshot.remaining : snapshot.spent)}</strong>
            <small>${hasBudget ? `本月額度 ${moneyAmount(snapshot.budget)}` : '尚未設定本月額度'}</small>
        </div>
        <div class="helper-cash-progress" aria-label="${hasBudget ? `已使用 ${Math.round(usage)}%` : '尚未設定額度'}">
            <span style="width:${usage}%"></span>
        </div>
        <div class="helper-cash-ledger">
            <div><span>已核准入帳</span><strong>${moneyAmount(snapshot.approved)}</strong></div>
            <div><span>我的待審</span><strong>${moneyAmount(snapshot.pending)}</strong></div>
            <div><span>目前支出</span><strong>${moneyAmount(snapshot.spent)}</strong></div>
        </div>
        ${cashLoading ? '<div class="helper-cash-loading"><i class="ph ph-spinner-gap"></i> 正在核對待審紀錄…</div>' : ''}
        <div class="helper-cash-buildings">
            ${snapshot.rows.map(row => `
                <div>
                    <span>${esc(row.buildingName)}</span>
                    <span>已用 ${moneyAmount(row.spent)}${row.pending ? ` <small>含待審 ${moneyAmount(row.pending)}</small>` : ''}</span>
                </div>
            `).join('') || '<p>目前沒有授權館別。</p>'}
        </div>
        ${hasBudget ? '' : '<p class="helper-cash-note"><i class="ph ph-info"></i> 管理員可在「房屋資料 → 租金」設定各館每月零用金額度。</p>'}
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

    const eventHtml = event => {
        const isIn = event.type === 'checkin';
        const building = mockData.buildings.find(b => b.id === event.buildingId)?.name || '';
        return `<a href="#occupancy" class="helper-calendar-event is-${event.type}" title="${escapeAttr(`${isIn ? '入住' : '退房'} ${event.tenant} · ${event.beds.join('、')}`)}">
            <b>${isIn ? '入' : '退'}</b><span>${esc(event.tenant)}</span><small>${esc(building)}</small>
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
                <a href="#occupancy"><time>${event.date.slice(5).replace('-', '/')}</time><b class="is-${event.type}">${event.type === 'checkin' ? '入住' : '退房'}</b><span>${esc(event.tenant)} · ${esc(event.beds.join('、'))}</span></a>
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
        </div>`;
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
    scope.querySelectorAll('[data-helper-expense]').forEach(button => button.addEventListener('click', () => {
        if (button.disabled) {
            showToast('這個帳號尚未開放館務報帳權限', 'warning');
            return;
        }
        queueExpensePrefill({ category: button.dataset.category, funding: button.dataset.funding });
        window.location.hash = 'expenses';
    }));
    bindCalendar(scope);

    const start = `${CURRENT_MONTH}-01`;
    const [year, month] = CURRENT_MONTH.split('-').map(Number);
    const end = new Date(year, month, 0).toISOString().slice(0, 10);
    const { data, error } = await supabase
        .from('expense_claims')
        .select('building_id,expense_date,funding_source,amount,status')
        .gte('expense_date', start)
        .lte('expense_date', end)
        .eq('funding_source', 'petty_cash');
    if (!error) {
        pendingClaims = (data || []).map(row => ({
            buildingId: row.building_id,
            expenseDate: row.expense_date,
            fundingSource: row.funding_source,
            amount: Number(row.amount) || 0,
            status: row.status
        }));
    }
    cashLoading = false;
    const cash = scope.querySelector('[data-helper-cash]');
    if (cash) cash.innerHTML = cashHtml();
}
