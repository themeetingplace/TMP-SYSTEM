# 住房一覽手機 redesign V2

> 跟 V1 報告 (`OCCUPANCY_MOBILE_REDESIGN_2026-06-13.md`) 互補。
> V1 改完之後用戶手機 (iPhone ~390px) 仍然完全看不到月份 header (`5月` / `6月` / ...)。
> 本報告找出根因 + 給最小修法。

---

## TL;DR

**根因**：`css/style.css:6248-6256` 那條 M-R-2 規則：

```css
@media (max-width: 600px) {
    .data-table thead {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
    }
}
```

**沒有用 `:not(.occ-table)` 排除矩陣表**，把 `.occ-table` 的整個 `<thead>` 縮成 1×1px 並 clip 掉 → 月份 header + 床位 / 房客 / 備註 / 退房 **4 個 th 整列都被隱形了**。

用戶 iPhone 390px **正好落在 ≤ 600px** 這個 M-R-2 卡片化斷點裡，所以中招；如果是 iPad mini 768px 就不會踩到。

**最小修法**：那一條規則加 `:not(.occ-table)`，一個字元的事。然後順便補幾條 V1 規則沒處理的邊緣情況。

---

## V1 為何失效

### 根因 #1 — 致命：M-R-2 全域 thead 隱形術蓋到 occ-table

- **位置**：`css/style.css:6248-6256`，在 `@media (max-width: 600px)` 內
- **規則**：`.data-table thead { position: absolute; clip: rect(0,0,0,0); width: 1px; height: 1px; ... }`
- **設計意圖**（看 6235 註解）：M-R-2 是把 `.data-table` 在小手機 (≤600px) 自動轉成 card list，配 `js/utils/tableDataLabels.js` 自動加的 `data-label`。卡片版本不需要 `<thead>`，所以用「視覺隱形 + 留結構給 a11y」的 sr-only pattern 把 thead 縮成 1×1。
- **bug**：底下 6258-6330 一連串 `.data-table:not(.occ-table)` 都很乖地排除矩陣表，**唯獨 6248 的 thead 規則漏掉 `:not(.occ-table)`**。
- **後果**：用戶 iPhone 390px ≤ 600px → `<thead>` 整個被 clip 掉 → 不只「2026/6 那行」不見，**床位 / 房客 / 備註 / 退房 4 個欄位 label 也都不見**（用戶截圖描述「R1-A / italia / 訂金已付」三個欄位看起來是表頭其實是 tbody 第 1 列，這跟我的判斷一致）。
- **為何 V1 在 5942 加的 `.occ-table thead th { position: sticky; ... }` 沒救**：5942 規則作用對象是 `th`（子元素），但 6248 是作用在 `thead`（父元素）上 — **父元素已經 `position: absolute; width: 1px; clip: rect(0,0,0,0)`**，子元素再怎麼樣 sticky 都被框死在那個 1×1 容器內並被 clip 掉。
- **為何 desktop 跟 600 < W ≤ 768 OK**：M-R-2 規則 6238 是 `@media (max-width: 600px)`，所以 768px 平板看得到；但是 iPhone (~390) 必定中標。

### 根因 #2 — V1 規則 5942 的 specificity 確實低於 6248

確認過：
- V1 mobile rule `.occ-table thead th` (5942) → specificity `0,0,1,2`
- M-R-2 rule `.data-table thead` (6248) → specificity `0,0,1,1`

specificity 上 V1 贏。但 V1 是針對 `th`、M-R-2 是針對 `thead`，**兩條規則的選擇對象不同 →沒打架**。M-R-2 直接把 `<thead>` 從 layout 流中拿走 + clip 掉，V1 在 `<th>` 上加什麼樣式都沒救。

### 根因 #3 — 次要：thead inline width 沒問題、wrap overflow 沒問題

掃過其他懷疑點全部排除：

