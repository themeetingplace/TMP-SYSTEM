// 檢查 sb-secret-new.txt 的金鑰是否有效 (不外洩完整金鑰)
// 用法: node scripts\sb-check-new.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let url, key;
const f = path.join(__dirname, 'sb-secret-new.txt');
if (!fs.existsSync(f)) { console.error('✗ 找不到 scripts/sb-secret-new.txt'); process.exit(1); }
const raw = fs.readFileSync(f, 'utf8');
for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(url|key)\s*=\s*(.+?)\s*$/i);
    if (!m) continue;
    const val = m[2].replace(/^<+|>+$/g, '').trim(); // 去掉貼上時誤留的角括號
    if (m[1].toLowerCase() === 'url') url = val;
    else key = val;
}
url = url ? url.replace(/\/$/, '') : url;

console.log('--- 檔案診斷 ---');
console.log('url          :', url);
console.log('key 長度     :', key ? key.length : '(空)');
console.log('key 開頭     :', key ? key.slice(0, 10) + '…' : '(空)');
console.log('key 結尾     :', key ? '…' + key.slice(-4) : '(空)');
if (key) {
    const kind = key.startsWith('eyJ') ? 'legacy JWT (anon 或 service_role)'
        : key.startsWith('sb_secret_') ? '新版 secret key ✓ 可用'
        : key.startsWith('sb_publishable_') ? '新版 publishable key ✗ (這把是給前端的, 權限不夠, 要換 service_role / secret)'
        : '未知格式';
    console.log('key 類型     :', kind);
    if (/\s/.test(key)) console.log('⚠ 金鑰中含有空白或換行, 可能是貼上時斷行了!');
    const dots = (key.match(/\./g) || []).length;
    if (key.startsWith('eyJ')) console.log('JWT 點數     :', dots, dots === 2 ? '(正常)' : '✗ 不是 2, JWT 被截斷了!');
}

if (!url || !key) process.exit(1);

console.log('\n--- 連線測試 (GET owners) ---');
const res = await fetch(`${url}/rest/v1/owners?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
});
console.log('HTTP', res.status, res.statusText);
const txt = await res.text();
console.log(txt.slice(0, 300));
if (res.ok) console.log('\n✓ 金鑰有效! 可以直接重跑 node scripts\\db-restore.mjs');
else console.log('\n✗ 金鑰仍無效, 看上面類型判斷換一把');
