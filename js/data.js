async function loadDirectoryHandle() {
  try {
    // Check whether the browser is likely to evict IndexedDB/cache data
    try {
      if (navigator.storage && navigator.storage.persisted) {
        __anchorMeta.storagePersisted = await navigator.storage.persisted();
      }
    } catch (_) {}

    // Check for Azure AD config — if credentials are set, use Graph API path
    var azureConfig = null;
    try { azureConfig = await idbGet('settings', 'azureConfig'); } catch (_) {}
    if (azureConfig && azureConfig.clientId && azureConfig.tenantId) {
      console.log('[Startup] Azure AD config detected — attempting Microsoft Graph API auth');
      window.__azureConfig = azureConfig;
      if (typeof GraphAPI !== 'undefined' && typeof GraphAPI.init === 'function') {
        try {
          await GraphAPI.init(azureConfig);
          await GraphAPI.acquireToken();
          console.log('[Startup] Graph API authenticated successfully');
        } catch (graphErr) {
          console.warn('[Startup] Graph API auth failed, falling back to local folder:', graphErr);
          window.__azureConfig = null;
        }
      } else {
        console.log('[Startup] GraphAPI module not loaded — using local folder mode');
        window.__azureConfig = null;
      }
      if (window.__azureConfig && typeof GraphAPI !== 'undefined' && GraphAPI.isAuthenticated()) {
        console.log('[Startup] Cloud sync active — auto-syncing from SharePoint');
        const cloudStatusEl = document.getElementById('folderStatus');
        if (cloudStatusEl) cloudStatusEl.innerText = 'Status: Cloud sync active (Azure AD)';
        try { await syncData(); } catch (syncErr) { console.warn('[Startup] Cloud sync failed:', syncErr); }
        return;
      }
    }

    const settings = await idbGetAll('settings');
    const saved = settings.find(s => s.id === 'masterFolder');
    const statusEl = document.getElementById('folderStatus');

    if (!saved || !saved.dirHandle) {
      directoryHandle = null;
      __anchorMeta.folderName = null;
      __anchorMeta.anchoredAt = null;
      __anchorMeta.perm = null;
      if (statusEl) statusEl.innerText = 'Status: Not Anchored';
      return;
    }

    // Restore handle + meta
    directoryHandle = saved.dirHandle;
    __anchorMeta.folderName = saved.folderName || (directoryHandle && directoryHandle.name) || null;
    __anchorMeta.anchoredAt = saved.anchoredAt || null;

    // Query permission without prompting (prompting requires a user gesture)
    let perm = null;
    try {
      perm = await directoryHandle.queryPermission({ mode: 'read' });
    } catch (_) {
      perm = null;
    }
    __anchorMeta.perm = perm;

    const folderLabel = __anchorMeta.folderName ? (' — ' + __anchorMeta.folderName) : '';
    const lockLine = (perm === 'granted')
      ? ' Locked (auto-restored)'
      : (perm === 'prompt')
        ? '️ Locked (needs permission — press Refresh Data once)'
        : '️ Locked (permission denied — reselect folder)';

    const persistLine = (__anchorMeta.storagePersisted === true)
      ? ' • Storage: persistent'
      : (__anchorMeta.storagePersisted === false)
        ? ' • Storage: not persistent'
        : '';

    if (statusEl) statusEl.innerText = 'Status: ' + lockLine + folderLabel + persistLine;

    if (perm === 'granted') {
      console.log('[Startup] Permission granted — auto-syncing Data folder');
      try { await syncData(); } catch (syncErr) { console.warn('[Startup] Auto-sync failed:', syncErr); }
    }
  } catch (e) {
    console.warn('loadDirectoryHandle failed', e);
    try {
      const statusEl = document.getElementById('folderStatus');
      if (statusEl) statusEl.innerText = 'Status: Not Anchored';
    } catch (_) {}
  }
}

