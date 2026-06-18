// 收支分析 — 從原 帳務管理 拆出來的「各館/群組收支」+「本月分類分析(交叉表)」
// 跟 finance.js 共用 financeState.viewMonth (切月份會同步)

import { mockData, invoiceMonth, shiftMonth, currentMonth, formatMonthLabel, isSettled, getSortedBuildings, invoiceActualAmount as actualAmount } from '../data.js';
import { refreshView } from '../utils/ui.js';
import { financeState } from './finance-state.js';
import { exportAnalysisReport } from './analysis-export.js';
import { renderFinanceSubTabs } from '../utils/financeSubTabs.js';
// actualAmount 從 data.js import (P1-13 抽共用)
function computeAgg(invoices) {
    const inAll = invoices.filter(i => i.direction === 'in').reduce((s, i) => s + actualAmount(i), 0);
    const outAll = invoices.filter(i => i.direction === 'out').reduce((s, i) => s + actualAmount(i), 0);
    const landlordRent = invoices.filter(i => i.direction === 'out' && i.type === '房東租金').reduce((s, i) => s + actualAmount(i), 0);
    const net = inAll - outAll;
    const grossMargin = inAll > 0 ? (inAll - landlordRent) / inAll : 0;
    const netMargin = inAll > 0 ? net / inAll : 0;
    return { inAll, outAll, landlordRent, net, grossMargin, netMargin };
}
const pct = v => `${(v * 100).toFixed(1)}%`;

