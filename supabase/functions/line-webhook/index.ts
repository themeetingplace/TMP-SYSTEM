// Supabase Edge Function: line-webhook
// 接收 LINE Messaging API 的事件 (加好友 / 訊息 / 解除好友)
//
// 部署：
//   1. Supabase Dashboard → Edge Functions → Create new function "line-webhook"
//   2. 把這份貼進去 → Deploy
//   3. 把 webhook URL (https://xxx.supabase.co/functions/v1/line-webhook) 設定到 LINE Developers Console
//
// Secrets (在 Dashboard → Settings → Edge Functions → Secrets 設定):
//   LINE_CHANNEL_SECRET       LINE Console 拿 (用於驗簽)
//   LINE_CHANNEL_ACCESS_TOKEN LINE Console 拿 (用於回覆訊息)
//   SUPABASE_URL              Supabase 自動帶
//   SUPABASE_SERVICE_ROLE_KEY Supabase 自動帶 (要用 service role 才能寫 tenants)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'node:crypto';

const LINE_CHANNEL_SECRET = Deno.env.get('LINE_CHANNEL_SECRET') ?? '';
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// 管理員 LINE userId(多個用逗號分隔) — 收到租客報修/繳款/詢問時 push 通知
const ADMIN_LINE_USER_IDS = (Deno.env.get('ADMIN_LINE_USER_IDS') ?? '').split(',').map(s => s.trim()).filter(Boolean);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// === LINE Messaging API helpers ===
async function lineReply(replyToken: string, messages: any[]) {
    const r = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        },
        body: JSON.stringify({ replyToken, messages })
    });
    if (!r.ok) {
        const errText = await r.text();
        console.error(`[lineReply] FAILED ${r.status}: ${errText}`);
        throw new Error(`LINE reply ${r.status}: ${errText}`);
    }
    console.log(`[lineReply] OK (${messages.length} msg)`);
}

async function lineGetProfile(userId: string) {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
        headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
    });
    return r.ok ? await r.json() : null;
}

// Push 給單一 userId
async function linePush(userId: string, messages: any[]) {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        },
        body: JSON.stringify({ to: userId, messages })
    });
    // P2-6: 失敗就 throw，呼叫端決定要不要 catch (notifyAdmin 會 catch，避免錯誤循環通知)
    if (!r.ok) {
        const errText = await r.text();
        console.error(`[linePush] FAILED ${r.status}: ${errText}`);
        throw new Error(`LINE push ${r.status}: ${errText}`);
    }
}

// 廣播訊息給所有管理員
async function notifyAdmin(text: string) {
    if (ADMIN_LINE_USER_IDS.length === 0) {
        console.warn('[notifyAdmin] ADMIN_LINE_USER_IDS 未設定，跳過通知');
        return;
    }
    const msg = [{ type: 'text', text: `🔔 ${text}` }];
    for (const id of ADMIN_LINE_USER_IDS) {
        try { await linePush(id, msg); } catch (e) { console.error('notifyAdmin failed', id, e); }
    }
}

function verifySignature(body: string, signature: string): boolean {
    if (!signature) return false;
    const hash = createHmac('sha256', LINE_CHANNEL_SECRET).update(body).digest('base64');
    // P1-1: timing-safe 比對，避免時序攻擊推估 secret
    // 長度不同直接 false (timingSafeEqual 要求等長)
    if (hash.length !== signature.length) return false;
    try {
        const a = new TextEncoder().encode(hash);
        const b = new TextEncoder().encode(signature);
        // 模擬 crypto.timingSafeEqual 行為 (Deno 沒這 API，但用 XOR 累加實現等效)
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
        return diff === 0;
    } catch {
        return false;
    }
}

// === Rate limiting (per userId, in-memory) ===
// 每個 userId 60 秒內最多 RATE_LIMIT_MAX 次訊息事件
// in-memory：Edge Function cold start 後會重置 → 對慢速攻擊無效，但能擋 burst / rich menu bug 連發
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;
const rateMap = new Map<string, number[]>(); // userId → timestamps[]

