// 登入畫面 — 全螢幕 overlay
// A6: 改成 Google OAuth only (對應 admins 白名單)。email/password 流程已停用，留 helper 給帳號設定 modal 用
import { signInWithGoogle, signOut } from '../auth.js';

export function showLogin() {
    // 隱藏主 App
    const app = document.querySelector('.app-container');
    if (app) app.style.display = 'none';
    document.getElementById('boot-loading')?.remove();

    // 防止重複掛載
    if (document.getElementById('auth-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.innerHTML = `
        <div class="auth-card">
            <div class="auth-brand">
                <span class="auth-logo"><img src="assets/logo-icon.png?v=20260603g" alt="聚空間"></span>
                <div class="auth-brand-text">
                    <span class="auth-name">聚空間</span>
                    <span class="auth-sub">PMS 物件管理系統</span>
                </div>
            </div>
            <button type="button" id="auth-google-btn" class="auth-google">
                <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
                    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
                </svg>
                <span>使用 Google 帳號登入</span>
            </button>
            <div id="auth-error" class="auth-error" hidden></div>
            <div class="auth-footer">
                <i class="ph ph-info"></i>
                僅限管理員白名單內的 Google 帳號可登入
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const btn = overlay.querySelector('#auth-google-btn');
    const errEl = overlay.querySelector('#auth-error');
    btn.addEventListener('click', async () => {
        errEl.hidden = true;
        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-circle-notch"></i> <span>跳轉到 Google…</span>';
        try {
            await signInWithGoogle();
            // 正常會跳轉，下面這行通常不會跑到
        } catch (e) {
            errEl.hidden = false;
            errEl.textContent = `登入失敗：${e.message}`;
            btn.disabled = false;
            btn.innerHTML = '<span>重新嘗試</span>';
        }
    });
}

// 無權限頁 — Google 登入成功但 email 不在 admins 白名單
export function showAccessDenied(email) {
    const app = document.querySelector('.app-container');
    if (app) app.style.display = 'none';
    document.getElementById('boot-loading')?.remove();
    document.getElementById('auth-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.innerHTML = `
        <div class="auth-card">
            <div class="auth-brand">
                <span class="auth-logo" style="background: var(--color-danger, #b13535);"><i class="ph-fill ph-prohibit"></i></span>
                <div class="auth-brand-text">
                    <span class="auth-name">無權限存取</span>
                    <span class="auth-sub">聚空間 PMS</span>
                </div>
            </div>
            <div style="padding: 0.5rem 0 1rem; text-align: center;">
                <p style="margin: 0 0 0.4rem; color: var(--text-muted); font-size: 0.85rem;">你登入的帳號</p>
                <p style="margin: 0 0 1rem; font-weight: 700; font-size: 1rem; word-break: break-all;">${email || '(unknown)'}</p>
                <p style="margin: 0; color: var(--text-muted); font-size: 0.85rem; line-height: 1.5;">不在管理員白名單內。<br>請聯絡系統管理員加入名單，或改用授權帳號登入。</p>
            </div>
            <button type="button" id="auth-logout-btn" class="auth-submit">
                <i class="ph ph-sign-out"></i> 登出 / 換帳號
            </button>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#auth-logout-btn').addEventListener('click', async () => {
        await signOut();
    });
}

// 通用：把 scope 內所有 .password-toggle 綁好切換邏輯
// (Google 登入後沒密碼，但帳號設定 modal 還有改密碼欄位會用到，保留 export)
export function bindPasswordToggles(scope) {
    scope.querySelectorAll('.password-toggle').forEach(btn => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => {
            const input = scope.querySelector(`#${btn.dataset.target}`);
            if (!input) return;
            const icon = btn.querySelector('i');
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            icon.className = showing ? 'ph ph-eye' : 'ph ph-eye-slash';
            btn.setAttribute('aria-label', showing ? '顯示密碼' : '隱藏密碼');
        });
    });
}

export function hideLogin() {
    document.getElementById('auth-overlay')?.remove();
    const app = document.querySelector('.app-container');
    if (app) app.style.display = '';
}