export function renderAnalysis() {
    const { viewMonth, viewGrouping } = financeState;
    const monthInvoices = mockData.invoices.filter(inv => isSettled(inv) && invoiceMonth(inv) === viewMonth);
    const summary = computeAgg(monthInvoices);

    const activeBuildings = getSortedBuildings({ activeOnly: true });

    // === 各館 / 群組聚合 ===
    let unitRows;
    if (viewGrouping === 'group') {
        const groups = {};
        activeBuildings.forEach(b => {
            const g = b.group || b.name;
            if (!groups[g]) groups[g] = { label: g, buildings: [], invoices: [] };
            groups[g].buildings.push(b);
        });
        monthInvoices.forEach(inv => {
            const b = activeBuildings.find(x => x.id === inv.buildingId);
            if (!b) return;
            const g = b.group || b.name;
            if (groups[g]) groups[g].invoices.push(inv);
        });
        unitRows = Object.values(groups).map(g => ({
            label: g.label,
            sub: g.buildings.map(b => b.name).join(' + '),
            ...computeAgg(g.invoices)
        }));
    } else {
        unitRows = activeBuildings.map(b => ({
            label: b.name,
            sub: b.group ? `群組：${b.group}` : '',
            ...computeAgg(monthInvoices.filter(inv => inv.buildingId === b.id))
        }));
    }
    const maxIn = Math.max(1, ...unitRows.map(r => r.inAll));

    // === 分類分析（交叉表）===
    const incomeTypes = [...new Set(monthInvoices.filter(i => i.direction === 'in').map(i => i.type))];
    const expenseTypes = [...new Set(monthInvoices.filter(i => i.direction === 'out').map(i => i.type))];
    const matrixCols = activeBuildings;

    const cellSum = (direction, type, buildingId) =>
        monthInvoices.filter(i => i.direction === direction && i.type === type && i.buildingId === buildingId)
            .reduce((s, i) => s + actualAmount(i), 0);
    const rowTotal = (direction, type) =>
        monthInvoices.filter(i => i.direction === direction && i.type === type)
            .reduce((s, i) => s + actualAmount(i), 0);
    const colSum = (direction, buildingId) =>
        monthInvoices.filter(i => i.direction === direction && i.buildingId === buildingId)
            .reduce((s, i) => s + actualAmount(i), 0);
    const totalSum = (direction) =>
        monthInvoices.filter(i => i.direction === direction)
            .reduce((s, i) => s + actualAmount(i), 0);

    const renderMatrixRow = (direction, type, color) => {
        const cells = matrixCols.map(b => {
            const v = cellSum(direction, type, b.id);
            return `<td class="m-cell ${v > 0 ? 'has-val' : ''}" style="color: ${v > 0 ? color : 'var(--text-muted)'};">${v > 0 ? '$' + v.toLocaleString() : '—'}</td>`;
        }).join('');
        const total = rowTotal(direction, type);
        return `<tr><td class="m-type">${type}</td>${cells}<td class="m-total" style="color: ${color};">${total > 0 ? '$' + total.toLocaleString() : '—'}</td></tr>`;
    };

    const matrixHtml = monthInvoices.length === 0
        ? '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">本月尚無已結帳目</div>'
        : `
        <div class="matrix-wrap">
            <table class="matrix-table">
                <thead>
                    <tr>
                        <th class="m-type">類型</th>
                        ${matrixCols.map(b => `<th>${b.name}</th>`).join('')}
                        <th class="m-total">合計</th>
                    </tr>
                </thead>
                <tbody>
                    ${incomeTypes.length > 0 ? `
                        <tr class="m-section-row is-income"><td colspan="${matrixCols.length + 2}"><i class="ph ph-arrow-down"></i> 收入</td></tr>
                        ${incomeTypes.map(t => renderMatrixRow('in', t, 'var(--color-success)')).join('')}
                        <tr class="m-subtotal is-income">
                            <td class="m-type">收入合計</td>
                            ${matrixCols.map(b => {
                                const v = colSum('in', b.id);
                                return `<td>${v > 0 ? '<strong style="color: var(--color-success);">$' + v.toLocaleString() + '</strong>' : '—'}</td>`;
                            }).join('')}
                            <td class="m-total"><strong style="color: var(--color-success);">$${totalSum('in').toLocaleString()}</strong></td>
                        </tr>
                    ` : ''}
                    ${expenseTypes.length > 0 ? `
                        <tr class="m-section-row is-expense"><td colspan="${matrixCols.length + 2}"><i class="ph ph-arrow-up"></i> 支出</td></tr>
                        ${expenseTypes.map(t => renderMatrixRow('out', t, 'var(--color-danger)')).join('')}
                        <tr class="m-subtotal is-expense">
                            <td class="m-type">支出合計</td>
                            ${matrixCols.map(b => {
                                const v = colSum('out', b.id);
                                return `<td>${v > 0 ? '<strong style="color: var(--color-danger);">$' + v.toLocaleString() + '</strong>' : '—'}</td>`;
                            }).join('')}
                            <td class="m-total"><strong style="color: var(--color-danger);">$${totalSum('out').toLocaleString()}</strong></td>
                        </tr>
                    ` : ''}
                    <tr class="m-net-row">
                        <td class="m-type"><strong>淨收益</strong></td>
                        ${matrixCols.map(b => {
                            const net = colSum('in', b.id) - colSum('out', b.id);
                            return `<td><strong style="color: ${net >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${net < 0 ? '-' : ''}$${Math.abs(net).toLocaleString()}</strong></td>`;
                        }).join('')}
                        <td class="m-total"><strong style="color: ${summary.net >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${summary.net < 0 ? '-' : ''}$${Math.abs(summary.net).toLocaleString()}</strong></td>
                    </tr>
                    <tr class="m-margin-row">
                        <td class="m-type">毛利率</td>
                        ${matrixCols.map(b => {
                            const i = colSum('in', b.id);
                            const lr = monthInvoices.filter(x => x.direction === 'out' && x.type === '房東租金' && x.buildingId === b.id).reduce((s, x) => s + (x.amount || 0), 0);
                            const gm = i > 0 ? (i - lr) / i : 0;
                            return `<td style="color: ${gm >= 0 ? 'var(--text-muted)' : 'var(--color-danger)'}; font-size: var(--text-sm);">${i > 0 ? pct(gm) : '—'}</td>`;
                        }).join('')}
                        <td class="m-total" style="color: ${summary.grossMargin >= 0 ? 'var(--text-muted)' : 'var(--color-danger)'};">${summary.inAll > 0 ? pct(summary.grossMargin) : '—'}</td>
                    </tr>
                    <tr class="m-margin-row">
                        <td class="m-type">淨利率</td>
                        ${matrixCols.map(b => {
                            const i = colSum('in', b.id);
                            const o = colSum('out', b.id);
                            const nm = i > 0 ? (i - o) / i : 0;
                            return `<td style="color: ${nm >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}; font-size: var(--text-sm);">${i > 0 ? pct(nm) : '—'}</td>`;
                        }).join('')}
                        <td class="m-total" style="color: ${summary.netMargin >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${summary.inAll > 0 ? pct(summary.netMargin) : '—'}</td>
                    </tr>
                </tbody>
            </table>
        </div>`;

    return `
        ${renderFinanceSubTabs('analysis')}
        <div class="month-switcher">
            <button class="btn btn-outline btn-sm" data-month-action="prev">
                <i class="ph ph-caret-left"></i> 上個月
            </button>
            <div class="month-switcher__label">
                <strong>${formatMonthLabel(viewMonth)}</strong>
            </div>
            <div class="month-switcher__right">
                <button class="btn btn-outline btn-sm" id="btn-export-analysis-pdf" title="匯出當月收支分析為 PDF">
                    <i class="ph ph-file-pdf"></i> 匯出 PDF
                </button>
                <button class="btn btn-outline btn-sm" data-month-action="this">本月</button>
                <button class="btn btn-outline btn-sm" data-month-action="next">
                    下個月 <i class="ph ph-caret-right"></i>
                </button>
            </div>
        </div>

        <!-- 各館 / 群組收支 -->
        <div class="card" style="margin-bottom: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-buildings"></i> ${viewGrouping === 'group' ? '各群組' : '各館'}收支 — ${formatMonthLabel(viewMonth)}</h2>
                <div class="chart-mode-toggle" role="group">
                    <button type="button" class="chart-mode-btn ${viewGrouping === 'building' ? 'active' : ''}" data-grouping="building">按館別</button>
                    <button type="button" class="chart-mode-btn ${viewGrouping === 'group' ? 'active' : ''}" data-grouping="group">按群組</button>
                </div>
            </div>
            <div class="building-finance-grid">
                ${unitRows.length === 0
                    ? '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">尚無資料</div>'
                    : unitRows.map(r => {
                        const widthPct = r.inAll > 0 ? Math.round(r.inAll / maxIn * 100) : 0;
                        return `
                        <div class="bf-row">
                            <div class="bf-name">
                                <strong>${r.label}</strong>
                                <span class="bf-rate ${r.net >= 0 ? 'good' : 'low'}">${r.net >= 0 ? '獲利' : '虧損'} $${Math.abs(r.net).toLocaleString()}</span>
                                ${r.sub ? `<span style="font-size: var(--text-2xs); color: var(--text-muted);">${r.sub}</span>` : ''}
                            </div>
                            <div class="bf-bar"><div class="bf-bar-fill" style="width: ${widthPct}%;"></div></div>
                            <div class="bf-stats">
                                <span><span class="bf-label">收入</span><strong style="color: var(--color-success);">$${r.inAll.toLocaleString()}</strong></span>
                                <span><span class="bf-label">支出</span><strong style="color: var(--color-warning);">$${r.outAll.toLocaleString()}</strong></span>
                                <span><span class="bf-label">毛利率</span><strong>${r.inAll > 0 ? pct(r.grossMargin) : '—'}</strong></span>
                                <span><span class="bf-label">淨利率</span><strong style="color: ${r.netMargin >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${r.inAll > 0 ? pct(r.netMargin) : '—'}</strong></span>
                            </div>
                        </div>
                        `;
                    }).join('')}
            </div>
        </div>

        <!-- 分類交叉表 -->
        <div class="card">
            <h2 class="card-title"><i class="ph ph-chart-bar"></i> 分類交叉分析 — ${formatMonthLabel(viewMonth)}</h2>
            ${matrixHtml}
        </div>
    `;
}

export function initAnalysisActions(scope) {
    scope.querySelectorAll('[data-month-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.monthAction;
            if (action === 'prev') financeState.viewMonth = shiftMonth(financeState.viewMonth, -1);
            else if (action === 'next') financeState.viewMonth = shiftMonth(financeState.viewMonth, 1);
            else if (action === 'this') financeState.viewMonth = currentMonth();
            refreshView();
        });
    });
    scope.querySelectorAll('[data-grouping]').forEach(btn => {
        btn.addEventListener('click', () => {
            financeState.viewGrouping = btn.dataset.grouping;
            refreshView();
        });
    });
    scope.querySelector('#btn-export-analysis-pdf')?.addEventListener('click', () => {
        exportAnalysisReport(financeState.viewMonth);
    });
}
