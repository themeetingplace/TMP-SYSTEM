# 聚空間 BMS 系統審查整合報告

> 整合來源：穩定性 / 安全 / UX / 視覺 / 效能 五份審查（共 ~62 個原始 finding，去重整併後 38 項）
> 日期：2026-05-29

## 執行摘要

系統整體已可用、且基本流程完整，但有 **3 個會直接讓系統當掉或外洩資料** 的 P0 必須優先處理：(1) Supabase RLS 對所有 authenticated 帳號全開放、配合公開 anon key 等於誰註冊誰能撈走全部租客資料；(2) 多處 `null.toLocaleString()` / `null.replace()` 缺 guard，LINE webhook 進來的非典型資料就會炸頁面；(3) `sync.pullAll` 沒有並行鎖、且失敗中段會誤刪本機資料，是潛在的資料消失元兇。除此之外另有 7 項 P1（XSS、webhook 沒驗 JWT、寫死的 TODAY、UX 重要痛點），以及大量 P2 / P3 的視覺與效能拋光項。**建議先用 1-2 天打掉 P0 + 最痛的 P1（XSS、JWT 驗證、null guard）後再進入 phase 5**，避免上線後出包。

---

## 🔴 P0 嚴重（上線阻擋級）

### P0-1. Supabase RLS 對所有 authenticated 帳號完全開放
- **影響**：anon key 公開在前端與 LIFF，若 Dashboard 未關閉 email signup，攻擊者自行註冊一個帳號即可 `select *` 撈走 tenants / contracts / invoices / line_messages（含租客電話、Email、緊急聯絡人、私訊全文）。
- **修法**：(1) Supabase Dashboard → Authentication 立刻確認 Email Sign-ups = OFF；(2) policy 改為 `USING ((auth.jwt() ->> 'role') = 'admin')`；(3) `line_messages` 加額外 read-only 限制。
- **證據**：`sql/10-lockdown-rls.sql:37-48`、`js/supabase.js:4-5`
- **工作量**：中（半天）

### P0-2. `line-push` Edge Function 沒有身份驗證，任何人可冒名推送
- **影響**：anon key 公開，攻擊者直接呼叫 function 傳 `tenantId + message` 給租客做社工詐騙（「請改匯到這個帳號」）。
- **修法**：從 `Authorization` header 取 JWT → `supabase.auth.getUser(jwt)` 驗 admin role；確認 `config.toml` 保留 `verify_jwt = true`。
- **證據**：`supabase/functions/line-push/index.ts:46-100`
- **工作量**：小（<1h）

### P0-3. `pullAll` 無並行進入保護 + 失敗中段會誤刪本機資料
- **影響**：bootstrap、`online` 事件、realtime 重連幾乎同時觸發時會跑 2-3 個 pull 互相覆寫；某張表 fetch 中段失敗時，前面已套用「雲端優先刪除」邏輯，本機已被刪資料但 status='error'，使用者再 push 就把不完整資料推到雲端。
- **修法**：用 `let pullInFlight = null; if (pullInFlight) return pullInFlight;` 包整個 `pullAll`；每張表的 added/replaced/removed 先寫暫存 map，最後一次性 commit，失敗 rollback。
- **證據**：`js/sync.js:54-102`（無鎖）、`js/sync.js:87`（誤刪）
- **工作量**：中（半天）

### P0-4. 多處 `null.toLocaleString()` / `null.replace()` 缺 guard，LINE webhook 路徑會 crash
- **影響**：LINE webhook 建立的 invoice 可能 `amount = null`、退租流程被刪房間的 contract 可能 `propertyName = null`，前端整頁白屏。
- **修法**：`(inv.amount ?? 0).toLocaleString()`、`(c.propertyName || '').replace(...)`；同步抽出 `normalizePhone(p)` util 統一所有 `.phone.replace(...)` 用法。
- **證據**：`js/utils/topbar.js:122,164`、`js/views/dashboard.js:90`、`js/views/unsettled.js:83-84`、`js/views/finance.js:109`、`js/views/report-export.js:132,135,139`、`js/views/properties.js:723`
- **工作量**：小（<1h）

### P0-5. `mockData[t.src]` 未初始化會 crash（新增表的隱性 bug）
- **影響**：若新表加入 `TABLES` 但忘了在 `data.js` 初始化，pull / realtime INSERT 立即 throw `Cannot read properties of undefined`。
- **修法**：pull 與 realtime 開頭加 `if (!Array.isArray(mockData[t.src])) mockData[t.src] = [];`
- **證據**：`js/sync.js:75, 208, 214`
- **工作量**：小（<1h）

