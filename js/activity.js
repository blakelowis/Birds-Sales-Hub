/* ─── Activity Feed / Timeline ─────────────────────────────────── */

function parseUKDate(s){
  if(!s)return null;
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(s)){var p=s.split('/');return new Date(p[2],p[1]-1,p[0]);}
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

async function loadActivityData(){
  var items=[];

  // 1. Load audit actions
  try{
    var actions=await idbGetAll('actions');
    (actions||[]).forEach(function(a){
      var d=parseUKDate(a.AuditDate);
      if(!d)return;
      items.push({
        date:d,type:'audit',module:'Audits',
        actor:a.Auditor||'Unknown',
        store:a.Store||'',
        description:(a.Critical==='Yes'?'⚠ ':'')+(a.Sector||'Audit')+' – '+(a.ActionNeeded||a.Description||'Action item'),
        status:a.Status||'Open',
        category:a.Sector||'',
        ref:a.ActionID||''
      });
    });
  }catch(e){console.warn('[Activity] actions:',e);}

  // 2. Load audits summary (one entry per audit)
  try{
    var audits=await idbGetAll('audits');
    (audits||[]).forEach(function(a){
      var d=parseUKDate(a.date||a.AuditDate);
      if(!d)return;
      items.push({
        date:d,type:'audit_summary',module:'Audits',
        actor:a.Auditor||'Unknown',
        store:a.Store||'',
        description:'Completed audit — Score: '+(a.Score||0).toFixed(1)+'%',
        status:'Complete',
        category:'Audit Summary',
        ref:(a.Store||'')+'_'+(a.Year||'')+'_'+(a.Week||'')
      });
    });
  }catch(e){console.warn('[Activity] audits:',e);}

  // 3. Load complaints
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
  }catch(e){console.warn('[Activity] complaints:',e);}

  // 4. Load documents (from in-memory cache or IDB fallback)
  try{
    var docs=[];
    if(window.currentLoadedDocs){
      ['open','resolved','archived'].forEach(function(f){
        (window.currentLoadedDocs[f]||[]).forEach(function(d){
          if(d)docs.push(d);
        });
      });
    }
    if(!docs.length && window._localDocsConnection){
      // IDB fallback
      var tx=window._localDocsConnection.transaction('files','readonly');
      var store=tx.objectStore('files');
      var req=store.openCursor();
      await new Promise(function(resolve){
        req.onsuccess=function(e){
          var cursor=e.target.result;
          if(cursor){
            var p=cursor.value.path;
            if(p && p.indexOf('Documents/')===0 && !p.startsWith('__deleted__')){
              try{ docs.push(JSON.parse(cursor.value.data)); }catch(ex){}
            }
            cursor.continue();
          }else resolve();
        };
        req.onerror=function(){resolve();};
      });
    }
    (docs||[]).forEach(function(d){
      var dt=parseUKDate(d.createdAt||d.date);
      if(!dt)return;
      items.push({
        date:dt,type:'document',module:'Documents',
        actor:d.creator||d.creatorId||'Unknown',
        store: d.linkedToRecord||'',
        description:(d.title||d.name||'Document')+(d.status==='Open'?' ✏️':' ✅'),
        status:d.status||'Open',
        category:d.department||'',
        ref:d.id||''
      });
    });
  }catch(e){console.warn('[Activity] documents:',e);}

  // 5. Load projects
  try{
    var projects=[];
    if(typeof Projects!=='undefined' && Projects._loadAll){
      projects=await Projects._loadAll();
    } else if(window._localDocsConnection){
      // Direct IDB fallback
      var tx=window._localDocsConnection.transaction('files','readonly');
      var store=tx.objectStore('files');
      var req=store.openCursor();
      await new Promise(function(resolve){
        req.onsuccess=function(e){
          var cursor=e.target.result;
          if(cursor){
            var p=cursor.value.path;
            if(p && p.indexOf('Projects/')===0 && p.endsWith('.json')){
              try{ projects.push(JSON.parse(cursor.value.data)); }catch(ex){}
            }
            cursor.continue();
          }else resolve();
        };
        req.onerror=function(){resolve();};
      });
    }
    (projects||[]).forEach(function(p){
        var dt=parseUKDate(p.createdAt);
        if(!dt)return;
        items.push({
          date:dt,type:'project',module:'Projects',
          actor:p.createdByName||p.createdBy||'Unknown',
          store:'',
          description:(p.name||'Project')+' – '+p.department+(p.status==='resolved'?' ✅':''),
          status:p.status||'active',
          category:p.department||'',
          ref:p.id||''
        });
        // Also add stage completions
        (p.stages||[]).forEach(function(s,i){
          var sd=parseUKDate(s.completedAt||s.dueDate);
          if(!sd||s.status!=='completed')return;
          var assignee=s.completedByName||s.assignedTo?((s.assignedTo||[]).join(', ')):'';
          items.push({
            date:sd,type:'project_stage',module:'Projects',
            actor:assignee||p.createdByName||'Unknown',
            store:'',
            description:'Stage completed: '+s.title+' ('+p.name+')',
            status:'completed',
            category:p.department||'',
            ref:p.id+'/'+i
          });
        });
      });
    }catch(e){console.warn('[Activity] projects:',e);}

  // Sort by date DESC
  items.sort(function(a,b){return b.date.getTime()-a.date.getTime();});
  return items;
}

