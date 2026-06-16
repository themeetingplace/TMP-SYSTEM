import { renderDashboard } from './views/dashboard.js';
import { renderPropertiesHub, initPropertiesHubActions, forceHubTab } from './views/properties-hub.js';
import { renderManagedHouse, initManagedHouseActions, showNewManagedHouseForm } from './views/managed-house.js';
import { renderManagedOwners, initManagedOwnersActions } from './views/managed-owners.js';
import { renderManagedSettlements, initManagedSettlementsActions } from './views/managed-settlements.js';
import { initModeSwitcher } from './utils/sidebarRender.js';
import { getMode, applyModeAttribute } from './utils/appMode.js';
import { promptRenewalAuditIfNeeded, promptBundleAuditIfNeeded } from './utils/renewalAudit.js';
import { renderContracts, initContractActions } from './views/contracts.js';
import { renderFinance, initFinanceActions } from './views/finance.js';
import { renderUnsettled, initUnsettledActions } from './views/unsettled.js';
import { renderReports, initReportsActions } from './views/reports.js';
import { reportState } from './views/report-state.js';
import { renderMaintenance, initMaintenanceActions } from './views/maintenance.js';
import { renderTenants, initTenantActions } from './views/tenants.js';
import { renderSettings, initSettingsActions } from './views/settings.js';
import { renderAdminUsers, initAdminUsersActions } from './views/admin-users.js';
import { initTableInteractions } from './utils/tableFilter.js';
import { initGlobalSearch, initNotifications } from './utils/topbar.js';
import { initSidebar } from './utils/sidebar.js';
import './utils/entityNav.js'; // UIUX #2: 暴露 window.openEntity(type, id)
import { applyPendingRowFlash } from './utils/rowFlash.js'; // QW: CRUD 後 row 黃光閃
import { autoFixA11y } from './utils/a11yAutoFix.js';      // C-3: icon-only button 自動補 aria-label
import { autoAddDataLabels } from './utils/tableDataLabels.js'; // M-R-2: data-table 手機版自動轉卡片
import { showToast } from './utils/ui.js';
import './setup.js'; // 載入 console 偵錯工具（quickTest / testSupabaseConnection）
import './migrate-to-supabase.js'; // 暴露 migrateToSupabase() / clearAllSupabase()
import { bootstrap as syncBootstrap } from './sync.js'; // 雲端同步引擎
import { getSession, signOut, updateDisplayName, updatePassword, updateAvatar, clearSensitiveLocalCache, checkIsAdmin, checkIsOwner, getCurrentRole } from './auth.js';
import { showLogin, showAccessDenied, bindPasswordToggles } from './views/login.js';
import { applyAvatar, getAvatar, AVATAR_ICONS, AVATAR_COLORS } from './utils/avatar.js';
import { APP_VERSION, APP_BUILD_DATE, APP_NAME, APP_COPYRIGHT, APP_CHANGELOG } from './version.js';

const viewContainer = document.getElementById('view-container');
const pageTitle = document.getElementById('page-title');
const navItems = document.querySelectorAll('.nav-item');

