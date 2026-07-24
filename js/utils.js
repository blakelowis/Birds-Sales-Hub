/* ─── Lucide-style Trend Icons (inline SVG) ───────────────── */
const ICON_TREND_UP = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:2px;"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>';
const ICON_TREND_DOWN = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:2px;"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>';

function trendIcon(diff) { return diff > 0 ? ICON_TREND_UP : diff < 0 ? ICON_TREND_DOWN : ''; }

function canonicalStoreId(name){
  if(!name) return "";
  let s = String(name).toLowerCase().trim();
  s = s.replace(/[^a-z0-9]/g,'');

  const STORE_MAP = {
    "Derbion Crown Walk": ["derbioncrownwalk","crownwalk","derbioncw","crownwalkderbion","intucrownwalk"],
    "Lister Gate": ["listergate","listerg"],
    "West Bridgford": ["westbridgford","westbridgfo","westbridgeford"],
    "Sutton Lakeside": ["suttonlakeside","lakeside","suttonlakesidepoint"],
    "Victoria Centre": ["victoriacentre","victoriacenter","viccentre"],
    "Long Eaton": ["longeaton","longeton"],
    "Park Farm": ["parkfarm"],
    "East Leake": ["eastleake"],
    "Melton Road": ["meltonroad","meltonrd"],
    "Teal Park": ["tealpark"],
    "Lansdowne Drive": ["lansdownedrive","lansdowne","lansdowndrive","lansdowndr"],
    "Branston": ["branstonretailpark", "branston"],
    "Burton": ["burtonstationstreet","burtonexpresso"],
    "Sutton": ["sutton"],
    "Stretton": ["stretton"],
    "Swadlincote": ["swadlincote"],
    "Training": ["training"]
  };

  for(const key in STORE_MAP){
    if(STORE_MAP[key].some(v => s.includes(v))){
      return key;
    }
  }

  return s;
}

function resolveStoreAM(row, branchId){
 const AM_NAMES=['Katie Cartwright','Craig White','Paul Reeves','Suzanne Green','Thomas Henson','Tom Henson'];
 let excelAM=null;
 for(let cell of row){
  let val=String(cell||'').trim();
  if(AM_NAMES.includes(val)){
   excelAM=val==='Tom Henson'?'Thomas Henson':val;
   break;
  }
 }
 if(excelAM){
  storeMap.set(branchId,excelAM);
  idbPut('stores',{BranchId:branchId,originalName:branchId,AM:excelAM});
 }
 return storeMap.get(branchId) || 'Unassigned';
}

function calculateTrendWinner(currArr, prevArr, metric, inverse=false){
  const prevMap = new Map(prevArr.map(p=>[canonicalStoreId(p.Branch),p]));
  const deltas = currArr.map(c=>{
    const p = prevMap.get(canonicalStoreId(c.Branch));
    if(!p) return null;
    const currVal = c[metric]||0;
    const prevVal = p[metric]||0;
    let change = inverse ? (prevVal - currVal) : (currVal - prevVal);
    return {branch:c.Branch, change};
  }).filter(Boolean);
  deltas.sort((a,b)=>b.change-a.change);
  return deltas[0];
}

window.BirdsCore = {

    pct(value, dp = 1){

        const n = Number(value || 0);

        return (n * 100).toFixed(dp) + '%';

    },

    money(value){

        return '£' + Number(value || 0).toFixed(0);

    },

    whole(value){

        return Number(value || 0).toFixed(0);

    },

    energy(value){

        return Number(value || 0).toFixed(0) + ' kWh';

    },

    status(value){

        const s = String(value || '')
            .trim()
            .toLowerCase();

        if(s.includes('resolved'))
            return 'Resolved';

        if(s.includes('closed'))
            return 'Closed';

        if(s.includes('awaiting'))
            return 'Awaiting';

        return 'Open';

    },

    getArea(store){

        try{

            const id =
                canonicalStoreId(
                    store || ''
                );

            return (
                safeGetAM(store)
                || storeMap.get(id)
                || 'Unassigned'
            );

        }catch(e){

            return 'Unassigned';

        }

    },

    parseUKDate(value){

        if(!value)
            return null;

        const p =
            String(value).split('/');

        if(p.length !== 3)
            return null;

        return new Date(
            Number(p[2]),
            Number(p[1]) - 1,
            Number(p[0])
        );

    },

    statusColour(status){

        const s =
            this.status(status);

        if(
            s === 'Closed' ||
            s === 'Resolved'
        )
            return 'green';

        if(
            s === 'Awaiting'
        )
            return 'amber';

        return 'red';

    },

    isClosed(status){

        const s =
            this.status(status);

        return (
            s === 'Closed' ||
            s === 'Resolved'
        );

    },

    calculateScore(store){

        return (

            ((store.Sales || 0) * 100)

            +

            ((store.Product || 0) * 100)

            -

            ((store.Waste || 0) * 100)

            -

            ((store.Labour || 0) * 100)

            -

            ((store.Energy || 0) / 100)

        );

    }

};

function calculateStoreScore(s){
    return BirdsCore.calculateScore(s);
}

function computeRankMap(arr, metric, ascending=false){
 const safe = arr.filter(x=>Number.isFinite(x[metric]));
 const sorted=[...safe].sort((a,b)=>ascending ? a[metric]-b[metric] : b[metric]-a[metric]);
 return new Map(sorted.map((s,i)=>[canonicalStoreId(s.Branch),i+1]));
}

