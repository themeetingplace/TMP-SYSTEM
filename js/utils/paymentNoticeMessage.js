// paymentNoticeMessage.js
// LINE 繳款通知訊息組裝
// 給 autoRenewalProcessor + contracts.js doRenew + 手動「重發繳款通知」共用
//
// 已建立帳單的通知：金額與加減項目一律以 invoice 為準。
// 尚未建立帳單的續約預覽：才依合約套用目前的租金規則。

import { mockData, applyRentRules, leaseEndISO } from '../data.js';
import { invoiceAdjustments, invoiceDueAmount } from './invoicePaymentSummary.js';

function findRentInvoice(contract) {
    if (!contract?.id) return null;
    return mockData.invoices
        .filter(i => i.contractId === contract.id && i.direction === 'in' && i.type === '房租' && i.periodStart === contract.startDate)
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0];
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

    const { includeRenewalGreeting = false, invoice: suppliedInvoice } = opts;
    const invoice = suppliedInvoice || findRentInvoice(contract) || null;

    // 日期與房間資訊用合約；既有帳單的到期日與金額則以帳單快照為準。
    const dueDate = invoice?.dueDate || contract.startDate;
    const period = `${contract.startDate || '—'} ~ ${contract.endDate || '—'}`;
    const propertyShort = String(contract.propertyName || '').replace('聚空間 - ', '');

    // === 應收金額 ===
    const term = contract.termMonths || 1;
    // bundle 主合約: 併入子合約 rent
    const childRents = mockData.contracts
        .filter(c => c.bundleParentContractId === contract.id)
        .reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const monthlyRent = (Number(contract.amount) || 0) + childRents;  // 月租金 (bundle 併子床)
    const baseRent = monthlyRent * term;                              // 全期租金 = 月租 × 期數

    // 已建立帳單：直接使用帳單保存的有效細項（包含建立時真正套用的自動/手動項目）。
    // 預覽：沒有帳單時才依目前規則計算。
    const adjustments = invoice ? invoiceAdjustments(invoice) : applyRentRules(contract);
    const adjNet = adjustments.reduce((s, a) => s + (a.kind === 'add' ? a.amount : -a.amount), 0);
    const dueAmount = invoice
        ? invoiceDueAmount(invoice)
        : Math.max(0, Math.round(baseRent + adjNet));

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
