// 屋主管理 — 代管模式專用
// list / filter (全部/待審核/合作中/已封存) / 新增 / 編輯 / 審核通過 / 封存
// 詳情顯示名下代管房屋 + 押金總額 (Phase 1+3)
import { mockData, store } from '../data.js';
import { openFormModal, openConfirm, showToast, refreshView } from '../utils/ui.js';
import { escapeHtml as esc } from '../utils/escape.js';

const SOURCE_OPTIONS = [
    { value: '員工面談',   label: '員工面談' },
    { value: '屋主自填',   label: '屋主自填 (公開表單)' },
    { value: '朋友推薦',   label: '朋友推薦' },
    { value: '其他',       label: '其他' }
];
const HOW_KNOWN_OPTIONS = [
    { value: 'Facebook',          label: 'Facebook' },
    { value: 'Google',            label: 'Google' },
    { value: '朋友介紹',          label: '朋友介紹' },
    { value: '路過看到我們的房子', label: '路過看到我們的房子' },
    { value: '其他',              label: '其他' }
];
const GENDER_OPTIONS = [
    { value: '',    label: '不指定' },
    { value: '男',  label: '男' },
    { value: '女',  label: '女' },
    { value: '其他', label: '其他' }
];

const STATUS_LABEL = {
    pending_review: { label: '待審核', cls: 'warning' },
    active:         { label: '合作中', cls: 'success' },
    archived:       { label: '已封存', cls: 'info' }
};

