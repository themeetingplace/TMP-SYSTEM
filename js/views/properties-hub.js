// 物件管理 hub — 3 個 tab：住房一覽 / 物件一覽 / 房屋資料
// 取代原本「物件管理 (#properties)」+「住房一覽 (#occupancy)」兩個 sidebar 項目
// #occupancy 仍可直接 link 進來 (helper 預設首頁、舊書籤)，會強制鎖在住房一覽 tab

import { renderOccupancy, initOccupancyActions } from './occupancy.js';
import { renderProperties, initPropertyActions } from './properties.js';
import { renderHouses, initHousesActions } from './houses.js';
import { initTableInteractions } from '../utils/tableFilter.js';

const STORAGE_KEY = 'pms-properties-hub-tab';
const VALID_TABS = ['occupancy', 'properties', 'houses'];
const DEFAULT_TAB = 'occupancy';

const TABS = [
    { key: 'occupancy',  label: '住房一覽', icon: 'ph-chart-bar', render: renderOccupancy,  init: initOccupancyActions,  skipTableInteractions: true },
    { key: 'properties', label: '物件一覽', icon: 'ph-bed',       render: renderProperties, init: initPropertyActions },
    { key: 'houses',     label: '房屋資料', icon: 'ph-house',     render: renderHouses,     init: initHousesActions }
];

// 模組層：被 app.js handleRoute 設定為 'occupancy' (強制 lock) 或 null (用 localStorage)
let forcedTab = null;

export function forceHubTab(tab) {
    forcedTab = VALID_TABS.includes(tab) ? tab : null;
}

function getActiveTab() {
    if (forcedTab) return forcedTab;
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (VALID_TABS.includes(saved)) return saved;
    } catch {}
    return DEFAULT_TAB;
}

function saveActiveTab(tab) {
    if (!VALID_TABS.includes(tab)) return;
    try { localStorage.setItem(STORAGE_KEY, tab); } catch {}
}

export function renderPropertiesHub() {
    const activeTab = getActiveTab();
    const activeMeta = TABS.find(t => t.key === activeTab) || TABS[0];

    const tabsHtml = TABS.map(t => `
        <button class="settings-tab ${t.key === activeTab ? 'active' : ''}" data-hub-tab="${t.key}">
            <i class="ph ${t.icon}"></i> ${t.label}
        </button>
    `).join('');

    return `
        <div class="hub-container">
            <div class="settings-tabs hub-tabs">${tabsHtml}</div>
            <div class="hub-content" data-hub-active="${activeTab}">${activeMeta.render()}</div>
        </div>
    `;
}

export function initPropertiesHubActions(scope) {
    const tabsEl = scope.querySelector('.hub-tabs');
    const contentEl = scope.querySelector('.hub-content');
    if (!tabsEl || !contentEl) return;

    // 初次掛載：呼叫當前 active tab 的 init
    const activeTab = contentEl.dataset.hubActive;
    const activeMeta = TABS.find(t => t.key === activeTab);
    if (activeMeta?.init) activeMeta.init(contentEl);
    if (activeMeta && !activeMeta.skipTableInteractions) {
        initTableInteractions({ scope: contentEl, rowsPerPage: 10 });
    }

    // tab 切換
    tabsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-hub-tab]');
        if (!btn) return;
        const target = btn.dataset.hubTab;
        if (!VALID_TABS.includes(target) || target === contentEl.dataset.hubActive) return;

        // forcedTab 被切走 → 清掉 (避免下次又被 lock)
        if (forcedTab && target !== forcedTab) forcedTab = null;
        saveActiveTab(target);

        // 切按鈕 active
        tabsEl.querySelectorAll('[data-hub-tab]').forEach(b => b.classList.toggle('active', b === btn));

        // 重 render 內容區
        const meta = TABS.find(t => t.key === target);
        contentEl.dataset.hubActive = target;
        contentEl.innerHTML = meta.render();
        if (meta.init) meta.init(contentEl);
        if (!meta.skipTableInteractions) {
            initTableInteractions({ scope: contentEl, rowsPerPage: 10 });
        }
    });
}
