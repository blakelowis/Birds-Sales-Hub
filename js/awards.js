async function rebuildAwardsFromData(){
  try {
    const year = currentAwardsYear || new Date().getFullYear();
    const allKpis = await idbGetAll('kpi');
    if(!allKpis || allKpis.length === 0) { alert("No data found. Please click 'Refresh Data' in the top header first."); return; }
    const yearKpis = allKpis.filter(k => (k.Year || year) === year);
    const yearWeeks = [...new Set(yearKpis.map(k=>k.Week))].sort((a,b)=>a-b);
    await idbClear('area_winners_log');
    await idbClear('area_metric_winners_log');
    await idbClear('store_winners_log');
    await recordPersistentWinnersForWeeks(year, yearWeeks);
    renderHallOfFame();
    alert("Awards Rebuilt Successfully using Improvement Engine!");
  } catch (err) {
    console.error("Rebuild Crash:", err);
    renderDashboard(); 
  }
}

async function renderHallOfFame(){
  try {
      const kpis = await idbGetAll('kpi');
      if(!kpis.length){
        document.getElementById('mainView').innerHTML = `
          <div class="p-20 text-center flex flex-col items-center justify-center">
            <h2 class="text-2xl font-black outfit text-slate-800 mb-2">v32 Anomaly Protected Logic Active!</h2>
            <p class="text-slate-500 mb-6">Hit the " Refresh Data" button at the top to sync your master folder and calculate awards safely.</p>
          </div>`;
        return;
      }

      const years = [...new Set(kpis.map(k => k.Year || currentAwardsYear))].sort((a,b)=>b-a);
      if(!years.length) years.push(new Date().getFullYear());
      if(!years.includes(currentAwardsYear)) currentAwardsYear = years[0];

      const yearKpis = kpis.filter(k => (k.Year || currentAwardsYear) === currentAwardsYear);
      const latestWeek = yearKpis.length ? Math.max(...yearKpis.map(k=>k.Week)) : 1;
      const {from, to} = _periodWeeks(currentAwardsPeriod, latestWeek);

      const storeLog = await idbGetAll('store_winners_log');
      const areaLog = await idbGetAll('area_winners_log');

      let periodStores = storeLog.filter(l => l.Year == currentAwardsYear && l.Week >= from && l.Week <= to);
      let periodAreas = areaLog.filter(l => l.Year == currentAwardsYear && l.Week >= from && l.Week <= to);

      if(periodStores.length === 0){
        periodStores = []; periodAreas = [];
      }

      const areaWins = periodAreas.reduce((acc, l)=>{ acc[l.Winner] = (acc[l.Winner]||0)+1; return acc; }, {});
      const sortedAreas = Object.entries(areaWins).sort((a,b)=>b[1]-a[1]);

      const periodLabel = currentAwardsPeriod==='ytd' ? `Year to Date (Wk 1–${latestWeek})` : currentAwardsPeriod.toUpperCase() + ` (Wk ${from}–${to})`;
      const weeksCount = [...new Set(periodStores.map(x=>x.Week))].length;

      const storeStats = [];
      storeMap.forEach((am, branchId) => {
           let origName = originalStoreNames.get(branchId);

if (!origName) {
  origName = branchId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/bakeryshop/i, 'Bakery Shop')
    .replace(/albertstreet/i, 'Albert Street')
    .replace(/instreet/i, 'In Street')
    .replace(/tealpark/i, 'Teal Park')
    .replace(/meltonroad/i, 'Melton Road');
}
           let w = 0; let breakdown = {};
           periodStores.forEach(l => {
               const id = canonicalStoreId(l.Branch);
               if(id === branchId){
                   w++; breakdown[l.Metric] = (breakdown[l.Metric] || 0) + 1;
               }
           });
           storeStats.push({ branchId, name: origName, am, wins: w, breakdown });
      });

      storeStats.sort((a,b) => b.wins - a.wins || a.name.localeCompare(b.name));
      const topStore = storeStats.length ? [storeStats[0].name, storeStats[0].wins] : null;
      const topArea = sortedAreas.length ? sortedAreas[0] : null;

      const tableRows = storeStats.map((s, i) => {
          const summary = Object.entries(s.breakdown).sort((a,b)=>b[1]-a[1]).map(([m,c])=>`<span class="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] px-2 py-0.5 rounded-md font-black">${c}x ${m}</span>`).join(' ');
          const medalBg = i === 0 ? 'bg-amber-50 border-amber-300' : i === 1 ? 'bg-slate-100 border-slate-300' : i === 2 ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-100';
          const rankBadge = i === 0 ? '<span class="text-amber-500">&#9733;</span>' : i === 1 ? '<span class="text-slate-400">&#9733;</span>' : i === 2 ? '<span class="text-orange-400">&#9733;</span>' : '';
          return `<tr class="border-b border-slate-100 text-[11px] hover:bg-slate-50 transition-colors ${medalBg}">
              <td class="p-3 font-black text-center">${i < 3 ? rankBadge + ' #' + (i+1) : i+1}</td>
              <td class="p-3 font-black text-sm">${s.name}</td>
              <td class="p-3 text-slate-500 font-bold">${s.am}</td>
              <td class="p-3 font-black text-amber-600 text-lg">${s.wins > 0 ? s.wins : '<span class="text-slate-300">-</span>'}</td>
              <td class="p-3 flex flex-wrap gap-1">${summary || '<span class="text-slate-300 italic text-[10px]">No medals</span>'}</td>
          </tr>`;
      }).join('');

      document.getElementById('mainView').innerHTML = `
    <div id="ytd-card" class="bg-transparent p-1">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-black outfit birds-green uppercase tracking-tight">YTD AWARDS DASHBOARD ( WoW Improvement Engine)</h2>
        <div onclick="exportCard('ytd-card','YTD_Awards')" class="export-btn bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"> Export Dash</div>
      </div>
      <div class="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
          <div>
            <h2 class="text-[36px] font-black outfit birds-green uppercase tracking-tighter"> Medals Leaderboard</h2>
            <p class="text-slate-500 text-sm font-bold">${currentAwardsYear} &bull; ${periodLabel}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select onchange="currentAwardsYear=parseInt(this.value); renderHallOfFame();" class="input-chip text-sm">
              ${years.map(y=>`<option value="${y}" ${y===currentAwardsYear?'selected':''}>Season ${y}</option>`).join('')}
            </select>
            <select onchange="currentAwardsPeriod=this.value; renderHallOfFame();" class="input-chip text-sm">
              <option value="ytd" ${currentAwardsPeriod==='ytd'?'selected':''}> YTD</option>
              <option value="q1" ${currentAwardsPeriod==='q1'?'selected':''}>Q1 (Wk 1-13)</option>
              <option value="q2" ${currentAwardsPeriod==='q2'?'selected':''}>Q2 (Wk 14-26)</option>
              <option value="q3" ${currentAwardsPeriod==='q3'?'selected':''}>Q3 (Wk 27-39)</option>
              <option value="q4" ${currentAwardsPeriod==='q4'?'selected':''}>Q4 (Wk 40-53)</option>
            </select>
            <button onclick="rebuildAwardsFromData()" class="btn-primary"> Rebuild Awards</button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="card p-4 border-t-4 border-t-amber-400">
            <div class="text-[10px] font-black text-slate-400 uppercase">Top Store</div>
            <div class="text-lg font-black text-amber-600">${topStore ? topStore[0] : '—'}</div>
            <div class="text-xs font-bold text-slate-600">${topStore ? topStore[1] + ' medals' : 'No medals yet'}</div>
          </div>
          <div class="card p-4 border-t-4 border-t-birds-green">
            <div class="text-[10px] font-black text-slate-400 uppercase">Top Area (YTD Weekly Wins)</div>
            <div class="text-lg font-black birds-green">${topArea ? topArea[0] : '—'}</div>
            <div class="text-xs font-bold text-slate-600">${topArea ? topArea[1] + ' weekly podium wins' : 'No wins yet'}</div>
          </div>
          <div class="card p-4 border-t-4 border-t-slate-300">
            <div class="text-[10px] font-black text-slate-400 uppercase">Weeks Counted</div>
            <div class="text-lg font-black text-slate-700">${weeksCount}</div>
            <div class="text-xs font-bold text-slate-600">weekly logs included</div>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="card p-6 border-t-4 border-t-birds-green">
            <h3 class="font-black outfit text-sm mb-4 uppercase tracking-widest text-slate-400">Area with Most Weekly Wins</h3>
            ${sortedAreas.length ? sortedAreas.map(([am,wins],i)=>`
              <div class="flex justify-between items-center border-b border-slate-100 py-3 last:border-0">
                <span class="font-bold text-slate-700">${i+1}. ${am}</span>
                <span class="text-birds-green font-black">${wins} Wins</span>
              </div>`).join('') : `<p class="text-slate-400 italic">No area wins logged yet. Hit 'Rebuild Awards' after syncing data.</p>`}
          </div>

          <div class="card lg:col-span-2 border-t-4 border-t-amber-400 overflow-hidden flex flex-col">
            <div class="p-6 pb-2">
                <div class="flex justify-between items-start mb-2">
                <div>
                    <h3 class="font-black outfit text-slate-600 text-xl uppercase tracking-tighter">Medal Leaderboard</h3>
                    <p class="text-xs font-bold text-slate-400">Stores ranked by total medals accrued this period</p>
                </div>
                </div>
            </div>
            <div class="overflow-y-auto flex-1 p-0 relative">
                <table class="w-full text-left relative">
                <thead class="bg-slate-50 sticky top-0 z-10 border-y border-slate-100 shadow-sm">
                    <tr>
                    <th class="p-3 text-[10px] uppercase text-slate-500 font-black w-12">Rank</th>
                    <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Store</th>
                    <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Area</th>
                    <th class="p-3 text-[10px] uppercase text-slate-500 font-black w-16">Total</th>
                    <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Medals Breakdown</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
                </table>
            </div>
          </div>
        </div>
    </div>
    `;
  } catch (err) {
      console.error(err);
      document.getElementById('mainView').innerHTML = '<div class="p-20 text-center"><h2 class="text-birds-green font-black text-xl mb-2">Awards Calculation Required</h2><button onclick="rebuildAwardsFromData()" class="btn-primary"> Run Awards Engine Now</button></div>';
  }
}

