// 一次性遷移：localStorage 內的 mockData → Supabase
//
// 用法（在瀏覽器 console）：
//   await migrateToSupabase()        // 上傳全部
//   await clearAllSupabase()         // 清空 Supabase 所有資料（會要求二次確認）
//
// 設計：upsert (on conflict do update)，重跑安全。
// 順序：按 FK 依賴 (db-mapping.js TABLES 已排好)。

import { supabase } from './supabase.js';
import { mockData } from './data.js';
import { TABLES } from './db-mapping.js';

export async function migrateToSupabase() {
    console.group('[migrate] localStorage → Supabase');
    const results = [];

    for (const step of TABLES) {
        const source = mockData[step.src] || [];
        const rows = source.map(step.toDb);

        if (rows.length === 0) {
            console.log(`  ${step.key}: 0 筆 (跳過)`);
            results.push({ table: step.key, count: 0, status: '跳過 (空)' });
            continue;
        }

        console.log(`→ ${step.key}: 上傳 ${rows.length} 筆...`);
        const { error } = await supabase.from(step.key).upsert(rows, { onConflict: step.pk });
        if (error) {
            console.error(`  ❌ ${step.key}: ${error.message}`, error);
            results.push({ table: step.key, count: rows.length, status: '失敗', error: error.message });
        } else {
            console.log(`  ✅ ${step.key}: ${rows.length} 筆完成`);
            results.push({ table: step.key, count: rows.length, status: '成功' });
        }
    }

    console.table(results);
    console.groupEnd();

    const failed = results.filter(r => r.status === '失敗');
    if (failed.length) {
        console.warn(`⚠️ 有 ${failed.length} 張表上傳失敗，看上面紅字`);
    } else {
        console.log('🎉 全部上傳完成！到 Supabase Table Editor 確認');
    }
    return results;
}

export async function clearAllSupabase() {
    if (!confirm('確定要清空 Supabase 所有表的資料？此動作無法還原。')) return;
    // 反向順序避免 FK 阻擋
    const reversed = [...TABLES].reverse();
    console.group('[clear] 清空 Supabase 所有表');
    for (const step of reversed) {
        const { error } = await supabase.from(step.key).delete().not(step.pk, 'is', null);
        if (error) console.error(`❌ ${step.key}: ${error.message}`);
        else console.log(`✅ ${step.key} 已清空`);
    }
    console.groupEnd();
}

window.migrateToSupabase = migrateToSupabase;
window.clearAllSupabase = clearAllSupabase;
console.log('[migrate] 已就緒 — 在 console 輸入 await migrateToSupabase() 開始上傳');
