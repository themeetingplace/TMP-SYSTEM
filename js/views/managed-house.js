// 代管房屋頁 — 4 tabs: 房屋資料 / 住房一覽 / 合約 / 費用計算
// route: #m-house/{buildingId}
// 共居房屋資料在「物件管理 → 房屋資料 tab」，這頁專屬代管 mode

import { mockData, store, bedOccupied, getOwnerById } from '../data.js';
import { openFormModal, openConfirm, showToast, refreshView, initFlatpickr } from '../utils/ui.js';
import { escapeHtml as esc } from '../utils/escape.js';
import { showRoomForm } from './settings.js';
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

// inline 可編輯欄位 (auto-save on blur/change)
// data-inline-target: 'building' | 'owner' | 'feeConfig'
// data-inline-coerce: 'number' | 'bool' | (default text)
// opts.span: 1 (預設) | 2 (跨整列)
function inlineField(label, value, opts = {}) {
    const {
        key, target = 'building',
        type = 'text', coerce = 'text',
        options, placeholder = '', hint = '', rows = 2,
        span = 1
    } = opts;
    let inputHtml;
    const v = value == null ? '' : String(value);
    const attrs = `data-inline-key="${esc(key)}" data-inline-target="${esc(target)}" data-inline-coerce="${esc(coerce)}"`;
    if (type === 'checkbox') {
        // bool checkbox: 純記號 ✓ 切換，視覺輕量
        const checked = v === 'true' || v === '1';
        inputHtml = `
            <label class="inline-checkbox">
                <input type="checkbox" class="inline-edit-input" ${attrs} ${checked ? 'checked' : ''}>
                <span class="inline-checkbox-mark"></span>
                <span class="inline-checkbox-text">${esc(opts.checkboxLabel || '勾選=是')}</span>
            </label>
        `;
    } else if (type === 'select') {
        const opts2 = options || [];
        inputHtml = `<select class="inline-edit-input" ${attrs}>${
            opts2.map(o => `<option value="${esc(o.value)}" ${String(o.value) === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')
        }</select>`;
    } else if (type === 'textarea') {
        inputHtml = `<textarea class="inline-edit-input" ${attrs} rows="${rows}" placeholder="${esc(placeholder)}">${esc(v)}</textarea>`;
    } else {
        inputHtml = `<input type="${type}" class="inline-edit-input" ${attrs} value="${esc(v)}" placeholder="${esc(placeholder)}">`;
    }
    return `
        <div class="houses-field-row inline-edit-row" ${span === 2 ? 'data-span="2"' : ''}>
            <div class="houses-field-label">${esc(label)}</div>
            <div class="houses-field-value">${inputHtml}${hint ? `<span class="houses-field-hint">${esc(hint)}</span>` : ''}</div>
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
    const feeConfig = building.feeConfig || {};
    const feeType = building.feeType || 'fixed';

    // 收費 sub-field: 依 feeType 顯示對應的 input
    let feeAmountField = '';
    if (feeType === 'fixed') {
        feeAmountField = inlineField('固定月費 (NT$)', feeConfig.amount, {
            key: 'amount', target: 'feeConfig', type: 'number', coerce: 'number', placeholder: '3000'
        });
    } else if (feeType === 'percent') {
        feeAmountField = inlineField('抽成 %', feeConfig.rate, {
            key: 'rate', target: 'feeConfig', type: 'number', coerce: 'number', placeholder: '10'
        });
    } else if (feeType === 'tier') {
        feeAmountField = inlineField('階梯設定 (JSON)', JSON.stringify(feeConfig.tiers || []), {
            key: 'tiers', target: 'feeConfig', type: 'textarea', coerce: 'json', rows: 2,
            placeholder: '[{"from":0,"to":30000,"rate":8},{"from":30001,"rate":12}]',
            hint: 'JSON 陣列'
        });
    } else {
        feeAmountField = inlineField('其他收費說明', feeConfig.note, {
            key: 'note', target: 'feeConfig'
        });
    }

    const ownerSection = owner
        ? `
            <div class="houses-fields-grid">
                ${inlineField('姓名', owner.name, { key: 'name', target: 'owner', span: 2 })}
                ${inlineField('性別', owner.gender, {
                    key: 'gender', target: 'owner', type: 'select',
                    options: [
                        { value: '',     label: '不指定' },
                        { value: '男',   label: '男' },
                        { value: '女',   label: '女' },
                        { value: '其他', label: '其他' }
                    ]
                })}
                ${inlineField('電話', owner.phone, { key: 'phone', target: 'owner', placeholder: '0912-345-678' })}
                ${inlineField('信箱', owner.email, { key: 'email', target: 'owner', placeholder: 'name@example.com' })}
                ${inlineField('LINE ID', owner.lineId, { key: 'lineId', target: 'owner' })}
                <div class="houses-field-row" data-span="2">
                    <div class="houses-field-label">狀態</div>
                    <div class="houses-field-value">
                        <span class="status-badge ${owner.status === 'active' ? 'success' : (owner.status === 'pending_review' ? 'warning' : 'muted')}">${owner.status === 'active' ? '合作中' : (owner.status === 'pending_review' ? '待審核' : '已封存')}</span>
                        <a href="#m-owners" style="margin-left: 1rem; font-size: var(--text-xs); color: var(--color-primary);"><i class="ph ph-arrow-right"></i> 至屋主清單</a>
                    </div>
                </div>
            </div>
        `
        : `<div style="color: var(--text-muted); font-size: var(--text-sm); padding: 0.5rem 0;">尚未指定屋主 → <button class="btn btn-outline" data-action="set-owner" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);"><i class="ph ph-user-plus"></i> 新增屋主資料</button></div>`;

    return `
        <div class="houses-section">
            <h4 class="houses-section-title"><i class="ph ph-info"></i> 基本資訊</h4>
            <div class="houses-fields-grid">
                <div class="houses-field-row" data-readonly>
                    <div class="houses-field-label">房屋編號</div>
                    <div class="houses-field-value houses-field-readonly">${esc(building.id)}</div>
                </div>
                ${inlineField('房屋名稱', building.name, { key: 'name' })}
                ${inlineField('地址', building.baseAddress, { key: 'baseAddress', placeholder: '台北市...', span: 2 })}
                ${inlineField('原始格局', building.layout, { key: 'layout', placeholder: '3房2廳1衛' })}
                ${inlineField('坪數', building.areaSize, { key: 'areaSize', type: 'number', coerce: 'number', placeholder: '32.5' })}
                ${inlineField('開發人', building.developer, { key: 'developer' })}
                ${inlineField('管理人', building.manager, { key: 'manager' })}
            </div>
        </div>

        <div class="houses-section">
            <h4 class="houses-section-title"><i class="ph ph-currency-circle-dollar"></i> 租金</h4>
            <div class="houses-fields-grid">
                ${inlineField('月租金 (NT$)', building.monthlyRent, { key: 'monthlyRent', type: 'number', coerce: 'number', placeholder: '45000' })}
                ${inlineField('租金條件', building.rentTerm, { key: 'rentTerm', placeholder: '押二付一' })}
                ${inlineField('含稅', building.rentIncludesTax, {
                    key: 'rentIncludesTax', type: 'checkbox', coerce: 'bool',
                    checkboxLabel: '租金含稅'
                })}
                ${inlineField('報稅', building.taxReported, {
                    key: 'taxReported', type: 'checkbox', coerce: 'bool',
                    checkboxLabel: '已申報'
                })}
            </div>
        </div>

        <div class="houses-section">
            <h4 class="houses-section-title"><i class="ph ph-user-circle"></i> 屋主</h4>
            ${ownerSection}
        </div>

        <div class="houses-section">
            <h4 class="houses-section-title"><i class="ph ph-key"></i> 代管設定</h4>
            <div class="houses-fields-grid">
                ${inlineField('起始日', building.managedStartDate, { key: 'managedStartDate', type: 'date' })}
                ${inlineField('結束日', building.managedEndDate, { key: 'managedEndDate', type: 'date' })}
                ${inlineField('收費方式', feeType, {
                    key: 'feeType', type: 'select',
                    options: FEE_TYPE_OPTIONS
                })}
                ${feeAmountField}
                ${inlineField('能源費負擔', building.energyMode || 'owner', {
                    key: 'energyMode', type: 'select',
                    options: ENERGY_OPTIONS,
                    span: 2,
                    hint: building.energyMode === 'mixed' ? '(見備註)' : ''
                })}
            </div>
        </div>

        <div class="houses-section">
            <h4 class="houses-section-title"><i class="ph ph-note"></i> 備註</h4>
            ${inlineField('內容', building.note, { key: 'note', type: 'textarea', rows: 4, placeholder: '漏水修了 / 配合水電行...', span: 2 })}
        </div>

        <div style="margin-top: 1.5rem; display: flex; gap: 0.75rem; align-items: center;">
            <button class="btn btn-outline" data-action="toggle-status"><i class="ph ${building.status === 'active' ? 'ph-pause' : 'ph-play'}"></i> ${building.status === 'active' ? '停用此房屋' : '啟用此房屋'}</button>
            <span class="inline-save-hint" style="font-size: var(--text-xs); color: var(--text-muted);"><i class="ph ph-check-circle" style="color: var(--color-success);"></i> 編輯後自動儲存</span>
        </div>
    `;
}

function renderOccupancyTab(building) {
    const beds = mockData.properties.filter(p => p.buildingId === building.id);
    const rooms = new Map();
    beds.forEach(b => {
        const rn = b.roomNumber || 0;
        if (!rooms.has(rn)) rooms.set(rn, []);
        rooms.get(rn).push(b);
    });
    const sortedRn = [...rooms.keys()].sort((a, b) => Number(a) - Number(b));
    const total = beds.length;
    const rented = beds.filter(b => bedOccupied(b.name)).length;

    const emptyState = beds.length === 0 ? `
        <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
            <i class="ph ph-bed" style="font-size: 2rem;"></i>
            <p style="margin: 0.5rem 0 0;">此房屋尚未建立房間/床位</p>
            <p style="font-size: var(--text-xs);">點下方「新增房間」按鈕建第一間</p>
        </div>` : '';

    const roomBlocks = sortedRn.map(rn => {
        const list = rooms.get(rn).sort((a, b) => (a.bedLetter || '').localeCompare(b.bedLetter || ''));
        return `
            <div class="mhouse-room-block">
                <div class="mhouse-room-header" style="display: flex; align-items: center; justify-content: space-between;">
                    <div>R${rn} <span style="color: var(--text-muted); font-weight: normal; font-size: 0.8rem; margin-left: 0.5rem;">${list.length} 床</span></div>
                    <div style="display: flex; gap: 0.4rem;">
                        <button class="btn btn-outline" data-action="add-bed" data-room="${rn}" style="padding: 0.2rem 0.55rem; font-size: var(--text-xs);"><i class="ph ph-plus"></i> 加床</button>
                        <button class="btn btn-outline" data-action="del-room" data-room="${rn}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs); color: var(--color-danger);" title="刪除整房（包含所有床位）"><i class="ph ph-trash"></i></button>
                    </div>
                </div>
                <table class="data-table" style="margin: 0;">
                    <thead><tr><th style="width: 15%;">床位</th><th style="width: 26%;">租客</th><th style="width: 20%;">合約期間</th><th style="width: 14%;">月租 (inline)</th><th>狀態</th><th style="width: 5%;"></th></tr></thead>
                    <tbody>
                        ${list.map(b => {
                            const c = mockData.contracts.find(x => x.propertyName === b.name && (x.renewalState === 'active' || x.renewalState === 'snoozed'));
                            return `<tr>
                                <td><strong>R${b.roomNumber}-${b.bedLetter}</strong></td>
                                <td>${c ? esc(c.tenant) : '<span style="color: var(--text-muted);">空床</span>'}</td>
                                <td>${c ? `${c.startDate} ~ ${c.endDate}` : '—'}</td>
                                <td><input type="number" class="inline-edit-input" data-inline-bed="${esc(b.id)}" data-inline-field="rent" value="${b.rent || 0}" style="max-width: 110px; text-align: right;"></td>
                                <td>${c ? `<span class="status-badge success">已出租</span>` : `<span class="status-badge muted">空床</span>`}</td>
                                <td>${c ? '' : `<button class="btn btn-outline" data-action="del-bed" data-bed="${esc(b.id)}" style="padding: 0.15rem 0.4rem; font-size: var(--text-xs); color: var(--color-danger);" title="刪除空床"><i class="ph ph-x"></i></button>`}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }).join('');

    return `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
            <div style="font-size: var(--text-sm); color: var(--text-muted);">
                共 ${sortedRn.length} 房 / ${total} 床 — 已租 <strong style="color: var(--color-success);">${rented}</strong> · 空 <strong style="color: var(--color-warning);">${total - rented}</strong>
            </div>
            <button class="btn btn-primary" data-action="add-room"><i class="ph ph-plus"></i> 新增房間</button>
        </div>
        ${emptyState}
        ${roomBlocks}
    `;
}

function renderContractsTab(building) {
    // 屋主端委託合約 = contract_type managed-owner, buildingId = this building
    const ownerContracts = mockData.contracts
        .filter(c => c.contractType === 'managed-owner' && c.buildingId === building.id)
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

    // 住客端代管合約 = contract_type managed-tenant, buildingId = this building
    // 也順便接受舊資料：propertyName 反查 building (cohousing-style fallback)
    const tenantContracts = mockData.contracts
        .filter(c => {
            if (c.contractType === 'managed-tenant' && c.buildingId === building.id) return true;
            // legacy fallback: 沒 contractType 但 propertyName 對應到本 building 的床位
            if (!c.contractType || c.contractType === 'cohousing') {
                const prop = mockData.properties.find(p => p.name === c.propertyName);
                return prop?.buildingId === building.id;
            }
            return false;
        })
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

    function statusBadge(c) {
        const st = c.renewalState || 'active';
        const map = {
            active: ['success', '進行中'], snoozed: ['info', '暫緩'],
            terminated: ['muted', '已終止'], renewed: ['info', '已續約']
        };
        const [cls, txt] = map[st] || ['muted', st];
        return `<span class="status-badge ${cls}">${txt}</span>`;
    }

    const ownerTable = ownerContracts.length === 0
        ? `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: var(--text-sm);">尚無屋主委託合約</div>`
        : `
            <table class="data-table is-compact">
                <thead><tr><th style="width: 100px;">合約 ID</th><th>屋主</th><th>期間</th><th style="text-align: right; width: 130px;">委託月租</th><th style="width: 90px;">狀態</th><th style="width: 50px;"></th></tr></thead>
                <tbody>
                    ${ownerContracts.map(c => `
                        <tr>
                            <td><code>${esc(c.id)}</code></td>
                            <td>${esc(getOwnerById(c.ownerId)?.name || c.lessorName || '—')}</td>
                            <td>${c.startDate || ''} ~ ${c.endDate || ''}</td>
                            <td style="text-align: right; font-variant-numeric: tabular-nums;">$${(c.amount || 0).toLocaleString()}</td>
                            <td>${statusBadge(c)}</td>
                            <td><button class="btn btn-outline" data-action="del-contract" data-id="${esc(c.id)}" style="padding: 0.15rem 0.4rem; font-size: var(--text-xs); color: var(--color-danger);"><i class="ph ph-trash"></i></button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    const tenantTable = tenantContracts.length === 0
        ? `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: var(--text-sm);">尚無住客合約</div>`
        : `
            <table class="data-table is-compact">
                <thead><tr><th style="width: 100px;">合約 ID</th><th>租客</th><th>床位</th><th>期間</th><th style="text-align: right; width: 110px;">月租</th><th>出租人</th><th style="width: 90px;">狀態</th><th style="width: 50px;"></th></tr></thead>
                <tbody>
                    ${tenantContracts.map(c => `
                        <tr>
                            <td><code>${esc(c.id)}</code></td>
                            <td>${esc(c.tenant || '')}</td>
                            <td style="font-size: var(--text-sm);">${esc((c.propertyName || '').replace('聚空間 - ', ''))}</td>
                            <td>${c.startDate || ''} ~ ${c.endDate || ''}</td>
                            <td style="text-align: right; font-variant-numeric: tabular-nums;">$${(c.amount || 0).toLocaleString()}</td>
                            <td style="font-size: var(--text-xs);">${esc(c.lessorName || '我們')}</td>
                            <td>${statusBadge(c)}</td>
                            <td><button class="btn btn-outline" data-action="del-contract" data-id="${esc(c.id)}" style="padding: 0.15rem 0.4rem; font-size: var(--text-xs); color: var(--color-danger);"><i class="ph ph-trash"></i></button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    return `
        <div class="houses-section">
            <h4 class="houses-section-title" style="display: flex; justify-content: space-between; align-items: center;">
                <span><i class="ph ph-handshake"></i> 屋主委託合約 <small style="color: var(--text-muted); font-weight: normal;">(我們 ← 屋主)</small></span>
                <button class="btn btn-primary" data-action="new-owner-contract" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);"><i class="ph ph-plus"></i> 新增委託合約</button>
            </h4>
            ${ownerTable}
        </div>

        <div class="houses-section" style="margin-top: 1.5rem;">
            <h4 class="houses-section-title" style="display: flex; justify-content: space-between; align-items: center;">
                <span><i class="ph ph-users"></i> 住客租賃合約 <small style="color: var(--text-muted); font-weight: normal;">(住客 ← 出租人)</small></span>
                <button class="btn btn-primary" data-action="new-tenant-contract" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);"><i class="ph ph-plus"></i> 新增住客合約</button>
            </h4>
            ${tenantTable}
        </div>
    `;
}

// === R5.4: 費用計算 — 固定項目，每項可編輯，無帳單對帳 ===
const FEE_ITEMS_TEMPLATE = [
    { key: 'rentIncome',   label: '收租金額',           sign: 'in'  },
    { key: 'energy',       label: '能源費 (水電瓦斯)',  sign: 'out' },
    { key: 'repair',       label: '修繕費用',           sign: 'out' },
    { key: 'other',        label: '其他費用',           sign: 'out' },
    { key: 'mgmtFee',      label: '代管費用',           sign: 'out' }
];

// 給定 building + ym → 從現有合約 / 押金算出建議值 (沒帳單就 0)
function computeFeeDefaults(building, ym) {
    // 收租 = 本月有效的住客合約月租總和
    const tenantContracts = mockData.contracts.filter(c =>
        (c.contractType === 'managed-tenant') &&
        c.buildingId === building.id &&
        (c.renewalState === 'active' || c.renewalState === 'snoozed') &&
        (!c.endDate || c.endDate >= ym + '-01')
    );
    const rentIncome = tenantContracts.reduce((s, c) => s + (Number(c.amount) || 0), 0);

    // 代管費 — 依 building.feeType / feeConfig
    let mgmtFee = 0;
    const cfg = building.feeConfig || {};
    if (building.feeType === 'fixed') mgmtFee = Number(cfg.amount) || 0;
    else if (building.feeType === 'percent') mgmtFee = Math.round(rentIncome * (Number(cfg.rate) || 0) / 100);
    else if (building.feeType === 'tier' && Array.isArray(cfg.tiers)) {
        const tier = cfg.tiers.find(x => rentIncome >= (x.from || 0) && rentIncome <= (x.to ?? Infinity));
        if (tier) mgmtFee = Math.round(rentIncome * (tier.rate || 0) / 100);
    }
    return { rentIncome, energy: 0, repair: 0, other: 0, mgmtFee };
}

function renderFeeTab(building) {
    const ym = currentFeeMonth(building);
    const existing = (mockData.settlements || []).find(s => s.buildingId === building.id && s.month === ym);
    const defaults = computeFeeDefaults(building, ym);

    // existing.items 是陣列；轉成 key → amount map
    const existingMap = {};
    if (existing && Array.isArray(existing.items)) {
        existing.items.forEach(it => {
            if (it.key) existingMap[it.key] = it.amount;
            else if (it.type === 'rent_income') existingMap.rentIncome = it.amount;
            else if (it.type === 'energy')      existingMap.energy = Math.abs(it.amount);
            else if (it.type === 'repair')      existingMap.repair = Math.abs(it.amount);
            else if (it.type === 'other')       existingMap.other = Math.abs(it.amount);
            else if (it.type === 'mgmt_fee')    existingMap.mgmtFee = Math.abs(it.amount);
        });
    }

    // 用 2-col grid 排版 (每行: label + sign + number input)
    const itemRows = FEE_ITEMS_TEMPLATE.map(item => {
        const val = existingMap[item.key] ?? defaults[item.key] ?? 0;
        const signColor = item.sign === 'in' ? 'var(--color-success)' : 'var(--color-danger)';
        const signLabel = item.sign === 'in' ? '+' : '−';
        return `
            <div class="fee-item-row">
                <span class="fee-item-label">${item.label}</span>
                <span class="fee-item-sign" style="color: ${signColor};">${signLabel}</span>
                <input type="number" class="inline-edit-input fee-item-input" data-fee-key="${item.key}" data-fee-sign="${item.sign}" value="${val}">
            </div>
        `;
    }).join('');

    const settlements = (mockData.settlements || [])
        .filter(s => s.buildingId === building.id)
        .sort((a, b) => (b.month || '').localeCompare(a.month || ''));

    const historyTable = settlements.length === 0
        ? `<div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: var(--text-sm);">尚無歷史結算</div>`
        : `
            <table class="data-table" style="margin: 0;">
                <thead><tr><th>結算月</th><th style="text-align: right;">屋主應收</th><th>狀態</th><th></th></tr></thead>
                <tbody>
                    ${settlements.map(s => `
                        <tr ${s.month === ym ? 'style="background: rgba(255, 122, 0, 0.05);"' : ''}>
                            <td><strong>${s.month}</strong></td>
                            <td style="text-align: right;">$${(s.ownerReceivable || 0).toLocaleString()}</td>
                            <td><span class="status-badge ${s.status === 'settled' ? 'success' : s.status === 'sent' ? 'info' : 'muted'}">${s.status || 'draft'}</span></td>
                            <td>
                                <button class="btn btn-outline" data-action="view-settlement" data-id="${s.id}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs);"><i class="ph ph-eye"></i></button>
                                <button class="btn btn-outline" data-action="load-fee-month" data-month="${s.month}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs);" title="載入此月到上方表單"><i class="ph ph-arrow-up-left"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    return `
        <div class="fee-tab-card">
            <div class="fee-card-header">
                <h4 class="houses-section-title" style="margin: 0;"><i class="ph ph-calculator"></i> ${ym} 月結算</h4>
                <div class="fee-month-picker-wrap">
                    <label>結算月</label>
                    <input type="month" class="inline-edit-input" id="feeMonthPicker" value="${ym}">
                </div>
            </div>

            <div class="fee-items-list">${itemRows}</div>

            <div class="fee-receivable-row">
                <span class="fee-receivable-label">屋主應收</span>
                <strong id="feeReceivable" class="fee-receivable-value">$0</strong>
            </div>

            <div class="fee-actions">
                <button class="btn btn-primary" data-action="save-fee"><i class="ph ph-floppy-disk"></i> 儲存本月結算</button>
                <button class="btn btn-outline" data-action="reset-fee"><i class="ph ph-arrow-counter-clockwise"></i> 重設為自動計算</button>
                <span class="fee-last-saved">${existing ? `上次儲存：${existing.month}` : '尚未儲存'}</span>
            </div>
        </div>

        <div class="houses-section" style="margin-top: 1.5rem;">
            <h4 class="houses-section-title"><i class="ph ph-clock-counter-clockwise"></i> 歷史結算</h4>
            ${historyTable}
        </div>
    `;
}

// per-instance state — currentFeeMonth 用 module-level，reset 時 refreshView 重新 render
let _feeMonthOverride = null;
function currentFeeMonth(building) {
    if (_feeMonthOverride && _feeMonthOverride.bId === building.id) return _feeMonthOverride.ym;
    return new Date().toISOString().slice(0, 7);
}
function setFeeMonth(building, ym) {
    _feeMonthOverride = { bId: building.id, ym };
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
    // #5 統一月曆選擇器 — 把 inline-edit-input 裡的 type=date / type=month 都升級成 Flatpickr
    initFlatpickr(scope);

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
        else if (action === 'set-owner')      showSetOwnerForm(building);
        else if (action === 'gen-settlement') generateMonthSettlement(building);
        else if (action === 'view-settlement') viewSettlement(btn.dataset.id);
        // R5.2: 住房一覽 inline 新增 / 刪除
        else if (action === 'add-room')       addRoom(building);
        else if (action === 'add-bed')        addBed(building, parseInt(btn.dataset.room, 10));
        else if (action === 'del-room')       delRoom(building, parseInt(btn.dataset.room, 10));
        else if (action === 'del-bed')        delBed(building, btn.dataset.bed);
        // R5.3: 合約 tab inline create / delete
        else if (action === 'new-owner-contract')  showManagedOwnerContractForm(building);
        else if (action === 'new-tenant-contract') showManagedTenantContractForm(building);
        else if (action === 'del-contract')   delContract(btn.dataset.id);
        // R5.4: 費用計算 actions
        else if (action === 'save-fee')       saveFeeSettlement(building, scope);
        else if (action === 'reset-fee')      { setFeeMonth(building, currentFeeMonth(building)); resetFeeFormToDefaults(building, scope); }
        else if (action === 'load-fee-month') { setFeeMonth(building, btn.dataset.month); refreshView(); }
    });

    // R5.4: live recalc 屋主應收 + month picker change
    contentEl?.addEventListener('input', (e) => {
        if (e.target.matches('[data-fee-key]')) recalcFeeReceivable(scope);
    });
    contentEl?.addEventListener('change', (e) => {
        if (e.target.id === 'feeMonthPicker') {
            const building = mockData.buildings.find(b => b.id === currentHouseId);
            if (building && e.target.value) {
                setFeeMonth(building, e.target.value);
                refreshView();
            }
        }
    });
    // 初始 render 後算一次
    setTimeout(() => recalcFeeReceivable(scope), 0);

    // R5.1: inline auto-save (blur for text/number/textarea; change for select)
    contentEl?.addEventListener('blur', (e) => {
        // bed rent inline save 走另一條
        if (e.target.matches('[data-inline-bed]')) {
            handleBedInlineSave(e);
        } else {
            handleInlineSave(e);
        }
    }, true);
    contentEl?.addEventListener('change', (e) => {
        if (e.target.matches('select.inline-edit-input, input[type="checkbox"].inline-edit-input')) handleInlineSave(e);
    });
}

