// 雲端優先同步引擎 (multi-device)
//
// 設計：
//   * Supabase 是唯一真實來源
//   * 開機 bootstrap() 必拉一次完整資料才渲染 UI
//   * Realtime 訂閱所有表 — 別人改了會立刻收到並 re-render
//   * 寫入：本機 mockData 即時更新 (UI 不卡) + debounced push 1.5s
//   * localStorage 只當斷網時的緊急備援
//
// 對外 API (掛 window)：
//   pullFromSupabase()     手動拉
//   pushToSupabase()       手動推
//   syncStatus()           查狀態
//   migrateToSupabase()    完整遷移 (在 migrate-to-supabase.js)
//
// 內部事件：
//   'bms:persist'             data.js persist() 後 → 排程 push
//   'bms:template-changed'    合約樣板變更 → 立即 push 大欄位
//   'bms:data-changed'        資料變動 → app.js 重新渲染當前頁

import { supabase } from './supabase.js';
import { mockData, runMigration } from './data.js';
import { TABLES, SMALL_TABLES, LARGE_TABLES } from './db-mapping.js';

const LAST_SYNC_KEY = 'pms-last-sync';
const LEGACY_LAST_SYNC_KEY = 'bms-last-sync';

// 一次性 migrate：新 key 沒值就讀舊 key (bms-last-sync) 並刪舊
(function migrateLastSyncKey() {
    if (localStorage.getItem(LAST_SYNC_KEY)) return;
    const legacy = localStorage.getItem(LEGACY_LAST_SYNC_KEY);
    if (legacy) {
        localStorage.setItem(LAST_SYNC_KEY, legacy);
        localStorage.removeItem(LEGACY_LAST_SYNC_KEY);
    }
})();

const state = {
    status: 'idle',  // idle | pulling | pushing | error | offline
    lastSync: localStorage.getItem(LAST_SYNC_KEY) || null,
    error: null,
    online: navigator.onLine,
    realtimeConnected: false
};

// ⚠ 防資料復活: 首次 pull 完成才允許 push 上雲
// 沒這個 gate, stale localStorage 可能在 pull 還沒拉到雲端 truth 之前就 blind upsert
// (forensic 確認 2026-06-16 用戶昨晚的資料復活就是這個 race)
let firstPullDone = false;

const listeners = new Set();
function emit() { listeners.forEach(fn => { try { fn({ ...state }); } catch {} }); }
function setStatus(s, error = null) {
    state.status = s;
    state.error = error;
    if (s === 'idle') {
        state.lastSync = new Date().toISOString();
        localStorage.setItem(LAST_SYNC_KEY, state.lastSync);
    }
    emit();
}
export function onSyncChange(fn) {
    listeners.add(fn);
    fn({ ...state });
    return () => listeners.delete(fn);
}
export function syncStatus() { return { ...state }; }

