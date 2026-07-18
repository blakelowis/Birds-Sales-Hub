// === AUDIT PERFORM — In-App Retail Audit ===
// Sector cards → Category → Question → Pass/Fail/NA → Photos → Actions → PDF
// Writes directly to `actions` + `audits` IndexedDB stores

var auditState = null;
var _auditQB = null;

var SECTOR_META = {
  food:         { color: 'emerald', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  fire:         { color: 'red',    icon: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z' },
  hs:           { color: 'amber',  icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  health:       { color: 'amber',  icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  journey:      { color: 'blue',   icon: 'M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  customer:     { color: 'blue',   icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  coffee:       { color: 'orange', icon: 'M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z' },
  focus:        { color: 'purple', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976-2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
  birds_focus:  { color: 'purple', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976-2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
  test:         { color: 'slate',  icon: 'M13 10V3L4 14h7v7l9-11h-7z' }
};

function auditMakeThumb(dataURL, size, mime, quality) {
  size = size || 1200; mime = mime || 'image/jpeg'; quality = quality != null ? quality : 0.7;
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;
      var sw = size, sh = Math.round(size * (h / w));
      if (h > w) { sh = size; sw = Math.round(size * (w / h)); }
      var c = document.createElement('canvas');
      c.width = size; c.height = size;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (size - sw) / 2, (size - sh) / 2, sw, sh);
      resolve(c.toDataURL(mime, quality));
    };
    img.onerror = function() { resolve(null); };
    img.src = dataURL;
  });
}

function auditEmailForStore(name) {
  return name.replace(/\s+/g, '.') + '@birdsofderby.co.uk';
}

function auditInit(branchId, storeName, am) {
  var isTraining = branchId === '__training';
  auditState = {
    branchId: branchId,
    storeName: storeName,
    areaManager: isTraining ? 'Training' : am,
    email: '',
    manager: '',
    auditor: 'Blake Lowis',
    date: new Date().toISOString().slice(0, 10),
    summary: '',
    view: 'meta',
    sectorId: null,
    categoryId: null,
    sectors: {},
    isTraining: isTraining
  };
  if (!isTraining) {
    idbGet('stores', branchId).then(function(rec) {
      if (rec && rec.email) auditState.email = rec.email;
      if (rec && rec.manager) auditState.manager = rec.manager;
      var em = document.getElementById('auditEmail');
      var mg = document.getElementById('auditManager');
      if (em && !em.value) em.value = auditState.email || auditEmailForStore(storeName);
      if (mg && !mg.value) mg.value = auditState.manager;
    });
  } else {
    var em = document.getElementById('auditEmail');
    var mg = document.getElementById('auditManager');
    if (em) em.value = 'blake.lowis@birdsofderby.co.uk';
    if (mg) mg.value = 'Training Manager';
    auditState.email = 'blake.lowis@birdsofderby.co.uk';
  }
  if (storeName === 'Training') {
    auditState.email = 'blake.lowis@birdsofderby.co.uk';
    var em = document.getElementById('auditEmail');
    if (em && !em.value) em.value = 'blake.lowis@birdsofderby.co.uk';
  }
}

function auditInitSectors() {
  if (!_auditQB) return;
  var sectors = {};
  Object.keys(_auditQB).forEach(function(key) {
    var sec = _auditQB[key];
    var cats = [];
    (sec.categories || []).forEach(function(cat) {
      var qs = [];
      (cat.questions || []).forEach(function(q) {
        qs.push({
          id: q.id, text: q.text, weight: q.weight || 1,
          answer: null, photo: null, photoThumb: null,
          extraPhoto: null, extraPhotoThumb: null,
          extraPhoto2: null, extraPhoto2Thumb: null,
          comment: '',
          action: null
        });
      });
      cats.push({ id: cat.id, name: cat.name, questions: qs });
    });
    sectors[key] = { title: sec.title, categories: cats };
  });
  auditState.sectors = sectors;
}

function auditSectorKeys() { return auditState ? Object.keys(auditState.sectors) : []; }

function auditSectorMetrics(sid) {
  var sec = auditState.sectors[sid];
  if (!sec) return null;
  var accrued = 0, max = 0, answered = 0, passes = 0, fails = 0, open = 0, criticalCount = 0;
  sec.categories.forEach(function(cat) {
    cat.questions.forEach(function(q) {
      if (q.answer === 'Pass' || q.answer === 'Fail') {
        max += q.weight;
        answered++;
        if (q.answer === 'Pass') { accrued += q.weight; passes++; }
        else { fails++; }
      } else if (q.answer === 'NA') { answered++; }
      if (q.action && q.action.enabled) {
        open++;
        if (q.action.critical) criticalCount++;
      }
    });
  });
  var basePct = max ? Math.round((accrued / max) * 100) : 0;
  var penalty = 0, failed = false;
  if (criticalCount >= 3) { failed = true; penalty = basePct; }
  else if (criticalCount === 2) penalty = 20;
  else if (criticalCount === 1) penalty = 10;
  var penalisedPct = failed ? 0 : Math.max(0, basePct - penalty);
  return { accrued: accrued, max: max, answered: answered, passes: passes, fails: fails, open: open, criticalCount: criticalCount, penalty: penalty, basePct: basePct, penalisedPct: penalisedPct, failed: failed };
}

function auditOverallMetrics() {
  var totalAccrued = 0, totalMax = 0, totalAnswered = 0, totalOpen = 0, totalCritical = 0, totalPenalty = 0;
  var sectorData = [];
  auditSectorKeys().forEach(function(sid) {
    var m = auditSectorMetrics(sid);
    sectorData.push({ id: sid, title: auditState.sectors[sid].title, metrics: m });
    totalOpen += m.open;
    totalCritical += m.criticalCount;
    totalPenalty += m.penalty;
    if (!m.answered) return;
    totalAnswered += m.answered;
    if (m.failed) return;
    totalAccrued += (m.penalisedPct / 100) * m.max;
    totalMax += m.max;
  });
  var pct = totalMax ? Math.round((totalAccrued / totalMax) * 100) : 0;
  return { totalAccrued: totalAccrued, totalMax: totalMax, totalAnswered: totalAnswered, totalOpen: totalOpen, totalCritical: totalCritical, totalPenalty: totalPenalty, pct: pct, sectorData: sectorData };
}

function auditGetActions() {
  var items = [];
  auditSectorKeys().forEach(function(sid) {
    var sec = auditState.sectors[sid];
    sec.categories.forEach(function(cat) {
      cat.questions.forEach(function(q) {
        if (q.action && q.action.enabled) {
          items.push({ sector: sec.title, category: cat.name, questionId: q.id, question: q.text, answer: q.answer, weight: q.weight, action: q.action, photos: [q.photoThumb, q.extraPhotoThumb, q.extraPhoto2Thumb] });
        }
      });
    });
  });
  items.sort(function(a, b) { return (b.action.critical ? 1 : 0) - (a.action.critical ? 1 : 0); });
  return items;
}

function auditCollectComments() {
  var items = [];
  auditSectorKeys().forEach(function(sid) {
    var sec = auditState.sectors[sid];
    sec.categories.forEach(function(cat) {
      cat.questions.forEach(function(q) {
        if (!q.comment || !q.comment.trim()) return;
        if (q.action && q.action.enabled) return;
        items.push({ sector: sec.title, category: cat.name, question: q.text, answer: q.answer, comment: q.comment, photoThumb: q.photoThumb, extraPhotoThumb: q.extraPhotoThumb, extraPhoto2Thumb: q.extraPhoto2Thumb });
      });
    });
  });
  return items;
}

function auditCollectAllComments() {
  var withPhotos = [];
  var withoutPhotos = [];
  auditSectorKeys().forEach(function(sid) {
    var sec = auditState.sectors[sid];
    sec.categories.forEach(function(cat) {
      cat.questions.forEach(function(q) {
        if (!q.comment && !q.photoThumb && !q.extraPhotoThumb && !q.extraPhoto2Thumb) return;
        var item = {
          sector: sec.title, category: cat.name,
          question: q.text, answer: q.answer,
          comment: q.comment || '',
          photoThumb: q.photoThumb, extraPhotoThumb: q.extraPhotoThumb, extraPhoto2Thumb: q.extraPhoto2Thumb
        };
        var hasPhotos = item.photoThumb || item.extraPhotoThumb || item.extraPhoto2Thumb;
        if (hasPhotos) withPhotos.push(item);
        else withoutPhotos.push(item);
      });
    });
  });
  return { withPhotos: withPhotos, withoutPhotos: withoutPhotos };
}

function auditCollectEvidence() {
  var items = [];
  auditSectorKeys().forEach(function(sid) {
    var sec = auditState.sectors[sid];
    sec.categories.forEach(function(cat) {
      cat.questions.forEach(function(q) {
        var has2 = q.extraPhotoThumb;
        var has3 = q.extraPhoto2Thumb;
        if (has2 || has3) {
          items.push({ sector: sec.title, category: cat.name, question: q.text, answer: q.answer, photo2: q.extraPhotoThumb, photo3: q.extraPhoto2Thumb });
        }
      });
    });
  });
  return items;
}

function auditTotalAnswered() {
  var total = 0, answered = 0;
  auditSectorKeys().forEach(function(sid) {
    auditState.sectors[sid].categories.forEach(function(cat) {
      cat.questions.forEach(function(q) {
        total++;
        if (q.answer) answered++;
      });
    });
  });
  return { total: total, answered: answered };
}

function auditScoreRag(pct) {
  if (pct >= 95) return 'text-emerald-600';
  if (pct >= 90) return 'text-green-600';
  if (pct >= 80) return 'text-amber-600';
  return 'text-red-600';
}

function auditScoreBg(pct) {
  if (pct >= 95) return 'bg-emerald-50 border-emerald-200';
  if (pct >= 90) return 'bg-green-50 border-green-200';
  if (pct >= 80) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

// === RENDER ===

window.renderAuditPerform = function() {
  if (!auditState) return renderAuditMetaView();
  if (auditState.view === 'meta') return renderAuditMetaView();
  if (auditState.view === 'sectors') return renderAuditSectorView();
  if (auditState.view === 'categories') return renderAuditCategoryView();
  if (auditState.view === 'questions') return renderAuditQuestionView();
  if (auditState.view === 'complete') return renderAuditCompleteView();
};

function renderAuditMetaView() {
  var mainView = document.getElementById('mainView');
  var stores = [];
  originalStoreNames.forEach(function(name, id) {
    var am = storeMap.get(id) || 'Unassigned';
    if (am === 'Unassigned') return;
    stores.push({ id: id, name: name, am: am });
  });
  stores.sort(function(a, b) { return a.name.localeCompare(b.name); });

  // If QB not loaded yet, try fetching it now
  if (!_auditQB) {
    console.log('[Audit] QB not loaded, retrying fetch...');
    fetch('./AuditQuestions.json').then(function(r) { return r.json(); }).then(function(data) {
      _auditQB = data;
      console.log('[Audit] Retry fetch succeeded:', Object.keys(data).length, 'sectors');
      // Re-render the meta view with loaded QB
      if (auditState && auditState.view === 'meta') renderAuditMetaView();
    }).catch(function(e) { console.warn('[Audit] Retry fetch failed:', e.message); });
  }

  var qbInfo = _auditQB ? '<span class="text-emerald-600 font-bold">✓ Question bank loaded (' + Object.keys(_auditQB).length + ' sectors)</span>' : '<span class="text-amber-600 font-bold">Loading question bank...</span>';
  var branchOpts = stores.map(function(s) {
    return '<option value="' + s.id + '"' + (auditState && auditState.branchId === s.id ? ' selected' : '') + '>' + escapeHtml(s.name) + ' (' + escapeHtml(s.am) + ')</option>';
  }).join('');
  branchOpts += '<option value="__training"' + (auditState && auditState.branchId === '__training' ? ' selected' : '') + '>🔧 Training / Temp Store</option>';

  var meta = auditState || {};
  mainView.innerHTML = `
    <div class="max-w-3xl mx-auto">
      <div class="flex items-center gap-4 mb-6">
        <button onclick="cancelAudit()" class="text-slate-400 hover:text-slate-600 text-sm font-bold">← Back to Hub</button>
        <h2 class="text-2xl font-black outfit birds-green uppercase tracking-tight">New Audit</h2>
        ${auditState && auditState.isTraining ? '<span class="bg-amber-100 text-amber-700 border border-amber-300 px-3 py-1 rounded-full text-xs font-black uppercase">Training Mode — Not Saved to SharePoint</span>' : ''}
      </div>

      <div class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm mb-6">
        <h3 class="font-black text-slate-800 mb-4">Store Details</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="text-xs font-black text-slate-500 uppercase">Store *</label>
            <select id="auditStoreSelect" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mt-1" onchange="onAuditStoreSelect(this.value)">
              <option value="">Select store...</option>
              ${branchOpts}
            </select>
          </div>
          <div id="auditCustomStoreWrap" class="${auditState && auditState.branchId === '__training' ? '' : 'hidden'}">
            <label class="text-xs font-black text-slate-500 uppercase">Custom Store Name</label>
            <input id="auditCustomStore" type="text" value="${escapeHtml(meta.storeName !== 'Training / Temp Store' ? meta.storeName : '')}" placeholder="e.g. Albert Street" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mt-1" oninput="if(auditState){auditState.storeName=this.value||'Training / Temp Store';}">
          </div>
          <div>
            <label class="text-xs font-black text-slate-500 uppercase">Email</label>
            <input id="auditEmail" type="email" value="${escapeHtml(meta.email || '')}" placeholder="Type any email address..." class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mt-1" oninput="if(auditState){auditState.email=this.value||'';}">
          </div>
          <div>
            <label class="text-xs font-black text-slate-500 uppercase">Store Manager *</label>
            <input id="auditManager" type="text" value="${escapeHtml(meta.manager || '')}" placeholder="e.g. John Smith" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mt-1">
          </div>
          <div>
            <label class="text-xs font-black text-slate-500 uppercase">Auditor</label>
            <input id="auditAuditor" type="text" value="${escapeHtml(meta.auditor || 'Blake Lowis')}" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mt-1">
          </div>
          <div>
            <label class="text-xs font-black text-slate-500 uppercase">Date</label>
            <input id="auditDate" type="date" value="${escapeHtml(meta.date || new Date().toISOString().slice(0, 10))}" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mt-1">
          </div>
        </div>
        <div class="mb-4">
          <label class="text-xs font-black text-slate-500 uppercase">Audit Summary (optional)</label>
          <textarea id="auditSummary" maxlength="300" rows="2" placeholder="Overall notes..." class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mt-1">${escapeHtml(meta.summary || '')}</textarea>
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm mb-6">
        <h3 class="font-black text-slate-800 mb-4">Question Bank</h3>
        <div class="flex items-center gap-4">
          <label class="btn-primary text-sm cursor-pointer">
            Load JSON File
            <input type="file" accept=".json" class="hidden" onchange="onAuditLoadQB(event)">
          </label>
          <span id="auditQBStatus" class="text-sm">${qbInfo}</span>
        </div>
        ${_auditQB ? '<div class="mt-3 text-xs text-slate-500">Sectors: ' + Object.keys(_auditQB).map(function(k) { return _auditQB[k].title || k; }).join(', ') + '</div>' : ''}
      </div>

      <div class="text-center">
        <button onclick="startAuditExecution()" id="auditStartBtn" class="bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black px-10 py-4 rounded-full text-lg shadow-lg transition-colors">
          Start Audit →
        </button>
        <div id="auditStartHint" class="text-xs text-slate-400 mt-2"></div>
      </div>
    </div>`;
}

// === BREADCRUMBS ===
function auditBreadcrumbHTML() {
  if (!auditState || auditState.view === 'meta' || auditState.view === 'complete') return '';
  var parts = [];
  parts.push('<span onclick="auditGoSectors()" class="cursor-pointer text-slate-400 hover:text-emerald-600 font-bold text-sm transition-colors">Sectors</span>');
  if (auditState.view === 'categories' || auditState.view === 'questions') {
    var sec = auditState.sectors[auditState.sectorId];
    if (sec) {
      parts.push('<span class="text-slate-300 text-sm mx-1">›</span>');
      if (auditState.view === 'questions') {
        parts.push('<span onclick="auditGoSector(\'' + auditState.sectorId + '\')" class="cursor-pointer text-slate-400 hover:text-emerald-600 font-bold text-sm transition-colors">' + escapeHtml(sec.title) + '</span>');
      } else {
        parts.push('<span class="text-slate-700 font-bold text-sm">' + escapeHtml(sec.title) + '</span>');
      }
    }
  }
  if (auditState.view === 'questions') {
    var sec2 = auditState.sectors[auditState.sectorId];
    if (sec2) {
      var cat = sec2.categories.find(function(c) { return c.id === auditState.categoryId; });
      if (cat) {
        parts.push('<span class="text-slate-300 text-sm mx-1">›</span>');
        parts.push('<span class="text-slate-700 font-bold text-sm">' + escapeHtml(cat.name) + '</span>');
      }
    }
  }
  return '<nav id="auditBreadcrumbs" class="flex items-center mb-6">' + parts.join('') + '</nav>';
}

// === DONUT CHART ===
function auditDonutSVG(pct) {
  var C = 2 * Math.PI * 18;
  var val = (pct / 100) * C;
  var arcColor = pct >= 95 ? '#10b981' : pct >= 90 ? '#22c55e' : pct >= 80 ? '#f59e0b' : '#ef4444';
  var textColor = pct >= 95 ? 'text-emerald-600' : pct >= 90 ? 'text-green-600' : pct >= 80 ? 'text-amber-600' : 'text-red-600';
  return '<svg viewBox="0 0 44 44" width="100" height="100" class="flex-shrink-0">' +
    '<circle cx="22" cy="22" r="18" fill="none" stroke="#e2e8f0" stroke-width="4"/>' +
    '<circle cx="22" cy="22" r="18" fill="none" stroke="' + arcColor + '" stroke-width="4" stroke-linecap="round" transform="rotate(-90 22 22)" stroke-dasharray="' + val.toFixed(1) + ' ' + C.toFixed(1) + '" class="transition-all duration-700"/>' +
    '<text x="22" y="22" text-anchor="middle" dominant-baseline="central" class="font-black ' + textColor + '" style="font-size:9px;font-weight:900">' + pct + '%</text>' +
    '</svg>';
}

function renderAuditSectorView() {
  var mainView = document.getElementById('mainView');
  var overall = auditOverallMetrics();
  var counts = auditTotalAnswered();
  var sectorCards = auditSectorKeys().map(function(sid) {
    var sec = auditState.sectors[sid];
    var m = auditSectorMetrics(sid);
    var meta = SECTOR_META[sid] || { color: 'slate' };
    var pctText = m.answered ? m.penalisedPct + '%' : '—';
    var pctRag = m.answered ? auditScoreRag(m.penalisedPct) : 'text-slate-400';
    return `
      <button onclick="auditGoSector('${sid}')" class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all text-left group">
        <div class="flex items-center justify-between mb-3">
          <div class="w-10 h-10 rounded-xl bg-${meta.color}-50 flex items-center justify-center">
            <svg class="w-5 h-5 text-${meta.color}-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${meta.icon}"/></svg>
          </div>
          <span class="text-lg font-black ${pctRag}">${pctText}</span>
        </div>
        <div class="font-black text-slate-800 text-sm mb-1">${escapeHtml(sec.title)}</div>
        <div class="text-[11px] text-slate-400">${m.answered} answered • ${m.fails} fails${m.criticalCount ? ' • ' + m.criticalCount + ' critical' : ''}</div>
        <div class="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div class="h-full bg-${meta.color}-400 rounded-full transition-all" style="width: ${m.answered ? Math.round(m.passes / (m.passes + m.fails || 1) * 100) : 0}%"></div>
        </div>
      </button>`;
  }).join('');

  mainView.innerHTML = `
    <div>
      <div class="flex items-center gap-4 mb-6">
        <button onclick="auditGoMeta()" class="text-slate-400 hover:text-slate-600 text-sm font-bold">← Setup</button>
        <h2 class="text-2xl font-black outfit birds-green uppercase tracking-tight">${escapeHtml(auditState.storeName)}</h2>
        <span class="text-xs font-bold text-slate-400">${escapeHtml(auditState.areaManager)}</span>
      </div>

      <div class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm mb-6">
        <h3 class="font-black text-slate-800 mb-4">Overall Score</h3>
        <div class="flex items-center gap-6 flex-wrap">
          ${auditDonutSVG(overall.pct)}
          <div>
            <div class="text-sm font-bold text-slate-500 mb-1">${counts.answered} / ${counts.total} questions answered</div>
            ${overall.totalCritical > 0 ? '<div class="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm font-bold text-red-700">' + overall.totalCritical + ' critical item' + (overall.totalCritical > 1 ? 's' : '') + ' — penalty: -' + overall.totalPenalty + '%</div>' : ''}
          </div>
        </div>
      </div>

      <h3 class="font-black text-slate-800 mb-4">Sectors</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">${sectorCards}</div>

      <div class="text-center">
        <button onclick="auditCompleteAllInOne()" class="bg-emerald-500 hover:bg-emerald-600 text-white font-black px-10 py-4 rounded-full text-lg shadow-lg transition-colors">
          Complete Audit →
        </button>
      </div>
    </div>`;
}

function renderAuditCategoryView() {
  var mainView = document.getElementById('mainView');
  var sec = auditState.sectors[auditState.sectorId];
  var meta = SECTOR_META[auditState.sectorId] || { color: 'slate' };
  var catCards = sec.categories.map(function(cat) {
    var answered = cat.questions.filter(function(q) { return q.answer; }).length;
    var total = cat.questions.length;
    var pct = total ? Math.round(answered / total * 100) : 0;
    return `
      <button onclick="auditGoCategory('${cat.id}')" class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-all text-left">
        <div class="flex items-center justify-between mb-2">
          <span class="font-black text-slate-800 text-sm">${escapeHtml(cat.name)}</span>
          <span class="text-xs font-bold ${answered === total ? 'text-emerald-600' : 'text-slate-400'}">${answered}/${total}</span>
        </div>
        <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div class="h-full bg-${meta.color}-400 rounded-full" style="width: ${pct}%"></div>
        </div>
      </button>`;
  }).join('');

  mainView.innerHTML = `
    <div>
      ${auditBreadcrumbHTML()}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${catCards}</div>
    </div>`;
}

function renderAuditQuestionView() {
  var mainView = document.getElementById('mainView');
  var sec = auditState.sectors[auditState.sectorId];
  var cat = sec.categories.find(function(c) { return c.id === auditState.categoryId; });
  var meta = SECTOR_META[auditState.sectorId] || { color: 'slate' };

  var questionsHTML = cat.questions.map(function(q, qi) {
    var passCls = q.answer === 'Pass' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-emerald-50';
    var failCls = q.answer === 'Fail' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-red-50';
    var naCls = q.answer === 'NA' ? 'bg-slate-400 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200';
    var actionEnabled = q.action && q.action.enabled;
    var actionCls = actionEnabled ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-amber-50';
    var photos = [q.photoThumb, q.extraPhotoThumb, q.extraPhoto2Thumb].filter(Boolean);

    return `
      <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-3">
        <div class="flex items-start gap-3 mb-3">
          <span class="bg-${meta.color}-50 text-${meta.color}-700 text-[10px] font-black px-2 py-0.5 rounded whitespace-nowrap">×${q.weight}</span>
          <p class="text-sm font-bold text-slate-800 leading-snug">${escapeHtml(q.text)}</p>
        </div>

        <div class="flex items-center gap-2 mb-3 flex-wrap">
          <button onclick="auditAnswer('${auditState.sectorId}','${cat.id}','${q.id}','Pass')" class="px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${passCls}">✓ Pass</button>
          <button onclick="auditAnswer('${auditState.sectorId}','${cat.id}','${q.id}','Fail')" class="px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${failCls}">✗ Fail</button>
          <button onclick="auditAnswer('${auditState.sectorId}','${cat.id}','${q.id}','NA')" class="px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${naCls}">N/A</button>
          <button onclick="auditToggleAction('${auditState.sectorId}','${cat.id}','${q.id}')" class="px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${actionCls}">⚡ Action</button>
        </div>

        <div class="flex items-center gap-2 mb-3 flex-wrap">
          <label class="text-[10px] font-bold text-slate-400 uppercase">Photo</label>
          ${q.photoThumb ? '<img src="' + q.photoThumb + '" class="w-14 h-14 rounded-lg object-cover border border-slate-200">' : ''}
          ${q.extraPhotoThumb ? '<img src="' + q.extraPhotoThumb + '" class="w-14 h-14 rounded-lg object-cover border border-slate-200">' : ''}
          ${q.extraPhoto2Thumb ? '<img src="' + q.extraPhoto2Thumb + '" class="w-14 h-14 rounded-lg object-cover border border-slate-200">' : ''}
          ${photos.length < 3 ? '<label class="w-14 h-14 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:border-emerald-400 hover:text-emerald-500 cursor-pointer transition-colors text-lg">' + '<input type="file" accept="image/*" capture="environment" class="hidden" onchange="auditPhoto(\'' + auditState.sectorId + '\',\'' + cat.id + '\',\'' + q.id + '\',' + photos.length + ', event)">+</label>' : ''}
        </div>

        <textarea onchange="auditSetComment('${auditState.sectorId}','${cat.id}','${q.id}',this.value)" placeholder="Comment (optional)..." class="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 mb-3" rows="1">${escapeHtml(q.comment || '')}</textarea>

        ${actionEnabled ? auditActionHTML(q, auditState.sectorId, cat.id) : ''}
      </div>`;
  }).join('');

  mainView.innerHTML = `
    <div>
      ${auditBreadcrumbHTML()}
      ${questionsHTML}
    </div>`;
}

function auditActionHTML(q, sid, cid) {
  var a = q.action || {};
  var isOpen = (a.status || 'Open') === 'Open';
  return `
    <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-2">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <label class="text-[10px] font-black text-amber-700 uppercase">Description</label>
          <textarea placeholder="Describe the issue" onchange="auditSetAction('${sid}','${cid}','${q.id}','description',this.value)" class="w-full text-xs border border-amber-200 rounded-lg px-3 py-2 mt-1" rows="2">${escapeHtml(a.description || '')}</textarea>
        </div>
        <div>
          <label class="text-[10px] font-black text-amber-700 uppercase">Person Responsible</label>
          <select onchange="auditSetAction('${sid}','${cid}','${q.id}','person',this.value)" class="w-full text-xs border border-amber-200 rounded-lg px-3 py-2 mt-1">
            <option value="" ${!a.person ? 'selected' : ''}>Select...</option>
            <option value="All team members" ${a.person === 'All team members' ? 'selected' : ''}>All team members</option>
            <option value="Store Manager" ${a.person === 'Store Manager' ? 'selected' : ''}>Store Manager</option>
            <option value="Area Manager" ${a.person === 'Area Manager' ? 'selected' : ''}>Area Manager</option>
            <option value="Maintenance" ${a.person === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
            <option value="Health and Safety" ${a.person === 'Health and Safety' ? 'selected' : ''}>Health and Safety</option>
            <option value="Auditor" ${a.person === 'Auditor' ? 'selected' : ''}>Auditor</option>
          </select>
        </div>
        <div>
          <label class="text-[10px] font-black text-amber-700 uppercase">Action Needed</label>
          <textarea placeholder="Describe the action" onchange="auditSetAction('${sid}','${cid}','${q.id}','actionNeeded',this.value)" class="w-full text-xs border border-amber-200 rounded-lg px-3 py-2 mt-1" rows="2">${escapeHtml(a.actionNeeded || '')}</textarea>
        </div>
        <div>
          <label class="text-[10px] font-black text-amber-700 uppercase">Status</label>
          <select onchange="auditSetAction('${sid}','${cid}','${q.id}','status',this.value)" class="w-full text-xs border border-amber-200 rounded-lg px-3 py-2 mt-1">
            <option value="Open" ${isOpen ? 'selected' : ''}>Open</option>
            <option value="Closed" ${!isOpen ? 'selected' : ''}>Closed</option>
          </select>
        </div>
        <div>
          <label class="text-[10px] font-black text-amber-700 uppercase">Closed On</label>
          <input type="date" value="${escapeHtml(a.closedOn || '')}" onchange="auditSetAction('${sid}','${cid}','${q.id}','closedOn',this.value)" ${isOpen ? 'disabled' : ''} class="w-full text-xs border border-amber-200 rounded-lg px-3 py-2 mt-1 disabled:bg-slate-100 disabled:text-slate-400">
        </div>
      </div>
      <label class="flex items-center gap-3 cursor-pointer bg-red-50 border border-red-200 rounded-xl px-4 py-3 mt-2 hover:bg-red-100 transition-colors">
        <input type="checkbox" ${a.critical ? 'checked' : ''} onchange="auditSetAction('${sid}','${cid}','${q.id}','critical',this.checked)" class="w-5 h-5 rounded border-red-300 text-red-500 focus:ring-red-500">
        <span class="text-sm font-black text-red-600 uppercase tracking-wide">${a.critical ? '✓ ' : ''}Mark as Critical</span>
      </label>
    </div>`;
}

function renderAuditCompleteView() {
  var mainView = document.getElementById('mainView');
  var overall = auditOverallMetrics();

  mainView.innerHTML = `
    <div class="max-w-2xl mx-auto text-center py-12">
      <div class="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg class="w-10 h-10 text-emerald-500" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
      </div>
      <h2 class="text-3xl font-black outfit text-slate-800 mb-2">Audit Complete</h2>
      <p class="text-slate-500 mb-6">${escapeHtml(auditState.storeName)} — ${escapeHtml(auditState.date)}</p>

      <div class="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm mb-8">
        <div class="text-6xl font-black ${auditScoreRag(overall.pct)} mb-4">${overall.pct}%</div>
        <div class="text-sm text-slate-500 mb-4">${overall.totalAnswered} questions answered</div>
        ${overall.totalCritical > 0 ? '<div class="bg-red-50 border border-red-200 rounded-xl px-6 py-3 text-sm font-bold text-red-700 inline-block mb-4">' + overall.totalCritical + ' critical item' + (overall.totalCritical > 1 ? 's' : '') + ' — penalty: -' + overall.totalPenalty + '%</div>' : ''}
        ${auditState.isTraining ? '<div class="bg-amber-50 border border-amber-200 rounded-xl px-6 py-3 text-sm font-bold text-amber-700 inline-block mb-4">Training Mode — Not synced to SharePoint</div>' : ''}
        ${window._lastXlsxResult && !auditState.isTraining ? '<div class="bg-slate-50 border border-slate-200 rounded-xl px-6 py-3 text-sm inline-block mb-4">' + (window._lastXlsxResult.method === 'folder' ? '<span class="text-emerald-600 font-bold">✓ ' + window._lastXlsxResult.count + ' actions queued for Power Automate — pending-actions.json saved</span>' : window._lastXlsxResult.method === 'no_folder' ? '<span class="text-amber-600 font-bold">⚠ Actions saved locally — anchor Data folder for auto-sync</span>' : '<span class="text-amber-600 font-bold">⚠ XLSX write failed — ' + escapeHtml(window._lastXlsxResult.error || 'check folder permissions') + '</span>') + '</div>' : ''}
      </div>

      <div class="flex gap-4 justify-center">
        <button onclick="auditCompleteAndDownload()" class="bg-emerald-500 hover:bg-emerald-600 text-white font-black px-8 py-4 rounded-full text-lg shadow-lg transition-colors">
          Save & Download PDF
        </button>
        <button onclick="auditCompleteAndSave()" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-6 py-4 rounded-full transition-colors">
          Save Only
        </button>
      </div>
    </div>`;
}

// === NAVIGATION ===

window.auditGoMeta = function() { auditState.view = 'meta'; renderAuditPerform(); };
window.auditGoSectors = function() { auditState.view = 'sectors'; renderAuditPerform(); };
window.auditGoSector = function(sid) { auditState.view = 'categories'; auditState.sectorId = sid; renderAuditPerform(); };
window.auditGoCategory = function(cid) { auditState.view = 'questions'; auditState.categoryId = cid; renderAuditPerform(); };
window.auditGoCategory_back = function() { auditState.view = 'categories'; renderAuditPerform(); };
window.cancelAudit = function() { auditState = null; setView('auditexport'); };

window.onAuditStoreSelect = function(branchId) {
  if (!branchId) return;
  var customWrap = document.getElementById('auditCustomStoreWrap');
  if (branchId === '__training') {
    auditInit('__training', 'Training / Temp Store', 'Training');
    var em = document.getElementById('auditEmail');
    var mg = document.getElementById('auditManager');
    if (em) em.value = '';
    if (mg) mg.value = '';
    if (em) em.placeholder = 'Enter auditor/trainee email...';
    if (mg) mg.placeholder = 'e.g. Trainee Name';
    if (customWrap) customWrap.classList.remove('hidden');
    var cs = document.getElementById('auditCustomStore');
    if (cs) { cs.value = ''; cs.focus(); }
  } else {
    var name = originalStoreNames.get(branchId) || branchId;
    var am = storeMap.get(branchId) || 'Unassigned';
    auditInit(branchId, name, am);
    var em = document.getElementById('auditEmail');
    if (em && !em.value) em.value = auditEmailForStore(name);
    if (em) em.placeholder = 'auto-generated from store name';
    var mg = document.getElementById('auditManager');
    if (mg) mg.placeholder = 'e.g. John Smith';
    if (customWrap) customWrap.classList.add('hidden');
  }
  // Enable Start button now that store is selected
  var btn = document.getElementById('auditStartBtn');
  if (btn) btn.disabled = !_auditQB;
  var hint = document.getElementById('auditStartHint');
  if (hint) hint.textContent = _auditQB ? '' : '⚠ Question bank still loading...';
};

window.onAuditLoadQB = async function(e) {
  var file = e.target.files[0];
  if (!file) return;
  try {
    var text = await file.text();
    _auditQB = JSON.parse(text);
    idbPut('questionBank', { id: 'current', data: _auditQB, loadedAt: new Date().toISOString(), fileName: file.name });
    var status = document.getElementById('auditQBStatus');
    if (status) status.innerHTML = '<span class="text-emerald-600 font-bold">✓ Loaded: ' + escapeHtml(file.name) + ' (' + Object.keys(_auditQB).length + ' sectors)</span>';
    var btn = document.querySelector('[onclick="startAuditExecution()"]');
    if (btn && auditState && auditState.branchId) btn.disabled = false;
  } catch(err) {
    alert('Failed to load question bank: ' + err.message);
  }
  e.target.value = '';
};

window.startAuditExecution = function() {
  if (!_auditQB) { alert('Question bank not loaded yet. Please wait or click Load JSON File.'); return; }
  if (!auditState || !auditState.branchId) { alert('Please select a store first.'); return; }
  auditState.email = (document.getElementById('auditEmail') || {}).value || '';
  auditState.manager = (document.getElementById('auditManager') || {}).value || '';
  auditState.auditor = (document.getElementById('auditAuditor') || {}).value || 'Blake Lowis';
  auditState.date = (document.getElementById('auditDate') || {}).value || new Date().toISOString().slice(0, 10);
  auditState.summary = (document.getElementById('auditSummary') || {}).value || '';
  // Use custom store name if provided for training store
  if (auditState.branchId === '__training') {
    var cs = document.getElementById('auditCustomStore');
    var customName = cs ? cs.value.trim() : '';
    if (customName) {
      auditState.storeName = customName;
      auditState.isTraining = false;
      auditState.branchId = 'custom_' + customName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    }
  }
  auditInitSectors();
  auditState.view = 'sectors';
  renderAuditPerform();
};

window.auditAnswer = function(sid, cid, qid, answer) {
  var q = findAuditQ(sid, cid, qid);
  if (q) q.answer = q.answer === answer ? null : answer;
  renderAuditPerform();
};

window.auditSetComment = function(sid, cid, qid, val) {
  var q = findAuditQ(sid, cid, qid);
  if (q) q.comment = val;
};

window.auditPhoto = async function(sid, cid, qid, slot, e) {
  var file = e.target.files[0];
  if (!file) return;
  var data = await new Promise(function(resolve) {
    var reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.readAsDataURL(file);
  });
  var thumb = await auditMakeThumb(data, 1200, 'image/jpeg', 0.7);
  var q = findAuditQ(sid, cid, qid);
  if (!q) return;
  if (slot === 0) { q.photo = data; q.photoThumb = thumb; }
  else if (slot === 1) { q.extraPhoto = data; q.extraPhotoThumb = thumb; }
  else if (slot === 2) { q.extraPhoto2 = data; q.extraPhoto2Thumb = thumb; }
  renderAuditPerform();
  e.target.value = '';
};

window.auditTriggerPhoto = function(sid, cid, qid, slot) {
  var input = document.getElementById('auditPhotoInput_' + qid + '_' + slot);
  if (input) input.click();
};

window.auditToggleAction = function(sid, cid, qid) {
  var q = findAuditQ(sid, cid, qid);
  if (!q) return;
  if (q.action && q.action.enabled) { q.action = null; }
  else { q.action = { enabled: true, description: '', person: '', actionNeeded: '', critical: false, status: 'Open', closedOn: '', createdAt: new Date().toISOString() }; }
  renderAuditPerform();
};

window.auditSetAction = function(sid, cid, qid, field, val) {
  var q = findAuditQ(sid, cid, qid);
  if (!q || !q.action) return;
  q.action[field] = val;
  if (field === 'status') {
    if (val === 'Closed' && !q.action.closedOn) {
      q.action.closedOn = new Date().toISOString().slice(0, 10);
    }
    renderAuditPerform();
  }
};

function findAuditQ(sid, cid, qid) {
  if (!auditState || !auditState.sectors[sid]) return null;
  var cat = auditState.sectors[sid].categories.find(function(c) { return c.id === cid; });
  if (!cat) return null;
  return cat.questions.find(function(q) { return q.id === qid; });
}

// === COMPLETE AUDIT ===

window.auditCompleteAndSave = async function() {
  if (!auditState) return;
  try {
    await writeAuditResults(auditState);
  } catch (e) {
    console.warn('[Audit] writeAuditResults error:', e.message);
  }
  var result = window._lastXlsxResult;
  var msg = 'Audit saved';
  if (result && result.method === 'folder') msg += ' — ' + result.count + ' actions queued for Power Automate';
  alert(msg);
  auditState = null;
  setView('auditexport');
};

window.auditCompleteAllInOne = async function() {
  if (!auditState) return;
  console.log('[Audit] auditCompleteAllInOne started, isTraining:', auditState.isTraining);
  
  // 1. Save to IndexedDB + write to xlsx
  try {
    await writeAuditResults(auditState);
  } catch (e) {
    console.error('[Audit] writeAuditResults error:', e);
  }
  
  // 2. Generate PDF
  try {
    await auditGeneratePDF();
  } catch (e) {
    console.warn('[Audit] PDF error:', e.message);
  }
  
  // 3. Build result message
  var result = window._lastXlsxResult;
  var msg = 'Audit complete';
  if (result && result.method === 'training') msg += ' — training audit saved';
  else if (result && result.method === 'folder') msg += ' — ' + result.count + ' actions queued for Power Automate';
  else if (result && result.method === 'no_folder') msg += ' — actions saved locally (anchor Data folder to sync)';
  else if (result && result.method === 'no_permission') msg += ' — xlsx write denied (permission)';
  else if (result && result.method === 'error') msg += ' — xlsx write failed: ' + (result.error || 'unknown');
  else msg += ' — PDF downloaded';
  
  console.log('[Audit] Result:', msg);
  
  // 4. Show visible notification (alert fallback if U.toast doesn't exist)
  alert(msg);
  
  // 5. Clear state and return to hub
  auditState = null;
  setView('auditexport');
};

window.auditCompleteAndDownload = async function() {
  if (!auditState) return;
  try {
    await writeAuditResults(auditState);
  } catch (e) {
    console.warn('[Audit] writeAuditResults error:', e.message);
  }
  try {
    await auditGeneratePDF();
  } catch (e) {
    console.warn('[Audit] PDF error:', e.message);
  }
  var result = window._lastXlsxResult;
  var msg = 'Audit saved & PDF downloaded';
  if (result && result.method === 'training') msg = 'Training audit saved & PDF downloaded';
  else if (result && result.method === 'folder') msg += ' — ' + result.count + ' actions queued for Power Automate';
  alert(msg);
  auditState = null;
  setView('auditexport');
};

// === XLSX DATA SHEET APPEND (for Power Automate pickup) ===

var DATA_SHEET_HEADERS = [
  'Store Name','Store Email','Auditor','Manager','Date','Sector','Category',
  'Sector Score','Category Score','Question ID','Question','Answer','Weight',
  'Question Score','Question Max Score','Total Score','Max Score','Overall %',
  'Description','Person responsible','Action Needed','Status','Closed On',
  'How action was closed','Extra Comment','Photo Full','Photo Thumb',
  'Extra Photo Full','Extra Photo Thumb','Person Email','Audit Email Sent',
  'Area Manager','Critical'
];

function auditCategoryMetrics(sid, catId) {
  var sec = auditState.sectors[sid];
  if (!sec) return { accrued: 0, max: 0 };
  var cat = sec.categories.find(function(c) { return c.id === catId; });
  if (!cat) return { accrued: 0, max: 0 };
  var accrued = 0, max = 0;
  cat.questions.forEach(function(q) {
    if (q.answer === 'Pass' || q.answer === 'Fail') {
      max += q.weight;
      if (q.answer === 'Pass') accrued += q.weight;
    }
  });
  return { accrued: accrued, max: max, pct: max ? Math.round((accrued / max) * 100) : 0 };
}

function buildActionRows(state) {
  var overall = auditOverallMetrics();
  var rows = [];

  auditSectorKeys().forEach(function(sid) {
    var sec = auditState.sectors[sid];
    var secM = auditSectorMetrics(sid);
    var sectorScore = secM ? secM.penalisedPct : 0;

    sec.categories.forEach(function(cat) {
      var catM = auditCategoryMetrics(sid, cat.id);
      var catScore = catM.pct;

      cat.questions.forEach(function(q) {
        if (!q.answer || q.answer === 'NA') return;
        var qScore = q.answer === 'Pass' ? q.weight : 0;
        var hasAction = q.action && q.action.enabled;
        rows.push({
          'Store Name': state.storeName,
          'Store Email': state.email || '',
          'Auditor': state.auditor || '',
          'Manager': state.manager || '',
          'Date': state.date || '',
          'Sector': sec.title || sid,
          'Category': cat.name || cat.id,
          'Sector Score': sectorScore,
          'Category Score': catScore,
          'Question ID': q.id || '',
          'Question': q.text || '',
          'Answer': q.answer || '',
          'Weight': q.weight,
          'Question Score': qScore,
          'Question Max Score': q.weight,
          'Total Score': overall.totalAccrued,
          'Max Score': overall.totalMax,
          'Overall %': overall.pct + '%',
          'Description': hasAction ? (q.action.description || '') : '',
          'Person responsible': hasAction ? (q.action.person || '') : '',
          'Action Needed': hasAction ? (q.action.actionNeeded || '') : '',
          'Status': hasAction ? (q.action.status || 'Open') : '',
          'Closed On': hasAction && q.action.closedOn ? q.action.closedOn : '',
          'How action was closed': '',
          'Extra Comment': '',
          'Photo Full': '',
          'Photo Thumb': '',
          'Extra Photo Full': '',
          'Extra Photo Thumb': '',
          'Person Email': '',
          'Audit Email Sent': '',
          'Area Manager': state.areaManager || '',
          'Critical': hasAction && q.action.critical ? 'Yes' : 'No'
        });
      });
    });
  });
  return rows;
}

async function writeAuditActionsToXlsx(state) {
  var actionItems = auditGetActions();
  console.log('[Audit Actions] auditGetActions returned', actionItems.length, 'actions');

  var isCloud = window.__azureConfig && typeof GraphAPI !== 'undefined' && GraphAPI.isAuthenticated();
  console.log('[Audit Actions] Cloud sync:', isCloud);

  // ===== GRAPH API PATH =====
  if (isCloud) {
    try {
      var d = new Date(state.date);
      var year = d.getFullYear();
      var week = getISOWeek(d);

      var metrics = auditOverallMetrics();
      var sectorScores = {};
      if (metrics && metrics.sectorData) {
        metrics.sectorData.forEach(function(s) { sectorScores[s.id] = s.metrics ? s.metrics.penalisedPct : 0; });
      }

      var payload = {
        storeName: state.storeName, storeEmail: state.email || '',
        auditor: state.auditor, manager: state.manager, areaManager: state.areaManager || '',
        date: state.date, isTraining: state.isTraining || false, week: week, year: year,
        scores: {
          total: metrics ? metrics.pct : null, food: sectorScores.food || null,
          fire: sectorScores.fire || null, handS: sectorScores.hs || null,
          coffee: sectorScores.coffee || null, customerJourney: sectorScores.journey || null,
          birdsFocus: sectorScores.focus || null
        },
        actions: actionItems.map(function(a) {
          return {
            questionId: a.questionId || '', sector: a.sector || '', category: a.category || '',
            question: a.question || '', answer: a.answer || '',
            description: (a.action && a.action.description) || '',
            personResponsible: (a.action && a.action.person) || '',
            actionNeeded: (a.action && a.action.actionNeeded) || '',
            status: (a.action && a.action.status) || 'Open',
            critical: (a.action && a.action.critical) ? 'Yes' : 'No',
            extraComment: '', auditEmailSent: ''
          };
        })
      };

      var safeStore = state.storeName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      var safeDate = state.date.replace(/\//g, '-');
      var fileName = safeStore + '-' + safeDate + '.json';
      var jsonStr = JSON.stringify(payload, null, 2);

      await GraphAPI.uploadFileToFolder('Open', fileName, jsonStr, 'application/json');
      console.log('[Audit Actions] Cloud write complete — Open/' + fileName + ' saved');
      return { method: 'sharepoint', count: payload.actions.length };
    } catch (e) {
      console.error('[Audit Actions] Cloud write FAILED:', e.message);
      return { method: 'error', count: actionItems.length, error: e.message };
    }
  }

  // ===== FSA PATH =====
  console.log('[Audit Actions] directoryHandle:', directoryHandle ? directoryHandle.name : 'NULL');
  if (typeof directoryHandle === 'undefined' || !directoryHandle) {
    console.warn('[Audit Actions] No directory handle — returning no_folder');
    return { method: 'no_folder', count: actionItems.length };
  }

  var hasPerm = typeof verifyPermission === 'function' ? await verifyPermission(directoryHandle, true) : false;
  console.log('[Audit Actions] write permission:', hasPerm);
  if (!hasPerm) return { method: 'no_permission', count: actionItems.length };

  try {
    var d = new Date(state.date);
    var year = d.getFullYear();
    var week = getISOWeek(d);

    var metrics = auditOverallMetrics();
    var sectorScores = {};
    if (metrics && metrics.sectorData) {
      metrics.sectorData.forEach(function(s) { sectorScores[s.id] = s.metrics ? s.metrics.penalisedPct : 0; });
    }

    var payload = {
      storeName: state.storeName,
      storeEmail: state.email || '',
      auditor: state.auditor,
      manager: state.manager,
      areaManager: state.areaManager || '',
      date: state.date,
      isTraining: state.isTraining || false,
      week: week,
      year: year,
      scores: {
        total: metrics ? metrics.pct : null,
        food: sectorScores.food || null,
        fire: sectorScores.fire || null,
        handS: sectorScores.hs || null,
        coffee: sectorScores.coffee || null,
        customerJourney: sectorScores.journey || null,
        birdsFocus: sectorScores.focus || null
      },
      actions: actionItems.map(function(a) {
        return {
          questionId: a.questionId || '',
          sector: a.sector || '',
          category: a.category || '',
          question: a.question || '',
          answer: a.answer || '',
          description: (a.action && a.action.description) || '',
          personResponsible: (a.action && a.action.person) || '',
          actionNeeded: (a.action && a.action.actionNeeded) || '',
          status: (a.action && a.action.status) || 'Open',
          critical: (a.action && a.action.critical) ? 'Yes' : 'No',
          extraComment: '',
          auditEmailSent: ''
        };
      })
    };

    var safeStore = state.storeName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    var safeDate = state.date.replace(/\//g, '-');
    var fileName = safeStore + '-' + safeDate + '.json';

    var openDirHandle = await directoryHandle.getDirectoryHandle('Open', { create: true });
    console.log('[Audit Actions] Got Open/ folder');

    console.log('[Audit Actions] Writing ' + fileName + ' with', payload.actions.length, 'actions...');
    var jsonStr = JSON.stringify(payload, null, 2);
    var jsonBlob = new Blob([jsonStr], { type: 'application/json' });
    var fh = await openDirHandle.getFileHandle(fileName, { create: true });
    var writable = await fh.createWritable();
    await writable.write(jsonBlob);
    await writable.close();

    console.log('[Audit Actions] Write complete — Open/' + fileName + ' saved');
    return { method: 'folder', count: payload.actions.length };
  } catch (e) {
    console.error('[Audit Actions] Write FAILED:', e.message, e);
    return { method: 'error', count: actionItems.length, error: e.message };
  }
}

async function readJsonFolder(folderName) {
  var isCloud = window.__azureConfig && typeof GraphAPI !== 'undefined' && GraphAPI.isAuthenticated();

  // ===== GRAPH API PATH =====
  if (isCloud) {
    try {
      var files = await GraphAPI.listFilesInFolder(folderName);
      var results = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (f.name.endsWith('.json')) {
          try {
            var text = await GraphAPI.downloadFileAsTextFromFolder(folderName, f.name);
            var data = JSON.parse(text);
            data._fileName = f.name;
            results.push(data);
          } catch (e) {
            console.warn('[Audit Actions] Cloud read failed for ' + folderName + '/' + f.name + ':', e.message);
          }
        }
      }
      console.log('[Audit Actions] Cloud read: ' + results.length + ' JSON files from ' + folderName);
      return results;
    } catch (e) {
      console.log('[Audit Actions] Cloud folder ' + folderName + ' not accessible');
      return [];
    }
  }

  // ===== FSA PATH =====
  if (typeof directoryHandle === 'undefined' || !directoryHandle) return [];
  try {
    var hasPerm = typeof verifyPermission === 'function' ? await verifyPermission(directoryHandle, false) : false;
    if (!hasPerm) return [];
    var dir = await directoryHandle.getDirectoryHandle(folderName);
    var results = [];
    for await (var entry of dir.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.json')) {
        try {
          var file = await entry.getFile();
          var text = await file.text();
          var data = JSON.parse(text);
          data._fileName = entry.name;
          results.push(data);
        } catch (e) {
          console.warn('[Audit Actions] Failed to read ' + entry.name + ':', e.message);
        }
      }
    }
    return results;
  } catch (e) {
    console.log('[Audit Actions] Folder ' + folderName + ' not found or not accessible');
    return [];
  }
}

async function readAllActions() {
  console.log('[Audit Actions] Reading Open/ and Closed/ folders...');
  var openFiles = await readJsonFolder('Open');
  var closedFiles = await readJsonFolder('Closed');
  console.log('[Audit Actions] Open files:', openFiles.length, 'Closed files:', closedFiles.length);

  var closedQuestionIds = {};
  closedFiles.forEach(function(f) {
    if (f.actions) {
      f.actions.forEach(function(a) {
        if (a.questionId) closedQuestionIds[a.questionId] = {
          closedOn: a.closedOn || '',
          howClosed: a.howClosed || ''
        };
      });
    }
  });

  var allOpen = [];
  openFiles.forEach(function(f) {
    if (!f.actions) return;
    f.actions.forEach(function(a) {
      if (a.status !== 'Closed' && !closedQuestionIds[a.questionId]) {
        allOpen.push({
          storeName: f.storeName,
          storeEmail: f.storeEmail,
          auditor: f.auditor,
          manager: f.manager,
          areaManager: f.areaManager || '',
          date: f.date,
          scores: f.scores || {},
          questionId: a.questionId,
          sector: a.sector,
          category: a.category,
          question: a.question,
          answer: a.answer,
          description: a.description,
          personResponsible: a.personResponsible,
          actionNeeded: a.actionNeeded,
          status: 'Open',
          critical: a.critical || 'No',
          isTraining: f.isTraining || false,
          _fileName: f._fileName
        });
      }
    });
  });

  console.log('[Audit Actions] Total open actions:', allOpen.length);
  return { open: allOpen, openFiles: openFiles, closedFiles: closedFiles, closedQuestionIds: closedQuestionIds };
}

window.loadSharedActions = async function() {
  var data = await readAllActions();
  if (data.open.length > 0) {
    console.log('[Audit Actions] Loading', data.open.length, 'open actions into IndexedDB...');
    for (var i = 0; i < data.open.length; i++) {
      var a = data.open[i];
      var existing = await idbGet('actions', a.questionId);
      if (!existing) {
        await idbAdd('actions', {
          QuestionID: a.questionId,
          Store: a.storeName,
          StoreEmail: a.storeEmail,
          Auditor: a.auditor,
          Manager: a.manager,
          AreaManager: a.areaManager,
          AuditDate: a.date,
          Sector: a.sector,
          Category: a.category,
          Question: a.question,
          Answer: a.answer,
          Description: a.description,
          PersonResponsible: a.personResponsible,
          ActionNeeded: a.actionNeeded,
          Status: 'Open',
          Critical: a.critical,
          isTraining: a.isTraining || false,
          _source: 'json_files'
        });
      }
    }
  }
  return data;
};

window.writeAuditResults = async function(state) {
  if (!state) { console.warn('[Audit] writeAuditResults called with null state'); return; }
  console.log('[Audit] writeAuditResults START — store:', state.storeName, 'isTraining:', state.isTraining, 'branchId:', state.branchId);
  
  var metrics = auditOverallMetrics();
  var isoDate = state.date;
  var d = new Date(isoDate);
  var year = d.getFullYear();
  var week = getISOWeek(d);
  console.log('[Audit] Week:', week, 'Year:', year, 'Score:', metrics.pct + '%');

  var sectorScores = {};
  metrics.sectorData.forEach(function(s) { sectorScores[s.id] = s.metrics.penalisedPct; });

  var isTraining = state.isTraining === true;
  console.log('[Audit] isTraining resolved to:', isTraining, '(raw:', state.isTraining, ')');

  var auditRecord = {
    Store: state.storeName,
    Year: year,
    Week: week,
    Score: metrics.pct,
    Food: sectorScores.food || 0,
    Fire: sectorScores.fire || 0,
    HandS: sectorScores.hs || 0,
    Journey: sectorScores.journey || 0,
    Coffee: sectorScores.coffee || 0,
    Focus: sectorScores.focus || 0
  };

  if (isTraining) {
    auditRecord.isTraining = true;
    auditRecord.auditor = state.auditor;
    auditRecord.date = isoDate;
    auditRecord.traineeName = state.manager || '';
    await idbPut('training_audits', auditRecord);
    console.log('[Audit] Saved training audit to training_audits store (not audits store)');

    var actionItems = auditGetActions();
    for (var i = 0; i < actionItems.length; i++) {
      var a = actionItems[i];
      await idbAdd('actions', {
        Week: week, Year: year,
        Store: state.storeName,
        StoreEmail: state.email || '',
        Auditor: state.auditor,
        Manager: state.manager,
        AreaManager: state.areaManager,
        AuditDate: isoDate,
        Sector: a.sector,
        Category: a.category,
        QuestionID: a.questionId || '',
        Question: a.question,
        Answer: a.answer || '',
        Description: a.action.description || '',
        PersonResponsible: a.action.person || '',
        ActionNeeded: a.action.actionNeeded || '',
        Status: a.action.status || 'Open',
        ClosedOn: a.action.closedOn || '',
        HowClosed: '',
        ExtraComment: '',
        Critical: a.action.critical ? 'Yes' : 'No',
        isTraining: true,
        _source: 'audit_perform'
      });
    }
    console.log('[Audit] Saved', actionItems.length, 'training action items to IndexedDB');

    console.log('[Audit] Calling writeAuditActionsToXlsx for training...');
    try {
      var xlsxResult = await writeAuditActionsToXlsx(state);
      window._lastXlsxResult = xlsxResult;
      console.log('[Audit] XLSX result:', JSON.stringify(xlsxResult));
    } catch (xlsxErr) {
      console.error('[Audit] XLSX append FAILED:', xlsxErr.message, xlsxErr);
      window._lastXlsxResult = { method: 'error', count: 0, error: xlsxErr.message };
    }
    console.log('[Audit] writeAuditResults COMPLETE (training mode)');
    return;
  }

  await idbPut('audits', auditRecord);
  console.log('[Audit] Saved audit record to IndexedDB');

  var actionItems = auditGetActions();
  console.log('[Audit] Actions found:', actionItems.length);

  for (var i = 0; i < actionItems.length; i++) {
    var a = actionItems[i];
    await idbAdd('actions', {
      Week: week, Year: year,
      Store: state.storeName,
      StoreEmail: state.email || '',
      Auditor: state.auditor,
      Manager: state.manager,
      AreaManager: state.areaManager,
      AuditDate: isoDate,
      Sector: a.sector,
      Category: a.category,
      QuestionID: a.questionId || '',
      Question: a.question,
      Answer: a.answer || '',
      Description: a.action.description || '',
      PersonResponsible: a.action.person || '',
      ActionNeeded: a.action.actionNeeded || '',
      Status: a.action.status || 'Open',
      ClosedOn: a.action.closedOn || '',
      HowClosed: '',
      ExtraComment: '',
      Critical: a.action.critical ? 'Yes' : 'No',
      _source: 'audit_perform'
    });
  }
  console.log('[Audit] Saved', actionItems.length, 'action items to IndexedDB');

  if (state.email || state.manager) {
    var rec = await idbGet('stores', state.branchId) || { BranchId: state.branchId, originalName: state.storeName, AM: state.areaManager };
    if (state.email) rec.email = state.email;
    if (state.manager) rec.manager = state.manager;
    await idbPut('stores', rec);
  }

  console.log('[Audit] Calling writeAuditActionsToXlsx...');
  try {
    var xlsxResult = await writeAuditActionsToXlsx(state);
    window._lastXlsxResult = xlsxResult;
    console.log('[Audit] XLSX result:', JSON.stringify(xlsxResult));
  } catch (xlsxErr) {
    console.error('[Audit] XLSX append FAILED:', xlsxErr.message, xlsxErr);
    window._lastXlsxResult = { method: 'error', count: 0, error: xlsxErr.message };
  }
  console.log('[Audit] writeAuditResults COMPLETE');
};

function getISOWeek(date) {
  var d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  var week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// === PDF GENERATION (Portrait, jsPDF, Auto-Download) ===

async function auditGeneratePDF() {
  if (typeof window.jspdf === 'undefined') { alert('PDF library not loaded'); return; }
  var { jsPDF } = window.jspdf;
  var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  var W = 210, H = 297, M = 15, CW = W - 2 * M;
  var y = M;

  function checkPage(needed) { if (y + needed > H - M) { doc.addPage(); y = M; } }

  // ── SECTION 1: Header & Scores ──────────────────────────────
  doc.setFillColor(0, 168, 142);
  doc.rect(0, 0, W, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('Retail Audit Report', M, 14);
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(auditState.storeName + ' — ' + auditState.date, M, 22);
  y = 40;

  // Info Grid
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  var infoLabels = ['Store', 'Area Manager', 'Manager', 'Auditor'];
  var infoValues = [auditState.storeName, auditState.areaManager, auditState.manager, auditState.auditor];
  for (var i = 0; i < 4; i++) {
    var col = i % 2, row = Math.floor(i / 2);
    var ix = M + col * (CW / 2), iy = y + row * 12;
    doc.setFont(undefined, 'bold'); doc.text(infoLabels[i] + ':', ix, iy);
    doc.setFont(undefined, 'normal'); doc.text(infoValues[i] || '—', ix + 25, iy);
  }
  y += 30;

  // Summary
  if (auditState.summary) {
    checkPage(15);
    doc.setFont(undefined, 'italic'); doc.setFontSize(9);
    doc.text('Summary: ' + auditState.summary, M, y); y += 10;
  }

  // Overall Score
  var overall = auditOverallMetrics();
  checkPage(35);
  doc.setFillColor(240, 253, 250);
  doc.roundedRect(M, y, CW, 25, 3, 3, 'F');
  doc.setFontSize(28); doc.setFont(undefined, 'bold');
  doc.setTextColor(0, 168, 142);
  doc.text(overall.pct + '%', M + 5, y + 17);
  doc.setFontSize(9); doc.setTextColor(100, 100, 100);
  doc.text('Overall Score (' + overall.totalMax + ' max points)', M + 50, y + 10);
  if (overall.totalCritical > 0) {
    doc.setTextColor(200, 50, 50);
    doc.text(overall.totalCritical + ' critical items — penalty: -' + overall.totalPenalty + '%', M + 50, y + 18);
  }
  y += 32;

  // Sector Scores
  checkPage(20);
  var secW = CW / 6 - 2;
  overall.sectorData.forEach(function(s, idx) {
    var sx = M + idx * (secW + 2);
    var rag = s.metrics.failed ? [255, 200, 200] : s.metrics.penalisedPct >= 95 ? [209, 250, 229] : s.metrics.penalisedPct >= 90 ? [220, 252, 231] : s.metrics.penalisedPct >= 80 ? [254, 243, 199] : [254, 226, 226];
    doc.setFillColor(rag[0], rag[1], rag[2]);
    doc.roundedRect(sx, y, secW, 18, 2, 2, 'F');
    doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(60, 60, 60);
    doc.text(s.metrics.penalisedPct + '%', sx + secW / 2, y + 8, { align: 'center' });
    doc.setFontSize(6); doc.setFont(undefined, 'normal');
    doc.text(s.title, sx + secW / 2, y + 14, { align: 'center' });
  });
  y += 25;

  // ── SECTION 2: Critical Actions ─────────────────────────────
  var allActions = auditGetActions();
  var criticalActions = allActions.filter(function(a) { return a.action.critical; });
  var nonCriticalActions = allActions.filter(function(a) { return !a.action.critical; });

  if (criticalActions.length > 0) {
    checkPage(15);
    doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(200, 50, 50);
    doc.text('Critical Actions (' + criticalActions.length + ')', M, y); y += 6;

    for (var ci = 0; ci < criticalActions.length; ci++) {
      var item = criticalActions[ci];
      var cardH = 24;
      // Estimate photo height
      var hasAnyPhoto = item.photos[0] || item.photos[1] || item.photos[2];
      if (hasAnyPhoto) cardH = 70;

      checkPage(cardH + 5);

      // Card background with red left border
      doc.setFillColor(254, 226, 226);
      doc.roundedRect(M, y, CW, cardH, 2, 2, 'F');
      doc.setFillColor(220, 38, 38);
      doc.roundedRect(M, y, 4, cardH, 1, 1, 'F');

      // Text content
      doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(60, 60, 60);
      doc.text(item.sector + ' > ' + item.category + ' [CRITICAL]', M + 8, y + 5);
      doc.setFont(undefined, 'normal'); doc.setFontSize(7);
      doc.text(item.action.description || item.question, M + 8, y + 11);
      doc.text('Responsible: ' + (item.action.person || '—') + '  |  Status: ' + (item.action.status || 'Open'), M + 8, y + 16);

      // Photos — large, side by side
      if (hasAnyPhoto) {
        var photoY = y + 20;
        var photoX = M + 8;
        var photoW = 55, photoH = 45;
        for (var pi = 0; pi < item.photos.length; pi++) {
          if (!item.photos[pi]) continue;
          try {
            var ph = await addPhotoToDoc(doc, item.photos[pi], photoX, photoY, photoW, photoH);
            photoX += photoW + 3;
            if (photoX + photoW > M + CW) break;
          } catch(e) {}
        }
      }

      y += cardH + 4;
    }
  }

  // ── SECTION 3: Non-Critical Actions ─────────────────────────
  if (nonCriticalActions.length > 0) {
    checkPage(15);
    doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(40, 40, 40);
    doc.text('Action Items (' + nonCriticalActions.length + ')', M, y); y += 6;

    for (var ni = 0; ni < nonCriticalActions.length; ni++) {
      var nitem = nonCriticalActions[ni];
      var ncardH = 22;
      if (nitem.photos[0]) ncardH = 54;

      checkPage(ncardH + 4);

      doc.setFillColor(255, 251, 235);
      doc.roundedRect(M, y, CW, ncardH, 2, 2, 'F');
      doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(60, 60, 60);
      doc.text(nitem.sector + ' > ' + nitem.category, M + 3, y + 5);
      doc.setFont(undefined, 'normal'); doc.setFontSize(7);
      doc.text(nitem.action.description || nitem.question, M + 3, y + 11);
      doc.text('Responsible: ' + (nitem.action.person || '—') + '  |  Status: ' + (nitem.action.status || 'Open'), M + 3, y + 16);
      y += 20;

      if (nitem.photos[0]) {
        try {
          var nph = await addPhotoToDoc(doc, nitem.photos[0], M + 3, y, 40, 30);
          if (nph) y += nph + 2;
        } catch(e) {}
      }
      y += 2;
    }
  }

  // ── SECTION 4: Comments & Evidence ──────────────────────────
  var comments = auditCollectAllComments();

  // 4a: Comments WITH photos
  if (comments.withPhotos.length > 0) {
    checkPage(15);
    doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(40, 40, 40);
    doc.text('Comments & Evidence (' + comments.withPhotos.length + ')', M, y); y += 6;

    for (var ci2 = 0; ci2 < comments.withPhotos.length; ci2++) {
      var cv = comments.withPhotos[ci2];
      var allP = [cv.photoThumb, cv.extraPhotoThumb, cv.extraPhoto2Thumb].filter(Boolean);
      var cCardH = cv.comment ? 55 : 45;

      checkPage(cCardH + 4);

      doc.setFillColor(248, 250, 252);
      doc.roundedRect(M, y, CW, cCardH, 2, 2, 'F');
      doc.setFontSize(7); doc.setFont(undefined, 'bold'); doc.setTextColor(0, 140, 120);
      doc.text(cv.sector + ' > ' + cv.category, M + 3, y + 5);
      doc.setFont(undefined, 'normal'); doc.setFontSize(6); doc.setTextColor(80, 80, 80);
      doc.text(cv.question.substring(0, 90), M + 3, y + 10);

      var commentY = y + 15;
      if (cv.comment) {
        doc.setFontSize(7); doc.setTextColor(60, 60, 60);
        var commentLines = doc.splitTextToSize(cv.comment, CW - 6);
        doc.text(commentLines, M + 3, commentY);
        commentY += commentLines.length * 3 + 2;
      }

      // Photos — large and prominent
      var photoStartY = Math.max(commentY, y + 16);
      var pX = M + 3;
      for (var pi2 = 0; pi2 < allP.length; pi2++) {
        try {
          var cph = await addPhotoToDoc(doc, allP[pi2], pX, photoStartY, 55, 38);
          pX += 58;
          if (pX + 55 > M + CW) break;
        } catch(e) {}
      }
      y += cCardH + 4;
    }
  }

  // 4b: Comments WITHOUT photos
  if (comments.withoutPhotos.length > 0) {
    checkPage(15);
    doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(40, 40, 40);
    doc.text('Notes (' + comments.withoutPhotos.length + ')', M, y); y += 6;

    for (var ci3 = 0; ci3 < comments.withoutPhotos.length; ci3++) {
      var cv2 = comments.withoutPhotos[ci3];
      var nLines = cv2.comment ? doc.splitTextToSize(cv2.comment, CW - 6) : [];
      var nCardH = 12 + nLines.length * 3;

      checkPage(nCardH + 3);

      doc.setFillColor(248, 250, 252);
      doc.roundedRect(M, y, CW, nCardH, 2, 2, 'F');
      doc.setFontSize(7); doc.setFont(undefined, 'bold'); doc.setTextColor(0, 140, 120);
      doc.text(cv2.sector + ' > ' + cv2.category, M + 3, y + 5);
      doc.setFont(undefined, 'normal'); doc.setFontSize(6); doc.setTextColor(80, 80, 80);
      doc.text(cv2.question.substring(0, 90), M + 3, y + 10);
      if (cv2.comment) {
        doc.setFontSize(7); doc.setTextColor(60, 60, 60);
        doc.text(nLines, M + 3, y + 15);
      }
      y += nCardH + 3;
    }
  }

  // ── SECTION 5: All Answered Questions ───────────────────────
  checkPage(15);
  doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(40, 40, 40);
  doc.text('All Questions', M, y); y += 4;

  var tableRows = [];
  auditSectorKeys().forEach(function(sid) {
    var sec = auditState.sectors[sid];
    sec.categories.forEach(function(cat) {
      cat.questions.forEach(function(q) {
        if (q.answer) {
          var icon = q.answer === 'Pass' ? '✓' : q.answer === 'Fail' ? '✗' : '—';
          tableRows.push([sec.title, cat.name, q.text.substring(0, 60), icon, q.weight + '']);
        }
      });
    });
  });

  if (tableRows.length > 0) {
    doc.autoTable({
      startY: y,
      head: [['Sector', 'Category', 'Question', 'Answer', 'Wt']],
      body: tableRows,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [0, 168, 142], fontSize: 7, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: M, right: M },
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 30 }, 2: { cellWidth: 75 }, 3: { cellWidth: 12, halign: 'center' }, 4: { cellWidth: 10, halign: 'center' } }
    });
  }

  // Footer
  var pageCount = doc.internal.getNumberOfPages();
  for (var p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7); doc.setTextColor(150, 150, 150);
    doc.text('Birds Bakery — Retail Audit Report — Generated ' + new Date().toLocaleString('en-GB'), M, H - 8);
    doc.text('Page ' + p + ' of ' + pageCount, W - M, H - 8, { align: 'right' });
  }

  var filename = 'audit_' + auditState.storeName.replace(/\s+/g, '_') + '_' + auditState.date + '.pdf';
  doc.save(filename);
}

async function addPhotoToDoc(doc, dataUrl, x, y, maxW, maxH) {
  if (!dataUrl) return 0;
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;
      if (w > maxW) { h = h * (maxW / w); w = maxW; }
      if (h > maxH) { w = w * (maxH / h); h = maxH; }
      var c = document.createElement('canvas');
      c.width = Math.round(w); c.height = Math.round(h);
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, Math.round(w), Math.round(h));
      try {
        doc.addImage(c.toDataURL('image/jpeg', 0.75), 'JPEG', x, y, w, h);
        resolve(h);
      } catch(e) { resolve(0); }
    };
    img.onerror = function() { resolve(0); };
    img.src = dataUrl;
  });
}

