// paymentNoticeMessage.js
// LINE 繳款通知訊息組裝 — 一律用「合約當下」資料, 不吃 invoice 存的舊值
// 給 autoRenewalProcessor + contracts.js doRenew + 手動「重發繳款通知」共用
//
// 為什麼要這個: 若用戶編輯合約日期後, invoice.dueDate/period 可能同步不及
// (cascade 有 edge case), 造成 LINE 顯示舊值. 一律用 contract 當下值最安全.

import { mockData, applyRentRules, leaseEndISO } from '../data.js';

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
    const baseRent = ((Number(contract.amount) || 0) + childRents) * term;

    // Apply rent rules → 產生 adjustments
    const adjustments = applyRentRules(contract);
    const adjNet = adjustments.reduce((s, a) => s + (a.kind === 'add' ? a.amount : -a.amount), 0);
    // discount = 負(=加收) or 正(=折扣); 應收 = base - discount
    // (跟 buildContractInvoice 同語意, 但這裡直接算應繳)
    const dueAmount = Math.max(0, Math.round(baseRent + adjNet));

    const adjLines = adjustments
        .map(a => `　　${a.kind === 'sub' ? '折抵' : '加項'}: ${a.label} $${Math.abs(a.amount).toLocaleString()}`)
        .join('\n');

    // === 組訊息 ===
    const greeting = includeRenewalGreeting
        ? `感謝您回覆續租!\n\n🔄 已為您建立續租合約 ${contract.id}`
        : `📄 合約 ${contract.id} 繳款通知`;

    const message = `${contract.tenant} 您好 ☺️

${greeting}
📍 ${propertyShort}
📅 期間: ${period}

🔔 應繳金額: NT$${dueAmount.toLocaleString()}
應繳日: ${dueDate || '—'}${adjLines ? '\n\n細項:\n' + adjLines : ''}

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
