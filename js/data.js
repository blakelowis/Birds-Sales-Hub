async function loadDirectoryHandle() {
  // TEST MODE — skip Graph API init, use local folder picker instead
  console.log('[Startup] Test mode — skipping Graph API init');
}

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
      return;
    } catch (syncErr) {
      console.error('[Sync] Cloud sync failed:', syncErr);
      document.getElementById('ingestStatus').innerText = "Cloud sync failed: " + syncErr.message;
      window.__dataStatus.syncOk = false;
      return;
    }
  }

  // ===== LOCAL FOLDER PICKER FALLBACK =====
  document.getElementById('ingestStatus').innerText = "Opening folder picker...";
  try {
    directoryHandle = await window.showDirectoryPicker();
  } catch (pickErr) {
    if (pickErr.name === 'AbortError') {
      document.getElementById('ingestStatus').innerText = "Folder selection cancelled.";
      window.__dataStatus.syncOk = false;
      return;
    }
    document.getElementById('ingestStatus').innerText = "Folder picker failed: " + pickErr.message;
    window.__dataStatus.syncOk = false;
    return;
  }

  document.getElementById('ingestStatus').innerText = "Reading files from folder...";
  var localFiles = [];
  var trackerJsonText = null;
  for await (const entry of directoryHandle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.csv')) {
        localFiles.push(file);
      }
      if (file.name === 'tracker_data.json') {
        trackerJsonText = await file.text();
      }
    }
  }

  window.__dataStatus.filesFound = localFiles.length + (trackerJsonText ? 1 : 0);
  if (localFiles.length === 0 && !trackerJsonText) {
    document.getElementById('ingestStatus').innerText = "No .xlsx, .csv, or tracker_data.json found in selected folder.";
    window.__dataStatus.syncOk = false;
    return;
  }
  if (trackerJsonText) {
    try {
      const trackerData = JSON.parse(trackerJsonText);
      if (Array.isArray(trackerData)) {
        await idbClear('tracker_audits');
        for (const rec of trackerData) { await idbPut('tracker_audits', rec); }
        console.log('[Sync] Loaded', trackerData.length, 'tracker records from local folder');
      }
    } catch (tErr) { console.warn('[Sync] Failed to parse tracker_data.json:', tErr); }
  }
  if (localFiles.length > 0) await processFiles(localFiles, 'local folder');
  window.__dataStatus.syncOk = true;
  window.__dataStatus.ts = Date.now();
  window.__dataStatus.source = 'local folder';
};

// ===== SHAREPOINT AUTO-SYNC =====
// Processes raw XLSX ArrayBuffers through the same pipeline as local folder sync.
async function processFiles(cachedFiles, sourceLabel) {
  // Clear kpi before re-import to prevent stale data from removed/renamed files
  try { await idbClear('kpi'); } catch(e) { console.warn('[processFiles] kpi clear failed:', e); }
  const weeksTouched = new Set(); const yearsTouched = new Set(); const seenWeeksByYear = {};
  var weeklyCount = 0; var scorecardCount = 0;
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
        // Actions are read live from Open/ and Closed/ JSON files by the Audit Hub — no xlsx import needed
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

