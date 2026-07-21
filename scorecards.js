window._ehoRatings = new Map();

window.loadEHORatings = async function() {
    try {
        const resp = await fetch('EHO_Ratings.csv');
        if (!resp.ok) return;
        const text = await resp.text();
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) return;
        const headers = lines[0].split(',').map(h => h.trim());
        const nameIdx = headers.indexOf('Shop Name');
        const ratingIdx = headers.indexOf('Hygiene Rating');
        const dateIdx = headers.indexOf('Inspection Date');
        const nextIdx = headers.indexOf('Next Insp. Due');
        const foodIdx = headers.indexOf('Food safety Score');
        if (nameIdx === -1 || ratingIdx === -1) return;
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            const name = cols[nameIdx];
            const rating = parseInt(cols[ratingIdx]);
            if (name && !isNaN(rating)) {
                window._ehoRatings.set(name.toLowerCase(), {
                    name: name,
                    rating: rating,
                    inspectionDate: cols[dateIdx] || '',
                    nextDue: cols[nextIdx] || '',
                    foodScore: cols[foodIdx] || ''
                });
            }
        }
        console.log('[EHO] Loaded ' + window._ehoRatings.size + ' ratings');
    } catch(e) { console.warn('[EHO] Failed to load:', e); }
};

function getStarHTML(rating) {
    if (!rating || rating === 0) return '';
    const colors = { 5: 'text-emerald-500', 4: 'text-green-500', 3: 'text-amber-500', 2: 'text-orange-500', 1: 'text-red-500' };
    const labels = { 5: 'Very Good', 4: 'Good', 3: 'Generally Satisfactory', 2: 'Improvement Necessary', 1: 'Major Improvement Necessary' };
    const col = colors[rating] || 'text-slate-400';
    const label = labels[rating] || '';
    let stars = '';
    for (let i = 0; i < 5; i++) {
        stars += `<svg class="w-4 h-4 ${i < rating ? col : 'text-slate-200'}" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`;
    }
    return `<div class="flex items-center gap-1" title="EHO Rating: ${rating}/5 - ${label}">${stars}</div>`;
}

