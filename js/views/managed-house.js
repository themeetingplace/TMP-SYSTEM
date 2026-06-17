// 代管房屋頁 — 4 tabs: 房屋資料 / 住房一覽 / 合約 / 費用計算
// route: #m-house/{buildingId}
// 共居房屋資料在「物件管理 → 房屋資料 tab」，這頁專屬代管 mode

import { mockData, store, bedOccupied, getOwnerById } from '../data.js';
import { openFormModal, openConfirm, showToast, refreshView } from '../utils/ui.js';
import { escapeHtml as esc } from '../utils/escape.js';
// 屋主資料現在 inline 在房屋表單，不再需要 showOwnerForm 入口

const STORAGE_TAB_KEY = 'pms-m-house-tab';
const VALID_TABS = ['data', 'occupancy', 'contracts', 'fee'];
const DEFAULT_TAB = 'data';

const TAB_LABELS = {
    data:      { label: '房屋資料', icon: 'ph-info' },
    occupancy: { label: '住房一覽', icon: 'ph-chart-bar' },
    contracts: { label: '合約',     icon: 'ph-file-text' },
    fee:       { label: '費用計算', icon: 'ph-receipt' }
};

const FEE_TYPE_OPTIONS = [
    { value: 'fixed',   label: '固定月費' },
    { value: 'percent', label: '抽成 %' },
    { value: 'tier',    label: '階梯' },
    { value: 'other',   label: '其他' }
];
const ENERGY_OPTIONS = [
    { value: 'owner',  label: '屋主全包' },
    { value: 'tenant', label: '房客分攤' },
    { value: 'mixed',  label: '混合 (依備註)' }
];
const TAX_OPTIONS = [
    { value: 'false', label: '未稅' },
    { value: 'true',  label: '含稅' }
];
const BOOL_OPTIONS = [
    { value: 'false', label: '否' },
    { value: 'true',  label: '是' }
];

let currentHouseId = null;

function getActiveTab() {
    try {
        const saved = localStorage.getItem(STORAGE_TAB_KEY);
        if (VALID_TABS.includes(saved)) return saved;
    } catch {}
    return DEFAULT_TAB;
}
function saveActiveTab(t) {
    try { localStorage.setItem(STORAGE_TAB_KEY, t); } catch {}
}

