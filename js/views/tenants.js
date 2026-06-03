import { mockData, store } from '../data.js';
import { openFormModal, openConfirm, openDetailModal, openModal, showToast, refreshView } from '../utils/ui.js';
import { escapeHtml as esc, escapeAttr } from '../utils/escape.js';

const TENANT_STATUSES = ['居住中', '待入住', '已退租'];

export function renderTenants() {
    const { tenants } = mockData;

    const totalTenants = tenants.length;
    const activeTenants = tenants.filter(t => t.status === '居住中').length;
    const pendingTenants = tenants.filter(t => t.status === '待入住').length;
    const inactiveTenants = tenants.filter(t => t.status === '已退租').length;

    // LINE 綁定統計 — 5/27 上線後追蹤用
    const activeBoundCount = tenants.filter(t => t.status === '居住中' && t.lineUserId).length;
    const activeUnboundCount = activeTenants - activeBoundCount;
    const bindRate = activeTenants > 0 ? Math.round(activeBoundCount / activeTenants * 100) : 0;

    const tableRows = tenants.map(t => {
        let statusClass = 'primary';
        if (t.status === '居住中') statusClass = 'success';
        if (t.status === '待入住') statusClass = 'warning';
        if (t.status === '已退租') statusClass = 'info';

        // LINE 綁定狀態 cell
        const lineBound = !!t.lineUserId;
        const lineCell = lineBound
            ? `<div style="display: flex; flex-direction: column; gap: 2px;">
                   <span class="status-badge success" style="font-size: 0.7rem; align-self: flex-start;"><i class="ph-fill ph-check-circle"></i> 已綁定</span>
                   ${t.lineDisplayName ? `<span style="font-size: 0.7rem; color: var(--text-muted);">${esc(t.lineDisplayName)}</span>` : ''}
               </div>`
            : (t.status === '居住中'
                ? `<span class="status-badge warning" style="font-size: 0.7rem;"><i class="ph ph-warning"></i> 未綁定</span>`
                : `<span style="color: var(--text-muted); font-size: 0.75rem;">—</span>`);

        const searchText = [t.name, t.phone, t.email, t.currentProperty || '', t.lineDisplayName || ''].join(' ').toLowerCase();

        return `
            <tr data-row-id="${esc(t.id)}" data-status="${esc(t.status)}" data-line="${lineBound ? 'bound' : 'unbound'}" data-search="${escapeAttr(searchText)}">
                <td>
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <div style="width: 40px; height: 40px; border-radius: var(--radius-full); background-color: var(--color-primary); color: var(--text-inverse); display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem;">
                            ${esc((t.name || '?').charAt(0))}
                        </div>
                        <div>
                            <strong style="font-size: 0.875rem;">${esc(t.name || '(未命名)')}</strong>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">${esc(t.email || '')}</div>
                        </div>
                    </div>
                </td>
                <td><div style="font-weight: 500;">${t.phone ? esc(t.phone) : '<span style="color: var(--text-muted)">—</span>'}</div></td>
                <td>
                    <div style="max-width: 200px;">
                        <div style="font-weight: 500; margin-bottom: 0.25rem;">${t.currentProperty ? esc(t.currentProperty) : '<span style="color: var(--text-muted)">未指定物件</span>'}</div>
                        <span class="status-badge ${statusClass}" style="font-size: 0.75rem;">${esc(t.status)}</span>
                    </div>
                </td>
                <td>${lineCell}</td>
                <td><div style="font-size: 0.875rem; color: var(--text-main);">${t.emergencyContact ? esc(t.emergencyContact) : '<span style="color: var(--text-muted)">--</span>'}</div></td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-outline tenant-action" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" data-action="view" data-id="${t.id}" title="詳細資料">
                            <i class="ph ph-eye"></i>
                        </button>
                        <button class="btn btn-outline tenant-action" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" data-action="edit" data-id="${t.id}" title="編輯資料">
                            <i class="ph ph-pencil"></i>
                        </button>
                        ${t.phone
                            ? `<a class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" href="tel:${t.phone.replace(/\D/g,'')}" title="撥打電話"><i class="ph ph-phone"></i></a>`
                            : `<button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; opacity: 0.4; cursor: not-allowed;" disabled title="無電話"><i class="ph ph-phone"></i></button>`}
                        <button class="btn btn-outline tenant-action" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--color-danger);" data-action="delete" data-id="${t.id}" title="刪除">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="metrics-grid">
            <div class="card metric-card"><div class="metric-header"><span>總租客數</span><div class="metric-icon primary"><i class="ph ph-users"></i></div></div><div class="metric-value">${totalTenants}</div><div class="metric-subtext">所有租客記錄</div></div>
            <div class="card metric-card"><div class="metric-header"><span>現居租客</span><div class="metric-icon success"><i class="ph ph-house-line"></i></div></div><div class="metric-value">${activeTenants}</div><div class="metric-subtext">目前居住中</div></div>
            <div class="card metric-card ${activeUnboundCount > 0 ? 'highlight-warning' : ''}">
                <div class="metric-header"><span>LINE 綁定</span><div class="metric-icon ${activeUnboundCount > 0 ? 'warning' : 'success'}"><i class="ph ph-link"></i></div></div>
                <div class="metric-value" style="color: ${activeUnboundCount > 0 ? 'var(--color-warning)' : 'var(--color-success)'};">${bindRate}%</div>
                <div class="metric-subtext">${activeBoundCount} / ${activeTenants} 現住客已綁${activeUnboundCount > 0 ? ` · 待催 ${activeUnboundCount} 位` : ''}</div>
            </div>
            <div class="card metric-card"><div class="metric-header"><span>已退租</span><div class="metric-icon info"><i class="ph ph-sign-out"></i></div></div><div class="metric-value">${inactiveTenants}</div><div class="metric-subtext">歷史租客</div></div>
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-users"></i> 租客清單</h2>
                <div class="flex gap-2">
                    <div class="search-bar" style="width: 250px;">
                        <i class="ph ph-magnifying-glass"></i>
                        <input type="text" placeholder="搜尋租客姓名或電話..." style="font-size: 0.875rem;">
                    </div>
                    <button class="btn btn-primary" id="btn-new-tenant">
                        <i class="ph ph-user-plus"></i> 新增租客
                    </button>
                </div>
            </div>

            <div class="filter-bar mb-4">
                <div class="filter-tabs">
                    <button class="filter-tab active" data-filter-value="all">全部 (${totalTenants})</button>
                    <button class="filter-tab" data-filter-value="居住中">居住中 (${activeTenants})</button>
                    <button class="filter-tab" data-filter-value="待入住">待入住 (${pendingTenants})</button>
                    <button class="filter-tab" data-filter-value="已退租">已退租 (${inactiveTenants})</button>
                </div>
                ${activeUnboundCount > 0 ? `
                    <button class="filter-chip" data-filter-value="unbound" data-filter-group="line" title="只顯示尚未綁定 LINE 的居住中租客 (點擊切換)">
                        <i class="ph ph-warning"></i> 只看未綁 LINE
                        <span class="filter-chip-count">${activeUnboundCount}</span>
                    </button>
                ` : ''}
            </div>

            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>租客資訊</th><th>聯絡方式</th><th>居住狀態</th><th>LINE 綁定</th><th>緊急聯絡人</th><th>操作</th></tr></thead>
                    <tbody>${tableRows}</tbody>
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

function showTenantForm(tenant = null) {
    const isEdit = !!tenant;
    const propertyOptions = [
        '',
        ...mockData.properties.map(p => p.name)
    ];
    const sourceOptions = (mockData.tenantSources || []).map(s => ({ value: s.name, label: s.name }));
    const defaultSource = sourceOptions[0]?.value || '';
    openFormModal({
        title: isEdit ? `編輯租客：${tenant.name}` : '新增租客',
        maxWidth: 700,
        fields: [
            { name: 'source', label: '顧客來源', type: 'select', required: true, span: 2, options: sourceOptions, value: tenant?.source ?? defaultSource, hint: '從哪邊聯絡我們的（系統設定可新增來源）' },
            { name: 'name', label: '姓名', type: 'text', required: true },
            { name: 'phone', label: '電話', type: 'tel', required: true, placeholder: '例：0912-345-678' },
            { name: 'email', label: '電子郵件', type: 'email', required: true, span: 2 },
            { name: 'status', label: '狀態', type: 'select', required: true, options: TENANT_STATUSES, value: tenant?.status ?? '待入住' },
            { name: 'currentProperty', label: '目前物件', type: 'select', options: propertyOptions, hint: '可選擇住客所在物件' },
            { name: 'emergencyContact', label: '緊急聯絡人', type: 'text', span: 2, placeholder: '例：王小明 (0911-222-333)' },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 3, placeholder: '寫一些關於這位租客的備忘（個性、特殊狀況、注意事項…）' }
        ],
        values: tenant ?? {},
        submitLabel: isEdit ? '儲存變更' : '建立',
        onSubmit: (values) => {
            if (isEdit) {
                store.updateTenant(tenant.id, values);
                showToast(`已更新：${values.name}`, 'success');
            } else {
                const created = store.addTenant(values);
                showToast(`已新增租客：${created.name}`, 'success');
            }
            refreshView();
        }
    });
}

