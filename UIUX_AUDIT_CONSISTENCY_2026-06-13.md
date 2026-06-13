# 聚空間 PMS — 視覺一致性 Audit (2026-06-13)

> Auditor: Senior UI/UX Designer (design-system review)
> Scope: 整個前端 (`index.html` + `css/style.css` + `js/views/*`)
> 方法：靜態檔比對，不執行專案、不改任何 code。
> 觸發：用戶反映「報表折線圖跟首頁 Dashboard 曲線圖風格差很多」。

---

## TL;DR

聚空間 PMS 的設計 token (色彩變數 / 字級階梯 / 圓角 / 陰影) 在 `:root` 已經定義得很乾淨，**問題不在 token 本身**，而是在**有沒有走 token**。最痛的是「**圖表渲染分裂**」(Critical)：dashboard 用 Chart.js (smooth curve, fill, 軟 grid)，reports 用手寫 SVG (grouped bar + polyline + pie，硬色碼、不同 grid 灰階、white-fill dot)，連 css 變數都沒走 — 兩頁擺在一起像兩套系統。其次是 **inline style 硬色碼遍佈** (16+ 處 `#16a34a / #dc2626 / #cbd5e1 / #6b7280 / #22946e / #b13535`)，與 `--color-success / --color-danger / --text-muted` 應該完全等價但沒走變數。第三是 **font-size 0.6~0.8rem 亂數**：明明 `:root` 有定義 `--text-2xs ~ --text-3xl` 9 級階梯，但 view 裡照樣寫 `0.65 / 0.68 / 0.7 / 0.72 / 0.75 / 0.78 / 0.8 / 0.82 / 0.85 / 0.88rem` (10+ 個值)，閱讀層級含糊。整體嚴重度：**Critical (圖表) > High (色彩 token) > Medium (字級) > Low (互動)**。

對用戶當下問題的最終建議：**走 A 路 — 把 reports 三個 SVG 圖表改用 Chart.js 重畫**，理由與步驟見第 6 節。

---

## 1. 圖表渲染分裂 (Critical)

### 1.1 全系統圖表用了 5 種完全不同的渲染方式

| # | 用在哪 | 渲染方式 | 範例 file:line |
|---|---|---|---|
| A | Dashboard 收支趨勢 (折線圖) | **Chart.js `type: 'line'`** | `js/views/dashboard.js:428-453` |
| B | Dashboard 各館空床 (圓環圖) | **Chart.js `type: 'doughnut'`** | `js/views/dashboard.js:523-552` |
| C | Reports Tab1/3 月度趨勢 (grouped bar) | **手寫 SVG** | `js/views/reports.js:165-220` (`renderTrendChart`) |
| D | Reports Tab2 入住/退租 (雙折線) | **手寫 SVG polyline** | `js/views/reports.js:602-642` (`renderMoveInOutChart`) |
| E | Reports Tab3 支出結構 (圓餅) | **手寫 SVG arcPath** | `js/views/reports.js:716-748` (`renderExpensePie`) |
| F | Reports Tab1 各館應收 vs 已收 | **純 div + CSS bar (.stacked-bar-*)** | `js/views/reports.js:132-162` |
| G | Reports Tab2 出租率橫條 | **純 div + CSS bar (.bar-chart-*)** | `js/views/reports.js:581-599` |
| H | Finance 「各館收支」 | **純 div + CSS bar (.bf-* / .bf-bar)** | `css/style.css:4668-4724` |
| I | Reports Tab3 Pareto Tile | **純 CSS flex tile** | `css/style.css:3644-3695` |

**這已經不是「分裂」，是 9 種圖表表現方式各自為政。**

### 1.2 同樣是「折線/條形圖」，配色 + 風格實質差異

