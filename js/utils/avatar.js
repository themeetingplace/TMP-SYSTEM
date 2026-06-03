// 頭像 helper — 內建 Phosphor icon avatars
// user_metadata.avatar = { icon: 'cat', color: 'orange' } 或 null (用字母)
//
// 用法：
//   import { applyAvatar, AVATAR_ICONS, AVATAR_COLORS } from './utils/avatar.js';
//   applyAvatar(document.querySelector('.avatar'), user);

// 內建 16 個圖示（Phosphor fill 變體，看起來像可愛的吉祥物）
export const AVATAR_ICONS = [
    { id: 'cat',         label: '貓' },
    { id: 'dog',         label: '狗' },
    { id: 'bird',        label: '鳥' },
    { id: 'fish',        label: '魚' },
    { id: 'butterfly',   label: '蝴蝶' },
    { id: 'paw-print',   label: '腳印' },
    { id: 'flower',      label: '花' },
    { id: 'tree',        label: '樹' },
    { id: 'coffee',      label: '咖啡' },
    { id: 'cookie',      label: '餅乾' },
    { id: 'rocket',      label: '火箭' },
    { id: 'robot',       label: '機器人' },
    { id: 'ghost',       label: '幽靈' },
    { id: 'smiley',      label: '笑臉' },
    { id: 'star',        label: '星星' },
    { id: 'crown',       label: '皇冠' }
];

// 8 個底色 — 跟 BMS 設計語言一致
export const AVATAR_COLORS = {
    orange:  { value: '#f97316', label: '橘' },
    emerald: { value: '#10b981', label: '綠' },
    blue:    { value: '#3b82f6', label: '藍' },
    purple:  { value: '#8b5cf6', label: '紫' },
    pink:    { value: '#ec4899', label: '粉' },
    yellow:  { value: '#eab308', label: '黃' },
    red:     { value: '#ef4444', label: '紅' },
    slate:   { value: '#64748b', label: '灰' }
};

// 從 user object 取 avatar metadata；沒有 → null
export function getAvatar(user) {
    const a = user?.user_metadata?.avatar;
    if (!a || typeof a !== 'object' || !a.icon) return null;
    return a;
}

// 把 .avatar 元素套用對應狀態（icon mode 或 letter mode）
// avatarEl: DOM 元素
// user: Supabase user object（會讀 user_metadata.avatar）
// fallbackChar: 沒設 avatar 時顯示的字母（預設用 email 第一個字）
export function applyAvatar(avatarEl, user, fallbackChar) {
    if (!avatarEl) return;
    const avatar = getAvatar(user);
    if (avatar) {
        const colorMeta = AVATAR_COLORS[avatar.color] || AVATAR_COLORS.orange;
        avatarEl.style.background = colorMeta.value;
        avatarEl.innerHTML = `<i class="ph-fill ph-${avatar.icon}"></i>`;
        avatarEl.dataset.avatarMode = 'icon';
    } else {
        const letter = fallbackChar || (user?.email || 'A')[0].toUpperCase();
        avatarEl.style.background = '';   // 還原 CSS 預設漸層
        avatarEl.innerHTML = '';
        avatarEl.textContent = letter;
        avatarEl.dataset.avatarMode = 'letter';
    }
}
