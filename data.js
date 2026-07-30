window.syncData = async function() {
  window.__dataStatus.syncRan = true;
  window.ComplaintsData = null;
  window.__dataStatus.complaintsRows = 0;
  window.__complaintsSourceCSV = false;
  document.getElementById('ingestStatus').innerText = "Scanning... Please wait.";

  // v168: ONLY read from kpi_master.json — NEVER download XLSX files
  if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
    document.getElementById('ingestStatus').innerText = "Loading KPI data...";
    try {
      // Read kpi_master.json directly — no folder listing needed
      var masterText = await GraphClient.readFile('kpi_master.json');
      console.log('[Sync] master read:', typeof masterText, masterText ? (masterText.length + ' bytes') : 'null');
      if (masterText) {
        try {
          var master = JSON.parse(masterText);
          if (master && master.records && master.records.length > 0) {
            console.log('[Sync] FAST PATH —', master.records.length, 'records');
            document.getElementById('ingestStatus').innerText = "Loading " + master.records.length + " records...";
            for (var mi = 0; mi < master.records.length; mi++) {
              await idbPut('kpi', master.records[mi]);
            }
            window.__dataStatus.filesFound = master.records.length;
            window.__dataStatus.syncOk = true;
            window.__dataStatus.ts = Date.now();
            window.__dataStatus.source = 'MasterJSON';
            document.getElementById('ingestStatus').innerText = "Loaded: " + master.records.length + " records.";
            // List folder for CSV/tracker only (never XLSX)
            try {
              var items = await GraphClient.listFolder('');
              var csvBlobs = [];
              var trackerJsonText = null;
              for (var item of items) {
                if (item.isFolder) continue;
                var name = item.name;
                if (name === 'tracker_data.json') {
                  trackerJsonText = await GraphClient.readFile(name);
                } else if (name.toLowerCase().endsWith('.csv')) {
                  var csvBuf = await GraphClient.readFileBinary(name);
                  if (csvBuf) { var b = new Blob([csvBuf], { type: 'text/csv' }); b.name = name; csvBlobs.push(b); }
                }
              }
              if (trackerJsonText) {
                try {
                  var td = JSON.parse(trackerJsonText);
                  var so = td.stores || td.updates || td;
                  var se = (typeof so === 'object' && !Array.isArray(so)) ? Object.entries(so) : (Array.isArray(so) ? so.map(function(r) { return [r.StoreId || r.id, r]; }) : []);
                  for (var si = 0; si < se.length; si++) {
                    if (se[si][1] && typeof se[si][1] === 'object') { if (!se[si][1].StoreId) se[si][1].StoreId = se[si][0]; await idbPut('eho_data', se[si][1]); }
                  }
                } catch(tErr) { console.warn('[Sync] tracker error:', tErr); }
              }
              if (csvBlobs.length > 0) { await processFiles(csvBlobs, 'SharePoint'); }
            } catch(listErr) { console.warn('[Sync] Folder list failed (non-fatal):', listErr.message); }
            return;
          }
          console.warn('[Sync] Master has no records');
        } catch(parseErr) { console.warn('[Sync] Master JSON parse error:', parseErr.message); }
      }
      // No valid master found — show error, NEVER fall back to XLSX
      console.warn('[Sync] No master JSON — use "Build Master" button');
      document.getElementById('ingestStatus').innerText = "No KPI master found. Click Admin → Build Master.";
      window.__dataStatus.syncOk = false;
      window.__dataStatus.ts = Date.now();
    } catch(e) {
      console.warn('[Sync] SharePoint sync failed:', e.message);
    }
    return;
  }

  document.getElementById('ingestStatus').innerText = "Not connected to SharePoint — sign in to sync data.";
  window.__dataStatus.syncOk = false;
};