function buildMonthlyChampions(rawKpis, effectiveWeek, effectiveYear){
 const weeks=[...new Set((rawKpis||[]).filter(k=>!k.IsAnomaly && (k.Year || effectiveYear) === effectiveYear).map(k=>k.Week))].sort((a,b)=>a-b).filter(w=>w<=effectiveWeek).slice(-4);
 if(weeks.length<2) return [];
 const wk1=weeks[0], wk4=weeks[weeks.length-1];
 const stores=new Map();
 (rawKpis||[]).filter(k=>!k.IsAnomaly && (k.Year || effectiveYear) == effectiveYear).forEach(k=>{
    const id=canonicalStoreId(k.Branch);
    if(!stores.has(id)) stores.set(id,{branch:k.Branch,week1:null,week4:null});
    const s=stores.get(id);
    if(k.Week==wk1) s.week1=k;
    if(k.Week==wk4) s.week4=k;
 });
 const results=[];
 stores.forEach(store=>{
   if(!store.week1||!store.week4) return;
   const w1=store.week1,w4=store.week4;
   const salesGain=Number(((Number(w4.Sales||0)-Number(w1.Sales||0))*100).toFixed(1));
   const productGain=Number(((Number(w4.Product||0)-Number(w1.Product||0))*100).toFixed(1));
   const wasteGain=Number(((Number(w1.Waste||0)-Number(w4.Waste||0))*100).toFixed(1));
   const labourGain=Number(((Number(w1.Labour||0)-Number(w4.Labour||0))*100).toFixed(1));
   const energyGain=Number(((Number(w1.Energy||0)-Number(w4.Energy||0))*100).toFixed(1));
   const wins=(window.__areaWinsCache||[]).filter(w=>canonicalStoreId(w.Branch)===canonicalStoreId(store.branch));
   results.push({branch:store.branch,score:salesGain+productGain+wasteGain+labourGain+energyGain,awards:[...new Set(wins.map(w=>w.Metric))],awardCount:wins.length,improvedCount:[salesGain,productGain,wasteGain,labourGain,energyGain].filter(v=>v>0).length,salesGain,productGain,wasteGain,labourGain,energyGain});
 });
 return results.sort((a,b)=>b.score-a.score).slice(0,3);
}

