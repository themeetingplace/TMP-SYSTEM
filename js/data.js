// Data Service - Switch between mock data and Supabase
import { supabase } from './supabase.js';

// Mock Data simulating Supabase responses (fallback)
export const mockData = {
    // Metrics for Dashboard（之後 recalcMetrics 會自動同步，這裡是初始值）
    metrics: {
        totalProperties: 17,
        rentedProperties: 10,
        pendingContracts: 1,
        pendingMaintenances: 2,
        monthlyIncome: 50000, // TWD（已繳清的帳單金額加總）
    },

    // === 以下所有資料表都從雲端 (Supabase) 拉，本機預設都空 ===
    // 之前留 demo 資料（王大明、李小芬…）會造成 pullAll 萬一失敗時 UI 直接顯示假資料，超容易誤導
    // 真實資料源是 Supabase。新環境如果還沒同步，會看到空表 → 走「立即下載」拉資料
    properties: [],
    contracts: [],
    invoices: [],
    maintenances: [],
    tenants: [],
    checkins: [],

    // === 系統設定主檔 ===

    // 房屋主檔（禁刪，可停用）— group 用於財報合併（例：松師 = 松山+師大）
    // mode: 'cohousing' (聚空間共居我們是房東) | 'managed' (聚空間代管 — 我們是屋主的管家)
    buildings: [
        { id: 'B001', name: '松山館',  baseAddress: '台北市松山區南京東路 50 號',   group: '松師', status: 'active', mode: 'cohousing', note: '' },
        { id: 'B002', name: '信義館',  baseAddress: '台北市信義區信義路五段 100 號', group: '信義', status: 'active', mode: 'cohousing', note: '' },
        { id: 'B003', name: '中山館',  baseAddress: '台北市中山區中山北路二段 60 號', group: '中山', status: 'active', mode: 'cohousing', note: '' },
        { id: 'B004', name: '古亭1館', baseAddress: '台北市大安區古亭街 120 號',     group: '古亭', status: 'active', mode: 'cohousing', note: '' },
        { id: 'B005', name: '古亭2館', baseAddress: '台北市大安區古亭街 150 號',     group: '古亭', status: 'active', mode: 'cohousing', note: '' },
        { id: 'B006', name: '師大館',  baseAddress: '台北市大安區師大路 88 號',       group: '松師', status: 'active', mode: 'cohousing', note: '' }
    ],

    // 代管模式 — 屋主主檔 (公開表單 / 內部表單寫入)
    owners: [],

    // 代管模式 — 押金 ledger (房客交 → 我們暫收 → 月結時移交屋主)
    // { id, contractId, tenantName, propertyName, buildingId, amount, holder: 'pms'|'owner', collectedDate, transferredDate, note }
    deposits: [],

    // 代管模式 — 屋主月結算 (一個月一張，可下載 PDF / LINE 傳屋主)
    // { id, ownerId, buildingId, month, items[], ownerReceivable, deposit*, status, createdAt }
    settlements: [],

    // 合約 PDF 樣板（每館一份）— pdfBase64 由使用者上傳
    // {  buildingId, fileName, pdfBase64, uploadedAt }
    contractTemplates: [],

    // 顧客來源主檔 (預設清空 — 同 invoiceTypes，避免幽靈復活)
    tenantSources: [],

    // 付款方式主檔 (預設清空)
    paymentMethods: [],

    // 帳單類型主檔 (預設清空 — 從 Supabase 拉，避免本機 hardcode 在「清空後又被默默載回」)
    invoiceTypes: []
};

// === localStorage 持久化（避免重整時遺失修改） ===
// 2026-06-13: 系統改名 BMS → PMS，key 跟著改
// 為了不讓老用戶資料消失，hydrate 時會先試新 key，沒有就讀舊 key 並一次性 migrate
const STORAGE_KEY = 'bananas-pms-data-v1';
const LEGACY_STORAGE_KEY = 'bananas-bms-data-v1';
let _persistDisabled = false;

// ── 財務起算日 cutoff ──
// 2026-06-22: 系統正式上線, 用戶把過去歷史先 key 進去當資料底
// 從 2026-06-01 起算所有 KPI / 報表 / 帳務統計
// pre-cutoff invoices 保留在 DB 但不算進統計 (例外: 房租查帳未結款照樣顯示, 不漏舊欠款)
export const FINANCE_CUTOFF_DATE = '2026-06-01';

// 判斷一筆 invoice 是否在 cutoff 之前 (= 不算進統計)
// 用 paidDate (已結) 優先, 沒有就用 dueDate (未結)
// 已結 + paidDate < cutoff → 排除
// 未結 + dueDate  < cutoff → 通常房租查帳會顯示, 別處排除
export function isPreCutoff(inv) {
    if (!inv) return false;
    const d = inv.paidDate || inv.dueDate || '';
    return d && d < FINANCE_CUTOFF_DATE;
}

// 5 月期初預期值 (用戶 5/31 結算)
// 給 verifyOpeningBalance() console 腳本對 DB 用
// 松山支出 250,536 (2026-06-23 更正, 原 258,736 含 8,200 未分類補登 → 用戶確認 key 錯該筆已修)
export const EXPECTED_5MAY_OPENING = {
    cutoff: FINANCE_CUTOFF_DATE,
    notes: '5/31 結算數字 (用戶整理), 用來對 DB 內 pre-cutoff invoices 加總',
    perBuilding: {
        '松山館':   { in: 186595, out: 250536 },
        '中山館':   { in: 171000, out:  64682 },
        '溫州館':   { in:      0, out:      0 },
        '古亭2館':  { in:   8500, out:  66040 },
        '古亭1館':  { in: 101250, out:  50639 },
        '師大館':   { in:  40500, out:  49469 },
        '信義館':   { in:  42500, out:  69207 }
    },
    // 支出 per-type (用戶詳細分項), 加總 == perBuilding.out
    perBuildingOutByType: {
        '松山館':  { '租金': 113000, '管理費': 15051, '591': 1289, '水費': 16437, '電費': 23123, '網路費': 1199, '瓦斯費': 4690, '薪水': 36000, '其他': 39747 },
        '中山館':  { '租金': 40015, '管理費': 8000, '591': 789, '電費': 8483, '網路費': 2859, '其他': 4536 },
        '古亭2館': { '租金': 45675, '管理費': 5500, '水費': 3109, '其他': 11756 },
        '古亭1館': { '租金': 35000, '591': 789, '其他': 14850 },
        '師大館':  { '租金': 32015, '591': 789, '網路費': 6028, '其他': 10637 },
        '信義館':  { '租金': 23015, '水費': 1314, '網路費': 6028, '其他': 38850 }
    },
    totals: {
        in: 550345,
        out: 550573,
        net: -228
    }
};

// P1-15: contractTemplates (PDF base64) 不寫 localStorage，避免一個樣板就撐爆 5MB
// 雲端 Supabase 已是 source of truth (contract_templates table)
function persist() {
    if (_persistDisabled) return;
    try {
        const snapshot = {
            properties: mockData.properties,
            tenants: mockData.tenants,
            contracts: mockData.contracts,
            invoices: mockData.invoices,
            maintenances: mockData.maintenances,
            checkins: mockData.checkins,
            buildings: mockData.buildings,
            owners: mockData.owners,
            deposits: mockData.deposits,
            settlements: mockData.settlements,
            invoiceTypes: mockData.invoiceTypes,
            tenantSources: mockData.tenantSources,
            paymentMethods: mockData.paymentMethods,
            metrics: mockData.metrics
            // contractTemplates 不存：base64 太大會撐爆，需要時從雲端拉
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        // 通知 sync.js 排程 push 到 Supabase (若已啟用同步)
        window.dispatchEvent(new CustomEvent('bms:persist'));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            console.warn('[persist] localStorage 已滿');
            // 主動提示用戶 (toast util 不一定 ready，用 window event)
            window.dispatchEvent(new CustomEvent('bms:storage-full', { detail: { error: e } }));
        } else {
            console.warn('資料持久化失敗:', e);
        }
    }
}

// P1-14: hydrate 失敗時備份毀損內容，方便事後 debug，不要靜默 fallback 到 mockData
function hydrate() {
    let raw;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
        // 一次性 migrate：新 key 沒東西時試讀舊 key (bananas-bms-data-v1)
        if (!raw) {
            const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
            if (legacy) {
                console.log('[migrate] BMS→PMS localStorage 一次性遷移');
                localStorage.setItem(STORAGE_KEY, legacy);
                localStorage.removeItem(LEGACY_STORAGE_KEY);
                raw = legacy;
            }
        }
        if (!raw) return false;
        const saved = JSON.parse(raw);
        Object.keys(saved).forEach(key => {
            if (saved[key] !== undefined) mockData[key] = saved[key];
        });
        // 代管 phase 1 migration:
        //   既有 buildings 補上 mode='cohousing' (預設共居)
        //   owners / deposits / settlements 沒有就給空陣列
        if (Array.isArray(mockData.buildings)) {
            mockData.buildings.forEach(b => { if (!b.mode) b.mode = 'cohousing'; });
        }
        if (!Array.isArray(mockData.owners)) mockData.owners = [];
        if (!Array.isArray(mockData.deposits)) mockData.deposits = [];
        if (!Array.isArray(mockData.settlements)) mockData.settlements = [];
        return true;
    } catch (e) {
        console.error('[hydrate] localStorage 毀損:', e);
        // 備份毀損內容到另一 key，留證據
        if (raw) {
            try {
                const ts = new Date().toISOString().replace(/[:.]/g, '-');
                localStorage.setItem(`${STORAGE_KEY}.broken-${ts}`, raw);
                console.warn(`[hydrate] 毀損內容備份到: ${STORAGE_KEY}.broken-${ts}`);
            } catch {}
        }
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        // 等 UI ready 後 toast 提示 (data.js 載入時 toast util 還沒 ready)
        window.addEventListener('DOMContentLoaded', () => {
            if (window.showToast) window.showToast('本機快取毀損，已從雲端重新載入', 'warning', 6000);
        });
        return false;
    }
}

// 開機時嘗試從 localStorage 載入；過程中關閉持久化避免 race
_persistDisabled = true;
const wasHydrated = hydrate();
_persistDisabled = false;
if (wasHydrated) console.info('[PMS] 已從本機儲存載入既有資料');

