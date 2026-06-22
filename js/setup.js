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
        const response = await fetch('https://zkwkycpfcyecebstmotc.supabase.co/rest/v1/properties?select=count', {
            headers: {
                'apikey': 'sb_publishable_qsFrMoFYyM5DMcSt9nvNcg_pah5nruy',
                'Authorization': 'Bearer sb_publishable_qsFrMoFYyM5DMcSt9nvNcg_pah5nruy'
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