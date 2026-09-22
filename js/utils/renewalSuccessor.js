// 找出舊合約對應的接續合約。
// 優先採用 parentContractId 明確指向舊合約的資料；舊資料若沒有關聯欄位，
// 才以同租客、同床位且開始日不早於舊到期日作為相容判斷。
export function findRenewalSuccessor(contract, contracts = []) {
    if (!contract) return null;

    return contracts
        .filter(other => {
            const state = other.renewalState ?? 'active';
            return other.id !== contract.id
                && other.tenant === contract.tenant
                && other.propertyName === contract.propertyName
                && (
                    other.parentContractId === contract.id
                    || (other.startDate && contract.endDate && other.startDate >= contract.endDate)
                )
                && (state === 'active' || state === 'renewed');
        })
        .sort((a, b) => {
            const aLinked = a.parentContractId === contract.id ? 1 : 0;
            const bLinked = b.parentContractId === contract.id ? 1 : 0;
            return bLinked - aLinked
                || String(a.startDate || '').localeCompare(String(b.startDate || ''));
        })[0] || null;
}
