export function resolveTenantBuildingName(tenant, { properties = [], buildings = [] } = {}) {
    const property = properties.find(item => item.name === tenant?.currentProperty);
    const linkedBuilding = property?.buildingId
        ? buildings.find(building => building.id === property.buildingId)
        : null;
    if (linkedBuilding?.name) return linkedBuilding.name;
    const propertyName = tenant?.currentProperty || '';
    return buildings.find(building => propertyName.includes(building.name))?.name || '未分類';
}

export function tenantNewestFirst(a, b) {
    const aCreated = Date.parse(a?.createdAt || a?.created_at || '');
    const bCreated = Date.parse(b?.createdAt || b?.created_at || '');
    if (Number.isFinite(aCreated) || Number.isFinite(bCreated)) {
        const safeA = Number.isFinite(aCreated) ? aCreated : 0;
        const safeB = Number.isFinite(bCreated) ? bCreated : 0;
        if (safeA !== safeB) return safeB - safeA;
    }
    const idNumber = value => Number(String(value || '').match(/\d+/)?.[0] || 0);
    return idNumber(b?.id) - idNumber(a?.id);
}
