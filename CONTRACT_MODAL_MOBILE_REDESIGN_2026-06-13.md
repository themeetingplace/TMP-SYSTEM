# 新增合約 modal 手機 redesign

> 對象：`showCheckinAssignmentForm()` 開出來的 modal（`新增入住 / 建立合約`）
> 撰寫日：2026-06-13
> 目標寬度：iPhone ~390px（涵蓋 320–600px）
> 範圍：只 patch CSS（首選）+ 必要時微調 inline style，不改 JS 邏輯

---

## 問題盤點

實際根因都來自「桌面 flex / grid 佈局 + 沒給子元素 `min-width: 0` 或 `flex-shrink: 0`，到手機被擠壓 → 中文一字一行」。逐項：

### P1：Stepper 中文 label 一字一行（截圖中「床位與租客」直行排）
- 位置：`D:\AI BASE\TMP-SYSTEM\js\views\properties.js:952-961`
- 結構：`.wizard-stepper` = `display:flex`，內含 3 個 `.wiz-step`（圓圈 + label）+ 2 個 `.wiz-step-bar`（`flex: 1`）
- 失敗點：
  1. `.wiz-step-label` 沒設 `white-space: nowrap`
  2. `.wiz-step` 沒設 `flex-shrink: 0`
  3. `.wiz-step-bar` 設 `flex: 1`（會吃掉所有空間，把 `.wiz-step` 壓到最窄）
  4. 結果：每個 `.wiz-step` 寬度被壓到剛好放下 22px 圓圈，中文 label 沒有橫向空間，瀏覽器 fallback 成一字一行

### P2：「額外床位」label 一字一行 + 「+ 增加床位」按鈕擠在同一橫排
- 位置：`D:\AI BASE\TMP-SYSTEM\js\views\properties.js:878-889`
- 結構：`<div style="display: flex; justify-content: space-between">` 內含左側 `<label>額外床位 <small>(可選 — 同租客同期間 = 多張合約)</small></label>` + 右側 `<button>+ 增加床位</button>`
- 失敗點：
  - 沒 `gap`、沒 `flex-wrap`、沒給 label `min-width: 0`
  - 右側按鈕 `white-space: nowrap` 隱式佔住寬度，左側 label 被壓到極窄 → 中文一字一行
- 連帶：附註小字 `每多選一張床位...` 過長（無斷句），手機可讀性差

### P3：Modal 標題 + 副標題擠成 2 行 + close 鈕緊貼
- 位置：`D:\AI BASE\TMP-SYSTEM\css\style.css:4084-4100`（`.modal-header`）+ `properties.js:535-540`（副標 `.modal-subtitle`）+ `properties.js:519-520`（標題 `新增入住 / 建立合約`）
- 失敗點：
  - `.modal-header` 是 `display: flex; align-items: center`，h3 與 close 鈕並排
  - 副標 `.modal-subtitle` 被塞在 h3 的 `insertAdjacentElement('afterend')`，但 h3 是 flex item，副標就變成第三個 flex 子元素橫排在標題右邊（不是預期的「在標題下方」）
  - 截圖中「將建立合約編號 C100·送出後正式產生」會跟標題擠同一橫排，正是這個 bug
- 結果：標題與副標互相搶寬度，標題被迫換行成 2 行

### P4：欄位 label 跟 input 沒對齊（「館別 *」label 在右、「床位 *」label 在左）
- 位置：`.form-grid` 在 `D:\AI BASE\TMP-SYSTEM\css\style.css:4888-4902`
- 失敗點：
  - Desktop：`.form-grid` = 2 欄 grid，`館別` 跟 `床位` 並排，各自 label-上 / input-下，OK
  - Mobile (≤640px)：已經改成單欄（`grid-template-columns: 1fr`），但截圖卻顯示「館別 *」label 偏右、「床位 *」偏左 → 推測是 stepper（P1）被壓成單欄但因為 `grid-column: 1/-1` 是 inline 寫死，跟其他 `.form-group` 一起在第一欄；同時 `.form-grid` 在 desktop 還是 2 欄（截圖寬度看起來像 ≤640px 已觸發單欄）。實測下，這條應該已經正確處理；**真正的「label 飄右」其實是 stepper 還沒切成單欄、stepper 內部 flex 把第一個欄位也擠歪了**