// 提供清空與匯出工具給 console 偵錯用
window.bmsResetData = function() {
    if (confirm('確定要清除所有本機資料、回到預設範例？此動作無法還原。')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    }
};
window.bmsExportData = function() {
    const snapshot = localStorage.getItem(STORAGE_KEY) || '{}';
    const blob = new Blob([snapshot], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bms-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

// === 資料遷移 / 衍生欄位補強（開機 + 每次 pull Supabase 後都會跑，必須冪等）===
export function runMigration() {
    const buildingByName = Object.fromEntries(mockData.buildings.map(b => [b.name, b]));
    const reBed = /^聚空間\s*[-–]\s*(\S+)\s+R(\d+)-([A-Z])$/;

    // 1. properties 補上 buildingId / roomNumber / bedLetter / gender / capacity
    mockData.properties.forEach(p => {
        const m = (p.name || '').match(reBed);
        if (m) {
            const [, areaName, roomNumStr, bedLetter] = m;
            const building = buildingByName[areaName];
            if (building) {
                p.buildingId = p.buildingId || building.id;
                p.roomNumber = p.roomNumber ?? parseInt(roomNumStr, 10);
                p.bedLetter = p.bedLetter || bedLetter;
            }
        }
        if (!p.gender) p.gender = '男';
        if (!p.capacity) p.capacity = 4;
        delete p.roomTypeId;
    });

    // 2a. 合約生命週期欄位先補 (給 invoice 步驟用)
    mockData.contracts.forEach(c => {
        if (!('termMonths' in c) || !c.termMonths) {
            if (c.signDate && c.endDate) {
                const days = Math.round((new Date(c.endDate) - new Date(c.signDate)) / 86400000);
                c.termMonths = days <= 35 ? 1 : 3;
            } else {
                c.termMonths = 1;
            }
        }
        if (!c.startDate && c.signDate) c.startDate = c.signDate;
        if (!('parentContractId' in c)) c.parentContractId = null;
        if (!('renewalState' in c)) c.renewalState = 'active';
        if (!('snoozeUntil' in c)) c.snoozeUntil = null;
        if (!('signedFileUrl' in c)) c.signedFileUrl = null;
        if (!('terminatedDate' in c)) c.terminatedDate = null;
        // 押金金額（合約上需寫，預設 0 表示不收押金）
        if (!('depositAmount' in c)) c.depositAmount = 0;
    });

    // 2. invoices 遷移
    mockData.invoices.forEach(inv => {
        if (!inv.direction) inv.direction = 'in';
        if (!inv.buildingId && inv.propertyName) {
            const m = inv.propertyName.match(/^聚空間\s*[-–]\s*(\S+)\s+/);
            if (m) {
                const b = buildingByName[m[1]];
                if (b) inv.buildingId = b.id;
            }
        }
        // 命名統一：收入的「租金」改成「房租」（避免跟付給房東的「房東租金」混淆）
        if (inv.direction === 'in' && inv.type === '租金') inv.type = '房租';
        // 收入的「水電費」舊資料：房租已含水電，移除
        if (inv.direction === 'in' && inv.type === '水電費') inv.type = '房租';
        if (!inv.note) inv.note = '';
        // 階段 2 新欄位：匯款末 5 碼核對
        if (!('bankLast5' in inv)) inv.bankLast5 = null;
        if (!('bankVerified' in inv)) inv.bankVerified = false;
        if (!('contractId' in inv)) inv.contractId = null;
        // 階段 2.1：補上舊房租帳單的 contractId（用 tenant + propertyName 找對應 active 合約）
        if (inv.direction === 'in' && inv.type === '房租' && !inv.contractId && inv.tenant && inv.propertyName) {
            const matchedContract = mockData.contracts.find(c =>
                c.tenant === inv.tenant &&
                c.propertyName === inv.propertyName &&
                c.renewalState === 'active'
            );
            if (matchedContract) inv.contractId = matchedContract.id;
        }
    });

    // 3. invoiceTypes 遷移：補 direction / isRecurring，並補上新增的支出類型
    if (Array.isArray(mockData.invoiceTypes)) {
        const meta = {
            '房租': { direction: 'in', isRecurring: true },
            '其他收入': { direction: 'in', isRecurring: false },
            '房東租金': { direction: 'out', isRecurring: true },
            '薪水': { direction: 'out', isRecurring: true },
            '水費': { direction: 'out', isRecurring: true },
            '電費': { direction: 'out', isRecurring: true },
            '瓦斯費': { direction: 'out', isRecurring: true },
            '網路費': { direction: 'out', isRecurring: true },
            '管理費': { direction: 'out', isRecurring: true },
            '清潔用品': { direction: 'out', isRecurring: false },
            '修繕雜支': { direction: 'out', isRecurring: false },
            '紅利發放': { direction: 'out', isRecurring: false },
            '其他支出': { direction: 'out', isRecurring: false }
        };
        // 移除舊的「押金」「租金」「清潔費」「水電費」「其他」(以新名稱取代)
        const obsolete = new Set(['押金', '租金', '清潔費', '水電費', '其他']);
        mockData.invoiceTypes = mockData.invoiceTypes.filter(t => !obsolete.has(t.name));
        // 補欄位
        mockData.invoiceTypes.forEach(t => {
            const m = meta[t.name];
            if (m) {
                t.direction = m.direction;
                t.isRecurring = m.isRecurring;
            } else {
                if (!t.direction) t.direction = 'both';
                if (t.isRecurring === undefined) t.isRecurring = false;
            }
        });
        // 補上缺的標準類型
        const existing = new Set(mockData.invoiceTypes.map(t => t.name));
        let nextNum = 200;
        Object.entries(meta).forEach(([name, m]) => {
            if (!existing.has(name)) {
                mockData.invoiceTypes.push({ id: `IT${nextNum++}`, name, ...m, note: '' });
            }
        });
    }

    // 4. tenant.source 舊代碼 → 顯示名稱
    const sourceCodeMap = { fb: 'Facebook', airbnb: 'Airbnb', line: 'LINE', '介紹': '朋友介紹' };
    if (Array.isArray(mockData.tenants)) {
        mockData.tenants.forEach(t => {
            if (t.source && sourceCodeMap[t.source]) t.source = sourceCodeMap[t.source];
        });
    }

    // 5. invoice 收款欄位 backfill — 舊資料補 paidAmount / discount
    // 已繳清/已付 → paidAmount = amount；部分繳款保留現值；其他 → 0
    if (Array.isArray(mockData.invoices)) {
        mockData.invoices.forEach(inv => {
            if (inv.discount == null) inv.discount = 0;
            if (inv.paidAmount == null) {
                if (inv.status === '已繳清' || inv.status === '已付') {
                    inv.paidAmount = inv.amount || 0;
                    if (!inv.paymentMethod) inv.paymentMethod = '匯款';
                } else {
                    inv.paidAmount = 0;
                }
            }
        });
    }

    // 6. 孤兒清理：property 的 tenant/contractId/contractEnd/status 一律以「有無 active 合約」為準
    //    確保 property 表上的 denormalized 欄位永遠跟 contracts 表同步
    if (Array.isArray(mockData.properties) && Array.isArray(mockData.contracts)) {
        mockData.properties.forEach(p => {
            const active = mockData.contracts.find(c =>
                c.propertyName === p.name && c.renewalState === 'active'
            );
            if (active) {
                // 同步到 active 合約
                p.tenant = active.tenant;
                p.contractId = active.id;
                p.contractEnd = active.endDate;
                if (p.status !== '已出租' && p.status !== '待簽約') p.status = '已出租';
            } else {
                // 沒 active 合約 → 一律清空 + 重設為待租
                if (p.tenant || p.contractId || p.status === '已出租' || p.status === '待簽約') {
                    p.tenant = null;
                    p.contractId = null;
                    p.contractEnd = null;
                    p.status = '待租';
                }
            }
        });
    }
    if (Array.isArray(mockData.tenants) && Array.isArray(mockData.contracts)) {
        mockData.tenants.forEach(t => {
            if (!t.currentProperty) return;
            const stillActive = mockData.contracts.some(c =>
                c.tenant === t.name && c.renewalState === 'active'
            );
            if (!stillActive) {
                t.currentProperty = null;
                if (t.status === '居住中') t.status = '待入住';
            }
        });
    }
    // 順便刪孤兒 invoice (contractId 指向已不存在的合約)
    if (Array.isArray(mockData.invoices) && Array.isArray(mockData.contracts)) {
        const ids = new Set(mockData.contracts.map(c => c.id));
        mockData.invoices = mockData.invoices.filter(inv => !inv.contractId || ids.has(inv.contractId));
    }

    // 3.5 contractTemplates 防呆
    if (!Array.isArray(mockData.contractTemplates)) mockData.contractTemplates = [];

    // 4. buildings 遷移：補 group + 補上缺的師大館 + 移除溫州館（已結束）
    const groupByName = {
        '松山館': '松師', '師大館': '松師',
        '中山館': '中山',
        '信義館': '信義',
        '古亭1館': '古亭', '古亭2館': '古亭'
    };
    mockData.buildings.forEach(b => {
        if (!b.group) b.group = groupByName[b.name] || b.name;
    });
    if (!buildingByName['師大館']) {
        mockData.buildings.push({
            id: 'B006', name: '師大館',
            baseAddress: '台北市大安區師大路 88 號',
            group: '松師', status: 'active', note: ''
        });
    }
    // 移除溫州館（業務已結束）
    mockData.buildings = mockData.buildings.filter(b => b.name !== '溫州館');
}

// 開機立刻跑一次
runMigration();

// 全站統一館別排序：永遠按 id (B001 → B002 → ...) 升冪
// 用法：getSortedBuildings()              全部館 (含停用)
//      getSortedBuildings({ activeOnly: true })  只回啟用中
export function getSortedBuildings({ activeOnly = false } = {}) {
    let list = [...mockData.buildings];
    if (activeOnly) list = list.filter(b => b.status === 'active');
    return list.sort((a, b) => (a.id || '').localeCompare(b.id || ''));
}

// 找指定床位目前的「進行中」合約 (renewalState='active' 且未過期)
// 一張床位最多只該有一份 active 合約 — 用這個 helper 取代各處 ad-hoc 過濾
export function activeContractFor(propertyName) {
    if (!propertyName) return null;
    return mockData.contracts.find(c =>
        c.propertyName === propertyName && c.renewalState === 'active'
    ) || null;
}

// 床位是否「實際有人住」— 對齊住房一覽顯示邏輯
// 規則: renewalState='active' 或 'snoozed' 且 startDate <= today (已入住，不論合約是否過期)
// 「床位上有名字 = 居住」(2026-06-16 用戶要求)
export function bedOccupied(propertyName, today = new Date()) {
    if (!propertyName) return false;
    const todayStr = today.toISOString().slice(0, 10);
    return mockData.contracts.some(c =>
        c.propertyName === propertyName
        && (c.renewalState === 'active' || c.renewalState === 'snoozed')
        && c.startDate && c.startDate <= todayStr
    );
}

// 找指定租客目前的「進行中」合約 (一個人同時只該有一份 active)
export function activeContractOfTenant(tenantName) {
    if (!tenantName) return null;
    return mockData.contracts.find(c =>
        c.tenant === tenantName && c.renewalState === 'active'
    ) || null;
}

// 期間重疊判斷 — 兩段時間有交集
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    if (!aStart || !aEnd || !bStart || !bEnd) return false;
    // 允許「端點接續」: 一個合約 end_date == 另一合約 start_date 不算衝突
    // (例: 5/31 退房 → 5/31 新人入住，同日交接)
    if (aStart === bEnd || aEnd === bStart) return false;
    return aStart <= bEnd && aEnd >= bStart;
}

// 找跟「指定床位 + 指定期間」時段衝突的舊合約
// 不論舊合約是 active/terminated/snoozed/renewed 都會檢查 (歷史也算)
// excludeId: 編輯時排除自己
export function findOverlappingBedContracts(propertyName, startDate, endDate, { excludeId } = {}) {
    if (!propertyName || !startDate || !endDate) return [];
    return mockData.contracts.filter(c => {
        if (c.id === excludeId) return false;
        if (c.propertyName !== propertyName) return false;
        // 退租過的合約：用實際 terminatedDate 為真正結束日，不要用 endDate (還沒到原本期滿日)
        const realEnd = (c.renewalState === 'terminated' && c.terminatedDate) ? c.terminatedDate : c.endDate;
        return rangesOverlap(startDate, endDate, c.startDate, realEnd);
    });
}

// 找跟「指定租客 + 指定期間」時段衝突的舊合約 (同人不能同時住兩床)
export function findOverlappingTenantContracts(tenantName, startDate, endDate, { excludeId } = {}) {
    if (!tenantName || !startDate || !endDate) return [];
    return mockData.contracts.filter(c => {
        if (c.id === excludeId) return false;
        if (c.tenant !== tenantName) return false;
        const realEnd = (c.renewalState === 'terminated' && c.terminatedDate) ? c.terminatedDate : c.endDate;
        return rangesOverlap(startDate, endDate, c.startDate, realEnd);
    });
}

// 一次性對齊 contract ↔ property 的雙向關聯
// 用途：清理舊資料 (同床位多份 active / property.contractId 對不上實際 active 合約)
// opts.dryRun: 只報告不修
// 在 console: await reconcilePropertyContracts() 跑一次即可
export function reconcilePropertyContracts({ dryRun = false } = {}) {
    const issues = [];
    const TODAY = new Date().toISOString().split('T')[0];

    // 1. 同一床位多份 active 合約 → 留最新 startDate，其餘標 terminated
    const byProperty = {};
    mockData.contracts.forEach(c => {
        if (c.renewalState !== 'active' || !c.propertyName) return;
        if (!byProperty[c.propertyName]) byProperty[c.propertyName] = [];
        byProperty[c.propertyName].push(c);
    });
    Object.entries(byProperty).forEach(([propName, contracts]) => {
        if (contracts.length <= 1) return;
        contracts.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
        const winner = contracts[0];
        contracts.slice(1).forEach(loser => {
            issues.push(`床位衝突 → ${propName}：${loser.id}(${loser.tenant}) 跟 ${winner.id}(${winner.tenant}) 並存，將 ${loser.id} 標記為已退租`);
            if (!dryRun) {
                loser.renewalState = 'terminated';
                loser.status = '已終止';
                loser.terminatedDate = loser.terminatedDate || TODAY;
            }
        });
    });

    // 1b. 同一租客多份 active 合約 → 留最新 startDate，其餘標 terminated
    const byTenant = {};
    mockData.contracts.forEach(c => {
        if (c.renewalState !== 'active' || !c.tenant) return;
        if (!byTenant[c.tenant]) byTenant[c.tenant] = [];
        byTenant[c.tenant].push(c);
    });
    Object.entries(byTenant).forEach(([tenantName, contracts]) => {
        if (contracts.length <= 1) return;
        contracts.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
        const winner = contracts[0];
        contracts.slice(1).forEach(loser => {
            issues.push(`租客衝突 → ${tenantName}：${loser.id}(${loser.propertyName}) 跟 ${winner.id}(${winner.propertyName}) 並存，將 ${loser.id} 標記為已退租`);
            if (!dryRun) {
                loser.renewalState = 'terminated';
                loser.status = '已終止';
                loser.terminatedDate = loser.terminatedDate || TODAY;
            }
        });
    });

    // 2. 每個 property：同步 contractId / tenant / status / contractEnd
    mockData.properties.forEach(p => {
        const active = mockData.contracts.find(c =>
            c.propertyName === p.name && c.renewalState === 'active'
        );
        if (active) {
            if (p.contractId !== active.id || p.tenant !== active.tenant) {
                issues.push(`修正 ${p.name}：contractId ${p.contractId || 'null'} → ${active.id}, tenant ${p.tenant || 'null'} → ${active.tenant}`);
                if (!dryRun) {
                    p.contractId = active.id;
                    p.contractEnd = active.endDate;
                    p.tenant = active.tenant;
                    if (p.status === '待租' || p.status === '待簽約') p.status = '已出租';
                }
            }
        } else {
            // 沒 active 合約 → 床位該是空的
            if (p.contractId || p.tenant) {
                issues.push(`清空 ${p.name}：無 active 合約但仍有 contractId=${p.contractId} / tenant=${p.tenant}`);
                if (!dryRun) {
                    p.contractId = null;
                    p.contractEnd = null;
                    p.tenant = null;
                    if (p.status === '已出租') p.status = '待租';
                }
            }
        }
    });

    if (!dryRun && issues.length > 0) {
        // 透過 store 的 helper 觸發 persist + 'bms:persist' 事件
        try { recalcMetrics(); } catch {}
    }

    console.log(`[reconcile] ${issues.length} 項${dryRun ? '(dry-run)' : '已修正'}`);
    if (issues.length) console.table(issues.map(i => ({ 訊息: i })));
    return { issues, fixed: !dryRun };
}

window.reconcilePropertyContracts = reconcilePropertyContracts;
window.dryRunReconcile = () => reconcilePropertyContracts({ dryRun: true });

// 把 mockData 暴露給 console 偵錯 (read-only 用途，別直接寫)
window.mockData = mockData;

// 顯示用：把 gender + capacity 組成「女生 8 人房」這種字串
export function formatRoomType(gender, capacity) {
    if (!gender || !capacity) return '未指定房型';
    const prefix = gender === '不限' ? '混合' : `${gender}生`;
    return `${prefix} ${capacity} 人房`;
}

// === 帳務聚合 helpers ===

// 取一筆 invoice 屬於哪個月份（YYYY-MM）— 以 dueDate 為準
export function invoiceMonth(inv) {
    // 已收/已付 → 用實際入帳日 (paidDate)；未結 → 用到期日 (dueDate)
    // 這樣「總收支表」顯示的是「該月實際金流」，房租查帳則是「該月該收/該付」
    return (inv.paidDate || inv.dueDate || '').substring(0, 7);
}

// YYYY-MM 加減 N 個月
export function shiftMonth(yyyymm, delta) {
    const [y, m] = (yyyymm || '').split('-').map(Number);
    if (!y || !m) return yyyymm;
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 取得目前年月 YYYY-MM
export function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 「2026 年 5 月」這種顯示字串
export function formatMonthLabel(yyyymm) {
    if (!yyyymm) return '';
    const [y, m] = yyyymm.split('-');
    return `${y} 年 ${parseInt(m, 10)} 月`;
}

// 取最近 N 個月（含本月），由舊到新
export function lastNMonths(n) {
    const months = [];
    const d = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
        months.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
}

// === 合約生命週期 helpers ===
// 階段：active / expiring_soon / awaiting_decision / expired / snoozed / renewed / terminated
export function getContractLifecycle(contract, today = new Date()) {
    if (!contract) return 'unknown';
    if (contract.renewalState === 'renewed') return 'renewed';
    if (contract.renewalState === 'terminated') return 'terminated';
    if (!contract.endDate) return 'active';

    // snooze 期間內：當作正常進行中，不出決策卡
    if (contract.snoozeUntil) {
        const snooze = new Date(contract.snoozeUntil);
        if (today < snooze) return 'snoozed';
    }

    const end = new Date(contract.endDate);
    const diffDays = Math.ceil((end - today) / 86400000);

    // 三段時間軸 (2026-06-15 確認):
    //   > 10 天 = active
    //   6 ~ 10 天 = expiring_soon (此區間 renewal-poll cron 會發 LINE 詢問)
    //   0 ~ 5 天 = awaiting_decision (該管理者下決定了，不能再等)
    //   < 0 天 = expired
    if (diffDays > 10) return 'active';
    if (diffDays > 5) return 'expiring_soon';
    if (diffDays >= 0) return 'awaiting_decision';
    return 'expired';
}

// 距到期天數（負數表已過）
export function daysUntilExpiry(contract, today = new Date()) {
    if (!contract?.endDate) return null;
    const end = new Date(contract.endDate);
    return Math.ceil((end - today) / 86400000);
}

// 是否需要管理員決策（待決策 + 已到期 + snooze 已過）
export function needsDecision(contract, today = new Date()) {
    const state = getContractLifecycle(contract, today);
    return state === 'awaiting_decision' || state === 'expired';
}

// 顯示用文字 + class
export function contractLifecycleLabel(state) {
    return ({
        active: { text: '進行中',     cls: 'success' },
        expiring_soon: { text: '即將到期', cls: 'warning' },
        awaiting_decision: { text: '待決策', cls: 'danger' },
        expired: { text: '已過期',     cls: 'danger' },
        snoozed: { text: '已暫緩',     cls: 'info' },
        renewed: { text: '已續約',     cls: 'info' },
        terminated: { text: '已終止',  cls: 'primary' }
    })[state] || { text: state, cls: 'primary' };
}

// 加減天數，回傳 YYYY-MM-DD
export function addDaysISO(dateStr, days) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

// +N 個月 (calendar month) — 月底 clamp (1/31 + 1 月 = 2/28/2029, 不是 3/3)
export function addMonthsISO(dateStr, months) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const origDay = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    // clamp 到該月最後一天
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(origDay, lastDay));
    return d.toISOString().split('T')[0];
}

