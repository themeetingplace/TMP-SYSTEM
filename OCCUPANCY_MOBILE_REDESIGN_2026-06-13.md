# 住房一覽手機版 redesign 建議

> 範圍：`/#occupancy` 在 iPhone 寬度 (~390px) 的 layout
> 對應檔案：`js/views/occupancy.js`、`css/style.css`
> 日期：2026-06-13

---

## 問題盤點

### P1 — 月份 column header 視覺上「看不到」

- **檔案/位置**：`css/style.css:5620-5627`、`js/views/occupancy.js:270-272 + 298-309`
- **根本原因**：
  1. `style.css:5620` 的 sticky thead 規則只覆蓋 `.data-table:not(.occ-table)` — `.occ-table` 被排除掉，**手機橫向捲動往右滑時，thead 一捲就消失**（這是用戶說「不見了」最可能的成因）。
  2. `style.css:5853` mobile 整列 padding 降到 `0.4rem 0.3rem`，加上 `font-size: 0.72rem`、月份格沒 `width` 限制 → fixed layout 把剩餘空間平分給每個月份 cell，header 的 `2026/5` (5 字元) 被擠壓到視覺上幾乎沒存在感。
  3. `js/views/occupancy.js:271` 的 month label 是 `${year}/${month}` (例 `2026/5`)，**這個字串在手機 ~50px 寬欄裡會佔 2 行或被截**，用戶以為是空白。
- **為何 desktop OK**：desktop main-content 寬，`calculateMonthCount` 算出 6+ 月，每月欄 ~55px，`2026/5` 還能塞；且 sticky thead 沒影響（不需要捲就看得到）。

### P2 — 月份格寬度過窄、視覺擁擠

- **檔案/位置**：`css/style.css:1413-1416`、`5851-5857`
- **根本原因**：
  1. `style.css:1414` `table-layout: fixed` + 手機 media query 只設了前 4 欄寬度（60+90+90+48 = 288px），剩下 viewport (~358px - 288px = 70px) 被多個月份欄平分 → 每欄 12-25px **完全擠不下** `5/31到期` 之類字串。
  2. `calculateMonthCount()` (`occupancy.js:29-36`) 用 `main-content.offsetWidth` 算，手機可能算出 4-5 個月，但實際空間只夠 1-2 個月舒適顯示。
  3. cell 內容 = 日期 + badge icon (`✓`/`◐`/`!`) + 偶爾「到期 X/Y」**疊在一個 ~50px 寬格內**，必然爆。

### P3 — 床位 / 房客 / 備註 / 退房 4 欄擠在左半

- **檔案/位置**：`css/style.css:5854-5857`
- **目前**：床位 60px + 房客 90px + 備註 90px + 退房 48px = **288px 已吃掉 viewport 80%**
- **問題**：
  1. 「備註」欄 90px 平常只塞 `+ 編輯` 提示，浪費寬度；有備註時又會 truncate。
  2. 「退房」checkbox 只需要 ~32px，目前 48px 過大但跟備註太靠近視覺上看不出分隔。
  3. 房客名字 90px 對於「林海薇」「Nelson」OK，但對於「italia (預入住)」這種帶 span wrapper 的會擠。

### P4 — sticky 床位欄只 sticky 第 1 欄，房客名字會被捲走

- **檔案/位置**：`css/style.css:5859-5872`
- **問題**：往右滑後只剩 `R1-A` 看得到，**沒有「誰住的」線索**，使用者得滑回最左邊才能比對。手機資料表常見 pattern 是 sticky 「身份識別欄」(床位+名字至少 2 欄)。

### P5 — `.occ-table-wrap::after` 漸層提示 sticky 在 wrap 內，可能定位失效

- **檔案/位置**：`css/style.css:5838-5848`
- **問題**：`position: sticky; right: 0` + `margin-left: -24px` 在 `overflow-x: auto` 的 wrap 上行為不一致（Safari/iOS 尤其），實際測試常常沒出現或位置怪。建議改成 wrap 外層加個 `::after` 用 absolute。
- **非阻塞**：視覺優化，可後做。

