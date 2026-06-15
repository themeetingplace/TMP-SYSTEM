# 代管模式 Phase 1 規劃 (2026-06-15)

> 目標：把聚空間 PMS 從**單一包租模式**擴成**包租 + 代管雙模式**並存
> Phase 1 範圍：屋主主檔 + 館別綁屋主（最小可行資料模型）
> 後續 Phase 2-4：分潤帳務 / 屋主對帳單 / 屋主 portal

---

## 1. 背景：聚空間目前是怎麼運作的

**包租模式（現況）**
```
房東 ────── 月租 X ──────→ 聚空間（整租整棟）
                           │
                           ├─ 隔成床位再分租
                           ▼
                  租客 ──── 床位月租 Y ─→ 聚空間
                  (現有 PMS 全部資料都在這層)
```

**金流：**
- 聚空間付給房東「房租成本」(收支表的支出 / 房租 type)
- 租客付給聚空間「床位租金」(收入)
- 利潤 = 床位收入 ÷ 床數 − 整棟房東租金 − 水電 − ...

**目前 PMS 處理對象：** 床位、租客合約、租客帳單、維修
**目前 PMS 沒處理的：** 房東是誰、房東對帳、分潤計算

---

## 2. 代管模式：跟包租不同在哪？

**代管模式**
```
屋主 ────── 委託聚空間代管 ─→ 聚空間
                                │
                                ├─ 物色租客、簽約、收租、維修
                                ▼
                       租客 ──── 月租 Z ──→ 聚空間
                                            │
                                            ├─ 扣管理費 (e.g. 10-15%)
                                            ▼
                                          屋主收到淨額
```

**金流：**
- 屋主不付房租給聚空間（不是包租）
- 屋主給聚空間「管理權」，聚空間代收租
- 聚空間每月把租金扣除管理費後撥給屋主
- 利潤 = 管理費 (固定 % 或固定金額)

**新需要處理：**
- 屋主主檔（聯絡 / 銀行帳號 / 分潤條件）
- 每個館別屬於誰
- 每月分潤計算
- 給屋主的對帳單 / 撥款紀錄
- (未來) 屋主自己登入看自己館的狀況

---

## 3. 雙模式設計：聚空間實際同時有兩種館

從現實出發 — 聚空間 6 個館不會全部一致：
- 有些是**包租**（聚空間自己整租，屋主跟你無關）
- 有些是**代管**（屋主把房子交給聚空間管）

→ Phase 1 設計要支援「**每個館 mode 不同**」

**Building mode field：**
- `master_lease` (包租) → 屋主資訊可選填 (即使有也不需分潤計算)
- `agency` (代管) → 屋主必填，啟用分潤計算

---

## 4. Phase 1 範圍（這次要做的）

### 4.1 資料層
**新表 `owners`**（屋主主檔）
```sql
CREATE TABLE owners (
    id            text PRIMARY KEY,        -- e.g. O001
    name          text NOT NULL,
    phone         text,
    email         text,
    bank_account  text,                    -- 撥款用 (xxx 銀行 / 帳號)
    note          text,
    status        text DEFAULT 'active',
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now()
);
```

**`buildings` 表加欄位：**
```sql
ALTER TABLE buildings
    ADD COLUMN owner_id        text REFERENCES owners(id) ON DELETE SET NULL,
    ADD COLUMN mode            text DEFAULT 'master_lease',  -- 'master_lease' | 'agency'
    ADD COLUMN commission_pct  numeric(5,2),                  -- 分潤百分比 (代管才用，e.g. 12.50 = 12.5%)
    ADD COLUMN commission_flat numeric;                       -- 固定金額分潤 (擇一 with pct)
```

### 4.2 UI 層
**新頁：屋主管理 (`#owners`)**
- 跟「租客清單」差不多的 row-card 列表
- 列：屋主名 / 電話 / 銀行 / 管哪幾個館（join 顯示）
- 新增 / 編輯屋主 modal
- 進入路徑：左側選單「營運」section 新增「屋主管理」項

**修現有頁：系統設定 → 館別管理**
- 編輯館別 modal 加 3 個欄位：
  - **模式**：包租 / 代管 (segmented control)
  - **屋主**：dropdown（代管才必填，從 owners 抓）
  - **分潤條件**：百分比 OR 固定金額（代管才出現）