// === Pull：Supabase → mockData (per-row 比較) ===
// 設計重點：
//   1. 並行鎖 pullInFlight — bootstrap / online / realtime reconnect 同時觸發只跑 1 次
//   2. Per-table apply — 每張表獨立 fetch + apply；單表失敗其他表照樣套用
//   3. mockData[t.src] 沒初始化的補 [] guard，新表加進 TABLES 不會 crash
//
// 為什麼不做「全部成功才 commit」(rollback)：那會造成單表失敗時，整個本機停留在 data.js
// 的 demo 預設 (含「王大明」等假資料)，UI 直接看到 mock 跑出來 — 比讓部分表更新還糟。
let pullInFlight = null;
export async function pullAll() {
    if (pullInFlight) return pullInFlight;
    pullInFlight = (async () => {
        if (!navigator.onLine) { setStatus('offline'); throw new Error('離線'); }
        setStatus('pulling');
        const lastPullAt = state.lastSync || '1970-01-01T00:00:00Z';
        console.group(`[sync] pull (lastSync = ${lastPullAt})`);
        const tableErrors = [];
        try {
            for (const t of TABLES) {
                try {
                    const { data, error } = await supabase.from(t.key).select('*');
                    if (error) throw new Error(error.message);

                    const pkJs = t.pk === 'building_id' ? 'buildingId' : 'id';
                    if (!Array.isArray(mockData[t.src])) mockData[t.src] = [];
                    const localById = new Map();
                    mockData[t.src].forEach(r => localById.set(r[pkJs], r));
                    const remoteIds = new Set((data || []).map(r => r[t.pk]));

                    let added = 0, replaced = 0;
                    (data || []).forEach(raw => {
                        const id = raw[t.pk];
                        const local = localById.get(id);
                        const converted = t.fromDb(raw);
                        if (!local) {
                            mockData[t.src].push(converted);
                            added++;
                        } else {
                            // 一律以雲端為準 (拿掉 updated_at > lastPullAt 的優化 —
                            // 會讓本機 mockData demo 殘留 [王大明 P001 等] 一直留著)
                            Object.assign(local, converted);
                            replaced++;
                        }
                    });
                    // 雲端優先：本機有但雲端沒有 → 刪掉本機 (清掉 mockData demo 殘留)
                    const beforeLen = mockData[t.src].length;
                    mockData[t.src] = mockData[t.src].filter(r => remoteIds.has(r[pkJs]));
                    const removed = beforeLen - mockData[t.src].length;
                    console.log(`  ⬇ ${t.key}: +${added} / ↺${replaced} / 🗑${removed}`);
                } catch (tableErr) {
                    // 單表失敗：log 但不打斷其他表
                    tableErrors.push({ table: t.key, error: tableErr.message });
                    console.error(`  ❌ ${t.key} 失敗 (其他表照常):`, tableErr.message);
                }
            }
            runMigration();
            window.dispatchEvent(new CustomEvent('bms:data-changed', { detail: { source: 'pull' } }));
            if (tableErrors.length === 0) {
                firstPullDone = true;  // ✅ bootstrap pull 過關，允許 push (防資料復活第一道閘)
                setStatus('idle');
                console.log('✅ pull 完成 (firstPullDone=true，push 解鎖)');
            } else {
                setStatus('error', `${tableErrors.length} 表 pull 失敗 (其他成功)`);
                console.warn(`⚠ pull 部分失敗:`, tableErrors);
            }
        } catch (e) {
            setStatus('error', e.message);
            console.error('[sync] pull 失敗:', e);
            throw e;
        } finally {
            console.groupEnd();
            pullInFlight = null;
        }
    })();
    return pullInFlight;
}

// === Push 小表 ===
// 三層防禦防資料復活:
//   1. firstPullDone gate — 首次 pull 完成才能推 (避免 stale localStorage blind 上雲)
//   2. Sanity check — 雲端 0 筆 + 本機 >5 筆 = 強烈懷疑是 zombie restore，abort + 紅 toast
//   3. catch error 也 abort 整批，避免半推半就
//   4. in-flight lock — 多條 push 路徑 (bms:persist / online / template-changed) 序列化
let pushInFlight = null;
async function pushSmall() {
    if (pushInFlight) return pushInFlight;       // audit: 防止三條 push 路徑併發 (race + status 閃爍)
    pushInFlight = (async () => {
        if (!navigator.onLine) return;
        if (!firstPullDone) {
            console.warn('[sync] skip pushSmall — bootstrap pull 未完成 (防資料復活)');
            return;
        }
        setStatus('pushing');
        try {
            for (const t of SMALL_TABLES) {
                const rows = (mockData[t.src] || []).map(t.toDb);
                if (rows.length === 0) continue;
                // sanity check: 雲端 0 筆但本機很多 → 強烈懷疑是 zombie restore，拒絕推
                if (rows.length > 5) {
                    const { count: remoteCount } = await supabase.from(t.key).select('*', { count: 'exact', head: true });
                    if (remoteCount === 0) {
                        const msg = `偵測到 zombie restore: 雲端 ${t.key} 是 0 筆但本機有 ${rows.length} 筆，拒絕 push 避免覆蓋雲端刪除。請先「清空本機快取」`;
                        console.warn(`[sync] ${msg}`);
                        if (window.showToast) window.showToast(msg, 'danger', 12000);
                        setStatus('error', msg);
                        return;
                    }
                }
                const { error } = await supabase.from(t.key).upsert(rows, { onConflict: t.pk });
                if (error) throw new Error(`${t.key}: ${error.message}`);
            }
            markJustPushed();
            setStatus('idle');
        } catch (e) {
            setStatus('error', e.message);
            console.error('[sync] push 失敗:', e);
        }
    })().finally(() => { pushInFlight = null; });
    return pushInFlight;
}

async function pushLarge() {
    if (!navigator.onLine) return;
    if (!firstPullDone) {
        console.warn('[sync] skip pushLarge — bootstrap pull 未完成');
        return;
    }
    setStatus('pushing');
    try {
        for (const t of LARGE_TABLES) {
            const rows = (mockData[t.src] || []).map(t.toDb);
            if (rows.length === 0) continue;
            const { error } = await supabase.from(t.key).upsert(rows, { onConflict: t.pk });
            if (error) throw new Error(`${t.key}: ${error.message}`);
        }
        markJustPushed();
        setStatus('idle');
    } catch (e) {
        setStatus('error', e.message);
        console.error('[sync] push 大表失敗:', e);
    }
}