---

## 提議 layout

### 設計原則

1. **手機本來就是橫捲表格**，不要妄想塞死；但要把「看哪一格屬於哪個月」這件事變直觀。
2. **左側 sticky 區塊 = 床位 + 房客** 兩欄一起 sticky（身份識別）。備註 / 退房合併進 sticky 區塊或移到 cell 點開後的詳細頁。
3. **月份格寬度給足**（建議 ~64-72px），讓 `5/31 ✓` 一行能放心顯示；月份數量讓用戶捲，不要硬塞。
4. **sticky thead** 讓表頭跟著縱向捲動，月份 header 永遠看得到。
5. **月份 label 改短**：手機把 `2026/5` 縮成 `5月` 或 `5/2026`（兩行：上面大字 `5`、下面小字 `月`），節省橫向。

### ASCII mockup

```
┌──────────────────────────────────────────────────────────────────┐
│ [館 tab horizontal scroll]                                       │
├──────────────────────────────────────────────────────────────────┤
│ ┌───┬──── sticky 區 ────┬─── 橫捲區 ─→─→─→─→─→─→─→─→─→─→─→─→  │
│ │床 │ 房客              │5月  │6月  │7月  │8月  │9月  │10月  │ │  ← sticky thead
│ │位 │                   │     │     │     │     │     │      │ │
│ ├───┼───────────────────┼─────┼─────┼─────┼─────┼─────┼──────┤ │
│ │R1-│ italia            │5/31 │6/30 │     │     │     │      │ │
│ │A  │ +備註             │  ✓  │  !  │     │     │     │      │ │
│ ├───┼───────────────────┼─────┼─────┼─────┼─────┼─────┼──────┤ │
│ │R1-│ Kayla             │5/29 │     │     │     │     │      │ │
│ │D  │ 提早繳清          │ ✓   │ 到期│     │     │     │      │ │
│ │   │                   │     │ 6/5 │     │     │     │      │ │
│ ├───┼───────────────────┼─────┼─────┼─────┼─────┼─────┼──────┤ │
│ │R1-│ 空床              │     │     │     │     │     │      │ │
│ │E  │ [+入住]           │     │     │     │     │     │      │ │
│ └───┴───────────────────┴─────┴─────┴─────┴─────┴─────┴──────┘  │
│  sticky-left 寬度 = 60 + 96 = 156px                              │
│  剩 ~200px viewport 顯示 2-3 個月份格 (×68px)，其餘往右滑       │
└──────────────────────────────────────────────────────────────────┘
```

### 關鍵取捨

| 項目 | 目前 | 新 |
|---|---|---|
| 備註欄獨立 | ✅ 第 3 欄 | ❌ 合進房客 cell（小字第 2 行） |
| 退房 checkbox | ✅ 第 4 欄 | 隱藏到房客 cell 內 long-press / 改點房客名字 → modal 操作；或把整欄寬度縮到 28px 並合到 sticky 區 |
| 月份格寬 | ~12-50px | 68px (固定) |
| 月份 label | `2026/5` | `5月` (今年) / `25/12` (跨年) |
| sticky | 只床位 | 床位 + 房客 + thead |

---

## 具體 CSS 改動

放在現有的 `@media (max-width: 768px)` block (`style.css:5826` 開頭那塊)，**替換** 5851-5872 那段，並新增幾條：

