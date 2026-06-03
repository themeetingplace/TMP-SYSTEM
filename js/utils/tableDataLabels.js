// 自動為 data-table 的每個 td 加 data-label 屬性 — 對應 UIUX_AUDIT M-R-2
//
// 配合 CSS 媒體查詢，手機 (≤ 600px) 把 table 轉成「卡片列表」呈現：
//   每個 td 變成一行：label (從 thead 來) ｜ value
//   桌面不受影響
//
// 由 app.js handleRoute() 在每次 view 切換後呼叫一次。

export function autoAddDataLabels(scope) {
    if (!scope) scope = document;
    scope.querySelectorAll('.data-table').forEach(table => {
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => {
            // 只抓文字（忽略 icon）
            return th.textContent.replace(/\s+/g, ' ').trim();
        });
        if (!headers.length) return;
        table.querySelectorAll('tbody tr').forEach(tr => {
            Array.from(tr.children).forEach((td, idx) => {
                if (td.dataset.label) return;          // 已有 label 不覆蓋
                if (td.classList.contains('empty-state')) return;
                if (headers[idx]) td.dataset.label = headers[idx];
            });
        });
    });
}