// 租期到期日: 1 個月 = 嚴格 30 天 (用戶慣例)
// 1 月 = 30 天, 2 月 = 60 天, 3 月 = 90 天
// 例: 6/20 + 1 月 → 7/20 / 4/9 + 3 月 → 7/8 / 6/3 + 3 月 → 9/1 / 1/31 + 1 月 → 3/2
export function leaseEndISO(startDate, months) {
    if (!startDate) return '';
    const days = (Number(months) || 0) * 30;
    return addDaysISO(startDate, days);
}

// 一筆 invoice 的實際金額 (P1-13: 從 finance/analysis/reports 抽出共用)
// 優先用 paidAmount (實收/實付)，沒有就 fallback 到 amount
export function invoiceActualAmount(i) {
    if (!i) return 0;
    return i.paidAmount != null && i.paidAmount > 0 ? i.paidAmount : (i.amount || 0);
}

// 把 discountReason 顯示成可讀字串 (新需求 #1)
// 新格式: JSON array [{ kind: 'sub'|'add', label, amount }]
// 舊格式: 純文字 (e.g. "季繳優惠") — 直接回傳
// 回傳 string，可塞進 innerHTML (含 HTML escape)
// labelsOnly=true → 只回 label 文字 (e.g. "能源費 · 季繳優惠")
//                   給已經有獨立 +$X / -$X 顯示欄的地方用 (e.g. finance list)
//                   避免 +$500 能源費 跟外層 +$500 重複
export function formatDiscountReason(raw, { labelsOnly = false } = {}) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (!s.startsWith('[')) return s;  // 舊格式，純文字
    try {
        const items = JSON.parse(s);
        if (!Array.isArray(items)) return '';
        return items.map(x => {
            if (labelsOnly) return (x.label || '').trim();
            const sign = x.kind === 'add' ? '+' : '−';
            const amt = (x.amount || 0).toLocaleString();
            return `${sign}$${amt} ${x.label || ''}`.trim();
        }).filter(Boolean).join(' · ');
    } catch {
        // 壞掉的 JSON (被截斷 / 編碼錯) — 不要把 raw garbage 顯給 user
        return '';
    }
}

// 一筆 invoice 是否已結算（已收 / 已付）
// 優先用 paidAmount 判斷；若沒有 paidAmount (舊資料) 退回 status 字串
// 邊界：due <= 0 (全免) 也算結清
export function isSettled(inv) {
    if (!inv) return false;
    if (inv.paidAmount != null && inv.amount != null) {
        const due = (inv.amount || 0) - (inv.discount || 0);
        if (due <= 0) return true;
        return (inv.paidAmount || 0) >= due;
    }
    if (inv.direction === 'in') return inv.status === '已繳清';
    return inv.status === '已付';
}