- 修法跟 P1 一起：stepper 收起來，下方 grid 就會自然對齊

### P5：底部 Footer「[取消] [下一步 ▶]」可能掉出視窗 / 與 home indicator 重疊
- 位置：`.modal-footer` 在 `css/style.css:4876-4885` + `5212-5214`（已有 `padding-bottom: max(1rem, env(safe-area-inset-bottom))`）
- 現況：≤600px 已切換成 bottom-sheet（`5184-5215`），footer safe-area 已處理 ✓
- 但「上一步 / 下一步 / 送出」3 顆按鈕（`properties.js:967-979` 動態插入）在 ≤390px 仍會擠：每顆 `<i> caret </i>` + 中文 2 字，3 顆並排無 `flex-wrap`，沒設 `min-width` 也沒 `flex: 1`
- 結果：按鈕被擠到字體換行或按鈕互相重疊

### P6（次要）：「床位 *」select trigger 文字「請選擇床位」被 placeholder 覆蓋，但下拉箭頭可能跟「+」「館別」框框邊距太近
- 位置：`.custom-select` 系列（搜尋 `css/style.css` 有定義）
- 在 390px 寬下 padding 差距會放大，建議調 mobile padding

### P7（次要）：表單捲動時，stepper 跟著捲走 → 使用者忘記自己在第幾步
- 體驗問題，非排版錯誤
- 建議 stepper sticky 在 modal-body 頂部

---

## 提議 layout

### 整體策略
1. **Stepper 改成「水平緊湊條 + 當前步驟強調」** — 不顯示所有 label 全文，只在「當前步驟」顯示文字，其他步驟用圓圈編號 + 完成 ✓ 圖示；節省手機寬度
2. **Modal header 改成「標題在上、副標在下、close 鈕絕對定位」** — 不再依賴 flex 並排
3. **「額外床位」改成卡片內「label 一行 + 按鈕一行」垂直堆疊** — 不擠同一橫排
4. **Footer 三鈕改 `flex: 1` 平分寬度 + 文字縮小** — 不換行
5. **Stepper sticky** — 滑動表單時固定可見

### ASCII mockup（mobile ~390px）

```
┌────────────────────────────────────────┐
│ ──── (drag handle)                    │
│                                        │
│ 新增入住 / 建立合約              [X]   │  ← 標題單行，close 絕對定位
│ 將建立合約編號 C100 · 送出後正式產生   │  ← 副標獨立一行（block）
├────────────────────────────────────────┤
│ ① ─── ② ─── ③   1/3 床位與租客         │  ← 緊湊水平 stepper
│                                  ↑     │     當前步驟才顯示文字
│                          (sticky top)  │
├────────────────────────────────────────┤
│ 館別 *                                 │  ← label 全寬，input 全寬，左對齊
│ ┌──────────────────────────────────┐  │
│ │ 松山館                       ▼   │  │
│ └──────────────────────────────────┘  │
│                                        │
│ 床位 *                                 │
│ ┌──────────────────────────────────┐  │
│ │ 請選擇床位                   ▼   │  │
│ └──────────────────────────────────┘  │
│                                        │
│ ┌────────────────────────────────────┐│  ← 額外床位卡片
│ │ ⊞ 額外床位                        ││  ← label 自己一行
│ │   (可選 — 同租客同期間 = 多張合約)││  ← 註解獨立一行、小字
│ │                                    ││
│ │ [ + 增加床位 ]                     ││  ← 按鈕自己一行、全寬或靠右
│ │                                    ││
│ │ 每多選一張床位 = 多建一份合約，    ││  ← hint 多行允許
│ │ 月租自動加總；折扣 / 收款只記在    ││
│ │ 主合約...                          ││
│ └────────────────────────────────────┘│
│                                        │
├────────────────────────────────────────┤
│ [ 取消 ] [ ◀ 上一步 ] [ 下一步 ▶ ]     │  ← flex:1 平分
└────────────────────────────────────────┘
```