export async function pushAll() { await pushSmall(); await pushLarge(); }

let pushTimer = null;
function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushSmall(), 1500);
}
window.addEventListener('bms:persist', schedulePush);
window.addEventListener('bms:template-changed', () => pushLarge());

// 刪除事件 → 直接送 DELETE 到 Supabase (upsert 不會處理刪除，否則本機刪了雲端還在，下次 pull 又拉回)
// P2-7: 用 in-flight Set 去重，避免連點刪除按鈕送 N 次 DELETE
// audit: 加 timeout 15s + 失敗 rollback (本機 row 復活到 mockData，避免 pull 復活時 race)
const deleteInFlight = new Set();
const DELETE_TIMEOUT_MS = 15_000;
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms))
    ]);
}
window.addEventListener('bms:delete', async (e) => {
    if (!navigator.onLine) return;
    const { table, id, snapshot } = e.detail || {};  // snapshot = row 被刪前的快照 (caller 可傳)
    if (!table || !id) return;
    const t = TABLES.find(x => x.key === table);
    if (!t) return;
    const key = `${table}/${id}`;
    if (deleteInFlight.has(key)) {
        console.log(`[sync] DELETE ${key} 已在進行中，跳過重複請求`);
        return;
    }
    deleteInFlight.add(key);
    markRecentlyDeleted(table, id);
    try {
        markJustPushed();
        const { error, count } = await withTimeout(
            supabase.from(table).delete({ count: 'exact' }).eq(t.pk, id),
            DELETE_TIMEOUT_MS,
            `DELETE ${table}/${id}`
        );
        if (error) {
            console.error(`[sync] DELETE ${table}/${id} 失敗:`, error);
            setStatus('error', `刪除同步失敗：${error.message}`);
            if (window.showToast) window.showToast(`雲端刪除失敗：${error.message}`, 'danger', 6000);
            // audit: 失敗 rollback — 把 row 加回 mockData，避免下次 pull 把雲端那筆又拉回造成「以為刪了其實沒刪」
            if (snapshot && Array.isArray(mockData[t.src])) {
                const exists = mockData[t.src].some(r => r[t.pk === 'building_id' ? 'buildingId' : 'id'] === id);
                if (!exists) {
                    mockData[t.src].push(snapshot);
                    console.warn(`[sync] DELETE 失敗，rollback ${table}/${id} 回本機`);
                    window.dispatchEvent(new CustomEvent('bms:data-changed', { detail: { source: 'delete-rollback' } }));
                }
            }
            // 延長黑名單期 → 防 30s 內 sync 各種事件又把 row 復活
            markRecentlyDeleted(table, id);
            setTimeout(() => recentlyDeleted.delete(`${table}/${id}`), 30_000);
        } else if (count === 0) {
            // RLS 真的擋掉 DELETE — 本機刪了但雲端還在
            console.warn(`[sync] ⚠ DELETE ${table}/${id} 雲端 0 筆受影響 (RLS 阻擋)`);
            if (window.showToast) {
                window.showToast(
                    `雲端 RLS 阻擋 <code>${table}/${id}</code> 的刪除。請用 Supabase SQL Editor 直接跑 <code>DELETE FROM ${table} WHERE id='${id}'</code>`,
                    'danger',
                    10000
                );
            }
        } else {
            // count 為 null (有些 PostgREST 版本不回 count) 或 >0 都當成功
            console.log(`[sync] 🗑 ${table}/${id} 已從雲端刪除${count != null ? ` (${count} 筆)` : ''}`);
        }
    } catch (err) {
        console.error('[sync] DELETE 異常:', err);
    } finally {
        deleteInFlight.delete(key);
    }
});

// 自家 echo 抑制：剛推完的那 3 秒內，Realtime 回來的事件視為自家迴響，靜默套用不再 dispatch data-changed
let lastPushAt = 0;
function markJustPushed() { lastPushAt = Date.now(); }
function isOwnEcho() { return Date.now() - lastPushAt < 3000; }

// === Realtime — 訂閱所有表 ===
let realtimeChannel = null;

