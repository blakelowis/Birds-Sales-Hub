// overview.js — Fresh overview renderer, zero CSS class dependencies
// All styles are inline. If numbers show here, the issue was CSS.

function _ovPct(v){ return (v*100).toFixed(1) + '%'; }
function _ovCurrency(v){ return '\u00a3' + v.toFixed(2); }
function _ovTrend(curr, prev, isInverse){
  var diff = curr - prev;
  var good = isInverse ? diff < 0 : diff > 0;
  var bad = isInverse ? diff > 0 : diff < 0;
  var arrow = diff > 0 ? '\u25B2' : diff < 0 ? '\u25BC' : '';
  var col = diff === 0 ? '#7A7A7A' : good ? '#6E8E6D' : '#D94F4F';
  return '<span style="color:'+col+';font-size:12px;font-weight:800;">'+arrow+' '+Math.abs(diff*100).toFixed(1)+'%</span>';
}

function _ovKpiCard(label, curr, prev, isInverse, fmt){
  var valStr, diffStr;
  if(fmt==='currency'){ valStr = '\u00a3'+curr.toFixed(2); diffStr = '\u00a3'+Math.abs(curr-prev).toFixed(2); }
  else if(fmt==='whole'){ valStr = curr.toFixed(0); diffStr = Math.abs(curr-prev).toFixed(0); }
  else { valStr = (curr*100).toFixed(1)+'%'; diffStr = (Math.abs(curr-prev)*100).toFixed(1)+'%'; }
  var diff = curr - prev;
  var good = isInverse ? diff < 0 : diff > 0;
  var bad = isInverse ? diff > 0 : diff < 0;
  var arrow = diff > 0 ? '\u25B2' : diff < 0 ? '\u25BC' : '';
  var valCol = bad ? '#D94F4F' : good ? '#6E8E6D' : '#4A4A4A';
  var changeCol = diff === 0 ? '#7A7A7A' : good ? '#6E8E6D' : '#D94F4F';
  var changeText = diff === 0 ? 'No change' : diffStr + ' ' + arrow + (diff>0?'Up':'Down');
  return '<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:16px;text-align:center;border-top:3px solid '+(bad?'#D94F4F':good?'#8BA88A':'#ccc')+';">'
    +'<div style="font-size:11px;font-weight:800;color:#20231F;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:8px;font-family:Merriweather,Georgia,serif;">'+label+'</div>'
    +'<div style="font-size:32px;font-weight:900;color:'+valCol+';margin-bottom:5px;font-family:Merriweather,Georgia,serif;line-height:1.05;">'+valStr+'</div>'
    +'<div style="font-size:13px;font-weight:800;color:'+changeCol+';">'+changeText+'</div>'
    +'</div>';
}

function _ovCatCard(label, curr, prev){
  var val = _finiteOr0(curr);
  var pVal = _finiteOr0(prev);
  var valStr = Math.round(val).toLocaleString();
  var pctChange = pVal !== 0 ? ((val - pVal) / Math.abs(pVal)) * 100 : 0;
  var absChange = val - pVal;
  var good = absChange > 0;
  var bad = absChange < 0;
  var arrow = absChange > 0 ? '\u25B2' : absChange < 0 ? '\u25BC' : '';
  var valCol = good ? '#6E8E6D' : bad ? '#D94F4F' : '#4A4A4A';
  var changeCol = absChange === 0 ? '#7A7A7A' : good ? '#6E8E6D' : '#D94F4F';
  var changeText = absChange === 0 ? 'No change' : Math.abs(pctChange).toFixed(1)+'% '+arrow+(absChange>0?'Up':'Down');
  return '<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:12px;text-align:center;border-top:3px solid '+(good?'#8BA88A':bad?'#D94F4F':'#ccc')+';">'
    +'<div style="font-size:11px;font-weight:800;color:#20231F;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:5px;font-family:Merriweather,Georgia,serif;">'+label+'</div>'
    +'<div style="font-size:24px;font-weight:900;color:'+valCol+';margin-bottom:4px;font-family:Merriweather,Georgia,serif;line-height:1.05;">'+valStr+'</div>'
    +'<div style="font-size:13px;font-weight:800;color:'+changeCol+';">'+changeText+'</div>'
    +'</div>';
}

