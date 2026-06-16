// 房屋資料 — 物件管理 hub 第三個 tab
// 共居模式 (代管 fields 等代管 phase 再加，這邊先放共居共用欄位)
import { mockData, store, getSortedBuildings, bedOccupied } from '../data.js';
import { openFormModal, showToast, refreshView } from '../utils/ui.js';
import { escapeHtml as esc } from '../utils/escape.js';

const ENERGY_OPTIONS = [
    { value: 'tenant', label: '房客分攤' },
    { value: 'owner',  label: '房東/屋主全包' },
    { value: 'mixed',  label: '混合 (依備註)' }
];
const RENT_TERMS = [
    { value: '押二付一', label: '押二付一' },
    { value: '押二付二', label: '押二付二' },
    { value: '押三付一', label: '押三付一' },
    { value: '押三付二', label: '押三付二' },
    { value: '其他',     label: '其他' }
];
const STATUS_OPTIONS = [
    { value: 'active',   label: '啟用中' },
    { value: 'inactive', label: '已停用' }
];
const BOOL_OPTIONS = [
    { value: 'false', label: '否' },
    { value: 'true',  label: '是' }
];
const TAX_OPTIONS = [
    { value: 'false', label: '未稅' },
    { value: 'true',  label: '含稅' }
];

function energyLabel(mode) {
    return ENERGY_OPTIONS.find(o => o.value === mode)?.label || '<span style="color: var(--text-muted)">未設</span>';
}

export function renderHouses() {
    const buildings = getSortedBuildings();
    const { properties } = mockData;

    const statsOf = (bid) => {
        const beds = properties.filter(p => p.buildingId === bid);
        const rooms = new Set(beds.map(p => p.roomNumber)).size;
        const rented = beds.filter(p => bedOccupied(p.name)).length;
        return { rooms, totalBeds: beds.length, rented };
    };

    const rows = buildings.map(b => {
        const { rooms, totalBeds, rented } = statsOf(b.id);
        const isActive = b.status === 'active';
        const rentDisplay = b.monthlyRent != null
            ? `$${Number(b.monthlyRent).toLocaleString()}${b.rentIncludesTax ? ' <span style="font-size: var(--text-2xs); color: var(--text-muted);">含稅</span>' : ''}`
            : '<span style="color: var(--text-muted)">—</span>';
        const layoutLine = (b.layout || b.areaSize)
            ? `<div style="font-size: var(--text-xs); color: var(--text-muted);">${esc(b.layout || '')}${b.areaSize ? ` · ${b.areaSize}坪` : ''}</div>`
            : '';

        return `
            <tr class="${isActive ? '' : 'inactive-row'}" data-row-id="${esc(b.id)}">
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <strong>${esc(b.name)}</strong>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">${esc(b.id)}</span>
                    </div>
                </td>
                <td>
                    <div style="font-size: var(--text-sm);">${esc(b.baseAddress || '未設定')}</div>
                    ${layoutLine}
                </td>
                <td>${rentDisplay}</td>
                <td><span style="font-size: var(--text-sm);">${energyLabel(b.energyMode)}</span></td>
                <td>
                    <div style="font-size: var(--text-sm);">${rooms} 間 · ${totalBeds} 床</div>
                    <div style="font-size: var(--text-xs); color: var(--text-muted);">已租 ${rented} / 空 ${totalBeds - rented}</div>
                </td>
                <td><span class="status-badge ${isActive ? 'success' : 'info'}">${isActive ? '啟用' : '停用'}</span></td>
                <td>
                    <div style="display: flex; gap: 0.4rem;">
                        <button class="btn btn-outline house-action" data-action="edit" data-id="${esc(b.id)}" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" title="編輯房屋資料">
                            <i class="ph ph-pencil"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <div>
                    <h2 class="card-title" style="margin-bottom: 0.25rem;"><i class="ph ph-house"></i> 房屋資料</h2>
                    <p style="font-size: var(--text-xs); color: var(--text-muted); margin: 0;">記錄房屋詳細資訊（格局/坪數/月租金/能源費負擔/備註）— 房屋禁刪，不用請改停用</p>
                </div>
                <button class="btn btn-primary" id="btn-new-house" data-fab="ph-plus">
                    <i class="ph ph-plus"></i> 新增房屋
                </button>
            </div>
            <div class="table-container">
                <table class="data-table" style="table-layout: fixed;">
                    <colgroup>
                        <col style="width: 14%;">
                        <col style="width: 26%;">
                        <col style="width: 13%;">
                        <col style="width: 12%;">
                        <col style="width: 17%;">
                        <col style="width: 9%;">
                        <col style="width: 9%;">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>房屋</th><th>地址 / 格局</th><th>月租金</th><th>能源費</th><th>房間/床位</th><th>狀態</th><th>操作</th>
                        </tr>
                    </thead>
                    <tbody>${rows || `<tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">尚無房屋資料</td></tr>`}</tbody>
                </table>
            </div>
        </div>
    `;
}

export function initHousesActions(scope) {
    scope.querySelector('#btn-new-house')?.addEventListener('click', () => showHouseForm());
    scope.addEventListener('click', (e) => {
        const btn = e.target.closest('.house-action');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const building = mockData.buildings.find(b => b.id === id);
        if (action === 'edit' && building) showHouseForm(building);
    });
}

function showHouseForm(building = null) {
    const isEdit = !!building;
    openFormModal({
        title: isEdit ? `編輯房屋：${building.name}` : '新增房屋',
        maxWidth: 720,
        fields: [
            { name: 'name', label: '房屋名稱', type: 'text', required: true, placeholder: '例：松山館' },
            { name: 'status', label: '狀態', type: 'select', required: true, options: STATUS_OPTIONS, value: building?.status ?? 'active' },
            { name: 'baseAddress', label: '地址', type: 'text', span: 2, placeholder: '例：台北市松山區南京東路 50 號 X 樓' },
            { name: 'layout', label: '原始格局', type: 'text', placeholder: '例：3房2廳1衛' },
            { name: 'areaSize', label: '坪數', type: 'number', placeholder: '32.5' },
            { name: 'developer', label: '開發人', type: 'text', placeholder: '例：小K' },
            { name: 'manager', label: '管理人', type: 'text', placeholder: '例：Anna' },
            { name: 'monthlyRent', label: '月租金 (NT$)', type: 'number', placeholder: '例：45000' },
            { name: 'rentIncludesTax', label: '租金含稅', type: 'select', options: TAX_OPTIONS, value: building?.rentIncludesTax ? 'true' : 'false' },
            { name: 'rentTerm', label: '租金條件', type: 'select', options: RENT_TERMS, value: building?.rentTerm ?? '押二付一' },
            { name: 'taxReported', label: '是否報稅', type: 'select', options: BOOL_OPTIONS, value: building?.taxReported ? 'true' : 'false' },
            { name: 'energyMode', label: '能源費負擔', type: 'select', options: ENERGY_OPTIONS, value: building?.energyMode ?? 'tenant', hint: '水電瓦斯由誰繳' },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 3, placeholder: '例：漏水修了 / 配合水電行：阿明 09xx...' }
        ],
        values: building ?? { status: 'active', energyMode: 'tenant', rentTerm: '押二付一', rentIncludesTax: false, taxReported: false },
        submitLabel: isEdit ? '儲存變更' : '建立',
        onSubmit: (values) => {
            // boolean / number 轉型 (select 回 string)
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
            }
            refreshView();
        }
    });
}
