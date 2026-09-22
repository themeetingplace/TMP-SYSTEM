import assert from 'node:assert/strict';
import { findRenewalSuccessor, hasContractRenewed } from '../js/utils/renewalSuccessor.js';

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
    findRenewalSuccessor(oldContract, [{ ...linkedSuccessor, propertyName: '松山館 R1-B' }])?.id,
    linkedSuccessor.id,
    '明確 parentContractId 是唯一的接續關聯依據'
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
assert.equal(
    findRenewalSuccessor(oldContract, [{ ...linkedSuccessor, parentContractId: null }]),
    null,
    '同租客、同床位與相鄰日期不可推測為續約'
);
assert.equal(hasContractRenewed(oldContract, [oldContract]), false, '沒有標記或接續合約時應顯示尚未續約');
assert.equal(hasContractRenewed({ ...oldContract, renewalState: 'renewed' }, [oldContract]), true, '已標記續約時應顯示已續約');
assert.equal(hasContractRenewed(oldContract, [linkedSuccessor]), true, '已有接續合約時應顯示已續約');
assert.equal(
    hasContractRenewed(oldContract, [{ ...linkedSuccessor, parentContractId: null }]),
    false,
    '沒有明確關聯的相似合約不得顯示已續約'
);

console.log('dashboard renewal marker checks passed');
