import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contracts = readFileSync(new URL('../js/views/contracts.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../js/views/dashboard.js', import.meta.url), 'utf8');
const processor = readFileSync(new URL('../js/utils/autoRenewalProcessor.js', import.meta.url), 'utf8');

assert.ok(contracts.includes("const repliedRenewCount = renewCounts.renew + renewCounts.decline + renewCounts.inquiry"), '已回覆清單應包含續租、不續租與有問題');
assert.ok(contracts.includes("data-filter-value=\"replied\" data-filter-group=\"renew\""), '合約頁應提供已回覆待處理篩選');
assert.ok(contracts.includes("${c.renewIntent || 'none'} ${hasIntent ? 'replied' : ''}"), '已回覆的合約資料列應可被合併篩選');
assert.ok(contracts.includes('批次修改並發送'), '原批次修改與發送入口必須保留');
assert.ok(processor.includes('export function findInquiryPendingCandidates()'), '有問題的回覆也應納入待處理候選');
assert.ok(dashboard.includes('const replyCount = renewCandidates.length + declineCandidates.length + inquiryCandidates.length'), '首頁回覆數量應包含三種已回覆狀態');
assert.ok(dashboard.includes("actionId: replyCount > 0 ? 'goto-renewal-replies' : ''"), '首頁回覆處理應導向已回覆清單');
assert.ok(dashboard.includes("scope.querySelector('[data-filter-value=\"replied\"][data-filter-group=\"renew\"]')?.click()"), '導向後應自動套用已回覆篩選');

console.log('renewal reply list regression checks passed');
