import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../mockup/helper-lobby/index.html', import.meta.url), 'utf8');
const hold = readFileSync(new URL('../mockup/helper-lobby/production-hold.js', import.meta.url), 'utf8');

assert.ok(html.includes('production-hold.js?v=20261106a'), '角色大廳必須在正式站載入建置中保護頁');
assert.ok(hold.includes("'localhost', '127.0.0.1', '::1'"), '本機網址必須略過建置中頁，保留原型測試');
assert.ok(hold.includes('角色大廳建置中'), '正式站必須顯示明確的建置中狀態');
assert.ok(hold.includes('其他 PMS 功能仍可正常使用'), '建置中頁必須告知使用者 PMS 不受影響');
assert.ok(hold.includes('../../index.html#dashboard'), '建置中頁必須能返回 PMS 首頁');

console.log('helper lobby production hold checks passed');
