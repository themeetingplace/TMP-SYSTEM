// paymentNoticeMessage.js
// LINE 繳款通知訊息組裝 — 一律用「合約當下」資料, 不吃 invoice 存的舊值
// 給 autoRenewalProcessor + contracts.js doRenew + 手動「重發繳款通知」共用
//
// 為什麼要這個: 若用戶編輯合約日期後, invoice.dueDate/period 可能同步不及
// (cascade 有 edge case), 造成 LINE 顯示舊值. 一律用 contract 當下值最安全.

import { mockData, applyRentRules, leaseEndISO } from '../data.js';

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 抓合約首張帳單存的加減項目, 過濾掉「跟目前 rentRules 規則同名」的項目
// (那些交給 applyRentRules 現算, 避免用到帳單建立當下的舊月份標籤 / 舊金額)
// 剩下的視為手動加項 (例如「多一天」這種一次性費用), 這種東西只存在帳單上,
// 合約物件本身沒有欄位可以 fresh 算, 一定要從帳單撈
function getManualAdjustments(contract) {
    if (!contract?.id) return [];
    // periodStart 要對到現在這個 contract.startDate — previewRenewalFor 會拿舊合約
    // 的 id 組一個「假想新期間」的 virtual contract, 那種情況下舊帳單的手動加項
    // (例如上一期的「多一天」) 不該被誤帶進這一期的預覽
    const invoice = mockData.invoices
        .filter(i => i.contractId === contract.id && i.direction === 'in' && i.type === '房租' && i.periodStart === contract.startDate)
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0];
    if (!invoice || !invoice.discountReason) return [];
    let arr;
    try { arr = JSON.parse(invoice.discountReason); } catch { return []; }
    if (!Array.isArray(arr)) return [];
    const ruleNames = (mockData.rentRules || []).filter(r => r.enabled !== false).map(r => r.name);
    // 月份可能是單月 "(8月)" 或帳單上被人工合併過的區間 "(8-10月)" / "(8~10月)" —
    // 兩種都代表「這筆本來就是規則算出來的」, 都要濾掉, 不然會跟 applyRentRules
    // 現算的月份項目疊加, 變成同一筆能源費多收一次 (2026-07-30 抓到 C202 多收 $1500).
    return arr.filter(a => {
        const label = String(a?.label || '');
        return !ruleNames.some(name => new RegExp(`^${escapeRegExp(name)} \\(\\d{1,2}(?:[-~～]\\d{1,2})?月\\)$`).test(label));
    });
}

// 把同一條 rentRules 規則、跨連續月份的多筆加總合併成一行給訊息顯示用
// (例如 3 筆「能源費 (8月)/(9月)/(10月)」→ 1 行「能源費 (8-10月) $1,500」),
// 跟合約編輯畫面「折扣/加收項目」的呈現顆粒度對齊 —— 純顯示層合併, 不影響
// dueAmount/adjNet 的實際計算 (那些一律用未合併的 adjustments 陣列算, 避免
// 合併邏輯本身有 bug 時反而動到金額).
function mergeMonthlyLabelsForDisplay(items) {
    const groups = new Map();
    const order = [];
    items.forEach(a => {
        const m = String(a?.label || '').match(/^(.+) \((\d{1,2})月\)$/);
        if (!m) {
            const key = `__raw__${order.length}`;
            groups.set(key, { label: a.label, kind: a.kind, amount: Number(a.amount) || 0 });
            order.push(key);
            return;
        }
        const [, name, monthStr] = m;
        const key = `${name}__${a.kind}`;
        if (!groups.has(key)) {
            groups.set(key, { name, kind: a.kind, amount: 0, months: [] });
            order.push(key);
        }
        const g = groups.get(key);
        g.amount += Number(a.amount) || 0;
        g.months.push(Number(monthStr));
    });
    return order.map(key => {
        const g = groups.get(key);
        if (!g.months) return { label: g.label, kind: g.kind, amount: g.amount };
        const sorted = [...new Set(g.months)].sort((x, y) => x - y);
        const isConsecutive = sorted.every((m, i) => i === 0 || m === sorted[i - 1] + 1);
        const monthLabel = sorted.length === 1
            ? `${sorted[0]}月`
            : isConsecutive
                ? `${sorted[0]}-${sorted[sorted.length - 1]}月`
                : `${sorted.join('、')}月`;
        return { label: `${g.name} (${monthLabel})`, kind: g.kind, amount: g.amount };
    });
}

