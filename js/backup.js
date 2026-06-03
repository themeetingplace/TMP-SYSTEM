// 一鍵備份 — 把 Supabase 所有資料表 + Storage 檔案清單匯出成單一 JSON
// 給用戶手動下載存到 Google Drive / 隨身碟 之類，做為災難復原用
//
// 設計考量：
//   * 直接從 Supabase 拉 (而不是 mockData)，確保拿到最新版本
//   * 表資料用 snake_case (DB 原始格式)，未來要 restore 可直接 INSERT
//   * Storage 檔案只列 path + size，不下載二進位 (太大；Supabase Storage 自己有備份)
//   * line_messages 表也含進來 (歷史溝通紀錄有保存價值)

import { supabase } from './supabase.js';
import { TABLES } from './db-mapping.js';
import { APP_VERSION } from './version.js';

// 額外的非 TABLES 資料表 (沒有 toDb/fromDb 對應、純 DB 用)
const EXTRA_TABLES = ['line_messages'];

const BACKUP_LAST_AT_KEY = 'bms-last-backup-at';

export function getLastBackupAt() {
    return localStorage.getItem(BACKUP_LAST_AT_KEY);
}
function setLastBackupAt(iso) {
    localStorage.setItem(BACKUP_LAST_AT_KEY, iso);
}

// 拉所有表 + storage 清單，回傳 backup payload
export async function buildBackupPayload() {
    const exportedAt = new Date().toISOString();
    const tables = {};
    const errors = [];

    const tableList = [...TABLES.map(t => t.key), ...EXTRA_TABLES];
    for (const key of tableList) {
        try {
            const { data, error } = await supabase.from(key).select('*');
            if (error) throw error;
            tables[key] = data || [];
        } catch (e) {
            errors.push({ table: key, error: e.message });
            tables[key] = null;
        }
    }

    // contract-pdfs Storage 清單
    let storageFiles = [];
    try {
        const { data: list, error } = await supabase.storage
            .from('contract-pdfs')
            .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });
        if (error) throw error;
        storageFiles = (list || []).map(f => ({
            name: f.name,
            size: f.metadata?.size ?? null,
            created_at: f.created_at,
            mime_type: f.metadata?.mimetype ?? null
        }));
    } catch (e) {
        errors.push({ table: 'storage.contract-pdfs', error: e.message });
    }

    return {
        schema_version: 1,
        app_version: APP_VERSION,
        exported_at: exportedAt,
        tables,
        storage: { 'contract-pdfs': storageFiles },
        errors: errors.length ? errors : undefined
    };
}

// 觸發瀏覽器下載
export async function downloadBackup() {
    const payload = await buildBackupPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const ts = payload.exported_at.replace(/[:.]/g, '-').slice(0, 19); // 2026-05-27T17-30-00
    const filename = `bms-backup-${ts}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setLastBackupAt(payload.exported_at);

    // 統計給呼叫端 toast 用
    const rowCounts = Object.fromEntries(
        Object.entries(payload.tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 'error'])
    );
    return {
        filename,
        sizeKB: Math.round(json.length / 1024),
        rowCounts,
        storageFileCount: payload.storage['contract-pdfs'].length,
        errors: payload.errors
    };
}
