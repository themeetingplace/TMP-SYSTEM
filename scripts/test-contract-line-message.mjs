import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildContractLineMessage, contractPaidAmount } from '../js/utils/contractLineMessage.js';

const contract = {
    id: 'C285',
    tenant: '王小明',
    startDate: '2026-10-19',
    endDate: '2026-11-18'
};
const invoice = {
    amount: 9500,
    discount: 150,
    paidAmount: 9000,
    status: '部分繳款'
};

assert.equal(contractPaidAmount(invoice), 9000);
assert.equal(buildContractLineMessage(contract, invoice),
`王小明 您好，這是您的合約 (C285)
租期：2026-10-19 ~ 2026-11-18
本期已繳費用：$9,000

連結 24 小時內有效
請下載後填寫，完成後回傳給我們🙌🏻`);

// 舊資料只有已繳清狀態、未保存 paidAmount 時，以最後應收作為已繳金額。
assert.equal(contractPaidAmount({ amount: 9500, discount: 150, paidAmount: 0, status: '已繳清' }), 9350);

// 有效期限只在主文字出現一次，下載連結泡泡不重複顯示。
const linePushSource = readFileSync(new URL('../supabase/functions/line-push/index.ts', import.meta.url), 'utf8');
assert.ok(!linePushSource.includes('(連結 24 小時內有效)'), '下載連結泡泡不應重複有效期限');

console.log('contract LINE message regression checks passed');
