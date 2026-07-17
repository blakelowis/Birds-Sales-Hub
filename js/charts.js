function calculateTrendSummary(storeSeries, companySeries, inverse=false){
  let under=0, near=0, above=0;
  let total=0;
  for(let i=0;i<storeSeries.length;i++){
    const s = storeSeries[i];
    const c = companySeries[i];
    if(s==null || c==null) continue;
    const diff = s - c;
    total++;
    const withinBand = Math.abs(diff) <= 1;
    if(inverse){
      if(diff < -1) under++; // GOOD
      else if(withinBand) near++;
      else above++;
    } else {
      if(diff > 1) above++; // GOOD
      else if(withinBand) near++;
      else under++;
    }
  }
  if(total===0) return {under:0,near:0,above:0};
  return {
    under: Math.round((under/total)*100),
    near: Math.round((near/total)*100),
    above: Math.round((above/total)*100)
  }
}

async function renderTrendsPanel() {
    const validAMs = Array.from(new Set(Array.from(storeMap.values()))).filter(am => am !== 'Unassigned');
    const rawKpisAll = await idbGetAll('kpi'); const auditsAll = await idbGetAll('audits');
    const allYears = [...rawKpisAll.map(k => k.Year), ...auditsAll.map(a => a.Year)].filter(y => y); const effectiveYear = allYears.length ? Math.max(...allYears) : new Date().getFullYear();
    const yearKpis = rawKpisAll.filter(k => (k.Year || effectiveYear) === effectiveYear); const yearAudits = auditsAll.filter(a => (a.Year || effectiveYear) === effectiveYear);
    const allWeeks = new Set([...yearKpis.map(k => k.Week), ...yearAudits.map(a => a.Week)]);
    const existingWeeks = [...allWeeks].sort((a,b)=>a-b);
    const weeksOptions = existingWeeks.map(w => `<option value="${w}" ${archiveWeekOverride == w ? 'selected':''}>Week ${w}</option>`).join('');
    const amOptions = validAMs.map(am => `<option value="${am}">${am}</option>`).join('');
    
    const storeOptions = Array.from(new Set(
  Array.from(originalStoreNames.values()).map(n => {
    let fixed = n
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([a-z])([A-Z])/g, '$1 $2');

    fixed = fixed
      .replace(/tealpark/i, 'Teal Park')
      .replace(/meltonroad/i, 'Melton Road')
      .replace(/bakeryshop/i, 'Bakery Shop');

    return fixed;
  })
))
      .filter(Boolean)
      .sort((a,b)=>a.localeCompare(b))
      .map(n => `<option value="${n}">${n}</option>`)
      .join('');

    document.getElementById('mainView').innerHTML = `
        <div id="trend-card" class="card p-6 border-t-4 border-t-teal-500 relative">
            <div onclick="exportCard('trend-card', 'Trend_Analysis')" class="export-btn absolute top-4 right-4 bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"> Export Dash</div>
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 pr-24">
                <div>
                    <h2 class="text-2xl font-black outfit birds-green">Historical Trend Analysis</h2>
                    <p class="text-sm text-slate-500">Track key performance indicators over time across the entire network or specific areas. Click a point to open that week or pick an Archive Week.</p>
                </div>
                <div class="flex gap-2 w-full md:w-auto">
                    <select id="trendMetric" onchange="drawTrendChart()" class="input-chip text-sm p-2 w-full md:w-auto">
                    <option value="Sales">Sales Growth %</option>
                    <option value="Product">Product Target %</option>
                    <option value="Waste">Wastage %</option>
                    <option value="Labour">Labour %</option>
                    <option value="ATV">Avg Trans. Val (£)</option>
                    <option value="Energy">Energy (kWh)</option>
                    <option value="HotBev">Hot Drinks %</option>
                    <option value="HotRolls">Hot Food %</option>
                    <option value="FilledRolls">Cold Rolls %</option>
                    <option value="Audit">Audit Score %</option>
                  </select>
                    <select id="trendScope" onchange="drawTrendChart()" class="input-chip text-sm p-2 w-full md:w-auto">
                        <option value="Network">Network Average</option>
                        ${amOptions}
                    </select>
                  <select id="trendStoreFilter" onchange="drawTrendChart(true)" class="input-chip text-sm p-2 w-full md:w-auto">
                      <option value=""> Select a specific store...</option>
                      ${storeOptions}
                  </select>
                  <button onclick="exportAllTrendsPNGs()" class="btn-secondary">️ Export ALL Trend Graphs</button>
                  <select id="archiveWeekSel" onchange="this.value?setArchiveWeekOverride(this.value):clearArchiveWeekOverride();" class="input-chip text-sm p-2 w-full md:w-auto">
                        <option value="" ${!archiveWeekOverride?'selected':''}>️ Follow Latest</option>
                        ${weeksOptions}
                    </select>
                </div>
            </div>
            <div class="bg-slate-50 border border-slate-100 rounded-2xl p-3 shadow-inner relative w-full" style="height:600px;">
                <canvas id="trendCanvas"></canvas>
            </div>
        </div>
    `;
    setTimeout(drawTrendChart, 50);
}

