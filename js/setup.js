// Supabase Setup Guide
// Run this in browser console to test Supabase connection

import { supabase } from './supabase.js';

export async function testSupabaseConnection() {
    try {
        console.log('🔍 Testing Supabase connection...');

        // Test connection by trying to get a simple query
        const { data, error } = await supabase.from('properties').select('count').limit(1);

        if (error) {
            console.error('❌ Supabase connection failed:', error);
            console.log('💡 Make sure to:');
            console.log('   1. Check your Supabase URL and API key');
            console.log('   2. Enable Row Level Security policies in Supabase');
            console.log('   3. Run the SQL scripts from README.md to create tables');
            return false;
        }

        console.log('✅ Supabase connection successful!');
        console.log('📊 Connected to database');

        // Try to get actual data
        const { data: properties, error: propError } = await supabase.from('properties').select('*').limit(5);
        if (propError) {
            console.log('⚠️ Tables may not be created yet. Run the SQL scripts from README.md');
        } else {
            console.log(`📋 Found ${properties.length} properties in database`);
        }

        return true;
    } catch (err) {
        console.error('❌ Connection test failed:', err);
        return false;
    }
}

export async function initializeMockData() {
    console.log('📝 This function is for development - mock data is handled in data.js');

    // Test if we can insert data (this will fail if tables don't exist)
    try {
        const testProperty = {
            id: 'TEST001',
            name: 'Test Property',
            address: 'Test Address',
            type: 'Test Type',
            status: 'Test Status',
            rent: 1000
        };

        const { data, error } = await supabase
            .from('properties')
            .insert(testProperty);

        if (error) {
            console.error('❌ Failed to insert test data:', error);
            console.log('💡 Make sure tables are created and RLS policies are set up');
        } else {
            console.log('✅ Successfully inserted test data');
        }
    } catch (err) {
        console.error('❌ Test insert failed:', err);
    }
}

// Make functions available globally for console testing
window.testSupabaseConnection = testSupabaseConnection;
window.initializeMockData = initializeMockData;

// 續租日期校正 — 在 console 跑 fixRenewalDates(false) 看 audit 報告，fixRenewalDates(true) 套用
window.fixRenewalDates = async (apply = false) => {
    const { store } = await import('./data.js');
    const result = store.auditRenewalDates({ apply });
    console.log(`%c[renewalAudit] ${apply ? 'APPLIED' : 'DRY-RUN'}`, 'color: #0a7;', result);
    console.table(result.affected);
    if (result.skipped.length) {
        console.warn('Skipped (疑似手動編輯過):');
        console.table(result.skipped);
    }
    return result;
};

// console 一鍵綁定: bundleContracts('C017', ['C018', 'C019'])
window.bundleContracts = async (parentId, childIds) => {
    const { store } = await import('./data.js');
    const { refreshView } = await import('./utils/ui.js');
    const ids = Array.isArray(childIds) ? childIds : [childIds];
    const result = store.bundleContracts(parentId, ids);
    console.log('%c[bundle]', 'color: #0a7;', result);
    if (result.ok) refreshView();
    return result;
};

// console 一鍵解綁: unbundleContracts('C018')  或 unbundleContracts(['C018', 'C019'])
window.unbundleContracts = async (childIds) => {
    const { store } = await import('./data.js');
    const { refreshView } = await import('./utils/ui.js');
    const ids = Array.isArray(childIds) ? childIds : [childIds];
    const result = store.unbundleContracts(ids);
    console.log('%c[unbundle]', 'color: #a04;', result);
    if (result.ok) refreshView();
    return result;
};

// 把 store / mockData 掛 window 方便 ad-hoc debug (純 dev, 不影響 prod 行為)
import('./data.js').then(m => {
    window.store = m.store;
    window.mockData = m.mockData;
});

