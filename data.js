async function loadDirectoryHandle() {
  // Try to reuse previously selected folder
  if (directoryHandle) {
    var perm = await directoryHandle.queryPermission({ mode: 'read' });
    if (perm === 'granted') {
      document.getElementById('folderStatus').textContent = 'Folder connected';
      return;
    }
    directoryHandle = null;
  }

  // Open folder picker on first load
  try {
    directoryHandle = await window.showDirectoryPicker();
    document.getElementById('folderStatus').textContent = 'Folder connected';
  } catch (e) {
    document.getElementById('ingestStatus').innerText = "Select a data folder to begin.";
    document.getElementById('folderStatus').textContent = '';
  }
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

  // ===== LOCAL FOLDER PATH =====
  if (directoryHandle) {
    var perm = await directoryHandle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') {
      perm = await directoryHandle.requestPermission({ mode: 'read' });
    }
    if (perm === 'granted') {
      document.getElementById('ingestStatus').innerText = "Re-syncing from previous folder...";
    } else {
      directoryHandle = null;
    }
  }

  // Only open picker if we don't have a valid handle
  if (!directoryHandle) {
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
      const storeObj = trackerData.stores || trackerData.updates || trackerData;
      const storeEntries = (typeof storeObj === 'object' && !Array.isArray(storeObj))
        ? Object.entries(storeObj)
        : (Array.isArray(storeObj) ? storeObj.map(r => [r.StoreId || r.id, r]) : []);
      if (storeEntries.length > 0) {
        for (const [storeId, rec] of storeEntries) {
          if (rec && typeof rec === 'object') {
            if (!rec.StoreId) rec.StoreId = storeId;
            await idbPut('eho_data', rec);
          }
        }
        console.log('[Sync] Loaded', storeEntries.length, 'tracker records from local folder');
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