- 館別列表 row 加 badge：📦 包租 / 🤝 代管 + 屋主名

**修現有頁：物件管理 / 合約 / 帳務 等**
- **不動**（Phase 1 不影響日常營運流程，分潤計算留 Phase 2）

### 4.3 程式層
- `js/data.js` mockData 加 `owners: []` array + buildings 各物件補欄位
- `js/db-mapping.js` 加 owners 雙向轉換 + buildings 新欄位 (mode/owner_id/commission_*)
- `js/sync.js` TABLES 加 owners (FK 順序：在 buildings 之前)
- 新檔 `js/views/owners.js`（依現有 tenants.js 結構抄改）
- 修 `js/views/settings.js`（館別 modal 加 3 欄位）
- 修 `index.html` 加 nav 項
- 新 SQL migration `sql/18-managed-mode-phase1.sql`

### 4.4 不在 Phase 1 範圍（明確排除）
- ❌ 分潤金額自動計算（Phase 2）
- ❌ 撥款紀錄 / 屋主對帳單（Phase 2）
- ❌ 屋主自己登入 portal（Phase 3）
- ❌ 多屋主分潤一棟（Phase 4 if ever）

---

## 5. 開發步驟（建議順序）

| 步 | 動作 | 工 |
|---|---|---|
| 1 | 寫 SQL migration + 跑 Supabase | 15 分 |
| 2 | mockData / db-mapping / sync 加 owners table | 30 分 |
| 3 | 新建 owners.js view + nav 入口 | 1 小時 |
| 4 | 設定 → 館別 modal 加 3 欄位 + badge | 1 小時 |
| 5 | 端對端測：建屋主 / 綁館別 / 切模式 | 30 分 |

**總工時估：3-4 小時**

---

## 6. 待你決定的設計題

### Q1: 屋主聯絡資訊欄位夠不夠？
目前規劃：name / phone / email / bank_account / note
- 要不要加：身分證 / 地址 / LINE / 第二聯絡人？
- 銀行帳號要不要拆「銀行 / 分行 / 帳號」三欄？

### Q2: 分潤條件支援到什麼程度？
目前規劃 (簡單版)：百分比 OR 固定金額，二擇一
- 夠嗎？實際合約有沒有「先固定 X，超過部分再 Y%」這種階梯？
- 階梯分潤要不要 Phase 1 就做，還是先用「百分比 OR 固定」之後再升級？

### Q3: 房東包租模式還要不要記屋主？
目前規劃：包租模式 owner_id 可選填、commission 不要
- 包租模式也記屋主有幾個好處：
  - 知道每棟整租自誰，contract 資料完整
  - 之後產報表給法務 / 會計知道整租成本對應的對象
- 但會不會增加日常維護負擔（每加新館就要建屋主）？

### Q4: 「屋主」名字要叫什麼比較自然？
- 屋主 / 房東 / 業主 / Owner？
- 同事跟你溝通時都怎麼叫？跟著用最不容易誤會

### Q5: nav 位置？
建議放「營運」section 在「租客清單」下面，或新開個 section「夥伴」放屋主：
- A 路：營運 → 物件 / 住房 / 合約 / 帳務 / 維修 / 租客 / **屋主** （順著現有清單疊）
- B 路：營運 → ... / 租客；**夥伴**: 屋主 （獨立分區，未來再加合作廠商之類）

---

## 7. 未來 Phase 預告（不在這次做）

**Phase 2：分潤帳務自動化**
- 每月閉帳時依模式計算屋主應收
- 產生「屋主對帳單」(月度 / 季度)
- 撥款紀錄 (透過帳務管理的「支出」欄)
- 跟現有 invoices / finance 整合

**Phase 3：屋主 portal**
- 屋主自己登入看自己館的狀況
- 看出租率、本月收入、對帳單下載
- 用同一套 auth 機制 (admins table 加 'owner' role) 或開新 auth

**Phase 4：多屋主 / 一棟多戶分潤**
- 一棟由多位屋主持有的場景（如果有）
- 一棟內按樓層 / 房間分潤

---

## 收尾

報告先看，看完跟我說 Q1-Q5 怎麼決定，或者直接喊「就照規劃做」，我開工。
如果有沒提到的需求（例如要對接會計軟體 / 報稅 / 屋主簽合約流程）也提出來。
