// 帳單付款摘要的純計算工具。
// LINE 通知、畫面顯示等既有帳單情境都應以 invoice 為唯一金額來源，
// 不可重新套用目前的租金規則，否則被取消的規則會再次加回。

function integerAmount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : 0;
}

export function invoiceDueAmount(invoice) {
    if (!invoice) return 0;
    return Math.max(0, integerAmount(invoice.amount) - integerAmount(invoice.discount));
}

export function invoiceAdjustments(invoice) {
    if (!invoice) return [];

    let parsed = [];
    const rawReason = typeof invoice.discountReason === 'string'
        ? invoice.discountReason.trim()
        : '';

    if (rawReason.startsWith('[')) {
        try {
            const value = JSON.parse(rawReason);
            if (Array.isArray(value)) parsed = value;
        } catch {}
    }

    const items = parsed
        .filter(item => item && (item.kind === 'add' || item.kind === 'sub'))
        .map(item => ({
            kind: item.kind,
            label: String(item.label || '帳務調整'),
            amount: Math.abs(integerAmount(item.amount))
        }))
        .filter(item => item.amount > 0);

    // discount > 0 代表折扣，discount < 0 代表加收。
    // 舊資料可能只有 discount 或原因不是 JSON；補一筆差額，確保細項、算式與應收相符。
    const invoiceDiscount = integerAmount(invoice.discount);
    const describedDiscount = items.reduce(
        (sum, item) => sum + (item.kind === 'sub' ? item.amount : -item.amount),
        0
    );
    const undisclosedDiscount = invoiceDiscount - describedDiscount;

    if (undisclosedDiscount !== 0) {
        items.push({
            kind: undisclosedDiscount > 0 ? 'sub' : 'add',
            label: rawReason && !rawReason.startsWith('[') ? rawReason : '其他帳務調整',
            amount: Math.abs(undisclosedDiscount)
        });
    }

    return items;
}
