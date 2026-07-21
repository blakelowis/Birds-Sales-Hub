async function renderDashboard(){
  
  
if(currentView === 'champions')
    return renderChampionsView();


if(currentView === 'documents')
    return renderDocuments();

if(currentView === 'documentarchive')
    return renderDocumentArchive();

if(currentView === 'documentcreate')
    return renderDocumentCreate();

if(currentView === 'complaints')
    return renderComplaintsHub();

if(currentView === 'tracker')
    return renderTracker();

if(currentView === 'auditPerform')
    return renderAuditPerform();


if(currentView === 'storereports')
    return renderStoreReports();


if(currentView === 'storecards')
    return renderStoreScorecards();

  if(currentView === 'auditexport') return renderAuditActionHub();
  if(currentView === 'masterreview') return renderQuarterlySummary();
  // PRIORITY FIX
  
  if(currentView === 'control') return renderControlPanel();
  if(currentView === 'trends') return renderTrendsPanel();
  if(currentView === 'halloffame') return renderHallOfFame();
if(currentView === 'banding') return renderBandingView();

  

  const rawKpis = await idbGetAll('kpi'); const allAudits = await idbGetAll('audits'); var allActions = []; if (typeof getAuditActionsForReport === 'function') { try { allActions = await getAuditActionsForReport(); allActions.forEach(function(a) { if (a.Status === 'Closed' && a.ClosedOn && a.AuditDate) { var cd = new Date(a.ClosedOn); var ad = new Date(a.AuditDate); if (!isNaN(cd.getTime()) && !isNaN(ad.getTime())) a.DaysToClose = Math.round((cd - ad) / 86400000); } }); } catch(e) { console.warn('[Dash] Failed to load actions from JSON folders:', e); } } var ehoData = []; try { ehoData = await idbGetAll('eho_data'); } catch(e) {}
  const combinedData = [...rawKpis, ...allAudits]; if(!combinedData.length && currentView !== 'control') return;
  const effectiveYear = combinedData.length ? Math.max(...combinedData.map(k => (k.Year || currentAwardsYear || new Date().getFullYear()))) : new Date().getFullYear();
  latestWkGlobal = combinedData.length ? Math.max(...combinedData.filter(k => (k.Year || effectiveYear) === effectiveYear).map(k => k.Week)) : 0;
  let effectiveWeek = (archiveWeekOverride && Number.isFinite(archiveWeekOverride)) ? archiveWeekOverride : latestWkGlobal;
  updateActiveWeekBadge(effectiveWeek);
  // BUILD STORE MEDALS MAP (v41)
  const winners = await idbGetAll('store_winners_log');
  window.storeMedalsMap = {}; window.__areaWinsCache = winners;
  winners.filter(w => w.Week === effectiveWeek).forEach(w=>{
    if(!window.storeMedalsMap[w.Branch]) window.storeMedalsMap[w.Branch]=[];
    window.storeMedalsMap[w.Branch].push(w.Metric);
  });


  let globalMostImprovedWin = null;
  try{ const wins = await idbGetAll('store_winners_log'); globalMostImprovedWin = wins.find(w => w && w.Metric === 'Most Improved' && w.Week === effectiveWeek && (w.Year || effectiveYear) === effectiveYear) || null; }catch(e){}
  
  let curr = [], prev = []; let currAudits = [], prevAudits = []; let currActions = [], prevActions = [];
  if (currentTimeFilter === 'latest') {
      curr = aggregateData(rawKpis.filter(k => k.Week === effectiveWeek && (k.Year || effectiveYear) === effectiveYear));
      {
          const p =
              getPreviousAvailableWeek(
                  effectiveWeek,
                  effectiveYear,
                  rawKpis
              );

          prev = aggregateData(
              rawKpis.filter(
                  k =>
                      k.Week === p.week &&
                      (k.Year || p.year) === p.year
              )
          );
      }
      currAudits = allAudits.filter(a => a.Week === effectiveWeek); prevAudits = allAudits.filter(a => a.Week === effectiveWeek - 1);
      currActions = allActions.filter(a => a.Week >= 1 && a.Week <= effectiveWeek); prevActions = allActions.filter(a => a.Week >= 1 && a.Week <= effectiveWeek - 1);
  } else if (currentTimeFilter === 'last4') {
      curr = aggregateData(rawKpis.filter(k => k.Week <= effectiveWeek && k.Week > effectiveWeek - 4)); prev = aggregateData(rawKpis.filter(k => k.Week <= effectiveWeek - 4 && k.Week > effectiveWeek - 8));
      currAudits = allAudits.filter(a => a.Week <= effectiveWeek && a.Week > effectiveWeek - 4); prevAudits = allAudits.filter(a => a.Week <= effectiveWeek - 4 && a.Week > effectiveWeek - 8);
      currActions = allActions.filter(a => a.Week <= effectiveWeek && a.Week > effectiveWeek - 4); prevActions = allActions.filter(a => a.Week <= effectiveWeek - 4 && a.Week > effectiveWeek - 8);
  } else if (currentTimeFilter === 'ytd') {
      curr = aggregateData(rawKpis); prev = []; currAudits = allAudits; prevAudits = []; currActions = allActions; prevActions = [];
  }
  
  const aggAudits = new Map();
  currAudits.forEach(a => { const id = canonicalStoreId(a.Store); if(!aggAudits.has(id)) aggAudits.set(id, {Store: a.Store, count:0, Score:0, Food:0, Fire:0, HandS:0, Journey:0, Coffee:0, Focus:0}); const obj = aggAudits.get(id); obj.count++; obj.Score += a.Score||0; obj.Food += a.Food||0; obj.Fire += a.Fire||0; obj.HandS += a.HandS||0; obj.Journey += a.Journey||0; obj.Coffee += a.Coffee||0; obj.Focus += a.Focus||0; });
  const auditMap = new Map(); aggAudits.forEach((v, k) => auditMap.set(k, { Score: v.Score/v.count, Food: v.Food/v.count, Fire: v.Fire/v.count, HandS: v.HandS/v.count, Journey: v.Journey/v.count, Coffee: v.Coffee/v.count, Focus: v.Focus/v.count }));

  const bAvgSales = curr.reduce((a,b)=>a+(b.Sales||0),0) / (curr.length || 1); const pbAvgSales = prev.reduce((a,b)=>a+(b.Sales||0),0) / (prev.length || 1);
  const bAvgProduct = curr.reduce((a,b)=>a+(b.Product||0),0) / (curr.length || 1); const pbAvgProduct = prev.reduce((a,b)=>a+(b.Product||0),0) / (prev.length || 1);
  const bAvgWaste = curr.reduce((a,b)=>a+(b.Waste||0),0) / (curr.length || 1); const pbAvgWaste = prev.reduce((a,b)=>a+(b.Waste||0),0) / (prev.length || 1);
  const bAvgLabour = curr.reduce((a,b)=>a+(b.Labour||0),0) / (curr.length || 1); const pbAvgLabour = prev.reduce((a,b)=>a+(b.Labour||0),0) / (prev.length || 1);
  const bAvgEnergy = curr.reduce((a,b)=>a+(b.Energy||0),0) / (curr.length || 1); const pbAvgEnergy = prev.reduce((a,b)=>a+(b.Energy||0),0) / (prev.length || 1);
  const bAvgATV = curr.reduce((a,b)=>a+(b.ATV||0),0) / (curr.length || 1); const pbAvgATV = prev.reduce((a,b)=>a+(b.ATV||0),0) / (prev.length || 1);
  const bAvgFilledRolls = curr.reduce((a,b)=>a+(b.FilledRolls||0),0) / (curr.length || 1); const pbAvgFilledRolls = prev.reduce((a,b)=>a+(b.FilledRolls||0),0) / (prev.length || 1);
  const bAvgSandwiches = curr.reduce((a,b)=>a+(b.Sandwiches||0),0) / (curr.length || 1); const pbAvgSandwiches = prev.reduce((a,b)=>a+(b.Sandwiches||0),0) / (prev.length || 1);
  const bAvgHotRolls = curr.reduce((a,b)=>a+(b.HotRolls||0),0) / (curr.length || 1); const pbAvgHotRolls = prev.reduce((a,b)=>a+(b.HotRolls||0),0) / (prev.length || 1);
  const bAvgHotBev = curr.reduce((a,b)=>a+(b.HotBev||0),0) / (curr.length || 1); const pbAvgHotBev = prev.reduce((a,b)=>a+(b.HotBev||0),0) / (prev.length || 1);
  const bAvgAudit = Array.from(auditMap.values()).reduce((a,b)=>a+(b.Score||0),0) / (auditMap.size || 1);

  const validAMs = Array.from(new Set(Array.from(storeMap.values()))).filter(am => am !== 'Unassigned');

  const amStatsGlobal = validAMs.map(am => {
      const stores = curr.filter(k => k.AM === am); if(!stores.length) return null;
      const avg = (f) => stores.reduce((a,b)=>a+(b[f]||0),0)/stores.length;
      let validAudits = 0;
      const totalAuditScore = stores.reduce((a,b) => { const s = auditMap.get(b.Branch.trim().toLowerCase())?.Score; if(s) { validAudits++; return a + s; } return a; }, 0);
      const aAvg = validAudits > 0 ? totalAuditScore / validAudits : 0;
      const compScore = calculateStoreScore({Sales: avg('Sales'),Product: avg('Product'),Waste: avg('Waste'),Labour: avg('Labour'),Energy: avg('Energy')});
      return { am, score: compScore, sAvg: avg('Sales'), pAvg: avg('Product'), wAvg: avg('Waste'), lAvg: avg('Labour'), aAvg: aAvg, eAvg: avg('Energy'), atvAvg: avg('ATV') };
  }).filter(x => x).sort((a,b)=>b.score-a.score);

  const overallWinner = amStatsGlobal[0]?.am; const bestSalesAM = [...amStatsGlobal].sort((a,b)=>b.sAvg-a.sAvg)[0]?.am; const bestProductAM = [...amStatsGlobal].sort((a,b)=>b.pAvg-a.pAvg)[0]?.am; const bestWasteAM = [...amStatsGlobal].sort((a,b)=>a.wAvg-b.wAvg)[0]?.am; const bestLabourAM = [...amStatsGlobal].sort((a,b)=>a.lAvg-b.lAvg)[0]?.am; const bestEnergyAM = [...amStatsGlobal].sort((a,b)=>a.eAvg-b.eAvg)[0]?.am; const bestAuditAM = [...amStatsGlobal].sort((a,b)=>b.aAvg-a.aAvg)[0]?.am; const bestATVAM = [...amStatsGlobal].sort((a,b)=>b.atvAvg-a.atvAvg)[0]?.am;

  
if(currentView === 'overview'){

    const filterLabel = currentTimeFilter === 'latest' ? `Wk ${effectiveWeek}${archiveWeekOverride? ' (Archive)' : ''}` : currentTimeFilter === 'last4' ? 'Rolling 4 Weeks' : 'Year to Date';
    const areaRows = amStatsGlobal.map((am, i) => `
      <div class="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
        <div class="flex items-center gap-3"><span class="w-6 h-6 rounded-full ${i===0?' text-slate-800': i===1?'bg-slate-100 text-slate-700': i===2?'bg-amber-100 text-amber-700':'bg-slate-50 text-slate-400'} flex items-center justify-center text-[10px] font-black">${i+1}</span><span class="font-bold text-sm">${am.am}</span></div>
        <div class="text-right flex gap-4 text-xs font-bold">
          <span class="w-16 text-emerald-600">${(am.sAvg*100).toFixed(1)}% <span class="text-[9px] text-slate-400 font-normal block">Sales</span></span>
          <span class="w-16 text-indigo-600">${(am.lAvg*100).toFixed(1)}% <span class="text-[9px] text-slate-400 font-normal block">Labour</span></span>
          <span class="w-16 text-blue-600">${(am.wAvg*100).toFixed(1)}% <span class="text-[9px] text-slate-400 font-normal block">Waste</span></span>
        </div>
      </div>`).join('');
    const progColor = (val) => val >= 95 ? 'progress-fill' : val >= 90 ? 'progress-fill-warn' : 'progress-fill-crit';

    document.getElementById('mainView').innerHTML = `
      <div id="overview-card" class="bg-transparent p-1">
        <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-black outfit birds-green uppercase tracking-tight">C-SUITE BUSINESS SUMMARY (${filterLabel})</h2>
            <div onclick="exportCard('overview-card', 'Overview')" class="export-btn bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"> Export Dash</div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div class="card p-3 border-t-2 border-t-orange-400 flex justify-between items-center"><div><p class="text-[9px] font-bold text-slate-400 uppercase letter">Hot Drinks</p><h2 class="text-lg font-black ${bAvgHotBev >= 0 ? 'text-emerald-600' : 'text-red-500'}">${(bAvgHotBev*100)>0?'+':''}${(bAvgHotBev*100).toFixed(1)}%</h2></div>${getTrendStr(bAvgHotBev, pbAvgHotBev, false, 'percent')}</div>
          <div class="card p-3 border-t-2 border-t-orange-500 flex justify-between items-center"><div><p class="text-[9px] font-bold text-slate-400 uppercase letter">Hot Food</p><h2 class="text-lg font-black ${bAvgHotRolls >= 0 ? 'text-emerald-600' : 'text-red-500'}">${(bAvgHotRolls*100)>0?'+':''}${(bAvgHotRolls*100).toFixed(1)}%</h2></div>${getTrendStr(bAvgHotRolls, pbAvgHotRolls, false, 'percent')}</div>
          <div class="card p-3 border-t-2 border-t-blue-400 flex justify-between items-center"><div><p class="text-[9px] font-bold text-slate-400 uppercase letter">Sandwiches</p><h2 class="text-lg font-black ${bAvgSandwiches >= 0 ? 'text-emerald-600' : 'text-red-500'}">${(bAvgSandwiches*100)>0?'+':''}${(bAvgSandwiches*100).toFixed(1)}%</h2></div>${getTrendStr(bAvgSandwiches, pbAvgSandwiches, false, 'percent')}</div>
          <div class="card p-3 border-t-2 border-t-blue-500 flex justify-between items-center"><div><p class="text-[9px] font-bold text-slate-400 uppercase letter">Cold Rolls</p><h2 class="text-lg font-black ${bAvgFilledRolls >= 0 ? 'text-emerald-600' : 'text-red-500'}">${(bAvgFilledRolls*100)>0?'+':''}${(bAvgFilledRolls*100).toFixed(1)}%</h2></div>${getTrendStr(bAvgFilledRolls, pbAvgFilledRolls, false, 'percent')}</div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <div class="card p-4 text-center"><p class="text-[9px] font-bold text-slate-400 uppercase letter">Sales Growth</p><h2 class="text-xl font-black birds-green">${(bAvgSales*100).toFixed(1)}%</h2>${getTrendStr(bAvgSales, pbAvgSales, false, 'percent')}</div>
          <div class="card p-4 text-center"><p class="text-[9px] font-bold text-slate-400 uppercase letter">Product Target</p><h2 class="text-xl font-black birds-green">${(bAvgProduct*100).toFixed(1)}%</h2>${getTrendStr(bAvgProduct, pbAvgProduct, false, 'percent')}</div>
          <div class="card p-4 text-center"><p class="text-[9px] font-bold text-slate-400 uppercase letter">Wastage</p><h2 class="text-xl font-black text-slate-700">${(bAvgWaste*100).toFixed(1)}%</h2>${getTrendStr(bAvgWaste, pbAvgWaste, true, 'percent')}</div>
          <div class="card p-4 text-center"><p class="text-[9px] font-bold text-slate-400 uppercase letter">Labour %</p><h2 class="text-xl font-black text-slate-700">${(bAvgLabour*100).toFixed(1)}%</h2>${getTrendStr(bAvgLabour, pbAvgLabour, true, 'percent')}</div>
          <div class="card p-4 text-center"><p class="text-[9px] font-bold text-slate-400 uppercase letter">Avg Trans. Val</p><h2 class="text-xl font-black text-slate-700">£${(bAvgATV).toFixed(2)}</h2>${getTrendStr(bAvgATV, pbAvgATV, false, 'currency')}</div>
          <div class="card p-4 text-center"><p class="text-[9px] font-bold text-slate-400 uppercase letter">Energy (kWh)</p><h2 class="text-xl font-black text-slate-700">${(bAvgEnergy).toFixed(0)}</h2>${getTrendStr(bAvgEnergy, pbAvgEnergy, true, 'whole')}</div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="lg:col-span-1 card p-6 border-t-4 border-t-indigo-400">
             <h3 class="font-black outfit text-indigo-600 mb-4 text-sm uppercase">Critical Actions & Common Failures</h3>
             <div class="bg-indigo-50 rounded-xl p-4 mb-4 border border-indigo-100">
                 <div class="text-[10px] font-bold text-indigo-800 uppercase mb-1">Critical Action Rate</div>
                 <div class="flex items-end justify-between"><div><span class="text-[36px] font-black text-indigo-600">${allActions.length > 0 ? ((allActions.filter(function(a){return a.Critical === 'Yes';}).length / allActions.length) * 100).toFixed(1) : '0.0'}<span class="text-xs text-slate-800 ml-1">%</span></span><span class="text-xs text-slate-800 ml-2">${allActions.filter(function(a){return a.Critical === 'Yes';}).length} of ${allActions.length} actions</span></div></div>
                 <p class="text-[10px] text-indigo-600 mt-2 leading-tight">Percentage of all audit actions (open & closed) flagged as critical across the entire network.</p>
             </div>
             <div class="bg-white rounded-xl p-3 border border-indigo-100 shadow-sm"><div class="text-[10px] font-bold text-slate-800 uppercase mb-2"> Top 5 Common Audit Failures</div>${allActions.length > 0 ? function(){ var qMap = new Map(); allActions.forEach(function(a){ var q = (a.Question || '').trim(); if(q) qMap.set(q, (qMap.get(q)||0) + 1); }); return Array.from(qMap.entries()).sort(function(a,b){ return b[1] - a[1]; }).slice(0,5).map(function(f, idx){ return '<div class="text-[10px] border-b border-indigo-100 pb-1 mb-1 last:border-0 last:mb-0 last:pb-0"><span class="font-bold text-indigo-800">' + (idx+1) + '.</span> ' + f[0] + ' <span class="font-bold text-indigo-500 float-right">(' + f[1] + 'x)</span></div>'; }).join(''); }() : '<p class="text-xs text-slate-500 italic">No action data found.</p>'}
             </div>
          </div>
          <div class="lg:col-span-1 card p-6">
            <h3 class="font-black outfit birds-green mb-4 text-sm uppercase">Sector Compliance Profile</h3>
            <div class="flex flex-col gap-4 mt-2">
              ${['Food','Fire','HandS','Journey','Coffee','Focus'].map(s => {
                const sAvg = Array.from(auditMap.values()).reduce((a,b)=>a+(b[s]||0),0)/(auditMap.size||1);
                return `<div><div class="flex justify-between text-[10px] font-bold mb-1"><span>${s === 'Focus' ? 'Birds Focus' : s === 'HandS' ? 'Health & Safety' : s}</span><span class="${sAvg<90?'text-red-500':sAvg<95?'text-amber-500':''}">${sAvg.toFixed(1)}%</span></div>
                <div class="progress-bar"><div class="${progColor(sAvg)}" style="width:${sAvg}%"></div></div></div>`
              }).join('')}
            </div>
          </div>
          <div class="lg:col-span-1 card p-6"><h3 class="font-black outfit birds-green mb-4 text-sm uppercase">Network Area Standings</h3><div class="flex flex-col">${areaRows}</div></div>
        </div>
        <div class="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="card p-6 border-t-4 border-t-amber-500">
            <h3 class="font-black outfit text-amber-800 text-lg uppercase mb-3">5 Most Recent EHO Visits</h3>
            <div class="max-h-48 overflow-y-auto space-y-2">${function(){ var list = []; function tryGetCsv(name,id){ if(typeof window._ehoRatings === 'undefined') return null; return window._ehoRatings.get((name||'').toLowerCase()) || window._ehoRatings.get((id||'').toLowerCase()) || null; } ehoData.forEach(function(d){ if(!storeMap.get(d.StoreId)) return; var displayName = (typeof originalStoreNames !== 'undefined' && originalStoreNames.get(d.StoreId)) || d.StoreId; var inspDate = d.inspectionDate || d.ehoVisit || ''; var csv = tryGetCsv(displayName, d.StoreId); if(!inspDate && csv) inspDate = csv.inspectionDate || csv.nextDue || ''; if(!inspDate) return; var parsed = parseUKDate(inspDate); if(!parsed || isNaN(parsed.getTime())) return; var rating = d.ehoRating || (csv ? csv.rating : '') || ''; var dd = ('0'+parsed.getDate()).slice(-2) + '/' + ('0'+(parsed.getMonth()+1)).slice(-2) + '/' + parsed.getFullYear(); list.push({store: displayName, rating: rating, date: dd, parsed: parsed}); }); if(typeof window._ehoRatings !== 'undefined'){ window._ehoRatings.forEach(function(csv,key){ var parsed = csv.inspectionDate ? parseUKDate(csv.inspectionDate) : null; if(!parsed || isNaN(parsed.getTime())){ parsed = csv.nextDue ? parseUKDate(csv.nextDue) : null; } if(!parsed || isNaN(parsed.getTime())) return; if(list.some(function(e){return e.store.toLowerCase() === (csv.name||key).toLowerCase()})) return; var dd = ('0'+parsed.getDate()).slice(-2) + '/' + ('0'+(parsed.getMonth()+1)).slice(-2) + '/' + parsed.getFullYear(); list.push({store: csv.name || key, rating: csv.rating || '', date: dd, parsed: parsed}); }); } list.sort(function(a,b){ return b.parsed - a.parsed; }); list = list.slice(0,5); if(list.length === 0) return '<p class="text-sm text-slate-500 italic">No EHO visit data available.</p>'; return list.map(function(r){ var stars = ''; var n = parseInt(r.rating); if(n > 0) for(var i=0;i<n;i++) stars += '★'; else stars = r.rating; return '<div class="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-4 py-2"><span class="text-sm font-bold text-slate-800">' + r.store + '</span><span class="text-xs text-slate-500"><span class="text-amber-500">' + stars + '</span> <span class="text-amber-700 font-bold ml-2">' + r.date + '</span></span></div>'; }).join(''); }()}</div>
          </div>
          <div class="card p-6 border-t-4 border-t-red-500">
            <h3 class="font-black outfit text-red-800 text-lg uppercase mb-3">EHO Overdue Stores</h3>
            <div class="max-h-48 overflow-y-auto space-y-2">${function(){ var now = new Date(); var rows = []; function tryGetCsv(name,id){ if(typeof window._ehoRatings === 'undefined') return null; return window._ehoRatings.get((name||'').toLowerCase()) || window._ehoRatings.get((id||'').toLowerCase()) || null; } ehoData.forEach(function(d){ if(!storeMap.get(d.StoreId)) return; var displayName = (typeof originalStoreNames !== 'undefined' && originalStoreNames.get(d.StoreId)) || d.StoreId; var dueDate = null; var csv = tryGetCsv(displayName, d.StoreId); if(d.nextDue){ dueDate = parseUKDate(d.nextDue); } if(!dueDate && d.ehoVisit){ var dd = parseUKDate(d.ehoVisit); if(dd && !isNaN(dd.getTime())){ var nd = new Date(dd); nd.setFullYear(nd.getFullYear() + 1); dueDate = nd; } } if(!dueDate && d.inspectionDate){ var dd = parseUKDate(d.inspectionDate); if(dd && !isNaN(dd.getTime())){ var nd = new Date(dd); nd.setFullYear(nd.getFullYear() + 1); dueDate = nd; } } if(!dueDate && csv && csv.nextDue){ dueDate = parseUKDate(csv.nextDue); } if(!dueDate && csv && csv.inspectionDate){ var dd = parseUKDate(csv.inspectionDate); if(dd && !isNaN(dd.getTime())){ var nd = new Date(dd); nd.setFullYear(nd.getFullYear() + 1); dueDate = nd; } } if(dueDate && !isNaN(dueDate.getTime()) && dueDate < now){ var rating = d.ehoRating || (csv ? csv.rating : '') || '—'; var dd = ('0'+dueDate.getDate()).slice(-2) + '/' + ('0'+(dueDate.getMonth()+1)).slice(-2) + '/' + dueDate.getFullYear(); rows.push({store: displayName, rating: rating, due: dd, days: Math.round((dueDate - now) / 86400000)}); } }); rows.sort(function(a,b){ return a.days - b.days; }); if(rows.length === 0) return '<p class="text-sm text-slate-500 italic">No stores currently overdue for EHO inspection.</p>'; return rows.map(function(r){ var stars = ''; var n = parseInt(r.rating); if(n > 0) for(var i=0;i<n;i++) stars += '★'; else stars = r.rating; return '<div class="flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-4 py-2"><span class="text-sm font-bold text-slate-800">' + r.store + '</span><span class="text-xs text-slate-500"><span class="text-amber-500">' + stars + '</span> <span class="text-red-600 font-bold ml-2">Due: ' + r.due + '</span></span></div>'; }).join(''); }()}
          </div>
        </div>
</div>`;
  }

  if(currentView === 'areas'){
    const byAM = validAMs.map(am => {
      const stores = curr.filter(k => k.AM === am); if(!stores.length) return ''; const pStores = prev.filter(k => k.AM === am);
      const aItems = Array.from(auditMap.entries()).filter(([id, data]) => storeMap.get(id) === am).map(([id, data]) => data);
      const avgK = (f) => stores.reduce((a,b)=>a+(b[f]||0),0)/stores.length; const pAvgK = (f) => pStores.length ? pStores.reduce((a,b)=>a+(b[f]||0),0)/pStores.length : undefined;

    // --- SHOP-VERSION KPI ENGINE ---
    const getAreaAvg = (storeArray, keywords, excludeKw = null) => {
        if (!storeArray || storeArray.length === 0) return undefined;
        let actualKey = null;
        let keys = Object.keys(storeArray[0] || {});
        
        for (let k of keys) {
            let l = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            let matches = keywords.every(kw => l.includes(kw));
            if (excludeKw && excludeKw.some(ex => l.includes(ex))) matches = false;
            
            if (matches && !l.includes('target') && !l.includes('diff') && !l.includes('var') && !l.includes('ly')) {
                actualKey = k;
                break;
            }
        }
        if (!actualKey) return undefined;
        
        let total = 0, count = 0;
        storeArray.forEach(s => {
            let val = s[actualKey];
            if (val !== undefined && val !== null && val !== '') {
                let parsed = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ''));
                if (!isNaN(parsed) && parsed !== 0) { total += parsed; count++; }
            }
        });
        return count > 0 ? total / count : undefined;
    };

    const kpiCats = [
        { label: 'Hot Food', kw: ['hot', 'roll'], ex: ['bev', 'drink'] },
        { label: 'Hot Drinks', kw: ['hot', 'bev'], ex: null },
        { label: 'Cold Rolls', kw: ['filled', 'roll'], ex: ['hot'] },
        { label: 'Sandwiches', kw: ['sandwich'], ex: null }
    ];

    // THE FIX: min-width: 100% physically prevents the browser from squashing it to the left
    let extraKpisHtml = `
    <div class="birds-kpi-panel block w-full mt-6 pt-5 border-t border-slate-200 clear-both" style="min-width: 100%;">
        <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3">Category Variance

<div class="mt-4 border-t pt-4"></div>


</h4>
        <div class="grid grid-cols-2 gap-3 w-full">
    `;
    
    kpiCats.forEach(kpi => {
        let currAvg = getAreaAvg(stores, kpi.kw, kpi.ex);
        let prevAvg = getAreaAvg(typeof pStores !== 'undefined' ? pStores : [], kpi.kw, kpi.ex);
        
        let displayVal = '-';
        let formattedDiff = '-';
        let trendColor = 'text-slate-500';
        let trendBg = 'bg-slate-100';
        let trendArrow = '-';

        if (currAvg !== undefined) {
            let isPct = (currAvg > -2 && currAvg < 2 && currAvg !== 0);
            displayVal = isPct ? (currAvg * 100).toFixed(1) + '%' : Math.round(currAvg).toString();
            
            if (prevAvg !== undefined) {
                let diff = currAvg - prevAvg;
                formattedDiff = isPct ? Math.abs(diff * 100).toFixed(1) + '%' : Math.abs(Math.round(diff)).toString();
                if (diff > (isPct ? 0.001 : 1)) { 
                    trendColor = 'text-slate-800'; 
                    trendBg = '';
                    trendArrow = '▲'; 
                }
                else if (diff < -(isPct ? 0.001 : 1)) { 
                    trendColor = 'text-rose-700'; 
                    trendBg = 'bg-rose-50';
                    trendArrow = '▼'; 
                }
            }
        }
        
        extraKpisHtml += `
            <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between w-full">
                <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">${kpi.label}</span>
                <div class="flex items-center justify-between mt-3">
                    <span class="text-xl font-black text-slate-800 leading-none">${displayVal}</span>
                    <span class="${trendBg} ${trendColor} text-[11px] font-black px-2 py-1 rounded-md flex items-center gap-1">${trendArrow} ${formattedDiff}</span>
                </div>
            </div>
        `;
    });
    extraKpisHtml += '</div></div>';
    
    /* PATCH30C0:
       Prevent KPI block accumulation
    */

    window.areaKPIBlocks = [
        extraKpisHtml
    ];
    let validAreaAudits = 0; const totalAreaAuditScore = stores.reduce((a,b) => { const s = auditMap.get(b.Branch.trim().toLowerCase())?.Score; if(s) { validAreaAudits++; return a + s; } return a; }, 0); const aAvg = validAreaAudits > 0 ? totalAreaAuditScore / validAreaAudits : 0;
      const sFood = aItems.reduce((a,b)=>a+(b['Food']||0),0)/(aItems.length||1); const sFire = aItems.reduce((a,b)=>a+(b['Fire']||0),0)/(aItems.length||1); const sHandS = aItems.reduce((a,b)=>a+(b['HandS']||0),0)/(aItems.length||1); const sJourney = aItems.reduce((a,b)=>a+(b['Journey']||0),0)/(aItems.length||1); const sCoffee = aItems.reduce((a,b)=>a+(b['Coffee']||0),0)/(aItems.length||1); const sFocus = aItems.reduce((a,b)=>a+(b['Focus']||0),0)/(aItems.length||1);
      const progColor = (val) => val >= 95 ? 'progress-fill' : val >= 90 ? 'progress-fill-warn' : 'progress-fill-crit';
      const safeMin = (p, c, f) => ((p[f]===0||!p[f]?Infinity:p[f]) < (c[f]===0||!c[f]?Infinity:c[f])) ? p : c; const safeMax = (p, c, f) => ((p[f]===0||!p[f]?-Infinity:p[f]) > (c[f]===0||!c[f]?-Infinity:c[f])) ? p : c;
      const bestSales = stores.reduce((p, c) => safeMax(p, c, 'Sales')); const bestProduct = stores.reduce((p, c) => safeMax(p, c, 'Product')); const bestWaste = stores.reduce((p, c) => safeMin(p, c, 'Waste')); const bestLabour = stores.reduce((p, c) => safeMin(p, c, 'Labour')); const bestEnergy = stores.reduce((p, c) => safeMin(p, c, 'Energy')); const bestATV = stores.reduce((p, c) => safeMax(p, c, 'ATV'));
      const bestAudit = stores.reduce((p, c) => { const pScore = auditMap.get(p.Branch.trim().toLowerCase())?.Score || 0; const cScore = auditMap.get(c.Branch.trim().toLowerCase())?.Score || 0; return pScore > cScore ? p : c; });
      const dev = [ { name: 'Sales Growth', diff: avgK('Sales') - bAvgSales, badIfNeg: true, fmt: x=>(x>0?'+':'')+(x*100).toFixed(1)+'%' }, { name: 'Product Target', diff: avgK('Product') - bAvgProduct, badIfNeg: true, fmt: x=>(x>0?'+':'')+(x*100).toFixed(1)+'%' }, { name: 'Wastage', diff: avgK('Waste') - bAvgWaste, badIfNeg: false, fmt: x=>(x>0?'+':'')+(x*100).toFixed(1)+'%' }, { name: 'Labour', diff: avgK('Labour') - bAvgLabour, badIfNeg: false, fmt: x=>(x>0?'+':'')+(x*100).toFixed(1)+'%' }, { name: 'ATV', diff: avgK('ATV') - bAvgATV, badIfNeg: true, fmt: x => `${x >= 0 ? '+£' : '-£'}${Math.abs(x).toFixed(2)}` }, { name: 'Energy', diff: avgK('Energy') - bAvgEnergy, badIfNeg: false, fmt: x=>(x>0?'+':'')+x.toFixed(0)+' kWh' } ];
      dev.forEach(d => d.severity = d.badIfNeg ? -d.diff : d.diff); const focus = dev.reduce((p, c) => p.severity > c.severity ? p : c);
      const isRedAlert = focus.severity > 0; const alertBoxCol = isRedAlert ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'; const alertTextCol = isRedAlert ? 'text-red-600' : 'text-slate-600';
      let badges = '';
      try{ if(globalMostImprovedWin && globalMostImprovedWin.Branch){ const miId = canonicalStoreId(globalMostImprovedWin.Branch); const miAM = storeMap.get(miId); if(miAM === am) badges += `<span class="bg-purple-50 text-purple-700 border border-purple-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> MOST IMPROVED: ${globalMostImprovedWin.Branch}</span>`; } }catch(e){}
      if (am === overallWinner) badges += `<span class="bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-black px-2 py-0.5 rounded shadow-sm mr-1"> OVERALL CHAMPION</span>`;
      if (am === bestSalesAM) badges += `<span class=" text-slate-800 border border-emerald-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> 1st Sales</span>`;
      if (am === bestProductAM) badges += `<span class=" text-slate-800 border border-emerald-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> 1st Product</span>`;
      if (am === bestWasteAM) badges += `<span class="bg-blue-50 text-slate-800 border border-blue-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> 1st Waste</span>`;
      if (am === bestLabourAM) badges += `<span class="bg-indigo-50 text-slate-800 border border-indigo-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> 1st Labour</span>`;
      if (am === bestEnergyAM) badges += `<span class="bg-slate-50 text-slate-700 border border-slate-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> 1st Energy</span>`;
      if (am === bestATVAM) badges += `<span class=" text-slate-800 border border-emerald-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> 1st ATV</span>`;
      const cardId = `area-card-${am.replace(/\s+/g, '-')}`;

      return `
        <div id="${cardId}" data-am="${am}" class="card area-card-export p-8 border-t-4 ${am === overallWinner ? 'border-t-amber-400' : 'border-t-birds-green'} relative bg-white">
          <div onclick="exportCard('${cardId}', '${am}')" class="export-btn absolute top-6 right-8 bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center shadow-sm"> Export DASH</div>
          <div class="mb-6 pb-4 border-b"><h3 class="font-black outfit text-4xl text-slate-800 leading-none mb-3">${am}</h3><div class="flex flex-wrap gap-2">${badges}</div></div>
          <div class="landscape-container">
            <div class="landscape-left">
              <div class="grid grid-cols-3 md:grid-cols-6 gap-3 bg-slate-50 border border-slate-100 p-4 rounded-2xl mb-6 shadow-inner text-center">
                 <div><small class="muted uppercase font-bold text-[10px]">Sales</small><div class="text-lg font-black text-slate-800">${(avgK('Sales')*100).toFixed(1)}%</div>${getTrendStr(avgK('Sales'), pAvgK('Sales'), false, 'percent')}</div>
                 <div><small class="muted uppercase font-bold text-[10px]">Product</small><div class="text-lg font-black text-slate-800">${(avgK('Product')*100).toFixed(1)}%</div>${getTrendStr(avgK('Product'), pAvgK('Product'), false, 'percent')}</div>
                 <div><small class="muted uppercase font-bold text-[10px]">Waste</small><div class="text-lg font-black text-slate-800">${(avgK('Waste')*100).toFixed(1)}%</div>${getTrendStr(avgK('Waste'), pAvgK('Waste'), true, 'percent')}</div>
                 <div><small class="muted uppercase font-bold text-[10px]">Labour</small><div class="text-lg font-black text-slate-800">${(avgK('Labour')*100).toFixed(1)}%</div>${getTrendStr(avgK('Labour'), pAvgK('Labour'), true, 'percent')}</div>
                 <div><small class="muted uppercase font-bold text-[10px]">ATV</small><div class="text-lg font-black text-slate-800">£${(avgK('ATV')).toFixed(2)}</div>${getTrendStr(avgK('ATV'), pAvgK('ATV'), false, 'currency')}</div>
                 <div><small class="muted uppercase font-bold text-[10px]">Energy</small><div class="text-lg font-black text-slate-800">${(avgK('Energy')).toFixed(0)}</div>${getTrendStr(avgK('Energy'), pAvgK('Energy'), true, 'whole')}</div>
              </div>
              <div class="mb-6 p-5 rounded-xl border ${alertBoxCol}"><div class="text-[10px] font-black ${alertTextCol} uppercase mb-2 tracking-wide"> Performance Focus Area</div><div class="text-sm text-slate-700 leading-snug font-medium"><b>${focus.name}</b> indicates the highest variance against the network average (<span class="${alertTextCol} font-bold">${focus.fmt(focus.diff)}</span>). Prioritize this sector for coaching interventions.</div></div>
              
<h4 class="text-[11px] font-black muted uppercase mb-3">KPI Performance Table</h4>
<div class="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
  <table class="w-full text-sm">
    <thead class="bg-slate-50 border-b">
      <tr>
        <th class="p-2 text-left font-bold text-slate-500">KPI</th>
        <th class="p-2 text-left font-bold text-amber-600">Top Performer</th>
        <th class="p-2 text-left font-bold text-emerald-600">Most Improved</th>
      </tr>
    </thead>
    <tbody>
      ${['Sales','Product','Waste','Labour','ATV','Energy'].map(m=>{
        const perf = (window.__areaWinsCache||[]).find(w=>w.Week===effectiveWeek && w.Metric===m && storeMap.get(canonicalStoreId(w.Branch))===am);
        const imp = (window.__areaWinsCache||[]).find(w=>w.Week===effectiveWeek && w.Metric===m+' (Improvement)' && storeMap.get(canonicalStoreId(w.Branch))===am);
        return `
        <tr class="border-b">
          <td class="p-2 font-bold text-slate-700">${m}</td>
          <td class="p-2 text-amber-600 font-semibold">${perf?perf.Branch:'-'}</td>
          <td class="p-2 text-emerald-600 font-semibold">${imp?imp.Branch:'-'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>

            </div>
            <div class="landscape-right">
              <h4 class="text-[11px] font-black muted uppercase mb-4 flex items-center gap-2"><div class="w-1 h-3  rounded-full"></div> Operational Sectors (Area Avg: ${aAvg.toFixed(1)}%)</h4>
              <div class="grid grid-cols-2 gap-x-6 gap-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>Food Safety</span><span class="${sFood<90?'text-red-500':sFood<95?'text-amber-500':''}">${sFood.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sFood)}" style="width:${sFood}%"></div></div></div>
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>Fire Safety</span><span class="${sFire<90?'text-red-500':sFire<95?'text-amber-500':''}">${sFire.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sFire)}" style="width:${sFire}%"></div></div></div>
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>H&S / Legal</span><span class="${sHandS<90?'text-red-500':sHandS<95?'text-amber-500':''}">${sHandS.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sHandS)}" style="width:${sHandS}%"></div></div></div>
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>Cust. Journey</span><span class="${sJourney<90?'text-red-500':sJourney<95?'text-amber-500':''}">${sJourney.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sJourney)}" style="width:${sJourney}%"></div></div></div>
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>Coffee Standard</span><span class="${sCoffee<90?'text-red-500':sCoffee<95?'text-amber-500':''}">${sCoffee.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sCoffee)}" style="width:${sCoffee}%"></div></div></div>
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>Birds Focus</span><span class="${sFocus<90?'text-red-500':sFocus<95?'text-amber-500':''}">${sFocus.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sFocus)}" style="width:${sFocus}%"></div></div></div>
              </div>
              <div class="mt-8 p-4  rounded-xl border border-emerald-100 flex items-start gap-3 relative group">
                <div class="h-8 w-8  rounded-lg flex items-center justify-center font-bold text-emerald-600 shrink-0"></div>
                <div class="flex-1"><h5 contenteditable="true" class="text-xs font-black text-emerald-900 mb-1 outline-none border-b border-dashed border-emerald-200 focus:border-emerald-400 focus:bg-white pr-6 transition-all">Area Manager Note</h5><p contenteditable="true" class="text-[11px] text-emerald-800 leading-tight outline-none focus:bg-white focus:ring-1 focus:ring-emerald-300 p-1 rounded cursor-text italic transition-all">Current period performance shows <b>${am}</b> maintaining network-leading standards in operational compliance while driving top-tier commercial growth.</p></div>
                <button onclick="this.parentElement.remove()" class="export-btn absolute -top-2 -right-2 bg-white border border-red-100 text-red-400 hover:text-red-600 rounded-full w-6 h-6 flex items-center justify-center text-[12px] shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"></button>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
    
    document.getElementById('mainView').innerHTML = `
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-2xl font-black outfit birds-green tracking-tight">Area Executive Reports (Landscape Optimized)</h2>
        <button id="export-all-btn" onclick="exportAllCardsToZip()" class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-2xl font-black shadow-lg transition-all text-sm flex items-center gap-2"> Export All Landscape (ZIP)</button>
      </div>
      <div class="grid grid-cols-1 gap-10 pb-20">${byAM}</div>`;
  }

  if(currentView === 'winners'){
    const prevByAM = {}; prev.forEach(p=>{ if(!prevByAM[p.AM]) prevByAM[p.AM]={total:0,count:0}; prevByAM[p.AM].total += p.Sales; prevByAM[p.AM].count++; });
    const improvedArea = amStatsGlobal.map(a=>{ const prevAvg = prevByAM[a.am] ? prevByAM[a.am].total/prevByAM[a.am].count : 0; return {name:a.am, change:(a.sAvg - prevAvg)}; }).sort((a,b)=>b.change-a.change)[0];
    const rankMetric = (metric, asc) => [...amStatsGlobal].sort((a,b) => asc ? a[metric] - b[metric] : b[metric] - a[metric]).slice(0,3);
    const buildSubPodium = (title, metric, asc, fmt, displayMode) => {
      const ranked = rankMetric(metric, asc);
      const formatVal = (val) => { if (displayMode === 'currency') return '£' + (val || 0).toFixed(2); if (displayMode === 'whole') return (val || 0).toFixed(0); return ((val || 0) * 100).toFixed(fmt) + '%'; };
      return `<div class="card p-4 text-center"><h4 class="text-xs font-black muted uppercase mb-3">${title}</h4><div class="flex justify-between items-end gap-2"><div class="flex-1 text-[10px]"><b>2nd</b><br>${ranked[1]?.am || '—'}<br>${formatVal(ranked[1]?.[metric])}</div><div class="flex-1 text-[11px] pb-1 border-b-2 border-birds-green"> <b>1st</b><br>${ranked[0]?.am || '—'}<br>${formatVal(ranked[0]?.[metric])}</div><div class="flex-1 text-[10px]"><b>3rd</b><br>${ranked[2]?.am || '—'}<br>${formatVal(ranked[2]?.[metric])}</div></div></div>`;
    };
    const prevByStore = new Map(prev.map(p=>[p.Branch, p.Sales]));
    const improvedStore = curr.map(c=>{ const p = prevByStore.get(c.Branch) || 0; return {name: c.Branch, change: (c.Sales - p)}; }).sort((a,b)=>b.change-a.change)[0];
    const improvedStoreHtml = `
    <div class="card p-4 text-center mb-6 border-t-4 border-t-amber-400">
      <h4 class="text-xs font-black muted uppercase mb-1"> Most Improved Store</h4>
      <div class="text-base font-black birds-green"> ${improvedStore?.name || '-'}</div>
      <div class="text-xs text-emerald-600 font-bold">+${((improvedStore?.change||0)*100).toFixed(1)}%</div>
      <div class="text-[9px] text-slate-400 font-bold uppercase mt-1">Sales vs Prior Period</div>
    </div>`;
    document.getElementById('mainView').innerHTML = `
      <div id="winners-card" class="pb-2 relative">
        <div onclick="exportCard('winners-card', 'Winners')" class="export-btn absolute top-4 right-4 bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"> Export Dash</div>
        ${improvedStoreHtml}
        <div class="card p-8 mb-6 text-center relative"><h2 class="font-black outfit birds-green text-2xl mb-8 mt-2">COMBINED AREA PODIUM</h2><div class="flex items-end gap-4 justify-center"><div class="card p-4 h-32 flex-1 border border-slate-200"><b>2nd</b><br>${amStatsGlobal[1]?.am || '—'}</div><div class="card p-6 h-48 flex-1 winner-1st shadow-lg"> <b>1st Overall</b><br><b class="text-xl">${amStatsGlobal[0]?.am || '—'}</b></div><div class="card p-4 h-24 flex-1 border border-slate-200"><b>3rd</b><br>${amStatsGlobal[2]?.am || '—'}</div></div></div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">${buildSubPodium('Sales Growth', 'sAvg', false, 1, 'percent')}${buildSubPodium('Product Target', 'pAvg', false, 1, 'percent')}${buildSubPodium('Waste Control', 'wAvg', true, 1, 'percent')}${buildSubPodium('Labour Efficiency', 'lAvg', true, 1, 'percent')}${buildSubPodium('ATV Standings', 'atvAvg', false, 2, 'currency')}${buildSubPodium('Energy Usage', 'eAvg', true, 0, 'whole')}</div>
      </div>`;
  }

  if(currentView === 'leaderboard') {
    const baseWeek = (typeof effectiveWeek !== 'undefined') ? effectiveWeek : latestWkGlobal;
    let currLB = []; let prevLB = [];
    if(currentTimeFilter === 'latest') { currLB = aggregateData(rawKpis.filter(k => k.Week === baseWeek)); prevLB = aggregateData(rawKpis.filter(k => k.Week === (baseWeek - 1))); }
    else if(currentTimeFilter === 'last4') { currLB = aggregateData(rawKpis.filter(k => k.Week <= baseWeek && k.Week > baseWeek - 4)); prevLB = aggregateData(rawKpis.filter(k => k.Week <= baseWeek - 4 && k.Week > baseWeek - 8)); }
    else { currLB = aggregateData(rawKpis); prevLB = []; }

    const getCompScore = (k) => ((k.Sales||0)*100) + ((k.Product||0)*100) - ((k.Waste||0)*100) - ((k.Labour||0)*100) + (k.ATV||0) - ((k.Energy||0)/100);

    const currSorted = [...currLB].sort((a,b)=> getCompScore(b) - getCompScore(a)); 
    const prevSorted = [...prevLB].sort((a,b)=> getCompScore(b) - getCompScore(a)); 
    const prevRank = new Map(prevSorted.map((r,i)=>[r.Branch, i+1]));

    const rows = currSorted.map((r,i)=>{
      const nowRank = i+1; const wasRank = prevRank.get(r.Branch); let delta = '<span class="text-slate-300 font-black">—</span>';
      if(wasRank && wasRank !== nowRank) { const diff = wasRank - nowRank; if(diff > 0) delta = `<span class="text-emerald-600 font-black">▲ ${diff}</span>`; else delta = `<span class="text-red-600 font-black">▼ ${Math.abs(diff)}</span>`; }
      return `<tr class="border-b border-slate-100 text-[11px] hover:bg-slate-50">
        <td class="p-3 font-black">${nowRank}</td>
        <td class="p-3">${delta}</td>
        <td class="p-3 font-bold">${r.Branch}</td>
        <td class="p-3 text-slate-500">${r.AM}</td>
        <td class="p-3 font-black text-indigo-600">${getCompScore(r).toFixed(1)}</td>
        <td class="p-3 font-bold birds-green">${(r.Sales*100).toFixed(1)}%</td>
        <td class="p-3">${(r.Labour*100).toFixed(1)}%</td>
        <td class="p-3">${(r.Energy).toFixed(0)} kWh</td>
      </tr>`;
    }).join('');

    document.getElementById('mainView').innerHTML = `
      <div class="card overflow-x-auto relative max-h-[600px] overflow-y-auto shadow-inner border border-slate-200">
        <table class="w-full text-left relative">
          <thead class="sticky top-0 bg-slate-50 z-10 shadow-sm border-b border-slate-200">
            <tr>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Rank</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Δ</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Store</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Area</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Comp Score</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Sales</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Labour</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Energy</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }
}

function renderControlPanel() { if(window.isAdmin && !isAdmin()){ document.getElementById('mainView').innerHTML='<div class="card p-8 text-center"><h2>Admin Access Required</h2></div>'; return; }
    let rows = ''; const sortedStores = Array.from(storeMap.entries()).sort((a,b) => a[0].localeCompare(b[0]));
    sortedStores.forEach(([branchId, currentAM]) => {
        let origName = originalStoreNames.get(branchId);

if (!origName) {
  origName = branchId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/bakeryshop/i, 'Bakery Shop')
    .replace(/albertstreet/i, 'Albert Street')
    .replace(/instreet/i, 'In Street')
    .replace(/tealpark/i, 'Teal Park')
    .replace(/meltonroad/i, 'Melton Road');
} let options = AM_LIST.map(am => `<option value="${am}" ${am === currentAM ? 'selected' : ''}>${am}</option>`).join('');
        rows += `<div class="flex justify-between items-center border-b border-slate-100 py-3 hover:bg-slate-50 transition-colors px-2 rounded"><span class="font-bold text-slate-800 text-sm w-1/2">${origName}</span><select onchange="updateStoreAM('${branchId}', this.value)" class="p-1.5 border border-slate-200 rounded-lg text-sm bg-white shadow-sm w-1/2 focus:ring-2 focus:ring-birds-green outline-none">${options}</select></div>`;
    });
    document.getElementById('mainView').innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="col-span-1">
              <div class="card p-6 mb-6">
                <h2 class="text-xl font-black birds-green mb-4">Add New Store</h2>
                <p class="text-xs text-slate-500 mb-4">Add an upcoming store to allocate it to an Area Manager immediately.</p>
                <div class="flex flex-col gap-3">
                  <input type="text" id="newStoreName" placeholder="Enter Store Name..." class="border border-slate-200 p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-birds-green outline-none w-full shadow-sm">
                  <select id="newStoreAM" class="border border-slate-200 p-2.5 rounded-xl text-sm bg-white shadow-sm focus:ring-2 focus:ring-birds-green outline-none w-full">${AM_LIST.map(a => `<option value="${a}">${a}</option>`).join('')}</select>
                   <button onclick="addNewStore()" class="bg-birds text-white px-4 py-2.5 rounded-xl font-bold shadow-md transition-all mt-2"> Add to System</button>
                </div>
              </div>
            </div>
            <div class="col-span-2"><div class="card p-6 h-full"><div class="flex justify-between items-center mb-6"><h2 class="text-xl font-black birds-green">Store Allocation Matrix</h2><span class="text-xs font-bold bg-slate-100 text-slate-600 px-3 py-1 rounded-full">${sortedStores.length} Stores</span></div><div class="max-h-[600px] overflow-y-auto pr-2">${rows}</div></div></div>
        </div>
    `;
}

window.setView = function(v) { currentView = v; document.querySelectorAll('nav button').forEach(b => { b.className = (b.id === `btn-${v}`) ? 'seg-btn seg-btn-active flex-1 whitespace-nowrap' : 'seg-btn flex-1 whitespace-nowrap'; }); renderDashboard(); }

window.startAudit = function() {
  console.log('[Audit] startAudit called, _auditQB=', !!_auditQB, 'auditState=', !!auditState);
  setActiveTab('audits');
  auditState = { view: 'meta', branchId: null, storeName: '', areaManager: '', email: '', manager: '', auditor: 'Blake Lowis', date: new Date().toISOString().slice(0, 10), summary: '', sectors: {}, sectorId: null, categoryId: null, isTraining: false };
  currentView = 'auditPerform';
  try { renderAuditPerform(); console.log('[Audit] renderAuditPerform completed'); } catch(e) { console.error('[Audit] Render error:', e); }
}
