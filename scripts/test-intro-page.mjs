import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../intro/index.html', import.meta.url), 'utf8');
const loginSource = await readFile(new URL('../js/views/login.js', import.meta.url), 'utf8');

assert.match(source, /<meta name="viewport"/, '介紹頁必須支援手機版');
assert.match(source, /聚空間 PMS/, '介紹頁必須使用正確品牌名稱');
assert.match(source, /id="workflow"/, '介紹頁必須展示完整營運流程');
assert.match(source, /id="interfaces"/, '介紹頁必須展示主要介面');
assert.match(source, /id="line"/, '介紹頁必須說明 LINE 協作');
assert.match(source, /id="managed"/, '介紹頁必須說明代管模式');
assert.match(source, /id="modules"/, '介紹頁必須提供完整功能盤點');

for (const feature of [
    '住房一覽', '合約管理', '房租查帳', '館務報帳', '租客與證件',
    '維修追蹤', '營運報表', '權限與系統', '小幫手工作台', '屋主月結算'
]) {
    assert.ok(source.includes(feature), `介紹頁缺少功能：${feature}`);
}

assert.match(source, /去識別化示意/, '介紹頁必須清楚標示畫面不含真實個資');
assert.match(source, /href="\.\.\/"/, '介紹頁必須提供返回 PMS 的入口');
assert.match(loginSource, /href="intro\/"/, '登入頁必須提供功能介紹入口');

const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, '介紹頁必須包含互動腳本');
new Function(script);

console.log('PMS intro page regression checks passed');