function generateSupportiveStoreCard(s, p) {
    const getVal = (obj, keys) => {
        if (!obj) return 0;
        for (let k of keys) {
            if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
                return (typeof obj[k] === 'number') ? obj[k] : (parseFloat(obj[k]) || 0);
            }
        }
        return 0; 
    };
    
    const weekNum = s.Week || latestWkGlobal || 'Current';
    const aRank = s.AreaRank || '-';
    const cRank = s.CompanyRank || '-';

    const metrics = [
        { name: "Sales", val: getVal(s, ['Sales']), prev: getVal(p, ['Sales']), inverse: false, isRaw: false },
        { name: "Product Target", val: getVal(s, ['Product']), prev: getVal(p, ['Product']), inverse: false, isRaw: false },

        { name: "ATV", val: getVal(s, ['ATV']), prev: getVal(p, ['ATV']), inverse: false, isRaw: true, prefix: '£', format: (v) => v.toFixed(2) },
        { name: "Waste", val: getVal(s, ['Waste']), prev: getVal(p, ['Waste']), inverse: true, isRaw: false },
        { name: "Labour", val: getVal(s, ['Labour']), prev: getVal(p, ['Labour']), inverse: true, isRaw: false },
        { name: "Energy", val: getVal(s, ['Energy']), prev: getVal(p, ['Energy']), inverse: true, isRaw: true, suffix: ' kWh', format: (v) => Math.round(v) },
        { name: "Hot Drinks", val: getVal(s, ['HotBev']), prev: getVal(p, ['HotBev']), inverse: false, isRaw: false },
        { name: "Hot Food", val: getVal(s, ['HotRolls']), prev: getVal(p, ['HotRolls']), inverse: false, isRaw: false },
        { name: "Cold Rolls", val: getVal(s, ['FilledRolls']), prev: getVal(p, ['FilledRolls']), inverse: false, isRaw: false },
        { name: "Sandwiches", val: getVal(s, ['Sandwiches']), prev: getVal(p, ['Sandwiches']), inverse: false, isRaw: false }
    ];

    metrics.forEach(m => {
        if (m.isRaw) {
            m.displayVal = (m.prefix || '') + (m.format ? m.format(m.val) : m.val) + (m.suffix || '');
            m.variance = (m.prev !== 0 && m.prev !== undefined) ? (m.val - m.prev) / Math.abs(m.prev) : 0;
        } else {
            m.displayVal = (m.val * 100).toFixed(1) + '%';
            m.variance = m.val - m.prev;
        }
        m.impact = m.inverse ? -m.variance : m.variance; 
    });

    const validMetrics = metrics.sort((a, b) => b.impact - a.impact);

    // SUPPORTIVE COACHING LOGIC
    let winning = validMetrics.filter(m => m.impact >= 0);
    let negativeMetrics = validMetrics.filter(m => m.impact < 0);
    
    // Extract max 2 absolute worst metrics for "Focus", the rest become "Neutral" stats
    let focus = negativeMetrics.slice(-2).reverse(); 
    let neutral = negativeMetrics.slice(0, -2);

    const formatDiff = (val) => {
        if (val > 0) return `▲ +${(val * 100).toFixed(1)}%`;
        if (val < 0) return `▼ ${Math.abs(val * 100).toFixed(1)}%`;
        return `- 0.0%`;
    };

    const renderPill = (m, category) => {
        let bgClass, trendCol;
        if (category === 'win') {
            bgClass = ' text-emerald-900 border-emerald-200';
            trendCol = 'text-slate-800';
        } else if (category === 'focus') {
            bgClass = 'bg-amber-50 text-amber-900 border-amber-200';
            trendCol = 'text-amber-700';
        } else {
            // Neutral style for metrics that are negative but not the core focus
            bgClass = 'bg-slate-50 text-slate-700 border-slate-200 opacity-90';
            trendCol = 'text-slate-500';
        }
        
        return `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-5 rounded-xl border ${bgClass} shadow-sm gap-2">
                <span class="text-base md:text-lg font-black leading-tight">${m.name}</span>
                <div class="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center w-full sm:w-auto shrink-0 gap-2 sm:gap-0">
                    <span class="text-sm opacity-80 font-medium mb-0.5">${m.displayVal}</span>
                    <span class="text-base font-black ${trendCol}">${formatDiff(m.variance)}</span>
                </div>
            </div>
        `;
    };
    
    const renderRank = (title, current, prev) => {
        if (!current || current === '-') return '';
        let changeHtml = '<span class="text-slate-400 font-bold text-xs">-</span>';
        if (prev && current !== '-' && prev !== '-') {
            const diff = prev - current;
            if (diff > 0) changeHtml = `<span class="text-emerald-600 font-bold text-xs">▲ +${diff}</span>`;
            else if (diff < 0) changeHtml = `<span class="text-amber-600 font-bold text-xs">▼ ${Math.abs(diff)}</span>`;
        }
        return `
        <div class="flex flex-col bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200 min-w-[85px] items-center justify-center shadow-sm">
            <span class="text-[10px] uppercase font-bold text-slate-500 mb-1 tracking-wide">${title}</span>
            <div class="flex items-center gap-2">
                <span class="text-xl font-black text-slate-800">#${current}</span>
                ${changeHtml}
            </div>
        </div>`;
    };

    const safeId = "card-" + s.Branch.replace(/[ 	]+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');

    return `
      <div id="${safeId}" class="bg-white p-6 rounded-2xl shadow-md flex flex-col gap-4 border border-slate-200 relative mt-4">
        
        <button onclick="exportToPNG('${safeId}', 'Scorecard_${s.Branch}')" class="export-btn absolute top-6 right-6 bg-slate-100 hover:bg-slate-200 p-2.5 rounded-lg text-slate-600 transition-colors shadow-sm" title="Download as PNG">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
        </button>

        <div class="flex flex-col md:flex-row md:justify-between md:items-start gap-2 border-b border-slate-100 pb-4 pr-14">
          <div class="flex flex-col gap-2.5">
              <div class="flex items-center gap-3">
                  <h2 class="font-black text-[36px] text-slate-800 tracking-tight">${s.Branch}</h2>
                  <span class="text-xs font-black text-slate-800 bg-blue-50 border border-blue-200 px-3 py-1 rounded-md shadow-sm">Wk ${weekNum}</span>
              </div>
              <div class="flex items-center gap-2">
                  <span class="text-sm font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-md">${s.AM || 'Store Manager'}
${(window.storeMedalsMap && window.storeMedalsMap[s.Branch]) ? `<div class="mt-2 flex flex-wrap gap-1">${window.storeMedalsMap[s.Branch].map(m=>{const isImp=m.includes('(Improvement)');return `<span class="text-[10px] font-black px-2 py-1 rounded-md border ${isImp?'bg-emerald-50 text-slate-800 border-emerald-200':'bg-amber-50 text-amber-700 border-amber-200'}">${isImp?'':''} ${m.replace(' (Improvement)','')}</span>`}).join('')}</div>`:''}</span>
              </div>
              <div class="text-xs font-bold text-slate-800 flex items-center gap-1.5  px-3 py-1.5 rounded-md border border-emerald-200 w-fit mt-1">
                 ${winning.length} Metrics Improved This Week!
              </div>
          </div>
          <div class="flex gap-4">
              ${renderRank('Area Rank', aRank, p?.AreaRank)}
              ${renderRank('Network Rank', cRank, p?.CompanyRank)}
          </div>
        </div>

        <div class="flex flex-col gap-6">
            <div>
                <h3 class="text-sm uppercase tracking-widest font-black text-slate-400 mb-4 pl-1"> Weekly Highlights & Tracking</h3>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                    ${winning.map(m => renderPill(m, 'win')).join('')}
                    ${neutral.map(m => renderPill(m, 'neutral')).join('')}
                    ${(winning.length === 0 && neutral.length === 0) ? '<span class="text-sm text-slate-400 italic pl-1">No data available.</span>' : ''}
                </div>
            </div>

            ${focus.length > 0 ? `
            <div class="pt-2">
                <h3 class="text-sm uppercase tracking-widest font-black text-amber-600 mb-4 pl-1"> Core Focus Areas</h3>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                    ${focus.map(m => renderPill(m, 'focus')).join('')}
                </div>
            </div>
            ` : `
            <div class=" rounded-xl p-5 text-center border border-emerald-200 shadow-sm">
                <span class="text-base font-bold text-slate-800"> Exceptional week! No negative trends to focus on.</span>
            </div>
            `}
        </div>
      </div>`;
}


