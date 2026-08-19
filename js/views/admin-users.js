// 帳號管理 — owner 專用
// 列出所有 admin，可新增 / 刪除其他帳號
// RLS 已經把 INSERT/UPDATE/DELETE 限制給 owner，這層 UI 只是讓 owner 不用 SQL 也能操作
//
// 注意：帳號加進 admins table 之後，該 email 還要實際用 Google 登入過一次
// Supabase 才會建出對應的 auth.users。本表只控「准不准進」，不負責建 auth 帳號

import { supabase } from '../supabase.js';
import { getSession } from '../auth.js';
import { mockData, getSortedBuildings } from '../data.js';
import { openFormModal, openConfirm, showToast } from '../utils/ui.js';
import { escapeHtml as esc, escapeAttr } from '../utils/escape.js';
import { rowAction, rowActionGroup } from '../utils/rowActions.js';
import { emptyState } from '../utils/emptyState.js';

// 小幫手可看的館別 — 給指派選單 (共居、啟用中)
function helperBuildingChoices() {
    return getSortedBuildings({ activeOnly: true }).filter(b => (b.mode || 'cohousing') === 'cohousing');
}
// 列表裡顯示某小幫手可看哪些館 (空 = 警示看不到)
function helperBuildingsLabel(ids) {
    const arr = Array.isArray(ids) ? ids : [];
    if (!arr.length) {
        return `<div style="font-size: var(--text-2xs); color: var(--color-danger); margin-top: 0.25rem;">⚠ 未指定館別（看不到任何資料）</div>`;
    }
    const names = arr.map(id => (mockData.buildings.find(b => b.id === id)?.name) || id);
    return `<div style="font-size: var(--text-2xs); color: var(--text-muted); margin-top: 0.25rem;">可看：${esc(names.join('、'))}</div>`;
}

let cachedAdmins = [];
let currentEmail = null;

async function loadAdmins() {
    const { data, error } = await supabase
        .from('admins')
        .select('*')
        .order('created_at', { ascending: true });
    if (error) {
        console.error('[admin-users] load failed:', error);
        showToast(`載入失敗：${error.message}`, 'danger');
        return [];
    }
    return data || [];
}

function roleBadge(role) {
    if (role === 'owner') {
        return `<span class="status-badge primary" title="可管理其他帳號"><i class="ph-fill ph-crown" aria-hidden="true"></i> Owner</span>`;
    }
    if (role === 'helper') {
        return `<span class="status-badge info" title="小幫手 — 只能檢視部分資料，不可編輯"><i class="ph-fill ph-hand-heart" aria-hidden="true"></i> 小幫手</span>`;
    }
    if (role === 'viewer') {
        return `<span class="status-badge muted"><i class="ph-fill ph-eye" aria-hidden="true"></i> Viewer</span>`;
    }
    return `<span class="status-badge neutral"><i class="ph-fill ph-wrench" aria-hidden="true"></i> Admin</span>`;
}

function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rowsHtml(admins) {
    if (!admins.length) {
        return emptyState({ mode: 'table-row', colspan: 5, icon: 'ph-user-gear', title: '尚無管理員', hint: '點右上「新增管理員」加入第一個帳號' });
    }
    return admins.map(a => {
        const isSelf = a.email === currentEmail;
        const canDelete = !isSelf;  // 不能刪自己；其他 RLS 會擋（非 owner 也按不到）
        return `
            <tr data-email="${escapeAttr(a.email)}">
                <td>
                    <strong>${esc(a.email)}</strong>
                    ${isSelf ? '<span class="status-badge neutral" style="margin-left: 0.5rem; font-size: var(--text-2xs);">你</span>' : ''}
                </td>
                <td>${a.display_name ? esc(a.display_name) : '<span style="color: var(--text-muted);">—</span>'}</td>
                <td>${roleBadge(a.role)}${a.role === 'helper' ? helperBuildingsLabel(a.allowed_buildings) : ''}</td>
                <td style="color: var(--text-muted); font-size: var(--text-xs);">${esc(formatDate(a.created_at))}</td>
                <td style="text-align: right;">
                    ${canDelete
                        ? rowActionGroup(
                            rowAction({ action: 'edit', id: a.email, icon: 'ph-pencil', title: '編輯（角色 / 館別權限）', className: 'admin-edit-btn' })
                                .replace('<button ', `<button data-email="${escapeAttr(a.email)}" `)
                            + rowAction({ action: 'delete', id: a.email, icon: 'ph-trash', title: '移除此帳號', variant: 'danger', className: 'admin-delete-btn' })
                                .replace('<button ', `<button data-email="${escapeAttr(a.email)}" data-name="${escapeAttr(a.display_name || a.email)}" `)
                          )
                        : '<span style="color: var(--text-muted); font-size: var(--text-xs);">不能編輯自己</span>'
                    }
                </td>
            </tr>
        `;
    }).join('');
}