export function buildPaymentNoticeMessage(contract, opts = {}) {
    if (!contract) return { message: '', dueAmount: 0, dueDate: null };

    const { includeRenewalGreeting = false } = opts;

    // === 一律用合約當下的資料 ===
    const dueDate = contract.startDate;
    const period = `${contract.startDate || '—'} ~ ${contract.endDate || '—'}`;
    const propertyShort = String(contract.propertyName || '').replace('聚空間 - ', '');

    // === 金額 fresh 算 (含 rentRules adjustments) ===
    const term = contract.termMonths || 1;
    // bundle 主合約: 併入子合約 rent
    const childRents = mockData.contracts
        .filter(c => c.bundleParentContractId === contract.id)
        .reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const monthlyRent = (Number(contract.amount) || 0) + childRents;  // 月租金 (bundle 併子床)
    const baseRent = monthlyRent * term;                              // 全期租金 = 月租 × 期數

    // Apply rent rules (fresh 算, 標籤月份永遠正確) + 帳單上的手動加項 (fresh 算不出來的部分)
    const adjustments = [...applyRentRules(contract), ...getManualAdjustments(contract)];
    const adjNet = adjustments.reduce((s, a) => s + (a.kind === 'add' ? a.amount : -a.amount), 0);
    // discount = 負(=加收) or 正(=折扣); 應收 = base - discount
    // (跟 buildContractInvoice 同語意, 但這裡直接算應繳)
    const dueAmount = Math.max(0, Math.round(baseRent + adjNet));

    const adjLines = mergeMonthlyLabelsForDisplay(adjustments)
        .map(a => `　　${a.kind === 'sub' ? '折抵' : '加項'}: ${a.label} $${Math.abs(a.amount).toLocaleString()}`)
        .join('\n');

    // === 算式列出來 (2026-08-01 用戶要求): 月租金 × 期數 + 加項 − 折抵 = 應繳金額 ===
    const totalAdd = adjustments.filter(a => a.kind === 'add').reduce((s, a) => s + Math.abs(a.amount), 0);
    const totalSub = adjustments.filter(a => a.kind === 'sub').reduce((s, a) => s + Math.abs(a.amount), 0);
    const formulaParts = [`月租金 $${monthlyRent.toLocaleString()} × ${term} 個月`];
    if (totalAdd) formulaParts.push(`+ 加項 $${totalAdd.toLocaleString()}`);
    if (totalSub) formulaParts.push(`− 折抵 $${totalSub.toLocaleString()}`);
    const formulaLine = `🧮 ${formulaParts.join(' ')} = $${dueAmount.toLocaleString()}`;

    // 合約期間 (斜線格式, 例 2026/09/12~2026/12/11)
    const periodSlash = `${(contract.startDate || '').replace(/-/g, '/') || '—'}~${(contract.endDate || '').replace(/-/g, '/') || '—'}`;

    // === 組訊息 ===
    const greeting = includeRenewalGreeting
        ? `感謝您回覆續租!\n\n🔄 已為您建立續租合約 ${contract.id}`
        : `📄 合約 ${contract.id} 繳款通知`;

    const message = `${contract.tenant} 您好 ☺️

${greeting}
📍 ${propertyShort}

🔔 應繳金額: NT$${dueAmount.toLocaleString()}
📅 合約期間: ${periodSlash}
月租金：$${monthlyRent.toLocaleString()}${adjLines ? '\n細項:\n' + adjLines : ''}
${formulaLine}

繳款完成後, 請回傳「銀行帳戶末 5 碼」(5 位數字), 系統會自動記錄 ✨
入帳後合約 PDF 會自動寄給您.`;

    return { message, dueAmount, dueDate, period };
}

// 假設「現在確認續約」會產生的新合約期間 + 應繳金額 — 給續約前的預覽用
// (首頁續租流程卡片 + 合約管理「確認續約」勾選 modal 共用, 保證兩處看到的
// 數字跟之後真的按確認送出時 100% 一致, 不會有兩套算法對不上的風險)
// opts.overrideAmount: 若 admin 在確認前調整了月租, 傳這個算出來的預覽才會反映新金額
export function previewRenewalFor(oldContract, opts = {}) {
    const term = oldContract.termMonths || 1;
    const newStart = oldContract.endDate;
    const newEnd = leaseEndISO(newStart, term);
    const amount = opts.overrideAmount != null ? Number(opts.overrideAmount) : oldContract.amount;
    const virtualContract = { ...oldContract, startDate: newStart, endDate: newEnd, amount };
    const { dueAmount } = buildPaymentNoticeMessage(virtualContract, {});
    return { newStart, newEnd, dueAmount };
}
