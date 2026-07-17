// PMS 系統常數 — 集中管理 magic number
// audit: 之前散在 14+ 個地方，改一處不易掌握

// === 時間 ===
export const MS_PER_DAY = 86_400_000;
export const MS_PER_HOUR = 3_600_000;

// === 續租決策時間軸 (天) ===
// 用戶 2026-07-17 更新: 詢問 14 天前發 LINE / 決策 7 天前進待決策狀態
export const RENEWAL_THRESHOLDS = {
    /** 進入「即將到期 expiring_soon」狀態，renewal-poll cron 在這區間發 LINE 詢問 */
    expiringSoonDays: 14,
    /** 進入「待決策 awaiting_decision」狀態，管理者需要下決定 */
    awaitingDecisionDays: 7,
    /** 詢問續租 cron 排程的窗口 (14 天內到期) */
    askRenewalDays: 14,
    /** 重複詢問 cooldown (避免 spam，距上次詢問 < 5 天不重發) */
    reAskCooldownDays: 5
};

// === Sync 時間參數 ===
export const SYNC_TIMINGS = {
    /** persist → schedulePush debounce (ms) */
    pushDebounceMs: 1500,
    /** isOwnEcho 視窗 — push 完這段時間內 realtime UPDATE 視為自家迴響 */
    ownEchoWindowMs: 3000,
    /** 最近刪除黑名單 (擋 realtime UPDATE 復活已刪 row) */
    recentlyDeletedMs: 5000,
    /** DELETE 失敗時延長黑名單 */
    recentlyDeletedFailMs: 30_000,
    /** DELETE timeout (Promise.race) */
    deleteTimeoutMs: 15_000,
    /** scheduleReconnect 上限 */
    reconnectMaxAttempts: 10,
    /** scheduleReconnect 最長 backoff */
    reconnectMaxDelayMs: 30_000,
    /** sync.js data-changed → handleRoute debounce */
    dataChangedDebounceMs: 150
};

// === 連結 / 檔案 ===
export const SIGNED_URL_TTL_SECONDS = 7 * 24 * 3600;  // 7 天 (Supabase Storage signed URL)

// === 群組累金 baselines (2026/05 月底) ===
// 用戶 2026-06-17 確認: 純歷史資料寫死，未來每月用「上期 + 結餘 - 紅利」自動往後算
// 中溫累金 = 中山 + 溫州 (歷史含, 未來只算中山因為溫州館已收)
export const GROUP_CUM_BASELINES = {
    asOf: '2026-05',  // baseline 月份 (含此月為止)
    groups: {
        '松師': 5_032_041,
        '中溫': 334_758,
        '古亭': 238_449
    }
};

// === Storage key ===
export const STORAGE_KEYS = {
    appMode: 'pms-app-mode',
    sidebarCollapsed: 'bms-sidebar-collapsed',  // 舊 key 名 (歷史遺留, 沒改避免 migration)
    navCollapsedGroups: 'bms-nav-collapsed-groups',
    propertiesHubTab: 'pms-properties-hub-tab',
    managedHouseTab: 'pms-m-house-tab',
    managedHousesActiveBuilding: 'pms-houses-active-building',
    dataSnapshot: 'bananas-pms-data-v1',
    lastSync: 'pms-last-sync',
    // 舊 key (一次性 migrate 用)
    legacyDataSnapshot: 'bananas-bms-data-v1',
    legacyLastSync: 'bms-last-sync'
};