// P1-11: 斷線重試
// audit: 加上限 10 次 (auth 過期 / 雲端異常時不無限重連耗電池)
let reconnectAttempt = 0;
let reconnectTimer = null;
const RECONNECT_MAX_ATTEMPTS = 10;
function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
        console.warn(`[sync] Realtime 重連達上限 (${RECONNECT_MAX_ATTEMPTS} 次)，停止自動重連`);
        setStatus('error', 'Realtime 重連失敗多次，請手動重新整理');
        if (window.showToast) window.showToast('Realtime 連線中斷多次，請手動重新整理頁面', 'warning', 8000);
        return;
    }
    // exponential backoff: 2s, 4s, 8s, 16s, 30s (cap)
    const delay = Math.min(30_000, 2_000 * 2 ** reconnectAttempt);
    reconnectAttempt++;
    console.log(`[sync] Realtime reconnect in ${delay/1000}s (attempt #${reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS})`);
    reconnectTimer = setTimeout(() => {
        if (realtimeChannel) {
            try { supabase.removeChannel(realtimeChannel); } catch {}
            realtimeChannel = null;
        }
        startRealtime();
    }, delay);
}

function startRealtime() {
    if (realtimeChannel) return;
    realtimeChannel = supabase
        .channel('bms-all-tables')
        .on('postgres_changes', { event: '*', schema: 'public' }, handleRealtimeChange)
        .subscribe(status => {
            const wasConnected = state.realtimeConnected;
            state.realtimeConnected = (status === 'SUBSCRIBED');
            console.log(`[sync] Realtime: ${status}`);
            emit();
            if (status === 'SUBSCRIBED') {
                reconnectAttempt = 0;  // 連上了重置重試次數
                clearTimeout(reconnectTimer);
                // 重連回來後拉一次最新資料 (期間可能有別人改了)
                if (!wasConnected && state.lastSync) pullAll().catch(e => console.warn('[reconnect] pull 失敗:', e));
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                scheduleReconnect();
            }
        });
}

// 最近刪除黑名單 — 防 race: 自己刪了之後，先前 upsert 的 echo 才到、會把剛刪的 row 復活
const recentlyDeleted = new Map();  // key=`${table}/${id}` → expireAt timestamp
const DELETE_BLACKLIST_MS = 5_000;
function markRecentlyDeleted(table, id) {
    recentlyDeleted.set(`${table}/${id}`, Date.now() + DELETE_BLACKLIST_MS);
}
function isRecentlyDeleted(table, id) {
    const expire = recentlyDeleted.get(`${table}/${id}`);
    if (!expire) return false;
    if (Date.now() > expire) {
        recentlyDeleted.delete(`${table}/${id}`);
        return false;
    }
    return true;
}

function handleRealtimeChange(payload) {
    const t = TABLES.find(x => x.key === payload.table);
    if (!t) return;
    const pkJs = t.pk === 'building_id' ? 'buildingId' : 'id';
    // P0-5: 確保陣列已初始化 (新表 INSERT 第一筆時)
    if (!Array.isArray(mockData[t.src])) mockData[t.src] = [];

    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const converted = t.fromDb(payload.new);
        const id = converted[pkJs];
        // ⚠ 防復活: 最近 5s 內被本機刪過 → 不接受 INSERT/UPDATE echo
        // (避免步驟 [upsert → broadcast UPDATE → 本機刪 → echo 才到] 把刪掉的 row push 回來)
        if (isRecentlyDeleted(t.key, id)) {
            console.log(`[realtime] ${payload.eventType} ${t.key}/${id} 略過 (最近剛刪)`);
            return;
        }
        const idx = mockData[t.src].findIndex(r => r[pkJs] === id);
        if (idx >= 0) {
            // 若本機資料完全相同 (通常是自己 push 後的迴響)，跳過 re-render
            const existing = mockData[t.src][idx];
            const sameUpdatedAt = payload.new.updated_at && existing.updatedAt === payload.new.updated_at;
            if (sameUpdatedAt) return;
            mockData[t.src][idx] = { ...existing, ...converted };
        } else if (payload.eventType === 'INSERT') {
            // INSERT 才 push 進來 (別人新增)
            mockData[t.src].push(converted);
        } else {
            // UPDATE 但本機沒這筆 → 不復活；可能 race 或先前漏 INSERT
            console.log(`[realtime] UPDATE ${t.key}/${id} 略過 (本機無此筆)`);
            return;
        }
        console.log(`[realtime] ${payload.eventType} ${t.key}/${id}`);
    } else if (payload.eventType === 'DELETE') {
        const id = payload.old[t.pk];
        markRecentlyDeleted(t.key, id);  // 接到 DELETE 也黑名單，防後續 echo 重新加回
        const before = mockData[t.src]?.length || 0;
        mockData[t.src] = (mockData[t.src] || []).filter(r => r[pkJs] !== id);
        if (mockData[t.src].length === before) return;
        console.log(`[realtime] DELETE ${t.key}/${id}`);
    }

    runMigration();
    // 若是自家剛 push 的迴響 → 靜默套用，不觸發 re-render (避免畫面狂閃)
    if (isOwnEcho()) return;
    window.dispatchEvent(new CustomEvent('bms:data-changed', { detail: { source: 'realtime', table: payload.table } }));
}