export function renderManagedOwners() {
    const owners = [...mockData.owners].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
    const counts = {
        all: owners.length,
        pending_review: owners.filter(o => o.status === 'pending_review').length,
        active:         owners.filter(o => o.status === 'active').length,
        archived:       owners.filter(o => o.status === 'archived').length
    };

    const rows = owners.map(o => {
        const st = STATUS_LABEL[o.status] || { label: o.status, cls: 'muted' };
        const myHouses = mockData.buildings.filter(b => b.mode === 'managed' && b.ownerId === o.id);
        return `
            <tr data-row-id="${esc(o.id)}" data-status="${esc(o.status)}" data-search="${esc((o.name + ' ' + (o.phone || '') + ' ' + (o.email || '')).toLowerCase())}">
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <strong>${esc(o.name || '(未命名)')}</strong>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">${esc(o.id)} · ${esc(o.gender || '')}</span>
                    </div>
                </td>
                <td>
                    <div>${esc(o.phone || '—')}</div>
                    <div style="font-size: var(--text-xs); color: var(--text-muted);">${esc(o.email || '')}</div>
                </td>
                <td>${esc(o.lineId || '—')}</td>
                <td>${esc(o.source || '')}</td>
                <td>${esc(o.howKnown || '') + (o.howKnown === '其他' && o.howKnownOther ? ` · ${esc(o.howKnownOther)}` : '')}</td>
                <td><span class="status-badge ${st.cls}">${st.label}</span></td>
                <td style="font-size: var(--text-sm);">
                    ${myHouses.length === 0 ? '<span style="color: var(--text-muted);">—</span>' : myHouses.map(h => `<a href="#m-house/${esc(h.id)}" style="color: var(--color-primary);">${esc(h.name)}</a>`).join(', ')}
                </td>
                <td>
                    <div style="display: flex; gap: 0.35rem;">
                        ${o.status === 'pending_review' ? `<button class="btn btn-success owner-action" data-action="approve" data-id="${esc(o.id)}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs);" title="審核通過"><i class="ph ph-check"></i></button>` : ''}
                        <button class="btn btn-outline owner-action" data-action="view" data-id="${esc(o.id)}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs);" title="詳情"><i class="ph ph-eye"></i></button>
                        <button class="btn btn-outline owner-action" data-action="edit" data-id="${esc(o.id)}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs);" title="編輯"><i class="ph ph-pencil"></i></button>
                        ${o.status !== 'archived' ? `<button class="btn btn-outline owner-action" data-action="archive" data-id="${esc(o.id)}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs); color: var(--color-danger);" title="封存"><i class="ph ph-archive"></i></button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <div>
                    <h2 class="card-title" style="margin-bottom: 0.25rem;"><i class="ph ph-user-circle"></i> 屋主管理</h2>
                    <p style="font-size: var(--text-xs); color: var(--text-muted); margin: 0;">公開表單送進來的屋主會落在「待審核」</p>
                </div>
                <button class="btn btn-primary" id="btn-new-owner" data-fab="ph-plus">
                    <i class="ph ph-plus"></i> 新增屋主
                </button>
            </div>
            <div class="filter-bar mb-4">
                <div class="filter-tabs">
                    <button class="filter-tab active" data-filter-value="all">全部 (${counts.all})</button>
                    <button class="filter-tab" data-filter-value="pending_review">⚠ 待審核 (${counts.pending_review})</button>
                    <button class="filter-tab" data-filter-value="active">合作中 (${counts.active})</button>
                    <button class="filter-tab" data-filter-value="archived">已封存 (${counts.archived})</button>
                </div>
            </div>
            <div class="table-container">
                <table class="data-table" style="table-layout: fixed;">
                    <colgroup>
                        <col style="width: 14%;">
                        <col style="width: 16%;">
                        <col style="width: 12%;">
                        <col style="width: 11%;">
                        <col style="width: 14%;">
                        <col style="width: 10%;">
                        <col style="width: 12%;">
                        <col style="width: 11%;">
                    </colgroup>
                    <thead><tr>
                        <th>屋主</th><th>聯絡</th><th>LINE ID</th><th>來源</th><th>怎麼知道</th><th>狀態</th><th>名下房屋</th><th>操作</th>
                    </tr></thead>
                    <tbody>${rows || `<tr><td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted);">尚無屋主資料</td></tr>`}</tbody>
                </table>
            </div>
        </div>
    `;
}

export function initManagedOwnersActions(scope) {
    scope.querySelector('#btn-new-owner')?.addEventListener('click', () => showOwnerForm());
    scope.addEventListener('click', (e) => {
        const btn = e.target.closest('.owner-action');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const owner = mockData.owners.find(o => o.id === id);
        if (!owner) return;
        if (action === 'edit') showOwnerForm(owner);
        else if (action === 'view') showOwnerDetail(owner);
        else if (action === 'approve') {
            store.approveOwner(owner.id);
            showToast(`已審核通過：${owner.name}`, 'success');
            refreshView();
        }
        else if (action === 'archive') {
            const count = store.ownerActiveHouseCount(owner.id);
            if (count > 0) {
                openConfirm({
                    title: '無法直接封存',
                    message: `屋主 <strong>${owner.name}</strong> 名下還有 <strong>${count}</strong> 棟啟用中代管房屋，請先停用該屋主名下所有代管房屋。`,
                    confirmLabel: '我知道了',
                    hideCancel: true
                });
                return;
            }
            openConfirm({
                title: `封存屋主：${owner.name}？`,
                message: '封存後不會出現在新增代管房屋的下拉選單，但歷史資料保留。可隨時編輯回「合作中」。',
                confirmLabel: '封存',
                danger: true,
                onConfirm: () => {
                    store.archiveOwner(owner.id);
                    showToast(`已封存：${owner.name}`, 'success');
                    refreshView();
                }
            });
        }
    });
}

function showOwnerDetail(owner) {
    const myHouses = mockData.buildings.filter(b => b.mode === 'managed' && b.ownerId === owner.id);
    const totalDeposit = myHouses.reduce((s, h) => s + store.ownerHoldingDepositTotal(h.id), 0);
    const html = `
        <div>
            <p><strong>${esc(owner.name)}</strong> (<code>${esc(owner.id)}</code>) —
                <span class="status-badge ${STATUS_LABEL[owner.status]?.cls}">${STATUS_LABEL[owner.status]?.label}</span></p>
            <table style="width: 100%; margin-top: 0.5rem; font-size: var(--text-sm);">
                <tr><td style="color: var(--text-muted); width: 30%;">性別</td><td>${esc(owner.gender || '—')}</td></tr>
                <tr><td style="color: var(--text-muted);">電話</td><td>${esc(owner.phone || '—')}</td></tr>
                <tr><td style="color: var(--text-muted);">信箱</td><td>${esc(owner.email || '—')}</td></tr>
                <tr><td style="color: var(--text-muted);">LINE ID</td><td>${esc(owner.lineId || '—')}</td></tr>
                <tr><td style="color: var(--text-muted);">來源</td><td>${esc(owner.source || '—')}</td></tr>
                <tr><td style="color: var(--text-muted);">怎麼知道</td><td>${esc(owner.howKnown || '—')}${owner.howKnown === '其他' && owner.howKnownOther ? ' · ' + esc(owner.howKnownOther) : ''}</td></tr>
                <tr><td style="color: var(--text-muted);">建檔時間</td><td>${esc(owner.submittedAt?.slice(0, 10) || '—')}</td></tr>
                <tr><td style="color: var(--text-muted);">審核時間</td><td>${esc(owner.reviewedAt?.slice(0, 10) || '—')}</td></tr>
            </table>
            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--color-background); border-radius: 4px;">
                <div style="font-weight: 600; margin-bottom: 0.5rem;"><i class="ph ph-house"></i> 名下代管房屋 (${myHouses.length})</div>
                ${myHouses.length === 0
                    ? '<span style="color: var(--text-muted);">尚無</span>'
                    : myHouses.map(h => `<div>• <a href="#m-house/${esc(h.id)}" style="color: var(--color-primary);">${esc(h.name)}</a> · ${esc(h.baseAddress || '無地址')}</div>`).join('')}
            </div>
            <div style="margin-top: 0.75rem; padding: 0.75rem; background: rgba(34, 148, 110, 0.06); border-radius: 4px;">
                <div style="font-weight: 600;"><i class="ph ph-vault"></i> 屋主目前持有押金 (跨房屋總計)</div>
                <div style="font-size: 1.15rem; color: var(--color-success); margin-top: 0.25rem;">NT$ ${totalDeposit.toLocaleString()}</div>
            </div>
            ${owner.note ? `<div style="margin-top: 0.75rem;"><div style="font-weight: 600;">備註</div><div style="white-space: pre-wrap; padding: 0.5rem; background: #fafbfc; border-radius: 4px;">${esc(owner.note)}</div></div>` : ''}
        </div>
    `;
    openConfirm({
        title: `屋主：${owner.name}`,
        message: html,
        confirmLabel: '關閉',
        hideCancel: true,
        maxWidth: 640
    });
}

export function showOwnerForm(owner = null, opts = {}) {
    const isEdit = !!owner;
    // ⚠ field 'name' 跟 HTMLFormElement.name property 衝突 → 用 ownerName
    openFormModal({
        title: isEdit ? `編輯屋主：${owner.name}` : '新增屋主',
        maxWidth: 600,
        fields: [
            { name: 'ownerName', label: '姓名', type: 'text', required: true },
            { name: 'gender', label: '性別', type: 'select', options: GENDER_OPTIONS, value: owner?.gender ?? '' },
            { name: 'phone', label: '電話', type: 'text', placeholder: '0912-345-678' },
            { name: 'email', label: '信箱', type: 'text', placeholder: 'name@example.com' },
            { name: 'lineId', label: 'LINE ID', type: 'text', span: 2, placeholder: '@xxx 或 userId' },
            { name: 'source', label: '來源', type: 'select', options: SOURCE_OPTIONS, value: owner?.source ?? '員工面談' },
            { name: 'howKnown', label: '怎麼知道我們的', type: 'select', options: HOW_KNOWN_OPTIONS, value: owner?.howKnown ?? '' },
            { name: 'howKnownOther', label: '其他說明', type: 'text', span: 2, hint: '怎麼知道選「其他」時填' },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 2 }
        ],
        values: owner ? { ...owner, ownerName: owner.name } : { source: '員工面談', status: 'active' },
        submitLabel: isEdit ? '儲存變更' : '建立',
        onSubmit: (values) => {
            values.name = values.ownerName;
            delete values.ownerName;
            if (isEdit) {
                store.updateOwner(owner.id, values);
                showToast(`已更新：${values.name}`, 'success');
            } else {
                const created = store.addOwner({ ...values, status: 'active' });
                showToast(`已新增屋主：${created.name}`, 'success');
                if (opts.onCreated) opts.onCreated(created);
            }
            if (!opts.skipRefresh) refreshView();
        }
    });
}
