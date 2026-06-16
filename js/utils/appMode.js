// 共居 / 代管 模式切換 — sidebar 跟 routing 都依這個決定
// 一切以 getMode() 為準，setMode() 會 dispatch event 觸發 sidebar / view 重 render

const STORAGE_KEY = 'pms-app-mode';
const VALID_MODES = ['cohousing', 'managed'];
const DEFAULT_MODE = 'cohousing';

let currentMode = (() => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (VALID_MODES.includes(saved)) return saved;
    } catch {}
    return DEFAULT_MODE;
})();

export function getMode() {
    return currentMode;
}

export function setMode(mode) {
    if (!VALID_MODES.includes(mode)) return false;
    if (mode === currentMode) return false;
    currentMode = mode;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
    document.body.dataset.appMode = mode;
    window.dispatchEvent(new CustomEvent('pms:mode-change', { detail: { mode } }));
    return true;
}

export function isManaged() {
    return currentMode === 'managed';
}

export function isCohousing() {
    return currentMode === 'cohousing';
}

// 用在 DOMContentLoaded — 把當前 mode 寫到 body 上 (給 CSS 用)
export function applyModeAttribute() {
    document.body.dataset.appMode = currentMode;
}
