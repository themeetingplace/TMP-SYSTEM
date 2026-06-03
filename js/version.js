// 應用程式版本資訊 — 顯示在 sidebar footer + 「關於」彈窗
// 改版時更新這裡 + index.html 的 ?v= cache-bust 字串
export const APP_VERSION = '1.1.1';
export const APP_BUILD_DATE = '2026-05-31';
export const APP_NAME = '聚空間 BMS';
export const APP_COPYRIGHT = '© 2026 聚空間 Juu Space';

// 主要版本紀錄 — 給「關於」彈窗顯示
export const APP_CHANGELOG = [
    { version: '1.1.1', date: '2026-05-31', notes: '分頁升級 (頁碼/頁筆選擇) / 退租 summary 預告影響 / signed URL 縮 24h / Toast z-index / HTTP security headers / 表單必填錯誤訊息帶欄位名' },
    { version: '1.1.0', date: '2026-05-30', notes: '系統審查大修：RLS admin-only / XSS 防護 / pullAll 並行鎖 + 雲端優先 / webhook timing-safe + idempotency + DB cooldown / null guards / mock 資料根絕 / 排序 UI / 物件管理篩選' },
    { version: '1.0.0', date: '2026-05-27', notes: '正式上線：Supabase 雲端同步、合約 PDF、LINE Bot、安全收尾 (Auth + RLS lockdown + 私有 Storage)' },
    { version: '0.9.0', date: '2026-05-26', notes: 'Phase 4 收尾：帳務一致性、住房一覽、收支分析' },
    { version: '0.8.0', date: '2026-05-20', notes: 'Phase 3：合約樣板 + LIFF 住客登記 + LINE Bot' },
    { version: '0.7.0', date: '2026-05-15', notes: 'Phase 2：Supabase 雲端遷移' },
    { version: '0.5.0', date: '2026-05-01', notes: 'Phase 1：MVP 完成 (物件 / 合約 / 帳務 / 維修 / 租客)' }
];
