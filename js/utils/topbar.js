// 頂部全域搜尋 + 通知中心
import { mockData } from '../data.js';

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
            html += `<div class="search-result-item" data-entity-type="property" data-entity-id="${escapeAttr(p.id)}">
                <div class="search-result-item-title">${highlight(p.name, query)}</div>
                <div class="search-result-item-sub">${escapeHtml(p.address || '')} · ${escapeHtml(p.status || '')}</div>
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
export function initNotifications() {
    const btn = document.querySelector('.notification-btn');
    if (!btn) return;

    let panel = null;

    function close() {
        panel?.remove();
        panel = null;
    }

    function buildNotifications() {
        const notifications = [];
        // 逾期帳單
        mockData.invoices.filter(inv =>
            inv.status === '欠繳' && new Date(inv.dueDate) < new Date(TODAY)
        ).forEach(inv => {
            notifications.push({
                icon: 'ph-warning-circle',
                color: 'var(--color-danger)',
                title: `帳單逾期：${inv.tenant} · ${inv.type}`,
                meta: `$${(inv.amount ?? 0).toLocaleString()} · 應繳 ${inv.dueDate}`,
                link: 'finance'
            });
        });
        // 待簽合約
        mockData.contracts.filter(c => c.status === '待簽署').forEach(c => {
            notifications.push({
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
                icon: 'ph-clock',
                color: 'var(--color-warning)',
                title: `合約即將到期：${c.tenant}`,
                meta: `${c.propertyName} · ${c.endDate}`,
                link: 'contracts'
            });
        });
        return notifications;
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
                <div class="notification-header">
                    <span>通知 (${items.length})</span>
                </div>
                ${items.map(n => `
                    <div class="notification-item" data-link="${n.link}">
                        <div style="display: flex; gap: 0.75rem;">
                            <i class="ph-fill ${n.icon}" style="color: ${n.color}; font-size: 1.25rem; flex-shrink: 0;"></i>
                            <div style="flex: 1; min-width: 0;">
                                <div class="notification-item-title">${escapeHtml(n.title)}</div>
                                <div class="notification-item-meta">${escapeHtml(n.meta)}</div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            `;
        }
        document.body.appendChild(panel);

        // 更新 badge 數字
        const badge = btn.querySelector('.badge');
        if (badge) badge.textContent = items.length;

        panel.querySelectorAll('[data-link]').forEach(item => {
            item.addEventListener('click', () => {
                window.location.hash = item.dataset.link;
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

    // 初始更新 badge
    const badge = btn.querySelector('.badge');
    if (badge) {
        const count = buildNotifications().length;
        badge.textContent = count;
        if (count === 0) badge.style.display = 'none';
    }
}
