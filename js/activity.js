/* ─── Activity Feed / Timeline ─────────────────────────────────── */

function parseUKDate(s){
  if(!s)return null;
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(s)){var p=s.split('/');return new Date(p[2],p[1]-1,p[0]);}
  if(typeof s==='string'&&s.indexOf('T')>0){var d=new Date(s);return isNaN(d.getTime())?null:d;}
  var d=new Date(s);return isNaN(d.getTime())?null:d;
}
function fmtDateDisplay(d){
  if(!d)return '';
  var dd=d.getDate(),mm=d.getMonth()+1,yy=d.getFullYear();
  return (dd<10?'0'+dd:dd)+'/'+(mm<10?'0'+mm:mm)+'/'+yy;
}
function fmtShortDate(d){
  if(!d)return '';
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear();
}

/* ─── Cached data loader ──────────────────────────────────────── */
var ACTIVITY_CACHE_KEY='activity_cache';
var ACTIVITY_CACHE_TTL=86400000;

function _activityCacheGet(){
  try{
    var raw=localStorage.getItem(ACTIVITY_CACHE_KEY);
    if(!raw)return null;
    var cache=JSON.parse(raw);
    if(!cache||!cache.items||!cache.cachedAt)return null;
    cache.items.forEach(function(i){if(typeof i.date==='string')i.date=new Date(i.date);});
    return {items:cache.items,age:Date.now()-new Date(cache.cachedAt).getTime(),cachedAt:cache.cachedAt};
  }catch(e){return null;}
}

function _activityCacheSet(items){
  try{
    var ser=items.map(function(i){var o={};for(var k in i){if(k==='date')o.date=i.date.toISOString();else o[k]=i[k];}return o;});
    localStorage.setItem(ACTIVITY_CACHE_KEY,JSON.stringify({items:ser,cachedAt:new Date().toISOString()}));
  }catch(e){}
  window._activityCache=items;
}

