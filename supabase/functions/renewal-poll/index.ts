// Supabase Edge Function: renewal-poll
// 掃描 30 天內到期但還沒問過的 active 合約，發 LINE Quick Reply 給租客
//
// 觸發方式:
//   1. BMS 「立即詢問」按鈕 → 從前端 supabase.functions.invoke('renewal-poll', { body: { daysAhead: 30 } })
//   2. cron / pg_cron 定時觸發
//
// 部署:
//   Dashboard → Edge Functions → Create new "renewal-poll" → 貼這份 → Deploy
//
// Secrets:
//   LINE_CHANNEL_ACCESS_TOKEN  LINE Channel access token
//   SUPABASE_URL               自動帶
//   SUPABASE_SERVICE_ROLE_KEY  自動帶

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

// 組合續租詢問訊息 (含 Quick Reply 按鈕)
function buildRenewalMessage(contract: any, daysLeft: number) {
    const propertyShort = String(contract.property_name || '').replace('聚空間 - ', '');
    const fmtDate = (iso: string) => iso ? iso.replace(/-/g, '/') : '';
    return {
        type: 'text',
        text: `聚空間 您好 😊\n\n您在 ${propertyShort} 的合約將於 ${fmtDate(contract.end_date)} (${daysLeft} 天後) 到期。\n請問是否續租？\n\n👇 點下方按鈕回覆`,
        quickReply: {
            items: [
                {
                    type: 'action',
                    action: {
                        type: 'postback',
                        label: '✅ 我要續租',
                        data: `action=renew&contract=${contract.id}`,
                        displayText: '我要續租'
                    }
                },
                {
                    type: 'action',
                    action: {
                        type: 'postback',
                        label: '❌ 不續租',
                        data: `action=decline&contract=${contract.id}`,
                        displayText: '不續租'
                    }
                },
                {
                    type: 'action',
                    action: {
                        type: 'postback',
                        label: '❓ 我要問問題',
                        data: `action=inquiry&contract=${contract.id}`,
                        displayText: '我要問問題'
                    }
                }
            ]
        }
    };
}

interface Result {
    sent: number;
    skipped_no_line: number;
    skipped_already_asked: number;
    failed: number;
    contracts: Array<{ id: string; tenant: string; status: string; reason?: string }>;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: CORS_HEADERS });
    }
    if (req.method !== 'POST') {
        return new Response('only POST', { status: 405, headers: CORS_HEADERS });
    }

    try {
        const body = await req.json().catch(() => ({}));
        const daysAhead = Math.max(1, Math.min(90, Number(body.daysAhead) || 30));
        const force = !!body.force; // 即使最近問過也再問一次 (測試用)

        const today = new Date();
        const todayIso = today.toISOString().slice(0, 10);
        const cutoff = new Date(today.getTime() + daysAhead * 86400000).toISOString().slice(0, 10);

        // 找出 active 且 endDate 在 today ~ today+N 天內 的合約
        const { data: contracts, error: cErr } = await supabase
            .from('contracts')
            .select('*')
            .eq('renewal_state', 'active')
            .gte('end_date', todayIso)
            .lte('end_date', cutoff);
        if (cErr) throw cErr;

        const result: Result = {
            sent: 0,
            skipped_no_line: 0,
            skipped_already_asked: 0,
            failed: 0,
            contracts: []
        };

        for (const c of (contracts || [])) {
            // 跳過已問過的 (除非 force)
            const askedAt = c.renew_asked_at ? new Date(c.renew_asked_at) : null;
            if (!force && askedAt) {
                // 7 天內問過就跳過
                const ageDays = (Date.now() - askedAt.getTime()) / 86400000;
                if (ageDays < 7) {
                    result.skipped_already_asked++;
                    result.contracts.push({ id: c.id, tenant: c.tenant, status: 'skipped_already_asked' });
                    continue;
                }
            }
            // 找對應租客的 LINE userId
            const { data: tenant } = await supabase
                .from('tenants')
                .select('id, name, line_user_id')
                .eq('name', c.tenant)
                .maybeSingle();
            if (!tenant || !tenant.line_user_id) {
                result.skipped_no_line++;
                result.contracts.push({ id: c.id, tenant: c.tenant, status: 'skipped_no_line', reason: '未綁定 LINE' });
                continue;
            }
            // 計算還剩幾天
            const daysLeft = Math.ceil((new Date(c.end_date).getTime() - today.getTime()) / 86400000);
            const msg = buildRenewalMessage(c, daysLeft);

            try {
                await linePush(tenant.line_user_id, [msg]);
                // 更新合約 → renew_intent='asking', renew_asked_at=now
                await supabase.from('contracts').update({
                    renew_intent: 'asking',
                    renew_asked_at: new Date().toISOString()
                }).eq('id', c.id);
                // log to line_messages
                await supabase.from('line_messages').insert({
                    line_user_id: tenant.line_user_id,
                    direction: 'out',
                    message_type: 'renewal_ask',
                    content: `[續租詢問] ${c.id} · ${propertyShortName(c.property_name)} · 到期 ${c.end_date}`,
                    raw: { contractId: c.id, daysLeft }
                });
                result.sent++;
                result.contracts.push({ id: c.id, tenant: c.tenant, status: 'sent' });
            } catch (e: any) {
                result.failed++;
                result.contracts.push({ id: c.id, tenant: c.tenant, status: 'failed', reason: e.message });
                console.error(`[renewal-poll] LINE push fail for ${c.id}:`, e);
            }
        }

        return new Response(JSON.stringify({ ok: true, daysAhead, ...result }, null, 2), {
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
    } catch (e: any) {
        console.error('[renewal-poll] error:', e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
    }
});

function propertyShortName(name: string | null) {
    return String(name || '').replace('聚空間 - ', '');
}
