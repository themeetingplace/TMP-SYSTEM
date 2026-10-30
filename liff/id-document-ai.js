(function initIdDocumentAI(root) {
    'use strict';

    function normalizeText(value) {
        return String(value || '')
            .toUpperCase()
            .replace(/[\s\u3000]+/g, ' ')
            .trim();
    }

    function countMatches(text, patterns) {
        return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
    }

    // 僅判斷「影像是否像可接受的身分證件」，不抽取、不回傳姓名或證號。
    // 支援：台灣身分證、護照、居留證；side=back 時會接受證件背面常見欄位。
    function classifyIdDocumentText(rawText, { side = 'front' } = {}) {
        const text = normalizeText(rawText);
        const compact = text.replace(/[^A-Z0-9\u3400-\u9FFF<]/g, '');
        let score = 0;
        const signals = [];

        const strongPatterns = [
            /中華民國/, /國民身分證/, /身分證/, /護照/, /居留證/,
            /REPUBLIC OF CHINA/, /NATIONAL IDENTIFICATION/, /IDENTITY CARD/,
            /PASSPORT/, /RESIDENT CERTIFICATE/, /ALIEN RESIDENT/, /RESIDENCE PERMIT/
        ];
        const strongCount = countMatches(text, strongPatterns);
        if (strongCount) {
            score += Math.min(6, strongCount * 3);
            signals.push('document_keyword');
        }

        // 台灣身分證號格式；OCR 偶爾會把欄位間空格吃掉，因此用 compact 判斷。
        if (/[A-Z][12]\d{8}/.test(compact)) {
            score += 4;
            signals.push('tw_id_pattern');
        }

        // 護照機讀區 (MRZ) 常見 P<國碼 或連續大量 < 分隔符號。
        if (/P<[A-Z]{3}/.test(compact) || /[A-Z0-9<]{20,}/.test(compact) && (compact.match(/</g) || []).length >= 3) {
            score += 5;
            signals.push('passport_mrz');
        }

        const fieldPatterns = [
            /姓名/, /出生日期/, /出生地/, /國籍/, /性別/, /發證日期/, /有效日期/, /統一證號/,
            /\bNAME\b/, /DATE OF BIRTH/, /NATIONALITY/, /\bSEX\b/, /DATE OF ISSUE/, /DATE OF EXPIRY/, /PERSONAL NO/
        ];
        const fieldCount = countMatches(text, fieldPatterns);
        score += Math.min(4, fieldCount);
        if (fieldCount >= 2) signals.push('identity_fields');

        const readableChars = compact.replace(/</g, '').length;
        const receiptSignals = countMatches(text, [
            /統一發票/, /電子發票/, /收據/, /交易明細/, /品名/, /小計/, /稅額/,
            /\bTOTAL\b/, /THANK YOU/, /RECEIPT/
        ]);

        if (side === 'back') {
            // 身分證反面通常沒有照片、證號或「國民身分證」標題，不能沿用正面的判斷門檻。
            // 改看背面專屬欄位；中英文、常見 OCR 變體都納入。
            const backPatterns = [
                /父(?:親|[：:\s])?|\bFATHER\b/,
                /母(?:親|[：:\s])?|\bMOTHER\b/,
                /配偶|\bSPOUSE\b/,
                /役別|兵役|免役|MILITARY SERVICE/,
                /出生地|PLACE OF BIRTH/,
                /戶籍地址|戶籍|住址|地址|\bADDRESS\b/,
                /初領|補領|換領|發證地點|核發機關|ISSUING AUTHORITY/
            ];
            const backCount = countMatches(text, backPatterns);
            score += Math.min(6, backCount * 2);
            if (backCount >= 1) signals.push('back_fields');

            // 兩個背面欄位，或一個欄位搭配可讀文字，就足以判定為合理的證件背面。
            // 明顯是發票／收據且沒有任何背面欄位時仍拒絕。
            if (receiptSignals >= 2 && backCount === 0) {
                return { verdict: 'unlikely', confidence: 0.9, signals: ['receipt_like'] };
            }
            if (backCount >= 2 || (backCount >= 1 && readableChars >= 10)) {
                return {
                    verdict: 'likely',
                    confidence: Math.max(0.72, Math.min(0.99, (score + readableChars / 12) / 8)),
                    signals
                };
            }
        }

        // 有一定文字量但沒有強證據時，只回「無法確認」，不武斷判成非證件。
        let verdict = 'unlikely';
        if (score >= 4) verdict = 'likely';
        else if (score >= 2 || readableChars >= 24) verdict = 'uncertain';

        return {
            verdict,
            confidence: Math.max(0, Math.min(0.99, score / 8)),
            signals
        };
    }

    function validateIdDocumentGate({ hasFront, hasBack, frontVerdict, backVerdict, manualFallback = false }) {
        if (!hasFront) return { ok: false, code: 'front_missing' };
        if (!frontVerdict || frontVerdict === 'checking') return { ok: false, code: 'checking' };

        const frontFailed = frontVerdict !== 'likely';
        let backFailed = false;

        // 護照照片頁不需要背面；但使用者若有上傳背面，也必須通過相同驗證。
        if (hasBack) {
            if (!backVerdict || backVerdict === 'checking') return { ok: false, code: 'checking' };
            // 背面使用自己的欄位辨識規則，不要求大頭照；仍須明確判定為 likely，
            // 避免任意文字圖片因為「無法確認」而繞過證件驗證。
            backFailed = backVerdict !== 'likely';
        }

        // AI 已完成但無法確認時，允許住客明確聲明「已把證件交給小編」，
        // 後台會留下待補件狀態；沒有先選證件、或仍在判讀中時不可使用備援。
        if ((frontFailed || backFailed) && manualFallback) return { ok: true, code: 'manual_review' };
        if (frontVerdict === 'unavailable' || (hasBack && backVerdict === 'unavailable')) {
            return { ok: false, code: 'unavailable' };
        }
        if (frontFailed || backFailed) return { ok: false, code: 'not_id_document' };
        return { ok: true, code: 'verified' };
    }

    const api = { classifyIdDocumentText, validateIdDocumentGate };
    root.IdDocumentAI = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