/* ─── Core data loader ─────────────────────────────────────────── */
async function loadActivityData(forceRefresh){
  if(window._activityCache&&!forceRefresh)return window._activityCache;
  if(!forceRefresh){
    var cached=_activityCacheGet();
    if(cached&&cached.age<ACTIVITY_CACHE_TTL){
      window._activityCache=cached.items;
      return cached.items;
    }
  }
  var items=[];
  /* 1. Load audit actions (from Open/Closed JSON files via audit hub) */
  try{
    if(typeof getAuditActionsForReport==='function'){
      var actions=window._dc&&window._dc.actions ? window._dc.actions : await getAuditActionsForReport();
      (actions||[]).forEach(function(a){
        var d=parseUKDate(a.AuditDate);
        if(!d && a.Week && a.Year){
          var jan1=new Date(a.Year,0,1);
          var daysToAdd=(a.Week-1)*7;
          d=new Date(jan1.getTime()+daysToAdd*86400000);
          if(isNaN(d.getTime()))d=null;
        }
        if(!d)return;
        items.push({
          date:d,type:'audit',module:'Audits',
          actor:a.Auditor||'Unknown',
          store:a.Store||'',
          description:'Audit '+(a.Store||'')+' — Score: '+(a.Score!==undefined?a.Score+'%':'No score'),
          status:a.Status||'Open',
          category:a.Sector||'',
          ref:a.ActionID||''
        });
      });
    }
  }catch(e){console.warn('[Calendar] audit actions:',e);}
  /* 2. Load audits summary (scorecards) */
  try{
    var audits=await idbGetAll('audits');
    (audits||[]).forEach(function(a){
      var d=parseUKDate(a.date||a.AuditDate);
      if(!d && a.Week && a.Year){
        var jan1=new Date(a.Year,0,1);
        var daysToAdd=(a.Week-1)*7;
        d=new Date(jan1.getTime()+daysToAdd*86400000);
        if(isNaN(d.getTime()))d=null;
      }
      if(!d)return;
      var sectors=[];
      if(a.Food!==undefined)sectors.push('Food:'+a.Food+'%');
      if(a.Fire!==undefined)sectors.push('Fire:'+a.Fire+'%');
      if(a.HandS!==undefined)sectors.push('H&S:'+a.HandS+'%');
      if(a.Journey!==undefined)sectors.push('Journey:'+a.Journey+'%');
      if(a.Coffee!==undefined)sectors.push('Coffee:'+a.Coffee+'%');
      if(a.Focus!==undefined)sectors.push('Focus:'+a.Focus+'%');
      items.push({
        date:d,type:'audit_summary',module:'Audits',
        actor:'',
        store:a.Store||'',
        description:'Audit Score: '+(a.Score||0).toFixed(1)+'% — '+sectors.join(', '),
        status:'Complete',
        category:'Audit',
        ref:(a.Store||'')+'_'+(a.Year||'')+'_'+(a.Week||'')
      });
    });
  }catch(e){console.warn('[Calendar] audits:',e);}
  /* 3. Load complaints */
  try{
    var complaints=window.ComplaintsData||await idbGetAll('complaints');
    (complaints||[]).forEach(function(c){
      var d=parseUKDate(c['Date of complaint']);
      if(!d)return;
      items.push({
        date:d,type:'complaint',module:'Complaints',
        actor:c['Customer full name']||'Anonymous',
        store:c['Shop bought from']||'',
        description:(c['Type of complaint']||'Complaint')+(c['Product Type']?' – '+c['Product Type']:'')+(c['Status']==='Resolved'?' ✅':''),
        status:c['Status']||'Unknown',
        category:c['Type of complaint']||'General',
        ref:c.id||''
      });
    });
  }catch(e){console.warn('[Calendar] complaints:',e);}
  /* 4. Load documents */
  try{
    var docs=[];
    if(window.currentLoadedDocs){
      ['open','resolved','archived'].forEach(function(f){(window.currentLoadedDocs[f]||[]).forEach(function(d){if(d)docs.push(d);});});
    }
    (docs||[]).forEach(function(d){
      var dt=parseUKDate(d.createdAt||d.date);
      if(!dt)return;
      items.push({date:dt,type:'document',module:'Documents',actor:d.creator||d.creatorId||'Unknown',store:d.linkedToRecord||'',description:(d.title||d.name||'Document')+(d.status==='Open'?' ✏️':' ✅'),status:d.status||'Open',category:d.department||'',ref:d.id||''});
    });
  }catch(e){console.warn('[Calendar] documents:',e);}
  /* 5. Load projects */
  try{
    var projects=[];
    if(typeof Projects!=='undefined'&&Projects._loadAll)projects=await Projects._loadAll();
    (projects||[]).forEach(function(p){
      var dt=parseUKDate(p.createdAt);
      if(!dt)return;
      items.push({date:dt,type:'project',module:'Projects',actor:p.createdByName||p.createdBy||'Unknown',store:'',description:'Project: '+(p.name||'')+' — '+(p.status==='resolved'?'✅ Resolved':'Active')+(p.department?' ('+p.department+')':''),status:p.status||'active',category:p.department||'',ref:p.id||''});
      (p.stages||[]).forEach(function(s,i){
        var sd=parseUKDate(s.completedAt||s.dueDate);
        if(!sd||s.status!=='completed')return;
        items.push({date:sd,type:'project_stage',module:'Projects',actor:s.completedByName||'Unknown',store:'',description:'Stage completed: '+s.title+' ('+p.name+')',status:'completed',category:p.department||'',ref:p.id+'/'+i});
      });
    });
  }catch(e){console.warn('[Calendar] projects:',e);}
  /* 6. Load EHO / Tracker data */
  try{
    var ehoRecords=window._ehoRatings;
    if(ehoRecords&&ehoRecords.size){
      ehoRecords.forEach(function(v,k){
        if(v.nextDue){
          var nd=parseUKDate(v.nextDue);
          if(nd){
            var days=Math.round((nd-new Date())/86400000);
            items.push({date:nd,type:'eho',module:'EHO',actor:'',store:v.name||k,description:'EHO store due — '+(v.name||k)+'. Rating: '+v.rating+'★'+(days<0?' (OVERDUE '+Math.abs(days)+' days)':' (Due in '+days+' days)'),status:days<0?'Overdue':'Pending',category:'EHO',ref:k});
          }
        }
      });
    }
    var trackerData=await idbGetAll('eho_data');
    (trackerData||[]).forEach(function(t){
      var vd=parseUKDate(t.lastVisit||t.visitDate||t.date);
      if(vd){items.push({date:vd,type:'eho_visit',module:'Tracker',actor:'',store:t.StoreId||t.storeId||t.id||'',description:'Store had EHO — '+(t.StoreId||t.storeId||t.id||'')+(t.rating?' Score: '+t.rating:'')+(t.notes?' — '+t.notes:''),status:'Complete',category:'Tracker',ref:t.StoreId||t.id||''});}
    });
  }catch(e){console.warn('[Calendar] eho:',e.message);}
  items.sort(function(a,b){return b.date.getTime()-a.date.getTime();});
  _activityCacheSet(items);
  return items;
}

