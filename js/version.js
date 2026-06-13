// 應用程式版本資訊 — 顯示在 sidebar footer + 「關於」彈窗
// 改版時更新這裡 + index.html 的 ?v= cache-bust 字串
export const APP_VERSION = '1.3.0';
export const APP_BUILD_DATE = '2026-06-13';
export const APP_NAME = '聚空間 PMS';
export const APP_COPYRIGHT = '© 2026 聚空間 THE MEETING PLACE';

// 主要版本紀錄 — 給「關於」彈窗顯示
export const APP_CHANGELOG = [
    { version: '1.3.0', date: '2026-06-13', notes: '系統改名 BMS → PMS (Property Management System，業界標準命名，BMS 一般指 Building Management = 樓宇機電) / localStorage 自動遷移 (老用戶資料不會消失) / 報表折線圖風格統一 dashboard / 視覺一致性 audit' },
    { version: '1.2.5', date: '2026-06-12', notes: '小幫手角色 (read-only 物件/住房/租客) / 報表 3 tab (總覽 / 各館 / 財務分析) + NOI / OpEx / 出租率傳統燈 / LINE 自動詢問續租 (Quick Reply Postback) / LIFF 身分證上傳 + Canvas 浮水印 (私有 bucket + 5 分鐘 signed URL)' },
    { version: '1.2.0', date: '2026-06-11', notes: '報表大改版 — 4 tab hub (總覽 / 各館 / 交叉 / 對帳單) + 共用區間 picker (本月/本季/本年/自訂) / 帳務管理只留 總收支 + 房租查帳 / 收支分析搬到報表 / 合約 PDF 加 total_amount + monthly_amount / 多床位合約只開 1 張 invoice / 帳單編輯折扣加收正負號修正' },
    { version: '1.1.4', date: '2026-06-07', notes: '新增合約支援多床位 (同租客同期間 = 多份合約) / 折扣加收項目改成分段切換按鈕 (取代醜下拉)' },
    { version: '1.1.3', date: '2026-06-07', notes: '編輯 / 確認彈窗鎖外點 — 誤點 backdrop 或 Esc 會震動提醒，要按 X 或取消才會關閉，避免新增合約時誤關失去輸入' },
    { version: '1.1.2', date: '2026-06-06', notes: 'LINE 客服改稱「小編」/ 找小編按鈕修正 / 入住詢問關鍵字補上 / 使用手冊入口 (📖 在關於彈窗) / 側邊欄收合 polish / 入住紀錄歷史異常金額 ⚠ 提示 / 英文品牌 THE MEETING PLACE' },
    { version: '1.1.1', date: '2026-05-31', notes: '分頁升級 (頁碼/頁筆選擇) / 退租 summary 預告影響 / signed URL 縮 24h / Toast z-index / HTTP security headers / 表單必填錯誤訊息帶欄位名' },
    { version: '1.1.0', date: '2026-05-30', notes: '系統審查大修：RLS admin-only / XSS 防護 / pullAll 並行鎖 + 雲端優先 / webhook timing-safe + idempotency + DB cooldown / null guards / mock 資料根絕 / 排序 UI / 物件管理篩選' },
    { version: '1.0.0', date: '2026-05-27', notes: '正式上線：Supabase 雲端同步、合約 PDF、LINE Bot、安全收尾 (Auth + RLS lockdown + 私有 Storage)' },
    { version: '0.9.0', date: '2026-05-26', notes: 'Phase 4 收尾：帳務一致性、住房一覽、收支分析' },
    { version: '0.8.0', date: '2026-05-20', notes: 'Phase 3：合約樣板 + LIFF 住客登記 + LINE Bot' },
    { version: '0.7.0', date: '2026-05-15', notes: 'Phase 2：Supabase 雲端遷移' },
    { version: '0.5.0', date: '2026-05-01', notes: 'Phase 1：MVP 完成 (物件 / 合約 / 帳務 / 維修 / 租客)' }
];
