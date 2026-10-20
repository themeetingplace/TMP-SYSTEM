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

        if (side === 'back') {
            const backCount = countMatches(text, [/父/, /母/, /配偶/, /役別/, /地址/, /戶籍地址/, /PLACE OF BIRTH/, /ADDRESS/]);
            // 背面本來就較少出現「身分證」標題；三個以上典型欄位視為足夠強的證件訊號。
            score += Math.min(4, backCount);
            if (backCount >= 2) signals.push('back_fields');
        }

        // 有一定文字量但沒有強證據時，只回「無法確認」，不武斷判成非證件。
        const readableChars = compact.replace(/</g, '').length;
        let verdict = 'unlikely';
        if (score >= 4) verdict = 'likely';
        else if (score >= 2 || readableChars >= 24) verdict = 'uncertain';

        return {
            verdict,
            confidence: Math.max(0, Math.min(0.99, score / 8)),
            signals
        };
    }

    function validateIdDocumentGate({ hasFront, hasBack, frontVerdict, backVerdict }) {
        if (!hasFront) return { ok: false, code: 'front_missing' };
        if (!frontVerdict || frontVerdict === 'checking') return { ok: false, code: 'checking' };
        if (frontVerdict === 'unavailable') return { ok: false, code: 'unavailable' };
        if (frontVerdict !== 'likely') return { ok: false, code: 'not_id_document' };

        // 護照照片頁不需要背面；但使用者若有上傳背面，也必須通過相同驗證。
        if (hasBack) {
            if (!backVerdict || backVerdict === 'checking') return { ok: false, code: 'checking' };
            if (backVerdict === 'unavailable') return { ok: false, code: 'unavailable' };
            if (backVerdict !== 'likely') return { ok: false, code: 'not_id_document' };
        }
        return { ok: true, code: 'verified' };
    }

    const api = { classifyIdDocumentText, validateIdDocumentGate };
    root.IdDocumentAI = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