// 為一份合約建立全期房租帳單（一份合約 = 一張帳單）
// 帳單金額 = 月租 × termMonths，期間 = 合約全期，應結日 = startDate
// 1 合約 = 1 張全期 invoice，預設已繳清 (現實規則：先收錢才簽合約)
// 1 月合約 = 1 月房租；3 月合約 = 3 月房租 (季繳優惠)
// 多床位 bundle: 主合約 invoice 自動累加 payment.__bundleExtraRents 裡的額外床位月租；
//   額外床位合約呼叫 addContract 時不傳 __payment，就不會產生獨立 invoice (避免出現「主已收完、額外待繳」的怪狀態)
function buildContractInvoice(contract, payment = {}) {
    if (!contract || !contract.startDate) return null;
    const property = mockData.properties.find(p => p.name === contract.propertyName);
    const buildingId = property?.buildingId || null;
    const term = contract.termMonths || 1;
    // 多床位 bundle：主合約 invoice 把額外床位月租一起算進去
    const extraRents = Array.isArray(payment.__bundleExtraRents) ? payment.__bundleExtraRents : [];
    const extraRentSum = extraRents.reduce((s, r) => s + (Number(r) || 0), 0);
    const baseRent = (Number(contract.amount) || 0) + extraRentSum;
    const totalAmount = baseRent * term;
    const termLabel = term === 3 ? '3 個月 (季繳)' : `${term} 個月`;
    const bundleNote = extraRents.length
        ? ` · 含額外 ${extraRents.length} 張床位`
        : '';
    const today = new Date().toISOString().slice(0, 10);

    const discount = Number(payment.discount) || 0;
    const due = totalAmount - discount;
    // 已收：留空 / null / '' 都當作「未收 (0)」 — 要明確輸入金額才視為已收
    const paidAmount = (payment.paidAmount == null || payment.paidAmount === '')
        ? 0
        : Number(payment.paidAmount);
    const method = payment.paymentMethod || '匯款';

    const inv = {
        id: nextId('INV-', mockData.invoices),
        direction: 'in',
        buildingId,
        propertyName: contract.propertyName,
        tenant: contract.tenant,
        type: '房租',
        amount: totalAmount,
        dueDate: contract.startDate,
        status: '已繳清',
        paidDate: today,
        periodStart: contract.startDate,
        periodEnd: contract.endDate,
        note: `${contract.id} ${termLabel} 房租${bundleNote}` + (payment.note ? ` · ${payment.note}` : (paidAmount >= due ? ' · 簽約已收' : '')),
        contractId: contract.id,
        bankLast5: null,
        bankVerified: paidAmount >= due,
        discount,
        discountReason: payment.discountReason || null,
        paidAmount,
        paymentMethod: method
    };
    inv.status = deriveInvoiceStatus(inv);
    return inv;
}

// 由 paidAmount vs (amount - discount) 派生 status
// 用於：收款後自動更新 status / UI 顯示
// 邊界：折扣 = amount 時 due = 0，視為「已繳清」(全免也算結清)
export function deriveInvoiceStatus(inv) {
    if (!inv) return null;
    const due = (inv.amount || 0) - (inv.discount || 0);
    const paid = inv.paidAmount || 0;
    if (inv.direction === 'in') {
        if (due <= 0) return '已繳清';        // 全免 → 視為結清
        if (paid >= due) return '已繳清';
        if (paid > 0) return '部分繳款';
        return '欠繳';
    }
    // out
    if (due <= 0) return '已付';
    if (paid >= due) return '已付';
    if (paid > 0) return '部分支付';
    return '未付';
}

// 套用一筆收款到 invoice (paidAmount 累加，自動更新 status)
export function applyPayment(inv, { amount, method, last5, date } = {}) {
    if (!inv || !amount) return inv;
    inv.paidAmount = (inv.paidAmount || 0) + Number(amount);
    if (method) inv.paymentMethod = method;
    if (last5) inv.bankLast5 = last5;
    inv.paidDate = date || new Date().toISOString().slice(0, 10);
    inv.status = deriveInvoiceStatus(inv);
    return inv;
}

// 補產所有 active 合約缺少的帳單（一合約一帳單模式）
// 用於：使用者手動觸發、修復資料、初次匯入
export function ensureContractInvoices() {
    const created = [];
    let skipped = 0;

    mockData.contracts.forEach(c => {
        if (c.renewalState !== 'active') return;
        if (!c.startDate) return;

        // 此合約是否已有帳單？（用 contractId 比對）
        const exists = mockData.invoices.some(inv =>
            inv.direction === 'in' &&
            inv.type === '房租' &&
            inv.contractId === c.id
        );
        if (exists) { skipped++; return; }

        const inv = buildContractInvoice(c);
        if (inv) {
            mockData.invoices.push(inv);
            created.push(inv);
        }
    });

    if (created.length) {
        // 透過 recalcMetrics 走完整的 persist 流程 (含 'bms:persist' event → sync 推到 Supabase)
        recalcMetrics();
    }

    return { created, skipped };
}

// dry-run 版本：回傳「要新增的帳單」+「跳過的合約」清單，不寫 mockData
// 給 UIUX #3 危險操作護欄用 — 讓使用者看清楚會發生什麼再決定按下去
export function previewContractInvoices() {
    const wouldCreate = [];
    const wouldSkip = [];
    mockData.contracts.forEach(c => {
        if (c.renewalState !== 'active') return;
        if (!c.startDate) return;
        const exists = mockData.invoices.some(inv =>
            inv.direction === 'in' && inv.type === '房租' && inv.contractId === c.id
        );
        if (exists) { wouldSkip.push(c); return; }
        const inv = buildContractInvoice(c);
        if (inv) wouldCreate.push({ invoice: inv, contract: c });
    });
    return { wouldCreate, wouldSkip };
}

// 建合約後自動建 1 張全期房租 invoice，預設已繳清
// payment: { discount, discountReason, paidAmount, paymentMethod } — 可選，預設視為簽約全額收款
export function createInvoiceForContract(contract, payment = {}) {
    if (!contract) return null;
    const exists = mockData.invoices.some(inv =>
        inv.direction === 'in' && inv.type === '房租' && inv.contractId === contract.id
    );
    if (exists) return null;
    const inv = buildContractInvoice(contract, payment);
    if (inv) mockData.invoices.push(inv);
    return inv;
}

// 是否為未結（欠繳 / 未付 / 部分繳款）
// 優先用 paidAmount 判斷；含「部分繳款」也算未結
export function isUnsettled(inv) {
    if (!inv) return false;
    if (inv.paidAmount != null && inv.amount != null) {
        const due = (inv.amount || 0) - (inv.discount || 0);
        return (inv.paidAmount || 0) < due;
    }
    if (inv.direction === 'in') return inv.status === '欠繳' || inv.status === '部分繳款';
    return inv.status === '未付' || inv.status === '部分支付';
}

// 把 invoices 聚合成 { inDue, inPaid, outDue, outPaid, net }
// inDue/outDue = 淨應收 (amount - discount)；inPaid/outPaid = 實收 (paidAmount)
// 含部分繳款 + 折扣，跟 finance.js 的 actualAmount 對齊
export function aggregateInvoices(invoices) {
    let inDue = 0, inPaid = 0, outDue = 0, outPaid = 0;
    invoices.forEach(inv => {
        const due = (inv.amount || 0) - (inv.discount || 0);
        const paid = invoicePaidValue(inv);
        if (inv.direction === 'in') {
            inDue += due;
            inPaid += paid;
        } else if (inv.direction === 'out') {
            outDue += due;
            outPaid += paid;
        }
    });
    return { inDue, inPaid, outDue, outPaid, net: inPaid - outPaid };
}

// Data service class for Supabase integration
export class DataService {
    constructor() {
        this.useSupabase = false; // Set to true when Supabase is configured
    }

    // Get all data (fallback to mock data if Supabase not configured)
    async getAllData() {
        if (this.useSupabase) {
            try {
                const [properties, tenants, contracts, invoices, maintenances, checkins] = await Promise.all([
                    supabase.from('properties').select('*'),
                    supabase.from('tenants').select('*'),
                    supabase.from('contracts').select('*'),
                    supabase.from('invoices').select('*'),
                    supabase.from('maintenances').select('*'),
                    supabase.from('checkins').select('*')
                ]);

                return {
                    properties: properties.data || [],
                    tenants: tenants.data || [],
                    contracts: contracts.data || [],
                    invoices: invoices.data || [],
                    maintenances: maintenances.data || [],
                    checkins: checkins.data || []
                };
            } catch (error) {
                console.error('Supabase error:', error);
                return mockData;
            }
        }
        return mockData;
    }

    // Properties methods
    async getProperties() {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('properties')
                .select(`
                    *,
                    tenants (
                        name,
                        phone,
                        email
                    )
                `);
            return error ? mockData.properties : data;
        }
        return mockData.properties;
    }

    async getPropertyById(id) {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('properties')
                .select(`
                    *,
                    tenants (
                        name,
                        phone,
                        email
                    )
                `)
                .eq('id', id)
                .single();
            return error ? null : data;
        }
        return mockData.properties.find(p => p.id === id);
    }

    // Tenants methods
    async getTenants() {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('tenants')
                .select(`
                    *,
                    properties (
                        name,
                        address
                    )
                `);
            return error ? mockData.tenants : data;
        }
        return mockData.tenants;
    }

    // Contracts methods
    async getContracts() {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('contracts')
                .select(`
                    *,
                    properties (
                        name
                    ),
                    tenants (
                        name
                    )
                `);
            return error ? mockData.contracts : data;
        }
        return mockData.contracts;
    }

    // Invoices methods
    async getInvoices() {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('invoices')
                .select(`
                    *,
                    properties (
                        name
                    ),
                    tenants (
                        name
                    )
                `);
            return error ? mockData.invoices : data;
        }
        return mockData.invoices;
    }

    // Maintenances methods
    async getMaintenances() {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('maintenances')
                .select(`
                    *,
                    properties (
                        name
                    )
                `);
            return error ? mockData.maintenances : data;
        }
        return mockData.maintenances;
    }

    // Checkins methods
    async getCheckins() {
        if (this.useSupabase) {
            const { data, error } = await supabase
                .from('checkins')
                .select(`
                    *,
                    properties (
                        name
                    ),
                    tenants (
                        name
                    )
                `);
            return error ? mockData.checkins : data;
        }
        return mockData.checkins;
    }
}

// Export data service instance
export const dataService = new DataService();

// === In-memory CRUD helpers (for mock mode) ===
// 之後切到 Supabase 時，把這些 helper 改成呼叫 dataService 即可