```css
/* ============================================================
 * M-R-3 v3 (2026-06-13): 住房一覽手機版 — 給月份格喘息空間
 * 原則：sticky 左 2 欄 + sticky thead + 月份欄寬度固定 (不再 fixed-layout 平分)
 * ============================================================ */
@media (max-width: 768px) {

    /* --- 1. 表格不再 fixed-layout 平分，改成自然寬 + min-width 撐開橫捲 ---
       fixed-layout 在手機是反效果：剩餘空間平均分給月份格 → 每格 20px 擠死。
       改 auto 後月份格用 colgroup/th 的 min-width 撐開，總寬超過 viewport 就讓 wrap 橫捲。 */
    .data-table.occ-table {
        table-layout: auto;
        width: max-content;       /* 讓表格寬度 = 內容總和，撐出橫捲 */
        min-width: 100%;          /* 內容少時仍滿版 */
    }

    /* --- 2. 整體字級 / padding 比目前再寬鬆一點點，視覺呼吸 --- */
    .occ-table { font-size: 0.75rem; }       /* 比目前 0.72 略大 */
    .occ-table thead th,
    .occ-table tbody td {
        padding: 0.5rem 0.4rem;              /* 比目前 0.4 / 0.3 寬 */
        line-height: 1.3;
    }

    /* --- 3. 固定欄寬度（覆蓋 desktop 的 inline width） --- */
    .occ-table thead th:nth-child(1),
    .occ-table tbody td:nth-child(1) {
        width: 56px !important; min-width: 56px;
    }
    .occ-table thead th:nth-child(2),
    .occ-table tbody td:nth-child(2) {
        width: 96px !important; min-width: 96px;
        text-align: left !important;          /* 房客名字靠左讀感較好 */
        padding-left: 0.55rem;
    }
    .occ-table thead th:nth-child(3),
    .occ-table tbody td:nth-child(3) {
        width: 72px !important; min-width: 72px;   /* 備註欄 — 給 +編輯 / 短備註 */
    }
    .occ-table thead th:nth-child(4),
    .occ-table tbody td:nth-child(4) {
        width: 36px !important; min-width: 36px;   /* checkbox 36px 就夠了 */
        padding: 0.4rem 0.2rem;
    }

    /* --- 4. 月份欄統一寬度（第 5 欄之後）+ 中央對齊 --- */
    .occ-table thead th:nth-child(n+5),
    .occ-table tbody td:nth-child(n+5) {
        width: 68px !important;
        min-width: 68px;
        padding: 0.5rem 0.3rem;
    }

    /* --- 5. sticky 左側「身份識別」雙欄（床位 + 房客） --- */
    .occ-table td:nth-child(1),
    .occ-table th:nth-child(1) {
        position: sticky;
        left: 0;
        z-index: 2;
        background: var(--bg-secondary, #fafbfc);
    }
    .occ-table td:nth-child(2),
    .occ-table th:nth-child(2) {
        position: sticky;
        left: 56px;                            /* = 床位欄 width */
        z-index: 2;
        background: var(--color-surface, #fff);
        /* 房客欄右側陰影 — 讓使用者明確感受到 sticky 邊界 */
        box-shadow: 4px 0 6px -4px rgba(0, 0, 0, 0.10);
    }
    /* thead 對應的 sticky 欄要更高層級（壓過 tbody sticky 第 1 欄） */
    .occ-table thead th:nth-child(1),
    .occ-table thead th:nth-child(2) {
        z-index: 4;
    }
    /* 房間 header row (colspan) 不要被 sticky 影響底色 — 它原本就有 occ-room-header 樣式 */
    .occ-table tr.occ-room-header td { position: static !important; }

    /* --- 6. sticky thead（橫捲時保持月份標題可見） ---
       注意：style.css:5620 的全域規則排除了 occ-table，所以這裡要單獨加。
       top: 0 是相對於 .occ-table-wrap 的（wrap 是 overflow scroll container）。 */
    .occ-table thead th {
        position: sticky;
        top: 0;
        z-index: 3;
        background: var(--bg-secondary, #fafbfc);
    }
    /* sticky thead × sticky 左欄交叉 cell — 必須最高層 */
    .occ-table thead th:nth-child(1),
    .occ-table thead th:nth-child(2) {
        z-index: 5;
    }

    /* --- 7. 月份格內容直立排（日期上面、badge 下面），不再擠在一行 --- */
    .occ-table td.occ-cell {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;    /* 數字等寬，視覺整齊 */
    }
    .occ-table td.occ-end-marker {
        font-size: 0.68rem;
        white-space: normal;                   /* 「到期 6/5」可換行 */
        line-height: 1.25;
    }
    /* badge 改成獨立一行，跟日期分開 — 避免「5/31✓」黏成一團 */
    .occ-table .occ-pay-badge {
        display: inline-block;
        margin-left: 2px;
        font-size: 0.6rem;
    }

    /* --- 8. 房客 cell — 名字 + 備註 兩行堆疊（如果採用「合併備註進房客欄」方案，見 JS 建議 1） --- */
    .occ-table td:nth-child(2) {
        word-break: break-word;
        line-height: 1.3;
    }

    /* --- 9. 退房 checkbox 視覺降權（手機上是次要操作） --- */
    .occ-terminate-check {
        transform: scale(0.9);
        opacity: 0.7;
    }

    /* --- 10. wrap 右側漸層提示 — 改用 wrap 外層 + absolute（原 sticky 方案在 iOS Safari 行為不一） --- */
    .occ-table-wrap {
        position: relative;
        overflow-x: auto !important;
        overflow-y: visible;
        -webkit-overflow-scrolling: touch;
    }
    .occ-table-wrap::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 20px;
        background: linear-gradient(to left, var(--color-surface, #fff) 0%, transparent 100%);
        pointer-events: none;
        opacity: 0.8;
    }
}
```

