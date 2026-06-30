import { mockData, monthlyChartData, invoiceMonth, lastNMonths, getContractLifecycle, daysUntilExpiry, isUnsettled, currentMonth, getSortedBuildings, bedOccupied, isPreCutoff } from '../data.js';
import { emptyState } from '../utils/emptyState.js';
import { moneyAmount } from '../utils/moneyDisplay.js';
import { getChartColors } from '../utils/chartTheme.js';
import { modeFilteredData } from '../utils/modeFilter.js';
import { getMode } from '../utils/appMode.js';

// 提取館別名稱（例如：聚空間 - 松山館 R1-A → 松山館）
function extractAreaName(fullName) {
    const match = fullName.match(/聚空間 - ([^\s]+)\s/);
    return match ? match[1] : fullName;
}

// 統計各館空床狀況（含性別分布）
// 回傳順序跟系統設定的館別順序一致（getSortedBuildings）— 只列當前 mode 的 buildings
function buildEmptyBedsByProperty(properties, mode = getMode()) {
    const targetMode = mode === 'managed' ? 'managed' : 'cohousing';
    const sortedBuildings = getSortedBuildings({ activeOnly: true })
        .filter(b => (b.mode || 'cohousing') === targetMode);
    const propertiesByArea = {};
    // 先按設定順序預建 key，確保之後 Object.keys 順序對
    sortedBuildings.forEach(b => {
        propertiesByArea[b.name] = {
            total: 0,
            active: 0,    // 居住中 (合約期內 + startDate<=today<=endDate)
            snoozed: 0,   // 暫緩 (有合約但未到入住日 或 過期未決策)
            vacant: 0,    // 空床 (完全無 active/snoozed 合約)
            vacantByGender: { '男': 0, '女': 0, '不限': 0 }
        };
    });

    // 反查 buildingId → name (避免靠床位名 regex)
    const buildingNameById = new Map(sortedBuildings.map(b => [b.id, b.name]));
    const todayStr = new Date().toISOString().slice(0, 10);
    // 3-state semantics 對齊住房一覽:
    //   active (居住):  有 active/snoozed 合約 + startDate <= today <= endDate
    //   snoozed (暫緩): 有合約但 startDate 未到 OR endDate 已過 (待決策 / 待入住)
    //   vacant (空床):  完全無 active/snoozed 合約
    const bedState = (propName) => {
        const cs = mockData.contracts.filter(c =>
            c.propertyName === propName &&
            (c.renewalState === 'active' || c.renewalState === 'snoozed')
        );
        if (cs.length === 0) return 'vacant';
        const hasCurrent = cs.some(c =>
            c.startDate && c.endDate &&
            c.startDate <= todayStr && c.endDate >= todayStr
        );
        return hasCurrent ? 'active' : 'snoozed';
    };
    properties.forEach(prop => {
        const areaName = buildingNameById.get(prop.buildingId);
        if (!areaName || !propertiesByArea[areaName]) return;
        const area = propertiesByArea[areaName];
        area.total++;
        const s = bedState(prop.name);
        if (s === 'active') area.active++;
        else if (s === 'snoozed') area.snoozed++;
        else {
            area.vacant++;
            const g = prop.gender || '不限';
            if (area.vacantByGender[g] !== undefined) area.vacantByGender[g]++;
            else area.vacantByGender['不限']++;
        }
    });

    return propertiesByArea;
}

// 構建合約類待辦：優先顯示「待決策」/ 「已過期」，其次「即將到期」/ 「待簽署」
function buildContractTodos(contracts) {
    const today = new Date();
    const items = contracts
        .map(c => ({ c, state: getContractLifecycle(c, today), days: daysUntilExpiry(c, today) }))
        .filter(({ c, state }) => state === 'awaiting_decision' || state === 'expired' || state === 'expiring_soon' || c.status === '待簽署')
        .sort((a, b) => {
            const pri = { expired: 0, awaiting_decision: 1, expiring_soon: 2 };
            return (pri[a.state] ?? 3) - (pri[b.state] ?? 3);
        })
        .slice(0, 3);

    return items.map(({ c, state, days }) => {
        let label, status;
        if (state === 'expired')           { label = `已過期 ${-days} 天`; status = 'danger'; }
        else if (state === 'awaiting_decision') { label = `${days} 天內到期`; status = 'danger'; }
        else if (state === 'expiring_soon')     { label = `${days} 天後到期`; status = 'warning'; }
        else                                    { label = '待簽署';          status = 'warning'; }

        return {
            status,
            label,
            text: `${extractAreaName(c.propertyName)} / ${c.tenant}`,
            action: state === 'expired' || state === 'awaiting_decision' ? '決策' : '查看',
            entityType: 'contract',
            entityId: c.id
        };
    });
}

