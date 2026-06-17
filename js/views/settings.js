import { mockData, store, formatRoomType, getSortedBuildings, bedOccupied } from '../data.js';
import { openFormModal, openConfirm, openModal, showToast, refreshView } from '../utils/ui.js';
import { showPropertyForm } from './properties.js';
import { fileToBase64, fillContractPdf, downloadPdfBytes, previewPdfBytes, listPdfFields, formatRentalPeriod } from '../utils/pdfGen.js';
import { downloadBackup, getLastBackupAt } from '../backup.js';
import { getMode } from '../utils/appMode.js';

const GENDER_OPTIONS = ['男', '女', '不限'];
const STATUS_OPTIONS = [
    { value: 'active', label: '啟用中' },
    { value: 'inactive', label: '已停用' }
];

// === 主入口 ===
export function renderSettings() {
    return `
        <div class="settings-tabs">
            <button class="settings-tab active" data-settings-tab="buildings">
                <i class="ph ph-buildings"></i> 館別管理
            </button>
            <button class="settings-tab" data-settings-tab="invoiceTypes">
                <i class="ph ph-receipt"></i> 帳單類型
            </button>
            <button class="settings-tab" data-settings-tab="tenantSources">
                <i class="ph ph-user-circle"></i> 顧客來源
            </button>
            <button class="settings-tab" data-settings-tab="paymentMethods">
                <i class="ph ph-credit-card"></i> 付款方式
            </button>
            <button class="settings-tab" data-settings-tab="contractTemplates">
                <i class="ph ph-file-pdf"></i> 合約範本
            </button>
            <button class="settings-tab" data-settings-tab="sync">
                <i class="ph ph-cloud"></i> 雲端同步
            </button>
        </div>
        <div id="settings-content" class="settings-content">
            ${renderBuildingsTab()}
        </div>
    `;
}

