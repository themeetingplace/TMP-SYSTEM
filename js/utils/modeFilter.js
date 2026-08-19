// 共居 / 代管 mode 資料篩選 — 提供 dashboard / reports / 跨房屋 page 使用
// 給定 mode 後，把 properties / contracts / invoices / maintenances 篩成只屬於該 mode buildings 的子集
import { mockData } from '../data.js';
import { getMode } from './appMode.js';

export function currentModeBuildingIdSet(mode = getMode()) {
    const targetMode = mode === 'managed' ? 'managed' : 'cohousing';
    let ids = new Set();
    (mockData.buildings || []).forEach(b => {
        const bm = b.mode || 'cohousing';
        if (bm === targetMode) ids.add(b.id);
    });
    // 小幫手按館別限制: window.__helperBuildings 只在 helper 角色時被設 (app.js boot)。
    //   跟 mode 的館取交集 → 全站 (物件/住房/合約/租客/房租查帳/維修/儀表板) 都只看到被指定的館。
    //   空陣列 = 看不到任何館 (用戶選定的行為)。非 helper → undefined → 不過濾。
    const helperBuildings = (typeof window !== 'undefined') ? window.__helperBuildings : undefined;
    if (Array.isArray(helperBuildings)) {
        const allowed = new Set(helperBuildings);
        ids = new Set([...ids].filter(id => allowed.has(id)));
    }
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
    // ⚠ 跟其他 filterXxxByMode 一致加 fallback — 之前這裡沒有,
    //   若 invoice.buildingId 因任何原因是 null (見 buildContractInvoice 註解),
    //   該筆帳單會在所有頁面永遠消失 (但資料庫裡其實存在), 誤導成「帳單不見了」
    const allowedPropNames = new Set(
        mockData.properties.filter(p => ids.has(p.buildingId)).map(p => p.name)
    );
    return invoices.filter(inv => {
        if (inv.buildingId) return ids.has(inv.buildingId);
        if (inv.propertyName) return allowedPropNames.has(inv.propertyName);
        // 兩者都沒有 (整館共用支出等) → 預設歸共居, 跟其他 filter function 邏輯一致
        return mode !== 'managed';
    });
}

export function filterMaintenancesByMode(maintenances, mode = getMode()) {
    const ids = currentModeBuildingIdSet(mode);
    const allowedPropNames = new Set(
        mockData.properties.filter(p => ids.has(p.buildingId)).map(p => p.name)
    );
    const allowedBuildingNames = new Set(
        mockData.buildings.filter(b => ids.has(b.id)).map(b => b.name)
    );
    // 「managed 模式」對應反面: 判斷是否屬於代管
    const oppositeMode = mode === 'managed' ? 'cohousing' : 'managed';
    const oppositePropNames = new Set(
        mockData.properties.filter(p => currentModeBuildingIdSet(oppositeMode).has(p.buildingId)).map(p => p.name)
    );
    const oppositeBuildingNames = new Set(
        mockData.buildings.filter(b => currentModeBuildingIdSet(oppositeMode).has(b.id)).map(b => b.name)
    );

    return maintenances.filter(m => {
        // 有 buildingId → 精準判斷
        if (m.buildingId) return ids.has(m.buildingId);
        // propertyName 對到本 mode 的床位/館 → 顯示
        if (m.propertyName) {
            if (allowedPropNames.has(m.propertyName) || allowedBuildingNames.has(m.propertyName)) return true;
            // 對到另一 mode → 不顯示 (避免代管房子的維修出現在共居 tab)
            if (oppositePropNames.has(m.propertyName) || oppositeBuildingNames.has(m.propertyName)) return false;
        }
        // 無法判斷歸屬 (LINE bot 舊資料如「(未指定)」「公共區/其他」, 或空 propertyName)
        // → 預設歸共居 (實務上 LINE 綁定客戶都是共居), 讓 admin 看得到
        return mode !== 'managed';
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