> **重要**：上面 block 整段要**取代** `style.css:5830-5884` 那一整塊現有的 `@media (max-width: 768px) { .occ-table-wrap { ... } ... }`，不是疊加。`.occ-tabs` 那段 (5874-5883) 要保留搬過來。

---

## 具體 JS / HTML 結構建議

### 建議 1（小幅 — 推薦先做）：縮短月份 label

`js/views/occupancy.js:42-49` `buildMonths` 改：

```js
months.push({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    label: `${d.getFullYear()}/${d.getMonth() + 1}`,
    shortLabel: `${d.getMonth() + 1}月`,        // 新增
    isCurrent: ...
});
```

`occupancy.js:270-272` thead 改：

```js
const monthHeader = months.map(m =>
    `<th class="${m.isCurrent ? 'occ-this-month-header' : ''}">
        <span class="occ-month-full">${m.label}</span>
        <span class="occ-month-short">${m.shortLabel}</span>
    </th>`
).join('');
```

對應 CSS（global，非 media）：

```css
.occ-month-short { display: none; }
@media (max-width: 768px) {
    .occ-month-full { display: none; }
    .occ-month-short { display: inline; font-weight: 600; }
}
```

### 建議 2（中幅 — 可選）：手機 viewport 強制月份數上限

`js/views/occupancy.js:29-36` `calculateMonthCount` 加入手機邏輯：

```js
function calculateMonthCount() {
    const main = document.querySelector('.main-content');
    const availableArea = main?.offsetWidth || window.innerWidth;
    // 手機 (≤768px) 強制顯示 6 個月（讓使用者橫向捲動發現未來月份）
    // 不依賴可視寬度 — 因為手機本來就是橫捲表格
    if (window.innerWidth <= 768) {
        return 6;
    }
    const space = Math.max(300, availableArea - FIXED_COLS - CARD_PADDING);
    return Math.max(4, Math.min(MAX_MONTHS, Math.floor(space / COL_WIDTH)));
}
```

### 建議 3（大幅 — 不建議，作為備案）：手機合併「備註」進「房客」欄

把第 3 欄 (備註) 移除，把備註文字當作房客 cell 的第 2 行：

- 好處：少一欄 → 月份格多 ~72px 空間。
- 壞處：要改 `renderContractRow` (`occupancy.js:136-184`)、`renderVacantRow` (`occupancy.js:187-202`)、`occ-room-header td colspan` (`occupancy.js:251` 從 `colCount` 算式 `4 + months.length` 變 `3 + months.length`)、helper 模式的 `nth-child(4)` rule (`style.css:2676`) 全部要連動改。
- **建議用「CSS hide 備註欄」**取代結構改動，留住單一 HTML：