window.selectAndAnchorFolder = async function() {
  try {
    // Request persistent storage (best-effort) to reduce IndexedDB eviction
    try {
      if (navigator.storage && navigator.storage.persist) {
        const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        if (!already) {
          await navigator.storage.persist();
        }
        __anchorMeta.storagePersisted = navigator.storage.persisted ? await navigator.storage.persisted() : __anchorMeta.storagePersisted;
      }
    } catch (_) {}

    directoryHandle = await window.showDirectoryPicker();

    __anchorMeta.folderName = (directoryHandle && directoryHandle.name) || null;
    __anchorMeta.anchoredAt = Date.now();

    await idbPut('settings', {
      id: 'masterFolder',
      dirHandle: directoryHandle,
      folderName: __anchorMeta.folderName,
      anchoredAt: __anchorMeta.anchoredAt
    });

    const statusEl = document.getElementById('folderStatus');
    const folderLabel = __anchorMeta.folderName ? (' — ' + __anchorMeta.folderName) : '';
    const persistLine = (__anchorMeta.storagePersisted === true)
      ? ' • Storage: persistent'
      : (__anchorMeta.storagePersisted === false)
        ? ' • Storage: not persistent'
        : '';
    if (statusEl) statusEl.innerText = 'Status:  Locked (selected)' + folderLabel + persistLine;

    await syncData();
  } catch (err) {
    console.warn('selectAndAnchorFolder cancelled/failed', err);
  }
};

async function verifyPermission(fileHandle, readWrite) {
    const options = {}; if (readWrite) options.mode = 'readwrite';
    if ((await fileHandle.queryPermission(options)) === 'granted') return true;
    if ((await fileHandle.requestPermission(options)) === 'granted') return true;
    return false;
}

