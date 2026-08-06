// PDF 套版工具
// 用 pdf-lib 載入樣板 PDF → 填入 form fields → 下載最終 PDF
// 樣板 PDF 在 Acrobat 等工具中建立 text form field (欄位名稱要一字不差)：
//   [必要] bed_no          (床位編號，例：R1-A)
//   [必要] tenant_name     (承租人姓名，例：王大明)
//   [選填] issue_date      (生成當天日期 = 今天，例：2026/08/06)
//   [選填] address         (物件地址)
//   [選填] rental_period   (租賃期間合併一格，例：2026/05/01 ~ 2026/07/30)
//   [選填] start_date      (租約開始日，例：2026/05/01)
//   [選填] end_date        (租約結束日，例：2026/07/30)
//   [選填] total_days      (租約共幾日 = 起訖相差天數，本系統 1 月=30 天)
//   [選填] rent_amount     (每月租金 — 基底，例：10,000)
//   [選填] deposit_amount  (押金金額，例：0 或 18,000)
//   [選填] adjustments     (折扣 / 加收明細多行文字 — 設成 multi-line 欄位)
//   [選填] total_amount    (租金總額 = 月租 × 合約期 + 加 − 折，例：29,000)
//   [選填] monthly_amount  (月付金額 = 租金總額 ÷ 合約期，1 期等於 total，3 期÷3)

// === Base64 ↔ Uint8Array (分段處理避免 stack overflow) ===

export function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

export function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// 把使用者上傳的 File 轉成 base64 字串
export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const bytes = new Uint8Array(reader.result);
            resolve(bytesToBase64(bytes));
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// === 中文字型動態下載 + 模組級快取 ===
// pdf-lib 預設用 WinAnsi (拉丁字母) 編碼，遇中文會炸："WinAnsi cannot encode 王"
// 解法：fontkit + 嵌入支援中文的 TTF/OTF，在 flatten 前呼叫 updateAppearances(cjkFont)
//
// 字型來源優先序：本地檔案 → CDN fallback
// 本地放 Windows 標楷體 (kaiu.ttf) 或思源宋體效果最佳；
// CDN fallback 用粉圓 (open-huninn)，缺字較多但能跑通流程。
// 為什麼不用 Noto CJK / cwTeX：前者 Git LFS / 後者 jsDelivr 403。
const CJK_FONT_URLS = [
    './assets/fonts/kaiu.ttf',                      // Windows 標楷體 (請從 C:\Windows\Fonts\ 複製來)
    './assets/fonts/NotoSansTC-Regular.otf',        // 思源黑體 (備用本地)
    './assets/fonts/NotoSerifTC-Regular.otf',       // 思源宋體 (備用本地)
    'https://cdn.jsdelivr.net/gh/justfont/open-huninn-font@master/font/jf-openhuninn-2.1.ttf'
];
let _cjkFontBytes = null;
let _cjkFontPromise = null;

async function loadCjkFontBytes() {
    if (_cjkFontBytes) return _cjkFontBytes;
    if (!_cjkFontPromise) {
        _cjkFontPromise = (async () => {
            let lastErr = null;
            for (const url of CJK_FONT_URLS) {
                try {
                    const r = await fetch(url);
                    if (!r.ok) { lastErr = new Error(`HTTP ${r.status} @ ${url}`); continue; }
                    _cjkFontBytes = new Uint8Array(await r.arrayBuffer());
                    console.log(`[pdfGen] 中文字型已下載: ${url} (${(_cjkFontBytes.byteLength/1024/1024).toFixed(1)} MB)`);
                    return _cjkFontBytes;
                } catch (e) { lastErr = e; }
            }
            _cjkFontPromise = null;
            throw new Error(`下載中文字型失敗，已試完所有 fallback：${lastErr?.message || '未知錯誤'}`);
        })();
    }
    return _cjkFontPromise;
}

// === PDF 套版核心 ===

