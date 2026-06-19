// 折扣 / 加收項目共用 widget
// 用在: 新增入住 wizard (properties.js) / 編輯合約 (contracts.js) / 編輯帳目 (finance.js)
//
// 用法:
//   form fields 加 { name: 'adjustments', type: 'placeholder' } + hidden discount/discountReason
//   onFormMount: initAdjustmentsWidget({ container: form.querySelector('#ph-adjustments'), ... })
//
// 規約:
//   每筆 row = { kind: 'sub' | 'add', label, amount }
//     sub = 折扣 (減項) / add = 加收 (額外費用)
//   discount input value = net = sum(sub) - sum(add)
//     net 正 = 整體偏折扣 / net 負 = 整體偏加收
//   discountReason input value = JSON.stringify(items)

const adjRowHtml = (row = { kind: 'sub', label: '', amount: '' }) => `
    <div class="adj-row" style="display: grid; grid-template-columns: 130px 1fr 120px 32px; gap: 0.5rem; align-items: center; padding: 0.55rem; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 0.4rem;">
        <div class="adj-kind-toggle">
            <button type="button" class="adj-kind-btn ${row.kind === 'sub' ? 'is-active' : ''}" data-kind="sub" title="折扣 / 減項">− 折扣</button>
            <button type="button" class="adj-kind-btn ${row.kind === 'add' ? 'is-active' : ''}" data-kind="add" title="加收 / 額外費用">+ 加收</button>
        </div>
        <input type="hidden" data-adj="kind" value="${row.kind || 'sub'}">
        <input data-adj="label" type="text" class="form-input" placeholder="說明 (例：季繳優惠 / 能源費)" value="${row.label || ''}" style="font-size: var(--text-sm);">
        <input data-adj="amount" type="number" class="form-input" placeholder="金額" value="${row.amount || ''}" style="font-size: var(--text-sm); text-align: right;">
        <button type="button" class="adj-del" title="移除這筆" style="background: none; border: none; cursor: pointer; color: var(--color-danger); font-size: 1rem; padding: 0.2rem;"><i class="ph ph-x"></i></button>
    </div>
`;

// 解析 discountReason — 可能是 JSON 陣列 or 純文字 (legacy)
function parseInitialItems(raw) {
    if (!raw) return [];
    const s = String(raw).trim();
    if (!s.startsWith('[')) return [];
    try {
        const items = JSON.parse(s);
        return Array.isArray(items) ? items : [];
    } catch {
        return [];
    }
}

// opts:
//   container: 渲染 widget 的容器 (e.g. #ph-adjustments placeholder div)
//   discountInput: hidden input 接收 net 數字
//   discountReasonInput: hidden input 接收 JSON 字串
//   initialReason: 既有的 discountReason 字串 (要 prefill)
//   onChange(net, items): 每次變動觸發 (給 form 內其他欄位 recompute, e.g. totalDue)
export function initAdjustmentsWidget(opts) {
    const { container, discountInput, discountReasonInput, initialReason = '', onChange } = opts;
    if (!container) return null;

    const recalc = () => {
        const items = Array.from(container.querySelectorAll('.adj-row')).map(row => ({
            kind: row.querySelector('[data-adj="kind"]').value,
            label: row.querySelector('[data-adj="label"]').value.trim(),
            amount: Number(row.querySelector('[data-adj="amount"]').value) || 0
        })).filter(x => x.amount > 0);
        let sub = 0, add = 0;
        items.forEach(x => x.kind === 'sub' ? (sub += x.amount) : (add += x.amount));
        const net = sub - add;
        if (discountInput) discountInput.value = String(net);
        if (discountReasonInput) discountReasonInput.value = items.length ? JSON.stringify(items) : '';
        if (typeof onChange === 'function') onChange(net, items);
    };

    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <label style="font-weight: 500; font-size: var(--text-base);">折扣 / 加收項目 <small style="color: var(--text-muted); font-weight: 400;">(可多筆)</small></label>
            <button type="button" class="btn btn-outline btn-xs adj-add-btn">
                <i class="ph ph-plus"></i> 新增項目
            </button>
        </div>
        <div class="adj-list"></div>
    `;
    const listEl = container.querySelector('.adj-list');

    const addRow = (row = { kind: 'sub', label: '', amount: '' }) => {
        const div = document.createElement('div');
        div.innerHTML = adjRowHtml(row).trim();
        const rowEl = div.firstChild;
        listEl.appendChild(rowEl);
        rowEl.querySelectorAll('input').forEach(inp => inp.addEventListener('input', recalc));
        rowEl.querySelector('.adj-del').addEventListener('click', () => { rowEl.remove(); recalc(); });
        rowEl.querySelectorAll('.adj-kind-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const kind = btn.dataset.kind;
                rowEl.querySelectorAll('.adj-kind-btn').forEach(b => b.classList.toggle('is-active', b.dataset.kind === kind));
                rowEl.querySelector('[data-adj="kind"]').value = kind;
                recalc();
            });
        });
    };

    container.querySelector('.adj-add-btn').addEventListener('click', () => addRow());

    // Prefill
    const initialItems = parseInitialItems(initialReason);
    initialItems.forEach(addRow);
    recalc();

    return { recalc, addRow };
}