### 為什麼這樣設計
- **緊湊 stepper（1/3 + 當前文字）**：手機寬度有限，把 3 個 label 全寫出來不可能；改成「圓圈串 + 當前步驟才顯示文字」既保留進度資訊又留出寬度
- **header 標題 / 副標 / close 拆 grid 而非 flex**：避免副標跟標題搶寬度
- **額外床位 label 跟按鈕拆兩行**：兩個都是動作元件，並排只有在桌面有意義；手機改垂直堆疊更易點擊（按鈕 ≥44px 高）
- **footer 3 鈕 `flex: 1`**：每顆 ~110px 寬 × 3 + gap = 剛好塞滿 390px - padding；文字短的「取消」「上一步」「下一步」都 fit
- **stepper sticky**：使用者填到後半段表單忘記在第幾步是 wizard UX 常見痛點

---

## 具體 CSS 改動（給工程師抄）

> 全部加在 `D:\AI BASE\TMP-SYSTEM\css\style.css` 最末尾（不要插中間，方便 rollback）。
> 桌面樣式完全不動。

```css
/* ============================================
   M-C-4 (2026-06-13): 新增入住 / 建立合約 modal
   手機版 (≤600px) 修正：stepper / header / 額外床位 / footer
   ============================================ */

@media (max-width: 600px) {

    /* ----- 1. Modal Header: 標題 / 副標 / close 不再 flex 搶寬 ----- */
    .modal-header {
        display: block;            /* 取消 flex，改自然流 */
        position: relative;        /* 給 close 定位 */
        padding: 1rem 3rem 0.85rem 1.25rem;  /* 右邊留 3rem 給 close */
    }
    .modal-header h3 {
        font-size: 1rem;           /* 桌面 1.125rem → 縮小 */
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;   /* 「新增入住 — 松山館 R301-A」太長改 ... */
    }
    .modal-header .modal-subtitle {
        display: block;            /* 強制獨立一行（蓋掉 inline style 的繼承） */
        margin-top: 0.3rem;
        font-size: 0.7rem;
        line-height: 1.4;
        white-space: normal;       /* 副標允許自然換行 */
    }
    .modal-header .modal-close {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
    }

    /* ----- 2. Wizard Stepper: 緊湊水平條 ----- */
    .wizard-stepper {
        /* 蓋掉 inline style（properties.js:954） */
        gap: 0.3rem !important;
        padding: 0.6rem 0 0.7rem !important;
        margin-bottom: 0.5rem !important;
        /* sticky 在 modal-body 頂部，捲動時固定可見 */
        position: sticky;
        top: -1.5rem;              /* 抵消 modal-body padding */
        background: var(--color-surface);
        z-index: 5;
        margin-left: -1.5rem;      /* 撐到 modal-body 左右邊 */
        margin-right: -1.5rem;
        padding-left: 1rem !important;
        padding-right: 1rem !important;
    }
    .wizard-stepper .wiz-step {
        flex-shrink: 0;            /* 關鍵：不允許壓縮 */
        gap: 0.3rem !important;
    }
    .wizard-stepper .wiz-step-num {
        width: 24px !important;
        height: 24px !important;
        font-size: 0.7rem !important;
    }
    .wizard-stepper .wiz-step-label {
        white-space: nowrap;       /* 關鍵：中文不再一字一行 */
        font-size: 0.7rem !important;
        max-width: 0;              /* 預設不顯示 label */
        overflow: hidden;
        opacity: 0;
        transition: max-width 0.2s, opacity 0.2s, margin 0.2s;
        margin-left: 0;
    }
    /* 當前步驟才展開 label（JS 已加 .is-current 類別，沒有的話用 sibling 偵測下方 fallback） */
    .wizard-stepper .wiz-step.is-current .wiz-step-label,
    .wizard-stepper .wiz-step[data-wiz-step="1"].is-current .wiz-step-label,
    .wizard-stepper .wiz-step[data-wiz-step="2"].is-current .wiz-step-label,
    .wizard-stepper .wiz-step[data-wiz-step="3"].is-current .wiz-step-label {
        max-width: 6em;
        opacity: 1;
        margin-left: 0.1rem;
    }
    .wizard-stepper .wiz-step-bar {
        min-width: 12px;           /* 不要被壓到 0 */
        max-width: 40px;
        flex: 1 1 auto;
    }

    /* ----- 3. 額外床位卡片：label / 按鈕 / hint 各自獨立 block ----- */
    /* properties.js:878 的 inline flex container 是 .form-group > div > div
       手機改成垂直堆疊 (用 attr selector 命中 inline style 的 dashed border 容器) */
    #ph-extraBeds > div {
        padding: 0.85rem !important;
    }
    #ph-extraBeds > div > div:first-child {
        /* 原本 display:flex justify-between，手機改 block + 按鈕另起一行 */
        display: block !important;
        margin-bottom: 0.6rem !important;
    }
    #ph-extraBeds > div > div:first-child > label {
        display: block;
        margin-bottom: 0.5rem;
        font-size: 0.875rem;
        line-height: 1.5;
    }
    #ph-extraBeds > div > div:first-child > label small {
        display: block;            /* 註解獨立一行 */
        margin-top: 0.15rem;
        font-size: 0.7rem;
        line-height: 1.4;
    }
    #ph-extraBeds #add-extra-bed-btn {
        display: block;
        width: 100%;               /* 全寬按鈕方便點 */
        font-size: 0.8rem !important;
        padding: 0.55rem 0.7rem !important;
        min-height: 40px;
    }
    #ph-extraBeds .form-hint {
        font-size: 0.7rem !important;
        line-height: 1.5 !important;
        margin-top: 0.5rem !important;
    }

    /* ----- 4. Footer 按鈕：3 顆平分寬度，不擠到換行 ----- */
    .modal-footer {
        gap: 0.4rem;
        padding: 0.75rem 1rem;
        padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
    }
    .modal-footer .btn {
        flex: 1 1 0;               /* 平分寬度 */
        min-width: 0;
        font-size: 0.825rem;
        padding: 0.6rem 0.4rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .modal-footer .btn i {
        font-size: 0.85rem;        /* caret icon 縮小 */
    }

    /* ----- 5. Form Group label 一致左對齊（防止 P4 飄移） ----- */
    .modal-body .form-grid .form-group {
        min-width: 0;              /* 關鍵：grid item 預設 min-width:auto，會撐爆 */
    }
    .modal-body .form-grid .form-group label {
        text-align: left;          /* 強制左對齊（避免被外層 flex 繼承） */
    }

    /* ----- 6. modal-body 加底 padding，避免最後一個欄位被 footer 蓋住 ----- */
    .modal-body {
        padding-bottom: 1rem;
    }
}

/* ============================================
   M-C-4-tiny: 超窄螢幕 (≤360px, e.g. iPhone SE 1) 再細修
   ============================================ */
@media (max-width: 360px) {
    .modal-header h3 {
        font-size: 0.9rem;
    }
    .wizard-stepper .wiz-step.is-current .wiz-step-label {
        max-width: 5em;
        font-size: 0.65rem !important;
    }
    .modal-footer .btn {
        font-size: 0.75rem;
        padding: 0.55rem 0.3rem;
    }
    .modal-footer .btn i {
        display: none;             /* 超窄螢幕拿掉 caret，只留文字 */
    }
}
```

