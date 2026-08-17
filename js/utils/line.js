// LINE 推送工具 — 呼叫 Supabase Edge Function 'line-push'
import { supabase } from '../supabase.js';
import { mockData } from '../data.js';

// 推訊息給租客 (tenant 必須已綁定 LINE)
// opts.message: 文字訊息
// opts.fileUrl: 檔案 URL (LINE 會帶連結文字)
// opts.fileName: 顯示用檔名
export async function pushToTenant(tenantId, opts = {}) {
    const tenant = mockData.tenants.find(t => t.id === tenantId);
    if (!tenant) throw new Error(`找不到租客 ${tenantId}`);
    if (!tenant.lineUserId) throw new Error(`${tenant.name} 尚未綁定 LINE`);

    const { data, error } = await supabase.functions.invoke('line-push', {
        body: { tenantId, ...opts }
    });
    if (error) throw new Error(error.message);
    if (data && data.ok === false) throw new Error(data.error || 'LINE 推送失敗');
    return data;
}

// 觸發續租詢問掃描 — 後端找 N 天內到期的 active 合約，發 LINE Quick Reply 給租客
// opts.daysAhead: 預設 14; opts.force: 即使 5 天內問過也再問一次 (測試用)
// opts.contractIds: 只發指定合約 (勾選 UI 用); opts.dryRun: 只回列表, 不真的發
export async function triggerRenewalPoll(opts = {}) {
    const body = { daysAhead: opts.daysAhead || 14 };
    if (opts.force) body.force = true;
    if (opts.dryRun) body.dryRun = true;
    if (Array.isArray(opts.contractIds) && opts.contractIds.length) body.contractIds = opts.contractIds;
    const { data, error } = await supabase.functions.invoke('renewal-poll', { body });
    if (error) throw new Error(error.message);
    if (data && data.ok === false) throw new Error(data.error || '續租詢問失敗');
    return data; // { ok, sent, skipped_no_line, skipped_already_asked, failed, contracts: [...] }
}

// 上傳 PDF bytes 到 Supabase Storage (bucket = private)
// 回傳 { path: 存到 DB 用的 storage key, url: 24 小時有效的簽名連結，給 LINE 用 }
// Storage key 不能含中文 → 用 ASCII 隨機檔名；原中文檔名只用在 LINE 訊息顯示
export async function uploadPdfToStorage(filename, bytes) {
    const random = Math.random().toString(36).slice(2, 8);
    const key = `contract_${Date.now()}_${random}.pdf`;
    const { error } = await supabase.storage
        .from('contract-pdfs')
        .upload(key, bytes, { contentType: 'application/pdf', upsert: false });
    if (error) throw new Error(`上傳失敗：${error.message}`);
    const url = await createSignedPdfUrl(key);
    return { path: key, url };
}

// 手動上傳「簽署檔」(PDF 或圖片) → contract-pdfs bucket
// 跟 line-webhook 自動流程同 bucket + 同命名 (signed_<合約>_<時間>.<副檔名>)，
// 所以之後一樣用 resolveSignedPdfUrl(path) 開得起來。回傳 { path }。
export async function uploadSignedFileToStorage(bytes, ext, contentType, contractId) {
    const random = Math.random().toString(36).slice(2, 8);
    const safeExt = (ext || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const key = `signed_${contractId || 'manual'}_${Date.now()}_${random}.${safeExt}`;
    const { error } = await supabase.storage
        .from('contract-pdfs')
        .upload(key, bytes, { contentType: contentType || 'application/octet-stream', upsert: false });
    if (error) throw new Error(`上傳失敗：${error.message}`);
    return { path: key };
}

// 簽過名連結 (預設 24 小時有效) — bucket 是 private，這是唯一存取方式
// P2-3: 從 7 天縮短到 24h，降低 URL 被截圖外流的暴露時間
// (合約 PDF 用戶當下會看；要再看用 BMS「重發 URL」按鈕重新產)
export async function createSignedPdfUrl(path, expiresInSec = 24 * 3600) {
    const { data, error } = await supabase.storage
        .from('contract-pdfs')
        .createSignedUrl(path, expiresInSec);
    if (error) throw error;
    return data.signedUrl;
}

// 給 signedFileUrl 用 — 可能是新的 path 或舊的 public URL，自動處理
// 新版：DB 存 path → 即時產生 signed URL
// 舊版相容：若 DB 已存完整 URL（http 開頭）→ 直接回傳
export async function resolveSignedPdfUrl(pathOrUrl) {
    if (!pathOrUrl) return null;
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
        return pathOrUrl;  // 舊資料：完整 URL，直接用
    }
    return await createSignedPdfUrl(pathOrUrl);  // 新資料：path，動態簽
}