function getHouseIdFromHash() {
    const m = window.location.hash.match(/^#m-house\/([^?]+)/);
    return m ? decodeURIComponent(m[1]) : null;
}

function fieldRow(label, value, hint = '') {
    const valHtml = (value == null || value === '' || value === false)
        ? '<span style="color: var(--text-muted);">—</span>'
        : esc(String(value));
    return `
        <div class="houses-field-row">
            <div class="houses-field-label">${esc(label)}</div>
            <div class="houses-field-value">${valHtml}${hint ? `<span class="houses-field-hint">${esc(hint)}</span>` : ''}</div>
        </div>
    `;
}

function feeConfigDescriptor(building) {
    const t = building.feeType;
    const c = building.feeConfig || {};
    if (t === 'fixed')   return `固定月費 NT$ ${(c.amount || 0).toLocaleString()}`;
    if (t === 'percent') return `抽成 ${c.rate || 0}%`;
    if (t === 'tier') {
        const tiers = Array.isArray(c.tiers) ? c.tiers : [];
        return tiers.length
            ? '階梯：' + tiers.map(x => `${x.from || 0}~${x.to ?? '∞'} 抽 ${x.rate || 0}%`).join(' / ')
            : '階梯 (未設定)';
    }
    if (t === 'other')   return `其他：${c.note || '(未填說明)'}`;
    return '<span style="color: var(--text-muted);">未設定</span>';
}

// === 各 tab render ===

function renderDataTab(building) {
    const owner = building.ownerId ? getOwnerById(building.ownerId) : null;
    const ownerSection = owner
        ? `
            ${fieldRow('姓名', owner.name)}
            ${fieldRow('性別', owner.gender)}
            ${fieldRow('電話', owner.phone)}
            ${fieldRow('信箱', owner.email)}
            ${fieldRow('LINE ID', owner.lineId)}
            ${fieldRow('來源', owner.source)}
            ${fieldRow('狀態', owner.status === 'active' ? '合作中' : (owner.status === 'pending_review' ? '待審核' : '已封存'))}
            <div style="margin-top: 0.5rem;"><a href="#m-owners" class="btn btn-outline" style="padding: 0.3rem 0.7rem; font-size: var(--text-xs);"><i class="ph ph-arrow-right"></i> 至屋主清單</a></div>
        `
        : `<div style="color: var(--text-muted); font-size: var(--text-sm);">尚未指定屋主 → <a href="#m-owners" style="color: var(--color-primary);">先到屋主清單建檔</a>，再回來編輯房屋</div>`;

    const layoutLine = [
        building.layout || '',
        building.areaSize ? `${building.areaSize} 坪` : ''
    ].filter(Boolean).join(' · ');
    const rentDisplay = building.monthlyRent != null
        ? `NT$ ${Number(building.monthlyRent).toLocaleString()}${building.rentIncludesTax ? ' (含稅)' : ' (未稅)'}`
        : '';
    const energyLabel = ENERGY_OPTIONS.find(o => o.value === building.energyMode)?.label || '';

    return `
        <div class="houses-section">
            <h4 class="houses-section-title"><i class="ph ph-info"></i> 基本資訊</h4>
            ${fieldRow('房屋編號', building.id)}
            ${fieldRow('房屋名稱', building.name)}
            ${fieldRow('地址', building.baseAddress)}
            ${fieldRow('原始格局 / 坪數', layoutLine)}
            ${fieldRow('開發人', building.developer)}
            ${fieldRow('管理人', building.manager)}
        </div>

        <div class="houses-section">
            <h4 class="houses-section-title"><i class="ph ph-currency-circle-dollar"></i> 租金</h4>
            ${fieldRow('月租金', rentDisplay)}
            ${fieldRow('租金條件', building.rentTerm)}
            ${fieldRow('是否報稅', building.taxReported ? '是' : (building.monthlyRent != null ? '否' : ''))}
        </div>

        <div class="houses-section">
            <h4 class="houses-section-title"><i class="ph ph-user-circle"></i> 屋主</h4>
            ${ownerSection}
        </div>

        <div class="houses-section">
            <h4 class="houses-section-title"><i class="ph ph-key"></i> 代管設定</h4>
            ${fieldRow('代管期間', [building.managedStartDate, building.managedEndDate].filter(Boolean).join(' ~ '))}
            ${fieldRow('代管收費', feeConfigDescriptor(building))}
            ${fieldRow('能源費負擔', energyLabel, building.energyMode === 'mixed' ? '(見備註)' : '')}
        </div>

        <div class="houses-section">
            <h4 class="houses-section-title"><i class="ph ph-note"></i> 備註</h4>
            <div class="houses-note">${building.note ? esc(building.note).replace(/\n/g, '<br>') : '<span style="color: var(--text-muted);">—</span>'}</div>
        </div>

        <div style="margin-top: 1.5rem; display: flex; gap: 0.75rem;">
            <button class="btn btn-primary" data-action="edit-house"><i class="ph ph-pencil"></i> 編輯房屋資料</button>
            <button class="btn btn-outline" data-action="toggle-status"><i class="ph ${building.status === 'active' ? 'ph-pause' : 'ph-play'}"></i> ${building.status === 'active' ? '停用' : '啟用'}</button>
        </div>
    `;
}

function renderOccupancyTab(building) {
    const beds = mockData.properties.filter(p => p.buildingId === building.id);
    if (beds.length === 0) {
        return `<div style="padding: 2rem; text-align: center; color: var(--text-muted);">
            <i class="ph ph-bed" style="font-size: 2rem;"></i>
            <p style="margin: 0.5rem 0 0;">此房屋尚未建立房間/床位</p>
            <p style="font-size: var(--text-xs);">前往系統設定 → 房屋管理 → 該房屋的「房間/床位」管理</p>
        </div>`;
    }
    const rooms = new Map();
    beds.forEach(b => {
        const rn = b.roomNumber || 0;
        if (!rooms.has(rn)) rooms.set(rn, []);
        rooms.get(rn).push(b);
    });
    const sortedRn = [...rooms.keys()].sort((a, b) => Number(a) - Number(b));
    const total = beds.length;
    const rented = beds.filter(b => bedOccupied(b.name)).length;

    const roomBlocks = sortedRn.map(rn => {
        const list = rooms.get(rn).sort((a, b) => (a.bedLetter || '').localeCompare(b.bedLetter || ''));
        return `
            <div class="mhouse-room-block">
                <div class="mhouse-room-header">R${rn} <span style="color: var(--text-muted); font-weight: normal; font-size: 0.8rem; margin-left: 0.5rem;">${list.length} 床</span></div>
                <table class="data-table" style="margin: 0;">
                    <thead><tr><th style="width: 15%;">床位</th><th style="width: 28%;">租客</th><th style="width: 20%;">合約期間</th><th style="width: 12%;">月租</th><th>狀態</th></tr></thead>
                    <tbody>
                        ${list.map(b => {
                            const c = mockData.contracts.find(x => x.propertyName === b.name && (x.renewalState === 'active' || x.renewalState === 'snoozed'));
                            return `<tr>
                                <td><strong>R${b.roomNumber}-${b.bedLetter}</strong></td>
                                <td>${c ? esc(c.tenant) : '<span style="color: var(--text-muted);">空床</span>'}</td>
                                <td>${c ? `${c.startDate} ~ ${c.endDate}` : '—'}</td>
                                <td>$${(b.rent || 0).toLocaleString()}</td>
                                <td>${c ? `<span class="status-badge success">已出租</span>` : `<span class="status-badge muted">空床</span>`}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }).join('');

    return `
        <div style="margin-bottom: 1rem; font-size: var(--text-sm); color: var(--text-muted);">
            共 ${sortedRn.length} 房 / ${total} 床 — 已租 <strong style="color: var(--color-success);">${rented}</strong> · 空 <strong style="color: var(--color-warning);">${total - rented}</strong>
        </div>
        ${roomBlocks}
    `;
}

function renderContractsTab(building) {
    const contracts = mockData.contracts
        .filter(c => {
            const prop = mockData.properties.find(p => p.name === c.propertyName);
            return prop?.buildingId === building.id;
        })
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

    if (!contracts.length) {
        return `<div style="padding: 2rem; text-align: center; color: var(--text-muted);">尚無合約資料</div>`;
    }
    return `
        <table class="data-table">
            <thead><tr><th>合約 ID</th><th>租客</th><th>床位</th><th>期間</th><th>月租</th><th>狀態</th></tr></thead>
            <tbody>
                ${contracts.map(c => `
                    <tr>
                        <td><code>${esc(c.id)}</code></td>
                        <td>${esc(c.tenant)}</td>
                        <td style="font-size: var(--text-sm);">${esc((c.propertyName || '').replace('聚空間 - ', ''))}</td>
                        <td>${c.startDate || ''} ~ ${c.endDate || ''}</td>
                        <td>$${(c.amount || 0).toLocaleString()}</td>
                        <td><span class="status-badge ${c.renewalState === 'active' ? 'success' : c.renewalState === 'terminated' ? 'muted' : 'info'}">${c.renewalState}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderFeeTab(building) {
    // P3 月結算簡易版：列既有 settlements + 「產生本月結算」按鈕
    const settlements = (mockData.settlements || [])
        .filter(s => s.buildingId === building.id)
        .sort((a, b) => (b.month || '').localeCompare(a.month || ''));

    const summary = settlements.length === 0
        ? `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: var(--text-sm);">尚無月結算紀錄</div>`
        : `
            <table class="data-table">
                <thead><tr><th>結算月</th><th>屋主應收</th><th>本月新收押</th><th>本月移交押金</th><th>屋主持有押金</th><th>狀態</th><th>操作</th></tr></thead>
                <tbody>
                    ${settlements.map(s => `
                        <tr>
                            <td><strong>${s.month}</strong></td>
                            <td>$${(s.ownerReceivable || 0).toLocaleString()}</td>
                            <td>$${(s.depositCollectedThisMonth || 0).toLocaleString()}</td>
                            <td>$${(s.depositTransferredThisMonth || 0).toLocaleString()}</td>
                            <td>$${(s.ownerHoldingDepositTotal || 0).toLocaleString()}</td>
                            <td><span class="status-badge ${s.status === 'settled' ? 'success' : s.status === 'sent' ? 'info' : 'muted'}">${s.status}</span></td>
                            <td>
                                <button class="btn btn-outline mhouse-fee-action" data-action="view-settlement" data-id="${s.id}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs);"><i class="ph ph-eye"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    return `
        <div class="flex justify-between items-center mb-2">
            <div style="font-size: var(--text-sm); color: var(--text-muted);">屋主月結算 — 自動帶入收租 / 能源 / 修繕 / 代管費，產出 PDF / LINE 傳屋主 (Phase 3)</div>
            <button class="btn btn-primary" data-action="gen-settlement"><i class="ph ph-plus"></i> 產生本月結算</button>
        </div>
        ${summary}
    `;
}

// === main render ===

export function renderManagedHouse() {
    const id = getHouseIdFromHash();
    currentHouseId = id;
    const building = id ? mockData.buildings.find(b => b.id === id && b.mode === 'managed') : null;

    if (!building) {
        return `
            <div class="card" style="padding: 3rem; text-align: center;">
                <i class="ph ph-house-line" style="font-size: 3rem; color: var(--text-muted);"></i>
                <h3>找不到代管房屋</h3>
                <p style="color: var(--text-muted);">ID: <code>${esc(id || '(未指定)')}</code></p>
                <a href="#m-house-new" class="btn btn-primary"><i class="ph ph-plus"></i> 新增代管房屋</a>
            </div>
        `;
    }

    const activeTab = getActiveTab();
    const owner = building.ownerId ? getOwnerById(building.ownerId) : null;

    const tabsHtml = VALID_TABS.map(t => `
        <button class="settings-tab ${t === activeTab ? 'active' : ''}" data-mhouse-tab="${t}">
            <i class="ph ${TAB_LABELS[t].icon}"></i> ${TAB_LABELS[t].label}
        </button>
    `).join('');

    const tabContent = (() => {
        switch (activeTab) {
            case 'occupancy': return renderOccupancyTab(building);
            case 'contracts': return renderContractsTab(building);
            case 'fee':       return renderFeeTab(building);
            default:          return renderDataTab(building);
        }
    })();

    return `
        <div class="card">
            <div class="mhouse-header">
                <div>
                    <h2 style="margin: 0;"><i class="ph ph-house"></i> ${esc(building.name)}</h2>
                    <div style="font-size: var(--text-xs); color: var(--text-muted); margin-top: 4px;">
                        <code>${esc(building.id)}</code>
                        <span class="status-badge ${building.status === 'active' ? 'success' : 'info'}" style="margin-left: 0.5rem;">${building.status === 'active' ? '啟用中' : '已停用'}</span>
                        ${owner ? `<span style="margin-left: 0.5rem;">屋主：<strong>${esc(owner.name)}</strong></span>` : ''}
                    </div>
                </div>
            </div>
            <div class="settings-tabs hub-tabs">${tabsHtml}</div>
            <div class="mhouse-tab-content" data-active="${activeTab}">${tabContent}</div>
        </div>
    `;
}

export function initManagedHouseActions(scope) {
    const tabsEl = scope.querySelector('.hub-tabs');
    const contentEl = scope.querySelector('.mhouse-tab-content');

    if (tabsEl && contentEl) {
        tabsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-mhouse-tab]');
            if (!btn) return;
            const target = btn.dataset.mhouseTab;
            if (!VALID_TABS.includes(target) || target === contentEl.dataset.active) return;
            saveActiveTab(target);
            refreshView();
        });
    }

    contentEl?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const building = mockData.buildings.find(b => b.id === currentHouseId);
        if (!building) return;
        const action = btn.dataset.action;
        if (action === 'edit-house') showHouseForm(building);
        else if (action === 'toggle-status') {
            const next = building.status === 'active' ? 'inactive' : 'active';
            store.updateBuilding(building.id, { status: next });
            showToast(`已${next === 'active' ? '啟用' : '停用'}：${building.name}`, 'success');
            refreshView();
        }
        else if (action === 'gen-settlement') generateMonthSettlement(building);
        else if (action === 'view-settlement') viewSettlement(btn.dataset.id);
    });
}

