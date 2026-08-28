let db;

window.__dataStatus = { syncRan: false, syncOk: false, filesFound: 0, weeklyFiles: 0, complaintsRows: 0, source: 'none', ts: null };

// Persist storage so IndexedDB doesn't get evicted
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then(function(persisted) {
    if (persisted) console.log('[DB] Storage persisted');
  }).catch(function() {});
}

// Delete old database versions to prevent stale data
indexedDB.databases && indexedDB.databases().then(function(dbs) {
  dbs.forEach(function(dbInfo) {
    if (dbInfo.name && dbInfo.name !== 'BirdsExecutiveHub_v41' && dbInfo.name !== 'BirdsExecutiveHub_v40' && dbInfo.name !== 'birds_documents' && dbInfo.name !== 'birds_users') {
      console.log('[DB] Deleting old database:', dbInfo.name);
      indexedDB.deleteDatabase(dbInfo.name);
    }
  });
}).catch(function() {});

const req = indexedDB.open('BirdsExecutiveHub_v41', 2);
req.onupgradeneeded = e => {
  const d = e.target.result;
  if(!d.objectStoreNames.contains('kpi')) d.createObjectStore('kpi', { keyPath: ['BranchId','Year','Week'] });
  if(!d.objectStoreNames.contains('audits')) d.createObjectStore('audits', { keyPath: ['Store','Year','Week'] });
  if(!d.objectStoreNames.contains('stores')) d.createObjectStore('stores', { keyPath: 'BranchId' });
  if(!d.objectStoreNames.contains('actions')) d.createObjectStore('actions', { keyPath: 'ActionID' });
  if(!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('area_winners_log')) d.createObjectStore('area_winners_log', { keyPath: ['Year','Week'] });
  if(!d.objectStoreNames.contains('area_metric_winners_log')) d.createObjectStore('area_metric_winners_log', { keyPath: ['Year','Week','Metric'] });
  if(!d.objectStoreNames.contains('store_winners_log')) d.createObjectStore('store_winners_log', { keyPath: ['Year','Week','Metric','Branch'] });
  if(!d.objectStoreNames.contains('ingest_log')) d.createObjectStore('ingest_log', { keyPath: 'id', autoIncrement: true });
  if(!d.objectStoreNames.contains('tracker_audits')) d.createObjectStore('tracker_audits', { keyPath: 'StoreId' });
  if(!d.objectStoreNames.contains('eho_data')) d.createObjectStore('eho_data', { keyPath: 'StoreId' });
  if(!d.objectStoreNames.contains('questionBank')) d.createObjectStore('questionBank', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('training_audits')) d.createObjectStore('training_audits', { keyPath: ['Store','Year','Week'] });
  if(!d.objectStoreNames.contains('complaints')) d.createObjectStore('complaints', { keyPath: 'id' });
  /* Phase 1: Messages + Communication stores */
  if(!d.objectStoreNames.contains('messages')) d.createObjectStore('messages', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('message_responses')) d.createObjectStore('message_responses', { keyPath: 'id' });
  /* Phase 1: Personal productivity stores */
  if(!d.objectStoreNames.contains('my_todos')) d.createObjectStore('my_todos', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('my_lists')) d.createObjectStore('my_lists', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('my_contacts')) d.createObjectStore('my_contacts', { keyPath: 'id' });
  /* Rota stores */
  if(!d.objectStoreNames.contains('rota_staff')) d.createObjectStore('rota_staff', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('rota_week')) d.createObjectStore('rota_week', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('rota_leave')) d.createObjectStore('rota_leave', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('shared_views')) d.createObjectStore('shared_views', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('it_tickets')) d.createObjectStore('it_tickets', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('form_templates')) d.createObjectStore('form_templates', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('form_submissions')) d.createObjectStore('form_submissions', { keyPath: 'id' });
  if(!d.objectStoreNames.contains('documents')) d.createObjectStore('documents', { keyPath: 'id' });
};
req.onerror = e => {
  console.error('[DB] Failed to open:', e.target.error);
};
req.onblocked = () => {
  console.warn('[DB] Open blocked — close other tabs using this app');
};
req.onsuccess = async e => { 
    db = e.target.result; 
    try { await idbClear('complaints'); } catch(e) { console.warn('[DB] complaints clear failed:', e.message); }
    try { await loadStoreMap(); } catch(e) { console.warn('[DB] loadStoreMap failed:', e.message); }
    populateExportDropdown();

    // v148: Auth-first boot — try silent Entra login, then load via Graph
    var _authReady = false;
    if (typeof BirdsAuth !== 'undefined') {
        try { BirdsAuth.init(); } catch(e) { console.warn('[DB] MSAL init failed:', e.message); }
        try {
            await BirdsAuth.loginSilent();
            await BirdsAuth.resolveSharePointIds();
            _authReady = true;
            console.log('[DB] Entra silent login OK');
            var fsEl = document.getElementById('folderStatus');
            if (fsEl) fsEl.textContent = 'Connected via SharePoint';
        } catch(e) {
            console.log('[DB] Silent login not available, showing login screen');
        }
    }

    // Init documents IDB connection so projects/documents can load
    if (typeof _localDocsInit === 'function') { try { await _localDocsInit(); } catch(e) { console.warn('[DB] _localDocsInit failed:', e.message); } }

    // Step 1: Show loading overlay
    var loadingEl = document.getElementById('loadingOverlay');
    if (loadingEl) loadingEl.style.display = 'flex';
    var loadingStatusEl = document.getElementById('loadingStatus');
    if (loadingStatusEl) loadingStatusEl.textContent = 'Loading KPI data...';

    if (_authReady) {
        // Logged in — load everything via Graph
        // Step 2: syncData FIRST (loads KPI data into IDB), THEN render
        if (typeof window.syncData === 'function') {
            try {
                document.getElementById('loadingStatus').textContent = 'Syncing KPI data from SharePoint...';
                await window.syncData();
            } catch(e) { console.warn('[DB] syncData failed:', e.message); }
        }
        document.getElementById('loadingStatus').textContent = 'Loading dashboard...';
        if (typeof Users !== 'undefined') {
            await Users.init();
            if (typeof Projects !== 'undefined') await Projects.load();
            if (typeof Messages !== 'undefined') try { await Messages.load(); } catch(e) { console.warn('[DB] Messages load failed:', e.message); }
            Users.updateHeaderBadge();
        }
        /* Restrict shop users to the Shop Tools tab only */
        if (typeof ShopTools !== 'undefined' && ShopTools._restrictShopUser) ShopTools._restrictShopUser();
        renderDashboard();
        if (loadingEl) loadingEl.style.display = 'none';
    } else if (typeof Users !== 'undefined') {
        // Not logged in — show Entra login screen
        await Users.init();
        Users.renderLoginScreen();
        var fsEl2 = document.getElementById('folderStatus');
        if (fsEl2) fsEl2.textContent = 'Sign in required';
        if (loadingEl) loadingEl.style.display = 'none';
    } else {
        renderDashboard();
        if (loadingEl) loadingEl.style.display = 'none';
    }

    if (window.ComplaintsData && window.ComplaintsData.length) {
        window.__dataStatus.complaintsRows = window.ComplaintsData.length;
        console.log('[Startup] Complaints loaded from data folder sync:', window.ComplaintsData.length, 'rows');
    } else {
        console.log('[Startup] No complaints loaded — sync from data folder required');
    }
    updateDataStatusUI();
    checkDataFreshness();
    if(typeof loadSettings === 'function') loadSettings();
};