window.syncData = async function() {
  window.__dataStatus.syncRan = true;
  window.ComplaintsData = null;
  window.__dataStatus.complaintsRows = 0;
  window.__complaintsSourceCSV = false;
  document.getElementById('ingestStatus').innerText = "Scanning... Please wait.";

  // ===== GRAPH API PATH (cloud sync) =====
  if (window.__azureConfig && typeof GraphAPI !== 'undefined' && GraphAPI.isAuthenticated()) {
    console.log('[Sync] Using Microsoft Graph API for cloud sync');
    try {
      var remoteFiles = await GraphAPI.listFiles();
      var cachedFiles = [];
      var trackerJsonText = null;

      for (var i = 0; i < remoteFiles.length; i++) {
        var f = remoteFiles[i];
        document.getElementById('ingestStatus').innerText = "Downloading " + (i + 1) + " of " + remoteFiles.length + "... " + f.name;
        try {
          if (f.name.toLowerCase().endsWith('.xlsx') || f.name.toLowerCase().endsWith('.csv')) {
            var buffer = await GraphAPI.downloadFile(f.name);
            var blob = new Blob([buffer], { type: f.name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv' });
            var fileObj = new File([blob], f.name, { lastModified: new Date(f.lastModifiedDateTime).getTime() });
            cachedFiles.push(fileObj);
          }
          if (f.name === 'tracker_data.json') {
            trackerJsonText = await GraphAPI.downloadFileAsText(f.name);
          }
        } catch (dlErr) {
          console.warn('[Sync] Failed to download ' + f.name + ':', dlErr.message);
        }
      }

      window.__dataStatus.filesFound = cachedFiles.length + (trackerJsonText ? 1 : 0);
      if (cachedFiles.length === 0 && !trackerJsonText) {
        document.getElementById('ingestStatus').innerText = "No .xlsx, .csv, or tracker_data.json found in SharePoint library.";
        window.__dataStatus.syncOk = false;
        return;
      }
      if (cachedFiles.length > 0) await processFiles(cachedFiles, 'sharepoint');
      window.__dataStatus.syncOk = true;
      window.__dataStatus.ts = Date.now();
      window.__dataStatus.source = 'sharepoint';

      if (trackerJsonText) {
        try {
          var importObj = JSON.parse(trackerJsonText);
          var stores = importObj.stores || importObj;
          var count = 0;
          var keys = Object.keys(stores);
          for (var i = 0; i < keys.length; i++) {
            var rec = stores[keys[i]];
            if (rec && rec.StoreId) { await idbPut('eho_data', rec); count++; }
          }
          console.log('[Cloud] Loaded tracker data: ' + count + ' stores');
        } catch(e) { console.warn('[Cloud] Failed to load tracker JSON:', e); }
      }
      return;
    } catch (syncErr) {
      console.error('[Sync] Cloud sync failed:', syncErr);
      document.getElementById('ingestStatus').innerText = "Cloud sync failed: " + syncErr.message;
      window.__dataStatus.syncOk = false;
      return;
    }
  }

  // ===== FSA PATH (local folder) =====
  if (!directoryHandle) { alert("Please anchor a master folder first using 'Select Data Folder'."); return; }
  const hasPerm = await verifyPermission(directoryHandle, false);
  if(!hasPerm) { alert("Permission is needed to access the anchored folder. When prompted, choose Allow. If you no longer have access, use 'Select Data Folder' to re-anchor."); return; }
  let localFiles = [];
  let trackerJson = null;
  try {
      for await (const entry of directoryHandle.values()) {
          if (entry.kind === 'file' && (entry.name.endsWith('.xlsx') || entry.name.endsWith('.csv')) && !entry.name.startsWith('~')) localFiles.push(await entry.getFile());
          if (entry.kind === 'file' && entry.name === 'tracker_data.json') trackerJson = await entry.getFile();
      }
  } catch (err) { alert("Could not scan directory. Ensure the folder still exists."); window.__dataStatus.syncOk = false; return; }
  window.__dataStatus.filesFound = localFiles.length + (trackerJson ? 1 : 0);
  if (localFiles.length === 0 && !trackerJson) { document.getElementById('ingestStatus').innerText = "No .xlsx, .csv, or tracker_data.json files found in the selected folder."; window.__dataStatus.syncOk = false; return; }
  if (localFiles.length > 0) await processFiles(localFiles, 'file');
  window.__dataStatus.syncOk = true;
  window.__dataStatus.ts = Date.now();
  window.__dataStatus.source = 'folder';
  if (trackerJson) {
    try {
      var text = await trackerJson.text();
      var importObj = JSON.parse(text);
      var stores = importObj.stores || importObj;
      var count = 0;
      var keys = Object.keys(stores);
      for (var i = 0; i < keys.length; i++) {
        var rec = stores[keys[i]];
        if (rec && rec.StoreId) { await idbPut('eho_data', rec); count++; }
      }
      console.log('[Local] Loaded tracker data: ' + count + ' stores');
    } catch(e) { console.warn('[Local] Failed to load tracker JSON:', e); }
  }
};

// ===== SHAREPOINT AUTO-SYNC =====
// Processes raw XLSX ArrayBuffers through the same pipeline as local folder sync.
async function processFiles(cachedFiles, sourceLabel) {
  const weeksTouched = new Set(); const yearsTouched = new Set(); const seenWeeksByYear = {};
  var weeklyCount = 0; var scorecardCount = 0;
  // Only clear actions that came from scorecard XLSX sync — preserve custom audit actions
  var existingActions = await idbGetAll('actions');
  for (var ai = 0; ai < existingActions.length; ai++) {
    if (existingActions[ai]._source === 'scorecard') {
      await (function(a) { return new Promise(function(res) { var r = db.transaction('actions','readwrite').objectStore('actions').delete(a.ActionID); r.onsuccess = function(){res(true);}; r.onerror = function(){res(false);}; }); })(existingActions[ai]);
    }
  }
  let filesProcessed = 0;
  for (const file of cachedFiles) {
    filesProcessed++;
    document.getElementById('ingestStatus').innerText = `Processing ${sourceLabel} ${filesProcessed} of ${cachedFiles.length}...`;
    await new Promise(r => setTimeout(r, 20));
    try {
      const buffer = file.buffer || await file.arrayBuffer();

      // Handle CSV files (complaints / hygiene ratings)
      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = new TextDecoder('utf-8').decode(buffer);
        if (file.name.toLowerCase().includes('complaint')) {
          console.log('[+] Complaints CSV detected:', file.name);
          const rows = (typeof parseComplaintsCSV === 'function') ? parseComplaintsCSV(text) : [];
          console.log('[+] Complaints CSV parsed:', rows.length, 'rows from', file.name);
          if (rows.length > 0) {
            window.loadComplaintsFromSheet(rows);
            window.__complaintsSourceCSV = true;
            console.log('[Complaints] Loaded', rows.length, 'rows from CSV file:', file.name);
          } else {
            console.warn('[Complaints] No rows parsed from', file.name);
          }
        }
        if (file.name.toLowerCase().includes('hygiene') || file.name.toLowerCase().includes('eho') || file.name.toLowerCase().includes('rating register')) {
          console.log('[+] Hygiene Rating CSV detected:', file.name);
          if (typeof window._ehoRatings === 'undefined') window._ehoRatings = new Map();
          var hLines = text.split('\n').filter(function(l) { return l.trim(); });
          if (hLines.length >= 2) {
            var hHeaders = hLines[0].split(',').map(function(h) { return h.trim(); });
            var hNameIdx = hHeaders.indexOf('Shop Name');
            var hRatingIdx = hHeaders.indexOf('Hygiene Rating');
            var hDateIdx = hHeaders.indexOf('Inspection Date');
            var hNextIdx = hHeaders.indexOf('Next Insp. Due');
            var hFoodIdx = hHeaders.indexOf('Food safety Score');
            if (hNameIdx >= 0 && hRatingIdx >= 0) {
              for (var hi = 1; hi < hLines.length; hi++) {
                var hCols = hLines[hi].split(',').map(function(c) { return c.trim(); });
                var hName = hCols[hNameIdx];
                var hRating = parseInt(hCols[hRatingIdx]);
                if (hName && !isNaN(hRating)) {
                  window._ehoRatings.set(hName.toLowerCase(), {
                    name: hName,
                    rating: hRating,
                    inspectionDate: hDateIdx >= 0 ? (hCols[hDateIdx] || '') : '',
                    nextDue: hNextIdx >= 0 ? (hCols[hNextIdx] || '') : '',
                    foodScore: hFoodIdx >= 0 ? (hCols[hFoodIdx] || '') : ''
                  });
                }
              }
              console.log('[EHO] Loaded', window._ehoRatings.size, 'hygiene ratings from CSV:', file.name);
            }
          }
        }
        continue; // Skip XLSX processing for CSV files
      }

      // Handle XLSX files
      const wb = XLSX.read(buffer, { type: 'array' });
      const resolved = resolveWeekYear(file.name, wb); const fileWk = resolved.week || 0; const fileYr = resolved.year || (new Date().getFullYear());
      yearsTouched.add(fileYr); if(!seenWeeksByYear[fileYr]) seenWeeksByYear[fileYr] = new Set();
      if(fileWk) seenWeeksByYear[fileYr].add(fileWk); currentAwardsYear = Math.max(currentAwardsYear || fileYr, fileYr);
      if(fileWk) weeksTouched.add(fileWk); if(fileWk > latestWkGlobal) latestWkGlobal = fileWk;
      let insertedRows = 0;
      if(file.name.toLowerCase().includes('weekly')) {
        weeklyCount++;
        let weeklySheet = wb.Sheets['Report 1 (Detailed)'] || wb.Sheets['Report 1 (Detailed) (Template)'];
        if(!weeklySheet) { const possibleName = wb.SheetNames.find(n => n.toLowerCase().includes('report') || n.toLowerCase().includes('detailed')); weeklySheet = possibleName ? wb.Sheets[possibleName] : wb.Sheets[wb.SheetNames[0]]; }
        const rows = weeklySheet ? XLSX.utils.sheet_to_json(weeklySheet, {header:1}) : []; const cols = findCols(rows);
        if(cols) {
          for(let i=cols.hr+1; i<rows.length; i++){
            const r = rows[i]; if(!r || !r[cols.idxB] || String(r[cols.idxB]).toLowerCase().includes('total')) continue;
            let rawBranch = cleanStoreName(r[cols.idxB]);
            let branchId = canonicalStoreId(rawBranch);
            if (!storeMap.has(branchId)) {
              let defaultAM = 'Unassigned';
              const bLower = branchId.toLowerCase();
              for (const [am, branches] of Object.entries(DEFAULT_AREA_MAPPING)) {
                if (branches.some(b => {
                  const bId = canonicalStoreId(b).toLowerCase();
                  return bLower === bId || bLower.startsWith(bId) || bId.startsWith(bLower);
                })) { defaultAM = am; break; }
              }
              await idbPut('stores', { BranchId: branchId, originalName: rawBranch, AM: defaultAM });
              storeMap.set(branchId, defaultAM);
              originalStoreNames.set(branchId, rawBranch);
            }
            await idbPut('kpi', {
              Branch: rawBranch, Week: fileWk, Year: fileYr, AM: resolveStoreAM(r, branchId),
              Sales: cols.idxS >= 0 ? parseVal(r[cols.idxS]) : 0, SalesActual: (cols.idxSA !== undefined && cols.idxSA >= 0) ? parseVal(r[cols.idxSA]) : 0, __rawSales: (cols.idxSA !== undefined && cols.idxSA >= 0) ? parseVal(r[cols.idxSA]) : undefined, Product: cols.idxP >= 0 ? parseVal(r[cols.idxP]) : 0,
              Waste: cols.idxW >= 0 ? parseVal(r[cols.idxW]) : 0, Labour: cols.idxL >= 0 ? parseVal(r[cols.idxL]) : 0,
              ATV: cols.idxA >= 0 ? parseVal(r[cols.idxA]) : 0, Energy: cols.idxE >= 0 ? parseVal(r[cols.idxE]) : 0,
              FilledRolls: cols.idxFR >= 0 ? parseVal(r[cols.idxFR]) : 0, Sandwiches: cols.idxSW >= 0 ? parseVal(r[cols.idxSW]) : 0,
              HotRolls: cols.idxHR >= 0 ? parseVal(r[cols.idxHR]) : 0, HotBev: cols.idxHB >= 0 ? parseVal(r[cols.idxHB]) : 0,
              IsAnomaly: false
            });
            insertedRows++;
          }
        }
      }
      await logIngest({ file: file.name, kind: 'weekly', year: fileYr, week: fileWk, rowsInserted: insertedRows });
      if(file.name.toLowerCase().includes('scorecard')) {
        scorecardCount++;
        const sWk = fileWk > 0 ? fileWk : (latestWkGlobal > 0 ? latestWkGlobal : 1); if(sWk) weeksTouched.add(sWk);
        if(wb.Sheets['Scorecards']) {
          const json = XLSX.utils.sheet_to_json(wb.Sheets['Scorecards']);
          for(const r of json) {
            if(r.Store) {
              let rawStore = cleanStoreName(r.Store);
              await idbPut('audits', { Store: rawStore, Week: sWk, Year: fileYr, Score: parseVal(r['Total score'] || r['Audit Score']) * (String(r['Total score']||'').includes('%')?100:1), Food: parseVal(r['Food safety']), Fire: parseVal(r['Fire safety']), HandS: parseVal(r['HandS ']), Journey: parseVal(r['Customer journey']), Coffee: parseVal(r['Coffee']), Focus: parseVal(r['Birds focus']) });
            }
          }
        }
        if(!window.__complaintsSourceCSV && wb.Sheets['complaints']) {
          const complaintsRows = XLSX.utils.sheet_to_json(wb.Sheets['complaints'], { defval: '' });
          if (complaintsRows && complaintsRows.length) {
            window.loadComplaintsFromSheet(complaintsRows);
            console.log('[Complaints] Loaded', complaintsRows.length, 'rows from XLSX sheet:', file.name);
          }
        } else if (window.__complaintsSourceCSV && wb.Sheets['complaints']) {
          console.log('[Complaints] Skipping XLSX complaints sheet in', file.name, '— CSV already loaded');
        }
        if(wb.Sheets['Data']) {
          const dataJson = XLSX.utils.sheet_to_json(wb.Sheets['Data']);
          for(const r of dataJson) {
            if(r.Question && r.Status) {
              let dOpen = parseDateSafe(r.Date); let dClosed = parseDateSafe(r['Closed On']); let daysToClose = null;
              if(dOpen && dClosed) { daysToClose = (dClosed - dOpen) / (1000 * 60 * 60 * 24); if(daysToClose < 0) daysToClose = 0; }
              const rawStoreForAction = cleanStoreName(r['Store Name'] || r.Store || r['Data'] || '');
              const rawQuestionForAction = normalizeAuditCell(r.Question || '');
              const rawStatusForAction = normalizeActionStatus(r.Status || '');
              const headerLike = ['store name','data','question','status','sector'].includes(String(rawStoreForAction).toLowerCase()) || ['question',''].includes(rawQuestionForAction.toLowerCase()) || rawStatusForAction === 'Status';
              if(headerLike) continue;
              await idbPut('actions', {
                Week: sWk, Year: fileYr, Store: rawStoreForAction, StoreEmail: r['Store Email'] || '',
                Auditor: r.Auditor || '', Manager: r.Manager || '', AuditDate: r.Date || '',
                AreaManager: r['Area Manager'] || safeGetAM(rawStoreForAction), Sector: r.Sector || '',
                Category: r.Category || '', QuestionID: r['Question ID'] || '', Question: r.Question || '',
                Answer: normalizeAuditCell(r.Answer), Description: r.Description || '',
                PersonResponsible: r['Person responsible'] || '', ActionNeeded: r['Action Needed'] || '',
                Status: rawStatusForAction, ClosedOn: r['Closed On'] || '',
                HowClosed: r['How action was closed'] || '', ExtraComment: r['Extra Comment'] || '',
                Critical: normalizeYesNo(r.Critical), DaysToClose: daysToClose,
                DaysOpen: dOpen ? Math.max(0, (new Date() - dOpen) / (1000 * 60 * 60 * 24)) : null,
                _source: 'scorecard'
              });
            }
          }
        }
      }
    } catch (innerErr) { console.warn(`Skipping file ${file.name} due to an error:`, innerErr); }
  }
  __missingByYear = computeMissingWeeks(seenWeeksByYear);
  const b = document.getElementById('missingWeeksBadge'); if(b) b.innerText = formatMissingBadge(__missingByYear);
  window.__dataStatus.weeklyFiles = weeklyCount;
  if (window.__dataStatus.complaintsRows === 0 && window.ComplaintsData && window.ComplaintsData.length) window.__dataStatus.complaintsRows = window.ComplaintsData.length;
  document.getElementById('ingestStatus').innerText = "Last Updated: " + new Date().toLocaleTimeString();
  await validateAndCorrectData(Array.from(weeksTouched));
  await flagAnomalies();
  for(const yr of Array.from(yearsTouched)) { await recordPersistentWinnersForWeeks(yr, Array.from(weeksTouched)); }
  await idbPut('settings', { id: 'lastSynced', timestamp: Date.now() });
  renderDashboard();
  checkDataFreshness();
}

