// Supabase Edge Function: line-push
// 給 BMS 前端呼叫，主動推訊息到指定租客的 LINE
//
// 部署：Dashboard → Edge Functions → Create new "line-push" → 貼這份 → Deploy
//
// 使用方式 (前端):
//   const { data, error } = await supabase.functions.invoke('line-push', {
//     body: {
//       tenantId: 'T001',
//       message: '您的合約已送出',
//       fileUrl: 'https://...',     // 選填，會傳 file message
//       fileName: '合約.pdf'
//     }
//   });

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function linePush(toUserId: string, messages: any[]) {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        },
        body: JSON.stringify({ to: toUserId, messages })
    });
    if (!r.ok) {
        throw new Error(`LINE push failed (${r.status}): ${await r.text()}`);
    }
    return r.json();
}

// audit: 加 JWT + admins 表查驗 (原本零授權, 任何拿到 anon key 的人都可推任意租客 LINE)
async function requireAdmin(req: Request): Promise<{ ok: boolean; status?: number; reason?: string }> {
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return { ok: false, status: 401, reason: 'Authorization Bearer JWT required' };
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: `Bearer ${jwt}` } }
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return { ok: false, status: 401, reason: 'invalid JWT' };
    const email = (userRes.user.email || '').toLowerCase();
    if (!email) return { ok: false, status: 403, reason: 'no email in JWT' };
    // 用 service role client 查 admins 表 (繞 RLS)
    const { data: admin } = await supabase
        .from('admins').select('email,role').eq('email', email).maybeSingle();
    if (!admin) return { ok: false, status: 403, reason: `${email} not in admins` };
    return { ok: true };
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: CORS_HEADERS });
    }
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    // === Auth gate ===
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return new Response(JSON.stringify({ ok: false, error: auth.reason || 'unauthorized' }), {
            status: auth.status || 401,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
    }

    try {
        const { tenantId, message, fileUrl, fileName, messageType, invoiceId } = await req.json();
        if (!tenantId) throw new Error('tenantId required');

        // 找 tenant
        const { data: tenant, error: tErr } = await supabase
            .from('tenants').select('*').eq('id', tenantId).maybeSingle();
        if (tErr) throw tErr;
        if (!tenant) throw new Error(`tenant ${tenantId} 不存在`);
        if (!tenant.line_user_id) throw new Error(`${tenant.name} 尚未綁定 LINE`);

        // 組訊息 (text + optional file/image link)
        const messages: any[] = [];
        if (message) messages.push({ type: 'text', text: message });
        if (fileUrl) {
            // LINE 不支援直接傳 PDF 為 file message (只支援 image/video/audio)
            // 改用 text message 帶連結
            messages.push({
                type: 'text',
                text: `📄 ${fileName || '檔案'}\n下載連結：${fileUrl}\n(連結 7 天內有效)`
            });
        }
        if (messages.length === 0) throw new Error('message 或 fileUrl 至少要有一個');

        const result = await linePush(tenant.line_user_id, messages);

        // log — messageType 可指定 'reminder' / 'contract' / 'notice' 等專用標籤, 預設依 fileUrl 推斷
        const resolvedType = messageType || (fileUrl ? 'file' : 'text');
        await supabase.from('line_messages').insert({
            tenant_id: tenant.id,
            line_user_id: tenant.line_user_id,
            direction: 'out',
            message_type: resolvedType,
            content: message || fileName,
            raw: { messages, result, invoiceId: invoiceId || null }
        });

        return new Response(JSON.stringify({ ok: true, tenant: tenant.name }), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
    } catch (e) {
        console.error('line-push error:', e);
        return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), {
            status: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
    }
});