// 補寄「已核對入帳但合約還沒寄」的合約 (Q4 hook 上線前已 verify 的歷史合約救援)
// 用法: backfillSendContracts(false) → 列出哪些要寄
//      backfillSendContracts(true)  → 真的寄出去
window.backfillSendContracts = async (apply = false) => {
    const { mockData } = await import('./data.js');
    const { sendContractToLine } = await import('./views/contracts.js');
    // 條件: bankVerified=true (核對過) + 對應合約 status=已簽署/active/沒寄過/非平台/非代管/租客已綁 LINE
    const candidates = [];
    mockData.invoices.forEach(inv => {
        if (!inv.bankVerified) return;
        if (!inv.contractId) return;
        const c = mockData.contracts.find(x => x.id === inv.contractId);
        if (!c) return;
        if (c.contractSentAt) return;
        if (c.status === '已終止') return;
        if (c.renewalState !== 'active') return;
        if (c.contractType && c.contractType !== 'cohousing') return;
        if (c.paymentChannel === 'platform') return;
        const t = mockData.tenants.find(x => x.name === c.tenant && x.lineUserId)
              || mockData.tenants.find(x => x.name === c.tenant);
        const hasLine = !!t?.lineUserId;
        candidates.push({
            invoiceId: inv.id, contractId: c.id, tenant: c.tenant,
            property: c.propertyName, hasLine,
            verifyDate: inv.paidDate
        });
    });
    console.log(`%c[backfillSendContracts] ${apply ? 'APPLIED' : 'DRY-RUN'} — ${candidates.length} 筆候選`, 'color:#08a;font-weight:bold');
    console.table(candidates);
    if (!apply) return candidates;
    // 逐筆 sendContractToLine, 隔 1.5 秒一筆避免 LINE rate limit
    const results = [];
    for (const cand of candidates) {
        if (!cand.hasLine) { results.push({ ...cand, result: 'SKIP_NO_LINE' }); continue; }
        try {
            await sendContractToLine(cand.contractId);
            results.push({ ...cand, result: 'SENT' });
            await new Promise(r => setTimeout(r, 1500));
        } catch (e) {
            results.push({ ...cand, result: `FAIL: ${e.message}` });
        }
    }
    console.log('=== 寄送結果 ===');
    console.table(results);
    return results;
};

// 5月期初結算 種子 — 把用戶 Excel 內 5月各館各項數字寫成 invoice (paidDate=2026-05-31, periodTag='opening')
// 重跑安全: 已存在的 opening 會先砍, 再用最新 EXPECTED_5MAY_OPENING 重建
// dry-run: seedMay2026Opening() → 印出要建的清單, 不動 DB
// apply:   seedMay2026Opening(true) → 寫入 + persist + recalcMetrics
window.seedMay2026Opening = async (apply = false) => {
    const { store } = await import('./data.js');
    const result = store.seedMay2026Opening({ apply });
    console.log(`%c[seedMay2026Opening] ${apply ? 'APPLIED' : 'DRY-RUN'}`, 'color: #08a; font-weight: bold;', {
        要建: result.summary.count + ' 筆',
        IN合計: '$' + result.summary.in.toLocaleString(),
        OUT合計: '$' + result.summary.out.toLocaleString(),
        既存opening: result.existingOpeningCount + ' 筆 (apply 時會先砍掉重建)'
    });
    if (result.warnings.length) {
        console.warn('警告:');
        result.warnings.forEach(w => console.warn(' -', w));
    }
    console.table(result.toCreate.map(p => ({
        館: window.mockData?.buildings?.find(b => b.id === p.buildingId)?.name || p.buildingId,
        方向: p.direction === 'in' ? '收' : '支',
        項目: p.type,
        金額: p.amount.toLocaleString(),
        note: p.note
    })));
    return result;
};

