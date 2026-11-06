import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const helperDashboard = readFileSync(new URL('../js/views/helper-dashboard.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

assert.ok(helperDashboard.includes('https://garbage-duty-euw.pages.dev/'), '小幫手首頁必須提供公司 Cloudflare 的垃圾值日表連結');
assert.ok(helperDashboard.includes('target="_blank"'), '值日表應在新分頁開啟，避免離開 PMS 工作台');
assert.ok(helperDashboard.includes('rel="noopener noreferrer"'), '外部連結必須隔離 opener');
assert.ok(css.includes('.helper-duty-link'), '值日表入口必須有專用且可辨識的介面樣式');
assert.ok(helperDashboard.includes("['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']"), '值班台日期必須使用固定且可預期的中文星期格式');
assert.ok(helperDashboard.includes('helper-home-date-copy'), '日期應改為橫向資訊，不再使用撕頁月曆');
assert.ok(!helperDashboard.includes("month: 'long'"), '不可再讓瀏覽器產生「月:11月」等冗餘格式');
assert.ok(!helperDashboard.includes('記錄館務花費、核對零用金'), '值班台不應保留重複的功能說明');

console.log('helper duty link checks passed');
