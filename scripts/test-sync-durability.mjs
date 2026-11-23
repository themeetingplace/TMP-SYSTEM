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
assert.match(syncSource, /addEventListener\('pageshow'[\s\S]*?reconcileDevices\('pageshow'\)/, '頁面從快取恢復時必須重新核對');
assert.match(syncSource, /reason:\s*isReconnect\s*\?\s*'realtime-reconnect'\s*:\s*'realtime-subscribe'/, 'Realtime 首次訂閱完成後必須補拉空窗期間的更新');
assert.doesNotMatch(syncSource, /略過前景 pull：Realtime 已連線/, 'Realtime 顯示已連線時也不能略過前景增量核對');
assert.match(syncSource, /addEventListener\('bms:persist', \(\) => schedulePush\(\)\)/, 'persist event 不得被誤當成 debounce delay');
assert.match(syncSource, /tableKeys:\s*\['contracts'\]/, '前景同步必須完整核對合約清單，才能移除雲端不存在的本機孤兒合約');
assert.match(syncSource, /state\.pendingChanges\s*=\s*countDirtyRows\(\)/, '同步狀態必須揭露仍待上傳的本機變更');
assert.match(syncSource, /s === 'idle' && state\.pendingChanges > 0/, '尚有待上傳資料時不得顯示已同步綠燈');
assert.match(syncSource, /const tableErrors = \[\][\s\S]*?for \(const t of SMALL_TABLES\)[\s\S]*?catch \(tableError\)[\s\S]*?繼續處理其他表/, '單一資料表上傳失敗時必須繼續處理後續資料表');

console.log('cross-device sync durability checks passed');