// 角色說明：
//   owner / admin / viewer = 看得到全部分頁 (差別在能不能管帳號 / 寫入)
//   helper = 小幫手 → 只能看 物件管理 / 住房一覽 / 租客清單，且寫入按鈕全隱藏
//   helper 預設首頁 = 住房一覽 (#occupancy)，不給看 dashboard
const HELPER_ALLOWED = new Set(['properties', 'occupancy', 'tenants']);
const HELPER_DEFAULT_HASH = 'occupancy';
const routes = {
    dashboard:     { title: '首頁',         group: '總覽', render: renderDashboard },
    properties:    { title: '物件管理',     group: '營運', render: renderPropertiesHub, init: initPropertiesHubActions, isHub: true },
    occupancy:     { title: '住房一覽',     group: '營運', render: renderPropertiesHub, init: initPropertiesHubActions, isHub: true, forceHubTab: 'occupancy' },
    contracts:     { title: '合約管理',     group: '營運', render: renderContracts,  init: initContractActions },
    finance:       { title: '總收支表',     group: '帳務', render: renderFinance,    init: initFinanceActions },
    unsettled:     { title: '房租查帳',     group: '帳務', render: renderUnsettled,  init: initUnsettledActions },
    reports:       { title: '報表',         group: '分析', render: renderReports,    init: initReportsActions },
    maintenance:   { title: '維修管理',     group: '營運', render: renderMaintenance,init: initMaintenanceActions },
    tenants:       { title: '租客清單',     group: '營運', render: renderTenants,    init: initTenantActions },
    settings:      { title: '系統設定',     group: '系統', render: renderSettings,   init: initSettingsActions },
    'admin-users': { title: '帳號管理',     group: '系統', render: renderAdminUsers, init: initAdminUsersActions, ownerOnly: true },
    // 代管模式 routes
    'm-house':       { title: '代管房屋',       group: '代管', render: renderManagedHouse,       init: initManagedHouseActions, dynamic: true },
    'm-house-new':   { title: '新增代管房屋',   group: '代管', render: () => { setTimeout(showNewManagedHouseForm, 50); return '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">開啟新增代管房屋表單中…</div>'; } },
    'm-owners':      { title: '屋主管理',       group: '代管', render: renderManagedOwners,      init: initManagedOwnersActions },
    'm-settlements': { title: '屋主月結算',     group: '代管', render: renderManagedSettlements, init: initManagedSettlementsActions }
};

function handleRoute() {
    let hash = window.location.hash.substring(1);
    // 舊 URL #analysis 重定向到 #reports 並切到交叉分析 tab (不破壞 bookmark)
    if (hash === 'analysis') {
        reportState.activeTab = 'analysis';
        window.location.hash = 'reports';
        return;
    }
    // 動態 route: #m-house/{buildingId} → 取 base 'm-house' 查 routes
    // (買 sidebar 動態連結) — 同樣模式未來加 #other/{id} 也可重用
    const baseHash = hash.includes('/') ? hash.split('/')[0] : hash;
    if (!hash || !routes[baseHash]) {
        // helper 預設進住房一覽，其他角色進首頁
        hash = window.__currentRole === 'helper' ? HELPER_DEFAULT_HASH : 'dashboard';
        window.location.hash = hash;
        return;
    }

    const route = routes[baseHash];
    // owner-only route guard：非 owner 直接打 #admin-users 也擋掉
    if (route.ownerOnly && window.__currentRole !== 'owner') {
        showToast('此頁僅限 Owner 存取', 'warning');
        window.location.hash = 'dashboard';
        return;
    }
    // helper-only route guard：小幫手只能看白名單裡的頁面
    if (window.__currentRole === 'helper' && !HELPER_ALLOWED.has(hash)) {
        showToast('小幫手只能檢視 物件管理 / 住房一覽 / 租客清單', 'warning', 4000);
        window.location.hash = HELPER_DEFAULT_HASH;
        return;
    }
    pageTitle.textContent = route.title;
    // M-2: 更新 breadcrumb (取代寫死的「聚空間」eyebrow)
    const breadcrumbEl = document.getElementById('page-breadcrumb');
    if (breadcrumbEl) {
        if (route.group) {
            breadcrumbEl.innerHTML = `${route.group} <span class="pb-sep">›</span> <span class="pb-current">${route.title}</span>`;
        } else {
            breadcrumbEl.textContent = route.title;
        }
    }
    // M-R-1: 切頁後自動關閉手機 drawer
    closeMobileDrawer();

    // Update Nav Activity
    // 帳務管理: finance / unsettled → 映射到 sidebar 的「帳務管理」
    // 收支分析已搬到 reports (報表) 之下
    const FINANCE_GROUP = ['finance', 'unsettled'];
    const sidebarHash = FINANCE_GROUP.includes(baseHash) ? 'finance' : baseHash;
    // sidebar 每次 mode 切換會重 render，所以 navItems 要重抓
    document.querySelectorAll('.sidebar .nav-item').forEach(item => {
        const matchesView = item.dataset.view === sidebarHash;
        // 代管房屋 sidebar item 還要進一步比對 houseId
        if (baseHash === 'm-house' && item.dataset.view === 'm-house') {
            const houseIdInHash = hash.split('/')[1];
            item.classList.toggle('active', item.dataset.houseId === houseIdInHash);
        } else {
            item.classList.toggle('active', matchesView);
        }
    });

    // 物件管理 hub：#occupancy 進來會 lock 在「住房一覽」tab；其他用 localStorage
    if (route.isHub) {
        forceHubTab(route.forceHubTab || null);
    }

    // Clear Container and Render
    viewContainer.innerHTML = '';

    const viewElement = document.createElement('div');
    viewElement.className = 'view-section active';
    viewElement.innerHTML = route.render();
    viewContainer.appendChild(viewElement);

    // 套用通用表格互動（dashboard / settings / occupancy / hub 不適用）
    //   dashboard: 沒表格
    //   settings: 有 sub-tab 自管表格
    //   occupancy: 矩陣表，不分頁；橫向滾動處理寬度
    //   hub: 自己管 (每個 tab 切換時呼叫 initTableInteractions)
    if (baseHash !== 'dashboard' && baseHash !== 'settings' && baseHash !== 'occupancy' && baseHash !== 'm-house' && !route.isHub) {
        initTableInteractions({ scope: viewElement, rowsPerPage: 10 });
    }

    // 各 view 自己的 init（綁定事件等）
    if (typeof route.init === 'function') {
        route.init(viewElement);
    }

    // Dashboard 圖表
    if (baseHash === 'dashboard' && window.initDashboardChart) {
        window.initDashboardChart();
        if (window.initDashboardInteractions) {
            window.initDashboardInteractions();
        }
    }

    // QW: 若 store 操作前有排程 row-flash，這裡套用
    applyPendingRowFlash();

    // C-3: 自動補 aria-label / aria-hidden
    autoFixA11y(viewElement);

    // M-R-2: 自動為 td 加 data-label，配合 CSS 在手機上轉卡片排版
    autoAddDataLabels(viewElement);

    // M-R-5: 手機 FAB — 找 [data-fab] 主要按鈕，做一個底部固定 FAB 代理它
    updateMobileFab(viewElement);
}

