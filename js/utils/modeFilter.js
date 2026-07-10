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
    // maintenance 可能有 buildingId / 完整床位 propertyName / 純館別 propertyName
    // (audit: LINE bot 建的 maintenance 只存館別如「松山館」, 沒床位路徑, 原本會被誤 filter)
    const allowedPropNames = new Set(
        mockData.properties.filter(p => ids.has(p.buildingId)).map(p => p.name)
    );
    const allowedBuildingNames = new Set(
        mockData.buildings.filter(b => ids.has(b.id)).map(b => b.name)
    );
    return maintenances.filter(m => {
        if (m.buildingId) return ids.has(m.buildingId);
        if (!m.propertyName) return true;  // 沒指定 → 顯示 (助人判斷)
        return allowedPropNames.has(m.propertyName) || allowedBuildingNames.has(m.propertyName);
    });
}

export function filterTenantsByMode(tenants, mode = getMode()) {
    const ids = currentModeBuildingIdSet(mode);
    const allowedPropNames = new Set(
        mockData.properties.filter(p => ids.has(p.buildingId)).map(p => p.name)
    );
    // 三層判斷:
    //   1. tenant.currentProperty 在此 mode → 收
    //   2. 有任何 active 合約屬於此 mode (buildingId 或 propertyName 對到) → 收
    //   3. 完全沒合約 (新建/退租過久 etc) → 看 source 或最近合約決定
    //      退而求其次: 若有任何 contract (不管 active) 屬於此 mode → 收
    //      仍判不出來 → 視為共居 (cohousing 是預設, 代管是少數)
    // (audit: 原本 !currentProperty 一律放行 → 退租/待入住租客在兩 mode 都出現, 重複混雜)
    return tenants.filter(t => {
        // 1. currentProperty 直接判
        if (t.currentProperty) return allowedPropNames.has(t.currentProperty);
        // 2. 從合約反查
        const contracts = mockData.contracts.filter(c => c.tenant === t.name);
        if (contracts.length === 0) {
            // 沒合約 — 預設只在 cohousing 顯示 (代管不顯示無合約租客)
            return mode !== 'managed';
        }
        // 拿最新 startDate 那筆判斷
        const latest = [...contracts].sort((a,b) => (b.startDate || '').localeCompare(a.startDate || ''))[0];
        if (latest.buildingId) return ids.has(latest.buildingId);
        if (latest.propertyName) return allowedPropNames.has(latest.propertyName);
        return mode !== 'managed';
    });
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
