let db;
let directoryHandle = null;
let __anchorMeta = { folderName: null, anchoredAt: null, perm: null, storagePersisted: null };

window.__dataStatus = { syncRan: false, syncOk: false, filesFound: 0, weeklyFiles: 0, complaintsRows: 0, actionsFromJson: 0, source: 'none', ts: null };

// Delete old database versions to prevent stale data
indexedDB.databases && indexedDB.databases().then(function(dbs) {
  dbs.forEach(function(dbInfo) {
    if (dbInfo.name && dbInfo.name !== 'BirdsExecutiveHub_v37') {
      console.log('[DB] Deleting old database:', dbInfo.name);
      indexedDB.deleteDatabase(dbInfo.name);
    }
  });
}).catch(function() {});

const req = indexedDB.open('BirdsExecutiveHub_v37', 7);
req.onupgradeneeded = e => {
  const d = e.target.result;
  if(!d.objectStoreNames.contains('kpi')) d.createObjectStore('kpi', { keyPath: ['Branch','Year','Week'] });
  if(!d.objectStoreNames.contains('audits')) d.createObjectStore('audits', { keyPath: ['Store','Year','Week'] });
  if(!d.objectStoreNames.contains('stores')) d.createObjectStore('stores', { keyPath: 'BranchId' });
  if(!d.objectStoreNames.contains('actions')) d.createObjectStore('actions', { keyPath: 'ActionID', autoIncrement: true });
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
req.onsuccess = async e => { 
    db = e.target.result; 
    await idbClear('complaints');
    await loadStoreMap();
    populateExportDropdown();
    if (typeof loadDirectoryHandle === 'function') await loadDirectoryHandle();
    if (typeof loadSharedActions === 'function') {
      try {
        var sharedResult = await loadSharedActions();
        if (sharedResult && sharedResult.open) window.__dataStatus.actionsFromJson = sharedResult.open.length;
      } catch(e) { console.warn('loadSharedActions failed:', e.message); }
    }
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
    parts.push(s.actionsFromJson + ' actions from JSON');
    el.innerText = 'Data folder synced — ' + parts.join(', ') + ' • ' + new Date(s.ts).toLocaleTimeString();
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

const idbGetAll = (s) => new Promise(res => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
const idbGet = (s, k) => new Promise(res => { const r = db.transaction(s).objectStore(s).get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
const idbAdd = (s, v) => new Promise(res => { try{ const r = db.transaction(s,'readwrite').objectStore(s).add(v); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch(e){ res(null); }});
const idbPut = (s, v) => new Promise(res => { const r = db.transaction(s,'readwrite').objectStore(s).put(v); r.onsuccess = () => res(true); r.onerror = (err) => { console.error('DB Put Error', err); res(false); }; });
const idbClear = (s) => new Promise(res => { const r = db.transaction(s,'readwrite').objectStore(s).clear(); r.onsuccess = () => res(true); r.onerror = () => res(false); });
