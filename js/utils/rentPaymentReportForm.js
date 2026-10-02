import { supabase } from '../supabase.js';
import { getSession } from '../auth.js';
import { enhanceAmountInput } from './amountInput.js';
import { escapeHtml, escapeAttr } from './escape.js';
import { moneyAmount } from './moneyDisplay.js';
import { openFormModal, showToast } from './ui.js';

async function uploadPaymentProof(file) {
    if (!file) return null;
    const session = await getSession();
    if (!session?.user?.id) throw new Error('登入狀態已過期，請重新登入後再試');
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    if (!allowed.has(file.type)) throw new Error('付款證明只支援 JPG、PNG、WebP 或 PDF');
    if (file.size > 10 * 1024 * 1024) throw new Error('付款證明不能超過 10 MB');
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const key = `${session.user.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('rent-payment-proofs').upload(key, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(`付款證明上傳失敗：${error.message}`);
    return { path: key, name: file.name, mime: file.type };
}

export function openRentPaymentReportForm(row, { onSaved } = {}) {
    if (!row?.id || Number(row.remaining) <= 0) return;
    let proofFile = null;
    openFormModal({
        title: `回報住客已繳 · ${escapeHtml(row.tenant || '未填住客')}`,
        maxWidth: 560,
        fields: [
            { name: 'invoiceSummary', type: 'placeholder', span: 2 },
            { name: 'amount', label: '本次住客繳費金額', type: 'number', required: true, span: 2, value: row.remaining },
            { name: 'paymentDate', label: '繳費日期', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
            { name: 'paymentMethod', label: '付款方式', type: 'select', required: true, options: [
                { value: 'transfer', label: '匯款' }, { value: 'cash_deposit', label: '無摺存款' }, { value: 'other', label: '其他' }
            ], value: 'transfer' },
            { name: 'note', label: '備註', type: 'textarea', span: 2, rows: 2, placeholder: '例：住客已將匯款畫面傳給我' },
            { name: 'proofUpload', type: 'placeholder', span: 2 }
        ],
        submitLabel: '回報已繳・等待核帳',
        onFormMount: form => {
            enhanceAmountInput(form, { readbackLabel: '本次回報金額' });
            const summary = form.querySelector('#ph-invoiceSummary');
            if (summary) {
                const location = [row.buildingName, row.property].filter(Boolean).join(' · ');
                summary.innerHTML = `<div class="helper-report-summary"><span>${escapeHtml(location || '未指定館別與床位')}</span><strong>尚待收 ${moneyAmount(row.remaining)}</strong><small>${escapeHtml(row.id)} · 到期 ${escapeHtml(row.dueDate || '未設定')}</small></div>`;
            }
            const ph = form.querySelector('#ph-proofUpload');
            if (!ph) return;
            const inputId = `rent-proof-${String(row.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
            ph.innerHTML = `<label class="expense-upload" for="${escapeAttr(inputId)}"><input id="${escapeAttr(inputId)}" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden><span class="expense-upload-icon"><i class="ph ph-camera-plus"></i></span><span><strong>付款或存款證明（選填）</strong><small>可上傳住客匯款畫面或無摺存款單，檔案上限 10 MB。</small></span><span class="expense-upload-state">選擇檔案</span></label>`;
            const input = ph.querySelector('input');
            input?.addEventListener('change', () => {
                proofFile = input.files?.[0] || null;
                ph.querySelector('.expense-upload-state').textContent = proofFile ? proofFile.name : '選擇檔案';
                ph.querySelector('.expense-upload')?.classList.toggle('has-file', !!proofFile);
            });
        },
        onSubmit: async values => {
            const remaining = Math.round(Number(row.remaining) || 0);
            const amount = Math.round(Number(values.amount) || 0);
            if (amount <= 0 || amount > remaining) {
                showToast(`本次回報金額需介於 1～${remaining.toLocaleString()} 元`, 'warning', 5000);
                return false;
            }
            let uploaded = null;
            try {
                uploaded = await uploadPaymentProof(proofFile);
                const { error } = await supabase.from('rent_payment_reports').insert({
                    invoice_id: row.id,
                    building_id: row.buildingId,
                    amount,
                    payment_date: values.paymentDate,
                    payment_method: values.paymentMethod,
                    note: values.note || null,
                    evidence_path: uploaded?.path || null,
                    evidence_name: uploaded?.name || null,
                    evidence_mime: uploaded?.mime || null
                });
                if (error) throw new Error(error.message);
                showToast('已回報住客繳費，等待管理員核帳', 'success', 4500);
                await onSaved?.();
            } catch (error) {
                if (uploaded?.path) await supabase.storage.from('rent-payment-proofs').remove([uploaded.path]);
                showToast(`回報失敗：${error.message}`, 'danger', 7000);
                return false;
            }
        }
    });
}
