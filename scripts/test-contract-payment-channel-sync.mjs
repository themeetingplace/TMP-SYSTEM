import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toDb, fromDb } from '../js/db-mapping.js';

const platformDb = toDb.contract({
    id: 'C521',
    paymentChannel: 'platform',
    platformName: 'Airbnb'
});
assert.equal(platformDb.payment_channel, 'platform');
assert.equal(platformDb.platform_name, 'Airbnb');

const selfDb = toDb.contract({ id: 'C999', paymentChannel: 'self', platformName: '舊平台' });
assert.equal(selfDb.payment_channel, 'self');
assert.equal(selfDb.platform_name, null, '自行收款不得殘留舊平台名稱');

const platformJs = fromDb.contract({
    id: 'C521',
    payment_channel: 'platform',
    platform_name: 'Airbnb'
});
assert.equal(platformJs.paymentChannel, 'platform');
assert.equal(platformJs.platformName, 'Airbnb');

const legacyJs = fromDb.contract({ id: 'C001' });
assert.equal(legacyJs.paymentChannel, 'self', '舊合約沒有欄位時必須視為自行收款');

// 日期／時間輸入清空時必須送 null；空字串會被 Postgres date/timestamptz 拒絕，
// 並讓同一批所有租客或合約一起卡在待上傳。
const blankTenantDates = toDb.tenant({
    id: 'T019',
    name: '測試',
    lineBoundAt: '',
    idCardUploadedAt: '   ',
    idCardFallbackDeclaredAt: ''
});
assert.equal(blankTenantDates.line_bound_at, null);
assert.equal(blankTenantDates.id_card_uploaded_at, null);
assert.equal(blankTenantDates.id_card_fallback_declared_at, null);
const blankContractDates = toDb.contract({ id: 'C999', startDate: '', endDate: '', contractSentAt: '' });
assert.equal(blankContractDates.start_date, null);
assert.equal(blankContractDates.end_date, null);
assert.equal(blankContractDates.contract_sent_at, null);

// 防止未來新增 contracts 欄位卻漏掉前端雲端 mapping，造成「只有某台瀏覽器看得到」。
const schema = await readFile(new URL('../sql/NEW-PROJECT-01-schema.sql', import.meta.url), 'utf8');
const contractBlock = schema.match(/create table if not exists public\.contracts\s*\(([\s\S]*?)\n\);/i)?.[1];
assert.ok(contractBlock, '必須能讀到 contracts schema');
const serverManaged = new Set(['created_at', 'updated_at']);
const dbColumns = contractBlock
    .split(/\r?\n/)
    .map(line => line.match(/^\s{2}([a-z][a-z0-9_]*)\s+/i)?.[1])
    .filter(Boolean)
    .filter(column => !serverManaged.has(column));

const toDbKeys = new Set(Object.keys(toDb.contract({})));
dbColumns.forEach(column => {
    assert.ok(toDbKeys.has(column), `contracts.${column} 缺少 JS → DB mapping`);
});

const snakeToCamel = value => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const rawContract = Object.fromEntries(dbColumns.map(column => [column, `__${column}__`]));
const mappedContract = fromDb.contract(rawContract);
dbColumns.forEach(column => {
    const jsField = snakeToCamel(column);
    assert.equal(mappedContract[jsField], rawContract[column], `contracts.${column} 缺少 DB → JS mapping`);
});

console.log('contract cloud mapping parity checks passed');