const DEFAULT_AREA_MAPPING = {
  'Katie Cartwright': ['Bingham','Bulwell','Bakery Shop','Chilwell','Clifton','Melton Road','Newark','Radcliffe','Ruddington','Southwell','Sherwood','Sutton','Sutton Lakeside','Victoria Centre'],
  'Craig White': ['Alfreton','Arnold','Beeston','Ilkeston','Lister Gate','Long Eaton','Mansfield','Mapperley','Teal Park','West Bridgford','Wollaton'],
  'Paul Reeves': ['Allenton','Alvaston','Belper','Duffield','Eastwood','Heanor','Hucknall','Mackworth','Matlock','Ripley','Sinfin','Spondon'],
  'Suzanne Green': ['Albert Street','Ashbourne','Bakery Shop','Borrowash','Chaddesden','Chellaston','Derbion Crown Walk','Littleover','Melbourne','Mickleover','Oakwood','Park Farm'],
  'Thomas Henson': ['Anstey','Ashby','Branston','Burton','Coalville','East Leake','Keyworth','Lichfield','Lansdowne Drive','Loughborough','Stretton','Swadlincote','Tamworth','Uttoxeter'],
  'Unassigned': ['Training']
};
const AM_LIST = ['Katie Cartwright', 'Craig White', 'Paul Reeves', 'Suzanne Green', 'Thomas Henson', 'Unassigned'];

let currentView = 'overview', latestWkGlobal = 0;

let storeMap = new Map();

function safeGetAM(branch){
  const id = canonicalStoreId(branch);
  const am = storeMap.get(id) || 'Unassigned';
  return am === 'Tom Henson' ? 'Thomas Henson' : am;
}

let originalStoreNames = new Map();
let currentTimeFilter = 'latest';
let trendChartInstance = null;
let archiveWeekOverride = null; 

function openIngestLog() {
    alert("Ingest log viewer coming soon.");
}

function cleanStoreName(name) {
    let s = String(name || '').trim();
    let lower = s.toLowerCase();
    
    if (lower.includes('burton expresso') || lower.includes('burton station street') || lower === 'burton') {
        return 'Burton';
    }
    
    if (lower.includes('branston retail park') || lower === 'branston') {
        return 'Branston';
    }
    
    if (lower === 'crown walk') return 'Derbion Crown Walk';
    if (lower === 'sutton lakeside point') return 'Sutton Lakeside';
    if (lower === 'lister gate') return 'Lister Gate';

    
    return s;
}

function updateActiveWeekBadge(effectiveWeek) {
    const badge = document.getElementById('activeWeekBadge');
    if(!badge) return;
    if(archiveWeekOverride) {
        badge.className = "bg-amber-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider";
        badge.innerText = "ARCHIVE: WK " + archiveWeekOverride;
    } else if (currentTimeFilter === 'latest') {
        badge.className = "bg-slate-700 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider";
        badge.innerText = "LATEST: WK " + (latestWkGlobal || effectiveWeek || '?');
    } else if (currentTimeFilter === 'last4') {
        badge.className = "bg-indigo-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider";
        badge.innerText = "ROLLING 4 WEEKS (WK " + Math.max(1, (latestWkGlobal-3)) + "-" + latestWkGlobal + ")";
    } else {
        badge.className = " text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider";
        badge.innerText = "YEAR TO DATE";
    }
}

window.setArchiveWeekOverride = function(w){
  const n = parseInt(w,10);
  archiveWeekOverride = (Number.isFinite(n) && n>0) ? n : null;
  renderDashboard();
};
window.clearArchiveWeekOverride = function(){ archiveWeekOverride = null; renderDashboard(); };

function populateExportDropdown(){
  const sel = document.getElementById('exportStoreSelect');
  if(!sel) return;
  sel.innerHTML = '<option value="">Select Store...</option>';
  Array.from(originalStoreNames.values())
    .sort()
    .forEach(s=>{
      const opt=document.createElement('option');
      opt.value=s;
      opt.textContent=s;
      sel.appendChild(opt);
    });
}

async function loadStoreMap() {
    const stores = await idbGetAll('stores');
    if (stores.length === 0) {
        for (const [am, branches] of Object.entries(DEFAULT_AREA_MAPPING)) {
            for (const b of branches) {
                let lowerId = canonicalStoreId(b);
                await idbPut('stores', { BranchId: lowerId, originalName: b, AM: am });
                storeMap.set(lowerId, am);
                originalStoreNames.set(lowerId, b);
            }
        }
    } else {
        var canonical = {};
        for (var i = 0; i < stores.length; i++) {
            var s = stores[i];
            var cid = canonicalStoreId(s.BranchId || '');
            if (!cid) continue;
            if (s.AM === 'Tom Henson') { s.AM = 'Thomas Henson'; }
            if (s.AM === 'Unassigned' || !s.AM) {
                for (const [am, branches] of Object.entries(DEFAULT_AREA_MAPPING)) {
                    if (branches.some(b => {
                        const bId = canonicalStoreId(b).toLowerCase();
                        const sLower = (s.BranchId || '').toLowerCase();
                        return sLower === bId || sLower.startsWith(bId) || bId.startsWith(sLower);
                    })) {
                        s.AM = am; break;
                    }
                }
            }
            if (!canonical[cid] || (canonical[cid].AM === 'Unassigned' && s.AM !== 'Unassigned')) {
                canonical[cid] = { BranchId: cid, originalName: canonicalStoreId(s.BranchId || ''), AM: s.AM || 'Unassigned' };
            }
        }
        // Flush deduplicated entries to IndexedDB and runtime map
        for (var cid in canonical) {
            var entry = canonical[cid];
            await idbPut('stores', entry);
            storeMap.set(cid, entry.AM);
            originalStoreNames.set(cid, entry.originalName);
        }
    }
}

window.updateStoreAM = async function(branchId, newAM) {
    const origName = originalStoreNames.get(branchId);
    await idbPut('stores', { BranchId: branchId, originalName: origName, AM: newAM });
    storeMap.set(branchId, newAM);
    if(currentView === 'control') renderDashboard();
};

window.addNewStore = async function() {
    const nameInput = document.getElementById('newStoreName').value.trim();
    const amSelect = document.getElementById('newStoreAM').value;
    if(!nameInput) return alert("Please enter a store name.");
    
    const lowerId = canonicalStoreId(nameInput);
    await idbPut('stores', { BranchId: lowerId, originalName: nameInput, AM: amSelect });
    storeMap.set(lowerId, amSelect);
    originalStoreNames.set(lowerId, nameInput);
    
    document.getElementById('newStoreName').value = '';
    renderDashboard();
    alert(`Store '${nameInput}' added successfully to ${amSelect}.`);
};

