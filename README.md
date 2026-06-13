# 聚空間 PMS 物件管理系統 (Property Management System)

## 🚀 快速開始

### 1. 環境準備
- 安裝 Python 3.x 或 Node.js
- 下載專案檔案

### 2. 本地運行
```bash
# 使用 Python
python -m http.server 8000

# 或使用 Node.js
npx serve .
```

訪問 http://localhost:8000

## 🗄️ Supabase 資料庫設置

### 步驟 1: 創建 Supabase 專案
1. 前往 [Supabase](https://supabase.com)
2. 註冊/登入帳號
3. 點擊 "New Project"
4. 填入專案資訊：
   - Name: `jushih-bms`
   - Database Password: 設定安全密碼
   - Region: 選擇最近的地區

### 步驟 2: 獲取 API 憑證
1. 在專案儀表板中，進入 "Settings" > "API"
2. 複製以下資訊：
   - Project URL
   - anon/public API Key

### 步驟 3: 創建資料庫表格

**如果表格已存在，請先執行清理腳本：**

```sql
-- 清理現有表格（如果需要重新開始）
DROP TABLE IF EXISTS checkins CASCADE;
DROP TABLE IF EXISTS maintenances CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS contracts CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
DROP TABLE IF EXISTS properties CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
```

**然後執行表格創建腳本：**

```sql

```sql
-- 啟用 UUID 擴展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 建立屬性表格
CREATE TABLE properties (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '待租',
    rent INTEGER NOT NULL,
    tenant_id UUID,
    contract_end DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 建立租客表格
CREATE TABLE tenants (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    current_property_id UUID REFERENCES properties(id),
    status TEXT NOT NULL DEFAULT '待入住',
    emergency_contact TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 建立合約表格
CREATE TABLE contracts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    property_id UUID REFERENCES properties(id) NOT NULL,
    tenant_id UUID REFERENCES tenants(id) NOT NULL,
    sign_date DATE,
    end_date DATE NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT '待簽署',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 建立帳單表格
CREATE TABLE invoices (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    property_id UUID REFERENCES properties(id) NOT NULL,
    tenant_id UUID REFERENCES tenants(id) NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    due_date DATE NOT NULL,
    paid_date DATE,
    status TEXT NOT NULL DEFAULT '欠繳',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 建立維修表格
CREATE TABLE maintenances (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    property_id UUID REFERENCES properties(id) NOT NULL,
    issue TEXT NOT NULL,
    reporter TEXT NOT NULL,
    report_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT '待處理',
    cost INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 建立入住表格
CREATE TABLE checkins (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id) NOT NULL,
    property_id UUID REFERENCES properties(id) NOT NULL,
    scheduled_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT '待確認',
    tasks JSONB DEFAULT '{"contract": false, "deposit": false, "keys": false, "conditionReport": false}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 建立使用者設定檔表格
CREATE TABLE profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    company_name TEXT,
    phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 設定 RLS (Row Level Security)
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenances ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 建立 RLS 政策 (所有使用者都可以讀取)
CREATE POLICY "Enable read access for all users" ON properties FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON tenants FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON contracts FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON invoices FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON maintenances FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON checkins FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON profiles FOR SELECT USING (true);

-- 允許認證使用者進行寫入操作
CREATE POLICY "Enable insert for authenticated users" ON properties FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Enable update for authenticated users" ON properties FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for authenticated users" ON tenants FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Enable update for authenticated users" ON tenants FOR UPDATE USING (auth.role() = 'authenticated');
-- ... 為其他表格重複此模式
```

### 步驟 4: 配置應用程式

1. 編輯 `js/supabase.js` 文件
2. 將 `YOUR_SUPABASE_URL` 替換為您的 Project URL
3. 將 `YOUR_SUPABASE_ANON_KEY` 替換為您的 anon/public API Key

### 步驟 5: 匯入測試資料

在 Supabase SQL Editor 中執行以下 SQL 來匯入測試資料：

```sql
-- 插入測試屬性資料
INSERT INTO properties (name, address, type, status, rent, contract_end) VALUES
('聚空間 - 中山館 A房', '台北市中山區中山北路二段 10 號 3F', '獨立套房', '已出租', 18000, '2026-12-31'),
('聚空間 - 中山館 B房', '台北市中山區中山北路二段 10 號 3F', '獨立套房', '待租', 16000, NULL),
('聚空間 - 信義館 101室', '台北市信義區信義路五段 7 號 5F', '家庭式公寓', '維修中', 32000, NULL),
('聚空間 - 信義館 102室', '台北市信義區信義路五段 7 號 5F', '獨立套房', '已出租', 22000, '2026-08-15'),
('聚空間 - 大安館 2A', '台北市大安區忠孝東路四段 100 號 4F', '分租套房', '待簽約', 15000, NULL);

-- 插入測試租客資料
INSERT INTO tenants (name, phone, email, status, emergency_contact) VALUES
('王大明', '0912345678', 'ming@example.com', '居住中', '王小明 (0911222333)'),
('李小芬', '0988777666', 'fen@example.com', '居住中', '李媽媽 (0988111222)'),
('張志豪', '0933444555', 'hao@example.com', '待入住', '張爸爸 (0933999888)'),
('陳建宏', '0955666777', 'hung@example.com', '居住中', '陳太太 (0955123456)');

-- 更新屬性與租客的關聯
UPDATE properties SET tenant_id = (SELECT id FROM tenants WHERE name = '王大明') WHERE name = '聚空間 - 中山館 A房';
UPDATE properties SET tenant_id = (SELECT id FROM tenants WHERE name = '李小芬') WHERE name = '聚空間 - 信義館 102室';
UPDATE properties SET tenant_id = (SELECT id FROM tenants WHERE name = '張志豪') WHERE name = '聚空間 - 大安館 2A';
UPDATE properties SET tenant_id = (SELECT id FROM tenants WHERE name = '陳建宏') WHERE name = '聚空間 - 松山館 5C';

UPDATE tenants SET current_property_id = (SELECT id FROM properties WHERE name = '聚空間 - 中山館 A房') WHERE name = '王大明';
UPDATE tenants SET current_property_id = (SELECT id FROM properties WHERE name = '聚空間 - 信義館 102室') WHERE name = '李小芬';
UPDATE tenants SET current_property_id = (SELECT id FROM properties WHERE name = '聚空間 - 大安館 2A') WHERE name = '張志豪';
UPDATE tenants SET current_property_id = (SELECT id FROM properties WHERE name = '聚空間 - 松山館 5C') WHERE name = '陳建宏';
```

## 📋 功能說明

### 已實現功能
- ✅ 響應式儀表板
- ✅ 物件管理（查看、編輯、詳細資訊）
- ✅ 合約管理
- ✅ 帳務管理
- ✅ 維修管理
- ✅ 租客管理
- ✅ 入住管理
- ✅ 帳號設定
- ✅ 資料篩選與搜尋

### 開發中功能
- 🔄 Supabase 資料庫整合
- 🔄 使用者認證
- 🔄 即時通知
- 🔄 報表匯出

## 🛠️ 技術棧

- **前端**: HTML5, CSS3, JavaScript (ES6+)
- **UI框架**: 自定義響應式設計
- **圖標**: Phosphor Icons
- **圖表**: Chart.js
- **資料庫**: Supabase (PostgreSQL)
- **部署**: 靜態網站

## 📞 支援

如有問題請聯繫開發團隊。