```css
@media (max-width: 768px) {
    .occ-table thead th:nth-child(3),
    .occ-table tbody td:nth-child(3) { display: none; }
    /* 並把房客欄加寬到 130-140px 補回備註空間，或讓使用者進房客 modal 編備註 */
}
```

> 不採用建議 3 也 OK，建議 1+2+前述 CSS 就能解九成痛點。

---

## 影響範圍 + 風險

### 不會影響 desktop

- 所有改動包在 `@media (max-width: 768px)` 內
- `table-layout: auto` 只在 mobile 套用，desktop 保留 `fixed`
- sticky thead 只在 mobile 加（desktop 本來就被 `:not(.occ-table)` 排除，行為不變）

### 風險清單

1. **sticky 雙欄在 iOS Safari 16 以前**有過 layout shift bug — 測 iPhone 真機需確認。fallback 是只保留 sticky 第 1 欄。
2. **`width: max-content` + `min-width: 100%`** 組合在表格 cell 數量極少時（例如只有 1 個月份格）會留白，但實際 monthCount 最少 4-6，不會踩到。
3. **helper 模式**：`style.css:2676-2678` 隱藏第 4 欄（退房）— 用 `nth-child(4)` 仍然命中，不受影響。但要驗證 helper 模式手機版第 4 欄消失後 sticky 邏輯仍正確（sticky 用的是 nth-child(1)(2)，第 4 欄消失不影響 sticky）。
4. **`.occ-table-wrap::after` 改 absolute 後**，wrap 必須有 `position: relative`（規則裡有加）。若 wrap 本身被父容器 `overflow: hidden` 切到，漸層可能跑掉。

### 建議測試場景

| 場景 | 驗證點 |
|---|---|
| iPhone 390px viewport | 月份 header「5月 6月…」可見；捲動 thead 跟著 |
| 同上 + 橫捲到底 | sticky 床位+房客欄留在左側，月份格不重疊 |
| helper 角色登入手機 | 第 4 欄 (退房) 不見、布局不破 |
| 沒有任何合約的空館 | 表格仍顯示 thead，月份 header 可見 |
| 跨年月份 (12月→1月) | `shortLabel` 為 `12月` `1月`，視覺一致（若擔心歧義可改 `12月` `26/1`） |
| 房客名字超長（如 `Vorabhongse Phuc`） | sticky 房客欄 96px 內換行不破版 |
| 折疊側欄 → 展開 | resize listener (`occupancy.js:581`) 觸發 re-render，monthCount 重算 |
| 同房 2 床都「續租 + 接續合約」雙列 | sticky 第 2 欄 (房客) z-index 正確，不會被 row stripe 蓋 |

---

## 不要動的東西 (lock-down)

- `--text-*`, `--color-*`, `--bg-*` token — **完全不動**
- helper 模式相關規則 (`style.css:2671-2684`) — 保留 `nth-child(4)` 命中邏輯不變
- desktop 矩陣表 (`@media min-width: 769px` 也就是預設) 的 `colgroup` / inline width 寫法、`table-layout: fixed` — 不動
- 「+ 入住」按鈕 `.occ-checkin-btn` 視覺樣式（橘綠配色 + token）— 不動
- 月份格底色、`occ-this-month` / `occ-today` / `occ-past` / `occ-future` 顏色語意 — **完全不動**
- `.occ-mobile-nav`（三層導航備案）相關 CSS `display: none` 保留 — 用戶要求保留矩陣表，這套留著當未來「切顯示模式」備案
- `data-action="show-tenant"` / `data-action="edit-note"` 等事件委派 — 不動

---

## 實作優先序建議

1. **P0**：替換 `style.css:5830-5884` 整塊 mobile media query（上面那段 CSS）→ 解 P1 P2 P3 P4
2. **P1**：建議 1（短月份 label）→ 視覺最後一里
3. **P2**：建議 2（手機 monthCount 上限）→ 一致性
4. **P3（可不做）**：建議 3 隱藏備註欄 / `::after` 漸層位置調整

完成 P0 即可解掉用戶截圖看到的所有問題。
