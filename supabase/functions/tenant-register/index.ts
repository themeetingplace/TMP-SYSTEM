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

// base64 → Uint8Array
function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// 上傳浮水印身分證到 id-cards bucket
// path = id-cards/{tenantId}/{side}_{timestamp}.jpg
async function uploadIdCard(tenantId: string, side: 'front' | 'back', b64: string): Promise<string> {
    const bytes = base64ToBytes(b64);
    const ts = Date.now();
    const path = `${tenantId}/${side}_${ts}.jpg`;
    const { error } = await supabase.storage
        .from('id-cards')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`身分證 ${side} 上傳失敗：${error.message}`);
    return path;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders() });
    }
    if (req.method !== 'POST') {
        return new Response('only POST', { status: 405, headers: corsHeaders() });
    }

    try {
        const { idToken, userId, displayName, pictureUrl, form, idCardFront, idCardBack, claimTenantId } = await req.json();

        // 1. 驗 LINE ID Token
        if (!idToken || !userId) throw new Error('缺少 idToken / userId');
        const valid = await verifyLineIdToken(idToken, userId);
        if (!valid) throw new Error('LINE 身份驗證失敗，請重新整理再試');

        // 2. 表單欄位檢查
        const required = ['name', 'phone'];
        for (const k of required) {
            if (!form[k]) throw new Error(`欄位「${k}」必填`);
        }
        // 手機格式：
        //   (a) 台灣本地 09XXXXXXXX
        //   (b) 國際格式 +國碼+號碼 (海外租客)
        // 都先 strip 連字號/空白
        const phone = String(form.phone).replace(/[-\s]/g, '');
        const isTW = /^09\d{8}$/.test(phone);
        const isIntl = /^\+\d{8,15}$/.test(phone);
        if (!isTW && !isIntl) {
            throw new Error('手機格式錯誤 (台灣請填 09XXXXXXXX，海外請以 + 開頭加國碼)');
        }

        // 證件正面必填，反面選填 (外籍租客只傳護照)
        if (!idCardFront) {
            throw new Error('請至少上傳證件正面照片');
        }
        if (idCardFront.length < 1000) {
            throw new Error('證件正面資料異常，請重新拍照上傳');
        }
        if (idCardBack && idCardBack.length < 1000) {
            throw new Error('證件反面資料異常，請重新拍照上傳');
        }
        // 過大保護 — 每張 base64 < 4 MB
        const MAX_B64 = 4 * 1024 * 1024;
        if (idCardFront.length > MAX_B64 || (idCardBack && idCardBack.length > MAX_B64)) {
            throw new Error('證件照片過大，請以較低畫質重拍');
        }

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
        //   優先順序:
        //   (a) claimTenantId 由 LIFF 傳入 (客戶自己選的) → 驗證+綁定該筆
        //   (b) 同 phone 完全相符 → 直接 merge
        //   (c) phone 沒中, 但同名 unbound 剛好 1 筆 → 自動 merge
        //   (d) 同名 unbound 2+ 筆 → 不自動綁, 回 candidates 讓 LIFF UI 列出讓客戶選
        //   (e) 都沒中 → 建新 tenant
        const trimmedName = String(form.name || '').trim();
        let existing: any = null;
        let mergedBy: 'phone' | 'name' | 'claim' | null = null;

        // (a) claim 路徑
        if (claimTenantId) {
            const { data: claimRow } = await supabase
                .from('tenants').select('*').eq('id', claimTenantId).maybeSingle();
            if (!claimRow) throw new Error('您選的租客資料找不到, 請重新嘗試');
            if (claimRow.line_user_id) throw new Error('該租客已綁定其他 LINE, 請聯絡小編');
            if ((claimRow.name || '').trim() !== trimmedName) throw new Error('姓名跟選擇的合約對不上, 請重新確認');
            existing = claimRow;
            mergedBy = 'claim';
        } else {
            // (b) phone
            const { data: phoneMatch } = await supabase
                .from('tenants').select('*').eq('phone', phone).maybeSingle();
            if (phoneMatch) {
                existing = phoneMatch;
                mergedBy = 'phone';
            } else if (trimmedName) {
                // (c) (d) 同名 unbound
                const { data: nameMatches } = await supabase
                    .from('tenants').select('id, name, phone, current_property, status, created_at')
                    .eq('name', trimmedName)
                    .is('line_user_id', null);
                if (nameMatches && nameMatches.length === 1) {
                    // (c) 唯一同名 → auto merge
                    const { data: fullRow } = await supabase
                        .from('tenants').select('*').eq('id', nameMatches[0].id).maybeSingle();
                    existing = fullRow;
                    mergedBy = 'name';
                } else if (nameMatches && nameMatches.length > 1) {
                    // (d) 多筆同名 → 回 candidates 給 LIFF 列表, 客戶選了再重 POST 帶 claimTenantId
                    // 把每位 tenant 的 active 合約一起帶回去, 讓客戶看「住哪間 / 何時起租」幫助辨認
                    const tenantIds = nameMatches.map((t: any) => t.id);
                    const { data: contracts } = await supabase
                        .from('contracts').select('id, tenant, property_name, start_date, end_date, renewal_state')
                        .in('tenant', [trimmedName])
                        .eq('renewal_state', 'active');
                    const candidates = nameMatches.map((t: any) => ({
                        tenantId: t.id,
                        name: t.name,
                        phoneMasked: t.phone ? `${String(t.phone).slice(0, 3)}***${String(t.phone).slice(-3)}` : null,
                        currentProperty: t.current_property,
                        status: t.status,
                        createdAt: t.created_at,
                        contracts: (contracts || [])
                            .filter((c: any) => c.tenant === t.name)
                            .map((c: any) => ({
                                id: c.id, propertyName: c.property_name,
                                startDate: c.start_date, endDate: c.end_date
                            }))
                    }));
                    return new Response(JSON.stringify({
                        needsClaim: true,
                        candidates,
                        message: '查詢到多筆同名租客紀錄, 請選擇您的合約'
                    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
                }
            }
        }

        const nowIso = new Date().toISOString();
        let tenantId: string;

        if (existing) {
            // 已有 tenant (merge) → 更新 + 綁 LINE (保留現有 current_property/合約, 不覆寫)
            // 注意: 按 name merge 時 phone 用 LIFF 填的 (因為原本 phone 不對才走 name fallback)
            const updates: any = {
                name: form.name,
                email: form.email || existing.email,
                emergency_contact: form.emergencyContact || existing.emergency_contact,
                line_user_id: userId,
                line_display_name: displayName || null,
                line_picture_url: pictureUrl || null,
                line_bound_at: nowIso,
                source: existing.source || 'LIFF'
            };
            if (mergedBy === 'name' || mergedBy === 'claim') {
                updates.phone = phone;  // 用 LIFF 提供的 phone (原本 phone 沒對到才落到 name/claim 路徑)
            }
            await supabase.from('tenants').update(updates).eq('id', existing.id);
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

        // 7. 上傳證件 (浮水印照) 到 id-cards bucket → 寫回 tenants
        //    反面可選 — 沒傳就只上傳正面
        let frontPath: string | null = null;
        let backPath: string | null = null;
        try {
            frontPath = await uploadIdCard(tenantId, 'front', idCardFront);
            if (idCardBack) {
                backPath = await uploadIdCard(tenantId, 'back', idCardBack);
            }
            await supabase.from('tenants').update({
                id_card_front_path: frontPath,
                id_card_back_path: backPath,
                id_card_uploaded_at: nowIso
            }).eq('id', tenantId);
        } catch (uploadErr: any) {
            // 上傳失敗不阻斷主流程，記錄錯誤；tenant 已建好可手動補
            console.error('[tenant-register] id-card upload fail:', uploadErr);
        }

        // 8. log 到 line_messages 給管理員追蹤
        await supabase.from('line_messages').insert({
            line_user_id: userId,
            direction: 'in',
            message_type: 'liff_register',
            content: `LIFF 登記：${form.name} (${phone})${
                existing
                    ? (mergedBy === 'name' ? ' — 同名合併 (原 phone 不符)'
                        : mergedBy === 'claim' ? ' — 客戶自選合約 (claim)'
                        : ' — 更新舊客')
                    : ' — 新客'
            }${frontPath ? ' · 含身分證照' : ''}`,
            raw: { form, profile: { displayName, pictureUrl }, idCardUploaded: !!frontPath, mergedBy }
        });

        return new Response(JSON.stringify({
            ok: true, tenantId, isNew: !existing,
            idCardUploaded: !!(frontPath && backPath)
        }), {
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
