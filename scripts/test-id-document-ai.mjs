import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { classifyIdDocumentText } = require('../liff/id-document-ai.js');

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
    classifyIdDocumentText('ALIEN RESIDENT CERTIFICATE NAME DATE OF BIRTH NATIONALITY').verdict,
    'likely',
    '居留證特徵應判為像證件'
);
assert.equal(
    classifyIdDocumentText('父 王先生 母 林女士 配偶 無 地址 台北市', { side: 'back' }).verdict,
    'likely',
    '台灣身分證背面欄位應判為像證件'
);
assert.notEqual(
    classifyIdDocumentText('便利商店 發票 TOTAL 500 THANK YOU').verdict,
    'likely',
    '一般收據不可被判為身分證件'
);
assert.equal(classifyIdDocumentText('').verdict, 'unlikely', '空白或無文字影像應判為不像證件');

const liffSource = readFileSync(new URL('../liff/index.html', import.meta.url), 'utf8');
assert.ok(liffSource.includes('tesseract.js@6.0.1'), 'LIFF 必須載入固定版本的裝置端 OCR');
assert.ok(liffSource.includes('AI：看起來是身分證件'), '上傳區必須顯示 AI 判讀結果');
assert.ok(liffSource.includes('idOcrQueue'), '正反面 OCR 必須排隊，避免同一 worker 併發衝突');

console.log('ID document AI classifier regression checks passed');