window.drawTrendChart = async function(storeFilterTriggered = false, exportMode = false) {
  const rawKpis = await idbGetAll('kpi'); const auditsAll = await idbGetAll('audits');
  const metric = document.getElementById('trendMetric')?.value || 'Sales'; 
  
  const storeFilterRaw = (document.getElementById('trendStoreFilter')?.value || '').trim(); 
  const storeFilter = storeFilterRaw.toLowerCase();
  
  
  const scope = document.getElementById('trendScope')?.value || 'Network';
  
  const storeMatch = (name) => { if(!storeFilter) return true; return canonicalStoreId(name).includes(canonicalStoreId(storeFilter)); };
  const allYears = [...rawKpis.map(k => k.Year), ...auditsAll.map(a => a.Year)].filter(y => y); const effectiveYear = allYears.length ? Math.max(...allYears) : new Date().getFullYear();
  
  // Trend chart filters out anomalies dynamically
  let selKpis = rawKpis.filter(k => (k.Year ?? effectiveYear) === effectiveYear && !k.IsAnomaly); 
  let selAudits = auditsAll.filter(a => (a.Year ?? effectiveYear) === effectiveYear);
  
  if(scope !== 'Network') selKpis = selKpis.filter(k => k.AM === scope);
  if(scope === 'Network') selKpis = selKpis;
  if(scope !== 'Network'){ selAudits = selAudits.filter(a => { const branchId = String(a.Store).trim().toLowerCase(); return storeMap.get(branchId) === scope; }); }
  
  if(storeFilter) selKpis = selKpis.filter(k => storeMatch(k.Branch)); 
  if(storeFilter) selAudits = selAudits.filter(a => storeMatch(a.Store));
  
  const showCompany = true;
  const coKpis = rawKpis.filter(k => (k.Year ?? effectiveYear) === effectiveYear &&  !k.IsAnomaly); const coAudits = auditsAll.filter(a => (a.Year ?? effectiveYear) === effectiveYear);
  const weekSet = new Set();
  (metric === 'Audit' ? selAudits.map(a=>a.Week) : selKpis.map(k=>k.Week)).forEach(w => weekSet.add(w));
  if(showCompany){ (metric === 'Audit' ? coAudits.map(a=>a.Week) : coKpis.map(k=>k.Week)).forEach(w => weekSet.add(w)); }
  if(!weekSet.size) return;
  const weeks = Array.from(weekSet).filter(w => w!=null).sort((a,b)=>a-b);
  const pctMetrics = ['Sales','Product','Waste','Labour','HotBev','HotRolls','FilledRolls','Sandwiches'];
  const valueForWeek = (arr, week, field) => {
    const wk = arr.filter(x => x.Week === week); if(!wk.length) return null;
    if(field === '__AUDIT__'){ const avg = wk.reduce((s,x)=> s + (Number(x.Score) || 0), 0) / wk.length; return Number(avg.toFixed(1)); }
    const avg = wk.reduce((s,x)=> s + (Number(x[field]) || 0), 0) / wk.length;
    if(pctMetrics.includes(field)) return Number((avg * 100).toFixed(1)); return Number(avg.toFixed(2));
  };
  const selectedSeries = weeks.map(w => metric === 'Audit' ? valueForWeek(selAudits, w, '__AUDIT__') : valueForWeek(selKpis, w, metric));
  const companySeries = showCompany ? weeks.map(w => metric === 'Audit' ? valueForWeek(coAudits, w, '__AUDIT__') : valueForWeek(coKpis, w, metric)) : null;
  const canvas = document.getElementById('trendCanvas'); if(!canvas) return; const ctx = canvas.getContext('2d');
  if(trendChartInstance) trendChartInstance.destroy();
  // PATCH: EXPORT_CHART_FIXED_SIZE - lock the canvas to a fixed, non-responsive
  // pixel size during export so every metric page in the PDF renders at the
  // same dimensions, instead of racing the live responsive container resize.
  if(exportMode){
    canvas.removeAttribute('style');
    canvas.width = 1600;
    canvas.height = 900;
  } else {
    // Always clear any fixed sizing left over from a previous export run,
    // so Chart.js's responsive engine sizes the canvas purely from the live
    // container's CSS every time (the old conditional check here could leave
    // the canvas stuck at export dimensions in some cases).
    canvas.removeAttribute('width');
    canvas.removeAttribute('height');
    canvas.removeAttribute('style');
  }
  const isInverse = ['Waste','Labour','Energy'].includes(metric); const lineColor = isInverse ? '#F59E0B' : '#00A88E'; const bgColor = isInverse ? 'rgba(245, 158, 11, 0.10)' : 'rgba(0, 168, 142, 0.10)';
  const labelScope = storeFilterRaw ? storeFilterRaw : scope;
  let datasets = [{ label: labelScope, data: selectedSeries, borderColor: lineColor, backgroundColor: bgColor, borderWidth: 4, pointBackgroundColor: '#ffffff', pointBorderColor: lineColor, pointBorderWidth: 2, pointRadius: 6, pointHoverRadius: 7, fill: true, tension: 0.3, spanGaps: true }];
  if(showCompany){
  datasets.push({
    label: 'Company Avg',
    data: companySeries,
    borderColor: '#2563eb',
    borderDash: [6,6],
    borderWidth: 2,
    fill: false,
    pointRadius: 0,
      borderWidth: 2,
    tension: 0.3,
    spanGaps: true
  });
}
  

  
trendChartInstance = new Chart(ctx, {
    type: 'line', data: { labels: weeks.map(w => 'Week ' + w), datasets },
    options: {
      responsive: !exportMode,
      maintainAspectRatio: false, // <--- Change this to false
      animation: exportMode ? false : undefined,
      interaction: { mode: 'index', intersect: false },
      onClick: function(evt, elements){ try{ if(elements && elements.length){ const idx = elements[0].index; const wk = weeks[idx]; if(wk){ setArchiveWeekOverride(wk); setView('overview'); } } }catch(e){} },
      scales: {
    y: {
        beginAtZero: false,
        grace: '10%',
        grid: {
            color: '#e2e8f0'
        },
        ticks: {
            font: {
                family: 'Inter',
                weight: 'bold',
                size: 13
            },
            color: '#64748b',
            padding: 8
        }
    },
    x: {
        grid: {
            display: false
        },
        ticks: {
            autoSkip: true,
            maxTicksLimit: 52,
            font: {
                family: 'Inter',
                weight: 'bold',
                size: 13
            },
            color: '#64748b'
        }
    }
},
      plugins: { legend: { display: true }, tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', titleFont: { family: 'Inter', size: 14, weight: 'bold' }, bodyFont: { family: 'Inter', size: 16, weight: 'bold' }, padding: 12, cornerRadius: 8, callbacks: { label: function(context) { const name = context.dataset?.label ? (context.dataset.label + ': ') : ''; let val = context.parsed.y; const isPct = (metric === 'Audit') || pctMetrics.includes(metric); if(isPct) return name + val + '%'; if(metric === 'ATV') return name + '£' + val; if(metric === 'Energy') return name + val + ' kWh'; return name + String(val); } } } }
    }
  });
  return trendChartInstance;
}

window.exportAllTrendsPNGs = async function(){
  try{
    if(typeof JSZip === 'undefined'){ alert('JSZip library is still loading, please try again.'); return; }
    const metrics = [ {id:'Sales', name:'Sales_Growth'}, {id:'Product', name:'Product_Target'}, {id:'Waste', name:'Wastage'}, {id:'Labour', name:'Labour'}, {id:'ATV', name:'ATV'}, {id:'Energy', name:'Energy'}, {id:'HotBev', name:'Hot_Drinks'}, {id:'HotRolls', name:'Hot_Food'}, {id:'FilledRolls', name:'Cold_Rolls'}, {id:'Audit', name:'Audit_Score'} ];
    const metricSel = document.getElementById('trendMetric'); if(!metricSel){ alert('Trend metric selector not found.'); return; }
    const zip = new JSZip(); const originalMetric = metricSel.value; const waitFrame = () => new Promise(res => requestAnimationFrame(() => res()));
    for(const m of metrics){ metricSel.value = m.id; await drawTrendChart(true, true); await waitFrame(); const canvas = document.getElementById('trendCanvas'); if(!canvas || !canvas.toDataURL) continue; const pngBase64 = canvas.toDataURL('image/png').split(',')[1]; zip.file(`${m.name}.png`, pngBase64, {base64:true}); }
    metricSel.value = originalMetric; await drawTrendChart(true, false);
    const blob = await zip.generateAsync({type:'blob'});
    const scopeNow = document.getElementById('trendScope')?.value || 'Network'; const storeNow = (document.getElementById('trendStoreFilter')?.value || '').trim();
    const safe = (s) => String(s||'').replace(/[^a-z0-9\-_]+/gi,'_').replace(/_+/g,'_');     const stamp=new Date().toISOString().slice(0,10); safeDownload(blob, `All_Trends_${safe(storeNow||scopeNow)}_${stamp}.zip`);
  } catch(err){ console.error(err); alert('Export ALL trends failed. Check console for details.'); }
}
