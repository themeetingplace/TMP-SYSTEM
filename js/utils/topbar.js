// 頂部全域搜尋 + 通知中心
import { mockData } from '../data.js';
import { showToast } from './ui.js';
import {
    detectNewTenantRegistrations,
    getDismissedNotificationIds,
    listTenantRegistrationNotifications,
    markNotificationRead,
    saveDismissedNotificationIds
} from './tenantRegistrationNotifications.js';

const TODAY = new Date().toISOString().split('T')[0];

export function initGlobalSearch() {
    const input = document.querySelector('.topbar .search-bar input');
    const wrap = document.querySelector('.topbar .search-bar');
    if (!input || !wrap) return;

    let panel = null;
    let debounce = null;

    function close() {
        panel?.remove();
        panel = null;
    }

    function open(query) {
        close();
        const results = searchAll(query);
        panel = document.createElement('div');
        panel.className = 'global-search-results';
        const rect = wrap.getBoundingClientRect();
        panel.style.right = `${window.innerWidth - rect.right}px`;
        panel.innerHTML = renderResults(results, query);
        document.body.appendChild(panel);

        panel.querySelectorAll('[data-entity-type]').forEach(item => {
            item.addEventListener('click', () => {
                // UIUX #2: 直接打開 entity 的 detail modal，不只是跳列表頁
                const type = item.dataset.entityType;
                const id = item.dataset.entityId;
                if (window.openEntity && type && id) {
                    window.openEntity(type, id);
                }
                close();
            });
        });
    }

    input.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        clearTimeout(debounce);
        if (!q) { close(); return; }
        debounce = setTimeout(() => open(q), 150);
    });

    document.addEventListener('click', (e) => {
        if (panel && !panel.contains(e.target) && !wrap.contains(e.target)) {
            close();
        }
    });
}

function searchAll(query) {
    const q = query.toLowerCase();
    const matches = (text) => text && text.toLowerCase().includes(q);

    return {
        properties: mockData.properties.filter(p =>
            matches(p.name) || matches(p.address) || matches(p.tenant) || matches(p.id)
        ).slice(0, 5),
        tenants: mockData.tenants.filter(t =>
            matches(t.name) || matches(t.phone) || matches(t.email) || matches(t.currentProperty)
        ).slice(0, 5),
        contracts: mockData.contracts.filter(c =>
            matches(c.id) || matches(c.tenant) || matches(c.propertyName)
        ).slice(0, 3),
        invoices: mockData.invoices.filter(i =>
            matches(i.id) || matches(i.tenant) || matches(i.propertyName) || matches(i.type)
        ).slice(0, 3)
    };
}

function renderResults(r, query) {
    const total = r.properties.length + r.tenants.length + r.contracts.length + r.invoices.length;
    if (total === 0) {
        return `<div class="search-empty"><i class="ph ph-magnifying-glass" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>找不到「${escapeHtml(query)}」相關資料</div>`;
    }

    let html = '';
    if (r.properties.length) {
        html += `<div class="search-result-group"><div class="search-result-group-title">物件 (${r.properties.length})</div>`;
        r.properties.forEach(p => {
            // 副標前置租客名稱 (如有)，讓「用名字搜→出物件」時看得到是誰住的
            const tenantBit = p.tenant ? `${highlight(p.tenant, query)} · ` : '';
            html += `<div class="search-result-item" data-entity-type="property" data-entity-id="${escapeAttr(p.id)}">
                <div class="search-result-item-title">${highlight(p.name, query)}</div>
                <div class="search-result-item-sub">${tenantBit}${escapeHtml(p.address || '')} · ${escapeHtml(p.status || '')}</div>
            </div>`;
        });
        html += `</div>`;
    }
    if (r.tenants.length) {
        html += `<div class="search-result-group"><div class="search-result-group-title">租客 (${r.tenants.length})</div>`;
        r.tenants.forEach(t => {
            html += `<div class="search-result-item" data-entity-type="tenant" data-entity-id="${escapeAttr(t.id)}">
                <div class="search-result-item-title">${highlight(t.name, query)}</div>
                <div class="search-result-item-sub">${escapeHtml(t.phone || '無電話')} · ${escapeHtml(t.currentProperty || '未指定物件')}</div>
            </div>`;
        });
        html += `</div>`;
    }
    if (r.contracts.length) {
        html += `<div class="search-result-group"><div class="search-result-group-title">合約 (${r.contracts.length})</div>`;
        r.contracts.forEach(c => {
            html += `<div class="search-result-item" data-entity-type="contract" data-entity-id="${escapeAttr(c.id)}">
                <div class="search-result-item-title">${highlight(c.id, query)} · ${escapeHtml(c.tenant || '')}</div>
                <div class="search-result-item-sub">${escapeHtml(c.propertyName || '')} · ${escapeHtml(c.status || '')}</div>
            </div>`;
        });
        html += `</div>`;
    }
    if (r.invoices.length) {
        html += `<div class="search-result-group"><div class="search-result-group-title">帳單 (${r.invoices.length})</div>`;
        r.invoices.forEach(i => {
            html += `<div class="search-result-item" data-entity-type="invoice" data-entity-id="${escapeAttr(i.id)}">
                <div class="search-result-item-title">${highlight(i.id, query)} · ${escapeHtml(i.type || '')}</div>
                <div class="search-result-item-sub">${escapeHtml(i.tenant || '')} · $${(i.amount ?? 0).toLocaleString()} · ${escapeHtml(i.status || '')}</div>
            </div>`;
        });
        html += `</div>`;
    }
    return html;
}

