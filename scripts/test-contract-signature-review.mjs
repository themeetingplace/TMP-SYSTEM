import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const webhook = readFileSync(new URL('../supabase/functions/line-webhook/index.ts', import.meta.url), 'utf8');
const contracts = readFileSync(new URL('../js/views/contracts.js', import.meta.url), 'utf8');
const tenants = readFileSync(new URL('../js/views/tenants.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../sql/42-contract-signature-review-2026-11-06.sql', import.meta.url), 'utf8');

assert.match(webhook, /pending-signatures\//, 'LINE 回傳檔必須先進待審路徑');
assert.match(webhook, /contract_signature_submissions/, 'Webhook 必須建立簽署檔待審紀錄');
assert.match(webhook, /file_signature_pending/, 'Webhook 必須留下待確認訊息紀錄');
assert.match(webhook, /fetchWithRetry[\s\S]*20_000/, 'LINE PDF 下載必須有重試與較長逾時');
assert.match(webhook, /isPdfByName[\s\S]*isPdfByMagic/, 'PDF 必須同時支援檔名與檔頭辨識');
assert.doesNotMatch(webhook, /pendingContract![\s\S]{0,800}signed_file_url:\s*key/, '自動收檔不得直接標記合約已簽署');

assert.match(contracts, /approve_contract_signature_submission/, '後台必須提供確認簽名的正式歸檔操作');
assert.match(contracts, /reject_contract_signature_submission/, '後台必須提供退回重傳操作');
assert.match(contracts, /data-action="preview-signature-submission"/, '後台必須先提供檔案預覽');
assert.match(tenants, /data-action="open-history-contract"/, '入住紀錄合約編號必須可點擊');
assert.match(tenants, /import\('\.\/contracts\.js'\)[\s\S]*showContractDetails\(contractId\)/, '入住紀錄必須開啟合約詳情');

assert.match(migration, /create table if not exists public\.contract_signature_submissions/, '必須建立簽署檔待審資料表');
assert.match(migration, /status = '已簽署'/, '只有核准 RPC 才更新已簽署狀態');

console.log('Contract signature review workflow checks passed');
