// 帳務管理三個子分頁共用的狀態 (檢視月份 / 分組模式)
// 在一個分頁切月份，跳到另一個分頁仍顯示同月，UX 比較一致
import { currentMonth } from '../data.js';

export const financeState = {
    viewMonth: currentMonth(),
    viewGrouping: 'building' // 'building' | 'group'
};
