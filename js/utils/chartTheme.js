// Chart palette 從 :root --chart-* token 讀出來，dashboard / reports 共用
// 改色只改一處 (css/style.css :root)；切 dark mode 也能用同套機制
// Chart.js 沒辦法直接吃 CSS variable (它要 literal hex/rgba)，所以這裡用 getComputedStyle 取值

export function getChartColors() {
    const css = getComputedStyle(document.documentElement);
    const read = name => css.getPropertyValue(name).trim();
    const cats = [];
    for (let i = 1; i <= 8; i++) cats.push(read(`--chart-cat-${i}`) || '#999');
    return {
        income: read('--chart-income') || '#22946e',
        expense: read('--chart-expense') || '#b13535',
        fillIncome: read('--chart-fill-income') || 'rgba(34, 148, 110, 0.10)',
        fillExpense: read('--chart-fill-expense') || 'rgba(177, 53, 53, 0.08)',
        grid: read('--chart-grid') || 'rgba(15, 23, 42, 0.06)',
        axis: read('--chart-axis-text') || '#6b7280',
        surface: read('--color-surface') || '#ffffff',
        primary: read('--color-primary') || '#ff8859',
        cats
    };
}