// === 新增 / 編輯代管房屋表單 ===

export function showNewManagedHouseForm() {
    showHouseForm(null);
}

function showHouseForm(building) {
    const isEdit = !!building;
    // 屋主資料 inline 直接填，submit 時 lookup-or-create owner

    openFormModal({
        title: isEdit ? `編輯代管房屋：${building.name}` : '新增代管房屋',
        maxWidth: 760,
        fields: [
            { name: '__s1', type: 'section', label: '基本資訊' },
            // ⚠ field name 'name' 跟 HTMLFormElement.name property + form.elements.namedItem 衝突 → 改用 houseName
            { name: 'houseName', label: '房屋名稱', type: 'text', required: true, placeholder: '例：仁愛代管屋' },
            { name: 'status', label: '狀態', type: 'select', required: true, value: building?.status ?? 'active',
              options: [{ value: 'active', label: '啟用中' }, { value: 'inactive', label: '已停用' }] },
            { name: 'baseAddress', label: '地址', type: 'text', span: 2, placeholder: '台北市...' },
            { name: 'layout', label: '原始格局', type: 'text', placeholder: '3房2廳1衛' },
            { name: 'areaSize', label: '坪數', type: 'number', placeholder: '32.5' },
            { name: 'developer', label: '開發人', type: 'text' },
            { name: 'manager', label: '管理人', type: 'text' },

            { name: '__s2', type: 'section', label: '租金' },
            { name: 'monthlyRent', label: '月租金 (NT$)', type: 'number', placeholder: '45000' },
            { name: 'rentIncludesTax', label: '租金含稅', type: 'select', options: TAX_OPTIONS, value: building?.rentIncludesTax ? 'true' : 'false' },
            { name: 'rentTerm', label: '租金條件', type: 'text', placeholder: '押二付一' },
            { name: 'taxReported', label: '是否報稅', type: 'select', options: BOOL_OPTIONS, value: building?.taxReported ? 'true' : 'false' },

            { name: '__s3', type: 'section', label: '屋主資料', hint: '同姓名屋主已存在 → 自動連動更新；不存在 → 自動建檔' },
            { name: 'ownerName', label: '屋主姓名', type: 'text', required: true, span: 2, placeholder: '例：王小明' },
            { name: 'ownerGender', label: '性別', type: 'select', options: [
                { value: '',     label: '不指定' },
                { value: '男',   label: '男' },
                { value: '女',   label: '女' },
                { value: '其他', label: '其他' }
            ] },
            { name: 'ownerPhone', label: '電話', type: 'text', placeholder: '0912-345-678' },
            { name: 'ownerEmail', label: '信箱', type: 'text', placeholder: 'name@example.com' },
            { name: 'ownerLineId', label: 'LINE ID', type: 'text', placeholder: '@xxx 或 userId' },

            { name: '__s3b', type: 'section', label: '代管設定' },
            { name: 'managedStartDate', label: '代管起始日', type: 'date' },
            { name: 'managedEndDate', label: '代管結束日', type: 'date' },
            { name: 'feeType', label: '代管收費方式', type: 'select', options: FEE_TYPE_OPTIONS, value: building?.feeType ?? 'fixed' },
            // 以下 4 個 sub-field 只顯示對應 feeType 選的那一個，全部 span 2 占滿一列
            { name: 'feeFixedAmount', label: '固定月費 (NT$)', type: 'number', span: 2, placeholder: '例：3000' },
            { name: 'feePercentRate', label: '抽成 %', type: 'number', span: 2, placeholder: '例：10' },
            { name: 'feeTierJson', label: '階梯設定 (JSON)', type: 'textarea', span: 2, rows: 2, placeholder: '[{"from":0,"to":30000,"rate":8},{"from":30001,"rate":12}]', hint: '格式為 JSON 陣列' },
            { name: 'feeOtherNote', label: '其他收費說明', type: 'text', span: 2 },
            { name: 'energyMode', label: '能源費負擔', type: 'select', span: 2, options: ENERGY_OPTIONS, value: building?.energyMode ?? 'owner' },

            { name: '__s4', type: 'section', label: '備註' },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 3, placeholder: '漏水修了 / 配合水電行...' }
        ],
        values: (() => {
            const base = building ?? {
                status: 'active', mode: 'managed',
                energyMode: 'owner', rentIncludesTax: false, taxReported: false,
                feeType: 'fixed'
            };
            const cfg = base?.feeConfig || {};
            // 編輯模式 prefill 屋主 inline 欄位 (從 owners 表反查)
            const linkedOwner = base.ownerId ? getOwnerById(base.ownerId) : null;
            return {
                ...base,
                houseName: base.name ?? '',
                ownerName:   linkedOwner?.name   ?? '',
                ownerGender: linkedOwner?.gender ?? '',
                ownerPhone:  linkedOwner?.phone  ?? '',
                ownerEmail:  linkedOwner?.email  ?? '',
                ownerLineId: linkedOwner?.lineId ?? '',
                feeFixedAmount: cfg.amount ?? '',
                feePercentRate: cfg.rate ?? '',
                feeTierJson: cfg.tiers ? JSON.stringify(cfg.tiers) : '',
                feeOtherNote: cfg.note ?? ''
            };
        })(),
        submitLabel: isEdit ? '儲存變更' : '建立',
        onFormMount: (form) => {
            // feeType 改變時 → 只顯示對應的 sub-field
            const subFieldNames = {
                fixed:   'feeFixedAmount',
                percent: 'feePercentRate',
                tier:    'feeTierJson',
                other:   'feeOtherNote'
            };
            const wrappers = {};
            Object.entries(subFieldNames).forEach(([k, name]) => {
                const input = form.querySelector(`[name="${name}"]`);
                if (input) wrappers[k] = input.closest('.form-group');
            });
            const feeTypeInput = form.querySelector('[name="feeType"]');
            function syncVisibility() {
                const v = feeTypeInput?.value || 'fixed';
                Object.entries(wrappers).forEach(([k, el]) => {
                    if (!el) return;
                    el.style.display = (k === v) ? '' : 'none';
                });
            }
            syncVisibility();
            // custom-select 在 dispatchEvent('change') 寫到 hidden input
            feeTypeInput?.addEventListener('change', syncVisibility);

            // 屋主資料 inline 直接填，不需要獨立「+ 新增屋主」按鈕
            // submit 時自動 lookup-or-create owner，user 不用先去屋主管理建檔
        },
        onSubmit: (values) => {
            // houseName → name
            values.name = values.houseName;
            delete values.houseName;
            values.mode = 'managed';
            values.rentIncludesTax = values.rentIncludesTax === 'true' || values.rentIncludesTax === true;
            values.taxReported = values.taxReported === 'true' || values.taxReported === true;
            if (values.monthlyRent != null && values.monthlyRent !== '') values.monthlyRent = Number(values.monthlyRent);
            if (values.areaSize != null && values.areaSize !== '') values.areaSize = Number(values.areaSize);

            // ===== 屋主 lookup-or-create (取代之前 dropdown + 新增屋主 button 流程) =====
            const ownerName = (values.ownerName || '').trim();
            if (!ownerName) {
                showToast('「屋主姓名」必填', 'danger');
                return false;
            }
            const ownerPatch = {
                name:   ownerName,
                gender: values.ownerGender ?? '',
                phone:  values.ownerPhone  ?? '',
                email:  values.ownerEmail  ?? '',
                lineId: values.ownerLineId ?? ''
            };
            // 找同名 owner — 若已存在，update 該筆並取其 id；否則建一筆 active
            let ownerId = building?.ownerId || null;
            const existing = mockData.owners.find(o => o.name === ownerName && o.status !== 'archived');
            if (existing) {
                store.updateOwner(existing.id, ownerPatch);
                ownerId = existing.id;
            } else {
                const created = store.addOwner({ ...ownerPatch, source: '員工面談', status: 'active' });
                ownerId = created.id;
            }
            values.ownerId = ownerId;
            // 清掉 inline 臨時欄位 (不寫進 buildings)
            delete values.ownerName;
            delete values.ownerGender;
            delete values.ownerPhone;
            delete values.ownerEmail;
            delete values.ownerLineId;

            // 收費 config 從 4 個臨時欄位收成 feeConfig 物件
            const feeConfig = {};
            const t = values.feeType;
            if (t === 'fixed' && values.feeFixedAmount) feeConfig.amount = Number(values.feeFixedAmount);
            if (t === 'percent' && values.feePercentRate != null && values.feePercentRate !== '') feeConfig.rate = Number(values.feePercentRate);
            if (t === 'tier' && values.feeTierJson) {
                try { feeConfig.tiers = JSON.parse(values.feeTierJson); } catch {
                    showToast('階梯 JSON 解析失敗，請檢查格式', 'danger', 5000);
                    return false;
                }
            }
            if (t === 'other' && values.feeOtherNote) feeConfig.note = values.feeOtherNote;
            values.feeConfig = feeConfig;
            // 清掉臨時欄位
            delete values.feeFixedAmount;
            delete values.feePercentRate;
            delete values.feeTierJson;
            delete values.feeOtherNote;

            const dup = mockData.buildings.find(b => b.name === values.name && b.id !== building?.id);
            if (dup) { showToast(`房屋名稱「${values.name}」已存在`, 'danger'); return false; }

            if (isEdit) {
                store.updateBuilding(building.id, values);
                showToast(`已更新：${values.name}`, 'success');
                refreshView();
            } else {
                const created = store.addBuilding(values);
                window.dispatchEvent(new CustomEvent('bms:create', { detail: { table: 'buildings', id: created.id } }));
                showToast(`已新增代管房屋：${created.name}`, 'success');
                window.location.hash = `#m-house/${created.id}`;
            }
        }
    });
}

