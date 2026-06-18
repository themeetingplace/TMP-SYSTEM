import { mockData, store, formatRoomType, getSortedBuildings, addDaysISO, activeContractFor, activeContractOfTenant, findOverlappingBedContracts, findOverlappingTenantContracts, bedOccupied } from '../data.js';
import { escapeHtml as esc } from '../utils/escape.js';
import { openFormModal, openConfirm, openDetailModal, showToast, showUndoToast, refreshView, initCustomSelects } from '../utils/ui.js';
import { showTenantDetails } from './tenants.js';
import { filterPropertiesByMode } from '../utils/modeFilter.js';
import { getMode } from '../utils/appMode.js';

const PROPERTY_STATUSES = ['已出租', '待租', '待簽約'];
const NAME_PREFIX = '聚空間 - ';

// 點表頭排序 (跟合約/帳務用同樣的 caret 風格)
const PROP_SORT_COLS = {
    info:    { cmp: (a, b) => {
        // 預設順序：館 → 房號 → 床位
        const ba = a.buildingId || '', bb = b.buildingId || '';
        if (ba !== bb) return ba.localeCompare(bb);
        const ra = Number(a.roomNumber ?? 999), rb = Number(b.roomNumber ?? 999);
        if (ra !== rb) return ra - rb;
        return (a.bedLetter || '').localeCompare(b.bedLetter || '');
    } },
    status:  { cmp: (a, b) => {
        const order = { '待租': 0, '待簽約': 1, '已出租': 2 };
        return (order[a.status] ?? 99) - (order[b.status] ?? 99);
    } },
    rent:    { cmp: (a, b) => (a.rent ?? -1) - (b.rent ?? -1) },
    tenant:  { cmp: (a, b) => (a.tenant || '').localeCompare(b.tenant || '', 'zh-Hant') },
    end:     { cmp: (a, b) => (a.contractEnd || '9999').localeCompare(b.contractEnd || '9999') },
};
const PROP_SORT_KEY = 'bms-properties-sort';
function getPropSort() {
    const raw = localStorage.getItem(PROP_SORT_KEY) || '';
    const [col, dir] = raw.split('-');
    if (PROP_SORT_COLS[col] && (dir === 'asc' || dir === 'desc')) return { col, dir };
    return { col: '', dir: '' };
}
function propSortArrow(thisCol, current) {
    const isActive = current.col === thisCol;
    const icon = isActive ? (current.dir === 'desc' ? 'ph-caret-down' : 'ph-caret-up') : 'ph-caret-up-down';
    const opacity = isActive ? 1 : 0.35;
    const color = isActive ? 'color: var(--color-warning);' : '';
    return `<span style="display: inline-block; width: 1.1em; text-align: center; margin-left: 3px; opacity: ${opacity}; ${color}"><i class="ph ${icon}" style="font-size: var(--text-2xs); vertical-align: middle;"></i></span>`;
}

// 把「聚空間 - 松山館 R1-A」拆成 { area: '松山館', bed: 'R1-A' }
function parsePropertyName(name) {
    const m = name.match(/^聚空間\s*[-–]\s*(\S+)\s+(.+)$/);
    if (m) return { area: m[1], bed: m[2] };
    return { area: name, bed: '' };
}

function composeName(area, bed) {
    return `${NAME_PREFIX}${(area || '').trim()} ${(bed || '').trim()}`.trim();
}

function buildAreaStats(properties) {
    const stats = {};
    properties.forEach(p => {
        const { area } = parsePropertyName(p.name);
        if (!stats[area]) stats[area] = { total: 0, vacant: 0 };
        stats[area].total++;
        // 「床位上有名字 = 居住」對齊 (2026-06-16)
        if (!bedOccupied(p.name)) stats[area].vacant++;
    });
    return stats;
}

// 各館的代表地址（取每個館最常見的地址當預設）
function buildAreaAddressMap(properties) {
    const counter = {};
    properties.forEach(p => {
        const { area } = parsePropertyName(p.name);
        if (!area || !p.address) return;
        if (!counter[area]) counter[area] = {};
        counter[area][p.address] = (counter[area][p.address] || 0) + 1;
    });
    const map = {};
    Object.entries(counter).forEach(([area, addrCounts]) => {
        map[area] = Object.entries(addrCounts).sort((a, b) => b[1] - a[1])[0][0];
    });
    return map;
}

function statusClassOf(status) {
    if (status === '已出租') return 'success';
    if (status === '待租') return 'warning';
    if (status === '待簽約') return 'info';
    return 'primary';
}

