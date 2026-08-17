// 委託諮詢 — 代管模式專用
// 官網「委託管理 / 房屋委託初步評估」表單 (management_leads) 的收件桌
// 資料獨立 fetch (不進主 sync)：官網匿名 INSERT，PMS admin SELECT/UPDATE/DELETE
// 見 sql/31-management-leads-2026-08-17.sql
import { supabase } from '../supabase.js';
import { openModal, openConfirm, showToast } from '../utils/ui.js';
import { escapeHtml as esc } from '../utils/escape.js';

const STATUS_META = {
    new:       { label: '新諮詢', cls: 'warning' },
    contacted: { label: '已聯繫', cls: 'info' },
    won:       { label: '已成交', cls: 'success' },
    lost:      { label: '未成交', cls: 'muted' }
};
const STATUS_ORDER = ['new', 'contacted', 'won', 'lost'];

const PROPERTY_STATUS_LABEL = {
    vacant: '空屋', 'occupied-self': '自住中', rented: '已出租',
    'ending-soon': '即將退租', renovating: '裝修中', other: '其他'
};
const SERVICE_LABEL = {
    'lease-management': '代租代管', 'master-lease': '包租合作', planning: '出租規劃',
    cleanup: '空間整理／修繕', renovation: '老屋翻修', unsure: '先評估'
};

let leadsCache = [];
let activeFilter = 'all';

function labelList(map, arr) {
    if (!Array.isArray(arr) || !arr.length) return '';
    return arr.map(v => map[v] || v).join('、');
}

function fromRow(r) {
    return {
        id: r.id, createdAt: r.created_at, updatedAt: r.updated_at,
        name: r.name || '(未填名)', phone: r.phone || '', lineId: r.line_id || '', email: r.email || '',
        area: r.area || '', propertyType: r.property_type || '',
        acreage: r.acreage, roomCount: r.room_count, timing: r.timing || '',
        propertyStatus: Array.isArray(r.property_status) ? r.property_status : [],
        services: Array.isArray(r.services) ? r.services : [],
        mainProblem: r.main_problem || '', message: r.message || '',
        status: STATUS_META[r.status] ? r.status : 'new',
        handledBy: r.handled_by || '', note: r.note || '', source: r.source || ''
    };
}

export function renderManagedLeads() {
    // 殼 + 載入中；init 再 fetch 填 #leads-container
    return `
        <div class="card">
            <div class="flex justify-between items-center mb-4">
                <h2 class="card-title" style="margin-bottom: 0;"><i class="ph ph-tray"></i> 委託諮詢</h2>
                <button class="btn btn-outline" id="btn-leads-refresh"><i class="ph ph-arrow-clockwise"></i> 重新整理</button>
            </div>
            <p style="color: var(--text-muted); font-size: var(--text-sm); margin-bottom: 1rem;">
                官網「委託管理」線上諮詢表單送出的房東諮詢會列在這裡，可標記聯繫進度、寫負責人與備註。
            </p>
            <div id="leads-container"><div style="text-align: center; padding: 3rem; color: var(--text-muted);">載入中…</div></div>
        </div>
    `;
}

export function initManagedLeadsActions(scope) {
    const container = scope.querySelector('#leads-container');
    if (!container) return;
    scope.querySelector('#btn-leads-refresh')?.addEventListener('click', () => loadAndRender(container));

    // 事件委派掛在 container (renderList 只換 innerHTML，container 本身不變)
    container.addEventListener('click', (e) => {
        const tab = e.target.closest('.filter-tab');
        if (tab) { activeFilter = tab.dataset.filterValue; renderList(container); return; }
        const btn = e.target.closest('.lead-action');
        if (!btn) return;
        const lead = leadsCache.find(l => l.id === btn.dataset.id);
        if (!lead) return;
        if (btn.dataset.action === 'view') showLeadDetail(lead, container);
        else if (btn.dataset.action === 'delete') confirmDeleteLead(lead, container);
    });
    container.addEventListener('change', (e) => {
        const sel = e.target.closest('.lead-status-select');
        if (!sel) return;
        const id = sel.dataset.id;
        const val = sel.value;
        updateLead(id, { status: val }).then(ok => { if (ok) renderList(container); });
    });

    loadAndRender(container);
}