// 5月期初餘額對賬 — 把 mockData 內 paidDate < 2026-06-01 的 invoices 加總 per 館 per type, 跟用戶 Excel 比對
// 用法: verifyOpeningBalance()  → 列出差額表, 自動標紅
window.verifyOpeningBalance = async () => {
    const { mockData, FINANCE_CUTOFF_DATE, EXPECTED_5MAY_OPENING, isPreCutoff } = await import('./data.js');
    const buildingById = new Map(mockData.buildings.map(b => [b.id, b.name]));
    const expected = EXPECTED_5MAY_OPENING;

    // 1. 算系統內 pre-cutoff invoices per 館 in/out aggregate
    const actualByBuilding = {};
    Object.keys(expected.perBuilding).forEach(name => {
        actualByBuilding[name] = { in: 0, out: 0, inByType: {}, outByType: {} };
    });
    actualByBuilding.__無館別 = { in: 0, out: 0, inByType: {}, outByType: {} };

    let preCount = 0;
    mockData.invoices.forEach(inv => {
        if (!isPreCutoff(inv)) return;
        preCount++;
        const bName = buildingById.get(inv.buildingId) || '__無館別';
        const bucket = actualByBuilding[bName] || actualByBuilding.__無館別;
        const amt = Number(inv.amount) || 0;
        const disc = Number(inv.discount) || 0;
        const actualPaid = inv.paidAmount != null ? (Number(inv.paidAmount) || 0) : amt;
        const v = actualPaid;  // 用實收/實付 (paidAmount) 對賬
        if (inv.direction === 'in') {
            bucket.in += v;
            const t = inv.type || '未分類';
            bucket.inByType[t] = (bucket.inByType[t] || 0) + v;
        } else if (inv.direction === 'out') {
            bucket.out += v;
            const t = inv.type || '未分類';
            bucket.outByType[t] = (bucket.outByType[t] || 0) + v;
        }
    });

    // 2. 比對 per 館 in/out aggregate
    const aggregateRows = [];
    let aggMismatchCount = 0;
    Object.entries(expected.perBuilding).forEach(([name, exp]) => {
        const act = actualByBuilding[name] || { in: 0, out: 0 };
        const inDiff = act.in - exp.in;
        const outDiff = act.out - exp.out;
        if (inDiff !== 0 || outDiff !== 0) aggMismatchCount++;
        aggregateRows.push({
            館: name,
            'IN_期望': exp.in,
            'IN_系統': act.in,
            'IN_差': inDiff,
            'OUT_期望': exp.out,
            'OUT_系統': act.out,
            'OUT_差': outDiff,
            狀態: (inDiff === 0 && outDiff === 0) ? '✓' : '✗'
        });
    });
    // __無館別 (沒掛 buildingId 的 pre-cutoff invoices) — 應該為 0
    const noBuilding = actualByBuilding.__無館別;
    if (noBuilding && (noBuilding.in > 0 || noBuilding.out > 0)) {
        aggregateRows.push({
            館: '⚠ 無館別 (這些 invoice 沒 buildingId)',
            'IN_期望': 0, 'IN_系統': noBuilding.in, 'IN_差': noBuilding.in,
            'OUT_期望': 0, 'OUT_系統': noBuilding.out, 'OUT_差': noBuilding.out,
            狀態: '✗'
        });
    }

    // 3. 比對 per 館 out by type
    const typeRows = [];
    let typeMismatchCount = 0;
    Object.entries(expected.perBuildingOutByType).forEach(([name, types]) => {
        const actTypes = actualByBuilding[name]?.outByType || {};
        const allTypes = new Set([...Object.keys(types), ...Object.keys(actTypes)]);
        allTypes.forEach(t => {
            const expVal = types[t] || 0;
            const actVal = actTypes[t] || 0;
            const diff = actVal - expVal;
            if (diff !== 0) typeMismatchCount++;
            typeRows.push({
                館: name, 項目: t,
                '期望': expVal, '系統': actVal, '差': diff,
                狀態: diff === 0 ? '✓' : '✗'
            });
        });
    });

    console.log(`%c[verifyOpeningBalance] cutoff = ${FINANCE_CUTOFF_DATE} | pre-cutoff invoices: ${preCount}`, 'color: #08a; font-weight: bold;');
    console.log('=== 1. 每館 IN / OUT aggregate ===');
    console.table(aggregateRows);
    console.log(`%c${aggMismatchCount === 0 ? '✓ 全對' : `✗ ${aggMismatchCount} 個館有差額`}`, `color: ${aggMismatchCount === 0 ? '#0a7' : '#c00'}; font-weight: bold;`);

    console.log('=== 2. 每館 OUT per type ===');
    console.table(typeRows);
    console.log(`%c${typeMismatchCount === 0 ? '✓ 全對' : `✗ ${typeMismatchCount} 筆項目有差額`}`, `color: ${typeMismatchCount === 0 ? '#0a7' : '#c00'}; font-weight: bold;`);

    return { aggregate: aggregateRows, byType: typeRows, preCount, aggMismatchCount, typeMismatchCount };
};

// 合約 endDate 校正 — 舊版用 +30/+90 days 算的合約 endDate 改成 leaseEndISO (start + N 月 − 1 天)
window.fixContractEndDates = async (apply = false) => {
    const { store } = await import('./data.js');
    const result = store.auditContractEndDates({ apply });
    console.log(`%c[contractEndAudit] ${apply ? 'APPLIED' : 'DRY-RUN'}`, 'color: #a04;', result);
    console.table(result.affected);
    if (result.skipped.length) {
        console.warn('Skipped:');
        console.table(result.skipped);
    }
    return result;
};

