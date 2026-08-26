// 把 Supabase MCP 設定寫進 Claude Code 的設定檔 (~/.claude.json)
// 由「使用者自己」執行 (Claude 不被允許自動改自己的設定)。
// 讀 scripts/sb-pat.txt 的 Personal Access Token，寫進 mcpServers.supabase。
//
// 執行：node scripts/add-mcp.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const patFile = path.join(__dirname, 'sb-pat.txt');

if (!fs.existsSync(patFile)) {
    console.error('✗ 找不到 scripts/sb-pat.txt，請先把 Personal Access Token 貼進那個檔。');
    process.exit(1);
}
const pat = fs.readFileSync(patFile, 'utf8').trim();
if (!pat.startsWith('sbp_')) {
    console.error('✗ sb-pat.txt 裡的 token 格式不對 (應以 sbp_ 開頭)。目前開頭:', JSON.stringify(pat.slice(0, 8)));
    process.exit(1);
}

const cfgPath = path.join(os.homedir(), '.claude.json');
if (!fs.existsSync(cfgPath)) {
    console.error('✗ 找不到 ~/.claude.json：', cfgPath);
    process.exit(1);
}
const raw = fs.readFileSync(cfgPath, 'utf8');
let cfg;
try { cfg = JSON.parse(raw); } catch (e) { console.error('✗ .claude.json 不是有效 JSON，中止：', e.message); process.exit(1); }

// 先備份
fs.writeFileSync(cfgPath + '.bak-mcp', raw);

cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.supabase = {
    command: 'cmd',
    args: ['/c', 'npx', '-y', '@supabase/mcp-server-supabase@latest', '--project-ref=zkwkycpfcyecebstmotc'],
    env: { SUPABASE_ACCESS_TOKEN: pat }
};

fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

const masked = pat.slice(0, 7) + '…' + pat.slice(-4);
console.log('');
console.log('  ✓ 已把 Supabase MCP 寫進 Claude Code 設定');
console.log('    位置 :', cfgPath);
console.log('    專案 : zkwkycpfcyecebstmotc');
console.log('    token:', masked);
console.log('    原檔已備份到 .claude.json.bak-mcp');
console.log('');
console.log('  👉 接下來請「把 Claude Code 整個關掉重開」(或重新載入視窗)，MCP 才會生效。');
console.log('');
