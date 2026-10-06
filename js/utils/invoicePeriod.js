function normalizeDate(value) {
    if (!value) return '';
    return String(value).slice(0, 10);
}

/**
 * 帳款顯示期間：優先採用帳單保存的期間，舊帳單缺值時回查所屬合約。
 */
export function resolveInvoiceContractPeriod(invoice, contracts = []) {
    const contract = invoice?.contractId
        ? contracts.find(item => item.id === invoice.contractId)
        : null;
    const start = normalizeDate(invoice?.periodStart || contract?.startDate);
    const end = normalizeDate(invoice?.periodEnd || contract?.endDate);

    return {
        start,
        end,
        label: start || end ? `${start || '—'} ~ ${end || '—'}` : '未設定'
    };
}