function renderOverviewFresh(bAvgs, pAvgs, ehoData, allActions, auditMap, effectiveWeek, amStatsGlobal, storeCount, complaints, topStores, areaLeaderboard){
  var mv = document.getElementById('mainView');
  if(!mv) return;
  var weekLabel = 'Wk ' + effectiveWeek;

  // Products grid
  var prodHtml = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">'
    + _ovCatCard('Hot Drinks', bAvgs.HotBev, pAvgs.HotBev)
    + _ovCatCard('Hot Food', bAvgs.HotRolls, pAvgs.HotRolls)
    + _ovCatCard('Sandwiches', bAvgs.Sandwiches, pAvgs.Sandwiches)
    + _ovCatCard('Cold Rolls', bAvgs.FilledRolls, pAvgs.FilledRolls)
    + '</div>';

  // KPIs grid
  var kpiHtml = '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:24px;">'
    + _ovKpiCard('Sales Growth', bAvgs.Sales, pAvgs.Sales, false, 'percent')
    + _ovKpiCard('Product Target', bAvgs.Product, pAvgs.Product, false, 'percent')
    + _ovKpiCard('Wastage', bAvgs.Waste, pAvgs.Waste, true, 'percent')
    + _ovKpiCard('Labour %', bAvgs.Labour, pAvgs.Labour, true, 'percent')
    + _ovKpiCard('Avg Trans. Val', bAvgs.ATV, pAvgs.ATV, false, 'currency')
    + _ovKpiCard('Energy (kWh)', bAvgs.Energy, pAvgs.Energy, true, 'whole')
    + '</div>';

  // Area medal leaderboard from area_winners_log
  var areaHtml = '';
  if(areaLeaderboard && areaLeaderboard.length){
    var medals = ['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'];
    areaHtml = '<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:16px;">'
      +'<div style="font-size:13px;font-weight:900;color:#20231F;margin-bottom:4px;font-family:Merriweather,Georgia,serif;">Area Leaderboard</div>'
      +'<div style="font-size:10px;color:#888;margin-bottom:12px;">Medal wins \u2014 Year to Date</div>';
    areaLeaderboard.forEach(function(entry, i){
      var bg = i===0?'#f0f7ec':i===1?'#f5f5f5':i===2?'#fdf6ee':'#fff';
      var border = i===0?'#c5d8b8':i===1?'#ddd':i===2?'#e8d5c0':'#eee';
      var medal = i < 3 ? medals[i]+' ' : '';
      var rankBg = i<3 ? '#e8eee5' : '#f5f5f5';
      areaHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 8px;margin-bottom:4px;border:1px solid '+border+';border-radius:8px;background:'+bg+';">'
        +'<div style="display:flex;align-items:center;gap:10px;">'
        +'<span style="width:28px;height:28px;border-radius:50%;background:'+rankBg+';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:'+(i<3?'#20231F':'#666')+';">'+(i+1)+'</span>'
        +'<span style="font-weight:800;font-size:13px;color:#20231F;">'+medal+escapeHtml(entry.am)+'</span></div>'
        +'<span style="font-size:18px;font-weight:900;color:'+(i===0?'#2d6a2e':i===1?'#555':i===2?'#a06830':'#888')+';">'+entry.wins+'</span>'
        +'</div>';
    });
    areaHtml += '</div>';
  }

  // Last 7 days complaints by category
  var compHtml = '<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:16px;border-top:3px solid #a47772;">'
    +'<div style="font-size:13px;font-weight:900;color:#20231F;margin-bottom:8px;font-family:Merriweather,Georgia,serif;">Complaints (Last 7 Days)</div>';
  if(complaints && complaints.length){
    var sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    var recent = complaints.filter(function(c){
      /* Only count actual complaints — exclude Praise / Google Review etc. (blank Purpose counts for older exports) */
      var purpose = String(c['Purpose'] || '').trim().toLowerCase();
      if (purpose && purpose !== 'complaint') return false;
      var d = parseUKDate(c['Date of complaint'] || '');
      return d && !isNaN(d.getTime()) && d >= sevenDaysAgo;
    });
    if(recent.length === 0) recent = complaints.slice(-30);
    var openCount = 0, resolvedCount = 0;
    recent.forEach(function(c){
      var st = (typeof normaliseComplaintStatus === 'function') ? normaliseComplaintStatus(c['Status']) : String(c['Status'] || '');
      if(st === 'Resolved') resolvedCount++; else openCount++;
    });
    compHtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">'
      +'<div style="background:#FDF3F3;border:1px solid #F0D9D9;border-radius:10px;padding:12px;text-align:center;">'
      +'<div style="font-size:10px;font-weight:900;color:#a47772;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Open</div>'
      +'<div style="font-size:26px;font-weight:900;color:#D94F4F;line-height:1;">'+openCount+'</div></div>'
      +'<div style="background:#EDF5EC;border:1px solid #D6E6D4;border-radius:10px;padding:12px;text-align:center;">'
      +'<div style="font-size:10px;font-weight:900;color:#60755f;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Resolved</div>'
      +'<div style="font-size:26px;font-weight:900;color:#6E8E6D;line-height:1;">'+resolvedCount+'</div></div>'
      +'</div>';
    var cats = {};
    recent.forEach(function(c){
      var t = c['Type of complaint'] || 'Other';
      cats[t] = (cats[t]||0) + 1;
    });
    var sorted = Object.keys(cats).sort(function(a,b){return cats[b]-cats[a];}).slice(0,5);
    sorted.forEach(function(t){
      compHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #eee;">'
        +'<div style="font-size:13px;font-weight:800;color:#20231F;">'+t+'</div>'
        +'<div style="font-size:22px;font-weight:900;color:#a47772;">'+cats[t]+'</div></div>';
    });
  } else {
    compHtml += '<div style="font-size:12px;color:#999;">No complaints data loaded</div>';
  }
  compHtml += '</div>';

  // EHO
  var ehoHtml = '<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:16px;border-top:3px solid #D97706;">'
    +'<div style="font-size:13px;font-weight:900;color:#20231F;margin-bottom:8px;font-family:Merriweather,Georgia,serif;">EHO Inspections</div>';
  if(ehoData && ehoData.length){
    var ehoList = [];
    var now = new Date();
    ehoData.forEach(function(d){
      var inspDate = d.inspectionDate || d.ehoVisit || '';
      if(!inspDate) return;
      var parsed = parseUKDate(inspDate);
      if(!parsed || isNaN(parsed.getTime())) return;
      if(parsed > now) return;
      var dd = ('0'+parsed.getDate()).slice(-2)+'/'+('0'+(parsed.getMonth()+1)).slice(-2)+'/'+parsed.getFullYear();
      ehoList.push({store: d.StoreId, rating: d.ehoRating||'', date: parsed, dateStr: dd});
    });
    ehoList.sort(function(a,b){return b.date-a.date;});
    if(ehoList.length === 0) ehoHtml += '<div style="font-size:12px;color:#999;">No past EHO visit dates recorded.</div>';
    ehoList.slice(0,5).forEach(function(r){
      ehoHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:12px;">'
        +'<span style="font-weight:700;">'+r.store+'</span>'
        +'<span style="color:#a47772;">'+r.dateStr+' ('+r.rating+' star)</span></div>';
    });
  } else {
    ehoHtml += '<div style="font-size:12px;color:#999;">No EHO data loaded.</div>';
  }
  ehoHtml += '</div>';

  // Top 5 stores this week
  var actHtml = '<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:16px;border-top:3px solid #6E8E6D;">'
    +'<div style="font-size:13px;font-weight:900;color:#20231F;margin-bottom:8px;font-family:Merriweather,Georgia,serif;">Top 5 Stores — Wk '+effectiveWeek+'</div>';
  if(topStores && topStores.length){
    var medals = ['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49','',''];
    topStores.forEach(function(s, i){
      actHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #eee;font-size:12px;">'
        +'<span style="font-weight:700;">'+(medals[i]||(i+1)+'. ')+' '+escapeHtml(s.name)+'</span>'
        +'<span style="color:#6E8E6D;font-weight:800;">'+s.score.toFixed(1)+'%</span></div>';
    });
  } else {
    actHtml += '<div style="font-size:12px;color:#999;">No store data for this week</div>';
  }
  actHtml += '</div>';

  // Store count (storeCount is passed directly now)

  mv.innerHTML = '<div style="padding:8px;">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
    +'<div style="font-size:11px;font-weight:800;color:#20231F;background:#e8eee5;padding:4px 12px;border-radius:99px;">'+weekLabel+' \u2014 '+storeCount+' Stores</div>'
    +'<div onclick="exportCard(\'overview-card\',\'Overview\')" style="cursor:pointer;font-size:11px;font-weight:700;color:#555;background:#f0f0f0;padding:4px 12px;border-radius:6px;">Export</div>'
    +'</div>'
    +'<div id="overview-card">'
    +'<div style="font-size:10px;font-weight:900;color:#999;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Products</div>'
    +prodHtml
    +'<div style="font-size:10px;font-weight:900;color:#999;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">KPIs</div>'
    +kpiHtml
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">'
    +'<div style="grid-column:span 1;">'+actHtml+'</div>'
    +'<div style="grid-column:span 1;">'+compHtml+'</div>'
    +'<div style="grid-column:span 1;">'+areaHtml+'</div>'
    +'</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">'
    +ehoHtml
    +'<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:16px;border-top:3px solid #D94F4F;">'
    +'<div style="font-size:13px;font-weight:900;color:#20231F;margin-bottom:8px;font-family:Merriweather,Georgia,serif;">EHO Overdue</div>'
    +(function(){
      if(!ehoData || !ehoData.length) return '<div style="font-size:12px;color:#999;">No EHO data loaded.</div>';
      var now = new Date();
      var overdue = [];
      ehoData.forEach(function(d){
        var dueDate = null;
        if(d.nextDue){ dueDate = parseUKDate(d.nextDue); }
        if(!dueDate && d.ehoVisit){ var vd = parseUKDate(d.ehoVisit); if(vd && !isNaN(vd.getTime())){ dueDate = new Date(vd); dueDate.setFullYear(dueDate.getFullYear() + 1); } }
        if(!dueDate && d.inspectionDate){ var id2 = parseUKDate(d.inspectionDate); if(id2 && !isNaN(id2.getTime())){ dueDate = new Date(id2); dueDate.setFullYear(dueDate.getFullYear() + 1); } }
        if(dueDate && !isNaN(dueDate.getTime()) && dueDate < now){
          var dd = ('0'+dueDate.getDate()).slice(-2)+'/'+('0'+(dueDate.getMonth()+1)).slice(-2)+'/'+dueDate.getFullYear();
          overdue.push({store: d.StoreId || d.name || '?', days: Math.ceil((now - dueDate) / 86400000), dateStr: dd, rating: d.ehoRating || d.rating || ''});
        }
      });
      overdue.sort(function(a,b){return b.days - a.days;});
      if(!overdue.length) return '<div style="font-size:12px;color:#6E8E6D;font-weight:700;">All inspections up to date</div>';
      var html = '';
      overdue.slice(0,5).forEach(function(r){
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #eee;font-size:12px;">'
          +'<span style="font-weight:700;">'+r.store+'</span>'
          +'<span style="color:#D94F4F;font-weight:800;">'+r.days+' days overdue</span></div>';
      });
      if(overdue.length > 5) html += '<div style="font-size:11px;color:#999;margin-top:6px;">+'+(overdue.length-5)+' more overdue</div>';
      return html;
    })()
    +'</div>'
    +'</div>'
    +'</div>'
    +'</div>';
}
