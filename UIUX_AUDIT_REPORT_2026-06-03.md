# 聚空間 BMS — UIUX Audit Report
**日期：** 2026-06-03  
**範圍：** 完整視覺 + 動態效果 audit  
**版本：** v1.1.1 (commit b041e49)  
**生產網址：** https://themeetingplace-bms.netlify.app

---

## Executive Summary

整體已是相當扎實的 admin SaaS：design tokens、focus ring、prefers-reduced-motion、危險操作 undo、Flatpickr 重做、雙行 sidebar footer 都做得到位，視覺語彙統一。

**最大強項：** 資訊密度與可掃描性、a11y 基底、品牌色 + design token 系統  
**最大痛點：**
- **401 處 inline style** 散落各 view，token 旁路率高
- **6 個列表頁的分頁是死按鈕**（pg-wrap 樣式齊全但沒人呼叫）
- **桌面表格在 1366 寬以下橫向溢出**，且無 sticky header
- Chart.js 預設 1 秒動畫拖累每次切換
- Wizard / 表格 CRUD / 數字變動全部零過渡，缺少 feedback

**本次方向：** 把 inline style 收斂回 component class、把假分頁換成真的、補上 a11y 微調與 motion micro-feedback。

---

## 評分總覽

### 視覺設計（1-10）
| 項目 | 分數 |
|---|---|
| 視覺一致性 | 7.5 |
| 資訊密度 | 8.5 |
| 操作流暢度 | 7 |
| 無障礙 (a11y) | 6.5 |
| 品牌呈現 | 8 |

### 動態效果（1-10）
| 項目 | 分數 |
|---|---|
| 動畫一致性 | 5 |
| 動畫流暢度 | 6 |
| 觸覺回饋密度 | 4 |
| prefers-reduced-motion 遵循度 | 9 |
| 品味（不浮誇 / 不延遲使用） | 7 |

---

# Part 1：視覺設計 Audit

## 🔴 Critical（嚴重影響使用 — 必改）

### C-1：6 個列表頁的分頁區塊是「死按鈕」
- **位置：** `js/views/properties.js:245-251`、`contracts.js`、`finance.js`、`maintenance.js:110-116`、`tenants.js:129-135`、`unsettled.js`
- **現況：** 所有頁面尾端硬寫「第 1 頁，共 1 頁」+ 兩顆 `disabled` 箭頭。已有 `pg-wrap` 完整樣式 (style.css:2587-2649) 但沒有任何頁實際呼叫。
- **影響：** 所有 admin、所有資料密集頁；資料量過 100 筆使用者只能滾長表。
- **建議：** 寫 `utils/pagination.js` 公用 helper（接 rows + pageSize → 回傳當頁 rows + 渲染 `.pg-wrap`），六處 placeholder 全部換掉。預設 50/頁、提供 25/50/100 切換。
- **工程量：** M (3h)

### C-2：表格在 1366 寬以下橫向溢出，且無 sticky header
- **位置：** `css/style.css:2354-2412` `.table-container { overflow-x: auto }`
- **現況：** properties / contracts / finance 平均 6-9 欄，1366×768 開全螢幕 sidebar 展開時 table 右端要橫滾才看到「操作」欄；滾下去後 thead 整個消失。
- **影響：** 1-3 個 admin 每天都看這幾張表，是核心工作流。
- **建議：**
  1. `.table-container { max-height: calc(100vh - 320px); overflow: auto; }` + `.data-table th { position: sticky; top: 0; z-index: 2; }`
  2. 「操作」欄改 `position: sticky; right: 0; background: var(--color-surface);` 讓 icon button 群恆可見
  3. 行動 icon `gap: 0.5rem` 改 `gap: 0.25rem`，`padding: 0.25rem 0.5rem` 改 `padding: 0.3rem 0.45rem`
- **工程量：** M (2h)

