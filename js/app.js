import { renderDashboard } from './views/dashboard.js';
import { renderProperties, initPropertyActions } from './views/properties.js';
import { renderOccupancy, initOccupancyActions } from './views/occupancy.js';
import { renderContracts, initContractActions } from './views/contracts.js';
import { renderFinance, initFinanceActions } from './views/finance.js';
import { renderUnsettled, initUnsettledActions } from './views/unsettled.js';
import { renderReports, initReportsActions } from './views/reports.js';
import { renderAnalysis, initAnalysisActions } from './views/analysis.js';
import { renderMaintenance, initMaintenanceActions } from './views/maintenance.js';
import { renderTenants, initTenantActions } from './views/tenants.js';
import { renderSettings, initSettingsActions } from './views/settings.js';
import { renderAdminUsers, initAdminUsersActions } from './views/admin-users.js';
import { initTableInteractions } from './utils/tableFilter.js';
import { initGlobalSearch, initNotifications } from './utils/topbar.js';
import { initSidebar } from './utils/sidebar.js';
import './utils/entityNav.js'; // UIUX #2: 暴露 window.openEntity(type, id)
import { showToast } from './utils/ui.js';
import './setup.js'; // 載入 console 偵錯工具（quickTest / testSupabaseConnection）
import './migrate-to-supabase.js'; // 暴露 migrateToSupabase() / clearAllSupabase()
import { bootstrap as syncBootstrap } from './sync.js'; // 雲端同步引擎
import { getSession, signOut, updateDisplayName, updatePassword, clearSensitiveLocalCache, checkIsAdmin, checkIsOwner } from './auth.js';
import { showLogin, showAccessDenied, bindPasswordToggles } from './views/login.js';
import { APP_VERSION, APP_BUILD_DATE, APP_NAME, APP_COPYRIGHT, APP_CHANGELOG } from './version.js';

const viewContainer = document.getElementById('view-container');
const pageTitle = document.getElementById('page-title');
const navItems = document.querySelectorAll('.nav-item');

const routes = {
    dashboard: { title: '首頁', render: renderDashboard },
    properties: { title: '物件管理', render: renderProperties, init: initPropertyActions },
    occupancy: { title: '住房一覽', render: renderOccupancy, init: initOccupancyActions },
    contracts: { title: '合約管理', render: renderContracts, init: initContractActions },
    finance: { title: '總收支表', render: renderFinance, init: initFinanceActions },
    analysis: { title: '收支分析', render: renderAnalysis, init: initAnalysisActions },
    unsettled: { title: '房租查帳', render: renderUnsettled, init: initUnsettledActions },
    reports: { title: '各館收入報表', render: renderReports, init: initReportsActions },
    maintenance: { title: '維修管理', render: renderMaintenance, init: initMaintenanceActions },
    tenants: { title: '租客清單', render: renderTenants, init: initTenantActions },
    settings: { title: '系統設定', render: renderSettings, init: initSettingsActions },
    'admin-users': { title: '帳號管理', render: renderAdminUsers, init: initAdminUsersActions, ownerOnly: true }
};

