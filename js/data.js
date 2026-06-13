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

    // 館別主檔（禁刪，可停用） — group 用於財報合併（例：松師 = 松山+師大）
    buildings: [
        { id: 'B001', name: '松山館',  baseAddress: '台北市松山區南京東路 50 號',   group: '松師', status: 'active', note: '' },
        { id: 'B002', name: '信義館',  baseAddress: '台北市信義區信義路五段 100 號', group: '信義', status: 'active', note: '' },
        { id: 'B003', name: '中山館',  baseAddress: '台北市中山區中山北路二段 60 號', group: '中山', status: 'active', note: '' },
        { id: 'B004', name: '古亭1館', baseAddress: '台北市大安區古亭街 120 號',     group: '古亭', status: 'active', note: '' },
        { id: 'B005', name: '古亭2館', baseAddress: '台北市大安區古亭街 150 號',     group: '古亭', status: 'active', note: '' },
        { id: 'B006', name: '師大館',  baseAddress: '台北市大安區師大路 88 號',       group: '松師', status: 'active', note: '' }
    ],

    // 合約 PDF 樣板（每館一份）— pdfBase64 由使用者上傳
    // {  buildingId, fileName, pdfBase64, uploadedAt }
    contractTemplates: [],

    // 顧客來源主檔
    tenantSources: [
        { id: 'TS001', name: 'Facebook', note: '' },
        { id: 'TS002', name: 'Airbnb',   note: '' },
        { id: 'TS003', name: 'LINE',     note: '' },
        { id: 'TS004', name: '591',      note: '' },
        { id: 'TS005', name: '朋友介紹', note: '' },
        { id: 'TS006', name: '其他',     note: '' }
    ],

    // 付款方式主檔
    paymentMethods: [
        { id: 'PM001', name: '匯款',   note: '' },
        { id: 'PM002', name: '現金',   note: '' },
        { id: 'PM003', name: '信用卡', note: '' }
    ],

    // 帳單類型主檔（direction: in=收入, out=支出 / isRecurring: 每月固定）
    invoiceTypes: [
        // 收入類（房租全包，無另外水電費；訂金 = 一個月房租，併入房租即可）
        { id: 'IT001', name: '房租',       direction: 'in',  isRecurring: true,  note: '向租客收的房租（含水電全包）' },
        { id: 'IT002', name: '其他收入',   direction: 'in',  isRecurring: false, note: '' },

        // 支出類
        { id: 'IT101', name: '房東租金',   direction: 'out', isRecurring: true,  note: '付給房東的整棟租金' },
        { id: 'IT102', name: '薪水',       direction: 'out', isRecurring: true,  note: '' },
        { id: 'IT103', name: '水費',       direction: 'out', isRecurring: true,  note: '' },
        { id: 'IT104', name: '電費',       direction: 'out', isRecurring: true,  note: '' },
        { id: 'IT105', name: '瓦斯費',     direction: 'out', isRecurring: true,  note: '' },
        { id: 'IT106', name: '網路費',     direction: 'out', isRecurring: true,  note: '' },
        { id: 'IT107', name: '管理費',     direction: 'out', isRecurring: true,  note: '社區管理費' },
        { id: 'IT108', name: '清潔用品',   direction: 'out', isRecurring: false, note: '' },
        { id: 'IT109', name: '修繕雜支',   direction: 'out', isRecurring: false, note: '' },
        { id: 'IT110', name: '紅利發放',   direction: 'out', isRecurring: false, note: '' },
        { id: 'IT111', name: '其他支出',   direction: 'out', isRecurring: false, note: '' }
    ]
};

