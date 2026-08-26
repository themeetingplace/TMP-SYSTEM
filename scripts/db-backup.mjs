// Supabase 資料表完整備份 → 每張表存成 JSON (搬遷前的安全快照)
// 讀 scripts/sb-secret.txt 的 url + service_role key (跟 storage 備份同一個檔)。
// 用法: node scripts/db-backup.mjs
// 輸出: scripts/db-backup/<table>.json  (含住客/綁定/合約/帳單…全部原始資料)
//
// ⚠ 這些 JSON 含個資 (住客電話/Email/LINE 綁定/身分證路徑), 已 gitignore, 不會進 git。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'db-backup');

// 要備份的表 (audit_log 是純 log、量大, 跳過; 其他全部備)
const TABLES = [
    'buildings', 'properties', 'tenants', 'contracts', 'invoices',
    'maintenances', 'checkins', 'invoice_types', 'tenant_sources',
    'payment_methods', 'rent_rules', 'contract_templates',
    'owners', 'deposits', 'settlements', 'management_leads',
    'admins', 'line_messages'
];

// --- 讀設定 (優先環境變數, 否則 scripts/sb-secret.txt 的 url= / key=) ---
function loadConfig() {
    let url = process.env.SB_URL;
    let key = process.env.SB_SERVICE_KEY;
    if (!url || !key) {
        const f = path.join(__dirname, 'sb-secret.txt');
        if (fs.existsSync(f)) {
            for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
                const m = line.match(/^\s*(url|key)\s*=\s*(.+?)\s*$/i);
                if (!m) continue;
                if (m[1].toLowerCase() === 'url') url = url || m[2];
                else key = key || m[2];
            }
        }
    }
    return { url: url ? url.replace(/\/$/, '') : url, key };
}

const { url: URL_BASE, key: KEY } = loadConfig();
if (!URL_BASE || !KEY) {
    console.error('✗ 找不到網址或 service_role key。請確認 scripts/sb-secret.txt 有填 url= 跟 key=');
    process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// 分頁抓一張表全部資料 (REST 一次最多 1000 筆, 用 Range 分頁)
async function fetchAll(table) {
    const out = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
        const to = from + pageSize - 1;
        const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=*`, {
            headers: { ...H, Range: `${from}-${to}`, 'Range-Unit': 'items', Prefer: 'count=exact' }
        });
        if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
        const rows = await res.json();
        out.push(...rows);
        if (rows.length < pageSize) break;
    }
    return out;
}

(async () => {
    console.log(`▶ 備份自 ${URL_BASE}\n  存到 ${OUT_DIR}\n`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    let grand = 0;
    const summary = {};
    for (const table of TABLES) {
        try {
            const rows = await fetchAll(table);
            fs.writeFileSync(path.join(OUT_DIR, `${table}.json`), JSON.stringify(rows, null, 2));
            summary[table] = rows.length;
            grand += rows.length;
            console.log(`  ✓ ${table.padEnd(20)} ${rows.length} 筆`);
        } catch (e) {
            console.error(`  ✗ ${table}: ${e.message}`);
        }
    }
    fs.writeFileSync(path.join(OUT_DIR, '_summary.json'), JSON.stringify({ backupAt: new Date().toISOString(), source: URL_BASE, counts: summary }, null, 2));
    console.log(`\n✓ 備份完成，共 ${grand} 筆，在 ${OUT_DIR}`);
})().catch(e => { console.error('\n✗ 失敗：', e.message); process.exit(1); });