// === R5.1: inline auto-save handler ===
function handleInlineSave(e) {
    const input = e.target.closest('.inline-edit-input');
    if (!input) return;
    // fee tab inputs / month picker 走別條，沒 data-inline-key 直接跳出
    if (!input.dataset.inlineKey) return;
    const building = mockData.buildings.find(b => b.id === currentHouseId);
    if (!building) return;

    const key = input.dataset.inlineKey;
    const target = input.dataset.inlineTarget || 'building';
    const coerce = input.dataset.inlineCoerce || 'text';
    // checkbox 走 .checked 而非 .value
    const isCheckbox = input.type === 'checkbox';
    let raw = isCheckbox ? input.checked : input.value;
    let val;
    if (isCheckbox) val = !!raw;
    else if (coerce === 'number') val = raw === '' ? null : Number(raw);
    else if (coerce === 'bool') val = raw === 'true' || raw === true;
    else if (coerce === 'json') {
        try { val = raw === '' ? [] : JSON.parse(raw); }
        catch { showToast(`「${key}」JSON 格式錯誤`, 'danger'); flashSaved(input, 'fail'); return; }
    }
    else val = raw;

    if (target === 'building') {
        if (key === 'name') {
            const nv = String(val || '').trim();
            if (!nv) { showToast('房屋名稱不可空', 'danger'); flashSaved(input, 'fail'); return; }
            const dup = mockData.buildings.find(b => b.name === nv && b.id !== building.id);
            if (dup) { showToast(`房屋名稱「${nv}」已存在`, 'danger'); flashSaved(input, 'fail'); return; }
        }
        // feeType 改變 → 觸發 refresh (sub-field 要換)
        const needsRefresh = (key === 'feeType' && val !== building.feeType);
        store.updateBuilding(building.id, { [key]: val });
        flashSaved(input);
        if (needsRefresh) refreshView();
    }
    else if (target === 'owner') {
        if (!building.ownerId) {
            showToast('請先指定屋主', 'warning'); return;
        }
        store.updateOwner(building.ownerId, { [key]: val });
        flashSaved(input);
    }
    else if (target === 'feeConfig') {
        const cfg = { ...(building.feeConfig || {}) };
        if (key === 'tiers' && Array.isArray(val)) cfg.tiers = val;
        else cfg[key] = val;
        store.updateBuilding(building.id, { feeConfig: cfg });
        flashSaved(input);
    }
}