function _fmtMoney(n){
  const x = Number(n)||0;
  try{ return '£' + Math.round(x).toLocaleString('en-GB'); }catch(e){ return '£' + Math.round(x); }
}
function _fmtPct(n, dp=1){
  const x = Number(n);
  if(!Number.isFinite(x)) return '—';
  return (x*100).toFixed(dp) + '%';
}
function _safe(n){ n = Number(n); return Number.isFinite(n) ? n : 0; }
function _median(arr){
  const a = arr.filter(v=>Number.isFinite(v)).slice().sort((x,y)=>x-y);
  if(!a.length) return 0;
  const mid = Math.floor(a.length/2);
  return a.length%2 ? a[mid] : (a[mid-1]+a[mid])/2;
}
function _mad(arr){
  const med = _median(arr);
  const dev = arr.map(v=>Math.abs(v-med));
  return _median(dev) || 1;
}
function _zRobust(v, arr){
  const med = _median(arr);
  const mad = _mad(arr);
  return (v - med) / mad;
}
function _bandLabel(i){
  return i===0 ? 'Band A (Largest Stores)' : (i===1 ? 'Band B' : (i===2 ? 'Band C' : 'Band D (Smallest Stores)'));
}
function _ragFromScore(score){
  const s = _safe(score);
  if(s >= 75) return {label:'GREEN', cls:'text-slate-800 bg-emerald-50 border-emerald-200', icon:''};
  if(s >= 50) return {label:'AMBER', cls:'text-amber-700 bg-amber-50 border-amber-200', icon:''};
  return {label:'RED', cls:'text-rose-700 bg-rose-50 border-rose-200', icon:''};
}
function _riskBadge(risk){
  if(!risk) return '<span class="text-[10px] font-black text-slate-400">—</span>';
  const cls = risk.level==='high' ? 'text-rose-700 bg-rose-50 border-rose-200'
            : (risk.level==='med' ? 'text-amber-700 bg-amber-50 border-amber-200'
            : 'text-slate-700 bg-slate-50 border-slate-200');
  const icon = risk.level==='high' ? '️' : (risk.level==='med' ? '' : 'ℹ️');
  return `<span class="text-[10px] font-black ${cls} px-2 py-1 rounded-md border">${icon} ${risk.label}</span>`;
}