| 懷疑點 | file:line | 結論 |
|---|---|---|
| thead 結構真的有 render 出短月份 span 嗎 | `occupancy.js:272-274` | **有**。`<th>...<span class="occ-month-full">${m.label}</span><span class="occ-month-short">${m.shortLabel}</span></th>` 結構正確 |
| `.occ-month-short` display 沒被覆蓋成 none | `style.css:6065-6069` | **OK**。global `.occ-month-short { display: none }` + mobile 5066 `.occ-month-short { display: inline }`，specificity 差不多但後者在 media query 內、且寫在後面，會贏。但因為整個 `<thead>` 都隱形了，這條規則跟不跟根本看不到 |
| sticky 左欄 z-index 把 thead 蓋掉 | `style.css:5979-6008` | **OK**。thead `z-index: 3`、sticky 左欄 tbody `z-index: 2`、sticky 左欄 thead `z-index: 5`。順序正確 |
| desktop inline `<th style="width: 75px;">` 蓋過 mobile width | `occupancy.js:303-306` vs `style.css:5949-5968` | **OK**。mobile rule 用 `width: 56px !important`，inline 是 0 important，輸 |
| desktop 全域 `.occ-table-wrap { overflow-x: hidden }` | `style.css:1434` vs `style.css:6033` | **OK**。mobile rule 用 `overflow-x: auto !important`，贏 |
| `width: max-content` 被 `table-layout: fixed` 蓋過 | `style.css:1435-1438` vs `5934-5938` | **OK**。mobile rule specificity 相同，但 media query 寫在後面，後贏 |
| M-R-2 把 `.table-container` 改成 `overflow: visible` | `style.css:6240-6243` | **OK**。`.occ-table-wrap` 同層級 + `!important` 贏 |
| ≤600px M-R-2 把 `.data-table` 改 `display: block` | `style.css:6258-6264` | **OK**。寫了 `:not(.occ-table)` 排除 |

**唯一漏網之魚就是 6248 的 thead 隱形規則。**

### 根因 #4 — 一個次要副作用 (不影響月份 header 出現，但會影響 polish)

- **位置**：`style.css:6033-6038`
- **規則**：`.occ-table-wrap { overflow-x: auto !important; overflow-y: visible; }`
- **問題**：CSS spec 規定 `overflow-x` / `overflow-y` 一個是 `visible`、另一個不是 `visible` 時，瀏覽器會把 `visible` 那邊強制改成 `auto`。所以實際 computed style 變成 `overflow: auto auto`。
- **後果**：wrap 變成「縱橫雙軸都可捲」，sticky thead 的 `top: 0` 是相對於 wrap、但 wrap 沒設 max-height → 縱向不會出現 scrollbar，sticky thead 在縱向上實際無效（不過 wrap 內 thead 本來就在最上面，視覺看不出差別）。
- **影響**：本身不會讓「月份 header 看不到」（這個是根因 #1）；但會讓縱向 sticky thead 預期效果失靈。如果要 polish 改成 `overflow-y: hidden` 或不要寫 `overflow-y`。

---

## V2 修法

### 修法 1 — P0 必修：給 6248 規則加 `:not(.occ-table)`

**`css/style.css:6248`** 從：

```css
.data-table thead {
    position: absolute;
    width: 1px;
    ...
}
```

改成：

```css
.data-table:not(.occ-table) thead {
    position: absolute;
    width: 1px;
    ...
}
```

**一個字元 (3 個 token) 的事**，跟同 block 內 6258 / 6259 / 6276 / ... 風格一致。

> 為何不是改成 `display: revert` 在 mobile rule 補蓋？因為 `position: absolute + clip` 連帶把 thead 從 normal flow 拿走，要還原得補 `position: static; width: auto; height: auto; clip: auto; overflow: visible; margin: 0; padding: revert;` 一大坨，又難維護又怕漏。**從源頭排除最乾淨。**

### 修法 2 — P0 必修：wrap overflow-y 改寫

**`css/style.css:6036`** 從：

```css
.occ-table-wrap {
    position: relative;
    overflow-x: auto !important;
    overflow-y: visible;     /* ← 改 */
    -webkit-overflow-scrolling: touch;
}
```

改成：

```css
.occ-table-wrap {
    position: relative;
    overflow-x: auto !important;
    overflow-y: hidden;       /* 避免 spec 把另一軸強制改 auto，sticky thead 縱向預期 OK */
    -webkit-overflow-scrolling: touch;
}
```

> 為何不直接 `overflow: auto !important` 一行？因為 wrap 高度沒被父層限制，縱向 auto 永遠不會出現 scrollbar，跟 hidden 視覺一樣，但寫 hidden 比較 explicit（也省瀏覽器計算）。

### 修法 3 — P1 建議：thead 整體再加保險

V1 5942 規則只針對 `th`。為了防呆，再針對 `thead` 補一條，把 root cause 萬一未來又被全域規則戳到時自救：

加在 `css/style.css:5942` 之前（mobile media query 內）：

```css
/* 防禦規則：避免 M-R-2 之類的「sr-only thead」全域規則打到矩陣表 */
.occ-table thead {
    position: static !important;
    width: auto !important;
    height: auto !important;
    clip: auto !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0;
}
```

