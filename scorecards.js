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

function generateSupportiveStoreCard(s, p, prevWeekLabel) {
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
    const prevLabel = prevWeekLabel || ('Wk ' + (parseInt(weekNum) - 1));
    const aRank = s.AreaRank || '-';
    const cRank = s.CompanyRank || '-';

    const metrics = [
        { name: "Sales", val: getVal(s, ['Sales']), prev: getVal(p, ['Sales']), inverse: false, isRaw: false },
        { name: "Product Target", val: getVal(s, ['Product']), prev: getVal(p, ['Product']), inverse: false, isRaw: false },

        { name: "ATV", val: getVal(s, ['ATV']), prev: getVal(p, ['ATV']), inverse: false, isRaw: true, prefix: '£', format: (v) => v.toFixed(2) },
        { name: "Waste", val: getVal(s, ['Waste']), prev: getVal(p, ['Waste']), inverse: true, isRaw: false },
        { name: "Labour", val: getVal(s, ['Labour']), prev: getVal(p, ['Labour']), inverse: true, isRaw: false },
        { name: "Energy", val: getVal(s, ['Energy']), prev: getVal(p, ['Energy']), inverse: true, isRaw: true, suffix: ' kWh', format: (v) => Math.round(v) },
        { name: "Hot Drinks", val: getVal(s, ['HotBev']), prev: getVal(p, ['HotBev']), inverse: false, isRaw: true, format: (v) => Math.round(v).toLocaleString() },
        { name: "Hot Food", val: getVal(s, ['HotRolls']), prev: getVal(p, ['HotRolls']), inverse: false, isRaw: true, format: (v) => Math.round(v).toLocaleString() },
        { name: "Cold Rolls", val: getVal(s, ['FilledRolls']), prev: getVal(p, ['FilledRolls']), inverse: false, isRaw: true, format: (v) => Math.round(v).toLocaleString() },
        { name: "Sandwiches", val: getVal(s, ['Sandwiches']), prev: getVal(p, ['Sandwiches']), inverse: false, isRaw: true, format: (v) => Math.round(v).toLocaleString() }
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

    const renderPill = (m, category) => {
        let borderClass, trendCol;
        if (category === 'win') {
            borderClass = 'border-l-4 border-birds-green';
            trendCol = 'text-birds-green';
        } else if (category === 'focus') {
            borderClass = 'border-l-4 border-birds-red';
            trendCol = 'text-birds-red';
        } else {
            borderClass = 'border-l-4 border-slate-300';
            trendCol = 'text-slate-500';
        }
        var pillIcon = trendIcon(m.variance);

        const absPct = Math.abs(m.variance * 100).toFixed(1);
        const trendLabel = m.variance > 0 ? 'Up' : m.variance < 0 ? 'Down' : 'Flat';
        const trendText = m.variance === 0 ? 'No change' : `${absPct}% ${trendLabel}`;
        
        return `
            <div class="sc-pill flex flex-col p-3 rounded-lg border border-birds-border shadow-sm gap-1 ${borderClass}">
                <span class="sc-pill-name text-[10px] font-black text-birds-dark uppercase tracking-wide leading-tight">${m.name}</span>
                <span class="sc-pill-value text-[18px] font-black text-birds-dark leading-none">${m.displayVal}</span>
                <span class="text-[10px] font-bold ${trendCol} leading-tight">${pillIcon} ${trendText}</span>
            </div>
        `;
    };
    
    const renderRank = (title, current, prev) => {
        if (!current || current === '-') return '';
        let changeHtml = '<span class="text-slate-400 font-bold text-[10px]">-</span>';
        if (prev && current !== '-' && prev !== '-') {
            const diff = prev - current;
            if (diff > 0) changeHtml = `<span class="text-birds-green font-bold text-[10px]" title="Up ${diff} places">${ICON_TREND_UP}Up ${diff}</span>`;
            else if (diff < 0) changeHtml = `<span class="text-birds-red font-bold text-[10px]" title="Down ${Math.abs(diff)} places">${ICON_TREND_DOWN}Down ${Math.abs(diff)}</span>`;
        }
        return `
        <div class="flex flex-col bg-white px-3 py-2 rounded-lg border border-birds-border min-w-[70px] items-center justify-center shadow-sm">
            <span class="text-[9px] uppercase font-bold text-slate-500 mb-0.5 tracking-wide">${title}</span>
            <div class="flex items-center gap-1.5">
                <span class="text-lg font-black text-birds-dark">#${current}</span>
                ${changeHtml}
            </div>
        </div>`;
    };

    const safeId = "card-" + s.Branch.replace(/[ 	]+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');

    return `
      <div id="${safeId}" class="sc-card bg-birds-warmwhite p-6 rounded-2xl shadow-md flex flex-col gap-4 border border-birds-border relative mt-4">
        
        <button onclick="exportToPNG('${safeId}', 'Scorecard_${s.Branch}')" class="export-btn absolute top-4 right-4 bg-slate-100 hover:bg-slate-200 p-2 rounded-lg text-slate-600 transition-colors shadow-sm z-10" title="Download as PNG">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
        </button>

        <div class="flex flex-col md:flex-row md:justify-between md:items-start gap-3 border-b border-slate-100 pb-4 pr-12">
          <div class="flex flex-col gap-2 min-w-0">
              <div class="flex items-center gap-3 flex-wrap">
                  <h2 class="font-black text-[28px] text-birds-dark tracking-tight leading-tight">${s.Branch}</h2>
                  <span class="text-[10px] font-black text-birds-dark border border-birds-border px-2 py-0.5 rounded-md shadow-sm whitespace-nowrap">Wk ${weekNum}</span>
                  <span class="text-[10px] font-black ${winning.length >= 5 ? 'text-birds-green border border-birds-green' : 'text-slate-600 border border-slate-200'} px-2 py-0.5 rounded-md whitespace-nowrap">${winning.length}/${metrics.length} improved</span>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs font-bold text-slate-600 border border-birds-border px-2 py-1 rounded-md">${s.AM || 'Store Manager'}</span>
${(window.storeMedalsMap && window.storeMedalsMap[s.Branch]) ? `<div class="flex flex-wrap gap-1 max-w-[280px] overflow-hidden">${window.storeMedalsMap[s.Branch].slice(0,6).map(m=>{const isImp=m.includes('(Improvement)');return `<span class="text-[9px] font-black px-1.5 py-0.5 rounded border ${isImp?'text-birds-green border-birds-green':'text-birds-terracotta border-birds-terracotta'}">${m.replace(' (Improvement)','')}</span>`}).join('')}</div>`:''}
              </div>
          </div>
          <div class="flex gap-2 flex-shrink-0">
              ${renderRank('Area Rank', aRank, p?.AreaRank)}
              ${renderRank('Network Rank', cRank, p?.CompanyRank)}
          </div>
        </div>

        <div class="flex flex-col gap-5">
            <div>
                <h3 class="text-[10px] uppercase tracking-widest font-black text-birds-green mb-2 pl-1">Improved</h3>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                    ${winning.map(m => renderPill(m, 'win')).join('')}
                    ${neutral.map(m => renderPill(m, 'neutral')).join('')}
                    ${(winning.length === 0 && neutral.length === 0) ? '<span class="text-sm text-slate-400 italic pl-1">No data available.</span>' : ''}
                </div>
            </div>

            ${focus.length > 0 ? `
            <div>
                <h3 class="text-[10px] uppercase tracking-widest font-black text-birds-red mb-2 pl-1">Needs Action</h3>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                    ${focus.map(m => renderPill(m, 'focus')).join('')}
                </div>
            </div>
            ` : `
            <div class="rounded-xl p-4 text-center border border-birds-green shadow-sm">
                <span class="text-sm font-black text-birds-green"> Exceptional week! No negative trends to focus on.</span>
            </div>
            `}
        </div>
      </div>`;
}


window.renderStoreScorecards = function(){
  idbGetAll('kpi').then(raw => {

    const wk = archiveWeekOverride || latestWkGlobal;
    const yr = currentAwardsYear || new Date().getFullYear();

    const curr = aggregateData(raw.filter(k => k.Week == wk && (k.Year || yr) == yr));
    const prevWk = getPreviousAvailableWeek(wk, yr, raw);
    const prev = aggregateData(raw.filter(k => k.Week == prevWk.week && (k.Year || prevWk.year) == prevWk.year));
    
    // Dynamically calculate ranks using composite score (sales vs cost)
    curr.forEach(s => { s._compositeScore = calculateStoreScore(s); });
    prev.forEach(s => { s._compositeScore = calculateStoreScore(s); });

    const currNetworkRank = computeRankMap(curr, '_compositeScore', false);
    const prevNetworkRank = computeRankMap(prev, '_compositeScore', false);
    
    const areas = [...new Set(curr.map(x => safeGetAM(x.Branch)))].sort();
    const currAreaRanks = {};
    const prevAreaRanks = {};
    
    areas.forEach(a => {
        currAreaRanks[a] = computeRankMap(curr.filter(x => safeGetAM(x.Branch) === a), '_compositeScore', false);
        prevAreaRanks[a] = computeRankMap(prev.filter(x => safeGetAM(x.Branch) === a), '_compositeScore', false);
    });

    curr.forEach(s => {
        const sAm = safeGetAM(s.Branch);
        s.CompanyRank = currNetworkRank.get(canonicalStoreId(s.Branch));
        s.AreaRank = currAreaRanks[sAm] ? currAreaRanks[sAm].get(canonicalStoreId(s.Branch)) : '-';
    });

    const prevMap = new Map();
    prev.forEach(p => {
        const pAm = safeGetAM(p.Branch);
        p.CompanyRank = prevNetworkRank.get(canonicalStoreId(p.Branch));
        p.AreaRank = prevAreaRanks[pAm] ? prevAreaRanks[pAm].get(canonicalStoreId(p.Branch)) : '-';
        prevMap.set(canonicalStoreId(p.Branch), p);
    });

    const aSel = document.getElementById('areaFilter')?.value || 'ALL';
    const search = (document.getElementById('storeSearch')?.value || '').toLowerCase();

    let list = curr;
    if(aSel !== 'ALL'){ list = list.filter(x => safeGetAM(x.Branch) === aSel); }
    if(search){ list = list.filter(x => x.Branch.toLowerCase().includes(search)); }

    
setTimeout(() => {
    const select = document.getElementById('storeSelect');
    if (!select) return;
    const uniqueStores = [...new Set(curr.map(s => s.Branch))].sort();
    select.innerHTML = uniqueStores.map(s => `<option value="${s}">${s}</option>`).join('');
}, 100);

const cards = list.map(s => {
      const p = prevMap.get(canonicalStoreId(s.Branch));
      return generateSupportiveStoreCard(s, p, 'Wk ' + prevWk.week);
    }).join("");

    document.getElementById('mainView').innerHTML = `
      <div class="flex justify-between items-center mb-6">
      <h2 class="text-[36px] font-black">Store Scorecards</h2>
      <button onclick="exportAllScorecardsAsZip()" class="btn" style="background: #555B6E; color: white; padding: 10px 20px; border-radius: 6px; font-weight: 800; font-size: 13px;">Download All as ZIP</button>
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
