async function renderDashboard(){
try {
  
  
if(currentView === 'champions')
    return renderChampionsView();


if(currentView === 'documents')
    return renderDocuments();

if(currentView === 'documentarchive')
    return renderDocumentArchive();

if(currentView === 'documentcreate')
    return renderDocumentCreate();

if(currentView === 'templatelibrary')
    return renderTemplateLibrary();
if(currentView === 'templatebuilder')
    return renderTemplateBuilderPage();
if(currentView === 'templatefill')
    return renderTemplateFill();

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
if(currentView === 'missingweeks') return renderMissingWeeksReport();

  

  const rawKpis = await idbGetAll('kpi'); const allAudits = await idbGetAll('audits'); var allActions = []; if (typeof getAuditActionsForReport === 'function') { try { allActions = await getAuditActionsForReport(); allActions.forEach(function(a) { if (a.Status === 'Closed' && a.ClosedOn && a.AuditDate) { var cd = new Date(a.ClosedOn); var ad = new Date(a.AuditDate); if (!isNaN(cd.getTime()) && !isNaN(ad.getTime())) a.DaysToClose = Math.round((cd - ad) / 86400000); } }); } catch(e) { console.warn('[Dash] Failed to load actions from JSON folders:', e); } } // EHO data: prefer CSV (shared, consistent across users) over IndexedDB
  var ehoData = []; if (typeof window._ehoRatings !== 'undefined' && window._ehoRatings.size > 0) { window._ehoRatings.forEach(function(v, k) { ehoData.push({StoreId: k, ehoRating: String(v.rating || ''), inspectionDate: v.inspectionDate || '', ehoVisit: '', nextDue: v.nextDue || ''}); }); } else { try { ehoData = await idbGetAll('eho_data'); } catch(e) {} }
  const combinedData = [...rawKpis, ...allAudits]; if(!combinedData.length && currentView !== 'control') return;
  const effectiveYear = combinedData.length ? Math.max(...combinedData.map(k => (k.Year || currentAwardsYear || new Date().getFullYear()))) : new Date().getFullYear();
  latestWkGlobal = combinedData.length ? Math.max(...combinedData.filter(k => (k.Year || effectiveYear) == effectiveYear).map(k => Number(k.Week) || 0)) : 0;
  let effectiveWeek = (archiveWeekOverride && Number.isFinite(archiveWeekOverride)) ? archiveWeekOverride : latestWkGlobal;
  updateActiveWeekBadge(effectiveWeek);
  // BUILD STORE MEDALS MAP (v41)
  const winners = await idbGetAll('store_winners_log');
  window.storeMedalsMap = {}; window.__areaWinsCache = winners;
  winners.filter(w => w.Week == effectiveWeek).forEach(w=>{
    if(!window.storeMedalsMap[w.Branch]) window.storeMedalsMap[w.Branch]=[];
    window.storeMedalsMap[w.Branch].push(w.Metric);
  });


  let globalMostImprovedWin = null;
  try{ const wins = await idbGetAll('store_winners_log'); globalMostImprovedWin = wins.find(w => w && w.Metric === 'Most Improved' && w.Week == effectiveWeek && (w.Year || effectiveYear) == effectiveYear) || null; }catch(e){}
  
  let curr = [], prev = []; let currAudits = [], prevAudits = []; let currActions = [], prevActions = [];
  if (currentTimeFilter === 'latest') {
      curr = aggregateData(rawKpis.filter(k => k.Week == effectiveWeek && (k.Year || effectiveYear) == effectiveYear));
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
                      k.Week == p.week &&
                      (k.Year || p.year) == p.year
              )
          );
      }
      currAudits = allAudits.filter(a => a.Week == effectiveWeek); prevAudits = allAudits.filter(a => a.Week == effectiveWeek - 1);
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
      const stores = curr.filter(k => safeGetAM(k.Branch) === am); if(!stores.length) return null;
      const avg = (f) => stores.reduce((a,b)=>a+(b[f]||0),0)/stores.length;
      let validAudits = 0;
      const totalAuditScore = stores.reduce((a,b) => { const s = auditMap.get(b.Branch.trim().toLowerCase())?.Score; if(s) { validAudits++; return a + s; } return a; }, 0);
      const aAvg = validAudits > 0 ? totalAuditScore / validAudits : 0;
      const compScore = calculateStoreScore({Sales: avg('Sales'),Product: avg('Product'),Waste: avg('Waste'),Labour: avg('Labour'),Energy: avg('Energy')});
      return { am, score: compScore, sAvg: avg('Sales'), pAvg: avg('Product'), wAvg: avg('Waste'), lAvg: avg('Labour'), aAvg: aAvg, eAvg: avg('Energy'), atvAvg: avg('ATV') };
  }).filter(x => x).sort((a,b)=>b.score-a.score);

  const overallWinner = amStatsGlobal[0]?.am; const bestSalesAM = [...amStatsGlobal].sort((a,b)=>b.sAvg-a.sAvg)[0]?.am; const bestProductAM = [...amStatsGlobal].sort((a,b)=>b.pAvg-a.pAvg)[0]?.am; const bestWasteAM = [...amStatsGlobal].sort((a,b)=>a.wAvg-b.wAvg)[0]?.am; const bestLabourAM = [...amStatsGlobal].sort((a,b)=>a.lAvg-b.lAvg)[0]?.am; const bestEnergyAM = [...amStatsGlobal].sort((a,b)=>a.eAvg-b.eAvg)[0]?.am; const bestAuditAM = [...amStatsGlobal].sort((a,b)=>b.aAvg-a.aAvg)[0]?.am; const bestATVAM = [...amStatsGlobal].sort((a,b)=>b.atvAvg-a.atvAvg)[0]?.am;

  