function handleRoute() {
    let hash = window.location.hash.substring(1);
    if (!hash || !routes[hash]) {
        hash = 'dashboard';
        window.location.hash = hash;
        return;
    }

    const route = routes[hash];
    // owner-only route guard：非 owner 直接打 #admin-users 也擋掉
    if (route.ownerOnly && window.__currentRole !== 'owner') {
        showToast('此頁僅限 Owner 存取', 'warning');
        window.location.hash = 'dashboard';
        return;
    }
    pageTitle.textContent = route.title;

    // Update Nav Activity
    // UIUX #1: finance/analysis/unsettled 都映射到 sidebar 的「帳務管理」(data-view='finance')
    const FINANCE_GROUP = ['finance', 'analysis', 'unsettled'];
    const sidebarHash = FINANCE_GROUP.includes(hash) ? 'finance' : hash;
    navItems.forEach(item => {
        if (item.dataset.view === sidebarHash) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Clear Container and Render
    viewContainer.innerHTML = '';
    
    const viewElement = document.createElement('div');
    viewElement.className = 'view-section active';
    viewElement.innerHTML = route.render();
    viewContainer.appendChild(viewElement);

    // 套用通用表格互動（dashboard / settings / occupancy 不適用）
    //   dashboard: 沒表格
    //   settings: 有 sub-tab 自管表格
    //   occupancy: 矩陣表，不分頁；橫向滾動處理寬度
    if (hash !== 'dashboard' && hash !== 'settings' && hash !== 'occupancy') {
        initTableInteractions({ scope: viewElement, rowsPerPage: 10 });
    }

    // 各 view 自己的 init（綁定事件等）
    if (typeof route.init === 'function') {
        route.init(viewElement);
    }

    // Dashboard 圖表
    if (hash === 'dashboard' && window.initDashboardChart) {
        window.initDashboardChart();
        if (window.initDashboardInteractions) {
            window.initDashboardInteractions();
        }
    }
}

// P1-15: localStorage 滿時跳 toast 警告
window.addEventListener('bms:storage-full', () => {
    showToast('本機儲存空間已滿，編輯可能無法保留到下次重整。請聯絡開發者改用 IndexedDB', 'danger', 8000);
});

window.addEventListener('hashchange', handleRoute);
window.addEventListener('DOMContentLoaded', async () => {
    // 1. 先檢查登入 — 未登入直接顯示登入畫面，不跑後面的 boot 流程
    const session = await getSession();
    if (!session) {
        // 沒 session 但本機可能有上一個使用者的快取資料 → 一律清掉避免外洩
        clearSensitiveLocalCache();
        showLogin();
        return;
    }

    // 1.5 白名單檢查 — 已登入但 email 不在 admins → 顯示無權限頁、不進主應用
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
        clearSensitiveLocalCache();
        showAccessDenied(session.user?.email);
        return;
    }

    // 1.6 取 owner 狀態 — owner 才能看「帳號管理」nav
    const isOwner = await checkIsOwner();
    window.__currentRole = isOwner ? 'owner' : 'admin';
    if (isOwner) {
        const navAdminUsers = document.getElementById('nav-admin-users');
        if (navAdminUsers) navAdminUsers.style.display = '';
    }

    // 2. 顯示登入者資訊在 sidebar
    updateUserProfile(session.user);
    // 帶入版本號 (sidebar footer)
    const versionEl = document.getElementById('app-version-num');
    if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

    // 3. 主介面初始化
    initSidebar();
    initGlobalSearch();
    initNotifications();

    // 4. 雲端優先：開機先拉一次 Supabase 才渲染
    showBootLoading();
    const result = await syncBootstrap();
    hideBootLoading();
    if (!result.success) {
        showToast(`雲端載入失敗：${result.error?.message || result.error}。將使用本機備援資料`, 'warning', 8000);
    }
    handleRoute();
});

function updateUserProfile(user) {
    const nameEl = document.querySelector('.user-profile .user-name');
    const avatarEl = document.querySelector('.user-profile .avatar');
    if (nameEl) {
        const email = user?.email || '使用者';
        const displayName = user?.user_metadata?.full_name || email.split('@')[0];
        nameEl.textContent = displayName;
    }
    if (avatarEl) {
        const seed = (user?.email || 'A')[0].toUpperCase();
        avatarEl.textContent = seed;
    }
}

function showBootLoading() {
    const overlay = document.createElement('div');
    overlay.id = 'boot-loading';
    overlay.innerHTML = `
        <div class="boot-loading-inner">
            <div class="boot-loading-spinner"></div>
            <div class="boot-loading-text">從雲端載入資料中…</div>
        </div>
    `;
    document.body.appendChild(overlay);
}
function hideBootLoading() {
    document.getElementById('boot-loading')?.remove();
}

// 主題切換 / 登出 — 目前為佔位行為，留給後續串實際邏輯
window.toggleAppTheme = function () {
    showToast('主題切換功能開發中', 'info');
};
window.logoutPlaceholder = async function () {
    if (confirm('確定要登出？')) {
        await signOut();
    }
};

// 讓任何 view 修改資料後可以重新渲染當前畫面
window.refreshCurrentView = handleRoute;

// 雲端同步拉完資料後重新渲染當前頁面 (靜默 — 由 sidebar 指示燈呈現狀態)
// debounce：一次「+入住」可能連續觸發 4-8 個 realtime 事件，全部合併成 1 次 re-render，避免畫面狂閃
let _dataChangedTimer = null;
window.addEventListener('bms:data-changed', () => {
    // 若 modal 開著就跳過渲染 — 避免 input focus 跳掉、表單清空之類
    if (document.querySelector('.modal-overlay')) return;
    clearTimeout(_dataChangedTimer);
    _dataChangedTimer = setTimeout(() => handleRoute(), 150);
});

// 關於系統 — 點 sidebar footer 的版本號開啟
window.showAboutApp = function() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    const changelogHtml = APP_CHANGELOG.map(c => `
        <div class="changelog-item">
            <div class="changelog-head">
                <strong>v${c.version}</strong>
                <span class="changelog-date">${c.date}</span>
            </div>
            <div class="changelog-notes">${c.notes}</div>
        </div>
    `).join('');
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 480px;">
            <div class="modal-header">
                <h3>關於 ${APP_NAME}</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="about-hero">
                    <div class="about-logo"><img src="assets/logo.png?v=20260603f" alt="聚空間"></div>
                    <div>
                        <div class="about-name">${APP_NAME}</div>
                        <div class="about-version">v${APP_VERSION} · ${APP_BUILD_DATE}</div>
                    </div>
                </div>
                <div class="about-section">
                    <div class="about-section-label">版本紀錄</div>
                    <div class="changelog-list">${changelogHtml}</div>
                </div>
                <div class="about-footer">${APP_COPYRIGHT}</div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
};

