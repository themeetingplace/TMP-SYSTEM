// 共居 / 代管 mode 資料篩選 — 提供 dashboard / reports / 跨房屋 page 使用
// 給定 mode 後，把 properties / contracts / invoices / maintenances 篩成只屬於該 mode buildings 的子集
import { mockData } from '../data.js';
import { getMode } from './appMode.js';

export function currentModeBuildingIdSet(mode = getMode()) {
    const targetMode = mode === 'managed' ? 'managed' : 'cohousing';
    const ids = new Set();
    (mockData.buildings || []).forEach(b => {
        const bm = b.mode || 'cohousing';
        if (bm === targetMode) ids.add(b.id);
    });
    return ids;
}

export function filterPropertiesByMode(properties, mode = getMode()) {
    const ids = currentModeBuildingIdSet(mode);
    return properties.filter(p => ids.has(p.buildingId));
}

export function filterContractsByMode(contracts, mode = getMode()) {
    const ids = currentModeBuildingIdSet(mode);
    // 統一邏輯: 優先用 buildingId (一致 source of truth)
    // 若 contract.buildingId 缺 (舊資料) → 退而靠 propertyName 反查 (給 cohousing 用)
    // (audit: 原本代管 contract 走 buildingId、共居 contract 走 propertyName 兩條 path 不對稱
    //   propertyName 改名後孤兒合約會被誤過濾, 用 buildingId 主導比較穩)
    const allowedPropNames = new Set(
        mockData.properties.filter(p => ids.has(p.buildingId)).map(p => p.name)
    );
    return contracts.filter(c => {
        if (c.buildingId) return ids.has(c.buildingId);
        // fallback: 沒 buildingId 的舊合約靠 propertyName 反查
        return allowedPropNames.has(c.propertyName);
    });
}

export function filterInvoicesByMode(invoices, mode = getMode()) {
    const ids = currentModeBuildingIdSet(mode);
    return invoices.filter(inv => ids.has(inv.buildingId));
}

export function filterMaintenancesByMode(maintenances, mode = getMode()) {
    const ids = currentModeBuildingIdSet(mode);
    // maintenance 可能有 buildingId 或只有 propertyName
    const allowedPropNames = new Set(
        mockData.properties.filter(p => ids.has(p.buildingId)).map(p => p.name)
    );
    return maintenances.filter(m => {
        if (m.buildingId) return ids.has(m.buildingId);
        return allowedPropNames.has(m.propertyName);
    });
}

export function filterTenantsByMode(tenants, mode = getMode()) {
    const ids = currentModeBuildingIdSet(mode);
    // tenant 沒 buildingId，靠 currentProperty 反查
    const allowedPropNames = new Set(
        mockData.properties.filter(p => ids.has(p.buildingId)).map(p => p.name)
    );
    return tenants.filter(t => !t.currentProperty || allowedPropNames.has(t.currentProperty));
}

// 一次性回傳所有 filtered 子集 (給 dashboard / reports 用方便)
export function modeFilteredData(mode = getMode()) {
    return {
        mode,
        properties:   filterPropertiesByMode(mockData.properties, mode),
        contracts:    filterContractsByMode(mockData.contracts, mode),
        invoices:     filterInvoicesByMode(mockData.invoices, mode),
        maintenances: filterMaintenancesByMode(mockData.maintenances, mode),
        tenants:      filterTenantsByMode(mockData.tenants, mode)
    };
}