// 同名重複租客合併 — 找出同名且其中一筆有 lineUserId 的, 把 lineUserId 搬到「有合約」那筆, 刪掉沒合約那筆
// 用於: 先建合約 (admin 後台) → 後做 LIFF 登記 (LINE) 時拆出第二筆 tenant 的修復
window.fixDuplicateTenants = async (apply = false) => {
    const { store, mockData } = await import('./data.js');
    const byName = new Map();
    mockData.tenants.forEach(t => {
        const key = (t.name || '').trim();
        if (!key) return;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(t);
    });

    const merges = [];
    const skipped = [];
    byName.forEach((rows, name) => {
        if (rows.length < 2) return;
        const bound = rows.filter(r => r.lineUserId);
        const unbound = rows.filter(r => !r.lineUserId);
        if (bound.length === 0) {
            skipped.push({ name, count: rows.length, reason: '都沒綁 LINE, 不確定是不是同一人' });
            return;
        }
        if (bound.length > 1) {
            skipped.push({ name, count: rows.length, reason: '有 >1 筆綁了 LINE, 需手動分辨' });
            return;
        }
        // 1 筆 bound + N 筆 unbound — 把 bound 的 LINE 資料搬到「有合約的 unbound 那筆」(通常是 admin 先建的)
        // 若 unbound 都沒合約 → 直接保留 bound, 刪 unbound
        const lineRecord = bound[0];
        const unboundWithContract = unbound.filter(t =>
            mockData.contracts.some(c => c.tenant === t.name && c.renewalState === 'active')
        );
        // 決策: 留哪一筆當 master?
        // - 優先留「有合約」的 unbound, 把 LINE 資料 merge 進來
        // - 否則留 bound, 刪 unbound
        let masterId, deleteIds, lineFieldsTo;
        if (unboundWithContract.length === 1) {
            masterId = unboundWithContract[0].id;
            const others = rows.filter(r => r.id !== masterId).map(r => r.id);
            deleteIds = others;
            lineFieldsTo = masterId;
        } else {
            masterId = lineRecord.id;
            deleteIds = unbound.map(r => r.id);
            lineFieldsTo = null;  // bound 本身已有 LINE 資料
        }
        merges.push({ name, masterId, deleteIds, copyLineFrom: lineFieldsTo ? lineRecord.id : null });
    });

    if (apply) {
        merges.forEach(m => {
            if (m.copyLineFrom) {
                const src = mockData.tenants.find(t => t.id === m.copyLineFrom);
                const dstIdx = mockData.tenants.findIndex(t => t.id === m.masterId);
                if (src && dstIdx >= 0) {
                    mockData.tenants[dstIdx] = {
                        ...mockData.tenants[dstIdx],
                        lineUserId: src.lineUserId,
                        lineDisplayName: src.lineDisplayName,
                        linePictureUrl: src.linePictureUrl,
                        lineBoundAt: src.lineBoundAt,
                        idCardFrontPath: src.idCardFrontPath || mockData.tenants[dstIdx].idCardFrontPath,
                        idCardBackPath: src.idCardBackPath || mockData.tenants[dstIdx].idCardBackPath,
                        idCardUploadedAt: src.idCardUploadedAt || mockData.tenants[dstIdx].idCardUploadedAt
                    };
                }
            }
            m.deleteIds.forEach(id => store.deleteTenant(id));
        });
    }
    console.log(`%c[duplicateTenantMerge] ${apply ? 'APPLIED' : 'DRY-RUN'}`, 'color: #08a;', { merges, skipped });
    console.table(merges);
    if (skipped.length) {
        console.warn('Skipped:');
        console.table(skipped);
    }
    return { merges, skipped, apply };
};

// bundle 重複 invoice 校正 — 舊版多床位合約會在額外床位開重複 invoice
window.fixBundleInvoices = async (apply = false) => {
    const { store } = await import('./data.js');
    const result = store.auditBundleInvoices({ apply });
    console.log(`%c[bundleAudit] ${apply ? 'APPLIED' : 'DRY-RUN'}`, 'color: #a04;', result);
    console.table(result.affected);
    if (result.skipped.length) {
        console.warn('Skipped:');
        console.table(result.skipped);
    }
    return result;
};

// Also expose a simple test function that doesn't require imports
window.quickTest = async () => {
    console.log('🔍 Quick Supabase connection test...');
    try {
        const response = await fetch('https://mkatwwouurwxlruisqwe.supabase.co/rest/v1/properties?select=count', {
            headers: {
                'apikey': 'sb_publishable__CepJC3ggYmoXBXSx0ETxA_0_RnWJCY',
                'Authorization': 'Bearer sb_publishable__CepJC3ggYmoXBXSx0ETxA_0_RnWJCY'
            }
        });
        if (response.ok) {
            console.log('✅ Supabase connection successful!');
            const data = await response.json();
            console.log('📊 Response:', data);
        } else {
            console.error('❌ Connection failed:', response.status, response.statusText);
        }
    } catch (err) {
        console.error('❌ Test failed:', err);
    }
};

// Auto-run connection test on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 PMS Application Loaded');
    console.log('💡 Run testSupabaseConnection() in console to test database connection');
    console.log('💡 Or run quickTest() for a simple connection test');
    console.log('💡 Run initializeMockData() to test data insertion');
});