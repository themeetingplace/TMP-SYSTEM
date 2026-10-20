// 首頁「末五碼待核對」只顯示仍可處理的帳單。
// 已結清、已核對或所屬合約已不存在的舊資料，不應繼續卡在首頁。
export function isDashboardVerificationCandidate(invoice, contractIds = null) {
    if (!invoice || invoice.direction !== 'in' || !invoice.bankLast5 || invoice.bankVerified) return false;

    const due = Math.max(0, (Number(invoice.amount) || 0) - (Number(invoice.discount) || 0));
    const paid = Math.max(0, Number(invoice.paidAmount) || 0);
    const settled = due <= 0
        || paid >= due
        || ['已繳清', '已收'].includes(invoice.status);
    if (settled) return false;

    if (invoice.contractId && contractIds instanceof Set && !contractIds.has(invoice.contractId)) return false;
    return true;
}