// ===== SHAREPOINT AUTO-SYNC =====
// Processes raw XLSX ArrayBuffers through the same pipeline as local folder sync.
async function processFiles(cachedFiles, sourceLabel) {
  var hasXlsx = cachedFiles.some(function(f) { return f.name && f.name.toLowerCase().endsWith('.xlsx'); });
  // Clear kpi before re-import to prevent stale data from removed/renamed files
  if (hasXlsx) { try { await idbClear('kpi'); } catch(e) { console.warn('[processFiles] kpi clear failed:', e); } }
  const weeksTouched = new Set(); const yearsTouched = new Set(); const seenWeeksByYear = {};
  var weeklyCount = 0; var scorecardCount = 0;
  let filesProcessed = 0;
  // Sort files alphabetically for deterministic processing order
  const sortedFiles = [...cachedFiles].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  for (const file of sortedFiles) {
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
        
        // Helper: parse one sheet's rows and insert KPI records for a given week
        async function parseSheetRows(sheetRows, wkNum, yrNum) {
          const cols = findCols(sheetRows);
          if (!cols) return 0;
          let count = 0;
          for (let i = cols.hr + 1; i < sheetRows.length; i++) {
            const r = sheetRows[i];
            if (!r || !r[cols.idxB] || String(r[cols.idxB]).toLowerCase().includes('total')) continue;
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
              BranchId: branchId, Branch: rawBranch, Week: wkNum, Year: yrNum, AM: resolveStoreAM(r, branchId),
              Sales: cols.idxS >= 0 ? parseVal(r[cols.idxS]) : 0, SalesActual: (cols.idxSA !== undefined && cols.idxSA >= 0) ? parseVal(r[cols.idxSA]) : 0, __rawSales: (cols.idxSA !== undefined && cols.idxSA >= 0) ? parseVal(r[cols.idxSA]) : undefined, Product: cols.idxP >= 0 ? parseVal(r[cols.idxP]) : 0,
              Waste: cols.idxW >= 0 ? parseVal(r[cols.idxW]) : 0, Labour: cols.idxL >= 0 ? parseVal(r[cols.idxL]) : 0,
              ATV: cols.idxA >= 0 ? parseVal(r[cols.idxA]) : 0, Energy: cols.idxE >= 0 ? parseVal(r[cols.idxE]) : 0,
              FilledRolls: cols.idxFR >= 0 ? parseVal(r[cols.idxFR]) : 0, Sandwiches: cols.idxSW >= 0 ? parseVal(r[cols.idxSW]) : 0,
              HotRolls: cols.idxHR >= 0 ? parseVal(r[cols.idxHR]) : 0, HotBev: cols.idxHB >= 0 ? parseVal(r[cols.idxHB]) : 0,
              IsAnomaly: false
            });
            count++;
          }
          return count;
        }

        // Scan ALL sheets for week-numbered sheets (e.g. "W1 26", "W 13 26", "Wk17")
        let sheetsWithWeekData = 0;
        for (const sName of wb.SheetNames) {
          const wkMatch = sName.match(/^W\s*(\d{1,2})\s+\d{2,4}$/i) || sName.match(/^Wk\s*(\d{1,2})$/i);
          if (wkMatch) {
            const sheetWeek = parseInt(wkMatch[1], 10);
            if (sheetWeek < 1 || sheetWeek > 53) continue;
            const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[sName], { header: 1 });
            const count = await parseSheetRows(sheetRows, sheetWeek, fileYr);
            if (count > 0) {
              sheetsWithWeekData++;
              seenWeeksByYear[fileYr].add(sheetWeek);
              weeksTouched.add(sheetWeek);
              if (sheetWeek > latestWkGlobal) latestWkGlobal = sheetWeek;
              insertedRows += count;
              console.log('[Weekly] Sheet "' + sName + '" -> Wk' + sheetWeek + ':', count, 'rows');
            }
          }
        }

        // Find the data sheet: prefer non-template, handle typos (Reprt, report, Detailsd)
        if (fileWk) {
          let weeklySheet = null;
          let reportSheetName = null;

          // 1. Try exact name matches (non-template only)
          const exactNames = ['Report 1 (Detailed)', 'Reprt 1 (Detailed)', 'report 1 (Detailed)', 'Report 1 (Detailsd)'];
          for (const name of wb.SheetNames) {
            if (exactNames.includes(name) && !name.includes('(Template)')) {
              weeklySheet = wb.Sheets[name];
              reportSheetName = name;
              break;
            }
          }

          // 2. Fuzzy match: find sheets containing 'detailed'/'detailsd' but NOT 'template'
          if (!weeklySheet) {
            const fuzzyName = wb.SheetNames.find(n => {
              const lower = n.toLowerCase().replace(/\s+/g, '');
              return (lower.includes('detailed') || lower.includes('detailsd') || lower.includes('detaild')) && !lower.includes('template');
            });
            if (fuzzyName) { weeklySheet = wb.Sheets[fuzzyName]; reportSheetName = fuzzyName; }
          }

          // 3. Last resort: any sheet with 'report' or 'reprt' (even template)
          if (!weeklySheet) {
            const anyName = wb.SheetNames.find(n => {
              const lower = n.toLowerCase().replace(/\s+/g, '');
              return (lower.includes('report') || lower.includes('reprt')) && (lower.includes('detailed') || lower.includes('detailsd'));
            });
            if (anyName) { weeklySheet = wb.Sheets[anyName]; reportSheetName = anyName; }
          }

          // 4. Ultimate fallback: first sheet in workbook
          if (!weeklySheet && wb.SheetNames.length > 0) {
            weeklySheet = wb.Sheets[wb.SheetNames[0]];
            reportSheetName = wb.SheetNames[0];
          }

          // Skip if this sheet was already parsed as a W<n> sheet
          const alreadyParsed = reportSheetName && reportSheetName.match(/^W\s*\d{1,2}\s+\d{2,4}$/i);
          if (weeklySheet && !alreadyParsed) {
            const rows = XLSX.utils.sheet_to_json(weeklySheet, { header: 1 });
            const count = await parseSheetRows(rows, fileWk, fileYr);
            if (count > 0) {
              seenWeeksByYear[fileYr].add(fileWk);
              weeksTouched.add(fileWk);
              if (fileWk > latestWkGlobal) latestWkGlobal = fileWk;
              insertedRows += count;
              console.log('[Weekly] Sheet "' + reportSheetName + '" -> Wk' + fileWk + ':', count, 'rows');
            } else {
              console.warn('[Weekly] Sheet "' + reportSheetName + '" produced 0 rows for Wk' + fileWk + ' in ' + file.name);
            }
          }
        }

        console.log('[Weekly] ' + file.name + ':', sheetsWithWeekData, 'week sheets + report,', insertedRows, 'total rows');
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
      // Handle Hygiene Rating Register XLSX (same logic as CSV path)
      if(file.name.toLowerCase().includes('hygiene') || file.name.toLowerCase().includes('eho') || file.name.toLowerCase().includes('rating register')) {
        if (typeof window._ehoRatings === 'undefined') window._ehoRatings = new Map();
        const allSheetNames = Object.keys(wb.Sheets);
        for (const sName of allSheetNames) {
          const ehoRows = XLSX.utils.sheet_to_json(wb.Sheets[sName], { defval: '' });
          if (!ehoRows.length) continue;
          const nameKey = Object.keys(ehoRows[0]).find(k => k.toLowerCase().includes('shop name') || k.toLowerCase().includes('store name') || k.toLowerCase().includes('branch'));
          const ratingKey = Object.keys(ehoRows[0]).find(k => k.toLowerCase().includes('hygiene rating') || k.toLowerCase().includes('rating'));
          const dateKey = Object.keys(ehoRows[0]).find(k => k.toLowerCase().includes('inspection date'));
          const nextKey = Object.keys(ehoRows[0]).find(k => k.toLowerCase().includes('next'));
          const foodKey = Object.keys(ehoRows[0]).find(k => k.toLowerCase().includes('food safety') || k.toLowerCase().includes('food score'));
          if (nameKey && ratingKey) {
            ehoRows.forEach(function(r) {
              var name = String(r[nameKey] || '').trim();
              var rating = parseInt(r[ratingKey]);
              if (name && !isNaN(rating)) {
                window._ehoRatings.set(name.toLowerCase(), {
                  name: name,
                  rating: rating,
                  inspectionDate: dateKey ? String(r[dateKey] || '') : '',
                  nextDue: nextKey ? String(r[nextKey] || '') : '',
                  foodScore: foodKey ? String(r[foodKey] || '') : ''
                });
              }
            });
            console.log('[EHO] Loaded', window._ehoRatings.size, 'hygiene ratings from XLSX:', file.name);
          }
        }
      }
    } catch (innerErr) { console.warn(`Skipping file ${file.name} due to an error:`, innerErr); }
  }
  __missingByYear = computeMissingWeeks(seenWeeksByYear);
  const b = document.getElementById('missingWeeksBadge'); if(b) b.innerText = formatMissingBadge(__missingByYear);
  window.__dataStatus.weeklyFiles = weeklyCount;
  if (window.__dataStatus.complaintsRows === 0 && window.ComplaintsData && window.ComplaintsData.length) window.__dataStatus.complaintsRows = window.ComplaintsData.length;
  document.getElementById('ingestStatus').innerText = "Rebuilding AM assignments...";

  // POST-PROCESS: Rebuild storeMap from the HIGHEST WEEK for every store.
  // This ensures AM assignments always reflect the most recent allocation,
  // regardless of which file was processed first or what DEFAULT_AREA_MAPPING says.
  {
    const allKpis = await idbGetAll('kpi');
    // Group by BranchId, track highest week per store
    const latestByStore = new Map();
    for (const k of allKpis) {
      const cid = k.BranchId || canonicalStoreId(k.Branch);
      const existing = latestByStore.get(cid);
      const kYr = k.Year || 0, kWk = k.Week || 0;
      const eYr = existing ? (existing.Year || 0) : -1, eWk = existing ? (existing.Week || 0) : -1;
      if (!existing || kYr > eYr || (kYr === eYr && kWk > eWk)) {
        latestByStore.set(cid, k);
      }
    }
    // Also build a map of ALL AM names found per store across all weeks
    const allAMsByStore = new Map();
    for (const k of allKpis) {
      const cid = k.BranchId || canonicalStoreId(k.Branch);
      const am = k.AM;
      if (am && am !== 'Unassigned') {
        if (!allAMsByStore.has(cid)) allAMsByStore.set(cid, new Map());
        const amCount = allAMsByStore.get(cid);
        amCount.set(am, (amCount.get(am) || 0) + 1);
      }
    }
    // For each store: prefer the AM from the highest week; if no AM found,
    // use the most frequently occurring AM across all weeks; then fall back to DEFAULT_AREA_MAPPING.
    let updated = 0;
    for (const [cid, latestKpi] of latestByStore) {
      let chosenAM = null;
      // 1. Check the latest week's stored AM
      if (latestKpi.AM && latestKpi.AM !== 'Unassigned') {
        chosenAM = latestKpi.AM;
      }
      // 2. If latest week has no AM, pick the most frequent AM across all weeks
      if (!chosenAM && allAMsByStore.has(cid)) {
        const freqMap = allAMsByStore.get(cid);
        let bestCount = 0;
        for (const [am, count] of freqMap) {
          if (count > bestCount) { bestCount = count; chosenAM = am; }
        }
      }
      // 3. Still nothing? Fall back to DEFAULT_AREA_MAPPING
      if (!chosenAM) {
        const rawName = latestKpi.Branch || cid;
        for (const [am, branches] of Object.entries(DEFAULT_AREA_MAPPING)) {
          if (branches.some(b => {
            const bId = canonicalStoreId(b).toLowerCase();
            return cid.toLowerCase() === bId || cid.toLowerCase().startsWith(bId) || bId.startsWith(cid.toLowerCase());
          })) { chosenAM = am; break; }
        }
      }
      if (!chosenAM) chosenAM = 'Unassigned';
      if (chosenAM === 'Tom Henson') chosenAM = 'Thomas Henson';
      // Update storeMap
      storeMap.set(cid, chosenAM);
      originalStoreNames.set(cid, latestKpi.Branch || cid);
      await idbPut('stores', { BranchId: cid, originalName: latestKpi.Branch || cid, AM: chosenAM });
      updated++;
    }
    // Now rewrite ALL KPI records to use the canonical current AM from storeMap
    // so every view (YTD, overview, trends, etc.) sees the same AM
    for (const k of allKpis) {
      const cid = k.BranchId || canonicalStoreId(k.Branch);
      const canonicalAM = storeMap.get(cid) || 'Unassigned';
      if (k.AM !== canonicalAM) {
        k.AM = canonicalAM;
        await idbPut('kpi', k);
      }
    }
    console.log('[Sync] Rebuilt AM assignments for', updated, 'stores from latest week data');
  }

  // Diagnostic: show record counts per week to help identify missing data
  {
    const allKpisFinal = await idbGetAll('kpi');
    const weekCounts = {};
    for (const k of allKpisFinal) {
      const key = (k.Year || 0) + '-W' + String(k.Week || 0).padStart(2, '0');
      weekCounts[key] = (weekCounts[key] || 0) + 1;
    }
    const sorted = Object.entries(weekCounts).sort((a, b) => a[0].localeCompare(b[0]));
    console.log('[Sync] Records per week:', sorted.map(([w, c]) => w + ':' + c).join(', '));
    const lowWeeks = sorted.filter(([, c]) => c < 10);
    if (lowWeeks.length) console.warn('[Sync] LOW DATA WEEKS:', lowWeeks.map(([w, c]) => w + '(' + c + ')').join(', '));
  }

  document.getElementById('ingestStatus').innerText = "Last Updated: " + new Date().toLocaleTimeString();
  await validateAndCorrectData(Array.from(weeksTouched));
  await flagAnomalies();
  for(const yr of Array.from(yearsTouched)) { await recordPersistentWinnersForWeeks(yr, Array.from(weeksTouched)); }
  await idbPut('settings', { id: 'lastSynced', timestamp: Date.now() });
  renderDashboard();
  checkDataFreshness();
}

