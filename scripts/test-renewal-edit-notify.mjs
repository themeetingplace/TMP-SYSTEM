import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/views/contracts.js', import.meta.url), 'utf8');

assert.ok(source.includes('async function sendRenewalPaymentNotice(contract)'), '續租繳款通知應使用共用發送流程');
assert.ok(source.includes('function promptRenewalPaymentNotice(contract)'), '編輯續租後必須顯示立即發送提示');
assert.ok(source.includes("confirmLabel: '立即發送繳款通知'"), '提示視窗必須提供立即發送按鈕');
assert.ok(source.includes("cancelLabel: '稍後再發送'"), '使用者必須可以選擇稍後發送');
assert.ok(source.includes('onSaved: (saved) =>'), '編輯續租儲存後必須銜接發送提示');
assert.ok(source.includes('promptRenewalPaymentNotice(saved)'), '發送提示必須使用剛儲存的新合約');

console.log('renewal edit notification regression checks passed');