### P0-6. 前端大量 `innerHTML` 拼接未 escape 的用戶資料（Stored XSS）
- **影響**：租客名字、地址、LINE displayName 等用戶可控欄位若含 `<img src=x onerror=...>`，會在管理員 BMS 介面執行任意 JS、讀走 supabase session。LIFF 端 `profile.displayName` 也未 escape。
- **修法**：抽出 `utils/escape.js` 把現有 `topbar.js:135` 的 escapeHtml 集中；所有 view 的表格 cell / detail modal 渲染都過一遍；`openDetailModal` 預設 escape `it.value`，需要 raw HTML 才開 `valueHtml` 欄位。
- **證據**：`js/views/tenants.js:46-59`、`js/views/maintenance.js:24-46`、`js/views/properties.js:586-599`、`js/utils/ui.js:459-467`、`liff/index.html:193-194`
- **工作量**：中（半天）

### P0-7. 寫死的 `TODAY = '2026-05-08'` 讓維修頁全部算錯
- **影響**：所有報修都顯示「-22 天前」等負值，使用者一眼覺得系統壞了。
- **修法**：`const TODAY = new Date().toISOString().split('T')[0];`
- **證據**：`js/views/maintenance.js:5`
- **工作量**：小（<1h）

---

## 🟡 P1 重要

### P1-1. LINE webhook 簽章用 `===` 比對，有時序攻擊風險
- **影響**：webhook 是公開端點，業界標準必修。
- **修法**：`crypto.timingSafeEqual()` 比 Buffer。
- **證據**：`supabase/functions/line-webhook/index.ts:78-81`
- **工作量**：小

### P1-2. LINE webhook supabase 查詢全部沒檢查 `error`，會 500 並造成重送風暴
- **影響**：Postgres 失敗時 `data` 是 null，後面 `.name` `.length` 全炸 → 回 500 → LINE retry 3 次 → 重複插入。
- **修法**：每個 query 解構 `{ data, error }`，error → throw 統一處理。
- **證據**：`supabase/functions/line-webhook/index.ts:222-223, 239, 358, 410, 505, 568`
- **工作量**：中

### P1-3. webhook 缺 idempotency，LINE 重送會建重複資料
- **影響**：同訊息事件被處理兩次 → 維修紀錄 / 末 5 碼 invoice 重複。
- **修法**：`line_messages.webhook_event_id` 加 unique，重複事件 silent skip。
- **證據**：`supabase/functions/line-webhook/index.ts:611-663`
- **工作量**：小

### P1-4. `tenant-register` 沒 rate limit + 表單欄位無長度/格式驗證
- **影響**：任何 LINE 用戶可無限次 POST，撐爆 DB 或塞超長字串；email 完全沒驗格式。
- **修法**：per-userId rate limit（5/h）；name/email/emergencyContact ≤100 字；email regex；DB schema 加 `CHECK (length(name) <= 100)`。
- **證據**：`supabase/functions/tenant-register/index.ts:80-116`
- **工作量**：中

### P1-5. Edge Function CORS 設為 `*`
- **影響**：搭配 P0-2（line-push 沒驗 JWT）等於任意網站可埋 fetch 冒名推送。
- **修法**：白名單 `https://<netlify>.app, https://liff.line.me`，Function 內驗 Origin。
- **證據**：`supabase/functions/tenant-register/index.ts:55-61`、`supabase/functions/line-push/index.ts:25-29`
- **工作量**：小

### P1-6. `bms:data-changed` 觸發整頁 re-render，450+ invoices 時雪崩
- **影響**：每筆編輯都走 `viewContainer.innerHTML = ''` 全清重建 + tab counts O(rows × tabs)；finance / analysis 頁明顯卡頓。
- **修法**：拆 `mountRoute()`（換頁）+ `refreshDataOnly()`（資料變動只更 tbody / metric cards）；或判斷 `payload.table` 與當前 view 無關時跳過。
- **證據**：`js/app.js:166-173`、`js/sync.js:192-223`
- **工作量**：大

### P1-7. `analysis.js` 交叉表 O(types × buildings × invoices) 重複過濾
- **影響**：5 月 450 invoices × 12 type × 6 館 ≈ 7 萬次比較，每次切月/排序都跑。
- **修法**：先 `byTypeBuilding[direction][type][buildingId] = sum` 雙層 groupBy，cell/row/col total 查 lookup。
- **證據**：`js/views/analysis.js:65-150`、同樣套到 `reports.js:38-59`
- **工作量**：中

