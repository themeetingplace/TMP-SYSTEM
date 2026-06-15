// 共用表格互動：篩選 tab + 搜尋 + client-side 分頁
//
// 使用方式：
//   initTableInteractions({
//     scope: document.querySelector('.view-section'),
//     rowsPerPage: 10
//   });
//
// 表格的 <tr> 需要標：
//   data-status="已出租"           ← 給狀態 filter-tab 比對
//   data-area="松山館"             ← 給館別等其他篩選群組比對（可選）
//   data-search="王大明 松山館 ..." ← 給搜尋框比對（小寫化）
// 篩選按鈕需要標：
//   data-filter-value="已出租"      （或 "all" 表示不過濾）
//   data-filter-group="status"     （可省略，預設 "status"。"area" 對應 data-area）
// 同一 group 的按鈕互斥；不同 group 的條件會 AND 一起過濾。

// 跨 re-render 的狀態快取 — 編輯資料後 view 重畫，搜尋字 / filter / 頁碼可以還原
// 用 window.location.hash 當 key (每個 view 獨立)
const viewStateCache = new Map();

export function initTableInteractions({ scope, rowsPerPage: initRpp = 10 } = {}) {
    if (!scope) return;
    const stateKey = window.location.hash || '#dashboard';

    // 找出含有 filter-tabs 的 card；只在那張 card 範圍內套用篩選/搜尋/分頁
    // (合約頁有兩張 data-table，這樣才不會誤抓到「待結帳款」表)
    const filterCard = scope.querySelector('.filter-tabs')?.closest('.card') || scope;
    const table = filterCard.querySelector('.data-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const tabs = filterCard.querySelectorAll('[data-filter-value]');
    const searchInput = filterCard.querySelector('.search-bar input');

    const filtersByGroup = {}; // group -> 'all' | value
    let currentSearch = '';
    let currentPage = 1;
    let rowsPerPage = initRpp;  // 改 let 因為「每頁筆數」可換

    function saveState() {
        viewStateCache.set(stateKey, {
            filtersByGroup: { ...filtersByGroup },
            currentSearch,
            currentPage,
            rowsPerPage
        });
    }

    // 取得目前符合條件的 row 陣列
    function getFilteredRows() {
        const rows = Array.from(tbody.querySelectorAll('tr:not(.empty-row):not(.row-mobile-card)'));
        return rows.filter(r => {
            // 每個 group 單獨比對 dataset[group]，例如 group=status -> r.dataset.status
            for (const [group, value] of Object.entries(filtersByGroup)) {
                if (!value || value === 'all') continue;
                const raw = r.dataset[group] || '';
                const list = raw.split(/\s+/).filter(Boolean);
                if (!list.includes(value)) return false;
            }
            const search = (r.dataset.search || '').toLowerCase();
            return !currentSearch || search.includes(currentSearch);
        });
    }

    // 重算所有「Label (N)」格式的 filter tab 數字 (跟著當下其他 filter 連動)
    // 不會動到複雜版型的 tab (如館別卡用「空 X / 共 Y」格式) — regex 不 match 就跳過
    function updateTabCounts() {
        const allRows = Array.from(tbody.querySelectorAll('tr:not(.empty-row):not(.row-mobile-card)'));
        const groups = new Set();
        filterCard.querySelectorAll('[data-filter-value][data-filter-group]').forEach(t => groups.add(t.dataset.filterGroup));
        // 沒標 group 的 status tabs 也納入 (default group = 'status')
        if (filterCard.querySelectorAll('.filter-tab[data-filter-value]:not([data-filter-group])').length) groups.add('status');

        groups.forEach(group => {
            // 該 group 內的 tabs；含沒標 group 的當作 status
            const groupTabs = group === 'status'
                ? filterCard.querySelectorAll('[data-filter-value]:not([data-filter-group]), [data-filter-value][data-filter-group="status"]')
                : filterCard.querySelectorAll(`[data-filter-value][data-filter-group="${group}"]`);

            // 「其他 group 都套用、search 也套用、唯獨此 group 不套」的 row 候選
            const candidates = allRows.filter(r => {
                for (const [g, v] of Object.entries(filtersByGroup)) {
                    if (g === group) continue;
                    if (!v || v === 'all') continue;
                    const raw = r.dataset[g] || '';
                    if (!raw.split(/\s+/).filter(Boolean).includes(v)) return false;
                }
                if (currentSearch) {
                    const search = (r.dataset.search || '').toLowerCase();
                    if (!search.includes(currentSearch)) return false;
                }
                return true;
            });

            groupTabs.forEach(tab => {
                // 取得 tab 原始 label (第一次跑時把「Label (N)」拆出 prefix 存 dataset)
                if (!tab.dataset.labelPrefix) {
                    const m = tab.textContent.match(/^(.+?)\s*\((\d+)\)\s*$/);
                    if (!m) return; // 不符合 simple "(N)" 格式 → 跳過 (例如館別卡)
                    tab.dataset.labelPrefix = m[1].trim();
                }
                const value = tab.dataset.filterValue;
                const count = value === 'all'
                    ? candidates.length
                    : candidates.filter(r => (r.dataset[group] || '').split(/\s+/).filter(Boolean).includes(value)).length;
                tab.textContent = `${tab.dataset.labelPrefix} (${count})`;
            });
        });
    }

    function applyView() {
        const allRows = Array.from(tbody.querySelectorAll('tr:not(.empty-row):not(.row-mobile-card)'));
        const filtered = getFilteredRows();
        const total = filtered.length;
        // rowsPerPage 為 0 = 顯示全部
        const effectiveRpp = rowsPerPage === 0 ? Math.max(1, total) : rowsPerPage;
        const totalPages = Math.max(1, Math.ceil(total / effectiveRpp));
        if (currentPage > totalPages) currentPage = totalPages;
        updateTabCounts();

        const start = (currentPage - 1) * effectiveRpp;
        const end = start + effectiveRpp;
        const visibleSet = new Set(filtered.slice(start, end));

        allRows.forEach(r => {
            const show = visibleSet.has(r);
            r.style.display = show ? '' : 'none';
            // 同步 row-mobile-card sibling (dual-row 結構，桌面行隱手機卡也要跟著隱)
            const next = r.nextElementSibling;
            if (next && next.classList.contains('row-mobile-card')) {
                next.style.display = show ? '' : 'none';
            }
        });

        // 處理空狀態
        let emptyRow = tbody.querySelector('tr.empty-row');
        if (total === 0) {
            if (!emptyRow) {
                emptyRow = document.createElement('tr');
                emptyRow.className = 'empty-row';
                const colCount = table.querySelectorAll('thead th').length || 1;
                emptyRow.innerHTML = `
                    <td colspan="${colCount}" style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
                        <i class="ph ph-magnifying-glass" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
                        <div>查無符合條件的資料</div>
                    </td>
                `;
                tbody.appendChild(emptyRow);
            } else {
                emptyRow.style.display = '';
            }
        } else if (emptyRow) {
            emptyRow.style.display = 'none';
        }

        // === 升級版分頁 (P1-9) ===
        // - 只 1 頁時隱藏整段
        // - 顯示「X-Y 筆 / 共 N 筆」+ 頁碼數字按鈕 + 上下頁
        const paginationContainer = filterCard.querySelector('.pagination-container');
        if (paginationContainer) {
            if (totalPages <= 1 && rowsPerPage !== 0) {
                // 只 1 頁就不秀分頁，省版面
                paginationContainer.style.display = total === 0 ? 'none' : 'flex';
                if (total > 0) {
                    paginationContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 0.5rem;">共 ${total} 筆</div>`;
                }
            } else {
                paginationContainer.style.display = 'flex';
                paginationContainer.innerHTML = renderPagination(total, currentPage, totalPages, start, end);
                bindPaginationClicks(paginationContainer, totalPages);
            }
        }
    }

    function renderPagination(total, page, totalPages, start, end) {
        const shownEnd = Math.min(end, total);
        const info = rowsPerPage === 0
            ? `<span class="pg-info">共 ${total} 筆 (全部顯示)</span>`
            : `<span class="pg-info">${start + 1}-${shownEnd} / 共 ${total} 筆</span>`;
        // 頁碼數字: 顯示最多 7 個，超過用 ...
        let pageBtns = '';
        if (rowsPerPage !== 0) {
            const pages = computePageList(page, totalPages);
            pageBtns = pages.map(p => {
                if (p === '...') return `<span class="pg-ellipsis">…</span>`;
                const active = p === page ? 'pg-active' : '';
                return `<button class="pg-num ${active}" data-page="${p}">${p}</button>`;
            }).join('');
        }
        const pageSizeOpts = [10, 25, 50, 100, 0]
            .map(n => `<option value="${n}" ${n === rowsPerPage ? 'selected' : ''}>${n === 0 ? '全部' : n}</option>`).join('');
        return `
            <div class="pg-wrap">
                ${info}
                ${rowsPerPage !== 0 ? `
                    <button class="pg-arrow" data-action="prev" ${page <= 1 ? 'disabled' : ''}><i class="ph ph-caret-left"></i></button>
                    ${pageBtns}
                    <button class="pg-arrow" data-action="next" ${page >= totalPages ? 'disabled' : ''}><i class="ph ph-caret-right"></i></button>
                ` : ''}
                <label class="pg-size">
                    每頁
                    <select data-action="set-size">${pageSizeOpts}</select>
                </label>
            </div>
        `;
    }

    function computePageList(current, total) {
        // 顯示策略: 永遠顯示 1 跟 total；current 周圍 ±1；中間斷層用 …
        if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
        const set = new Set([1, 2, total - 1, total, current - 1, current, current + 1]);
        const sorted = [...set].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
        const out = [];
        for (let i = 0; i < sorted.length; i++) {
            if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('...');
            out.push(sorted[i]);
        }
        return out;
    }

    function bindPaginationClicks(container, totalPages) {
        container.querySelectorAll('.pg-num').forEach(b => {
            b.addEventListener('click', () => {
                const p = parseInt(b.dataset.page, 10);
                if (p >= 1 && p <= totalPages) {
                    currentPage = p;
                    applyView();
                    saveState();
                }
            });
        });
        container.querySelector('[data-action="prev"]')?.addEventListener('click', () => {
            if (currentPage > 1) { currentPage--; applyView(); saveState(); }
        });
        container.querySelector('[data-action="next"]')?.addEventListener('click', () => {
            if (currentPage < totalPages) { currentPage++; applyView(); saveState(); }
        });
        container.querySelector('[data-action="set-size"]')?.addEventListener('change', (e) => {
            rowsPerPage = parseInt(e.target.value, 10);
            currentPage = 1;
            applyView();
            saveState();
        });
    }

    // 篩選 tab（依 data-filter-group 分組互斥；預設 group = "status"）
    // 點已 active 的 tab → 清除該 group (回到 'all')
    tabs.forEach(tab => {
        const value = tab.dataset.filterValue;
        const group = tab.dataset.filterGroup || 'status';

        if (!(group in filtersByGroup)) filtersByGroup[group] = 'all';
        if (tab.classList.contains('active')) filtersByGroup[group] = value;

        tab.addEventListener('click', () => {
            // 若使用者正在用搜尋框 → 記下游標位置，點完 filter 後幫他重新 focus 回去
            const wasSearching = searchInput && document.activeElement === searchInput;
            const cursorPos = wasSearching ? searchInput.selectionStart : null;
            const wasActive = tab.classList.contains('active');
            const isToggleOff = wasActive && value !== 'all';
            const isAllOfStatus = (value === 'all' && group === 'status');

            // 點「全部」(status group) = 清除所有 group 的篩選 (直覺上「全部」= 無篩選)
            if (isAllOfStatus) {
                Object.keys(filtersByGroup).forEach(g => { filtersByGroup[g] = 'all'; });
                // 清掉所有 tab 的 active，再幫各 group 的 'all' tab 重新打上 active
                filterCard.querySelectorAll('[data-filter-value]').forEach(t => t.classList.remove('active'));
                filterCard.querySelectorAll('[data-filter-value="all"]').forEach(t => t.classList.add('active'));
                tab.classList.add('active');
                currentPage = 1;
                applyView();
                saveState();
                return;
            }

            // 同 group 全部清除 active
            filterCard.querySelectorAll(`[data-filter-value][data-filter-group="${group}"]`)
                .forEach(t => t.classList.remove('active'));
            if (group === 'status') {
                filterCard.querySelectorAll('.filter-tab[data-filter-value]:not([data-filter-group])')
                    .forEach(t => t.classList.remove('active'));
            }

            if (isToggleOff) {
                // 第二次點 = 取消 → 切回該 group 的「全部」tab (如果有)
                filtersByGroup[group] = 'all';
                const allTab = filterCard.querySelector(`[data-filter-value="all"]${group === 'status' ? '' : `[data-filter-group="${group}"]`}`);
                if (allTab) allTab.classList.add('active');
                // 若沒同 group 全部 tab，且這是非 status group，就把 status 的全部 tab 設成 fallback active
                if (!allTab && group !== 'status') {
                    const statusAllTab = filterCard.querySelector('[data-filter-value="all"]:not([data-filter-group])');
                    if (statusAllTab && filtersByGroup.status === 'all') statusAllTab.classList.add('active');
                }
            } else {
                tab.classList.add('active');
                filtersByGroup[group] = value;
            }
            currentPage = 1;
            applyView();
            saveState();
            // 還原搜尋框 focus + 游標位置 (使用者連續操作不會被打斷)
            if (wasSearching && searchInput) {
                requestAnimationFrame(() => {
                    searchInput.focus();
                    if (cursorPos != null) searchInput.setSelectionRange(cursorPos, cursorPos);
                });
            }
        });
    });

    // 上面在 isAllOfStatus 分支內也加 saveState (避免遺漏)
    // 透過攔截 applyView wrapper? — 簡單做法：把 isAllOfStatus 那段也補
    // (已在下面 applyView() 後一次性存)

    // 搜尋框 (debounce 簡化版)
    if (searchInput) {
        let timer = null;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                currentSearch = e.target.value.trim().toLowerCase();
                currentPage = 1;
                applyView();
                saveState();
            }, 150);
        });
    }

    // (舊的 prevBtn / nextBtn / pageInfo handler 拿掉，改由 applyView 內動態 render + bind)

    // === 從快取還原狀態 (re-render 後的關鍵) ===
    const saved = viewStateCache.get(stateKey);
    if (saved) {
        Object.assign(filtersByGroup, saved.filtersByGroup || {});
        currentSearch = saved.currentSearch || '';
        currentPage = saved.currentPage || 1;
        if (typeof saved.rowsPerPage === 'number') rowsPerPage = saved.rowsPerPage;
        // 套到 UI: 搜尋框值
        if (searchInput && currentSearch) {
            searchInput.value = currentSearch;
        }
        // 套到 UI: filter tab active 狀態
        filterCard.querySelectorAll('[data-filter-value]').forEach(t => t.classList.remove('active'));
        Object.entries(filtersByGroup).forEach(([g, v]) => {
            const sel = g === 'status'
                ? `[data-filter-value="${v}"]:not([data-filter-group]), [data-filter-value="${v}"][data-filter-group="status"]`
                : `[data-filter-value="${v}"][data-filter-group="${g}"]`;
            const tab = filterCard.querySelector(sel);
            if (tab) tab.classList.add('active');
        });
        // 沒有任一 status active → 把 status 的「全部」打上
        if (!filterCard.querySelector('.filter-tab.active:not([data-filter-group]), .filter-tab.active[data-filter-group="status"]')) {
            const allTab = filterCard.querySelector('[data-filter-value="all"]:not([data-filter-group])');
            allTab?.classList.add('active');
        }
    }

    applyView();
}
