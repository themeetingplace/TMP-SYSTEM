const PREFIX = 'tenant-registration-';
const DEFAULT_MAX_AGE_DAYS = 30;
export const NOTIFICATION_DISMISS_KEY = 'pms-notif-dismissed';

// 已讀狀態以 Supabase 為正式來源，所有已登入的工作帳號共用。
// localStorage 只保留為舊版一次性遷移／離線備援，不再作為跨裝置判斷依據。
const syncedDismissedIds = new Set();
let notificationReadsLoaded = false;

function readStorageIds(storage) {
    try { return new Set(JSON.parse(storage?.getItem(NOTIFICATION_DISMISS_KEY) || '[]')); }
    catch { return new Set(); }
}

function writeStorageIds(ids, storage) {
    try { storage?.setItem(NOTIFICATION_DISMISS_KEY, JSON.stringify([...ids])); } catch {}
}

export function getDismissedNotificationIds(storage) {
    if (storage) return readStorageIds(storage);
    if (notificationReadsLoaded) return new Set(syncedDismissedIds);
    return readStorageIds(globalThis.localStorage);
}

export function saveDismissedNotificationIds(ids, storage) {
    if (storage) {
        writeStorageIds(ids, storage);
        return;
    }
    syncedDismissedIds.clear();
    ids.forEach(id => syncedDismissedIds.add(id));
    writeStorageIds(syncedDismissedIds, globalThis.localStorage);
}

async function persistNotificationReads(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (!uniqueIds.length || typeof window === 'undefined') return { synced: false };
    try {
        const { supabase } = await import('../supabase.js');
        const { error } = await supabase.from('system_notification_reads').upsert(
            uniqueIds.map(notificationId => ({ notification_id: notificationId })),
            { onConflict: 'notification_id', ignoreDuplicates: true }
        );
        if (error) throw error;
        return { synced: true };
    } catch (error) {
        console.warn('[notifications] 無法同步已讀狀態，暫存於本機', error);
        return { synced: false, error };
    }
}

export async function hydrateNotificationReads() {
    if (typeof window === 'undefined') return { ids: getDismissedNotificationIds(), changed: false };
    const before = new Set(syncedDismissedIds);
    try {
        const { supabase } = await import('../supabase.js');
        const { data, error } = await supabase.from('system_notification_reads').select('notification_id');
        if (error) throw error;

        syncedDismissedIds.clear();
        (data || []).forEach(row => row.notification_id && syncedDismissedIds.add(row.notification_id));
        notificationReadsLoaded = true;

        // 將舊版只存在這台裝置的已讀紀錄補登至雲端，成功後移除舊 key。
        const legacyIds = readStorageIds(globalThis.localStorage);
        if (legacyIds.size) {
            legacyIds.forEach(id => syncedDismissedIds.add(id));
            const migrated = await persistNotificationReads([...legacyIds]);
            if (migrated.synced) {
                try { globalThis.localStorage?.removeItem(NOTIFICATION_DISMISS_KEY); } catch {}
            }
        }

        const changed = before.size !== syncedDismissedIds.size
            || [...syncedDismissedIds].some(id => !before.has(id));
        return { ids: new Set(syncedDismissedIds), changed };
    } catch (error) {
        console.warn('[notifications] 載入共用已讀狀態失敗，使用本機備援', error);
        notificationReadsLoaded = false;
        return { ids: getDismissedNotificationIds(), changed: false, error };
    }
}

export function markNotificationRead(id, storage) {
    if (!id) return Promise.resolve({ synced: false });
    if (storage) {
        const dismissed = getDismissedNotificationIds(storage);
        dismissed.add(id);
        saveDismissedNotificationIds(dismissed, storage);
        return Promise.resolve({ synced: false });
    }
    syncedDismissedIds.add(id);
    writeStorageIds(syncedDismissedIds, globalThis.localStorage);
    return persistNotificationReads([id]);
}

export function markNotificationsRead(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    uniqueIds.forEach(id => syncedDismissedIds.add(id));
    writeStorageIds(syncedDismissedIds, globalThis.localStorage);
    return persistNotificationReads(uniqueIds);
}

export async function subscribeToNotificationReads(onChange) {
    if (typeof window === 'undefined') return null;
    const { supabase } = await import('../supabase.js');
    return supabase.channel('system-notification-reads')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_notification_reads' }, payload => {
            const id = payload.new?.notification_id;
            if (!id || syncedDismissedIds.has(id)) return;
            syncedDismissedIds.add(id);
            onChange?.(id);
        })
        .subscribe();
}

function parseTime(value) {
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function tenantRegistrationNotificationId(tenant) {
    if (!tenant?.id || !tenant?.lineBoundAt) return null;
    return `${PREFIX}${tenant.id}-${tenant.lineBoundAt}`;
}

export function listTenantRegistrationNotifications(
    tenants,
    { dismissedIds = new Set(), now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}
) {
    const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
    return (Array.isArray(tenants) ? tenants : [])
        .map(tenant => {
            const id = tenantRegistrationNotificationId(tenant);
            const time = parseTime(tenant?.lineBoundAt);
            if (!id || time == null || time < cutoff || dismissedIds.has(id)) return null;
            return { id, time, tenant };
        })
        .filter(Boolean)
        .sort((a, b) => b.time - a.time);
}

export function detectNewTenantRegistrations(previousIds, tenants, options = {}) {
    const previous = previousIds instanceof Set ? previousIds : new Set(previousIds || []);
    const current = listTenantRegistrationNotifications(tenants, {
        ...options,
        dismissedIds: new Set()
    });
    return {
        items: current.filter(item => !previous.has(item.id)),
        currentIds: new Set(current.map(item => item.id))
    };
}

export { PREFIX as TENANT_REGISTRATION_NOTIFICATION_PREFIX };