| 項目 | Dashboard (A, Chart.js) | Reports 月度趨勢 (C, SVG bar) | Reports 入住/退租 (D, SVG line) |
|---|---|---|---|
| 圖表型態 | line + smooth (`tension: 0.4`) + fill 半透明背景 | grouped bar (2 bars per month) | polyline 直線 (沒 tension) |
| 線寬 | `borderWidth: 2` | 沒線 (是 bar) | `stroke-width="2"` |
| Dot | Chart.js 預設 (小實心圓) | 無 | `r="3.5" fill="white" stroke="${color}"` (空心圓 stroke) |
| Grid 顏色 | `rgba(0, 0, 0, 0.05)` (Chart.js scale) | 底線 `#cbd5e1` + 內線 `#eef0f3` + dashed | 底線 `#cbd5e1` + 內線 `#e5e7eb` + dashed |
| Grid 軸文字 | Chart.js 預設灰 | `#9ca3af` (Inter font) | `#6b7280` (Inter font) |
| X 軸標籤色 | Chart.js 預設 | `#6b7280` | `#6b7280` |
| Y 軸 tick 格式 | `$1,234` (千分位) | `$1.2k / $1.5M` (`formatYAxis`) | `整數` (床位數) |
| 色票 (收/支或入/退) | `#22946e` / `#b13535` (走 hex，不走 `--color-success/danger`) | 同 (`#22946e`/`#b13535` 寫死) | 同 (`#22946e`/`#b13535` 寫死) |
| Hover | Chart.js tooltip (黑底白字 + 自訂 callback) | 自己寫 `.chart-tooltip` (`css/style.css:3588-3627`) | **無 hover** (純靜態 SVG) |
| Y 軸起點 | Chart.js (`beginAtZero` 隨模式變) | `niceCeil()` 漂亮取整 | `niceCeil()` 漂亮取整 |
| 字體 | Chart.js 預設 sans-serif | `font-family="Inter, system-ui, sans-serif"` (覆寫成 Inter) | 同 |
| Legend | Chart.js 內建 (`position: 'top'`) | 自己寫 `.trend-chart-legend`，dot 是寫死 hex 的小方塊 | 同 |

**最違和 3 個點**：
1. Dashboard 是 smooth curve + 半透明 fill，**視覺很「柔」**；reports 用直線 polyline + 空心圓 dot，**視覺很「工程圖」** — 用戶感受是「同一個老闆兩個工程師寫的」。
2. Grid 顏色 dashboard 用 `rgba(0,0,0,0.05)` (近乎隱形)，reports 用 `#cbd5e1` (= rgba(15,23,42,0.27))，**亮度差 5 倍**，reports 圖表看起來「網格很重」。
3. **顏色都沒走 CSS 變數** — `--color-success = #22946e`, `--color-danger = #b13535` 跟 chart 裡 hex 完全一樣，但全部 hardcode。

### 1.3 圖表 tooltip 有 1.5 套
- Chart.js 內建 tooltip (dashboard)
- 自己寫的 `.chart-tooltip` (`css/style.css:3588`)，給 reports bar/pie hover 用，黑底白字 + `chart-tip-row/key/val/net`
  - tooltip 內顏色又是 hex hardcode：`#22946e / #b13535`，見 `reports.js:1042-1044`
- reports 的折線圖 (D `renderMoveInOutChart`) **完全沒 tooltip**，dot 上面寫死字 (`fill="${color}" font-weight="700"` 數字 label) 取代 hover — 跟 bar 圖內外互動也不一致。

### 1.4 建議方向 (詳見第 6 節)
建議 **全 Chart.js 化** (A 路)：
- 統一渲染引擎 → 統一 hover / responsive / accessibility / 動畫。
- 色票改走 CSS 變數讀進 JS：`getComputedStyle(document.documentElement).getPropertyValue('--color-success')`。
- 留下「純 div bar」(F, G, H) — 這些是 KPI/排行類，本來就不是圖表，留著沒問題。
- 留下 Pareto Tile (I) — 這是設計性的視覺，非圖表。

---

## 2. 色彩 token 一致性

### 2.1 `:root` token 是健全的 (`css/style.css:1-93`)
- Brand: `--color-primary #ff8859` (+ hover / light / text / text-strong)
- Semantic: `--color-success #22946e`, `--color-warning #b8871f` (+ warning-text 加深版), `--color-danger #b13535`, `--color-info #1e56a3`
- Surface: `--color-surface`, `--surface-warm`, `--surface-sunken`, `--bg-secondary`, `--bg-tertiary`
- Text: `--text-main`, `--text-muted`, `--text-secondary`, `--text-inverse`
- Border: `--border-color`, `--border-strong`, `--border-soft`
- Shadow: `--shadow-sm/md/lg/hover/focus`，加 `--focus-ring` `--focus-outline`

這套已經涵蓋 90% 場景，問題是 **view 沒去用**。

### 2.2 inline style 硬色碼 — 應走 token 卻沒走

