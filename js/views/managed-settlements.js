// 屋主月結算 — 跨房屋總覽 (Phase 3 基礎版)
// 列所有已產生的 settlements，按月份/屋主篩選
// 詳情看單張結算單 + 後續 P3 進階：PDF / LINE 傳送
import { mockData, store, getOwnerById } from '../data.js';
import { openConfirm, showToast, refreshView } from '../utils/ui.js';
import { escapeHtml as esc } from '../utils/escape.js';

export function renderManagedSettlements() {
    const settlements = [...mockData.settlements].sort((a, b) =>
        (b.month || '').localeCompare(a.month || '')
    );

    const months = [...new Set(settlements.map(s => s.month))].sort((a, b) => b.localeCompare(a));

    const totalReceivable = settlements.reduce((s, x) => s + (x.ownerReceivable || 0), 0);
    const draftCount = settlements.filter(s => s.status === 'draft').length;
    const sentCount = settlements.filter(s => s.status === 'sent').length;

    const rows = settlements.map(s => {
        const b = mockData.buildings.find(b => b.id === s.buildingId);
        const o = s.ownerId ? getOwnerById(s.ownerId) : null;
        return `
            <tr data-row-id="${esc(s.id)}" data-status="${esc(s.status)}" data-month="${esc(s.month)}" data-search="${esc(((o?.name || '') + ' ' + (b?.name || '')).toLowerCase())}">
                <td><code style="font-size: 0.78rem;">${esc(s.id)}</code></td>
                <td><strong>${esc(s.month)}</strong></td>
                <td>${esc(o?.name || '—')}</td>
                <td>${b ? `<a href="#m-house/${esc(b.id)}" style="color: var(--color-primary);">${esc(b.name)}</a>` : '—'}</td>
                <td style="text-align: right;"><strong>$${(s.ownerReceivable || 0).toLocaleString()}</strong></td>
                <td style="text-align: right;">$${(s.ownerHoldingDepositTotal || 0).toLocaleString()}</td>
                <td><span class="status-badge ${s.status === 'settled' ? 'success' : s.status === 'sent' ? 'info' : 'muted'}">${s.status}</span></td>
                <td>
                    <div style="display: flex; gap: 0.35rem;">
                        <button class="btn btn-outline settlement-action" data-action="view" data-id="${esc(s.id)}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs);" title="詳情"><i class="ph ph-eye"></i></button>
                        ${s.status !== 'settled' ? `<button class="btn btn-outline settlement-action" data-action="mark-sent" data-id="${esc(s.id)}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs);" title="標記已傳送"><i class="ph ph-paper-plane-tilt"></i></button>` : ''}
                        ${s.status === 'sent' ? `<button class="btn btn-outline settlement-action" data-action="mark-settled" data-id="${esc(s.id)}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs); color: var(--color-success);" title="標記已結清"><i class="ph ph-check-circle"></i></button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="metrics-grid">
            <div class="card metric-card"><div class="metric-header"><span>結算筆數</span><div class="metric-icon primary"><i class="ph ph-receipt"></i></div></div><div class="metric-value">${settlements.length}</div><div class="metric-subtext">跨房屋全部</div></div>
            <div class="card metric-card"><div class="metric-header"><span>累計屋主應收</span><div class="metric-icon success"><i class="ph ph-currency-dollar"></i></div></div><div class="metric-value">$${totalReceivable.toLocaleString()}</div><div class="metric-subtext">所有月份合計</div></div>
            <div class="card metric-card"><div class="metric-header"><span>待傳送</span><div class="metric-icon warning"><i class="ph ph-paper-plane-tilt"></i></div></div><div class="metric-value">${draftCount}</div><div class="metric-subtext">draft 狀態</div></div>
            <div class="card metric-card"><div class="metric-header"><span>已傳送 / 待結清</span><div class="metric-icon info"><i class="ph ph-clock"></i></div></div><div class="metric-value">${sentCount}</div><div class="metric-subtext">等屋主收款回報</div></div>
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <div>
                    <h2 class="card-title" style="margin-bottom: 0.25rem;"><i class="ph ph-receipt"></i> 屋主月結算</h2>
                    <p style="font-size: var(--text-xs); color: var(--text-muted); margin: 0;">至各代管房屋的「費用計算」tab 產生月結算單</p>
                </div>
            </div>
            ${settlements.length === 0
                ? `<div style="padding: 3rem; text-align: center; color: var(--text-muted);">
                    <i class="ph ph-receipt" style="font-size: 3rem;"></i>
                    <p style="margin: 1rem 0 0;">尚無月結算紀錄</p>
                    <p style="font-size: var(--text-xs);">前往代管房屋 → 費用計算 tab → 產生本月結算</p>
                </div>`
                : `<div class="table-container">
                    <table class="data-table">
                        <thead><tr>
                            <th>結算 ID</th><th>月份</th><th>屋主</th><th>房屋</th>
                            <th style="text-align: right;">屋主應收</th>
                            <th style="text-align: right;">屋主持有押金</th>
                            <th>狀態</th><th>操作</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`}
        </div>
    `;
}

export function initManagedSettlementsActions(scope) {
    scope.addEventListener('click', (e) => {
        const btn = e.target.closest('.settlement-action');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const s = mockData.settlements.find(x => x.id === id);
        if (!s) return;
        if (action === 'view') viewSettlement(s);
        else if (action === 'mark-sent') {
            store.updateSettlement(id, { status: 'sent', sentAt: new Date().toISOString() });
            showToast('已標記為「已傳送」', 'success');
            refreshView();
        }
        else if (action === 'mark-settled') {
            store.updateSettlement(id, { status: 'settled' });
            showToast('已標記為「已結清」', 'success');
            refreshView();
        }
    });
}

function viewSettlement(s) {
    const b = mockData.buildings.find(b => b.id === s.buildingId);
    const o = s.ownerId ? getOwnerById(s.ownerId) : null;
    const lines = (s.items || []).map(it => `
        <tr>
            <td>${esc(it.label)}</td>
            <td style="text-align: right; ${it.amount < 0 ? 'color: var(--color-danger);' : 'color: var(--color-success);'}">${it.amount < 0 ? '-' : '+'}$${Math.abs(it.amount).toLocaleString()}</td>
        </tr>
    `).join('');
    const html = `
        <div>
            <p><strong>${esc(b?.name || '')}</strong> · 屋主：<strong>${esc(o?.name || '—')}</strong></p>
            <p>結算月：<strong>${esc(s.month)}</strong> · 狀態：${esc(s.status)}</p>
            <table class="data-table" style="margin: 0.5rem 0;">
                <thead><tr><th>項目</th><th style="text-align: right;">金額</th></tr></thead>
                <tbody>
                    ${lines}
                    <tr style="border-top: 2px solid var(--border-color); background: var(--color-background);">
                        <td><strong>屋主應收</strong></td>
                        <td style="text-align: right;"><strong style="font-size: 1.1rem;">$${(s.ownerReceivable || 0).toLocaleString()}</strong></td>
                    </tr>
                </tbody>
            </table>
            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--color-background); border-radius: 4px; font-size: var(--text-sm);">
                <div style="font-weight: 600; margin-bottom: 0.4rem;">押金狀態</div>
                <div>本月新收押金: <strong>$${(s.depositCollectedThisMonth || 0).toLocaleString()}</strong></div>
                <div>本月移交給屋主: <strong>$${(s.depositTransferredThisMonth || 0).toLocaleString()}</strong></div>
                <div>屋主目前持有押金總額: <strong style="color: var(--color-success);">$${(s.ownerHoldingDepositTotal || 0).toLocaleString()}</strong></div>
            </div>
            <p style="margin-top: 0.75rem; font-size: var(--text-xs); color: var(--text-muted);">下一步 (P3 進階): PDF 下載 / LINE 直傳屋主</p>
        </div>
    `;
    openConfirm({
        title: `月結算 ${s.id}`,
        message: html,
        confirmLabel: '關閉',
        hideCancel: true,
        maxWidth: 680
    });
}