export function renderAdminUsers() {
    return `
        <div class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <div>
                    <h2 class="card-title" style="margin-bottom: 0.25rem;"><i class="ph ph-user-gear"></i> 帳號管理</h2>
                    <p style="font-size: var(--text-xs); color: var(--text-muted); margin: 0;">
                        管理可登入系統的 Google 帳號白名單。新增後該 email 需用 Google 登入一次才會啟用。
                    </p>
                </div>
                <button class="btn btn-primary" id="btn-add-admin" data-fab="ph-user-plus">
                    <i class="ph ph-plus"></i> 新增管理員
                </button>
            </div>

            <div style="background: var(--bg-secondary); border-left: 3px solid var(--color-info, #0ea5e9); padding: 0.75rem 1rem; margin-bottom: 1rem; border-radius: 4px; font-size: var(--text-xs); color: var(--text-secondary);">
                <strong><i class="ph ph-info" aria-hidden="true"></i> 角色說明</strong>
                <div style="margin-top: 0.4rem; line-height: 1.8; display: grid; gap: 0.25rem;">
                    <div><i class="ph-fill ph-crown" aria-hidden="true" style="color: var(--color-primary);"></i> <strong>Owner</strong> — 最高權限，可管理其他帳號</div>
                    <div><i class="ph-fill ph-wrench" aria-hidden="true" style="color: var(--text-secondary);"></i> <strong>Admin</strong> — 完整操作權限</div>
                    <div><i class="ph-fill ph-hand-heart" aria-hidden="true" style="color: var(--color-info, #0ea5e9);"></i> <strong>小幫手 Helper</strong> — 只能檢視部分資料</div>
                    <div><i class="ph-fill ph-eye" aria-hidden="true" style="color: var(--text-muted);"></i> <strong>Viewer</strong> — 預留給未來「全頁只能看」的角色（目前等同 Admin）</div>
                </div>
            </div>

            <div class="table-container">
                <table class="data-table" id="admin-users-table">
                    <thead>
                        <tr>
                            <th>Email</th>
                            <th>顯示名稱</th>
                            <th>角色</th>
                            <th>新增日期</th>
                            <th style="text-align: right;">操作</th>
                        </tr>
                    </thead>
                    <tbody id="admin-users-tbody">
                        ${emptyState({ mode: 'table-row', colspan: 5, icon: 'ph-circle-notch', title: '載入中...' })}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

async function refreshTable() {
    cachedAdmins = await loadAdmins();
    const tbody = document.getElementById('admin-users-tbody');
    if (tbody) tbody.innerHTML = rowsHtml(cachedAdmins);
    bindRowActions();
}

function bindRowActions() {
    document.querySelectorAll('.admin-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const admin = cachedAdmins.find(a => a.email === btn.dataset.email);
            if (admin) openAdminForm(admin);
        });
    });
    document.querySelectorAll('.admin-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const email = btn.dataset.email;
            const name = btn.dataset.name;
            openConfirm({
                title: '移除管理員',
                message: `確定要移除 <strong>${esc(name)}</strong> (${esc(email)}) 的存取權限？<br><br><span style="color: var(--text-muted); font-size: var(--text-sm);">移除後該 email 將無法再登入 PMS。</span>`,
                danger: true,
                confirmLabel: '確定移除',
                onConfirm: async () => {
                    const { error } = await supabase.from('admins').delete().eq('email', email);
                    if (error) {
                        showToast(`移除失敗：${error.message}`, 'danger');
                        return;
                    }
                    showToast(`已移除 ${name}`, 'success');
                    refreshTable();
                }
            });
        });
    });
}

// 新增 (admin=null) / 編輯 (admin=record) 共用同一個表單
function openAdminForm(admin = null) {
    const isEdit = !!admin;
    const roleOptions = [
        { value: 'admin', label: '🛠 Admin (完整 PMS 操作)' },
        { value: 'owner', label: '👑 Owner (可管理其他帳號)' },
        { value: 'helper', label: '🤝 小幫手 (只能檢視部分資料)' },
        { value: 'viewer', label: '👁 Viewer (預留)' }
    ];
    const fields = [];
    if (!isEdit) {
        fields.push({ name: 'email', label: 'Google 帳號 Email', type: 'email', required: true, span: 2, placeholder: 'employee@gmail.com', hint: '必須是 Google 帳號（Gmail 或啟用 Google 登入的網域）' });
    }
    fields.push({ name: 'display_name', label: '顯示名稱', type: 'text', required: false, span: 2, placeholder: '例：王經理', value: admin?.display_name || '' });
    fields.push({ name: 'role', label: '角色', type: 'select', required: true, value: admin?.role || 'admin', options: roleOptions });
    fields.push({ name: 'allowedBuildings', type: 'placeholder', span: 2 });

    let formEl = null;
    const preChecked = new Set(Array.isArray(admin?.allowed_buildings) ? admin.allowed_buildings : []);

    openFormModal({
        title: isEdit ? `編輯帳號：${admin.email}` : '新增管理員',
        maxWidth: 480,
        fields,
        submitLabel: isEdit ? '儲存變更' : '加入白名單',
        onFormMount: (form) => {
            formEl = form;
            const roleSelect = form.querySelector('[name="role"]');
            const ph = form.querySelector('#ph-allowedBuildings');
            if (ph) {
                const blds = helperBuildingChoices();
                ph.innerHTML = `
                    <label style="display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem;">可看的館別 <span style="color: var(--color-danger);">*</span></label>
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">小幫手只看得到勾選的館；沒勾任何館 = 看不到任何資料。</div>
                    ${blds.length === 0
                        ? '<div style="color: var(--text-muted); font-size: 0.85rem;">目前沒有共居館別</div>'
                        : `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                            ${blds.map(b => `<label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.9rem; cursor: pointer;">
                                <input type="checkbox" class="helper-bld-chk" value="${escapeAttr(b.id)}" ${preChecked.has(b.id) ? 'checked' : ''}> ${esc(b.name)}
                            </label>`).join('')}
                        </div>`}
                `;
            }
            const syncVisible = () => {
                if (ph) ph.style.display = (roleSelect?.value === 'helper') ? '' : 'none';
            };
            roleSelect?.addEventListener('change', syncVisible);
            syncVisible();
        },
        onSubmit: async (values) => {
            const role = values.role || 'admin';
            // 只有 helper 記館別; 其他角色一律清空 (不受此限制)
            const allowed_buildings = role === 'helper'
                ? Array.from(formEl?.querySelectorAll('.helper-bld-chk:checked') || []).map(c => c.value)
                : [];

            if (isEdit) {
                const { error } = await supabase.from('admins')
                    .update({ display_name: values.display_name || null, role, allowed_buildings })
                    .eq('email', admin.email);
                if (error) {
                    showToast(error.message?.includes('row-level security') ? '只有 Owner 可以編輯帳號' : `更新失敗：${error.message}`, 'danger');
                    return false;
                }
                showToast(`已更新 ${admin.email}`, 'success');
                refreshTable();
                return;
            }

            const email = (values.email || '').trim().toLowerCase();
            if (!email.includes('@')) { showToast('Email 格式不正確', 'danger'); return false; }
            if (cachedAdmins.some(a => a.email === email)) { showToast(`${email} 已在白名單內`, 'warning'); return false; }
            const { error } = await supabase.from('admins').insert({ email, display_name: values.display_name || null, role, allowed_buildings });
            if (error) {
                showToast(error.message?.includes('row-level security') ? '只有 Owner 可以新增管理員' : `新增失敗：${error.message}`, 'danger');
                return false;
            }
            showToast(`已加入 ${email}`, 'success');
            refreshTable();
        }
    });
}

export async function initAdminUsersActions(scope) {
    const session = await getSession();
    currentEmail = session?.user?.email?.toLowerCase() || null;

    scope.querySelector('#btn-add-admin')?.addEventListener('click', () => openAdminForm());
    await refreshTable();
}