export function showTenantDetails(id) {
    const t = mockData.tenants.find(x => x.id === id);
    if (!t) return;
    const statusClass = t.status === '居住中' ? 'success' : t.status === '待入住' ? 'warning' : 'info';

    // 入住紀錄 — 該租客所有合約（含 active / renewed / terminated），按起始日新→舊
    const allContracts = mockData.contracts
        .filter(c => c.tenant === t.name)
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

    const today = new Date().toISOString().slice(0, 10);
    const stateLabel = (c) => {
        if (c.renewalState === 'terminated') return { text: '已退租', cls: 'info' };
        if (c.renewalState === 'renewed') return { text: '已續約', cls: 'primary' };
        if (c.endDate && c.endDate < today) return { text: '已過期', cls: 'danger' };
        if (c.startDate && c.startDate > today) return { text: '未開始', cls: 'warning' };
        return { text: '進行中', cls: 'success' };
    };

    const historyRows = allContracts.length === 0
        ? `<tr><td colspan="5" style="text-align: center; padding: 1.25rem; color: var(--text-muted); font-size: 0.85rem;">尚無入住紀錄</td></tr>`
        : allContracts.map(c => {
            const s = stateLabel(c);
            return `
                <tr>
                    <td style="font-family: monospace; font-size: 0.8rem;">${c.id}</td>
                    <td>${(c.propertyName || '—').replace('聚空間 - ', '')}</td>
                    <td style="font-size: 0.78rem; color: var(--text-secondary);">${c.startDate || '—'} ~ ${c.endDate || '—'}</td>
                    <td style="text-align: right; font-weight: 600;">$${(c.amount || 0).toLocaleString()}</td>
                    <td><span class="status-badge ${s.cls}" style="font-size: 0.7rem;">${s.text}</span></td>
                </tr>
            `;
        }).join('');

    const historyHtml = `
        <div style="margin-top: 1.5rem;">
            <h3 style="font-size: 0.95rem; font-weight: 600; margin: 0 0 0.6rem; color: var(--text-main); display: flex; align-items: center; gap: 0.4rem;">
                <i class="ph ph-clock-counter-clockwise"></i> 入住紀錄
                <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 400;">共 ${allContracts.length} 筆</span>
            </h3>
            <div style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
                    <thead>
                        <tr style="background: var(--bg-tertiary);">
                            <th style="padding: 0.45rem 0.6rem; text-align: left; color: var(--text-muted); font-weight: 600;">合約</th>
                            <th style="padding: 0.45rem 0.6rem; text-align: left; color: var(--text-muted); font-weight: 600;">床位</th>
                            <th style="padding: 0.45rem 0.6rem; text-align: left; color: var(--text-muted); font-weight: 600;">期間</th>
                            <th style="padding: 0.45rem 0.6rem; text-align: right; color: var(--text-muted); font-weight: 600;">月租</th>
                            <th style="padding: 0.45rem 0.6rem; text-align: left; color: var(--text-muted); font-weight: 600;">狀態</th>
                        </tr>
                    </thead>
                    <tbody>${historyRows}</tbody>
                </table>
            </div>
        </div>
    `;

    openDetailModal({
        title: '租客詳細資料',
        maxWidth: 640,
        items: [
            { label: '租客編號', value: t.id },
            { label: '姓名', value: t.name },
            { label: '顧客來源', value: t.source ? `<span class="status-badge info">${t.source}</span>` : '<span style="color: var(--text-muted)">未填</span>' },
            { label: '電話', value: t.phone ? `<a href="tel:${t.phone.replace(/\D/g,'')}">${t.phone}</a>` : '—' },
            { label: '電子郵件', value: t.email ? `<a href="mailto:${t.email}">${t.email}</a>` : '—' },
            { label: '狀態', value: `<span class="status-badge ${statusClass}">${t.status}</span>` },
            { label: '目前物件', value: t.currentProperty || '無' },
            { label: '緊急聯絡人', value: t.emergencyContact || '無' },
            { label: 'LINE 綁定', value: t.lineUserId
                ? `<span class="status-badge success"><i class="ph-fill ph-check-circle"></i> 已綁定</span>${t.lineDisplayName ? ` · ${t.lineDisplayName}` : ''}`
                : '<span style="color: var(--text-muted)">未綁定</span>' },
            { label: '備註', value: t.note
                ? `<span style="white-space: pre-wrap; color: var(--text-main);">${t.note.replace(/</g, '&lt;')}</span>`
                : '<span style="color: var(--text-muted)">無</span>' }
        ],
        extraHtml: historyHtml
    });
}