function updateMobileFab(viewElement) {
    document.querySelector('.mobile-fab')?.remove();
    const primary = viewElement.querySelector('[data-fab]');
    if (!primary) return;
    const icon = primary.dataset.fab || 'ph-plus';
    const label = primary.textContent.replace(/\s+/g, ' ').trim() || '新增';
    const fab = document.createElement('button');
    fab.className = 'mobile-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', label);
    fab.title = label;
    fab.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
    fab.addEventListener('click', () => primary.click());
    document.body.appendChild(fab);
}

// P1-15: localStorage 滿時跳 toast 警告
window.addEventListener('bms:storage-full', () => {
    showToast('本機儲存空間已滿，編輯可能無法保留到下次重整。請聯絡開發者改用 IndexedDB', 'danger', 8000);
});

// invoice 金額改動 → 反推合約月租 + property.rent，提示用戶有連動到
window.addEventListener('bms:invoice-sync-contract', (e) => {
    const { invoiceId, contractId, oldAmount, newAmount, newMonthlyRent } = e.detail || {};
    if (!contractId) return;
    const diff = (Number(newAmount) || 0) - (Number(oldAmount) || 0);
    const sign = diff >= 0 ? '+' : '−';
    const absDiff = Math.abs(diff).toLocaleString();
    showToast(
        `已連動更新：合約 <strong>${contractId}</strong> 月租同步為 <strong>$${(newMonthlyRent || 0).toLocaleString()}</strong> ` +
        `<span style="opacity:0.8;">(帳單 ${invoiceId} ${sign}$${absDiff})</span>`,
        'success',
        6000
    );
});

// 合約月租改動 → 反向同步房租 invoice 金額
window.addEventListener('bms:contract-sync-invoice', (e) => {
    const { contractId, invoiceId, oldAmount, newAmount } = e.detail || {};
    if (!invoiceId) return;
    const diff = (Number(newAmount) || 0) - (Number(oldAmount) || 0);
    const sign = diff >= 0 ? '+' : '−';
    const absDiff = Math.abs(diff).toLocaleString();
    showToast(
        `已連動更新：帳單 <strong>${invoiceId}</strong> 金額同步為 <strong>$${(newAmount || 0).toLocaleString()}</strong> ` +
        `<span style="opacity:0.8;">(合約 ${contractId} ${sign}$${absDiff})</span>`,
        'success',
        6000
    );
});

