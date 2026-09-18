// Bundle 重複帳單歷史資料比對（純函式，方便回歸測試）。
// 沒有 bundleParentContractId 的舊資料，僅在同租客且合約起訖完全相同時才可視為同一 bundle。
export function isHistoricalBundleMatch(mainContract, candidateContract, tenantName) {
    if (!mainContract || !candidateContract) return false;
    return candidateContract.tenant === tenantName
        && candidateContract.startDate === mainContract.startDate
        && candidateContract.endDate === mainContract.endDate;
}