// 把 PDF 樣板（base64 或 Uint8Array）載入，填入欄位，回傳 Uint8Array
// 欄位若不存在會略過（不中斷流程），回傳 { bytes, filledFields, missingFields }
export async function fillContractPdf(template, values) {
    if (!window.PDFLib) {
        throw new Error('pdf-lib 未載入，請確認 index.html 已引入 CDN');
    }
    const { PDFDocument } = window.PDFLib;

    const sourceBytes = typeof template === 'string'
        ? base64ToBytes(template)
        : template;

    const pdfDoc = await PDFDocument.load(sourceBytes);

    // 嵌入中文字型 (fontkit 需先 register)。失敗時退回原本字型，
    // 但中文欄位會無法正確渲染 → 由呼叫端決定要不要中斷。
    let cjkFont = null;
    if (window.fontkit) {
        try {
            pdfDoc.registerFontkit(window.fontkit);
            const fontBytes = await loadCjkFontBytes();
            cjkFont = await pdfDoc.embedFont(fontBytes, { subset: true });
        } catch (e) {
            console.warn('載入中文字型失敗，將使用 PDF 內建字型 (中文可能無法顯示):', e);
        }
    } else {
        console.warn('fontkit 未載入，中文欄位將無法正確渲染');
    }

    let form;
    try {
        form = pdfDoc.getForm();
    } catch (e) {
        throw new Error('此 PDF 沒有可填入的表單欄位。請先用 Adobe Acrobat (或 PDFescape 等線上工具) 在樣板中加入 bed_no / tenant_name / rental_period 三個文字欄位');
    }

    // 診斷：列出 PDF 內所有欄位的關鍵屬性 (找出為何 tenant_name 與其他欄位行為不同)
    try {
        const diag = form.getFields().map(f => {
            let da = '', maxLen = null;
            try { da = f.acroField?.getDefaultAppearance?.() || ''; } catch {}
            try { maxLen = f.getMaxLength?.() ?? null; } catch {}
            return { name: f.getName(), type: f.constructor.name, da, maxLength: maxLen };
        });
        console.table(diag);
    } catch (e) { console.warn('[pdfGen] 欄位診斷失敗:', e); }

    const filledFields = [];
    const missingFields = [];

    Object.entries(values).forEach(([key, val]) => {
        try {
            const field = form.getTextField(key);
            field.setText(String(val ?? ''));
            filledFields.push(key);
        } catch (e) {
            missingFields.push(key);
            console.warn(`[pdfGen] 欄位 "${key}" 填入失敗: ${e.message}`, e);
        }
    });

    // 用中文字型逐欄位重繪 appearance；不做這步 flatten/save 會用預設 Helvetica 撞到 WinAnsi。
    // 額外處理 auto-size (字型大小 = 0) 的欄位：pdf-lib 對 CJK auto-size 渲染不穩，強制設 11pt。
    if (cjkFont) {
        form.getFields().forEach(field => {
            if (typeof field.updateAppearances !== 'function') return;
            try {
                // 偵測 DA 字型大小，若為 0 (auto-size) 設預設 11pt
                let forcedSize = false;
                try {
                    const da = field.acroField?.getDefaultAppearance?.() || '';
                    const sizeMatch = da.match(/(\d+(?:\.\d+)?)\s+Tf/);
                    const currentSize = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
                    if (currentSize === 0 && typeof field.setFontSize === 'function') {
                        field.setFontSize(11);
                        forcedSize = true;
                    }
                } catch {}
                field.updateAppearances(cjkFont);
                console.log(`[pdfGen] 欄位 "${field.getName()}" 已套用字型${forcedSize ? ' (強制 11pt)' : ''}`);
            } catch (e) {
                console.warn(`[pdfGen] 欄位 "${field.getName()}" 套用中文字型失敗:`, e);
            }
        });
    }

    // 平面化 (flatten)：把 form fields 轉成普通文字，不可再編輯
    // updateFieldAppearances: false → 跳過 flatten 內部的自動重繪（會用 Helvetica）
    try {
        form.flatten({ updateFieldAppearances: false });
    } catch (e) {
        console.warn('無法 flatten form，PDF 仍可用但欄位可被編輯', e);
    }

    const bytes = await pdfDoc.save({ updateFieldAppearances: false });
    return { bytes, filledFields, missingFields };
}

// 觸發瀏覽器下載
export function downloadPdfBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 開新分頁預覽（不下載）
export function previewPdfBytes(bytes) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000); // 1 分鐘後回收
}

// 列出 PDF 內所有 form field 名稱 (給上傳預覽 / 除錯用)
export async function listPdfFields(template) {
    if (!window.PDFLib) throw new Error('pdf-lib 未載入');
    const { PDFDocument } = window.PDFLib;
    const bytes = typeof template === 'string' ? base64ToBytes(template) : template;
    const pdfDoc = await PDFDocument.load(bytes);
    try {
        const form = pdfDoc.getForm();
        return form.getFields().map(f => ({ name: f.getName(), type: f.constructor.name }));
    } catch (e) {
        return [];
    }
}

// 格式化 demo / 實際租期顯示
export function formatRentalPeriod(startDate, endDate) {
    const fmt = (d) => d ? d.replace(/-/g, '/') : '';
    return `${fmt(startDate)} ~ ${fmt(endDate)}`;
}