### P1-8. `getBedContracts()` + `paymentStatusFor()` 每床每月全表掃
- **影響**：117 床 × 10 月 × 450 invoices ≈ 52 萬次比較。
- **修法**：渲染前建 `contractsByProperty` + `invoicesByContractAndMonth` Map，O(1) 查詢。
- **證據**：`js/views/occupancy.js:123-128, 197, 235`
- **工作量**：中

### P1-9. 所有列表頁分頁元件是假按鈕
- **影響**：使用者按了沒反應，且資料量到 50+ 筆整頁拖很長；UX 反指引。
- **修法**：實作 client-side slice 分頁，或先拿掉。
- **證據**：`js/views/properties.js:192`、tenants/maintenance/contracts 同
- **工作量**：中

### P1-10. 離線編輯後重新連線可能丟失本機變更
- **影響**：offline 時 push 直接 silent return，無 outbox；online 後 bootstrap pull 把本機覆蓋掉，離線期編輯消失。
- **修法**：offline 時把待 push 事件記到 localStorage outbox，online 後逐筆 replay；indicator 顯示「離線待同步 N 筆」。
- **證據**：`js/sync.js:106, 124, 148-149`
- **工作量**：大

### P1-11. Realtime 連線斷掉沒重試，但 UI 仍顯示綠燈
- **影響**：`CHANNEL_ERROR / TIMED_OUT / CLOSED` 都被忽略，使用者以為正常但實際看不到別人變更。
- **修法**：非 `SUBSCRIBED` 狀態 → exponential backoff 重連；status 切換都 emit。
- **證據**：`js/sync.js:184`
- **工作量**：中

### P1-12. `runMigration()` 在每次 pull 與 realtime event 都全表跑
- **影響**：realtime 每收 1 筆 UPDATE 都跑全 mockData 補欄位 + denormalize（O(properties × contracts)）。
- **修法**：拆「冪等補欄位」+「同步 denorm 欄位」兩段；realtime 只跑局部 migration。
- **證據**：`js/data.js:268-468`，呼叫點 `js/sync.js:91, 219`
- **工作量**：中

### P1-13. `actualAmount` / 收支彙整邏輯複製 4-5 份
- **影響**：未來改規則（折扣、匯率）會漏改，已有 code comment 暗示踩過坑。
- **修法**：抽到 `js/data.js` exports `invoiceActualAmount` / `aggregateInvoicesByDirection`，把 `invoicePaidValue`（data.js:1534）也合併。
- **證據**：`finance.js:27-38`、`analysis.js:10-21`、`analysis-export.js:7-13`、`finance-export.js:9`、`reports.js:45`
- **工作量**：小

### P1-14. localStorage 毀損後靜默 fallback 到 demo 資料
- **影響**：使用者重整後看到「王大明、李小芬」會以為帳號被駭。
- **修法**：catch 後備份毀損內容到 `bananas-bms-data-v1.broken-${ts}` → 清掉原 key → toast 提示「本機快取毀損，已從雲端重新載入」。
- **證據**：`js/data.js:227-241`
- **工作量**：小

### P1-15. localStorage 沒大小監控，`contractTemplates`（PDF base64）會撐爆 5MB
- **影響**：`QuotaExceededError` 只 console.warn，後續編輯靜默失敗 → 重整後資料消失。
- **修法**：contractTemplates 不寫 localStorage（雲端為 source）；`navigator.storage.estimate()` 在 settings 顯示用量；QuotaExceeded 主動 toast。
- **證據**：`js/data.js:197-225`、`store.setContractTemplate:1383`
- **工作量**：中

### P1-16. 「新增入住」表單一次塞 13+ 欄位、且「建立合約」按鈕語意混淆
- **影響**：新手有壓迫感、容易漏填；合約頁的「建立合約」其實是走入住流程，造成困惑。
- **修法**：拆 3 步 stepper（床位+租客 → 合約條件 → 收款）；合約頁按鈕改「新增入住 / 合約」或先讓使用者選空殼/入住兩種模式。
- **證據**：`js/views/properties.js:514-685`、`js/views/contracts.js:660`
- **工作量**：大