function updateDataStatusUI() {
  var el = document.getElementById('ingestStatus');
  if (!el) return;
  var s = window.__dataStatus;
  var parts = [];
  if (s.syncRan && s.syncOk) {
    /* Show the most recent week loaded (from kpi_master.json) instead of old XLSX file counts */
    var wk = (typeof latestWkGlobal !== 'undefined' && latestWkGlobal) ? latestWkGlobal : 0;
    if (wk) parts.push('Latest week: ' + wk);
    else if (s.filesFound) parts.push(s.filesFound + ' records loaded');
    else parts.push('Data loaded');
    parts.push(s.complaintsRows + ' complaints');
        el.innerText = parts.join(' • ') + ' • ' + new Date(s.ts).toLocaleTimeString();
    el.className = 'text-xs font-bold text-emerald-600';
  } else if (s.syncRan && !s.syncOk) {
    el.innerText = 'Sync failed — click Refresh to retry';
    el.className = 'text-xs font-bold text-amber-600';
  } else {
    el.innerText = 'Not synced — no data folder anchored';
    el.className = 'text-xs font-bold text-red-500';
  }
}

async function checkDataFreshness() {
  try {
    const rec = await idbGet('settings', 'lastSynced');
    const badge = document.getElementById('lastSyncedBadge');
    if (!rec || !rec.timestamp) {
      if (badge) { badge.innerText = 'Never synced'; badge.className = 'text-[10px] font-bold text-amber-500'; }
      return;
    }
    const ageMs = Date.now() - rec.timestamp;
    const ageMin = Math.floor(ageMs / 60000);
    const ageHrs = Math.floor(ageMs / 3600000);
    if (badge) {
      if (ageMin < 1) {
        badge.innerText = 'Synced just now';
        badge.className = 'text-[10px] font-bold text-emerald-600';
      } else if (ageMin < 60) {
        badge.innerText = 'Synced ' + ageMin + 'm ago';
        badge.className = 'text-[10px] font-bold text-emerald-600';
      } else if (ageHrs <= 6) {
        badge.innerText = 'Synced ' + ageHrs + 'h ago';
        badge.className = 'text-[10px] font-bold text-slate-400';
      } else {
        badge.innerText = 'Data is ' + ageHrs + 'h old — click Refresh';
        badge.className = 'text-[10px] font-bold text-amber-600';
      }
    }
  } catch (_) {}
}

