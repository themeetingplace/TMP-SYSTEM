# 聚空間 BMS — 手機視覺品質審視（第 4 輪 audit）
**日期：** 2026-06-05
**範圍：** 手機 viewport (375×812) 視覺品質
**前提：** 功能已 OK（drawer/FAB/卡片化/bottom sheet/swipe-to-close 都 work），這輪只看視覺/排版/層級/呼吸感

---

## 整體印象（3 句話）

系統的功能性已可用、間距 token 也已立基（`--text-2xs` ~ `--text-3xl`、`--radius-sm/md/lg/xl`），但是**手機畫面整體仍然「工程感」重於「產品感」**——layer 之間缺乏明確的「呼吸感層級」，色彩用得熱鬧（橘 + 綠 + 黃 + 紅 + 藍 + 紫常常同框出現），typography hierarchy 在小螢幕被壓得幾乎沒有對比，加上 558 處 inline style 帶來的數值漂移（`0.65rem`、`0.68rem`、`0.7rem`、`0.72rem`、`0.78rem` 都共存），使整體像 admin tool 而非 SaaS 產品。**手機要從「能用」進到「好看」，重點不在多做動畫或花樣，而在收斂——少一點顏色、少一點字級、少一點 emoji、多一點留白。**

---

## 視覺評分 (1-10)

| 項目 | 分數 | 短評 |
|---|---|---|
| typography 階層 | 5 | metric value 在手機被壓到 `1.25rem`，跟內文 `0.875rem` 差距太小，數字應該是視覺主角卻不夠突出；subtext 又被壓到 `0.65rem` 進入「快讀不到」區 |
| 留白 / 呼吸感 | 5 | 卡片 padding `0.85rem 0.9rem`、`view-container` `1rem` 全部偏緊；卡片之間沒有 section breathing，視覺像清單而非分區 |
| 色彩運用 | 4 | 主色橘、暖黃、藍、綠、紅同時出現在 dashboard 一個首屏；占用率有自己一套綠/黃/紅，badge 又是另一套；色彩沒有層級 |
| 對齊 / 一致性 | 5 | sticky right action 欄、卡片化、occupancy 矩陣的對齊基準三套規則；月份欄日期 `0.75rem`、配對的 pay badge `0.65rem` 視覺不在同一 baseline |
| 卡片 / 容器設計 | 5 | 全站 `--radius-md (0.625rem)` 跟卡片 `--radius-lg (1rem)` 並用，shadow 體系也分 sm/md/lg/hover/focus 5 種，但實際手機上幾乎看不出差別；卡片邊框 `#e7e9ee` 太淺 + shadow-sm 太弱，卡片像「印在背景上」而非「浮在表面」 |
| icon 配重 | 6 | Phosphor 線性風格本身好看；但 `metric-icon` 在手機沒縮（仍 36×36 + 1.25rem），加上 metric value 縮小 → icon 反而搶眼壓過數字 |
| empty state 溫度 | 4 | esf-icon 用綠色 `--color-success`（含蓄而正確），但「☕ 所有帳款都清光了」「🎉 沒有未處理的維修」混用 emoji 跟 Phosphor icon，風格分裂；esf-title 顏色僅 `--text-secondary`，沒有溫度詞彙 |
| 跨頁一致性 | 5 | 表頭 UPPERCASE + letter-spacing 是一致的；但同樣是「狀態 + 副資訊」的小單元，contracts 用 row card、finance 用 cell 內 inline div、maintenance 用 inline-style flex-column，三套寫法 |
| 細節品質 (vs 一流 SaaS) | 4 | 對比 Linear / Stripe / Front：缺乏「冷色系中性色階」做為背景主軸（這裡背景太單一 `#f4f6f8`）、缺乏微妙的 hairline divider 取代粗 border、缺乏 number tabular alignment、缺乏 selection / hover 的「狀態漸層」 |

---

## 🔴 視覺 Critical（影響首屏觀感）

### 1. metric 數字在手機被壓得不夠分量
- **位置：** `css/style.css:3960-3974`
- **現況：** `.metric-value` 桌面 1.75rem → 手機 1.25rem，跟 `.metric-subtext 0.65rem` 之間落差不夠誇張；同時 metric-icon 仍 36×36，視覺上 icon 跟數字「平起平坐」，但 dashboard 上「物件已租 / 總數」應該是該卡的視覺英雄
- **修法：** 手機 `.metric-value` 拉回 1.5rem，加 `font-variant-numeric: tabular-nums`、`letter-spacing: -0.02em`；同時 `.metric-icon` 手機縮到 28×28 + `font-size: 0.95rem`，背景色透明度從 10% 降到 8%
- **工程量：** S