| File:Line | 硬色碼 | 對應 token | 嚴重度 |
|---|---|---|---|
| `dashboard.js:382, 388, 391, 392` | `#22946e` `rgba(34,148,110,0.1)` `#b13535` `rgba(177,53,53,0.08)` | `--color-success` / `--color-success-light` / `--color-danger` / `--color-danger-light` | High (chart 主色) |
| `dashboard.js:338` | `BUILDING_COLOR_PALETTE = ['#ff8859', '#1e56a3', '#22946e', '#b8871f', '#7c3aed', '#0891b2', '#db2777']` | 前 4 個是 `--color-primary/info/success/warning`，後 3 個是新的紫青粉 | High (應該抽成 `--chart-palette-*`) |
| `dashboard.js:529` | `backgroundColor: ['#22946e', '#ff8859']` | `--color-success`, `--color-primary` | High |
| `reports.js:187, 190, 203, 209-210, 214-215, 617-618, 622-624, 626, 631-632, 636-637, 1042-1044` | `#cbd5e1` `#eef0f3` `#9ca3af` `#6b7280` `#22946e` `#b13535` `#e5e7eb` `white` | 應走 `--border-color` / `--text-muted` / `--color-success` / `--color-danger` 等 | **Critical** (這就是用戶看到的不一致來源) |
| `reports.js:696-705` | `PIE_COLORS = ['#ff8859', '#3f7c8a', '#d4a574', '#7a9a6a', '#b67d7d', '#9c8aaa', '#c4a486', '#7a7c80']` | 暖系設計師色盤，token 沒對應 | Medium (建議抽成 `--chart-pie-*` 或留 PIE_COLORS const 即可，但要跟 `BUILDING_COLOR_PALETTE` 整併) |
| `finance-export.js:54, 64, 231, 236, 241, 273-275` `analysis-export.js:81-162, 268-278` `report-export.js:107, 246` | `#16a34a` `#dc2626` `#f59e0b` `#94a3b8` `#64748b` `#0f172a` `#cbd5e1` | 整套用 Tailwind 預設色階！跟 `:root` 的暖色 brand (`#22946e/#b13535/#b8871f`) **完全不同色相** | Medium (PDF export 不會直接影響螢幕 UI，但離開 design system) |
| `contracts.js:202` | `#06c755` (LINE 綠) | brand 色，可保留但建議加 `--color-line-brand` | Low |
| `properties.js:798` | `var(--color-surface, #fff)` fallback | 沒問題，提一下這個寫法很乾淨可作為模範 | — |

**洞察**：`*-export.js` 三檔用的是 **Tailwind 預設綠 #16a34a / 紅 #dc2626**，跟主 UI 的暖系綠 `#22946e` / 暖系紅 `#b13535` **是兩套完全不同的色系**。雖然這些是 PDF 預覽，但用戶從 UI 切到 PDF 預覽會感覺「換了一個 app」。

### 2.3 圖表色票應該抽成一組 token
建議新增：

```css
:root {
    /* Chart palette */
    --chart-income: var(--color-success);        /* #22946e */
    --chart-expense: var(--color-danger);        /* #b13535 */
    --chart-grid: rgba(15, 23, 42, 0.06);        /* 統一 grid 灰 — 介於 dashboard 0.05 跟 reports #cbd5e1 之間 */
    --chart-axis-text: var(--text-muted);        /* #6b7280 */
    --chart-fill-income: rgba(34, 148, 110, 0.10);
    --chart-fill-expense: rgba(177, 53, 53, 0.08);

    /* 多館 / 分類用 categorical palette (取代 BUILDING_COLOR_PALETTE 跟 PIE_COLORS) */
    --chart-cat-1: #ff8859;  /* brand */
    --chart-cat-2: #3f7c8a;
    --chart-cat-3: #d4a574;
    --chart-cat-4: #7a9a6a;
    --chart-cat-5: #b67d7d;
    --chart-cat-6: #9c8aaa;
    --chart-cat-7: #c4a486;
    --chart-cat-8: #7a7c80;
}
```

之後 dashboard 跟 reports 共用：`getComputedStyle(document.documentElement).getPropertyValue('--chart-income')`。

---

## 3. 字體 / 排版層級

### 3.1 `:root` 已經有 9 級字級階梯 (`css/style.css:60-68`)

```
--text-2xs: 0.6875rem   11px
--text-xs:  0.75rem     12px
--text-sm:  0.8125rem   13px
--text-base:0.875rem    14px
--text-md:  1rem        16px
--text-lg:  1.125rem    18px
--text-xl:  1.375rem    22px
--text-2xl: 1.75rem     28px
--text-3xl: 2.25rem     36px
```

註解寫得很明白：「別再混 0.6rem / 0.65rem / 0.68rem 等奇怪數字」 — 但實際上違規處處可見。

### 3.2 view 裡 inline `font-size` 直接寫 rem，沒走 token

