// UIUX #1: 帳務管理 sub-tab 共用元件 — 讓 finance / analysis / unsettled 三頁有橫向切換條
// 使用方式：在 view render 的最上面 prepend `renderFinanceSubTabs('finance' | 'analysis' | 'unsettled')`

const TABS = [
    { hash: 'unsettled', icon: 'ph-warning-circle', label: '房租查帳',   subtitle: '欠繳 / 未付追蹤' },
    // 總收支表 sub-tab 已拿掉 (sidebar 不再有入口)
    // 收支分析 已搬到 報表 → 交叉分析 tab
];

export const FINANCE_TAB_KEYS = TABS.map(t => t.hash);

export function renderFinanceSubTabs(activeHash) {
    // 只剩 1 個 tab → 不顯示切換條 (避免 UI 多餘)
    if (TABS.length <= 1) return '';
    return `
        <div class="finance-sub-tabs card" style="padding: 0.3rem; margin-bottom: 1rem; display: flex; gap: 0.25rem;">
            ${TABS.map(t => `
                <a href="#${t.hash}" class="finance-sub-tab ${t.hash === activeHash ? 'is-active' : ''}" title="${t.subtitle}">
                    <i class="ph ${t.icon}"></i>
                    <span class="fst-label">${t.label}</span>
                </a>
            `).join('')}
        </div>
    `;
}
