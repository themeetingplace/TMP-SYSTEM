import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageSource = await readFile(new URL('../contract-download/index.html', import.meta.url), 'utf8');
const contractsSource = await readFile(new URL('../js/views/contracts.js', import.meta.url), 'utf8');

assert.match(contractsSource, /new URL\('\/contract-download\/', window\.location\.origin\)/, '前端必須先將 signed URL 包成預覽下載頁');
assert.match(contractsSource, /fileUrl: downloadPageUrl\.toString\(\)/, '即使 Edge Function 尚未更新也必須傳送下載頁連結');

assert.match(pageSource, /id="download-button"[^>]*>下載 PDF</, '下載頁必須有醒目的下載 PDF 主按鈕');
assert.match(pageSource, /id="pdf-preview"/, '下載頁開啟後必須立即顯示 PDF 內容');
assert.match(pageSource, /pdfjs-dist@3\.11\.174/, 'PDF 預覽必須固定使用經驗證的 PDF.js 版本');
assert.match(pageSource, /pdfjsLib\.getDocument\(\{ url: fileUrl/, 'PDF 預覽必須使用本次 signed URL');
assert.match(pageSource, /className = 'pdf-page'/, 'PDF 必須由頁面自行繪製，避免手機檢視器接管整頁');
assert.doesNotMatch(pageSource, /<iframe[^>]+id="pdf-preview"/, 'PDF 預覽不得使用會被 LINE 手機檢視器接管的 iframe');
assert.match(pageSource, /id="preview-button"[^>]*>全螢幕開啟</, '下載頁必須提供全螢幕開啟選項');
assert.match(pageSource, /mkatwwouurwxlruisqwe\.supabase\.co/, '下載頁只接受目前專案的 Storage 網址');
assert.match(pageSource, /\/storage\/v1\/object\/sign\/contract-pdfs\//, '下載頁只接受合約 bucket 的 signed URL');
assert.match(pageSource, /anchor\.download = filename/, '下載按鈕必須指定 PDF 檔名');
assert.match(pageSource, /連結自發送後 24 小時內有效/, '下載頁必須說明有效期限');
assert.match(pageSource, /meta name="referrer" content="no-referrer"/, 'signed URL 頁面不得外送 referrer');

const script = pageSource.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, '下載頁必須包含下載邏輯');
new Function(script);

console.log('contract download page regression checks passed');