// === MOBILE ZIP IMPORT ===

window.importMobileAuditZIP = async function(event) {
  var file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  try {
    console.log('[Import] Reading ZIP:', file.name);
    var zip = await JSZip.loadAsync(file);

    var sessionFile = zip.file('audit_session.json');
    if (!sessionFile) {
      alert('Invalid audit ZIP \u2014 audit_session.json not found.');
      return;
    }

    var sessionData = JSON.parse(await sessionFile.async('text'));
    console.log('[Import] Session data loaded:', sessionData.metadata.storeName);

    var meta = sessionData.metadata;
    var actionItems = sessionData.actions || [];
    var questionItems = sessionData.questions || [];

    // Determine branchId — use original if it's a real store, otherwise generate custom
    var branchId = meta.branchId || '';
    if (!branchId || branchId === '__training') {
      branchId = 'custom_' + Date.now();
    }

    // 1. Init fresh auditState
    auditInit(branchId, meta.storeName, meta.areaManager || '');

    // 2. Override metadata from ZIP (don't wait for IndexedDB lookup)
    auditState.email = meta.storeEmail || '';
    auditState.manager = meta.manager || '';
    auditState.auditor = meta.auditor || 'Blake Lowis';
    auditState.date = meta.date || new Date().toISOString().slice(0, 10);
    auditState.summary = meta.summary || '';
    auditState.isTraining = meta.isTraining || false;

    // 3. Init empty sector structure from question bank
    auditInitSectors();

    // 4. Populate answers + comments from session questions
    var answerCount = 0;
    questionItems.forEach(function(item) {
      var sec = auditState.sectors[item.sectorId];
      if (!sec) return;
      var cat = sec.categories.find(function(c) { return c.id === item.categoryId; });
      if (!cat) return;
      var q = cat.questions.find(function(qq) { return qq.id === item.questionId; });
      if (!q) return;
      if (item.answer) { q.answer = item.answer; answerCount++; }
      if (item.comment) q.comment = item.comment;
    });
    console.log('[Import] Populated', answerCount, 'answers');

    // 5. Populate actions
    var actionCount = 0;
    actionItems.forEach(function(a) {
      // Find question by questionId across all sectors
      var found = null;
      auditSectorKeys().forEach(function(sid) {
        if (found) return;
        auditState.sectors[sid].categories.forEach(function(cat) {
          if (found) return;
          var qq = cat.questions.find(function(q) { return q.id === a.questionId; });
          if (qq) found = qq;
        });
      });
      if (!found) return;
      var critical = a.critical === 'Yes' || a.critical === true || a.critical === 'true';
      found.action = {
        enabled: true,
        description: a.description || '',
        person: a.personResponsible || '',
        actionNeeded: a.actionNeeded || '',
        critical: critical,
        status: a.status || 'Open',
        closedOn: a.closedOn || '',
        createdAt: a.createdAt || new Date().toISOString()
      };
      actionCount++;
    });
    console.log('[Import] Populated', actionCount, 'actions');

    // 6. Load photos from ZIP
    var photoCount = 0;
    var photosFolder = zip.folder('photos');
    if (photosFolder) {
      var photoPromises = [];
      photosFolder.forEach(function(relativePath, entry) {
        if (entry.dir) return;
        // Filename format: {sectorId}_{catId}_{qId}.jpg or {sectorId}_{catId}_{qId}_extra.jpg
        var match = relativePath.match(/^([^_]+)_(.+)_(F?\d+[a-z]?)(?:_(extra|extra2))?\.\w+$/i);
        if (!match) return;
        var sectorId = match[1];
        // catId may contain underscores, qId is the last segment before _extra
        // Re-parse: sectorId is first token, everything between first _ and last _FXX is catId
        var parts = relativePath.replace(/\.\w+$/, '').split('_');
        // Find the question ID pattern (starts with F or is a number)
        var qIdIdx = -1;
        for (var pi = parts.length - 1; pi >= 1; pi--) {
          if (/^(F?\d+[a-z]?|extra|extra2)$/i.test(parts[pi])) { qIdIdx = pi; break; }
        }
        if (qIdIdx < 2) return;
        sectorId = parts[0];
        var catId = parts.slice(1, qIdIdx).join('_');
        var qId = parts[qIdIdx];
        var slot = parts[qIdIdx + 1] || '';

        var promise = entry.async('base64').then(function(b64) {
          var ext = relativePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
          var dataURL = 'data:' + ext + ';base64,' + b64;
          // Find question and set photo
          var sec = auditState.sectors[sectorId];
          if (!sec) return;
          var cat = sec.categories.find(function(c) { return c.id === catId; });
          if (!cat) return;
          var q = cat.questions.find(function(qq) { return qq.id === qId; });
          if (!q) return;
          if (slot === 'extra') { q.extraPhoto = dataURL; q.extraPhotoThumb = dataURL; }
          else if (slot === 'extra2') { q.extraPhoto2 = dataURL; q.extraPhoto2Thumb = dataURL; }
          else { q.photo = dataURL; q.photoThumb = dataURL; }
          photoCount++;
        });
        photoPromises.push(promise);
      });
      await Promise.all(photoPromises);
    }
    console.log('[Import] Loaded', photoCount, 'photos');

    // 7. Open the perform view
    auditState.view = 'sectors';
    renderAuditPerform();

    alert(
      'Import complete: ' + meta.storeName + (meta.isTraining ? ' [TRAINING]' : '') + '\n' +
      'Score: ' + (sessionData.scores ? sessionData.scores.overall + '%' : '—') + '\n' +
      answerCount + ' answers, ' + actionCount + ' actions, ' + photoCount + ' photos loaded\n\n' +
      'Review the audit and press Complete when ready.'
    );

  } catch (err) {
    console.error('[Import] Failed:', err);
    alert('Failed to import ZIP: ' + err.message);
  }
};