> 即使修法 1 已經處理，這條當「下次再加新全域 thead 規則時的安全網」。Specificity `.occ-table thead` = 0,0,1,1 跟 `.data-table thead` 相同；但這條在 mobile media query 內、且 `!important`，會贏。**這不是必要、是 defense-in-depth**。

### 修法 4 — P1 建議：sticky 房客欄 stripe 背景修

V1 5986-5993 sticky 第 2 欄背景設 `var(--color-surface, #fff)`，但是 `.occ-table tr.occ-room-stripe-b` (1416-1418) `td:not(.occ-bed-label)` 的背景是 `rgba(0,0,0,0.02)`。sticky 第 2 欄不是 `.occ-bed-label`、會被 stripe-b 蓋成淡灰、但 sticky 規則又用 inline 0,0,1,2 specificity 設了白色背景 → **stripe-b 列的房客欄會顯示白色、跟下面 tbody 列同房間其他格灰底不對齊**。

修法：用 inherit 背景，或 row-level 設背景：

加在 `css/style.css:5993` 後面：

```css
/* sticky 房客欄底色跟著該列的 stripe 走，避免白底跟灰底錯位 */
.occ-table tr.occ-room-stripe-a td:nth-child(2) { background: white; }
.occ-table tr.occ-room-stripe-b td:nth-child(2) { background: #fafbfa; }    /* 跟 rgba(0,0,0,0.02) 視覺等同的不透明灰 */
.occ-table tr.occ-row-vacant td:nth-child(1),
.occ-table tr.occ-row-vacant td:nth-child(2) {
    background: rgba(241, 245, 249, 0.98);   /* 跟 1421 vacant 淡灰一致、但不透明避免 sticky 漏 */
}
```

> sticky cell 必須**不透明**才不會「看穿」捲到底下的 tbody 內容；rgba alpha < 1 在橫捲時會看穿，視覺很髒。

### 修法 5 — P2 nice-to-have：把 inline width 從 JS 移除

**`js/views/occupancy.js:303-306`** thead 還寫著 inline `<th style="width: 75px;">`，desktop 用、mobile 用 `!important` 蓋。雖然能 work，但 inline style 會增加 mobile rule 必須帶 `!important` 的負擔。

如果想乾淨，把寬度移到 colgroup 或 desktop-only CSS：

```html
<colgroup>
    <col class="occ-col-bed">
    <col class="occ-col-tenant">
    <col class="occ-col-note">
    <col class="occ-col-terminate">
    <!-- 月份欄不指定 col，靠 fixed-layout 平分 -->
</colgroup>
```

CSS desktop (新增)：

```css
@media (min-width: 769px) {
    .occ-table colgroup .occ-col-bed       { width: 75px; }
    .occ-table colgroup .occ-col-tenant    { width: 120px; }
    .occ-table colgroup .occ-col-note      { width: 130px; }
    .occ-table colgroup .occ-col-terminate { width: 60px; }
}
```

然後 mobile rule 就不用一直 `!important`。**這個是 lint quality，不修也 work。**

### 為什麼這次會 work

1. **修法 1** 把唯一阻擋 thead 顯示的規則排除掉 → `<thead>` 重新進入 normal flow → `<th>` 跟著看得見。
2. V1 已經做的 sticky thead / sticky 左欄 / 短 label / 月份欄寬 68px / `table-layout: auto` 全部都正確 — 只是因為根因 #1 整個 thead 被 clip 掉所以「看起來」全部沒效；解掉根因後它們會立刻發揮預期效果。
3. **修法 2** 把 sticky thead 縱向行為穩定下來。
4. **修法 4** 補住 sticky 房客欄底色不一致。

---

## 視覺確認 — V1 其他改動仍然合理嗎

過一遍 V1 報告裡其他建議：

| V1 改動 | 仍合理？ | 備註 |
|---|---|---|
| sticky 左 2 欄（床位 + 房客） | ✅ | 解掉 thead 隱形後，這套 sticky 行為會正確 |
| sticky thead `top: 0` | ✅ | 配合修法 2 之後 |
| 月份欄統一 68px | ✅ | 用戶 390px viewport - sticky 左 156px = 234px → 容得下 ~3.4 個月份欄完整顯示，剩餘橫捲。OK |
| 月份 label `5月` / `6月` 短版 | ✅ | `occupancy.js:47` shortLabel `${m}月` + `style.css:6065-6069` display 切換 — 結構正確 |
| `table-layout: auto` + `width: max-content` | ✅ | 解掉 thead 隱形後，自然撐寬會出現，wrap 橫捲會 work |
| 退房 checkbox 縮 36px / `transform: scale(0.9)` | ✅ | 視覺降權 OK |
| `.occ-table-wrap::after` 漸層 absolute | ✅ | 改修法 2 後 wrap overflow-y: hidden 不影響 absolute 子元素 |
| `padding: 0.5rem 0.4rem` + `font-size: 0.75rem` | ✅ | 比原本 0.72/0.3 寬鬆，OK |
| helper 模式 `nth-child(4)` 仍命中 | ✅ | mobile rule 沒重排欄位順序 |