window.renderStoreScorecards = function(){
  idbGetAll('kpi').then(raw => {

    const wk = archiveWeekOverride || latestWkGlobal;

    const curr = aggregateData(raw.filter(k => k.Week === wk));
    const prev = aggregateData(raw.filter(k => k.Week === wk-1));
    
    // Dynamically calculate ranks using existing data
    const currNetworkRank = computeRankMap(curr, 'Sales', false);
    const prevNetworkRank = computeRankMap(prev, 'Sales', false);
    
    const areas = [...new Set(curr.map(x => x.AM))].sort();
    const currAreaRanks = {};
    const prevAreaRanks = {};
    
    areas.forEach(a => {
        currAreaRanks[a] = computeRankMap(curr.filter(x => x.AM === a), 'Sales', false);
        prevAreaRanks[a] = computeRankMap(prev.filter(x => x.AM === a), 'Sales', false);
    });

    curr.forEach(s => {
        s.CompanyRank = currNetworkRank.get(canonicalStoreId(s.Branch));
        s.AreaRank = currAreaRanks[s.AM] ? currAreaRanks[s.AM].get(canonicalStoreId(s.Branch)) : '-';
    });

    const prevMap = new Map();
    prev.forEach(p => {
        p.CompanyRank = prevNetworkRank.get(canonicalStoreId(p.Branch));
        p.AreaRank = prevAreaRanks[p.AM] ? prevAreaRanks[p.AM].get(canonicalStoreId(p.Branch)) : '-';
        prevMap.set(canonicalStoreId(p.Branch), p);
    });

    const aSel = document.getElementById('areaFilter')?.value || 'ALL';
    const search = (document.getElementById('storeSearch')?.value || '').toLowerCase();

    let list = curr;
    if(aSel !== 'ALL'){ list = list.filter(x => x.AM === aSel); }
    if(search){ list = list.filter(x => x.Branch.toLowerCase().includes(search)); }

    
setTimeout(() => {
    const select = document.getElementById('storeSelect');
    if (!select) return;
    const uniqueStores = [...new Set(curr.map(s => s.Branch))].sort();
    select.innerHTML = uniqueStores.map(s => `<option value="${s}">${s}</option>`).join('');
}, 100);

const cards = list.map(s => {
      const p = prevMap.get(canonicalStoreId(s.Branch));
      return generateSupportiveStoreCard(s, p);
    }).join("");

    document.getElementById('mainView').innerHTML = `
      <div class="flex justify-between items-center mb-6">
      <h2 class="text-[36px] font-black">Store Scorecards</h2>
      <button onclick="exportAllScorecardsAsZip()" class="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 px-5 rounded-xl shadow-sm transition-colors text-sm flex items-center gap-2">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
        Download All as ZIP
      </button>
    </div>

      <div class="flex gap-4 mb-6">
        <select id="areaFilter" class="input-chip text-base py-2"></select>
        <input id="storeSearch" placeholder="Search store..." class="input-chip text-base py-2 flex-grow max-w-md">
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-8">
        ${cards}
      </div>
    `;

    const sel = document.getElementById('areaFilter');
    sel.innerHTML = '<option value="ALL">All Areas</option>' +
      areas.map(a => '<option>'+a+'</option>').join('');

    sel.value = aSel; 
    sel.onchange = renderStoreScorecards;
    
    const searchInput = document.getElementById('storeSearch');
    if (searchInput) {
        searchInput.value = search;
        searchInput.oninput = renderStoreScorecards;
    }
  });
}

