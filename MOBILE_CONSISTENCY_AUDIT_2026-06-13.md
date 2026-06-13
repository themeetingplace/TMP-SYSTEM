# PMS 手機 UI 一致性 audit (2026-06-13)

> Auditor: Senior UI/UX Designer
> Scope: 手機 (~390px、涵蓋 320–768px) 的同類元件一致性
> 方法：純讀檔，不執行專案、不改 code
> 觸發：用戶反映「同樣的物件系統就要有一樣的模式」 — 6 個個別 bug 已在主 thread 處理，本報告找系統性不一致

---

## TL;DR

聚空間 PMS 桌面樣式的「分歧 + 後補手機 patch」造成手機 UI 系統性裂縫。主要 4 個問題：(1) **`form-grid` 在 ≤640px 已是單欄、但 modal「3 欄」(`grid-column: span 3`) 不存在 — 真正問題是某些欄位用 `span: 2` 撐滿、某些保留預設 1 欄就被併排，視覺上「為什麼這格獨佔，下一格又雙拼」沒邏輯**；(2) **filter 列有 5 套並存**（`.filter-tabs` / `.area-filter-row` / `.bldg-subtab-row` / `.occ-tabs` / `.finance-sub-tabs`），手機處理方式各不同 — `.filter-tabs` 已改橫向滾動但 `.unsettled` 仍 inline 寫 `flex-wrap: wrap` 蓋掉；(3) **KPI 卡分裂成 2 套** — 5 個 view 用 `metrics-grid + metric-card`（手機改 70% 寬橫向 snap），但 reports 用 `stat-tile-grid + stat-tile`（手機改 2 欄 grid），同樣是 KPI 卻完全不同手感；(4) **iOS 鍵盤遮住 input** — `attachKeyboardAdjustment()` 用 `visualViewport.height` 強壓 `max-height`，但 `modal-body` 的 `overflow-y: auto` 不會主動把 focus 元素捲進視野，鍵盤一彈 input 就死在 viewport 外。整體嚴重度：**High (form-grid span 規則)、High (filter 不一致)、Medium (KPI 二元化)、High (iOS 鍵盤)**。

---

## 1. Modal 表單一致性

### 1.1 系統內所有 `openFormModal` 清單

| # | 用途 | file:line | maxWidth | 欄位數 | 用 `span: 2` 欄位 |
|---|---|---|---|---|---|
| 1 | 新增 / 編輯床位 | `js/views/properties.js:290` | 720 | 4–5 | `status` (span 2) |
| 2 | 新增入住 / 建立合約 | `js/views/properties.js:517` | 640 | ~15 | `source / tenantName / tenantEmergency / extraBeds / discount` (多個 span 2) |
| 3 | 新增 / 編輯收支 | `js/views/finance.js:293` | 700 | 7–10 | `contractId / note` (span 2)；其他預設 1 |
| 4 | 編輯合約 | `js/views/contracts.js:397` | 700 | 8 | 無 (全部預設 1 欄並排) |
| 5 | 退租確認 | `js/views/contracts.js:809` | 560 | 2 | `effectiveDate / note` (全 span 2) |
| 6 | 暫緩決策 | `js/views/contracts.js:857` | 420 | 1 | 無 |
| 7 | 新增 / 編輯維修 | `js/views/maintenance.js:125` | 700 | 6 | `issue / cost` (span 2) |
| 8 | 完成維修 (填費用) | `js/views/maintenance.js:182` | 480 | 1 | `cost` (span 2) |
| 9 | 新增 / 編輯租客 | `js/views/tenants.js:148` | 700 | 9 | `source / email / emergencyContact / note` (span 2) |
| 10 | 新增 / 編輯應收 | `js/views/unsettled.js:405` | 700 | 11 | `note` (span 2) |
| 11 | 末 5 碼核對 | `js/views/unsettled.js:215` | 480 | 3 | 全 span 2 |
| 12 | 管理員邀請 / 編輯 | `js/views/admin-users.js:153` | — | — | — |
| 13 | 設定相關 (多支) | `js/views/settings.js:114/385/569/694` | — | — | — |

### 1.2 對比 — 「同類事件，不同欄位配置」

