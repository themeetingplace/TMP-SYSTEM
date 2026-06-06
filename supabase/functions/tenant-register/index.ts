// Supabase Edge Function: tenant-register
// 接收 LIFF 表單送出的資料 → 驗證 LINE ID Token → 建立 tenant + 綁定 LINE userId
//
// 安全：
//   1. 用 LINE ID Token verify endpoint 驗證 idToken 是真的、屬於該 userId
//   2. 同手機已存在 → 更新並綁定，不新增
//   3. 同 line_user_id 已綁定別人 → 拒絕
//
// 部署：
//   Supabase Dashboard → Edge Functions → Create new function "tenant-register"
//   貼這份 → Deploy
//
// Secrets:
//   LINE_CHANNEL_ID            LIFF App 的 Channel ID (LINE Login Channel)
//   SUPABASE_URL               自動帶
//   SUPABASE_SERVICE_ROLE_KEY  自動帶

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const LINE_CHANNEL_ID = Deno.env.get('LINE_CHANNEL_ID') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 驗證 LINE ID Token — 確認 idToken 是 LINE 簽發、且 userId 跟 token 內的 sub 吻合
async function verifyLineIdToken(idToken: string, expectedUserId: string): Promise<boolean> {
    const body = new URLSearchParams({
        id_token: idToken,
        client_id: LINE_CHANNEL_ID
    });
    const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    if (!r.ok) {
        console.error('LINE verify failed', r.status, await r.text());
        return false;
    }
    const data = await r.json();
    return data.sub === expectedUserId;
}

function nextId(prefix: string, existingIds: string[]): string {
    let max = 0;
    existingIds.forEach(id => {
        const m = String(id || '').match(new RegExp(`^${prefix}(\\d+)$`));
        if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type'
    };
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders() });
    }
    if (req.method !== 'POST') {
        return new Response('only POST', { status: 405, headers: corsHeaders() });
    }

    try {
        const { idToken, userId, displayName, pictureUrl, form } = await req.json();

        // 1. 驗 LINE ID Token
        if (!idToken || !userId) throw new Error('缺少 idToken / userId');
        const valid = await verifyLineIdToken(idToken, userId);
        if (!valid) throw new Error('LINE 身份驗證失敗，請重新整理再試');

        // 2. 表單欄位檢查
        const required = ['name', 'phone'];
        for (const k of required) {
            if (!form[k]) throw new Error(`欄位「${k}」必填`);
        }
        const phone = String(form.phone).replace(/[-\s]/g, '');
        if (!/^09\d{8}$/.test(phone)) throw new Error('手機格式錯誤');

        // 床位 / 合約 由管理員後台處理，這裡只做「自我介紹 + 綁 LINE」

        // 5. 同 line_user_id 已綁別人？
        const { data: alreadyBound } = await supabase
            .from('tenants').select('id, name')
            .eq('line_user_id', userId)
            .maybeSingle();
        if (alreadyBound) {
            throw new Error(`此 LINE 已綁定「${alreadyBound.name}」，請聯絡小編協助`);
        }

        // 6. 找 / 建 tenant
        const { data: existing } = await supabase
            .from('tenants').select('*').eq('phone', phone).maybeSingle();

        const nowIso = new Date().toISOString();
        let tenantId: string;

        if (existing) {
            // 同手機已存在 → 更新 + 綁 LINE (保留現有 current_property，不覆寫)
            await supabase.from('tenants').update({
                name: form.name,
                email: form.email || existing.email,
                emergency_contact: form.emergencyContact || existing.emergency_contact,
                line_user_id: userId,
                line_display_name: displayName || null,
                line_picture_url: pictureUrl || null,
                line_bound_at: nowIso,
                source: existing.source || 'LIFF'
            }).eq('id', existing.id);
            tenantId = existing.id;
        } else {
            // 新建 tenant — 床位 / 居住中狀態 由管理員後台確認
            const { data: allTenants } = await supabase.from('tenants').select('id');
            const newId = nextId('T', (allTenants || []).map((t: any) => t.id));
            const { error: insErr } = await supabase.from('tenants').insert({
                id: newId,
                name: form.name,
                phone,
                email: form.email || null,
                emergency_contact: form.emergencyContact || null,
                current_property: null,
                status: '待入住',
                source: 'LIFF',
                line_user_id: userId,
                line_display_name: displayName || null,
                line_picture_url: pictureUrl || null,
                line_bound_at: nowIso
            });
            if (insErr) throw new Error(`建立租客失敗：${insErr.message}`);
            tenantId = newId;
        }

        // 7. log 到 line_messages 給管理員追蹤
        await supabase.from('line_messages').insert({
            line_user_id: userId,
            direction: 'in',
            message_type: 'liff_register',
            content: `LIFF 登記：${form.name} (${phone})${existing ? ' — 更新舊客' : ' — 新客'}`,
            raw: { form, profile: { displayName, pictureUrl } }
        });

        return new Response(JSON.stringify({ ok: true, tenantId, isNew: !existing }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    } catch (e: any) {
        console.error('[tenant-register]', e);
        return new Response(JSON.stringify({ error: e.message || String(e) }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }
});