### C-3：Icon-only 按鈕沒 aria-label（只有 title）
- **位置：** `properties.js:154-160`、`contracts.js:107-141`、`finance.js:130-134`、`maintenance.js:48-67`、`tenants.js:62-74`、`unsettled.js:96-109`
- **現況：** 每個列只有 `title="查看詳情"`，沒有 `aria-label`。`title` 在桌面 hover 才出現，鍵盤 tab + 螢幕讀字機無法理解。
- **影響：** a11y 合規。
- **建議：** 把所有 `title="X"` 同步加 `aria-label="X"`；寫共用 helper `iconBtn(action, icon, label)`；icon 加 `aria-hidden="true"`。
- **工程量：** S (1.5h，可大量 sed)

### C-4：401 處 inline `style="…"` 散在 16 個 view
- **位置：** 全站；最嚴重 `settings.js` (55 處)、`properties.js` (28)、`contracts.js` (26)、`unsettled.js` (29)
- **現況：** 例如 `style="font-size: 0.7rem; color: var(--text-muted);"` 出現 249 次（明明 `--text-2xs` / `--text-xs` 已定義）；硬編 `color: #2563eb`、`#16a34a` 等 64 次。
- **影響：** 未來做 dark mode、主題切換、批次調色都會「改了但只動一半」。
- **建議：** 抽 6 個 utility class 一次處理 80% 案例：
  ```css
  .text-2xs { font-size: var(--text-2xs); }
  .text-xs  { font-size: var(--text-xs); }
  .text-muted { color: var(--text-muted); }
  .text-success { color: var(--color-success); }
  .text-danger { color: var(--color-danger); }
  .cell-stack { display: flex; flex-direction: column; gap: 0.25rem; }
  ```
  先處理 properties + contracts 兩張表就能砍掉 ~80 處。
- **工程量：** L (4h+，可分批；先打底兩張表約 1.5h)

### C-5：Topbar 全域搜尋 `/` kbd 提示為假
- **位置：** `index.html:143-147`
- **現況：** UI 顯示 `<kbd class="search-kbd">/</kbd>` 暗示按 `/` 聚焦搜尋框，但 codebase 沒有 keydown handler。
- **影響：** 信任感、品牌專業度。
- **建議：** 在 `app.js` 加：
  ```js
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.target.matches('input,textarea')) {
      e.preventDefault();
      document.querySelector('.search-bar input').focus();
    }
  })
  ```
- **工程量：** S (0.5h)

---

## 🟡 Major（明顯瑕疵 — 應改）

### M-1：Sidebar 收合時 header 位置奇怪
- **位置：** `css/style.css:255-275`
- **現況：** 收合時 `flex-direction: column` 把 logo 跟 toggle 直立堆疊，造成 header 高度與 topbar 不齊。
- **建議：** 收合時 sidebar-header 維持 `height: var(--topbar-height)`，只放 logo icon 置中，toggle 移到 footer 區。
- **工程量：** S (1h)

### M-2：Topbar `page-eyebrow`「聚空間」三個字資訊量為零
- **位置：** `index.html:138`、`css/style.css:1993-2007`
- **建議：** 改成 breadcrumb「營運 ▸ 物件管理」「報表 ▸ 各館收入」隨 hash 動態更新。
- **工程量：** S (1h)

### M-3：Toast 沒有 `role="status"` / `aria-live`
- **位置：** `js/utils/ui.js:489-505`
- **建議：** 加 `role="region" aria-live="polite" aria-label="系統通知"`；danger toast 個別加 `role="alert"`。
- **工程量：** S (0.5h)

### M-4：Dashboard 待辦卡的「暫無待辦事項」純文字、又冷又空
- **位置：** `js/views/dashboard.js:292, 309, 326`
- **建議：** 抽共用 `emptyState({ icon, title, hint })` helper，給 phosphor icon (`ph-confetti` / `ph-coffee` / `ph-check-circle`) + 打氣文字「本月合約都安全 ✓」。
- **工程量：** S (1h)

### M-5：Finance `tr:hover` 跟 `finance-row-in/out` 底色衝突
- **位置：** `css/style.css:946-959` vs `2406`
- **建議：** hover 加 `border-left: 4px solid var(--color-success/danger);` + `box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05)`，比改底色更有反饋。
- **工程量：** S (0.5h)