### 2. 全站背景單調，卡片浮不起來
- **位置：** `css/style.css:11` `--color-background: #f4f6f8`、`:2178-2185` `.card` shadow-sm + border `#e7e9ee`
- **現況：** 卡片白底 + 極淺灰邊 + 幾乎看不見的 shadow，疊在淺灰 `#f4f6f8` 上。手機上整片畫面是「灰底白塊」沒有層次
- **修法：** 兩條路擇一—— (a) 拿掉卡片 border、shadow 強化成 `0 1px 3px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.04)`；或 (b) shadow 拿掉、border 拉到 `1px solid #e2e6ec` + 卡片內加 `--bg-secondary` 區塊化。建議走 (a)
- **工程量：** S

### 3. 色彩過量——dashboard 首屏 6 種色塊同框
- **位置：** `js/views/dashboard.js:189-231`
- **現況：** 4 張 metric card 分別是 primary 橘 / warning 黃 / danger 紅 / success 綠 icon，再加上 check-banner 橘漸層、查帳藍、空床 chip 男藍女紅不限橘，首屏「彩虹板」
- **修法：** metric-icon 一律改成中性色（`background: var(--bg-tertiary)`、`color: var(--text-secondary)`），把橘黃紅綠留給 `.metric-value` 本身或卡片右上角的 mini badge；check-banner 不要 urgent 色帶 + 黃文字同時用
- **工程量：** M

### 4. 558 處 inline style 造成數值漂移，沒有 spacing rhythm
- **位置：** 16 個 view 檔
- **現況：** 同樣是 sub-text，`0.65rem`、`0.68rem`、`0.7rem`、`0.72rem`、`0.75rem`、`0.78rem`、`0.8rem` 全部出現；padding 也是 `0.2rem 0.45rem`、`0.25rem 0.5rem`、`0.25rem 0.6rem`、`0.25rem 0.75rem`、`0.3rem 0.6rem` 亂飛
- **修法：** 立 spacing scale token `--space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem; --space-5: 1.25rem; --space-6: 1.5rem;`，並強制所有 padding/gap/margin 用 token；font-size 全部走 `var(--text-*)`，禁用 inline 數值字級
- **工程量：** L（但可分批，先換 metric/card/btn）

---

## 🟡 視覺 Major（細看就發現）

### 5. occupancy 矩陣手機字級不協調，pay badge 太搶眼
- **位置：** `css/style.css:4583` `.occ-table { font-size: 0.72rem; }`、`:1443-1463` `.occ-pay-badge` 純飽和 `#16a34a / #f59e0b / #dc2626`
- **修法：** badge 改成 `background: rgba(34,148,110,0.18); color: var(--color-success);`（用 token light 版本），尺寸不變但飽和度 -50%；日期字級在手機補回 0.78rem、padding 從 `0.4rem 0.3rem` → `0.5rem 0.4rem`
- **工程量：** S

### 6. contract row card 上排 4 欄在手機塌成 2 欄，但 label 缺失
- **位置：** `css/style.css:4311-4344`
- **修法：** 手機在 `.crc-tenant` 前加微 icon `ph-user` muted 色、`.crc-amount` 前加 `$` 前綴的 cell-label 微字
- **工程量：** S（注意：合約頁桌面已還原為原 7 欄表格，此項僅影響手機自動卡片化版本）

### 7. dashboard 待辦卡 inline style 寫死字級
- **位置：** `js/views/dashboard.js:283-329`
- **修法：** 抽 class `.todo-item`，padding `var(--space-3) 0`，divider 改 `border-top: 1px solid rgba(15,23,42,0.05)`；action 按鈕用 `.btn-sm` token
- **工程量：** S

### 8. card-title 0.9375rem 跟內容字級 0.875rem 差距太小
- **位置：** `css/style.css:2195-2204`
- **修法：** `.card-title` 拉到 `1rem` 或 `1.0625rem`，weight 維持 600
- **工程量：** S

### 9. status-badge 缺乏 size variant
- **位置：** `css/style.css:2261-2280`
- **修法：** 加 `.status-badge.is-xs { padding: 0.1rem 0.45rem; font-size: var(--text-2xs); }`，並把矩陣 / row card 內的 badge 套上
- **工程量：** S