function parseVal(v){
  if(v === undefined || v === null || v === '') return 0;
  let s = String(v).trim();
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if(!m) return 0;
  let num = parseFloat(m[0]);
  return s.includes('%') ? num/100 : num;
}
function _finiteOr0(x){ x = Number(x); return Number.isFinite(x) ? x : 0; }
function _clamp(x, lo, hi){ x = _finiteOr0(x); return Math.max(lo, Math.min(hi, x)); }

function _fixRatio(v, {allowNegative=false} = {}){
  v = _finiteOr0(v);
  if (!Number.isFinite(v)) return 0;
  if (Math.abs(v) > 1.5 && Math.abs(v) <= 200) v = v / 100;
  else if (Math.abs(v) > 1.5 && Math.abs(v) <= 20000) v = v / 10000;
  if (Math.abs(v) > 1.5) v = 0;
  return _clamp(v, allowNegative ? -1 : 0, 1);
}

function _fixATV(v){ v = _finiteOr0(v); if (v < 0) v = 0; if (v > 100 && v <= 10000) v = v / 100; return _clamp(v, 0, 200); }
function _fixEnergy(v){ v = _finiteOr0(v); if (v < 0) v = Math.abs(v); if (v > 0 && v < 1) v = 0; return _clamp(v, 0, 50000); }
function _fixScore100(v){ v = _finiteOr0(v); if (v > 0 && v <= 1.5) v = v * 100; return _clamp(v, 0, 100); }

async function validateAndCorrectData(weeksTouched){
  try {
    const kpis = await idbGetAll('kpi');
    for (const rec of kpis) {
      if (Array.isArray(weeksTouched) && weeksTouched.length && !weeksTouched.includes(rec.Week)) continue;
      const fixed = { ...rec };
      if (fixed.__rawSales === undefined) fixed.__rawSales = (rec.SalesActual !== undefined ? rec.SalesActual : rec.Sales);
      if (fixed.__rawProduct === undefined) fixed.__rawProduct = rec.Product;
      if (fixed.__rawWaste === undefined) fixed.__rawWaste = rec.Waste;
      if (fixed.__rawLabour === undefined) fixed.__rawLabour = rec.Labour;
      if (fixed.__rawATV === undefined) fixed.__rawATV = rec.ATV;
      if (fixed.__rawEnergy === undefined) fixed.__rawEnergy = rec.Energy;

      fixed.Sales = _fixRatio(rec.Sales, {allowNegative:true});
      fixed.Product = _fixRatio(rec.Product, {allowNegative:true});
      fixed.Waste = _fixRatio(rec.Waste, {allowNegative:false});
      fixed.Labour = _fixRatio(rec.Labour, {allowNegative:false});
      fixed.ATV = _fixATV(rec.ATV);
      fixed.Energy = _fixEnergy(rec.Energy);
      fixed.FilledRolls = Math.max(0, _finiteOr0(rec.FilledRolls));
      fixed.Sandwiches = Math.max(0, _finiteOr0(rec.Sandwiches));
      fixed.HotRolls = Math.max(0, _finiteOr0(rec.HotRolls));
      fixed.HotBev = Math.max(0, _finiteOr0(rec.HotBev));
      await idbPut('kpi', fixed);
    }
    const audits = await idbGetAll('audits');
    for (const rec of audits) {
      if (Array.isArray(weeksTouched) && weeksTouched.length && !weeksTouched.includes(rec.Week)) continue;
      const fixed = { ...rec };
      if (fixed.__rawScore === undefined) fixed.__rawScore = rec.Score;
      if (fixed.__rawFood === undefined) fixed.__rawFood = rec.Food;
      if (fixed.__rawFire === undefined) fixed.__rawFire = rec.Fire;
      if (fixed.__rawHandS === undefined) fixed.__rawHandS = rec.HandS;
      if (fixed.__rawJourney === undefined) fixed.__rawJourney = rec.Journey;
      if (fixed.__rawCoffee === undefined) fixed.__rawCoffee = rec.Coffee;
      if (fixed.__rawFocus === undefined) fixed.__rawFocus = rec.Focus;

      fixed.Score = _fixScore100(rec.Score);
      fixed.Food = _fixScore100(rec.Food);
      fixed.Fire = _fixScore100(rec.Fire);
      fixed.HandS = _fixScore100(rec.HandS);
      fixed.Journey = _fixScore100(rec.Journey);
      fixed.Coffee = _fixScore100(rec.Coffee);
      fixed.Focus = _fixScore100(rec.Focus);
      await idbPut('audits', fixed);
    }
  } catch (e) {
    console.warn('Post-ingest validation failed:', e);
  }
}

