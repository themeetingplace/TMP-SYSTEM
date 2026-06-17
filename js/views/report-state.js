// 報表頁共用狀態 (區間 + 子分頁 + 分組方式)
// 跟 finance-state.js 是分開的 — 報表用區間 (start/end)，帳務用單月
import { currentMonth } from '../data.js';

// 預設區間 = 本月 1 號到今天
function defaultRange() {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const start = new Date(y, m, 1);
    const end = today;
    return {
        start: toIso(start),
        end: toIso(end),
        preset: 'thisMonth'
    };
}

function toIso(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export const reportState = {
    viewRange: defaultRange(),
    viewGrouping: 'building',                     // 'building' | 'group'
    activeTab: 'buildings',                       // 'buildings' | 'analysis' | 'yearly'
    activeBuilding: 'all',                        // 'all' | <buildingId>
    yearlyYear: new Date().getFullYear()          // R3: 年度總表選擇年份
};

// 預設區間選項，傳給 picker 用
// 每項回傳 { start, end } ISO 字串
export const RANGE_PRESETS = [
    {
        key: 'thisMonth',
        label: '本月',
        compute: () => {
            const d = new Date();
            const start = new Date(d.getFullYear(), d.getMonth(), 1);
            const end = new Date();
            return { start: toIso(start), end: toIso(end) };
        }
    },
    {
        key: 'lastMonth',
        label: '上月',
        compute: () => {
            const d = new Date();
            const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
            const end = new Date(d.getFullYear(), d.getMonth(), 0);
            return { start: toIso(start), end: toIso(end) };
        }
    },
    {
        key: 'thisQuarter',
        label: '本季',
        compute: () => {
            const d = new Date();
            const q = Math.floor(d.getMonth() / 3);
            const start = new Date(d.getFullYear(), q * 3, 1);
            const end = new Date();
            return { start: toIso(start), end: toIso(end) };
        }
    },
    {
        key: 'lastQuarter',
        label: '上季',
        compute: () => {
            const d = new Date();
            const q = Math.floor(d.getMonth() / 3) - 1;
            const ny = q < 0 ? d.getFullYear() - 1 : d.getFullYear();
            const nq = (q + 4) % 4;
            const start = new Date(ny, nq * 3, 1);
            const end = new Date(ny, nq * 3 + 3, 0);
            return { start: toIso(start), end: toIso(end) };
        }
    },
    {
        key: 'thisYear',
        label: '本年度',
        compute: () => {
            const d = new Date();
            const start = new Date(d.getFullYear(), 0, 1);
            const end = new Date();
            return { start: toIso(start), end: toIso(end) };
        }
    },
    {
        key: 'lastYear',
        label: '去年度',
        compute: () => {
            const d = new Date();
            const start = new Date(d.getFullYear() - 1, 0, 1);
            const end = new Date(d.getFullYear() - 1, 11, 31);
            return { start: toIso(start), end: toIso(end) };
        }
    },
    {
        key: 'last12m',
        label: '過去 12 個月',
        compute: () => {
            const d = new Date();
            const start = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
            const end = new Date();
            return { start: toIso(start), end: toIso(end) };
        }
    },
    {
        key: 'all',
        label: '全期',
        compute: () => {
            return { start: '2020-01-01', end: toIso(new Date()) };
        }
    }
];

// 套用預設選項
export function applyRangePreset(key) {
    const p = RANGE_PRESETS.find(x => x.key === key);
    if (!p) return;
    const r = p.compute();
    reportState.viewRange = { ...r, preset: key };
}

// 顯示用 label (例：「本月 (06/01 ~ 06/10)」)
export function getRangeLabel() {
    const r = reportState.viewRange;
    const preset = RANGE_PRESETS.find(x => x.key === r.preset);
    const fmt = (iso) => iso ? iso.slice(5).replace('-', '/') : '?';
    if (preset && r.preset !== 'custom') {
        return `${preset.label} · ${fmt(r.start)} ~ ${fmt(r.end)}`;
    }
    return `${fmt(r.start)} ~ ${fmt(r.end)}`;
}

// 判斷一筆 invoice 是否落在區間內 (用 paidDate 或 dueDate)
export function invoiceInRange(inv, range = reportState.viewRange) {
    const date = inv.paidDate || inv.dueDate;
    if (!date) return false;
    return date >= range.start && date <= range.end;
}
