let db;
let directoryHandle = null;
let __anchorMeta = { folderName: null, anchoredAt: null, perm: null, storagePersisted: null };

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
    if (dbInfo.name && dbInfo.name !== 'BirdsExecutiveHub_v38') {
      console.log('[DB] Deleting old database:', dbInfo.name);
      indexedDB.deleteDatabase(dbInfo.name);
    }
  });
}).catch(function() {});

const req = indexedDB.open('BirdsExecutiveHub_v38', 1);
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
    if (typeof loadDirectoryHandle === 'function') await loadDirectoryHandle();
    // loadSharedActions is called on-demand from the audit hub after folder sync completes
    if (window.ComplaintsData && window.ComplaintsData.length) {
      window.__dataStatus.complaintsRows = window.ComplaintsData.length;
      console.log('[Startup] Complaints loaded from data folder sync:', window.ComplaintsData.length, 'rows');
    } else {
      console.log('[Startup] No complaints loaded — sync from data folder required');
    }
    renderDashboard();
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
    parts.push(s.weeklyFiles + ' weekly files');
    parts.push(s.complaintsRows + ' complaints');
        el.innerText = 'Data folder synced — ' + parts.join(', ') +   ' • ' + new Date(s.ts).toLocaleTimeString();
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

const idbGetAll = s => { if (!db || db.closed) { _reconnectDB(); return Promise.resolve([]); } try { return new Promise(res => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }); } catch(e) { if (String(e).includes('closing') || String(e).includes('closed')) _reconnectDB(); return Promise.resolve([]); } };
const idbGet = (s, k) => { if (!db || db.closed) { _reconnectDB(); return Promise.resolve(null); } try { return new Promise(res => { const r = db.transaction(s).objectStore(s).get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch(e) { if (String(e).includes('closing') || String(e).includes('closed')) _reconnectDB(); return Promise.resolve(null); } };
const idbAdd = (s, v) => { if (!db || db.closed) { _reconnectDB(); return Promise.resolve(null); } try { return new Promise(res => { const r = db.transaction(s,'readwrite').objectStore(s).add(v); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); } catch(e) { if (String(e).includes('closing') || String(e).includes('closed')) _reconnectDB(); return Promise.resolve(null); } };
const idbPut = (s, v) => { if (!db || db.closed) { _reconnectDB(); return Promise.resolve(false); } try { return new Promise(res => { const r = db.transaction(s,'readwrite').objectStore(s).put(v); r.onsuccess = () => res(true); r.onerror = () => res(false); }); } catch(e) { if (String(e).includes('closing') || String(e).includes('closed')) _reconnectDB(); return Promise.resolve(false); } };
const idbClear = (s) => { if (!db || db.closed) { _reconnectDB(); return Promise.resolve(false); } try { return new Promise(res => { const r = db.transaction(s,'readwrite').objectStore(s).clear(); r.onsuccess = () => res(true); r.onerror = () => res(false); }); } catch(e) { if (String(e).includes('closing') || String(e).includes('closed')) _reconnectDB(); return Promise.resolve(false); } };

// Auto-reconnect if DB connection closes (e.g. after SW update)
function _reconnectDB() {
  if (db && !db.closed) return;
  console.log('[DB] Connection lost — reconnecting...');
  var req2 = indexedDB.open('BirdsExecutiveHub_v38', 1);
  req2.onsuccess = function(e) { db = e.target.result; console.log('[DB] Reconnected'); };
  req2.onerror = function() { console.error('[DB] Reconnect failed'); };
}
setInterval(_reconnectDB, 5000);
