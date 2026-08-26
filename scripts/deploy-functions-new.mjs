// 部署 4 支 Edge Function 到「新專案」(走 Supabase Management API, 不需 CLI / Docker)
// 讀:
//   scripts/sb-pat-new.txt   → 新專案「擁有帳號」的 access token (Account → Access Tokens 產生)
//                              格式一行: pat=sbp_xxx  (或直接一行貼 token 也可)
//   scripts/sb-secret-new.txt→ url= 那行 (用來取專案 ref)
// 用法: node scripts\deploy-functions-new.mjs
//
// verify_jwt 設定 (跟舊專案一致):
//   line-webhook / tenant-register → false (LINE / LIFF 公開呼叫)
//   line-push / renewal-poll       → true  (前端帶登入 JWT 呼叫)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const FUNCTIONS = [
    { slug: 'line-webhook', verify_jwt: false },
    { slug: 'tenant-register', verify_jwt: false },
    { slug: 'line-push', verify_jwt: true },
    { slug: 'renewal-poll', verify_jwt: true },
];

function readKV(file, keys) {
    const out = {};
    if (!fs.existsSync(file)) return out;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([a-z_]+)\s*=\s*(.+?)\s*$/i);
        if (!m) continue;
        const k = m[1].toLowerCase();
        if (keys.includes(k)) out[k] = m[2].replace(/^<+|>+$/g, '').trim();
    }
    return out;
}

// PAT: 支援 pat=xxx 一行, 或整個檔就是一行 token
function loadPat() {
    if (process.env.SB_PAT_NEW) return process.env.SB_PAT_NEW.trim();
    const f = path.join(__dirname, 'sb-pat-new.txt');
    if (!fs.existsSync(f)) return '';
    const raw = fs.readFileSync(f, 'utf8').trim();
    if (!raw) return '';
    const m = raw.match(/^\s*pat\s*=\s*(.+?)\s*$/im);
    const val = m ? m[1] : (raw.split(/\r?\n/).find(l => l.trim()) || '');
    return val.replace(/^<+|>+$/g, '').trim();
}

const PAT = loadPat();
const { url } = readKV(path.join(__dirname, 'sb-secret-new.txt'), ['url']);
const REF = url ? (url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i) || [])[1] : null;

if (!PAT) { console.error('✗ 找不到 access token。請在 scripts/sb-pat-new.txt 貼上新專案帳號的 token。'); process.exit(1); }
if (!REF) { console.error('✗ 從 sb-secret-new.txt 的 url= 取不到專案 ref。'); process.exit(1); }

async function deployOne({ slug, verify_jwt }) {
    const file = path.join(ROOT, 'supabase', 'functions', slug, 'index.ts');
    if (!fs.existsSync(file)) throw new Error(`找不到 ${file}`);
    const code = fs.readFileSync(file, 'utf8');

    const fd = new FormData();
    fd.append('metadata', JSON.stringify({ name: slug, entrypoint_path: 'index.ts', verify_jwt }));
    fd.append('file', new Blob([code], { type: 'application/typescript' }), 'index.ts');

    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${slug}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${PAT}` },
        body: fd
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${txt}`);
    return txt;
}

(async () => {
    console.log(`▶ 部署 Edge Functions 到 ref=${REF}\n`);
    let ok = 0;
    for (const fn of FUNCTIONS) {
        try {
            await deployOne(fn);
            ok++;
            console.log(`  ✓ ${fn.slug.padEnd(16)} (verify_jwt=${fn.verify_jwt})`);
        } catch (e) {
            console.error(`  ✗ ${fn.slug}: ${e.message}`);
        }
    }
    console.log(`\n${ok}/${FUNCTIONS.length} 部署完成`);
    if (ok === FUNCTIONS.length) {
        console.log('\n下一步: 到新專案後台設 Edge Function secrets (LINE_* 那幾個), 見 Claude 說明。');
    }
})().catch(e => { console.error('\n✗ 失敗：', e.message); process.exit(1); });