if(currentView === 'overview'){
    if(typeof renderOverviewFresh === 'function') {
      var bAvgs = { Sales: bAvgSales, Product: bAvgProduct, Waste: bAvgWaste, Labour: bAvgLabour, Energy: bAvgEnergy, ATV: bAvgATV, HotBev: bAvgHotBev, HotRolls: bAvgHotRolls, Sandwiches: bAvgSandwiches, FilledRolls: bAvgFilledRolls };
      var pAvgs = { Sales: pbAvgSales, Product: pbAvgProduct, Waste: pbAvgWaste, Labour: pbAvgLabour, Energy: pbAvgEnergy, ATV: pbAvgATV, HotBev: pbAvgHotBev, HotRolls: pbAvgHotRolls, Sandwiches: pbAvgSandwiches, FilledRolls: pbAvgFilledRolls };
      return renderOverviewFresh(bAvgs, pAvgs, ehoData, allActions, auditMap, effectiveWeek, amStatsGlobal, curr.length);
    }
    const filterLabel = currentTimeFilter === 'latest' ? `Wk ${effectiveWeek}${archiveWeekOverride? ' (Archive)' : ''}` : currentTimeFilter === 'last4' ? 'Rolling 4 Weeks' : 'Year to Date';
    const prevWeekLabel = currentTimeFilter === 'latest' ? `Wk ${effectiveWeek - 1}` : currentTimeFilter === 'last4' ? 'Prev 4 Weeks' : 'Prev YTD';

    // RAG helper: isInverse=true means up is BAD (labour, waste, energy)
    function kpiCard(label, curr, prev, isInverse, format) {
      const currPct = format === 'currency' ? `£${curr.toFixed(2)}` : format === 'whole' ? curr.toFixed(0) : `${(curr*100).toFixed(1)}%`;
      const diff = curr - prev;
      const absDiff = Math.abs(diff);
      let diffStr = '';
      if (format === 'currency') diffStr = `£${absDiff.toFixed(2)}`;
      else if (format === 'whole') diffStr = absDiff.toFixed(0);
      else diffStr = `${(absDiff*100).toFixed(1)}%`;
      const isGood = isInverse ? diff < 0 : diff > 0;
      const isBad = isInverse ? diff > 0 : diff < 0;
      const direction = diff > 0 ? 'Up' : diff < 0 ? 'Down' : 'unchanged';
      const changeText = diff === 0 ? `No change from ${prevWeekLabel}` : `${diffStr} ${trendIcon(diff)}${direction} from ${prevWeekLabel}`;
      const bracketColor = isGood ? '#8BA88A' : isBad ? '#D94F4F' : '#ccc';
      const valColor = isBad ? 'color:#D94F4F' : isGood ? 'color:#6E8E6D' : 'color:#4A4A4A';
      const changeColor = diff === 0 ? 'color:#7A7A7A' : isGood ? 'color:#6E8E6D' : 'color:#D94F4F';
      return `<div class="card p-4 text-center bracket-rag" style="--bracket-color:${bracketColor};">
        <p style="font-size:13px;font-weight:800;color:#20231F;text-transform:uppercase;letter-spacing:0.03em;margin:0 0 8px 0;font-family:var(--birds-font-display);">${label}</p>
        <h2 style="font-size:32px;font-weight:900;${valColor};margin:0 0 5px 0;font-family:var(--birds-font-display);line-height:1.05;font-variant-numeric:tabular-nums;">${currPct}</h2>
        <p style="font-size:14px;font-weight:800;${changeColor};margin:0;">${changeText}</p>
      </div>`;
    }

    // Product category RAG card (sales categories - up is GOOD)
    function catCard(label, curr, prev, borderClass) {
      const currVal = Math.round(curr).toLocaleString();
      const diff = curr - prev;
      const absDiff = Math.abs(diff);
      const pctChange = prev !== 0 ? (absDiff / Math.abs(prev)) * 100 : 0;
      const diffStr = `${pctChange.toFixed(1)}%`;
      const isGood = diff > 0;
      const direction = diff > 0 ? 'Up' : diff < 0 ? 'Down' : 'unchanged';
      const changeText = diff === 0 ? `No change from ${prevWeekLabel}` : `${diffStr} ${trendIcon(diff)}${direction} from ${prevWeekLabel}`;
      const bracketColor = isGood ? '#8BA88A' : diff < 0 ? '#D94F4F' : '#ccc';
      const valColor = isGood ? 'color:#6E8E6D' : diff < 0 ? 'color:#D94F4F' : 'color:#4A4A4A';
      const changeColor = diff === 0 ? 'color:#7A7A7A' : isGood ? 'color:#6E8E6D' : 'color:#D94F4F';
      return `<div class="card p-3 text-center bracket-rag" style="--bracket-color:${bracketColor};">
        <p style="font-size:13px;font-weight:800;color:#20231F;text-transform:uppercase;letter-spacing:0.03em;margin:0 0 5px 0;font-family:var(--birds-font-display);">${label}</p>
        <h2 style="font-size:26px;font-weight:900;${valColor};margin:0 0 4px 0;font-family:var(--birds-font-display);line-height:1.05;font-variant-numeric:tabular-nums;">${currVal}</h2>
        <p style="font-size:14px;font-weight:800;${changeColor};margin:0;">${changeText}</p>
      </div>`;
    }

    const areaRows = amStatsGlobal.map((am, i) => `
      <div class="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
        <div class="flex items-center gap-3"><span class="w-6 h-6 rounded-full ${i===0?' text-slate-800': i===1?'bg-slate-100 text-slate-700': i===2?'bg-amber-100 text-amber-700':'bg-slate-50 text-slate-400'} flex items-center justify-center text-[10px] font-black">${i+1}</span><span class="font-bold text-sm">${am.am}</span></div>
        <div class="text-right flex gap-4 text-xs font-bold">
          <span class="w-16" style="color:var(--edwardian-sage-dark);">${(am.sAvg*100).toFixed(1)}% <span class="text-[9px] text-slate-400 font-normal block">Sales</span></span>
          <span class="w-16" style="color:var(--edwardian-rose);">${(am.lAvg*100).toFixed(1)}% <span class="text-[9px] text-slate-400 font-normal block">Labour</span></span>
          <span class="w-16" style="color:var(--edwardian-terracotta);">${(am.wAvg*100).toFixed(1)}% <span class="text-[9px] text-slate-400 font-normal block">Waste</span></span>
        </div>
      </div>`).join('');
    const progColor = (val) => val >= 95 ? 'progress-fill' : val >= 90 ? 'progress-fill-warn' : 'progress-fill-crit';

    document.getElementById('mainView').innerHTML = `
      <div id="overview-card" class="bg-transparent p-1">
        <div class="flex justify-between items-center mb-4">
            <div></div>
            <div onclick="exportCard('overview-card', 'Overview')" class="export-btn bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"> Export Dash</div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div class="col-span-2 md:col-span-4"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Products</p></div>
          ${catCard('Hot Drinks', bAvgHotBev, pbAvgHotBev, 'border-t-orange-400')}
          ${catCard('Hot Food', bAvgHotRolls, pbAvgHotRolls, 'border-t-orange-500')}
          ${catCard('Sandwiches', bAvgSandwiches, pbAvgSandwiches, 'border-t-blue-400')}
          ${catCard('Cold Rolls', bAvgFilledRolls, pbAvgFilledRolls, 'border-t-blue-500')}
        </div>
        <div class="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <div class="col-span-2 md:col-span-6"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">KPIs</p></div>
          ${kpiCard('Sales Growth', bAvgSales, pbAvgSales, false, 'percent')}
          ${kpiCard('Product Target', bAvgProduct, pbAvgProduct, false, 'percent')}
          ${kpiCard('Wastage', bAvgWaste, pbAvgWaste, true, 'percent')}
          ${kpiCard('Labour %', bAvgLabour, pbAvgLabour, true, 'percent')}
          ${kpiCard('Avg Trans. Val', bAvgATV, pbAvgATV, false, 'currency')}
          ${kpiCard('Energy (kWh)', bAvgEnergy, pbAvgEnergy, true, 'whole')}
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <p class="lg:col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Compliance & Area Performance</p>
           <div class="lg:col-span-1 card p-6" style="border-top:4px solid var(--edwardian-rose);">
             <h3 class="font-black outfit mb-4 text-sm uppercase" style="color:var(--edwardian-rose);">Critical Actions & Common Failures</h3>
             <div class="rounded-xl p-4 mb-4" style="background:rgba(164,119,114,0.06);border:1px solid rgba(164,119,114,0.15);">
                 <div class="text-[10px] font-bold uppercase mb-1" style="color:var(--edwardian-charcoal);">Critical Action Rate</div>
                 <div class="flex items-end justify-between"><div><span class="text-[36px] font-black" style="color:var(--edwardian-rose);">${allActions.length > 0 ? ((allActions.filter(function(a){return a.Critical === 'Yes';}).length / allActions.length) * 100).toFixed(1) : '0.0'}<span class="text-xs text-slate-800 ml-1">%</span></span><span class="text-xs text-slate-800 ml-2">${allActions.filter(function(a){return a.Critical === 'Yes';}).length} of ${allActions.length} actions</span></div></div>
                 <p class="text-[10px] mt-2 leading-tight" style="color:var(--edwardian-sage-dark);">Percentage of all audit actions (open & closed) flagged as critical across the entire network.</p>
             </div>
             <div class="bg-white rounded-xl p-3 shadow-sm" style="border:1px solid var(--edwardian-rule);"><div class="text-[10px] font-bold text-slate-800 uppercase mb-2"> Top 5 Common Audit Failures</div>${allActions.length > 0 ? function(){ var qMap = new Map(); allActions.forEach(function(a){ var q = (a.Question || '').trim(); if(q) qMap.set(q, (qMap.get(q)||0) + 1); }); return Array.from(qMap.entries()).sort(function(a,b){ return b[1] - a[1]; }).slice(0,5).map(function(f, idx){ return '<div class="text-[10px] pb-1 mb-1 last:border-0 last:mb-0 last:pb-0" style="border-bottom:1px solid var(--edwardian-rule);"><span class="font-bold" style="color:var(--edwardian-charcoal);">' + (idx+1) + '.</span> ' + f[0] + ' <span class="font-bold float-right" style="color:var(--edwardian-sage-dark);">(' + f[1] + 'x)</span></div>'; }).join(''); }() : '<p class="text-xs text-slate-500 italic">No action data found.</p>'}
             </div>
           </div>
          <div class="lg:col-span-1 card p-6">
            <h3 class="font-black outfit birds-green mb-4 text-sm uppercase">Sector Compliance Profile</h3>
            <div class="flex flex-col gap-4 mt-2">
              ${['Food','Fire','HandS','Journey','Coffee','Focus'].map(s => {
                const sAvg = Array.from(auditMap.values()).reduce((a,b)=>a+(b[s]||0),0)/(auditMap.size||1);
                return `<div><div class="flex justify-between text-[10px] font-bold mb-1"><span>${s === 'Focus' ? 'Birds Focus' : s === 'HandS' ? 'Health & Safety' : s}</span><span class="${sAvg<90?'text-birds-red':sAvg<95?'text-amber-500':''}">${sAvg.toFixed(1)}%</span></div>
                <div class="progress-bar"><div class="${progColor(sAvg)}" style="width:${sAvg}%"></div></div></div>`
                  }).join('')}
                  <p class="col-span-3 md:col-span-6 text-[9px] text-slate-400 font-bold text-center mt-1">Changes vs ${currentTimeFilter === 'latest' ? 'Wk ' + (effectiveWeek - 1) : currentTimeFilter === 'last4' ? 'Prev 4 Weeks' : 'Prev Period'}</p>
              </div>
          </div>
          <div class="lg:col-span-1 card p-6"><h3 class="font-black outfit birds-green mb-4 text-sm uppercase">Network Area Standings</h3><div class="flex flex-col">${areaRows}</div></div>
        </div>
        <div class="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <p class="col-span-1 lg:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">EHO Inspections</p>
          <div class="card p-6 border-t-4 border-t-amber-500">
            <h3 class="font-black outfit text-amber-800 text-lg uppercase mb-3">5 Most Recent EHO Visits</h3>
            <div class="max-h-48 overflow-y-auto space-y-2">${function(){ var list = []; ehoData.forEach(function(d){ var displayName = d.StoreId; if(typeof originalStoreNames !== 'undefined' && originalStoreNames.get(d.StoreId)){displayName = originalStoreNames.get(d.StoreId) || d.StoreId;} var inspDate = d.inspectionDate || d.ehoVisit || d.nextDue || ''; if(!inspDate) return; var parsed = parseUKDate(inspDate); if(!parsed || isNaN(parsed.getTime())) return; var rating = d.ehoRating || ''; var dd = ('0'+parsed.getDate()).slice(-2) + '/' + ('0'+(parsed.getMonth()+1)).slice(-2) + '/' + parsed.getFullYear(); list.push({store: displayName, rating: rating, date: dd, parsed: parsed}); }); list.sort(function(a,b){ return b.parsed - a.parsed; }); list = list.slice(0,5); if(list.length === 0) return '<p class="text-sm text-slate-500 italic">No EHO visit data available.</p>'; return list.map(function(r){ var stars = ''; var n = parseInt(r.rating); if(n > 0) for(var i=0;i<n;i++) stars += '★'; else stars = r.rating; return '<div class="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-4 py-2"><span class="text-sm font-bold text-slate-800">' + r.store + '</span><span class="text-xs text-slate-500"><span class="text-amber-500">' + stars + '</span> <span class="text-amber-700 font-bold ml-2">' + r.date + '</span></span></div>'; }).join(''); }()}</div>
          </div>
          <div class="card p-6 border-t-4 border-t-red-500">
            <h3 class="font-black outfit text-red-800 text-lg uppercase mb-3">EHO Overdue Stores</h3>
            <div class="max-h-48 overflow-y-auto space-y-2">${function(){ var now = new Date(); var rows = []; ehoData.forEach(function(d){ var displayName = d.StoreId; if(typeof originalStoreNames !== 'undefined' && originalStoreNames.get(d.StoreId)){displayName = originalStoreNames.get(d.StoreId) || d.StoreId;} var dueDate = null; if(d.nextDue){ dueDate = parseUKDate(d.nextDue); } if(!dueDate && d.ehoVisit){ var dd = parseUKDate(d.ehoVisit); if(dd && !isNaN(dd.getTime())){ var nd = new Date(dd); nd.setFullYear(nd.getFullYear() + 1); dueDate = nd; } } if(!dueDate && d.inspectionDate){ var dd = parseUKDate(d.inspectionDate); if(dd && !isNaN(dd.getTime())){ var nd = new Date(dd); nd.setFullYear(nd.getFullYear() + 1); dueDate = nd; } } if(dueDate && !isNaN(dueDate.getTime()) && dueDate < now){ var rating = d.ehoRating || ''; var dd = ('0'+dueDate.getDate()).slice(-2) + '/' + ('0'+(dueDate.getMonth()+1)).slice(-2) + '/' + dueDate.getFullYear(); rows.push({store: displayName, rating: rating, due: dd, days: Math.round((dueDate - now) / 86400000)}); } }); rows.sort(function(a,b){ return a.days - b.days; }); if(rows.length === 0) return '<p class="text-sm text-slate-500 italic">No stores currently overdue for EHO inspection.</p>'; rows = rows.slice(0, 5); return rows.map(function(r){ var stars = ''; var n = parseInt(r.rating); if(n > 0) for(var i=0;i<n;i++) stars += '\u2605'; else stars = r.rating; return '<div class="flex items-center justify-between rounded-lg px-4 py-2" style="border-left:3px solid #D94F4F;"><span class="text-sm font-bold text-slate-800">' + r.store + '</span><span class="text-xs text-slate-500"><span class="text-amber-500">' + stars + '</span> <span style="color:#D94F4F;font-weight:700;margin-left:8px;">Due: ' + r.due + '</span></span></div>'; }).join(''); }()}
          </div>
        </div>
</div>`;
  }

  if(currentView === 'areas'){
    const prevWeekLabel = currentTimeFilter === 'latest' ? `Wk ${effectiveWeek - 1}` : currentTimeFilter === 'last4' ? 'Prev 4 Weeks' : 'Prev YTD';
    const byAM = validAMs.map(am => {
      const stores = curr.filter(k => safeGetAM(k.Branch) === am); if(!stores.length) return ''; const pStores = prev.filter(k => safeGetAM(k.Branch) === am);
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
        <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3">Category Variance</h4>
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
                    trendArrow = 'Up';
                }
                else if (diff < -(isPct ? 0.001 : 1)) { 
                    trendColor = 'text-rose-700'; 
                    trendBg = 'bg-rose-50';
                    trendArrow = 'Down';
                }
            }
        }
        
        extraKpisHtml += `
            <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between w-full">
                <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">${kpi.label}</span>
                <div class="flex items-center justify-between mt-3">
                    <span class="text-xl font-black text-slate-800 leading-none">${displayVal}</span>
                    <span class="${trendBg} ${trendColor} text-[11px] font-black px-2 py-1 rounded-md flex items-center gap-1">${trendArrow === 'Up' ? ICON_TREND_UP : trendArrow === 'Down' ? ICON_TREND_DOWN : ''} ${formattedDiff} from ${prevWeekLabel}</span>
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
      const isRedAlert = focus.severity > 0; const alertBoxCol = isRedAlert ? 'border-l-3 border-l-red-400' : 'border-l-3 border-l-slate-300'; const alertTextCol = isRedAlert ? 'text-red-600' : 'text-slate-600';
      let badges = '';
      try{ if(globalMostImprovedWin && globalMostImprovedWin.Branch){ const miId = canonicalStoreId(globalMostImprovedWin.Branch); const miAM = storeMap.get(miId); if(miAM === am) badges += `<span class="bg-purple-50 text-purple-700 border border-purple-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> MOST IMPROVED: ${globalMostImprovedWin.Branch}</span>`; } }catch(e){}
      if (am === overallWinner) badges += `<span class="bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-black px-2 py-0.5 rounded shadow-sm mr-1"> OVERALL CHAMPION</span>`;
      if (am === bestSalesAM) badges += `<span class=" text-slate-800 border border-emerald-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> 1st Sales</span>`;
      if (am === bestProductAM) badges += `<span class=" text-slate-800 border border-emerald-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> 1st Product</span>`;
      if (am === bestWasteAM) badges += `<span class="text-slate-800 border text-[9px] font-bold px-1.5 py-0.5 rounded mr-1" style="background:rgba(193,127,78,0.08);border-color:rgba(193,127,78,0.25);"> 1st Waste</span>`;
      if (am === bestLabourAM) badges += `<span class="text-slate-800 border text-[9px] font-bold px-1.5 py-0.5 rounded mr-1" style="background:rgba(164,119,114,0.08);border-color:rgba(164,119,114,0.25);"> 1st Labour</span>`;
      if (am === bestEnergyAM) badges += `<span class="bg-slate-50 text-slate-700 border border-slate-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> 1st Energy</span>`;
      if (am === bestATVAM) badges += `<span class=" text-slate-800 border border-emerald-200 text-[9px] font-bold px-1.5 py-0.5 rounded mr-1"> 1st ATV</span>`;
      const cardId = `area-card-${am.replace(/\s+/g, '-')}`;

      return `
        <div id="${cardId}" data-am="${am}" class="card area-card-export p-8 border-t-4 ${am === overallWinner ? 'border-t-amber-400' : 'border-t-birds-green'} relative bg-white">
          <div onclick="exportCard('${cardId}', '${am}')" class="export-btn absolute top-6 right-8 bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center shadow-sm"> Export DASH</div>
          <div class="mb-6 pb-4 border-b"><h3 class="font-black outfit text-4xl text-slate-800 leading-none mb-3">${am}</h3><div class="flex flex-wrap gap-2">${badges}</div></div>
          <div class="landscape-container">
            <div class="landscape-left">
              <div class="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
                 ${[
                   { label: 'Sales Growth', val: avgK('Sales'), prev: pAvgK('Sales'), inv: false, fmt: 'pct' },
                   { label: 'Product Target', val: avgK('Product'), prev: pAvgK('Product'), inv: false, fmt: 'pct' },
                   { label: 'Wastage', val: avgK('Waste'), prev: pAvgK('Waste'), inv: true, fmt: 'pct' },
                   { label: 'Labour %', val: avgK('Labour'), prev: pAvgK('Labour'), inv: true, fmt: 'pct' },
                   { label: 'Avg Trans. Val', val: avgK('ATV'), prev: pAvgK('ATV'), inv: false, fmt: 'cur' },
                   { label: 'Energy (kWh)', val: avgK('Energy'), prev: pAvgK('Energy'), inv: true, fmt: 'num' }
                 ].map(kpi => {
                   const hasPrev = kpi.prev !== undefined && kpi.prev !== null;
                   const diff = hasPrev ? kpi.val - kpi.prev : 0;
                   const absDiff = Math.abs(diff);
                   let dispVal, diffStr;
                   if (kpi.fmt === 'cur') { dispVal = '\u00a3' + kpi.val.toFixed(2); diffStr = '\u00a3' + absDiff.toFixed(2); }
                   else if (kpi.fmt === 'num') { dispVal = kpi.val.toFixed(0); diffStr = absDiff.toFixed(0); }
                   else { dispVal = (kpi.val * 100).toFixed(1) + '%'; diffStr = (absDiff * 100).toFixed(1) + '%'; }
                    const isGood = kpi.inv ? diff < 0 : diff > 0;
                    const isBad = kpi.inv ? diff > 0 : diff < 0;
                    const direction = diff > 0 ? 'Up' : diff < 0 ? 'Down' : '';
                     const changeText = diff === 0 ? `No change from ${prevWeekLabel}` : diffStr + ' ' + trendIcon(diff) + direction + ` from ${prevWeekLabel}`;
                    const borderColor = diff === 0 ? '#ccc' : isGood ? '#8BA88A' : '#D94F4F';
                    const valCol = isBad ? 'color:#D94F4F' : isGood ? 'color:#6E8E6D' : 'color:#3D3D3D';
                    const changeCol = diff === 0 ? 'color:#7A7A7A' : isGood ? 'color:#6E8E6D' : 'color:#D94F4F';
                    return `<div class="rounded-lg p-3 text-center bracket-rag" style="--bracket-color:${borderColor};">
                      <p style="font-size:13px;font-weight:800;color:#20231F;text-transform:uppercase;letter-spacing:0.03em;margin:0 0 6px 0;font-family:var(--birds-font-display);">${kpi.label}</p>
                      <div style="font-size:26px;font-weight:900;${valCol};margin:0 0 4px 0;font-family:var(--birds-font-display);line-height:1.05;font-variant-numeric:tabular-nums;">${dispVal}</div>
                      <p style="font-size:14px;font-weight:800;${changeCol};margin:0;">${hasPrev ? changeText : '\u2014'}</p>
                    </div>`;
                 }).join('')}
              </div>
              <div class="mb-6 p-5 rounded-xl border ${alertBoxCol}"><div class="text-[10px] font-black ${alertTextCol} uppercase mb-2 tracking-wide"> Performance Focus Area</div><div class="text-sm text-slate-700 leading-snug font-medium"><b>${focus.name}</b> indicates the highest variance against the network average (<span class="${alertTextCol} font-bold">${focus.fmt(focus.diff)}</span>). Prioritize this sector for coaching interventions.</div></div>
              
<h4 class="text-[11px] font-black muted uppercase mb-3">KPI Performance Table</h4>
<div class="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
  <table class="w-full text-sm">
    <thead class="bg-slate-50 border-b">
      <tr>
        <th class="p-2 text-left font-bold text-slate-500">KPI</th>
        <th class="p-2 text-left font-bold text-amber-600">Top Performer</th>
        <th class="p-2 text-left font-bold text-birds-green">Most Improved</th>
      </tr>
    </thead>
    <tbody>
      ${['Sales','Product','Waste','Labour','ATV','Energy'].map(m=>{
        const perf = (window.__areaWinsCache||[]).find(w=>w.Week==effectiveWeek && w.Metric===m && storeMap.get(canonicalStoreId(w.Branch))===am);
        const imp = (window.__areaWinsCache||[]).find(w=>w.Week==effectiveWeek && w.Metric===m+' (Improvement)' && storeMap.get(canonicalStoreId(w.Branch))===am);
        return `
        <tr class="border-b">
          <td class="p-2 font-bold text-slate-700">${m}</td>
          <td class="p-2 text-amber-600 font-semibold">${perf?perf.Branch:'-'}</td>
          <td class="p-2 text-birds-green font-semibold">${imp?imp.Branch:'-'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>

            </div>
            <div class="landscape-right">
              <h4 class="text-[11px] font-black muted uppercase mb-4 flex items-center gap-2"><div class="w-1 h-3  rounded-full"></div> Operational Sectors (Area Avg: ${aAvg.toFixed(1)}%)</h4>
              <div class="grid grid-cols-2 gap-x-6 gap-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>Food Safety</span><span class="${sFood<90?'text-birds-red':sFood<95?'text-amber-500':''}">${sFood.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sFood)}" style="width:${sFood}%"></div></div></div>
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>Fire Safety</span><span class="${sFire<90?'text-birds-red':sFire<95?'text-amber-500':''}">${sFire.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sFire)}" style="width:${sFire}%"></div></div></div>
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>H&S / Legal</span><span class="${sHandS<90?'text-birds-red':sHandS<95?'text-amber-500':''}">${sHandS.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sHandS)}" style="width:${sHandS}%"></div></div></div>
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>Cust. Journey</span><span class="${sJourney<90?'text-birds-red':sJourney<95?'text-amber-500':''}">${sJourney.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sJourney)}" style="width:${sJourney}%"></div></div></div>
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>Coffee Standard</span><span class="${sCoffee<90?'text-birds-red':sCoffee<95?'text-amber-500':''}">${sCoffee.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sCoffee)}" style="width:${sCoffee}%"></div></div></div>
                <div><div class="flex justify-between text-xs font-bold mb-1.5"><span>Birds Focus</span><span class="${sFocus<90?'text-birds-red':sFocus<95?'text-amber-500':''}">${sFocus.toFixed(1)}%</span></div><div class="progress-bar h-2"><div class="${progColor(sFocus)}" style="width:${sFocus}%"></div></div></div>
              </div>
              <div class="mt-8 p-4  rounded-xl border border-emerald-100 flex items-start gap-3 relative group">
                <div class="h-8 w-8  rounded-lg flex items-center justify-center font-bold text-birds-green shrink-0"></div>
                <div class="flex-1"><h5 contenteditable="true" class="text-xs font-black text-birds-dark mb-1 outline-none border-b border-dashed border-birds-border focus:border-birds-green focus:bg-white pr-6 transition-all">Area Manager Note</h5><p contenteditable="true" class="text-[11px] text-birds-dark leading-tight outline-none focus:bg-white focus:ring-1 focus:ring-birds-green p-1 rounded cursor-text italic transition-all">Current period performance shows <b>${am}</b> maintaining network-leading standards in operational compliance while driving top-tier commercial growth.</p></div>
                <button onclick="this.parentElement.remove()" class="export-btn absolute -top-2 -right-2 bg-white border border-red-100 text-red-400 hover:text-red-600 rounded-full w-6 h-6 flex items-center justify-center text-[12px] shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"></button>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
    
    document.getElementById('mainView').innerHTML = `
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-2xl font-black outfit birds-green tracking-tight">Area Executive Reports (Landscape Optimized)</h2>
        <button id="export-all-btn" onclick="exportAllCardsToZip()" class="btn" style="background: #555B6E; color: white; padding: 10px 20px; border-radius: 6px; font-weight: 800; font-size: 13px;">Export All Landscape (ZIP)</button>
      </div>
      <div class="grid grid-cols-1 gap-10 pb-20">${byAM}</div>`;
  }

  if(currentView === 'winners'){
    // Podium uses the most recent week's data
    const latestWeekKpis = rawKpis.filter(k => k.Week == latestWkGlobal && (k.Year || currentAwardsYear) == currentAwardsYear);
    const ytdCurr = aggregateData(latestWeekKpis);
    const ytdPrev = [];
    const ytdByAM = {}; ytdCurr.forEach(c=>{ if(!ytdByAM[c.AM]) ytdByAM[c.AM]={total:0,count:0}; ytdByAM[c.AM].total += c.Sales; ytdByAM[c.AM].count++; });
    // Build YTD audit map from all audits (not time-filtered)
    const ytdAggAudits = new Map();
    allAudits.forEach(a => { const id = canonicalStoreId(a.Store); if(!ytdAggAudits.has(id)) ytdAggAudits.set(id, {Store: a.Store, count:0, Score:0}); const obj = ytdAggAudits.get(id); obj.count++; obj.Score += a.Score||0; });
    const ytdAuditMap = new Map(); ytdAggAudits.forEach((v, k) => ytdAuditMap.set(k, { Score: v.Score/v.count }));
    const ytdAmStats = validAMs.map(am => {
        const stores = ytdCurr.filter(k => safeGetAM(k.Branch) === am); if(!stores.length) return null;
        const avg = (f) => stores.reduce((a,b)=>a+(b[f]||0),0)/stores.length;
        let validAudits = 0;
        const totalAuditScore = stores.reduce((a,b) => { const s = ytdAuditMap.get(b.Branch.trim().toLowerCase())?.Score; if(s) { validAudits++; return a + s; } return a; }, 0);
        const aAvg = validAudits > 0 ? totalAuditScore / validAudits : 0;
        const compScore = calculateStoreScore({Sales: avg('Sales'),Product: avg('Product'),Waste: avg('Waste'),Labour: avg('Labour'),Energy: avg('Energy')});
        return { am, score: compScore, sAvg: avg('Sales'), pAvg: avg('Product'), wAvg: avg('Waste'), lAvg: avg('Labour'), aAvg: aAvg, eAvg: avg('Energy'), atvAvg: avg('ATV') };
    }).filter(x => x).sort((a,b)=>b.score-a.score);
    const rankMetric = (metric, asc) => [...ytdAmStats].sort((a,b) => asc ? a[metric] - b[metric] : b[metric] - a[metric]).slice(0,3);
    const buildSubPodium = (title, metric, asc, fmt, displayMode) => {
      const ranked = rankMetric(metric, asc);
      const formatVal = (val) => { if (displayMode === 'currency') return '£' + (val || 0).toFixed(2); if (displayMode === 'whole') return (val || 0).toFixed(0); return ((val || 0) * 100).toFixed(fmt) + '%'; };
      return `<div class="card p-4 text-center"><h4 class="text-xs font-black muted uppercase mb-3">${title}</h4><div class="flex justify-between items-end gap-2"><div class="flex-1 text-[10px]"><b>2nd</b><br>${ranked[1]?.am || '—'}<br>${formatVal(ranked[1]?.[metric])}</div><div class="flex-1 text-[11px] pb-1 border-b-2 border-birds-green"> <b>1st</b><br>${ranked[0]?.am || '—'}<br>${formatVal(ranked[0]?.[metric])}</div><div class="flex-1 text-[10px]"><b>3rd</b><br>${ranked[2]?.am || '—'}<br>${formatVal(ranked[2]?.[metric])}</div></div></div>`;
    };
    // Top Performing Store uses latest week data
    const latestByStore = new Map(); ytdCurr.forEach(c=>{ latestByStore.set(c.Branch, {Branch: c.Branch, Sales: c.Sales}); });
    const improvedStore = [...latestByStore.values()].sort((a,b)=>b.Sales-a.Sales)[0];
    const improvedStoreHtml = `
    <div class="card p-4 text-center mb-6 border-t-4 border-t-amber-400">
      <h4 class="text-xs font-black muted uppercase mb-1">Top Performing Store</h4>
      <div class="text-base font-black birds-green"> ${improvedStore?.name || improvedStore?.Branch || '-'}</div>
      <div class="text-[9px] text-slate-400 font-bold uppercase mt-1">Highest Sales This Week</div>
    </div>`;
    document.getElementById('mainView').innerHTML = `
      <div id="winners-card" class="pb-2 relative">
        <div onclick="exportCard('winners-card', 'Winners')" class="export-btn absolute top-4 right-4 bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"> Export Dash</div>
        ${improvedStoreHtml}
        <div class="card p-8 mb-6 text-center relative"><h2 class="font-black outfit birds-green text-2xl mb-8 mt-2">COMBINED AREA PODIUM</h2><div class="flex items-end gap-4 justify-center"><div class="card p-4 h-32 flex-1 border border-slate-200"><b>2nd</b><br>${ytdAmStats[1]?.am || '—'}</div><div class="card p-6 h-48 flex-1 winner-1st shadow-lg"> <b>1st Overall</b><br><b class="text-xl">${ytdAmStats[0]?.am || '—'}</b></div><div class="card p-4 h-24 flex-1 border border-slate-200"><b>3rd</b><br>${ytdAmStats[2]?.am || '—'}</div></div></div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">${buildSubPodium('Sales Growth', 'sAvg', false, 1, 'percent')}${buildSubPodium('Product Target', 'pAvg', false, 1, 'percent')}${buildSubPodium('Waste Control', 'wAvg', true, 1, 'percent')}${buildSubPodium('Labour Efficiency', 'lAvg', true, 1, 'percent')}${buildSubPodium('ATV Standings', 'atvAvg', false, 2, 'currency')}${buildSubPodium('Energy Usage', 'eAvg', true, 0, 'whole')}</div>
      </div>`;
  }

  if(currentView === 'leaderboard') {
    const baseWeek = (typeof effectiveWeek !== 'undefined') ? effectiveWeek : latestWkGlobal;
    const baseYear = effectiveYear || new Date().getFullYear();
    let currLB = []; let prevLB = [];
    if(currentTimeFilter === 'latest') {
      currLB = aggregateData(rawKpis.filter(k => k.Week == baseWeek && (k.Year || baseYear) == baseYear));
      const p = getPreviousAvailableWeek(baseWeek, baseYear, rawKpis);
      prevLB = aggregateData(rawKpis.filter(k => k.Week == p.week && (k.Year || p.year) == p.year));
    }
    else if(currentTimeFilter === 'last4') { currLB = aggregateData(rawKpis.filter(k => k.Week <= baseWeek && k.Week > baseWeek - 4)); prevLB = aggregateData(rawKpis.filter(k => k.Week <= baseWeek - 4 && k.Week > baseWeek - 8)); }
    else { currLB = aggregateData(rawKpis); prevLB = []; }

    const getCompScore = (k) => ((k.Sales||0)*100) + ((k.Product||0)*100) - ((k.Waste||0)*100) - ((k.Labour||0)*100) - ((k.Energy||0)/100);

    const currSorted = [...currLB].sort((a,b)=> getCompScore(b) - getCompScore(a)); 
    const prevSorted = [...prevLB].sort((a,b)=> getCompScore(b) - getCompScore(a)); 
    const prevRank = new Map(prevSorted.map((r,i)=>[r.Branch, i+1]));

    const leaderData = currSorted.map((r,i)=>{
      const nowRank = i+1; const wasRank = prevRank.get(r.Branch);
      let deltaNum = 0; let deltaHtml = '<span class="text-slate-300 font-black">\u2014</span>';
      if(wasRank && wasRank !== nowRank) { deltaNum = wasRank - nowRank; if(deltaNum > 0) deltaHtml = `<span class="text-birds-green font-black">${ICON_TREND_UP}Up ${deltaNum}</span>`; else deltaHtml = `<span class="text-birds-red font-black">${ICON_TREND_DOWN}Down ${Math.abs(deltaNum)}</span>`; }
      return { rank: nowRank, wasRank: wasRank || null, deltaNum, deltaHtml, branch: r.Branch, am: r.AM, score: getCompScore(r), sales: (r.Sales||0)*100, labour: (r.Labour||0)*100, energy: r.Energy||0 };
    });

    window._leaderData = leaderData;

    function leaderRowHtml(d) {
      const salesCol = d.sales >= 95 ? 'text-birds-green' : d.sales >= 90 ? 'text-amber-600' : 'text-birds-red';
      const labourCol = d.labour <= 12 ? 'text-birds-green' : d.labour <= 15 ? 'text-amber-600' : 'text-birds-red';
      const energyCol = d.energy <= 1500 ? 'text-birds-green' : d.energy <= 2000 ? 'text-amber-600' : 'text-birds-red';
      return `<tr class="border-b border-slate-100 text-[11px] hover:bg-slate-50">
        <td class="p-3 font-black">${d.rank}</td>
        <td class="p-3">${d.deltaHtml}</td>
        <td class="p-3 font-bold">${escapeHtml(d.branch)}</td>
        <td class="p-3 text-slate-500">${escapeHtml(d.am)}</td>
        <td class="p-3 font-black" style="color:var(--edwardian-sage-dark);">${d.score.toFixed(1)}</td>
        <td class="p-3 font-black ${salesCol}">${d.sales.toFixed(1)}%</td>
        <td class="p-3 font-black ${labourCol}">${d.labour.toFixed(1)}%</td>
        <td class="p-3 font-black ${energyCol}">${d.energy.toFixed(0)} kWh</td>
      </tr>`;
    }

    window._leaderFilter = function() {
      const sortBy = document.getElementById('leaderSortBy')?.value || 'rank';
      const dir = document.getElementById('leaderSortDir')?.value || 'asc';
      let data = [...(window._leaderData || [])];
      if(sortBy === 'rank') data.sort((a,b) => dir==='asc' ? a.rank - b.rank : b.rank - a.rank);
      else if(sortBy === 'movement') data.sort((a,b) => dir==='asc' ? a.deltaNum - b.deltaNum : b.deltaNum - a.deltaNum);
      else if(sortBy === 'score') data.sort((a,b) => dir==='asc' ? a.score - b.score : b.score - a.score);
      else if(sortBy === 'sales') data.sort((a,b) => dir==='asc' ? a.sales - b.sales : b.sales - a.sales);
      else if(sortBy === 'labour') data.sort((a,b) => dir==='asc' ? a.labour - b.labour : b.labour - a.labour);
      else if(sortBy === 'energy') data.sort((a,b) => dir==='asc' ? a.energy - b.energy : b.energy - a.energy);
      else if(sortBy === 'name') data.sort((a,b) => dir==='asc' ? a.branch.localeCompare(b.branch) : b.branch.localeCompare(a.branch));
      const tbody = document.getElementById('leaderTbody');
      if(tbody) tbody.innerHTML = data.map(leaderRowHtml).join('');
      window._leaderFiltered = data;
    };

    window._leaderFiltered = leaderData;

    const timeLabel = currentTimeFilter === 'latest' ? 'Week ' + baseWeek : currentTimeFilter === 'last4' ? 'Last 4 Weeks' : 'YTD';

    document.getElementById('mainView').innerHTML = `
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <div class="filter-group">
          <label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Sort By</label>
          <select id="leaderSortBy" onchange="window._leaderFilter()" class="border border-slate-300 p-2 rounded-lg text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none">
            <option value="rank">Rank (Default)</option>
            <option value="movement">Rank Movement</option>
            <option value="score">Composite Score</option>
            <option value="sales">Sales %</option>
            <option value="labour">Labour %</option>
            <option value="energy">Energy kWh</option>
            <option value="name">Store Name</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Direction</label>
          <select id="leaderSortDir" onchange="window._leaderFilter()" class="border border-slate-300 p-2 rounded-lg text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none">
            <option value="desc">Highest First</option>
            <option value="asc">Lowest First</option>
          </select>
        </div>
        <button onclick="leaderboardPDFExport()" class="btn" style="background: var(--edwardian-rose); color: white; padding: 8px 16px; border-radius: 6px; font-weight: 800; font-size: 13px;">PDF Export</button>
        <span class="text-xs font-bold text-slate-400 ml-auto">${timeLabel} \u2014 ${leaderData.length} stores</span>
      </div>
      <div class="card overflow-x-auto relative max-h-[600px] overflow-y-auto shadow-inner border border-slate-200">
        <table class="w-full text-left relative">
          <thead class="sticky top-0 bg-slate-50 z-10 shadow-sm border-b border-slate-200">
            <tr>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Rank</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">\u0394</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Store</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Area</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Comp Score</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Sales</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Labour</th>
              <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Energy</th>
            </tr>
          </thead>
          <tbody id="leaderTbody">${leaderData.map(leaderRowHtml).join('')}</tbody>
        </table>
      </div>`;
  }
} catch(e) { console.error('[Dash] FATAL renderDashboard error:', e); }
}

