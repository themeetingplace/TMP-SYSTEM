/**
 * 將 openFormModal 的 number input 升級為可辨識的金額輸入區。
 * 保留原始 input，所以必填驗證、送出取值與其他監聽器都不需改寫。
 */
export function enhanceAmountInput(form, {
    name = 'amount',
    readbackLabel = '這筆金額',
    presetAmounts = [100, 300, 500, 1000]
} = {}) {
    const input = form?.querySelector?.(`[name="${name}"]`);
    const group = input?.closest('.form-group');
    if (!input || !group || group.classList.contains('expense-amount-field')) return null;

    group.classList.add('expense-amount-field');
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('min', '1');
    input.setAttribute('step', '1');
    input.setAttribute('autocomplete', 'off');
    input.placeholder = '0';

    const control = document.createElement('div');
    control.className = 'expense-amount-control';
    input.before(control);
    control.innerHTML = '<span class="expense-amount-currency">NT$</span>';
    control.appendChild(input);

    const tools = document.createElement('div');
    tools.className = 'expense-amount-tools';
    tools.innerHTML = `
        <span>常用金額</span>
        ${presetAmounts.map(amount => `<button type="button" data-amount-preset="${amount}">$${Number(amount).toLocaleString('zh-TW')}</button>`).join('')}
    `;
    control.after(tools);

    const readback = document.createElement('div');
    readback.className = 'expense-amount-readback';
    readback.setAttribute('aria-live', 'polite');
    readback.innerHTML = `<span><i class="ph ph-receipt"></i> ${readbackLabel}</span><output>尚未輸入</output>`;
    tools.after(readback);

    const update = () => {
        const amount = Math.max(0, Number(input.value) || 0);
        readback.querySelector('output').textContent = amount ? `NT$ ${Math.round(amount).toLocaleString('zh-TW')}` : '尚未輸入';
        group.classList.toggle('has-amount', amount > 0);
    };
    input.addEventListener('input', update);
    tools.querySelectorAll('[data-amount-preset]').forEach(button => button.addEventListener('click', () => {
        input.value = button.dataset.amountPreset;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    }));
    update();
    return { input, update };
}
