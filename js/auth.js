// Supabase Auth 包裝
// 用 email + password 登入。帳號要先在 Supabase Dashboard 建好
// (Authentication → Users → Add user → 「Create new user」 + 直接設密碼)

import { supabase } from './supabase.js';

// 取得目前的 session（已登入 → 有 session.user；未登入 → null）
export async function getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
}

export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

// Google OAuth 登入 — 會跳轉到 Google 授權頁，授權後跳回本站並自動建 session
// 前置：Supabase Dashboard → Authentication → Providers → Google 要啟用且填好 Client ID/Secret
export async function signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            // 授權完跳回當前頁 (含 path，避免跳到根目錄)
            redirectTo: window.location.origin + window.location.pathname
        }
    });
    if (error) throw error;
    return data;
}

// 登出時要清掉的本機快取 (含個資的 mockData snapshot + 同步時戳)
// UI 偏好如 sidebar 收合狀態保留 (不含敏感資料)
const SENSITIVE_LOCAL_KEYS = ['bananas-bms-data-v1', 'bms-last-sync'];

export function clearSensitiveLocalCache() {
    SENSITIVE_LOCAL_KEYS.forEach(k => {
        try { localStorage.removeItem(k); } catch {}
    });
}

export async function signOut() {
    // 先清本機快取再登出 Supabase；避免下次登入時舊資料殘留
    clearSensitiveLocalCache();
    await supabase.auth.signOut();
    // 重整頁面讓 boot 流程重新跑（會回到登入畫面）
    location.reload();
}

// 更新顯示名稱 (寫到 user_metadata.full_name，登入後 sidebar 顯示用)
export async function updateDisplayName(fullName) {
    const { data, error } = await supabase.auth.updateUser({
        data: { full_name: fullName }
    });
    if (error) throw error;
    return data.user;
}

// 修改密碼 — P2-1: 要求重輸舊密碼驗證，防被劫持 session 任意改密碼
// 流程: 用 currentEmail + oldPassword 重新 signInWithPassword 驗證 → 通過才 updateUser
export async function updatePassword(newPassword, oldPassword) {
    if (!newPassword || newPassword.length < 6) {
        throw new Error('密碼至少 6 個字元');
    }
    if (!oldPassword) {
        throw new Error('請輸入目前密碼以驗證身份');
    }
    // 先驗證舊密碼
    const session = await getSession();
    const email = session?.user?.email;
    if (!email) throw new Error('找不到當前帳號');
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email, password: oldPassword });
    if (verifyErr) throw new Error(`舊密碼錯誤：${verifyErr.message}`);
    // 通過 → 更新
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return data.user;
}

// 白名單檢查 — 呼叫 Supabase 的 is_admin() function
// 該 function 用 auth.jwt() ->> 'email' 去 admins table 比對
// 沒登入 / email 不在白名單 → false；在白名單 → true
export async function checkIsAdmin() {
    const { data, error } = await supabase.rpc('is_admin');
    if (error) {
        console.error('[auth] checkIsAdmin failed:', error);
        return false;
    }
    return data === true;
}

// 是否為 owner (能管理其他 admin) — 對應 admins.role = 'owner'
export async function checkIsOwner() {
    const { data, error } = await supabase.rpc('is_owner');
    if (error) {
        console.error('[auth] checkIsOwner failed:', error);
        return false;
    }
    return data === true;
}

// 監聽 auth 狀態變更（其他分頁登入/登出時也會觸發）
export function onAuthChange(cb) {
    return supabase.auth.onAuthStateChange((event, session) => cb(event, session));
}

// 跨分頁同步：別的分頁登出 / session 過期 → 這分頁也清快取 + 重整
onAuthChange((event) => {
    if (event === 'SIGNED_OUT') {
        clearSensitiveLocalCache();
        location.reload();
    }
});

// 暴露到 console / 給 sidebar 登出按鈕用
window.signOut = signOut;
window.currentUser = async () => (await getSession())?.user || null;