// === localStorage 持久化（避免重整時遺失修改） ===
// 2026-06-13: 系統改名 BMS → PMS，key 跟著改
// 為了不讓老用戶資料消失，hydrate 時會先試新 key，沒有就讀舊 key 並一次性 migrate
const STORAGE_KEY = 'bananas-pms-data-v1';
const LEGACY_STORAGE_KEY = 'bananas-bms-data-v1';
let _persistDisabled = false;

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
if (wasHydrated) console.info('[BMS] 已從本機儲存載入既有資料');

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

    if (diffDays > 14) return 'active';
    if (diffDays > 7) return 'expiring_soon';
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
export function formatDiscountReason(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (!s.startsWith('[')) return s;  // 舊格式，純文字
    try {
        const items = JSON.parse(s);
        if (!Array.isArray(items)) return s;
        return items.map(x => {
            const sign = x.kind === 'add' ? '+' : '−';
            const amt = (x.amount || 0).toLocaleString();
            return `${sign}$${amt} ${x.label || ''}`.trim();
        }).join(' · ');
    } catch {
        return s;
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
        const { __payment, ...contractFields } = payload;
        const item = { id: nextId('C', mockData.contracts), ...contractFields };
        mockData.contracts.push(item);
        // 一份合約 = 一張帳單：自動建立全期房租應收
        if (item.renewalState === 'active' || !item.renewalState) {
            createInvoiceForContract(item, __payment || {});
        }
        recalcMetrics();
        return item;
    },
    updateContract(id, patch) {
        const i = mockData.contracts.findIndex(c => c.id === id);
        if (i >= 0) {
            mockData.contracts[i] = { ...mockData.contracts[i], ...patch };
            recalcMetrics();
            return mockData.contracts[i];
        }
        return null;
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
        const days = termMonths === 3 ? 90 : 30;
        const newStart = oldContract.endDate
            ? new Date(oldContract.endDate)
            : new Date();
        newStart.setDate(newStart.getDate() + 1);
        const newStartISO = newStart.toISOString().split('T')[0];
        const newEnd = new Date(newStart);
        newEnd.setDate(newEnd.getDate() + days - 1);
        const newEndISO = newEnd.toISOString().split('T')[0];

        const newContract = {
            id: nextId('C', mockData.contracts),
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
            terminatedDate: null
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

    // 退租：終止合約 + 床位釋放 + 租客標記
    terminateContract(contractId, options = {}) {
        const c = mockData.contracts.find(x => x.id === contractId);
        if (!c) return { error: 'not_found' };

        const effectiveDate = options.effectiveDate || new Date().toISOString().split('T')[0];
        const idx = mockData.contracts.findIndex(x => x.id === contractId);
        mockData.contracts[idx] = {
            ...mockData.contracts[idx],
            renewalState: 'terminated',
            terminatedDate: effectiveDate,
            status: '已終止'
        };

        // 釋放床位
        const property = mockData.properties.find(p => p.name === c.propertyName);
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

        // 租客標記
        const tenant = mockData.tenants.find(t => t.name === c.tenant);
        if (tenant) {
            const tIdx = mockData.tenants.indexOf(tenant);
            mockData.tenants[tIdx] = {
                ...tenant,
                status: '已退租',
                currentProperty: null
            };
        }

        recalcMetrics();
        return { ok: true };
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
    updateInvoice(id, patch) {
        const i = mockData.invoices.findIndex(inv => inv.id === id);
        if (i >= 0) {
            mockData.invoices[i] = { ...mockData.invoices[i], ...patch };
            recalcMetrics();
            return mockData.invoices[i];
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
        const item = { id: nextId('B', mockData.buildings), status: 'active', note: '', ...payload };
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
    }
};

// 收款金額：優先用 paidAmount (實收)，舊資料無此欄位則退回 amount
function invoicePaidValue(inv) {
    return inv.paidAmount != null && inv.paidAmount > 0 ? inv.paidAmount : (inv.amount || 0);
}

// 隨資料變動自動重算 dashboard 指標 + 持久化
function recalcMetrics() {
    const props = mockData.properties;
    mockData.metrics.totalProperties = props.length;
    mockData.metrics.rentedProperties = props.filter(p => p.status === '已出租').length;
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