/* ─── Render view ───────────────────────────────────────────────── */
function renderActivityView(){
  var el=document.getElementById('mainView');
  if(!el)return;
  var cached=_activityCacheGet();
  if(cached&&cached.items.length){
    _renderActivityUI(el,cached.items,false);
    setTimeout(function(){
      loadActivityData(true).then(function(fresh){
        window._activityItems=fresh;
        _renderActivityUI(el,fresh,true);
      }).catch(function(){});
    },100);
    return;
  }
  el.innerHTML='<div style="text-align:center;padding:40px;font-size:14px">'+
    '<div style="display:inline-block;width:24px;height:24px;border:3px solid #E8E5E0;border-top-color:#8BA88A;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:10px"></div>'+
    '<span style="color:#7A7A7A;font-weight:600;">Loading calendar data...</span></div>';
  loadActivityData().then(function(allItems){
    window._activityItems=allItems;
    _renderActivityUI(el,allItems,true);
  }).catch(function(err){
    console.error('[Calendar] Error:',err);
    el.innerHTML='<div class="card" style="text-align:center;padding:30px;color:#D94F4F">Error loading data: '+err.message+'</div>';
  });
}

/* ─── Build UI ─────────────────────────────────────────────────── */
var _activityItems=[];
var _calViewMonth = new Date().getMonth();
var _calViewYear = new Date().getFullYear();
var _calCategory = 'all';

function _calendarNav(dir) {
  _calViewMonth += dir;
  if (_calViewMonth < 0) { _calViewMonth = 11; _calViewYear--; }
  if (_calViewMonth > 11) { _calViewMonth = 0; _calViewYear++; }
  _renderActivityUI(document.getElementById('mainView'), window._activityItems || [], false);
}

function _setCalCat(cat) {
  _calCategory = cat;
  _renderActivityUI(document.getElementById('mainView'), window._activityItems || [], false);
}