### M-6：登入頁背景單薄、缺品牌延伸
- **位置：** `js/views/login.js:14-41`、`css/style.css:487-543`
- **建議：**
  1. 背景加極淡橘色徑向光：`radial-gradient(circle at 30% 20%, rgba(255,136,89,0.15), transparent 50%)`
  2. auth-card 上方加 slogan「一站式管理你的所有租賃物件」
  3. 無權限頁紅圓圈改 `background: var(--color-danger-light)` + icon 用 `var(--color-danger)` 字色
- **工程量：** S (1h)

### M-7：Occupancy 退房 checkbox 視覺強度太低，誤觸風險高
- **位置：** `js/views/occupancy.js:171`
- **建議：** 改成 `<button class="occ-row-action"><i class="ph ph-door-open"></i></button>`，hover 紅色強調；點擊一律進 confirm modal。
- **工程量：** S (1h)

### M-8：Settings tabs 切換沒 URL 記錄
- **位置：** `js/views/settings.js:14-39`
- **現況：** 6 個子分頁靠 `data-settings-tab` 切 DOM，URL 永遠 `#settings`。
- **建議：** 改用 `#settings/sync` hash sub-route，連帶解 sidebar sync indicator 點擊那段 setTimeout hack。
- **工程量：** M (2h)

### M-9：Admin Users 頁用 emoji 當主視覺，跟其他頁脫節
- **位置：** `js/views/admin-users.js:88-95`
- **建議：** emoji 全改 phosphor：`ph-crown`、`ph-wrench`、`ph-eye`、`ph-info`，外層套 `.status-badge`。
- **工程量：** S (0.5h)

### M-10：表格列「操作」欄 icon 太多，hover 時才該顯示
- **位置：** contracts.js (5-7 顆 icon)、unsettled.js (5 顆)
- **建議：** 保留 1-2 顆主要動作恆顯示，其餘塞進 `⋯` kebab dropdown。連帶幫 C-2 解決橫向空間問題。
- **工程量：** M (2.5h)

---

## 🟢 Minor（雕琢級）

| # | 問題 | 位置 | 工程量 |
|---|---|---|---|
| P-1 | 出租率除以 0 顯示 `NaN%` | `properties.js:193` | 5min |
| P-2 | Notification bell badge 永遠寫死 0 | `index.html:148-151` | 0.5h |
| P-3 | Sidebar 子項收合後與父項無視覺差別 | `css:432-440` | 0.2h |
| P-4 | Reports 兩種 cell 邊框權重不對等 | `css:651-658` | 5min |
| P-5 | Search bar 沒有 clear button | 多處 | 0.5h |
| P-6 | Matrix 分析交叉表無 sticky thead | `css:3147-3175` | 0.2h |
| P-7 | Status badge 不支援強度分級 | `css:2258-2276` | 0.5h |
| P-8 | Modal 沒「上次表單填到一半恢復」 | `ui.js:18-61` | 2h |
| P-9 | Sidebar footer brand-row 可點但無提示 | `index.html:125-128` | 0.3h |
| P-10 | Occupancy tabs vs filter-row 樣式不一致 | `css:1240-1277` vs `3460-3514` | 1h |
| P-11 | 金額欄未用 `font-variant-numeric: tabular-nums` | 多處 | 0.1h |
| P-12 | Boot loading 移除時硬切，無 fade-out | `css:1513-1543` | 0.3h |

---

## 視覺 Quick Wins（5 個立刻能做）

1. **`/` 鍵綁搜尋框聚焦** — `app.js` 加 10 行 keydown listener （C-5）
2. **Toast 加 `role` + `aria-live`** — `ui.js:491-493` 三行屬性 （M-3）
3. **金額全域 tabular-nums** — `style.css` `.data-table td, .metric-value { font-variant-numeric: tabular-nums; }` （P-11）
4. **物件管理 NaN% 防呆** — `properties.js:193` 加三元 （P-1）
5. **emoji 換 phosphor** — `admin-users.js:88-95` 4 處替換 （M-9）

---

# Part 2：動態 / 動畫 Audit

