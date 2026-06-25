// 聚空間 PMS 術語常數 — 用戶強約定
//
// 房租 (RENT_IN)  = 住客 → 我們 (收入)
// 房東租金 (RENT_OUT) = 我們 → 房東 (支出)
//
// 絕對不能混用「租金」這個詞 (歧義), 全站只用 RENT_IN / RENT_OUT 常數
// 顯示文字 / chip label / invoice type / form option 一律對齊
//
// (audit: 之前 reports.js detectLandlordRent 用 /租金|房租|房東/ 模糊配對
//  可能把住客房租誤分類成房東支出, 財報邊界破洞)

export const RENT_IN = '房租';       // 收入: 住客付給我們
export const RENT_OUT = '房東租金';   // 支出: 我們付給房東

// 嚴格判定 (用 === 不用 regex 模糊)
export function isRentIn(invoiceType) {
    return invoiceType === RENT_IN;
}

export function isRentOut(invoiceType) {
    return invoiceType === RENT_OUT;
}

// 給 UI 顯示用 — 帶方向上下文
export function rentLabel(direction) {
    return direction === 'in' ? RENT_IN : RENT_OUT;
}