// 構建帳款類待辦（待結帳款：應收欠繳 + 應付未付）
function buildFinanceTodos(invoices) {
    return invoices
        .filter(inv => inv.status === '欠繳' || inv.status === '未付')
        .slice(0, 3)
        .map(inv => {
            const isIn = inv.direction === 'in';
            const sign = isIn ? '' : '-';
            const area = extractAreaName(inv.propertyName || '');
            // 收入 (in): 顯示「館別 / 租客 / 類別」; 支出 (out): 顯示「館別 / 合約ID 或 整館 / 類別」
            const target = isIn
                ? `${area}${inv.tenant ? ` / ${inv.tenant}` : ''}`
                : `${area}${inv.contractId ? ` / ${inv.contractId}` : (inv.propertyName ? '' : ' / 整館')}`;
            return {
                status: 'danger',
                label: isIn ? '欠繳' : '未付',
                text: `${target} / ${inv.type} ${sign}$${(inv.amount ?? 0).toLocaleString()}`,
                action: '查看',
                entityType: 'invoice',
                entityId: inv.id
            };
        });
}

// 構建維修類待辦
function buildMaintenanceTodos(maintenances) {
    return maintenances
        .filter(m => m.status !== '已完成')
        .slice(0, 3)
        .map(m => ({
            status: m.status === '待處理' ? 'danger' : 'warning',
            label: m.status === '待處理' ? '待處理' : '進行中',
            text: `${extractAreaName(m.propertyName)} / ${m.issue}`,
            action: '派工',
            entityType: 'maintenance',
            entityId: m.id
        }));
}

