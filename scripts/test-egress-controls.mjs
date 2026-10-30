import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const syncSource = await readFile(new URL('../js/sync.js', import.meta.url), 'utf8');
const loaderSource = await readFile(new URL('../js/utils/contractTemplateLoader.js', import.meta.url), 'utf8');
const contractsSource = await readFile(new URL('../js/views/contracts.js', import.meta.url), 'utf8');
const settingsSource = await readFile(new URL('../js/views/settings.js', import.meta.url), 'utf8');

assert.match(
    syncSource,
    /CONTRACT_TEMPLATE_METADATA_COLUMNS\s*=\s*'building_id,file_name,uploaded_at,created_at,updated_at'/,
    '一般同步不得下載 contract_templates.pdf_base64'
);
assert.match(syncSource, /query\.gt\('updated_at', lastPullAt\)/, '前景核對必須使用 updated_at 增量查詢');
assert.match(syncSource, /FOREGROUND_RECONCILE_MIN_MS\s*=\s*5 \* 60 \* 1000/, '前景同步必須至少節流五分鐘');
assert.match(syncSource, /SMALL_TABLES\.forEach[\s\S]*?table: t\.key/, 'Realtime 必須逐張訂閱輕量資料表');
assert.doesNotMatch(syncSource, /event: '\*', schema: 'public' \}, handleRealtimeChange/, 'Realtime 不得訂閱含大型 PDF 的全 schema');
assert.match(syncSource, /realtimeEverSubscribed/, '首次 Realtime 連線不得額外觸發重複 pull');

assert.match(loaderSource, /select\('building_id,file_name,pdf_base64,uploaded_at,updated_at'\)/, 'PDF 必須按需載入');
assert.match(loaderSource, /\.eq\('building_id', buildingId\)/, 'PDF 載入必須限制單一館別');
assert.match(contractsSource, /ensureContractTemplatePdf\(buildingId\)/, '下載與發送合約必須走 lazy loader');
assert.match(settingsSource, /ensureContractTemplatePdf\(buildingId\)/, '樣板測試與檢查必須走 lazy loader');

console.log('Supabase egress controls checks passed');
