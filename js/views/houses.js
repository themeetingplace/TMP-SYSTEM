// 房屋資料 — 物件管理 hub 第三個 tab
// 一館一 tab 顯示 (不用列表)；共居 fields only，代管擴充等代管 phase 再加
import { mockData, store, getSortedBuildings, bedOccupied } from '../data.js';
import { openFormModal, showToast, refreshView, initFlatpickr, initCustomSelects } from '../utils/ui.js';
import { escapeHtml as esc } from '../utils/escape.js';
import { getMode } from '../utils/appMode.js';
import { showBuildingRoomsModal } from './settings.js';

// 每 section 獨立編輯 (跟代管 managed-house 同款 inline 編輯流程)
let editingSection = null; // 'basic' | 'rent' | 'owner' | 'note' | null

const STORAGE_KEY = 'pms-houses-active-building';
const STATUS_OPTIONS = [
    { value: 'active',   label: '啟用中' },
    { value: 'inactive', label: '已停用' }
];
const TAX_OPTIONS = [
    { value: 'false', label: '未稅' },
    { value: 'true',  label: '含稅' }
];
const BOOL_OPTIONS = [
    { value: 'false', label: '否' },
    { value: 'true',  label: '是' }
];
const GENDER_OPTIONS = [
    { value: '',    label: '不指定' },
    { value: '男',  label: '男' },
    { value: '女',  label: '女' },
    { value: '其他', label: '其他' }
];

function statsOf(bid) {
    const beds = mockData.properties.filter(p => p.buildingId === bid);
    const rooms = new Set(beds.map(p => p.roomNumber)).size;
    const rented = beds.filter(p => bedOccupied(p.name)).length;
    return { rooms, totalBeds: beds.length, rented };
}

function getActiveBuildingId(buildings) {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && buildings.some(b => b.id === saved)) return saved;
    } catch {}
    return buildings[0]?.id || null;
}

