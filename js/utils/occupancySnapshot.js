// 純資料版入住率快照：同時支援共居與代管，避免報表跨模式混入其他房屋。

function normalizedMode(mode) {
    return mode === 'managed' ? 'managed' : 'cohousing';
}

function scopedBeds(data, buildingId, mode) {
    const targetMode = normalizedMode(mode);
    const allowedBuildingIds = new Set((data.buildings || [])
        .filter(b => (b.mode || 'cohousing') === targetMode && (!buildingId || b.id === buildingId))
        .map(b => b.id));
    const beds = (data.properties || []).filter(p => allowedBuildingIds.has(p.buildingId));
    return { targetMode, allowedBuildingIds, beds };
}

function contractTypeMatches(contract, mode) {
    if (!contract.contractType) return true; // 舊資料靠 buildingId / propertyName 判斷歸屬
    return mode === 'managed'
        ? contract.contractType === 'managed-tenant'
        : contract.contractType === 'cohousing';
}

function collectOccupied(data, dateISO, buildingId, mode) {
    if (!dateISO) return { beds: [], contracts: [] };
    const { targetMode, allowedBuildingIds, beds } = scopedBeds(data, buildingId, mode);
    const bedKeys = new Set(beds.map(p => `${p.buildingId}\u0000${p.name}`));
    const bedKeysByName = new Map();
    beds.forEach(p => {
        if (!bedKeysByName.has(p.name)) bedKeysByName.set(p.name, []);
        bedKeysByName.get(p.name).push(`${p.buildingId}\u0000${p.name}`);
    });

    const byBed = new Map();
    (data.contracts || []).forEach(contract => {
        if (!contractTypeMatches(contract, targetMode)) return;
        if (contract.bundleParentContractId) return;
        if (!contract.startDate || contract.startDate > dateISO) return;
        if (contract.terminatedDate && contract.terminatedDate <= dateISO) return;
        if (contract.endDate && contract.endDate <= dateISO) return;
        if (!contract.propertyName) return;

        let bedKey = null;
        if (contract.buildingId) {
            if (!allowedBuildingIds.has(contract.buildingId)) return;
            const candidate = `${contract.buildingId}\u0000${contract.propertyName}`;
            if (bedKeys.has(candidate)) bedKey = candidate;
        } else {
            const candidates = bedKeysByName.get(contract.propertyName) || [];
            // 舊資料沒有 buildingId 時，只有名稱唯一才能安全歸館，避免同名床位跨館誤算。
            if (candidates.length === 1) bedKey = candidates[0];
        }
        if (!bedKey) return;
        if (!byBed.has(bedKey)) byBed.set(bedKey, []);
        byBed.get(bedKey).push(contract);
    });

    const contracts = [];
    byBed.forEach((list, bedKey) => {
        list.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
        const winner = { ...list[0], _occupancyBuildingId: bedKey.split('\u0000')[0] };
        if (list.length > 1) {
            winner._conflictCount = list.length;
            winner._conflictOthers = list.slice(1).map(c => ({
                id: c.id, tenant: c.tenant, startDate: c.startDate, endDate: c.endDate
            }));
        }
        contracts.push(winner);
    });
    return { beds, contracts };
}

export function calculateOccupancySnapshot(data, dateISO, buildingId = null, mode = 'cohousing') {
    const { beds, contracts } = collectOccupied(data, dateISO, buildingId, mode);
    const total = beds.length;
    const occupied = contracts.length;
    return { occupied, total, rate: total > 0 ? occupied / total : 0 };
}

export function listOccupiedContracts(data, dateISO, buildingId = null, mode = 'cohousing') {
    return collectOccupied(data, dateISO, buildingId, mode).contracts;
}
