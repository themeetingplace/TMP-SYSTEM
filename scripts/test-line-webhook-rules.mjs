import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../supabase/functions/line-webhook/index.ts', import.meta.url), 'utf8');

assert.ok(!source.includes('關於房租匯款帳號，小編會盡快提供給您'), '不得恢復無用的匯款帳號自動回覆');
assert.ok(!source.includes('有人在 LINE 詢問「匯款帳號 / 房租怎麼繳」'), '不得保留該關鍵字的隱藏管理員通知');
assert.ok(source.includes("if (/^\\d{5}$/.test(text))"), '銀行末 5 碼正式回報流程必須保留');

console.log('LINE webhook auto-reply regression checks passed');