// === Phase 3: 月結算產生 (簡易自動計算) ===

function generateMonthSettlement(building) {
    const ym = new Date().toISOString().slice(0, 7);   // 本月
    // 找該房屋本月房租收入 (in invoices, status 已繳清)
    const monthRentIncome = mockData.invoices
        .filter(inv =>
            inv.direction === 'in'
            && inv.type === '房租'
            && inv.buildingId === building.id
            && (inv.periodStart || '').startsWith(ym)
        )
        .reduce((s, inv) => s + (Number(inv.paidAmount) || Number(inv.amount) || 0), 0);

    // 能源費 (out) — 該館本月實際支出 (水/電/瓦斯)
    const energyExpense = mockData.invoices
        .filter(inv =>
            inv.direction === 'out'
            && ['水費', '電費', '瓦斯費'].includes(inv.type)
            && inv.buildingId === building.id
            && (inv.dueDate || '').startsWith(ym)
        )
        .reduce((s, inv) => s + (Number(inv.paidAmount) || Number(inv.amount) || 0), 0);

    // 修繕費 (out)
    const repairExpense = mockData.invoices
        .filter(inv =>
            inv.direction === 'out'
            && ['修繕雜支'].includes(inv.type)
            && inv.buildingId === building.id
            && (inv.dueDate || '').startsWith(ym)
        )
        .reduce((s, inv) => s + (Number(inv.paidAmount) || Number(inv.amount) || 0), 0);

    // 代管費 — 依 feeType 計算
    let mgmtFee = 0;
    const c = building.feeConfig || {};
    if (building.feeType === 'fixed') mgmtFee = c.amount || 0;
    else if (building.feeType === 'percent') mgmtFee = Math.round(monthRentIncome * (c.rate || 0) / 100);
    else if (building.feeType === 'tier' && Array.isArray(c.tiers)) {
        const tier = c.tiers.find(x => monthRentIncome >= (x.from || 0) && monthRentIncome <= (x.to ?? Infinity));
        if (tier) mgmtFee = Math.round(monthRentIncome * (tier.rate || 0) / 100);
    }

    const items = [
        { type: 'rent_income', label: '收租金額',                 amount: monthRentIncome,    sign: 'in' },
        { type: 'energy',      label: '能源費 (水電瓦斯)',         amount: -energyExpense,     sign: 'out', breakdown: { exclude: building.energyMode === 'tenant' } },
        { type: 'repair',      label: '修繕費用',                 amount: -repairExpense,     sign: 'out' },
        { type: 'other',       label: '其他費用',                 amount: 0,                  sign: 'out' },
        { type: 'mgmt_fee',    label: `代管費用 (${building.feeType})`, amount: -mgmtFee,      sign: 'out' }
    ];

    // 屋主應收 = 收租 + 所有扣除
    const ownerReceivable = items.reduce((s, x) => s + x.amount, 0);

    // 押金狀態 — 本月新收 / 本月移交
    const monthDeposits = mockData.deposits.filter(d => d.buildingId === building.id);
    const depCollected  = monthDeposits.filter(d => (d.collectedDate || '').startsWith(ym)).reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const depTransferred = monthDeposits.filter(d => (d.transferredDate || '').startsWith(ym)).reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const ownerHolding = store.ownerHoldingDepositTotal(building.id);

    const existing = mockData.settlements.find(s => s.buildingId === building.id && s.month === ym);
    if (existing) {
        openConfirm({
            title: `本月結算單已存在 (${existing.id})`,
            message: '要重算覆寫嗎？(原資料會被取代)',
            confirmLabel: '重算覆寫',
            danger: true,
            onConfirm: () => {
                store.updateSettlement(existing.id, {
                    items, ownerReceivable,
                    depositCollectedThisMonth: depCollected,
                    depositTransferredThisMonth: depTransferred,
                    ownerHoldingDepositTotal: ownerHolding
                });
                showToast(`已重算 ${ym} 結算單`, 'success');
                refreshView();
            }
        });
        return;
    }

    const s = store.addSettlement({
        ownerId: building.ownerId,
        buildingId: building.id,
        month: ym,
        items, ownerReceivable,
        depositCollectedThisMonth: depCollected,
        depositTransferredThisMonth: depTransferred,
        ownerHoldingDepositTotal: ownerHolding
    });
    showToast(`已產生 ${ym} 結算單 (${s.id}) — 屋主應收 $${ownerReceivable.toLocaleString()}`, 'success', 5000);
    refreshView();
}

