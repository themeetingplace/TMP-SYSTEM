// Supabase Storage 搬移工具 — 備份 (backup) / 還原 (restore)
// 用途：Supabase 搬到新專案時，把 private bucket 的檔案整批下載備份，之後原樣上傳到新專案。
// 關鍵：還原時「檔名 (key) 原封不動」，DB 裡的路徑字串 (signed_file_url / id_card_*) 才接得回去。
//
// 需求：Node 18+ (內建 fetch)，不用 npm install。
//
// 用法 (PowerShell)：
//   # 1) 備份 (從舊專案抓下來)
//   $env:SB_URL="https://zkwkycpfcyecebstmotc.supabase.co"
//   $env:SB_SERVICE_KEY="<舊專案的 service_role key>"
//   node scripts/storage-migrate.mjs backup
//
//   # 2) 還原 (上傳到新專案) — 等新專案開好再做
//   $env:SB_URL="https://<新專案>.supabase.co"
//   $env:SB_SERVICE_KEY="<新專案的 service_role key>"
//   node scripts/storage-migrate.mjs restore
//
// ⚠ service_role key 是機密：只放在自己電腦的環境變數，別貼到聊天/commit。
// 備份檔會存在 scripts/storage-backup/<bucket>/<原路徑>。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKETS = ['contract-pdfs', 'id-cards'];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_ROOT = path.join(__dirname, 'storage-backup');

const URL_BASE = process.env.SB_URL?.replace(/\/$/, '');
const KEY = process.env.SB_SERVICE_KEY;
const MODE = process.argv[2];

if (!URL_BASE || !KEY) {
    console.error('✗ 請先設好環境變數 SB_URL 與 SB_SERVICE_KEY (service_role key)');
    process.exit(1);
}
if (MODE !== 'backup' && MODE !== 'restore') {
    console.error('✗ 用法：node scripts/storage-migrate.mjs <backup|restore>');
    process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const CT_BY_EXT = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif'
};
const contentTypeFor = (name) => CT_BY_EXT[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

// 遞迴列出 bucket 底下所有檔案 (含子資料夾)，回傳完整 key 陣列
async function listAll(bucket, prefix = '') {
    const out = [];
    let offset = 0;
    const limit = 100;
    for (;;) {
        const res = await fetch(`${URL_BASE}/storage/v1/object/list/${bucket}`, {
            method: 'POST',
            headers: { ...H, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, limit, offset, sortBy: { column: 'name', order: 'asc' } })
        });
        if (!res.ok) throw new Error(`list ${bucket}/${prefix} 失敗：${res.status} ${await res.text()}`);
        const items = await res.json();
        if (!items.length) break;
        for (const it of items) {
            const full = prefix ? `${prefix}${it.name}` : it.name;
            // id 為 null = 資料夾 (prefix)，往下遞迴；否則是檔案
            if (it.id == null && it.metadata == null) {
                out.push(...await listAll(bucket, `${full}/`));
            } else {
                out.push(full);
            }
        }
        if (items.length < limit) break;
        offset += limit;
    }
    return out;
}

async function download(bucket, key) {
    const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${encodeURI(key)}`, { headers: H });
    if (!res.ok) throw new Error(`download ${bucket}/${key} 失敗：${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

async function ensureBucket(bucket) {
    // 冪等：已存在就略過 (新專案若已跑過 sql/11 + sql/17 建好 bucket，這裡也不會出錯)
    const res = await fetch(`${URL_BASE}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bucket, name: bucket, public: false })
    });
    if (res.ok) { console.log(`  · 建立 bucket ${bucket}`); return; }
    const txt = await res.text();
    if (res.status === 409 || /already exists|exists/i.test(txt)) return;  // 已存在
    console.warn(`  ⚠ 建 bucket ${bucket} 回應 ${res.status}：${txt}（可能已存在，繼續）`);
}

async function upload(bucket, key, buf) {
    const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${encodeURI(key)}`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': contentTypeFor(key), 'x-upsert': 'true' },
        body: buf
    });
    if (!res.ok) throw new Error(`upload ${bucket}/${key} 失敗：${res.status} ${await res.text()}`);
}

async function runBackup() {
    console.log(`▶ 備份自 ${URL_BASE}\n  存到 ${BACKUP_ROOT}\n`);
    let total = 0;
    for (const bucket of BUCKETS) {
        const keys = await listAll(bucket);
        console.log(`● ${bucket}：${keys.length} 個檔案`);
        for (const key of keys) {
            const buf = await download(bucket, key);
            const dest = path.join(BACKUP_ROOT, bucket, key);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, buf);
            total++;
            if (total % 20 === 0) console.log(`  …已下載 ${total}`);
        }
        console.log(`  ✓ ${bucket} 完成`);
    }
    console.log(`\n✓ 全部備份完成，共 ${total} 個檔案，在 ${BACKUP_ROOT}`);
}

// 遞迴收集本機備份資料夾裡的所有檔案 → 相對 key
function walk(dir, base = dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) out.push(...walk(full, base));
        else out.push(path.relative(base, full).split(path.sep).join('/'));  // key 用正斜線
    }
    return out;
}

async function runRestore() {
    console.log(`▶ 還原到 ${URL_BASE}\n  來源 ${BACKUP_ROOT}\n`);
    let total = 0;
    for (const bucket of BUCKETS) {
        const bucketDir = path.join(BACKUP_ROOT, bucket);
        const keys = walk(bucketDir);
        if (!keys.length) { console.log(`● ${bucket}：備份資料夾沒有檔案，略過`); continue; }
        console.log(`● ${bucket}：${keys.length} 個檔案`);
        await ensureBucket(bucket);
        for (const key of keys) {
            const buf = fs.readFileSync(path.join(bucketDir, key));
            await upload(bucket, key, buf);
            total++;
            if (total % 20 === 0) console.log(`  …已上傳 ${total}`);
        }
        console.log(`  ✓ ${bucket} 完成`);
    }
    console.log(`\n✓ 全部還原完成，共 ${total} 個檔案。檔名原封，DB 路徑接得回去。`);
}

(MODE === 'backup' ? runBackup() : runRestore()).catch(e => {
    console.error('\n✗ 失敗：', e.message);
    process.exit(1);
});