// ===== BUILD MASTER JSON FROM INDEXEDDB (one-time migration) =====
// Reads all KPI records from IndexedDB and writes them to kpi_master.json on SharePoint.
async function _buildMasterFromIdb() {
  var allKpis = await idbGetAll('kpi');
  if (!allKpis || allKpis.length === 0) { console.warn('[BuildMaster] No KPI records in IDB'); return; }
  var recordsMap = {};
  for (var bi = 0; bi < allKpis.length; bi++) {
    var k = allKpis[bi];
    recordsMap[k.BranchId + '_' + k.Year + '_' + k.Week] = k;
  }
  var records = Object.keys(recordsMap).map(function(key) { return recordsMap[key]; });
  // Get current XLSX filenames from SharePoint for the files array
  var items = [];
  try { items = await GraphClient.listFolder(''); } catch(e) {}
  var xlsxNames = items.filter(function(i) { return !i.isFolder && i.name.toLowerCase().endsWith('.xlsx') && i.name.toLowerCase().includes('weekly'); }).map(function(i) { return i.name; });
  var master = { version: 2, generated: new Date().toISOString(), fileCount: xlsxNames.length, files: xlsxNames, records: records };
  var jsonText = JSON.stringify(master, null, 2);
  var ok = await GraphClient.writeFile('kpi_master.json', jsonText, '');
  if (ok) { console.log('[BuildMaster] Created kpi_master.json with', records.length, 'records'); }
}

