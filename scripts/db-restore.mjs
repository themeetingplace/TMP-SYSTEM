// Supabase 資料還原 → 讀 scripts/db-backup/*.json 匯入「新專案」
// 讀 scripts/sb-secret-new.txt 的 url= + key= (⚠ 新專案的 service_role key, 不是舊的!)
// 用法: node scripts/db-restore.mjs
//
// 特性:
//   - 依 FK 依賴順序匯入 (被參照的表先進), 不會踩外鍵順序。
//   - upsert (merge-duplicates on PK), 重跑安全 (同 id 覆蓋而非重複)。
//   - 欄位已是 snake_case (從 REST select* 備份), 直接送回, 不需轉換。
//   - service_role 走 REST 會繞過 RLS, 匯入不受政策擋。
//
// ⚠ 匯入後 line_messages 的序號 (sequence) 需手動補一行 (腳本結束會印出來)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_DIR = path.join(__dirname, 'db-backup');

// 依 FK 依賴排序: 被參照的先進 (owners→buildings→properties→contracts→invoices…)
const ORDER = [
    'owners', 'buildings', 'properties', 'contracts',
    'invoices', 'deposits', 'settlements', 'contract_templates',
    'tenants', 'maintenances', 'checkins', 'invoice_types',
    'tenant_sources', 'payment_methods', 'rent_rules',
    'management_leads', 'admins', 'line_messages'
];

// --- 讀設定 (優先環境變數, 否則 scripts/sb-secret-new.txt 的 url= / key=) ---
function loadConfig() {
    let url = process.env.SB_URL_NEW;
    let key = process.env.SB_SERVICE_KEY_NEW;
    if (!url || !key) {
        const f = path.join(__dirname, 'sb-secret-new.txt');
        if (fs.existsSync(f)) {
            for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
                const m = line.match(/^\s*(url|key)\s*=\s*(.+?)\s*$/i);
                if (!m) continue;
                const val = m[2].replace(/^<+|>+$/g, '').trim(); // 去掉貼上時誤留的角括號
                if (m[1].toLowerCase() === 'url') url = url || val;
                else key = key || val;
            }
        }
    }
    return { url: url ? url.replace(/\/$/, '') : url, key };
}

const { url: URL_BASE, key: KEY } = loadConfig();
if (!URL_BASE || !KEY) {
    console.error('✗ 找不到新專案網址或 service_role key。請在 scripts/sb-secret-new.txt 填 url= 跟 key=（新專案的！）');
    process.exit(1);
}
const H = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal'
};

const BATCH = 500; // 一次送 500 筆, 避免 payload 過大

async function upsertTable(table, rows) {
    for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
            method: 'POST',
            headers: H,
            body: JSON.stringify(chunk)
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`${table} 批次 ${i}-${i + chunk.length - 1}: ${res.status} ${txt}`);
        }
    }
}

(async () => {
    const DELTA = (process.argv[2] || '').toLowerCase() === 'delta';
    // delta 模式: 只補業務資料, 跳過 line_messages (webhook 已切新專案, 兩邊流水號會撞)
    const tables = DELTA ? ORDER.filter(t => t !== 'line_messages') : ORDER;
    console.log(`▶ ${DELTA ? '差異同步 (delta, 跳過 line_messages)' : '完整還原'} 到 ${URL_BASE}\n  來源 ${IN_DIR}\n`);
    if (!/mkatwwouurwxlruisqwe/.test(URL_BASE)) {
        console.log(`  (提醒: 目標網址是 ${URL_BASE}, 確認這是「新」專案再繼續)\n`);
    }
    let grand = 0;
    for (const table of tables) {
        const f = path.join(IN_DIR, `${table}.json`);
        if (!fs.existsSync(f)) { console.log(`  - ${table.padEnd(20)} (無備份檔, 跳過)`); continue; }
        const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (!Array.isArray(rows) || rows.length === 0) { console.log(`  - ${table.padEnd(20)} 0 筆, 跳過`); continue; }
        try {
            await upsertTable(table, rows);
            grand += rows.length;
            console.log(`  ✓ ${table.padEnd(20)} ${rows.length} 筆`);
        } catch (e) {
            console.error(`  ✗ ${e.message}`);
        }
    }
    console.log(`\n✓ ${DELTA ? '差異同步' : '還原'}完成，共 ${grand} 筆`);
    if (!DELTA) {
        console.log(`\n⚠ 最後補一步: 到新專案 SQL Editor 跑這行, 修正 line_messages 的自動序號 (不然之後 LINE 訊息寫入會撞號):`);
        console.log(`   select setval('line_messages_id_seq', (select coalesce(max(id),1) from line_messages));`);
    }
})().catch(e => { console.error('\n✗ 失敗：', e.message); process.exit(1); });