window.exportAllScorecardsAsZip = async function() {
  if (typeof html2canvas === 'undefined' || typeof JSZip === 'undefined') {
    alert('Libraries still loading. Please try again.');
    return;
  }
  const cards = document.querySelectorAll('#mainView [id^="card-"]');
  if (!cards.length) { alert('No scorecards to export.'); return; }

  const btn = document.querySelector('button[onclick="exportAllScorecardsAsZip()"]');
  const origText = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="animate-pulse">Generating PNGs...</span>'; }

  const zip = new JSZip();
  const folder = zip.folder('Store_Scorecards');

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const name = card.id.replace(/^card-/, '').replace(/-/g, '_');
    if (btn) btn.innerHTML = `<span class="animate-pulse">${i + 1} of ${cards.length}...</span>`;

    const btns = card.querySelectorAll('.export-btn');
    btns.forEach(b => b.style.display = 'none');

    try {
      const canvas = await html2canvas(card, { scale: 2.5, useCORS: true, backgroundColor: '#ffffff', logging: false });
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      folder.file(name + '.png', blob);
    } catch (e) {
      console.warn('Failed to export ' + name, e);
    }

    btns.forEach(b => b.style.display = '');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const content = await zip.generateAsync({ type: 'blob' });
  safeDownload(content, 'Store_Scorecards_' + stamp + '.zip');

  if (btn) { btn.disabled = false; btn.innerHTML = origText; }
};