## 動畫現況統計

| 項目 | 數量 |
|---|---|
| `transition:` 出現 | 52 處 |
| `animation:` 出現 | 11 處 |
| `@keyframes` 定義 | 6 個 |
| 使用 token (`--transition-fast` 等) | 28 處 |
| 硬編秒數 (`0.1s` / `0.12s` / `0.2s` 等) | 24 處 |
| Token 普及率 | **54%（一半旁路）** |

**Keyframe 用途清單：**

| 名稱 | 行號 | 用途 |
|---|---|---|
| `sync-spin` | 1581 | 旋轉 360°，sync indicator (1.5s) / boot loader (0.8s) / auth submit (0.8s) |
| `fadeIn` | 2166 | 進場 `opacity 0→1 + translateY(10px→0)` |
| `modalOverlayIn` | 2673 | overlay 0→1，0.25s |
| `modalContentIn` | 2692 | modal 內容 `translateY(8px) + scale(0.99)→1` |
| `csFadeIn` | 3672 | 下拉小元件進場 |
| `row-flash-anim` | 4043 | 從深連結進入時 row 黃光閃爍 2.2s |

---

## 🔴 動畫 Critical 問題

### A-C-1：Chart.js 預設 1 秒 ease — 切頁等於罰站
- **位置：** `js/views/dashboard.js:427-452, 471`
- **現況：** 進儀表板、切「總和/各館」、切館別篩選，每次跑 1000ms cubic 動畫。`prefers-reduced-motion` 也關不掉（Chart.js 不吃 CSS）。
- **建議：**
  ```js
  options: {
    animation: { duration: 250, easing: 'easeOutCubic' },
    animations: { colors: false, x: false },
    transitions: { active: { animation: { duration: 0 } } }
  }
  // 全域：Chart.defaults.animation.duration = 250
  ```
- **工程量：** S (10 分鐘)

### A-C-2：Wizard 三步切換 `display: none ↔ ''`，零過渡
- **位置：** `js/views/properties.js:812-853` (setStep)
- **現況：** 切換瞬間像 PowerPoint 投影片無切換效果。
- **建議：**
  ```css
  .wiz-step-pane { opacity: 0; transform: translateX(8px); transition: opacity 0.2s, transform 0.2s; }
  .wiz-step-pane.is-active { opacity: 1; transform: translateX(0); }
  ```
  stepper num 顏色/icon 切換改用 CSS class，加 `transition: background-color 0.2s, transform 0.2s`。
- **工程量：** M (要重寫 setStep + 調 30 行 inline style)

### A-C-3：表格 re-render 沒任何 list animation
- **位置：** 所有 `views/*.js` 列表
- **現況：** CRUD 後 `innerHTML = ...` 整段重畫，刪除/新增無 highlight。
- **建議：** CRUD 後對該 row 加 `tr.row-flash`（已有現成 keyframe），改 2 行 code 立即見效。
- **工程量：** S（步驟 1）

---

## 🟡 動畫 Major 問題

### A-M-1：dashboard card hover 升起過熱
- **位置：** `css:2183-2190`
- **建議：** 移除 `.metric-card.card:hover` 的 `translateY`，metric card 沒 onclick 不該有 hover 升起。
- **工程量：** S

### A-M-2：sync indicator 旋轉 1.5s 太慢
- **位置：** `css:1574`
- **建議：** 統一 0.8s linear。
- **工程量：** S

### A-M-3：toast dismiss timer 200ms 比 transition 250ms 還短，動畫被截斷
- **位置：** `js/utils/ui.js:502, 539`
- **建議：** 200 改 260（或用 `transitionend`）
- **工程量：** S (改 2 個數字)

### A-M-4：表單錯誤無 motion 提示
- **位置：** `properties.js:869`
- **建議：**
  ```css
  @keyframes input-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
  .input-error { animation: input-shake 0.3s ease-out; }
  ```
  + JS 加 `scrollIntoView`
- **工程量：** S