function saveActiveBuildingId(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
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

// inline 可編輯欄位 (與 managed-house.js 同款 — 共用 .inline-edit-input / .inline-checkbox / custom-select 樣式)
function inlineField(label, value, opts = {}) {
    const { key, type = 'text', coerce = 'text', options, placeholder = '', hint = '', rows = 2, span = 1, disabled = false } = opts;
    const v = value == null ? '' : String(value);
    const attrs = `data-inline-key="${esc(key)}" data-inline-coerce="${esc(coerce)}"`;
    const dis = disabled ? 'disabled' : '';
    let inputHtml;
    if (type === 'checkbox') {
        const checked = v === 'true' || v === '1';
        inputHtml = `<label class="inline-checkbox ${disabled ? 'is-readonly' : ''}">
            <input type="checkbox" class="inline-edit-input" ${attrs} ${checked ? 'checked' : ''} ${dis}>
            <span class="inline-checkbox-mark"></span>
            <span class="inline-checkbox-text">${esc(opts.checkboxLabel || '勾選=是')}</span>
        </label>`;
    } else if (type === 'select') {
        const opts2 = options || [];
        const current = opts2.find(o => String(o.value) === v);
        const displayLabel = current ? current.label : (placeholder || '請選擇');
        if (disabled) {
            inputHtml = `<div class="inline-readonly-value">${esc(displayLabel || '—')}</div>`;
        } else {
            inputHtml = `<div class="custom-select inline-custom-select" data-name="${esc(key)}">
                <input type="hidden" class="inline-edit-input" ${attrs} value="${esc(v)}">
                <button type="button" class="custom-select-trigger">
                    <span class="custom-select-value">${esc(displayLabel)}</span>
                    <i class="ph ph-caret-down"></i>
                </button>
                <div class="custom-select-panel" hidden>
                    <div class="custom-select-options-wrap">
                        ${opts2.map(o => `<button type="button" class="custom-select-option ${String(o.value) === v ? 'is-selected' : ''}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
                    </div>
                </div>
            </div>`;
        }
    } else if (type === 'textarea') {
        if (disabled) {
            inputHtml = `<div class="inline-readonly-value inline-readonly-textarea">${v ? esc(v).replace(/\n/g, '<br>') : '<span style="color: var(--text-muted);">—</span>'}</div>`;
        } else {
            inputHtml = `<textarea class="inline-edit-input" ${attrs} rows="${rows}" placeholder="${esc(placeholder)}">${esc(v)}</textarea>`;
        }
    } else {
        if (disabled) {
            inputHtml = `<div class="inline-readonly-value">${v ? esc(v) : '<span style="color: var(--text-muted);">—</span>'}</div>`;
        } else {
            inputHtml = `<input type="${type}" class="inline-edit-input" ${attrs} value="${esc(v)}" placeholder="${esc(placeholder)}">`;
        }
    }
    return `<div class="houses-field-row inline-edit-row" ${span === 2 ? 'data-span="2"' : ''}>
        <div class="houses-field-label">${esc(label)}</div>
        <div class="houses-field-value">${inputHtml}${hint ? `<span class="houses-field-hint">${esc(hint)}</span>` : ''}</div>
    </div>`;
}

function sectionHeader(name, icon, label, isEditing) {
    return `<h4 class="houses-section-title">
        <span><i class="ph ${icon}"></i> ${esc(label)}</span>
        <div class="section-actions" data-section="${esc(name)}">
            ${isEditing
                ? `<button type="button" class="btn btn-primary btn-xs section-action-btn" data-section-action="save"><i class="ph ph-check"></i> 儲存</button>
                   <button type="button" class="btn btn-outline btn-xs section-action-btn" data-section-action="cancel">取消</button>`
                : `<button type="button" class="btn btn-outline btn-xs section-action-btn" data-section-action="edit"><i class="ph ph-pencil"></i> 編輯</button>`
            }
        </div>
    </h4>`;
}

function renderBuildingDetail(building) {
    const { rooms, totalBeds, rented } = statsOf(building.id);
    const isActive = building.status === 'active';
    const isBasic = editingSection === 'basic';
    const isRent  = editingSection === 'rent';
    const isOwner = editingSection === 'owner';
    const isNote  = editingSection === 'note';

    return `
        <div class="houses-detail">
            <div class="houses-detail-header">
                <div>
                    <h3 style="margin: 0;">${esc(building.name)}</h3>
                    <div style="font-size: var(--text-xs); color: var(--text-muted); margin-top: 2px;">
                        <code>${esc(building.id)}</code>
                        <span class="status-badge ${isActive ? 'success' : 'info'}" style="margin-left: 0.5rem;">${isActive ? '啟用中' : '已停用'}</span>
                    </div>
                </div>
            </div>

            <div class="houses-section" data-section="basic">
                ${sectionHeader('basic', 'ph-info', '基本資訊', isBasic)}
                <div class="houses-fields-grid">
                    <div class="houses-field-row" data-readonly>
                        <div class="houses-field-label">房屋編號</div>
                        <div class="houses-field-value houses-field-readonly">${esc(building.id)}</div>
                    </div>
                    ${inlineField('房屋名稱', building.name, { key: 'name', disabled: !isBasic })}
                    ${inlineField('地址', building.baseAddress, { key: 'baseAddress', placeholder: '台北市...', span: 2, disabled: !isBasic })}
                    ${inlineField('原始格局', building.layout, { key: 'layout', placeholder: '3房2廳1衛', disabled: !isBasic })}
                    ${inlineField('坪數', building.areaSize, { key: 'areaSize', type: 'number', coerce: 'number', placeholder: '32.5', disabled: !isBasic })}
                </div>
            </div>

            <div class="houses-section" data-section="rent">
                ${sectionHeader('rent', 'ph-currency-circle-dollar', '租金', isRent)}
                <div class="houses-fields-grid">
                    ${inlineField('月租金 (NT$)', building.monthlyRent, { key: 'monthlyRent', type: 'number', coerce: 'number', placeholder: '45000', disabled: !isRent })}
                    ${inlineField('含稅', building.rentIncludesTax, {
                        key: 'rentIncludesTax', type: 'select', coerce: 'bool', disabled: !isRent,
                        options: [{ value: 'true', label: '含稅' }, { value: 'false', label: '不含稅' }]
                    })}
                    ${inlineField('租金條件', building.rentTerm, { key: 'rentTerm', disabled: !isRent })}
                    ${inlineField('是否報稅', building.taxReported, {
                        key: 'taxReported', type: 'select', coerce: 'bool', disabled: !isRent,
                        options: [{ value: 'true', label: '是' }, { value: 'false', label: '否' }]
                    })}
                </div>
            </div>

            <div class="houses-section" data-section="owner">
                ${sectionHeader('owner', 'ph-user-circle', '屋主資料', isOwner)}
                <div class="houses-fields-grid">
                    ${inlineField('姓名', building.ownerName, { key: 'ownerName', span: 2, disabled: !isOwner })}
                    ${inlineField('性別', building.ownerGender, {
                        key: 'ownerGender', type: 'select', options: GENDER_OPTIONS, disabled: !isOwner
                    })}
                    ${inlineField('電話', building.ownerPhone, { key: 'ownerPhone', placeholder: '0912-345-678', disabled: !isOwner })}
                    ${inlineField('信箱', building.ownerEmail, { key: 'ownerEmail', placeholder: 'name@example.com', disabled: !isOwner })}
                    ${inlineField('LINE ID', building.ownerLineId, { key: 'ownerLineId', disabled: !isOwner })}
                </div>
            </div>

            <div class="houses-section" data-section="note">
                ${sectionHeader('note', 'ph-note', '備註', isNote)}
                ${inlineField('內容', building.note, { key: 'note', type: 'textarea', rows: 4, placeholder: '', span: 2, disabled: !isNote })}
            </div>

            <div class="houses-section">
                <h4 class="houses-section-title">
                    <span><i class="ph ph-bed"></i> 房間 / 床位</span>
                    <div class="section-actions">
                        <button class="btn btn-outline btn-xs" data-action="manage-rooms" data-building-id="${esc(building.id)}" style="text-transform: none; letter-spacing: 0;">
                            <i class="ph ph-list-bullets"></i> 管理房間/床位
                        </button>
                    </div>
                </h4>
                <div style="font-size: var(--text-base); padding: 0.5rem 0.75rem;">
                    <strong>${rooms}</strong> 間 ·
                    <strong>${totalBeds}</strong> 床 ·
                    已租 <span style="color: var(--color-success); font-weight: 600;">${rented}</span> /
                    空 <span style="color: var(--color-warning); font-weight: 600;">${totalBeds - rented}</span>
                </div>
            </div>

            <div class="houses-data-footer">
                <button class="btn btn-outline btn-toggle-status" data-action="toggle-status" data-id="${esc(building.id)}"><i class="ph ${isActive ? 'ph-pause' : 'ph-play'}"></i> ${isActive ? '停用此房屋' : '啟用此房屋'}</button>
            </div>
        </div>
    `;
}

export function renderHouses() {
    // 跟 mode 切開：共居 hub 只顯示共居房屋，代管走 #m-house/* route
    const mode = getMode();
    const buildings = getSortedBuildings().filter(b => (b.mode || 'cohousing') === (mode === 'managed' ? 'managed' : 'cohousing'));

    if (buildings.length === 0) {
        return `
            <div class="card" style="padding: 3rem; text-align: center;">
                <i class="ph ph-house" style="font-size: 3rem; color: var(--text-muted);"></i>
                <p style="margin: 1rem 0;">尚無房屋資料</p>
                <button class="btn btn-primary" id="btn-new-house" data-fab="ph-plus">
                    <i class="ph ph-plus"></i> 新增房屋
                </button>
            </div>
        `;
    }

    const activeId = getActiveBuildingId(buildings);
    const activeBuilding = buildings.find(b => b.id === activeId) || buildings[0];

    const tabsHtml = buildings.map(b => `
        <button class="houses-tab ${b.id === activeBuilding.id ? 'active' : ''}" data-building-id="${esc(b.id)}" title="${esc(b.name)} (${esc(b.id)})">
            <i class="ph ${b.status === 'active' ? 'ph-house' : 'ph-house-line'}"></i>
            <span>${esc(b.name)}</span>
            ${b.status !== 'active' ? '<span class="houses-tab-badge">停</span>' : ''}
        </button>
    `).join('');

    return `
        <div class="card">
            <div class="flex justify-between items-center mb-2" style="gap: 1rem;">
                <div>
                    <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-house"></i> 房屋資料</h2>
                </div>
                <button class="btn btn-primary" id="btn-new-house" data-fab="ph-plus">
                    <i class="ph ph-plus"></i> 新增房屋
                </button>
            </div>
            <div class="houses-tabs">${tabsHtml}</div>
            <div class="houses-content" data-building-id="${esc(activeBuilding.id)}">
                ${renderBuildingDetail(activeBuilding)}
            </div>
        </div>
    `;
}

export function initHousesActions(scope) {
    const tabsEl = scope.querySelector('.houses-tabs');
    const contentEl = scope.querySelector('.houses-content');

    scope.querySelector('#btn-new-house')?.addEventListener('click', () => showHouseForm());
    initFlatpickr(scope);
    initCustomSelects(scope);

    if (tabsEl && contentEl) {
        tabsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-building-id]');
            if (!btn) return;
            const id = btn.dataset.buildingId;
            if (id === contentEl.dataset.buildingId) return;
            const building = mockData.buildings.find(b => b.id === id);
            if (!building) return;
            saveActiveBuildingId(id);
            editingSection = null;  // 切換房屋自動退出編輯
            tabsEl.querySelectorAll('[data-building-id]').forEach(b => b.classList.toggle('active', b === btn));
            contentEl.dataset.buildingId = id;
            contentEl.innerHTML = renderBuildingDetail(building);
            initFlatpickr(contentEl);
            initCustomSelects(contentEl);
        });

        contentEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action], [data-section-action]');
            if (!btn) return;
            // section 編輯 / 儲存 / 取消
            if (btn.hasAttribute('data-section-action')) {
                const sectionName = btn.closest('[data-section]')?.dataset.section;
                const building = mockData.buildings.find(b => b.id === contentEl.dataset.buildingId);
                if (building) handleSectionAction(building, sectionName, btn.dataset.sectionAction);
                return;
            }
            const action = btn.dataset.action;
            if (action === 'edit-house') {
                const building = mockData.buildings.find(b => b.id === btn.dataset.id);
                if (building) showHouseForm(building);
            }
            else if (action === 'manage-rooms') showBuildingRoomsModal(btn.dataset.buildingId);
            else if (action === 'toggle-status') {
                const building = mockData.buildings.find(b => b.id === btn.dataset.id);
                if (!building) return;
                const next = building.status === 'active' ? 'inactive' : 'active';
                store.updateBuilding(building.id, { status: next });
                showToast(`已${next === 'active' ? '啟用' : '停用'}：${building.name}`, 'success');
                refreshView();
            }
        });
    }
}

// 共用 inline section save handler (跟代管 managed-house.handleSectionAction 同款)
function handleSectionAction(building, sectionName, action) {
    if (!sectionName || !action) return;
    if (action === 'edit') {
        editingSection = sectionName;
        refreshView();
        return;
    }
    if (action === 'cancel') {
        editingSection = null;
        refreshView();
        return;
    }
    if (action === 'save') {
        const sectionEl = document.querySelector(`[data-section="${sectionName}"]`);
        if (!sectionEl) return;
        const inputs = sectionEl.querySelectorAll('.inline-edit-input');
        const patch = {};
        let hasError = false;
        inputs.forEach(input => {
            if (input.disabled) return;
            const key = input.dataset.inlineKey;
            if (!key) return;
            const coerce = input.dataset.inlineCoerce || 'text';
            const isCheckbox = input.type === 'checkbox';
            let raw = isCheckbox ? input.checked : input.value;
            let val;
            if (isCheckbox) val = !!raw;
            else if (coerce === 'number') val = raw === '' ? null : Number(raw);
            else if (coerce === 'bool') val = raw === 'true' || raw === true;
            else val = raw;
            if (key === 'name') {
                const nv = String(val || '').trim();
                if (!nv) { showToast('房屋名稱不可空', 'danger'); hasError = true; return; }
                const dup = mockData.buildings.find(b => b.name === nv && b.id !== building.id);
                if (dup) { showToast(`房屋名稱「${nv}」已存在`, 'danger'); hasError = true; return; }
            }
            patch[key] = val;
        });
        if (hasError) return;
        if (Object.keys(patch).length) store.updateBuilding(building.id, patch);
        editingSection = null;
        showToast('已儲存', 'success', 1800);
        refreshView();
    }
}

function showHouseForm(building = null) {
    const isEdit = !!building;
    openFormModal({
        title: isEdit ? `編輯房屋：${building.name}` : '新增房屋',
        maxWidth: 680,
        fields: [
            { name: '__section1', type: 'section', label: '基本資訊' },
            { name: 'name', label: '房屋名稱', type: 'text', required: true, placeholder: '例：松山館' },
            { name: 'status', label: '狀態', type: 'select', required: true, options: STATUS_OPTIONS, value: building?.status ?? 'active' },
            { name: 'baseAddress', label: '地址', type: 'text', span: 2, placeholder: '例：台北市松山區南京東路 50 號 X 樓' },
            { name: 'layout', label: '原始格局', type: 'text', placeholder: '例：3房2廳1衛' },
            { name: 'areaSize', label: '坪數', type: 'number', placeholder: '32.5' },

            { name: '__section2', type: 'section', label: '租金' },
            { name: 'monthlyRent', label: '月租金 (NT$)', type: 'number', placeholder: '例：45000' },
            { name: 'rentIncludesTax', label: '租金含稅', type: 'select', options: TAX_OPTIONS, value: building?.rentIncludesTax ? 'true' : 'false' },
            { name: 'taxReported', label: '是否報稅', type: 'select', options: BOOL_OPTIONS, value: building?.taxReported ? 'true' : 'false' },

            { name: '__section3', type: 'section', label: '屋主資料' },
            { name: 'ownerName', label: '姓名', type: 'text', placeholder: '王小明' },
            { name: 'ownerGender', label: '性別', type: 'select', options: GENDER_OPTIONS, value: building?.ownerGender ?? '' },
            { name: 'ownerPhone', label: '電話', type: 'text', placeholder: '0912-345-678' },
            { name: 'ownerEmail', label: '信箱', type: 'text', placeholder: 'wang@example.com' },
            { name: 'ownerLineId', label: 'LINE ID', type: 'text', span: 2, placeholder: '@wang0912 或 LINE userId' },

            { name: '__section4', type: 'section', label: '備註' },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 3, placeholder: '例：漏水修了 / 配合水電行：阿明 09xx...' }
        ],
        values: building ?? { status: 'active', rentIncludesTax: false, taxReported: false },
        submitLabel: isEdit ? '儲存變更' : '建立',
        onSubmit: (values) => {
            // boolean / number 轉型
            values.rentIncludesTax = values.rentIncludesTax === 'true' || values.rentIncludesTax === true;
            values.taxReported = values.taxReported === 'true' || values.taxReported === true;
            if (values.monthlyRent != null && values.monthlyRent !== '') values.monthlyRent = Number(values.monthlyRent);
            if (values.areaSize != null && values.areaSize !== '') values.areaSize = Number(values.areaSize);

            const dup = mockData.buildings.find(b => b.name === values.name && b.id !== building?.id);
            if (dup) {
                showToast(`房屋名稱「${values.name}」已存在`, 'danger');
                return false;
            }
            if (isEdit) {
                store.updateBuilding(building.id, values);
                showToast(`已更新：${values.name}`, 'success');
            } else {
                const created = store.addBuilding(values);
                showToast(`已新增房屋：${created.name}`, 'success');
                // 新建後自動切到該館 tab
                saveActiveBuildingId(created.id);
            }
            refreshView();
        }
    });
}