export function renderDashboard() {
    // 依當前 mode (共居/代管) 篩出對應 buildings 的子集
    const mode = getMode();
    const filtered = modeFilteredData(mode);
    const { properties, contracts, maintenances, invoices } = filtered;
    // 即時計算 metrics — 不再讀 mockData.metrics (避免清資料後快取殘留)
    const actualAmt = (i) => i.paidAmount != null && i.paidAmount > 0 ? i.paidAmount : (i.amount || 0);
    const thisMonthStr = new Date().toISOString().slice(0, 7);
    const metrics = {
        totalProperties: properties.length,
        rentedProperties: properties.filter(p => bedOccupied(p.name)).length,
        pendingContracts: contracts.filter(c => c.status === '待簽署' && c.renewalState === 'active').length,
        pendingMaintenances: maintenances.filter(m => m.status !== '已完成').length,
        monthlyIncome: invoices
            .filter(i => !isPreCutoff(i))  // 起算自 FINANCE_CUTOFF_DATE 之前的不算
            .filter(i => i.direction === 'in' && (i.paidDate || i.dueDate || '').startsWith(thisMonthStr))
            .reduce((s, i) => s + actualAmt(i), 0)
    };
    const emptyBedsByProperty = buildEmptyBedsByProperty(properties);
    // 維持系統設定的館別順序（不再 .sort() 改成字典序）
    const propertyNames = Object.keys(emptyBedsByProperty);
    const firstProperty = propertyNames[0];
    
    const contractTodos = buildContractTodos(contracts);
    const financeTodos = buildFinanceTodos(invoices);
    const maintenanceTodos = buildMaintenanceTodos(maintenances);
    
    const selectedPropertyData = emptyBedsByProperty[firstProperty] || { total: 0, active: 0, snoozed: 0, vacant: 0, vacantByGender: { '男': 0, '女': 0, '不限': 0 } };

    // === 15 號查帳橫條 ===
    const today = new Date();
    const day = today.getDate();
    const thisMonth = currentMonth();
    const monthUnsettled = invoices.filter(inv => isUnsettled(inv) && (inv.dueDate || '').startsWith(thisMonth));
    const monthAwaitVerify = monthUnsettled.filter(inv => inv.bankLast5 && !inv.bankVerified).length;
    const monthUnsettledIn = monthUnsettled.filter(i => i.direction === 'in').length;

    let checkBanner = '';
    if (monthUnsettled.length > 0) {
        if (day === 15) {
            checkBanner = `
                <div class="check-banner urgent">
                    <div class="check-banner-icon"><i class="ph-fill ph-calendar-check"></i></div>
                    <div class="check-banner-body">
                        <strong>📅 今天是 ${day} 號查帳日！</strong>
                        <span>本月共 <strong>${monthUnsettled.length}</strong> 筆待結${monthAwaitVerify > 0 ? `，其中 <strong style="color: var(--color-warning);">${monthAwaitVerify}</strong> 筆已回報末 5 碼待核對` : ''}</span>
                    </div>
                    <a href="#unsettled" class="btn btn-primary">前往查帳 →</a>
                </div>`;
        } else if (day >= 13 && day <= 17) {
            const diff = 15 - day;
            const text = diff > 0 ? `${diff} 天後是查帳日` : `查帳日已過 ${-diff} 天`;
            checkBanner = `
                <div class="check-banner soft">
                    <div class="check-banner-icon"><i class="ph ph-calendar"></i></div>
                    <div class="check-banner-body">
                        <strong>${text}</strong>
                        <span>本月待結 ${monthUnsettled.length} 筆${monthAwaitVerify > 0 ? `（${monthAwaitVerify} 筆待核對）` : ''}</span>
                    </div>
                    <a href="#unsettled" class="btn btn-outline">前往房租查帳</a>
                </div>`;
        } else if (monthAwaitVerify > 0) {
            checkBanner = `
                <div class="check-banner soft">
                    <div class="check-banner-icon"><i class="ph ph-shield-warning"></i></div>
                    <div class="check-banner-body">
                        <strong>${monthAwaitVerify} 筆待核對</strong>
                        <span>客戶已回報末 5 碼，請至房租查帳頁核對結帳</span>
                    </div>
                    <a href="#unsettled" class="btn btn-outline">立即處理</a>
                </div>`;
        }
    }

    // helper 不看「本月租金收入」(沒有總收支權限)
    const isHelper = window.__currentRole === 'helper';
    return `
        ${checkBanner}
        <div class="metrics-grid${isHelper ? ' metrics-grid--3col' : ''}">
            <a href="${isHelper ? '#occupancy' : '#properties'}" class="card metric-card metric-link" title="點擊前往${isHelper ? '房況一覽' : '物件管理'}">
                <div class="metric-header">
                    <span>物件已租 / 總數</span>
                    <div class="metric-icon primary">
                        <i class="ph ph-buildings"></i>
                    </div>
                </div>
                <div class="metric-value">${metrics.rentedProperties} / ${metrics.totalProperties}</div>
                <div class="metric-subtext">整體出租率 ${metrics.totalProperties > 0 ? Math.round((metrics.rentedProperties / metrics.totalProperties) * 100) : 0}%</div>
            </a>

            <a href="#contracts" class="card metric-card metric-link" title="點擊前往合約管理">
                <div class="metric-header">
                    <span>待簽約事項</span>
                    <div class="metric-icon warning">
                        <i class="ph ph-signature"></i>
                    </div>
                </div>
                <div class="metric-value">${metrics.pendingContracts}</div>
                <div class="metric-subtext">${metrics.pendingContracts === 0 ? '本月合約都已簽署' : '請盡速完成簽署流程'}</div>
            </a>

            <a href="#maintenance" class="card metric-card metric-link" title="點擊前往維修管理">
                <div class="metric-header">
                    <span>待處理維修</span>
                    <div class="metric-icon danger">
                        <i class="ph ph-wrench"></i>
                    </div>
                </div>
                <div class="metric-value">${metrics.pendingMaintenances}</div>
                <div class="metric-subtext">${metrics.pendingMaintenances === 0 ? '目前無待處理報修' : '追蹤租客報修進度'}</div>
            </a>

            ${isHelper ? '' : `<a href="#finance" class="card metric-card metric-link" title="點擊前往總收支表">
                <div class="metric-header">
                    <span>本月租金收入</span>
                    <div class="metric-icon success">
                        <i class="ph ph-currency-circle-dollar"></i>
                    </div>
                </div>
                <div class="metric-value">${moneyAmount(metrics.monthlyIncome, { sign: 'in' })}</div>
                <div class="metric-subtext">${metrics.monthlyIncome === 0 ? '尚無本月入帳' : '本月已入帳房租'}</div>
            </a>`}
        </div>

        ${(() => {
            // === 共用 card template ===
            const todoCardHtml = (icon, title, todos, emptyMsg) => `
                <div class="card">
                    <h2 class="card-title"><i class="ph ${icon}"></i> ${title}</h2>
                    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                        ${todos.length > 0 ? todos.map(item => `
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border-color);">
                                <div style="flex: 1; min-width: 0;">
                                    <div style="margin-bottom: 0.25rem;">
                                        <span class="status-badge ${item.status}" style="white-space: nowrap;">${item.label}</span>
                                    </div>
                                    <div style="font-size: var(--text-xs); color: var(--text-main); word-break: break-word; overflow-wrap: break-word;">${item.text}</div>
                                </div>
                                <button class="btn btn-outline todo-action" style="padding: 0.3rem 0.6rem; font-size: var(--text-2xs); white-space: nowrap; flex-shrink: 0; cursor: pointer;" data-entity-type="${item.entityType}" data-entity-id="${item.entityId}">${item.action}</button>
                            </div>
                        `).join('') : emptyState({ icon: emptyMsg.icon, title: emptyMsg.title, hint: emptyMsg.hint })}
                    </div>
                </div>
            `;

            const vacancyCardHtml = `
                <div class="card">
                    <div style="margin-bottom: 1rem;">
                        <h3 style="font-size: var(--text-md); font-weight: 600; margin-bottom: 0.75rem; white-space: nowrap;">各館空床狀態</h3>
                        <div id="property-selector" style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                            ${propertyNames.map((name, idx) => `
                                <button class="property-filter-btn ${idx === 0 ? 'active' : ''}" data-property="${name}">
                                    ${name}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    <div id="empty-beds-display">
                        <div style="position: relative; height: 200px; margin: 0.5rem 0;">
                            <canvas id="emptyBedsChart"></canvas>
                            <div id="empty-beds-center" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; pointer-events: none;">
                                <div style="font-size: 1.75rem; font-weight: 700; color: var(--color-primary); line-height: 1;">${selectedPropertyData.vacant}</div>
                                <div style="font-size: var(--text-2xs); color: var(--text-muted); margin-top: 0.25rem;">空床 / 共 ${selectedPropertyData.total}</div>
                            </div>
                        </div>
                        <div id="empty-beds-legend" style="text-align: center; font-size: var(--text-xs); color: var(--text-muted); margin-top: 0.5rem;">
                            居住 <strong style="color: var(--color-success);">${selectedPropertyData.active}</strong> ·
                            ${selectedPropertyData.snoozed > 0 ? `暫緩 <strong style="color: var(--color-warning);">${selectedPropertyData.snoozed}</strong> · ` : ''}空床 <strong style="color: var(--color-primary);">${selectedPropertyData.vacant}</strong>
                        </div>
                        <div id="empty-beds-gender" style="display: flex; justify-content: center; gap: 0.5rem; margin-top: 0.75rem; flex-wrap: wrap; padding-top: 0.75rem; border-top: 1px dashed var(--border-color);">
                            <div class="gender-chip male"><i class="ph-fill ph-person-simple"></i> 男 <strong>${selectedPropertyData.vacantByGender['男']}</strong></div>
                            <div class="gender-chip female"><i class="ph-fill ph-person-simple"></i> 女 <strong>${selectedPropertyData.vacantByGender['女']}</strong></div>
                            <div class="gender-chip mixed"><i class="ph-fill ph-users"></i> 不限 <strong>${selectedPropertyData.vacantByGender['不限']}</strong></div>
                        </div>
                    </div>
                </div>
            `;

            const contractTodoHtml = todoCardHtml('ph-file-text', '合約事項', contractTodos, { icon: 'ph-check-circle', title: '本月合約都安全', hint: '沒有即將到期 / 待簽 / 需決策的合約' });
            const financeTodoHtml = todoCardHtml('ph-wallet', '帳款事項', financeTodos, { icon: 'ph-coffee', title: '所有帳款都清光了', hint: '沒有待繳款或未對帳的項目' });
            const maintTodoHtml = todoCardHtml('ph-wrench', '維修事項', maintenanceTodos, { icon: 'ph-confetti', title: '沒有未處理的維修', hint: '所有報修都已完成或進行中' });

            if (isHelper) {
                // helper 版: 第二列 = 帳款事項 / 維修事項 / 各館空床 (3-col)
                //           不顯示收支圖表 + 合約事項
                return `
                    <div class="dashboard-grid dashboard-grid--3col">
                        ${financeTodoHtml}
                        ${maintTodoHtml}
                        ${vacancyCardHtml}
                    </div>
                `;
            }

            // admin / owner 版: 維持原樣 (收支圖表 + 各館空床 + 3 個 todo)
            return `
                <div class="dashboard-grid">
                    <div class="card chart-card">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                            <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-chart-line-up"></i> 近半年收支概況</h2>
                            <div class="chart-mode-toggle" role="group" aria-label="圖表模式">
                                <button type="button" class="chart-mode-btn active" data-chart-mode="total">總和</button>
                                <button type="button" class="chart-mode-btn" data-chart-mode="byBuilding">各館</button>
                            </div>
                        </div>
                        <div style="height: 300px; width: 100%;">
                            <canvas id="incomeChart"></canvas>
                        </div>
                    </div>
                    ${vacancyCardHtml}
                </div>
                <div class="todo-cards-grid">
                    ${contractTodoHtml}
                    ${financeTodoHtml}
                    ${maintTodoHtml}
                </div>
            `;
        })()}
    `;
}

// === 收支圖表（即時聚合 invoices）===
let incomeChartInstance = null;
let chartMode = 'total'; // 'total' | 'byBuilding'

// 各館分色 — 從 :root --chart-cat-1~8 讀，buildChartData() 直接用 getChartColors().cats

function aggregateInvoicesByMonth(months) {
    // 回傳 { income: [m1, m2, ...], expense: [...] }
    const income = months.map(() => 0);
    const expense = months.map(() => 0);
    const invoices = modeFilteredData().invoices;
    invoices.forEach(inv => {
        const m = invoiceMonth(inv);
        const idx = months.indexOf(m);
        if (idx < 0) return;
        if (inv.direction === 'in') income[idx] += inv.amount || 0;
        else if (inv.direction === 'out') expense[idx] += inv.amount || 0;
    });
    return { income, expense };
}

function aggregateNetByBuildingMonth(months, buildings) {
    // 回傳 { 'B001': [m1淨, m2淨, ...], ... }
    const result = {};
    buildings.forEach(b => { result[b.id] = months.map(() => 0); });
    const invoices = modeFilteredData().invoices;
    invoices.forEach(inv => {
        const m = invoiceMonth(inv);
        const idx = months.indexOf(m);
        if (idx < 0) return;
        if (!result[inv.buildingId]) return;
        const sign = inv.direction === 'in' ? 1 : -1;
        result[inv.buildingId][idx] += (inv.amount || 0) * sign;
    });
    return result;
}

function buildChartData() {
    const months = lastNMonths(6);
    const monthLabels = months.map(m => `${parseInt(m.substring(5), 10)}月`);
    // 依 mode 篩 buildings (代管 mode 圖表只顯代管房屋)
    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    const buildings = getSortedBuildings({ activeOnly: true })
        .filter(b => (b.mode || 'cohousing') === targetMode);
    const C = getChartColors();

    if (chartMode === 'total') {
        const { income, expense } = aggregateInvoicesByMonth(months);
        return {
            labels: monthLabels,
            datasets: [
                {
                    label: '收入',
                    data: income,
                    borderColor: C.income,
                    backgroundColor: C.fillIncome,
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true
                },
                {
                    label: '支出',
                    data: expense,
                    borderColor: C.expense,
                    backgroundColor: C.fillExpense,
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true
                }
            ]
        };
    }

    // byBuilding：每館一條淨收益線
    const netByBuilding = aggregateNetByBuildingMonth(months, buildings);
    const palette = C.cats;
    return {
        labels: monthLabels,
        datasets: buildings.map((b, i) => ({
            label: b.name,
            data: netByBuilding[b.id],
            borderColor: palette[i % palette.length],
            backgroundColor: 'transparent',
            borderWidth: 2,
            tension: 0.4,
            fill: false,
            pointRadius: 3
        }))
    };
}

window.initDashboardChart = function() {
    const ctx = document.getElementById('incomeChart');
    if (!ctx) return;

    // 切頁面回來時銷毀舊 instance
    if (incomeChartInstance) {
        try { incomeChartInstance.destroy(); } catch (e) {}
        incomeChartInstance = null;
    }

    incomeChartInstance = new Chart(ctx, {
        type: 'line',
        data: buildChartData(),
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 14, padding: 16 } },
                tooltip: {
                    callbacks: {
                        label: (item) => `${item.dataset.label}：$${item.parsed.y.toLocaleString()}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: chartMode === 'total',  // 各館淨收益可能有負值
                    grid: { color: 'rgba(0, 0, 0, 0.05)' },
                    ticks: {
                        callback: (v) => '$' + v.toLocaleString()
                    }
                },
                x: { grid: { display: false } }
            }
        }
    });

    // 模式切換按鈕
    document.querySelectorAll('[data-chart-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            chartMode = btn.dataset.chartMode;
            document.querySelectorAll('[data-chart-mode]').forEach(b => {
                b.classList.toggle('active', b === btn);
            });
            incomeChartInstance.data = buildChartData();
            incomeChartInstance.options.scales.y.beginAtZero = (chartMode === 'total');
            incomeChartInstance.update();
        });
    });
};