async function flagAnomalies() {
    try {
        const kpis = await idbGetAll('kpi');
        const byBranch = {};

        kpis.forEach(k => {
            const key = k.BranchId || k.Branch || 'unknown';
            if (!byBranch[key]) byBranch[key] = [];
            byBranch[key].push(k);
        });

        // Find the global latest week across all data — never flag it
        let globalLatestWeek = 0;
        let globalLatestYear = 0;
        kpis.forEach(k => {
            const y = k.Year || 0;
            const w = k.Week || 0;
            if (y > globalLatestYear || (y === globalLatestYear && w > globalLatestWeek)) {
                globalLatestWeek = w;
                globalLatestYear = y;
            }
        });

        for (const branch in byBranch) {
            const stores = byBranch[branch].sort((a,b) => {
               if ((a.Year || 0) !== (b.Year || 0)) return (a.Year || 0) - (b.Year || 0);
               return (a.Week || 0) - (b.Week || 0);
            });
            
            let lastValidSales = null;
            
            for (let i = 0; i < stores.length; i++) {
               const curr = stores[i];
               let isAnomaly = false;

               // NEVER flag the latest week — users must always see current data
               if (curr.Week == globalLatestWeek && (curr.Year || 0) == globalLatestYear) {
                   curr.IsAnomaly = false;
                   await idbPut('kpi', curr);
                   lastValidSales = curr.Sales;
                   continue;
               }

               // Rule 1: True closures — __rawSales must be explicitly 0 (not defaulted)
               // Only flag if we're confident the store was closed: Sales <= -0.90 AND __rawSales is exactly 0
               if (curr.Sales <= -0.90) {
                   isAnomaly = true;
               }
               // Rule 2: 80%+ drop from last valid baseline
               else if (lastValidSales !== null && (lastValidSales - curr.Sales) >= 0.80) {
                   isAnomaly = true;
               }

               curr.IsAnomaly = isAnomaly;
               await idbPut('kpi', curr);

               if (!isAnomaly) {
                   lastValidSales = curr.Sales;
               }
            }
        }
    } catch (e) {
        console.warn('Anomaly flagging failed:', e);
    }
}

let currentAwardsYear = new Date().getFullYear();
let currentAwardsPeriod = 'ytd';

async function recordPersistentWinnersForWeeks(year, weeks){
  const kpis = await idbGetAll('kpi');
  const validAMs = AM_LIST.filter(a => a !== 'Unassigned');

  for(const week of weeks){
    // Exclude Anomaly weeks from ever winning an award
    const wkKpis = kpis.filter(k => (k.Year ?? year) == year && k.Week == week &&  !k.IsAnomaly);
    if(!wkKpis.length) continue;

    const pWkResult = getPreviousAvailableWeek(week, year, kpis);
    const pWk = pWkResult.week;
    const pYr = pWkResult.year;
    // Exclude anomalies from previous baseline comparisons
    const prevKpis = kpis.filter(k => (k.Year ?? pYr) == pYr && k.Week == pWk && !k.IsAnomaly);

  try{
    const prevById = new Map(prevKpis.map(p=>[canonicalStoreId(p.Branch), p]));
    let bestMI = null;
    for(const c of wkKpis){
      const cAm = safeGetAM(c.Branch);
      const p = prevById.get(canonicalStoreId(c.Branch));
      if(!p) continue;
      const delta = (_finiteOr0(c.Sales) - _finiteOr0(p.Sales));
      if(!bestMI || delta > bestMI.delta) bestMI = { Branch: c.Branch, AM: cAm, delta };
    }
    if(bestMI && bestMI.delta > 0){
      await idbPut('store_winners_log', { Year: year, Week: week, Metric: 'Most Improved', Branch: bestMI.Branch });
    }
  }catch(e){ console.warn('MostImproved skipped', e); }

    const metrics = [
      { id: 'Sales', order: 'desc' }, { id: 'Product', order: 'desc' },
      { id: 'Waste', order: 'asc' }, { id: 'Labour', order: 'asc' },
      { id: 'ATV', order: 'desc' }, { id: 'Energy', order: 'asc' }
    ];

    // Enrich each KPI row with the CURRENT canonical AM from storeMap
    const wkKpisWithAM = wkKpis.map(k => ({ ...k, _am: safeGetAM(k.Branch) }));
    const prevKpisWithAM = prevKpis.map(k => ({ ...k, _am: safeGetAM(k.Branch) }));

    const areaImprovementPoints = {};
    validAMs.forEach(am => areaImprovementPoints[am] = 0);

    metrics.forEach(m => {
      const areaDeltas = validAMs.map(am => {
        const curr = wkKpisWithAM.filter(k => k._am === am);
        const prev = prevKpisWithAM.filter(k => k._am === am);
        if(!curr.length || !prev.length) return { am, gain: -999999 };
        const cAvg = curr.reduce((a,b) => a + (_finiteOr0(b[m.id])), 0) / curr.length;
        const pAvg = prev.reduce((a,b) => a + (_finiteOr0(b[m.id])), 0) / prev.length;
        const gain = m.order === 'desc' ? (cAvg - pAvg) : (pAvg - cAvg);
        return { am, gain };
      });
      areaDeltas.sort((a,b) => b.gain - a.gain);
      areaDeltas.forEach((item, idx) => { areaImprovementPoints[item.am] += (5 - idx); });
    });

    const winner = Object.entries(areaImprovementPoints).sort((a,b) => b[1] - a[1])[0];
    if(winner) { await idbPut('area_winners_log', { Year: year, Week: week, Winner: winner[0], Score: winner[1] }); }

    for(const am of validAMs){

  const areaStores = wkKpisWithAM.filter(k => k._am === am);
  const prevStores = prevKpisWithAM.filter(k => k._am === am);

  for(const m of metrics){

    let validStores = areaStores;
    if (m.order === 'asc'){
      validStores = areaStores.filter(x => _finiteOr0(x[m.id]) > 0);
    }

    if(!validStores.length) continue;

    // PERFORMANCE WINNER
    const sorted = [...validStores].sort((a,b)=>
      m.order==='desc'
        ? (_finiteOr0(b[m.id])-_finiteOr0(a[m.id]))
        : (_finiteOr0(a[m.id])-_finiteOr0(b[m.id]))
    );

    if(sorted[0]){
      await idbPut('store_winners_log',{
        Year: year,
        Week: week,
        Metric: m.id,
        Branch: sorted[0].Branch
      });
    }

    // TREND WINNER
    const trendWinner = calculateTrendWinner(validStores, prevStores, m.id, m.order === 'asc');

    if(trendWinner && trendWinner.change > 0){
      await idbPut('store_winners_log',{
        Year: year,
        Week: week,
        Metric: m.id + " (Improvement)",
        Branch: trendWinner.branch
      });
    }

  }
}
  }
}