### P1-17. 退租流程沒顯示影響範圍 + 必填提示太籠統
- **影響**：退租 modal 只問日期+備註，沒寫「會釋出床位、改租客狀態、作廢後續帳單」等副作用，跟續租 modal 有完整預覽不對等；必填錯誤只說「請填寫所有必填欄位」要使用者自己肉眼掃。
- **修法**：退租 modal 加 summary；toast 帶第一個遺漏欄位名 + scrollIntoView。
- **證據**：`js/views/contracts.js:613-632`、`js/utils/ui.js:126`
- **工作量**：中

---

## 🟢 P2 改善

### P2-1. `supabase.auth.updatePassword` 不要求重輸舊密碼，劫持風險
- **修法**：前置 `signInWithPassword(currentEmail, oldPw)` 驗證後再 `updateUser`。
- **證據**：`js/auth.js:61-68`
- **工作量**：小

### P2-2. supabase client 暴露到 `window.sb` / `window.supabaseClient`
- **修法**：`if (location.hostname === 'localhost') window.sb = supabase;`
- **證據**：`js/supabase.js:11-12`
- **工作量**：小

### P2-3. signed PDF URL 7 天過長 + token 永久寫進 `line_messages.raw`
- **修法**：縮短到 24-48h；寫 `line_messages` 前抹掉 URL token；備份流程同樣 sanitize。
- **證據**：`js/utils/line.js:37`、`supabase/functions/line-push/index.ts:71-87`
- **工作量**：中

### P2-4. 缺 HTTP security headers（CSP / X-Frame-Options / HSTS）
- **修法**：Netlify `_headers` 加 CSP、X-Frame-Options: DENY、HSTS、Referrer-Policy。
- **證據**：全域無 `netlify.toml` / `_headers` / CSP meta
- **工作量**：小

### P2-5. Realtime echo 判斷邏輯重疊（updatedAt 字串比對 + isOwnEcho）
- **修法**：移除 sameUpdatedAt 短路，全交給 isOwnEcho；或 push 後把 server `updated_at` 寫回本機。
- **證據**：`js/sync.js:204`
- **工作量**：小

### P2-6. `linePush` 失敗只 log 不 throw，`notifyAdmin` 永遠看似成功
- **修法**：linePush 失敗 throw；notifyAdmin 在 catch log 即可。
- **證據**：`supabase/functions/line-webhook/index.ts:54-64`
- **工作量**：小

### P2-7. `bms:delete` 沒去重，連點刪除按鈕送 N 次 DELETE
- **修法**：in-flight `Set<string>` 記 `${table}/${id}` 去重。
- **證據**：`js/sync.js:152-170`
- **工作量**：小

### P2-8. webhook 的 `rateMap` / `cannedSentAt` 在 cold start 重置
- **修法**：改寫到 `rate_limits` 表；先期至少把 MAX 從 15 降到 5。
- **證據**：`supabase/functions/line-webhook/index.ts:88, 112`
- **工作量**：中

### P2-9. 登出 race，跑兩次 `location.reload()`
- **修法**：移除 `signOut()` 內的 reload，全交給 `onAuthChange`。
- **證據**：`js/app.js:96-99`、`js/auth.js:43-49`
- **工作量**：小

### P2-10. 原生 `confirm()` / `alert()` 仍在用，視覺風格斷裂
- **修法**：登出/清資料改 `openConfirm({ danger: true })`，簽署檔失敗改 toast。
- **證據**：`js/data.js:251`、`js/app.js:157,287`、`js/migrate-to-supabase.js:52`
- **工作量**：小

### P2-11. 「結帳」vs「核對結帳」差別說明不足
- **修法**：頁面 header 加一句 SOP：「客戶有回報末 5 碼 → 用核對結帳；其他直接結帳」。
- **證據**：`js/views/unsettled.js:36-66`、`finance.js:189-195`
- **工作量**：小

### P2-12. 合約頁操作欄最多 8 顆 icon，視覺擠
- **修法**：把次要操作（編輯/下載/寄 LINE/刪除）收進 ⋯ more menu，主操作只留續租/退租/檢視。
- **證據**：`js/views/contracts.js:131-141`
- **工作量**：中

### P2-13. 多數列表頁缺 empty state
- **修法**：每個 view 統一處理 `tableRows || EMPTY_STATE_HTML`。
- **證據**：`js/views/properties.js:244-250` 等
- **工作量**：小

### P2-14. 字體大小階層失控（27+ 種非標準尺寸）+ 間距失控（30+ 種）
- **修法**：定義 type scale `--fs-xs/sm/base/lg/xl/2xl/3xl`、space scale `--space-1..12`（4px 階），全檔對齊。
- **證據**：`css/style.css` 全檔
- **工作量**：中（4-6h）

