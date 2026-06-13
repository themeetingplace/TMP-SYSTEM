# LIFF 表單部署指南 — 住客資料登記

5/27 上線後做的功能。目的：讓現有住客 / 新詢問者**自己**填一張表單，
系統自動建 tenant + 綁定 LINE，管理員零打字。

完整流程：客人 LINE 按按鈕 → 開表單 → 填送 → 完成。

---

## 🧭 整體架構

```
LINE 客人按圖文選單「我是住客」
   ↓ (LIFF URL)
liff/register.html (host 在 Vercel / Supabase Storage / GitHub Pages)
   ↓ (LIFF SDK init + login)
取得 LINE userId + displayName + idToken
   ↓ (POST)
Supabase Edge Function: tenant-register
   ↓ (驗證 idToken)
寫入 tenants 表 + 綁 line_user_id
   ↓
回客人「✅ 登記完成」
```

---

## 1️⃣ LINE Developers Console — 註冊 LIFF App

### 1.1 建 LINE Login Channel（如果還沒有）

> ⚠️ LIFF 必須掛在 **LINE Login Channel** 下，不是 Messaging API Channel。
> 兩個是不同的 channel，要分開建。

- 登入 https://developers.line.biz/console/
- 進入聚空間 Provider
- 點「**Create a new channel**」→ 選 **LINE Login**
- App name：「聚空間 PMS」(歷史值「聚空間 BMS」也可繼續使用，不影響功能)
- App types：勾選 **Web app**
- 建立完成

### 1.2 在 LINE Login Channel 加 LIFF App

- 進入剛建好的 LINE Login Channel
- 上方 tab 切到 **LIFF**
- 點「**Add**」
- 填：
  - **LIFF app name**：`tenant-register`
  - **Size**：`Full`
  - **Endpoint URL**：（暫時填 `https://example.com`，下一步部署完再回來改）
  - **Scopes**：勾 `profile` + `openid`
  - **Bot link feature**：On (Aggressive)
- 按 Add → 取得 **LIFF ID** (10 位數字)
- 同時記下 **LIFF URL** 長這樣：`https://liff.line.me/XXXXXXXXXX-YYYYYYYY`

### 1.3 取得 Channel ID（用來驗 idToken）

- 在 LINE Login Channel → Basic settings tab
- 找 **Channel ID**（10 位數字）→ 記下來

---

## 2️⃣ 部署 LIFF 頁面 — 三選一

### 方法 A：Vercel（推薦，5 分鐘）

1. 把 `liff/register.html` 改名為 `index.html`，放到一個新 GitHub repo
2. https://vercel.com → Import repo → Deploy
3. 拿到 URL，例如 `https://juukan-liff.vercel.app`

### 方法 B：Supabase Storage（最快）

1. Supabase Dashboard → Storage → 建 bucket `liff` (設為 public)
2. 上傳 `liff/register.html`
3. 取得 public URL：`https://xxx.supabase.co/storage/v1/object/public/liff/register.html`

### 方法 C：跟 BMS 同站

如果 BMS 是 deploy 到 Vercel 之類，直接 push `liff/register.html` 到同 repo，URL 變成 `https://your-bms.vercel.app/liff/register.html`。

---

## 3️⃣ 填好 register.html 的 3 個常數

部署前在 `liff/register.html` 開頭找這段：

```js
const LIFF_ID = 'YOUR_LIFF_ID_HERE';
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

依序填入：
- `LIFF_ID` → 步驟 1.2 拿到的 10 位數字 (沒有 `-` 後面那段)
- `SUPABASE_URL` → 跟 BMS 用的同一個 URL
- `SUPABASE_ANON_KEY` → 跟 BMS 用的 publishable / anon key（**不是 service role key**）

存檔 → 重新部署。

---

## 4️⃣ 回 LINE Developers Console 改 LIFF Endpoint URL

- LINE Login Channel → LIFF → 編輯 `tenant-register`
- **Endpoint URL** 改成步驟 2 拿到的部署網址（要 https 開頭）
- 儲存

---

## 5️⃣ 部署 Edge Function: tenant-register

- Supabase Dashboard → Edge Functions → **Create new function**
- Name: `tenant-register`
- 把 `supabase/functions/tenant-register/index.ts` 整份貼進去
- **Deploy**

### 5.1 設 Secrets

- 同頁 → **Secrets** → Add new secret
- Name: `LINE_CHANNEL_ID`
- Value: 步驟 1.3 拿到的 Channel ID（10 位數字）
- Save

> `SUPABASE_URL` 跟 `SUPABASE_SERVICE_ROLE_KEY` 是 Supabase 自動帶的，不用設。

---

## 6️⃣ 更新 LINE 圖文選單按鈕

- 進 https://manager.line.biz/ → 圖文選單
- 找「我是房客」那一格（原本 trigger 文字「我要綁定」）
- 動作改成：
  - **動作類型**：**連結**
  - **網址**：步驟 1.2 拿到的 **LIFF URL** (`https://liff.line.me/...`)
  - **動作標籤**：「我是住客」
- 儲存 → 立刻生效

---

## ✅ 測試流程

1. 用另一個 LINE 帳號加 OA 為好友
2. 點「我是住客」按鈕 → LIFF 表單在 LINE 內開啟
3. 填寫：館別 → 床位（要是真實存在的床位）→ 姓名 → 手機 → 入住日 → 月租金 → 送出
4. 看到「✅ 登記完成」
5. BMS 後台 → 租客清單 → 應該看到新增的租客（綠色「已綁定」badge）
6. 該租客的 LINE → 已綁定，可以開始用「帳單查詢 / 維修申報 / 末5碼」等功能

---

## 🆘 疑難排解

### 「LIFF 初始化失敗」
- 檢查 LIFF_ID 是不是填對（10 位數字，沒有 `-` 後面那段）
- 確認 LIFF Endpoint URL 跟實際部署網址一致
- 必須是 https，http 不行

### 「LINE 身份驗證失敗」
- 檢查 Edge Function Secret `LINE_CHANNEL_ID` 跟 LINE Login Channel ID 一致
- 注意：是 **LINE Login Channel** 的 ID，不是 Messaging API Channel ID（兩個不同）

### 「找不到 R?-? 床位」
- 確認 BMS 該床位真的存在（看物件管理）
- 床位輸入要全大寫 + 連字號，例如 `R1-A` 不是 `r1-a` 或 `R1A`

### 「此床位已被 X 住到 Y」
- 該床位有 active 合約 → 表單擋下
- 如果是要交接，等舊合約退租後再做

### 「此 LINE 已綁定 X」
- 該 LINE 帳號已綁過別人 → 拒絕
- 解法：管理員到 BMS 把舊綁定的 line_user_id 清掉，再重試

---

## 📦 之後的優化方向

- **動態床位選單**：改成從 Supabase 即時撈該館空床，下拉選（不用打字）
- **房型 / 月租自動帶**：選了床位後 rent 自動填
- **照片上傳**：身分證 / 簽好的合約直接傳
- **送出後自動建合約**：不只建 tenant，連 contract + invoice 一起建（看 admin 流程要不要保留審核）