// ===== AUTO-INGEST NEW XLSX FILES INTO MASTER JSON =====
// Detects XLSX files in SharePoint not yet in kpi_master.json, parses them,
// merges into the master, uploads updated master, and deletes originals.
async function autoIngest(items) {
  if (typeof GraphClient === 'undefined' || typeof BirdsAuth === 'undefined' || !BirdsAuth.isLoggedIn()) return;

  var statusEl = document.getElementById('ingestStatus');
  var xlsxFiles = items.filter(function(item) {
    return !item.isFolder && item.name.toLowerCase().endsWith('.xlsx') && item.name.toLowerCase().includes('weekly');
  });
  if (xlsxFiles.length === 0) return;

  // Load current master JSON
  var master = null;
  var masterEtag = '';
  try {
    var result = await GraphClient.readFileWithEtag('kpi_master.json');
    if (result) {
      master = JSON.parse(result.text);
      masterEtag = result.etag;
    }
  } catch(e) { /* will create new */ }
  if (!master || !master.records) {
    master = { version: 2, files: [], records: [] };
  }
  if (!master.files) master.files = [];
  var needsResave = false;
  // Migration: if master built by old code (has fileCount but no files list),
  // mark all current XLSX files as already processed to avoid re-downloading them.
  if (master.files.length === 0 && master.fileCount > 0 && xlsxFiles.length > 0) {
    master.files = xlsxFiles.map(function(f) { return f.name; });
    needsResave = true;
    console.log('[Ingest] Migrated master: added', master.files.length, 'filenames to files array');
  }
  var processedFiles = {};
  for (var fi = 0; fi < master.files.length; fi++) {
    processedFiles[master.files[fi].toLowerCase()] = true;
  }

  // Handle orphan .processing files before checking for new files
  var orphans = items.filter(function(item) {
    return !item.isFolder && item.name.toLowerCase().endsWith('.processing');
  });
  for (var oi = 0; oi < orphans.length; oi++) {
    var orphanName = orphans[oi].name;
    var oOrig = orphanName.slice(0, -'.processing'.length);
    if (processedFiles[oOrig.toLowerCase()]) {
      statusEl.innerText = 'Cleaning up orphan: ' + orphanName;
      try { await GraphClient.deleteFile(orphanName); } catch(e) {}
    } else {
      statusEl.innerText = 'Recovering orphan: ' + orphanName;
      try { await GraphClient.renameFile(orphanName, oOrig); } catch(e) {}
    }
  }

  // Find new files not yet in master
  var newFiles = xlsxFiles.filter(function(item) {
    return !processedFiles[item.name.toLowerCase()];
  });
  if (newFiles.length === 0) {
    // No new files, but may need to re-save master with migrated files array
    if (needsResave) {
      master.version = (master.version || 1) + 1;
      master.generated = new Date().toISOString();
      var updatedText = JSON.stringify({ version: master.version, generated: master.generated, fileCount: master.files.length, files: master.files, records: master.records }, null, 2);
      try { await GraphClient.writeFile('kpi_master.json', updatedText, masterEtag); } catch(e) { console.warn('[Ingest] Resave failed:', e.message); }
    }
    return;
  }

  statusEl.innerText = 'Ingesting ' + newFiles.length + ' new XLSX file(s)...';

  // Build records map from existing master records
  var recordsMap = {};
  for (var ri = 0; ri < master.records.length; ri++) {
    var rec = master.records[ri];
    recordsMap[rec.BranchId + '_' + rec.Year + '_' + rec.Week] = rec;
  }

  var ingested = 0;
  var errors = [];

  for (var ni = 0; ni < newFiles.length; ni++) {
    var fileItem = newFiles[ni];
    var fileName = fileItem.name;
    var lockName = fileName + '.processing';

    statusEl.innerText = '[' + (ni + 1) + '/' + newFiles.length + '] Locking ' + fileName + '...';
    var renamed = await GraphClient.renameFile(fileName, lockName);
    if (!renamed) {
      errors.push(fileName + ': lock failed (rename)');
      continue;
    }

    statusEl.innerText = '[' + (ni + 1) + '/' + newFiles.length + '] Downloading ' + fileName + '...';
    var buffer;
    try {
      buffer = await GraphClient.readFileBinary(lockName);
    } catch(e) {
      errors.push(fileName + ': download failed');
      await GraphClient.renameFile(lockName, fileName);
      continue;
    }
    if (!buffer) {
      errors.push(fileName + ': download null');
      await GraphClient.renameFile(lockName, fileName);
      continue;
    }

    statusEl.innerText = '[' + (ni + 1) + '/' + newFiles.length + '] Parsing ' + fileName + '...';
    try {
      var wb = XLSX.read(buffer, { type: 'array' });
      var resolved = resolveWeekYear(fileName, wb);
      var fileWk = resolved.week || 0;
      var fileYr = resolved.year || new Date().getFullYear();

      async function parseSheetRows(sheetRows, wkNum, yrNum) {
        var cols = findCols(sheetRows);
        if (!cols) return 0;
        var count = 0;
        for (var ri2 = cols.hr + 1; ri2 < sheetRows.length; ri2++) {
          var r = sheetRows[ri2];
          if (!r || !r[cols.idxB] || String(r[cols.idxB]).toLowerCase().includes('total')) continue;
          var rawBranch = cleanStoreName(r[cols.idxB]);
          var branchId = canonicalStoreId(rawBranch);
          var key = branchId + '_' + yrNum + '_' + wkNum;
          if (!recordsMap[key]) {
            recordsMap[key] = {
              BranchId: branchId, Branch: rawBranch, Week: wkNum, Year: yrNum,
              AM: resolveStoreAM(r, branchId),
              Sales: cols.idxS >= 0 ? parseVal(r[cols.idxS]) : 0,
              SalesActual: (cols.idxSA !== undefined && cols.idxSA >= 0) ? parseVal(r[cols.idxSA]) : 0,
              Product: cols.idxP >= 0 ? parseVal(r[cols.idxP]) : 0,
              Waste: cols.idxW >= 0 ? parseVal(r[cols.idxW]) : 0,
              Labour: cols.idxL >= 0 ? parseVal(r[cols.idxL]) : 0,
              ATV: cols.idxA >= 0 ? parseVal(r[cols.idxA]) : 0,
              Energy: cols.idxE >= 0 ? parseVal(r[cols.idxE]) : 0,
              FilledRolls: cols.idxFR >= 0 ? parseVal(r[cols.idxFR]) : 0,
              Sandwiches: cols.idxSW >= 0 ? parseVal(r[cols.idxSW]) : 0,
              HotRolls: cols.idxHR >= 0 ? parseVal(r[cols.idxHR]) : 0,
              HotBev: cols.idxHB >= 0 ? parseVal(r[cols.idxHB]) : 0,
              IsAnomaly: false
            };
            count++;
          }
        }
        return count;
      }

      for (var si = 0; si < wb.SheetNames.length; si++) {
        var sName = wb.SheetNames[si];
        var wkMatch = sName.match(/^W\s*(\d{1,2})\s+\d{2,4}$/i) || sName.match(/^Wk\s*(\d{1,2})$/i);
        if (wkMatch) {
          var sheetWeek = parseInt(wkMatch[1], 10);
          if (sheetWeek >= 1 && sheetWeek <= 53) {
            var sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[sName], { header: 1 });
            await parseSheetRows(sheetRows, sheetWeek, fileYr);
          }
        }
      }

      if (fileWk) {
        var weeklySheet = null, reportSheetName = null;
        var exactNames = ['Report 1 (Detailed)', 'Reprt 1 (Detailed)', 'report 1 (Detailed)', 'Report 1 (Detailsd)'];
        for (var ni2 = 0; ni2 < wb.SheetNames.length; ni2++) {
          var nm = wb.SheetNames[ni2];
          if (exactNames.indexOf(nm) !== -1 && nm.indexOf('(Template)') === -1) {
            weeklySheet = wb.Sheets[nm]; reportSheetName = nm; break;
          }
        }
        if (!weeklySheet) {
          for (var fi2 = 0; fi2 < wb.SheetNames.length; fi2++) {
            var lower = wb.SheetNames[fi2].toLowerCase().replace(/\s+/g, '');
            if ((lower.indexOf('detailed') !== -1 || lower.indexOf('detailsd') !== -1 || lower.indexOf('detaild') !== -1) && lower.indexOf('template') === -1) {
              weeklySheet = wb.Sheets[wb.SheetNames[fi2]]; reportSheetName = wb.SheetNames[fi2]; break;
            }
          }
        }
        if (!weeklySheet) {
          for (var ai = 0; ai < wb.SheetNames.length; ai++) {
            var lc = wb.SheetNames[ai].toLowerCase().replace(/\s+/g, '');
            if ((lc.indexOf('report') !== -1 || lc.indexOf('reprt') !== -1) && (lc.indexOf('detailed') !== -1 || lc.indexOf('detailsd') !== -1)) {
              weeklySheet = wb.Sheets[wb.SheetNames[ai]]; reportSheetName = wb.SheetNames[ai]; break;
            }
          }
        }
        if (!weeklySheet && wb.SheetNames.length > 0) {
          weeklySheet = wb.Sheets[wb.SheetNames[0]]; reportSheetName = wb.SheetNames[0];
        }
        var alreadyParsed = reportSheetName && reportSheetName.match(/^W\s*\d{1,2}\s+\d{2,4}$/i);
        if (weeklySheet && !alreadyParsed) {
          var rows = XLSX.utils.sheet_to_json(weeklySheet, { header: 1 });
          await parseSheetRows(rows, fileWk, fileYr);
        }
      }

      master.files.push(fileName);
    } catch(err) {
      errors.push(fileName + ': parse error (' + err.message + ')');
      await GraphClient.renameFile(lockName, fileName);
      continue;
    }

    statusEl.innerText = '[' + (ni + 1) + '/' + newFiles.length + '] Cleaning up ' + fileName + '...';
    try { await GraphClient.deleteFile(lockName); } catch(e) { errors.push(fileName + ': delete failed'); }
    ingested++;
  }

  if (ingested > 0) {
    master.version = (master.version || 1) + 1;
    master.generated = new Date().toISOString();
    master.records = Object.keys(recordsMap).map(function(k) { return recordsMap[k]; });
    var masterJsonText = JSON.stringify({ version: master.version, generated: master.generated, fileCount: master.files.length, files: master.files, records: master.records }, null, 2);
    statusEl.innerText = 'Uploading master (' + master.records.length + ' records)...';
    try {
      var ok = await GraphClient.writeFile('kpi_master.json', masterJsonText, masterEtag);
      if (ok) {
        if (errors.length === 0) statusEl.innerText = 'Ingested ' + ingested + ' file(s) successfully.';
        else statusEl.innerText = 'Ingested ' + ingested + ' file(s) with ' + errors.length + ' error(s).';
      } else {
        statusEl.innerText = 'Master upload conflict — ' + ingested + ' files processed but master not saved (concurrent edit).';
        errors.push('Master JSON upload rejected (412 conflict)');
      }
    } catch(e) {
      statusEl.innerText = 'Master upload error: ' + e.message;
      errors.push('Master upload: ' + e.message);
    }
  }
  if (errors.length > 0) console.warn('[Ingest] Errors:', errors.join('; '));
}

