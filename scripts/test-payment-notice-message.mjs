import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/utils/paymentNoticeMessage.js', import.meta.url), 'utf8');

assert.ok(source.includes('感謝您回覆續租！'), '續租通知必須使用新版感謝文字');
assert.ok(source.includes('🔄 已為您建立續租合約'), '續租通知必須保留續租 emoji');
assert.ok(source.includes('🔔 應繳金額：NT$'), '續租通知必須顯示應繳金額');
assert.ok(source.includes('📅 合約期間：'), '續租通知必須顯示合約期間');
assert.ok(source.includes('收款帳號：'), '續租通知必須顯示收款帳號標題');
assert.ok(source.includes('台新銀行(812)／敦南分行／戶名：陳麒峰／帳號：28881003694287'), '續租通知必須使用指定收款帳號');
assert.ok(source.includes('繳款完成後，請回傳「銀行帳戶末 5 碼」(5 位數字就好)，'), '續租通知必須提示回傳末五碼');
assert.ok(source.includes('系統會自動記錄，查帳確認後會再傳送合約給您 ✨'), '續租通知必須說明查帳後傳送合約');

console.log('payment notice message regression checks passed');