function _periodWeeks(period, latestWeek){
  const maxW = Math.max(1, latestWeek||1);
  if(period==='q1') return {from:1, to:Math.min(13,maxW)};
  if(period==='q2') return {from:14, to:Math.min(26,maxW)};
  if(period==='q3') return {from:27, to:Math.min(39,maxW)};
  if(period==='q4') return {from:40, to:Math.min(53,maxW)};
  return {from:1, to:maxW};
}

// Resolve metric column: prefer the 'actual' header directly; fall back to base index
function _metricCol(headers, key, actualKey) {
  actualKey = actualKey || key;
  // Try exact containment first
  const actIdx = headers.findIndex(x => x.includes(actualKey));
  if (actIdx >= 0) return actIdx;
  const baseIdx = headers.findIndex(x => x.includes(key));
  if (baseIdx >= 0) return baseIdx;
  // Fallback: try prefix match (e.g. 'sandwch' matches 'sandwiches')
  const shortKey = key.slice(0, 5);
  const prefIdx = headers.findIndex(x => x.startsWith(shortKey));
  return prefIdx >= 0 ? prefIdx : -1;
}

function findCols(rows){
  for(let r=0; r<Math.min(rows.length, 50); r++){
    if(!rows[r]) continue;
    let maxCols = Math.max(rows[r].length || 0, (rows[r+1] ? rows[r+1].length : 0) || 0);
    let headers = [];
    for(let c=0; c<maxCols; c++) {
      let h1 = String(rows[r][c] || '').toLowerCase().replace(/[^a-z0-9%]+/g, '');
      let h2 = (rows[r+1] && rows[r+1][c]) ? String(rows[r+1][c] || '').toLowerCase().replace(/[^a-z0-9%]+/g, '') : '';
      headers.push(h1 + h2);
    }
    const idxB = headers.findIndex(x => x === 'branch' || x === 'store' || x === 'shop' || x.includes('branchname') || x === 'name');
    if(idxB >= 0) {
      let hasSubHeader = rows[r+1] && rows[r+1].some(x => String(x).toLowerCase().includes('actual') || String(x).toLowerCase().includes('target'));
      let idxS = headers.findIndex(x => x.includes('salesdifference'));
      if(idxS === -1) {
          let actS = headers.findIndex(x => x.includes('actualsales') || x === 'sales');
          if(actS !== -1 && headers[actS+1] && headers[actS+1].includes('difference')) idxS = actS + 1;
      }
      // Fallback: newer templates (Wk19+) removed "Actual Sales" — match sales difference directly
      if(idxS === -1) {
          idxS = headers.findIndex(x => x.includes('differencetotarget'));
      }
          // NEW: capture Actual Sales (£) column for size-based banding
    let idxSA = headers.findIndex(x => String(x||'').includes('actualsales'));
let idxL = headers.findIndex(x => x.includes('wagesasa%') || x.includes('wagesas') || x.includes('labour%') || x.includes('wages%'));
      return {
        hr: hasSubHeader ? r + 1 : r, idxB: idxB, idxS: idxS, idxSA: idxSA,
        idxP: _metricCol(headers, 'producttarget', 'productactual'),
        idxW: headers.findIndex(x => x.includes('waste%') || x.includes('wastage') || x === 'waste'), 
        idxL: idxL, idxA: headers.findIndex(x => x.includes('atv') && !x.includes('target')), 
        idxE: headers.findIndex(x => x.includes('energy') || x.includes('green') || x.includes('kwh')),
        idxFR: _metricCol(headers, 'filledrolls', 'filledrollsactual'),
        idxSW: _metricCol(headers, 'sandwiches', 'sandwichesactual'),
        idxHR: _metricCol(headers, 'filledrollhot', 'filledrollhotactual'),
        idxHB: _metricCol(headers, 'hotbeverage', 'hotbeverageactual')
      };
    }
  }
  // Second pass: if we found the branch column but product columns were missing,
  // try scanning nearby rows for product headers
  for(let r=0; r<Math.min(rows.length, 50); r++){
    if(!rows[r]) continue;
    let maxCols = Math.max(rows[r].length || 0, (rows[r+1] ? rows[r+1].length : 0) || 0);
    let headers = [];
    for(let c=0; c<maxCols; c++) {
      let h1 = String(rows[r][c] || '').toLowerCase().replace(/[^a-z0-9%]+/g, '');
      let h2 = (rows[r+1] && rows[r+1][c]) ? String(rows[r+1][c] || '').toLowerCase().replace(/[^a-z0-9%]+/g, '') : '';
      headers.push(h1 + h2);
    }
    const idxB = headers.findIndex(x => x === 'branch' || x === 'store' || x === 'shop' || x.includes('branchname') || x === 'name');
    if(idxB >= 0) {
      let hasSubHeader = rows[r+1] && rows[r+1].some(x => String(x).toLowerCase().includes('actual') || String(x).toLowerCase().includes('target'));
      let idxS = headers.findIndex(x => x.includes('salesdifference'));
      if(idxS === -1) {
          let actS = headers.findIndex(x => x.includes('actualsales') || x === 'sales');
          if(actS !== -1 && headers[actS+1] && headers[actS+1].includes('difference')) idxS = actS + 1;
      }
      if(idxS === -1) idxS = headers.findIndex(x => x.includes('differencetotarget'));
      let idxSA = headers.findIndex(x => String(x||'').includes('actualsales'));
      let idxL = headers.findIndex(x => x.includes('wagesasa%') || x.includes('wagesas') || x.includes('labour%') || x.includes('wages%'));
      let idxFR = _metricCol(headers, 'filledrolls', 'filledrollsactual');
      let idxSW = _metricCol(headers, 'sandwiches', 'sandwichesactual');
      let idxHR = _metricCol(headers, 'filledrollhot', 'filledrollhotactual');
      let idxHB = _metricCol(headers, 'hotbeverage', 'hotbeverageactual');
      // Try row r-1, r+2, r+3 for missing product columns
      for(let adj of [r-1, r+2, r+3]) {
        if(adj < 0 || adj >= rows.length || !rows[adj]) continue;
        let adjH = [];
        for(let c=0; c<maxCols; c++) {
          adjH.push(String(rows[adj][c] || '').toLowerCase().replace(/[^a-z0-9%]+/g, ''));
        }
        if(idxFR === -1) idxFR = _metricCol(adjH, 'filledrolls', 'filledrollsactual');
        if(idxSW === -1) idxSW = _metricCol(adjH, 'sandwiches', 'sandwichesactual');
        if(idxHR === -1) idxHR = _metricCol(adjH, 'filledrollhot', 'filledrollhotactual');
        if(idxHB === -1) idxHB = _metricCol(adjH, 'hotbeverage', 'hotbeverageactual');
        if(idxSA === -1) idxSA = adjH.findIndex(x => String(x||'').includes('actualsales'));
      }
      return {
        hr: hasSubHeader ? r + 1 : r, idxB: idxB, idxS: idxS, idxSA: idxSA,
        idxP: _metricCol(headers, 'producttarget', 'productactual'),
        idxW: headers.findIndex(x => x.includes('waste%') || x.includes('wastage') || x === 'waste'), 
        idxL: idxL, idxA: headers.findIndex(x => x.includes('atv') && !x.includes('target')), 
        idxE: headers.findIndex(x => x.includes('energy') || x.includes('green') || x.includes('kwh')),
        idxFR: idxFR, idxSW: idxSW, idxHR: idxHR, idxHB: idxHB
      };
    }
  }
  return null;
}