export function renderProperties() {
    // 排序：點表頭切換 / 預設依「館 → 房號 → 床位」
    const currentSort = getPropSort();
    const sortedKey = currentSort.col || 'info';
    const baseCmp = PROP_SORT_COLS[sortedKey].cmp;
    const cmp = currentSort.dir === 'desc' ? (a, b) => -baseCmp(a, b) : baseCmp;
    // 跟 mode 切開：共居 mode 只顯示 cohousing buildings 的床位，代管同理
    const properties = filterPropertiesByMode(mockData.properties).slice().sort(cmp);

    const totalProperties = properties.length;
    // 三段互斥分類，跟 effectiveStatus 對齊：
    //   已出租 = bedOccupied (床位已入住，不管 p.status)
    //   待簽約 = !bedOccupied 且 p.status==='待簽約' (簽約中但還沒住)
    //   待租   = 其餘 (含 p.status='已出租' 但無 active 合約 = 髒資料)
    const rentedCount = properties.filter(p => bedOccupied(p.name)).length;
    const pendingCount = properties.filter(p => !bedOccupied(p.name) && p.status === '待簽約').length;
    const vacantCount = totalProperties - rentedCount - pendingCount;
    const totalVacant = vacantCount + pendingCount;

    const areaStats = buildAreaStats(properties);
    // 用系統設定的館別順序（id 升冪），未出現在 buildings 的 area 排最後
    const sortedAreaList = getSortedBuildings({ activeOnly: true }).map(b => b.name);
    const areaNames = [
        ...sortedAreaList.filter(n => areaStats[n]),
        ...Object.keys(areaStats).filter(n => !sortedAreaList.includes(n))
    ];

    const tableRows = properties.map(p => {
        // effectiveStatus: 三段互斥 → 對齊 rentedCount/pendingCount/vacantCount
        const occupied = bedOccupied(p.name);
        const effectiveStatus = occupied
            ? '已出租'
            : (p.status === '待簽約' ? '待簽約' : '待租');
        const statusClass = statusClassOf(p.status);
        const { area, bed } = parsePropertyName(p.name);
        const building = mockData.buildings.find(b => b.id === p.buildingId);
        const displayArea = building?.name || area;
        const displayBed = (p.roomNumber && p.bedLetter) ? `R${p.roomNumber}-${p.bedLetter}` : bed;
        const roomTypeBadge = (p.gender && p.capacity)
            ? `<span style="font-size: var(--text-2xs); color: var(--text-muted); margin-top: 2px;">${formatRoomType(p.gender, p.capacity)}</span>`
            : '';
        const tenantObj = p.tenant ? mockData.tenants.find(t => t.name === p.tenant) : null;
        const tenantCell = p.tenant
            ? (tenantObj
                ? `<button class="tenant-link" data-tenant-id="${esc(tenantObj.id)}" title="查看租客資料">${esc(p.tenant)}</button>`
                : `<strong>${esc(p.tenant)}</strong> <span style="font-size: var(--text-2xs); color: var(--text-muted);">(查無對應租客)</span>`)
            : '<span style="color: var(--text-muted)">--</span>';

        const contractCell = p.contractId
            ? `<div style="display: flex; flex-direction: column;">
                    <strong style="font-size: var(--text-base);">${p.contractId}</strong>
                    <span style="font-size: var(--text-xs); color: var(--text-muted);">${p.contractEnd ? '到期 ' + p.contractEnd : '未定到期日'}</span>
               </div>`
            : (p.contractEnd
                ? `<span style="font-weight: 500;">${p.contractEnd}</span>`
                : '<span style="color: var(--text-muted)">--</span>');

        const searchText = [p.name, p.address, p.tenant || '', p.id, area, bed, p.contractId || ''].join(' ').toLowerCase();

        return `
            <tr data-row-id="${p.id}" data-status="${effectiveStatus}" data-area="${displayArea}" data-search="${searchText}">
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <strong style="font-size: var(--text-base);">${displayArea}</strong>
                        <span style="font-size: var(--text-xs); color: var(--text-main);">床位 ${displayBed}</span>
                        ${roomTypeBadge}
                    </div>
                </td>
                <td><span class="status-badge ${statusClassOf(effectiveStatus)}">${effectiveStatus}</span></td>
                <td>
                    <div style="font-size: var(--text-base); font-weight: 500;">${p.rent != null ? '$' + p.rent.toLocaleString() : '<span style="color: var(--text-muted)">—</span>'}</div>
                    <div style="font-size: var(--text-xs); color: var(--text-muted);">每月租金</div>
                </td>
                <td>${tenantCell}</td>
                <td>${contractCell}</td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-outline action-btn" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" data-action="view" data-property-id="${p.id}" title="查看詳情">
                            <i class="ph ph-eye"></i>
                        </button>
                        <button class="btn btn-outline action-btn" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" data-action="edit" data-property-id="${p.id}" title="編輯床位">
                            <i class="ph ph-pencil"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    const areaTabs = `
        <button class="area-filter-btn active" data-filter-value="all" data-filter-group="area">
            <span class="area-name">全部館別</span>
            <span class="area-stats">空 ${totalVacant} / 共 ${totalProperties}</span>
        </button>
        ${areaNames.map(name => {
            const { total, vacant } = areaStats[name];
            const fullCls = vacant === 0 ? 'is-full' : '';
            return `
                <button class="area-filter-btn ${fullCls}" data-filter-value="${name}" data-filter-group="area">
                    <span class="area-name">${name}</span>
                    <span class="area-stats">空 ${vacant} / 共 ${total}</span>
                </button>
            `;
        }).join('')}
    `;

    return `
        <div class="metrics-grid">
            <div class="card metric-card">
                <div class="metric-header"><span>總床位數</span><div class="metric-icon primary"><i class="ph ph-buildings"></i></div></div>
                <div class="metric-value">${totalProperties}</div>
                <div class="metric-subtext">管理中的床位總數</div>
            </div>
            <div class="card metric-card">
                <div class="metric-header"><span>已出租</span><div class="metric-icon success"><i class="ph ph-house-line"></i></div></div>
                <div class="metric-value">${rentedCount}</div>
                <div class="metric-subtext">出租率 ${totalProperties > 0 ? Math.round(rentedCount / totalProperties * 100) : 0}%</div>
            </div>
            <div class="card metric-card">
                <div class="metric-header"><span>空床中</span><div class="metric-icon warning"><i class="ph ph-house"></i></div></div>
                <div class="metric-value">${totalVacant}</div>
                <div class="metric-subtext">待租 ${vacantCount} · 待簽約 ${pendingCount}</div>
            </div>
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-house-line"></i> 物件管理</h2>
                <div class="flex gap-2">
                    <div class="search-bar" style="width: 250px;">
                        <i class="ph ph-magnifying-glass"></i>
                        <input type="text" placeholder="搜尋館別、床位、租客或合約..." style="font-size: var(--text-base);">
                    </div>
                    <button class="btn btn-primary" id="btn-new-checkin-assign" data-fab="ph-key">
                        <i class="ph ph-key"></i> 新增入住
                    </button>
                </div>
            </div>

            <!-- 館別篩選 -->
            <div class="area-filter-row mb-4">
                ${areaTabs}
            </div>

            <!-- 狀態篩選 -->
            <div class="filter-tabs mb-4">
                <button class="filter-tab active" data-filter-value="all" data-filter-group="status">全部 (${totalProperties})</button>
                <button class="filter-tab" data-filter-value="已出租" data-filter-group="status">已出租 (${rentedCount})</button>
                <button class="filter-tab" data-filter-value="待租" data-filter-group="status">待租 (${vacantCount})</button>
                <button class="filter-tab" data-filter-value="待簽約" data-filter-group="status">待簽約 (${pendingCount})</button>
            </div>

            <div class="table-container">
                <table class="data-table" style="table-layout: fixed;">
                    <colgroup>
                        <col style="width: 22%;">
                        <col style="width: 12%;">
                        <col style="width: 13%;">
                        <col style="width: 20%;">
                        <col style="width: 18%;">
                        <col style="width: 15%;">
                    </colgroup>
                    <thead>
                        <tr>
                            <th class="sortable-col" data-sort-col="info" title="點擊排序">物件資訊 ${propSortArrow('info', currentSort)}</th>
                            <th class="sortable-col" data-sort-col="status" title="點擊排序">狀態 ${propSortArrow('status', currentSort)}</th>
                            <th class="sortable-col" data-sort-col="rent" title="點擊排序">租金 ${propSortArrow('rent', currentSort)}</th>
                            <th class="sortable-col" data-sort-col="tenant" title="點擊排序">目前租客 ${propSortArrow('tenant', currentSort)}</th>
                            <th class="sortable-col" data-sort-col="end" title="點擊排序">合約 ${propSortArrow('end', currentSort)}</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>

            <div class="pagination-container" style="display: flex; justify-content: center; margin-top: 2rem;">
                <div class="pagination">
                    <button class="btn btn-outline" disabled><i class="ph ph-caret-left"></i></button>
                    <span class="pagination-info">第 1 頁，共 1 頁</span>
                    <button class="btn btn-outline" disabled><i class="ph ph-caret-right"></i></button>
                </div>
            </div>
        </div>
    `;
}

export function showPropertyForm(property = null, preset = null, options = {}) {
    const isEdit = !!property;
    // structuralOnly: true → 只顯示結構欄位（館別/房間/字母/性別/人數/租金）
    // 用於「系統設定 → 館別 → 房間/床位」的編輯（不該管租客/合約/狀態）
    const structuralOnly = !!options.structuralOnly;
    const tenantOptions = mockData.tenants.map(t => t.name);
    const contractSuggestions = mockData.contracts.map(c => c.id);

    // 館別下拉：啟用中的；若編輯的是停用館別也要包含進去（以免顯示空白）
    const activeBuildings = getSortedBuildings({ activeOnly: true });
    const buildingOptions = activeBuildings.map(b => ({ value: b.id, label: b.name }));
    if (isEdit && property.buildingId && !activeBuildings.find(b => b.id === property.buildingId)) {
        const inactive = mockData.buildings.find(b => b.id === property.buildingId);
        if (inactive) buildingOptions.push({ value: inactive.id, label: `${inactive.name}（已停用）` });
    }

    const initialBuildingId = property?.buildingId || preset?.buildingId || activeBuildings[0]?.id || '';
    const initialBedLetter = property?.bedLetter || preset?.bedLetter || '';
    const initialRoomNumber = property?.roomNumber ?? preset?.roomNumber ?? '';

    // 結構性欄位（新增/編輯都顯示）
    // 註：性別/人數屬於「房間」層級（不在床位層編輯），請至「編輯房間」修改
    const structuralFields = [
        { name: 'buildingId', label: '館別', type: 'select', required: true, options: buildingOptions, value: initialBuildingId },
        { name: 'roomNumber', label: '房間編號 (R 後面的數字)', type: 'number', required: true, placeholder: '例：1 → R1', value: initialRoomNumber },
        { name: 'bedLetter', label: '床位字母', type: 'text', required: true, placeholder: '例：A', value: initialBedLetter, hint: '單一英文大寫字母 (A/B/C/D ...)' },
        { name: 'rent', label: '每月租金', type: 'number', required: true, placeholder: '例：18000' }
    ];

    // 出租/合約相關欄位 — 只顯示「狀態」（其他由合約管理自動同步，避免人工編輯造成不一致）
    const occupancyFields = [
        { name: 'status', label: '狀態', type: 'select', required: true, options: PROPERTY_STATUSES, value: property?.status ?? '待租', span: 2, hint: '租客 / 合約資訊請於「合約管理」修改，這裡不再人工編輯' }
    ];

    openFormModal({
        title: isEdit ? `編輯床位：${property.name}` : '新增床位',
        maxWidth: 720,
        fields: (isEdit && !structuralOnly) ? [...structuralFields, ...occupancyFields] : structuralFields,
        values: {
            ...(property ?? {}),
            buildingId: initialBuildingId,
            roomNumber: initialRoomNumber,
            bedLetter: initialBedLetter
        },
        submitLabel: isEdit ? '儲存變更' : '建立',
        onFormMount: (form) => {
            // 字母自動轉大寫
            const bedLetterInput = form.querySelector('[name="bedLetter"]');
            bedLetterInput.addEventListener('blur', () => {
                bedLetterInput.value = bedLetterInput.value.trim().toUpperCase().slice(0, 1);
            });
        },
        onSubmit: (values) => {
            const building = mockData.buildings.find(b => b.id === values.buildingId);
            if (!building) {
                showToast('請選擇有效的館別', 'danger');
                return false;
            }
            const letter = (values.bedLetter || '').toUpperCase();
            if (!/^[A-Z]$/.test(letter)) {
                showToast('床位字母必須是單一英文字母 (A-Z)', 'danger');
                return false;
            }
            const dup = mockData.properties.find(p =>
                p.buildingId === values.buildingId &&
                p.roomNumber === values.roomNumber &&
                p.bedLetter === letter &&
                p.id !== property?.id
            );
            if (dup) {
                showToast(`床位「${building.name} R${values.roomNumber}-${letter}」已存在`, 'danger');
                return false;
            }

            const name = `聚空間 - ${building.name} R${values.roomNumber}-${letter}`;
            const address = building.baseAddress || property?.address || '';

            // 性別 / 人數從同房間繼承（找出同 building+roomNumber 的其他床位）
            // 優先順序：preset > 同房 sibling > property 自己的 > 預設
            const sibling = mockData.properties.find(p =>
                p.buildingId === values.buildingId &&
                p.roomNumber === values.roomNumber &&
                p.id !== property?.id
            );
            const inheritedGender = preset?.gender || sibling?.gender || property?.gender || '男';
            const inheritedCapacity = preset?.capacity || sibling?.capacity || property?.capacity || 4;

            // structuralOnly：保留 property 既有的 occupancy 資料、只更新結構
            const showOccupancy = isEdit && !structuralOnly;
            // tenant / contractId / contractEnd 永遠繼承既有值 — 由合約管理操作維護，這裡不動
            const payload = {
                buildingId: values.buildingId,
                roomNumber: values.roomNumber,
                bedLetter: letter,
                gender: inheritedGender,
                capacity: inheritedCapacity,
                name,
                address,
                rent: values.rent,
                status: showOccupancy ? values.status : (property?.status ?? '待租'),
                tenant: property?.tenant ?? null,
                contractId: property?.contractId ?? null,
                contractEnd: property?.contractEnd ?? null
            };

            if (isEdit) {
                store.updateProperty(property.id, payload);
                showToast(`已更新：${name}`, 'success');
            } else {
                const created = store.addProperty(payload);
                showToast(`已新增床位：${created.name}`, 'success');
            }
            refreshView();
        }
    });
}

export function showPropertyDetails(propertyId) {
    const p = mockData.properties.find(x => x.id === propertyId);
    if (!p) return;
    const { area, bed } = parsePropertyName(p.name);
    const statusClass = statusClassOf(p.status);
    const tenantObj = p.tenant ? mockData.tenants.find(t => t.name === p.tenant) : null;
    const tenantValue = tenantObj
        ? `<button class="tenant-link" data-tenant-id="${tenantObj.id}">${p.tenant}</button>`
        : (p.tenant || '無');

    const building = mockData.buildings.find(b => b.id === p.buildingId);
    const roomTypeDisplay = (p.gender && p.capacity)
        ? formatRoomType(p.gender, p.capacity)
        : '<span style="color: var(--text-muted)">未設定</span>';

    openDetailModal({
        title: '床位詳細資訊',
        items: [
            { label: '床位編號', value: p.id },
            { label: '館別', value: building?.name || area },
            { label: '房間 / 床位', value: `R${p.roomNumber ?? '?'}-${p.bedLetter || bed}` },
            { label: '房型', value: roomTypeDisplay },
            { label: '地址', value: p.address },
            { label: '狀態', value: `<span class="status-badge ${statusClass}">${p.status}</span>` },
            { label: '租金', value: p.rent != null ? `$${p.rent.toLocaleString()} / 月` : '未設定' },
            { label: '目前租客', value: tenantValue },
            { label: '合約編號', value: p.contractId || '無' },
            { label: '合約到期日', value: p.contractEnd || '無' }
        ]
    });

    // 詳情 modal 內的租客連結也要能點
    document.querySelectorAll('.modal-overlay .tenant-link').forEach(btn => {
        btn.addEventListener('click', () => {
            const tid = btn.dataset.tenantId;
            if (tid) showTenantDetails(tid);
        });
    });
}

// === 新增入住：把現有空床指派給租客 ===
// opts.preselectBedId: 已知床位 → 跳過館別/床位選擇，直接選租客 + 日期
export function showCheckinAssignmentForm(opts = {}) {
    const activeBuildings = getSortedBuildings({ activeOnly: true });
    const buildingOptions = activeBuildings.map(b => ({ value: b.id, label: b.name }));
    // 只列「目前沒有 active 合約」的租客 — 避免一人多床
    const tenantOptions = mockData.tenants
        .filter(t => !activeContractOfTenant(t.name))
        .map(t => ({ value: t.id, label: `${t.name}（${t.phone}）` }));
    const todayStr = new Date().toISOString().split('T')[0];

    // 取得指定館別內可入住的床位（待租 / 待簽約）
    function getAvailableBeds(buildingId) {
        if (!buildingId) return [];
        return mockData.properties
            .filter(p => p.buildingId === buildingId)
            .sort((a, b) => (a.roomNumber - b.roomNumber) || (a.bedLetter || '').localeCompare(b.bedLetter || ''))
            .map(p => {
                const active = activeContractFor(p.name);
                const statusTag = active
                    ? ` · ⚠ ${active.tenant}住至${active.endDate}`
                    : ' · 空床';
                return {
                    value: p.id,
                    label: `R${p.roomNumber}-${p.bedLetter} · $${(p.rent || 0).toLocaleString()}${statusTag}`
                };
            });
    }

    // 預選床位：直接拿床位資料、跳過 building/bed select
    const preselectBed = opts.preselectBedId
        ? mockData.properties.find(p => p.id === opts.preselectBedId)
        : null;
    const preselectBuilding = preselectBed
        ? mockData.buildings.find(b => b.id === preselectBed.buildingId)
        : null;

    const initialBuildingId = preselectBed?.buildingId || activeBuildings[0]?.id || '';

    // 床位欄位（預選時跳過 building/bed select，但仍可加額外床位）
    // bedHeader = 入住床位摘要 banner (永遠顯示在 form-grid 第一列，span 2 撐滿整列)
    const bedFields = preselectBed ? [
        { name: 'bedHeader', type: 'placeholder', span: 2 },
        { name: 'extraBeds', type: 'placeholder', span: 2 },
        { name: 'extraBedIds', type: 'hidden', value: '[]' }
    ] : [
        { name: 'buildingId', label: '館別', type: 'select', required: true, options: buildingOptions, value: initialBuildingId },
        { name: 'bedId', label: '床位', type: 'select', required: true, options: getAvailableBeds(initialBuildingId), placeholder: getAvailableBeds(initialBuildingId).length ? '請選擇床位' : '此館目前無空床' },
        { name: 'extraBeds', type: 'placeholder', span: 2 },
        { name: 'extraBedIds', type: 'hidden', value: '[]' }
    ];
    // 租客資訊 — 永遠顯示完整欄位；輸入姓名/電話會自動跳出舊客建議
    const sourceOptions = (mockData.tenantSources || []).map(s => ({ value: s.name, label: s.name }));
    const defaultSource = sourceOptions[0]?.value || '';
    const tenantFields = [
        { name: 'source', label: '顧客來源', type: 'select', required: true, span: 2, options: sourceOptions, value: defaultSource },
        { name: 'tenantName', label: '姓名', type: 'text', required: true, span: 2, placeholder: '輸入姓名搜尋舊資料 / 或輸入新姓名' },
        { name: 'tenantPhone', label: '電話', type: 'text', required: false, placeholder: '輸入電話搜尋舊資料' },
        { name: 'tenantEmail', label: 'Email', type: 'text', required: false, placeholder: '選填' },
        { name: 'tenantEmergency', label: '緊急聯絡人', type: 'text', required: false, placeholder: '例：王媽媽 0911-222-333', span: 2 }
    ];
    // 依入住日期算合約期 dropdown 標籤，例如「1 個月 · 7/15 到期」
    function buildTermOptions(startDate) {
        const fmt = (iso) => iso ? iso.slice(5).replace('-', '/') : '?';
        const end1 = startDate ? addDaysISO(startDate, 30) : '';
        const end3 = startDate ? addDaysISO(startDate, 90) : '';
        return [
            { value: '1', label: `1 個月${end1 ? ` · ${fmt(end1)} 到期` : ''}` },
            { value: '3', label: `3 個月${end3 ? ` · ${fmt(end3)} 到期` : ''}` }
        ];
    }

    // 合約欄位（共用）
    const contractFields = [
        { name: 'scheduledDate', label: '入住日期 (= 合約起始日)', type: 'date', required: true, value: todayStr },
        { name: 'termMonths', label: '合約期', type: 'select', required: true, options: buildTermOptions(todayStr), value: '1' },
        { name: 'amount', label: '月租金', type: 'number', required: true, value: preselectBed?.rent || 0, span: 2, hint: '會自動帶床位設定的租金，可調整' }
    ];
    // 收款欄位 — 收費對象拉到收款步驟頂端
    const paymentFields = [
        { name: 'paymentChannel', label: '收費對象', type: 'select', required: true, value: 'self', span: 2,
          options: [
              { value: 'self',     label: '建立帳單' },
              { value: 'platform', label: '外部平台代收' }
          ] },
        { name: 'platformName', label: '平台名稱', type: 'text', span: 2, placeholder: '例：Airbnb / 591 / KKday', hint: '收費對象選「外部平台代收」時填' },
        { name: '__sep_payment', label: '收款記錄', type: 'section', hint: '依實際收款狀況填寫，未填視為未收' },
        { name: 'adjustments', type: 'placeholder' },  // 加減項目子表單
        { name: 'discount', type: 'hidden', value: 0 },           // 自動計算：net (sub − add)
        { name: 'discountReason', type: 'hidden', value: '' },    // 自動編碼: JSON of adjustments
        { name: 'totalDue', label: '應收總額', type: 'number', value: '', span: 2, hint: '月租金 × 合約期 + 加項 − 折扣（自動計算）' },
        { name: 'paidAmount', label: '已收金額', type: 'number', hint: '留空或 0 = 未收；全額收訖請填全部金額' },
        { name: 'paymentMethod', label: '付款方式', type: 'select', options: (mockData.paymentMethods || []).map(p => ({ value: p.name, label: p.name })), value: (mockData.paymentMethods || [])[0]?.name || '匯款' }
    ];
    const fields = [...bedFields, ...tenantFields, ...contractFields, ...paymentFields];

    // 預測下一個合約編號（純顯示用，實際 ID 在 store.addContract 才正式產）
    const predictedContractId = (() => {
        let max = 0;
        mockData.contracts.forEach(c => {
            const m = String(c.id || '').match(/^C(\d+)$/);
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        return `C${String(max + 1).padStart(3, '0')}`;
    })();

    // bed-header banner 改成 form-grid 內部 placeholder 渲染 (span 2 撐滿整列)，不再用 headerHtml
    const headerHtml = '';

    const formModal = openFormModal({
        title: preselectBed
            ? `新增入住 — ${preselectBuilding?.name || ''} R${preselectBed.roomNumber}-${preselectBed.bedLetter}`
            : '新增入住 / 建立合約',
        maxWidth: 640,
        fields,
        values: {
            ...(preselectBed ? {} : { buildingId: initialBuildingId }),
            source: defaultSource,
            scheduledDate: todayStr,
            termMonths: '1',
            amount: preselectBed?.rent || 0
        },
        submitLabel: '下一步：確認資料',
        onFormMount: (form) => {
            // 合約編號當 modal subtitle (放在標題下方，不擠到表單區域)
            const overlay = form.closest('.modal-overlay');
            const headerEl = overlay?.querySelector('.modal-header h3');
            if (headerEl && !headerEl.parentElement.querySelector('.modal-subtitle')) {
                const sub = document.createElement('div');
                sub.className = 'modal-subtitle';
                // 樣式走 .modal-subtitle CSS 規則 — 不再 inline (audit QW-5)
                sub.innerHTML = `將建立合約編號 <span class="mono">${predictedContractId}</span> <span class="modal-subtitle__faded">· 送出後正式產生</span>`;
                headerEl.insertAdjacentElement('afterend', sub);
            }

            // 預選床位資訊卡 (若有)
            if (headerHtml) {
                const banner = document.createElement('div');
                banner.innerHTML = headerHtml;
                Array.from(banner.children).reverse().forEach(el => form.insertBefore(el, form.firstChild));
            }

            // === 收費方式切換 — 平台代收 → 隱藏 platformName 以外的收款區塊 ===
            const channelInput = form.querySelector('[name="paymentChannel"]');
            const platformNameWrap = form.querySelector('[name="platformName"]')?.closest('.form-group');
            // 收款記錄整塊 (section divider + adjustments + totalDue + paidAmount + paymentMethod)
            const paymentSepDiv = form.querySelector('.form-section-divider:nth-of-type(2)') || null;
            const adjustWrap = form.querySelector('#ph-adjustments');
            const totalDueWrap = form.querySelector('[name="totalDue"]')?.closest('.form-group');
            const paidAmountWrap = form.querySelector('[name="paidAmount"]')?.closest('.form-group');
            const paymentMethodWrap = form.querySelector('[name="paymentMethod"]')?.closest('.form-group');
            function syncChannelVisibility() {
                const v = channelInput?.value || 'self';
                const isPlatform = v === 'platform';
                if (platformNameWrap) platformNameWrap.style.display = isPlatform ? '' : 'none';
                // 平台代收 → 完全隱藏收款區
                [adjustWrap, totalDueWrap, paidAmountWrap, paymentMethodWrap].forEach(el => {
                    if (el) el.style.display = isPlatform ? 'none' : '';
                });
            }
            syncChannelVisibility();
            channelInput?.addEventListener('change', syncChannelVisibility);

            // 輸入姓名 / 電話時搜尋舊客，跳出建議列，點擊即載入
            const nameInput = form.querySelector('[name="tenantName"]');
            const phoneInput = form.querySelector('[name="tenantPhone"]');
            const emailInput = form.querySelector('[name="tenantEmail"]');
            const emergencyInput = form.querySelector('[name="tenantEmergency"]');
            const sourceSelect = form.querySelector('[name="source"]');

            // 兩個獨立建議列：姓名底下 / 電話底下
            const nameSuggestStrip = document.createElement('div');
            nameSuggestStrip.className = 'tenant-suggest-strip';
            nameInput?.closest('.form-group')?.appendChild(nameSuggestStrip);

            const phoneSuggestStrip = document.createElement('div');
            phoneSuggestStrip.className = 'tenant-suggest-strip';
            phoneInput?.closest('.form-group')?.appendChild(phoneSuggestStrip);

            // mode: 'name' | 'phone' — 影響「將建立新顧客」提示文字
            function renderSuggest(strip, query, mode) {
                if (!query || query.trim().length < 1) { strip.innerHTML = ''; return; }
                const q = query.trim().toLowerCase();
                const matches = mockData.tenants.filter(t =>
                    (t.name || '').toLowerCase().includes(q) ||
                    (t.phone || '').replace(/-/g, '').includes(q.replace(/-/g, ''))
                ).slice(0, 5);

                // 「將建立新顧客」提示 — 只在姓名 strip 顯示，依姓名 input 精確比對
                let headerHtml = '';
                if (mode === 'name') {
                    const typedName = (nameInput?.value || '').trim();
                    const isExactExisting = typedName && mockData.tenants.some(t => t.name === typedName);
                    const willCreateNew = typedName && !isExactExisting;
                    headerHtml = willCreateNew
                        ? `<div class="ts-header ts-header-new">✨ 沒符合的舊資料 → 將建立新顧客「<strong>${esc(typedName)}</strong>」</div>`
                        : (matches.length > 0 ? `<div class="ts-header">找到 ${matches.length} 筆舊資料 — 點擊載入或繼續輸入新姓名</div>` : '');
                } else {
                    headerHtml = matches.length > 0 ? `<div class="ts-header">找到 ${matches.length} 筆舊資料 — 點擊載入或繼續輸入新電話</div>` : '';
                }
                if (!headerHtml && matches.length === 0) { strip.innerHTML = ''; return; }

                strip.innerHTML = `
                    ${headerHtml}
                    ${matches.map(t => {
                        const hasActive = !!activeContractOfTenant(t.name);
                        // 同名多合約合法 → 不擋點擊，只在已有合約時提醒 hint
                        return `
                            <div class="ts-item" data-tenant-id="${esc(t.id)}">
                                <span class="ts-name">${esc(t.name)} <span class="ts-phone">${esc(t.phone || '無電話')}</span></span>
                                ${t.source ? `<span class="ts-source">${esc(t.source)}</span>` : '<span></span>'}
                                ${hasActive ? '<span class="ts-hint">📌 已有合約 — 點此再加一床</span>' : '<span class="ts-load">點此載入 →</span>'}
                            </div>
                        `;
                    }).join('')}
                `;
            }

            function loadTenantFromItem(strip, item) {
                const t = mockData.tenants.find(x => x.id === item.dataset.tenantId);
                if (!t) return;
                if (nameInput) nameInput.value = t.name;
                if (phoneInput) phoneInput.value = t.phone || '';
                if (emailInput) emailInput.value = t.email || '';
                if (emergencyInput) emergencyInput.value = t.emergencyContact || '';
                if (sourceSelect && t.source) sourceSelect.value = t.source;
                // 清掉兩條建議列，顯示載入訊息
                nameSuggestStrip.innerHTML = `<div class="ts-loaded">✅ 已載入 ${esc(t.name)} 的資料</div>`;
                phoneSuggestStrip.innerHTML = '';
                setTimeout(() => { nameSuggestStrip.innerHTML = ''; }, 1800);
            }

            [nameSuggestStrip, phoneSuggestStrip].forEach(strip => {
                strip.addEventListener('click', (e) => {
                    const item = e.target.closest('.ts-item');
                    if (!item || item.dataset.blocked === '1') return;
                    loadTenantFromItem(strip, item);
                });
            });

            nameInput?.addEventListener('input', () => renderSuggest(nameSuggestStrip, nameInput.value, 'name'));
            phoneInput?.addEventListener('input', () => renderSuggest(phoneSuggestStrip, phoneInput.value, 'phone'));

            // 床位變更 → 自動帶該床位的租金
            const bedHidden = form.querySelector('[name="bedId"]');
            const amountInput = form.querySelector('[name="amount"]');
            bedHidden?.addEventListener('change', () => {
                const b = mockData.properties.find(p => p.id === bedHidden.value);
                if (b?.rent != null && amountInput) amountInput.value = b.rent;
            });

            // 館別變更 → 換床位選項 (非 preselect 才需要)
            if (!preselectBed) {
                const buildingHidden = form.querySelector('[name="buildingId"]');
                const bedSelectWrap = form.querySelector('.custom-select[data-name="bedId"]');
                buildingHidden?.addEventListener('change', () => {
                    const bid = buildingHidden.value;
                    const beds = getAvailableBeds(bid);
                    if (bedSelectWrap?.__setOptions) {
                        bedSelectWrap.__setOptions(beds, beds.length ? '請選擇床位' : '此館目前無空床');
                    }
                });
            }

            // 入住日期變更 → 重新計算合約期下拉的到期日 (1個月 · 7/15到期 / 3個月 · 9/15到期)
            const dateInput = form.querySelector('[name="scheduledDate"]');
            const termSelectWrap = form.querySelector('.custom-select[data-name="termMonths"]');
            const updateTermLabels = () => {
                if (termSelectWrap?.__setOptions) {
                    termSelectWrap.__setOptions(buildTermOptions(dateInput?.value || todayStr));
                }
            };
            dateInput?.addEventListener('change', updateTermLabels);
            dateInput?.addEventListener('input', updateTermLabels);

            // 應收總額自動計算 = (月租金 + 額外床位月租加總) × 合約期 - 折扣 + 加項
            const amountInput2 = form.querySelector('[name="amount"]');
            const termHidden = form.querySelector('[name="termMonths"]');  // custom-select 的 hidden input
            const discountInput = form.querySelector('[name="discount"]');
            const discountReasonInput = form.querySelector('[name="discountReason"]');
            const totalDueInput = form.querySelector('[name="totalDue"]');
            // 額外床位的月租加總 — 在下方額外床位區塊更新；先宣告避免 TDZ
            let extraBedRentSum = 0;

            // === 加減項目子表單 (新需求 #1) ===
            // 渲染到 #ph-adjustments；每筆 = { kind: 'sub'|'add', label, amount }
            // 變動時把「net = sub - add」寫到 discount hidden input、JSON 寫到 discountReason hidden input
            const adjustPh = form.querySelector('#ph-adjustments');
            const adjustments = []; // [{ kind, label, amount }]
            const recalcAdjustments = () => {
                const items = Array.from(adjustPh.querySelectorAll('.adj-row')).map(row => ({
                    kind: row.querySelector('[data-adj="kind"]').value,
                    label: row.querySelector('[data-adj="label"]').value.trim(),
                    amount: Number(row.querySelector('[data-adj="amount"]').value) || 0
                })).filter(x => x.amount > 0);
                let sub = 0, add = 0;
                items.forEach(x => x.kind === 'sub' ? (sub += x.amount) : (add += x.amount));
                const net = sub - add;  // discount = net (正數扣，負數加)
                discountInput.value = net;
                discountReasonInput.value = items.length ? JSON.stringify(items) : '';
                if (totalDueInput && amountInput2 && termHidden) {
                    const rent = Number(amountInput2.value) || 0;
                    const term = parseInt(termHidden.value, 10) || 1;
                    totalDueInput.value = Math.max(0, (rent + extraBedRentSum) * term - net);
                }
            };
            const adjRowHtml = (row = { kind: 'sub', label: '', amount: '' }) => `
                <div class="adj-row" style="display: grid; grid-template-columns: 130px 1fr 120px 32px; gap: 0.5rem; align-items: center; padding: 0.55rem; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 0.4rem;">
                    <div class="adj-kind-toggle">
                        <button type="button" class="adj-kind-btn ${row.kind === 'sub' ? 'is-active' : ''}" data-kind="sub" title="折扣 / 減項">− 折扣</button>
                        <button type="button" class="adj-kind-btn ${row.kind === 'add' ? 'is-active' : ''}" data-kind="add" title="加收 / 額外費用">+ 加收</button>
                    </div>
                    <input type="hidden" data-adj="kind" value="${row.kind || 'sub'}">
                    <input data-adj="label" type="text" class="form-input" placeholder="說明 (例：季繳優惠 / 能源費)" value="${row.label || ''}" style="font-size: var(--text-sm);">
                    <input data-adj="amount" type="number" class="form-input" placeholder="金額" value="${row.amount || ''}" style="font-size: var(--text-sm); text-align: right;">
                    <button type="button" class="adj-del" title="移除這筆" style="background: none; border: none; cursor: pointer; color: var(--color-danger); font-size: 1rem; padding: 0.2rem;"><i class="ph ph-x"></i></button>
                </div>
            `;
            if (adjustPh) {
                adjustPh.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <label style="font-weight: 500; font-size: var(--text-base);">折扣 / 加收項目 <small style="color: var(--text-muted); font-weight: 400;">(可多筆)</small></label>
                        <button type="button" id="adj-add" class="btn btn-outline" style="padding: 0.25rem 0.6rem; font-size: var(--text-xs);">
                            <i class="ph ph-plus"></i> 新增項目
                        </button>
                    </div>
                    <div id="adj-list"></div>
                `;
                const listEl = adjustPh.querySelector('#adj-list');
                const addRow = (row) => {
                    const div = document.createElement('div');
                    div.innerHTML = adjRowHtml(row).trim();
                    const rowEl = div.firstChild;
                    listEl.appendChild(rowEl);
                    rowEl.querySelectorAll('input').forEach(inp => inp.addEventListener('input', recalcAdjustments));
                    rowEl.querySelector('.adj-del').addEventListener('click', () => { rowEl.remove(); recalcAdjustments(); });
                    // 分段切換 (折扣 / 加收)
                    rowEl.querySelectorAll('.adj-kind-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const kind = btn.dataset.kind;
                            rowEl.querySelectorAll('.adj-kind-btn').forEach(b => b.classList.toggle('is-active', b.dataset.kind === kind));
                            rowEl.querySelector('[data-adj="kind"]').value = kind;
                            recalcAdjustments();
                        });
                    });
                };
                adjustPh.querySelector('#adj-add').addEventListener('click', () => addRow());
                recalcAdjustments();
            }

            // === 額外床位 (多床位合約) — 同租客 / 同期間，每張額外床位獨立建合約 ===
            const extraBedsPh = form.querySelector('#ph-extraBeds');
            const extraBedIdsInput = form.querySelector('input[name="extraBedIds"]');

            const recalcTotalDue = () => {
                if (!totalDueInput) return;
                const rent = Number(amountInput2?.value) || 0;
                const term = parseInt(termHidden?.value, 10) || 1;
                const discount = Number(discountInput?.value) || 0;
                const total = Math.max(0, (rent + extraBedRentSum) * term - discount);
                totalDueInput.value = total;
            };

            if (extraBedsPh && extraBedIdsInput) {
                const getCurrentBuildingId = () => {
                    if (preselectBed) return preselectBed.buildingId;
                    return form.querySelector('input[name="buildingId"]')?.value || '';
                };
                const getPrimaryBedId = () => {
                    if (preselectBed) return preselectBed.id;
                    return form.querySelector('input[name="bedId"]')?.value || '';
                };
                const getBedOptions = (excludeIds = []) => {
                    const buildingId = getCurrentBuildingId();
                    if (!buildingId) return [];
                    const primaryBedId = getPrimaryBedId();
                    return mockData.properties
                        .filter(p => p.buildingId === buildingId && p.id !== primaryBedId && !excludeIds.includes(p.id))
                        .sort((a, b) => (a.roomNumber - b.roomNumber) || (a.bedLetter || '').localeCompare(b.bedLetter || ''))
                        .map(p => {
                            const active = activeContractFor(p.name);
                            const tag = active ? ` ⚠ ${active.tenant}住至${active.endDate}` : ' · 空床';
                            return { value: p.id, label: `R${p.roomNumber}-${p.bedLetter} · $${(p.rent||0).toLocaleString()}${tag}` };
                        });
                };
                let extraRowCounter = 0;
                const refreshExtraBeds = () => {
                    const hiddenInputs = Array.from(extraBedsPh.querySelectorAll('input[data-extra-bed-id]'));
                    const ids = hiddenInputs.map(s => s.value).filter(Boolean);
                    extraBedIdsInput.value = JSON.stringify(ids);
                    extraBedRentSum = ids.reduce((sum, id) => {
                        const b = mockData.properties.find(p => p.id === id);
                        return sum + (Number(b?.rent) || 0);
                    }, 0);
                    recalcTotalDue();
                    updateBedHeader();
                };
                // 同步「入住床位」摘要框 — 用 form-grid 內部 placeholder 渲染，span 2 自然撐滿整列
                const headerEl = form.querySelector('#ph-bedHeader');
                if (headerEl && preselectBed) {
                    headerEl.style.cssText = 'grid-column: 1 / -1; width: 100%; box-sizing: border-box; background: var(--bg-secondary); border-left: 3px solid var(--color-warning); padding: 0.7rem 1rem; border-radius: 6px;';
                }
                const updateBedHeader = () => {
                    if (!headerEl || !preselectBed) return;
                    const extraIds = JSON.parse(extraBedIdsInput.value || '[]');
                    const extras = extraIds.map(id => mockData.properties.find(p => p.id === id)).filter(Boolean);
                    const primaryRent = Number(preselectBed.rent) || 0;
                    const totalRent = primaryRent + extraBedRentSum;
                    const totalCount = extras.length + 1;
                    const extraChips = extras.map(b => `
                        <span style="background: var(--color-surface, #fff); border: 1px solid var(--border-color); padding: 0.2rem 0.55rem; border-radius: 999px; display: inline-flex; align-items: center; gap: 0.3rem; font-size: var(--text-xs); color: var(--text-main); white-space: nowrap;">
                            <i class="ph ph-stack-plus" style="color: var(--color-primary); font-size: 0.85em;"></i>
                            <strong>${(b.name || '').replace('聚空間 - ', '')}</strong>
                            <span style="color: var(--text-muted);">$${(b.rent || 0).toLocaleString()}</span>
                        </span>
                    `).join('');
                    // 右側合計徽章：單床位顯示「$X/月」，多床位顯示「合計月租 $X (共 N 張)」
                    const rightBadge = extras.length
                        ? `<div style="text-align: right; line-height: 1.2; flex-shrink: 0;">
                              <div style="font-size: var(--text-2xs); color: var(--text-muted); letter-spacing: 0.04em;">合計月租 · 共 ${totalCount} 張</div>
                              <div style="font-size: 1.1rem; font-weight: 700; color: var(--color-primary); margin-top: 0.1rem;">$${totalRent.toLocaleString()}</div>
                           </div>`
                        : `<div style="font-size: 1.1rem; font-weight: 700; color: var(--color-primary); flex-shrink: 0; align-self: center;">
                              $${primaryRent.toLocaleString()}<span style="color: var(--text-muted); font-size: var(--text-2xs); margin-left: 0.15rem; font-weight: 500;">/月</span>
                           </div>`;
                    // 額外床位 chip 列 (有額外時才顯示，跟主資訊之間用虛線分隔)
                    const extrasRow = extras.length
                        ? `<div style="margin-top: 0.55rem; padding-top: 0.5rem; border-top: 1px dashed var(--border-color); display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                              <span style="font-size: var(--text-2xs); color: var(--text-muted); display: inline-flex; align-items: center; gap: 0.25rem; flex-shrink: 0;">
                                  <i class="ph ph-plus-circle" style="color: var(--color-primary);"></i> 額外
                              </span>
                              ${extraChips}
                           </div>`
                        : '';
                    headerEl.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                            <div style="display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1;">
                                <span style="font-size: var(--text-2xs); color: var(--text-muted); letter-spacing: 0.04em;">入住床位${extras.length ? ` <span style="color: var(--color-primary); font-weight: 600;">(${totalCount} 張)</span>` : ''}</span>
                                <span style="font-weight: 600; font-size: var(--text-md);">${preselectBuilding?.name || ''} R${preselectBed.roomNumber}-${preselectBed.bedLetter}</span>
                                <span style="font-size: var(--text-xs); color: var(--text-muted);">${formatRoomType(preselectBed.gender, preselectBed.capacity)} · $${primaryRent.toLocaleString()}/月</span>
                            </div>
                            ${rightBadge}
                        </div>
                        ${extrasRow}
                    `;
                };
                const buildExtraBedSelectHtml = (rowId) => {
                    const opts = getBedOptions();
                    const placeholder = opts.length ? '請選擇額外床位' : '此館目前無其他可選床位';
                    const optsHtml = opts.map(o => `
                        <button type="button" class="custom-select-option" data-value="${o.value}">
                            <span>${o.label}</span>
                            <i class="ph ph-check"></i>
                        </button>
                    `).join('');
                    return `
                        <div class="custom-select" data-name="extraBed_${rowId}">
                            <button type="button" class="custom-select-trigger">
                                <span class="custom-select-value placeholder">${placeholder}</span>
                                <i class="ph ph-caret-down custom-select-icon"></i>
                            </button>
                            <input type="hidden" name="extraBed_${rowId}" data-extra-bed-id value="">
                            <div class="custom-select-panel" hidden>
                                <div class="custom-select-options-wrap">
                                    <button type="button" class="custom-select-option is-selected" data-value="">
                                        <span>${placeholder}</span>
                                    </button>
                                    ${optsHtml}
                                </div>
                                <div class="custom-select-empty" hidden>查無符合項目</div>
                            </div>
                        </div>
                    `;
                };
                const addExtraBedRow = () => {
                    const rowId = ++extraRowCounter;
                    const row = document.createElement('div');
                    row.className = 'extra-bed-row';
                    row.style.cssText = 'display: grid; grid-template-columns: 1fr 32px; gap: 0.5rem; align-items: center; margin-bottom: 0.4rem;';
                    row.innerHTML = `
                        ${buildExtraBedSelectHtml(rowId)}
                        <button type="button" class="extra-bed-del" title="移除這張床位" style="background: none; border: none; cursor: pointer; color: var(--color-danger); font-size: 1.1rem; padding: 0.3rem; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;"><i class="ph ph-x-circle"></i></button>
                    `;
                    extraBedsPh.querySelector('#extra-beds-list').appendChild(row);
                    initCustomSelects(row);
                    // 監聽 hidden input 變動 (custom-select 在 selectValue 時派發 change event)
                    row.querySelector('input[data-extra-bed-id]').addEventListener('change', refreshExtraBeds);
                    row.querySelector('.extra-bed-del').addEventListener('click', () => { row.remove(); refreshExtraBeds(); });
                };
                extraBedsPh.innerHTML = `
                    <div style="padding: 0.75rem; background: var(--bg-secondary); border-radius: 8px; border: 1px dashed var(--border-color); margin-top: 0.5rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                            <label style="font-weight: 500; font-size: var(--text-base);">
                                <i class="ph ph-stack-plus"></i> 額外床位 <small style="color: var(--text-muted); font-weight: 400;">(可選 — 同租客同期間 = 多張合約)</small>
                            </label>
                            <button type="button" id="add-extra-bed-btn" class="btn btn-outline" style="font-size: var(--text-xs); padding: 0.3rem 0.7rem;">
                                <i class="ph ph-plus"></i> 增加床位
                            </button>
                        </div>
                        <div id="extra-beds-list"></div>
                        <small class="form-hint" style="color: var(--text-muted); font-size: var(--text-2xs); display: block; margin-top: 0.4rem;">每多選一張床位 = 多建一份合約，月租自動加總；折扣 / 收款只記在主合約，額外床位的房租可至帳務管理收款</small>
                    </div>
                `;
                extraBedsPh.querySelector('#add-extra-bed-btn').addEventListener('click', () => addExtraBedRow());
                // 主館別 / 主床位變更：清空額外床位（避免跨館 + 主床位選項衝突）
                const buildingHidden = form.querySelector('input[name="buildingId"]');
                const bedHidden = form.querySelector('input[name="bedId"]');
                [buildingHidden, bedHidden].forEach(input => {
                    input?.addEventListener('change', () => {
                        extraBedsPh.querySelector('#extra-beds-list').innerHTML = '';
                        refreshExtraBeds();
                    });
                });
                refreshExtraBeds();
            }

            if (totalDueInput) {
                // readonly 樣式：灰底 + 不可編輯
                totalDueInput.readOnly = true;
                totalDueInput.style.backgroundColor = 'var(--bg-tertiary)';
                totalDueInput.style.cursor = 'not-allowed';
                totalDueInput.style.fontWeight = '700';
                totalDueInput.style.color = 'var(--color-primary)';

                amountInput2?.addEventListener('input', recalcTotalDue);
                // termMonths 是 custom-select，要監聽 hidden input 的 change
                termHidden?.addEventListener('change', recalcTotalDue);
                recalcTotalDue();  // 初始算一次
            }

            // === UIUX #5: 3 步 wizard (床位+租客 → 合約條件 → 收款) ===
            const STEP_MAP = {
                buildingId: 1, bedId: 1, extraBeds: 1,
                source: 1, tenantName: 1, tenantPhone: 1, tenantEmail: 1, tenantEmergency: 1,
                scheduledDate: 2, termMonths: 2, amount: 2,
                paymentChannel: 3, platformName: 3,
                __sep_payment: 3, adjustments: 3, discount: 3, discountReason: 3,
                totalDue: 3, paidAmount: 3, paymentMethod: 3
            };
            const STEP_LABELS = ['床位與租客', '合約條件', '收款'];

            // 把每個 field 對應的 form-group / divider / placeholder 加上 data-wizard-step
            fields.forEach(f => {
                const step = STEP_MAP[f.name];
                if (!step) return;
                const el = form.querySelector(`#ph-${f.name}, #f-${f.name}, input[name="${f.name}"], textarea[name="${f.name}"]`);
                if (!el) return;
                // placeholder 已經是頂層 div；hidden input 不分組；其他要找 .form-group
                if (el.tagName === 'INPUT' && el.type === 'hidden') {
                    el.dataset.wizardStep = 'all';
                    return;
                }
                if (el.id && el.id.startsWith('ph-')) {
                    el.dataset.wizardStep = String(step);
                    return;
                }
                const target = el.closest('.form-group, .form-section-divider');
                if (target) target.dataset.wizardStep = String(step);
            });
            // section divider (__sep_payment) 沒有 input，按 fields 順序找 — 目前只有「收款」一個，固定 step 3
            form.querySelectorAll('.form-section-divider:not([data-wizard-step])').forEach(div => {
                div.dataset.wizardStep = '3';
            });

            // 建 stepper
            const stepper = document.createElement('div');
            stepper.className = 'wizard-stepper';
            stepper.style.cssText = 'display: flex; gap: 0.4rem; align-items: center; padding: 0.5rem 0 0.85rem; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border-color); grid-column: 1 / -1;';
            stepper.innerHTML = STEP_LABELS.map((label, idx) => `
                <div class="wiz-step" data-wiz-step="${idx + 1}" style="display: flex; align-items: center; gap: 0.4rem;">
                    <span class="wiz-step-num" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: var(--bg-tertiary); color: var(--text-muted); font-size: var(--text-2xs); font-weight: 700;">${idx + 1}</span>
                    <span class="wiz-step-label" style="font-size: var(--text-xs); color: var(--text-muted); font-weight: 500;">${label}</span>
                </div>
                ${idx < STEP_LABELS.length - 1 ? '<span class="wiz-step-bar" style="flex: 1; height: 2px; background: var(--border-color); border-radius: 2px;"></span>' : ''}
            `).join('');
            form.insertBefore(stepper, form.firstChild);

            // footer 動態切換 (上一步 / 下一步 / 送出)
            const wizardOverlay = form.closest('.modal-overlay');
            const footer = wizardOverlay?.querySelector('.modal-footer');
            const originalSubmit = footer?.querySelector('button[type="submit"]');
            const prevBtn = document.createElement('button');
            prevBtn.type = 'button';
            prevBtn.className = 'btn btn-outline';
            prevBtn.innerHTML = '<i class="ph ph-caret-left"></i> 上一步';
            const nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.className = 'btn btn-primary';
            nextBtn.innerHTML = '下一步 <i class="ph ph-caret-right"></i>';
            if (footer && originalSubmit) {
                footer.insertBefore(prevBtn, originalSubmit);
                footer.insertBefore(nextBtn, originalSubmit);
            }

            let currentStep = 1;
            const TOTAL_STEPS = STEP_LABELS.length;
            const setStep = (n) => {
                currentStep = Math.max(1, Math.min(TOTAL_STEPS, n));
                form.querySelectorAll('[data-wizard-step]').forEach(el => {
                    const s = el.dataset.wizardStep;
                    if (s === 'all') { el.style.display = ''; return; }
                    el.style.display = String(s) === String(currentStep) ? '' : 'none';
                });
                // 更新 stepper 樣式
                stepper.querySelectorAll('.wiz-step').forEach(el => {
                    const s = Number(el.dataset.wizStep);
                    // 手機 CSS 用 .is-current / .is-done 控制 stepper label 收/展 (M-C-4)
                    el.classList.toggle('is-current', s === currentStep);
                    el.classList.toggle('is-done', s < currentStep);
                    const num = el.querySelector('.wiz-step-num');
                    const lbl = el.querySelector('.wiz-step-label');
                    if (s < currentStep) {
                        num.style.background = 'var(--color-success)';
                        num.style.color = '#fff';
                        num.innerHTML = '<i class="ph ph-check" style="font-size: var(--text-xs);"></i>';
                        lbl.style.color = 'var(--text-muted)';
                        lbl.style.fontWeight = '500';
                    } else if (s === currentStep) {
                        num.style.background = 'var(--color-primary)';
                        num.style.color = '#fff';
                        num.textContent = String(s);
                        lbl.style.color = 'var(--text-main)';
                        lbl.style.fontWeight = '700';
                    } else {
                        num.style.background = 'var(--bg-tertiary)';
                        num.style.color = 'var(--text-muted)';
                        num.textContent = String(s);
                        lbl.style.color = 'var(--text-muted)';
                        lbl.style.fontWeight = '500';
                    }
                });
                stepper.querySelectorAll('.wiz-step-bar').forEach((bar, idx) => {
                    bar.style.background = (idx + 1) < currentStep ? 'var(--color-success)' : 'var(--border-color)';
                });
                // footer
                if (prevBtn) prevBtn.style.display = currentStep > 1 ? '' : 'none';
                if (nextBtn) nextBtn.style.display = currentStep < TOTAL_STEPS ? '' : 'none';
                if (originalSubmit) originalSubmit.style.display = currentStep === TOTAL_STEPS ? '' : 'none';
                // 捲到 modal body 頂端 (modal-body 才是滾動容器)
                const modalBody = wizardOverlay?.querySelector('.modal-body');
                if (modalBody) modalBody.scrollTop = 0;
            };

            prevBtn.addEventListener('click', () => setStep(currentStep - 1));
            nextBtn.addEventListener('click', () => {
                // 驗證當前 step 的 required 欄位
                const stepFields = fields.filter(f => STEP_MAP[f.name] === currentStep && f.required);
                let firstInvalid = null;
                let invalidLabel = '';
                stepFields.forEach(f => {
                    const el = form.querySelector(`[name="${f.name}"]`);
                    if (!el) return;
                    const val = String(el.value || '').trim();
                    const target = el.closest('.custom-select') || el;
                    if (!val) {
                        if (!firstInvalid) { firstInvalid = target; invalidLabel = f.label || f.name; }
                        target.classList.add('input-error');
                    } else {
                        target.classList.remove('input-error');
                    }
                });
                if (firstInvalid) {
                    const focusTarget = firstInvalid.classList.contains('custom-select')
                        ? firstInvalid.querySelector('.custom-select-trigger') : firstInvalid;
                    focusTarget?.focus();
                    if (focusTarget?.scrollIntoView) focusTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    showToast(`「${invalidLabel}」必填，請補上`, 'danger', 4000);
                    return;
                }
                setStep(currentStep + 1);
            });

            // Enter 鍵在前兩步 = 下一步 (不送出整張表)
            form.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && currentStep < TOTAL_STEPS) {
                    // textarea / 加減項目 row 內輸入不攔截
                    const tag = (e.target.tagName || '').toLowerCase();
                    if (tag === 'textarea') return;
                    if (e.target.closest?.('.adj-row')) return;
                    e.preventDefault();
                    nextBtn.click();
                }
            });

            setStep(1);
        },
        onSubmit: (values) => {
            // ── 1. 驗證 + 預先計算 (合約期間 / 重疊檢查) ──
            const bedId = preselectBed?.id || values.bedId;
            const bed = mockData.properties.find(p => p.id === bedId);
            if (!bed) { showToast('請選擇床位', 'danger'); return false; }

            const inputName = (values.tenantName || '').trim();
            if (!inputName) { showToast('請填姓名', 'danger'); return false; }

            const startDate = values.scheduledDate;
            const term = parseInt(values.termMonths, 10) || 1;
            const endDate = addDaysISO(startDate, term * 30);  // 6/15 + 30 = 7/15
            const amount = parseInt(values.amount, 10) || bed.rent || 0;

            const bedOverlaps = findOverlappingBedContracts(bed.name, startDate, endDate);
            if (bedOverlaps.length > 0) {
                const c = bedOverlaps[0];
                showToast(`合約期間衝突：床位 ${bed.name} 在 ${c.startDate} ~ ${c.endDate} 已有合約 ${c.id}（${c.tenant}）`, 'danger', 8000);
                return false;
            }
            // 同名多床位是合法情境 (一個聯絡人代表整間房 / 多床位入住)
            // 不擋，但若已有其他活躍合約，跳個 info toast 提醒一下
            const tenantOverlaps = findOverlappingTenantContracts(inputName, startDate, endDate);
            if (tenantOverlaps.length > 0) {
                const c = tenantOverlaps[0];
                showToast(`提醒：${inputName} 已有合約 ${c.id}（${c.propertyName}），將為其建立第 ${tenantOverlaps.length + 1} 份合約`, 'info', 5000);
            }

            // ── 2. 顯示確認頁 ──
            const existingTenant = mockData.tenants.find(t => t.name === inputName);
            const tenantStatusLabel = existingTenant ? '✏️ 更新舊客資料' : '✨ 建立新客';
            const discount = Number(values.discount) || 0;
            // 解析多筆加減項目 (新需求 #1) — 從 discountReason hidden input 取 JSON
            let adjItems = [];
            try { adjItems = values.discountReason ? JSON.parse(values.discountReason) : []; } catch {}
            // 解析額外床位 IDs — 去重 + 排除主床位 (防呆)
            let extraBedIdArr = [];
            try { extraBedIdArr = values.extraBedIds ? JSON.parse(values.extraBedIds) : []; } catch {}
            extraBedIdArr = [...new Set(extraBedIdArr)].filter(id => id !== bed.id);
            const extraBeds = extraBedIdArr
                .map(id => mockData.properties.find(p => p.id === id))
                .filter(Boolean);
            const extraBedRentTotal = extraBeds.reduce((s, b) => s + (Number(b.rent) || 0), 0);
            // 已收金額留空 → 0 (未收)
            const paidAmount = values.paidAmount != null && values.paidAmount !== '' ? Number(values.paidAmount) : 0;
            const due = (amount + extraBedRentTotal) * term - discount;
            // 加減項目 breakdown 顯示
            const adjustmentLines = adjItems.length
                ? adjItems.map(x => {
                    const sign = x.kind === 'add' ? '+' : '-';
                    const color = x.kind === 'add' ? 'var(--color-info)' : 'var(--color-warning)';
                    return `<div style="font-size: var(--text-xs); color: ${color}; padding-left: 0.5rem;">${sign} $${x.amount.toLocaleString()} ${x.label || '(無說明)'}</div>`;
                }).join('')
                : '';
            const bedSummary = extraBeds.length === 0
                ? `${(bed.name || '').replace('聚空間 - ', '')} · 月租 $${(bed.rent || 0).toLocaleString()}`
                : `<div><strong>主床位：</strong>${(bed.name || '').replace('聚空間 - ', '')} · $${(bed.rent || 0).toLocaleString()}/月</div>` +
                  extraBeds.map(b => `<div style="color: var(--text-secondary); font-size: var(--text-sm); padding-left: 0.5rem; margin-top: 0.2rem;"><i class="ph ph-stack-plus" style="font-size: 0.85em;"></i> 額外：${(b.name || '').replace('聚空間 - ', '')} · $${(b.rent || 0).toLocaleString()}/月</div>`).join('') +
                  `<div style="color: var(--text-muted); font-size: var(--text-xs); margin-top: 0.25rem;">共 ${extraBeds.length + 1} 張床位 · 合計月租 $${(amount + extraBedRentTotal).toLocaleString()}</div>`;
            const contractIdLabel = extraBeds.length === 0
                ? `<strong style="font-family: monospace;">${predictedContractId}</strong>`
                : `<strong style="font-family: monospace;">${predictedContractId}</strong> <span style="color: var(--text-muted); font-size: var(--text-xs);">+ 額外 ${extraBeds.length} 份</span>`;
            const reviewRows = [
                ['新合約編號', contractIdLabel],
                ['床位', bedSummary],
                ['租客', `${inputName} <span style="color: var(--text-muted); font-size: var(--text-xs);">${tenantStatusLabel}</span>`],
                ['電話', values.tenantPhone || '<span style="color: var(--text-muted)">未填</span>'],
                ['Email', values.tenantEmail || '<span style="color: var(--text-muted)">未填</span>'],
                ['緊急聯絡人', values.tenantEmergency || '<span style="color: var(--text-muted)">未填</span>'],
                ['顧客來源', values.source || '其他'],
                ['入住日', startDate],
                ['到期日', endDate],
                ['合約期', term === 3 ? '3 個月（季繳）' : '1 個月'],
                ['月租金', `$${(amount + extraBedRentTotal).toLocaleString()}${extraBeds.length ? ` <span style="color: var(--text-muted); font-size: var(--text-xs);">(主 $${amount.toLocaleString()} + 額外 $${extraBedRentTotal.toLocaleString()})</span>` : ''}`],
                ['應收總額', `<div><strong>$${due.toLocaleString()}</strong> <span style="color: var(--text-muted); font-size: var(--text-xs);">(月租 × ${term} = $${((amount + extraBedRentTotal) * term).toLocaleString()})</span></div>${adjustmentLines}`],
                ['已收金額', `$${paidAmount.toLocaleString()}${paidAmount >= due ? ' <span style="color: var(--color-success);">✅ 已收訖</span>' : paidAmount > 0 ? ` <span style="color: var(--color-warning);">部分繳款 (餘 $${(due - paidAmount).toLocaleString()})</span>` : ' <span style="color: var(--color-danger);">❌ 未繳</span>'}`],
                ['付款方式', values.paymentMethod || '匯款']
            ];
            const reviewHtml = `
                <div style="font-size: var(--text-sm); color: var(--text-muted); margin-bottom: 1rem;">請仔細核對下方資料，確認無誤後送出。送出後系統會：建立合約 → 自動產生帳單 → 更新床位 / 租客狀態。</div>
                <table style="width: 100%; border-collapse: collapse; font-size: var(--text-base);">
                    ${reviewRows.map(([k, v]) => `
                        <tr>
                            <td style="padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--border-color); color: var(--text-muted); width: 30%; vertical-align: top;">${k}</td>
                            <td style="padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--border-color); color: var(--text-main);">${v}</td>
                        </tr>
                    `).join('')}
                </table>
            `;

            openConfirm({
                title: `📋 確認建立合約 ${predictedContractId}`,
                message: reviewHtml,
                confirmLabel: '✅ 確認建立',
                cancelLabel: '返回修改',
                maxWidth: 560,
                onConfirm: () => {
                    // ── 3. 真正執行 ──
                    const inputPhone = (values.tenantPhone || '').trim();
                    const inputEmail = (values.tenantEmail || '').trim();
                    const inputEmergency = (values.tenantEmergency || '').trim();
                    const inputSource = values.source || '其他';

                    let tenant = mockData.tenants.find(t => t.name === inputName);
                    if (tenant) {
                        store.updateTenant(tenant.id, {
                            phone: inputPhone || tenant.phone,
                            email: inputEmail || tenant.email,
                            emergencyContact: inputEmergency || tenant.emergencyContact,
                            source: inputSource || tenant.source
                        });
                        tenant = mockData.tenants.find(t => t.id === tenant.id);
                    } else {
                        tenant = store.addTenant({
                            name: inputName, phone: inputPhone, email: inputEmail,
                            emergencyContact: inputEmergency, source: inputSource,
                            currentProperty: null, status: '待入住'
                        });
                    }

                    // 多床位 bundle: 主合約 invoice 自動含 額外床位月租；額外床位不獨立開 invoice
                    const extraBedRentList = extraBeds.map(eb => Number(eb.rent) || 0);
                    const paymentChannel = values.paymentChannel || 'self';
                    const platformName = paymentChannel === 'platform' ? (values.platformName || '').trim() : null;
                    const contract = store.addContract({
                        propertyId: bed.id,
                        propertyName: bed.name,
                        tenant: tenant.name,
                        signDate: startDate,
                        startDate,
                        endDate,
                        termMonths: term,
                        status: '已簽署',
                        amount,
                        depositAmount: 0,
                        parentContractId: null,
                        renewalState: 'active',
                        snoozeUntil: null,
                        signedFileUrl: null,
                        terminatedDate: null,
                        paymentChannel,                // 'self' | 'platform'
                        platformName,                  // 例: 'Airbnb' / '591' (platform 時才有值)
                        __payment: paymentChannel === 'platform' ? null : {
                            discount,
                            discountReason: values.discountReason || null,
                            paidAmount: values.paidAmount != null && values.paidAmount !== '' ? Number(values.paidAmount) : null,
                            paymentMethod: values.paymentMethod || '匯款',
                            __bundleExtraRents: extraBedRentList   // ← 自動累加進首張 invoice
                        }
                    });
                    store.updateProperty(bed.id, {
                        tenant: tenant.name, status: '已出租',
                        contractId: contract.id, contractEnd: endDate
                    });
                    store.updateTenant(tenant.id, { currentProperty: bed.name, status: '居住中' });

                    // 額外床位 — 各建一份合約 (相同期間、各自月租)
                    // 帳務全走主合約那張，所以額外合約傳 __skipInvoice: true
                    // (歷史 bug: 沒傳這旗標 → addContract 對任何 active 合約都會開 invoice → 重複)
                    const extraContractIds = [];
                    extraBeds.forEach(eb => {
                        const ec = store.addContract({
                            propertyId: eb.id,
                            propertyName: eb.name,
                            tenant: tenant.name,
                            signDate: startDate,
                            startDate, endDate,
                            termMonths: term,
                            status: '已簽署',
                            amount: Number(eb.rent) || 0,
                            depositAmount: 0,
                            parentContractId: null,
                            bundleParentContractId: contract.id,  // 標記為 bundle 子合約
                            renewalState: 'active',
                            snoozeUntil: null,
                            signedFileUrl: null,
                            terminatedDate: null,
                            paymentChannel,                       // 跟主合約一致 (self / platform)
                            platformName,
                            __skipInvoice: true                   // 不獨立開 invoice，帳務走主合約
                        });
                        store.updateProperty(eb.id, {
                            tenant: tenant.name, status: '已出租',
                            contractId: ec.id, contractEnd: endDate
                        });
                        extraContractIds.push(ec.id);
                    });

                    const msg = extraContractIds.length
                        ? `✅ 合約 ${contract.id} + 綁定 ${extraContractIds.length} 張床位 (${extraContractIds.join(', ')}) 建立完成 — 帳務全走主合約那張`
                        : `✅ 合約 ${contract.id} 建立完成 — ${tenant.name} → ${bed.name}`;
                    showToast(msg, 'success', 5000);
                    formModal.close();
                    refreshView();
                }
            });
            return false; // 不關閉表單，等待確認結果
        }
    });
}