// M-R-1: 手機 sidebar drawer 開關
function isMobileDrawerOpen() {
    return document.querySelector('.sidebar')?.classList.contains('is-mobile-open');
}
function openMobileDrawer() {
    document.querySelector('.sidebar')?.classList.add('is-mobile-open');
    document.getElementById('sidebar-backdrop')?.classList.add('is-open');
    document.body.style.overflow = 'hidden';
}
function closeMobileDrawer() {
    document.querySelector('.sidebar')?.classList.remove('is-mobile-open');
    document.getElementById('sidebar-backdrop')?.classList.remove('is-open');
    document.body.style.overflow = '';
}
function toggleMobileDrawer() {
    if (isMobileDrawerOpen()) closeMobileDrawer(); else openMobileDrawer();
}

window.addEventListener('DOMContentLoaded', () => {
    // 漢堡 = toggle (不是只能開)
    document.getElementById('topbar-hamburger')?.addEventListener('click', toggleMobileDrawer);
    // 點 backdrop 關
    document.getElementById('sidebar-backdrop')?.addEventListener('click', closeMobileDrawer);
    // ESC 關閉
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMobileDrawer();
    });
    // 手機在 drawer 內點原本的 sidebar-toggle (sidebar header 內) → 也關 drawer
    document.querySelector('.sidebar-toggle')?.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            e.stopPropagation();   // 不讓原本的 is-collapsed toggle 行為觸發
            e.preventDefault();
            closeMobileDrawer();
        }
    }, true);  // capture phase 確保比 sidebar.js 的 handler 先跑
    // T3-M-3: 視窗放大過 768 時自動關 drawer，避免桌面殘留
    let _resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
            if (window.innerWidth > 768) closeMobileDrawer();
        }, 100);
    });

    // T3R-#10: drawer swipe-to-close 手勢
    // 在 sidebar 上偵測左滑：startX 在 drawer 內、deltaX < -60 即關閉
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        let startX = 0, startY = 0, isTracking = false;
        sidebar.addEventListener('touchstart', (e) => {
            if (!isMobileDrawerOpen()) return;
            if (e.touches.length !== 1) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isTracking = true;
            sidebar.style.transition = 'none';   // 暫停 css transition，跟手指
        }, { passive: true });
        sidebar.addEventListener('touchmove', (e) => {
            if (!isTracking) return;
            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;
            // 垂直滑動為主 (例如想滑 nav) → 不攔截
            if (Math.abs(dy) > Math.abs(dx)) { isTracking = false; sidebar.style.transition = ''; return; }
            // 只允許往左拖（dx < 0），往右拖固定 0
            const tx = Math.min(0, dx);
            sidebar.style.transform = `translateX(${tx}px)`;
            // backdrop 透明度隨拖動變化
            const bd = document.getElementById('sidebar-backdrop');
            if (bd) bd.style.opacity = String(Math.max(0, 1 + tx / 280));
        }, { passive: true });
        sidebar.addEventListener('touchend', (e) => {
            if (!isTracking) return;
            isTracking = false;
            sidebar.style.transition = '';   // 還原 transition
            sidebar.style.transform = '';
            const bd = document.getElementById('sidebar-backdrop');
            if (bd) bd.style.opacity = '';
            const dx = (e.changedTouches[0]?.clientX || startX) - startX;
            if (dx < -60) closeMobileDrawer();
        }, { passive: true });
    }
});

// QW-C5: 全域 "/" 鍵聚焦 topbar 搜尋 (UI 上已有 kbd 提示)
window.addEventListener('keydown', (e) => {
    if (e.key !== '/') return;
    // 不要在輸入欄位裡攔截
    const t = e.target;
    if (t.matches && t.matches('input, textarea, [contenteditable="true"]')) return;
    const searchInput = document.querySelector('.search-bar input');
    if (searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
    }
});