### 預期 ASCII mockup (修完 V2 之後)

```
┌─────────────────────────────────────────────────────────────────┐
│ 🏢 松山館   共52床 居住12 暫緩29 空床11                          │
├─────────────────────────────────────────────────────────────────┤
│ ┌──── sticky 左 ────┬──── 橫捲區 (~234px viewport) ──→─→─→─→──  │
│ │床位 │ 房客       │ 5月 │ 6月 │ 7月 │ ...    ← sticky thead   │
│ ├─────┼────────────┼─────┼─────┼─────┼─────                    │
│ │ R1-A│ italia     │ 5/31│ 6/1 │     │                          │
│ │     │ 訂金已付   │  ✓  │ 到期│     │                          │
│ ├─────┼────────────┼─────┼─────┼─────┼─────                    │
│ │ R1-B│ italia     │ 5/31│     │     │                          │
│ │     │ 訂金已付   │  ✓  │     │     │                          │
│ ├─────┼────────────┼─────┼─────┼─────┼─────                    │
│ │ R1-C│ 空床       │     │     │     │                          │
│ │     │ [+入住]    │     │     │     │                          │
│ └─────┴────────────┴─────┴─────┴─────┴─────                    │
│   ↑ sticky                  ↑ 在右側用手指捲，sticky 左欄留在原地 │
└─────────────────────────────────────────────────────────────────┘
```

關鍵：**月份 header (`5月` `6月` `7月`) 在 sticky thead 上一直可見**。

---

## 測試 checklist

| 測試項 | 期望 |
|---|---|
| iPhone 13/14 Pro (390×844) | 月份 header `5月 6月 7月...` 完整顯示 |
| iPhone SE (375×667) | 同上 |
| iPad mini (768×1024) | 跟 V1 一致（>600px 不會踩到 6248），月份 header 顯示 |
| 橫向旋轉 iPhone (844×390) | viewport > 768，desktop 排版 OK |
| 橫向捲動矩陣表 | sticky 左 2 欄留在原地、月份格在右側捲動 |
| 縱向捲動整頁 | thead 隨頁面捲動（wrap 不限高度，thead 不會浮在 viewport 頂端） |
| stripe-a / stripe-b 房間交替 | sticky 房客欄底色跟同列 tbody 一致，無錯位 |
| 空床列 (`occ-row-vacant`) 整列灰 | sticky 床位 + 房客欄也是淡灰，不會跑出白底 |
| helper 角色登入 | 退房欄 (nth-child(4)) 隱藏，sticky 左 2 欄不破版 |
| 房客名字超長 (`Vorabhongse Phuc`) | sticky 房客欄 96px 內換行 |
| 折疊側欄 / 展開側欄 → resize | `calculateMonthCount` resize listener 觸發 re-render，desktop 月份數重算（mobile 仍強制 6） |
| Devtools network throttle 慢速 | thead 立刻顯示，不會被 FOUC |
| Safari iOS | sticky 雙欄 + sticky thead 不漂移 |

---

## 不要動的東西 (跟 V1 一致)

- `--text-*` / `--color-*` / `--bg-*` token — **完全不動**
- helper 模式規則 (`style.css:2718-2720`) — 保留
- desktop 矩陣表 `table-layout: fixed` (1435-1438) — **完全不動**
- 月份格底色語意 (`occ-this-month` / `occ-today` / `occ-past` / `occ-future`) — **完全不動**
- `.occ-mobile-nav`（三層垂直導航備案）`display: none` — 保留
- `data-action` 事件委派 — 不動

---

## 實作優先序

1. **P0 必做**：修法 1（加 `:not(.occ-table)`）— 一行字，根治
2. **P0 必做**：修法 2（wrap overflow-y: hidden）— 一行字，polish sticky
3. **P1 建議**：修法 4（sticky 房客欄 stripe 背景）— 視覺一致性
4. **P1 防呆**：修法 3（`.occ-table thead` 防禦規則）— 可不做但建議做
5. **P2 nice-to-have**：修法 5（inline width 改 colgroup）— 整潔，可不做

完成 P0 (修法 1 + 2) 即可解掉用戶截圖看到的「月份 header 不見」問題。
