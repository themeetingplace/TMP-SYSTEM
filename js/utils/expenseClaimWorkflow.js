export function isExpenseIncome(claim) {
    return claim?.category === 'petty_cash_income';
}

function completedMethod(claim) {
    if (claim?.settlementMethod) return claim.settlementMethod;
    if (isExpenseIncome(claim)) return 'income_confirmed';
    if (claim?.fundingSource === 'petty_cash') return 'petty_cash';
    return 'paid';
}

export function expenseClaimStatusMeta(claim) {
    if (claim?.status === 'submitted') return { stage: 'review', label: '待審核', cls: 'warning', icon: 'ph-magnifying-glass' };
    if (claim?.status === 'approved') return { stage: 'action', label: '待處理', cls: 'info', icon: 'ph-clock-countdown' };
    if (claim?.status === 'rejected') return { stage: 'rejected', label: '已退回', cls: 'danger', icon: 'ph-arrow-u-up-left' };

    const method = completedMethod(claim);
    const completed = {
        rent_deduction:  { label: '從房費扣除', icon: 'ph-house-line' },
        petty_cash:      { label: '零用金已支出', icon: 'ph-coins' },
        income_confirmed:{ label: '收入已確認', icon: 'ph-money' },
        paid:            { label: '已付款', icon: 'ph-check-circle' }
    }[method] || { label: '已完成', icon: 'ph-check-circle' };
    return { stage: 'completed', label: completed.label, cls: 'success', icon: completed.icon, method };
}

export function expenseReviewerActions(claim) {
    if (claim?.status === 'submitted') return ['approve', 'reject'];
    if (claim?.status !== 'approved') return [];
    if (isExpenseIncome(claim)) return ['confirm', 'reject'];
    if (claim?.fundingSource === 'petty_cash') return ['confirm', 'reject'];
    if (claim?.fundingSource === 'personal') return ['pay', 'rent_deduction', 'reject'];
    return ['pay', 'reject'];
}

export function expenseClaimMatchesFilter(claim, filter) {
    if (filter === 'all') return true;
    const stage = expenseClaimStatusMeta(claim).stage;
    if (filter === 'pending') return stage === 'review' || stage === 'action';
    return stage === filter;
}
