// 代管 mode 的 sidebar 動態渲染
// 共居 mode = 用 index.html 預設靜態 nav（不動）
// 代管 mode = 動態列出 mode='managed' 的房屋 + 屋主管理 + 屋主月結算 + 跨房屋 + 系統

import { mockData } from '../data.js';
import { getMode, setMode } from './appMode.js';
import { escapeHtml as esc } from './escape.js';

let originalNavHtml = null;   // 共居 mode 的靜態 nav (用 innerHTML 暫存 + 還原)

function cacheOriginalNav() {
    const nav = document.querySelector('.sidebar-nav');
    if (nav && originalNavHtml === null) originalNavHtml = nav.innerHTML;
}

function buildManagedNavHtml() {
    const managedHouses = (mockData.buildings || [])
        .filter(b => b.mode === 'managed')
        .sort((a, b) => (a.id || '').localeCompare(b.id || ''));

    const housesGroup = `
        <div class="nav-group">
            <span class="nav-section-label">代管房屋</span>
            ${managedHouses.length === 0
                ? `<div class="nav-empty-hint">尚無代管房屋<br><span style="font-size: 0.7rem; color: var(--text-muted);">至「屋主管理」先建屋主<br>再新增代管房屋</span></div>`
                : managedHouses.map(b => `
                    <a href="#m-house/${esc(b.id)}" class="nav-item" data-view="m-house" data-house-id="${esc(b.id)}" data-label="${esc(b.name)}">
                        <i class="ph ${b.status === 'active' ? 'ph-house' : 'ph-house-line'}"></i>
                        <span class="nav-label">${esc(b.name)}</span>
                        ${b.status !== 'active' ? '<span class="nav-badge-muted">停</span>' : ''}
                    </a>
                `).join('')
            }
            <a href="#m-house-new" class="nav-item nav-item-add" data-view="m-house-new" data-label="新增代管房屋">
                <i class="ph ph-plus-circle"></i>
                <span class="nav-label">新增代管房屋</span>
            </a>
        </div>
    `;

    const managementGroup = `
        <div class="nav-group">
            <span class="nav-section-label">代管管理</span>
            <a href="#m-owners" class="nav-item" data-view="m-owners" data-label="屋主管理">
                <i class="ph ph-user-circle"></i>
                <span class="nav-label">屋主管理</span>
            </a>
            <a href="#m-settlements" class="nav-item" data-view="m-settlements" data-label="屋主月結算">
                <i class="ph ph-receipt"></i>
                <span class="nav-label">屋主月結算</span>
            </a>
        </div>
    `;

    const sharedGroup = `
        <div class="nav-group">
            <span class="nav-section-label">跨房屋</span>
            <a href="#contracts" class="nav-item" data-view="contracts" data-label="合約管理">
                <i class="ph ph-file-text"></i>
                <span class="nav-label">合約管理</span>
            </a>
            <a href="#finance" class="nav-item" data-view="finance" data-label="帳務管理">
                <i class="ph ph-wallet"></i>
                <span class="nav-label">帳務管理</span>
            </a>
            <a href="#maintenance" class="nav-item" data-view="maintenance" data-label="維修管理">
                <i class="ph ph-wrench"></i>
                <span class="nav-label">維修管理</span>
            </a>
            <a href="#tenants" class="nav-item" data-view="tenants" data-label="租客清單">
                <i class="ph ph-users"></i>
                <span class="nav-label">租客清單</span>
            </a>
        </div>
    `;

    const analysisGroup = `
        <div class="nav-group">
            <span class="nav-section-label">分析</span>
            <a href="#reports" class="nav-item" data-view="reports" data-label="報表">
                <i class="ph ph-chart-line-up"></i>
                <span class="nav-label">報表</span>
            </a>
        </div>
    `;

    const systemGroup = `
        <div class="nav-group">
            <span class="nav-section-label">系統</span>
            <a href="#settings" class="nav-item" data-view="settings" data-label="系統設定">
                <i class="ph ph-gear-six"></i>
                <span class="nav-label">系統設定</span>
            </a>
            <a href="#admin-users" class="nav-item is-hidden" data-view="admin-users" data-label="帳號管理" id="nav-admin-users">
                <i class="ph ph-user-gear"></i>
                <span class="nav-label">帳號管理</span>
            </a>
        </div>
    `;

    const overviewGroup = `
        <div class="nav-group">
            <span class="nav-section-label">總覽</span>
            <a href="#dashboard" class="nav-item" data-view="dashboard" data-label="首頁">
                <i class="ph ph-squares-four"></i>
                <span class="nav-label">首頁</span>
            </a>
        </div>
    `;

    return overviewGroup + housesGroup + managementGroup + sharedGroup + analysisGroup + systemGroup;
}

export function renderSidebarForMode(mode = getMode()) {
    cacheOriginalNav();
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    if (mode === 'managed') {
        nav.innerHTML = buildManagedNavHtml();
    } else {
        if (originalNavHtml != null) nav.innerHTML = originalNavHtml;
    }
    // 更新 mode switcher active 狀態
    document.querySelectorAll('.mode-switch-btn').forEach(btn => {
        const isActive = btn.dataset.mode === mode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.body.dataset.appMode = mode;
}

export function initModeSwitcher({ onSwitch } = {}) {
    cacheOriginalNav();
    renderSidebarForMode(getMode());

    document.querySelectorAll('.mode-switch-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.mode;
            if (!target) return;
            if (setMode(target)) {
                renderSidebarForMode(target);
                if (onSwitch) onSwitch(target);
            }
        });
    });

    // 房屋列表變動 (新增/編輯) → 代管 mode 要重 render sidebar
    ['bms:create', 'bms:update', 'bms:delete'].forEach(evtName => {
        window.addEventListener(evtName, (e) => {
            if (getMode() !== 'managed') return;
            if (!e.detail || e.detail.table !== 'buildings') return;
            renderSidebarForMode('managed');
        });
    });
}