**新增收入 (#3) 桌面 vs 新增應收 (#10) 桌面**：兩個都是「在某館對某租客建一筆帳」，但欄位佈局完全不同。

| 欄位 | 新增收入 (`finance.js:277`) | 新增應收 (`unsettled.js:390`) |
|---|---|---|
| 館別 | 1 欄 | 1 欄 |
| 類型 | 1 欄 (跟館別並排) | 1 欄 (跟館別並排) |
| 物件 | 1 欄 | 1 欄 |
| 租客 | 1 欄 (跟物件並排，searchable) | 1 欄 (跟物件並排，searchable) |
| 應收金額 | 1 欄 | 1 欄 (跟「應結日」並排) |
| 調整金額 / 折扣 | 1 欄 (跟應收並排) | 1 欄 (在 section divider 之後) |
| 調整原因 / 折扣原因 | 1 欄 (跟調整並排) | 1 欄 |
| 付款方式 | 1 欄 | 1 欄 |
| 入帳日 / 應結日 | 1 欄 | 1 欄 |
| 租期起 / 租期止 | 1 欄 × 2 | 不存在 |
| 已收金額 | 不存在 | 1 欄 |
| 備註 | span 2 textarea | span 2 textarea |

**洞察**：兩個 modal 都是「收一筆錢」，欄位順序 + 並排組合不一樣 — 用戶切換頁面要重新學排版。

### 1.3 桌面 → 手機的轉換規則 (現況)

CSS 規則只有一條 (`css/style.css:4898`)：

```css
@media (max-width: 640px) {
    .form-grid { grid-template-columns: 1fr; }
}
```

意思是 **≤640px 所有欄位都會變單欄**。所以用戶說的「館別 / 床位併排」、「應收 / 調整併排」**其實在 ≤640px 已自動垂直堆疊** — 但用戶仍看到「併排」表示：
- **手機 viewport > 640px 觸發點**：iPad mini portrait = 768px → 還是 2 欄 (沒覆蓋到 641-768)
- **或斷點不夠靈敏**：iPhone 12 Pro Max = 428px ✓ 已單欄，但 fold 機展開 = 750px 沒單欄
- **或用戶以為的「手機」是 iPad 平板尺寸**

**修法**：把斷點改成 `max-width: 768px` (跟 `.filter-tabs / .area-filter-row` 同斷點)；或更安全用 `max-width: 900px` 強制所有觸控裝置都單欄。

### 1.4 modal 共同 footer / header 已統一 (好)

`openModal()` 共用：`.modal-overlay > .modal-content > .modal-header / .modal-body / .modal-footer`。
- ≤600px 統一 bottom-sheet (`css/style.css:5184-5215`)，drag handle ✓
- ≤600px header / subtitle / close 已重排成 block + absolute (`6346-6369`) ✓
- ≤600px footer 3 按鈕 `flex: 1` 平分 (`6446-6463`) ✓
- ≤360px footer icon hidden (`6492-6494`) ✓

這套是好的 — **問題只在 form-grid 內部 span 規則**。

### 1.5 modal subtitle 注入方式不一致

`properties.js:535-540` (新增合約) 把 `.modal-subtitle` 用 `insertAdjacentElement('afterend')` 動態插入到 `.modal-header h3` 後面 — **inline style 寫死 font-size 0.75rem, color, margin-top**，並用 `<span>` 內嵌 `monospace` 顯示合約編號。
其他 modal (`finance / unsettled / contracts`) **完全沒 subtitle**。
桌面 CSS **沒有 `.modal-subtitle` 規則**，只有 ≤600px 才補一條 (`css/style.css:6358-6364`) 改 block display。
桌面靠 inline style 撐起來，是個 fragile pattern。

### 1.6 「不一致地方」逐條表

| 問題 | 影響的 modal | 嚴重度 |
|---|---|---|
| `span` 規則沒一致策略：有的單欄 (退租 / 末 5 碼)、有的混合 (新增入住 / 租客)、有的全並排 (編輯合約) | 全部 13 個 | High |
| `form-grid` 手機斷點 640px **包不到** 641-900 區間 (平板直式 / 大手機橫拿) | 全部 | High |
| 編輯合約 (#4) 沒有任何 `span: 2`，桌面 8 個欄位全部 2 欄並排 — 跟「新增入住」精神不同 | #4 | Medium |
| `.modal-subtitle` 只有「新增入住」用 inline style 動態插入，且桌面 CSS 沒對應規則 | #2 | Medium |
| 「新增合約」用 wizard stepper (3 步驟)，其他 modal 全是 single-page form | #2 | Low (體驗差異化可接受) |
| 「退租 / 暫緩 / 完成維修」按鈕全寬，但「新增入住」3 顆按鈕擠壓 | #5/#6/#8 vs #2 | Low (已有 mobile patch) |

### 1.7 統一建議

**A. 制定「手機單欄」唯一規則：**
```css
/* 把 640 改成 768 — 涵蓋平板直式 + 大手機橫拿 */
@media (max-width: 768px) {
    .form-grid { grid-template-columns: 1fr; }
    /* 同時取消 grid-column: span N，避免 inline span="2" 在單欄時造成空 row */
    .form-grid > [style*="grid-column"] { grid-column: 1 / -1 !important; }
}
```

**B. 廢除 `span` 屬性的 freestyle 用法**：建立 3 個 layout preset：
- `layout: 'stacked'` → 全部 1 欄 (退租 / 末 5 碼 / 完成維修)
- `layout: 'pairs'` → 桌面 2 欄、手機 1 欄 (預設) — 新增 / 編輯類
- `layout: 'wide-sections'` → section + 部分 span 2 (新增入住 / 租客)

`renderField()` 內依 layout 決定 wrapStyle，不再讓呼叫方手動寫 `span: 2`。

**C. 統一「收一筆錢」的欄位順序**：
> 館別 → 類型 → 物件 → 租客 → 金額 → 折扣 → 折扣原因 → 付款方式 → 日期 → 備註

`finance.js` 跟 `unsettled.js` 共用 `buildInvoiceFields(direction)` 函式。

**D. 把 `.modal-subtitle` 寫進桌面 CSS**：
```css
.modal-subtitle {
    display: block;
    margin-top: 0.3rem;
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-weight: 400;
    line-height: 1.4;
}
```
移除 `properties.js:538` 的 inline style。

---

## 2. Filter / 篩選列一致性

### 2.1 系統內 filter 變體清單

| # | 名稱 | 用在哪 | 視覺 | 手機行為 (現況) |
|---|---|---|---|---|
| F1 | `.filter-tabs` + `.filter-tab` | finance / contracts / properties / maintenance / tenants / unsettled 狀態列 | 暖灰底圓角 pill (canonical segmented control) | ≤768px 改橫向 scroll (`2656-2672`) ✓ |
| F2 | `.area-filter-row` + `.area-filter-btn` | properties / contracts 館別篩選 | 白底框 + 雙行 (館名 + 統計)，min-width 110px | ≤768px 改橫向 scroll + scroll-snap (`5341-5357`) ✓ |
| F3 | `.bldg-subtab-row` + `.bldg-subtab` | reports 各館子標籤 | 米白底框 + active = 橘漸層 | 橫向 scroll (本來就 inline) ✓ |
| F4 | `.occ-tabs` + `.occ-tab` | occupancy 各館切換 | 灰底 pill + active = 橘漸層 (跟 F3 不同 active 樣式) | ≤768px 橫向 scroll (`6163-6168`) ✓ |
| F5 | `.finance-sub-tabs` + `.finance-sub-tab` | 帳務管理 3 個子頁 (總收支 / 房租查帳 / 收支分析) | 米白底 + 白底 active + shadow | ≤640px 只縮 label 字 (`5330-5337`)，**不橫向 scroll** |
| F6 | `.settings-tabs` + `.settings-tab` | settings 5 個分頁 | 底線 underline tab (跟其他都不同) | ≤720px 橫向 scroll (`5235-5246`) ✓ |
| F7 | `.area-quick-filter` | finance 隱藏版館別快速跳轉 | 用 `.filter-tab` 但 display:none | 看不到，無手機差異 |

### 2.2 6 套 filter 視覺對比

| 屬性 | F1 filter-tabs | F2 area-filter-row | F3 bldg-subtab | F4 occ-tab | F5 finance-sub-tab | F6 settings-tab |
|---|---|---|---|---|---|---|
| 容器底色 | 暖灰 `--color-background` | 透明 (無背景) | 透明 | 透明 | `--bg-secondary` 框 | 透明 + 底線 |
| 按鈕底色 | 透明 | 白 + 框 | 白 + 框 | 灰 pill | 透明 | 透明 |
| Active 樣式 | 白底 + shadow | 橘 light + 橘字 + 橘框 | 橘 light + 橘字 + 橘框 | **橘漸層 + 白字** | **白底 + shadow + 橘字** | **橘底線 + 橘字** |
| 圓角 | `--radius-md` (8px) | `--radius-md` (8px) | 8px | 999px (pill) | `--radius-sm` (6px) | 矩形 (border-bottom) |
| 內距 | 0.44 × 0.88 | 0.625 × 1 | 0.45 × 0.8 | 0.5 × 0.9 | 0.65 × 1 | 0.75 × 1.25 |
| 字級 | `--text-sm` | 0.875 + 0.75 雙行 | 0.85 | 0.85 | `--text-base` (1rem) | 0.9 |
| 字重 active | 600 | 600 | 600 | 600 | 600 | 500 |
| 圖示 | 偶有 | 無 | 1rem 前置 | 1rem 前置 | 1.05rem 前置 | 1.1rem 前置 |
| 含 count badge | inline `(n)` 文字 | sub-label 雙行 | 無 | `.occ-tab-count` 灰底 pill | 無 | 無 |
| Hover | 白 60% 不透明 | 橘 light | 暖 surface | 灰 tertiary | 黑 4% | 文字變深 |
| 觸控 ≥ 44px | F1/F2/F4/F6 已補 (`5255-5277`) | ✓ | ✗ 未補 | ✓ | ✗ 未補 | ✓ |

**結論**：6 套 segmented control，視覺、互動、active 表現、padding、字級全部不同。

### 2.3 user 已回報的具體不一致

> **房租查帳 (`unsettled.js:174,182`)** 的 「館別 / 狀態」篩選**沒有改橫向捲動**

根因：`unsettled.js:174` 寫死 `style="flex-wrap: wrap;"` inline，把 `2657-2672` 的 `flex-wrap: nowrap` overflow-x: auto 蓋掉。

```html
<!-- unsettled.js:174 -->
<div class="filter-tabs mb-2" style="flex-wrap: wrap;">
    <span class="filter-tab-label">館別</span>
    ...
</div>
```

**修法**：移除這個 inline style，吃 `.filter-tabs` 共用規則。同樣的 inline 在 `unsettled.js:182` 第二條 (狀態 filter) 也要刪。

### 2.4 已改 / 未改 對比

| Filter | 已改成手機水平 scroll | 還沒 |
|---|---|---|
| F1 `.filter-tabs` | ✓ 全域規則 | unsettled 兩條被 inline `flex-wrap: wrap` 蓋掉 |
| F2 `.area-filter-row` | ✓ | — |
| F3 `.bldg-subtab-row` | ✓ (一開始就是) | — |
| F4 `.occ-tabs` | ✓ | — |
| F5 `.finance-sub-tabs` | ✗ **沒改** — 3 個 sub-tab 就算 wrap 也擠 3 行 (icon-only 模式) | label 隱藏後 icon-only 還算可用，但不一致 |
| F6 `.settings-tabs` | ✓ | — |

### 2.5 統一建議

**A. 建立「Segmented Control」設計 token**：
```css
/* 3 種 size variant: sm / md (default) / lg */
.segmented {
    display: flex; gap: 0.4rem;
    padding: 0.25rem;
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
}
.segmented::-webkit-scrollbar { display: none; }
.segmented > button {
    flex-shrink: 0;
    padding: 0.45rem 0.9rem;
    border-radius: calc(var(--radius-md) - 2px);
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
}
.segmented > button.is-active {
    background: var(--color-surface);
    color: var(--color-primary);
    font-weight: 600;
    box-shadow: var(--shadow-sm);
}
```

**B. 6 套 filter 全部 alias 到同一 class**：把 `.filter-tab / .area-filter-btn / .bldg-subtab / .occ-tab / .finance-sub-tab / .settings-tab` 全部用 `@extend` 的方式 (CSS 沒 extend，就是改 selector 串列共用一條規則)，差異只用 modifier (例如 `.segmented--pill` 給 occ / `.segmented--underline` 給 settings)。

**C. 立即修 (10 分鐘)**：
- `unsettled.js:174` 刪 `style="flex-wrap: wrap;"`
- `unsettled.js:182` 刪 `style="flex-wrap: wrap;"`
- `.finance-sub-tabs` 加 ≤640px 橫向 scroll
- `.bldg-subtab` 加進 ≤768px 觸控目標 ≥44 規則

### 2.6 active 色 — 黑色橘 vs 白底橘

- **F1 / F2 / F3 / F5**: active = 「白底 + 橘字 / 橘框 + shadow / light 底」(柔)
- **F4 occ-tab**: active = 「橘漸層 + 白字 + 0.3 opacity shadow」(重)

`occupancy` 跟 `reports` 都是「各館切換」相同意圖，但前者重後者柔。建議 **occ-tab 改成跟 bldg-subtab 同樣的柔 active 樣式**，視覺一致 + 視線焦點仍在表格內容。

---

## 3. KPI 卡片 / Stat tile 一致性

### 3.1 兩套並存

| 套組 | 用在哪 | 桌面 grid | 手機處理 |
|---|---|---|---|
| `.metrics-grid + .metric-card` | dashboard (4) / properties (3) / contracts (4) / maintenance (4) / tenants (4) / unsettled (3) / finance (3) | repeat(auto-fit, minmax(...)) — 大致 4 欄 | **水平 scroll**：一張 70% 寬 + 下一張露 30% (`5291-5324`) |
| `.stat-tile-grid + .stat-tile` | reports 全頁 (4 處用) | `repeat(4, 1fr)` 固定 4 欄 | **2 欄 grid**：`repeat(2, 1fr)` + 字級縮小 (`3424-3426, 3469-3472`) |

### 3.2 視覺對比

| 屬性 | metric-card | stat-tile |
|---|---|---|
| 容器 | `.card` (border + shadow) | flat 米白 (`box-shadow: none`) |
| 內距 | 1.5rem | 1rem 1.15rem |
| 圓角 | `--radius-md` (8px) | 12px |
| 標題 | `metric-header > span` 名稱 + `metric-icon` 圓形圖示 | `stat-tile-label` UPPERCASE + 圖示 (前) |
| 標題字 | 名稱白色背景的彩色 icon (24px 圓) | 全灰小字 + 灰 icon |
| 數字字級 | 1.875rem 700 (手機 1.5rem) | 1.65rem 700 (手機 1.4rem) |
| 數字色 | 黑 + inline color override 為 success/danger | 黑 + inline color |
| 副文字 | `.metric-subtext` 小灰字 | `.stat-tile-sub` 小灰字 |
| Hover | `.metric-link` 才有 (浮起) | 整個 tile 變暖 surface |
| 手機 | flex + horizontal snap-scroll | 2x2 grid 縮小 |

### 3.3 為何分兩套

`stat-tile` 是後加的「flat 設計」(`css/style.css:3417` 區段註解寫「flat / monochrome / 數字黑色」)，給 reports 用。其他頁面留下舊的 `metric-card` (有 brand 圓 icon 跟 shadow)。
**結論**：兩套是設計風格演進過程的化石。`stat-tile` 是新的、更安靜、適合分析頁；`metric-card` 是舊的、強調 + 點擊跳轉。

### 3.4 跨頁面手機體驗差異

iPhone (~390px) 連看 dashboard → reports：
- Dashboard：4 個 metric-card 一字排開橫向 scroll，每張 70% 寬，視覺**很滿**
- Reports：4 個 stat-tile 2x2 grid，視覺**很乾淨**

兩個都是「進首頁前 3 秒看到的關鍵指標」，差太多。

### 3.5 統一建議

**選一條路 (建議 A)**：

**A. 全 stat-tile 化** — 把 `metric-card` 廢掉，全部 view 改用 `stat-tile`：
- 更安靜，符合「居家管理 SaaS」氣質
- 手機改 2x2 比橫向 snap 更直覺 (不會錯過任何一張)
- dashboard 仍要支援「點擊跳轉」→ 給 `.stat-tile` 加一個 `.stat-tile--link` modifier (hover 浮起 + cursor: pointer)

**B. 全 metric-card 化** — 維持現有點擊跳轉、彩色 icon，但要把 reports 4 個 stat-tile 換掉，會跟 reports 後續的 sub-stat 卡片打架，工作量大。

**C. 兩套共存但「明確分工」** — 列規則：
- 主 view 標題下方那排 KPI → 永遠用 `metric-card` (帶 brand icon)
- 報表 / sub-view 內的次級 KPI → 永遠用 `stat-tile`
- 文檔寫死

第 1 順位推薦 A。

### 3.6 手機橫向 scroll 的問題

`metrics-grid` 在 ≤768 改成 horizontal scroll，**第一張看到但第二張只露 30%**。用戶在 dashboard 不會意識到右邊還有兩張 — 重要資訊看不到。
建議改回 **2x2 grid** (`grid-template-columns: 1fr 1fr; gap: 0.6rem;`) 跟 stat-tile 同手感。

---

## 4. 表格一致性

### 4.1 系統內 table class

| Class | 用在哪 | 桌面行為 | 手機行為 |
|---|---|---|---|
| `.data-table` (預設) | finance / contracts / properties / maintenance / tenants / unsettled | 標準表格 + sticky thead + sticky 右欄 | ≤600px **卡片化** (`6507-6601`)：thead 視覺隱藏、每 row 變 card |
| `.data-table.occ-table` | occupancy 矩陣 | 多欄寬表 + sticky 左 2 欄 | ≤768px 保留矩陣 + 橫向 scroll + sticky 左 2 欄 (`6017-6175`)，**不卡片化** (規則 `:not(.occ-table)` 排除) |
| `.report-table` (推測) | reports | 報表式表格 | 未檢視，但 reports 頁面用 `stat-tile-grid` 加表格混排 |
| `.report-pnl-table` (推測) | reports P&L | nowrap | 同上 |
| inline `<table>` 純 inline style | unsettled.js:338 / tenants.js:238 / settings 各處 | 寫死的小表格 | 不會卡片化 (沒掛 `.data-table`)，會在 ≤600 變超擠 |

### 4.2 occ-table 用戶剛回報的問題

> 「橫向滾動時 sticky 房客欄底色不透明，底下退房欄顯露」

CSS 已有規則 `css/style.css:6071-6077`：
```css
.occ-table td:nth-child(2),
.occ-table th:nth-child(2) {
    position: sticky;
    left: 56px;
    z-index: 2;
    background: var(--color-surface, #fff);
    box-shadow: 4px 0 6px -4px rgba(0, 0, 0, 0.10);
}
```
**根因**：`background` 是 `--color-surface` (白)，但 stripe-b 列底色是 `rgba(0, 0, 0, 0.02)` (半透明灰)，sticky cell 是純白 — 兩列之間視覺不對齊。`6094-6096` 補了 stripe-b 的特例：
```css
.occ-table tr.occ-room-stripe-b:not(.occ-row-vacant):not(.occ-row-terminated) > td:nth-child(2) {
    background: #fafbfa !important;
}
```
但 vacant/terminated 列 (`6085-6092`) 用 `#f1f3f5 / #f8f9fa` — 跟非 sticky 的列底色寫死值，不走變數。

**判定**：sticky 不透明問題的根因是「sticky cell 的 background 是純白，沒跟著兄弟 cell 跑」— 用戶描述「退房欄顯露」可能是 stripe-a / stripe-b 切換時某些 row 沒設 background。建議：**所有 occ-row 在 sticky 列強制給一個變數定義的不透明色** (不要 #fafbfa 寫死)。

### 4.3 卡片化 vs 矩陣的決策

| 表格用途 | 適合卡片化 | 適合保留 |
|---|---|---|
| 列表 (合約 / 帳目 / 租客 / 維修) | ✓ M-R-2 已做 | — |
| 矩陣 (occupancy 床位 × 月份) | ✗ | ✓ |
| P&L 報表 | ? | ✓ (但建議 ≤600 也橫向 scroll) |
| inline 小表格 (退租前 invoice 列表) | ✗ (在 modal 內) | ✓ 改 stack |

reports 的 `.report-table / .report-pnl-table` 目前手機行為未檢視，但既然 `:not(.occ-table)` 已套用，會被卡片化 — **P&L 表格卡片化可能不好讀**，要確認。

### 4.4 不一致風險

| 風險 | 描述 | 嚴重度 |
|---|---|---|
| sticky cell 背景沒走變數 | `#f1f3f5 / #f8f9fa / #fafbfa` 散落，未來改 brand 色不會跟 | Medium |
| inline `<table>` 沒掛 class | unsettled 的 dry-run preview 表、tenants 入住紀錄表 — 在手機上沒卡片化 | High (手機會擠) |
| `.report-pnl-table` 卡片化是否壞 P&L 閱讀 | 未驗證 | Medium |
| `.occ-table` 在 768px 寬螢幕的 sticky 左欄 (56 + 96 = 152px) 吃掉 39% 寬度 | 月份欄只剩 60% 可視，每格 68px → 約只看 3.5 個月 | Low |

### 4.5 建議

**A. 把 inline `<table>` 統一改用 `.data-table.is-compact`** modifier，套用同一套卡片化規則。
**B. sticky cell 背景全部走變數**：定義 `--occ-sticky-bg-default / --occ-sticky-bg-vacant / --occ-sticky-bg-terminated / --occ-sticky-bg-stripe-b`。
**C. P&L 表格驗證**：用真實 P&L 表格在 360px 寬看，若卡片化 column 太多會擠 → 改 `<table class="data-table report-pnl-table">` + 對 `.report-pnl-table` 加 `:not()` exclude，改成「橫向 scroll」。

---

## 5. iOS 鍵盤 + scroll 行為

### 5.1 現有實作 (`js/utils/ui.js:89-116`)

```js
function attachKeyboardAdjustment(overlay) {
    if (!window.visualViewport) return;
    const content = overlay.querySelector('.modal-content');
    if (!content) return;
    const onResize = () => {
        ...
        if (window.innerWidth > 600) { content.style.maxHeight = ''; return; }
        const vv = window.visualViewport;
        content.style.maxHeight = `${vv.height}px`;
        content.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    window.visualViewport.addEventListener('resize', onResize);
    window.visualViewport.addEventListener('scroll', onResize);
    requestAnimationFrame(onResize);
}
```

### 5.2 根因分析

**用戶說「鍵盤上推容器，input 跑到 viewport 外」** — 4 個根因疊加：

1. **`.modal-content` 是 `align-items: flex-end` bottom-sheet** (`5188`)。鍵盤彈起時 `visualViewport.height` 縮小，`maxHeight` 跟著縮、`transform: translateY(vv.offsetTop)` 把 sheet 往上推。但 **`vv.offsetTop` 在 iOS 通常是 0**（鍵盤是「下方蓋上來」不是「viewport 上移」），所以 sheet 沒被推上去，反而被裁切。
2. **`.modal-body` 有 `overflow-y: auto`** (`4127`)。鍵盤彈起時 `maxHeight` 縮，但 modal-body 內 focused input 的捲動位置 **不會自動跟著**。瀏覽器原生會嘗試 `scrollIntoView`，但因為 modal-body 是內部 scroll 容器（不是 root scroll），iOS Safari 的自動 scroll 偶爾失效。
3. **`100vh` 概念在 iOS Safari 等於 large viewport** (含 URL bar)。`max-height: 85vh` 桌面寫死 (`4020`)，bottom-sheet 改成 `95vh`，但這個 vh 是 **large vv，不是 small vv**，鍵盤彈起算 small vv → 還是會被裁切。
4. **transform 推 sheet 上去後，modal 外部的 overlay 不變大**，導致 sheet 被截在 visualViewport 上方。

### 5.3 跨瀏覽器一致性

| 瀏覽器 | visualViewport.offsetTop | visualViewport.height | 行為 |
|---|---|---|---|
| iOS Safari 17 | 0 (鍵盤覆蓋) | 縮小 | 現有 transform 沒推上去 |
| Android Chrome | 也 0 但 layout viewport 會跟著縮 | 縮小 | 通常 input 已自動 scroll 進視野 |
| iPadOS Safari | 不一定 | 縮小 | 同 iOS |

### 5.4 建議修法

**多層保險**：

**A. modal-content 用 `100dvh` (dynamic vh) 取代 `vh`** (現代瀏覽器原生跟 visualViewport 連動)：
```css
@media (max-width: 600px) {
    .modal-content {
        max-height: 95dvh; /* 不是 95vh */
    }
}
```

**B. focus 時主動把 input scrollIntoView**（補在 `openFormModal` onMount 內）：
```js
form.addEventListener('focusin', (e) => {
    const el = e.target.closest('input, textarea, .custom-select-trigger');
    if (!el) return;
    // delay 一個 tick，等鍵盤動畫
    setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 350);
});
```

**C. 用 `interactive-widget=resizes-content` 在 meta viewport**：
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
```
iOS Safari 16.4+ / Chrome 108+ 支援。這個告訴瀏覽器鍵盤彈起時 viewport 要縮，不是用 inset 蓋。

**D. modal-footer 在鍵盤彈起時自動隱藏** (避免擋 input)：
```js
const isKeyboard = window.visualViewport.height < window.innerHeight * 0.75;
overlay.querySelector('.modal-footer').style.display = isKeyboard ? 'none' : '';
```

**E. 取消現有的 `transform: translateY(vv.offsetTop)`**：在 iOS Safari 上幾乎都是 0，沒用，反而會讓 sheet 偏移。

---

## 6. 跨頁面實作建議 (Priority)

### P0 (用戶會立刻看出，當週修)

| # | 建議 | 涉及檔案 | 工作量 |
|---|---|---|---|
| P0-1 | `form-grid` 斷點 640 → 768，並強制 `[style*="grid-column"]` 在手機重置 | `css/style.css:4898` | 10 分 |
| P0-2 | `unsettled.js:174,182` 拿掉 inline `flex-wrap: wrap`，吃共用規則 | `unsettled.js` | 5 分 |
| P0-3 | iOS 鍵盤 — 改 `100dvh` + 加 `focusin → scrollIntoView` | `css/style.css:5193` + `ui.js:89` | 30 分 |
| P0-4 | occ-table sticky 左欄背景 vacant/terminated/stripe-b 走變數，不寫死 hex | `css/style.css:6085-6096` | 15 分 |
| P0-5 | `metrics-grid` 手機改 2x2 grid (取消橫向 snap)，跟 stat-tile-grid 對齊 | `css/style.css:5291-5308` | 10 分 |

### P1 (細節)

| # | 建議 | 涉及檔案 |
|---|---|---|
| P1-1 | 統一所有 modal 「收錢類」欄位順序 (finance + unsettled 共用 `buildInvoiceFields(direction)`) | `finance.js:267` + `unsettled.js:390` |
| P1-2 | `.modal-subtitle` 寫進桌面 CSS，移除 `properties.js:538` inline style | `css/style.css` + `properties.js` |
| P1-3 | `.finance-sub-tabs` 加 ≤640 橫向 scroll | `css/style.css:2862` |
| P1-4 | `.bldg-subtab` 補 ≤768 觸控目標 ≥44px | `css/style.css:5255` |
| P1-5 | occupancy `.occ-tab` active 樣式改柔 (跟 `.bldg-subtab` 對齊)：`light + 橘字`，不用橘漸層 | `css/style.css:1353-1358` |

### P2 (未來重構)

| # | 建議 |
|---|---|
| P2-1 | 制定「Segmented Control」設計 token，6 套 filter 全部 alias 到同一條 base rule，差異只用 modifier |
| P2-2 | 全 `stat-tile` 化，廢除 `.metric-card`；加 `.stat-tile--link` 給 dashboard 用 |
| P2-3 | `openFormModal` 加 `layout: 'stacked' | 'pairs' | 'wide-sections'` preset，廢除 freestyle `span: 2` |
| P2-4 | reports 內 `.report-pnl-table` 驗證手機卡片化是否仍可讀，若否則 exclude |
| P2-5 | 把 inline `<table>` (退租 preview / 入住紀錄) 改掛 `.data-table.is-compact`，吃卡片化 |

---

## 7. Quick wins (5 個能在 30 分內動完)

### QW-1 (3 分)：unsettled filter 列吃共用規則

```diff
- <div class="filter-tabs mb-2" style="flex-wrap: wrap;">
+ <div class="filter-tabs mb-2">
- <div class="filter-tabs mb-4" style="flex-wrap: wrap;">
+ <div class="filter-tabs mb-4">
```
檔案：`js/views/unsettled.js:174, 182`

### QW-2 (3 分)：form-grid 手機斷點放寬

```diff
- @media (max-width: 640px) {
-     .form-grid { grid-template-columns: 1fr; }
- }
+ @media (max-width: 768px) {
+     .form-grid { grid-template-columns: 1fr; }
+     /* 避免 span:2 在單欄時造成偏排 */
+     .form-grid > .form-group[style*="grid-column"] {
+         grid-column: 1 / -1 !important;
+     }
+ }
```
檔案：`css/style.css:4898`

### QW-3 (5 分)：用 dvh 修 iOS 鍵盤

```diff
@media (max-width: 600px) {
    .modal-content {
        max-width: 100% !important;
        width: 100%;
-       max-height: 95vh;
+       max-height: 95dvh;
        ...
    }
}
```
檔案：`css/style.css:5193`
順便把 `js/utils/ui.js:109` 的 `content.style.transform = ...` 拿掉 — iOS 沒用反而偏移。

### QW-4 (5 分)：metric-card 手機回到 grid

```diff
@media (max-width: 768px) {
    .metrics-grid {
-       display: flex;
-       grid-template-columns: none;
+       display: grid;
+       grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
-       overflow-x: auto;
-       overflow-y: hidden;
-       scroll-snap-type: x mandatory;
-       scrollbar-width: none;
-       -webkit-overflow-scrolling: touch;
    }
-   .metrics-grid::-webkit-scrollbar { display: none; }
    .metrics-grid > .metric-card {
-       flex: 0 0 calc(70% - 0.375rem);
-       scroll-snap-align: start;
+       /* 自動 1fr */
    }
}
```
檔案：`css/style.css:5291-5308`

### QW-5 (8 分)：modal-subtitle 寫進 CSS

新增桌面規則：
```css
/* css/style.css，加在 modal-header h3 後面 */
.modal-header .modal-subtitle {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin-top: 0.25rem;
    font-weight: 400;
    line-height: 1.4;
}
.modal-header .modal-subtitle code,
.modal-header .modal-subtitle .mono {
    font-family: 'JetBrains Mono', monospace;
    color: var(--text-secondary);
    font-weight: 600;
    letter-spacing: 0.02em;
}
```
然後在 `js/views/properties.js:538` 拿掉 inline `style.cssText = ...`，HTML 改用 `<span class="mono">`。

---

## 附錄：檔案速查

| 主題 | 關鍵檔案 / 行號 |
|---|---|
| Modal API | `js/utils/ui.js:18,131,509,533` |
| Modal 桌面樣式 | `css/style.css:2936, 4014-4143, 4084-4122, 4876` |
| Modal 手機 bottom-sheet | `css/style.css:5184-5215, 6344-6477` |
| Form Grid | `css/style.css:4887-4902` |
| Filter base | `css/style.css:2607-2695` (canonical) |
| Filter 手機 horizontal scroll | `css/style.css:2656-2672, 5341-5357` |
| Area Filter | `css/style.css:4817-4871` |
| Bldg Subtab | `css/style.css:3351-3388` |
| Occ Tab | `css/style.css:1331-1368, 6163-6175` |
| Finance Sub Tab | `css/style.css:2828-2864, 5328-5338` |
| Settings Tab | `css/style.css:4253-4293, 5235-5246` |
| metric-card | `css/style.css:5291-5324` (手機) |
| stat-tile | `css/style.css:3417-3472` |
| data-table 卡片化 | `css/style.css:6507-6601` |
| occ-table 手機 | `css/style.css:6017-6175` |
| iOS 鍵盤 adjustment | `js/utils/ui.js:87-116` |
| Touch target ≥44px | `css/style.css:5255-5287` |
