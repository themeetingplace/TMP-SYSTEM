import assert from 'node:assert/strict';
import { isHistoricalBundleMatch } from '../js/utils/bundleAudit.js';

const main = { tenant: '林大鈞', startDate: '2026-09-01', endDate: '2026-10-01' };

assert.equal(isHistoricalBundleMatch(main, {
    tenant: '林大鈞', startDate: '2026-09-01', endDate: '2026-10-01'
}, '林大鈞'), true);

// 回歸：舊程式把 candidate.startDate 跟自己比較，造成不同租期也永遠成立。
assert.equal(isHistoricalBundleMatch(main, {
    tenant: '林大鈞', startDate: '2026-09-15', endDate: '2026-10-15'
}, '林大鈞'), false);

assert.equal(isHistoricalBundleMatch(main, {
    tenant: '另一位租客', startDate: '2026-09-01', endDate: '2026-10-01'
}, '林大鈞'), false);
assert.equal(isHistoricalBundleMatch(null, main, '林大鈞'), false);

console.log('bundle audit regression checks passed');