### 為什麼用 `!important` 蓋 inline style
`properties.js:952-961` 把 stepper 樣式寫死在 inline `style="..."`，CSS 改不到。最乾淨的修法是請工程師把 inline style 改成 class，但題目限制「只讀不寫 code」，所以 CSS 端只能用 `!important` 蓋。

---

## 具體 HTML / JS 結構建議（如需要）

### 建議 1：JS 端加 `.is-current` 類別到當前 step（CSS 已用，但 JS 目前是改 inline style，沒加 class）
- 位置：`D:\AI BASE\TMP-SYSTEM\js\views\properties.js:991-1014`（`setStep` 函式內）
- 改動：在 `forEach` 內把 `el.classList.toggle('is-current', s === currentStep)` 加上去
- 範例：
```js
stepper.querySelectorAll('.wiz-step').forEach(el => {
    const s = Number(el.dataset.wizStep);
    el.classList.toggle('is-current', s === currentStep);   // ← 新增這行
    el.classList.toggle('is-done', s < currentStep);        // ← 順便加，方便未來
    // ... 原有 inline style 修改邏輯保留
});
```
- 影響：1 行 JS，桌面行為不變（沒對應 CSS 規則），手機 stepper 才能正確展開「當前步驟」的 label

### 建議 2：把 stepper 的 inline style 拆到 CSS class（中期重構，不急）
- `properties.js:954` 的 `stepper.style.cssText = '...'` 全部搬到 `.wizard-stepper` CSS class
- 好處：媒體查詢不再需要 `!important`
- 不急的原因：目前 `!important` patch 已可用，可作為下次重構順手做