function renderActivityView(){
  var el=document.getElementById('mainView');
  if(!el)return;
  el.innerHTML='<div style="text-align:center;padding:40px;color:#7A7A7A;font-size:14px">Loading activity feed...</div>';

  loadActivityData().then(function(allItems){
    // Build tallies
    var now=new Date();
    var weekAgo=new Date(now.getTime()-7*86400000);
    var monthAgo=new Date(now.getTime()-30*86400000);
    var recentWeek=allItems.filter(function(i){return i.date>=weekAgo;});
    var recentMonth=allItems.filter(function(i){return i.date>=monthAgo;});

    var tallyAudits=recentWeek.filter(function(i){return i.type==='audit'||i.type==='audit_summary';}).length;
    var tallyComplaints=recentWeek.filter(function(i){return i.type==='complaint';}).length;
    var tallyDocs=recentWeek.filter(function(i){return i.type==='document';}).length;
    var tallyProjects=recentWeek.filter(function(i){return i.type==='project'||i.type==='project_stage';}).length;

    // Build store filter list
    var stores=[];
    allItems.forEach(function(i){if(i.store&&stores.indexOf(i.store)===-1)stores.push(i.store);});
    stores.sort();

    // Build month calendar data (current month)
    var thisMonth=now.getMonth(),thisYear=now.getFullYear();
    var monthItems=allItems.filter(function(i){
      return i.date.getMonth()===thisMonth && i.date.getFullYear()===thisYear;
    });
    var dayMap={};
    monthItems.forEach(function(i){
      var key=i.date.getDate();
      if(!dayMap[key])dayMap[key]=new Set();
      dayMap[key].add(i.type);
    });

    var firstDay=new Date(thisYear,thisMonth,1);
    var lastDay=new Date(thisYear,thisMonth+1,0);
    var startDow=firstDay.getDay(); // 0=Sun
    var daysInMonth=lastDay.getDate();
    var dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Generate calendar grid
    var calCells='';
    dayNames.forEach(function(n){calCells+='<div style="font-size:9px;font-weight:700;color:#999;text-align:center;padding:2px 0">'+n+'</div>';});
    for(var i=0;i<startDow;i++)calCells+='<div></div>';
    for(var d=1;d<=daysInMonth;d++){
      var hasAct=dayMap[d];
      var isToday=(d===now.getDate()&&thisMonth===now.getMonth()&&thisYear===now.getFullYear());
      var dotHtml='';
      if(hasAct){
        var colors={audit:'#C17F4E',audit_summary:'#C17F4E',complaint:'#D94F4F',document:'#8BA88A',project:'#6B7280',project_stage:'#6B7280'};
        var seen={};
        hasAct.forEach(function(t){
          var c=colors[t]||'#999';
          if(!seen[c]){dotHtml+='<div style="width:4px;height:4px;border-radius:50%;background:'+c+';display:inline-block;margin:0 1px"></div>';seen[c]=true;}
        });
      }
      calCells+='<div style="text-align:center;padding:3px 0;font-size:12px;'+(isToday?'font-weight:900;color:#166534;':'')+'">'+
        '<span style="cursor:pointer" onclick="document.getElementById(\'activity-filter-date\').value='+d+';document.getElementById(\'activity-filter-date\').dispatchEvent(new Event(\'change\'))">'+d+'</span>'+
        '<br>'+dotHtml+'</div>';
    }

    var monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];

    var html='';
    html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'+
      '<h2 style="font-size:22px;font-weight:900;color:#20231F;margin:0;font-family:var(--birds-font-display)">Activity Timeline</h2>'+
      '<span style="font-size:12px;color:#7A7A7A;font-weight:600">'+allItems.length+' total entries</span></div>';

    // Tally cards
    html+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">'+
      '<div class="card" style="text-align:center;padding:12px;border-left:3px solid #C17F4E">'+
        '<div style="font-size:9px;font-weight:800;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.5px">Audits (7d)</div>'+
        '<div style="font-size:24px;font-weight:900;color:#C17F4E;margin-top:2px">'+tallyAudits+'</div></div>'+
      '<div class="card" style="text-align:center;padding:12px;border-left:3px solid #D94F4F">'+
        '<div style="font-size:9px;font-weight:800;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.5px">Complaints (7d)</div>'+
        '<div style="font-size:24px;font-weight:900;color:#D94F4F;margin-top:2px">'+tallyComplaints+'</div></div>'+
      '<div class="card" style="text-align:center;padding:12px;border-left:3px solid #8BA88A">'+
        '<div style="font-size:9px;font-weight:800;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.5px">Documents (7d)</div>'+
        '<div style="font-size:24px;font-weight:900;color:#8BA88A;margin-top:2px">'+tallyDocs+'</div></div>'+
      '<div class="card" style="text-align:center;padding:12px;border-left:3px solid #6B7280">'+
        '<div style="font-size:9px;font-weight:800;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.5px">Projects (7d)</div>'+
        '<div style="font-size:24px;font-weight:900;color:#6B7280;margin-top:2px">'+tallyProjects+'</div></div>'+
      '</div>';

    // Calendar + filters row
    html+='<div style="display:grid;grid-template-columns:300px 1fr;gap:16px;margin-bottom:16px">';

    // Calendar
    html+='<div class="card" style="padding:12px">'+
      '<div style="font-size:12px;font-weight:900;color:#20231F;margin-bottom:8px;text-align:center">'+monthNames[thisMonth]+' '+thisYear+'</div>'+
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">'+calCells+'</div>'+
      '<div style="display:flex;gap:12px;margin-top:8px;font-size:9px;color:#7A7A7A;justify-content:center">'+
        '<span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#C17F4E;margin-right:3px;vertical-align:middle"></span>Audits</span>'+
        '<span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#D94F4F;margin-right:3px;vertical-align:middle"></span>Complaints</span>'+
        '<span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#8BA88A;margin-right:3px;vertical-align:middle"></span>Docs</span>'+
        '<span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#6B7280;margin-right:3px;vertical-align:middle"></span>Projects</span>'+
      '</div></div>';

    // Filters
    html+='<div class="card" style="padding:12px">';
    html+='<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">';

    // Type filter
    html+='<select id="activity-filter-type" onchange="renderActivity()" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-weight:600">'+
      '<option value="all">All Activity</option>'+
      '<option value="audit">Audits</option>'+
      '<option value="complaint">Complaints</option>'+
      '<option value="document">Documents</option>'+
      '<option value="project">Projects</option></select>';

    // Store filter
    html+='<select id="activity-filter-store" onchange="renderActivity()" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-weight:600;flex:1;max-width:250px">'+
      '<option value="">All Stores</option>';
    stores.forEach(function(s){html+='<option value="'+s.replace(/"/g,'&quot;')+'">'+s+'</option>';});
    html+='</select>';

    // Actor filter
    html+='<select id="activity-filter-actor" onchange="renderActivity()" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-weight:600;flex:1;max-width:200px">'+
      '<option value="">All People</option></select>';

    // Date filter
    html+='<select id="activity-filter-range" onchange="renderActivity()" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-weight:600">'+
      '<option value="30">Last 30 Days</option>'+
      '<option value="7">Last 7 Days</option>'+
      '<option value="90">Last 90 Days</option>'+
      '<option value="all">All Time</option></select>';

    html+='<input type="hidden" id="activity-filter-date" value="" onchange="renderActivity()">';
    html+='</div></div></div>'; // close filter card + grid

    // Timeline
    html+='<div id="activity-timeline"></div>';

    el.innerHTML=html;

    // Populate actor filter
    var actors=[];
    allItems.forEach(function(i){if(i.actor&&actors.indexOf(i.actor)===-1)actors.push(i.actor);});
    actors.sort();
    var actorSel=document.getElementById('activity-filter-actor');
    actors.forEach(function(a){actorSel.innerHTML+='<option value="'+a.replace(/"/g,'&quot;')+'">'+a+'</option>';});

    // Store actor filter changes
    window.renderActivity=function(){
      var typeFilter=document.getElementById('activity-filter-type').value;
      var storeFilter=document.getElementById('activity-filter-store').value.toLowerCase();
      var actorFilter=document.getElementById('activity-filter-actor').value;
      var rangeFilter=document.getElementById('activity-filter-range').value;
      var dateFilter=parseInt(document.getElementById('activity-filter-date').value)||0;

      var now2=new Date();
      var cutoff=rangeFilter==='all'?null:new Date(now2.getTime()-parseInt(rangeFilter)*86400000);

      var filtered=allItems.filter(function(i){
        if(typeFilter!=='all'){
          if(typeFilter==='audit' && i.type!=='audit' && i.type!=='audit_summary')return false;
          if(typeFilter==='project' && i.type!=='project' && i.type!=='project_stage')return false;
          if(typeFilter!=='audit' && typeFilter!=='project' && i.type!==typeFilter)return false;
        }
        if(storeFilter && i.store.toLowerCase().indexOf(storeFilter)===-1)return false;
        if(actorFilter && i.actor!==actorFilter)return false;
        if(cutoff && i.date<cutoff)return false;
        if(dateFilter>0 && i.date.getDate()!==dateFilter)return false;
        return true;
      });

      var timelineEl=document.getElementById('activity-timeline');
      if(!timelineEl)return;

      if(!filtered.length){
        timelineEl.innerHTML='<div class="card" style="text-align:center;padding:30px;color:#7A7A7A">No activity matches your filters</div>';
        return;
      }

      // Group by date
      var groups={};
      filtered.forEach(function(i){
        var key=fmtDateDisplay(i.date);
        if(!groups[key])groups[key]={date:i.date,items:[]};
        groups[key].items.push(i);
      });
      var sortedDates=Object.keys(groups).sort(function(a,b){
        return groups[b].date.getTime()-groups[a].date.getTime();
      });

      var tlHtml='';
      sortedDates.forEach(function(key){
        var g=groups[key];
        tlHtml+='<div style="margin-bottom:16px">'+
          '<div style="font-size:11px;font-weight:900;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;padding-left:4px">'+
          fmtShortDate(g.date)+'</div>';
        g.items.forEach(function(i){
          var icons={audit:'🔍',audit_summary:'📊',complaint:'⚠️',document:'📄',project:'📋',project_stage:'✅'};
          var icon=icons[i.type]||'📌';
          var colors={audit:'#C17F4E',audit_summary:'#C17F4E',complaint:'#D94F4F',document:'#8BA88A',project:'#6B7280',project_stage:'#6B7280'};
          var borderColor=colors[i.type]||'#ddd';
          tlHtml+='<div class="card" style="padding:10px 14px;margin-bottom:6px;border-left:3px solid '+borderColor+';display:flex;align-items:flex-start;gap:10px">'+
            '<span style="font-size:16px;line-height:1.4">'+icon+'</span>'+
            '<div style="flex:1;min-width:0">'+
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">'+
                '<span style="font-size:13px;font-weight:700;color:#20231F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+i.description+'</span>'+
                (i.status?'<span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:99px;background:'+(i.status==='Closed'||i.status==='resolved'||i.status==='Resolved'||i.status==='completed'?'#E8F0E8;color:#166534':'#FEF3C7;color:#92400e')+'">'+i.status+'</span>':'')+
              '</div>'+
              '<div style="font-size:11px;color:#7A7A7A;margin-top:2px">'+
                (i.actor&&i.actor!=='Unknown'&&i.actor!=='Anonymous'?i.actor+' · ':'')+
                (i.store?i.store+' · ':'')+
                i.module+
                (i.category?' · '+i.category:'')+
              '</div></div></div>';
        });
        tlHtml+='</div>';
      });

      timelineEl.innerHTML=tlHtml;
    };

    // Initial render
    window.renderActivity();
  }).catch(function(err){
    console.error('[Activity] Error loading data:',err);
    el.innerHTML='<div class="card" style="text-align:center;padding:30px;color:#D94F4F">Error loading activity data: '+err.message+'</div>';
  });
}
