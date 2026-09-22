import assert from 'node:assert/strict';
import { findRenewalSuccessor } from '../js/utils/renewalSuccessor.js';

const oldContract = {
    id: 'C100',
    tenant: '測試租客',
    propertyName: '松山館 R1-A',
    startDate: '2026-08-01',
    endDate: '2026-09-01',
    renewalState: 'active'
};

const linkedSuccessor = {
    id: 'C102',
    tenant: '測試租客',
    propertyName: '松山館 R1-A',
    parentContractId: 'C100',
    startDate: '2026-09-01',
    endDate: '2026-10-01',
    renewalState: 'active'
};

assert.equal(findRenewalSuccessor(oldContract, [oldContract]), null, '沒有接續合約時不得標記');
assert.equal(
    findRenewalSuccessor(oldContract, [{ ...linkedSuccessor, propertyName: '松山館 R1-B' }]),
    null,
    '不同床位的合約不得視為接續合約'
);
assert.equal(
    findRenewalSuccessor(oldContract, [{ ...linkedSuccessor, renewalState: 'terminated' }]),
    null,
    '已終止的合約不得視為有效接續合約'
);
assert.equal(
    findRenewalSuccessor(oldContract, [{ ...linkedSuccessor, renewalState: undefined }])?.id,
    'C102',
    '舊資料未寫 renewalState 時應相容視為 active'
);
assert.equal(
    findRenewalSuccessor(oldContract, [
        { ...linkedSuccessor, id: 'C101', parentContractId: null, startDate: '2026-09-01' },
        linkedSuccessor
    ])?.id,
    'C102',
    '明確 parentContractId 關聯應優先於日期推測'
);

console.log('dashboard renewal marker checks passed');