async function renderBandingView(){
  const mv = document.getElementById('mainView');
  if(!mv) return;

  const rawKpisAll = await idbGetAll('kpi');
  if(!rawKpisAll || rawKpisAll.length === 0){
    mv.innerHTML = `
      <div class="card p-10 text-center">
        <h2 class="text-2xl font-black outfit birds-green mb-2"> Sales Banding (YTD)</h2>
        <p class="text-slate-500 font-bold">No KPI data found yet.</p>
        <p class="text-slate-400 text-sm mt-2">Click <b> Refresh Data</b> to ingest weekly files, then re-open this view.</p>
      </div>`;
    return;
  }

  // Effective year + latest week
  const years = rawKpisAll.map(k=>k.Year).filter(y=>Number.isFinite(Number(y)));
  const effectiveYear = years.length ? Math.max(...years.map(Number)) : (new Date().getFullYear());
  const yearKpis = rawKpisAll.filter(k => (Number(k.Year)||effectiveYear) === effectiveYear);
  const latestWeek = yearKpis.length ? Math.max(...yearKpis.map(k=>Number(k.Week)||0)) : 0;

  const weekTo = latestWeek || 1;
  const periodLabel = `Year to Date (Wk 1–${weekTo})`;

  // Recent window used only for risk checks
  const recentTo = weekTo;
  const recentFrom = Math.max(1, recentTo - 3);

  const filterRows = (fromW, toW) => yearKpis.filter(k => {
    const w = Number(k.Week)||0;
    if(!w) return false;
    if(w < fromW || w > toW) return false;
    if(k.IsAnomaly) return false;
    
    return true;
  });

  const ytdRows = filterRows(1, weekTo);
  if(!ytdRows.length){
    mv.innerHTML = `
      <div class="card p-10 text-center">
        <h2 class="text-2xl font-black outfit birds-green mb-2"> Sales Banding (YTD)</h2>
        <p class="text-slate-500 font-bold">No usable KPI rows were found for ${periodLabel}.</p>
      </div>`;
    return;
  }
  const recentRows = filterRows(recentFrom, recentTo);

  function buildStoreAgg(rows){
    const byStore = new Map();
    for(const k of rows){
      const branch = k.Branch;
      if(!branch) continue;
      const id = canonicalStoreId(branch);
      if(!byStore.has(id)){
        byStore.set(id, { Branch: branch, AM: safeGetAM(branch), weeks: 0, salesTotal: 0, salesDiffSum: 0, productSum: 0, wasteSum: 0, labourSum: 0, atvSum: 0, energySum: 0 });
      }
      const s = byStore.get(id);
      s.weeks += 1;

      const actual = (k.__rawSales !== undefined && k.__rawSales !== null) ? Number(k.__rawSales)
                   : (k.SalesActual !== undefined && k.SalesActual !== null) ? Number(k.SalesActual)
                   : 0;
      if(Number.isFinite(actual) && actual > 0) s.salesTotal += actual;

      s.salesDiffSum += _safe(k.Sales);
      s.productSum   += _safe(k.Product);
      s.wasteSum     += _safe(k.Waste);
      s.labourSum    += _safe(k.Labour);
      s.atvSum       += _safe(k.ATV);
      s.energySum    += _safe(k.Energy);
    }

    return Array.from(byStore.values()).map(s => {
      const n = Math.max(1, s.weeks);
      const salesTotal = _safe(s.salesTotal);
      const energy = _safe(s.energySum) / n;
      const energyPerSales = (salesTotal > 0) ? (energy / salesTotal) : 0;
      return {
        Branch: s.Branch,
        AM: s.AM,
        weeks: n,
        SalesTotal: salesTotal,
        AvgWeeklySales: salesTotal / n,
        SalesDiff: s.salesDiffSum / n,
        Product: s.productSum / n,
        Waste: s.wasteSum / n,
        Labour: s.labourSum / n,
        ATV: s.atvSum / n,
        Energy: energy,
        EnergyPerSales: energyPerSales
      };
    });
  }

  let ytdStores = buildStoreAgg(ytdRows);
  const volSum = ytdStores.reduce((a,b)=>a+_safe(b.SalesTotal),0);
  if(!(volSum > 0)){
    mv.innerHTML = `
      <div class="card p-10 text-center">
        <h2 class="text-2xl font-black outfit birds-green mb-2"> Sales Banding (YTD)</h2>
        <p class="text-slate-500 font-bold">I can’t see any <b>Actual Sales (£)</b> values in your KPI records yet.</p>
        <p class="text-slate-400 text-sm mt-2">Use this updated file, then click <b> Refresh Data</b> so the ingest captures <b>Actual Sales</b> from your weekly spreadsheets.</p>
      </div>`;
    return;
  }

  const recentStores = buildStoreAgg(recentRows);
  const recentById = new Map(recentStores.map(s=>[String(s.Branch).trim().toLowerCase(), s]));

  // Band purely by YTD £ Sales
  ytdStores.sort((a,b)=> _safe(b.SalesTotal) - _safe(a.SalesTotal));
  const nStores = ytdStores.length;
  const q = Math.ceil(nStores / 4) || 1;
  const bands = [
    { name: _bandLabel(0), stores: ytdStores.slice(0, q) },
    { name: _bandLabel(1), stores: ytdStores.slice(q, q*2) },
    { name: _bandLabel(2), stores: ytdStores.slice(q*2, q*3) },
    { name: _bandLabel(3), stores: ytdStores.slice(q*3) },
  ].filter(b=>b.stores && b.stores.length);

  // Efficiency score (YTD) within each band
  function computeEfficiencyIndex(list){
    const arrSalesDiff = list.map(s=>_safe(s.SalesDiff));
    const arrProd      = list.map(s=>_safe(s.Product));
    const arrWaste     = list.map(s=>_safe(s.Waste));
    const arrLab       = list.map(s=>_safe(s.Labour));
    const arrATV       = list.map(s=>_safe(s.ATV));
    const arrEps       = list.map(s=>_safe(s.EnergyPerSales));
    list.forEach(s => {
      const zSales = _zRobust(_safe(s.SalesDiff), arrSalesDiff);
      const zProd  = _zRobust(_safe(s.Product), arrProd);
      const zATV   = _zRobust(_safe(s.ATV), arrATV);
      const zWaste = -_zRobust(_safe(s.Waste), arrWaste);
      const zLab   = -_zRobust(_safe(s.Labour), arrLab);
      const zEps   = -_zRobust(_safe(s.EnergyPerSales), arrEps);
      s.EfficiencyIndex = (zSales*0.25) + (zProd*0.20) + (zWaste*0.20) + (zLab*0.20) + (zEps*0.10) + (zATV*0.05);
    });
  }

  bands.forEach(b => {
    computeEfficiencyIndex(b.stores);
    const sorted = [...b.stores].sort((x,y)=>_safe(y.EfficiencyIndex)-_safe(x.EfficiencyIndex));
    const n = Math.max(1, sorted.length);
    sorted.forEach((s, idx)=>{
      s.BandRank = idx+1;
      s.BandScore = (n===1)?100:Math.round((1-(idx/(n-1)))*100);
      s.BandRAG = _ragFromScore(s.BandScore);
    });
    b._avgBandScore = sorted.reduce((a,s)=>a+_safe(s.BandScore),0)/n;
  });

  // Recent within-band score (for risk comparison)
  function computeRecentScoreMap(bandStores){
    const recentList = bandStores.map(s=>recentById.get(String(s.Branch).trim().toLowerCase())).filter(Boolean);
    if(!recentList.length) return new Map();
    computeEfficiencyIndex(recentList);
    const sorted = [...recentList].sort((a,b)=>_safe(b.EfficiencyIndex)-_safe(a.EfficiencyIndex));
    const n = Math.max(1, sorted.length);
    const map = new Map();
    sorted.forEach((s, idx)=>{
      const score = (n===1)?100:Math.round((1-(idx/(n-1)))*100);
      map.set(String(s.Branch).trim().toLowerCase(), score);
    });
    return map;
  }

  bands.forEach(b => {
    const recentScoreMap = computeRecentScoreMap(b.stores);
    b.stores.forEach(s => {
      const rid = String(s.Branch).trim().toLowerCase();
      const r = recentById.get(rid);

      // Risk checks
      let turnoverDrop = false;
      if(r && _safe(s.AvgWeeklySales) > 0 && _safe(r.AvgWeeklySales) > 0){
        const ratio = _safe(r.AvgWeeklySales) / _safe(s.AvgWeeklySales);
        if(ratio < 0.85) turnoverDrop = true; // material drop vs YTD run-rate
      }

      let efficiencyDrop = false;
      if(recentScoreMap.has(rid)){
        const recentScore = recentScoreMap.get(rid);
        s.RecentBandScore = recentScore;
        if((_safe(recentScore) - _safe(s.BandScore)) <= -15) efficiencyDrop = true;
      } else {
        s.RecentBandScore = null;
      }

      let risk = null;
      if(turnoverDrop && efficiencyDrop) risk = {level:'high', label:'Turnover & control drop'};
      else if(turnoverDrop) risk = {level:'high', label:'Turnover drop vs YTD'};
      else if(efficiencyDrop) risk = {level:'med', label:'Control drop vs YTD'};
      s.Risk = risk;
    });
  });

  const bandSummary = bands.map((band) => {
    const vals = band.stores.map(s=>_safe(s.SalesTotal)).filter(v=>v>0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avgScore = _safe(band._avgBandScore);
    const rag = _ragFromScore(avgScore);
    return `
      <div class="card p-4 border border-slate-200 flex flex-col gap-1">
        <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${band.name}</div>
        <div class="text-lg font-black text-slate-800">${_fmtMoney(min)} → ${_fmtMoney(max)}</div>
        <div class="text-xs font-bold ${rag.cls} w-fit px-2 py-1 rounded-md border">${rag.icon} Avg Band Score: ${avgScore.toFixed(0)} • ${band.stores.length} stores</div>
        <div class="text-[10px] text-slate-500 font-bold mt-1">Risk checks compare last 4 weeks (Wk ${recentFrom}–${recentTo}) vs YTD baseline</div>
      </div>`;
  }).join('');

  const headerNote = `This view is <b>YTD-first</b>. Band = store size (Total Sales £ for ${periodLabel}). Band Score ranks <b>investment performance</b> within that size band using Labour, Waste, Energy/£, Sales vs Target, Product and ATV. Drop Risk highlights stores slipping vs their own YTD expectations.`;

  const bandCards = bands.map((band, bi)=>{
    const vals = band.stores.map(s=>_safe(s.SalesTotal)).filter(v=>v>0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);

    const rows = band.stores
      .sort((a,b)=>_safe(a.BandRank)-_safe(b.BandRank))
      .map((s)=>{
        const rag = s.BandRAG || _ragFromScore(s.BandScore);
        const recentScore = (s.RecentBandScore==null) ? '—' : (String(s.RecentBandScore) + '%');
        return `
          <tr class="border-b border-slate-100 text-[11px] hover:bg-slate-50">
            <td class="p-3 font-black">${s.BandRank ?? '—'}</td>
            <td class="p-3 font-bold">${s.Branch}</td>
            <td class="p-3 text-slate-500">${s.AM || '—'}</td>
            <td class="p-3 font-black text-slate-800">${(s.BandScore ?? 0)}%</td>
            <td class="p-3"><span class="text-[10px] font-black ${rag.cls} px-2 py-1 rounded-md border">${rag.icon} ${rag.label}</span></td>
            <td class="p-3">${_riskBadge(s.Risk)}</td>
            <td class="p-3 font-black text-slate-800">${_fmtMoney(s.SalesTotal)}</td>
            <td class="p-3 text-slate-600">${recentScore}</td>
            <td class="p-3">${_fmtPct(s.SalesDiff)}</td>
            <td class="p-3">${_fmtPct(s.Product)}</td>
            <td class="p-3">${_fmtPct(s.Waste)}</td>
            <td class="p-3">${_fmtPct(s.Labour)}</td>
            <td class="p-3">${(s.EnergyPerSales>0)?(s.EnergyPerSales.toFixed(5)):'—'}</td>
          </tr>`;
      }).join('');

    return `
      <div class="card overflow-hidden border-t-4 ${bi===0?'border-t-amber-400':'border-t-birds-green'}">
        <div class="p-5 flex flex-col md:flex-row md:items-end md:justify-between gap-2">
          <div>
            <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${band.name}</div>
            <div class="text-xl font-black text-slate-800">${_fmtMoney(min)} → ${_fmtMoney(max)}</div>
          </div>
          <div class="text-xs text-slate-500 font-bold">Band Score = efficiency within size band (YTD, 0–100)</div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="bg-slate-50 border-y border-slate-100">
              <tr>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Band Rank</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Store</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Area</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">YTD Band Score</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">RAG</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Drop Risk</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">YTD Sales (£)</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Recent Score</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Sales vs Target</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Product</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Waste</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Labour</th>
                <th class="p-3 text-[10px] uppercase text-slate-500 font-black">Energy/£</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');

  mv.innerHTML = `
    <div id="banding-card" class="pb-2 relative">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-black outfit birds-green uppercase tracking-tight">Sales Banding (A–D) — YTD Investment Score + Drop Risk</h2>
        <div onclick="exportCard('banding-card', 'Sales_Banding_YTD')" class="export-btn bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"> Export</div>
      </div>

      <div class="card p-5 mb-6 border border-slate-200">
        <div class="text-sm text-slate-700 font-medium">${headerNote}</div>
        <div class="text-xs text-slate-500 font-bold mt-2">This tab is designed for investment decisions (store size vs operational control), not week-on-week rankings.</div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        ${bandSummary}
      </div>

      <div class="grid grid-cols-1 gap-6">${bandCards}</div>
    </div>`;
}

async function renderChampionsView(){

    const rawKpis = await idbGetAll('kpi');
    const effectiveWeek = archiveWeekOverride || latestWkGlobal;

    const monthlyChampions =
        buildMonthlyChampions(
            rawKpis,
            effectiveWeek,
            currentAwardsYear || new Date().getFullYear()
        );

    document.getElementById('mainView').innerHTML = `

    <div class="p-6">

        <div class="flex justify-between items-center mb-6">

            <h2 class="text-[36px] font-black birds-green">
                Monthly Champions
            </h2>

            <button
                onclick="exportAllChampions()"
                class="btn" style="background: #555B6E; color: white; padding: 10px 20px; border-radius: 6px; font-weight: 800; font-size: 13px;">

                Export All Champions

            </button>

        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

        ${monthlyChampions.map((s,i)=>{

            const position =
                i===0
                    ? 'GOLD CHAMPION'
                    : i===1
                    ? 'SILVER CHAMPION'
                    : 'BRONZE CHAMPION';

            // medalClass corresponds to the new CSS classes defined above
            const medalClass =
                i===0
                    ? 'champion-gold'
                    : i===1
                    ? 'champion-silver'
                    : 'champion-bronze';

            return `

            <div
                id="monthly-champion-${i}"
                class="card champion-export-card ${medalClass} p-6 relative">

                <button
                    onclick="exportCard('monthly-champion-${i}','${s.branch}')"
                    class="export-btn absolute top-4 right-4">

                    Export PNG

                </button>

                <div class="champion-title">

                    ${position}

                </div>

                <div class="text-center mb-6">

                    <div class="text-xs font-black tracking-[4px] text-slate-500 uppercase">

                        Well Done

                    </div>

                    <div class="text-4xl font-black text-slate-800 mt-2">

                        ${s.branch}

                    </div>

                </div>

                <div class="grid grid-cols-2 gap-4 mb-6">

                    <div class="champion-kpi-box">

                        <div class="text-xs uppercase text-slate-500 font-bold">

                            KPI Improvements

                        </div>

                        <div class="text-4xl font-black birds-green">

                            ${s.improvedCount}

                        </div>

                    </div>

                    <div class="champion-kpi-box">

                        <div class="text-xs uppercase text-slate-500 font-bold">

                            Total Medals

                        </div>

                        <div class="text-4xl font-black text-amber-600">

                            ${s.awardCount}

                        </div>

                    </div>

                </div>

                <div class="champion-summary mb-5">

                    <div class="champion-section-title">

                        KPI PERFORMANCE

                    </div>

                    <div class="space-y-2 text-sm">

                        <div class="flex justify-between">
                            <span>Sales Growth</span>
                            <strong>+${s.salesGain}%</strong>
                        </div>

                        <div class="flex justify-between">
                            <span>Product Target</span>
                            <strong>+${s.productGain}%</strong>
                        </div>

                        <div class="flex justify-between">
                            <span>Waste</span>
                            <strong>${s.wasteGain}%</strong>
                        </div>

                        <div class="flex justify-between">
                            <span>Labour</span>
                            <strong>${s.labourGain}%</strong>
                        </div>

                        <div class="flex justify-between">
                            <span>Energy</span>
                            <strong>${s.energyGain}%</strong>
                        </div>

                    </div>

                </div>

                <div>

                    <div class="champion-section-title">

                        MEDALS ACCRUED

                    </div>

                    <div class="flex flex-wrap justify-center gap-2">

                        ${s.awards.map(a=>`

                            <span class="champion-badge">

                                ${a}

                            </span>

                        `).join('')}

                    </div>

                </div>

            </div>

            `;

        }).join('')}

        </div>

    </div>

    `;
}

function exportAllChampions(){
    try{
        const champions = document.querySelector('#mainView .grid');
        if(!champions){ alert('No champions to export.'); return; }
        const wb = XLSX.utils.book_new();
        const rows = [['Position', 'Store', 'Score', 'Improved Metrics', 'Awards']];
        document.querySelectorAll('#mainView .grid > div').forEach(card => {
            const pos = (card.querySelector('h3') || {}).textContent || '';
            const name = (card.querySelector('h2') || {}).textContent || '';
            const score = (card.querySelector('.text-2xl') || {}).textContent || '';
            rows.push([pos.trim(), name.trim(), score.trim()]);
        });
        if(rows.length <= 1){ alert('No champion data found.'); return; }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Champions');
        const stamp=new Date().toISOString().slice(0,10);
        XLSX.writeFile(wb, 'Champions_'+stamp+'.xlsx');
    }catch(e){ console.error('Export champions failed', e); alert('Export failed.'); }
}