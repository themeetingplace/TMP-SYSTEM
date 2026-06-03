// 無障礙自動修補 — 對應 UIUX_AUDIT C-3
//
// 由 app.js handleRoute() 後呼叫，自動掃描剛渲染的 view：
//   1. icon-only button / a 沒有 aria-label 時，用 title 屬性回填
//   2. button / a 內的 <i class="ph..."> 加 aria-hidden="true"
//
// 為什麼不每個 view 手動加：12 個 view、200+ 個 icon button 一一改成本高。
// 全域 hook 一次解決，且未來新 component 不用記得加 a11y 屬性。

export function autoFixA11y(scope) {
    if (!scope) scope = document;

    // 1. icon-only button / link 自動補 aria-label
    scope.querySelectorAll('button[title]:not([aria-label]), a[title]:not([aria-label])').forEach(el => {
        // 判斷是否「icon-only」: textContent 只含空白
        const text = (el.textContent || '').replace(/\s+/g, '').trim();
        if (text.length === 0) {
            const title = el.getAttribute('title');
            if (title) el.setAttribute('aria-label', title);
        }
    });

    // 2. button / a 內的 phosphor icon 全加 aria-hidden（screen reader 略過）
    scope.querySelectorAll(
        'button > i.ph:not([aria-hidden]), button > i.ph-fill:not([aria-hidden]), ' +
        'a > i.ph:not([aria-hidden]), a > i.ph-fill:not([aria-hidden]), ' +
        '.metric-icon i:not([aria-hidden]), ' +
        '.status-badge i:not([aria-hidden])'
    ).forEach(i => i.setAttribute('aria-hidden', 'true'));

    // 3. 表單欄位有 required 但沒 aria-required，自動補
    scope.querySelectorAll('input[required]:not([aria-required]), textarea[required]:not([aria-required]), select[required]:not([aria-required])').forEach(el => {
        el.setAttribute('aria-required', 'true');
    });
}