function nextId(prefix, list, idKey = 'id') {
    let max = 0;
    list.forEach(item => {
        const m = String(item[idKey] || '').match(new RegExp(`^${prefix}(\\d+)$`));
        if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export const store = {
    // ----- properties -----
    addProperty(payload) {
        const item = { id: nextId('P', mockData.properties), ...payload };
        mockData.properties.push(item);
        recalcMetrics();
        return item;
    },
    updateProperty(id, patch) {
        const i = mockData.properties.findIndex(p => p.id === id);
        if (i >= 0) {
            mockData.properties[i] = { ...mockData.properties[i], ...patch };
            recalcMetrics();
            return mockData.properties[i];
        }
        return null;
    },
    deleteProperty(id) {
        mockData.properties = mockData.properties.filter(p => p.id !== id);
        recalcMetrics();
        window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'properties', id } }));
    },

    // ----- tenants -----
    addTenant(payload) {
        const item = { id: nextId('T', mockData.tenants), ...payload };
        mockData.tenants.push(item);
        persist();
        return item;
    },
    updateTenant(id, patch) {
        const i = mockData.tenants.findIndex(t => t.id === id);
        if (i >= 0) {
            mockData.tenants[i] = { ...mockData.tenants[i], ...patch };
            persist();
            return mockData.tenants[i];
        }
        return null;
    },
    deleteTenant(id) {
        mockData.tenants = mockData.tenants.filter(t => t.id !== id);
        persist();
        window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'tenants', id } }));
    },

    // ----- contracts -----
    // payload 可帶 __payment: { discount, discountReason, paidAmount, paymentMethod } 給對應 invoice 用
    addContract(payload) {
        const { __payment, __skipInvoice, ...contractFields } = payload;
        // R4: 預設 contractType = cohousing (沒帶 = 共居)
        if (!contractFields.contractType) contractFields.contractType = 'cohousing';
        const item = { id: nextId('C', mockData.contracts), ...contractFields };
        mockData.contracts.push(item);
        // 一份合約 = 一張帳單：自動建立全期房租應收
        // 例外:
        //   1. bundle 主合約 invoice 已含所有額外床位月租 → 額外合約傳 __skipInvoice 不開帳單
        //   2. 外部平台代收 (paymentChannel='platform') → 我們不收，跳過帳單
        //   3. 代管合約 (managed-owner / managed-tenant) → 房租不是我們的，月結算手動處理
        const isPlatform = item.paymentChannel === 'platform';
        const isManaged = item.contractType && item.contractType !== 'cohousing';
        if (!__skipInvoice && !isPlatform && !isManaged && (item.renewalState === 'active' || !item.renewalState)) {
            createInvoiceForContract(item, __payment || {});
        }
        recalcMetrics();
        return item;
    },
    updateContract(id, patch, _skipBundleCascade = false) {
        const i = mockData.contracts.findIndex(c => c.id === id);
        if (i < 0) return null;
        const before = mockData.contracts[i];
        mockData.contracts[i] = { ...before, ...patch };
        const after = mockData.contracts[i];

        // 改合約月租 → 反向同步該合約的房租 invoice 跟床位 property.rent
        // bundle 子合約 (bundleParentContractId) 改 amount → 透過 parent 重新觸發 cascade
        // (audit: 之前完全沒同步 child 改動，對帳會漂移)
        if ('amount' in patch && Number(before.amount) !== Number(after.amount)) {
            let cascadeContract = after;
            if (after.bundleParentContractId) {
                // 子合約變動 → 找 parent 走 cascade
                const parent = mockData.contracts.find(c => c.id === after.bundleParentContractId);
                if (parent) cascadeContract = parent;
            }
            const term = cascadeContract.termMonths || 1;
            const extraRentSum = mockData.contracts
                .filter(c => c.bundleParentContractId === cascadeContract.id)
                .reduce((s, c) => s + (Number(c.amount) || 0), 0);
            const newInvoiceAmount = Math.round((Number(cascadeContract.amount) + extraRentSum) * term);

            // invoice cascade — 走 store.updateInvoice 確保 persist + sync 事件正確觸發
            const rentInvoices = mockData.invoices.filter(inv =>
                inv.contractId === cascadeContract.id && inv.direction === 'in' && inv.type === '房租'
            );
            rentInvoices.forEach(inv => {
                const oldAmt = Number(inv.amount) || 0;
                if (oldAmt === newInvoiceAmount) return;
                this.updateInvoice(inv.id, { amount: newInvoiceAmount });
                window.dispatchEvent(new CustomEvent('bms:contract-sync-invoice', {
                    detail: {
                        contractId: cascadeContract.id,
                        invoiceId: inv.id,
                        oldAmount: oldAmt,
                        newAmount: newInvoiceAmount,
                        newMonthlyRent: cascadeContract.amount
                    }
                }));
            });

            // 床位 property.rent 同步 — 走 store.updateProperty 確保雲端同步
            const property = mockData.properties.find(p => p.name === after.propertyName);
            if (property && property.rent !== after.amount) {
                this.updateProperty(property.id, { rent: after.amount });
            }
        }

        // === bundle 群組同步: 改一邊, 主合約 + 全子合約跟著同步關鍵欄位 ===
        // 同步欄位: startDate / endDate / termMonths / tenant / paymentChannel / platformName / renewalState / pendingTerminationDate
        // 不同步: amount (每床自己的租金) / propertyName (每張各綁不同床) / status (簽署狀態各自填)
        // _skipBundleCascade 旗標防無限迴圈
        if (!_skipBundleCascade) {
            const SYNC_FIELDS = ['startDate', 'endDate', 'termMonths', 'tenant', 'paymentChannel', 'platformName', 'renewalState', 'pendingTerminationDate', 'terminatedDate'];
            const syncPatch = {};
            SYNC_FIELDS.forEach(k => {
                if (k in patch && before[k] !== after[k]) syncPatch[k] = after[k];
            });
            if (Object.keys(syncPatch).length > 0) {
                // 找 bundle 群組: 該合約若是 parent → 找所有 child; 若是 child → 找 parent + 兄弟 child
                const groupRootId = after.bundleParentContractId || after.id;
                const groupMembers = mockData.contracts.filter(c =>
                    c.id !== after.id &&
                    (c.id === groupRootId || c.bundleParentContractId === groupRootId)
                );
                groupMembers.forEach(member => {
                    this.updateContract(member.id, syncPatch, true); // skip 防迴圈
                });
            }
        }
        recalcMetrics();
        return after;
    },
    // === 綁定多份合約為同一筆收款 group ===
    // parentId = 主合約 (保留 invoice), childIds = 子合約陣列 (invoice 併入 parent, 自身 invoice 刪掉)
    // 用於: 同租客同館多床、想一筆收款涵蓋全部
    bundleContracts(parentId, childIds) {
        const parent = mockData.contracts.find(c => c.id === parentId);
        if (!parent) return { ok: false, msg: '找不到主合約' };
        if (!Array.isArray(childIds) || childIds.length === 0) return { ok: false, msg: '請至少選一份子合約' };

        const children = childIds.map(id => mockData.contracts.find(c => c.id === id)).filter(Boolean);
        if (children.some(c => c.id === parentId)) return { ok: false, msg: '主合約不能同時是子合約' };
        if (children.some(c => c.bundleParentContractId && c.bundleParentContractId !== parentId)) {
            return { ok: false, msg: '有合約已綁在其他 bundle 上, 請先解除' };
        }
        // 同租客檢查 (避免誤綁)
        if (children.some(c => c.tenant !== parent.tenant)) {
            return { ok: false, msg: '只能綁同租客的合約' };
        }

        // 1. 子合約設 parent + 子 invoice 歸零 (保留紀錄但金額為 0、已結清)
        // 設計理念：每張合約都應該有自己的 invoice (帳本完整), 但金額轉移到主合約
        children.forEach(c => {
            const ci = mockData.contracts.findIndex(x => x.id === c.id);
            if (ci < 0) return;
            mockData.contracts[ci] = {
                ...mockData.contracts[ci],
                bundleParentContractId: parentId,
                // 記錄原始 amount, unbundle 時可還原
                bundleOriginalAmount: mockData.contracts[ci].bundleOriginalAmount ?? mockData.contracts[ci].amount
            };
            // 子合約 invoice 歸零 + 標已結清 + 註明併入哪份
            const childInvoices = mockData.invoices.filter(inv =>
                inv.contractId === c.id && inv.direction === 'in' && inv.type === '房租'
            );
            childInvoices.forEach(inv => {
                this.updateInvoice(inv.id, {
                    amount: 0,
                    discount: 0,
                    paidAmount: 0,
                    status: '已繳清',
                    note: `併入 ${parentId} 收款 (原應收 $${(inv.amount || 0).toLocaleString()})`
                });
            });
        });

        // 2. parent invoice 重算: amount = (parent.amount + sum(children.amount)) * term
        const term = parent.termMonths || 1;
        const childRentSum = children.reduce((s, c) => s + (Number(c.amount) || 0), 0);
        const newAmount = Math.round((Number(parent.amount) + childRentSum) * term);
        const parentInvoices = mockData.invoices.filter(inv =>
            inv.contractId === parentId && inv.direction === 'in' && inv.type === '房租'
        );
        parentInvoices.forEach(inv => {
            if (Number(inv.amount) !== newAmount) {
                this.updateInvoice(inv.id, { amount: newAmount });
            }
        });
        // parent 沒 invoice (e.g. 也是 bundle 子) → 給一張新的
        if (parentInvoices.length === 0) {
            const newInv = buildContractInvoice(parent, { __bundleExtraRents: children.map(c => Number(c.amount) || 0) });
            if (newInv) mockData.invoices.push(newInv);
        }
        recalcMetrics();
        return { ok: true, parentId, childIds: children.map(c => c.id), newAmount };
    },
    // 解除綁定 — 還原 children 的獨立 invoice + parent invoice 扣回
    unbundleContracts(childIds) {
        const children = childIds.map(id => mockData.contracts.find(c => c.id === id)).filter(Boolean);
        if (children.length === 0) return { ok: false, msg: '找不到合約' };

        const affectedParents = new Set();
        children.forEach(c => {
            if (c.bundleParentContractId) affectedParents.add(c.bundleParentContractId);
            const ci = mockData.contracts.findIndex(x => x.id === c.id);
            if (ci < 0) return;
            const restoreAmount = c.bundleOriginalAmount ?? c.amount;
            mockData.contracts[ci] = {
                ...mockData.contracts[ci],
                bundleParentContractId: null,
                amount: restoreAmount,
                bundleOriginalAmount: undefined
            };
            // 子合約原本歸零的 invoice → 還原金額
            const childInvoices = mockData.invoices.filter(inv =>
                inv.contractId === c.id && inv.direction === 'in' && inv.type === '房租'
            );
            const term = mockData.contracts[ci].termMonths || 1;
            const restoreInvoiceAmount = Math.round(Number(restoreAmount) * term);
            if (childInvoices.length === 0) {
                // 萬一 invoice 真的不在 (例如舊版刪除過) → 重新建立
                createInvoiceForContract(mockData.contracts[ci], { paidAmount: 0 });
            } else {
                childInvoices.forEach(inv => {
                    this.updateInvoice(inv.id, {
                        amount: restoreInvoiceAmount,
                        discount: 0,
                        paidAmount: 0,
                        status: '欠繳',
                        note: ''
                    });
                });
            }
        });

        // parent invoice 重算: 扣掉解除的 child rent
        affectedParents.forEach(pId => {
            const parent = mockData.contracts.find(c => c.id === pId);
            if (!parent) return;
            const term = parent.termMonths || 1;
            const remainingChildren = mockData.contracts.filter(c => c.bundleParentContractId === pId);
            const childRentSum = remainingChildren.reduce((s, c) => s + (Number(c.amount) || 0), 0);
            const newAmount = Math.round((Number(parent.amount) + childRentSum) * term);
            mockData.invoices
                .filter(inv => inv.contractId === pId && inv.direction === 'in' && inv.type === '房租')
                .forEach(inv => {
                    if (Number(inv.amount) !== newAmount) this.updateInvoice(inv.id, { amount: newAmount });
                });
        });
        recalcMetrics();
        return { ok: true, childIds: children.map(c => c.id) };
    },
    deleteContract(id) {
        const c = mockData.contracts.find(x => x.id === id);
        if (!c) return;
        const tenantName = c.tenant;
        const propertyName = c.propertyName;

        // 1. 刪除合約 + 對應已產的房租 invoice
        mockData.contracts = mockData.contracts.filter(x => x.id !== id);
        mockData.invoices = mockData.invoices.filter(inv => inv.contractId !== id);

        // 2. 清掉物件上的 denormalized 欄位（若指向這份合約）
        const prop = mockData.properties.find(p => p.name === propertyName && p.contractId === id);
        if (prop) {
            prop.tenant = null;
            prop.contractId = null;
            prop.contractEnd = null;
            prop.status = '待租';
        }

        // 3. 若該租客沒有任何其他 active 合約 → 清掉 currentProperty + 變待入住
        if (tenantName) {
            const stillActive = mockData.contracts.some(x => x.tenant === tenantName && x.renewalState === 'active');
            if (!stillActive) {
                const t = mockData.tenants.find(x => x.name === tenantName);
                if (t) {
                    t.currentProperty = null;
                    t.status = '待入住';
                }
            }
        }

        recalcMetrics();
        window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'contracts', id } }));
    },

    // 續租：基於舊合約自動產生新合約（同物件/租客/租金/termMonths，新期間 = 舊 endDate+1 ~ +30/+90 天）
    renewContract(oldContractId) {
        const oldContract = mockData.contracts.find(c => c.id === oldContractId);
        if (!oldContract) return { error: 'not_found' };
        if (oldContract.renewalState !== 'active') return { error: 'already_decided' };

        const termMonths = oldContract.termMonths || 1;
        // 續租 convention: endDate = 下期起算日 (calendar +N 月, 不 −1)
        //   → 新合約 startDate = 舊 endDate (同一天交接)
        //   → 新合約 endDate   = leaseEndISO(newStart, termMonths) = newStart + N 月
        const newStartISO = oldContract.endDate || new Date().toISOString().split('T')[0];
        const newEndISO = leaseEndISO(newStartISO, termMonths);

        const newContract = {
            id: nextId('C', mockData.contracts),
            contractType: oldContract.contractType || null,
            buildingId: oldContract.buildingId || null,
            ownerId: oldContract.ownerId || null,
            lessorName: oldContract.lessorName || null,
            propertyId: oldContract.propertyId,
            propertyName: oldContract.propertyName,
            tenant: oldContract.tenant,
            amount: oldContract.amount,
            termMonths,
            signDate: newStartISO,
            startDate: newStartISO,
            endDate: newEndISO,
            status: '待簽署',
            parentContractId: oldContract.id,
            renewalState: 'active',
            snoozeUntil: null,
            signedFileUrl: null,
            terminatedDate: null,
            paymentChannel: oldContract.paymentChannel || 'self',
            platformName: oldContract.platformName || null
        };
        mockData.contracts.push(newContract);

        // 舊合約標 renewed
        const idx = mockData.contracts.findIndex(c => c.id === oldContractId);
        mockData.contracts[idx] = { ...mockData.contracts[idx], renewalState: 'renewed' };

        // 同步床位的合約引用
        const property = mockData.properties.find(p => p.name === oldContract.propertyName);
        if (property) {
            mockData.properties[mockData.properties.indexOf(property)] = {
                ...property,
                contractId: newContract.id,
                contractEnd: newEndISO
            };
        }

        // 自動為新合約建立全期帳單；續約預設「未繳」(等租客 LINE 回報末5碼)
        createInvoiceForContract(newContract, { paidAmount: 0 });

        recalcMetrics();
        return { ok: true, newContract };
    },

    // 歷史續租日期校正 — 舊邏輯多 +1 天，掃描所有 parentContractId != null 的合約
    //   exact pattern: startDate === addDaysISO(parent.endDate, 1)
    //   → 安全修：startDate := parent.endDate (endDate 不變)
    //   其他模式 (使用者手動改過) → skip 不動
    // 同步把 contract 的 invoice (dueDate / periodStart) 一起 shift -1 天
    // 合約 endDate 校正: 對齊新版 leaseEndISO convention (start + termMonths − 1 天)
    // dry-run: auditContractEndDates() → 列出舊資料偏差
    // apply: auditContractEndDates({ apply: true }) → 寫回正確 endDate + 連動 invoice.dueDate/periodEnd + property.contractEnd
    auditContractEndDates({ apply = false } = {}) {
        const affected = [];
        const skipped = [];
        mockData.contracts.forEach(c => {
            if (!c.startDate || !c.termMonths) {
                skipped.push({ contractId: c.id, reason: '缺 startDate 或 termMonths' });
                return;
            }
            const expectedEnd = leaseEndISO(c.startDate, c.termMonths);
            if (c.endDate === expectedEnd) return;
            // 推算: +N 天 (舊算法 days = term*30 / term===3?90:30)
            const oldStyleEnd = addDaysISO(c.startDate, c.termMonths * 30);
            const drift = c.endDate
                ? Math.round((new Date(expectedEnd) - new Date(c.endDate)) / 86400000)
                : null;
            affected.push({
                contractId: c.id,
                tenant: c.tenant,
                startDate: c.startDate,
                termMonths: c.termMonths,
                currentEnd: c.endDate,
                expectedEnd,
                oldStyleEnd,
                driftDays: drift,
                matchesOldStyle: c.endDate === oldStyleEnd
            });
        });

        if (apply) {
            affected.forEach(a => {
                const ci = mockData.contracts.findIndex(c => c.id === a.contractId);
                if (ci < 0) return;
                mockData.contracts[ci] = { ...mockData.contracts[ci], endDate: a.expectedEnd };
                // 連動 property.contractEnd
                const propName = mockData.contracts[ci].propertyName;
                const pi = mockData.properties.findIndex(p => p.name === propName && p.contractId === a.contractId);
                if (pi >= 0) {
                    mockData.properties[pi] = { ...mockData.properties[pi], contractEnd: a.expectedEnd };
                }
                // 連動 invoice.periodEnd (該合約所有 rent invoice)
                mockData.invoices.forEach((inv, ii) => {
                    if (inv.contractId === a.contractId && inv.direction === 'in' && inv.type === '房租') {
                        mockData.invoices[ii] = { ...inv, periodEnd: a.expectedEnd };
                    }
                });
            });
            persist();
            recalcMetrics();
        }
        return { affected, skipped, apply };
    },

    auditRenewalDates({ apply = false } = {}) {
        const affected = [];
        const skipped = [];
        mockData.contracts.forEach(c => {
            if (!c.parentContractId || !c.startDate) return;
            const parent = mockData.contracts.find(p => p.id === c.parentContractId);
            if (!parent || !parent.endDate) {
                skipped.push({ contractId: c.id, reason: '無 parent endDate' });
                return;
            }
            const expectedStart = parent.endDate;                 // 正確
            const buggyStart = addDaysISO(parent.endDate, 1);     // 舊 bug 結果
            if (c.startDate === expectedStart) {
                // 已經對了 (可能已校正過 / 或用戶手動改過)
                return;
            }
            if (c.startDate !== buggyStart) {
                // 偏離超過 1 天 → 用戶手動改過，不動
                skipped.push({
                    contractId: c.id,
                    reason: 'startDate 跟 buggy 模式不符，可能已手動編輯',
                    currentStart: c.startDate,
                    parentEnd: parent.endDate
                });
                return;
            }
            affected.push({
                contractId: c.id,
                tenant: c.tenant,
                propertyName: c.propertyName,
                parentEnd: parent.endDate,
                oldStart: c.startDate,
                newStart: expectedStart,
                endDate: c.endDate
            });
        });

        if (!apply) {
            return { affected, skipped, applied: false };
        }

        // apply: 修 contract.startDate + 連動 invoice
        const patchedInvoices = [];
        affected.forEach(a => {
            const idx = mockData.contracts.findIndex(c => c.id === a.contractId);
            if (idx < 0) return;
            mockData.contracts[idx] = { ...mockData.contracts[idx], startDate: a.newStart };
            // 同步把同 contractId 的 invoice 也 shift (dueDate / periodStart 之前複製自 startDate)
            mockData.invoices.forEach((inv, i) => {
                if (inv.contractId !== a.contractId) return;
                const patch = {};
                if (inv.dueDate === a.oldStart) patch.dueDate = a.newStart;
                if (inv.periodStart === a.oldStart) patch.periodStart = a.newStart;
                if (Object.keys(patch).length) {
                    mockData.invoices[i] = { ...inv, ...patch };
                    patchedInvoices.push({ invoiceId: inv.id, ...patch });
                }
            });
        });
        persist();
        recalcMetrics();
        window.dispatchEvent(new CustomEvent('bms:audit-applied', { detail: { type: 'renewal-dates', count: affected.length } }));
        return { affected, skipped, applied: true, patchedInvoices };
    },

    // bundle 重複 invoice 校正 — 舊版額外床位合約沒帶 __skipInvoice
    // 主合約 invoice 已含所有床位月租，額外合約自己也開了 invoice → 重複算
    // 偵測規則: 主 invoice note 含「含額外 N 張床位」→ 找同 tenant + 同 dueDate + 同 buildingId 的其他 invoice 視為重複
    auditBundleInvoices({ apply = false } = {}) {
        const affected = [];
        const skipped = [];
        const bundleMains = mockData.invoices.filter(inv =>
            inv.direction === 'in'
            && inv.type === '房租'
            && /含額外\s*(\d+)\s*張床位/.test(inv.note || '')
        );
        bundleMains.forEach(main => {
            const dupes = mockData.invoices.filter(inv =>
                inv.id !== main.id
                && inv.direction === 'in'
                && inv.type === '房租'
                && inv.tenant === main.tenant
                && inv.dueDate === main.dueDate
                && inv.buildingId === main.buildingId
                && inv.propertyName !== main.propertyName
            );
            dupes.forEach(dup => {
                // 安全檢查：dup 的合約是 bundleParent=main.contractId 或 amount 跟主合約裡某個 extra 對得起來
                const dupContract = mockData.contracts.find(c => c.id === dup.contractId);
                const isLinkedBundle = dupContract?.bundleParentContractId === main.contractId;
                // 沒 link 但 amount 規律對得起來 — 也算 (歷史 bug 產生的舊資料)
                if (isLinkedBundle || (dupContract && dupContract.tenant === main.tenant && dupContract.startDate === dupContract.startDate)) {
                    affected.push({
                        mainInvoiceId: main.id,
                        mainAmount: main.amount,
                        dupInvoiceId: dup.id,
                        dupAmount: dup.amount,
                        tenant: dup.tenant,
                        propertyName: dup.propertyName,
                        dueDate: dup.dueDate,
                        dupContractId: dup.contractId
                    });
                } else {
                    skipped.push({
                        dupInvoiceId: dup.id,
                        reason: '對應合約看不出 bundle 關係 (可能是獨立帳單)',
                        tenant: dup.tenant,
                        propertyName: dup.propertyName
                    });
                }
            });
        });

        if (!apply) return { affected, skipped, applied: false };

        // apply: 刪除重複 invoice + 給對應合約補上 bundleParentContractId
        const deletedIds = [];
        affected.forEach(a => {
            const idx = mockData.invoices.findIndex(inv => inv.id === a.dupInvoiceId);
            if (idx >= 0) {
                mockData.invoices.splice(idx, 1);
                deletedIds.push(a.dupInvoiceId);
            }
            // 補旗標到合約上 (方便未來辨識 + 防呆)
            const cIdx = mockData.contracts.findIndex(c => c.id === a.dupContractId);
            if (cIdx >= 0 && !mockData.contracts[cIdx].bundleParentContractId) {
                const mainInv = mockData.invoices.find(inv => inv.id === a.mainInvoiceId);
                mockData.contracts[cIdx] = { ...mockData.contracts[cIdx], bundleParentContractId: mainInv?.contractId || null };
            }
        });
        persist();
        recalcMetrics();
        window.dispatchEvent(new CustomEvent('bms:audit-applied', { detail: { type: 'bundle-invoices', count: deletedIds.length } }));
        return { affected, skipped, applied: true, deletedIds };
    },

    // 退租：終止合約 + 床位釋放 + 租客標記
    terminateContract(contractId, options = {}) {
        const c = mockData.contracts.find(x => x.id === contractId);
        if (!c) return { error: 'not_found' };

        const today = new Date().toISOString().split('T')[0];
        const effectiveDate = options.effectiveDate || today;
        const idx = mockData.contracts.findIndex(x => x.id === contractId);

        // 退租生效日 > 今天 → 延後處理: 只標 pendingTerminationDate, 床位/租客還在
        // 到生效日後 finalizePendingTerminations() 會自動完成
        if (effectiveDate > today) {
            mockData.contracts[idx] = {
                ...mockData.contracts[idx],
                pendingTerminationDate: effectiveDate
            };
            recalcMetrics();
            return { ok: true, pending: true, effectiveDate };
        }

        // 立即執行 (effectiveDate <= today)
        return this._finalizeTermination(contractId, effectiveDate);
    },

    // 內部: 真正執行退租 (釋放床位+租客+清 pending 旗標)
    _finalizeTermination(contractId, effectiveDate) {
        const c = mockData.contracts.find(x => x.id === contractId);
        if (!c) return { error: 'not_found' };
        const idx = mockData.contracts.findIndex(x => x.id === contractId);
        mockData.contracts[idx] = {
            ...mockData.contracts[idx],
            renewalState: 'terminated',
            terminatedDate: effectiveDate,
            status: '已終止',
            pendingTerminationDate: null
        };

        // 釋放床位 (僅當床位仍指向此合約)
        const property = mockData.properties.find(p => p.name === c.propertyName && p.contractId === contractId);
        if (property) {
            const pIdx = mockData.properties.indexOf(property);
            mockData.properties[pIdx] = {
                ...property,
                status: '待租',
                tenant: null,
                contractId: null,
                contractEnd: null
            };
        }

        // 租客標記 (僅當該租客沒其他 active 合約)
        const tenant = mockData.tenants.find(t => t.name === c.tenant);
        if (tenant) {
            const stillActive = mockData.contracts.some(x =>
                x.id !== contractId && x.tenant === c.tenant && x.renewalState === 'active'
            );
            if (!stillActive) {
                const tIdx = mockData.tenants.indexOf(tenant);
                mockData.tenants[tIdx] = {
                    ...tenant,
                    status: '已退租',
                    currentProperty: null
                };
            }
        }

        recalcMetrics();
        return { ok: true };
    },

    // 掃描 pendingTerminationDate <= today 的合約, 一律執行 _finalizeTermination
    // 由 app.js / sync 在 boot + 每日 (或頁面 focus) 觸發
    finalizePendingTerminations() {
        const today = new Date().toISOString().split('T')[0];
        const due = mockData.contracts.filter(c =>
            c.pendingTerminationDate && c.pendingTerminationDate <= today
        );
        due.forEach(c => this._finalizeTermination(c.id, c.pendingTerminationDate));
        return { processed: due.length };
    },

    // 暫緩：snooze 到指定日期再提醒
    snoozeContract(contractId, days) {
        const c = mockData.contracts.find(x => x.id === contractId);
        if (!c) return { error: 'not_found' };
        const target = new Date();
        target.setDate(target.getDate() + (days || 3));
        const idx = mockData.contracts.findIndex(x => x.id === contractId);
        mockData.contracts[idx] = {
            ...mockData.contracts[idx],
            snoozeUntil: target.toISOString().split('T')[0]
        };
        persist();
        return { ok: true, until: mockData.contracts[idx].snoozeUntil };
    },

    // ----- invoices -----
    addInvoice(payload) {
        const item = { id: nextId('INV-', mockData.invoices), ...payload };
        mockData.invoices.push(item);
        recalcMetrics();
        return item;
    },

    // 種 5月期初結算 invoices 進 DB
    // - 每筆 paidDate = 2026-05-31, periodTag='opening', status='已繳清'
    // - cutoff filter (isPreCutoff) 會把它們從全站統計排除
    // - 重跑安全: 會先刪舊的 opening (periodTag='opening' on 2026-05-31), 再建新的
    // dry-run: seedMay2026Opening() → 回傳要建的 invoice 清單, 不動 DB
    // apply:   seedMay2026Opening({ apply: true }) → 寫入
    seedMay2026Opening({ apply = false } = {}) {
        const SEED_DATE = '2026-05-31';
        const TAG = 'opening';
        const expected = EXPECTED_5MAY_OPENING;
        const buildingByName = new Map(mockData.buildings.map(b => [b.name, b]));

        const planned = [];
        const warnings = [];

        Object.entries(expected.perBuilding).forEach(([bName, agg]) => {
            const b = buildingByName.get(bName);
            if (!b) {
                warnings.push(`館 "${bName}" 找不到 buildingId, 跳過 (請確認系統設定的館名跟 Excel 一致)`);
                return;
            }
            // 收入: 每館一筆 aggregate (Excel 沒給細項 by type)
            if (agg.in > 0) {
                planned.push({
                    buildingId: b.id,
                    direction: 'in',
                    type: '房租',
                    amount: agg.in,
                    discount: 0,
                    paidAmount: agg.in,
                    paidDate: SEED_DATE,
                    dueDate: SEED_DATE,
                    status: '已繳清',
                    note: `5月期初結算 — 各項收入合計 (Excel 5/31)`,
                    periodTag: TAG,
                    propertyName: null,
                    tenant: null
                });
            }
            // 支出: 每館每項一筆 (有 perBuildingOutByType 才細分, 否則 aggregate)
            const types = expected.perBuildingOutByType[bName];
            if (types && Object.keys(types).length > 0) {
                Object.entries(types).forEach(([typeName, amount]) => {
                    if (amount > 0) {
                        planned.push({
                            buildingId: b.id,
                            direction: 'out',
                            type: typeName,
                            amount,
                            discount: 0,
                            paidAmount: amount,
                            paidDate: SEED_DATE,
                            dueDate: SEED_DATE,
                            status: '已繳清',
                            note: `5月期初結算 — ${typeName}`,
                            periodTag: TAG,
                            propertyName: null,
                            tenant: null
                        });
                    }
                });
            } else if (agg.out > 0) {
                planned.push({
                    buildingId: b.id,
                    direction: 'out',
                    type: '其他',
                    amount: agg.out,
                    discount: 0,
                    paidAmount: agg.out,
                    paidDate: SEED_DATE,
                    dueDate: SEED_DATE,
                    status: '已繳清',
                    note: `5月期初結算 — 支出合計`,
                    periodTag: TAG,
                    propertyName: null,
                    tenant: null
                });
            }
        });

        // 找現有的 opening seed (要刪掉重建)
        const existingOpening = mockData.invoices.filter(inv =>
            inv.periodTag === TAG && inv.paidDate === SEED_DATE
        );

        if (apply) {
            // 1. 砍舊 opening
            existingOpening.forEach(inv => {
                mockData.invoices = mockData.invoices.filter(x => x.id !== inv.id);
                window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'invoices', id: inv.id } }));
            });
            // 2. 種新的
            planned.forEach(p => {
                const item = { id: nextId('INV-', mockData.invoices), ...p };
                mockData.invoices.push(item);
            });
            recalcMetrics();
            persist();
        }

        return {
            apply,
            toCreate: planned,
            existingOpeningCount: existingOpening.length,
            warnings,
            summary: {
                count: planned.length,
                in: planned.filter(p => p.direction === 'in').reduce((s, p) => s + p.amount, 0),
                out: planned.filter(p => p.direction === 'out').reduce((s, p) => s + p.amount, 0)
            }
        };
    },
    updateInvoice(id, patch) {
        const i = mockData.invoices.findIndex(inv => inv.id === id);
        if (i >= 0) {
            const before = mockData.invoices[i];
            mockData.invoices[i] = { ...before, ...patch };
            const after = mockData.invoices[i];

            // amount / discount / paidAmount 任一改 → 自動 derive status
            // 之前漏這段，cascade 改 amount 後 status 還停在「已繳清」變謊話
            // patch 已明確設 status 就尊重 (避免 cascade 跟 user 雙寫衝突)
            if (!('status' in patch) && ('amount' in patch || 'discount' in patch || 'paidAmount' in patch)) {
                const newStatus = deriveInvoiceStatus(after);
                if (newStatus && newStatus !== after.status) {
                    mockData.invoices[i] = { ...after, status: newStatus };
                }
            }

            // 改帳單金額 → 合約月租同步反推
            // 只處理：房租 invoice + 有 contractId + amount 真的變了
            // 反推: contract.amount = (新 invoice.amount - bundle 額外床位月租 × term) / term
            if ('amount' in patch
                && after.direction === 'in'
                && after.type === '房租'
                && after.contractId
                && Number(before.amount) !== Number(after.amount)) {
                const contract = mockData.contracts.find(c => c.id === after.contractId);
                if (contract) {
                    const term = contract.termMonths || 1;
                    const extraRentSum = mockData.contracts
                        .filter(c => c.bundleParentContractId === contract.id)
                        .reduce((s, c) => s + (Number(c.amount) || 0), 0);
                    // ⚠ Math.round 避免浮點漂移 (audit: 50000/3 沒 round 會 silently overwrite 用戶手調)
                    const newMainAmount = Math.round((Number(after.amount) / term) - extraRentSum);
                    if (newMainAmount > 0 && newMainAmount !== contract.amount) {
                        const ci = mockData.contracts.findIndex(c => c.id === contract.id);
                        if (ci >= 0) {
                            mockData.contracts[ci] = { ...mockData.contracts[ci], amount: newMainAmount };
                            // 床位 property.rent 也同步 (主床位的月租 = contract.amount)
                            const property = mockData.properties.find(p => p.name === contract.propertyName);
                            if (property) {
                                const pi = mockData.properties.indexOf(property);
                                mockData.properties[pi] = { ...property, rent: newMainAmount };
                            }
                            window.dispatchEvent(new CustomEvent('bms:invoice-sync-contract', {
                                detail: { invoiceId: id, contractId: contract.id, oldAmount: before.amount, newAmount: after.amount, newMonthlyRent: newMainAmount }
                            }));
                        }
                    }
                }
            }
            recalcMetrics();
            return after;
        }
        return null;
    },
    deleteInvoice(id) {
        mockData.invoices = mockData.invoices.filter(inv => inv.id !== id);
        recalcMetrics();
        window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'invoices', id } }));
    },

    // ----- maintenances -----
    addMaintenance(payload) {
        const item = { id: nextId('M', mockData.maintenances), ...payload };
        mockData.maintenances.push(item);
        recalcMetrics();
        return item;
    },
    updateMaintenance(id, patch) {
        const i = mockData.maintenances.findIndex(m => m.id === id);
        if (i >= 0) {
            mockData.maintenances[i] = { ...mockData.maintenances[i], ...patch };
            recalcMetrics();
            return mockData.maintenances[i];
        }
        return null;
    },
    deleteMaintenance(id) {
        mockData.maintenances = mockData.maintenances.filter(m => m.id !== id);
        recalcMetrics();
        window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'maintenances', id } }));
    },

    // ----- buildings (館別) — 禁刪，可停用 -----
    addBuilding(payload) {
        // 編號分流: 共居 = B001+, 代管 = M001+ (nextId 用 regex ^prefix\d+ 篩，互不干擾)
        const prefix = payload?.mode === 'managed' ? 'M' : 'B';
        const item = { id: nextId(prefix, mockData.buildings), status: 'active', note: '', ...payload };
        mockData.buildings.push(item);
        persist();
        return item;
    },
    updateBuilding(id, patch) {
        const i = mockData.buildings.findIndex(b => b.id === id);
        if (i >= 0) {
            const before = mockData.buildings[i];
            mockData.buildings[i] = { ...before, ...patch };
            const after = mockData.buildings[i];
            if (patch.name && patch.name !== before.name) {
                mockData.properties.forEach(p => {
                    if (p.buildingId === id) {
                        const oldName = p.name;
                        p.name = `聚空間 - ${after.name} R${p.roomNumber}-${p.bedLetter}`;
                        if (oldName) {
                            mockData.contracts.forEach(c => { if (c.propertyName === oldName) c.propertyName = p.name; });
                            mockData.invoices.forEach(inv => { if (inv.propertyName === oldName) inv.propertyName = p.name; });
                            mockData.maintenances.forEach(m => { if (m.propertyName === oldName) m.propertyName = p.name; });
                            mockData.checkins.forEach(ci => { if (ci.propertyName === oldName) ci.propertyName = p.name; });
                            mockData.tenants.forEach(t => { if (t.currentProperty === oldName) t.currentProperty = p.name; });
                        }
                    }
                });
            }
            persist();
            return after;
        }
        return null;
    },
    toggleBuildingStatus(id) {
        const b = mockData.buildings.find(x => x.id === id);
        if (b) {
            b.status = b.status === 'active' ? 'inactive' : 'active';
            persist();
        }
        return b;
    },

    // ----- contractTemplates (合約 PDF 樣板，每館一份) -----
    setContractTemplate(buildingId, fileName, pdfBase64) {
        if (!Array.isArray(mockData.contractTemplates)) mockData.contractTemplates = [];
        const idx = mockData.contractTemplates.findIndex(t => t.buildingId === buildingId);
        const item = {
            buildingId,
            fileName,
            pdfBase64,
            uploadedAt: new Date().toISOString()
        };
        if (idx >= 0) mockData.contractTemplates[idx] = item;
        else mockData.contractTemplates.push(item);
        try { persist(); } catch (e) { /* base64 太大時可能失敗 */ }
        // 觸發 sync.js 額外推大欄位 (PDF) — 避免每次小寫入都帶 PDF 上傳
        window.dispatchEvent(new CustomEvent('bms:template-changed'));
        return item;
    },
    removeContractTemplate(buildingId) {
        if (!Array.isArray(mockData.contractTemplates)) return;
        mockData.contractTemplates = mockData.contractTemplates.filter(t => t.buildingId !== buildingId);
        try { persist(); } catch (e) {}
        // 重要: 觸發雲端 DELETE — pushLarge 只跑 upsert，不會清孤兒列；
        // 沒這個事件刪完下次 pull 又會把樣板從 Supabase 拉回來
        window.dispatchEvent(new CustomEvent('bms:delete', {
            detail: { table: 'contract_templates', id: buildingId }
        }));
        window.dispatchEvent(new CustomEvent('bms:template-changed'));
    },
    getContractTemplate(buildingId) {
        if (!Array.isArray(mockData.contractTemplates)) return null;
        return mockData.contractTemplates.find(t => t.buildingId === buildingId) || null;
    },

    // ----- invoiceTypes (帳單類型) -----
    addInvoiceType(payload) {
        const item = { id: nextId('IT', mockData.invoiceTypes), note: '', ...payload };
        mockData.invoiceTypes.push(item);
        persist();
        return item;
    },
    updateInvoiceType(id, patch) {
        const i = mockData.invoiceTypes.findIndex(it => it.id === id);
        if (i >= 0) {
            const before = mockData.invoiceTypes[i];
            mockData.invoiceTypes[i] = { ...before, ...patch };
            const after = mockData.invoiceTypes[i];
            if (patch.name && patch.name !== before.name) {
                mockData.invoices.forEach(inv => {
                    if (inv.type === before.name) inv.type = after.name;
                });
            }
            persist();
            return after;
        }
        return null;
    },
    deleteInvoiceType(id) {
        const t = mockData.invoiceTypes.find(it => it.id === id);
        if (!t) return { error: 'not_found' };
        const inUse = mockData.invoices.some(inv => inv.type === t.name);
        if (inUse) return { error: 'in_use' };
        mockData.invoiceTypes = mockData.invoiceTypes.filter(it => it.id !== id);
        persist();
        window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'invoice_types', id } }));
        return { ok: true };
    },

    // ----- tenantSources (顧客來源) -----
    addTenantSource(payload) {
        const item = { id: nextId('TS', mockData.tenantSources), note: '', ...payload };
        mockData.tenantSources.push(item);
        persist();
        return item;
    },
    updateTenantSource(id, patch) {
        const i = mockData.tenantSources.findIndex(s => s.id === id);
        if (i < 0) return null;
        const before = mockData.tenantSources[i];
        mockData.tenantSources[i] = { ...before, ...patch };
        // 改名 → 連動更新所有租客的 source
        if (patch.name && patch.name !== before.name) {
            mockData.tenants.forEach(t => {
                if (t.source === before.name) t.source = patch.name;
            });
        }
        persist();
        return mockData.tenantSources[i];
    },
    deleteTenantSource(id) {
        const s = mockData.tenantSources.find(x => x.id === id);
        if (!s) return { error: 'not_found' };
        const inUse = mockData.tenants.some(t => t.source === s.name);
        if (inUse) return { error: 'in_use' };
        mockData.tenantSources = mockData.tenantSources.filter(x => x.id !== id);
        persist();
        window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'tenant_sources', id } }));
        return { ok: true };
    },

    // ----- paymentMethods (付款方式) -----
    addPaymentMethod(payload) {
        const item = { id: nextId('PM', mockData.paymentMethods), note: '', ...payload };
        mockData.paymentMethods.push(item);
        persist();
        return item;
    },
    updatePaymentMethod(id, patch) {
        const i = mockData.paymentMethods.findIndex(p => p.id === id);
        if (i < 0) return null;
        const before = mockData.paymentMethods[i];
        mockData.paymentMethods[i] = { ...before, ...patch };
        if (patch.name && patch.name !== before.name) {
            mockData.invoices.forEach(inv => {
                if (inv.paymentMethod === before.name) inv.paymentMethod = patch.name;
            });
        }
        persist();
        return mockData.paymentMethods[i];
    },
    deletePaymentMethod(id) {
        const p = mockData.paymentMethods.find(x => x.id === id);
        if (!p) return { error: 'not_found' };
        const inUse = mockData.invoices.some(inv => inv.paymentMethod === p.name);
        if (inUse) return { error: 'in_use' };
        mockData.paymentMethods = mockData.paymentMethods.filter(x => x.id !== id);
        persist();
        window.dispatchEvent(new CustomEvent('bms:delete', { detail: { table: 'payment_methods', id } }));
        return { ok: true };
    },

    // ----- checkins -----
    addCheckin(payload) {
        const item = {
            id: nextId('CI', mockData.checkins),
            tasks: { contract: false, deposit: false, keys: false, conditionReport: false },
            ...payload
        };
        mockData.checkins.push(item);
        persist();
        return item;
    },
    updateCheckin(id, patch) {
        const i = mockData.checkins.findIndex(ci => ci.id === id);
        if (i >= 0) {
            mockData.checkins[i] = { ...mockData.checkins[i], ...patch };
            persist();
            return mockData.checkins[i];
        }
        return null;
    },
    deleteCheckin(id) {
        mockData.checkins = mockData.checkins.filter(ci => ci.id !== id);
        persist();
    },

    // ===== 代管模式 =====

    // ----- owners (屋主主檔) -----
    addOwner(payload) {
        const now = new Date().toISOString();
        const item = {
            id: nextId('O', mockData.owners),
            name: '',
            gender: '',
            phone: '',
            email: '',
            lineId: '',
            source: '員工面談',          // '屋主自填' (公開表單) / '員工面談' / '朋友推薦' / '其他'
            howKnown: '',                // 'Facebook' / 'Google' / '朋友' / '路過看到房子' / '其他'
            howKnownOther: '',
            note: '',
            status: 'active',            // 'pending_review' (公開表單) / 'active' / 'archived'
            submittedAt: now,
            reviewedBy: null,
            reviewedAt: null,
            ...payload
        };
        mockData.owners.push(item);
        persist();
        window.dispatchEvent(new CustomEvent('bms:create', { detail: { table: 'owners', id: item.id } }));
        return item;
    },
    updateOwner(id, patch) {
        const i = mockData.owners.findIndex(o => o.id === id);
        if (i < 0) return null;
        mockData.owners[i] = { ...mockData.owners[i], ...patch };
        persist();
        window.dispatchEvent(new CustomEvent('bms:update', { detail: { table: 'owners', id } }));
        return mockData.owners[i];
    },
    archiveOwner(id) {
        return this.updateOwner(id, { status: 'archived' });
    },
    approveOwner(id, reviewerId = null) {
        return this.updateOwner(id, {
            status: 'active',
            reviewedBy: reviewerId,
            reviewedAt: new Date().toISOString()
        });
    },
    // 此屋主名下還有沒有 active 代管房屋（封存前檢查用）
    ownerActiveHouseCount(ownerId) {
        return mockData.buildings.filter(b => b.mode === 'managed' && b.ownerId === ownerId && b.status === 'active').length;
    },

    // ----- deposits (押金 ledger — 代管專用) -----
    // 房客交 → holder='pms' → 月結時轉 holder='owner' + 記 transferredDate
    addDeposit(payload) {
        const item = {
            id: nextId('D', mockData.deposits),
            contractId: null,
            tenantName: '',
            propertyName: '',
            buildingId: null,
            amount: 0,
            holder: 'pms',
            collectedDate: new Date().toISOString().slice(0, 10),
            transferredDate: null,
            note: '',
            ...payload
        };
        mockData.deposits.push(item);
        persist();
        return item;
    },
    transferDepositToOwner(id, transferDate = null) {
        const i = mockData.deposits.findIndex(d => d.id === id);
        if (i < 0) return null;
        mockData.deposits[i] = {
            ...mockData.deposits[i],
            holder: 'owner',
            transferredDate: transferDate || new Date().toISOString().slice(0, 10)
        };
        persist();
        return mockData.deposits[i];
    },
    // 某棟代管房屋 (= 某屋主) 目前持有押金總額
    ownerHoldingDepositTotal(buildingId) {
        return mockData.deposits
            .filter(d => d.buildingId === buildingId && d.holder === 'owner')
            .reduce((s, d) => s + (Number(d.amount) || 0), 0);
    },

    // ----- settlements (屋主月結算 — P3) -----
    // 自動產生一張月結算單，items 走預設 5 段：收租 / 能源 / 修繕 / 其他 / 代管費
    // 結算邏輯需要 invoices / deposits / 房屋設定，這裡放骨架；實際計算 in views/managed/settlements.js
    addSettlement(payload) {
        const item = {
            id: nextId('S', mockData.settlements),
            ownerId: null,
            buildingId: null,
            month: new Date().toISOString().slice(0, 7),  // YYYY-MM
            items: [],                                     // [{ type, label, amount, breakdown?, note? }]
            ownerReceivable: 0,
            depositCollectedThisMonth: 0,
            depositTransferredThisMonth: 0,
            ownerHoldingDepositTotal: 0,
            status: 'draft',                               // 'draft' | 'sent' | 'settled'
            createdAt: new Date().toISOString(),
            sentAt: null,
            ...payload
        };
        mockData.settlements.push(item);
        persist();
        return item;
    },
    updateSettlement(id, patch) {
        const i = mockData.settlements.findIndex(s => s.id === id);
        if (i < 0) return null;
        mockData.settlements[i] = { ...mockData.settlements[i], ...patch };
        persist();
        return mockData.settlements[i];
    },
    deleteSettlement(id) {
        mockData.settlements = mockData.settlements.filter(s => s.id !== id);
        persist();
    }
};