### 10. metric-icon 飽和 light 色塊看起來廉價
- **位置：** `css/style.css:2243-2247`
- **修法：** metric-icon 統一改：`background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color);`
- **工程量：** S

### 11. modal bottom sheet 缺乏視覺呼吸
- **位置：** `css/style.css:3855-3885`
- **修法：** 手機 `.modal-header` padding `1rem 1.25rem 0.875rem`，h3 拉到 1.25rem + weight 700；handle 跟 header 之間 gap 增加到 12px
- **工程量：** S

### 12. settings 表格手機卡片化標題消失
- **位置：** `css/style.css:4805-4853`
- **修法：** 卡片化的第一個 td 拉到 `var(--text-md)`；其他 td 的 value 字級拉到 `var(--text-sm)`、label 維持 `var(--text-2xs)` 但加 `text-transform: uppercase`
- **工程量：** S

### 13. topbar 手機標題塌成 1.0625rem，breadcrumb 又同時擠進來
- **位置：** `css/style.css:2125-2133`
- **修法：** ≤768 直接隱藏 `.page-eyebrow`，h1 拉到 1.125rem weight 600，topbar 拉到 56px
- **工程量：** S

### 14. report-card 在手機 grid 仍 2 欄，cell-value 與 cell-label 平衡不好
- **位置：** `css/style.css:622-650`
- **修法：** ≤640 `.report-summary-grid { grid-template-columns: 1fr; }`，cell-value 拉到 1.5rem
- **工程量：** S

---

## 🟢 視覺 Minor（雕琢）

| # | 問題 | 位置 | 工程量 |
|---|---|---|---|
| 15 | empty-state 圖示 emoji + Phosphor 混搭 | dashboard.js:293,310,327 reports.js:202,215 | S |
| 16 | dashboard 空床圓餅中心字 1.75rem vs 卡內其他 0.7-0.8rem 失調 | dashboard.js:263 | S |
| 17 | occ-room-header `#b45309` 棕色跟系統其他「橘」#ff8859 family 不同 | css:1280-1293 | S |
| 18 | occ-pay badge 用 `#16a34a/#f59e0b/#dc2626` 跟 token 全不一樣 | css:1453-1464 | S |
| 19 | metric-link hover `→` arrow 手機從未觸發 | css:701-713 | S |
| 20 | filter-chip 用黃色 warning 系列當 active，跟主色橘衝突 | css:2505-2543 | S |

---

## 改善方針（策略性）

### 方針 1：色彩收斂——大幅降低首屏色彩噪音
- **怎麼做：**
  - metric-icon 統一中性化
  - 收斂為「橘=系統主色 / 中性灰階=結構 / 紅=錯誤警示 / 綠=成功確認 / 黃=待處理」5 種角色
  - 新增 `--bg-elevated: #ffffff`、`--bg-base: #f7f8fa`、`--bg-sunken: #eef0f3` 做 3 層 neutral 結構

### 方針 2：Typography 階層重整
- 立明確 type scale 強度：display (1.5rem 700 -0.02em tabular-nums) → title (1.0625rem 600) → body (0.875rem 500) → meta (0.75rem 500 uppercase letter-spacing 0.04em) → micro (0.6875rem 500)
- 強制「卡片標題 vs 內文」字級差 ≥ 25%
- 數字一律加 `font-variant-numeric: tabular-nums`
- 禁用 inline `font-size`，全部走 token

### 方針 3：Spacing rhythm — 立 6 級 token 並徹底替換
- 新增 `--space-1 ... --space-6`（4 / 8 / 12 / 16 / 24 / 32 px）
- 卡片 padding 手機統一 `var(--space-4) var(--space-4)`，桌面 `var(--space-5) var(--space-6)`
- 卡片間 gap 手機 `var(--space-3)`、桌面 `var(--space-5)`

### 方針 4：卡片容器收斂——放棄 5 層 shadow / 雙弱 border + shadow
- 拿掉 `.card` border，改用較強 shadow
- shadow token 從 5 種收斂到 3 種（resting / elevated / overlay）

### 方針 5：空狀態溫度 + 內容語氣統一
- emoji 全移除，用 Phosphor
- 文案模板：「[圖示] [鼓勵性短句]」+ 灰色「[提示性說明]」
- empty-state-friendly padding 拉到 `var(--space-7) var(--space-5)`

---

## Quick Visual Wins (5 個)