// QW-AC1: Chart.js 全域動畫縮短 (從 1000ms 預設改成 250ms)，並 respect prefers-reduced-motion
if (typeof window.Chart !== 'undefined') {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.Chart.defaults.animation = {
        duration: reduceMotion ? 0 : 250,
        easing: 'easeOutCubic'
    };
}

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

    // 1.6 取實際角色 (owner / admin / helper / viewer) — 給 nav 顯示控制 + route guard 用
    const myRole = await getCurrentRole();
    window.__currentRole = myRole || 'admin'; // null → 預設 admin 避免破前端
    document.body.dataset.role = window.__currentRole;
    if (window.__currentRole === 'owner') {
        const navAdminUsers = document.getElementById('nav-admin-users');
        if (navAdminUsers) navAdminUsers.classList.remove('is-hidden');
    }
    // helper → 隱藏非白名單的 nav 項目 (包含首頁)
    if (window.__currentRole === 'helper') {
        document.querySelectorAll('.nav-item[data-view]').forEach(el => {
            const view = el.dataset.view;
            if (!HELPER_ALLOWED.has(view)) el.style.display = 'none';
        });
        // 整個 group 都被隱掉的話順手收起 label
        document.querySelectorAll('.nav-group').forEach(group => {
            const visibleItems = Array.from(group.querySelectorAll('.nav-item')).filter(el => el.style.display !== 'none');
            if (visibleItems.length === 0) group.style.display = 'none';
        });
        // 強制把當前路徑改成 helper 預設頁 (避免登入時還停在 #dashboard)
        if (!HELPER_ALLOWED.has(window.location.hash.substring(1))) {
            window.location.hash = HELPER_DEFAULT_HASH;
        }
    }

    // 2. 顯示登入者資訊在 sidebar
    updateUserProfile(session.user);
    // 帶入版本號 (sidebar footer)
    const versionEl = document.getElementById('app-version-num');
    if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

    // 3. 主介面初始化
    initSidebar();
    applyModeAttribute();
    initModeSwitcher({
        onSwitch: (mode) => {
            // 切換模式 → 跳到該模式的合理首頁
            const target = mode === 'managed' ? 'm-owners' : 'dashboard';
            const current = window.location.hash.substring(1);
            if (current === target) {
                // 同 hash 不會觸發 hashchange，手動 handleRoute 重 render
                handleRoute();
            } else {
                window.location.hash = target;
            }
        }
    });
    initGlobalSearch();
    initNotifications();

    // 4. 雲端優先：開機先拉一次 Supabase 才渲染
    showBootLoading();
    const result = await syncBootstrap();
    hideBootLoading();
    if (!result.success) {
        showToast(`雲端載入失敗：${result.error?.message || result.error}。將使用本機備援資料`, 'warning', 8000);
    }
    // sync 完才有真實 buildings/owners → 代管 mode 需要重 render sidebar
    if (getMode() === 'managed') {
        const { renderSidebarForMode } = await import('./utils/sidebarRender.js');
        renderSidebarForMode('managed');
    }
    handleRoute();
    // 資料載完後跑 audit (dry-run) — 有 affected 才彈 modal
    setTimeout(() => promptRenewalAuditIfNeeded(), 800);
    setTimeout(() => promptBundleAuditIfNeeded(), 1200);
});