### A-M-5：metric 數字直接跳，沒 count-up
- **位置：** 所有 `metric-value` 用處
- **建議：** 寫 `animateNumber(el, from, to, duration=400)` 用 rAF `easeOutQuart`。respect prefers-reduced-motion。
- **工程量：** M

### A-M-6：sub-tab 切換瞬切，無 underline slide
- **位置：** `css:2549-2585` `.finance-sub-tabs`、settings tabs
- **建議：** active indicator 用偽元素 + `transform: translateX()` 跟著移動（material-style）。內容 cross-fade。
- **工程量：** M

---

## 🟢 動畫 Minor 問題

| # | 問題 | 工程量 |
|---|---|---|
| A-P-1 | 24 處硬編秒數混用 | S (grep replace) |
| A-P-2 | keyframe 全用 `ease`，entrance 應用 `ease-out` | S |
| A-P-3 | sidebar collapse 動畫只動 width，內容沒同步淡出 | S |
| A-P-4 | custom-select 收合無 reverse animation | S |
| A-P-5 | Flatpickr 跟 select option transition 不一致 | S |
| A-P-6 | `bf-bar-fill` 進度條進場像 loading bar | S |
| A-P-7 | modal close 時瞬消，無 exit 動畫 | S |
| A-P-8 | row-flash 顏色 hardcoded，不走 token | S |

---

## 應該加但沒有的動畫（補強）

1. **表單儲存成功 — checkmark 彈出**：submit 後 icon `ph-check` 用 `transform: scale(0)→scale(1)` + 旋轉 30° 彈出 0.3s
2. **dashboard metric count-up**：見 A-M-5
3. **空狀態插畫的 idle motion**：icon 加 `animation: float 3s ease-in-out infinite alternate`
4. **deletion row exit**：刪除前 `opacity: 0; transform: translateX(-12px); max-height: 0`，再 splice DOM
5. **sync 成功的 pulse**：sync indicator 從 pulling/pushing → idle 時，icon 用 `animation: pulse 0.6s ease-out` 綠色擴散
6. **sparkline 進場線條繪製**：`reports.js:123` polyline 用 `stroke-dasharray` + `stroke-dashoffset` trick 0.6s
7. **undo toast 倒數條視覺化**：`ui.js:528` 文字 5→4→3 倒數，加底部 `width: 100% → 0%` progress bar
8. **dropdown / search panel 關閉**：reverse animation 對稱

---

## 動畫 Quick Wins（5 個）

1. **Chart.js 全域 duration 改 250ms** — `Chart.defaults.animation.duration = 250`，dashboard 立刻變快 10 倍 （A-C-1）
2. **CRUD 後對 row 加 `.row-flash`** — 利用既有 keyframe，0 新增 CSS （A-C-3）
3. **undo toast 加底部 progress bar** — 5 行 CSS + 1 行 JS （補強 #7）
4. **input-error 加 shake keyframe** — 8 行 CSS （A-M-4）
5. **toast dismiss timer 200 → 260** — 改 2 個數字 （A-M-3）

---

# Part 3：長期策略方向

## 視覺設計策略

### 1. CSS 重構：把 401 處 inline style 收進 12-15 個 utility class + component class
先打底（`.text-2xs/.text-muted/.cell-stack` 等共 6 個），再針對 properties + contracts + finance 三張主表把 `<td>` 內結構抽成 helper。完成後 dark mode 才有基礎。

### 2. Dark mode
sidebar 已有 `toggleAppTheme` placeholder（index.html:117）但無實作。token 都到位了，只差顏色映射表 + `<html data-theme="dark">` 切換。前提是先解 C-4。

### 3. 空狀態 illustration 系統
建一組 4-6 個 phosphor-based 線稿 illustration，用在 dashboard 三張待辦卡、occupancy 空館、unsettled 結清時。

### 4. 桌面 1366×768 的密度最佳化
- `.metrics-grid` minmax 從 240 → 200，讓 4 張 metric 一行擠進
- topbar 高度 54 → 48
- `.card { padding: 1.5rem → 1.25rem }`
- 整體可榨出約 80px 垂直空間

### 5. 真實平板響應 (iPad 10.9" / 1180×820)
加 1200px 中段斷點，sidebar 預設收合 + 觸控 hover 改 active 行為。