async function loadAndRender(container) {
    container.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">載入中…</div>';
    const { data, error } = await supabase
        .from('management_leads')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) {
        container.innerHTML = `
            <div style="padding: 1.5rem; background: rgba(181,57,56,.08); border-radius: 8px; border-left: 3px solid var(--color-danger); font-size: var(--text-sm); line-height: 1.7;">
                <strong>載入委託諮詢失敗</strong><br>${esc(error.message || '未知錯誤')}<br>
                <span style="color: var(--text-muted);">請確認：① 已登入且為管理員；② 已在 Supabase 跑過 <code>sql/31-management-leads-2026-08-17.sql</code>。</span>
            </div>`;
        return;
    }
    leadsCache = (data || []).map(fromRow);
    renderList(container);
}

function renderList(container) {
    const counts = { all: leadsCache.length };
    STATUS_ORDER.forEach(s => { counts[s] = leadsCache.filter(l => l.status === s).length; });

    const list = activeFilter === 'all' ? leadsCache : leadsCache.filter(l => l.status === activeFilter);

    const tabs = [
        { v: 'all', label: `全部 (${counts.all})` },
        { v: 'new', label: `⚠ 新諮詢 (${counts.new})` },
        { v: 'contacted', label: `已聯繫 (${counts.contacted})` },
        { v: 'won', label: `已成交 (${counts.won})` },
        { v: 'lost', label: `未成交 (${counts.lost})` }
    ].map(t => `<button class="filter-tab ${activeFilter === t.v ? 'active' : ''}" data-filter-value="${t.v}">${t.label}</button>`).join('');

    const rows = list.map(l => {
        const st = STATUS_META[l.status];
        const svc = labelList(SERVICE_LABEL, l.services);
        const houseInfo = [l.area, l.propertyType, l.acreage != null ? `${l.acreage} 坪` : '', l.roomCount != null ? `${l.roomCount} 房` : '']
            .filter(Boolean).join(' · ');
        return `
            <tr data-row-id="${esc(l.id)}">
                <td style="white-space: nowrap; font-size: var(--text-xs); color: var(--text-muted);">${esc((l.createdAt || '').slice(0, 10))}</td>
                <td>
                    <div style="font-weight: 600;">${esc(l.name)}</div>
                    <div style="font-size: var(--text-xs); color: var(--text-muted);">${esc(l.phone || '—')}</div>
                </td>
                <td style="font-size: var(--text-xs);">
                    ${l.lineId ? `LINE: ${esc(l.lineId)}<br>` : ''}${l.email ? esc(l.email) : (l.lineId ? '' : '—')}
                </td>
                <td style="font-size: var(--text-xs);">${esc(houseInfo || '—')}</td>
                <td style="font-size: var(--text-xs);">${esc(svc || '—')}</td>
                <td>
                    <select class="lead-status-select" data-id="${esc(l.id)}" style="font-size: var(--text-xs); padding: 0.2rem 0.4rem; border: 1px solid var(--border-color); border-radius: 4px;">
                        ${STATUS_ORDER.map(s => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${STATUS_META[s].label}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <div style="display: flex; gap: 0.35rem;">
                        <button class="btn btn-outline lead-action" data-action="view" data-id="${esc(l.id)}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs);" title="詳情"><i class="ph ph-eye"></i></button>
                        <button class="btn btn-outline lead-action" data-action="delete" data-id="${esc(l.id)}" style="padding: 0.2rem 0.5rem; font-size: var(--text-xs); color: var(--color-danger);" title="刪除"><i class="ph ph-trash"></i></button>
                    </div>
                </td>
            </tr>`;
    }).join('');

    container.innerHTML = `
        <div class="filter-bar mb-4"><div class="filter-tabs">${tabs}</div></div>
        <div class="table-container">
            <table class="data-table" style="table-layout: fixed;">
                <colgroup>
                    <col style="width: 9%;"><col style="width: 15%;"><col style="width: 18%;">
                    <col style="width: 20%;"><col style="width: 16%;"><col style="width: 12%;"><col style="width: 10%;">
                </colgroup>
                <thead><tr>
                    <th>諮詢日</th><th>房東</th><th>聯絡</th><th>房屋</th><th>想了解</th><th>狀態</th><th>操作</th>
                </tr></thead>
                <tbody>${rows || `<tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">${activeFilter === 'all' ? '目前沒有委託諮詢' : '此狀態沒有資料'}</td></tr>`}</tbody>
            </table>
        </div>
    `;
}

function showLeadDetail(lead, container) {
    const st = STATUS_META[lead.status];
    const row = (k, v) => v ? `<tr><td style="color: var(--text-muted); width: 32%; padding: 0.3rem 0.5rem;">${k}</td><td style="padding: 0.3rem 0.5rem;">${v}</td></tr>` : '';
    openModal({
        title: `委託諮詢：${esc(lead.name)}`,
        maxWidth: 560,
        bodyHtml: `
            <div style="font-size: var(--text-sm);">
                <p style="margin: 0 0 0.75rem;">
                    <span class="status-badge ${st.cls}">${st.label}</span>
                    <span style="color: var(--text-muted); margin-left: 0.5rem;">來源：${esc(lead.source || '—')} · ${esc((lead.createdAt || '').slice(0, 16).replace('T', ' '))}</span>
                </p>
                <table style="width: 100%; border-collapse: collapse;">
                    ${row('電話', esc(lead.phone))}
                    ${row('LINE ID', esc(lead.lineId))}
                    ${row('Email', esc(lead.email))}
                    ${row('房屋所在地區', esc(lead.area))}
                    ${row('房屋類型', esc(lead.propertyType))}
                    ${row('坪數', lead.acreage != null ? esc(String(lead.acreage)) + ' 坪' : '')}
                    ${row('房間數', lead.roomCount != null ? esc(String(lead.roomCount)) + ' 房' : '')}
                    ${row('預計出租時間', esc(lead.timing))}
                    ${row('目前狀況', esc(labelList(PROPERTY_STATUS_LABEL, lead.propertyStatus)))}
                    ${row('想了解的服務', esc(labelList(SERVICE_LABEL, lead.services)))}
                    ${row('最想解決的問題', esc(lead.mainProblem))}
                    ${row('備註', esc(lead.message).replace(/\n/g, '<br>'))}
                </table>
                <hr style="margin: 1rem 0; border: none; border-top: 1px solid var(--border-color);">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                    <div>
                        <label style="font-size: var(--text-xs); color: var(--text-muted); display: block; margin-bottom: 0.25rem;">處理狀態</label>
                        <select id="lead-detail-status" style="width: 100%; padding: 0.45rem; border: 1px solid var(--border-color); border-radius: 6px;">
                            ${STATUS_ORDER.map(s => `<option value="${s}" ${s === lead.status ? 'selected' : ''}>${STATUS_META[s].label}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size: var(--text-xs); color: var(--text-muted); display: block; margin-bottom: 0.25rem;">負責人</label>
                        <input id="lead-detail-handler" type="text" value="${esc(lead.handledBy)}" placeholder="誰在跟進" style="width: 100%; padding: 0.45rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box;">
                    </div>
                </div>
                <div style="margin-top: 0.75rem;">
                    <label style="font-size: var(--text-xs); color: var(--text-muted); display: block; margin-bottom: 0.25rem;">內部備註 (只有我們看得到)</label>
                    <textarea id="lead-detail-note" rows="3" placeholder="聯繫紀錄 / 報價 / 後續…" style="width: 100%; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box; resize: vertical;">${esc(lead.note)}</textarea>
                </div>
            </div>
        `,
        footerHtml: `
            <button class="btn btn-secondary" data-action="cancel">關閉</button>
            <button class="btn btn-primary" data-action="save-lead"><i class="ph ph-check"></i> 儲存</button>
        `,
        onMount: (modal, close) => {
            modal.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
            modal.querySelector('[data-action="save-lead"]')?.addEventListener('click', async () => {
                const patch = {
                    status: modal.querySelector('#lead-detail-status').value,
                    handledBy: modal.querySelector('#lead-detail-handler').value.trim(),
                    note: modal.querySelector('#lead-detail-note').value.trim()
                };
                const ok = await updateLead(lead.id, patch);
                if (ok) { close(); showToast('已更新委託諮詢', 'success'); renderList(container); }
            });
        }
    });
}

function confirmDeleteLead(lead, container) {
    openConfirm({
        title: `刪除委託諮詢：${esc(lead.name)}？`,
        message: '刪除後無法復原（官網送出的原始諮詢也會一併移除）。',
        confirmLabel: '刪除',
        danger: true,
        onConfirm: async () => {
            const { error } = await supabase.from('management_leads').delete().eq('id', lead.id);
            if (error) { showToast('刪除失敗：' + error.message, 'danger', 5000); return; }
            leadsCache = leadsCache.filter(l => l.id !== lead.id);
            showToast('已刪除', 'success');
            renderList(container);
        }
    });
}

async function updateLead(id, patch) {
    const dbPatch = {};
    if ('status' in patch) dbPatch.status = patch.status;
    if ('note' in patch) dbPatch.note = patch.note || null;
    if ('handledBy' in patch) dbPatch.handled_by = patch.handledBy || null;
    const { error } = await supabase.from('management_leads').update(dbPatch).eq('id', id);
    if (error) { showToast('更新失敗：' + error.message, 'danger', 5000); return false; }
    const lead = leadsCache.find(l => l.id === id);
    if (lead) Object.assign(lead, patch);
    return true;
}