抽樣統計 (`Grep "font-size: 0\.\d+rem"`)：
- `reports.js`: 5 處用 `0.72 / 0.85 rem`
- `finance.js`: 16 處用 `0.68 / 0.7 / 0.72 / 0.75 / 0.78 / 0.8 / 0.875 rem`
- `dashboard.js`: 11 處用 `0.7 / 0.75 / 0.8 / 0.95 rem`
- `unsettled.js`: 25 處用 `0.625 / 0.7 / 0.72 / 0.75 / 0.8 / 0.875 rem`
- `contracts.js`: 24 處用 `0.68 / 0.7 / 0.72 / 0.75 / 0.8 / 0.875 rem`

**至少 10 個不同 font-size 值**，token 階梯定義的「7 個一般尺寸」根本沒用上。

### 3.3 標題尺寸 — `.card-title` 被 3 次覆寫

CSS 本身就矛盾：
- `style.css:2289` `.card-title { font-size: 0.9375rem; }` (15px)
- `style.css:5330-5337` QW 補丁：`.card-title { font-size: 1rem !important; }` (16px, 含 mobile 0.95rem 補丁)
- `style.css:6590-6594` 又有 `.card-title { white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }` (不只大小，連 truncate 都加上去)

**3 個地方 + 2 個 !important** — 後人再寫 .card-title 會踩到 specificity 地雷。建議合併到 :root 字級階梯：

```css
.card-title {
    font-size: var(--text-md);   /* 1rem = 16px */
    font-weight: 600;
    /* ...其他 */
}
```

### 3.4 同義角色用了不同 class — 「卡片標題」有 5 種寫法

| Class | 用途 | 範例 |
|---|---|---|
| `.card-title` | dashboard / finance / unsettled / contracts / tenants / maintenance / properties 的卡片 h2 | 全系統 30+ 處 |
| `.report-chart-title` (`css/style.css:3905`) | reports 的圖表卡標題 | `font-size: 0.86rem`，不走階梯 |
| `.io-card-title` (`css/style.css:3409`) | reports 的「收入 vs 支出」對照卡 | `font-size: 0.72rem`，eyebrow 風 (uppercase) |
| `.bldg-hero-info h2` (`css/style.css:3312`) | reports 單館 hero | `font-size: 1.25rem` |
| `.stat-tile-label` (`css/style.css:3348`) | reports stat tile 上方小標 | `font-size: 0.72rem` (eyebrow 風) |
| `.omn-card-title` (`css/style.css:6061`) | properties 入住矩陣的卡片 | font-size 沒查到 (繼承?) |

**6 種不同尺寸**：1.25rem / 1rem / 0.9375rem / 0.86rem / 0.72rem (×2) — 各頁面點進去視覺「重量」完全不同。

### 3.5 表格 / 卡片 padding outlier

`.report-table` (`css/style.css:3856-3878`) 用 `padding: 0.55rem 0.7rem` (header) / `0.6rem 0.7rem` (td)
`.data-table` (`css/style.css:2470-2503`) 用 `padding: 0.75rem 1rem` (header) / `0.875rem 1rem` (td)

兩套表格 padding 差約 30%。reports 看起來「密」、finance/contracts 看起來「鬆」。建議統一或明確分 `compact / regular` 兩套。

---

## 4. 互動模式

### 4.1 篩選列 — 全系統其實只有 1 套 `.filter-tab`，但用法分裂

- `.filter-tabs` + `.filter-tab` (`css/style.css:2561-2618`)
  - finance.js (`L199-203`), unsettled.js (`L174-187`), contracts.js (`L297-316`), maintenance.js (`L96-100`), tenants.js (`L108-112`), properties.js (`L222-226`)
  - 統一好，這是亮點。
- `.filter-chip` (`css/style.css:2704-2739`) — 只 tenants.js (`L115-117`) 用，且只 1 個 chip (LINE unbound)。
  - 設計目的：「次要 toggle filter」，但目前生態只有 1 處實作，會被當成孤兒。
- `.bldg-subtab` (`css/style.css:3269-3296`) — reports 各館切換用
  - **完全自成一套**，不沿用 `.filter-tab`。視覺差異：圓角 `8px` (vs filter-tab `6px`)，active 是 `rgba(255,136,89,0.12) + 邊框` (vs filter-tab `bg: var(--color-surface) + box-shadow`)
- `.chart-mode-toggle` + `.chart-mode-btn` (`css/style.css:4630-4659`) — dashboard 「總和/各館」切換
  - 跟 `.filter-tab` 視覺**幾乎一樣** (segmented control 底色 + active 白底)，但用獨立 class。
- `.adj-kind-toggle` + `.adj-kind-btn` (`css/style.css:3996-4032`) — modal 裡「折扣/加收」切換
  - 又是一套 segmented control，active 用紅/綠**填色按鈕**，跟其他都不同。