// === Tab: 房屋管理 (依當前 mode 篩 - 共居只顯 B 系列、代管只顯 M 系列) ===
function renderBuildingsTab() {
    const targetMode = getMode() === 'managed' ? 'managed' : 'cohousing';
    const buildings = getSortedBuildings() // 含已停用，但按 id 排好
        .filter(b => (b.mode || 'cohousing') === targetMode);
    const { properties } = mockData;
    const totalBeds = (bid) => properties.filter(p => p.buildingId === bid).length;
    const rentedBeds = (bid) => properties.filter(p => p.buildingId === bid && bedOccupied(p.name)).length;
    const roomCount = (bid) => new Set(properties.filter(p => p.buildingId === bid).map(p => p.roomNumber)).size;

    const rows = buildings.map(b => {
        const total = totalBeds(b.id);
        const rented = rentedBeds(b.id);
        const rooms = roomCount(b.id);
        const isActive = b.status === 'active';
        return `
            <tr class="${isActive ? '' : 'inactive-row'}">
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <strong>${b.name}</strong>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">${b.id}</span>
                    </div>
                </td>
                <td><span style="font-size: var(--text-base);">${b.baseAddress || '<span style=\"color: var(--text-muted)\">未設定</span>'}</span></td>
                <td><strong>${rooms}</strong> <span style="font-size: var(--text-xs); color: var(--text-muted);">間</span></td>
                <td><strong>${total}</strong> <span style="font-size: var(--text-xs); color: var(--text-muted);">床</span></td>
                <td><span style="color: var(--color-success); font-weight: 600;">${rented}</span> <span style="color: var(--text-muted);"> / </span><span>${total - rented}</span></td>
                <td>
                    <span class="status-badge ${isActive ? 'success' : 'info'}">${isActive ? '啟用中' : '已停用'}</span>
                </td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-outline building-action" style="padding: 0.25rem 0.75rem; font-size: var(--text-xs);" data-action="manage" data-id="${b.id}" title="管理房間與床位">
                            <i class="ph ph-list-bullets"></i> 房間/床位
                        </button>
                        <button class="btn btn-outline building-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" data-action="edit" data-id="${b.id}" title="編輯館別">
                            <i class="ph ph-pencil"></i>
                        </button>
                        <button class="btn btn-outline building-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" data-action="toggle" data-id="${b.id}" title="${isActive ? '停用' : '啟用'}">
                            <i class="ph ${isActive ? 'ph-pause' : 'ph-play'}"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <div>
                    <h2 class="card-title" style="margin-bottom: 0.25rem;"><i class="ph ph-buildings"></i> 館別管理</h2>
                    <p style="font-size: var(--text-xs); color: var(--text-muted); margin: 0;">館別禁止刪除（會影響歷史資料），不再使用請改為「停用」</p>
                </div>
                <button class="btn btn-primary" id="btn-new-building">
                    <i class="ph ph-plus"></i> 新增館別
                </button>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>館別</th><th>預設地址</th><th>房間數</th><th>床位數</th><th>已租 / 空床</th><th>狀態</th><th>操作</th>
                        </tr>
                    </thead>
                    <tbody>${rows || `<tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">尚無館別資料</td></tr>`}</tbody>
                </table>
            </div>
        </div>
    `;
}

function showBuildingForm(building = null) {
    const isEdit = !!building;
    openFormModal({
        title: isEdit ? `編輯館別：${building.name}` : '新增館別',
        maxWidth: 540,
        fields: [
            { name: 'name', label: '館別名稱', type: 'text', required: true, placeholder: '例：松山館' },
            { name: 'status', label: '狀態', type: 'select', required: true, options: STATUS_OPTIONS, value: building?.status ?? 'active', hint: '停用後新增床位無法選此館別' },
            { name: 'baseAddress', label: '預設地址（不含樓層）', type: 'text', span: 2, placeholder: '例：台北市松山區南京東路 50 號', hint: '新增床位時會以此為預設地址' },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 2 }
        ],
        values: building ?? { status: 'active' },
        submitLabel: isEdit ? '儲存變更' : '建立',
        onSubmit: (values) => {
            // 名稱重複檢查
            const dup = mockData.buildings.find(b => b.name === values.name && b.id !== building?.id);
            if (dup) {
                showToast(`館別名稱「${values.name}」已存在`, 'danger');
                return false;
            }
            if (isEdit) {
                const oldAddress = (building.baseAddress || '').trim();
                const newAddress = (values.baseAddress || '').trim();
                const addressChanged = oldAddress !== newAddress && newAddress !== '';

                store.updateBuilding(building.id, values);
                showToast(`已更新：${values.name}`, 'success');
                refreshView();

                // 預設地址變更 → 詢問是否同步到該館所有床位 + 合約地址快照
                if (addressChanged) {
                    const affectedProps = mockData.properties.filter(p => p.buildingId === building.id);
                    if (affectedProps.length > 0) {
                        // 讓上一個 modal 先關掉再跳確認
                        setTimeout(() => {
                            openConfirm({
                                title: '同步地址到該館床位？',
                                message: `
                                    <p style="margin: 0 0 0.5rem;">館別「<strong>${values.name}</strong>」預設地址已改為：</p>
                                    <p style="margin: 0 0 0.75rem; padding: 0.5rem 0.75rem; background: var(--bg-secondary); border-radius: 4px; font-weight: 600;">${newAddress}</p>
                                    <p style="margin: 0 0 0.5rem;">要把它套用到該館 <strong>${affectedProps.length}</strong> 個現有床位嗎？</p>
                                    <ul style="margin: 0; padding-left: 1.2rem; color: var(--text-muted); font-size: var(--text-sm); line-height: 1.6;">
                                        <li>床位地址會被合約 detail / 搜尋 / PDF 引用</li>
                                        <li>若某些床位你曾自訂地址（例如加樓層），會被覆蓋</li>
                                        <li>不同步 = 只改未來新增床位的預設值</li>
                                    </ul>
                                `,
                                confirmLabel: `套用到 ${affectedProps.length} 個床位`,
                                cancelLabel: '不同步，只改預設',
                                onConfirm: () => {
                                    affectedProps.forEach(p => store.updateProperty(p.id, { address: newAddress }));
                                    showToast(`已同步 ${affectedProps.length} 個床位的地址`, 'success');
                                    refreshView();
                                }
                            });
                        }, 200);
                    }
                }
            } else {
                const created = store.addBuilding(values);
                showToast(`已新增館別：${created.name}`, 'success');
                refreshView();
            }
        }
    });
}

// === 房間 / 床位 drill-down 管理 modal ===
function nextLetter(beds) {
    const used = new Set(beds.map(b => b.bedLetter));
    for (let c = 65; c <= 90; c++) {
        const ch = String.fromCharCode(c);
        if (!used.has(ch)) return ch;
    }
    return '?';
}

function showBuildingRoomsModal(buildingId) {
    const building = mockData.buildings.find(b => b.id === buildingId);
    if (!building) return;

    let modalBody;

    function renderBody() {
        const beds = mockData.properties
            .filter(p => p.buildingId === buildingId)
            .sort((a, b) => (a.roomNumber - b.roomNumber) || (a.bedLetter || '').localeCompare(b.bedLetter || ''));

        const rooms = {};
        beds.forEach(b => {
            const key = b.roomNumber;
            if (!rooms[key]) rooms[key] = [];
            rooms[key].push(b);
        });
        const roomNumbers = Object.keys(rooms).map(Number).sort((a, b) => a - b);

        const totalBeds = beds.length;
        const rented = beds.filter(b => bedOccupied(b.name)).length;
        const vacant = totalBeds - rented;

        return `
            <div class="rooms-toolbar">
                <div class="rooms-stats">
                    共 <strong>${roomNumbers.length}</strong> 間房 · <strong>${totalBeds}</strong> 張床 ·
                    <span style="color: var(--color-success);">已租 ${rented}</span> ·
                    <span style="color: var(--color-warning);">空 ${vacant}</span>
                </div>
                <button class="btn btn-primary" data-action="add-room">
                    <i class="ph ph-plus"></i> 新增房間
                </button>
            </div>
            ${roomNumbers.length === 0
                ? `<div class="rooms-empty">
                        <i class="ph ph-bed" style="font-size: 2.5rem; color: var(--text-muted);"></i>
                        <p style="margin: 0.75rem 0 0.25rem; font-weight: 600;">此館別尚無房間</p>
                        <p style="margin: 0; font-size: var(--text-xs); color: var(--text-muted);">點選右上角「新增房間」開始建立</p>
                   </div>`
                : roomNumbers.map(rn => renderRoom(rn, rooms[rn])).join('')}
        `;
    }

    function renderRoom(roomNumber, beds) {
        const sample = beds[0];
        const gender = sample?.gender;
        const capacity = sample?.capacity;
        const genderClass = gender === '男' ? 'info' : gender === '女' ? 'danger' : 'primary';
        const roomTypeLabel = formatRoomType(gender, capacity);

        return `
            <div class="room-card">
                <div class="room-card-header">
                    <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                        <strong style="font-size: 1.1rem;">R${roomNumber}</strong>
                        <span class="status-badge ${genderClass}">${roomTypeLabel}</span>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">${beds.length} 張床</span>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">·</span>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">月租總計 <strong style="color: var(--color-success);">$${beds.reduce((s, b) => s + (b.rent || 0), 0).toLocaleString()}</strong></span>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" data-action="edit-room" data-room="${roomNumber}" title="編輯房間（房型/樓層）">
                            <i class="ph ph-pencil"></i>
                        </button>
                        <button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs); color: var(--color-danger);" data-action="delete-room" data-room="${roomNumber}" title="刪除整個房間">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="bed-list">
                    ${beds.map(renderBed).join('')}
                    <button class="bed-add-btn" data-action="add-bed" data-room="${roomNumber}">
                        <i class="ph ph-plus"></i> 新增床位（建議 <strong>${nextLetter(beds)}</strong>）
                    </button>
                </div>
            </div>
        `;
    }

    function renderBed(bed) {
        return `
            <div class="bed-row">
                <div class="bed-letter">${bed.bedLetter || '?'}</div>
                <div class="bed-main">
                    <span style="font-weight: 500;">床位 ${bed.bedLetter || '?'}</span>
                    <span style="color: var(--text-muted); font-size: var(--text-xs);">·</span>
                    <span style="font-weight: 600; color: var(--color-success);">$${(bed.rent || 0).toLocaleString()}</span>
                    <span style="font-size: var(--text-2xs); color: var(--text-muted);">/月</span>
                </div>
                <div style="display: flex; gap: 0.25rem;">
                    <button class="btn btn-outline" style="padding: 0.2rem 0.4rem; font-size: var(--text-2xs);" data-action="edit-bed" data-id="${bed.id}" title="編輯床位">
                        <i class="ph ph-pencil"></i>
                    </button>
                    <button class="btn btn-outline" style="padding: 0.2rem 0.4rem; font-size: var(--text-2xs); color: var(--color-danger);" data-action="delete-bed" data-id="${bed.id}" title="刪除床位">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    function refresh() {
        if (!modalBody) return;
        modalBody.innerHTML = renderBody();
        bindActions();
    }

    function bindActions() {
        modalBody.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const roomNumber = btn.dataset.room ? parseInt(btn.dataset.room, 10) : null;
                const bedId = btn.dataset.id;

                if (action === 'add-room') showRoomForm(buildingId, null, refresh);
                if (action === 'edit-room') showRoomForm(buildingId, roomNumber, refresh);
                if (action === 'delete-room') confirmDeleteRoom(buildingId, roomNumber, refresh);
                if (action === 'add-bed') {
                    const beds = mockData.properties.filter(p => p.buildingId === buildingId && p.roomNumber === roomNumber);
                    const sample = beds[0];
                    const preset = {
                        buildingId,
                        roomNumber,
                        bedLetter: nextLetter(beds),
                        gender: sample?.gender,
                        capacity: sample?.capacity
                    };
                    showPropertyForm(null, preset, { structuralOnly: true });
                    waitForModalClose(refresh);
                }
                if (action === 'edit-bed') {
                    const bed = mockData.properties.find(p => p.id === bedId);
                    if (bed) {
                        showPropertyForm(bed, null, { structuralOnly: true });
                        waitForModalClose(refresh);
                    }
                }
                if (action === 'delete-bed') {
                    const bed = mockData.properties.find(p => p.id === bedId);
                    if (bed) confirmDeleteBed(bed, refresh);
                }
            });
        });
    }

    openModal({
        title: `管理房間與床位 — ${building.name}`,
        bodyHtml: renderBody(),
        maxWidth: 900,
        footerHtml: `<button type="button" class="btn btn-outline" data-action="close-rooms-modal">關閉</button>`,
        onMount: (overlay, close) => {
            modalBody = overlay.querySelector('.modal-body');
            overlay.querySelector('[data-action="close-rooms-modal"]').addEventListener('click', close);
            bindActions();
        },
        onClose: () => {
            refreshView();
        }
    });
}

