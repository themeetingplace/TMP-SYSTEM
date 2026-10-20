const PREFIX = 'tenant-registration-';
const DEFAULT_MAX_AGE_DAYS = 30;
export const NOTIFICATION_DISMISS_KEY = 'pms-notif-dismissed';

export function getDismissedNotificationIds(storage = globalThis.localStorage) {
    try { return new Set(JSON.parse(storage?.getItem(NOTIFICATION_DISMISS_KEY) || '[]')); }
    catch { return new Set(); }
}

export function saveDismissedNotificationIds(ids, storage = globalThis.localStorage) {
    try { storage?.setItem(NOTIFICATION_DISMISS_KEY, JSON.stringify([...ids])); } catch {}
}

export function markNotificationRead(id, storage = globalThis.localStorage) {
    if (!id) return;
    const dismissed = getDismissedNotificationIds(storage);
    dismissed.add(id);
    saveDismissedNotificationIds(dismissed, storage);
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