### QW1（10 分鐘）：metric-icon 中性化
```css
.metric-icon {
    background: var(--bg-tertiary, #f1f5f9);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
}
/* 刪掉 .metric-icon.primary/.success/.warning/.danger/.info 4 行飽和色 */
```
→ 首屏色彩噪音降 70%

### QW2（5 分鐘）：手機 metric-value 拉回有分量
```css
@media (max-width: 768px) {
    .metric-value {
        font-size: 1.5rem;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
    }
    .metric-icon { width: 28px; height: 28px; font-size: 0.95rem; }
}
```
→ 數字終於是視覺主角

### QW3（5 分鐘）：卡片陰影強化、border 拿掉
```css
.card {
    border: none;
    box-shadow: 0 1px 3px rgba(15,23,42,0.04), 0 4px 16px -8px rgba(15,23,42,0.08);
}
.card:hover {
    box-shadow: 0 2px 6px rgba(15,23,42,0.06), 0 8px 24px -8px rgba(15,23,42,0.12);
    border: none;
}
```
→ 卡片立刻浮起來

### QW4（5 分鐘）：手機 topbar 拿掉 breadcrumb、H1 放大
```css
@media (max-width: 768px) {
    .page-eyebrow { display: none !important; }
    .topbar-left h1 { font-size: 1.125rem; font-weight: 600; }
    .topbar { height: 56px; }
}
```
→ 手機 header 更乾淨、可讀性大幅提升

### QW5（10 分鐘）：occupancy pay badge 飽和度降一半
```css
.occ-pay-paid    { background: rgba(34,148,110,0.18);  color: var(--color-success); }
.occ-pay-partial { background: rgba(184,135,31,0.18);  color: var(--color-warning-text); }
.occ-pay-unpaid  { background: rgba(177,53,53,0.18);   color: var(--color-danger); }
```
→ 矩陣表的視覺重心回到「日期 + 床位」

---

## 值得參考的 SaaS 視覺特徵

### 1. Linear — issue list 的「冷感」
- 觀察：背景 `#fafafb`、卡片無 border、無 shadow、靠 1px hairline divider 區分行；hover 才有極淺 `rgba(0,0,0,0.02)` 背景
- 套到 BMS：合約 row-card 把 border + shadow 砍掉，改成 hairline divider；hover 是極淺 bg 而非 shadow

### 2. Stripe Dashboard — number-first metric tile
- 觀察：metric 卡上方是極小灰字 label（`text-muted text-xs`），下方是巨大數字（`text-3xl weight 700 tabular-nums`），icon 不存在，狀態靠數字色或下方一行 +X.X% 趨勢
- 套到 BMS：完全照搬到 dashboard metrics-grid，icon 都拿掉、數字加 mom/yoy 趨勢

### 3. Notion — sidebar / empty state 的「禪感」
- 觀察：empty state 永遠是「淡色大圖 (低飽和插畫) + 一行鼓勵語 + 一個次要按鈕」，留白 `padding: 4rem 2rem`
- 套到 BMS：empty-state-friendly padding 拉到 `var(--space-7) var(--space-5)`，icon 從 2rem 拉到 2.5rem、opacity 0.6

### 4. Front — bottom sheet 的呼吸與層次
- 觀察：手機 sheet 上半透明 backdrop 顏色偏深（rgba(0,0,0,0.6)）、handle bar 更明顯（48×5）、標題 22px weight 700 + 副標 14px muted 上下排
- 套到 BMS：modal-overlay 手機 bg 從 `rgba(17,24,39,0.55)` 加深到 0.7；handle 從 4×36 → 5×48

### 5. Cron / Amie — calendar 矩陣的色彩節制
- 觀察：日期格只有 4 種狀態色（今天、本月、過去、未來），且全部低飽和、靠字重和透明度區分；事件 dot 才是飽和色但極小
- 套到 BMS：occupancy 表的「今天」改成「今天底色 = `rgba(0,0,0,0.04)` + 數字 weight 700 + 下方 1px 橫條 primary」

---

## 結論

手機**視覺品質的距離不在「做什麼新東西」，而在「拿掉雜訊」**。三個動作就能跨一個層級：
1. **收斂顏色**（metric-icon 中性化、pay badge 降飽和）
2. **強化 typography 主從**（metric-value 放大、card-title 拉大、subtext 收斂）
3. **卡片陰影/邊框 二選一不要兼用**

完成 5 個 Quick Wins 後系統會從「admin tool」開始走向「產品感 SaaS」；要再進一階則需要立完整 spacing token 體系並系統性替換 558 處 inline style——那是另一輪的功課。
