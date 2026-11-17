import assert from 'node:assert/strict';
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

console.log('contract payment-channel cloud mapping checks passed');
