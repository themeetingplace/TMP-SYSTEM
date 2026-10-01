function monthKeyOf(value) {
    return String(value || '').slice(0, 7);
}

function contractBuildingId(contract, properties) {
    if (contract?.buildingId) return contract.buildingId;
    return properties.find(p => p.name === contract?.propertyName)?.buildingId || null;
}

function contractBedLabel(contract, properties) {
    const property = properties.find(p => p.name === contract?.propertyName || (contract?.propertyId && p.id === contract.propertyId));
    if (property?.roomNumber != null && property?.bedLetter) return `R${property.roomNumber}-${property.bedLetter}`;
    const name = String(contract?.propertyName || property?.name || '').replace(/^\s*聚空間\s*-\s*/, '').trim();
    const roomBed = name.match(/\bR[^\s·]+$/i)?.[0];
    return roomBed || name || '未指定床位';
}

export function buildStayEvents({ contracts = [], properties = [], buildingIds = new Set(), monthKey = '' } = {}) {
    const merged = new Map();

    contracts.forEach(contract => {
        const buildingId = contractBuildingId(contract, properties);
        if (!buildingId || !buildingIds.has(buildingId)) return;

        const tenant = contract.tenant || '未填住客';
        const bed = contractBedLabel(contract, properties);
        const leaseStart = contract.startDate || '';
        const leaseEnd = contract.terminatedDate || contract.endDate || '';
        const leasePeriod = leaseStart && leaseEnd ? `${leaseStart} ～ ${leaseEnd}` : (leaseStart || leaseEnd || '未填租約期間');
        const dates = [
            { type: 'checkin', date: contract.startDate },
            { type: 'checkout', date: contract.terminatedDate || contract.endDate }
        ];

        dates.forEach(({ type, date }) => {
            if (!date || monthKeyOf(date) !== monthKey) return;
            const key = `${type}|${date}|${tenant}|${buildingId}`;
            const existing = merged.get(key) || { type, date, tenant, buildingId, beds: [], leasePeriods: [], contractIds: [] };
            if (!existing.beds.includes(bed)) existing.beds.push(bed);
            if (!existing.leasePeriods.includes(leasePeriod)) existing.leasePeriods.push(leasePeriod);
            if (contract.id && !existing.contractIds.includes(contract.id)) existing.contractIds.push(contract.id);
            merged.set(key, existing);
        });
    });

    return [...merged.values()].sort((a, b) =>
        a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.tenant.localeCompare(b.tenant)
    );
}

export function buildMonthCells(monthKey) {
    const [year, month] = String(monthKey).split('-').map(Number);
    if (!year || !month) return [];
    const days = new Date(year, month, 0).getDate();
    const offset = new Date(year, month - 1, 1).getDay();
    const cells = Array.from({ length: offset }, () => null);
    for (let day = 1; day <= days; day += 1) {
        cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    while (cells.length % 7) cells.push(null);
    return cells;
}

function invoiceSpend(invoice) {
    const paid = Number(invoice.paidAmount) || 0;
    return paid > 0 ? paid : (Number(invoice.amount) || 0);
}

export function buildPettyCashSnapshot({ buildings = [], invoices = [], pendingClaims = [], buildingIds = new Set(), monthKey = '' } = {}) {
    const rows = buildings
        .filter(b => buildingIds.has(b.id) && b.status !== 'inactive')
        .map(building => {
            const approved = invoices
                .filter(invoice => invoice.buildingId === building.id
                    && invoice.direction === 'out'
                    && invoice.paymentMethod === '零用金'
                    && monthKeyOf(invoice.paidDate || invoice.dueDate) === monthKey)
                .reduce((sum, invoice) => sum + invoiceSpend(invoice), 0);
            const pending = pendingClaims
                .filter(claim => claim.buildingId === building.id
                    && claim.fundingSource === 'petty_cash'
                    && claim.status === 'submitted'
                    && monthKeyOf(claim.expenseDate) === monthKey)
                .reduce((sum, claim) => sum + (Number(claim.amount) || 0), 0);
            const budget = Number(building.pettyCashMonthlyBudget) || 0;
            const spent = approved + pending;
            return {
                buildingId: building.id,
                buildingName: building.name,
                budget,
                approved,
                pending,
                spent,
                remaining: budget - spent
            };
        });

    return {
        budget: rows.reduce((sum, row) => sum + row.budget, 0),
        approved: rows.reduce((sum, row) => sum + row.approved, 0),
        pending: rows.reduce((sum, row) => sum + row.pending, 0),
        spent: rows.reduce((sum, row) => sum + row.spent, 0),
        remaining: rows.reduce((sum, row) => sum + row.remaining, 0),
        rows
    };
}
