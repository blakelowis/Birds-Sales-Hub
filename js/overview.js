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

function renderOverviewFresh(bAvgs, pAvgs, ehoData, allActions, auditMap, effectiveWeek, amStatsGlobal, storeCount){
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

  // Area standings
  var areaHtml = '';
  if(amStatsGlobal && amStatsGlobal.length){
    areaHtml = '<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:16px;">'
      +'<div style="font-size:13px;font-weight:900;color:#20231F;margin-bottom:12px;font-family:Merriweather,Georgia,serif;">Network Area Standings</div>';
    amStatsGlobal.forEach(function(am, i){
      var rankCol = i===0?'#20231F':i===1?'#555':'#888';
      areaHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eee;">'
        +'<div style="display:flex;align-items:center;gap:10px;">'
        +'<span style="width:24px;height:24px;border-radius:50%;background:'+(i<3?'#e8eee5':'#f5f5f5')+';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:'+rankCol+';">'+(i+1)+'</span>'
        +'<span style="font-weight:800;font-size:13px;color:#20231F;">'+am.am+'</span></div>'
        +'<div style="display:flex;gap:16px;font-size:12px;font-weight:700;">'
        +'<span style="color:#60755f;width:60px;text-align:right;">'+(am.sAvg*100).toFixed(1)+'%</span>'
        +'<span style="color:#a47772;width:60px;text-align:right;">'+(am.lAvg*100).toFixed(1)+'%</span>'
        +'<span style="color:#C17F4E;width:60px;text-align:right;">'+(am.wAvg*100).toFixed(1)+'%</span>'
        +'</div></div>';
    });
    areaHtml += '</div>';
  }

  // Audit compliance
  var sectors = ['Food','Fire','HandS','Journey','Coffee','Focus'];
  var sectorLabels = {Food:'Food Safety',Fire:'Fire Safety',HandS:'Health & Safety',Journey:'Cust. Journey',Coffee:'Coffee Standard',Focus:'Birds Focus'};
  var sHtml = '<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:16px;">'
    +'<div style="font-size:13px;font-weight:900;color:#20231F;margin-bottom:12px;font-family:Merriweather,Georgia,serif;">Sector Compliance</div>';
  sectors.forEach(function(s){
    var vals = Array.from(auditMap.values());
    var sAvg = vals.reduce(function(a,b){return a+(b[s]||0);},0)/(vals.length||1);
    var col = sAvg>=95?'#6E8E6D':sAvg>=90?'#C17F4E':'#D94F4F';
    sHtml += '<div style="margin-bottom:8px;">'
      +'<div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin-bottom:3px;"><span>'+sectorLabels[s]+'</span><span style="color:'+col+';">'+sAvg.toFixed(1)+'%</span></div>'
      +'<div style="height:6px;background:#e8eee5;border-radius:3px;"><div style="height:100%;width:'+sAvg+'%;background:'+col+';border-radius:3px;"></div></div>'
      +'</div>';
  });
  sHtml += '</div>';

  // EHO
  var ehoHtml = '<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:16px;border-top:3px solid #D97706;">'
    +'<div style="font-size:13px;font-weight:900;color:#20231F;margin-bottom:8px;font-family:Merriweather,Georgia,serif;">EHO Inspections</div>';
  if(ehoData && ehoData.length){
    var ehoList = [];
    ehoData.forEach(function(d){
      var inspDate = d.inspectionDate || d.ehoVisit || d.nextDue || '';
      if(!inspDate) return;
      var parsed = parseUKDate(inspDate);
      if(!parsed || isNaN(parsed.getTime())) return;
      var dd = ('0'+parsed.getDate()).slice(-2)+'/'+('0'+(parsed.getMonth()+1)).slice(-2)+'/'+parsed.getFullYear();
      ehoList.push({store: d.StoreId, rating: d.ehoRating||'', date: parsed, dateStr: dd});
    });
    ehoList.sort(function(a,b){return b.date-a.date;});
    ehoList.slice(0,5).forEach(function(r){
      ehoHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:12px;">'
        +'<span style="font-weight:700;">'+r.store+'</span>'
        +'<span style="color:#a47772;">'+r.dateStr+' ('+r.rating+' star)</span></div>';
    });
  }
  ehoHtml += '</div>';

  // Critical actions
  var actHtml = '<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:16px;border-top:3px solid #a47772;">'
    +'<div style="font-size:13px;font-weight:900;color:#20231F;margin-bottom:8px;font-family:Merriweather,Georgia,serif;">Critical Actions</div>';
  if(allActions && allActions.length){
    var crits = allActions.filter(function(a){return a.Critical==='Yes';}).length;
    actHtml += '<div style="font-size:28px;font-weight:900;color:#a47772;margin-bottom:4px;">'+((crits/allActions.length)*100).toFixed(1)+'%</div>'
      +'<div style="font-size:11px;color:#555;">'+crits+' of '+allActions.length+' actions flagged critical</div>';
  } else {
    actHtml += '<div style="font-size:12px;color:#999;">No action data</div>';
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
    +'<div style="grid-column:span 1;">'+sHtml+'</div>'
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
        var nd = d.nextDue || '';
        if(!nd) return;
        var parsed = parseUKDate(nd);
        if(!parsed || isNaN(parsed.getTime())) return;
        var days = Math.ceil((parsed - now) / 86400000);
        if(days < 0) overdue.push({store: d.StoreId || d.name || '?', days: Math.abs(days), dateStr: nd, rating: d.ehoRating || d.rating || ''});
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