function isRateLimited(userId: string): boolean {
    const now = Date.now();
    const arr = (rateMap.get(userId) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (arr.length >= RATE_LIMIT_MAX) {
        rateMap.set(userId, arr); // 保留視窗內的，捨棄舊的
        return true;
    }
    arr.push(now);
    rateMap.set(userId, arr);
    // 清理太久沒活動的 user (避免 map 無限長)
    if (rateMap.size > 1000) {
        for (const [k, v] of rateMap) {
            if (v.every(t => now - t > RATE_LIMIT_WINDOW_MS)) rateMap.delete(k);
        }
    }
    return false;
}

// === 罐頭訊息 cooldown (per userId, DB-backed) ===
// 「管理員會回覆您…」之類的自動回覆，同 userId 24 小時內只回一次
// ⚠ Edge Function 是 serverless，in-memory 狀態會在 cold start 後消失，所以改存 DB
// 用 line_messages 表記錄 direction='out' + message_type='canned'，下次查最近一筆判斷
const CANNED_COOLDOWN_MIN = 24 * 60;  // 24 小時

async function shouldSendCanned(userId: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - CANNED_COOLDOWN_MIN * 60_000).toISOString();
    const { data, error } = await supabase
        .from('line_messages')
        .select('id')
        .eq('line_user_id', userId)
        .eq('direction', 'out')
        .eq('message_type', 'canned')
        .gte('created_at', cutoff)
        .limit(1);
    if (error) {
        console.error('[shouldSendCanned] DB error:', error);
        return true;  // DB 壞了就放行，免得卡死
    }
    return !data || data.length === 0;
}

// 標記「剛發了罐頭」— 寫一筆 outbound log 到 line_messages
async function logCannedSent(userId: string, content: string) {
    try {
        await supabase.from('line_messages').insert({
            line_user_id: userId,
            direction: 'out',
            message_type: 'canned',
            content: content.slice(0, 100),
            raw: { auto: true }
        });
    } catch (e) {
        console.error('[logCannedSent] failed:', e);
    }
}

// === 事件處理 ===

// 快速選單 — 接在任何 reply 後讓用戶按鈕選擇
function welcomeQuickReply() {
    return {
        items: [
            { type: 'action', action: { type: 'message', label: '🏠 入住詢問', text: '入住詢問' } },
            { type: 'action', action: { type: 'uri', label: '🔗 住客登記', uri: 'https://liff.line.me/2010185822-G7D3N3Gw' } },
            { type: 'action', action: { type: 'message', label: '💬 找小編', text: '找小編' } }
        ]
    };
}

async function handleFollow(event: any) {
    const userId = event.source.userId;
    const profile = await lineGetProfile(userId);

    await supabase.from('line_messages').insert({
        line_user_id: userId,
        direction: 'in',
        message_type: 'follow',
        content: `${profile?.displayName || ''} 加好友`,
        raw: event,
        webhook_event_id: event.webhookEventId
    });

    // standby 模式不自動回
    if (event.mode === 'standby') return;

    // 友善歡迎 + 選單，不強迫綁定
    await lineReply(event.replyToken, [
        {
            type: 'text',
            text: `嗨 ${profile?.displayName || ''}！\n歡迎來到 聚空間✨\n請問有什麼可以協助您的？`,
            quickReply: welcomeQuickReply()
        }
    ]);
}

async function handleUnfollow(event: any) {
    const userId = event.source.userId;
    // 解除綁定 (清空 line_user_id)
    await supabase.from('tenants').update({
        line_user_id: null,
        line_bound_at: null
    }).eq('line_user_id', userId);

    await supabase.from('line_messages').insert({
        line_user_id: userId,
        direction: 'in',
        message_type: 'unfollow',
        content: '解除好友',
        raw: event,
        webhook_event_id: event.webhookEventId
    });
}

