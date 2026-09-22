// 找出舊合約對應的接續合約。
// 續約狀態屬於重要業務資料，只接受 parentContractId 明確關聯；
// 不可用同租客、同床位或相鄰日期推測，避免把重建／重複合約誤判為續約。
export function findRenewalSuccessor(contract, contracts = []) {
    if (!contract) return null;

    return contracts
        .filter(other => {
            const state = other.renewalState ?? 'active';
            return other.id !== contract.id
                && other.parentContractId === contract.id
                && (state === 'active' || state === 'renewed');
        })
        .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))[0] || null;
}

export function hasContractRenewed(contract, contracts = []) {
    return contract?.renewalState === 'renewed'
        || Boolean(findRenewalSuccessor(contract, contracts));
}
