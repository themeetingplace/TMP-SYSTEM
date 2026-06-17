// 房屋資料 — 物件管理 hub 第三個 tab
// 一館一 tab 顯示 (不用列表)；共居 fields only，代管擴充等代管 phase 再加
import { mockData, store, getSortedBuildings, bedOccupied } from '../data.js';
import { openFormModal, showToast, refreshView } from '../utils/ui.js';
import { escapeHtml as esc } from '../utils/escape.js';
import { getMode } from '../utils/appMode.js';

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

function renderBuildingDetail(building) {
    const { rooms, totalBeds, rented } = statsOf(building.id);
    const isActive = building.status === 'active';
    const rentStr = building.monthlyRent != null
        ? `NT$ ${Number(building.monthlyRent).toLocaleString()}`
        : '';
    const rentTaxStr = building.monthlyRent != null
        ? (building.rentIncludesTax ? '含稅' : '未稅')
        : '';
    const layoutLine = [
        building.layout || '',
        building.areaSize ? `${building.areaSize} 坪` : ''
    ].filter(Boolean).join(' · ');

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
                <button class="btn btn-primary" data-action="edit-house" data-id="${esc(building.id)}">
                    <i class="ph ph-pencil"></i> 編輯房屋資料
                </button>
            </div>

            <div class="houses-section">
                <h4 class="houses-section-title"><i class="ph ph-info"></i> 基本資訊</h4>
                ${fieldRow('房屋編號', building.id)}
                ${fieldRow('房屋名稱', building.name)}
                ${fieldRow('地址', building.baseAddress)}
                ${fieldRow('原始格局 / 坪數', layoutLine)}
            </div>

            <div class="houses-section">
                <h4 class="houses-section-title"><i class="ph ph-currency-circle-dollar"></i> 租金</h4>
                ${fieldRow('月租金', rentStr, rentTaxStr)}
                ${fieldRow('是否報稅', building.taxReported ? '是' : (building.monthlyRent != null ? '否' : ''))}
            </div>

            <div class="houses-section">
                <h4 class="houses-section-title"><i class="ph ph-user-circle"></i> 屋主資料</h4>
                ${fieldRow('姓名', building.ownerName)}
                ${fieldRow('性別', building.ownerGender)}
                ${fieldRow('電話', building.ownerPhone)}
                ${fieldRow('信箱', building.ownerEmail)}
                ${fieldRow('LINE ID', building.ownerLineId)}
            </div>

            <div class="houses-section">
                <h4 class="houses-section-title"><i class="ph ph-note"></i> 備註</h4>
                <div class="houses-note">${building.note ? esc(building.note).replace(/\n/g, '<br>') : '<span style="color: var(--text-muted);">—</span>'}</div>
            </div>

            <div class="houses-section">
                <h4 class="houses-section-title"><i class="ph ph-bed"></i> 房間 / 床位</h4>
                <div style="font-size: var(--text-base);">
                    <strong>${rooms}</strong> 間 ·
                    <strong>${totalBeds}</strong> 床 ·
                    已租 <span style="color: var(--color-success); font-weight: 600;">${rented}</span> /
                    空 <span style="color: var(--color-warning); font-weight: 600;">${totalBeds - rented}</span>
                </div>
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

    if (tabsEl && contentEl) {
        tabsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-building-id]');
            if (!btn) return;
            const id = btn.dataset.buildingId;
            if (id === contentEl.dataset.buildingId) return;
            const building = mockData.buildings.find(b => b.id === id);
            if (!building) return;
            saveActiveBuildingId(id);
            tabsEl.querySelectorAll('[data-building-id]').forEach(b => b.classList.toggle('active', b === btn));
            contentEl.dataset.buildingId = id;
            contentEl.innerHTML = renderBuildingDetail(building);
        });

        contentEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="edit-house"]');
            if (!btn) return;
            const building = mockData.buildings.find(b => b.id === btn.dataset.id);
            if (building) showHouseForm(building);
        });
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
