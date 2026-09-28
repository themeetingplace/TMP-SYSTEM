// 帳單付款摘要的純計算工具。
// LINE 通知、畫面顯示等既有帳單情境都應以 invoice 為唯一金額來源，
// 不可重新套用目前的租金規則，否則被取消的規則會再次加回。

function integerAmount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : 0;
}

function invoiceSequence(id) {
    const match = String(id || '').match(/(\d+)$/);
    return match ? Number(match[1]) : 0;
}

export function latestContractRentInvoice(invoices, contractId) {
    if (!contractId || !Array.isArray(invoices)) return null;
    return invoices
        .filter(invoice => invoice?.contractId === contractId && invoice.direction === 'in' && invoice.type === '房租')
        .sort((a, b) => {
            const createdDiff = (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0);
            return createdDiff || invoiceSequence(b.id) - invoiceSequence(a.id);
        })[0] || null;
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

// 合約 PDF / 合約確認頁的「最後應收」摘要。
// 有房租帳單時，帳單是管理員最後確認並保存的金額來源；不能再用月租重算覆蓋，
// 否則像 C285 這種直接調整最後應收的資料會從 9,000 被還原成 8,500。
export function contractReceivableSummary({ monthlyRent = 0, termMonths = 1, invoice = null } = {}) {
    const term = Math.max(1, integerAmount(termMonths));
    const baseTotal = integerAmount(monthlyRent) * term;
    const adjustments = invoiceAdjustments(invoice);
    const describedTotal = baseTotal + adjustments.reduce(
        (sum, item) => sum + (item.kind === 'add' ? item.amount : -item.amount),
        0
    );
    const totalAmount = invoice ? invoiceDueAmount(invoice) : Math.max(0, describedTotal);

    // 舊資料或直接編輯帳單金額時，最後應收可能沒有對應的結構化加減項。
    // 補出差額，讓 PDF 的明細算式仍能對得上最後應收。
    const unexplainedDifference = totalAmount - describedTotal;
    if (invoice && unexplainedDifference !== 0) {
        adjustments.push({
            kind: unexplainedDifference > 0 ? 'add' : 'sub',
            label: '帳單最後應收調整',
            amount: Math.abs(unexplainedDifference)
        });
    }

    return { adjustments, totalAmount, monthlyAmount: Math.round(totalAmount / term) };
}
