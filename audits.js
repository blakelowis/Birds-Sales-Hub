// ===== AUDIT ACTION HUB PRO =====
// Advanced filters, drill-downs, SLA flags and structured PDF export.
let __auditHubCache = [];
let __auditHubCurrentRows = [];
let __auditHubSort = { key: 'risk', dir: 'desc' };

function actionStoreName(a){ return cleanStoreName(a.Store || a['Store Name'] || a.StoreName || (a.StoreEmail ? String(a.StoreEmail).split('@')[0] : '') || 'Unknown Store'); }
function actionAreaName(a){ const store = actionStoreName(a); const area = a.AreaManager || a.AM || safeGetAM(store) || 'Unassigned'; return area === 'Area Manager' ? safeGetAM(store) : area; }
function actionSectorName(a){ return normalizeAuditCell(a.Sector) || 'Uncategorised'; }
function actionCategoryName(a){ return normalizeAuditCell(a.Category) || 'Uncategorised'; }
function actionIsClosed(a){ return normalizeActionStatus(a.Status) === 'Closed'; }
function actionIsCritical(a){ return normalizeYesNo(a.Critical) === 'Yes'; }
function fmtDays(v){ const n = Number(v); return Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '—'; }
function pct(part, total){ return total ? Math.round((part / total) * 1000) / 10 : 0; }
function countBy(arr, fn){ const m = new Map(); arr.forEach(x => { const k = fn(x) || 'Unknown'; m.set(k, (m.get(k)||0)+1); }); return Array.from(m.entries()).sort((a,b)=>b[1]-a[1] || String(a[0]).localeCompare(String(b[0]))); }
function buildStatusBreakdown(arr, keyFn){
  const m = new Map();
  arr.forEach(a => {
    const k = keyFn(a) || 'Unknown';
    if(!m.has(k)) m.set(k, {name:k, open:0, closed:0, critical:0, total:0});
    const o = m.get(k); o.total++;
    if(actionIsClosed(a)) o.closed++; else o.open++;
    if(actionIsCritical(a)) o.critical++;
  });
  return Array.from(m.values()).sort((a,b)=>b.open-a.open || b.total-a.total || a.name.localeCompare(b.name));
}
function auditDateValue(a){ return parseDateSafe(a.AuditDate || a.Date || a.auditDate); }
function daysOpenNow(a){ if(actionIsClosed(a)) return Number(a.DaysToClose); const d = auditDateValue(a); return d ? Math.max(0, (new Date() - d) / 86400000) : Number(a.DaysOpen); }
function riskScore(a){ let score = 0; if(!actionIsClosed(a)) score += 20; if(actionIsCritical(a)) score += 30; const d = daysOpenNow(a); if(Number.isFinite(d)) score += Math.min(50, d); return score; }
function slaBucket(a){
  if(actionIsClosed(a)) return 'Closed';
  const d = daysOpenNow(a);
  if(actionIsCritical(a) && Number.isFinite(d) && d > 2) return 'Critical > 48h';
  if(Number.isFinite(d) && d > 30) return 'Open > 30 days';
  if(Number.isFinite(d) && d > 14) return 'Open > 14 days';
  if(Number.isFinite(d) && d > 7) return 'Open > 7 days';
  return 'In SLA / New';
}
function closureQuality(a){
  if(!actionIsClosed(a)) return 'Open';
  const h = normalizeAuditCell(a.HowClosed || '');
  const c = normalizeAuditCell(a.ExtraComment || '');
  if(!h && !c) return 'Closed - no comment';
  if((h + ' ' + c).length < 12) return 'Closed - short comment';
  return 'Closed - comment added';
}
function auditIssueTheme(a){
  const text = [a.Question, a.Description, a.ActionNeeded, a.Category, a.Sector].map(x => normalizeAuditCell(x).toLowerCase()).join(' ').replace(/\u00a0/g, ' ');
  if(/hair\s*net|hairnet|garnet|hair covering|hair coverings/.test(text)) return 'Hairnets / hair coverings not worn';
  if(/probe.*calibrat|calibrat.*probe|test caps/.test(text)) return 'Probe calibration overdue / missing';
  if(/scale.*calibrat|calibrat.*scale|shop scales|scales recorded/.test(text)) return 'Scale calibration / scales issue';
  if(/out of date|use by|use-by|date checking|stock rotated|stock rotation|unlabelled|unlabeled|labelled|labeled|labelling|labeling|day opened|date label/.test(text)) return 'Out of date / stock rotation / labelling';
  if(/multiplug|multi plug|extension lead|extension leads|adaptors|adapter/.test(text)) return 'Multiplugs / extension leads in use';
  if(/emergency lighting|emergency light|exit sign|fire exit signs|illuminated|zone map/.test(text)) return 'Emergency lighting / exit signage issues';
  if(/fire alarm|detection|call point|alarm system|fire safety checks|flick test/.test(text)) return 'Fire alarm / detection system issues';
  if(/fire door|fire doors|fire exit door|escape routes|escape route|obstruction|opened immediately|push bar|wedged open|propped open/.test(text)) return 'Fire doors / escape routes issues';
  if(/glass breakage|glass clean/.test(text)) return 'Glass breakage kit missing';
  if(/opening time|opening hours/.test(text)) return 'Opening times signage missing';
  if(/\bbin\b|\bbins\b|lidded/.test(text)) return 'Bins / waste containers need lids';
  const fallback = normalizeAuditCell(a.Description) || normalizeAuditCell(a.Question) || normalizeAuditCell(a.ActionNeeded);
  return fallback || 'Uncategorised';
}
function sameQuestionKey(a){ return normalizeAuditCell(a.Question) || normalizeAuditCell(a.QuestionID) || auditIssueTheme(a); }
function shortQuestionLabel(q, maxLen=96){
  const s = normalizeAuditCell(q);
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

// Reads Open/ and Closed/ JSON files directly from SharePoint or local folder.
// No IndexedDB caching — two folders are the source of truth.
// Open JSON = open actions. If a matching questionId exists in Closed/, it's closed.
async function getAuditActionsForReport(){
  var all = [];
  try {
    var rawOpen = await readJsonFolder('Open');
    var rawClosed = await readJsonFolder('Closed');
    // Build lookup of closed actions by questionId
    var closedMap = {};
    rawClosed.forEach(function(f) {
      if (f.questionId) {
        closedMap[f.questionId] = {
          closedOn: f.closedOn || '',
          howClosed: f.howClosed || '',
          extraComment: f.extraComment || ''
        };
      } else if (f.actions) {
        f.actions.forEach(function(a) {
          if (a.questionId) closedMap[a.questionId] = {
            closedOn: a.closedOn || '',
            howClosed: a.howClosed || '',
            extraComment: a.extraComment || ''
          };
        });
      }
    });
    // Process open files — only non-training
    rawOpen.forEach(function(f) {
      if (f.isTraining) return;
      if (!f.actions) return;
      var storeName = cleanStoreName(f.storeName || '');
      f.actions.forEach(function(a) {
        var closed = closedMap[a.questionId];
        all.push({
          ActionID: storeName + '_' + a.questionId + '_' + (f.date || ''),
          QuestionID: a.questionId || '',
          Store: storeName,
          StoreEmail: f.storeEmail || '',
          Auditor: f.auditor || '',
          Manager: f.manager || '',
          AreaManager: f.areaManager || '',
          AuditDate: f.date || '',
          Week: f.week || 0,
          Year: f.year || 0,
          Sector: a.sector || '',
          Category: a.category || '',
          Question: a.question || '',
          Answer: a.answer || '',
          Description: a.description || '',
          PersonResponsible: a.personResponsible || '',
          ActionNeeded: a.actionNeeded || '',
          Status: closed ? 'Closed' : a.status || 'Open',
          ClosedOn: closed ? (closed.closedOn || '') : (a.closedOn || ''),
          HowClosed: closed ? (closed.howClosed || '') : (a.howClosed || ''),
          ExtraComment: closed ? (closed.extraComment || '') : (a.extraComment || ''),
          Critical: a.critical || 'No',
          DaysToClose: null
        });
      });
    });
  } catch(e) {
    console.warn('[Audit] Failed to read Open/Closed folders:', e.message);
    return [];
  }
  // Normalize and compute derived fields
  return all.map(function(obj) {
    obj.Store = actionStoreName(obj);
    obj.AreaManager = actionAreaName(obj);
    obj.Sector = actionSectorName(obj);
    obj.Category = actionCategoryName(obj);
    obj.Status = normalizeActionStatus(obj.Status);
    obj.Critical = normalizeYesNo(obj.Critical);
    obj.Question = normalizeAuditCell(obj.Question || '');
    obj.Description = normalizeAuditCell(obj.Description || '');
    obj.ActionNeeded = normalizeAuditCell(obj.ActionNeeded || '');
    obj.PersonResponsible = normalizeAuditCell(obj.PersonResponsible || '');
    obj.QuestionID = normalizeAuditCell(obj.QuestionID || '');
    obj.Answer = normalizeAuditCell(obj.Answer || '');
    obj.HowClosed = normalizeAuditCell(obj.HowClosed || '');
    obj.ExtraComment = normalizeAuditCell(obj.ExtraComment || '');
    if (obj.ClosedOn) {
      var dOpen = parseDateSafe(obj.AuditDate);
      var dClosed = parseDateSafe(obj.ClosedOn);
      if (dOpen && dClosed) obj.DaysToClose = (dClosed - dOpen) / 86400000;
    }
    obj.IssueTheme = auditIssueTheme(obj);
    obj.SLABucket = slaBucket(obj);
    obj.ClosureQuality = closureQuality(obj);
    obj.RiskScore = riskScore(obj);
    return obj;
  }).filter(function(a) {
    var s = String(a.Store || '').toLowerCase();
    var q = String(a.Question || '').toLowerCase();
    if (['store name','data','question','status','sector'].includes(s)) return false;
    if (q === 'question' || !q) return false;
    return true;
  });
}
function getHubDateRange(period){
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startPrevMonth = new Date(today.getFullYear(), today.getMonth()-1, 1);
  const endPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
  const qStartMonth = Math.floor(today.getMonth()/3)*3;
  const startQuarter = new Date(today.getFullYear(), qStartMonth, 1);
  const startYear = new Date(today.getFullYear(), 0, 1);
  const minusDays = d => new Date(today.getFullYear(), today.getMonth(), today.getDate() - d);
  if(period === 'last7') return {from: minusDays(7), to: today};
  if(period === 'last30') return {from: minusDays(30), to: today};
  if(period === 'mtd') return {from: startOfMonth, to: today};
  if(period === 'prevmonth') return {from: startPrevMonth, to: endPrevMonth};
  if(period === 'qtd') return {from: startQuarter, to: today};
  if(period === 'ytd') return {from: startYear, to: today};
  if(period === 'custom') {
    const f = parseDateSafe(document.getElementById('auditFromDate')?.value); const t = parseDateSafe(document.getElementById('auditToDate')?.value);
    return {from:f, to:t};
  }
  return {from:null, to:null};
}
function applyAuditHubFilters(actions){
  const area = document.getElementById('auditAreaFilter')?.value || 'ALL';
  const sector = document.getElementById('auditSectorFilter')?.value || 'ALL';
  const category = document.getElementById('auditCategoryFilter')?.value || 'ALL';
  const store = document.getElementById('auditStoreFilter')?.value || 'ALL';
  const status = document.getElementById('auditStatusFilter')?.value || 'ALL';
  const critical = document.getElementById('auditCriticalFilter')?.value || 'ALL';
  const theme = document.getElementById('auditThemeFilter')?.value || 'ALL';
  const sla = document.getElementById('auditSlaFilter')?.value || 'ALL';
  const period = document.getElementById('auditPeriodFilter')?.value || 'all';
  const {from, to} = getHubDateRange(period);
  const q = (document.getElementById('auditSearch')?.value || '').toLowerCase().trim();
  return actions.filter(a => {
    if(area !== 'ALL' && a.AreaManager !== area) return false;
    if(sector !== 'ALL' && a.Sector !== sector) return false;
    if(category !== 'ALL' && a.Category !== category) return false;
    if(store !== 'ALL' && a.Store !== store) return false;
    if(status !== 'ALL' && a.Status !== status) return false;
    if(critical !== 'ALL' && a.Critical !== critical) return false;
    if(theme !== 'ALL' && a.Question !== theme) return false;
    if(sla !== 'ALL' && a.SLABucket !== sla) return false;
    const d = auditDateValue(a);
    if(from && (!d || d < from)) return false;
    if(to && (!d || d > new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23,59,59))) return false;
    if(q){ const blob = [a.Store,a.AreaManager,a.Sector,a.Category,a.Question,a.Description,a.ActionNeeded,a.PersonResponsible,a.Status,a.Critical,a.IssueTheme,a.HowClosed,a.ExtraComment].join(' ').toLowerCase(); if(!blob.includes(q)) return false; }
    return true;
  });
}
function sortAuditRows(rows){
  const {key, dir} = __auditHubSort; const mult = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a,b) => {
    let av, bv;
    if(key === 'risk'){ av = a.RiskScore; bv = b.RiskScore; }
    else if(key === 'days'){ av = Number(daysOpenNow(a)); bv = Number(daysOpenNow(b)); }
    else { av = String(a[key] || ''); bv = String(b[key] || ''); return av.localeCompare(bv) * mult; }
    av = Number.isFinite(av) ? av : -1; bv = Number.isFinite(bv) ? bv : -1; return (av-bv) * mult;
  });
}
function setAuditSort(key){ if(__auditHubSort.key === key) __auditHubSort.dir = __auditHubSort.dir === 'asc' ? 'desc' : 'asc'; else __auditHubSort = {key, dir:'desc'}; refreshAuditHubBody(); }
function hubKpi(label, value, sub='', colour='birds-green'){
  return `<div class="card p-5 border-t-4 ${colour==='red'?'border-t-red-500':colour==='amber'?'border-t-amber-400':'border-t-birds-green'}"><div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${label}</div><div class="text-3xl font-black ${colour==='red'?'text-red-600':colour==='amber'?'text-amber-600':'birds-green'}">${value}</div><div class="text-xs font-bold text-slate-500 mt-1">${sub}</div></div>`;
}
function breakdownHtml(title, rows, clickType){
  return `<div class="card p-5"><h3 class="font-black outfit text-sm uppercase tracking-widest text-slate-400 mb-4">${title}</h3>${rows.length ? rows.map(x=>`<button class="w-full text-left mb-3 hover:bg-slate-50 rounded-lg p-1" onclick="auditDrilldown('${clickType}','${encodeURIComponent(x.name)}')"><div class="flex justify-between text-xs font-black"><span>${escapeHtml(x.name)}</span><span>${x.open} open / ${x.closed} closed</span></div><div class="progress-bar mt-1"><div class="progress-fill-warn" style="width:${pct(x.open,x.total)}%"></div></div></button>`).join('') : '<p class="text-slate-400 italic">No data.</p>'}</div>`;
}
function tooltipTitle(a){ return escapeHtml(`Question: ${a.Question} Closed comment: ${a.HowClosed || '—'} Extra comment: ${a.ExtraComment || '—'}`); }
async function renderAuditActionHub(){
  // Read Open/ and Closed/ JSON files directly — two folders are the source of truth
  document.getElementById('mainView').innerHTML = '<div class="card p-12 text-center"><h2 class="text-3xl font-black outfit birds-green mb-2">Audit Action Hub</h2><p class="text-slate-500 font-bold mb-4">Loading actions from Open/ and Closed/ folders...</p></div>';
  __auditHubCache = await getAuditActionsForReport();
  if(!__auditHubCache.length){ document.getElementById('mainView').innerHTML = `<div class="card p-12 text-center"><h2 class="text-3xl font-black outfit birds-green mb-2">Audit Action Hub</h2><p class="text-slate-500 font-bold mb-4">No audit actions found. Check that your data folder has <b>Open/</b> and <b>Closed/</b> subfolders with JSON action files.</p></div>`; return; }
  const areas = [...new Set(__auditHubCache.map(a=>a.AreaManager))].sort();
  const sectors = [...new Set(__auditHubCache.map(a=>a.Sector))].sort();
  const categories = [...new Set(__auditHubCache.map(a=>a.Category))].sort();
  const stores = [...new Set(__auditHubCache.map(a=>a.Store))].sort();
  const themes = [...new Set(__auditHubCache.map(a=>a.Question))].sort();
  const slas = ['Critical > 48h','Open > 30 days','Open > 14 days','Open > 7 days','In SLA / New','Closed'];
  document.getElementById('mainView').innerHTML = `<div id="audit-export-card" class="space-y-6"><div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4"><div><h2 class="text-[36px] font-black outfit birds-green uppercase tracking-tight"> Audit Action Hub</h2><p class="text-slate-500 font-bold">Time filters, SLA flags, issue drill-down and closure evidence review.</p><span class="inline-flex items-center gap-1.5 mt-2 px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-xs font-bold text-emerald-700">✓ Local storage active</span></div><div class="flex flex-wrap gap-2 audit-export-controls"><button onclick="exportAuditActions('filtered')" class="btn" style="background: #555B6E; color: white; padding: 8px 16px; border-radius: 6px; font-weight: 800; font-size: 12px;">Export Current Filter</button><button onclick="exportAuditActions('full')" class="btn" style="background: #555B6E; color: white; padding: 8px 16px; border-radius: 6px; font-weight: 800; font-size: 12px;"> Full Export</button><button onclick="exportAuditPDF()" class="btn" style="background: var(--edwardian-rose); color: white; padding: 8px 16px; border-radius: 6px; font-weight: 800; font-size: 12px;"> PDF Summary</button></div></div>
    <div class="card p-5 audit-export-controls"><div class="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-8 gap-3"><select id="auditPeriodFilter" onchange="toggleAuditCustomDates();refreshAuditHubBody()" class="input-chip text-sm"><option value="all">All dates</option><option value="last7">Last 7 days</option><option value="last30">Last 30 days</option><option value="mtd">Month to date</option><option value="prevmonth">Previous month</option><option value="qtd">Quarter to date</option><option value="ytd">Year to date</option><option value="custom">Custom dates</option></select><select id="auditAreaFilter" onchange="refreshAuditHubBody()" class="input-chip text-sm"><option value="ALL">All Areas</option>${areas.map(a=>`<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('')}</select><select id="auditSectorFilter" onchange="refreshAuditHubBody()" class="input-chip text-sm"><option value="ALL">All Sectors</option>${sectors.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select><select id="auditCategoryFilter" onchange="refreshAuditHubBody()" class="input-chip text-sm"><option value="ALL">All Categories</option>${categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select><select id="auditStoreFilter" onchange="refreshAuditHubBody()" class="input-chip text-sm"><option value="ALL">All Stores</option>${stores.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select><select id="auditStatusFilter" onchange="refreshAuditHubBody()" class="input-chip text-sm"><option value="ALL">Open & Closed</option><option value="Open">Open</option><option value="Closed">Closed</option></select><select id="auditCriticalFilter" onchange="refreshAuditHubBody()" class="input-chip text-sm"><option value="ALL">All Criticality</option><option value="Yes">Critical only</option><option value="No">Non-critical only</option></select><select id="auditSlaFilter" onchange="refreshAuditHubBody()" class="input-chip text-sm"><option value="ALL">All SLA</option>${slas.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select></div><div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3"><select id="auditThemeFilter" onchange="refreshAuditHubBody()" class="input-chip text-sm"><option value="ALL">All Questions</option>${themes.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</select><input id="auditSearch" oninput="refreshAuditHubBody()" class="input-chip text-sm" placeholder="Search issue, question, closure comment..." /><div id="auditCustomDates" class="hidden grid grid-cols-2 gap-2"><input id="auditFromDate" type="date" onchange="refreshAuditHubBody()" class="input-chip text-sm"/><input id="auditToDate" type="date" onchange="refreshAuditHubBody()" class="input-chip text-sm"/></div></div></div><div id="auditReportBody" class="space-y-6"></div><div id="auditDrilldownPanel" class="hidden"></div></div>`;
  refreshAuditHubBody();
}
function toggleAuditCustomDates(){ const box = document.getElementById('auditCustomDates'); if(box) box.classList.toggle('hidden', (document.getElementById('auditPeriodFilter')?.value || 'all') !== 'custom'); }
async function refreshAuditHubBody(){
  const filtered = sortAuditRows(applyAuditHubFilters(__auditHubCache));   __auditHubCurrentRows = filtered;
  const regularActions = filtered;
  const total = regularActions.length, open = regularActions.filter(a=>!actionIsClosed(a)).length, closed = regularActions.filter(actionIsClosed).length, critical = regularActions.filter(actionIsCritical).length;
  const overdueCritical = regularActions.filter(a=>slaBucket(a)==='Critical > 48h').length;
  const noCloseComment = regularActions.filter(a=>closureQuality(a)==='Closed - no comment').length;
  const avgClose = (()=>{ const vals=regularActions.filter(actionIsClosed).map(a=>Number(a.DaysToClose)).filter(Number.isFinite); return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : '—'; })();
  const themes = countBy(regularActions, a=>a.IssueTheme).slice(0,10);
  const questions = countBy(regularActions, sameQuestionKey).slice(0,10);
  const areaBreak = buildStatusBreakdown(regularActions, a=>a.AreaManager).slice(0,10);
  const sectorBreak = buildStatusBreakdown(regularActions, a=>a.Sector).slice(0,10);
  const storeBreak = buildStatusBreakdown(regularActions, a=>a.Store).slice(0,15);
  const slaCounts = countBy(regularActions, slaBucket);
  function buildActionRow(a){
    const mainRow = `<tr class="border-b border-slate-100 align-top hover:bg-slate-50"><td class="p-3 font-black text-slate-700">${escapeHtml(a.Store)}</td><td class="p-3 text-slate-500 font-bold">${escapeHtml(a.AreaManager)}</td><td class="p-3 text-xs font-bold text-slate-500">${escapeHtml(a.Sector)}</td><td class="p-3"><span class="px-2 py-1 rounded-full text-[10px] font-black ${actionIsClosed(a)?'bg-emerald-50 text-slate-800':'bg-amber-50 text-amber-700'}">${escapeHtml(a.Status)}</span></td><td class="p-3"><span class="px-2 py-1 rounded-full text-[10px] font-black ${actionIsCritical(a)?'bg-red-50 text-red-700':'bg-slate-100 text-slate-500'}">${actionIsCritical(a)?'Critical':'No'}</span></td><td class="p-3"><button onclick="auditDrilldown('sla','${encodeURIComponent(a.SLABucket)}')" class="text-[10px] font-black px-2 py-1 rounded-full ${a.SLABucket.includes('Critical')?'bg-red-50 text-red-700':a.SLABucket.includes('Open >')?'bg-amber-50 text-amber-700':'bg-slate-100 text-slate-600'}">${escapeHtml(a.SLABucket)}</button></td><td class="p-3 text-xs text-slate-700 max-w-[420px]" title="${tooltipTitle(a)}"><button class="text-left hover:underline font-black" onclick="showAuditActionDetail(${a.ActionID || 0})">${escapeHtml(a.Description || a.Question)}</button><div class="text-slate-500 mt-1">${escapeHtml(a.ActionNeeded)}</div><button onclick="auditDrilldown('theme','${encodeURIComponent(a.IssueTheme)}')" class="text-[10px] font-black text-slate-400 mt-1 hover:text-birds-green">${escapeHtml(a.IssueTheme)}</button></td><td class="p-3 text-xs text-slate-600">${escapeHtml(a.PersonResponsible || '—')}</td><td class="p-3 text-xs font-black text-slate-700">${actionIsClosed(a) ? fmtDays(a.DaysToClose) : fmtDays(daysOpenNow(a))}</td></tr>`;
    if(actionIsClosed(a) && (a.HowClosed || a.ExtraComment)){
      const closureRow = `<tr class="border-b border-slate-100"><td colspan="9" class="px-3 pb-3 pt-0"><div class="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-6"><div class="flex-1"><span class="text-[10px] font-black text-blue-800 uppercase tracking-wide">Store Manager Action:</span> <span class="text-xs font-bold text-slate-700">${escapeHtml(a.HowClosed || '—')}</span></div>${a.ExtraComment ? `<div class="flex-1"><span class="text-[10px] font-black text-blue-800 uppercase tracking-wide">Additional Notes:</span> <span class="text-xs text-slate-600">${escapeHtml(a.ExtraComment)}</span></div>` : ''}</div></td></tr>`;
      return [mainRow, closureRow];
    }
    return [mainRow];
  }
  const rows = regularActions.map(a => buildActionRow(a)).join('');
  document.getElementById('auditReportBody').innerHTML = `<div class="grid grid-cols-1 md:grid-cols-6 gap-4">${hubKpi('Actions', total, 'current filter')}${hubKpi('Open', `${pct(open,total)}%`, `${open} actions`, 'amber')}${hubKpi('Closed', `${pct(closed,total)}%`, `${closed} actions`)}${hubKpi('Critical', critical, `${pct(critical,total)}%`, critical?'red':'birds-green')}${hubKpi('Critical > 48h', overdueCritical, 'needs escalation', overdueCritical?'red':'birds-green')}${hubKpi('Avg Close Time', avgClose, 'days closed')}</div><div class="grid grid-cols-1 xl:grid-cols-5 gap-6"><div class="card p-5"><h3 class="font-black outfit text-sm uppercase tracking-widest text-slate-400 mb-4">Most common issue themes</h3>${themes.map(([n,c])=>`<button class="flex justify-between gap-3 py-2 border-b border-slate-100 last:border-0 w-full text-left hover:bg-slate-50" onclick="auditDrilldown('theme','${encodeURIComponent(n)}')"><span class="text-xs font-bold text-slate-700">${escapeHtml(n)}</span><span class="font-black birds-green">${c}</span></button>`).join('') || '<p class="text-slate-400 italic">No matching actions.</p>'}</div><div class="card p-5"><h3 class="font-black outfit text-sm uppercase tracking-widest text-slate-400 mb-4">Question drill-down</h3>${questions.map(([n,c])=>`<button class="flex justify-between gap-3 py-2 border-b border-slate-100 last:border-0 w-full text-left hover:bg-slate-50" onclick="auditDrilldown('question','${encodeURIComponent(n)}')"><span class="text-xs font-bold text-slate-700 line-clamp-2" title="${escapeHtml(n)}">${escapeHtml(shortQuestionLabel(n))}</span><span class="font-black birds-green">${c}</span></button>`).join('') || '<p class="text-slate-400 italic">No questions.</p>'}</div>${breakdownHtml('SLA / overdue flags', slaCounts.map(([name,total])=>({name,total,open:filtered.filter(a=>slaBucket(a)===name && !actionIsClosed(a)).length,closed:filtered.filter(a=>slaBucket(a)===name && actionIsClosed(a)).length})), 'sla')}${breakdownHtml('Sector open vs closed', sectorBreak, 'sector')}${breakdownHtml('Store open vs closed', storeBreak, 'store')}</div><div class="grid grid-cols-1 lg:grid-cols-2 gap-6">${breakdownHtml('Area open vs closed', areaBreak, 'area')}<div class="card p-5"><h3 class="font-black outfit text-sm uppercase tracking-widest text-slate-400 mb-4">Closure quality</h3>${countBy(filtered, closureQuality).map(([n,c])=>`<button class="flex justify-between gap-3 py-2 border-b border-slate-100 last:border-0 w-full text-left hover:bg-slate-50" onclick="auditDrilldown('closure','${encodeURIComponent(n)}')"><span class="text-xs font-bold text-slate-700">${escapeHtml(n)}</span><span class="font-black birds-green">${c}</span></button>`).join('')}</div></div><div class="card overflow-hidden"><div class="p-5 flex flex-wrap gap-3 justify-between items-center border-b border-slate-100"><h3 class="font-black outfit text-xl birds-green">Action Detail</h3><div class="flex flex-wrap gap-2 audit-export-controls"><button onclick="setAuditSort('risk')" class="export-btn">Sort Risk</button><button onclick="setAuditSort('days')" class="export-btn">Sort Days</button><button onclick="setAuditSort('Store')" class="export-btn">Sort Store</button><span class="text-xs font-black text-slate-400 px-2 py-1">${total} rows • missing closure comments: ${noCloseComment}</span></div></div><div class="overflow-x-auto max-h-[760px] overflow-y-auto"><table class="w-full text-left text-sm"><thead class="bg-slate-50 sticky top-0 z-10"><tr><th class="p-3 text-[10px] uppercase text-slate-500 font-black">Store</th><th class="p-3 text-[10px] uppercase text-slate-500 font-black">Area</th><th class="p-3 text-[10px] uppercase text-slate-500 font-black">Sector</th><th class="p-3 text-[10px] uppercase text-slate-500 font-black">Status</th><th class="p-3 text-[10px] uppercase text-slate-500 font-black">Critical</th><th class="p-3 text-[10px] uppercase text-slate-500 font-black">SLA</th><th class="p-3 text-[10px] uppercase text-slate-500 font-black">Action / Issue</th><th class="p-3 text-[10px] uppercase text-slate-500 font-black">Responsible</th><th class="p-3 text-[10px] uppercase text-slate-500 font-black">Days</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="p-8 text-center text-slate-400 font-bold">No matching actions.</td></tr>'}</tbody></table></div></div>`;
}
function auditDrilldown(type, encodedValue){
  const val = decodeURIComponent(encodedValue || '');
  let rows = __auditHubCurrentRows.filter(a => type==='theme'?a.IssueTheme===val:type==='question'?sameQuestionKey(a)===val:type==='sla'?a.SLABucket===val:type==='sector'?a.Sector===val:type==='store'?a.Store===val:type==='area'?a.AreaManager===val:closureQuality(a)===val);
  renderAuditDrilldownPanel(`${type.toUpperCase()}: ${val}`, rows);
}
function renderAuditDrilldownPanel(title, rows){
  const panel = document.getElementById('auditDrilldownPanel'); if(!panel) return;
  panel.className = 'card p-6';
  panel.innerHTML = `<div class="flex justify-between items-start gap-4 mb-4"><div><h3 class="text-2xl font-black outfit birds-green">${escapeHtml(title)}</h3><p class="text-sm font-bold text-slate-500">${rows.length} actions. Click an action to view full detail.</p></div><button onclick="document.getElementById('auditDrilldownPanel').className='hidden'" class="btn-secondary">Close</button></div><div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">${rows.map(a=>`<button onclick="showAuditActionDetail(${a.ActionID || 0})" class="text-left p-4 rounded-xl border border-slate-200 hover:bg-slate-50"><div class="flex justify-between items-center mb-2"><span class="font-black text-slate-800">${escapeHtml(a.Store)}</span><span class="text-[10px] font-black ${actionIsClosed(a)?'text-emerald-600':'text-amber-600'}">${escapeHtml(a.Status)}</span></div><div class="text-xs font-bold text-slate-500 mb-2">${escapeHtml(a.Sector)} • ${escapeHtml(a.Category)} • ${escapeHtml(a.SLABucket)}</div><div class="font-bold text-sm text-slate-700 line-clamp-3 mb-3">${escapeHtml(a.Description || a.Question)}</div>${actionIsClosed(a) && (a.HowClosed || a.ExtraComment) ? `<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2"><div class="text-[10px] font-black text-blue-800 uppercase tracking-wide mb-1">Store Manager Action</div><div class="text-xs font-bold text-slate-700">${escapeHtml(a.HowClosed || '—')}</div>${a.ExtraComment ? `<div class="text-[10px] font-black text-blue-800 uppercase tracking-wide mt-2 mb-1">Additional Notes</div><div class="text-xs text-slate-600">${escapeHtml(a.ExtraComment)}</div>` : ''}</div>` : ''}<div class="text-xs text-slate-500"><b>Days:</b> ${actionIsClosed(a)?fmtDays(a.DaysToClose):fmtDays(daysOpenNow(a))}${a.ClosedOn ? ` • <b>Closed:</b> ${escapeHtml(a.ClosedOn)}` : ''}</div></button>`).join('')}</div>`;
  panel.scrollIntoView({behavior:'smooth', block:'start'});
}
function showAuditActionDetail(actionId){
  const a = __auditHubCache.find(x => String(x.ActionID) === String(actionId)) || __auditHubCurrentRows.find(x => String(x.ActionID) === String(actionId)); if(!a) return;
  renderAuditDrilldownPanel(`ACTION DETAIL: ${a.Store}`, [a]);
  const panel = document.getElementById('auditDrilldownPanel');
  panel.innerHTML = `<div class="flex justify-between items-start gap-4 mb-4"><div><h3 class="text-2xl font-black outfit birds-green">${escapeHtml(a.Store)} • ${escapeHtml(a.IssueTheme)}</h3><p class="text-sm font-bold text-slate-500">${escapeHtml(a.AreaManager)} • ${escapeHtml(a.Sector)} • ${escapeHtml(a.Category)}</p></div><button onclick="document.getElementById('auditDrilldownPanel').className='hidden'" class="btn-secondary">Close</button></div><div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">${hubKpi('Status', a.Status, a.Critical==='Yes'?'Critical':'Non-critical', actionIsClosed(a)?'birds-green':'amber')}${hubKpi('SLA', a.SLABucket, 'current state', a.SLABucket.includes('Critical')?'red':'amber')}${hubKpi('Days', actionIsClosed(a)?fmtDays(a.DaysToClose):fmtDays(daysOpenNow(a)), actionIsClosed(a)?'to close':'open')}${hubKpi('Closure Quality', a.ClosureQuality, '', a.ClosureQuality.includes('no')?'red':'birds-green')}</div><div class="grid grid-cols-1 lg:grid-cols-2 gap-5"><div class="card p-5"><h4 class="font-black text-slate-400 uppercase text-xs mb-3">Question / Issue</h4><p class="font-black text-slate-800 mb-3">${escapeHtml(a.Question)}</p><p class="text-sm text-slate-700 mb-3"><b>Description:</b> ${escapeHtml(a.Description || '—')}</p><p class="text-sm text-slate-700"><b>Action needed:</b> ${escapeHtml(a.ActionNeeded || '—')}</p></div><div class="card p-5"><h4 class="font-black text-slate-400 uppercase text-xs mb-3">Closure Evidence</h4><p class="text-sm text-slate-700 mb-3"><b>Closed on:</b> ${escapeHtml(a.ClosedOn || '—')}</p><p class="text-sm text-slate-700 mb-3"><b>How closed:</b> ${escapeHtml(a.HowClosed || '—')}</p><p class="text-sm text-slate-700"><b>Extra comment:</b> ${escapeHtml(a.ExtraComment || '—')}</p></div></div>`;
  panel.scrollIntoView({behavior:'smooth', block:'start'});
}
function auditRowsForExport(mode){ return mode === 'full' ? __auditHubCache : __auditHubCurrentRows; }
async function exportAuditActions(mode='filtered'){
  const data = auditRowsForExport(mode);
  const rows = data.map(a => ({ 'Area Manager': a.AreaManager, 'Store': a.Store, 'Sector': a.Sector, 'Category': a.Category, 'Issue Theme': a.IssueTheme, 'SLA Bucket': a.SLABucket, 'Closure Quality': a.ClosureQuality, 'Audit Date': a.AuditDate || '', 'Question ID': a.QuestionID || '', 'Question': a.Question || '', 'Answer': a.Answer || '', 'Description': a.Description || '', 'Person Responsible': a.PersonResponsible || '', 'Action Needed': a.ActionNeeded || '', 'Status': a.Status, 'Critical': a.Critical, 'Closed On': a.ClosedOn || '', 'Days To Close': actionIsClosed(a) ? fmtDays(a.DaysToClose) : '', 'Days Open': !actionIsClosed(a) ? fmtDays(daysOpenNow(a)) : '', 'How Closed': a.HowClosed || '', 'Extra Comment': a.ExtraComment || '' }));
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Audit Actions'); const stamp = new Date().toISOString().slice(0,10); XLSX.writeFile(wb, `Birds_Audit_Actions_${mode}_${stamp}.xlsx`);
}
function pdfClean(s){ return String(s ?? '').replace(/\s+/g,' ').trim(); }
function drawPdfHeader(pdf, title, subtitle){ pdf.setFillColor(135,157,130); pdf.rect(0,0,297,18,'F'); pdf.setTextColor(255,255,255); pdf.setFontSize(16); pdf.setFont(undefined,'bold'); pdf.text(title, 10, 11); pdf.setFontSize(8); pdf.setFont(undefined,'normal'); pdf.text(subtitle, 10, 16); pdf.setTextColor(57,68,60); if (window.__pdfLogo) { try { pdf.addImage(window.__pdfLogo, 'PNG', 258, 1, 28, 28); } catch(e){} } }
function pdfLine(pdf, text, x, y, maxW, size=8, style='normal'){ pdf.setFontSize(size); pdf.setFont(undefined, style); const lines = pdf.splitTextToSize(pdfClean(text), maxW); pdf.text(lines, x, y); return y + (lines.length * (size*0.38)) + 1.5; }
function pdfEnsure(pdf, y, needed=20){ if(y+needed > 200){ pdf.addPage(); drawPdfHeader(pdf,'Audit Action Hub','continued'); return 26; } return y; }
async function exportAuditPDF(){
  const rows = __auditHubCurrentRows || []; if(!rows.length){ alert('No rows to export.'); return; }
  if(typeof window.jspdf === 'undefined'){ alert('PDF library is still loading, please try again.'); return; }
  const { jsPDF } = window.jspdf; const pdf = new jsPDF('l','mm','a4'); const stamp = new Date().toISOString().slice(0,10);
  drawPdfHeader(pdf, 'Birds Audit Action Hub', `Summary export • ${rows.length} filtered actions • ${stamp}`);
  let y = 28; const total=rows.length, open=rows.filter(a=>!actionIsClosed(a)).length, closed=rows.filter(actionIsClosed).length, critical=rows.filter(actionIsCritical).length, overdue=rows.filter(a=>a.SLABucket==='Critical > 48h').length;
  const cards=[['Actions',total],['Open',`${pct(open,total)}% (${open})`],['Closed',`${pct(closed,total)}% (${closed})`],['Critical',critical],['Critical >48h',overdue]];
  cards.forEach((c,i)=>{ const x=10+i*55; pdf.setFillColor(251,250,246); pdf.roundedRect(x,y-8,48,18,2,2,'F'); pdf.setFontSize(7); pdf.setFont(undefined,'bold'); pdf.setTextColor(96,108,98); pdf.text(c[0],x+3,y-2); pdf.setFontSize(13); pdf.setTextColor(57,68,60); pdf.text(String(c[1]),x+3,y+6); }); y+=25;
  const sections=[['Top issue themes', countBy(rows,a=>a.IssueTheme).slice(0,10)], ['SLA flags', countBy(rows,slaBucket)], ['Sector breakdown', countBy(rows,a=>a.Sector).slice(0,10)], ['Closure quality', countBy(rows,closureQuality)]];
  sections.forEach((sec,idx)=>{ let x=10+(idx%2)*143; if(idx%2===0 && idx>0) y+=70; let yy=y; pdf.setFontSize(10); pdf.setFont(undefined,'bold'); pdf.setTextColor(96,117,95); pdf.text(sec[0],x,yy); yy+=6; pdf.setTextColor(57,68,60); sec[1].forEach(([n,c])=>{ pdf.setFontSize(7); pdf.text(pdfClean(n).slice(0,60),x,yy); pdf.text(String(c),x+125,yy,{align:'right'}); yy+=5; }); });
  pdf.addPage(); drawPdfHeader(pdf,'Audit Action Detail',`${rows.length} filtered actions`); y=26;
  rows.forEach((a,idx)=>{ y=pdfEnsure(pdf,y,30); pdf.setFillColor(idx%2?255:248, idx%2?255:250, idx%2?255:252); pdf.rect(8,y-4,281,28,'F'); pdf.setTextColor(15,23,42); pdf.setFontSize(7); pdf.setFont(undefined,'bold'); pdf.text(`${a.Store} • ${a.AreaManager} • ${a.Sector} • ${a.Status} • ${a.Critical==='Yes'?'Critical':'Non-critical'} • ${a.SLABucket}`,10,y); y+=5; y=pdfLine(pdf, `${a.IssueTheme}: ${a.Description || a.Question}`, 10, y, 270, 7, 'bold'); pdf.setFont(undefined,'normal'); pdf.text(`Responsible: ${pdfClean(a.PersonResponsible)||'—'} | Days: ${actionIsClosed(a)?fmtDays(a.DaysToClose):fmtDays(daysOpenNow(a))}`, 210, y-5); if(actionIsClosed(a) && (a.HowClosed || a.ExtraComment)){ y+=1; if(a.HowClosed){ y=pdfLine(pdf, `Store manager action: ${a.HowClosed}`, 10, y, 270, 7, 'normal'); } if(a.ExtraComment){ y=pdfLine(pdf, `Notes: ${a.ExtraComment}`, 10, y, 270, 6, 'normal'); } } y+=2; });
  pdf.save(`Birds_Audit_Action_Hub_${stamp}.pdf`);
}
async function exportAuditClosurePDF(){
  const rows = (__auditHubCurrentRows || []).filter(a => actionIsClosed(a) || a.HowClosed || a.ExtraComment); if(!rows.length){ alert('No closure evidence rows in the current filter.'); return; }
  if(typeof window.jspdf === 'undefined'){ alert('PDF library is still loading, please try again.'); return; }
  const { jsPDF } = window.jspdf; const pdf = new jsPDF('p','mm','a4'); const stamp = new Date().toISOString().slice(0,10);
  pdf.setFillColor(135,157,130); pdf.rect(0,0,210,18,'F'); pdf.setTextColor(255,255,255); pdf.setFontSize(15); pdf.setFont(undefined,'bold'); pdf.text('Closure Evidence Report',10,11); pdf.setFontSize(8); pdf.text(`${rows.length} rows • ${stamp}`,10,16); pdf.setTextColor(57,68,60);
  let y=28; rows.forEach((a,idx)=>{ if(y>265){ pdf.addPage(); y=18; } pdf.setFillColor(251,250,246); pdf.roundedRect(8,y-5,194,38,2,2,'F'); pdf.setFontSize(9); pdf.setFont(undefined,'bold'); pdf.text(`${a.Store} • ${a.IssueTheme}`, 11, y); y+=5; y=pdfLine(pdf, `Issue: ${a.Description || a.Question}`, 11, y, 185, 7, 'normal'); y=pdfLine(pdf, `Action: ${a.ActionNeeded || '—'}`, 11, y, 185, 7, 'normal'); y=pdfLine(pdf, `Closed on: ${a.ClosedOn || '—'} | Days: ${fmtDays(a.DaysToClose)} | How closed: ${a.HowClosed || '—'} | Extra: ${a.ExtraComment || '—'}`, 11, y, 185, 7, 'normal'); y+=5; });
  pdf.save(`Birds_Audit_Closure_Evidence_${stamp}.pdf`);
}

async function exportAuditCurrentViewPDF(){

  if(typeof html2canvas==='undefined' ||
     typeof window.jspdf==='undefined'){
      alert('PDF libraries still loading.');
      return;
  }

  const target =
      document.getElementById('audit-export-card');

  if(!target){
      alert('Audit Hub view not found');
      return;
  }

  window.scrollTo(0,0);

  await new Promise(resolve =>
      setTimeout(resolve,400)
  );

  const controls =
      target.querySelectorAll('button');

  const restore = [];

  controls.forEach(btn=>{
      restore.push([btn,btn.style.display]);

      if(!btn.innerText.includes('Current View')){
          btn.style.display='none';
      }
  });

  const expand =
      target.querySelectorAll(
          '.overflow-auto,.overflow-y-auto,[class*="max-h-"]'
      );

  const restoreExpand = [];

  expand.forEach(el=>{
      restoreExpand.push([
          el,
          el.style.overflow,
          el.style.maxHeight,
          el.style.height
      ]);

      el.style.overflow='visible';
      el.style.maxHeight='none';
      el.style.height='auto';
  });

  await new Promise(resolve =>
      requestAnimationFrame(resolve)
  );

const canvas = await html2canvas(target,{
    scale:2,
    useCORS:true,
    windowWidth: target.scrollWidth,
    width: target.scrollWidth
});
  restore.forEach(([el,d])=>{
      el.style.display=d;
  });

  restoreExpand.forEach(([el,o,m,h])=>{
      el.style.overflow=o;
      el.style.maxHeight=m;
      el.style.height=h;
  });

  const { jsPDF } = window.jspdf;

  const pdf =
      new jsPDF('l','mm','a4');

  const pageW =
      pdf.internal.pageSize.getWidth();

  const pageH =
      pdf.internal.pageSize.getHeight();

  const imgW = pageW - 10;

  const sliceHeight =
      Math.floor(
          canvas.width *
          ((pageH-10)/imgW)
      );

  const pageCanvas =
      document.createElement('canvas');

  const ctx =
      pageCanvas.getContext('2d');

  pageCanvas.width =
      canvas.width;

  pageCanvas.height =
      sliceHeight;

  let sourceY = 0;
  let page = 0;

  while(sourceY < canvas.height){

      ctx.clearRect(
          0,0,
          pageCanvas.width,
          pageCanvas.height
      );

      ctx.drawImage(
          canvas,
          0,
          sourceY,
          canvas.width,
          sliceHeight,
          0,
          0,
          canvas.width,
          sliceHeight
      );

      if(page > 0){
          pdf.addPage();
      }

      pdf.addImage(
          pageCanvas.toDataURL('image/png'),
          'PNG',
          5,
          5,
          imgW,
          pageH - 10
      );

      sourceY += sliceHeight;
      page++;
  }

  const stamp=new Date().toISOString().slice(0,10);
  pdf.save('Audit_Hub_'+stamp+'.png');
}