window.buildMasterJson = async function() {
  if (!confirm('This will read all weekly XLSX files from SharePoint and build kpi_master.json.\nExisting kpi_master.json will be replaced.\n\nProceed?')) return;

  if (typeof GraphClient === 'undefined' || typeof BirdsAuth === 'undefined' || !BirdsAuth.isLoggedIn()) {
    alert('You must be signed in to SharePoint to build the master JSON.');
    return;
  }

  var statusEl = document.getElementById('ingestStatus');
  var sessionId = Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  statusEl.innerText = 'Listing files on SharePoint...';
  var items;
  try {
    items = await GraphClient.listFolder('');
  } catch(e) {
    alert('Failed to list SharePoint folder: ' + e.message);
    return;
  }

  var xlsxFiles = items.filter(function(item) {
    return !item.isFolder && item.name.toLowerCase().endsWith('.xlsx') && item.name.toLowerCase().includes('weekly');
  });

  if (xlsxFiles.length === 0) {
    alert('No weekly XLSX files found in SharePoint data folder.');
    return;
  }

  statusEl.innerText = 'Found ' + xlsxFiles.length + ' weekly XLSX files. Processing...';

  var master = {}; // key: BranchId_Year_Week → record
  var processed = 0;
  var errors = [];

  for (var i = 0; i < xlsxFiles.length; i++) {
    var item = xlsxFiles[i];
    var fileName = item.name;
    statusEl.innerText = '[' + (i + 1) + '/' + xlsxFiles.length + '] Downloading ' + fileName + '...';
    await new Promise(function(r) { setTimeout(r, 20); });

    try {
      var buffer = await GraphClient.readFileBinary(fileName);
      if (!buffer) {
        errors.push(fileName + ': download failed (null)');
        continue;
      }

      statusEl.innerText = '[' + (i + 1) + '/' + xlsxFiles.length + '] Parsing ' + fileName + '...';
      var wb = XLSX.read(buffer, { type: 'array' });
      var resolved = resolveWeekYear(fileName, wb);
      var fileWk = resolved.week || 0;
      var fileYr = resolved.year || new Date().getFullYear();

      var insertedRows = 0;

      // Helper: parse one sheet's rows
      async function parseSheetRows(sheetRows, wkNum, yrNum) {
        var cols = findCols(sheetRows);
        if (!cols) return 0;
        var count = 0;
        for (var ri = cols.hr + 1; ri < sheetRows.length; ri++) {
          var r = sheetRows[ri];
          if (!r || !r[cols.idxB] || String(r[cols.idxB]).toLowerCase().includes('total')) continue;
          var rawBranch = cleanStoreName(r[cols.idxB]);
          var branchId = canonicalStoreId(rawBranch);
          if (!storeMap.has(branchId)) {
            var defaultAM = 'Unassigned';
            var bLower = branchId.toLowerCase();
            for (var amKey in DEFAULT_AREA_MAPPING) {
              if (DEFAULT_AREA_MAPPING[amKey].some(function(b) {
                var bId = canonicalStoreId(b).toLowerCase();
                return bLower === bId || bLower.startsWith(bId) || bId.startsWith(bLower);
              })) { defaultAM = amKey; break; }
            }
            storeMap.set(branchId, defaultAM);
            originalStoreNames.set(branchId, rawBranch);
          }
          var key = branchId + '_' + yrNum + '_' + wkNum;
          if (!master[key]) {
            master[key] = {
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

      // Scan week-numbered sheets (e.g. "W1 26", "W 13 26", "Wk17")
      for (var si = 0; si < wb.SheetNames.length; si++) {
        var sName = wb.SheetNames[si];
        var wkMatch = sName.match(/^W\s*(\d{1,2})\s+\d{2,4}$/i) || sName.match(/^Wk\s*(\d{1,2})$/i);
        if (wkMatch) {
          var sheetWeek = parseInt(wkMatch[1], 10);
          if (sheetWeek < 1 || sheetWeek > 53) continue;
          var sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[sName], { header: 1 });
          var cnt = await parseSheetRows(sheetRows, sheetWeek, fileYr);
          if (cnt > 0) {
            insertedRows += cnt;
          }
        }
      }

      // Find and parse the main report sheet
      if (fileWk) {
        var weeklySheet = null;
        var reportSheetName = null;

        var exactNames = ['Report 1 (Detailed)', 'Reprt 1 (Detailed)', 'report 1 (Detailed)', 'Report 1 (Detailsd)'];
        for (var ni = 0; ni < wb.SheetNames.length; ni++) {
          var nm = wb.SheetNames[ni];
          if (exactNames.indexOf(nm) !== -1 && nm.indexOf('(Template)') === -1) {
            weeklySheet = wb.Sheets[nm];
            reportSheetName = nm;
            break;
          }
        }

        if (!weeklySheet) {
          for (var fi = 0; fi < wb.SheetNames.length; fi++) {
            var lower = wb.SheetNames[fi].toLowerCase().replace(/\s+/g, '');
            if ((lower.indexOf('detailed') !== -1 || lower.indexOf('detailsd') !== -1 || lower.indexOf('detaild') !== -1) && lower.indexOf('template') === -1) {
              weeklySheet = wb.Sheets[wb.SheetNames[fi]];
              reportSheetName = wb.SheetNames[fi];
              break;
            }
          }
        }

        if (!weeklySheet) {
          for (var ai = 0; ai < wb.SheetNames.length; ai++) {
            var lc = wb.SheetNames[ai].toLowerCase().replace(/\s+/g, '');
            if ((lc.indexOf('report') !== -1 || lc.indexOf('reprt') !== -1) && (lc.indexOf('detailed') !== -1 || lc.indexOf('detailsd') !== -1)) {
              weeklySheet = wb.Sheets[wb.SheetNames[ai]];
              reportSheetName = wb.SheetNames[ai];
              break;
            }
          }
        }

        if (!weeklySheet && wb.SheetNames.length > 0) {
          weeklySheet = wb.Sheets[wb.SheetNames[0]];
          reportSheetName = wb.SheetNames[0];
        }

        var alreadyParsed = reportSheetName && reportSheetName.match(/^W\s*\d{1,2}\s+\d{2,4}$/i);
        if (weeklySheet && !alreadyParsed) {
          var rows = XLSX.utils.sheet_to_json(weeklySheet, { header: 1 });
          var c = await parseSheetRows(rows, fileWk, fileYr);
          if (c > 0) insertedRows += c;
        }
      }

      processed++;
      statusEl.innerText = '[' + (i + 1) + '/' + xlsxFiles.length + '] ' + fileName + ' → ' + insertedRows + ' rows';

      // Small delay to let UI update
      await new Promise(function(r) { setTimeout(r, 50); });

    } catch (err) {
      errors.push(fileName + ': ' + err.message);
      console.warn('[BuildMaster] Error processing', fileName, err);
    }
  }

  // Convert master map to array
  var records = Object.keys(master).map(function(k) { return master[k]; });

  statusEl.innerText = 'Uploading kpi_master.json (' + records.length + ' records, ' + xlsxFiles.length + ' files processed)...';

  try {
    var jsonText = JSON.stringify({ version: 2, generated: new Date().toISOString(), fileCount: xlsxFiles.length, records: records }, null, 2);
    var ok = await GraphClient.writeFile('kpi_master.json', jsonText);
    if (ok) {
      statusEl.innerText = 'Done — kpi_master.json uploaded with ' + records.length + ' records from ' + processed + ' files.';
      var msg = 'Master JSON built successfully!\n\nFiles processed: ' + processed + '/' + xlsxFiles.length + '\nTotal records: ' + records.length;
      if (errors.length > 0) msg += '\n\nErrors (' + errors.length + '):\n' + errors.join('\n');
      alert(msg);
    } else {
      statusEl.innerText = 'Failed to upload kpi_master.json';
      alert('Write to SharePoint failed. Check console for details.\n\n' + (errors.length ? 'Errors:\n' + errors.join('\n') : ''));
    }
  } catch (e) {
    statusEl.innerText = 'Upload error: ' + e.message;
    alert('Upload failed: ' + e.message);
  }
};