// 處理 Quick Reply postback (續租詢問 回應)
async function handlePostback(event: any) {
    const userId = event.source.userId;
    if (event.mode === 'standby') return;
    if (isRateLimited(userId)) return;

    const dataStr = String(event.postback?.data || '');
    const params = new URLSearchParams(dataStr);
    const action = params.get('action');
    const contractId = params.get('contract');

    // log raw postback
    await supabase.from('line_messages').insert({
        line_user_id: userId,
        direction: 'in',
        message_type: 'postback',
        content: dataStr,
        raw: event,
        webhook_event_id: event.webhookEventId
    });

    if (!action || !contractId) return;

    // 續租意願 mapping
    const intentMap: Record<string, string> = {
        renew: 'renew',
        decline: 'decline',
        inquiry: 'inquiry'
    };
    const intent = intentMap[action];
    if (!intent) return;

    // 確認該合約存在且 contract.tenant 對得上 LINE 綁定的租客 (防呆: 別人代答)
    const { data: tenant } = await supabase
        .from('tenants').select('name').eq('line_user_id', userId).maybeSingle();
    if (!tenant) {
        await lineReply(event.replyToken, [
            { type: 'text', text: '請先到聚空間 PMS 完成登記綁定，才能使用續租回覆喔～' }
        ]);
        return;
    }

    const { data: contract } = await supabase
        .from('contracts').select('id, tenant, end_date, property_name, renew_intent')
        .eq('id', contractId).maybeSingle();
    if (!contract || contract.tenant !== tenant.name) {
        await lineReply(event.replyToken, [
            { type: 'text', text: '⚠ 找不到您的合約資料，請聯絡小編。' }
        ]);
        return;
    }

    // 更新合約 renew_intent
    await supabase.from('contracts').update({
        renew_intent: intent,
        renew_response_at: new Date().toISOString()
    }).eq('id', contractId);

    // 回覆對應訊息
    const propertyShort = String(contract.property_name || '').replace('聚空間 - ', '');
    let replyText = '';
    if (intent === 'renew') {
        replyText = `🎉 太好了！小編收到您的續租意願，會在合約到期前主動聯繫您處理續約。\n\n📍 ${propertyShort}\n📅 原合約到期：${contract.end_date}`;
    } else if (intent === 'decline') {
        replyText = `好的，小編已記下您不續租的意願。\n會在合約到期前再跟您確認退租手續 ☺️\n\n📍 ${propertyShort}\n📅 合約到期：${contract.end_date}`;
    } else {
        replyText = `好的～小編會盡快與您聯絡，了解您的問題 🙏\n\n📍 ${propertyShort}\n📅 合約到期：${contract.end_date}`;
    }
    await lineReply(event.replyToken, [{ type: 'text', text: replyText }]);
}

// 從 LINE 抓檔案二進位 (image / file / video)
// 限制：MAX_FILE_BYTES 以內，超過直接拒，避免 LINE 用戶傳超大檔耗光 Storage 配額
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
async function lineDownloadContent(messageId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const r = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
        headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
    });
    if (!r.ok) throw new Error(`LINE content fetch ${r.status}`);
    // 先看 Content-Length，超過就直接拒，連讀都不讀
    const cl = parseInt(r.headers.get('content-length') || '0', 10);
    if (cl > MAX_FILE_BYTES) {
        throw new Error(`檔案太大 (${(cl / 1024 / 1024).toFixed(1)} MB)，上限 ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    }
    const buf = await r.arrayBuffer();
    // 二次檢查 (有些 response 沒帶 Content-Length)
    if (buf.byteLength > MAX_FILE_BYTES) {
        throw new Error(`檔案太大 (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)，上限 ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    }
    return {
        bytes: new Uint8Array(buf),
        contentType: r.headers.get('content-type') || 'application/octet-stream'
    };
}

