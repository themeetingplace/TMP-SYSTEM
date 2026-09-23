// 統一的「打開某個實體 detail」入口 (UIUX #2 全域搜尋 + dashboard 待辦直達)
//
// 用法:
//   openEntity('contract', 'C012');   // → 跳合約管理頁 + 打開 C012 詳情 modal
//   openEntity('tenant',  'T003');    // → 跳租客清單 + 打開 T003 詳情 modal
//   openEntity('property','P040');
//   openEntity('maintenance','M005');
//   openEntity('invoice', 'INV-202605-01');  // → 跳帳務 + scroll + highlight 該列
//
// 同頁時不重複導頁，直接呼叫 detail 函式 (省一次 re-render)

import { showContractDetails } from '../views/contracts.js';
import { showTenantDetails } from '../views/tenants.js';
import { showPropertyDetails } from '../views/properties.js';
import { showMaintenanceDetails } from '../views/maintenance.js';

const TYPE_TO_HASH = {
    property:    'properties',
    tenant:      'tenants',
    contract:    'contracts',
    invoice:     'finance',
    maintenance: 'maintenance',
};

export async function openEntity(type, id) {
    if (!type || !id) return;
    const targetHash = TYPE_TO_HASH[type];
    if (!targetHash) return;
    const currentHash = (window.location.hash.replace(/^#/, '') || 'dashboard');

    // 不在目標頁 → 先換頁，等 view 渲染完才開 modal
    if (currentHash !== targetHash) {
        window.location.hash = targetHash;
        // 等 handleRoute 完成 (典型 60-150ms)
        await new Promise(r => setTimeout(r, 180));
    }

    try {
        switch (type) {
            case 'property':    showPropertyDetails(id); break;
            case 'tenant':      showTenantDetails(id); break;
            case 'contract':    showContractDetails(id); break;
            case 'maintenance': showMaintenanceDetails(id); break;
            case 'invoice':     highlightTableRowById(id); break;
            default: break;
        }
    } catch (e) {
        console.error('[openEntity]', type, id, e);
    }
}

// 從住房一覽的合約詳情直達「合約管理」對應列。
// 與 openEntity('contract') 不同：這裡不再打開詳情 modal，而是清除舊篩選、
// 搜尋合約編號並高亮該列，讓「LINE 寄合約」等列表操作可以直接使用。
export async function focusContractInManagement(id) {
    if (!id) return;
    const currentHash = window.location.hash.replace(/^#/, '').split('/')[0] || 'dashboard';
    if (currentHash !== 'contracts') {
        window.location.hash = 'contracts';
        await new Promise(resolve => setTimeout(resolve, 180));
    }

    const scope = document.querySelector('.view-section.active');
    if (!scope) return;

    // 先清除館別／狀態／續租意願等既有篩選，避免目標列被篩掉。
    scope.querySelectorAll('[data-filter-value="all"]').forEach(btn => {
        if (!btn.classList.contains('active')) btn.click();
    });

    const searchInput = scope.querySelector('.card .search-bar input');
    if (searchInput) {
        searchInput.value = id;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    requestAnimationFrame(() => {
        const rows = Array.from(scope.querySelectorAll(`tr[data-row-id="${CSS.escape(id)}"]`));
        const row = rows.find(candidate => getComputedStyle(candidate).display !== 'none') || rows[0];
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.remove('row-flash');
        requestAnimationFrame(() => row.classList.add('row-flash'));
        setTimeout(() => row.classList.remove('row-flash'), 2400);
    });
}

// 帳務 / 報表頁沒 detail modal —— 改成捲到那列 + 短暫高亮
function highlightTableRowById(id) {
    // 用 data-row-id 或 search 字串找
    let row = document.querySelector(`tr[data-row-id="${CSS.escape(id)}"]`);
    if (!row) {
        // fallback: search dataset
        row = document.querySelector(`tr[data-search*="${CSS.escape(id.toLowerCase())}"]`);
    }
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('row-flash');
    setTimeout(() => row.classList.remove('row-flash'), 2200);
}

// 暴露給 dashboard / topbar 用 (避免重複 import)
window.openEntity = openEntity;
window.focusContractInManagement = focusContractInManagement;
