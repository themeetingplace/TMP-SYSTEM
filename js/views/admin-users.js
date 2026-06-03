// 帳號管理 — owner 專用
// 列出所有 admin，可新增 / 刪除其他帳號
// RLS 已經把 INSERT/UPDATE/DELETE 限制給 owner，這層 UI 只是讓 owner 不用 SQL 也能操作
//
// 注意：帳號加進 admins table 之後，該 email 還要實際用 Google 登入過一次
// Supabase 才會建出對應的 auth.users。本表只控「准不准進」，不負責建 auth 帳號

import { supabase } from '../supabase.js';
import { getSession } from '../auth.js';
import { openFormModal, openConfirm, showToast } from '../utils/ui.js';

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
    if (role === 'viewer') {
        return `<span class="status-badge" style="background: var(--bg-tertiary); color: var(--text-muted);"><i class="ph-fill ph-eye" aria-hidden="true"></i> Viewer</span>`;
    }
    return `<span class="status-badge" style="background: var(--bg-secondary);"><i class="ph-fill ph-wrench" aria-hidden="true"></i> Admin</span>`;
}

function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rowsHtml(admins) {
    if (!admins.length) {
        return `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">尚無管理員</td></tr>`;
    }
    return admins.map(a => {
        const isSelf = a.email === currentEmail;
        const canDelete = !isSelf;  // 不能刪自己；其他 RLS 會擋（非 owner 也按不到）
        return `
            <tr data-email="${a.email}">
                <td>
                    <strong>${a.email}</strong>
                    ${isSelf ? '<span class="status-badge" style="margin-left: 0.5rem; background: var(--bg-secondary); font-size: 0.65rem;">你</span>' : ''}
                </td>
                <td>${a.display_name || '<span style="color: var(--text-muted);">—</span>'}</td>
                <td>${roleBadge(a.role)}</td>
                <td style="color: var(--text-muted); font-size: 0.8rem;">${formatDate(a.created_at)}</td>
                <td style="text-align: right;">
                    ${canDelete
                        ? `<button class="btn btn-outline admin-delete-btn" data-email="${a.email}" data-name="${a.display_name || a.email}" title="移除此帳號" style="color: var(--color-danger); padding: 0.25rem 0.6rem;">
                              <i class="ph ph-trash"></i> 移除
                           </button>`
                        : '<span style="color: var(--text-muted); font-size: 0.75rem;">不能移除自己</span>'
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
                    <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0;">
                        管理可登入系統的 Google 帳號白名單。新增後該 email 需用 Google 登入一次才會啟用。
                    </p>
                </div>
                <button class="btn btn-primary" id="btn-add-admin">
                    <i class="ph ph-plus"></i> 新增管理員
                </button>
            </div>

            <div style="background: var(--bg-secondary); border-left: 3px solid var(--color-info, #0ea5e9); padding: 0.75rem 1rem; margin-bottom: 1rem; border-radius: 4px; font-size: 0.8rem; color: var(--text-secondary);">
                <strong><i class="ph ph-info" aria-hidden="true"></i> 角色說明</strong>
                <div style="margin-top: 0.4rem; line-height: 1.8; display: grid; gap: 0.25rem;">
                    <div><i class="ph-fill ph-crown" aria-hidden="true" style="color: var(--color-primary);"></i> <strong>Owner</strong> — 完整權限，可管理其他帳號（你跟老闆）</div>
                    <div><i class="ph-fill ph-wrench" aria-hidden="true" style="color: var(--text-secondary);"></i> <strong>Admin</strong> — 完整 BMS 操作權限，但無法管理帳號（員工）</div>
                    <div><i class="ph-fill ph-eye" aria-hidden="true" style="color: var(--text-muted);"></i> <strong>Viewer</strong> — 預留給未來「只能看」的角色（目前等同 Admin）</div>
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
                        <tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">載入中...</td></tr>
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
    document.querySelectorAll('.admin-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const email = btn.dataset.email;
            const name = btn.dataset.name;
            openConfirm({
                title: '移除管理員',
                message: `確定要移除 <strong>${name}</strong> (${email}) 的存取權限？<br><br><span style="color: var(--text-muted); font-size: 0.85rem;">移除後該 email 將無法再登入 BMS。</span>`,
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

function openAddAdminForm() {
    openFormModal({
        title: '新增管理員',
        maxWidth: 480,
        fields: [
            { name: 'email', label: 'Google 帳號 Email', type: 'email', required: true, span: 2, placeholder: 'employee@gmail.com', hint: '必須是 Google 帳號（Gmail 或啟用 Google 登入的網域）' },
            { name: 'display_name', label: '顯示名稱', type: 'text', required: false, span: 2, placeholder: '例：王經理' },
            { name: 'role', label: '角色', type: 'select', required: true, value: 'admin', options: [
                { value: 'admin', label: '🛠 Admin (完整 BMS 操作)' },
                { value: 'owner', label: '👑 Owner (可管理其他帳號)' },
                { value: 'viewer', label: '👁 Viewer (預留)' }
            ] }
        ],
        submitLabel: '加入白名單',
        onSubmit: async (values) => {
            const email = (values.email || '').trim().toLowerCase();
            if (!email.includes('@')) {
                showToast('Email 格式不正確', 'danger');
                return false;
            }
            // 重複檢查
            if (cachedAdmins.some(a => a.email === email)) {
                showToast(`${email} 已在白名單內`, 'warning');
                return false;
            }
            const { error } = await supabase.from('admins').insert({
                email,
                display_name: values.display_name || null,
                role: values.role || 'admin'
            });
            if (error) {
                // RLS 擋下 → 通常是非 owner 嘗試新增
                if (error.message?.includes('row-level security')) {
                    showToast('只有 Owner 可以新增管理員', 'danger');
                } else {
                    showToast(`新增失敗：${error.message}`, 'danger');
                }
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

    scope.querySelector('#btn-add-admin')?.addEventListener('click', openAddAdminForm);
    await refreshTable();
}