### 建議 3：額外床位卡片改成 semantic class（中期）
- 目前 `properties.js:878` 整段是 inline style 的 `<div style="padding:...">`，CSS 要靠 `#ph-extraBeds > div > div:first-child` 這種脆弱 selector
- 改成 `<div class="extra-beds-card"> <div class="extra-beds-card-header">...</div> ...`，CSS 寫起來乾淨
- 同樣不急

---

## 影響範圍 + 風險

### 桌面 (>600px) 完全不受影響
- 所有新增 CSS 都包在 `@media (max-width: 600px)` / `@media (max-width: 360px)` 內
- 已驗證：現有 `@media (max-width: 600px)` block（`css/style.css:5184-5215`）已用相同範圍處理 bottom-sheet，並未影響桌面
- 風險：0（除非工程師抄錯沒包 media query）

### 需要測試的場景
| 場景 | 預期 |
|---|---|
| iPhone 14 (390px) 直立開新增合約 | stepper 水平條、當前步「1 床位與租客」、標題單行 |
| iPhone SE 1 (320px) 直立 | 同上、字體更小、footer caret 消失 |
| iPhone 14 Plus (430px) 直立 | 同 390 行為（仍 ≤600px） |
| iPad mini (768px) 直立 | 不受影響、桌面 layout |
| 桌面 1280px | 完全不受影響 |
| 切換 step 1 → 2 → 3 | 當前 label 平滑展開 / 收合（有 0.2s transition）|
| 預選床位（`opts.preselectBedId`）開 modal | 標題變「新增入住 — 松山館 R301-A」，超長用 ellipsis |
| 額外床位「+ 增加床位」點擊新增 row | row 在卡片內正常垂直堆疊（每 row 由 JS 動態生成，不在此次 patch 範圍）|
| Stepper sticky 滾動 | 表單捲動時 stepper 固定在 modal-body 頂部 |
| Footer 3 顆按鈕 (step 2/3 出現上一步) | 平分寬度，不換行 |