function escapeAttr(s) {
    return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function highlight(text, query) {
    const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return escapeHtml(text).replace(re, '<mark style="background-color: var(--color-primary-light); color: var(--color-primary); padding: 0 2px;">$1</mark>');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// === 通知中心 ===
function getDismissedIds() {
    return getDismissedNotificationIds();
}
function saveDismissedIds(set) {
    saveDismissedNotificationIds(set);
}

export function initNotifications() {
    const btn = document.querySelector('.notification-btn');
    if (!btn) return;

    let panel = null;
    let registrationSnapshotPrimed = false;
    let knownRegistrationIds = new Set();

    function close() {
        panel?.remove();
        panel = null;
    }

    function buildNotifications() {
        const dismissed = getDismissedIds();
        const notifications = [];
        // 新完成的住客登記（只給管理端；小幫手不處理身分資料）
        if (window.__currentRole !== 'helper') {
            listTenantRegistrationNotifications(mockData.tenants, { dismissedIds: dismissed }).forEach(item => {
                const tenant = item.tenant;
                notifications.push({
                    id: item.id,
                    icon: 'ph-user-plus',
                    color: 'var(--color-primary)',
                    title: `新住客登記：${tenant.name || '未命名住客'}`,
                    meta: `${tenant.phone || '未填電話'} · ${tenant.idCardStatus === 'pending_admin_upload' ? '待管理員補證件' : '已完成 LINE 綁定'}`,
                    link: 'tenants',
                    entityType: 'tenant',
                    entityId: tenant.id,
                    markReadOnOpen: true
                });
            });
        }
        // 逾期帳單
        mockData.invoices.filter(inv =>
            inv.status === '欠繳' && new Date(inv.dueDate) < new Date(TODAY)
        ).forEach(inv => {
            notifications.push({
                id: `inv-overdue-${inv.id}`,
                icon: 'ph-warning-circle',
                color: 'var(--color-danger)',
                title: `帳單逾期：${inv.tenant} · ${inv.type}`,
                meta: `$${(inv.amount ?? 0).toLocaleString()} · 應繳 ${inv.dueDate}`,
                link: 'unsettled'
            });
        });
        // 待簽合約
        mockData.contracts.filter(c => c.status === '待簽署').forEach(c => {
            notifications.push({
                id: `contract-pending-${c.id}`,
                icon: 'ph-signature',
                color: 'var(--color-warning)',
                title: `待簽合約：${c.tenant}`,
                meta: c.propertyName,
                link: 'contracts'
            });
        });
        // 待處理維修
        mockData.maintenances.filter(m => m.status === '待處理').forEach(m => {
            notifications.push({
                id: `maint-todo-${m.id}`,
                icon: 'ph-wrench',
                color: 'var(--color-danger)',
                title: `待處理維修：${m.issue}`,
                meta: m.propertyName,
                link: 'maintenance'
            });
        });
        // 即將到期合約
        mockData.contracts.filter(c => c.status === '即將到期').forEach(c => {
            notifications.push({
                id: `contract-expiring-${c.id}`,
                icon: 'ph-clock',
                color: 'var(--color-warning)',
                title: `合約即將到期：${c.tenant}`,
                meta: `${c.propertyName} · ${c.endDate}`,
                link: 'contracts'
            });
        });
        return notifications.filter(n => !dismissed.has(n.id));
    }

    function open() {
        close();
        const items = buildNotifications();
        panel = document.createElement('div');
        panel.className = 'notification-panel';
        if (items.length === 0) {
            panel.innerHTML = `
                <div class="notification-header"><span>通知</span></div>
                <div class="search-empty">
                    <i class="ph ph-bell-slash" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
                    目前沒有通知
                </div>
            `;
        } else {
            panel.innerHTML = `
                <div class="notification-header" style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                    <span>通知 (${items.length})</span>
                    <button type="button" data-action="clear-all" style="background: transparent; border: 1px solid var(--border-color); border-radius: 4px; padding: 0.25rem 0.6rem; font-size: 0.75rem; color: var(--text-secondary); cursor: pointer;">全部清除</button>
                </div>
                ${items.map(n => `
                    <div class="notification-item" data-link="${n.link}" data-notif-id="${escapeHtml(n.id)}" data-entity-type="${escapeHtml(n.entityType || '')}" data-entity-id="${escapeHtml(n.entityId || '')}" data-mark-read="${n.markReadOnOpen ? 'true' : 'false'}" style="position: relative;">
                        <div style="display: flex; gap: 0.75rem; padding-right: 1.5rem;">
                            <i class="ph-fill ${n.icon}" style="color: ${n.color}; font-size: 1.25rem; flex-shrink: 0;"></i>
                            <div style="flex: 1; min-width: 0;">
                                <div class="notification-item-title">${escapeHtml(n.title)}</div>
                                <div class="notification-item-meta">${escapeHtml(n.meta)}</div>
                            </div>
                        </div>
                        <button type="button" data-action="dismiss" data-dismiss-id="${escapeHtml(n.id)}" title="清除這條" style="position: absolute; top: 0.4rem; right: 0.4rem; background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 0.25rem; line-height: 1; border-radius: 3px; font-size: 1rem;"><i class="ph ph-x"></i></button>
                    </div>
                `).join('')}
            `;
        }
        document.body.appendChild(panel);

        // 更新 badge 數字
        const badge = btn.querySelector('.badge');
        if (badge) {
            badge.textContent = items.length;
            badge.style.display = items.length > 0 ? '' : 'none';
        }

        // 個別 dismiss (X 鈕)
        panel.querySelectorAll('[data-action="dismiss"]').forEach(dbtn => {
            dbtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = dbtn.dataset.dismissId;
                markNotificationRead(id);
                open();  // 重新 render
            });
        });
        // 全部清除
        panel.querySelector('[data-action="clear-all"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const dismissed = getDismissedIds();
            items.forEach(n => dismissed.add(n.id));
            saveDismissedIds(dismissed);
            open();
        });
        // 點 item 進頁面 (X 鈕排除)
        panel.querySelectorAll('.notification-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('[data-action="dismiss"]')) return;
                const link = item.dataset.link;
                if (item.dataset.markRead === 'true') {
                    markNotificationRead(item.dataset.notifId);
                    refreshBadge();
                }
                const entityType = item.dataset.entityType;
                const entityId = item.dataset.entityId;
                if (entityType && entityId && window.openEntity) window.openEntity(entityType, entityId);
                else if (link) window.location.hash = link;
                close();
            });
        });
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel) close();
        else open();
    });

    document.addEventListener('click', (e) => {
        if (panel && !panel.contains(e.target) && !btn.contains(e.target)) {
            close();
        }
    });

    function refreshBadge() {
        const badge = btn.querySelector('.badge');
        if (!badge) return;
        const count = buildNotifications().length;
        badge.textContent = count;
        badge.style.display = count > 0 ? '' : 'none';
        btn.classList.toggle('has-unread', count > 0);
    }

    function syncRegistrationSnapshot({ notify = false } = {}) {
        const { items, currentIds } = detectNewTenantRegistrations(knownRegistrationIds, mockData.tenants);
        if (registrationSnapshotPrimed && notify && window.__currentRole !== 'helper') {
            items.forEach(item => {
                const tenant = item.tenant;
                const toast = showToast(
                    tenant.idCardStatus === 'pending_admin_upload'
                        ? `🔔 新住客登記：${tenant.name || '未命名住客'} 已綁定，等待管理員補上證件`
                        : `🔔 新住客登記：${tenant.name || '未命名住客'} 已完成 LINE 綁定`,
                    'info',
                    8000
                );
                toast.style.cursor = 'pointer';
                toast.title = '點擊查看住客資料';
                toast.addEventListener('click', () => {
                    markNotificationRead(item.id);
                    refreshBadge();
                    window.openEntity?.('tenant', tenant.id);
                });
            });
        }
        knownRegistrationIds = currentIds;
        registrationSnapshotPrimed = true;
    }

    window.refreshNotifications = refreshBadge;
    window.markNotificationRead = markNotificationRead;
    window.addEventListener('bms:data-changed', (event) => {
        const isInitialPull = !registrationSnapshotPrimed && event.detail?.source === 'pull';
        syncRegistrationSnapshot({ notify: !isInitialPull });
        refreshBadge();
    });

    // init 時 mockData 可能還沒完成雲端 pull；第一次 data-changed 只建立基準，不彈舊資料。
    if (Array.isArray(mockData.tenants) && mockData.tenants.some(t => t?.lineBoundAt)) {
        syncRegistrationSnapshot();
    }
    refreshBadge();
}