- `.finance-sub-tab` — `renderFinanceSubTabs()` 帳務管理頁的子 tab，又是一套。
- `.property-filter-btn` — `dashboard.js:253` **inline style 一坨**：
  ```js
  style="padding: 0.35rem 0.75rem; font-size: 0.8rem; border: 1px solid var(--border-color); background: none; cursor: pointer; border-radius: var(--radius-md); white-space: nowrap; transition: all var(--transition-fast);"
  ```
  完全 inline，沒進 CSS class — dashboard 各館切換按鈕跟其他切換器都不一樣。

**結論**：「segmented control」這個元件，全系統有 **6 種變體**。多數視覺都很像，但因為 class 不共用，要動就要 6 處改。

### 4.2 hover / active / focus
- `:focus-visible` 已經統一處理 (`css/style.css:112-124`) — 這做得好。
- 但 dashboard inline 寫的 `.property-filter-btn` 沒 hover 樣式 (只 transition: all 但沒 :hover 宣告)，鍵盤 focus 就完全靠 `:focus-visible` fallback。
- `.bldg-subtab.is-active` 用 `rgba(255,136,89,0.12)` 軟橘底，但 `.filter-tab.active` 用 `var(--color-surface)` 白底 + `box-shadow` — 兩種 active 視覺語言。建議二擇一。

### 4.3 卡片 hover
- `.card:hover` 統一加 box-shadow (`css/style.css:2282-2287`)
- 但 `.metric-card.metric-link` (`css/style.css:713-738`) 另外有 `::after` 加箭頭 hover → 是好的，因為它有實際導頁。
- `.stat-tile:hover` (`css/style.css:3345-3347`) 是 `background: var(--surface-warm)` (換色) — 跟 `.card:hover` (加陰影) 兩種 hover 語言。
- `.bldg-hero:hover` 沒處理。
- `.connector-card:hover` 是 `background: var(--surface-warm)` (跟 stat-tile 一致)。

reports 頁系統性地用「換 surface-warm 底色」當 hover；其他頁系統性地用「加 shadow」當 hover。**兩個頁面看起來像來自兩個產品**。

---

## 5. 修正路徑 (Priority-ordered)

### P0 — 跨頁面分裂、用戶看得出

#### P0-1. Reports 三個 SVG 圖表全部改用 Chart.js
- **影響檔案**：`js/views/reports.js` (`renderTrendChart` L165-220, `renderMoveInOutChart` L602-642, `renderExpensePie` L716-748)，加 view enter hook 給 Chart.js 銷毀重建。
- **建議改法**：見第 6 節 A 路詳細步驟。
- **預估難度**：M (1~2 個工作日)。
- **理由**：根除「兩套圖表渲染」問題，後續 hover / responsive / a11y 全部統一。

#### P0-2. 抽出 chart palette token
- **影響檔案**：`css/style.css:1-93` 加入 `--chart-income / --chart-expense / --chart-grid / --chart-axis-text / --chart-fill-* / --chart-cat-1~8`；`dashboard.js:338, 382-396, 529`、`reports.js:187-216, 614-637, 696-705, 1042-1044` 改讀 token。
- **預估難度**：S (半天，純機械替換)。
- **理由**：之後改色只改 1 個地方。

#### P0-3. 統一 segmented control class
- **影響檔案**：`css/style.css` 把 `.chart-mode-toggle/.chart-mode-btn` (L4630)、`.adj-kind-toggle/.adj-kind-btn` (L3996)、`.bldg-subtab*` (L3269) 改為共用 `.seg-control` + `.seg-btn` (variant: `--accent / --filter`)；`dashboard.js:253` inline-style `.property-filter-btn` 也回歸這個共用 class。
- **預估難度**：M (1 天，CSS + 6 個 view 替換)。

### P1 — 細節不一致、但能容忍

#### P1-1. inline style 硬色碼掃乾淨 — 走 token
- **影響檔案**：`reports.js` 全部 hex / rgba 改成 `var(--*)`；`dashboard.js` 同上；`*-export.js` 三檔 (Tailwind 色階) 也走 token。
- **預估難度**：S (半天，純機械替換)。
- **理由**：之後改 brand 色只改 :root；目前是「改 brand 要 grep 全專案」的技術債。

#### P1-2. `.card-title` 三次覆寫整併
- **影響檔案**：`css/style.css:2289` 改成 `font-size: var(--text-md)`；L5330 / L6590 兩個 !important 補丁刪掉。
- **預估難度**：S (半小時)。