async function handleMessage(event: any) {
    const userId = event.source.userId;

    // 🔇 standby 模式 — 全部跳過
    if (event.mode === 'standby') {
        console.log('[handleMessage] standby mode — skip');
        return;
    }

    // 🚦 Rate limit — 同 userId 60 秒超過上限就 silent drop (不回 LINE，但仍 200 給 webhook 不重送)
    if (isRateLimited(userId)) {
        console.warn(`[handleMessage] rate-limited userId=${userId} — skip`);
        return;
    }

    const { data: bound, error: boundErr } = await supabase
        .from('tenants').select('*').eq('line_user_id', userId).maybeSingle();
    if (boundErr) throw new Error(`tenants lookup failed: ${boundErr.message}`);

    // ───────────── 圖片 / 檔案 (合約回傳專用) ─────────────
    if (event.message.type === 'image' || event.message.type === 'file') {
        await supabase.from('line_messages').insert({
            line_user_id: userId, direction: 'in', message_type: event.message.type,
            content: event.message.fileName || `(${event.message.type})`, raw: event,
            webhook_event_id: event.webhookEventId
        });

        // 未綁定 → 純 log 不回，避免一般用戶傳貼圖/檔案被嗆「請先綁定」
        if (!bound) {
            console.log(`[handleMessage] unbound user sent ${event.message.type} — silent skip`);
            return;
        }

        // 找該租客最新一份 active 合約 (優先 待簽署)
        const { data: contracts, error: ctErr } = await supabase
            .from('contracts').select('*')
            .eq('tenant', bound.name)
            .eq('renewal_state', 'active')
            .order('start_date', { ascending: false });
        if (ctErr) throw new Error(`contracts lookup failed: ${ctErr.message}`);

        if (!contracts || contracts.length === 0) {
            await lineReply(event.replyToken, [
                { type: 'text', text: `⚠️ ${bound.name} 您好，目前找不到您的進行中合約，無法附上簽署檔。\n請聯絡小編確認。`, quickReply: welcomeQuickReply() }
            ]);
            return;
        }
        const targetContract = contracts.find((c: any) => c.status === '待簽署') || contracts[0];

        try {
            // 下載 + 上傳
            const { bytes, contentType } = await lineDownloadContent(event.message.id);
            const ext = contentType.includes('pdf') ? 'pdf'
                     : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
                     : contentType.includes('png') ? 'png'
                     : 'bin';
            const key = `signed_${targetContract.id}_${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from('contract-pdfs')
                .upload(key, bytes, { contentType, upsert: false });
            if (upErr) throw new Error(`Storage 上傳失敗：${upErr.message}`);

            // 存 storage path（不存 public URL）— BMS 端會用 createSignedUrl 動態產
            // bucket 已改 private，不再有 public URL 可用
            await supabase.from('contracts').update({
                signed_file_url: key,
                status: '已簽署'
            }).eq('id', targetContract.id);

            await lineReply(event.replyToken, [
                { type: 'text', text: `✅ 已收到您的合約簽署檔\n\n合約：${targetContract.id}\n租期：${targetContract.start_date} ~ ${targetContract.end_date}\n\n感謝您 ✨`, quickReply: welcomeQuickReply() }
            ]);
        } catch (e: any) {
            console.error('[file upload] failed:', e);
            await lineReply(event.replyToken, [
                { type: 'text', text: `❌ 檔案處理失敗：${e.message}\n請聯絡小編協助。`, quickReply: welcomeQuickReply() }
            ]);
        }
        return;
    }

    // 其他非文字訊息 (貼圖 / 影片 / 位置) — 一律 silent log
    if (event.message.type !== 'text') {
        await supabase.from('line_messages').insert({
            line_user_id: userId, direction: 'in', message_type: event.message.type,
            content: `(${event.message.type})`, raw: event,
            webhook_event_id: event.webhookEventId
        });
        return;
    }

    const text = (event.message.text || '').trim();

    // 一律記 log
    await supabase.from('line_messages').insert({
        line_user_id: userId, direction: 'in', message_type: 'text', content: text, raw: event,
        webhook_event_id: event.webhookEventId
    });

    // ───────────── 通用按鈕 (不分綁定狀態) ─────────────

    // 「館別資訊」「關於我們」由 LINE 多頁訊息 / FB 處理。若不小心送到 webhook，silent 不回避免亂回
    // 管理員工具：傳「/myid」取得自己的 userId，方便設定 ADMIN_LINE_USER_IDS
    if (text === '/myid' || text === '/我的id' || text === '/id') {
        await lineReply(event.replyToken, [
            { type: 'text', text: `您的 LINE userId：\n\n${userId}\n\n📌 將此 ID 加到 Supabase Edge Functions Secrets：\nADMIN_LINE_USER_IDS = ${userId}\n\n多位小編用逗號分隔。設定後重新部署 webhook，就會收到租客通知 ✨` }
        ]);
        return;
    }

    if (/館別|關於/.test(text)) return;

    // 入住詢問 / 預約看房 / 詢問空房 — 共用同一份填空模板
    // 注意：quick reply 按鈕「🏠 入住詢問」送的是「入住詢問」，必須在 regex 內
    if (/入住|詢問|預約|看房|參觀|空房|租房|價錢|價格|租金|床位/.test(text)) {
        await lineReply(event.replyToken, [
            {
                type: 'text',
                text: `嗨！很開心你對聚空間有興趣 ☺️

在台北打拼，回到冷冰冰的房間總覺得有點寂寞嗎？
聚空間想成為你最有人情味的家 🏡

為了幫你找到合適的空間，請複製下方填好回傳給我～

━━━━━━━━━
📝 入住詢問

姓名：
性別：(男或女)
電話：
Email：
欲入住館別：(松山 / 信義 / 中山 / 古亭1 / 古亭2 / 師大)
入住人數：(ex. 1人、4人...)
欲入住日期：
入住時長：(ex. 1個月、半年...)
方便看房的時段：(ex. 平日晚上 7 點後 / 週末下午)
怎麼知道我們的：(ex. 臉書 / 朋友介紹 / Google / 591 / 其他)

關於你（簡單介紹～職業、習慣、興趣都歡迎）：

為什麼選聚空間：
━━━━━━━━━

填好直接貼回來就好，看房時段先告訴我們，後續會由小編聯繫與你約時間 ✨`,
                quickReply: welcomeQuickReply()
            }
        ]);
        return;
    }

    // 找小編 — 已綁定 / 未綁定都要回覆 (放在 bound 區塊前避免被「沉默」吃掉)
    // 關鍵字含舊版「管理員」，老用戶記憶猶新；新標準稱呼 = 小編
    if (/小編|管理員|找人|聯絡|客服/.test(text)) {
        if (!(await shouldSendCanned(userId))) {
            console.log(`[handleMessage] canned reply cooldown — silent skip (找小編) for ${userId.slice(-6)}`);
            return;
        }
        await logCannedSent(userId, '小編會盡快回覆您');
        await lineReply(event.replyToken, [
            {
                type: 'text',
                text: '💬 小編會盡快回覆您，您可以直接在此留言詳細需求。',
                quickReply: welcomeQuickReply()
            }
        ]);
        return;
    }

    // ───────────── 已綁定房客專屬 ─────────────
    if (bound) {

        // 末 5 碼回報
        if (/^\d{5}$/.test(text)) {
            // 先找該租客的未結 invoice (含部分繳款)
            const { data: unpaid, error: upErr } = await supabase
                .from('invoices').select('*')
                .eq('tenant', bound.name)
                .in('status', ['欠繳', '未付', '部分繳款', '部分支付'])
                .order('due_date', { ascending: true });
            if (upErr) throw new Error(`invoices lookup failed: ${upErr.message}`);

            if (unpaid && unpaid.length > 0) {
                // 場景 A：有欠繳 → 寫入末 5 碼
                const inv = unpaid[0];
                await supabase.from('invoices').update({
                    bank_last5: text,
                    bank_verified: false
                }).eq('id', inv.id);
                await lineReply(event.replyToken, [
                    {
                        type: 'text',
                        text: `✅ ${bound.name} 您的繳款已記錄\n\n• 帳單：${inv.type} $${(inv.amount || 0).toLocaleString()}\n• 到期日：${inv.due_date || '未定'}\n• 末 5 碼：${text}\n\n小編核對銀行對帳單後會通知您 ✨`,
                        quickReply: welcomeQuickReply()
                    }
                ]);
                return;
            }

            // 場景 B：無欠繳 → 視為續約預繳款
            // 僅留紀錄 (line_messages 已自動 log)，等管理員處理
            await lineReply(event.replyToken, [
                {
                    type: 'text',
                    text: `✅ 已收到您的末 5 碼 ${text}\n\n${bound.name} 您好，目前無待繳帳單，將視為「續約預繳款」處理。\n小編會盡快為您建立續約合約並聯絡您 ✨`,
                    quickReply: welcomeQuickReply()
                }
            ]);
            return;
        }

        // 繳款告知 — 直接提示傳末5碼，省去填表
        if (text === '繳款告知' || /繳款|繳費/.test(text)) {
            await lineReply(event.replyToken, [
                {
                    type: 'text',
                    text: `${bound.name} 您好，繳款後請直接傳「帳戶末 5 碼」5 位數字 (例如：12345)，系統會自動記錄到您的帳單上 ✨\n\n不用再填任何表單～`,
                    quickReply: welcomeQuickReply()
                }
            ]);
            return;
        }

        // 帳單查詢
        if (text === '帳單查詢' || /帳單|對帳/.test(text)) {
            // 抓「本期」帳單 — 即期間涵蓋今天的所有 invoice (含已繳清)
            // 沒有 period 的舊資料退回看 status (含已繳清以外)
            const today = new Date().toISOString().slice(0, 10);
            const { data: allInvoices, error: invErr } = await supabase
                .from('invoices').select('*')
                .eq('tenant', bound.name)
                .eq('direction', 'in')
                .order('due_date', { ascending: true });
            if (invErr) throw new Error(`invoices lookup failed: ${invErr.message}`);

            const invoices = (allInvoices || []).filter((i: any) => {
                if (i.period_start && i.period_end) {
                    return i.period_start <= today && i.period_end >= today;
                }
                return i.status !== '已繳清';
            });

            // 情境 F：完全無帳單
            if (invoices.length === 0) {
                await lineReply(event.replyToken, [
                    { type: 'text', text: `${bound.name} 您好~ 目前沒有任何帳單紀錄\n\n如有疑問請傳「找小編」`, quickReply: welcomeQuickReply() }
                ]);
                return;
            }

            // 狀態文字產生器
            const statusText = (i: any) => {
                const due = (i.amount || 0) - (i.discount || 0);
                const paid = i.paid_amount || 0;
                if (paid >= due && due > 0) return '✅ 已繳清';
                if (paid > 0) return `💰 已收 $${paid.toLocaleString()}，餘額 $${(due - paid).toLocaleString()}`;
                if (i.due_date && i.due_date < today) {
                    const days = Math.floor((Date.now() - new Date(i.due_date).getTime()) / 86400000);
                    return `⚠️ 逾期 ${days} 天`;
                }
                return '❌ 未繳';
            };
            const periodLabel = (i: any) => {
                if (i.period_start && i.period_end) return `${i.period_start} ~ ${i.period_end}`;
                return i.due_date || '未定';
            };
            const periodCompact = (i: any) => {
                if (i.period_start && i.period_end) {
                    return `${i.period_start.slice(5).replace('-', '/')}~${i.period_end.slice(5).replace('-', '/')}`;
                }
                return i.due_date?.slice(5).replace('-', '/') || '未定';
            };
            const hasUnpaid = invoices.some((i: any) => {
                const due = (i.amount || 0) - (i.discount || 0);
                return (i.paid_amount || 0) < due;
            });
            const tail = hasUnpaid ? '繳費後請傳「末 5 碼」' : '如有疑問請傳「找小編」';

            // 情境 A-D：1 筆帳單
            if (invoices.length === 1) {
                const i = invoices[0];
                const due = (i.amount || 0) - (i.discount || 0);
                await lineReply(event.replyToken, [
                    { type: 'text', text: `${bound.name} 您好~\n\n合約期間：${periodLabel(i)}\n應繳金額：$${due.toLocaleString()}\n繳費狀態：${statusText(i)}\n\n${tail}`, quickReply: welcomeQuickReply() }
                ]);
                return;
            }

            // 情境 E：多筆帳單
            const unpaidTotal = invoices.reduce((s: number, i: any) => {
                const due = (i.amount || 0) - (i.discount || 0);
                return s + Math.max(0, due - (i.paid_amount || 0));
            }, 0);
            const lines = invoices.map((i: any) => {
                const due = (i.amount || 0) - (i.discount || 0);
                return `📌 ${i.type}\n合約期間：${periodCompact(i)}\n應繳金額：$${due.toLocaleString()}\n繳費狀態：${statusText(i)}`;
            }).join('\n\n');
            const totalLine = unpaidTotal > 0
                ? `\n\n未繳合計 $${unpaidTotal.toLocaleString()}，${tail}`
                : `\n\n${tail}`;
            await lineReply(event.replyToken, [
                { type: 'text', text: `${bound.name} 您好~ 您目前有 ${invoices.length} 筆帳單\n\n${lines}${totalLine}`, quickReply: welcomeQuickReply() }
            ]);
            return;
        }

        // 維修申報 (引導格式)
        if (text === '維修申報') {
            await lineReply(event.replyToken, [
                { type: 'text', text: `🔧 維修申報\n\n請以「維修：問題描述」格式傳訊息\n\n例如：\n維修：冷氣不冷會滴水\n維修：浴室水管堵塞\n\n小編收到後會盡快安排處理。`, quickReply: welcomeQuickReply() }
            ]);
            return;
        }

        // 直接以「維修：xxx」格式報修
        if (/^維修[:：]/.test(text)) {
            const issue = text.replace(/^維修[:：]\s*/, '').trim();
            if (!issue) {
                await lineReply(event.replyToken, [
                    { type: 'text', text: '請描述問題內容，例如：「維修：冷氣不冷」' }
                ]);
                return;
            }
            // 建 maintenance 紀錄
            const { data: max, error: maxErr } = await supabase
                .from('maintenances').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
            if (maxErr) throw new Error(`maintenances lookup failed: ${maxErr.message}`);
            const lastNum = max ? parseInt(String(max.id).replace(/\D/g, ''), 10) || 0 : 0;
            const newId = 'M' + String(lastNum + 1).padStart(3, '0');
            const today = new Date().toISOString().split('T')[0];
            await supabase.from('maintenances').insert({
                id: newId,
                property_name: bound.current_property || '(未指定)',
                issue,
                reporter: bound.name,
                report_date: today,
                status: '待處理',
                cost: null
            });
            await lineReply(event.replyToken, [
                { type: 'text', text: `✅ 已收到維修申報 (${newId})\n\n位置：${bound.current_property || '未指定'}\n問題：${issue}\n\n小編會盡快聯絡您。`, quickReply: welcomeQuickReply() }
            ]);
            return;
        }

        // 已綁定者輸入沒對到的關鍵字 → bot 保持沉默，讓管理員或自然聊天
        return;
    }

    // ── 未綁定 (新好友 / 詢問者) ──
    // 詢問空房 / 預約看房 → 已被上方共用入住詢問模板處理
    // 找小編 → 已在最上方統一處理

    // 想綁定 / 登記
    if (/綁定|我是房客|我是租客|帳號|登記/.test(text)) {
        await lineReply(event.replyToken, [
            {
                type: 'text',
                text: '請填寫住客資料表單完成登記 + LINE 綁定 ✨\n👇 點下方按鈕',
                quickReply: {
                    items: [
                        { type: 'action', action: { type: 'uri', label: '📝 立即登記', uri: 'https://liff.line.me/2010185822-G7D3N3Gw' } },
                        { type: 'action', action: { type: 'message', label: '💬 找小編', text: '找小編' } }
                    ]
                }
            }
        ]);
        return;
    }

    // 直接輸入手機 → 嘗試綁定 (相容沒走按鈕的用戶)
    const phone = text.replace(/[-\s]/g, '');
    if (/^09\d{8}$/.test(phone)) {
        const { data: candidates, error: candErr } = await supabase
            .from('tenants').select('*');
        if (candErr) throw new Error(`tenants lookup failed: ${candErr.message}`);
        const tenant = candidates?.find(t =>
            t.phone && t.phone.replace(/[-\s]/g, '') === phone
        );
        if (tenant) {
            const profile = await lineGetProfile(userId);
            await supabase.from('tenants').update({
                line_user_id: userId,
                line_display_name: profile?.displayName || null,
                line_picture_url: profile?.pictureUrl || null,
                line_bound_at: new Date().toISOString()
            }).eq('id', tenant.id);
            await lineReply(event.replyToken, [
                { type: 'text', text: `✅ 綁定成功！您好 ${tenant.name}，之後合約跟繳費通知會傳到這裡。`, quickReply: welcomeQuickReply() }
            ]);
        } else {
            await lineReply(event.replyToken, [
                {
                    type: 'text',
                    text: '⚠️ 找不到此手機號碼的租客資料。\n要詢問租屋請點「詢問空房」，已是房客請聯絡小編確認。',
                    quickReply: welcomeQuickReply()
                }
            ]);
        }
        return;
    }

    // 其他自由訊息 — 加 cooldown，避免每則訊息都被罐頭回應
    if (!(await shouldSendCanned(userId))) {
        console.log(`[handleMessage] canned reply cooldown — silent skip (catch-all) for ${userId.slice(-6)}`);
        return;
    }
    await logCannedSent(userId, '收到您的訊息！小編會回覆');
    await lineReply(event.replyToken, [
        {
            type: 'text',
            text: '收到您的訊息！小編會回覆，或您可以選下方按鈕：',
            quickReply: welcomeQuickReply()
        }
    ]);
}

// === HTTP entry ===
serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('ok', { status: 200 });
    }
    const body = await req.text();
    const signature = req.headers.get('x-line-signature') || '';

    // 啟動檢查 — secret/token 沒設會直接看到
    console.log(`[webhook] secret=${LINE_CHANNEL_SECRET ? 'SET(' + LINE_CHANNEL_SECRET.length + ')' : 'MISSING'} token=${LINE_CHANNEL_ACCESS_TOKEN ? 'SET(' + LINE_CHANNEL_ACCESS_TOKEN.length + ')' : 'MISSING'}`);

    if (!verifySignature(body, signature)) {
        console.error(`[webhook] Invalid signature — secret 跟 LINE Console 對不上。收到 sig=${signature.slice(0, 10)}...`);
        return new Response('invalid signature', { status: 401 });
    }
    console.log('[webhook] signature OK');

    const payload = JSON.parse(body);
    const summary = (payload.events || []).map((e: any) =>
        `${e.type}${e.mode === 'standby' ? '(standby)' : ''}${e.message ? `:${e.message.type}` : ''}`
    ).join(', ');
    console.log(`[webhook] events=[${summary}]`);

    let handlerError: any = null;
    let errorContext = '';
    for (const event of (payload.events || [])) {
        try {
            // P1-3: idempotency — LINE 會在 ack timeout 重送，同 webhookEventId 跳過避免重複處理
            // 需 line_messages.webhook_event_id 加 UNIQUE constraint (見 sql/12-webhook-idempotency.sql)
            if (event.webhookEventId) {
                const { data: dup } = await supabase
                    .from('line_messages')
                    .select('id')
                    .eq('webhook_event_id', event.webhookEventId)
                    .maybeSingle();
                if (dup) {
                    console.log(`[webhook] skip duplicate event ${event.webhookEventId}`);
                    continue;
                }
            }
            if (event.type === 'follow')   await handleFollow(event);
            if (event.type === 'unfollow') await handleUnfollow(event);
            if (event.type === 'message')  await handleMessage(event);
            if (event.type === 'postback') await handlePostback(event);
        } catch (e) {
            console.error('[webhook] Event handler error:', e);
            handlerError = e;
            errorContext = `${event.type}${event.message ? `:${event.message.type}` : ''} from ${event.source?.userId?.slice(-6) || '?'}`;
        }
    }
    // 任一 event 失敗就回 500，讓 Invocations 列表直接看得到紅字
    if (handlerError) {
        const errMsg = String(handlerError?.message || handlerError);
        // E1: push 給管理員 LINE (best effort，自身失敗不要再 throw)
        try {
            await notifyAdmin(`⚠️ BMS Webhook 錯誤\n\n事件：${errorContext}\n錯誤：${errMsg.slice(0, 200)}\n\n請到 Supabase Logs 看詳情`);
        } catch (e) {
            console.error('[webhook] notifyAdmin failed:', e);
        }
        return new Response(JSON.stringify({ ok: false, error: errMsg }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
    });
});
