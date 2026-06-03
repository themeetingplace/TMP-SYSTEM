// row-flash helper — CRUD 後標示「剛剛改的那一列」
//
// 用法：
//   import { flashRowAfterRefresh } from '../utils/rowFlash.js';
//   store.updateProperty(id, patch);
//   flashRowAfterRefresh(id);   // 排程：下次 view 重畫時 highlight 該 tr
//   refreshView();
//
// 也支援 keyboard nav 跳到某一筆 (跟既有 highlightTableRowById 互通)

let pendingId = null;

export function flashRowAfterRefresh(id) {
    pendingId = String(id);
}

// 由 app.js 在 handleRoute 後呼叫一次
export function applyPendingRowFlash() {
    if (!pendingId) return;
    const id = pendingId;
    pendingId = null;
    // 用 requestAnimationFrame 確保 DOM 已 paint
    requestAnimationFrame(() => {
        const row = document.querySelector(`tr[data-row-id="${CSS.escape(id)}"]`);
        if (!row) return;
        row.classList.remove('row-flash');
        // force reflow so animation can restart
        void row.offsetWidth;
        row.classList.add('row-flash');
        // 動畫跑完移除 class，避免下次 hover 再觸發
        setTimeout(() => row.classList.remove('row-flash'), 2400);
        // 順便捲到視野內
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

// 對外暴露給 console 偵錯 / view 直接呼叫
if (typeof window !== 'undefined') {
    window.flashRowAfterRefresh = flashRowAfterRefresh;
}

// === 自動 hook 進 store 的 add/update 方法 ===
// 這樣所有 view 用 store.addProperty / store.updateProperty 後，下次 view re-render
// 都會自動 highlight 那一筆（不用每個 view 手動加 flashRowAfterRefresh 呼叫）
import { store } from '../data.js';

const HOOK_METHODS = [
    'addProperty',   'updateProperty',
    'addContract',   'updateContract',
    'addInvoice',    'updateInvoice',
    'addTenant',     'updateTenant',
    'addMaintenance','updateMaintenance',
    'addBuilding',   'updateBuilding',
    'addCheckin',    'updateCheckin'
];

HOOK_METHODS.forEach(name => {
    const original = store[name];
    if (typeof original !== 'function') return;
    store[name] = function(...args) {
        const result = original.apply(this, args);
        // add* 方法：id 在 return 物件
        // update* 方法：id 是第一個參數
        const id = name.startsWith('add') ? result?.id : args[0];
        if (id != null) flashRowAfterRefresh(id);
        return result;
    };
});
