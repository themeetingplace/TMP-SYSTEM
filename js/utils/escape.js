// 防 XSS：把字串內的 HTML 特殊字元轉成 entity
// 凡是要把「用戶可輸入內容」(租客名 / 地址 / 備註 / displayName 等) 塞到 innerHTML 都要過這個
//
// 用法:
//   import { escapeHtml as esc } from '../utils/escape.js';
//   container.innerHTML = `<td>${esc(tenant.name)}</td>`;
//
// 注意：用戶輸入有時候要保留換行 → 用 escapeHtmlMultiline (轉 \n → <br>)

export function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export function escapeHtmlMultiline(s) {
    return escapeHtml(s).replace(/\n/g, '<br>');
}

// 把字串放 attribute (title="...") 用 — 把 " 換 &quot; 就夠
export function escapeAttr(s) {
    if (s == null) return '';
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