function _renderActivityUI(el,allItems,isFresh){
  var now=new Date();
  var weekAgo=new Date(now.getTime()-7*86400000);
  var recentWeek=allItems.filter(function(i){return i.date>=weekAgo;});
  var tallyAudits=recentWeek.filter(function(i){return i.type==='audit'||i.type==='audit_summary';}).length;
  var tallyComplaints=recentWeek.filter(function(i){return i.type==='complaint';}).length;
  var tallyEho=recentWeek.filter(function(i){return i.type==='eho'||i.type==='eho_visit';}).length;
  var tallyProjects=recentWeek.filter(function(i){return i.type==='project'||i.type==='project_stage';}).length;

  var catColors={audit:'#C17F4E',audit_summary:'#C17F4E',complaint:'#D94F4F',eho:'#F59E0B',eho_visit:'#F59E0B',document:'#8BA88A',project:'#6B7280',project_stage:'#6B7280'};
  var catTitles={audit:'Audits',complaint:'Complaints',eho:'EHO Visits',project:'Projects'};
  var catNames=['audit','complaint','eho','project'];
  var catTallies={audit:tallyAudits,complaint:tallyComplaints,eho:tallyEho,project:tallyProjects};

  var filteredItems=allItems;
  if(_calCategory!=='all'){
    filteredItems=allItems.filter(function(i){
      if(_calCategory==='audit')return i.type==='audit'||i.type==='audit_summary';
      if(_calCategory==='project')return i.type==='project'||i.type==='project_stage';
      return i.type===_calCategory||i.type===_calCategory+'_summary'||i.type===_calCategory+'_visit';
    });
  }

  var thisMonth=_calViewMonth,thisYear=_calViewYear;
  var monthItems=filteredItems.filter(function(i){return i.date.getMonth()===thisMonth&&i.date.getFullYear()===thisYear;});
  var dayMap={};
  monthItems.forEach(function(i){
    var key=i.date.getDate();
    if(!dayMap[key])dayMap[key]=[];
    dayMap[key].push(i);
  });

  var firstDay=new Date(thisYear,thisMonth,1);
  var lastDay=new Date(thisYear,thisMonth+1,0);
  var startDow=firstDay.getDay();
  var daysInMonth=lastDay.getDate();
  var dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];

  var calCells='';
  dayNames.forEach(function(n){calCells+='<div style="font-size:10px;font-weight:700;color:#999;text-align:center;padding:4px 0">'+n+'</div>';});
  for(var i=0;i<startDow;i++)calCells+='<div></div>';
  for(var d=1;d<=daysInMonth;d++){
    var dayEntries=dayMap[d]||[];
    var isToday=(d===now.getDate()&&thisMonth===now.getMonth()&&thisYear===now.getFullYear());
    var dotHtml='';
    var seenCols={};
    dayEntries.forEach(function(e){
      var c=catColors[e.type]||'#999';
      if(!seenCols[c]){dotHtml+='<div style="width:5px;height:5px;border-radius:50%;background:'+c+';display:inline-block;margin:0 1px"></div>';seenCols[c]=true;}
    });
    var entryCount=dayEntries.length;
    calCells+='<div style="text-align:center;padding:4px 0;font-size:13px;cursor:pointer;'+(isToday?'font-weight:900;color:#166534;':'')+'" onclick="_showDayEntries('+d+')" title="'+entryCount+' entries">'+
      '<span>'+d+'</span><br>'+dotHtml+(entryCount>0?'<span style="font-size:8px;color:#999">'+entryCount+'</span>':'')+'</div>';
  }

  var cardsHtml='';
  catNames.forEach(function(cat){
    var c=catColors[cat];
    var count=catTallies[cat];
    var title=catTitles[cat];
    var active=_calCategory===cat?' ring-2 ring-offset-1':'';
    cardsHtml+='<div class="card" style="text-align:center;padding:14px;border-left:3px solid '+c+';cursor:pointer'+(active?';background:#fafafa':'')+'" onclick="_setCalCat(\''+cat+'\')">'+
      '<div style="font-size:10px;font-weight:800;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.5px">'+title+'</div>'+
      '<div style="font-size:36px;font-weight:900;color:'+c+';margin-top:4px">'+count+'</div>'+
      '<div style="font-size:9px;color:#aaa;margin-top:2px">this week</div></div>';
  });
  if(_calCategory!=='all'){
    cardsHtml+='<div class="card" style="text-align:center;padding:14px;cursor:pointer;border-left:3px solid #999" onclick="_setCalCat(\'all\')">'+
      '<div style="font-size:10px;font-weight:800;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.5px">All Activity</div>'+
      '<div style="font-size:36px;font-weight:900;color:#999;margin-top:4px">'+allItems.length+'</div>'+
      '<div style="font-size:9px;color:#aaa;margin-top:2px">total entries</div></div>';
  }

  var html='';
  html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'+
    '<h2 style="font-size:22px;font-weight:900;color:#20231F;margin:0;font-family:var(--birds-font-display)">'+
    (_calCategory==='all'?'Calendar':catTitles[_calCategory])+'</h2>'+
    '<span style="font-size:12px;color:#7A7A7A;font-weight:600">'+
    filteredItems.length+' entries'+
    (_calCategory!=='all'?' · <a href="#" onclick="_setCalCat(\'all\');return false" style="color:#8BA88A">Show all</a>':'')+
    '</span></div>';

  html+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">'+cardsHtml+'</div>';

  html+='<div style="display:grid;grid-template-columns:1fr 500px;gap:16px;margin-bottom:16px">'+
    '<div class="card" style="padding:16px;min-height:200px">'+
    '<div style="font-size:13px;font-weight:900;color:#20231F;margin-bottom:8px" id="cal-day-title">Click a day on the calendar</div>'+
    '<div id="cal-day-entries" style="font-size:12px;color:#999">Select any date to see its entries here</div></div>'+
    '<div class="card" style="padding:16px">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'+
    '<button onclick="_calendarNav(-1)" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8BA88A;font-weight:700;padding:0 8px;">&larr;</button>'+
    '<div style="font-size:16px;font-weight:900;color:#20231F">'+monthNames[thisMonth]+' '+thisYear+'</div>'+
    '<button onclick="_calendarNav(1)" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8BA88A;font-weight:700;padding:0 8px;">&rarr;</button>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">'+calCells+'</div></div></div>';

  el.innerHTML=html;
  _activityItems=allItems;
  _showDayEntries(now.getDate());
}