---

## 動畫策略

### 1. 建立 motion token 三層
```css
--motion-instant: 100ms;
--motion-fast: 180ms ease-out;
--motion-base: 250ms cubic-bezier(0.4, 0, 0.2, 1);
--motion-slow: 400ms ease-out;
--motion-enter-easing: ease-out;
--motion-exit-easing: ease-in;
```

### 2. View Transitions API
Chrome 已支援；切 sidebar nav 用 `document.startViewTransition()` 包 cross-fade，整個 view-section 切換立刻像 native app。fallback 走現有 `fadeIn`。

### 3. Shared element transitions
點儀表板 metric card → 跳到財務頁，metric card 變成頂部 hero。對 BMS「從總覽鑽進細節」高頻動作極有用。

### 4. Lottie / SVG 微插畫
empty state、boot loader、sync success 三個高曝光點，從 spinner 升級到品牌化的橘色 mini-loop，< 10KB。

### 5. 建立 motion guideline 文件
列「什麼時候該動、duration 用哪檔、entrance 用 ease-out」等，給未來新增 component 的人有 reference。

---

# 結論

聚空間 BMS 在「**資訊架構** + **設計 token**」層次已經處於成熟 SaaS 水準。  
**動畫底子**（prefers-reduced-motion、主流元件動畫）健康度也 OK。

最該投資的是「**執行力收尾**」——把假分頁變真、把 inline style 收回 token、把 a11y 補齊、把 Chart.js / wizard / CRUD 三個零過渡的地方補上 micro-feedback。  
**Quick wins 10 項合計工程量 ~ 4 小時**，但 perceived quality 提升極大。

---

## 推薦執行順序（如果一週只能投入 8h）

| Day | 任務 | 預估工時 | 屬於 |
|---|---|---|---|
| 1 | 視覺 + 動畫 Quick Wins 全包 | 3h | QW 1-10 |
| 2 | C-3 (aria-label) + M-3 (toast aria) + M-9 (emoji 換 icon) | 2h | a11y 收尾 |
| 3 | A-C-1 (Chart.js) + A-C-3 (row-flash CRUD) | 1h | 立即感知變化 |
| 4 | A-M-4 (input shake) + M-2 (breadcrumb) | 2h | 細節打磨 |

剩 C-1 (假分頁) / C-2 (表格 sticky) / C-4 (inline style 重構) 是 multi-week 的 strategic work，建議另開 sprint。

---

# Part 4：響應式 / 手機板 Audit

## 既有響應式現況統計

`css/style.css` 全檔 3737 行只有 **8 個有效 @media query**（另 1 個是 `prefers-reduced-motion`）。

| 行號 | Breakpoint | 影響範圍 |
|---|---|---|
| 2120 | max-width 768 | topbar：縮 padding、隱藏 eyebrow、search 280→180 |
| 2138 | max-width 560 | search-bar 完全隱藏 |
| 2151 | max-width 768 | view-container padding 1.5→1rem |
| 2448 | max-width 1024 | dashboard-grid 2→1 欄 |
| 2583 | max-width 640 | finance sub-tab 隱藏文字 |
| 2859 | max-width 1024 | todo-cards-grid 3→1 欄 |
| 3395 | max-width 880 | bf-row grid 1 欄 |
| 3565 | max-width 640 | form-grid 雙欄→單欄 |

**沒做響應式的關鍵 component（30+ 個）**：sidebar、所有 7 個 data-table 列表、matrix-table、occ-table、modal-content、area-filter-row、page-level toolbar、metric-card grid、settings-tabs、room-card、form-actions、pagination。

## 響應式評分

| 寬度 | 分數 | 理由 |
|---|---|---|
| 1366×768 | 7 | 基本可用，properties / contracts 6 欄已開始擠 |
| 1024×768 | 5 | sidebar 仍 260，main 剩 764，表格全部橫向溢出 |
| 平板 768×1024 | 3 | sidebar 佔 260 = main 剩 508，表格橫捲、topbar 切但 sidebar 沒處理 |
| 平板 1024×768 | 5 | 同 1024 桌面，觸控目標未放大 |
| 手機 375×812 | **1** | sidebar 佔 260 = 主畫面剩 115px，**幾乎完全不可用** |
| 整體響應式策略品質 | 3 | desktop-only 設計，響應式 patching 散亂 |