function confirmDelete(propertyId) {
    const p = mockData.properties.find(x => x.id === propertyId);
    if (!p) return;
    // 阻擋有 active 合約的床位被刪除
    const hasActiveContract = mockData.contracts.some(c => c.propertyId === propertyId && c.renewalState === 'active');
    const blockedReason = hasActiveContract
        ? `<div style="margin-top: 0.75rem; padding: 0.75rem; background: rgba(220, 38, 38, 0.08); border-radius: 6px; border-left: 3px solid var(--color-danger); font-size: var(--text-sm);">
              <strong>⚠ 此床位有現任租客的合約</strong>，先到合約管理「退租」才能刪除床位。
           </div>`
        : '';
    if (hasActiveContract) {
        openConfirm({
            title: '無法刪除床位',
            message: `床位 <strong>${p.name}</strong> 還有現任租客的活躍合約。${blockedReason}`,
            confirmLabel: '我知道了',
            hideCancel: true,
            danger: false
        });
        return;
    }
    openConfirm({
        title: '刪除床位',
        message: `確定要刪除 <strong>${p.name}</strong> 嗎？此動作無法還原。`,
        danger: true,
        confirmLabel: '確定刪除',
        onConfirm: () => {
            const snap = JSON.parse(JSON.stringify(p));
            mockData.properties = mockData.properties.filter(x => x.id !== propertyId);
            refreshView();
            showUndoToast({
                message: `已刪除床位 ${p.name}`,
                durationMs: 5000,
                onUndo: () => {
                    mockData.properties.push(snap);
                    refreshView();
                    showToast('已復原', 'success');
                },
                onCommit: () => {
                    window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'properties', id: snap.id } }));
                }
            });
        }
    });
}

function initPropertyActions(scope = document) {
    scope.querySelector('#btn-new-checkin-assign')?.addEventListener('click', () => showCheckinAssignmentForm());

    // 表頭排序：第一次點 = asc，再點 = desc，第三次點 = 取消回預設
    scope.querySelectorAll('.sortable-col').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sortCol;
            const cur = getPropSort();
            let next;
            if (cur.col !== col) next = `${col}-asc`;
            else if (cur.dir === 'asc') next = `${col}-desc`;
            else next = '';
            if (next) localStorage.setItem(PROP_SORT_KEY, next);
            else localStorage.removeItem(PROP_SORT_KEY);
            refreshView();
        });
    });

    scope.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const id = e.currentTarget.dataset.propertyId;
            const property = mockData.properties.find(p => p.id === id);
            if (!property) return;
            switch (action) {
                case 'view': showPropertyDetails(id); break;
                case 'edit': showPropertyForm(property); break;
                case 'delete': confirmDelete(id); break;
            }
        });
    });

    // 租客名稱點擊 → 開租客詳情 modal
    scope.querySelectorAll('.tenant-link').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tid = e.currentTarget.dataset.tenantId;
            if (tid) showTenantDetails(tid);
        });
    });
}

export { initPropertyActions };