// Find columns starting from a specific row offset (for multi-section sheets)
function findColsFrom(rows, startRow) {
  for(let r = startRow; r < Math.min(rows.length, startRow + 5); r++){
    if(!rows[r]) continue;
    let maxCols = Math.max(rows[r].length || 0, (rows[r+1] ? rows[r+1].length : 0) || 0);
    let headers = [];
    for(let c=0; c<maxCols; c++) {
      let h1 = String(rows[r][c] || '').toLowerCase().replace(/[^a-z0-9%]+/g, '');
      let h2 = (rows[r+1] && rows[r+1][c]) ? String(rows[r+1][c] || '').toLowerCase().replace(/[^a-z0-9%]+/g, '') : '';
      headers.push(h1 + h2);
    }
    const idxB = headers.findIndex(x => x === 'branch' || x === 'store' || x === 'shop' || x.includes('branchname') || x === 'name');
    if(idxB >= 0) {
      let hasSubHeader = rows[r+1] && rows[r+1].some(x => String(x).toLowerCase().includes('actual') || String(x).toLowerCase().includes('target'));
      let idxS = headers.findIndex(x => x.includes('salesdifference'));
      if(idxS === -1) {
          let actS = headers.findIndex(x => x.includes('actualsales') || x === 'sales');
          if(actS !== -1 && headers[actS+1] && headers[actS+1].includes('difference')) idxS = actS + 1;
      }
      // Fallback: newer templates (Wk19+) removed "Actual Sales" — match sales difference directly
      if(idxS === -1) {
          idxS = headers.findIndex(x => x.includes('differencetotarget'));
      }
    let idxSA = headers.findIndex(x => String(x||'').includes('actualsales'));
    let idxL = headers.findIndex(x => x.includes('wagesasa%') || x.includes('wagesas') || x.includes('labour%') || x.includes('wages%'));
      return {
        hr: hasSubHeader ? r + 1 : r, idxB: idxB, idxS: idxS, idxSA: idxSA,
        idxP: _metricCol(headers, 'producttarget', 'productactual'),
        idxW: headers.findIndex(x => x.includes('waste%') || x.includes('wastage') || x === 'waste'),
        idxL: idxL, idxA: headers.findIndex(x => x.includes('atv') && !x.includes('target')),
        idxE: headers.findIndex(x => x.includes('energy') || x.includes('green') || x.includes('kwh')),
        idxFR: _metricCol(headers, 'filledrolls', 'filledrollsactual'),
        idxSW: _metricCol(headers, 'sandwiches', 'sandwichesactual'),
        idxHR: _metricCol(headers, 'filledrollhot', 'filledrollhotactual'),
        idxHB: _metricCol(headers, 'hotbeverage', 'hotbeverageactual')
      };
    }
  }
  return null;
}

// Scan a sheet for multiple week sections.
// Returns [{week, cols, dataStart, dataEnd}] sorted by dataStart.
// Each section is bounded by a "Week X" / "Wk X" label row above the column headers.
function findWeekSections(rows) {
  const sections = [];
  const MAX_WK = 53;
  // Pass 1: find rows that look like week labels
  const weekLabelRows = [];
  for (let r = 0; r < rows.length; r++) {
    if (!rows[r]) continue;
    for (let c = 0; c < (rows[r].length || 0); c++) {
      const cell = String(rows[r][c] || '').trim();
      // Match "Week 1", "Wk 1", "Wk01", "Week45", "WEEK 12", etc.
      const wkMatch = cell.match(/^(?:Week|Wk)\s*(\d{1,2})$/i);
      if (wkMatch) {
        const wk = parseInt(wkMatch[1], 10);
        if (wk >= 1 && wk <= MAX_WK) {
          weekLabelRows.push({ row: r, week: wk });
        }
      }
    }
  }
  // Pass 2: for each week label, look ahead 1-5 rows for column headers
  for (const wl of weekLabelRows) {
    const cols = findColsFrom(rows, wl.row + 1);
    if (cols) {
      sections.push({ week: wl.week, cols: cols, headerRow: wl.row });
    }
  }
  // Pass 3: if no week labels found, fall back to single-section with findCols
  if (sections.length === 0) {
    const cols = findCols(rows);
    if (cols) {
      sections.push({ week: 0, cols: cols, headerRow: -1 });
    }
  }
  // Sort by header row position
  sections.sort((a, b) => a.headerRow - b.headerRow);
  // Assign dataEnd: each section's data runs from its dataStart to the next section's headerRow
  for (let i = 0; i < sections.length; i++) {
    sections[i].dataStart = sections[i].cols.hr + 1;
    sections[i].dataEnd = (i + 1 < sections.length) ? sections[i + 1].headerRow : rows.length;
  }
  return sections;
}