// 各館空床狀態：圓餅圖（doughnut）+ 中央數字 + 切換按鈕
let emptyBedsChart = null;

const VACANCY_PICK_KEY = 'pms-dashboard-vacancy-building';

window.initDashboardInteractions = function() {
    // 切換頁面回來時銷毀舊 chart instance（canvas 已被 re-render 替換）
    if (emptyBedsChart) {
        try { emptyBedsChart.destroy(); } catch (e) {}
        emptyBedsChart = null;
    }

    // 圖表也要依 mode 篩 (用 modeFilteredData 取代直接讀 mockData.properties)
    const emptyBedsByProperty = buildEmptyBedsByProperty(modeFilteredData().properties);
    const buttons = document.querySelectorAll('.property-filter-btn');
    // 還原上次選擇的館 (頁面切換回來也保留)
    const savedPick = localStorage.getItem(VACANCY_PICK_KEY);
    if (savedPick && emptyBedsByProperty[savedPick]) {
        buttons.forEach(b => {
            const isMatch = b.dataset.property === savedPick;
            b.classList.toggle('active', isMatch);
        });
    }
    const ctx = document.getElementById('emptyBedsChart');
    const centerEl = document.getElementById('empty-beds-center');
    const legendEl = document.getElementById('empty-beds-legend');
    if (!ctx) return;

    function applyData(propertyName) {
        const data = emptyBedsByProperty[propertyName] || { total: 0, active: 0, snoozed: 0, vacant: 0, vacantByGender: { '男': 0, '女': 0, '不限': 0 } };
        const g = data.vacantByGender || { '男': 0, '女': 0, '不限': 0 };

        if (emptyBedsChart) {
            // 強制重設 labels + backgroundColor (避免舊 cache 是 2 色版本還留著, 切館後只有 1 色)
            const Cnow = getChartColors();
            emptyBedsChart.data.labels = ['居住', '暫緩', '空床'];
            emptyBedsChart.data.datasets[0].data = [data.active, data.snoozed, data.vacant];
            emptyBedsChart.data.datasets[0].backgroundColor = [Cnow.income, Cnow.warning, Cnow.primary];
            emptyBedsChart.update();
        }
        if (centerEl) {
            centerEl.innerHTML = `
                <div style="font-size: 1.75rem; font-weight: 700; color: var(--color-primary); line-height: 1;">${data.vacant}</div>
                <div style="font-size: var(--text-2xs); color: var(--text-muted); margin-top: 0.25rem;">空床 / 共 ${data.total}</div>
            `;
        }
        if (legendEl) {
            legendEl.innerHTML = `
                居住 <strong style="color: var(--color-success);">${data.active}</strong> ·
                ${data.snoozed > 0 ? `暫緩 <strong style="color: var(--color-warning);">${data.snoozed}</strong> · ` : ''}空床 <strong style="color: var(--color-primary);">${data.vacant}</strong>
            `;
        }
        const genderEl = document.getElementById('empty-beds-gender');
        if (genderEl) {
            genderEl.innerHTML = `
                <div class="gender-chip male"><i class="ph-fill ph-person-simple"></i> 男 <strong>${g['男']}</strong></div>
                <div class="gender-chip female"><i class="ph-fill ph-person-simple"></i> 女 <strong>${g['女']}</strong></div>
                <div class="gender-chip mixed"><i class="ph-fill ph-users"></i> 不限 <strong>${g['不限']}</strong></div>
            `;
        }
    }

    // 初始化 doughnut chart — 先看有沒有 saved pick, 沒有就用第一個 button
    const activeBtn = document.querySelector('.property-filter-btn.active') || buttons[0];
    const firstName = activeBtn?.dataset.property;
    const firstData = firstName ? emptyBedsByProperty[firstName] : { total: 0, active: 0, snoozed: 0, vacant: 0 };

    // 居住 = success / 暫緩 = warning / 空床 = primary
    const C = getChartColors();
    emptyBedsChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['居住', '暫緩', '空床'],
            datasets: [{
                data: [firstData.active, firstData.snoozed, firstData.vacant],
                backgroundColor: [C.income, C.warning, C.primary],
                borderColor: C.surface,
                borderWidth: 2,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            animation: false,  // 關掉動畫避免「this._fn is not a function」race
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (item) => {
                            const total = item.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total ? Math.round(item.parsed / total * 100) : 0;
                            return `${item.label}: ${item.parsed} 張 (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    // 按鈕切換 (也存 localStorage, 切頁回來會還原)
    buttons.forEach(btn => {
        btn.addEventListener('click', function() {
            buttons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const pick = this.dataset.property;
            try { localStorage.setItem(VACANCY_PICK_KEY, pick); } catch {}
            applyData(pick);
        });
    });

    // 還原 saved pick 後同步 center/legend/gender 文字 (chart 已用 firstData init, 不需再 update)
    if (firstName && savedPick === firstName) {
        // 文字部份還是要刷 (HTML 預載的是 emptyBedsByProperty[firstProperty 第一個 key])
        if (centerEl) centerEl.innerHTML = `
            <div style="font-size: 1.75rem; font-weight: 700; color: var(--color-primary); line-height: 1;">${firstData.vacant}</div>
            <div style="font-size: var(--text-2xs); color: var(--text-muted); margin-top: 0.25rem;">空床 / 共 ${firstData.total}</div>
        `;
        if (legendEl) legendEl.innerHTML = `
            居住 <strong style="color: var(--color-success);">${firstData.active}</strong> ·
            ${firstData.snoozed > 0 ? `暫緩 <strong style="color: var(--color-warning);">${firstData.snoozed}</strong> · ` : ''}空床 <strong style="color: var(--color-primary);">${firstData.vacant}</strong>
        `;
        const genderEl = document.getElementById('empty-beds-gender');
        const g = firstData.vacantByGender || { '男': 0, '女': 0, '不限': 0 };
        if (genderEl) genderEl.innerHTML = `
            <div class="gender-chip male"><i class="ph-fill ph-person-simple"></i> 男 <strong>${g['男']}</strong></div>
            <div class="gender-chip female"><i class="ph-fill ph-person-simple"></i> 女 <strong>${g['女']}</strong></div>
            <div class="gender-chip mixed"><i class="ph-fill ph-users"></i> 不限 <strong>${g['不限']}</strong></div>
        `;
    }

    // UIUX #2: 待辦項目「決策 / 查看 / 派工」直接打開該筆 detail modal
    document.querySelectorAll('.todo-action').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.entityType;
            const id = btn.dataset.entityId;
            if (window.openEntity && type && id) window.openEntity(type, id);
        });
    });
};
