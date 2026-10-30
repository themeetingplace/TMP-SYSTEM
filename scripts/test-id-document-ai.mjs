import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { classifyIdDocumentText, validateIdDocumentGate } = require('../liff/id-document-ai.js');

assert.equal(
    classifyIdDocumentText('中華民國 國民身分證 姓名 王小明 A123456789').verdict,
    'likely',
    '台灣身分證特徵應判為像證件'
);
assert.equal(
    classifyIdDocumentText('PASSPORT REPUBLIC OF CHINA P<TWNCHEN<<MEI<LING<<<<<<<<').verdict,
    'likely',
    '護照與 MRZ 特徵應判為像證件'
);
assert.equal(
    classifyIdDocumentText('日本国旅券 JAPAN PASSPORT P<JPNYAMADA<<TARO<<<<<<<<<<<<').verdict,
    'likely',
    '各國護照照片頁應依 PASSPORT 與 MRZ 通過，不得只看大頭照'
);
assert.equal(
    classifyIdDocumentText('ALIEN RESIDENT CERTIFICATE NAME DATE OF BIRTH NATIONALITY').verdict,
    'likely',
    '居留證特徵應判為像證件'
);
assert.equal(
    classifyIdDocumentText('AUFENTHALTSTITEL RESIDENCE PERMIT NAME DATE OF BIRTH').verdict,
    'likely',
    '常見外國居留證英文或當地名稱應通過'
);
assert.equal(
    classifyIdDocumentText('在留カード 氏名 生年月日 国籍・地域').verdict,
    'likely',
    '日本居留證常見名稱應通過'
);
assert.equal(
    classifyIdDocumentText('父 王先生 母 林女士 配偶 無 地址 台北市', { side: 'back' }).verdict,
    'likely',
    '台灣身分證背面欄位應判為像證件'
);
assert.equal(
    classifyIdDocumentText('地址 臺北市信義區松仁路 役別 免役', { side: 'back' }).verdict,
    'likely',
    '證件反面應依地址與役別等背面欄位判讀，不得要求大頭照'
);
assert.equal(
    classifyIdDocumentText('王大明 林小美 臺北市 110', { side: 'back', imageAspectRatio: 1.58 }).verdict,
    'likely',
    '手機 OCR 未讀到欄位名稱時，證件比例加上足夠可讀文字仍應接受反面'
);
assert.equal(
    classifyIdDocumentText('統一發票 品名 咖啡 小計 100 TOTAL 100 THANK YOU', { side: 'back', imageAspectRatio: 1.58 }).verdict,
    'unlikely',
    '發票不得因文字量足夠而被誤判為證件反面'
);
assert.notEqual(
    classifyIdDocumentText('便利商店 發票 TOTAL 500 THANK YOU').verdict,
    'likely',
    '一般收據不可被判為身分證件'
);
assert.equal(classifyIdDocumentText('').verdict, 'unlikely', '空白或無文字影像應判為不像證件');

assert.deepEqual(
    validateIdDocumentGate({ hasFront: true, hasBack: false, frontVerdict: 'likely' }),
    { ok: true, code: 'verified' },
    '護照或單面證件的正面通過後可登記'
);
assert.equal(
    validateIdDocumentGate({ hasFront: true, hasBack: false, frontVerdict: 'uncertain' }).ok,
    false,
    '無法確認為證件時不可登記'
);
assert.equal(
    validateIdDocumentGate({ hasFront: true, hasBack: false, frontVerdict: 'unavailable' }).ok,
    false,
    'AI 無法使用且未聲明人工補件時不可繞過驗證'
);
assert.deepEqual(
    validateIdDocumentGate({
        hasFront: true,
        hasBack: false,
        frontVerdict: 'uncertain',
        manualFallback: true
    }),
    { ok: true, code: 'manual_review' },
    'AI 無法確認、且住客已聲明把證件交給小編時，可進入人工補件流程'
);
assert.equal(
    validateIdDocumentGate({
        hasFront: false,
        hasBack: false,
        frontVerdict: 'unlikely',
        manualFallback: true
    }).ok,
    false,
    '沒有先選擇證件照片時不可直接勾選人工補件'
);
assert.equal(
    validateIdDocumentGate({
        hasFront: true,
        hasBack: false,
        frontVerdict: 'checking',
        manualFallback: true
    }).ok,
    false,
    'AI 還在判讀時不可提前改走人工補件'
);
assert.equal(
    validateIdDocumentGate({ hasFront: true, hasBack: true, frontVerdict: 'likely', backVerdict: 'unlikely' }).ok,
    false,
    '有上傳背面時，背面也必須通過驗證'
);
assert.equal(
    validateIdDocumentGate({ hasFront: true, hasBack: true, frontVerdict: 'likely', backVerdict: 'uncertain' }).ok,
    false,
    '反面不要求大頭照，但無法辨識出反面欄位時仍不可直接繞過驗證'
);

const liffSource = readFileSync(new URL('../liff/index.html', import.meta.url), 'utf8');
assert.ok(liffSource.includes('tesseract.js@6.0.1'), 'LIFF 必須載入固定版本的裝置端 OCR');
assert.ok(liffSource.includes('AI：看起來是身分證件'), '上傳區必須顯示 AI 判讀結果');
assert.ok(liffSource.includes('idOcrQueue'), '正反面 OCR 必須排隊，避免同一 worker 併發衝突');
assert.ok(liffSource.includes('prepareEnhancedBackCanvas'), '反面第一次失敗時必須以旋轉高對比影像重判');
assert.ok(liffSource.includes('maxDim = 1800'), '證件 OCR 必須保留足夠解析度以辨識反面小字');
assert.ok(liffSource.includes('validateIdDocumentGate'), '送出前必須強制檢查 AI 證件驗證結果');
assert.ok(liffSource.includes('errIdAiRejected'), 'AI 判定不是證件時必須顯示阻擋訊息');
assert.ok(liffSource.includes('manualIdFallback'), 'AI 失敗畫面必須提供已將證件交給小編的人工補件聲明');
assert.ok(liffSource.includes('待管理員補件'), '人工補件路徑必須清楚標示後台待處理狀態');
assert.ok(liffSource.includes('不檢查大頭照'), '反面判讀提示必須明確說明不檢查大頭照');

console.log('ID document AI classifier regression checks passed');