function flashSaved(input, mode = 'ok') {
    input.classList.remove('is-saved', 'is-save-fail');
    void input.offsetWidth;
    input.classList.add(mode === 'fail' ? 'is-save-fail' : 'is-saved');
    setTimeout(() => input.classList.remove('is-saved', 'is-save-fail'), 1500);
}

// === R5.2: 住房一覽 inline 房/床 操作 ===
function buildBedName(building, roomNumber, bedLetter) {
    return `聚空間 - ${building.name} R${roomNumber}-${bedLetter}`;
}

function nextRoomNumber(building) {
    const beds = mockData.properties.filter(p => p.buildingId === building.id);
    const maxR = beds.reduce((m, b) => Math.max(m, b.roomNumber || 0), 0);
    return maxR + 1;
}

function nextBedLetter(building, roomNumber) {
    const beds = mockData.properties.filter(p => p.buildingId === building.id && p.roomNumber === roomNumber);
    if (!beds.length) return 'A';
    const maxCode = beds.reduce((m, b) => Math.max(m, (b.bedLetter || 'A').charCodeAt(0)), 64);
    return String.fromCharCode(Math.min(maxCode + 1, 90));  // cap at Z
}

function addRoom(building) {
    // 跟系統設定館別管理同款表單 (房號 / 性別 / 人數 / 床位數 / 起始字母 / 預設租金)
    showRoomForm(building.id, null, () => refreshView());
}

