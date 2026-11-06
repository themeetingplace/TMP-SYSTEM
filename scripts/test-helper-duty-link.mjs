import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const helperDashboard = readFileSync(new URL('../js/views/helper-dashboard.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

assert.ok(helperDashboard.includes('https://garbage-duty.pages.dev/'), '小幫手首頁必須提供垃圾值日表連結');
assert.ok(helperDashboard.includes('target="_blank"'), '值日表應在新分頁開啟，避免離開 PMS 工作台');
assert.ok(helperDashboard.includes('rel="noopener noreferrer"'), '外部連結必須隔離 opener');
assert.ok(css.includes('.helper-duty-link'), '值日表入口必須有專用且可辨識的介面樣式');

console.log('helper duty link checks passed');