function stopRealtime() {
    // audit: 清掉 reconnect timer 避免關 tab 後還在等重連
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempt = 0;
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
        state.realtimeConnected = false;
        emit();
    }
}

// === Bootstrap：開機呼叫，必拉完才回 ===
export async function bootstrap() {
    try {
        await pullAll();
        startRealtime();
        return { success: true };
    } catch (e) {
        // 失敗時 caller 決定要 fallback 還是 retry
        return { success: false, error: e };
    }
}

// 清空本機快取重新同步 — 跑完 destructive SQL 後一鍵清，避免 stale localStorage 把刪除的資料 push 回 Supabase
// 包：移除 localStorage data 快照 + last-sync + 重整頁面 → 重新 bootstrap pull 拿真實狀態
export function clearLocalCacheAndReload() {
    try {
        localStorage.removeItem('bananas-pms-data-v1');
        localStorage.removeItem('pms-last-sync');
        localStorage.removeItem('bananas-bms-data-v1');  // 舊 key
        localStorage.removeItem('bms-last-sync');
    } catch (e) {
        console.error('[sync] 清快取失敗:', e);
    }
    location.reload();
}
window.clearLocalCacheAndReload = clearLocalCacheAndReload;

// === 網路狀態監聽 ===
// ⚠ 一定要序列化 pullAll → pushAll，原本平行賽跑會讓 stale local 把雲端覆蓋掉 (zombie restore)
window.addEventListener('online', async () => {
    state.online = true;
    emit();
    console.log('[sync] 連線恢復');
    try {
        await pullAll();
        await pushAll();
    } catch (e) {
        console.warn('[sync] 連線恢復後同步失敗:', e);
    }
});
window.addEventListener('offline', () => {
    state.online = false;
    setStatus('offline');
    stopRealtime();
});

// === Sidebar 同步狀態指示燈 ===
function renderSyncIndicator() {
    const el = document.getElementById('syncIndicator');
    if (!el) return;
    const iconEl = el.querySelector('i');
    const labelEl = el.querySelector('.sync-label');

    Array.from(el.classList).filter(c => c.startsWith('status-')).forEach(c => el.classList.remove(c));

    const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '尚未';
    const live = state.realtimeConnected ? '🟢' : '';
    const config = {
        idle:    { icon: 'ph-cloud-check',       label: `${live} 已同步 ${fmtTime(state.lastSync)}` },
        pulling: { icon: 'ph-cloud-arrow-down',  label: '下載中…' },
        pushing: { icon: 'ph-cloud-arrow-up',    label: '上傳中…' },
        error:   { icon: 'ph-cloud-warning',     label: '同步錯誤' },
        offline: { icon: 'ph-cloud-slash',       label: '離線' }
    }[state.status] || { icon: 'ph-cloud', label: state.status };

    el.classList.add(`status-${state.status}`);
    iconEl.className = `ph ${config.icon}`;
    labelEl.textContent = config.label;
    el.title = state.error
        ? `錯誤：${state.error}`
        : `Realtime：${state.realtimeConnected ? '已連線' : '未連線'}\n上次同步：${state.lastSync || '尚未'}\n點擊前往設定`;
}

function bindSyncIndicatorClick() {
    const el = document.getElementById('syncIndicator');
    if (!el || el.dataset.bound === '1') return;
    el.dataset.bound = '1';
    el.addEventListener('click', () => {
        window.location.hash = '#settings';
        setTimeout(() => {
            const tab = document.querySelector('[data-settings-tab="sync"]');
            if (tab) tab.click();
        }, 50);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    renderSyncIndicator();
    bindSyncIndicatorClick();
});
listeners.add(renderSyncIndicator);

// === 暴露到 window ===
window.syncStatus = syncStatus;
window.pullFromSupabase = pullAll;
window.pushToSupabase = pushAll;

console.log('[sync] 已就緒 (雲端優先 + Realtime)');
