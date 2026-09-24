import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dataSource = await readFile(new URL('../js/data.js', import.meta.url), 'utf8');
const syncSource = await readFile(new URL('../js/sync.js', import.meta.url), 'utf8');

assert.match(dataSource, /const DIRTY_ROWS_KEY = 'pms-dirty-rows-v1'/, '待同步資料必須有獨立持久化 key');
assert.match(dataSource, /function hydrateDirtyJournal\(\)/, '重開頁面時必須還原待同步 row');
assert.match(dataSource, /markDirty[\s\S]*?persistDirtyJournal\(\)/, '標記 dirty 時必須立即保存 journal');
assert.match(dataSource, /expectedRevisions[\s\S]*?dirtyRevisions/, 'push 期間的再次編輯必須以 revision 防止誤清除');

assert.match(syncSource, /remoteIds\.has\(r\[pkJs\]\) \|\| dirtySet\?\.has\(r\[pkJs\]\)/, 'pull 不得移除本機待上傳 row');
assert.match(syncSource, /if \(local && dirtySet\?\.has\(id\)\)/, 'pull 不得覆寫本機待上傳 row');
assert.match(syncSource, /visibilitychange[\s\S]*?flushBeforeSuspend\('hidden'\)/, '手機切背景前必須立即補送');
assert.match(syncSource, /addEventListener\('focus'[\s\S]*?reconcileDevices\('focus'\)/, '電腦頁面回到前景時必須重新核對');
assert.match(syncSource, /addEventListener\('bms:persist', \(\) => schedulePush\(\)\)/, 'persist event 不得被誤當成 debounce delay');

console.log('cross-device sync durability checks passed');
