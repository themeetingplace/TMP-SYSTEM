import { mockData, store } from '../data.js';
import { openFormModal, openConfirm, openDetailModal, showToast, showUndoToast, refreshView } from '../utils/ui.js';
import { escapeHtml as esc, escapeAttr } from '../utils/escape.js';
import { filterMaintenancesByMode, filterPropertiesByMode } from '../utils/modeFilter.js';
import { getMode } from '../utils/appMode.js';
import { moneyAmount } from '../utils/moneyDisplay.js';
import { rowActions, rowActionGroup } from '../utils/rowActions.js';
import { entityCard } from '../utils/entityCard.js';
import { emptyState } from '../utils/emptyState.js';

const MAINTENANCE_STATUSES = ['待處理', '進行中', '已完成'];
const TODAY = new Date().toISOString().split('T')[0];

export function renderMaintenance() {
    const maintenances = filterMaintenancesByMode(mockData.maintenances);

    const totalRequests = maintenances.length;
    const pendingCount = maintenances.filter(m => m.status === '待處理').length;
    const inProgressCount = maintenances.filter(m => m.status === '進行中').length;
    const completedCount = maintenances.filter(m => m.status === '已完成').length;

    const tableRows = maintenances.map(m => {
        let statusClass = 'primary';
        if (m.status === '待處理') statusClass = 'danger';
        if (m.status === '進行中') statusClass = 'warning';
        if (m.status === '已完成') statusClass = 'success';

        const days = Math.floor((new Date(TODAY) - new Date(m.reportDate)) / 86400000);
        const searchText = [m.id, m.propertyName, m.issue, m.reporter].join(' ').toLowerCase();

        const actionsHtml = rowActionGroup(rowActions([
            m.status === '待處理' ? { action: 'start', icon: 'ph-play', title: '開始處理', variant: 'primary', className: 'maintenance-action' } : null,
            m.status === '進行中' ? { action: 'complete', icon: 'ph-check', title: '完成維修', variant: 'success', className: 'maintenance-action' } : null,
            { action: 'view', icon: 'ph-eye', title: '查看記錄', className: 'maintenance-action' },
            { action: 'edit', icon: 'ph-pencil', title: '編輯維修', className: 'maintenance-action' },
            { action: 'delete', icon: 'ph-trash', title: '刪除', variant: 'danger', className: 'maintenance-action' }
        ], m.id));

        const statusBadge = `<span class="status-badge ${statusClass}">${esc(m.status)}</span>`;
        const urgency = days >= 7 ? { label: `逾期 ${days} 天`, type: 'danger' }
            : days >= 3 ? { label: `${days} 天前`, type: 'warning' }
            : { label: `${days} 天前`, type: 'default' };

        const mobileCardHtml = entityCard({
            title: esc(m.id),
            subtitle: esc(m.propertyName || ''),
            hero: {
                value: m.cost ? moneyAmount(m.cost) : '',
                badge: statusBadge
            },
            chips: [
                { icon: 'ph-calendar', label: esc(m.reportDate || '—') },
                { icon: 'ph-timer', label: urgency.label, type: urgency.type },
                { icon: 'ph-user', label: esc(m.reporter || '—') }
            ],
            meta: [
                { cap: '問題', val: esc(m.issue || '—') },
                { cap: '完工日', val: m.status === '已完成' && m.completedDate ? esc(m.completedDate) : '—' }
            ],
            actions: actionsHtml
        });

        const sharedAttrs = `data-row-id="${esc(m.id)}" data-status="${esc(m.status)}" data-search="${escapeAttr(searchText)}"`;

        return `
            <tr ${sharedAttrs} class="row-desktop">
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <strong style="font-size: var(--text-base);">${esc(m.id)}</strong>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">${esc(m.propertyName || '')}</span>
                    </div>
                </td>
                <td>
                    <div style="max-width: 200px;">
                        <div style="font-weight: 500; margin-bottom: 0.25rem;">${esc(m.issue || '')}</div>
                        <div style="font-size: var(--text-xs); color: var(--text-muted);">回報人: ${esc(m.reporter || '—')}</div>
                    </div>
                </td>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-weight: 500;">${esc(m.reportDate || '')}</span>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">${days} 天前</span>
                    </div>
                </td>
                <td>${statusBadge}</td>
                <td>${m.cost ? `<div style="font-weight: 500;">${moneyAmount(m.cost)}</div>` : '<span style="color: var(--text-muted)">--</span>'}</td>
                <td>${actionsHtml}</td>
            </tr>
            <tr ${sharedAttrs} class="row-mobile-card">
                <td colspan="6">${mobileCardHtml}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="metrics-grid">
            <div class="card metric-card"><div class="metric-header"><span>總維修單</span><div class="metric-icon primary"><i class="ph ph-wrench"></i></div></div><div class="metric-value">${totalRequests}</div><div class="metric-subtext">所有維修請求</div></div>
            <div class="card metric-card"><div class="metric-header"><span>待處理</span><div class="metric-icon danger"><i class="ph ph-clock"></i></div></div><div class="metric-value">${pendingCount}</div><div class="metric-subtext">需要立即處理</div></div>
            <div class="card metric-card"><div class="metric-header"><span>進行中</span><div class="metric-icon warning"><i class="ph ph-spinner"></i></div></div><div class="metric-value">${inProgressCount}</div><div class="metric-subtext">維修作業中</div></div>
            <div class="card metric-card"><div class="metric-header"><span>已完成</span><div class="metric-icon success"><i class="ph ph-check-circle"></i></div></div><div class="metric-value">${completedCount}</div><div class="metric-subtext">維修完成</div></div>
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-wrench"></i> 維修任務管理</h2>
                <div class="flex gap-2">
                    <div class="search-bar" style="width: 250px;">
                        <i class="ph ph-magnifying-glass"></i>
                        <input type="text" placeholder="搜尋工單編號或物件..." style="font-size: var(--text-base);">
                    </div>
                    <button class="btn btn-primary" id="btn-new-maintenance" data-fab="ph-wrench">
                        <i class="ph ph-plus"></i> 新增報修
                    </button>
                </div>
            </div>

            <div class="filter-tabs mb-4">
                <button class="filter-tab active" data-filter-value="all">全部 (${totalRequests})</button>
                <button class="filter-tab" data-filter-value="待處理">待處理 (${pendingCount})</button>
                <button class="filter-tab" data-filter-value="進行中">進行中 (${inProgressCount})</button>
                <button class="filter-tab" data-filter-value="已完成">已完成 (${completedCount})</button>
            </div>

            <div class="table-container">
                <table class="data-table" style="table-layout: fixed;">
                    <colgroup>
                        <col style="width: 22%;">
                        <col style="width: 28%;">
                        <col style="width: 13%;">
                        <col style="width: 10%;">
                        <col style="width: 12%;">
                        <col style="width: 15%;">
                    </colgroup>
                    <thead><tr><th>工單資訊</th><th>報修內容</th><th>回報時間</th><th>狀態</th><th>維修費用</th><th>操作</th></tr></thead>
                    <tbody>${tableRows || emptyState({ mode: 'table-row', colspan: 6, icon: 'ph-wrench', title: '尚無維修單', hint: '點右上「新增報修」建立第一筆工單' })}</tbody>
                </table>
            </div>

            <div class="pagination-container" style="display: flex; justify-content: center; margin-top: 2rem;">
                <div class="pagination">
                    <button class="btn btn-outline" disabled><i class="ph ph-caret-left"></i></button>
                    <span class="pagination-info">第 1 頁，共 1 頁</span>
                    <button class="btn btn-outline" disabled><i class="ph ph-caret-right"></i></button>
                </div>
            </div>
        </div>
    `;
}

function showMaintenanceForm(item = null) {
    const isEdit = !!item;
    // 館別 + 物件 cascade (對齊 contracts.js / checkin / unsettled)
    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    const modeBuildingIds = new Set(mockData.buildings.filter(b => (b.mode || 'cohousing') === targetMode).map(b => b.id));
    const buildingOptions = mockData.buildings
        .filter(b => (b.mode || 'cohousing') === targetMode)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(b => ({ value: b.id, label: b.name }));
    // 初始 buildingId: 編輯時優先讀 item.buildingId, 沒有則從 propertyName 反查
    const currentProperty = item?.propertyName ? mockData.properties.find(p => p.name === item.propertyName) : null;
    const initialBuildingId = item?.buildingId || currentProperty?.buildingId || buildingOptions[0]?.value || '';
    // 物件 options builder: 依 buildingId filter (沒選館則用整個 mode)
    const buildPropertyOptions = (buildingId) => mockData.properties
        .filter(p => buildingId ? p.buildingId === buildingId : modeBuildingIds.has(p.buildingId))
        .slice()
        .sort((a, b) => {
            const ra = Number(a.roomNumber ?? 999), rb = Number(b.roomNumber ?? 999);
            if (ra !== rb) return ra - rb;
            return (a.bedLetter || '').localeCompare(b.bedLetter || '');
        })
        .map(p => ({ value: p.name, label: p.name.replace('聚空間 - ', '') }));
    const propertyOptions = buildPropertyOptions(initialBuildingId);

    openFormModal({
        title: isEdit ? `編輯維修：${item.id}` : '新增報修',
        maxWidth: 700,
        fields: [
            { name: 'buildingId', label: '館別', type: 'select', required: true, options: buildingOptions, value: initialBuildingId },
            { name: 'propertyName', label: '物件', type: 'select', required: true, options: propertyOptions },
            { name: 'reporter', label: '回報人', type: 'text', required: true, placeholder: '例：王大明' },
            { name: 'reportDate', label: '回報日期', type: 'date', required: true, value: item?.reportDate ?? TODAY },
            { name: 'status', label: '狀態', type: 'select', required: true, options: MAINTENANCE_STATUSES, value: item?.status ?? '待處理' },
            { name: 'issue', label: '問題描述', type: 'textarea', required: true, span: 2, placeholder: '例：冷氣不冷，會滴水' },
            { name: 'cost', label: '維修費用', type: 'number', span: 2, hint: '完成後可填入' }
        ],
        values: { ...(item ?? {}), buildingId: initialBuildingId },
        submitLabel: isEdit ? '儲存變更' : '建立',
        onFormMount: (form) => {
            // 館別變更 → 重 build 物件下拉 (filter 該館床位)
            const buildingHidden = form.querySelector('[name="buildingId"]');
            const propertyWrap = form.querySelector('.custom-select[data-name="propertyName"]');
            const propertyHidden = form.querySelector('[name="propertyName"]');
            buildingHidden?.addEventListener('change', () => {
                const bid = buildingHidden.value;
                if (propertyWrap?.__setOptions) {
                    // __setOptions 內部已自動清 hidden.value + 重設 trigger 文字, 不需手動重置
                    propertyWrap.__setOptions(buildPropertyOptions(bid));
                }
            });
        },
        onSubmit: (values) => {
            // 確保 buildingId 跟 propertyName 對齊 (avoid 漂移): 以 propertyName 反查為準
            const prop = mockData.properties.find(p => p.name === values.propertyName);
            if (prop?.buildingId) values.buildingId = prop.buildingId;
            if (isEdit) {
                store.updateMaintenance(item.id, values);
                showToast('已更新維修單', 'success');
            } else {
                const created = store.addMaintenance(values);
                showToast(`已建立維修單：${created.id}`, 'success');
            }
            refreshView();
        }
    });
}

export function showMaintenanceDetails(id) {
    const m = mockData.maintenances.find(x => x.id === id);
    if (!m) return;
    const statusClass = m.status === '待處理' ? 'danger' : m.status === '進行中' ? 'warning' : 'success';
    openDetailModal({
        title: `維修單 ${m.id}`,
        items: [
            { label: '物件', value: m.propertyName },
            { label: '狀態', value: `<span class="status-badge ${statusClass}">${m.status}</span>` },
            { label: '回報人', value: m.reporter },
            { label: '回報日期', value: m.reportDate },
            { label: '維修費用', value: m.cost ? moneyAmount(m.cost) : '尚未產生' }
        ],
        extraHtml: `
            <div style="margin-top: 1.5rem;">
                <div style="font-size: var(--text-xs); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">問題描述</div>
                <div style="padding: 1rem; background-color: var(--color-background); border-radius: var(--radius-md); font-size: var(--text-base); line-height: 1.6;">${m.issue}</div>
            </div>
        `
    });
}

function startMaintenance(id) {
    store.updateMaintenance(id, { status: '進行中' });
    showToast('維修已開始處理', 'success');
    refreshView();
}

function completeMaintenance(id) {
    const m = mockData.maintenances.find(x => x.id === id);
    if (!m) return;
    openFormModal({
        title: '完成維修',
        maxWidth: 480,
        fields: [
            { name: 'cost', label: '維修費用 (TWD)', type: 'number', required: true, span: 2 }
        ],
        submitLabel: '標記完成',
        onSubmit: ({ cost }) => {
            store.updateMaintenance(id, { status: '已完成', cost });
            showToast('維修已完成', 'success');
            refreshView();
        }
    });
}

function confirmDelete(id) {
    const m = mockData.maintenances.find(x => x.id === id);
    if (!m) return;
    openConfirm({
        title: '刪除維修單',
        message: `確定要刪除維修單 <strong>${m.id}</strong> 嗎？`,
        danger: true,
        confirmLabel: '確定刪除',
        onConfirm: () => {
            // 軟刪除 + 5 秒 undo
            const snap = JSON.parse(JSON.stringify(m));
            mockData.maintenances = mockData.maintenances.filter(x => x.id !== id);
            refreshView();
            showUndoToast({
                message: `已刪除維修單 ${m.id}`,
                durationMs: 5000,
                onUndo: () => {
                    mockData.maintenances.push(snap);
                    refreshView();
                    showToast('已復原', 'success');
                },
                onCommit: () => {
                    window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'maintenances', id: snap.id } }));
                }
            });
        }
    });
}

export function initMaintenanceActions(scope) {
    scope.querySelector('#btn-new-maintenance')?.addEventListener('click', () => showMaintenanceForm());
    scope.querySelectorAll('.maintenance-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const id = e.currentTarget.dataset.id;
            const m = mockData.maintenances.find(x => x.id === id);
            if (!m) return;
            if (action === 'view') showMaintenanceDetails(id);
            if (action === 'edit') showMaintenanceForm(m);
            if (action === 'start') startMaintenance(id);
            if (action === 'complete') completeMaintenance(id);
            if (action === 'delete') confirmDelete(id);
        });
    });
}
