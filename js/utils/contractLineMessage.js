import { invoiceDueAmount } from './invoicePaymentSummary.js';

const SETTLED_STATUSES = new Set(['已繳清', '已收', '已付']);

export function contractPaidAmount(invoice) {
    if (!invoice) return 0;
    const recordedPaid = Math.max(0, Number(invoice.paidAmount) || 0);
    if (!SETTLED_STATUSES.has(invoice.status)) return recordedPaid;
    return Math.max(recordedPaid, invoiceDueAmount(invoice));
}

export function buildContractLineMessage(contract, invoice) {
    const tenant = String(contract?.tenant || '').trim() || '租客';
    const contractId = String(contract?.id || '').trim() || '—';
    const startDate = contract?.startDate || '—';
    const endDate = contract?.endDate || '—';
    const paidAmount = contractPaidAmount(invoice);

    return `${tenant} 您好，這是您的合約 (${contractId})\n` +
        `租期：${startDate} ~ ${endDate}\n` +
        `本期已繳費用：$${paidAmount.toLocaleString()}\n\n` +
        '連結 24 小時內有效\n' +
        '請下載後填寫，完成後回傳給我們🙌🏻';
}