## Part A：桌面縮小問題（1920→768）

### 🔴 R-C-1：sidebar 在 <1024 沒自動收合、吃掉太多空間
- 位置：`css/style.css:139-148`、`index.html:28-130`
- 觸發：< 1100px
- 影響：1024 寬時主內容只剩 764px，6 欄表格全部擠到溢出
- 建議：`@media (max-width: 1100px) { .sidebar { width: var(--sidebar-width-collapsed); } .sidebar .nav-label, .nav-section-label, .sidebar-footer .user-info, .sidebar-footer .user-actions, .brand-row { display: none; } }`
- 工程量：**S**（已實作 ✓）

### 🔴 R-C-2：6–9 欄表格 1024 寬橫向溢出，操作欄被捲走看不到
- 位置：`contracts.js:237-244`（7 欄）、`finance.js:223-233`（9 欄）、`unsettled.js:174-176`（8 欄）
- 建議：操作欄 sticky right + 右側 gradient 提示
- 工程量：M
- **已實作部分** ✓（sticky right CSS）

### 🔴 R-C-3：occupancy 矩陣表窄寬欄寬不夠
- 位置：`css/style.css:1343-1347, 1402-1409`
- 觸發：< 1280px
- 建議：`.occ-table-wrap` overflow-x: auto + `.occ-table { min-width: 1100px }` + 床位欄 sticky left
- 工程量：M

### 🟡 Major（R-M-x）
- **R-M-1** page-level toolbar 在 <900 無 wrap
- **R-M-2** metric-card grid `minmax(240, 1fr)` 480-620 寬擠
- **R-M-3** area-filter-row 5+ 館換行佔太多垂直
- **R-M-4** settings 6 個 tab 在 1024 以下超寬
- **R-M-5** modal max-width 900 在 1000 寬撞牆
- **R-M-6** matrix-table sticky left 沒保底 min-width

### 🟢 Minor
- R-P-1 bf-row breakpoint 880 跟其他 768/1024 不一致
- R-P-2 dashboard chart 寫死 300px 高
- R-P-3 form-actions 窄寬無對齊

## Part B：手機板（375-414）問題

### 🔴 手機 Critical

**M-C-1：sidebar 強佔 260px = 主畫面剩 115px，整個 App 廢掉**
- 緊急 fix：sidebar 改 fixed drawer + 漢堡 button（已實作部分）
- 工程量：M

**M-C-2：所有 data-table 橫向溢出，操作欄看不到**
- 緊急 fix：操作欄 sticky right ✓
- 長期：改 card list pattern
- 工程量：L

**M-C-3：modal 在手機填到底找不到「儲存」按鈕**
- Fix：`@media (max-width: 600px) { .modal-overlay { padding: 0; align-items: flex-end; } .modal-content { max-width: 100%; max-height: 95vh; border-radius: 16px 16px 0 0; } }`
- 工程量：S（已實作 ✓）

**M-C-4：occupancy 矩陣在 ≤ 768 完全無法瀏覽**
- 重設計：手機改「館別 → 房 → 床」垂直導航
- 工程量：L

**M-C-5：< 560 搜尋條消失但沒替代入口**
- Fix：放大鏡 icon → 全螢幕 search overlay
- 工程量：S

### 🟡 手機 Major

- M-M-1 metric-card 在 375 變 1 欄，4 張卡要捲 4 個畫面
- M-M-2 page toolbar 擠成一團，「新增」按鈕應變 FAB
- M-M-3 area-filter-row 5+ 館分兩列佔垂直
- M-M-4 sub-tabs 在手機只剩 icon 沒語義
- M-M-5 filter-tabs 4 顆 + 計數擠 2 列
- M-M-6 form-actions 右對齊在手機怪
- M-M-7 chart 固定 300px 高在手機怪
- M-M-8 pagination 5+ 頁碼佔空間
- M-M-9 todo-cards 內 row 文字長時擠 button