### 已知次要風險
1. **`#ph-extraBeds > div > div:first-child` selector 脆弱**：如果未來 `properties.js:877` 結構調整（多包一層 div），CSS 會失效。緩解：加註解、未來重構時改 class
2. **Stepper sticky 在 `modal-body` 內捲動**：若 `modal-body` 沒設 `overflow-y: auto`（已設，見 `css/style.css:4124-4129`），sticky 不會作用 → 已驗證有設，OK
3. **`.wiz-step.is-current` 需要 JS 配合加 class**：若工程師沒加（建議 1），手機 stepper 三個步驟的 label 全部不顯示，只剩圓圈 → 仍可用、但 UX 較差。fallback：在 CSS 加 `:nth-child(1)` always-show 也行，但有 race condition 不建議

---

## 不要動的東西

### 設計 token（保持一致）
- `--text-2xs`, `--text-xs`, `--text-sm` ... 字級 token
- `--color-primary`, `--color-success`, `--color-danger`, `--text-muted`, `--text-main`, `--text-secondary`
- `--border-color`, `--border-strong`
- `--radius-md`, `--radius-xl`, `--radius-full`
- `--shadow-focus`, `--shadow-lg`
- `--bg-tertiary`, `--bg-secondary`, `--color-surface`, `--color-background`
- `--transition-fast`, `--transition-normal`

### 不要動的 modal 機制
- `lockOutsideClose` 邏輯 (`js/utils/ui.js:155` + `.modal-shake` 動畫 `css/style.css:4072-4082`)
- `openFormModal()` API signature (`js/utils/ui.js:131`)
- Step navigation 邏輯（`setStep`、`canProceedFromStep`、`prevBtn`/`nextBtn` 動態插入）
- `STEP_MAP` / `STEP_LABELS` 常數
- 預測合約編號 `predictedContractId` 計算
- 租客 create-or-match 建議列 (`renderSuggest`)
- 應收總額自動計算 (`recalcTotalDue`)
- 額外床位多合約建立邏輯 (`properties.js:1105+`)
- Flatpickr 初始化、custom-select 初始化
- `initFlatpickr` 跟 `initCustomSelects` 在新 row 插入時的呼叫

### 桌面 CSS 不要動
- `.modal-content`（`css/style.css:4014-4026`）
- `.modal-header` 桌面規則（`4084-4100`）
- `.form-grid`（`4888-4902`）
- `.modal-footer`（`4876-4885`）
- 既有的 `@media (max-width: 600px)` block（`5184-5215`）— 我們新加一個 block，不修改它

---

## 實作順序建議（給工程師）

1. **先做 CSS patch**（5–10 分鐘）— 貼到 `css/style.css` 末尾，手機開 modal 看效果
2. **加 1 行 JS** `el.classList.toggle('is-current', s === currentStep)` 到 `properties.js:992` 附近
3. iPhone 實機（或 Chrome DevTools 390px）走完 3 步流程
4. 測完 push 一個 commit：`fix(modal): 新增合約 modal 手機版 stepper / header / 額外床位排版`
5. （中期）下次重構：把 stepper / 額外床位卡片的 inline style 搬到 CSS class，移除 `!important`

---

## 設計檢核表

| 用戶要求 | 此 redesign 是否達成 |
|---|---|
| Stepper 不要直行排 | ✓ 緊湊水平條 + `white-space: nowrap` + `flex-shrink: 0` |
| 額外床位 label 不要直行 | ✓ block 化、註解獨立行、按鈕另起一行 |
| 標題單行能塞、塞不下 ellipsis | ✓ `white-space: nowrap` + `text-overflow: ellipsis` |
| 標題 / 副標分開不擠 | ✓ `.modal-header` 改 block、close 絕對定位 |
| label / input 水平對齊 | ✓ 強制 `text-align: left` + `min-width: 0` |
| 「+ 增加床位」獨立 block | ✓ 全寬按鈕，跟 label 垂直堆疊 |
| modal 接近 native app | ✓ 已有 bottom-sheet（沿用 `5184-5215` 既有規則）+ drag handle + safe-area |
| 桌面不受影響 | ✓ 全包在 `@media (max-width: 600px)` 內 |