function addBed(building, roomNumber) {
    const bedLetter = nextBedLetter(building, roomNumber);
    const name = buildBedName(building, roomNumber, bedLetter);
    store.addProperty({
        name, buildingId: building.id,
        roomNumber, bedLetter,
        status: '待租', rent: 0, tenant: null, contractId: null
    });
    showToast(`已新增 R${roomNumber}-${bedLetter}`, 'success');
    refreshView();
}

function delRoom(building, roomNumber) {
    const beds = mockData.properties.filter(p => p.buildingId === building.id && p.roomNumber === roomNumber);
    const occupied = beds.some(b => bedOccupied(b.name));
    if (occupied) {
        showToast(`R${roomNumber} 仍有住客，請先終止合約`, 'danger', 5000);
        return;
    }
    openConfirm({
        title: `刪除 R${roomNumber}？`,
        message: `將一併刪除 ${beds.length} 個床位 (R${roomNumber}-${beds.map(b => b.bedLetter).join(', R' + roomNumber + '-')})`,
        confirmLabel: '刪除',
        danger: true,
        onConfirm: () => {
            beds.forEach(b => store.deleteProperty(b.id));
            showToast(`已刪除 R${roomNumber}`, 'success');
            refreshView();
        }
    });
}

function delBed(building, bedId) {
    const bed = mockData.properties.find(p => p.id === bedId);
    if (!bed) return;
    if (bedOccupied(bed.name)) { showToast('床位仍有住客', 'danger'); return; }
    openConfirm({
        title: `刪除 R${bed.roomNumber}-${bed.bedLetter}？`,
        message: '此操作不可復原',
        confirmLabel: '刪除',
        danger: true,
        onConfirm: () => {
            store.deleteProperty(bed.id);
            showToast('已刪除床位', 'success');
            refreshView();
        }
    });
}

