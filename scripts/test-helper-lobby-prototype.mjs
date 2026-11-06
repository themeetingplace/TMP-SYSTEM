import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../mockup/helper-lobby/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../mockup/helper-lobby/lobby-v2.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../mockup/helper-lobby/lobby-v2.js', import.meta.url), 'utf8');

assert.ok(html.includes('assets/meeting-place-lobby-v2.png'), '原型必須使用 2.5D 像素大廳素材');
assert.ok(html.includes('data-open-wardrobe'), '原型必須提供角色換裝入口');
assert.ok(html.includes('所有館別的小幫手都在同一個空間'), '原型必須採用跨館共用大廳');
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'), '原型必須尊重減少動態效果設定');
assert.ok(css.includes('helper-sprite-sheet-v2.png'), '原型必須使用多方向角色影格');
assert.ok(js.includes("localStorage.setItem(storageKey"), '角色外觀應可在本機保存');
assert.ok(js.includes('requestAnimationFrame(step)'), '角色必須支援即時移動');
assert.ok(js.includes("viewport.addEventListener('pointerdown'"), '角色必須支援點擊地板移動');
assert.ok(js.includes("window.addEventListener('keydown'"), '角色必須支援鍵盤方向鍵移動');
assert.ok(html.includes('data-panel="tours"'), '大廳必須提供帶看行程板');
assert.ok(html.includes('data-tour-form'), '帶看行程板必須能新增安排');
assert.ok(js.includes("tmp-pixel-lobby-tours-v1"), '帶看安排必須能保存於本機');
assert.ok(js.includes('renderTours()'), '帶看紀錄必須可重新呈現');
assert.ok(!html.includes('小幫手都在這裡'), '大廳不應顯示已移除的主標題');
assert.ok(html.includes('data-look="gender"'), '角色外觀必須提供男女別選擇');
assert.ok(html.includes('data-look="outfit"'), '角色外觀必須提供服裝款式選擇');
assert.ok(html.includes('data-player-doll'), '玩家角色必須使用分層紙娃娃畫布');
assert.ok(html.includes('data-hair-thumb'), '髮型選項必須顯示實際素材縮圖');
assert.ok(html.includes('data-outfit-thumb'), '服裝選項必須顯示實際素材縮圖');
assert.ok(js.includes('function drawPaperDoll'), '紙娃娃系統必須依圖層繪製角色');
assert.ok(js.includes("assetRoot = './assets/paper-doll/'"), '紙娃娃必須載入獨立角色素材');
assert.ok(js.includes('renderOptionThumbnails()'), '紙娃娃選項縮圖必須隨素材與性別更新');
assert.ok(!html.includes('supabase'), '本機原型不可連接正式 Supabase');

console.log('helper lobby prototype checks passed');
