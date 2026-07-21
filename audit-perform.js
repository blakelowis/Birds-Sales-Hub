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
          items.push({ sector: sec.title, category: cat.name, questionId: q.id, question: q.text, answer: q.answer, weight: q.weight, action: q.action, photos: [q.photo, q.extraPhoto, q.extraPhoto2] });
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
        items.push({ sector: sec.title, category: cat.name, question: q.text, answer: q.answer, comment: q.comment, photoThumb: q.photo, extraPhotoThumb: q.extraPhoto, extraPhoto2Thumb: q.extraPhoto2 });
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
        if (!q.comment && !q.photo && !q.extraPhoto && !q.extraPhoto2) return;
        if (q.answer !== 'Pass' && q.answer !== 'Fail') return;
        if (q.action && q.action.enabled) return;
        var item = {
          sector: sec.title, category: cat.name,
          question: q.text, answer: q.answer,
          comment: q.comment || '',
          photoThumb: q.photo, extraPhotoThumb: q.extraPhoto, extraPhoto2Thumb: q.extraPhoto2
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
        var has2 = q.extraPhoto;
        var has3 = q.extraPhoto2;
        if (has2 || has3) {
          items.push({ sector: sec.title, category: cat.name, question: q.text, answer: q.answer, photo2: q.extraPhoto, photo3: q.extraPhoto2 });
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

  // Load email/manager from existing data
  if (auditState && auditState.sectors && Object.keys(auditState.sectors).length > 0) {
    setTimeout(function() {
      var em = document.getElementById('auditEmail');
      var mg = document.getElementById('auditManager');
      if (em && auditState.email) em.value = auditState.email;
      if (mg && auditState.manager) mg.value = auditState.manager;
    }, 0);
  }

  var meta = auditState || {};
  mainView.innerHTML = `
    <div class="max-w-3xl mx-auto">
      <div class="flex items-center gap-4 mb-6">
        ${auditState && auditState.sectors && Object.keys(auditState.sectors).length ? '<button onclick="auditGoSectors()" class="text-emerald-500 hover:text-emerald-600 text-sm font-bold">← Back to Sectors</button>' : ''}
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

window.auditJumpToQuestion = function(qid) {
  var found = null;
  auditSectorKeys().forEach(function(sid) {
    auditState.sectors[sid].categories.forEach(function(cat) {
      cat.questions.forEach(function(q) {
        if (q.id === qid) found = { sid: sid, cid: cat.id };
      });
    });
  });
  if (!found) return;
  auditState.view = 'questions';
  auditState.sectorId = found.sid;
  auditState.categoryId = found.cid;
  renderAuditPerform();
};

function auditSectorActionReviewHTML() {
  var actions = auditGetActions();
  if (!actions.length) return '';
  var rows = actions.map(function(a) {
    var statusCls = (a.action.status || 'Open') === 'Open' ? 'bg-amber-100 text-amber-700' : 'text-birds-green bg-birds-light';
    var critBadge = a.action.critical ? '<span class="bg-red-100 text-red-700 text-[9px] font-black px-1.5 py-0.5 rounded-full mr-1">CRITICAL</span>' : '';
    var photoCount = [a.photos[0], a.photos[1], a.photos[2]].filter(Boolean).length;
    return '<tr onclick="auditJumpToQuestion(\'' + a.questionId + '\')" class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">' +
      '<td class="py-2.5 px-2 text-[11px] font-bold text-slate-600 max-w-[80px] truncate">' + escapeHtml(a.sector) + '</td>' +
      '<td class="py-2.5 px-2 text-[11px] text-slate-800 max-w-[120px] truncate">' + escapeHtml(a.question.substring(0, 40)) + '</td>' +
      '<td class="py-2.5 px-2 text-[10px] font-bold">' + critBadge + '<span class="' + statusCls + ' px-2 py-0.5 rounded-full">' + (a.action.status || 'Open') + '</span></td>' +
      '<td class="py-2.5 px-2 text-center text-[11px] text-slate-400">' + (photoCount ? photoCount : '') + '</td>' +
    '</tr>';
  }).join('');
  return '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm mb-4 overflow-hidden">' +
    '<button onclick="auditToggleSectorActions()" class="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors">' +
      '<div class="flex items-center gap-2">' +
        '<h3 class="font-black text-slate-800 text-sm">Action Review</h3>' +
        '<span class="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-full">' + actions.length + ' items</span>' +
      '</div>' +
      '<svg class="w-5 h-5 text-slate-400 transition-transform ' + (_auditSectorActionsOpen ? 'rotate-180' : '') + '" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>' +
    '</button>' +
    '<div class="' + (_auditSectorActionsOpen ? '' : 'hidden') + '">' +
      '<div class="overflow-x-auto">' +
        '<table class="w-full text-left">' +
          '<thead><tr class="border-b border-slate-200 bg-slate-50">' +
            '<th class="py-2 px-2 text-[10px] font-black text-slate-500 uppercase">Sector</th>' +
            '<th class="py-2 px-2 text-[10px] font-black text-slate-500 uppercase">Question</th>' +
            '<th class="py-2 px-2 text-[10px] font-black text-slate-500 uppercase">Status</th>' +
            '<th class="py-2 px-2 text-[10px] font-black text-slate-500 uppercase text-center">📷</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
      '<div class="px-5 py-3 border-t border-slate-100">' +
        '<p class="text-[10px] text-slate-400 font-bold">Tap a row to jump to that question</p>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function auditSectorCommentReviewHTML() {
  var all = auditCollectAllComments();
  var items = all.withPhotos.concat(all.withoutPhotos);
  if (!items.length) return '';
  var rows = items.map(function(c) {
    var photos = '';
    if (c.photoThumb || c.extraPhotoThumb || c.extraPhoto2Thumb) {
      [c.photoThumb, c.extraPhotoThumb, c.extraPhoto2Thumb].filter(Boolean).forEach(function(ph) {
        photos += '<img src="' + ph + '" class="w-8 h-8 rounded object-cover border border-slate-200 inline-block mr-1">';
      });
    }
    return '<tr class="border-b border-slate-100">' +
      '<td class="py-2 px-2 text-[10px] font-bold text-slate-600 max-w-[60px] truncate">' + escapeHtml(c.sector) + '</td>' +
      '<td class="py-2 px-2 text-[11px] text-slate-800 max-w-[120px] truncate">' + escapeHtml(c.question.substring(0, 40)) + '</td>' +
      '<td class="py-2 px-2 text-[10px] text-slate-500 max-w-[80px] truncate">' + escapeHtml(c.comment.substring(0, 30)) + '</td>' +
      '<td class="py-2 px-2 text-center whitespace-nowrap">' + photos + '</td>' +
    '</tr>';
  }).join('');
  return '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm mb-4 overflow-hidden">' +
    '<button onclick="auditToggleSectorComments()" class="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors">' +
      '<div class="flex items-center gap-2">' +
        '<h3 class="font-black text-slate-800 text-sm">Comment Review</h3>' +
        '<span class="bg-slate-100 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded-full">' + items.length + ' items</span>' +
      '</div>' +
      '<svg class="w-5 h-5 text-slate-400 transition-transform ' + (_auditSectorCommentsOpen ? 'rotate-180' : '') + '" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>' +
    '</button>' +
    '<div class="' + (_auditSectorCommentsOpen ? '' : 'hidden') + '">' +
      '<div class="overflow-x-auto">' +
        '<table class="w-full text-left">' +
          '<thead><tr class="border-b border-slate-200 bg-slate-50">' +
            '<th class="py-2 px-2 text-[10px] font-black text-slate-500 uppercase">Sector</th>' +
            '<th class="py-2 px-2 text-[10px] font-black text-slate-500 uppercase">Question</th>' +
            '<th class="py-2 px-2 text-[10px] font-black text-slate-500 uppercase">Comment</th>' +
            '<th class="py-2 px-2 text-[10px] font-black text-slate-500 uppercase text-center">📷</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>' +
  '</div>';
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

      ${auditSectorActionReviewHTML()}
      ${auditSectorCommentReviewHTML()}

      <h3 class="font-black text-slate-800 mb-4">Sectors</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">${sectorCards}</div>

      <div class="flex flex-col gap-3 items-center mb-6">
        <button onclick="auditCompleteAllInOne()" class="w-full max-w-md bg-emerald-500 hover:bg-emerald-600 text-white font-black px-10 py-4 rounded-full text-lg shadow-lg transition-colors">
          Complete Audit
        </button>
        <div class="flex gap-3 w-full max-w-md">
          <button onclick="auditExportPDFOnly()" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-3 rounded-full transition-colors text-sm">
            Export PDF Only
          </button>
          <button onclick="auditSaveOnly()" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-3 rounded-full transition-colors text-sm">
            Save Only
          </button>
        </div>
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

      <div class="flex gap-4 justify-center flex-wrap">
        <button onclick="auditCompleteAndDownload()" class="bg-emerald-500 hover:bg-emerald-600 text-white font-black px-8 py-4 rounded-full text-lg shadow-lg transition-colors">
          Save & Download PDF
        </button>
        <button onclick="auditExportPDFOnly()" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-6 py-4 rounded-full transition-colors">
          Download PDF Only
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

var _auditSectorActionsOpen = false;
var _auditSectorCommentsOpen = false;

window.auditToggleSectorActions = function() {
  _auditSectorActionsOpen = !_auditSectorActionsOpen;
  renderAuditPerform();
};
window.auditToggleSectorComments = function() {
  _auditSectorCommentsOpen = !_auditSectorCommentsOpen;
  renderAuditPerform();
};

window.onAuditStoreSelect = function(branchId) {
  if (!branchId) return;
  var customWrap = document.getElementById('auditCustomStoreWrap');
  var hasExistingData = auditState && auditState.sectors && Object.keys(auditState.sectors).length > 0;
  if (branchId === '__training') {
    if (!hasExistingData) auditInit('__training', 'Training / Temp Store', 'Training');
    auditState.branchId = '__training';
    auditState.storeName = 'Training / Temp Store';
    auditState.areaManager = 'Training';
    auditState.isTraining = true;
    auditState.email = 'blake.lowis@birdsofderby.co.uk';
    var em = document.getElementById('auditEmail');
    var mg = document.getElementById('auditManager');
    if (em) { em.value = auditState.email; em.placeholder = 'Enter auditor/trainee email...'; }
    if (mg) { mg.value = ''; mg.placeholder = 'e.g. Trainee Name'; }
    if (customWrap) customWrap.classList.remove('hidden');
    var cs = document.getElementById('auditCustomStore');
    if (cs) { cs.value = ''; cs.focus(); }
  } else {
    var name = originalStoreNames.get(branchId) || branchId;
    var am = storeMap.get(branchId) || 'Unassigned';
    if (hasExistingData) {
      auditState.branchId = branchId;
      auditState.storeName = name;
      auditState.areaManager = am;
      auditState.isTraining = false;
      if (!auditState.email) auditState.email = auditEmailForStore(name);
    } else {
      auditInit(branchId, name, am);
    }
    var em = document.getElementById('auditEmail');
    if (em) { em.value = auditState.email || auditEmailForStore(name); em.placeholder = 'auto-generated from store name'; }
    var mg = document.getElementById('auditManager');
    if (mg) mg.placeholder = 'e.g. John Smith';
    if (customWrap) customWrap.classList.add('hidden');
  }
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
  var hasExistingData = Object.keys(auditState.sectors || {}).length > 0;
  if (!hasExistingData) auditInitSectors();
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
  var raw = await new Promise(function(resolve) {
    var reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.readAsDataURL(file);
  });
  var data = await auditOrientPhoto(raw);
  if (!data) data = raw;
  var thumb = await auditMakeThumb(data, 1200, 'image/jpeg', 0.7);
  var q = findAuditQ(sid, cid, qid);
  if (!q) return;
  if (slot === 0) { q.photo = data; q.photoThumb = thumb; }
  else if (slot === 1) { q.extraPhoto = data; q.extraPhotoThumb = thumb; }
  else if (slot === 2) { q.extraPhoto2 = data; q.extraPhoto2Thumb = thumb; }
  renderAuditPerform();
  e.target.value = '';
};

function auditOrientPhoto(dataUrl) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(c.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = function() { resolve(null); };
    img.src = dataUrl;
  });
}

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

window.auditSaveOnly = async function() {
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
};

window.auditExportPDFOnly = async function() {
  if (!auditState) return;
  try {
    await auditGeneratePDF();
  } catch (e) {
    console.warn('[Audit] PDF error:', e.message);
    alert('PDF generation failed: ' + e.message);
  }
};

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
  
  // 4. Show visible notification
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
          'Store Email': auditEmailForStore(state.storeName) || state.email || '',
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

      var storeEmail = auditEmailForStore(state.storeName);
      var payload = {
        storeName: state.storeName, storeEmail: storeEmail,
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

    var storeEmail = auditEmailForStore(state.storeName);
    var payload = {
      storeName: state.storeName,
      storeEmail: storeEmail,
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
      var actionKey = state.storeName + '_' + (a.questionId || 'q_' + i) + '_' + isoDate;
      await idbPut('actions', {
        ActionID: actionKey,
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

    console.log('[Audit] Skipping xlsx write for training audit');
    window._lastXlsxResult = { method: 'training', count: actionItems.length };
    console.log('[Audit] writeAuditResults COMPLETE (training mode)');
    return;
  }

  await idbPut('audits', auditRecord);
  console.log('[Audit] Saved audit record to IndexedDB');

  var actionItems = auditGetActions();
  console.log('[Audit] Actions found:', actionItems.length);

  for (var i = 0; i < actionItems.length; i++) {
    var a = actionItems[i];
    var actionKey = state.storeName + '_' + (a.questionId || 'q_' + i) + '_' + isoDate;
    await idbPut('actions', {
      ActionID: actionKey,
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
  var x0 = M, x1 = M + CW;
  var y = M;
  var FONT = 'helvetica';

  function checkPage(h) { if (y + h > H - M) { doc.addPage(); y = M; } }

  function bold() { doc.setFont(FONT, 'bold'); }
  function normal() { doc.setFont(FONT, 'normal'); }
  function size(s) { doc.setFontSize(s); }
  function color(r, g, b) { doc.setTextColor(r, g, b); }
  function fill(r, g, b) { doc.setFillColor(r, g, b); }
  function text(s, x, y_, opts) { doc.text(s, x, y_, opts || {}); }
  function wrap(s, w) { return doc.splitTextToSize(s, w); }
  function textW(s) { return doc.getTextWidth(s); }

  // ============================
  // PAGE 1 — Scorecard
  // ============================
  fill(0, 168, 142); doc.rect(0, 0, W, 32, 'F');
  color(255, 255, 255); size(20); bold();
  text('Retail Audit Report', x0, 14);
  size(10); normal();
  text(auditState.storeName + ' — ' + auditState.date, x0, 22);
  y = 42;

  // Metadata grid
  color(60, 60, 60); size(9);
  var mLabels = ['Store', 'Area Manager', 'Manager', 'Auditor'];
  var mValues = [auditState.storeName, auditState.areaManager, auditState.manager, auditState.auditor];
  for (var mi = 0; mi < 4; mi++) {
    var mc = mi % 2, mr = Math.floor(mi / 2);
    var mxx = x0 + mc * (CW / 2);
    bold(); text(mLabels[mi] + ':', mxx, y + mr * 11);
    normal();
    var mv = (mValues[mi] || '—') + '';
    text(mv, mxx + 28, y + mr * 11);
  }
  y += 28;

  // Summary
  if (auditState.summary) {
    checkPage(12);
    color(60, 60, 60); size(8); normal();
    var sumW = wrap('Summary: ' + auditState.summary, CW);
    text(sumW, x0, y); y += sumW.length * 3.5 + 2;
  }

  // Overall score card
  var overall = auditOverallMetrics();
  checkPage(32);
  fill(240, 253, 250); doc.roundedRect(x0, y, CW, 26, 3, 3, 'F');
  size(28); bold(); color(0, 168, 142);
  text(overall.pct + '%', x0 + 6, y + 18);
  size(10); color(100, 100, 100); normal();
  text('Overall Score (' + overall.totalMax + ' max pts)', x0 + 52, y + 11);
  if (overall.totalCritical > 0) {
    color(200, 50, 50); bold(); size(9);
    var cl = overall.totalCritical + ' critical items, penalty -' + overall.totalPenalty + '%';
    text(cl, x0 + 52, y + 19);
  }
  y += 32;

  // Sector scores
  checkPage(20);
  size(11); bold(); color(40, 40, 40);
  text('Sector Scores', x0, y); y += 7;
  var ansSectors = overall.sectorData.filter(function(s) { return s.metrics.totalQuestions > 0 && s.metrics.answered > 0; });
  if (ansSectors.length === 0) ansSectors = overall.sectorData;
  var sw = CW / Math.min(ansSectors.length, 6) - 2;
  ansSectors.forEach(function(s, si) {
    var sx = x0 + si * (sw + 2);
    var rgb = s.metrics.failed ? [255, 200, 200] : s.metrics.penalisedPct >= 95 ? [209, 250, 229] : s.metrics.penalisedPct >= 90 ? [220, 252, 231] : s.metrics.penalisedPct >= 80 ? [254, 243, 199] : [254, 226, 226];
    fill(rgb[0], rgb[1], rgb[2]); doc.roundedRect(sx, y, sw, 18, 2, 2, 'F');
    size(11); bold(); color(60, 60, 60);
    text(s.metrics.penalisedPct + '%', sx + sw / 2, y + 8, { align: 'center' });
    size(6); normal();
    var st = s.title.length > 10 ? s.title.substring(0, 9) + '..' : s.title;
    text(st, sx + sw / 2, y + 14, { align: 'center' });
  });
  y += 25;

  // ============================
  // PAGE 2+ — Action Plan
  // ============================
  var allActions = auditGetActions();
  var critActs = allActions.filter(function(a) { return a.action.critical; });
  var nonCritActs = allActions.filter(function(a) { return !a.action.critical; });

  // Critical actions
  if (critActs.length > 0) {
    checkPage(12);
    doc.addPage(); y = M;
    fill(200, 50, 50); doc.rect(0, 0, W, 14, 'F');
    color(255, 255, 255); size(12); bold();
    text('Critical Actions (' + critActs.length + ')', x0, 10);
    y = 22;

    for (var ci = 0; ci < critActs.length; ci++) {
      var item = critActs[ci];
      var photos = [item.photos[0], item.photos[1], item.photos[2]].filter(Boolean);
      var descW = wrap(item.action.description || item.question, CW - 14);
      var infoH = descW.length * 3 + 4 + 4 + 3 + 3;
      var photoH = photos.length > 0 ? 52 : 0;
      var cardH = infoH + photoH + 10;
      checkPage(cardH + 4);

      fill(254, 226, 226); doc.roundedRect(x0, y, CW, cardH, 2, 2, 'F');
      fill(220, 38, 38); doc.roundedRect(x0, y, 4, cardH, 1, 1, 'F');
      var cy = y + 4;
      size(8); bold(); color(60, 60, 60);
      var hd = item.sector + ' > ' + item.category;
      text(hd + ' [CRITICAL]', x0 + 6, cy);
      cy += 4;
      size(7); normal(); color(80, 80, 80);
      text(descW, x0 + 6, cy);
      cy += descW.length * 3 + 1;
      size(6); color(100, 100, 100);
      text('Resp: ' + (item.action.person || '—'), x0 + 6, cy); cy += 3;
      text('Status: ' + (item.action.status || 'Open'), x0 + 6, cy); cy += 3;
      text('Action: ' + (item.action.actionNeeded || '—'), x0 + 50, cy - 3);
      text('Closed: ' + (item.action.closedOn || '—'), x0 + 50, cy);

      if (photos.length > 0) {
        var px = x0 + 6;
        var py = cy + 2;
        for (var pi = 0; pi < photos.length; pi++) {
          if (px + 72 > x1) break;
          try { await addPhotoToDoc(doc, photos[pi], px, py, 72, 48); } catch(e) {}
          px += 75;
        }
      }
      y += cardH + 4;
    }
  }

  // Non-critical actions
  if (nonCritActs.length > 0) {
    doc.addPage(); y = M;
    fill(245, 158, 11); doc.rect(0, 0, W, 14, 'F');
    color(255, 255, 255); size(12); bold();
    text('Action Items (' + nonCritActs.length + ')', x0, 10);
    y = 22;

    for (var ni = 0; ni < nonCritActs.length; ni++) {
      var nitem = nonCritActs[ni];
      var nphotos = [nitem.photos[0], nitem.photos[1], nitem.photos[2]].filter(Boolean);
      var ndescW = wrap(nitem.action.description || nitem.question, CW - 14);
      var ninfoH = ndescW.length * 3 + 4 + 4 + 3 + 3;
      var nphotoH = nphotos.length > 0 ? 52 : 0;
      var ncardH = ninfoH + nphotoH + 10;
      checkPage(ncardH + 4);

      fill(255, 251, 235); doc.roundedRect(x0, y, CW, ncardH, 2, 2, 'F');
      var ncy = y + 4;
      size(8); bold(); color(60, 60, 60);
      var nhd = nitem.sector + ' > ' + nitem.category;
      text(nhd, x0 + 6, ncy);
      ncy += 4;
      size(7); normal(); color(80, 80, 80);
      text(ndescW, x0 + 6, ncy);
      ncy += ndescW.length * 3 + 1;
      size(6); color(100, 100, 100);
      text('Resp: ' + (nitem.action.person || '—'), x0 + 6, ncy); ncy += 3;
      text('Status: ' + (nitem.action.status || 'Open'), x0 + 6, ncy); ncy += 3;
      text('Action: ' + (nitem.action.actionNeeded || '—'), x0 + 50, ncy - 3);
      text('Closed: ' + (nitem.action.closedOn || '—'), x0 + 50, ncy);

      if (nphotos.length > 0) {
        var npx = x0 + 6;
        var npy = ncy + 2;
        for (var npi = 0; npi < nphotos.length; npi++) {
          if (npx + 72 > x1) break;
          try { await addPhotoToDoc(doc, nphotos[npi], npx, npy, 72, 48); } catch(e) {}
          npx += 75;
        }
      }
      y += ncardH + 4;
    }
  }

  // ============================
  // PAGE — Comments & Evidence
  // ============================
  var comments = auditCollectAllComments();

  if (comments.withPhotos.length > 0) {
    doc.addPage(); y = M;
    fill(0, 140, 120); doc.rect(0, 0, W, 14, 'F');
    color(255, 255, 255); size(12); bold();
    text('Comments & Evidence (' + comments.withPhotos.length + ')', x0, 10);
    y = 22;

    for (var cwi = 0; cwi < comments.withPhotos.length; cwi++) {
      var cv = comments.withPhotos[cwi];
      var cPhotos = [cv.photoThumb, cv.extraPhotoThumb, cv.extraPhoto2Thumb].filter(Boolean);
      var cLines = cv.comment ? wrap(cv.comment, CW - 12) : [];
      var ctextH = 4 + 4 + 4 + cLines.length * 3;
      var cphotoH = cPhotos.length > 0 ? 52 : 0;
      var cCardH = ctextH + cphotoH + 8;
      checkPage(cCardH + 4);

      fill(248, 250, 252); doc.roundedRect(x0, y, CW, cCardH, 2, 2, 'F');
      var ccy = y + 4;
      size(7); bold(); color(0, 140, 120);
      text(cv.sector + ' > ' + cv.category, x0 + 6, ccy); ccy += 4;
      size(6); normal(); color(80, 80, 80);
      text(cv.question.substring(0, 100), x0 + 6, ccy); ccy += 4;
      if (cv.comment) {
        size(7); color(60, 60, 60);
        text(cLines, x0 + 6, ccy);
        ccy += cLines.length * 3 + 1;
      }
      if (cPhotos.length > 0) {
        var cpx = x0 + 6;
        var cpy = ccy + 2;
        for (var cpi = 0; cpi < cPhotos.length; cpi++) {
          if (cpx + 72 > x1) break;
          try { await addPhotoToDoc(doc, cPhotos[cpi], cpx, cpy, 72, 48); } catch(e) {}
          cpx += 75;
        }
      }
      y += cCardH + 4;
    }
  }

  // Notes without photos
  if (comments.withoutPhotos.length > 0) {
    doc.addPage(); y = M;
    fill(100, 100, 100); doc.rect(0, 0, W, 14, 'F');
    color(255, 255, 255); size(12); bold();
    text('Notes (' + comments.withoutPhotos.length + ')', x0, 10);
    y = 22;

    for (var nti = 0; nti < comments.withoutPhotos.length; nti++) {
      var nt = comments.withoutPhotos[nti];
      var ntLines = nt.comment ? wrap(nt.comment, CW - 12) : [];
      var ntcH = 12 + ntLines.length * 3;
      checkPage(ntcH + 3);
      fill(248, 250, 252); doc.roundedRect(x0, y, CW, ntcH, 2, 2, 'F');
      size(7); bold(); color(0, 140, 120);
      text(nt.sector + ' > ' + nt.category, x0 + 6, y + 4);
      size(6); normal(); color(80, 80, 80);
      text(nt.question.substring(0, 80), x0 + 6, y + 8);
      if (nt.comment) {
        size(7); color(60, 60, 60);
        text(ntLines, x0 + 6, y + 12);
      }
      y += ntcH + 3;
    }
  }

  // ============================
  // PAGE — All Questions
  // ============================
  doc.addPage(); y = M;
  fill(0, 168, 142); doc.rect(0, 0, W, 14, 'F');
  color(255, 255, 255); size(12); bold();
  text('All Questions', x0, 10);
  y = 22;

  var tRows = [];
  auditSectorKeys().forEach(function(sid) {
    var sec = auditState.sectors[sid];
    sec.categories.forEach(function(cat) {
      cat.questions.forEach(function(q) {
        if (q.answer && q.answer !== 'N/A') {
          tRows.push([sec.title, cat.name, q.text.substring(0, 60), q.answer === 'Pass' ? 'P' : 'F', q.weight + '']);
        }
      });
    });
  });
  if (tRows.length > 0) {
    doc.autoTable({
      startY: y,
      head: [['Sector', 'Category', 'Question', 'Ans', 'Wt']],
      body: tRows,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [0, 168, 142], fontSize: 7, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: M, right: M },
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 30 }, 2: { cellWidth: 75 }, 3: { cellWidth: 10, halign: 'center' }, 4: { cellWidth: 10, halign: 'center' } }
    });
  }

  // Footer on all pages
  var pgCount = doc.internal.getNumberOfPages();
  for (var pg = 1; pg <= pgCount; pg++) {
    doc.setPage(pg);
    size(7); color(150, 150, 150); normal();
    text('Birds Bakery — Retail Audit — ' + new Date().toLocaleString('en-GB'), x0, H - 8);
    text('Page ' + pg + ' of ' + pgCount, x1, H - 8, { align: 'right' });
  }

  doc.save('audit_' + auditState.storeName.replace(/\s+/g, '_') + '_' + auditState.date + '.pdf');
}

async function addPhotoToDoc(doc, dataUrl, x, y, maxWmm, maxHmm) {
  if (!dataUrl) return 0;
  var targetWmm = maxWmm, targetHmm = maxHmm;
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var aspect = img.width / img.height;
      if (aspect > targetWmm / targetHmm) { targetHmm = targetWmm / aspect; }
      else { targetWmm = targetHmm * aspect; }
      var PX = 4;
      var canvasW = Math.round(targetWmm * PX);
      var canvasH = Math.round(targetHmm * PX);
      var c = document.createElement('canvas');
      c.width = canvasW; c.height = canvasH;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvasW, canvasH);
      try {
        var resized = c.toDataURL('image/jpeg', 0.95);
        doc.addImage(resized, 'JPEG', x, y, targetWmm, targetHmm);
        resolve(targetHmm);
      } catch(e) { console.warn('[PDF] addImage failed:', e.message); resolve(0); }
    };
    img.onerror = function() { console.warn('[PDF] Image load failed'); resolve(0); };
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
    if (!_auditQB) {
      alert('Question bank not loaded yet — please wait for AuditQuestions.json to load, then try again.');
      return;
    }
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
        var match = relativePath.match(/^([^_]+)_(.+)_([^_]+)(?:_(extra|extra2))?\.\w+$/i);
        if (!match) return;
        var sectorId = match[1];
        // catId may contain underscores, qId is the last segment before _extra
        // Re-parse: sectorId is first token, everything between first _ and last _FXX is catId
        var parts = relativePath.replace(/\.\w+$/, '').split('_');
        // Find the question ID pattern (starts with F or is a number)
        var qIdIdx = -1;
        for (var pi = parts.length - 1; pi >= 1; pi--) {
          if (/^[a-zA-Z0-9]+$|^extra$|^extra2$/i.test(parts[pi])) { qIdIdx = pi; break; }
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
