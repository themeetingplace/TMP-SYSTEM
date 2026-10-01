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

function isIncludedClaim(claim) {
    return claim?.status !== 'rejected';
}

function isIncome(claim) {
    return claim?.category === 'petty_cash_income';
}

export function buildPettyCashSnapshot({ buildings = [], claims = [], buildingIds = new Set(), monthKey = '' } = {}) {
    const rows = buildings
        .filter(b => buildingIds.has(b.id) && b.status !== 'inactive')
        .map(building => {
            const buildingClaims = claims.filter(claim => claim.buildingId === building.id && isIncludedClaim(claim));
            const income = buildingClaims
                .filter(isIncome)
                .reduce((sum, claim) => sum + (Number(claim.amount) || 0), 0);
            const pettyCashSpent = buildingClaims
                .filter(claim => !isIncome(claim) && claim.fundingSource === 'petty_cash')
                .reduce((sum, claim) => sum + (Number(claim.amount) || 0), 0);
            const monthSpent = buildingClaims
                .filter(claim => !isIncome(claim)
                    && claim.fundingSource === 'petty_cash'
                    && monthKeyOf(claim.expenseDate) === monthKey)
                .reduce((sum, claim) => sum + (Number(claim.amount) || 0), 0);
            const monthExpenseTotal = buildingClaims
                .filter(claim => !isIncome(claim) && monthKeyOf(claim.expenseDate) === monthKey)
                .reduce((sum, claim) => sum + (Number(claim.amount) || 0), 0);
            const outstandingPersonal = buildingClaims
                .filter(claim => !isIncome(claim)
                    && claim.fundingSource === 'personal'
                    && claim.status !== 'reimbursed')
                .reduce((sum, claim) => sum + (Number(claim.amount) || 0), 0);
            return {
                buildingId: building.id,
                buildingName: building.name,
                income,
                pettyCashSpent,
                monthSpent,
                monthExpenseTotal,
                outstandingPersonal,
                balance: income - pettyCashSpent
            };
        });

    return {
        monthExpenseTotal: rows.reduce((sum, row) => sum + row.monthExpenseTotal, 0),
        outstandingPersonal: rows.reduce((sum, row) => sum + row.outstandingPersonal, 0),
        income: rows.reduce((sum, row) => sum + row.income, 0),
        pettyCashSpent: rows.reduce((sum, row) => sum + row.pettyCashSpent, 0),
        monthSpent: rows.reduce((sum, row) => sum + row.monthSpent, 0),
        balance: rows.reduce((sum, row) => sum + row.balance, 0),
        rows
    };
}