// Account Settings — 接 Supabase Auth (email 唯讀、改顯示名稱、改密碼)
window.showAccountSettings = async function() {
    const session = await getSession();
    if (!session) { showToast('尚未登入', 'warning'); return; }
    const user = session.user;
    const currentName = user.user_metadata?.full_name || '';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
                <h3>帳號設定</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <form class="account-settings-form">
                    <div class="form-group">
                        <label for="acct-email">電子郵件</label>
                        <input type="email" id="acct-email" value="${user.email || ''}" class="form-input" readonly style="background: var(--bg-secondary); color: var(--text-muted);">
                        <small style="color: var(--text-muted); font-size: 0.75rem;">Email 不可修改（之後想換要由管理員另建帳號）</small>
                    </div>
                    <div class="form-group">
                        <label for="acct-name">顯示名稱</label>
                        <input type="text" id="acct-name" value="${currentName.replace(/"/g, '&quot;')}" class="form-input" placeholder="例如：王經理">
                        <small style="color: var(--text-muted); font-size: 0.75rem;">顯示在 sidebar 跟操作紀錄上</small>
                    </div>

                    <div class="form-section" style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                        <h4 style="margin-bottom: 0.75rem;">變更密碼（選填）</h4>
                        <div class="form-group">
                            <label for="acct-old-pw">目前密碼 <span style="color: var(--text-muted); font-size: 0.75rem;">(改密碼時必填)</span></label>
                            <div class="password-field-wrap">
                                <input type="password" id="acct-old-pw" class="form-input" autocomplete="current-password" placeholder="留空表示不改密碼">
                                <button type="button" class="password-toggle" data-target="acct-old-pw" title="顯示 / 隱藏密碼" aria-label="顯示密碼">
                                    <i class="ph ph-eye"></i>
                                </button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="acct-new-pw">新密碼</label>
                            <div class="password-field-wrap">
                                <input type="password" id="acct-new-pw" class="form-input" autocomplete="new-password" placeholder="至少 6 字元，留空表示不改">
                                <button type="button" class="password-toggle" data-target="acct-new-pw" title="顯示 / 隱藏密碼" aria-label="顯示密碼">
                                    <i class="ph ph-eye"></i>
                                </button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="acct-confirm-pw">確認新密碼</label>
                            <div class="password-field-wrap">
                                <input type="password" id="acct-confirm-pw" class="form-input" autocomplete="new-password">
                                <button type="button" class="password-toggle" data-target="acct-confirm-pw" title="顯示 / 隱藏密碼" aria-label="顯示密碼">
                                    <i class="ph ph-eye"></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div id="acct-error" class="auth-error" hidden style="margin-top: 1rem;"></div>

                    <div class="form-actions" style="margin-top: 1.25rem;">
                        <button type="button" class="btn btn-outline" data-action="logout" style="color: var(--color-danger); margin-right: auto;">
                            <i class="ph ph-sign-out"></i> 登出
                        </button>
                        <button type="button" class="btn btn-outline" data-action="cancel">取消</button>
                        <button type="submit" class="btn btn-primary">儲存變更</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.querySelector('[data-action="cancel"]').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('[data-action="logout"]').addEventListener('click', async () => {
        if (confirm('確定要登出？')) await signOut();
    });

    // 密碼顯示/隱藏切換
    bindPasswordToggles(modal);

    const errEl = modal.querySelector('#acct-error');
    const showErr = (msg) => { errEl.hidden = false; errEl.textContent = msg; };

    modal.querySelector('.account-settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        errEl.hidden = true;
        const newName = modal.querySelector('#acct-name').value.trim();
        const oldPw = modal.querySelector('#acct-old-pw').value;
        const newPw = modal.querySelector('#acct-new-pw').value;
        const confirmPw = modal.querySelector('#acct-confirm-pw').value;

        if (newPw && newPw !== confirmPw) { showErr('兩次輸入的新密碼不一致'); return; }
        if (newPw && newPw.length < 6) { showErr('密碼至少 6 字元'); return; }
        if (newPw && !oldPw) { showErr('改密碼前要先輸入目前密碼驗證身份'); return; }

        const submitBtn = modal.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = '儲存中…';

        try {
            const changes = [];
            if (newName !== currentName) {
                const updatedUser = await updateDisplayName(newName);
                updateUserProfile(updatedUser);
                changes.push('顯示名稱');
            }
            if (newPw) {
                await updatePassword(newPw, oldPw);
                changes.push('密碼');
            }
            close();
            showToast(changes.length ? `已更新：${changes.join('、')}` : '沒有變更', 'success');
        } catch (e) {
            showErr(`儲存失敗：${e.message}`);
            submitBtn.disabled = false;
            submitBtn.textContent = '儲存變更';
        }
    });
};
