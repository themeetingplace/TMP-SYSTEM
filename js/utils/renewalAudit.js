// 續租日期校正提示 — 跑 store.auditRenewalDates() dry-run，
// 有 affected 就跳 modal 讓 admin 審閱後一鍵全部修正
//
// 一次性歷史校正：舊 renewContract 多 +1 天，已在 data.js renewContract 修 forward；
// 這裡負責把歷史已產生的續租合約一次補回來
import { store } from '../data.js';
import { openModal, showToast } from './ui.js';

const SESSION_DISMISS_KEY = 'pms-renewal-audit-dismissed';

export function promptRenewalAuditIfNeeded() {
    try {
        if (sessionStorage.getItem(SESSION_DISMISS_KEY) === '1') return;
    } catch {}
    let report;
    try {
        report = store.auditRenewalDates({ apply: false });
    } catch (err) {
        console.error('[renewalAudit] dry-run 失敗', err);
        return;
    }
    if (!report || !report.affected?.length) return;
    showRenewalAuditModal(report);
}

function showRenewalAuditModal(report) {
    const { affected, skipped } = report;

    const rows = affected.map(a => `
        <tr>
            <td><code style="font-size: 0.75rem;">${a.contractId}</code></td>
            <td>${a.tenant || '—'}</td>
            <td style="font-size: 0.78rem;">${a.propertyName || '—'}</td>
            <td><code style="font-size: 0.75rem; color: var(--text-muted);">${a.parentEnd}</code></td>
            <td><code style="font-size: 0.75rem; color: var(--color-danger);">${a.oldStart}</code></td>
            <td style="text-align: center;">→</td>
            <td><code style="font-size: 0.75rem; color: var(--color-success);">${a.newStart}</code></td>
            <td><code style="font-size: 0.75rem; color: var(--text-muted);">${a.endDate}</code></td>
        </tr>
    `).join('');

    const skippedBlock = skipped.length
        ? `
        <details style="margin-top: 1rem;">
            <summary style="cursor: pointer; color: var(--text-muted); font-size: var(--text-sm);">
                另略過 ${skipped.length} 筆 (startDate 跟 buggy 模式不符，疑似手動編輯過) — 點開檢視
            </summary>
            <ul style="margin: 0.5rem 0 0 1rem; padding: 0; font-size: var(--text-xs); color: var(--text-muted); max-height: 180px; overflow-y: auto;">
                ${skipped.map(s => `<li><code>${s.contractId}</code> — ${s.reason}${s.currentStart ? ` (start=${s.currentStart}, parentEnd=${s.parentEnd})` : ''}</li>`).join('')}
            </ul>
        </details>
        ` : '';

    const bodyHtml = `
        <div style="padding: 0 0 0.5rem;">
            <p style="margin: 0 0 0.75rem;">
                舊版續租 logic 多加 1 天 → 新合約 <code>startDate</code> 應該 = 舊 <code>endDate</code>，但目前是 +1 天。
                共找到 <strong style="color: var(--color-danger);">${affected.length}</strong> 筆需要校正：
            </p>
            <div style="max-height: 360px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px;">
                <table class="data-table" style="margin: 0;">
                    <thead style="position: sticky; top: 0; background: #fafbfc; z-index: 1;">
                        <tr>
                            <th>合約 ID</th><th>租客</th><th>床位</th>
                            <th>parent endDate</th><th>現在 start</th><th></th><th>應為 start</th><th>end (不變)</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${skippedBlock}
            <p style="margin: 1rem 0 0; font-size: var(--text-xs); color: var(--text-muted);">
                修正會更新 <code>contracts.startDate</code> 跟對應 invoice 的 <code>dueDate</code> / <code>periodStart</code>。
                endDate 不動 (現有值已對的，只是 start 多吃了 1 天)。
            </p>
        </div>
    `;

    const footerHtml = `
        <button type="button" class="btn btn-outline" data-action="dismiss">先不處理 (本次 session 不再提示)</button>
        <button type="button" class="btn btn-primary" data-action="apply">
            <i class="ph ph-check-circle"></i> 全部修正 (${affected.length} 筆)
        </button>
    `;

    openModal({
        title: `⚠ 續租日期校正 — ${affected.length} 筆需處理`,
        bodyHtml,
        footerHtml,
        maxWidth: 880,
        onMount: (overlay, close) => {
            overlay.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
                try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch {}
                close();
            });
            overlay.querySelector('[data-action="apply"]').addEventListener('click', () => {
                const result = store.auditRenewalDates({ apply: true });
                showToast(`已校正 ${result.affected.length} 筆續租日期 (invoice ${result.patchedInvoices?.length || 0} 筆同步)`, 'success', 5000);
                try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch {}
                close();
                // 觸發 view refresh
                window.dispatchEvent(new Event('hashchange'));
            });
        }
    });
}