window.leaderboardPDFExport = function() {
    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') { alert('PDF library not loaded'); return; }
    var { jsPDF } = window.jspdf;
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    var SAGE = [135, 157, 130];
    var CHARCOAL = [57, 68, 60];
    var LIGHT_GREY = [126, 137, 128];
    var PAPER = [251, 250, 246];
    var RULE = [213, 221, 208];
    var SAGE_DARK = [96, 117, 95];
    var ROSE = [164, 119, 114];
    var TERRACOTTA = [193, 127, 78];
    var PW = 297, PH = 210, MG = 14;

    var data = window._leaderFiltered || window._leaderData || [];
    if (data.length === 0) { alert('No leaderboard data to export.'); return; }

    var sortBy = document.getElementById('leaderSortBy')?.value || 'rank';
    var dir = document.getElementById('leaderSortDir')?.value || 'asc';
    var sortLabel = { rank: 'Rank', movement: 'Rank Movement', score: 'Composite Score', sales: 'Sales %', labour: 'Labour %', energy: 'Energy kWh', name: 'Store Name' };
    var timeFilter = (typeof currentTimeFilter !== 'undefined') ? currentTimeFilter : 'ytd';
    var timeLabel = timeFilter === 'latest' ? 'Latest Week' : timeFilter === 'last4' ? 'Last 4 Weeks' : 'Year to Date';

    // Header
    doc.setFillColor(...SAGE);
    doc.rect(0, 0, PW, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...CHARCOAL);
    doc.text('Leaderboard Summary', MG, 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...LIGHT_GREY);
    doc.text('Generated: ' + new Date().toLocaleDateString('en-GB') + '  |  ' + timeLabel + '  |  Sorted by: ' + (sortLabel[sortBy] || sortBy) + ' (' + (dir === 'asc' ? 'Lowest First' : 'Highest First') + ')', MG, 21);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(MG, 24, PW - MG, 24);

    // KPI boxes
    var avgScore = data.reduce((s, d) => s + d.score, 0) / data.length;
    var topMovers = data.filter(d => Math.abs(d.deltaNum) > 0).sort((a, b) => Math.abs(b.deltaNum) - Math.abs(a.deltaNum)).slice(0, 3);
    var avgSales = data.reduce((s, d) => s + d.sales, 0) / data.length;

    var bw = 42, bh = 14;
    var kpis = [
        { label: 'STORES', value: String(data.length), bg: PAPER, fg: CHARCOAL },
        { label: 'AVG SCORE', value: avgScore.toFixed(1), bg: PAPER, fg: SAGE_DARK },
        { label: 'AVG SALES', value: avgSales.toFixed(1) + '%', bg: PAPER, fg: SAGE },
        { label: 'TOP MOVER', value: topMovers.length ? topMovers[0].branch.substring(0, 12) : 'N/A', bg: PAPER, fg: TERRACOTTA }
    ];
    var bx = MG;
    kpis.forEach(function(k) {
        doc.setFillColor(...k.bg);
        doc.roundedRect(bx, 28, bw, bh, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6);
        doc.setTextColor(...k.fg);
        doc.text(k.label, bx + 3, 33);
        doc.setFontSize(13);
        doc.text(k.value, bx + 3, 39);
        bx += bw + 3;
    });

    // Table
    var tableY = 46;
    var tableBody = data.map(function(d, idx) {
        var deltaStr = d.deltaNum > 0 ? 'Up +' + d.deltaNum : d.deltaNum < 0 ? 'Down ' + d.deltaNum : '\u2014';
        return [
            String(d.rank),
            deltaStr,
            d.branch,
            d.am,
            d.score.toFixed(1),
            d.sales.toFixed(1) + '%',
            d.labour.toFixed(1) + '%',
            d.energy.toFixed(0)
        ];
    });

    doc.autoTable({
        startY: tableY,
        head: [['Rank', '\u0394', 'Store', 'Area', 'Comp Score', 'Sales', 'Labour', 'Energy']],
        body: tableBody,
        styles: { fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: SAGE, fontSize: 8, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: PAPER },
        columnStyles: {
            0: { cellWidth: 14, fontStyle: 'bold', halign: 'center' },
            1: { cellWidth: 18, halign: 'center' },
            2: { cellWidth: 48, fontStyle: 'bold' },
            3: { cellWidth: 35 },
            4: { cellWidth: 24, fontStyle: 'bold', halign: 'center' },
            5: { cellWidth: 22, halign: 'center' },
            6: { cellWidth: 22, halign: 'center' },
            7: { cellWidth: 22, halign: 'center' }
        },
        margin: { left: MG, right: MG },
        didParseCell: function(hookData) {
            if (hookData.section === 'body') {
                // Color code rank delta
                if (hookData.column.index === 1) {
                    var raw = String(hookData.cell.raw);
                    if (raw.includes('Up')) { hookData.cell.styles.textColor = SAGE_DARK; hookData.cell.styles.fontStyle = 'bold'; }
                    else if (raw.includes('Down')) { hookData.cell.styles.textColor = ROSE; hookData.cell.styles.fontStyle = 'bold'; }
                    else { hookData.cell.styles.textColor = LIGHT_GREY; }
                }
                // Color code comp score
                if (hookData.column.index === 4) {
                    var val = parseFloat(hookData.cell.raw);
                    if (!isNaN(val)) {
                        if (val > 100) hookData.cell.styles.textColor = SAGE_DARK;
                        else if (val > 50) hookData.cell.styles.textColor = [20, 116, 148];
                        else if (val > 0) hookData.cell.styles.textColor = TERRACOTTA;
                        else hookData.cell.styles.textColor = ROSE;
                    }
                }
                // Color code sales
                if (hookData.column.index === 5) {
                    var val = parseFloat(hookData.cell.raw);
                    if (!isNaN(val)) {
                        if (val > 100) hookData.cell.styles.textColor = SAGE_DARK;
                        else if (val > 98) hookData.cell.styles.textColor = [20, 116, 148];
                        else hookData.cell.styles.textColor = ROSE;
                    }
                }
            }
        },
        didDrawPage: function(hookData) {
            doc.setDrawColor(...RULE);
            doc.setLineWidth(0.3);
            doc.line(MG, PH - 10, PW - MG, PH - 10);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...LIGHT_GREY);
            doc.text('Birds Bakery \u2014 Leaderboard', MG, PH - 6);
            doc.text('Page ' + hookData.pageNumber, PW - MG, PH - 6, { align: 'right' });
        }
    });

    // Top Movers Summary
    var summaryY = doc.lastAutoTable.finalY + 12;
    if (summaryY + 40 < PH - 20) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...CHARCOAL);
        doc.text('Top Movers', MG, summaryY);
        summaryY += 5;
        var movers = data.filter(d => Math.abs(d.deltaNum) > 0).sort((a, b) => Math.abs(b.deltaNum) - Math.abs(a.deltaNum)).slice(0, 5);
        if (movers.length > 0) {
            var moverBody = movers.map(function(d) {
                var dir = d.deltaNum > 0 ? 'Up' : 'Down';
                var dirColor = d.deltaNum > 0 ? 'green' : 'red';
                return [d.branch, dir + ' ' + Math.abs(d.deltaNum) + ' places', String(d.rank) + ' (was ' + (d.wasRank || '?') + ')', d.score.toFixed(1)];
            });
            doc.autoTable({
                startY: summaryY,
                head: [['Store', 'Movement', 'Now (Was)', 'Score']],
                body: moverBody,
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: SAGE, fontSize: 7, fontStyle: 'bold' },
                columnStyles: {
                    0: { cellWidth: 50, fontStyle: 'bold' },
                    1: { cellWidth: 40 },
                    2: { cellWidth: 35 },
                    3: { cellWidth: 25 }
                },
                margin: { left: MG, right: MG },
                didParseCell: function(hookData) {
                    if (hookData.section === 'body' && hookData.column.index === 1) {
                        var raw = String(hookData.cell.raw);
                        if (raw.includes('Up')) hookData.cell.styles.textColor = SAGE_DARK;
                        else if (raw.includes('Down')) hookData.cell.styles.textColor = ROSE;
                    }
                }
            });
        } else {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text('No rank movement data available for this period.', MG, summaryY + 5);
        }
    }

    var stamp = new Date().toISOString().slice(0, 10);
    doc.save('Leaderboard_' + stamp + '.pdf');
};

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