// 代管 helpers (給 view 用)
export function getOwnerById(id) {
    return mockData.owners.find(o => o.id === id) || null;
}
export function getManagedBuildings({ activeOnly = false } = {}) {
    return mockData.buildings
        .filter(b => b.mode === 'managed' && (!activeOnly || b.status === 'active'))
        .sort((a, b) => (a.id || '').localeCompare(b.id || ''));
}
export function getCohousingBuildings({ activeOnly = false } = {}) {
    return mockData.buildings
        .filter(b => b.mode !== 'managed' && (!activeOnly || b.status === 'active'))
        .sort((a, b) => (a.id || '').localeCompare(b.id || ''));
}

// 收款金額：優先用 paidAmount (實收)，舊資料無此欄位則退回 amount
function invoicePaidValue(inv) {
    return inv.paidAmount != null && inv.paidAmount > 0 ? inv.paidAmount : (inv.amount || 0);
}

// 隨資料變動自動重算 dashboard 指標 + 持久化
function recalcMetrics() {
    const props = mockData.properties;
    mockData.metrics.totalProperties = props.length;
    mockData.metrics.rentedProperties = props.filter(p => bedOccupied(p.name)).length;
    mockData.metrics.pendingContracts = mockData.contracts.filter(c => c.status === '待簽署').length;
    mockData.metrics.pendingMaintenances = mockData.maintenances.filter(m => m.status !== '已完成').length;
    // 月入帳：所有收款 invoice 的實收金額 (含部分繳款) — 跟 finance.js 的 actualAmount 對齊
    mockData.metrics.monthlyIncome = mockData.invoices
        .filter(inv => inv.direction === 'in')
        .reduce((sum, inv) => sum + invoicePaidValue(inv), 0);
    persist();
}

// Income Chart Data
export const monthlyChartData = {
    labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
    income: [820000, 835000, 850000, 850000, 865000, 0],
    expense: [120000, 95000, 110000, 80000, 45000, 0]
};
