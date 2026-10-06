import { invoiceDueAmount, latestContractRentInvoice } from './invoicePaymentSummary.js';

const SETTLED_STATUSES = new Set(['已繳清', '已收', '已付']);

/**
 * 取得入住紀錄所屬合約的繳款摘要。
 * 同一合約若留有歷史重複帳單，只採用最新房租帳單，與合約 PDF 的金額來源一致。
 */
export function contractPaymentStatus(contractId, invoices = [], today = new Date().toISOString().slice(0, 10)) {
    const invoice = latestContractRentInvoice(invoices, contractId);
    if (!invoice) {
        return { code: 'none', label: '尚無帳單', cls: 'muted', due: 0, paid: 0, balance: 0, overdue: false, invoice: null };
    }

    const due = invoiceDueAmount(invoice);
    const recordedPaid = Math.max(0, Number(invoice.paidAmount) || 0);
    const markedSettled = SETTLED_STATUSES.has(invoice.status);
    const settled = markedSettled || due <= 0 || recordedPaid >= due;
    const paid = settled ? Math.max(recordedPaid, due) : recordedPaid;
    const balance = Math.max(0, due - paid);
    const overdue = !settled && Boolean(invoice.dueDate && invoice.dueDate < today);

    if (settled) {
        return { code: 'paid', label: '已繳清', cls: 'success', due, paid, balance: 0, overdue: false, invoice };
    }
    if (paid > 0) {
        return { code: 'partial', label: '部分繳款', cls: 'warning', due, paid, balance, overdue, invoice };
    }
    if (overdue) {
        return { code: 'overdue', label: '逾期未繳', cls: 'danger', due, paid: 0, balance, overdue: true, invoice };
    }
    return { code: 'unpaid', label: '待繳', cls: 'warning', due, paid: 0, balance, overdue: false, invoice };
}
