import { invoiceDueAmount } from './invoicePaymentSummary.js';

function integerAmount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

// 「結帳」輸入的是本次新增入帳，不是累計入帳。
// 所有按鈕文案與拆帳都必須先加回 invoice.paidAmount，才不會把既有入帳漏掉。
export function settlementPreview(invoice, receivedThisTime) {
    const due = invoiceDueAmount(invoice);
    const alreadyPaid = integerAmount(invoice?.paidAmount);
    const received = integerAmount(receivedThisTime);
    const cumulativePaid = alreadyPaid + received;
    const outstandingBefore = Math.max(0, due - alreadyPaid);
    const remainingBalance = Math.max(0, due - cumulativePaid);

    return {
        due,
        alreadyPaid,
        receivedThisTime: received,
        cumulativePaid,
        outstandingBefore,
        remainingBalance,
        isFullySettled: due > 0 && cumulativePaid >= due
    };
}
