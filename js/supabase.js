// Supabase Configuration
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabaseUrl = 'https://mkatwwouurwxlruisqwe.supabase.co';
const supabaseKey = 'sb_publishable__CepJC3ggYmoXBXSx0ETxA_0_RnWJCY';

export const supabase = createClient(supabaseUrl, supabaseKey);

// P2-2: 只在 localhost 暴露到 window (production 不要讓用戶 console 直接打 sb)
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.sb = supabase;
    window.supabaseClient = supabase;
    console.log('[dev] window.sb / window.supabaseClient available');
}

// Database Tables Schema (for reference)
/*
Tables to create in Supabase:

1. properties
   - id: uuid (primary key)
   - name: text
   - address: text
   - type: text
   - status: text
   - rent: integer
   - tenant_id: uuid (foreign key to tenants)
   - contract_end: date
   - created_at: timestamp
   - updated_at: timestamp

2. tenants
   - id: uuid (primary key)
   - name: text
   - phone: text
   - email: text
   - current_property_id: uuid (foreign key to properties)
   - status: text
   - emergency_contact: text
   - created_at: timestamp
   - updated_at: timestamp

3. contracts
   - id: uuid (primary key)
   - property_id: uuid (foreign key to properties)
   - tenant_id: uuid (foreign key to tenants)
   - sign_date: date
   - end_date: date
   - amount: integer
   - status: text
   - created_at: timestamp
   - updated_at: timestamp

4. invoices
   - id: uuid (primary key)
   - property_id: uuid (foreign key to properties)
   - tenant_id: uuid (foreign key to tenants)
   - type: text
   - amount: integer
   - due_date: date
   - paid_date: date
   - status: text
   - created_at: timestamp
   - updated_at: timestamp

5. maintenances
   - id: uuid (primary key)
   - property_id: uuid (foreign key to properties)
   - issue: text
   - reporter: text
   - report_date: date
   - status: text
   - cost: integer
   - created_at: timestamp
   - updated_at: timestamp

6. checkins
   - id: uuid (primary key)
   - tenant_id: uuid (foreign key to tenants)
   - property_id: uuid (foreign key to properties)
   - scheduled_date: date
   - status: text
   - tasks: jsonb
   - created_at: timestamp
   - updated_at: timestamp

7. users (for authentication)
   - id: uuid (primary key, from auth.users)
   - email: text
   - full_name: text
   - role: text
   - company_name: text
   - phone: text
   - created_at: timestamp
   - updated_at: timestamp
*/