function viewSettlement(id) {
    const s = mockData.settlements.find(x => x.id === id);
    if (!s) return;
    const b = mockData.buildings.find(b => b.id === s.buildingId);
    const o = s.ownerId ? getOwnerById(s.ownerId) : null;
    const lines = (s.items || []).map(it => `
        <tr>
            <td>${esc(it.label)}</td>
            <td style="text-align: right; ${it.amount < 0 ? 'color: var(--color-danger);' : 'color: var(--color-success);'}">${it.amount < 0 ? '-' : '+'}$${Math.abs(it.amount).toLocaleString()}</td>
        </tr>
    `).join('');
    const html = `
        <div>
            <p><strong>${esc(b?.name || '')}</strong> · 屋主：${esc(o?.name || '—')} · 結算月：<strong>${s.month}</strong></p>
            <table class="data-table" style="margin: 0.5rem 0;">
                <thead><tr><th>項目</th><th style="text-align: right;">金額</th></tr></thead>
                <tbody>
                    ${lines}
                    <tr style="border-top: 2px solid var(--border-color);"><td><strong>屋主應收</strong></td><td style="text-align: right;"><strong style="font-size: 1.1rem;">$${(s.ownerReceivable || 0).toLocaleString()}</strong></td></tr>
                </tbody>
            </table>
            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--color-background); border-radius: 4px; font-size: var(--text-sm);">
                <div><strong>押金狀態</strong></div>
                <div>本月新收押金: $${(s.depositCollectedThisMonth || 0).toLocaleString()}</div>
                <div>本月移交給屋主: $${(s.depositTransferredThisMonth || 0).toLocaleString()}</div>
                <div>屋主目前持有押金總額: <strong>$${(s.ownerHoldingDepositTotal || 0).toLocaleString()}</strong></div>
            </div>
            <p style="margin-top: 1rem; font-size: var(--text-xs); color: var(--text-muted);">P3 接下來：PDF 下載 + LINE 傳屋主 (待接入)</p>
        </div>
    `;
    openConfirm({
        title: `月結算 ${s.id}`,
        message: html,
        confirmLabel: '關閉',
        hideCancel: true,
        maxWidth: 640
    });
}