var _idbCache = {};
function _clearCache(store) { if (store) { delete _idbCache[store]; } else { _idbCache = {}; } }
window.invalidateAuditCache = function() { _clearCache('audits'); };

const idbGetAll = s => {
  if (_idbCache[s]) return Promise.resolve(_idbCache[s]);
  if (!db || db.closed) { _reconnectDB(); return Promise.resolve([]); }
  try {
    return new Promise(res => {
      const r = db.transaction(s).objectStore(s).getAll();
      r.onsuccess = () => {
        var data = r.result || [];
        if (s === 'kpi' || s === 'audits' || s === 'stores') _idbCache[s] = data;
        res(data);
      };
      r.onerror = () => res([]);
    });
  } catch(e) {
    if (String(e).includes('closing') || String(e).includes('closed')) _reconnectDB();
    return Promise.resolve([]);
  }
};
const idbGet = (s, k) => { if (!db || db.closed) { _reconnectDB(); return Promise.resolve(null); } try { return new Promise(res => { const r = db.transaction(s).objectStore(s).get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch(e) { if (String(e).includes('closing') || String(e).includes('closed')) _reconnectDB(); return Promise.resolve(null); } };
const idbAdd = (s, v) => { if (!db || db.closed) { _reconnectDB(); return Promise.resolve(null); } try { return new Promise(res => { const r = db.transaction(s,'readwrite').objectStore(s).add(v); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); } catch(e) { if (String(e).includes('closing') || String(e).includes('closed')) _reconnectDB(); return Promise.resolve(null); } };
const idbPut = (s, v) => { _clearCache(s); if (!db || db.closed) { _reconnectDB(); return Promise.resolve(false); } try { return new Promise(res => { const r = db.transaction(s,'readwrite').objectStore(s).put(v); r.onsuccess = () => { res(true); }; r.onerror = () => res(false); }); } catch(e) { if (String(e).includes('closing') || String(e).includes('closed')) _reconnectDB(); return Promise.resolve(false); } };
const idbClear = (s) => { _clearCache(s); if (!db || db.closed) { _reconnectDB(); return Promise.resolve(false); } try { return new Promise(res => { const r = db.transaction(s,'readwrite').objectStore(s).clear(); r.onsuccess = () => res(true); r.onerror = () => res(false); }); } catch(e) { if (String(e).includes('closing') || String(e).includes('closed')) _reconnectDB(); return Promise.resolve(false); } };

// Auto-reconnect if DB connection closes (e.g. after SW update)
function _reconnectDB() {
  if (db && !db.closed) return;
  console.log('[DB] Connection lost — reconnecting...');
  var req2 = indexedDB.open('BirdsExecutiveHub_v41', 1);
  req2.onsuccess = function(e) { db = e.target.result; console.log('[DB] Reconnected'); };
  req2.onerror = function() { console.error('[DB] Reconnect failed'); };
}
setInterval(_reconnectDB, 5000);

// Bulk put — writes all records in a single transaction (fast!)
const idbBulkPut = (s, records) => { _clearCache(s); if (!db || db.closed || !records || !records.length) { _reconnectDB(); return Promise.resolve(false); } try { return new Promise(res => { var tx = db.transaction(s, 'readwrite'); var store = tx.objectStore(s); for (var i = 0; i < records.length; i++) { store.put(records[i]); } tx.oncomplete = function() { res(true); }; tx.onerror = function() { res(false); }; }); } catch(e) { if (String(e).includes('closing') || String(e).includes('closed')) _reconnectDB(); return Promise.resolve(false); } };