// 等子 modal 關閉後再呼叫 callback（用 polling，因為 openFormModal 沒提供 promise）
function waitForModalClose(callback) {
    const initialCount = document.querySelectorAll('.modal-overlay').length;
    const tick = () => {
        const now = document.querySelectorAll('.modal-overlay').length;
        if (now < initialCount) callback();
        else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function showRoomForm(buildingId, existingRoomNumber, onDone) {
    const isEdit = existingRoomNumber !== null && existingRoomNumber !== undefined;
    const existingBeds = isEdit
        ? mockData.properties.filter(p => p.buildingId === buildingId && p.roomNumber === existingRoomNumber)
        : [];
    const sample = existingBeds[0];
    const building = mockData.buildings.find(b => b.id === buildingId);

    const fields = isEdit
        ? [
            { name: 'roomNumber', label: '房間編號', type: 'number', required: true, value: existingRoomNumber, hint: '改編號會連動所有床位' },
            { name: 'gender', label: '性別', type: 'select', required: true, options: GENDER_OPTIONS, value: sample?.gender ?? '男' },
            { name: 'capacity', label: '人數 / 房', type: 'number', required: true, value: sample?.capacity ?? 4, span: 2, hint: '會連動更新同房所有床位的房型' }
          ]
        : [
            { name: 'roomNumber', label: '房間編號', type: 'number', required: true, placeholder: '例：3' },
            { name: 'gender', label: '性別', type: 'select', required: true, options: GENDER_OPTIONS, value: '男' },
            { name: 'capacity', label: '人數 / 房', type: 'number', required: true, value: 4, hint: '此房間總共幾張床位' },
            { name: 'bedCount', label: '建立床位數', type: 'number', required: true, value: 4, hint: '通常等於房間人數' },
            { name: 'startLetter', label: '起始字母', type: 'text', value: 'A', hint: '通常從 A 開始' },
            { name: 'rent', label: '預設租金', type: 'number', required: true, placeholder: '例：18000', hint: '套用到所有新建床位（之後可分別修改）' }
          ];

    openFormModal({
        title: isEdit ? `編輯房間 R${existingRoomNumber} — ${building.name}` : `新增房間 — ${building.name}`,
        maxWidth: 560,
        fields,
        values: isEdit ? { roomNumber: existingRoomNumber, gender: sample?.gender ?? '男', capacity: sample?.capacity ?? 4 } : {},
        submitLabel: isEdit ? '儲存變更' : '建立房間',
        onSubmit: (values) => {
            if (isEdit) {
                const newRoomNumber = values.roomNumber;
                if (newRoomNumber !== existingRoomNumber) {
                    const dup = mockData.properties.some(p =>
                        p.buildingId === buildingId && p.roomNumber === newRoomNumber
                    );
                    if (dup) {
                        showToast(`房間 R${newRoomNumber} 已存在於此館別`, 'danger');
                        return false;
                    }
                }
                const fullAddress = building.baseAddress || sample?.address || '';
                existingBeds.forEach(bed => {
                    const newName = `聚空間 - ${building.name} R${newRoomNumber}-${bed.bedLetter}`;
                    const oldName = bed.name;
                    store.updateProperty(bed.id, {
                        roomNumber: newRoomNumber,
                        gender: values.gender,
                        capacity: values.capacity,
                        address: fullAddress,
                        name: newName
                    });
                    if (oldName && newName !== oldName) {
                        mockData.contracts.forEach(c => { if (c.propertyName === oldName) c.propertyName = newName; });
                        mockData.invoices.forEach(inv => { if (inv.propertyName === oldName) inv.propertyName = newName; });
                        mockData.maintenances.forEach(m => { if (m.propertyName === oldName) m.propertyName = newName; });
                        mockData.checkins.forEach(ci => { if (ci.propertyName === oldName) ci.propertyName = newName; });
                        mockData.tenants.forEach(t => { if (t.currentProperty === oldName) t.currentProperty = newName; });
                    }
                });
                showToast(`已更新房間 R${newRoomNumber}（${existingBeds.length} 張床位）`, 'success');
            } else {
                const dup = mockData.properties.some(p =>
                    p.buildingId === buildingId && p.roomNumber === values.roomNumber
                );
                if (dup) {
                    showToast(`房間 R${values.roomNumber} 已存在於此館別`, 'danger');
                    return false;
                }
                const startLetter = (values.startLetter || 'A').toUpperCase().charCodeAt(0);
                if (startLetter < 65 || startLetter > 90) {
                    showToast('起始字母必須是 A-Z', 'danger');
                    return false;
                }
                const fullAddress = building.baseAddress || '';
                const created = [];
                for (let i = 0; i < values.bedCount; i++) {
                    const letter = String.fromCharCode(startLetter + i);
                    if (letter > 'Z') break;
                    const newBed = store.addProperty({
                        buildingId,
                        roomNumber: values.roomNumber,
                        bedLetter: letter,
                        gender: values.gender,
                        capacity: values.capacity,
                        name: `聚空間 - ${building.name} R${values.roomNumber}-${letter}`,
                        address: fullAddress,
                        status: '待租',
                        rent: values.rent,
                        tenant: null,
                        contractId: null,
                        contractEnd: null
                    });
                    created.push(newBed);
                }
                showToast(`已新增房間 R${values.roomNumber}（${created.length} 張床位）`, 'success');
            }
            if (onDone) onDone();
        }
    });
}

function confirmDeleteRoom(buildingId, roomNumber, onDone) {
    const beds = mockData.properties.filter(p => p.buildingId === buildingId && p.roomNumber === roomNumber);
    if (beds.length === 0) return;
    const occupied = beds.filter(b => b.tenant || b.contractId);
    const warning = occupied.length > 0
        ? `<br><br><span style="color: var(--color-danger);"><i class="ph ph-warning"></i> 注意：其中 ${occupied.length} 張床位有租客或合約綁定，刪除後對應租客的物件指向會失效。</span>`
        : '';
    openConfirm({
        title: `刪除房間 R${roomNumber}`,
        message: `確定要刪除 R${roomNumber} 嗎？將連帶刪除 <strong>${beds.length}</strong> 張床位（${beds.map(b => b.bedLetter).join('、')}）。${warning}`,
        danger: true,
        confirmLabel: `確定刪除整間房`,
        onConfirm: () => {
            beds.forEach(b => store.deleteProperty(b.id));
            showToast(`已刪除房間 R${roomNumber}`, 'success');
            if (onDone) onDone();
        }
    });
}

function confirmDeleteBed(bed, onDone) {
    openConfirm({
        title: '刪除床位',
        message: `確定要刪除 <strong>${bed.name}</strong> 嗎？${bed.tenant ? `<br><br><span style="color: var(--color-danger);"><i class="ph ph-warning"></i> 此床位目前有租客（${bed.tenant}）</span>` : ''}`,
        danger: true,
        confirmLabel: '確定刪除',
        onConfirm: () => {
            store.deleteProperty(bed.id);
            showToast('已刪除床位', 'success');
            if (onDone) onDone();
        }
    });
}

function toggleBuildingStatus(id) {
    const b = mockData.buildings.find(x => x.id === id);
    if (!b) return;
    const willBe = b.status === 'active' ? '停用' : '啟用';
    openConfirm({
        title: `${willBe}館別`,
        message: `確定要將「<strong>${b.name}</strong>」改為「${willBe}」嗎？<br><br>${willBe === '停用' ? '停用後將無法在新增床位時選擇此館別，但歷史資料仍可查詢。' : '啟用後可重新使用此館別。'}`,
        confirmLabel: `確定${willBe}`,
        danger: willBe === '停用',
        onConfirm: () => {
            store.toggleBuildingStatus(id);
            showToast(`${b.name}已${willBe}`, 'success');
            refreshView();
        }
    });
}

// === Tab: 帳單類型 ===
function renderInvoiceTypesTab() {
    const { invoiceTypes, invoices } = mockData;
    const usedCount = (name) => invoices.filter(inv => inv.type === name).length;

    const rows = invoiceTypes.map(it => {
        const used = usedCount(it.name);
        return `
            <tr>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <strong>${it.name}</strong>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">${it.id}</span>
                    </div>
                </td>
                <td><strong>${used}</strong> <span style="font-size: var(--text-xs); color: var(--text-muted);">張帳單使用</span></td>
                <td><span style="font-size: var(--text-base); color: var(--text-muted);">${it.note || '—'}</span></td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-outline invoicetype-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" data-action="edit" data-id="${it.id}" title="編輯類型">
                            <i class="ph ph-pencil"></i>
                        </button>
                        <button class="btn btn-outline invoicetype-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs); ${used === 0 ? 'color: var(--color-danger);' : 'opacity: 0.4; cursor: not-allowed;'}" data-action="delete" data-id="${it.id}" title="${used === 0 ? '刪除' : '已被使用，無法刪除'}">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <div>
                    <h2 class="card-title" style="margin-bottom: 0.25rem;"><i class="ph ph-receipt"></i> 帳單類型</h2>
                    <p style="font-size: var(--text-xs); color: var(--text-muted); margin: 0;">新增帳單時可選擇的類型；改名會連動已存在的帳單</p>
                </div>
                <button class="btn btn-primary" id="btn-new-invoicetype">
                    <i class="ph ph-plus"></i> 新增類型
                </button>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>類型名稱</th><th>使用中</th><th>備註</th><th>操作</th></tr></thead>
                    <tbody>${rows || `<tr><td colspan="4" style="text-align: center; padding: 3rem; color: var(--text-muted);">尚無類型資料</td></tr>`}</tbody>
                </table>
            </div>
        </div>
    `;
}

function showInvoiceTypeForm(invoiceType = null) {
    const isEdit = !!invoiceType;
    openFormModal({
        title: isEdit ? `編輯類型：${invoiceType.name}` : '新增帳單類型',
        maxWidth: 480,
        fields: [
            { name: 'name', label: '類型名稱', type: 'text', required: true, span: 2, placeholder: '例：清潔費' },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 2 }
        ],
        values: invoiceType ?? {},
        submitLabel: isEdit ? '儲存變更' : '建立',
        onSubmit: (values) => {
            const dup = mockData.invoiceTypes.find(it => it.name === values.name && it.id !== invoiceType?.id);
            if (dup) {
                showToast(`類型名稱「${values.name}」已存在`, 'danger');
                return false;
            }
            if (isEdit) {
                store.updateInvoiceType(invoiceType.id, values);
                showToast(`已更新：${values.name}`, 'success');
            } else {
                const created = store.addInvoiceType(values);
                showToast(`已新增類型：${created.name}`, 'success');
            }
            refreshView();
        }
    });
}

function deleteInvoiceType(id) {
    const it = mockData.invoiceTypes.find(x => x.id === id);
    if (!it) return;
    openConfirm({
        title: '刪除帳單類型',
        message: `確定要刪除「<strong>${it.name}</strong>」嗎？`,
        danger: true,
        confirmLabel: '確定刪除',
        onConfirm: () => {
            const result = store.deleteInvoiceType(id);
            if (result.error === 'in_use') {
                showToast('此類型仍有帳單使用中，無法刪除', 'danger');
                return;
            }
            showToast('已刪除類型', 'success');
            refreshView();
        }
    });
}

// === Tab: 顧客來源 / 付款方式 (共用 simple list 模式) ===
// kind: 'tenantSource' | 'paymentMethod'
const SIMPLE_LIST_CONFIG = {
    tenantSource: {
        title: '顧客來源',
        icon: 'ph-user-circle',
        desc: '建立新租客時可選擇的來源；改名會連動已存在的租客資料',
        dataKey: 'tenantSources',
        usageCounter: (name) => mockData.tenants.filter(t => t.source === name).length,
        usageLabel: '位租客使用',
        placeholder: '例：Facebook / 591 / 朋友介紹',
        store: { add: store.addTenantSource, update: store.updateTenantSource, delete: store.deleteTenantSource }
    },
    paymentMethod: {
        title: '付款方式',
        icon: 'ph-credit-card',
        desc: '建立合約 / 帳單時可選擇的付款方式；改名會連動已存在的帳單',
        dataKey: 'paymentMethods',
        usageCounter: (name) => mockData.invoices.filter(inv => inv.paymentMethod === name).length,
        usageLabel: '張帳單使用',
        placeholder: '例：匯款 / 現金 / 信用卡 / LINE Pay',
        store: { add: store.addPaymentMethod, update: store.updatePaymentMethod, delete: store.deletePaymentMethod }
    }
};

function renderSimpleListTab(kind) {
    const cfg = SIMPLE_LIST_CONFIG[kind];
    const items = mockData[cfg.dataKey] || [];
    const rows = items.map(it => {
        const used = cfg.usageCounter(it.name);
        return `
            <tr>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <strong>${it.name}</strong>
                        <span style="font-size: var(--text-xs); color: var(--text-muted);">${it.id}</span>
                    </div>
                </td>
                <td><strong>${used}</strong> <span style="font-size: var(--text-xs); color: var(--text-muted);">${cfg.usageLabel}</span></td>
                <td><span style="font-size: var(--text-base); color: var(--text-muted);">${it.note || '—'}</span></td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-outline simplelist-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs);" data-action="edit" data-kind="${kind}" data-id="${it.id}" title="編輯">
                            <i class="ph ph-pencil"></i>
                        </button>
                        <button class="btn btn-outline simplelist-action" style="padding: 0.25rem 0.5rem; font-size: var(--text-xs); ${used === 0 ? 'color: var(--color-danger);' : 'opacity: 0.4; cursor: not-allowed;'}" data-action="delete" data-kind="${kind}" data-id="${it.id}" title="${used === 0 ? '刪除' : '已被使用，無法刪除'}">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <div>
                    <h2 class="card-title" style="margin-bottom: 0.25rem;"><i class="ph ${cfg.icon}"></i> ${cfg.title}</h2>
                    <p style="font-size: var(--text-xs); color: var(--text-muted); margin: 0;">${cfg.desc}</p>
                </div>
                <button class="btn btn-primary" data-action="new-simplelist" data-kind="${kind}">
                    <i class="ph ph-plus"></i> 新增${cfg.title}
                </button>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>名稱</th><th>使用中</th><th>備註</th><th>操作</th></tr></thead>
                    <tbody>${rows || `<tr><td colspan="4" style="text-align: center; padding: 3rem; color: var(--text-muted);">尚無資料</td></tr>`}</tbody>
                </table>
            </div>
        </div>
    `;
}

function showSimpleListForm(kind, item = null) {
    const cfg = SIMPLE_LIST_CONFIG[kind];
    const isEdit = !!item;
    openFormModal({
        title: isEdit ? `編輯${cfg.title}：${item.name}` : `新增${cfg.title}`,
        maxWidth: 480,
        fields: [
            { name: 'name', label: '名稱', type: 'text', required: true, span: 2, placeholder: cfg.placeholder },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 2 }
        ],
        values: item ?? {},
        submitLabel: isEdit ? '儲存變更' : '建立',
        onSubmit: (values) => {
            const list = mockData[cfg.dataKey] || [];
            const dup = list.find(x => x.name === values.name && x.id !== item?.id);
            if (dup) {
                showToast(`「${values.name}」已存在`, 'danger');
                return false;
            }
            if (isEdit) {
                cfg.store.update(item.id, values);
                showToast(`已更新：${values.name}`, 'success');
            } else {
                const created = cfg.store.add(values);
                showToast(`已新增：${created.name}`, 'success');
            }
            refreshView();
        }
    });
}

function deleteSimpleListItem(kind, id) {
    const cfg = SIMPLE_LIST_CONFIG[kind];
    const item = (mockData[cfg.dataKey] || []).find(x => x.id === id);
    if (!item) return;
    openConfirm({
        title: `刪除${cfg.title}`,
        message: `確定要刪除「<strong>${item.name}</strong>」嗎？`,
        danger: true,
        confirmLabel: '確定刪除',
        onConfirm: () => {
            const result = cfg.store.delete(id);
            if (result.error === 'in_use') {
                showToast(`此${cfg.title}仍有資料使用中，無法刪除`, 'danger');
                return;
            }
            showToast('已刪除', 'success');
            refreshView();
        }
    });
}

// === Tab: 合約範本 ===
function renderContractTemplatesTab() {
    const buildings = getSortedBuildings({ activeOnly: true });
    const templates = mockData.contractTemplates || [];

    const rows = buildings.map(b => {
        const tpl = templates.find(t => t.buildingId === b.id);
        const uploaded = tpl ? new Date(tpl.uploadedAt).toLocaleString('zh-TW', { hour12: false }) : null;
        // 防呆: pdfBase64 可能是 null (雲端同步沒回傳) — 顯示 0 KB + 損壞 badge
        const isBroken = tpl && (!tpl.pdfBase64 || tpl.pdfBase64.length < 200);
        const sizeKB = tpl?.pdfBase64 ? Math.round(tpl.pdfBase64.length * 0.75 / 1024) : 0;

        return `
            <tr>
                <td>
                    <strong>${b.name}</strong>
                    <div style="font-size: var(--text-xs); color: var(--text-muted);">${b.baseAddress || '—'}</div>
                </td>
                <td>
                    ${tpl
                        ? `<div style="display: flex; flex-direction: column;">
                                <span style="font-weight: 500; font-size: var(--text-base);"><i class="ph ph-file-pdf" style="color: ${isBroken ? 'var(--color-danger)' : 'var(--color-success)'};"></i> ${tpl.fileName}${isBroken ? ' <span style="background: rgba(177,53,53,0.12); color: var(--color-danger); padding: 0.1rem 0.45rem; border-radius: 99px; font-size: var(--text-2xs); font-weight: 600; margin-left: 0.3rem;">⚠ 內容遺失</span>' : ''}</span>
                                <span style="font-size: var(--text-xs); color: ${isBroken ? 'var(--color-danger)' : 'var(--text-muted)'};">${sizeKB} KB · ${uploaded}${isBroken ? ' · 請先刪除後重新上傳' : ''}</span>
                           </div>`
                        : '<span style="color: var(--text-muted); font-size: var(--text-base);">尚未上傳樣板</span>'
                    }
                </td>
                <td>
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                        <label class="btn btn-outline" style="padding: 0.3rem 0.7rem; font-size: var(--text-xs); cursor: pointer;">
                            <i class="ph ph-upload-simple"></i> ${tpl ? '更換' : '上傳'} PDF
                            <input type="file" accept="application/pdf" style="display: none;" class="tpl-upload" data-building-id="${b.id}">
                        </label>
                        ${tpl ? `
                            <button class="btn btn-outline tpl-action" style="padding: 0.3rem 0.7rem; font-size: var(--text-xs);" data-action="test" data-building-id="${b.id}" title="用範例資料套版測試">
                                <i class="ph ph-flask"></i> 測試套版
                            </button>
                            <button class="btn btn-outline tpl-action" style="padding: 0.3rem 0.7rem; font-size: var(--text-xs);" data-action="inspect" data-building-id="${b.id}" title="列出 PDF 內的欄位">
                                <i class="ph ph-list-magnifying-glass"></i> 檢查欄位
                            </button>
                            <button class="btn btn-outline tpl-action" style="padding: 0.3rem 0.7rem; font-size: var(--text-xs); color: var(--color-danger);" data-action="delete" data-building-id="${b.id}" title="刪除樣板">
                                <i class="ph ph-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="card" style="margin-bottom: 1.25rem;">
            <h2 class="card-title"><i class="ph ph-info"></i> 樣板準備說明</h2>
            <div style="font-size: var(--text-base); line-height: 1.7;">
                <p style="margin: 0 0 0.75rem;">每個館別上傳一份 <strong>含可填入欄位</strong> 的 PDF 合約樣板。系統產生合約時會自動填入下列欄位：</p>
                <table style="width: auto; font-size: var(--text-sm); border-collapse: collapse; margin-bottom: 0.75rem;">
                    <thead>
                        <tr><th colspan="3" style="text-align: left; padding: 0.3rem 0; color: var(--text-secondary); font-size: var(--text-xs); border-bottom: 1px solid var(--border-color);">必要欄位</th></tr>
                    </thead>
                    <tbody>
                        <tr><td style="padding: 0.25rem 1rem 0.25rem 0;"><code style="background: var(--color-background); padding: 0.15rem 0.4rem; border-radius: 4px;">bed_no</code></td><td style="color: var(--text-muted);">床號（例：R1-A）</td></tr>
                        <tr><td style="padding: 0.25rem 1rem 0.25rem 0;"><code style="background: var(--color-background); padding: 0.15rem 0.4rem; border-radius: 4px;">tenant_name</code></td><td style="color: var(--text-muted);">乙方姓名（例：王大明）</td></tr>
                        <tr><td style="padding: 0.25rem 1rem 0.25rem 0;"><code style="background: var(--color-background); padding: 0.15rem 0.4rem; border-radius: 4px;">rental_period</code></td><td style="color: var(--text-muted);">租賃期間（例：2026/05/01 ~ 2026/07/30）</td></tr>
                        <tr><td style="padding: 0.25rem 1rem 0.25rem 0;"><code style="background: var(--color-background); padding: 0.15rem 0.4rem; border-radius: 4px;">rent_amount</code></td><td style="color: var(--text-muted);">月租金（例：18,000，已含千分位）</td></tr>
                        <tr><td style="padding: 0.25rem 1rem 0.25rem 0;"><code style="background: var(--color-background); padding: 0.15rem 0.4rem; border-radius: 4px;">deposit_amount</code></td><td style="color: var(--text-muted);">押金金額（例：0 或 18,000）</td></tr>
                    </tbody>
                    <thead>
                        <tr><th colspan="3" style="text-align: left; padding: 0.65rem 0 0.3rem; color: var(--text-secondary); font-size: var(--text-xs); border-bottom: 1px solid var(--border-color);">選填欄位 — 折扣 / 加收 (季繳優惠、能源費等)</th></tr>
                    </thead>
                    <tbody>
                        <tr><td style="padding: 0.25rem 1rem 0.25rem 0;"><code style="background: var(--color-background); padding: 0.15rem 0.4rem; border-radius: 4px;">adjustments</code></td><td style="color: var(--text-muted);">加減項目明細，多筆換行（例：<br>− 季繳優惠：−$1,000<br>+ 能源費：+$500）<br><small>欄位請設為「多行文字」(Multi-line)</small></td></tr>
                        <tr><td style="padding: 0.25rem 1rem 0.25rem 0;"><code style="background: var(--color-background); padding: 0.15rem 0.4rem; border-radius: 4px;">total_amount</code></td><td style="color: var(--text-muted);"><strong>租金總額</strong>（整個合約期，加減後）<br>= 月租 × 合約期 + 加收 − 折扣<br><small>例：月租 $10,000 × 3 月 − 季繳優惠 $1,000 = 29,000</small></td></tr>
                        <tr><td style="padding: 0.25rem 1rem 0.25rem 0;"><code style="background: var(--color-background); padding: 0.15rem 0.4rem; border-radius: 4px;">monthly_amount</code></td><td style="color: var(--text-muted);"><strong>月付金額</strong>（每月實際付多少）= 租金總額 ÷ 合約期<br><small>1 個月 → 跟 total_amount 相同；3 個月合約 → 平均到每月（四捨五入到整數）</small></td></tr>
                    </tbody>
                </table>
                <p style="margin: 0; color: var(--text-muted); font-size: var(--text-xs);">
                    💡 在 Adobe Acrobat 或 <a href="https://www.pdfescape.com/open/" target="_blank" rel="noopener" style="color: var(--color-primary);">PDFescape</a>（免費線上）等工具中，到「準備表單」功能加入這些文字欄位，命名為上述名稱。<br>
                    📝 沒有加減項目時，<code>adjustments</code> 會填空字串、<code>total_amount</code> 等於 <code>rent_amount</code>。樣板沒加這兩個欄位也沒影響，只是合約上不會印出折扣 / 加收明細。
                </p>
            </div>
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-file-pdf"></i> 各館合約樣板</h2>
                <span style="font-size: var(--text-xs); color: var(--text-muted);">總計 ${templates.length} / ${buildings.length} 已上傳</span>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>館別</th>
                            <th>已上傳樣板</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>${rows || `<tr><td colspan="3" style="text-align: center; padding: 3rem; color: var(--text-muted);">尚無啟用中館別</td></tr>`}</tbody>
                </table>
            </div>
        </div>
    `;
}

// 樣板測試套版（用範例值）
async function testFillTemplate(buildingId) {
    const tpl = store.getContractTemplate(buildingId);
    const building = mockData.buildings.find(b => b.id === buildingId);
    if (!tpl || !building) return;
    if (!tpl.pdfBase64) {
        showToast('樣板資料不完整 (PDF 內容缺失)，請重新上傳', 'danger', 5000);
        return;
    }

    try {
        const result = await fillContractPdf(tpl.pdfBase64, {
            bed_no: 'R1-A',
            tenant_name: '王大明',
            rental_period: formatRentalPeriod('2026-05-01', '2026-07-30'),
            rent_amount: '18,000',
            deposit_amount: '0'
        });
        if (result.filledFields.length === 0) {
            showToast(`未填入任何欄位 (PDF 中找不到任何已定義的欄位)`, 'danger');
            return;
        }
        previewPdfBytes(result.bytes);
        showToast(`已套版 ${result.filledFields.length} 個欄位`, 'success');
    } catch (e) {
        showToast(`套版失敗：${e.message}`, 'danger', 5000);
    }
}

async function inspectTemplate(buildingId) {
    const tpl = store.getContractTemplate(buildingId);
    if (!tpl) return;
    if (!tpl.pdfBase64) {
        showToast('樣板資料不完整 (PDF 內容缺失)，請重新上傳', 'danger', 5000);
        return;
    }
    try {
        const fields = await listPdfFields(tpl.pdfBase64);
        if (fields.length === 0) {
            openConfirm({
                title: '此 PDF 無表單欄位',
                message: `「${tpl.fileName}」沒有可填入的表單欄位。<br><br>請先在 Adobe Acrobat / PDFescape 加入 <code>bed_no</code>、<code>tenant_name</code>、<code>rental_period</code> 三個文字欄位，再重新上傳。`,
                confirmLabel: '了解',
                cancelLabel: ''
            });
            return;
        }
        // 必要：bed_no / tenant_name / rental_period 是最基本識別
        // 選填：所有金額欄位 (用戶可只用 total_amount + monthly_amount 也行，不一定要 rent_amount)
        const REQUIRED = ['bed_no', 'tenant_name', 'rental_period'];
        const OPTIONAL = ['rent_amount', 'deposit_amount', 'adjustments', 'total_amount', 'monthly_amount'];
        const KNOWN = [...REQUIRED, ...OPTIONAL];
        const list = fields.map(f => {
            const isKnown = KNOWN.includes(f.name);
            const icon = isKnown ? '✅' : '⚠️';
            const note = isKnown ? '' : ' <small style="color: var(--text-muted); font-family: inherit;">(系統不認識，不會自動填)</small>';
            return `<li style="font-family: monospace;">${icon} <code>${f.name}</code> <span style="color: var(--text-muted); font-family: inherit;">${f.type.replace('PDF', '').replace('Field', '')}</span>${note}</li>`;
        }).join('');
        const missing = REQUIRED.filter(r => !fields.find(f => f.name === r));
        const missingHtml = missing.length
            ? `<p style="color: var(--color-danger); margin-top: 0.75rem;">缺少必要欄位：${missing.map(m => `<code>${m}</code>`).join(', ')}</p>`
            : '<p style="color: var(--color-success); margin-top: 0.75rem;">✅ 必要欄位都齊全</p>';
        openConfirm({
            title: `${tpl.fileName} 內的欄位`,
            message: `<ul style="margin: 0; padding-left: 1.25rem; font-size: var(--text-base);">${list}</ul>${missingHtml}`,
            confirmLabel: '關閉',
            cancelLabel: ''
        });
    } catch (e) {
        showToast(`檢查失敗：${e.message}`, 'danger');
    }
}

async function handleTemplateUpload(file, buildingId) {
    if (!file) return;
    if (file.type !== 'application/pdf') {
        showToast('請選擇 PDF 檔案', 'danger');
        return;
    }
    // 防呆: 空檔
    if (file.size === 0) {
        showToast('PDF 檔案是空的 (0 bytes)，請換一份', 'danger', 5000);
        return;
    }
    // 防呆: 太大 (Supabase row 限制邊緣案例 > 4 MB 容易掛)
    if (file.size > 4 * 1024 * 1024) {
        showToast(`檔案 ${Math.round(file.size / 1024 / 1024 * 10) / 10} MB 偏大，建議壓縮到 < 4 MB 再上傳避免雲端寫入失敗`, 'warning', 6000);
    }
    showToast('上傳中...', 'info', 2500);
    try {
        const base64 = await fileToBase64(file);
        // 防呆: base64 轉碼失敗 / 內容過短
        if (!base64 || base64.length < 200) {
            throw new Error('檔案轉碼為空或過短，可能是損壞的 PDF');
        }
        store.setContractTemplate(buildingId, file.name, base64);
        // 驗證: 寫入後本機 mockData 內容是否真的有 base64 (還沒到雲端，先確認本機)
        const verified = store.getContractTemplate(buildingId);
        if (!verified?.pdfBase64 || verified.pdfBase64.length < 200) {
            throw new Error('本機儲存後驗證失敗');
        }
        const kb = Math.round(file.size / 1024);
        showToast(`✅ 已上傳 ${file.name} (${kb} KB) · 同步雲端中...`, 'success', 4000);
        refreshView();
        // 5 秒後再次驗證 (雲端往返時間夠了)，若 mockData 被 pull 覆蓋成 null → 警告
        setTimeout(() => {
            const final = store.getContractTemplate(buildingId);
            if (!final?.pdfBase64 || final.pdfBase64.length < 200) {
                showToast(`⚠ ${file.name} 雲端同步後內容遺失，請壓縮 PDF 後重新上傳 (檔案過大或網路問題)`, 'danger', 8000);
                refreshView();
            }
        }, 5000);
    } catch (e) {
        showToast(`上傳失敗：${e.message}`, 'danger', 6000);
    }
}

function deleteTemplate(buildingId) {
    const tpl = store.getContractTemplate(buildingId);
    const building = mockData.buildings.find(b => b.id === buildingId);
    if (!tpl) return;
    openConfirm({
        title: '刪除合約樣板',
        message: `確定要刪除「${building?.name}」的樣板（${tpl.fileName}）嗎？`,
        danger: true,
        confirmLabel: '確定刪除',
        onConfirm: () => {
            store.removeContractTemplate(buildingId);
            showToast('已刪除樣板', 'success');
            refreshView();
        }
    });
}

// === 切換 tab + 綁定動作 ===
let currentTab = 'buildings';

function rebindActions(scope) {
    // 館別
    scope.querySelector('#btn-new-building')?.addEventListener('click', () => showBuildingForm());
    scope.querySelectorAll('.building-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const id = e.currentTarget.dataset.id;
            const b = mockData.buildings.find(x => x.id === id);
            if (!b) return;
            if (action === 'edit') showBuildingForm(b);
            if (action === 'toggle') toggleBuildingStatus(id);
            if (action === 'manage') showBuildingRoomsModal(id);
        });
    });

    // 帳單類型
    scope.querySelector('#btn-new-invoicetype')?.addEventListener('click', () => showInvoiceTypeForm());
    scope.querySelectorAll('.invoicetype-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const id = e.currentTarget.dataset.id;
            const it = mockData.invoiceTypes.find(x => x.id === id);
            if (!it) return;
            if (action === 'edit') showInvoiceTypeForm(it);
            if (action === 'delete') deleteInvoiceType(id);
        });
    });

    // 顧客來源 / 付款方式 (共用 simple list)
    scope.querySelectorAll('[data-action="new-simplelist"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            showSimpleListForm(e.currentTarget.dataset.kind);
        });
    });
    scope.querySelectorAll('.simplelist-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const kind = e.currentTarget.dataset.kind;
            const id = e.currentTarget.dataset.id;
            const cfg = SIMPLE_LIST_CONFIG[kind];
            const item = (mockData[cfg.dataKey] || []).find(x => x.id === id);
            if (!item) return;
            if (action === 'edit') showSimpleListForm(kind, item);
            if (action === 'delete') deleteSimpleListItem(kind, id);
        });
    });

    // 合約範本
    scope.querySelectorAll('.tpl-upload').forEach(input => {
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            const buildingId = e.target.dataset.buildingId;
            handleTemplateUpload(file, buildingId);
            e.target.value = ''; // 重設以便同檔可再次選
        });
    });
    scope.querySelectorAll('.tpl-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const buildingId = e.currentTarget.dataset.buildingId;
            if (action === 'test') testFillTemplate(buildingId);
            if (action === 'inspect') inspectTemplate(buildingId);
            if (action === 'delete') deleteTemplate(buildingId);
        });
    });
}

// === Tab: 雲端同步 ===
function renderSyncTab() {
    const s = (window.syncStatus && window.syncStatus()) || { status: 'idle', lastSync: null, error: null, online: navigator.onLine, realtimeConnected: false };
    const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('zh-TW') : '尚未同步過';
    const statusLabel = {
        idle: '✅ 閒置',
        pulling: '⬇️ 下載中',
        pushing: '⬆️ 上傳中',
        error: '⚠️ 錯誤',
        offline: '🚫 離線'
    }[s.status] || s.status;

    return `
        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <div>
                    <h2 class="card-title" style="margin-bottom: 0.25rem;"><i class="ph ph-cloud"></i> 雲端同步</h2>
                    <p style="font-size: var(--text-xs); color: var(--text-muted); margin: 0;">雲端優先模式 — Supabase 是唯一真實來源，多裝置即時同步</p>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
                <div style="padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                    <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 0.5rem;">同步狀態</div>
                    <div style="font-size: 1.1rem; font-weight: 600;">${statusLabel}</div>
                    ${s.error ? `<div style="font-size: var(--text-xs); color: var(--color-danger); margin-top: 0.5rem;">錯誤：${s.error}</div>` : ''}
                </div>
                <div style="padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                    <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 0.5rem;">即時連線</div>
                    <div style="font-size: 1.1rem; font-weight: 600;">${s.realtimeConnected ? '🟢 連線中' : '🔴 未連線'}</div>
                    <div style="font-size: var(--text-2xs); color: var(--text-muted); margin-top: 0.5rem;">${s.realtimeConnected ? '別人改的會立刻收到' : 'Realtime 未啟用 — 跑 SQL 03 啟用'}</div>
                </div>
                <div style="padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                    <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 0.5rem;">上次同步</div>
                    <div style="font-size: var(--text-md); font-weight: 500;">${fmtTime(s.lastSync)}</div>
                    <div style="font-size: var(--text-2xs); color: var(--text-muted); margin-top: 0.5rem;">網路：${s.online ? '✅ 線上' : '🚫 離線'}</div>
                </div>
            </div>

            <div style="display: flex; flex-wrap: wrap; gap: 0.75rem; padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius-md); margin-bottom: 1.5rem;">
                <button class="btn btn-outline sync-action" data-action="pull" title="從 Supabase 拉一次最新資料">
                    <i class="ph ph-cloud-arrow-down"></i> 立即下載
                </button>
                <button class="btn btn-outline sync-action" data-action="push" title="把本機所有資料推到 Supabase">
                    <i class="ph ph-cloud-arrow-up"></i> 立即上傳
                </button>
                <button class="btn btn-outline sync-action" data-action="migrate" title="一次性把全部 mockData 上傳（含 PDF）">
                    <i class="ph ph-database"></i> 完整遷移
                </button>
                <button class="btn btn-outline sync-action" data-action="clear-cache" style="margin-left: auto; color: var(--color-danger); border-color: var(--color-danger);" title="跑完 destructive SQL 後一鍵清，防止本機 stale 資料 push 回 Supabase 復活已刪除的 row">
                    <i class="ph ph-broom"></i> 清空本機快取重新同步
                </button>
            </div>

            <div style="padding: 1rem; background: var(--bg-tertiary, #1a1a1a); border-radius: var(--radius-md); font-size: var(--text-xs); line-height: 1.7; color: var(--text-muted);">
                <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;"><i class="ph ph-info"></i> 同步行為</div>
                <ul style="margin: 0; padding-left: 1.2rem;">
                    <li><strong>雲端優先</strong>：開機必拉完雲端資料才顯示 UI</li>
                    <li><strong>即時同步</strong>：A 電腦改 → B 電腦立刻看到 (Supabase Realtime)</li>
                    <li><strong>背景上傳</strong>：每次改動後 1.5 秒自動推到 Supabase</li>
                    <li><strong>合約 PDF</strong>：只在上傳新範本時推一次（不跟一般改動綁一起）</li>
                    <li><strong>斷網時</strong>：仍可瀏覽（用本機備援），恢復連線會自動補推</li>
                </ul>
            </div>

            <div style="margin-top: 1rem; padding: 1rem; background: var(--bg-tertiary, #1a1a1a); border-radius: var(--radius-md); font-size: var(--text-xs); color: var(--text-muted);">
                <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;"><i class="ph ph-warning-circle"></i> 已知限制</div>
                <ul style="margin: 0; padding-left: 1.2rem;">
                    <li>多人同時編輯同一筆資料時，後 push 的會贏（last-write-wins）</li>
                    <li>本機刪除的資料不會推到雲端 — 想真刪要走「刪除按鈕」(會發 DELETE 到 Supabase)</li>
                </ul>
            </div>

            <!-- E2: 一鍵備份 -->
            <div style="margin-top: 1.5rem;">
                <h3 style="font-size: var(--text-md); margin-bottom: 0.5rem; color: var(--text-primary);">
                    <i class="ph ph-archive"></i> 災難復原 — 手動備份
                </h3>
                <div style="padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0.875rem; margin-bottom: 0.875rem;">
                        <button class="btn btn-primary" id="btn-backup-download">
                            <i class="ph ph-download-simple"></i> 下載完整備份 (JSON)
                        </button>
                        <div style="font-size: var(--text-xs); color: var(--text-muted);">
                            上次備份：<strong id="last-backup-at">${fmtTime(getLastBackupAt())}</strong>
                        </div>
                    </div>
                    <div style="font-size: var(--text-xs); color: var(--text-muted); line-height: 1.6;">
                        建議 <strong>每週一次</strong>，下載後存到 Google Drive / OneDrive。雲端 Supabase 自己也有 daily auto backup (Pro 方案 7 天)，這份是雙保險。<br>
                        備份內含：所有資料表的完整資料 (snake_case) + contract-pdfs 檔案清單。<strong>PDF 二進位不含</strong>，那部分依賴 Supabase Storage 自身的備份。
                    </div>
                </div>
            </div>
        </div>
    `;
}

function bindSyncActions(scope) {
    scope.querySelectorAll('.sync-action').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            try {
                if (action === 'pull')     { showToast('開始下載…', 'info'); await window.pullFromSupabase(); showToast('下載完成', 'success'); }
                if (action === 'push')     { showToast('開始上傳…', 'info'); await window.pushToSupabase();   showToast('上傳完成', 'success'); }
                if (action === 'migrate')  { showToast('完整遷移中…', 'info'); await window.migrateToSupabase(); showToast('遷移完成', 'success'); }
                if (action === 'clear-cache') {
                    openConfirm({
                        title: '清空本機快取重新同步',
                        message: '<p>會清掉本機暫存 (<code>bananas-pms-data-v1</code> + <code>pms-last-sync</code>) 並重新從 Supabase 拉真實資料。</p><p style="color: var(--color-warning); margin-top: 0.5rem;"><strong>適用場景</strong>: 跑完 destructive SQL (例如 <code>DELETE FROM invoices</code>) 之後一定要清，否則本機 stale 資料會被 sync push 回 Supabase 復活已刪除 row。</p><p style="margin-top: 0.5rem; font-size: var(--text-sm); color: var(--text-muted);">未推送的本機改動會遺失。</p>',
                        confirmLabel: '清空 + 重新同步',
                        danger: true,
                        onConfirm: () => { window.clearLocalCacheAndReload(); }
                    });
                    return;
                }
                // 重繪面板（狀態可能變了）
                const content = document.getElementById('settings-content');
                if (content && currentTab === 'sync') {
                    content.innerHTML = renderSyncTab();
                    bindSyncActions(content);
                }
            } catch (e) {
                showToast(`操作失敗：${e.message}`, 'danger', 5000);
            }
        });
    });

    // E2: 一鍵備份
    const backupBtn = scope.querySelector('#btn-backup-download');
    if (backupBtn) {
        backupBtn.addEventListener('click', async () => {
            backupBtn.disabled = true;
            const originalHtml = backupBtn.innerHTML;
            backupBtn.innerHTML = '<i class="ph ph-spinner"></i> 備份中…';
            try {
                showToast('開始抓取雲端資料…', 'info');
                const result = await downloadBackup();
                const totalRows = Object.values(result.rowCounts)
                    .filter(v => typeof v === 'number')
                    .reduce((a, b) => a + b, 0);
                const errMsg = result.errors ? `（${result.errors.length} 個表失敗，請看 console）` : '';
                showToast(`✅ 已下載 ${result.filename}（${totalRows} 筆資料 / ${result.storageFileCount} 個 PDF / ${result.sizeKB} KB）${errMsg}`, 'success', 6000);
                if (result.errors) console.warn('[backup] 部分失敗:', result.errors);
                // 更新「上次備份」時間
                const lastEl = scope.querySelector('#last-backup-at');
                if (lastEl) {
                    const t = getLastBackupAt();
                    lastEl.textContent = t ? new Date(t).toLocaleString('zh-TW') : '從未';
                }
            } catch (e) {
                showToast(`備份失敗：${e.message}`, 'danger', 7000);
                console.error('[backup] failed:', e);
            } finally {
                backupBtn.disabled = false;
                backupBtn.innerHTML = originalHtml;
            }
        });
    }
}

export function initSettingsActions(scope) {
    const content = scope.querySelector('#settings-content');
    const tabs = scope.querySelectorAll('.settings-tab');

    function switchTo(name) {
        currentTab = name;
        tabs.forEach(t => t.classList.toggle('active', t.dataset.settingsTab === name));
        if (name === 'buildings') content.innerHTML = renderBuildingsTab();
        if (name === 'invoiceTypes') content.innerHTML = renderInvoiceTypesTab();
        if (name === 'tenantSources') content.innerHTML = renderSimpleListTab('tenantSource');
        if (name === 'paymentMethods') content.innerHTML = renderSimpleListTab('paymentMethod');
        if (name === 'contractTemplates') content.innerHTML = renderContractTemplatesTab();
        if (name === 'sync') { content.innerHTML = renderSyncTab(); bindSyncActions(content); }
        rebindActions(content);
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTo(tab.dataset.settingsTab));
    });

    switchTo(currentTab);
}
