// 側邊欄收合控制
// - 點 sidebar header 內的收合按鈕，在「展開 (260px)」與「收合 (76px)」間切換
// - 收合狀態存 localStorage，下次開頁面記憶
// - 不影響任何資料 / 路由邏輯

const STORAGE_KEY = 'bms-sidebar-collapsed';
const NAV_COLLAPSED_KEY = 'bms-nav-collapsed-groups'; // 記住哪些 parent 是收合狀態

function readStoredCollapsed() {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

function writeStoredCollapsed(value) {
    try {
        localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch (e) { /* ignore */ }
}

export function initSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    // 套用儲存的收合狀態
    if (readStoredCollapsed()) {
        sidebar.classList.add('is-collapsed');
    }

    // 收合按鈕
    const collapseBtn = document.querySelector('[data-action="toggle-sidebar"]');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            const next = !sidebar.classList.contains('is-collapsed');
            sidebar.classList.toggle('is-collapsed', next);
            writeStoredCollapsed(next);
        });
    }

    // 帳戶區的快捷按鈕：阻止冒泡到 user-profile (避免同時開帳號設定 modal)
    sidebar.querySelectorAll('.profile-action').forEach(btn => {
        btn.addEventListener('click', (e) => e.stopPropagation());
    });

    // 清掉舊版可能殘留的 mobile drawer DOM
    document.querySelectorAll('.sidebar-backdrop').forEach(b => b.remove());
    sidebar.classList.remove('is-open');

    // === Nav 父項收合 (物件管理 / 帳務管理 等)
    const collapsed = readCollapsedGroups();
    Object.keys(collapsed).forEach(key => {
        if (collapsed[key]) applyGroupCollapse(key, true);
    });

    sidebar.querySelectorAll('.nav-collapse-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); // 不要連帶觸發 parent <a> 的導航
            const key = btn.dataset.collapseTarget;
            const next = !btn.classList.contains('is-collapsed');
            applyGroupCollapse(key, next);
            const map = readCollapsedGroups();
            map[key] = next;
            writeCollapsedGroups(map);
        });
    });
}

function applyGroupCollapse(key, isCollapsed) {
    const btn = document.querySelector(`.nav-collapse-btn[data-collapse-target="${key}"]`);
    const children = document.querySelector(`.nav-children[data-children-of="${key}"]`);
    if (btn) btn.classList.toggle('is-collapsed', isCollapsed);
    if (children) children.classList.toggle('is-collapsed', isCollapsed);
}

function readCollapsedGroups() {
    try { return JSON.parse(localStorage.getItem(NAV_COLLAPSED_KEY) || '{}'); }
    catch { return {}; }
}
function writeCollapsedGroups(map) {
    try { localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(map)); }
    catch { /* ignore */ }
}