#### P1-3. 字級階梯落實
- **影響檔案**：所有 view 的 inline `font-size: 0.6X / 0.7X / 0.8X rem` 替換成 `var(--text-2xs / --text-xs / --text-sm)` 或新增 helper class (`.t-2xs / .t-xs / .t-sm` 等)。
- **預估難度**：L (1.5~2 天，要逐處判斷意圖，不能盲改) — 但這是長期 maintainability 投資。
- **建議拆**：先處理 reports + dashboard (高曝光頁)，其他頁慢慢來。

#### P1-4. `.bldg-subtab` / `.filter-tab` 統一 active 樣式
- **影響檔案**：`css/style.css:3290-3294` 跟 L2590-2595，二擇一視覺語言。
- 建議保留 `.filter-tab` (白底 + box-shadow) 風格，因為較中性；`.bldg-subtab` 的橘底較強，**留給單一情境** (例：active 強調)。
- **預估難度**：S。

#### P1-5. reports 卡 hover 跟全站對齊
- **影響檔案**：`.report-chart-card` 加 `:hover` shadow (或全站改成 surface-warm 底色)。
- **預估難度**：S。

### P2 — 技術債、未來重構

#### P2-1. 表格元件分裂
- `.data-table` (主表格) vs `.report-table` (reports 用) — padding 差 30%。
- 建議：定義 `.data-table.is-compact` modifier，reports 用 compact 版本，CSS 共用。
- 難度：M (1 天)。

#### P2-2. PDF export (`*-export.js`) 色系切換到 brand
- 三個 export 檔用了 Tailwind 預設色階 (`#16a34a, #dc2626, #f59e0b, #94a3b8, #64748b, #0f172a, #cbd5e1`)。
- 建議：抽 `pdfPaletteV1` config，跟主 UI 共用同套 hex。
- 難度：S (半天)。
- 注意：PDF 印出來後對比度可能跟 `--color-success` (中飽和暖綠) 不一樣，可能要為 print 另開 token，不要盲改。

#### P2-3. `BUILDING_COLOR_PALETTE` (dashboard) 跟 `PIE_COLORS` (reports) 整併
- dashboard L338 7 色 vs reports L696 8 色，**色相邏輯完全不同**：
  - dashboard 是「brand + semantic + Tailwind 紫青粉」(rgb saturated)
  - reports 是「brand + 設計師暖系地球色」(low-sat earthy)
- 兩個都是「同一張圖各館用不同顏色」，但選色邏輯不一致，**用戶可能在 dashboard 看 B001 是橘色、到 reports 看 B001 是 teal**。
- 建議：抽成 `--chart-cat-1~8`，全系統共用，視 brand 風格定一套。
- 難度：S，但需設計師 review 配色。

#### P2-4. Sidebar nav inline `style="display: none"`
- `index.html:96` admin-users 入口寫 `style="display: none;"`，應該改成 class `.nav-item.is-hidden` + CSS。雖然不影響視覺一致性，但屬於同一類技術債 (markup 裡寫死樣式)。
- 難度：XS。

---

## 6. 對「reports 折線圖對齊 dashboard」的具體建議

這是用戶當下要解的問題。兩條路徑：

### A 路：把 reports 的 SVG 圖表全部換 Chart.js (推薦)

**動到的檔案**：`js/views/reports.js` (主)、`css/style.css` (新增 chart palette token)。

**步驟**：

1. **HTML 改 `<canvas>` 取代 `<svg>`** —
   - `renderTrendChart(months)` (reports.js:165) → 改回傳 `<canvas id="report-trend-chart-${tabKey}"></canvas>`，外面包 `.trend-chart-wrap` 保留高度容器。
   - `renderMoveInOutChart(months, maxVal)` (reports.js:602) → 同樣改 `<canvas>`。
   - `renderExpensePie(items)` (reports.js:716) → 改 `<canvas>` (Chart.js `type: 'doughnut'`)。

2. **新增 chart factory** (在 reports.js 內) —
   ```js
   const chartInstances = {};
   function makeTrendChart(canvasId, months) {
       const ctx = document.getElementById(canvasId);
       if (!ctx) return;
       if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
       const css = getComputedStyle(document.documentElement);
       const incomeColor = css.getPropertyValue('--chart-income').trim() || '#22946e';
       const expenseColor = css.getPropertyValue('--chart-expense').trim() || '#b13535';
       chartInstances[canvasId] = new Chart(ctx, {
           type: 'line',
           data: {
               labels: months.map(m => m.label),
               datasets: [
                   { label: '收入', data: months.map(m => m.income), borderColor: incomeColor, backgroundColor: incomeColor + '1a', borderWidth: 2, tension: 0.4, fill: true },
                   { label: '支出', data: months.map(m => m.expense), borderColor: expenseColor, backgroundColor: expenseColor + '14', borderWidth: 2, tension: 0.4, fill: true }
               ]
           },
           options: { /* 跟 dashboard.js L431-452 同 schema */ }
       });
   }
   ```

