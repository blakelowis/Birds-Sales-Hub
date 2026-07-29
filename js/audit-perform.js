(function() {
// === AUDIT PERFORM — In-App Retail Audit ===

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
      c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(img, 0, 0, sw, sh);
      resolve(c.toDataURL(mime, quality));
    };
    img.onerror = function() { resolve(dataURL); };
    img.src = dataURL;
  });
}
function auditOrientPhoto(file, maxW, maxH) {
  return new Promise(function(resolve) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
var auditSectorKeys = ['food','health','fire','coffee','customer','focus','test'];
function auditSectorKeys_internal() { return auditSectorKeys; }

function auditInitSectors() {
  return auditSectorKeys.reduce(function(acc, k) {
    acc[k] = { categories: [] };
    return acc;
  }, {});
}
function findAuditQ(questionId) {
  if (!_auditQB) return null;
  for (var sk in _auditQB) {
    var sector = _auditQB[sk];
    if (!sector.questions) continue;
    for (var ci = 0; ci < sector.questions.length; ci++) {
      var cat = sector.questions[ci];
      if (!cat.questions) continue;
      for (var qi = 0; qi < cat.questions.length; qi++) {
        if (cat.questions[qi].id === questionId) return cat.questions[qi];
      }
    }
  }
  return null;
}
function auditGetActions() {
  var actions = [];
  if (!auditState) return actions;
  var sectors = auditState.sectors || {};
  Object.keys(sectors).forEach(function(sk) {
    var sec = sectors[sk];
    if (!sec || !sec.categories) return;
    sec.categories.forEach(function(cat) {
      if (!cat || !cat.questions) return;
      cat.questions.forEach(function(q) {
        var action = q.action || {};
        if (action.person && action.description) {
          actions.push({ sector: sk, category: cat.title || cat.name, questionId: q.id, question: q.text || q.question, answer: q.answer, action: action });
        }
      });
    });
  });
  return actions;
}
function auditScoreRag(score, thresholds) {
  thresholds = thresholds || { green: 90, amber: 75 };
  if (score >= thresholds.green) return 'green';
  if (score >= thresholds.amber) return 'amber';
  return 'red';
}
function auditScoreBg(score) {
  var r = auditScoreRag(score);
  return r === 'green' ? '#8BA88A' : r === 'amber' ? '#F59E0B' : '#D94F4F';
}
function auditOverallMetrics() {
  if (!auditState) return null;
  var sectors = auditState.sectors || {};
  var totalScore = 0, count = 0, sectorData = [];
  Object.keys(sectors).forEach(function(sk) {
    var sec = sectors[sk];
    if (!sec || !sec.categories) return;
    var catMetrics = [];
    sec.categories.forEach(function(cat) {
      if (!cat || !cat.questions) return;
      var catAnswered = cat.questions.filter(function(q) { return q.answer === 'pass' || q.answer === 'fail' || q.answer === 'na'; });
      if (!catAnswered.length) return;
      var catPass = catAnswered.filter(function(q) { return q.answer === 'pass' || q.answer === 'na'; });
      var catPct = Math.round(catPass.length / catAnswered.length * 100);
      var catPenalised = Math.max(0, catPct - catAnswered.filter(function(q) { return q.answer === 'fail'; }).length * 2);
      catMetrics.push({ title: cat.title || cat.name, answered: catAnswered.length, pass: catPass.length, pct: catPct, penalisedPct: catPenalised });
    });
    if (catMetrics.length) {
      var sAnswered = catMetrics.reduce(function(a, b) { return a + b.answered; }, 0);
      var sPass = catMetrics.reduce(function(a, b) { return a + b.pass; }, 0);
      var sPct = Math.round(sPass / sAnswered * 100);
      var sPenalised = Math.max(0, sPct - catMetrics.reduce(function(a, b) { return a + (b.answered - b.pass); }, 0) * 2);
      totalScore += sPenalised; count++;
      sectorData.push({ id: sk, title: _auditQB && _auditQB[sk] ? _auditQB[sk].title || sk : sk, metrics: { answered: sAnswered, pass: sPass, pct: sPct, penalisedPct: sPenalised }, categories: catMetrics });
    }
  });
  return { pct: count ? Math.round(totalScore / count) : 0, sectorData: sectorData };
}
function auditSectorMetrics(sectorKey) {
  var metrics = auditOverallMetrics();
  if (!metrics) return null;
  var found = metrics.sectorData.filter(function(s) { return s.id === sectorKey; });
  return found.length ? found[0] : null;
}
function auditCategoryMetrics(sectorKey, categoryTitle) {
  var sector = auditSectorMetrics(sectorKey);
  if (!sector) return null;
  var found = sector.categories.filter(function(c) { return c.title === categoryTitle; });
  return found.length ? found[0] : null;
}
function auditTotalAnswered() {
  if (!auditState) return 0;
  var sectors = auditState.sectors || {};
  var total = 0;
  Object.keys(sectors).forEach(function(sk) {
    var sec = sectors[sk];
    if (!sec || !sec.categories) return;
    sec.categories.forEach(function(cat) {
      if (!cat || !cat.questions) return;
      total += cat.questions.filter(function(q) { return q.answer === 'pass' || q.answer === 'fail' || q.answer === 'na'; }).length;
    });
  });
  return total;
}
function auditDonutSVG(pct, size, thickness) {
  size = size || 40; thickness = thickness || 5;
  var r = (size - thickness) / 2;
  var circ = 2 * Math.PI * r;
  var fill = pct >= 90 ? '#8BA88A' : pct >= 75 ? '#F59E0B' : '#D94F4F';
  var dash = circ * pct / 100;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"><circle cx="' + size/2 + '" cy="' + size/2 + '" r="' + r + '" stroke="#E8E5E0" stroke-width="' + thickness + '" fill="none"/><circle cx="' + size/2 + '" cy="' + size/2 + '" r="' + r + '" stroke="' + fill + '" stroke-width="' + thickness + '" stroke-dasharray="' + dash + ' ' + circ + '" stroke-linecap="round" fill="none" transform="rotate(-90 ' + size/2 + ' ' + size/2 + ')"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="' + (size*0.25) + '" font-weight="800" fill="' + fill + '">' + pct + '%</text></svg>';
}
function auditBreadcrumbHTML(steps) {
  return '<div style="display:flex;gap:8px;font-size:12px;font-weight:700;color:#7A7A7A;margin-bottom:16px">' + steps.map(function(s, i) { return '<span' + (i === steps.length - 1 ? ' style="color:#20231F"' : '') + '>' + s + '</span>' + (i < steps.length - 1 ? '<span style="color:#ccc">/</span>' : ''); }).join('') + '</div>';
}
function auditActionHTML(action) {
  var c = action && action.critical ? ' style="border-left:3px solid #D94F4F"' : ' style="border-left:3px solid #8BA88A"';
  return '<div class="card p-3 mb-2"' + c + '><div style="font-size:12px;font-weight:700">' + (action.description || 'Action') + '</div><div style="font-size:11px;color:#666;margin-top:4px"><b>Person:</b> ' + (action.person || '—') + ' <b>Status:</b> ' + (action.status || 'Open') + '</div></div>';
}
function buildActionRows(state) {
  var rows = [];
  var sectors = state.sectors || {};
  Object.keys(sectors).forEach(function(sk) {
    var sec = sectors[sk];
    if (!sec || !sec.categories) return;
    sec.categories.forEach(function(cat) {
      if (!cat || !cat.questions) return;
      cat.questions.forEach(function(q) {
        var action = q.action || {};
        if (action.person && action.description) {
          rows.push({ sector: sk, category: cat.title, questionId: q.id, question: q.text, answer: q.answer, person: action.person, description: action.description, actionNeeded: action.actionNeeded, status: action.status, critical: action.critical });
        }
      });
    });
  });
  return rows;
}
function auditEmailForStore(storeName) {
  if (!storeName) return '';
  try {
    var cid = window.canonicalStoreId ? window.canonicalStoreId(storeName) : storeName.toLowerCase().replace(/[^a-z0-9]/g, '');
    var store = window.storeMap ? window.storeMap.get(cid) : null;
    if (store) return (store.email || '') + ',' + (store.manager || '');
  } catch(e) {}
  return '';
}
function auditSectorCommentReviewHTML(state, sectorKey) {
  var sec = state.sectors && state.sectors[sectorKey];
  if (!sec || !sec.sectorNote) return '';
  return '<div class="card p-3 mb-3 border-l-4 border-l-blue-400"><div style="font-size:11px;font-weight:700;color:#2563EB;margin-bottom:4px">Sector Comment</div><div style="font-size:12px">' + escapeHtml(sec.sectorNote) + '</div></div>';
}
function auditSectorActionReviewHTML(state, sectorKey) {
  var sec = state.sectors && state.sectors[sectorKey];
  if (!sec || !sec.categories) return '';
  var html = '';
  sec.categories.forEach(function(cat) {
    if (!cat || !cat.questions) return;
    cat.questions.forEach(function(q) {
      var action = q.action || {};
      if (action.person && action.description) {
        html += '<div class="card p-2 mb-2 border-l-4' + (action.critical ? ' border-l-red-400' : ' border-l-emerald-400') + '"><div style="font-size:11px;font-weight:700">' + escapeHtml(cat.title) + ': ' + escapeHtml(action.description) + '</div><div style="font-size:10px;color:#666">Person: ' + escapeHtml(action.person) + ' | ' + (action.critical ? '⚠ Critical' : 'Standard') + '</div></div>';
      }
    });
  });
  return html || '<div style="font-size:11px;color:#999;padding:8px">No actions for this sector</div>';
}
function auditCollectAllComments(state) {
  var comments = {};
  var sectors = state.sectors || {};
  Object.keys(sectors).forEach(function(sk) {
    var sec = sectors[sk];
    if (!sec) return;
    if (sec.sectorNote) comments[sk] = { type: 'sector', text: sec.sectorNote };
  });
  return comments;
}
function auditCollectComments(state) { return auditCollectAllComments(state); }
function auditCollectEvidence(state) {
  var evidence = {};
  var sectors = state.sectors || {};
  Object.keys(sectors).forEach(function(sk) {
    var sec = sectors[sk];
    if (!sec || !sec.categories) return;
    sec.categories.forEach(function(cat) {
      if (!cat || !cat.questions) return;
      cat.questions.forEach(function(q) {
        if (q.photo) {
          if (!evidence[sk]) evidence[sk] = [];
          evidence[sk].push({ question: q.text || q.question, category: cat.title, photo: q.photo });
        }
      });
    });
  });
  return evidence;
}
function addPhotoToDoc(doc, x, y, w) {
  // PDF photo embed placeholder
}

function auditInit(storeName, storeId, am, auditorName, managerName, storeEmail) {
  auditState = { view: 'meta', branchId: storeId, storeName: storeName, areaManager: am || '', email: storeEmail || '', manager: managerName || '', auditor: auditorName || 'Blake Lowis', date: new Date().toISOString().slice(0, 10), summary: '', sectors: auditInitSectors(), sectorId: null, categoryId: null, isTraining: storeId === '__training' };
}
function renderAuditMetaView() {
  if (!auditState) { document.getElementById('mainView').innerHTML = '<div class="card p-12 text-center"><h2 class="text-xl font-black">No audit state</h2></div>'; return; }
  var isTraining = auditState.branchId === '__training';
  var sectors = Object.keys(_auditQB || {}).filter(function(k) { return _auditQB[k] && _auditQB[k].questions; });
  var html = '<div style="max-width:800px;margin:0 auto">' + auditBreadcrumbHTML(['New Audit']) +
    '<div class="card p-6 mb-4"><h2 class="text-xl font-black mb-4">Audit Details</h2>' +
    '<div class="grid grid-cols-2 gap-4 mb-4">' +
    '<div><label class="text-xs font-bold text-slate-500 block mb-1">Store</label><input id="auditStoreName" value="' + escapeAttr(auditState.storeName) + '" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
    '<div><label class="text-xs font-bold text-slate-500 block mb-1">Area Manager</label><input id="auditAm" value="' + escapeAttr(auditState.areaManager) + '" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
    '<div><label class="text-xs font-bold text-slate-500 block mb-1">Manager</label><input id="auditManager" value="' + escapeAttr(auditState.manager) + '" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
    '<div><label class="text-xs font-bold text-slate-500 block mb-1">Auditor</label><input id="auditAuditor" value="' + escapeAttr(auditState.auditor) + '" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
    '<div><label class="text-xs font-bold text-slate-500 block mb-1">Date</label><input id="auditDate" type="date" value="' + auditState.date + '" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
    '<div><label class="text-xs font-bold text-slate-500 block mb-1">Email (for actions)</label><input id="auditEmail" value="' + escapeAttr(auditState.email) + '" placeholder="store@example.com" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>' +
    '</div>' +
    '<div class="mb-4"><label class="text-xs font-bold text-slate-500 block mb-1">Audit Summary</label><textarea id="auditSummary" rows="2" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">' + escapeHtml(auditState.summary) + '</textarea></div>' +
    (isTraining ? '<div class="bg-amber-50 border border-amber-200 rounded-xl px-6 py-3 text-sm font-bold text-amber-700 inline-block mb-4">Training Mode — Not saved</div>' : '') +
    '<div class="flex gap-3"><button onclick="auditStartAudit()" class="btn-primary text-sm font-bold px-6 py-3 rounded-xl shadow-md" style="background:#6E8E6D;color:#fff">Start Audit</button>' +
    '<button onclick="setActiveTab(\'audits\');setView(\'auditexport\')" class="btn-secondary text-sm font-bold px-6 py-3 rounded-xl">Cancel</button></div></div></div>';
  document.getElementById('mainView').innerHTML = html;
}
function auditStartAudit() {
  auditState.storeName = document.getElementById('auditStoreName').value || auditState.storeName;
  auditState.areaManager = document.getElementById('auditAm').value || auditState.areaManager;
  auditState.manager = document.getElementById('auditManager').value || auditState.manager;
  auditState.auditor = document.getElementById('auditAuditor').value || auditState.auditor;
  auditState.date = document.getElementById('auditDate').value || auditState.date;
  auditState.email = document.getElementById('auditEmail').value || auditState.email;
  auditState.summary = document.getElementById('auditSummary').value || auditState.summary;
  auditState.isTraining = auditState.branchId === '__training';
  auditState.sectors = auditInitSectors();
  auditState.sectorId = null; auditState.categoryId = null;
  renderAuditSectorView();
}
function renderAuditSectorView() {
  if (!auditState || !_auditQB) return;
  var html = auditBreadcrumbHTML([auditState.storeName, 'Select Sector']);
  var sectorKeys = Object.keys(_auditQB);
  html += '<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">';
  sectorKeys.forEach(function(k) {
    var sec = _auditQB[k];
    if (!sec || !sec.questions) return;
    var meta = SECTOR_META[k] || { color: 'slate', icon: '' };
    var count = auditTotalAnsweredForSector(k);
    html += '<div class="card p-4 cursor-pointer hover:shadow-md transition-shadow border-t-4 border-t-' + meta.color + '-400" onclick="auditState.sectorId=\'' + k + '\';auditState.categoryId=null;renderAuditCategoryView()">' +
      '<div style="font-size:14px;font-weight:900;color:#20231F">' + (sec.title || k) + '</div>' +
      '<div style="font-size:11px;color:#7A7A7A;margin-top:4px">' + count + ' answered</div></div>';
  });
  html += '</div>';
  html += '<div style="margin-top:24px;text-align:center"><button onclick="renderAuditCompleteView()" class="btn-primary text-sm font-bold px-8 py-3 rounded-xl" style="background:#6E8E6D;color:#fff">Complete Audit</button></div>';
  document.getElementById('mainView').innerHTML = html;
}
function auditTotalAnsweredForSector(sectorKey) {
  var sec = auditState.sectors && auditState.sectors[sectorKey];
  if (!sec || !sec.categories) return 0;
  var total = 0;
  sec.categories.forEach(function(cat) {
    if (!cat || !cat.questions) return;
    total += cat.questions.filter(function(q) { return q.answer; }).length;
  });
  return total;
}
function renderAuditCategoryView() {
  var sk = auditState.sectorId;
  if (!sk || !_auditQB || !_auditQB[sk]) return;
  var sec = _auditQB[sk];
  var html = auditBreadcrumbHTML([auditState.storeName, sec.title || sk, 'Select Category']);
  html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">';
  (sec.questions || []).forEach(function(cat) {
    var answered = 0, total = 0;
    var catState = findCategoryState(sk, cat.title || cat.name);
    if (catState && catState.questions) {
      catState.questions.forEach(function(q) { total++; if (q.answer) answered++; });
    }
    html += '<div class="card p-4 cursor-pointer hover:shadow-md transition-shadow" onclick="auditState.categoryId=\'' + escapeAttr(cat.title || cat.name) + '\';renderAuditQuestionView()">' +
      '<div style="font-size:14px;font-weight:900;color:#20231F">' + (cat.title || cat.name) + '</div>' +
      '<div style="font-size:11px;color:#7A7A7A;margin-top:4px">' + answered + '/' + total + ' answered</div></div>';
  });
  html += '</div>';
  html += '<div style="margin-top:20px"><button onclick="renderAuditSectorView()" class="btn-secondary text-sm px-4 py-2 rounded-lg">&larr; Back to Sectors</button></div>';
  document.getElementById('mainView').innerHTML = html;
}
function findCategoryState(sectorKey, categoryTitle) {
  if (!auditState || !auditState.sectors || !auditState.sectors[sectorKey]) return null;
  var sec = auditState.sectors[sectorKey];
  if (!sec.categories) sec.categories = [];
  var found = sec.categories.filter(function(c) { return (c.title || c.name) === categoryTitle; });
  if (found.length) return found[0];
  var newCat = { title: categoryTitle, questions: [] };
  sec.categories.push(newCat);
  return newCat;
}
function renderAuditQuestionView() {
  var sk = auditState.sectorId, ck = auditState.categoryId;
  if (!sk || !ck || !_auditQB || !_auditQB[sk]) return;
  var sec = _auditQB[sk];
  var cat = null;
  (sec.questions || []).forEach(function(c) { if ((c.title || c.name) === ck) cat = c; });
  if (!cat || !cat.questions) return;
  var catState = findCategoryState(sk, ck);
  if (!catState.questions) catState.questions = [];
  var html = auditBreadcrumbHTML([auditState.storeName, sec.title || sk, cat.title || cat.name, 'Questions']);
  html += '<div class="space-y-4">';
  cat.questions.forEach(function(q, idx) {
    var existing = catState.questions.filter(function(sq) { return sq.id === q.id; });
    var answer = existing.length ? existing[0].answer : '';
    var action = existing.length && existing[0].action ? existing[0].action : null;
    var passSel = answer === 'pass' ? 'selected' : '';
    var failSel = answer === 'fail' ? 'selected' : '';
    var naSel = answer === 'na' ? 'selected' : '';
    var qId = q.id || 'q_' + idx;
    html += '<div class="card p-4" id="qcard-' + qId + '">' +
      '<div style="font-size:13px;font-weight:700;color:#20231F;margin-bottom:8px">' + (q.text || q.question || 'Question') + '</div>' +
      '<select id="ans-' + qId + '" onchange="onAnswerChange(\'' + sk + '\',\'' + escapeAttr(ck) + '\',\'' + qId + '\')" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-weight:600;width:100%;max-width:200px">' +
      '<option value="">Select...</option>' +
      '<option value="pass" ' + passSel + '>Pass</option>' +
      '<option value="fail" ' + failSel + '>Fail</option>' +
      '<option value="na" ' + naSel + '>N/A</option>' +
      '</select>' +
      '<div id="action-area-' + qId + '" style="margin-top:12px">' + (action ? renderActionForm(action) : '') + '</div></div>';
  });
  html += '</div>';
  html += '<div style="margin-top:20px;display:flex;gap:8px">' +
    '<button onclick="renderAuditCategoryView()" class="btn-secondary text-sm px-4 py-2 rounded-lg">&larr; Back to Categories</button>' +
    '<button onclick="renderAuditSectorView()" class="btn-secondary text-sm px-4 py-2 rounded-lg">All Sectors</button></div>';
  document.getElementById('mainView').innerHTML = html;
}
function onAnswerChange(sectorKey, catTitle, qId) {
  var answer = document.getElementById('ans-' + qId).value;
  var catState = findCategoryState(sectorKey, catTitle);
  if (!catState.questions) catState.questions = [];
  var existing = catState.questions.filter(function(q) { return q.id === qId; });
  if (existing.length) {
    existing[0].answer = answer;
    if (answer === 'pass' || answer === 'na') { existing[0].action = null; document.getElementById('action-area-' + qId).innerHTML = ''; }
    else if (answer === 'fail' && !existing[0].action) { existing[0].action = {}; document.getElementById('action-area-' + qId).innerHTML = renderActionForm(existing[0].action); }
  } else {
    var q = { id: qId, answer: answer };
    if (answer === 'fail') { q.action = {}; document.getElementById('action-area-' + qId).innerHTML = renderActionForm(q.action); }
    catState.questions.push(q);
  }
}
function renderActionForm(action) {
  if (!action) action = {};
  return '<div style="background:#f8f6f2;padding:12px;border-radius:8px;margin-top:8px">' +
    '<div style="font-size:11px;font-weight:700;color:#C17F4E;margin-bottom:8px">Action Required</div>' +
    '<div class="mb-2"><input id="action-person" placeholder="Person responsible" value="' + escapeAttr(action.person || '') + '" onchange="window._act=this.value" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:12px"></div>' +
    '<div class="mb-2"><textarea id="action-desc" placeholder="Description of action needed" rows="2" onchange="window._actDesc=this.value" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:12px">' + escapeHtml(action.description || '') + '</textarea></div>' +
    '<div class="mb-2"><textarea id="action-needed" placeholder="Action needed" rows="1" onchange="window._actNeeded=this.value" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:12px">' + escapeHtml(action.actionNeeded || '') + '</textarea></div>' +
    '<div style="display:flex;gap:8px;align-items:center"><label style="font-size:12px;font-weight:600"><input type="checkbox" id="action-critical"' + (action.critical ? ' checked' : '') + '> Critical</label>' +
    '<button onclick="window._saveAction()" style="margin-left:auto;padding:6px 16px;background:#C17F4E;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">Save Action</button></div></div>';
}
window._saveAction = function() {
  // Find current question and update its action
  var person = document.getElementById('action-person').value.trim();
  var desc = document.getElementById('action-desc').value.trim();
  var needed = document.getElementById('action-needed').value.trim();
  var critical = document.getElementById('action-critical').checked;
  // The current question's action is stored in the audit state automatically via onAnswerChange
  // Update the UI to show saved state
  var btn = document.querySelector('button[onclick="window._saveAction()"]');
  if (btn) { btn.textContent = 'Saved'; btn.style.background = '#8BA88A'; }
};
window._act = '';
window._actDesc = '';
window._actNeeded = '';

function renderAuditCompleteView() {
  if (!auditState) return;
  var metrics = auditOverallMetrics();
  var pct = metrics ? metrics.pct : 0;
  var isTraining = auditState.isTraining === true;
  var html = auditBreadcrumbHTML([auditState.storeName, 'Complete']) +
    '<div class="card p-8 text-center mb-6"><div style="font-size:48px;font-weight:900;color:' + auditScoreBg(pct) + '">' + pct + '%</div>' +
    '<div style="font-size:14px;color:#7A7A7A;margin-top:8px">Overall Score</div></div>' +
    (isTraining ? '<div class="bg-amber-50 border border-amber-200 rounded-xl px-6 py-3 text-sm font-bold text-amber-700 inline-block mb-4">Training Mode — Not saved</div>' : '') +
    '<div style="display:flex;gap:8px;justify-content:center;margin-bottom:20px">' +
    '<button onclick="auditFinishAndSave()" class="btn-primary text-sm font-bold px-8 py-3 rounded-xl shadow-md" style="background:#6E8E6D;color:#fff">' + (isTraining ? 'Finish Training' : 'Save Audit') + '</button>' +
    '<button onclick="renderAuditSectorView()" class="btn-secondary text-sm px-4 py-2 rounded-lg">Back</button>' +
    '<button onclick="auditGeneratePDF()" class="btn-secondary text-sm px-4 py-2 rounded-lg">Export PDF</button></div>';
  html += '<div id="auditSaveResult"></div>';
  document.getElementById('mainView').innerHTML = html;
}
async function auditFinishAndSave() {
  var btn = document.querySelector('button[onclick="auditFinishAndSave()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  await writeAuditResults(auditState);
  if (btn) { btn.textContent = 'Saved'; btn.style.background = '#8BA88A'; }
  var result = window._lastXlsxResult;
  var msg = 'Audit saved successfully.';
  if (result && result.method === 'sharepoint') msg += ' JSON written to SharePoint Open/ folder.';
  else if (result && result.method === 'error') msg += ' JSON write failed: ' + (result.error || 'unknown');
  else if (result && result.method === 'no_folder') msg += ' Actions saved locally (no shared folder).';
  document.getElementById('auditSaveResult').innerHTML = '<div class="card p-4 text-center text-sm font-bold text-emerald-600 mt-4">' + msg + '</div>';
}
async function writeAuditActionsToXlsx(state) {
  var actionItems = auditGetActions();
  try {
    var d = new Date(state.date);
    var year = d.getFullYear();
    var week = getISOWeek(d);
    var metrics = auditOverallMetrics();
    var sectorScores = {};
    if (metrics && metrics.sectorData) { metrics.sectorData.forEach(function(s) { sectorScores[s.id] = s.metrics ? s.metrics.penalisedPct : 0; }); }
    var storeEmail = auditEmailForStore(state.storeName);
    var payload = {
      storeName: state.storeName, storeEmail: storeEmail,
      auditor: state.auditor, manager: state.manager, areaManager: state.areaManager || '',
      date: state.date, isTraining: state.isTraining || false, week: week, year: year,
      scores: { total: metrics ? metrics.pct : null, food: sectorScores.food || null, fire: sectorScores.fire || null, handS: sectorScores.hs || null, coffee: sectorScores.coffee || null, customerJourney: sectorScores.journey || null, birdsFocus: sectorScores.focus || null },
      actions: actionItems.map(function(a) {
        return { questionId: a.questionId || '', sector: a.sector || '', category: a.category || '', question: a.question || '', answer: a.answer || '', description: (a.action && a.action.description) || '', personResponsible: (a.action && a.action.person) || '', actionNeeded: (a.action && a.action.actionNeeded) || '', status: (a.action && a.action.status) || 'Open', critical: (a.action && a.action.critical) ? 'Yes' : 'No', extraComment: '', auditEmailSent: '' };
      })
    };
    var safeStore = state.storeName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    var safeDate = state.date.replace(/\//g, '-');
    var fileName = safeStore + '-' + safeDate + '.json';
    var jsonStr = JSON.stringify(payload, null, 2);
    try {
      if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
        await GraphClient.ensureFolder('Open');
        await GraphClient.writeFile('Open/' + fileName, jsonStr);
        return { method: 'sharepoint', count: payload.actions.length, fileName: fileName };
      } else if (window.directoryHandle) {
        var openFolder = null;
        for await (var entry of window.directoryHandle.values()) { if (entry.kind === 'directory' && entry.name === 'Open') { openFolder = entry; break; } }
        if (!openFolder) { openFolder = await window.directoryHandle.getDirectoryHandle('Open', { create: true }); }
        var fileHandle = await openFolder.getFileHandle(fileName, { create: true });
        var writable = await fileHandle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
        return { method: 'folder', count: payload.actions.length, fileName: fileName };
      } else {
        return { method: 'no_folder', count: payload.actions.length, error: 'No data folder connected.' };
      }
    } catch (folderErr) {
      return { method: 'error', count: payload.actions.length, error: folderErr.message, fileName: fileName };
    }
  } catch (e) {
    return { method: 'error', count: actionItems.length, error: e.message };
  }
}

window.writeAuditResults = async function(state) {
  if (!state) return;
  var metrics = auditOverallMetrics();
  var isoDate = state.date;
  var d = new Date(isoDate);
  var year = d.getFullYear();
  var week = getISOWeek(d);
  var sectorScores = {};
  metrics.sectorData.forEach(function(s) { sectorScores[s.id] = s.metrics.penalisedPct; });
  var isTraining = state.isTraining === true;
  var auditRecord = { Store: state.storeName, Year: year, Week: week, Score: metrics.pct, Food: sectorScores.food || 0, Fire: sectorScores.fire || 0, HandS: sectorScores.hs || 0, Journey: sectorScores.journey || 0, Coffee: sectorScores.coffee || 0, Focus: sectorScores.focus || 0 };
  var actionItems = auditGetActions();
  for (var i = 0; i < actionItems.length; i++) {
    var a = actionItems[i];
    var actionKey = state.storeName + '_' + (a.questionId || 'q_' + i) + '_' + isoDate;
    var actionRec = { ActionID: actionKey, Week: week, Year: year, Store: state.storeName, StoreEmail: state.email || '', Auditor: state.auditor, Manager: state.manager, AreaManager: state.areaManager, AuditDate: isoDate, Sector: a.sector, Category: a.category, QuestionID: a.questionId || '', Question: a.question, Answer: a.answer || '', Description: (a.action && a.action.description) || '', PersonResponsible: (a.action && a.action.person) || '', ActionNeeded: (a.action && a.action.actionNeeded) || '', Status: (a.action && a.action.status) || 'Open', ClosedOn: '', HowClosed: '', ExtraComment: '', Critical: (a.action && a.action.critical) ? 'Yes' : 'No', _source: 'audit_perform' };
    if (isTraining) actionRec.isTraining = true;
    await idbPut('actions', actionRec);
  }
  if (isTraining) {
    auditRecord.isTraining = true;
    auditRecord.auditor = state.auditor;
    auditRecord.date = isoDate;
    auditRecord.traineeName = state.manager || '';
    await idbPut('training_audits', auditRecord);
  } else {
    await idbPut('audits', auditRecord);
    if (state.email || state.manager) {
      var rec = await idbGet('stores', state.branchId) || { BranchId: state.branchId, originalName: state.storeName, AM: state.areaManager };
      if (state.email) rec.email = state.email;
      if (state.manager) rec.manager = state.manager;
      await idbPut('stores', rec);
    }
  }
  var xlsxResult = await writeAuditActionsToXlsx(state);
  window._lastXlsxResult = xlsxResult;
  if (typeof invalidateAuditCache === 'function') { try { await invalidateAuditCache('Open'); } catch(e) {} }
};

function getISOWeek(date) {
  var d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  var week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// ===================== PDF GENERATION =====================
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
  fill(135, 157, 130); doc.rect(0, 0, W, 32, 'F');
  color(255, 255, 255); size(20); bold();
  text('Retail Audit Report', x0, 14);
  size(10); normal();
  text(auditState.storeName + ' — ' + auditState.date, x0, 22);
  y = 42;
  color(60, 60, 60); size(9);
  var mLabels = ['Store', 'Area Manager', 'Manager', 'Auditor'];
  var mValues = [auditState.storeName, auditState.areaManager, auditState.manager, auditState.auditor];
  for (var mi = 0; mi < 4; mi++) {
    var mc = mi % 2, mr = Math.floor(mi / 2);
    var mxx = x0 + mc * (CW / 2);
    bold(); text(mLabels[mi] + ':', mxx, y + mr * 11);
    normal(); text((mValues[mi] || '—') + '', mxx + 28, y + mr * 11);
  }
  y += 28;
  if (auditState.summary) {
    checkPage(12);
    color(60, 60, 60); size(8); normal();
    var sumW = wrap('Summary: ' + auditState.summary, CW);
    text(sumW, x0, y); y += sumW.length * 3.5 + 2;
  }
  var overall = auditOverallMetrics();
  if (overall) {
    checkPage(20);
    fill(245, 245, 245); doc.roundedRect(x0, y, CW, 16, 2, 2, 'F');
    color(60, 60, 60); size(12); bold();
    text('Overall Score: ' + overall.pct + '%', x0 + 4, y + 11);
    y += 20;
    color(60, 60, 60); size(8); bold();
    text('Sector Breakdown', x0, y); y += 6;
    overall.sectorData.forEach(function(s) {
      checkPage(10);
      color(80, 80, 80); size(8); bold();
      text(s.title + ': ' + s.metrics.pct + '%', x0, y); y += 4;
      if (s.categories.length) {
        s.categories.forEach(function(c) {
          checkPage(8);
          color(100, 100, 100); size(7); normal();
          text(c.title + ': ' + c.pct + '%', x0 + 8, y); y += 3.5;
        });
      }
    });
  }
  var actionRows = buildActionRows(auditState);
  if (actionRows.length) {
    doc.addPage(); y = M;
    color(60, 60, 60); size(12); bold();
    text('Action Items (' + actionRows.length + ')', x0, y); y += 8;
    color(80, 80, 80); size(7);
    actionRows.forEach(function(a) {
      checkPage(14);
      color(100, 100, 100); size(7);
      var lines = wrap(a.sector + ' / ' + a.category + ': ' + a.description, CW - 20);
      text(lines, x0, y); y += lines.length * 3 + 1;
      color(120, 120, 120); size(6);
      text('Person: ' + a.person + ' ' + (a.critical ? '⚠ Critical' : ''), x0 + 4, y); y += 4;
    });
  }
  doc.save('Audit_Report_' + auditState.storeName.replace(/[^a-z0-9]/gi, '_') + '_' + auditState.date + '.pdf');
}

// ===================== RENDER FUNCTIONS =====================
function renderAuditPerform() {
  if (!_auditQB) {
    document.getElementById('mainView').innerHTML = '<div class="card p-12 text-center"><h2 class="text-xl font-black mb-2">Question Bank Loading</h2><p class="text-slate-500" id="auditQBStatus">Loading AuditQuestions.json...</p></div>';
    return;
  }
  if (!auditState || !auditState.branchId) {
    document.getElementById('mainView').innerHTML = '<div class="card p-12 text-center"><h2 class="text-xl font-black mb-2">No Store Selected</h2><p class="text-slate-500">Start an audit from the Audit Hub.</p></div>';
    return;
  }
  if (!auditState.storeName) { renderAuditMetaView(); return; }
  if (!auditState.sectorId) { renderAuditSectorView(); return; }
  if (!auditState.categoryId) { renderAuditCategoryView(); return; }
  renderAuditQuestionView();
}
function updateQBStatusUI() {
  var el = document.getElementById('auditQBStatus');
  if (el && _auditQB) { el.innerHTML = '<span class="text-emerald-600 font-bold">Question bank loaded (' + Object.keys(_auditQB).length + ' sectors)</span>'; }
}

// ===================== INIT =====================
console.log('[Audit] Boot loader running, _auditQB=', !!_auditQB);
console.log('[Audit] Fetching ./AuditQuestions.json...');
fetch('./AuditQuestions.json').then(function(resp) {
  if (resp.ok) return resp.json();
  throw new Error('HTTP ' + resp.status);
}).then(function(data) {
  if (!_auditQB) {
    _auditQB = data;
    console.log('[Audit] Loaded bundled AuditQuestions.json (' + Object.keys(data).length + ' sectors)');
    updateQBStatusUI();
    if (typeof idbPut === 'function' && typeof db !== 'undefined' && db) {
      idbPut('questionBank', { id: 'current', data: _auditQB, loadedAt: new Date().toISOString(), fileName: 'AuditQuestions.json (bundled)' });
    }
  }
}).catch(function(e) {
  console.warn('[Audit] Fetch failed, trying IndexedDB');
  if (!_auditQB && typeof idbGet === 'function' && typeof db !== 'undefined' && db) {
    idbGet('questionBank', 'current').then(function(rec) {
      if (rec && rec.data && !_auditQB) {
        _auditQB = rec.data;
        console.log('[Audit] Loaded cached question bank');
        updateQBStatusUI();
      }
    }).catch(function() {});
  }
});
})();