### P2-15. 顏色硬編碼繞過已定義變數
- **修法**：CSS 改用 `var(--text-secondary)` 等；js views 內顏色全部用 CSS class。
- **證據**：`css/style.css` 11+ 處硬寫 `#475569`；`js/views/*` 共 111 處 hex
- **工作量**：中

### P2-16. 483 處 inline style 散落 views/（settings 112 處最重）
- **修法**：抽 dashboard.js todo 卡 component；高頻 inline 改 utility class（.flex-col-2 / .text-xs / .text-muted）。
- **證據**：`js/views/dashboard.js:278-326` 三段重複 todo 卡
- **工作量**：大

### P2-17. Emoji 與 Phosphor Icon 混用
- **修法**：全面改用 Phosphor；toast 也改 `<i class="ph ph-check-circle">`。
- **證據**：多處 `🏢 各館收支` / `📊` / `🔧` 等 vs `<i class="ph">`
- **工作量**：小

### P2-18. `!important` 用了 140 次（flatpickr 段最重）
- **修法**：flatpickr 改 `.flatpickr-calendar.bms-custom { ... }` 提 specificity 取代 `!important`。
- **證據**：`css/style.css:644-820` 等
- **工作量**：中

### P2-19. 表格 `nowrap` + `overflow-x` 在窄螢幕無提示
- **修法**：策略統一 — 全 ellipsis + title tooltip，或全橫滑 + sticky 第一欄。
- **證據**：`css/style.css:2178, 2198`、`finance.js:129` inline 蓋掉
- **工作量**：中

### P2-20. 住房一覽用 checkbox 觸發退租，反直覺
- **修法**：改成 `ph-door-open` icon button，與其他頁的退租按鈕一致。
- **證據**：`js/views/occupancy.js:171`
- **工作量**：小

### P2-21. `viewStateCache` 跨 view 不清，登出後仍保留 A 使用者狀態
- **修法**：`clearSensitiveLocalCache()` 同時呼叫 `tableFilter.clearStateCache()`。
- **證據**：`js/utils/tableFilter.js:20`
- **工作量**：小

### P2-22. `buildingName(id)` 每 row 跑 `mockData.buildings.find`
- **修法**：`data.js` 提供 lazy `_buildingMap`；render 起頭建一次 `tenantsByName` Map。
- **證據**：`finance.js:14-16`、`unsettled.js:9-11`、`reports.js:30` 等 8 處
- **工作量**：小

### P2-23. `pullAll` 永遠全表拉，未用 `updated_at` 增量
- **修法**：bootstrap 全表（含刪除偵測）；前景切回 / online 走 incremental（`.gt('updated_at', lastSync)`），刪除靠 realtime DELETE。
- **證據**：`js/sync.js:54-102`
- **工作量**：中

### P2-24. `metric.monthlyIncome` 名不符實（實為歷史累計）
- **修法**：改名 `lifetimeIncome` 或補 `invoiceMonth(inv) === currentMonth()` 過濾。
- **證據**：`js/data.js:1546-1548`
- **工作量**：小

---

## ⚪ P3 nice-to-have

### P3-1. 全域缺「未儲存變更」防護
- **修法**：`openFormModal` 加 `dirtyCheck: true`，close 前若 dirty 跳 confirm。
- **證據**：`js/utils/ui.js:49-57`
- **工作量**：小

### P3-2. 表頭可排序但缺 `aria-sort` 與視覺提示
- **修法**：加 `aria-sort`、hover 底色、改用 `↑/↓` 視覺。
- **工作量**：小

### P3-3. 缺 `prefers-reduced-motion` 支援
- **修法**：`@media (prefers-reduced-motion: reduce)` 全域降 animation。
- **工作量**：小

### P3-4. Dark Mode 全無支援
- **修法**：依賴 type/space token + inline style 抽離完成後再做，否則踩 483 inline style 雷。
- **工作量**：大（1-2 天，但前置先做完 P2-14~16 才划算）

### P3-5. 缺中尺寸 btn-xs（24px 微型按鈕）
- **修法**：補 `.btn-xs { padding:.25rem .5rem; font-size:.75rem; min-height:24px; }`
- **工作量**：小

### P3-6. `transition: all` 用 30+ 次，行動裝置 repaint 卡
- **修法**：明確列出過場屬性。
- **工作量**：小