3. **改 view enter hook** —
   reports.js 內目前 `renderOverviewTab()` 是回傳 HTML 字串。Chart.js 必須在 DOM 插入後才能 init。需要：
   - 在 reports view 的 `init()` (或 view-container 監聽 hash change 的地方) 加 `setTimeout(() => makeTrendChart(...), 0)`，跟 dashboard 一樣的 pattern。
   - 切 tab / 切 building 時 destroy 舊 instance、重新 make。
   - 已有 `chartInstances` map 處理。

4. **刪掉**：
   - reports.js 內 `niceCeil()` / `formatYAxis()` (Chart.js 自己會處理)
   - `.trend-chart-svg / .trend-chart-legend` 樣式 (Chart.js 內建 legend)
   - 自己的 hover tooltip 處理 (reports.js bar-rect hover 監聽器)，改用 Chart.js tooltip callback

5. **保留** Pareto Tile (`.pareto-tiles`)、stacked bar (`.stacked-bar-*`)、出租率 bar (`.bar-chart-*`) — 這些都不是「圖表」，是 KPI 視覺化，留著。

**動到的程式碼量**：估約 300~400 行 (reports.js: 刪 ~150 行 SVG render + 加 ~150 行 Chart.js factory)。

**好處**：
- 用戶當下問題立刻解決 (兩頁 look 一致)
- 自動拿到 Chart.js 的 hover tooltip、responsive、a11y、動畫
- 之後改色 / 改 grid 只改 :root token

**壞處**：
- 多載一份 Chart.js render lifecycle (但 dashboard 已經載了，沒額外 cost)
- SVG bar chart 比 Chart.js bar chart 細部可調 (例如 grouped bar 的精確 offset)，部分視覺細節要重調

### B 路：保留 SVG，但 token 對齊 Chart.js look

如果不想動架構，最小改動：

1. `reports.js:187` grid 顏色從 `#cbd5e1 / #eef0f3` 全部改成 `rgba(0, 0, 0, 0.05)` (跟 dashboard 一樣)
2. `reports.js:617` 同上
3. `reports.js:190, 203, 618, 626` 軸文字 `fill="#9ca3af"` / `fill="#6b7280"` → 改 `var(--text-muted)` (或 SVG 用 `currentColor` + 外層 `color: var(--text-muted)`，比較 SVG-friendly)
4. `reports.js:602-642` 折線圖加 smooth：把 `polyline points="${points}"` 改成 `path d="${smoothPath(points)}"`，其中 `smoothPath` 用 Catmull-Rom 或 quadratic Bezier 平滑化 (約 30 行 helper)
5. 折線圖加 fill：在 polyline / path 下面多加一個 `path` 帶 `fill-opacity="0.1" fill="${color}"` 模擬 Chart.js fill
6. dot 從 `fill="white" stroke="${color}"` 改成 `fill="${color}"` (跟 Chart.js 預設 dot 一致)
7. font-family 從 `"Inter, system-ui, sans-serif"` 拿掉，繼承 body 字 (跟 dashboard 一致)
8. 顏色 hex 全改 `var(--color-success)` / `var(--color-danger)` (透過 CSS variable 注入 SVG attribute — 可以用 `fill="${getCSSVar('--color-success')}"` JS-side 取，或寫 `style="fill: var(--color-success)"` 在 SVG element 上)

**動到的程式碼量**：約 50~80 行修改。

**好處**：
- 改動量最小
- 不改架構
- 不引入 Chart.js render lifecycle 到 reports

**壞處**：
- hover tooltip 還是要自己寫 (現況已有 `.chart-tooltip`，可繼續用)
- 折線圖 smooth path 計算要自己處理，邊界 case 容易出 bug
- 之後 dashboard 換圖表庫的話兩頁又會分裂
- 雙引擎並存 (Chart.js + SVG) 仍是技術債

### 推薦：A 路

**理由**：
1. dashboard 已經載了 Chart.js，reports 也用 Chart.js **零 cost** (沒新增 dependency)
2. 用戶反映的核心痛 (「線條風格差好大」) **根治** — smooth + fill + tooltip 一次到位
3. 未來再加圖表 (例如「年度同期比較」「現金流預測」) 不用再決定「這個用 Chart.js 還是 SVG」
4. SVG 手寫圖表的 `niceCeil`, `formatYAxis`, hover binding 等 ~150 行邏輯都可以下架
5. B 路的努力只是「讓 SVG 假裝是 Chart.js」，價值有限