function handleBedInlineSave(e) {
    const input = e.target.closest('[data-inline-bed]');
    if (!input) return;
    const bedId = input.dataset.inlineBed;
    const field = input.dataset.inlineField;
    const bed = mockData.properties.find(p => p.id === bedId);
    if (!bed) return;
    let val = input.value;
    if (field === 'rent') val = val === '' ? 0 : Number(val);
    if (bed[field] === val) return;
    store.updateProperty(bedId, { [field]: val });
    flashSaved(input);
}

// 還沒指定屋主時走 lookup-or-create 流程
function showSetOwnerForm(building) {
    openFormModal({
        title: `設定屋主：${building.name}`,
        maxWidth: 480,
        fields: [
            { name: 'ownerName',   label: '屋主姓名', type: 'text', required: true, span: 2 },
            { name: 'ownerGender', label: '性別', type: 'select', options: [
                { value: '',     label: '不指定' },
                { value: '男',   label: '男' },
                { value: '女',   label: '女' },
                { value: '其他', label: '其他' }
            ] },
            { name: 'ownerPhone',  label: '電話', type: 'text' },
            { name: 'ownerEmail',  label: '信箱', type: 'text', span: 2 },
            { name: 'ownerLineId', label: 'LINE ID', type: 'text', span: 2 }
        ],
        values: {},
        submitLabel: '建立並指定',
        onSubmit: (values) => {
            const name = (values.ownerName || '').trim();
            if (!name) { showToast('屋主姓名必填', 'danger'); return false; }
            const ownerPatch = {
                name, gender: values.ownerGender ?? '',
                phone: values.ownerPhone ?? '', email: values.ownerEmail ?? '',
                lineId: values.ownerLineId ?? ''
            };
            const existing = mockData.owners.find(o => o.name === name && o.status !== 'archived');
            let ownerId;
            if (existing) { store.updateOwner(existing.id, ownerPatch); ownerId = existing.id; }
            else { const created = store.addOwner({ ...ownerPatch, source: '員工面談', status: 'active' }); ownerId = created.id; }
            store.updateBuilding(building.id, { ownerId });
            showToast(`已指定屋主：${name}`, 'success');
            refreshView();
        }
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

// === R5.3: 代管合約表單 ===

const CONTRACT_STATUSES_OPTS = [
    { value: '已簽署', label: '已簽署' },
    { value: '待簽署', label: '待簽署' },
    { value: '已終止', label: '已終止' }
];

function delContract(id) {
    const c = mockData.contracts.find(x => x.id === id);
    if (!c) return;
    openConfirm({
        title: `刪除合約 ${c.id}？`,
        message: '此操作不可復原',
        confirmLabel: '刪除',
        danger: true,
        onConfirm: () => {
            store.deleteContract(c.id);
            showToast('已刪除合約', 'success');
            refreshView();
        }
    });
}

// 屋主委託合約：我們 (承租方) ← 屋主 (出租方)
function showManagedOwnerContractForm(building) {
    const owner = building.ownerId ? getOwnerById(building.ownerId) : null;
    if (!owner) {
        showToast('請先在「房屋資料」設定屋主', 'warning', 4000);
        return;
    }
    const today = new Date().toISOString().slice(0, 10);
    openFormModal({
        title: `新增屋主委託合約 — ${building.name}`,
        maxWidth: 560,
        fields: [
            { name: '__s1', type: 'section', label: '委託基本資訊', hint: `屋主：${owner.name}（已自動帶入，可至屋主清單修改）` },
            { name: 'startDate', label: '委託起始日', type: 'date', required: true, value: building.managedStartDate || today },
            { name: 'endDate',   label: '委託結束日', type: 'date', value: building.managedEndDate || '' },
            { name: 'amount',    label: '委託月租 (我們每月付屋主)', type: 'number', required: true, value: building.monthlyRent || 0 },
            { name: 'status',    label: '簽署狀態', type: 'select', options: CONTRACT_STATUSES_OPTS, value: '待簽署' },
            { name: 'note',      label: '備註', type: 'textarea', span: 2, rows: 3 }
        ],
        values: {},
        submitLabel: '建立委託合約',
        onSubmit: (values) => {
            const payload = {
                contractType: 'managed-owner',
                buildingId: building.id,
                ownerId: building.ownerId,
                lessorName: owner.name,
                tenant: owner.name,           // 給 list 顯示用
                propertyName: '',
                startDate: values.startDate,
                endDate: values.endDate || null,
                signDate: values.startDate,
                amount: Number(values.amount) || 0,
                status: values.status,
                renewalState: 'active',
                termMonths: 12,
                depositAmount: 0,
                note: values.note || ''
            };
            const c = store.addContract(payload);
            showToast(`已建立屋主委託合約 ${c.id}`, 'success');
            refreshView();
        }
    });
}

// 住客代管合約：住客 ← 出租人（我們 / 屋主名義可選）
function showManagedTenantContractForm(building) {
    const owner = building.ownerId ? getOwnerById(building.ownerId) : null;
    const beds = mockData.properties
        .filter(p => p.buildingId === building.id)
        .sort((a, b) => (a.roomNumber - b.roomNumber) || (a.bedLetter || '').localeCompare(b.bedLetter || ''));
    if (!beds.length) {
        showToast('請先在「住房一覽」新增房間/床位', 'warning', 4000);
        return;
    }
    const bedOptions = beds.map(b => ({
        value: b.name,
        label: `R${b.roomNumber}-${b.bedLetter}${bedOccupied(b.name) ? ' (已出租)' : ''}`
    }));
    const today = new Date().toISOString().slice(0, 10);
    const ourName = '聚空間租賃管理顧問有限公司';
    const lessorOptions = [
        { value: ourName, label: `我們 (${ourName})` }
    ];
    if (owner) lessorOptions.push({ value: owner.name, label: `屋主名義 (${owner.name})` });

    openFormModal({
        title: `新增住客合約 — ${building.name}`,
        maxWidth: 600,
        fields: [
            { name: '__s1', type: 'section', label: '床位 + 租客' },
            { name: 'propertyName', label: '床位', type: 'select', required: true, span: 2, options: bedOptions, searchable: true },
            { name: 'tenant',       label: '租客姓名', type: 'text', required: true, span: 2 },

            { name: '__s2', type: 'section', label: '合約期間 + 月租' },
            { name: 'startDate', label: '入住日期', type: 'date', required: true, value: today },
            { name: 'termMonths', label: '合約期 (月)', type: 'number', value: 12 },
            { name: 'endDate', label: '到期日 (留空自動算)', type: 'date', span: 2 },
            { name: 'amount', label: '月租金', type: 'number', required: true },
            { name: 'depositAmount', label: '押金', type: 'number', value: 0 },

            { name: '__s3', type: 'section', label: '出租人 (合約上顯示)', hint: '可填我們公司名或屋主名義' },
            { name: 'lessorName', label: '出租人', type: 'select', span: 2, options: lessorOptions, value: ourName },
            { name: 'lessorNameCustom', label: '自訂出租人名稱（可選）', type: 'text', span: 2, placeholder: '留空則用上方下拉選擇' },

            { name: '__s4', type: 'section', label: '其他' },
            { name: 'status', label: '簽署狀態', type: 'select', options: CONTRACT_STATUSES_OPTS, value: '待簽署' },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 2 }
        ],
        values: {},
        submitLabel: '建立住客合約',
        onSubmit: (values) => {
            const prop = mockData.properties.find(p => p.name === values.propertyName);
            if (!prop) { showToast('找不到對應床位', 'danger'); return false; }
            let endDate = values.endDate || null;
            if (!endDate && values.startDate && values.termMonths) {
                const d = new Date(values.startDate);
                d.setMonth(d.getMonth() + (parseInt(values.termMonths, 10) || 12));
                d.setDate(d.getDate());
                endDate = d.toISOString().split('T')[0];
            }
            const lessorName = (values.lessorNameCustom || '').trim() || values.lessorName || ourName;
            const payload = {
                contractType: 'managed-tenant',
                buildingId: building.id,
                ownerId: building.ownerId,
                lessorName,
                propertyId: prop.id,
                propertyName: prop.name,
                tenant: values.tenant.trim(),
                startDate: values.startDate,
                signDate: values.startDate,
                endDate,
                termMonths: parseInt(values.termMonths, 10) || 12,
                amount: Number(values.amount) || 0,
                depositAmount: Number(values.depositAmount) || 0,
                status: values.status,
                renewalState: 'active',
                note: values.note || ''
            };
            const c = store.addContract(payload);
            // 同步更新床位狀態（代管模式還是要顯示已出租）
            store.updateProperty(prop.id, {
                status: '已出租',
                tenant: payload.tenant,
                contractId: c.id,
                contractEnd: endDate
            });
            showToast(`已建立住客合約 ${c.id}`, 'success');
            refreshView();
        }
    });
}

// === R5.4: 費用計算 actions ===
function readFeeInputs(scope) {
    const out = {};
    scope.querySelectorAll('[data-fee-key]').forEach(input => {
        out[input.dataset.feeKey] = {
            amount: Number(input.value) || 0,
            sign: input.dataset.feeSign
        };
    });
    return out;
}

function recalcFeeReceivable(scope) {
    const inputs = readFeeInputs(scope);
    let total = 0;
    Object.values(inputs).forEach(({ amount, sign }) => {
        total += sign === 'in' ? amount : -amount;
    });
    const el = scope.querySelector('#feeReceivable');
    if (el) {
        el.textContent = `$${total.toLocaleString()}`;
        el.style.color = total >= 0 ? 'var(--text-main)' : 'var(--color-danger)';
    }
}

function resetFeeFormToDefaults(building, scope) {
    const ym = currentFeeMonth(building);
    const defaults = computeFeeDefaults(building, ym);
    scope.querySelectorAll('[data-fee-key]').forEach(input => {
        const key = input.dataset.feeKey;
        if (defaults[key] != null) input.value = defaults[key];
    });
    recalcFeeReceivable(scope);
    showToast('已重設為自動計算值', 'info', 2000);
}

function saveFeeSettlement(building, scope) {
    const ym = currentFeeMonth(building);
    const inputs = readFeeInputs(scope);
    const items = FEE_ITEMS_TEMPLATE.map(t => ({
        key: t.key,
        label: t.label,
        sign: t.sign,
        amount: t.sign === 'in' ? (inputs[t.key]?.amount || 0) : -(inputs[t.key]?.amount || 0)
    }));
    const ownerReceivable = items.reduce((s, it) => s + it.amount, 0);

    // 押金狀態 - 沿用既有計算
    const monthDeposits = (mockData.deposits || []).filter(d => d.buildingId === building.id);
    const depCollected   = monthDeposits.filter(d => (d.collectedDate   || '').startsWith(ym)).reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const depTransferred = monthDeposits.filter(d => (d.transferredDate || '').startsWith(ym)).reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const ownerHolding = store.ownerHoldingDepositTotal?.(building.id) ?? 0;

    const existing = (mockData.settlements || []).find(s => s.buildingId === building.id && s.month === ym);
    const payload = {
        ownerId: building.ownerId,
        buildingId: building.id,
        month: ym,
        items, ownerReceivable,
        depositCollectedThisMonth: depCollected,
        depositTransferredThisMonth: depTransferred,
        ownerHoldingDepositTotal: ownerHolding,
        status: existing?.status || 'draft'
    };

    if (existing) {
        store.updateSettlement(existing.id, payload);
        showToast(`已更新 ${ym} 結算 — 屋主應收 $${ownerReceivable.toLocaleString()}`, 'success');
    } else {
        const s = store.addSettlement(payload);
        showToast(`已儲存 ${ym} 結算 (${s.id}) — 屋主應收 $${ownerReceivable.toLocaleString()}`, 'success');
    }
    refreshView();
}