### P3-7. 警示色對比度邊緣（chip-count 約 3.2:1 未過 AA）
- **修法**：warning 主色加深到 `#9b6f0e`；chip-count 換 `--text-main`。
- **工作量**：小

### P3-8. Phosphor icon variant 規則不明（ph vs ph-fill 混用）
- **修法**：定規則 — active 用 ph-fill，預設 ph；nav active state CSS 自動切。
- **工作量**：小

### P3-9. danger / success hover 色硬編碼
- **修法**：補 `--color-danger-hover` / `--color-success-hover`。
- **工作量**：小

### P3-10. RWD breakpoint 不一致（6 種）
- **修法**：抽 token，統一 3 個（sm 640 / md 768 / lg 1024），移除 880。
- **工作量**：小

### P3-11. `tableFilter.updateTabCounts()` 重複 split
- **修法**：init 時把 `r.dataset[group].split` cache 在 row 上。
- **工作量**：小

### P3-12. `searchAll` query 無長度限制
- **修法**：`q.slice(0, 100)`。
- **工作量**：小

### P3-13. Toast 在 modal 上可能被遮住
- **修法**：toast `z-index` 至少 2000，確保 `position: fixed`。
- **工作量**：小

---

## 📊 概覽統計

### 嚴重度分布
| 等級 | 數量 |
|---|---|
| 🔴 P0 嚴重 | 7 |
| 🟡 P1 重要 | 17 |
| 🟢 P2 改善 | 24 |
| ⚪ P3 nice-to-have | 13 |
| **合計** | **61** |

### 按面向分類
| 面向 | P0 | P1 | P2 | P3 | 合計 |
|---|---|---|---|---|---|
| 安全 | 2 | 5 | 4 | 0 | 11 |
| 穩定 | 3 | 6 | 4 | 0 | 13 |
| 效能 | 0 | 4 | 4 | 1 | 9 |
| UX / 流程 | 1 | 3 | 5 | 1 | 10 |
| 視覺 / 一致性 | 0 | 0 | 7 | 7 | 14 |
| 資料保護 / 其他 | 1 | 0 | 1 | 0 | 2 |
| 程式碼品質 | 0 | 2 | 2 | 0 | 4 |

> 註：P0-6 XSS 同時跨「安全 / 視覺」、P0-4 null guard 同時跨「穩定 / 程式碼品質」，分類取主要面向。

### 工作量分布
- 小（<1h）：~28 項
- 中（半天）：~25 項
- 大（1 天+）：~8 項
- **整體預估**：P0 全打完約 1-2 天；P0+P1 全打完約 5-7 天；P0+P1+P2 約 3 週。

---

## 🎯 建議下一步（最值得先動的 5 項）

> 排序依「上線風險 × 工作量」，按下面順序處理可以最快讓系統進入「敢上真實流量」狀態。

1. **【今天就動】P0-1 + P0-2：安全閘門（半天內）**
   先去 Supabase Dashboard 關掉 email signup → 改 RLS policy 為 admin-only → line-push 加 JWT 驗證。
   這三個動作完成前，系統其實是「任何人都能撈走全部資料 + 冒名發 LINE」狀態，不該對外。

2. **【今天就動】P0-4 + P0-5 + P0-7：3 個 null guard / 寫死日期（1 小時）**
   都是 10 行內可修的 crash 點，CP 值最高。順手抽 `normalizePhone()` util。

3. **【明天】P0-3：`pullAll` 並行鎖 + 失敗 rollback（半天）**
   是潛在「使用者資料神祕消失」的最大兇手，10 行 in-flight Promise 修法。

4. **【本週】P0-6 + P1-1 + P1-2 + P1-3：安全收尾（1 天）**
   抽 `utils/escape.js` 統一 escapeHtml + `openDetailModal` 預設 escape；webhook 改 `timingSafeEqual`、加 error 檢查、加 `webhook_event_id` unique。做完安全面就到 80 分。

5. **【下週】P0-7 已修 + P1-9（假分頁）+ P1-16（新增入住表單拆 stepper）+ P1-17（退租 summary）：UX 痛點集中收（2 天）**
   這幾項是使用者第一次接觸系統會「卡到」的地方，phase 5 前處理完比較像可交付產品。

> **暫緩**：Dark Mode（P3-4）絕對不要先做，會踩 483 inline style 的雷；先把 P2-14 ~ P2-16（token 化 + 抽 component）做完，dark mode 只剩 1-2 天工程量。