**反推 A 路風險**：
- Chart.js 的 grouped bar 群組偏移可能不如手寫精準 → mitigation：Chart.js v4 有 `categoryPercentage / barPercentage` 可調，足夠
- Chart.js 在容器寬度變化時 redraw 需要 `chart.resize()` 觸發 → mitigation：reports view 已經是 hash change 重 render，每次都重 init，沒這個問題

---

## 附錄 A — 關鍵檔案行號對照

| 元素 | 檔案 | 行號 |
|---|---|---|
| 全套 design token | `css/style.css` | 1-93 |
| Chart.js line chart (dashboard) | `js/views/dashboard.js` | 428-453 |
| Chart.js doughnut (dashboard) | `js/views/dashboard.js` | 523-552 |
| BUILDING_COLOR_PALETTE | `js/views/dashboard.js` | 338 |
| SVG grouped bar (reports) | `js/views/reports.js` | 165-220 |
| SVG polyline 折線 (reports) | `js/views/reports.js` | 602-642 |
| SVG pie (reports) | `js/views/reports.js` | 716-748 |
| PIE_COLORS | `js/views/reports.js` | 696-705 |
| `.filter-tab` (主) | `css/style.css` | 2561-2618 |
| `.bldg-subtab` (reports) | `css/style.css` | 3269-3296 |
| `.chart-mode-btn` (dashboard) | `css/style.css` | 4630-4659 |
| `.adj-kind-btn` (modal) | `css/style.css` | 3996-4032 |
| `.chart-tooltip` (reports 用) | `css/style.css` | 3588-3627 |
| `.trend-chart-wrap` / `.trend-chart-legend` | `css/style.css` | 3949-3974 |
| `.card-title` 三個覆寫 | `css/style.css` | 2289, 5330, 6590 |
| `.report-table` (差異化 padding) | `css/style.css` | 3856-3878 |
| `.data-table` (主表格 padding) | `css/style.css` | 2470-2503 |
| Tailwind 色 PDF export | `js/views/finance-export.js` | 54-275 |
| Tailwind 色 PDF export | `js/views/analysis-export.js` | 81-278 |
| Tailwind 色 PDF export | `js/views/report-export.js` | 107, 246 |

---

## 附錄 B — Anti-pattern 速查

### B1. 「inline style 寫一坨外加 transition」(無 hover 規則)
`dashboard.js:253` 的 `.property-filter-btn`：
```js
style="padding: 0.35rem 0.75rem; font-size: 0.8rem; border: 1px solid var(--border-color); background: none; cursor: pointer; border-radius: var(--radius-md); white-space: nowrap; transition: all var(--transition-fast);"
```
**問題**：寫了 transition 但沒 hover / active / focus 規則，等於空轉。建議改 `<button class="property-filter-btn">` + 進 CSS。

### B2. 「!important 修補 !important」
`.card-title` 在 `style.css` 出現 3 次：L2289 (原本)、L5330 (`!important` font-size 補丁)、L6590 (`!important` white-space 補丁)。這代表：
- 寫 L5330 的 commit 撞到了某處 specificity，用 `!important` 推過去
- 寫 L6590 的 commit 又撞到同一個 class，再加 `!important`
- 下一次想動 .card-title 的人會很痛苦

### B3. 「PDF 預覽用 Tailwind 預設色，UI 用 brand 暖色」
這是 `*-export.js` 三檔的共同問題。如果是因為要印出來「PDF 看起來鮮明一點」，那也要明文寫成 `--pdf-color-*` token，不該用 hex 文字。

### B4. 「SVG attribute 用 hex 寫死、不走 CSS variable」
`reports.js` 整個圖表渲染。SVG 是可以走 CSS variable 的 —
```svg
<rect style="fill: var(--color-success)" .../>
<line style="stroke: var(--chart-grid)" .../>
```
這樣切 dark mode 就會自動跟著走，目前 hex 寫死的版本，dark mode 來臨時要全部重寫。

---

## 收尾

主要視覺一致性問題集中在「**有 token、沒用 token**」這一句話。Design system 的骨架 (CSS variables / 字級階梯 / focus ring) 已經很乾淨，但 view 層大量 inline style 跟手寫 SVG 把這些都繞開了。

用戶反映的「折線圖風格差好大」是「圖表渲染分裂」這個系統性問題的可見冰山一角。**根治方向是 A 路 (全 Chart.js)，配合 P0-2 (chart palette token)**。一週工時內可解 P0 三項，把折線圖統一是其中半天的工作。後續 P1 / P2 用平常維護的速率慢慢清，不影響用戶體驗。