/* ─── Show entries for a specific day ─────────────────────────── */
function _showDayEntries(day){
  var titleEl=document.getElementById('cal-day-title');
  var entriesEl=document.getElementById('cal-day-entries');
  if(!titleEl||!entriesEl)return;
  var thisMonth=_calViewMonth,thisYear=_calViewYear;
  var dayItems=_activityItems.filter(function(i){
    return i.date.getDate()===day&&i.date.getMonth()===thisMonth&&i.date.getFullYear()===thisYear;
  });
  if(_calCategory!=='all'){
    dayItems=dayItems.filter(function(i){
      if(_calCategory==='audit')return i.type==='audit'||i.type==='audit_summary';
      if(_calCategory==='project')return i.type==='project'||i.type==='project_stage';
      return i.type===_calCategory||i.type===_calCategory+'_summary'||i.type===_calCategory+'_visit';
    });
  }
  var monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  titleEl.textContent=day+' '+monthNames[thisMonth]+' '+thisYear+' ('+dayItems.length+' entries)';
  if(!dayItems.length){entriesEl.innerHTML='<div style="color:#999;padding:10px;text-align:center">No entries for this day</div>';return;}

  var catColors={audit:'#C17F4E',audit_summary:'#C17F4E',complaint:'#D94F4F',eho:'#F59E0B',eho_visit:'#F59E0B',document:'#8BA88A',project:'#6B7280',project_stage:'#6B7280'};
  var rows=dayItems.map(function(i){
    var c=catColors[i.type]||'#999';
    var typeLabel='';
    if(i.type==='audit'||i.type==='audit_summary')typeLabel='Audit';
    else if(i.type==='complaint')typeLabel='Complaint';
    else if(i.type==='eho'||i.type==='eho_visit')typeLabel='EHO';
    else if(i.type==='document')typeLabel='Document';
    else if(i.type==='project'||i.type==='project_stage')typeLabel='Project';
    var navLink='';
    if(i.type==='complaint')navLink=' — <a href="#" onclick="setActiveTab(\'audits\');setView(\'complaints\');return false" style="color:#D94F4F;font-weight:700">View</a>';
    if((i.type==='audit'||i.type==='audit_summary')&&i.store)navLink=' — <a href="#" onclick="setActiveTab(\'audits\');setView(\'auditexport\');return false" style="color:#C17F4E;font-weight:700">View in Audit Hub</a>';
    if(i.type==='eho'||i.type==='eho_visit')navLink=' — <a href="#" onclick="setActiveTab(\'audits\');setView(\'tracker\');return false" style="color:#F59E0B;font-weight:700">Open Tracker</a>';
    return '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0">'+
      '<div style="width:8px;height:8px;border-radius:50%;background:'+c+';margin-top:4px;flex-shrink:0"></div>'+
      '<div style="flex:1"><div style="font-size:11px;font-weight:700;color:'+c+'">'+typeLabel+'</div>'+
      '<div style="font-size:12px;color:#4A4A4A">'+(i.store?'<b>'+i.store+'</b> — ':'')+i.description+'</div>'+
      '<div style="font-size:10px;color:#999;margin-top:2px">'+i.status+navLink+'</div></div></div>';
  }).join('');
  entriesEl.innerHTML=rows;
}