function updateUserProfile(user) {
    const nameEl = document.querySelector('.user-profile .user-name');
    const avatarEl = document.querySelector('.user-profile .avatar');
    if (nameEl) {
        const email = user?.email || '使用者';
        const displayName = user?.user_metadata?.full_name || email.split('@')[0];
        nameEl.textContent = displayName;
    }
    // applyAvatar 處理 icon 模式 / letter 模式自動切換
    applyAvatar(avatarEl, user);
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
                    <div class="about-logo"><img src="assets/logo-icon.png?v=20260603g" alt="聚空間"></div>
                    <div>
                        <div class="about-name">${APP_NAME}</div>
                        <div class="about-company" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem;">聚空間租賃管理顧問有限公司</div>
                        <div class="about-version">v${APP_VERSION} · ${APP_BUILD_DATE}</div>
                    </div>
                </div>
                <div class="about-section">
                    <div class="about-section-label">說明文件</div>
                    <a href="docs/USER-MANUAL.html" target="_blank" rel="noopener" class="about-manual-link">
                        <i class="ph ph-book-open"></i>
                        <span>
                            <strong>使用手冊</strong>
                            <small>入住 / 退房 / 收支 / LINE 自動回覆 對照</small>
                        </span>
                        <i class="ph ph-arrow-up-right"></i>
                    </a>
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

                    <div class="form-group">
                        <label>頭像</label>
                        <div class="avatar-picker">
                            <div class="avatar-preview-wrap">
                                <span class="avatar avatar-preview" id="acct-avatar-preview">A</span>
                                <button type="button" class="btn btn-outline btn-sm" id="acct-avatar-clear" style="font-size: 0.75rem; padding: 0.3rem 0.6rem;">
                                    <i class="ph ph-letter-circle-h"></i> 改回字母
                                </button>
                            </div>
                            <div class="avatar-picker-rows">
                                <div class="avatar-picker-row">
                                    <small class="avatar-picker-label">圖示</small>
                                    <div class="avatar-icon-grid" id="acct-avatar-icons">
                                        ${AVATAR_ICONS.map(i => `
                                            <button type="button" class="avatar-icon-btn" data-icon="${i.id}" title="${i.label}">
                                                <i class="ph-fill ph-${i.id}"></i>
                                            </button>
                                        `).join('')}
                                    </div>
                                </div>
                                <div class="avatar-picker-row">
                                    <small class="avatar-picker-label">底色</small>
                                    <div class="avatar-color-grid" id="acct-avatar-colors">
                                        ${Object.entries(AVATAR_COLORS).map(([key, c]) => `
                                            <button type="button" class="avatar-color-btn" data-color="${key}" title="${c.label}" style="background: ${c.value};"></button>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>
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

    // === Avatar picker 互動 ===
    const initialAvatar = getAvatar(user);
    // pendingAvatar 用 null 代表「字母模式」，否則是 { icon, color }
    let pendingAvatar = initialAvatar ? { ...initialAvatar } : null;
    const previewEl = modal.querySelector('#acct-avatar-preview');
    const fakeUserForPreview = (avatarMeta) => ({
        email: user.email,
        user_metadata: { ...user.user_metadata, avatar: avatarMeta }
    });
    const refreshPreview = () => {
        applyAvatar(previewEl, fakeUserForPreview(pendingAvatar));
        // 高亮目前選的 icon / color
        modal.querySelectorAll('.avatar-icon-btn').forEach(b => {
            b.classList.toggle('is-active', pendingAvatar && b.dataset.icon === pendingAvatar.icon);
        });
        modal.querySelectorAll('.avatar-color-btn').forEach(b => {
            b.classList.toggle('is-active', pendingAvatar && b.dataset.color === pendingAvatar.color);
        });
    };
    refreshPreview();
    modal.querySelectorAll('.avatar-icon-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            pendingAvatar = pendingAvatar || { icon: null, color: 'orange' };
            pendingAvatar.icon = btn.dataset.icon;
            if (!pendingAvatar.color) pendingAvatar.color = 'orange';
            refreshPreview();
        });
    });
    modal.querySelectorAll('.avatar-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            pendingAvatar = pendingAvatar || { icon: 'cat', color: null };
            pendingAvatar.color = btn.dataset.color;
            if (!pendingAvatar.icon) pendingAvatar.icon = 'cat';
            refreshPreview();
        });
    });
    modal.querySelector('#acct-avatar-clear').addEventListener('click', () => {
        pendingAvatar = null;
        refreshPreview();
    });

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

        // 判斷頭像是否變動
        const initialKey = initialAvatar ? `${initialAvatar.icon}:${initialAvatar.color}` : '_letter_';
        const pendingKey = pendingAvatar ? `${pendingAvatar.icon}:${pendingAvatar.color}` : '_letter_';
        const avatarChanged = initialKey !== pendingKey;

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
            if (avatarChanged) {
                const updatedUser = await updateAvatar(pendingAvatar);
                updateUserProfile(updatedUser);
                changes.push('頭像');
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