// === BOOT: Load cached question bank, fallback to bundled JSON ===
(function() {
  console.log('[Audit] Boot loader running, _auditQB=', _auditQB);
  function updateQBStatusUI() {
    var el = document.getElementById('auditQBStatus');
    if (!el || !_auditQB) return;
    el.innerHTML = '<span class="text-emerald-600 font-bold">&#10003; Question bank loaded (' + Object.keys(_auditQB).length + ' sectors)</span>';
    // Enable start button if store is also selected
    var btn = document.getElementById('auditStartBtn');
    if (btn && auditState && auditState.branchId) btn.disabled = false;
    var hint = document.getElementById('auditStartHint');
    if (hint && auditState && auditState.branchId) hint.textContent = '';
    // Show sectors list
    var sectorInfo = el.closest('.bg-white');
    if (sectorInfo && !sectorInfo.querySelector('.text-xs.text-slate-500.mt-3')) {
      var div = document.createElement('div');
      div.className = 'mt-3 text-xs text-slate-500';
      div.textContent = 'Sectors: ' + Object.keys(_auditQB).map(function(k) { return _auditQB[k].title || k; }).join(', ');
      sectorInfo.appendChild(div);
    }
  }

  // Always try fetching the bundled JSON immediately — no DB dependency
  console.log('[Audit] Fetching ./AuditQuestions.json...');
  fetch('./AuditQuestions.json').then(function(resp) {
    console.log('[Audit] Fetch response:', resp.status, resp.ok);
    if (resp.ok) return resp.json();
    throw new Error('HTTP ' + resp.status);
  }).then(function(data) {
    console.log('[Audit] Parse OK, keys:', Object.keys(data));
    if (!_auditQB) {
      _auditQB = data;
      console.log('[Audit] Loaded bundled AuditQuestions.json (' + Object.keys(data).length + ' sectors)');
      updateQBStatusUI();
      // Cache it for next time
      if (typeof idbPut === 'function' && typeof db !== 'undefined' && db) {
        idbPut('questionBank', { id: 'current', data: _auditQB, loadedAt: new Date().toISOString(), fileName: 'AuditQuestions.json (bundled)' });
      }
    }
  }).catch(function(e) {
    console.warn('[Audit] Fetch failed:', e.message, '— trying IndexedDB cache');
    // Fetch failed, try IndexedDB
    if (typeof idbGet === 'function' && typeof db !== 'undefined' && db) {
      idbGet('questionBank', 'current').then(function(rec) {
        if (rec && rec.data && !_auditQB) {
          _auditQB = rec.data;
          console.log('[Audit] Loaded cached question bank from', rec.fileName || 'IndexedDB');
          updateQBStatusUI();
        }
      }).catch(function() {});
    }
  });
})();
