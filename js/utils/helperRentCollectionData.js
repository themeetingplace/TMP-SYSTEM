function dateOnly(value) {
    return String(value || '').slice(0, 10);
}

function addDays(dateText, days) {
    const d = new Date(`${dateText}T00:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function isSettled(invoice, due, paid) {
    return paid >= due || ['已繳清', '已收', '已付'].includes(invoice.status);
}

export function buildRentCollectionRows({
    invoices = [], reports = [], contracts = [], buildings = [], buildingIds = new Set(), today = new Date().toISOString().slice(0, 10)
} = {}) {
    const reportMap = new Map();
    reports
        .slice()
        .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))
        .forEach(report => {
            if (!reportMap.has(report.invoiceId)) reportMap.set(report.invoiceId, report);
        });

    const monthKey = today.slice(0, 7);
    const soonLimit = addDays(today, 14);
    const buildingMap = new Map(buildings.map(building => [building.id, building.name]));
    const contractMap = new Map(contracts.map(contract => [contract.id, contract]));

    return invoices
        .filter(invoice => invoice.direction === 'in' && buildingIds.has(invoice.buildingId) && invoice.tenant)
        .map(invoice => {
            const due = Math.max(0, (Number(invoice.amount) || 0) - (Number(invoice.discount) || 0));
            const paid = Math.max(0, Number(invoice.paidAmount) || 0);
            const remaining = Math.max(0, due - paid);
            const report = reportMap.get(invoice.id) || null;
            const settled = isSettled(invoice, due, paid);
            const dueDate = dateOnly(invoice.dueDate);
            let status = 'upcoming';
            if (settled) status = 'paid';
            else if (report?.status === 'pending') status = 'reported';
            else if (dueDate && dueDate < today) status = 'overdue';
            else if (!dueDate || dueDate <= soonLimit) status = 'due_soon';

            const contract = contractMap.get(invoice.contractId);
            const property = String(contract?.propertyName || invoice.propertyName || '')
                .replace(/^聚空間\s*-\s*/, '')
                .replace(buildingMap.get(invoice.buildingId) || '', '')
                .replace(/^\s*[·-]\s*/, '')
                .trim();
            return {
                id: invoice.id,
                contractId: invoice.contractId || '',
                tenant: invoice.tenant,
                buildingId: invoice.buildingId,
                buildingName: buildingMap.get(invoice.buildingId) || invoice.buildingId || '—',
                property: property || '未指定床位',
                type: invoice.type || '房租',
                dueDate,
                due,
                paid,
                remaining,
                paidDate: dateOnly(invoice.paidDate),
                status,
                report
            };
        })
        .filter(row => row.status !== 'paid' || row.paidDate.startsWith(monthKey) || row.dueDate.startsWith(monthKey))
        .sort((a, b) => {
            const rank = { overdue: 0, due_soon: 1, reported: 2, upcoming: 3, paid: 4 };
            return rank[a.status] - rank[b.status]
                || String(a.dueDate || '9999-12-31').localeCompare(String(b.dueDate || '9999-12-31'))
                || a.tenant.localeCompare(b.tenant);
        });
}

export function rentCollectionCounts(rows = []) {
    return rows.reduce((counts, row) => {
        counts[row.status] = (counts[row.status] || 0) + 1;
        return counts;
    }, { overdue: 0, due_soon: 0, reported: 0, upcoming: 0, paid: 0 });
}

export function rentCollectionStatusMeta(status) {
    if (status === 'overdue') return { label: '逾期未繳', icon: 'ph-warning-circle', cls: 'danger' };
    if (status === 'reported') return { label: '已回報・待核帳', icon: 'ph-hourglass-medium', cls: 'reported' };
    if (status === 'paid') return { label: '已入帳', icon: 'ph-check-circle', cls: 'paid' };
    if (status === 'due_soon') return { label: '即將到期', icon: 'ph-clock-countdown', cls: 'soon' };
    return { label: '待繳費', icon: 'ph-calendar-blank', cls: 'upcoming' };
}