### 🟢 手機 Minor
- M-P-1 sidebar-footer 同步指示在 drawer 內可見即可
- M-P-2 matrix-table 字級 0.85rem 在手機過小
- M-P-3 flatpickr 在手機 UX 差，建議改回原生 `type="date"`
- M-P-4 toast 需加 safe-area-inset-bottom
- M-P-5 icon-btn 觸控目標 < 44×44px

## 應該重新為手機設計的 Component（重做清單）

| ID | Component | 改成 | 工程量 |
|---|---|---|---|
| M-R-1 | sidebar | drawer + 漢堡 + bottom tab | M |
| M-R-2 | data-table | card list（7 頁都要改） | L |
| M-R-3 | occupancy 矩陣 | 館別→房→床 垂直導航 | L |
| M-R-4 | modal | bottom sheet / full-screen | M |
| M-R-5 | page toolbar | 縮版 header + FAB | M |
| M-R-6 | filter-tabs / area-filter | 橫捲 chip 列 | S |
| M-R-7 | settings 6 tabs | 直式 list / accordion | M |
| M-R-8 | 全站搜尋 | full-screen overlay | S |

## 響應式 Quick Wins（5 個立刻能做、純 CSS）

1. **sidebar 在 ≤ 1100 強制收合** — 1024 桌面立刻多 184px 空間 (R-C-1) ✓
2. **所有 table 操作欄 sticky right** — 6-9 欄表格永遠看得到操作 (R-C-2) ✓
3. **modal 跨裝置 ≤ 600 全螢幕 bottom sheet** — 表單按鈕找得到 (M-C-3) ✓
4. **page-toolbar wrap** — 給 toolbar div 加 flex-wrap 一次解 5 頁 (R-M-1) ✓
5. **settings-tabs 橫捲不換行** — 6 個 tab 不再爆排版 (R-M-4) ✓

## Strategic：手機版規劃方向

**PWA**：建議做。BMS 是內部工具、admin 經常臨時要查（現場、跟租客見面、處理維修），PWA + 加到主畫面 + 離線快取會大幅提升體驗。技術成本低：manifest.json + 基本 service worker。

**不分流 mobile-only routes**：維護成本翻倍且容易 drift。應走「同一份 HTML + 響應式 CSS + JS 條件 render」路線。

**頁面手機優先級**：

| 頁面 | 手機優先級 | 理由 |
|---|---|---|
| dashboard | 高 | 老闆隨時想看數字 |
| properties | 高 | 現場用最多，需 card 化 |
| maintenance | 高 | 現場報修、拍照、跟進 — 手機原生情境 |
| contracts | 中 | 簽約多在電腦，但查狀態需要 |
| finance | 中 | 收款時用，9 欄表必須重設計 |
| tenants | 中 | 查聯絡資訊、撥打 LINE |
| unsettled | 中 | 催繳時查 |
| occupancy | 低 | 矩陣本來就桌面 |
| analysis / reports | 低 | 報表桌面看較合適 |
| settings / admin-users | 低 | 設定通常在桌面做 |

**Breakpoint 收斂**：目前混用 560/640/768/880/1024 五道，建議收斂到 **640 / 1024** 兩道（手機 / 平板 / 桌面）。

**Mobile-first vs desktop-first**：混合策略 — 新增 component 一律 mobile-first；既有 component 用 desktop-first 但每個都要有「≤ 1024 簡化版」「≤ 640 手機版」兩段。

## 響應式結論

目前系統是「**桌面 1366+ 才舒服**」程度：1024-1366 勉強堪用、< 1024 開始壞、< 768 接近不可用、手機完全不可用。

**最關鍵單點 fix**：sidebar 在 < 1100 自動收合（5 行 CSS 立刻把 1024 桌面從 5 分拉到 7 分）。

要做手機板必須重做 **sidebar→drawer、data-table→card list、occupancy 重新導航** 三個結構，沒有捷徑。

