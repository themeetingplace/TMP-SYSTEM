const STORAGE_KEY = 'pms-expense-quick-prefill-v1';

export function queueExpensePrefill(prefill = {}) {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
            category: prefill.category || 'daily_supplies',
            funding: prefill.funding || 'company'
        }));
    } catch {}
}

export function consumeExpensePrefill() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}