function parseDateSafe(val) {
    if(!val || String(val).includes('#')) return null;
    if(!isNaN(val) && Number(val) > 20000 && Number(val) < 100000) return new Date(Math.round((Number(val) - 25569)*86400*1000));
    let s = String(val).trim();
    let d = new Date(s);
    if(isNaN(d.getTime())) {
        const ukDateMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if(ukDateMatch) {
            let year = parseInt(ukDateMatch[3], 10);
            if(year < 100) year += 2000;
            return new Date(year, parseInt(ukDateMatch[2], 10) - 1, parseInt(ukDateMatch[1], 10));
        }
        return null;
    }
    return d;
}

function escapeHtml(v){ return String(v ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])); }
function normalizeAuditCell(v){
  if(v === undefined || v === null) return '';
  let s = String(v).trim();
  try { if(s.startsWith('[')) { const parsed = JSON.parse(s.replace(/'/g, '"')); if(Array.isArray(parsed)) return parsed.join(', '); } } catch(e) {}
  return s.replace(/^\["?|"?\]$/g, '').replace(/"/g, '').replace(/Â/g, '').replace(/â€™/g, "'").replace(/â/g, '').trim();
}
function normalizeActionStatus(v){ const s = normalizeAuditCell(v).toLowerCase(); if(s.includes('closed')) return 'Closed'; if(s.includes('open')) return 'Open'; if(s === 'status') return 'Status'; return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Open'; }
function normalizeYesNo(v){ const s = normalizeAuditCell(v).toLowerCase(); return (s === 'yes' || s === 'y' || s === 'true' || s === 'critical') ? 'Yes' : 'No'; }

const MAX_WEEK = 52; let __ingestMem = []; let __missingByYear = {};
function resolveWeekYear(fileName, wb){
  let week = 0; let year = 0; let evidence = [];
  const mW = fileName.match(/Wk\s*(\d{1,2})/i); if(mW){ week = parseInt(mW[1],10); evidence.push('filename:Wk'+week); }
  const mY = fileName.match(/(20\d{2})/); if(mY){ year = parseInt(mY[1],10); evidence.push('filename:'+year); }
  if(week && (week<1 || week>MAX_WEEK)) week = 0; if(year && year<2000) year = 0;
  return {week, year, evidence:evidence.join(',')};
}
//
// PATCH30B6 NOTE
// Legacy previous-week logic still active.
// Replace with actual available-week lookup in PATCH30B7.
//


function getPreviousAvailableWeek(
    currentWeek,
    currentYear,
    allRows
){
    try{

        const weeks = [...new Set(
            allRows
            .filter(r =>
                (r.Year || currentYear)
                == currentYear
            )
            .map(r => r.Week)
        )]
        .filter(w => w < currentWeek)
        .sort((a,b)=>b-a);

        if(weeks.length){
            return {
                week: weeks[0],
                year: currentYear
            };
        }

        return prevPair(
            currentWeek,
            currentYear
        );

    }catch(err){

        return prevPair(
            currentWeek,
            currentYear
        );

    }
}


function prevPair(week, year){
    if(week===1)
        return {
            week:MAX_WEEK,
            year:year-1
        };

    return {
        week:week-1,
        year:year
    };
}

async function logIngest(entry){ const e = Object.assign({ts:Date.now()}, entry||{}); __ingestMem.unshift(e); __ingestMem = __ingestMem.slice(0,400); try{ if(db && db.objectStoreNames.contains('ingest_log')) await idbAdd('ingest_log', e); }catch(err){} }
function computeMissingWeeks(seenByYear){ const missing = {}; Object.keys(seenByYear||{}).forEach(y=>{ const set = seenByYear[y]; const arr = Array.from(set||[]).sort((a,b)=>a-b); const max = arr.length ? arr[arr.length-1] : 0; const miss = []; for(let w=1; w<=max; w++){ if(!set.has(w)) miss.push(w); } if(miss.length) missing[y]=miss; }); return missing; }
function formatMissingBadge(m){ const years = Object.keys(m||{}); if(!years.length) return ''; return '️ ' + years.map(y=>'Y'+y+': missing '+(m[y]||[]).length+'wk').join(' • '); }

async function renderMissingWeeksReport() {
    const raw = await idbGetAll('kpi');
    const byYear = {};
    raw.forEach(k => {
        const yr = k.Year || currentAwardsYear || new Date().getFullYear();
        const wk = k.Week;
        if (!byYear[yr]) byYear[yr] = new Set();
        byYear[yr].add(wk);
    });
    const seenWeeksByYear = {};
    for (const [yr, set] of Object.entries(byYear)) seenWeeksByYear[yr] = set;
    const missing = computeMissingWeeks(seenWeeksByYear);
    const years = Object.keys(missing).sort((a,b) => b - a);
    let rows = '';
    years.forEach(y => {
        const weeks = missing[y];
        const expectedMax = Math.max(...[...byYear[y]]);
        const totalExpected = expectedMax;
        const totalGot = byYear[y].size;
        const pct = ((totalGot / totalExpected) * 100).toFixed(0);
        weeks.forEach(w => {
            rows += `<tr class="border-b border-birds-border-light"><td class="px-3 py-2 font-bold text-birds-dark">${y}</td><td class="px-3 py-2">Week ${w}</td><td class="px-3 py-2"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Missing</span></td></tr>`;
        });
    });
    const totalMissing = years.reduce((a, y) => a + missing[y].length, 0);
    document.getElementById('mainView').innerHTML = `
      <div class="mb-6">
        <button onclick="setView('overview')" class="text-sm font-bold text-slate-500 hover:text-slate-700 mb-2">&larr; Back to Overview</button>
        <h2 class="text-[36px] font-black birds-green">Missing Weeks Report</h2>
        <p class="text-sm text-slate-500 font-bold mt-1">Weeks expected but not found in the KPI data after file ingestion.</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="card p-4 text-center"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Missing</p><h3 class="text-3xl font-black text-amber-600 mt-1">${totalMissing}</h3></div>
        <div class="card p-4 text-center"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Years Affected</p><h3 class="text-3xl font-black text-birds-dark mt-1">${years.length}</h3></div>
        <div class="card p-4 text-center"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">KPI Records Loaded</p><h3 class="text-3xl font-black text-birds-green mt-1">${raw.length}</h3></div>
      </div>
      ${years.length ? `
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead><tr class="bg-birds-warmwhite border-b border-birds-border"><th class="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Year</th><th class="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Week</th><th class="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<div class="card p-8 text-center"><p class="text-lg font-black text-birds-green">All expected weeks present</p><p class="text-sm text-slate-500 mt-2">No missing weeks detected in the loaded data.</p></div>'}`;
}
window.renderMissingWeeksReport = renderMissingWeeksReport;

function getTrendStr(currVal, prevVal, isInverse=false, format='percent') {
 if(prevVal === undefined || isNaN(prevVal) || currVal === prevVal) return `<div class="trend-wrap"><span class="trend-flat">—</span><div class="spark spark-flat"></div></div>`;
 const diff = currVal - prevVal; const absDiff = Math.abs(diff); let fmt = '';
 if(format === 'percent') fmt = `${(absDiff*100).toFixed(1)}%`; else if(format === 'currency') fmt = `£${absDiff.toFixed(2)}`; else if(format === 'whole') fmt = absDiff.toFixed(0); else if(format === 'decimal') fmt = absDiff.toFixed(1);
 const good = isInverse ? diff < 0 : diff > 0; const arrow = diff > 0 ? '▲' : '▼';
 return good ? `<div class="trend-wrap"><span class="trend-up">${arrow} ${fmt}</span><div class="spark spark-up"></div></div>` : `<div class="trend-wrap"><span class="trend-down">${arrow} ${fmt}</span><div class="spark spark-down"></div></div>`;
}

function ringSVG(pct, stroke='#5B8C7A'){
 const p = Math.max(0, Math.min(100, Number(pct) || 0)); const dash = p.toFixed(1);
 return `<div class="relative w-20 h-20 mx-auto mt-1"><svg viewBox="0 0 36 36" class="w-full h-full"><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0-31.831" fill="none" stroke="rgba(15,23,42,.10)" stroke-width="3"/><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831" fill="none" stroke="${stroke}" stroke-linecap="round" stroke-width="3" stroke-dasharray="${dash}, 100"/></svg><div class="absolute inset-0 flex items-center justify-center font-black text-lg text-slate-800">${p.toFixed(1)}%</div></div>`;
}

window.changeTimeFilter = function(val) { currentTimeFilter = val; renderDashboard(); };

function aggregateData(dataArray) {
    const map = new Map();
    // THE NEW FILTER: Exclude anomalous weeks entirely from aggregations
    dataArray.filter(d => !d.IsAnomaly).forEach(d => {
        const branchId = d.BranchId || canonicalStoreId(d.Branch); const am = storeMap.get(branchId) || 'Unassigned'; 
        if(!map.has(branchId)) map.set(branchId, { Branch: d.Branch, AM: am, count:0, Sales:0, Product:0, Waste:0, Labour:0, ATV:0, Energy:0, FilledRolls:0, Sandwiches:0, HotRolls:0, HotBev:0 });
        let obj = map.get(branchId); obj.count++; obj.Sales += d.Sales || 0; obj.Product += d.Product || 0; obj.Waste += d.Waste || 0; obj.Labour += d.Labour || 0; obj.ATV += d.ATV || 0; obj.Energy += d.Energy || 0; obj.FilledRolls += d.FilledRolls || 0; obj.Sandwiches += d.Sandwiches || 0; obj.HotRolls += d.HotRolls || 0; obj.HotBev += d.HotBev || 0;
    });
    return Array.from(map.values()).map(o => ({ Branch: o.Branch, AM: o.AM, Sales: o.Sales/o.count, Product: o.Product/o.count, Waste: o.Waste/o.count, Labour: o.Labour/o.count, ATV: o.ATV/o.count, Energy: o.Energy/o.count, FilledRolls: o.FilledRolls/o.count, Sandwiches: o.Sandwiches/o.count, HotRolls: o.HotRolls/o.count, HotBev: o.HotBev/o.count }));
}

window.BirdsPDF = {
    async exportElement(elementId, fileName = 'Report.pdf'){
        const target = document.getElementById(elementId);
        if(!target){ alert('Export target not found: ' + elementId); return false; }
        try{
            const canvas = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = 210; const pageHeight = 297;
            const imgWidth = pageWidth;
            const imgHeight = canvas.height * imgWidth / canvas.width;
            let heightLeft = imgHeight;
            let position = 0;
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
            while(heightLeft > 0){
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }
            pdf.save(fileName);
            return true;
        }catch(err){ console.error(err); alert('PDF export failed.'); return false; }
    }
};

window.isAdmin = function(){ return false; };

// === safeDownload: reliable cross-browser file download ===
// Chrome/Edge on localhost require the anchor to be in the DOM before clicking.
// Usage: safeDownload(blobOrString, filename, mimeType)
window.safeDownload = function(content, name, mime) {
  var blob = (content instanceof Blob) ? content : new Blob([content], { type: mime || 'application/octet-stream' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
};

// === U namespace: toast notifications ===
window.U = window.U || {};
window.U.toast = window.U.toast || function(msg) {
  var toast = document.getElementById('saveToast');
  if (toast) {
    toast.textContent = msg || 'Saved';
    toast.style.opacity = '1';
    clearTimeout(U._toastTimer);
    U._toastTimer = setTimeout(function() { toast.style.opacity = '0'; }, 2000);
  }
};