// 「編輯備註」focused modal — 點租客名字打開
// 只能改備註，其他欄位都不能動 (要改其他資料請走完整租客 form)
export function showTenantNoteEditor(tenantId) {
    const t = mockData.tenants.find(x => x.id === tenantId);
    if (!t) return;

    const subtitle = t.currentProperty
        ? `${t.name} · ${t.currentProperty.replace('聚空間 - ', '')}`
        : t.name;
    const initialNote = t.note || '';

    const bodyHtml = `
        <div style="margin-bottom: 0.25rem;">
            <textarea id="tenant-note-input"
                rows="6"
                placeholder="例：作息較晚、對噪音敏感、家人聯絡為長女…"
                style="width: 100%; min-height: 180px; max-height: 50vh; padding: 0.875rem 1rem;
                       border: 1px solid var(--border-color); border-radius: 8px; resize: vertical;
                       font: 0.9375rem/1.6 'Noto Sans TC', -apple-system, sans-serif; color: var(--text-main);
                       background: #fffdfb; outline: none; box-sizing: border-box;
                       transition: border-color 0.15s, box-shadow 0.15s;">${initialNote.replace(/</g, '&lt;')}</textarea>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--text-muted); display: flex; justify-content: space-between;">
            <span><kbd style="font-family: inherit; padding: 1px 6px; background: var(--bg-tertiary); border-radius: 4px;">Ctrl + Enter</kbd> 儲存</span>
            <span id="tenant-note-count"></span>
        </div>
    `;

    const footerHtml = `
        <button type="button" class="btn btn-outline" data-action="cancel">取消</button>
        <button type="button" class="btn btn-primary" id="tenant-note-save">儲存</button>
    `;

    openModal({
        title: '編輯備註',
        bodyHtml: `<div style="margin: -0.25rem 0 0; padding: 0 0 1rem; font-size: 0.875rem; color: var(--text-muted); border-bottom: 1px dashed var(--border-color); margin-bottom: 1rem;">${subtitle}</div>${bodyHtml}`,
        footerHtml,
        maxWidth: 480,
        onMount: (overlay, close) => {
            const textarea = overlay.querySelector('#tenant-note-input');
            const counter = overlay.querySelector('#tenant-note-count');
            const saveBtn = overlay.querySelector('#tenant-note-save');
            const cancelBtn = overlay.querySelector('[data-action="cancel"]');

            // 文字計數 (>200 才顯示)
            const updateCount = () => {
                const len = textarea.value.length;
                counter.textContent = len > 200 ? `${len} 字` : '';
            };
            textarea.addEventListener('input', updateCount);

            // focus ring
            textarea.addEventListener('focus', () => {
                textarea.style.borderColor = 'var(--color-primary)';
                textarea.style.boxShadow = '0 0 0 3px rgba(255, 136, 89, 0.18)';
            });
            textarea.addEventListener('blur', () => {
                textarea.style.borderColor = 'var(--border-color)';
                textarea.style.boxShadow = 'none';
            });

            // 儲存邏輯
            const doSave = () => {
                const newNote = textarea.value.trim();
                store.updateTenant(tenantId, { note: newNote || null });
                // 視覺回饋：按鈕變綠 "已儲存 ✓" 800ms 後關閉 + 重整
                saveBtn.textContent = '已儲存 ✓';
                saveBtn.style.background = 'var(--color-success)';
                saveBtn.disabled = true;
                setTimeout(() => {
                    close();
                    refreshView();
                }, 800);
            };

            saveBtn.addEventListener('click', doSave);
            cancelBtn.addEventListener('click', close);

            // Ctrl/Cmd + Enter 快捷鍵
            textarea.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    doSave();
                }
            });

            // 預設 focus + 游標到結尾
            setTimeout(() => {
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            }, 50);
            updateCount();
        }
    });
}

function confirmDelete(id) {
    const t = mockData.tenants.find(x => x.id === id);
    if (!t) return;
    openConfirm({
        title: '刪除租客',
        message: `確定要刪除 <strong>${t.name}</strong> 的紀錄嗎？此動作無法還原。`,
        danger: true,
        confirmLabel: '確定刪除',
        onConfirm: () => {
            store.deleteTenant(id);
            showToast('已刪除租客', 'success');
            refreshView();
        }
    });
}

export function initTenantActions(scope) {
    scope.querySelector('#btn-new-tenant')?.addEventListener('click', () => showTenantForm());
    scope.querySelectorAll('.tenant-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const id = e.currentTarget.dataset.id;
            const tenant = mockData.tenants.find(t => t.id === id);
            if (!tenant) return;
            if (action === 'view') showTenantDetails(id);
            if (action === 'edit') showTenantForm(tenant);
            if (action === 'delete') confirmDelete(id);
        });
    });
}
