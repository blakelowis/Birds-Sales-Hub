/*  STORE VISIT QUESTIONNAIRE BUILDER v2
    Left sidebar: Objects + Question Types
    Scoring is an attachment layer, not a question type  */

function _getTplStores() {
  var set = new Set();
  for (var branches of Object.values(DEFAULT_AREA_MAPPING)) {
    branches.forEach(function(b) { set.add(b); });
  }
  if (originalStoreNames && originalStoreNames.size) {
    originalStoreNames.forEach(function(name) { set.add(name); });
  }
  set.add('Training');
  return Array.from(set).sort();
}

var TPL_OBJECTS = [
    { type: 'docheader', label: 'Document Header', icon: '\uD83D\uDCCB', desc: 'Title + name, date, job title etc.' },
    { type: 'section',   label: 'Section',         icon: '\u25A0',  desc: 'Section divider with name' },
    { type: 'pagebreak', label: 'Page Breaker',    icon: '\u2014',  desc: 'Visual page break' },
    { type: 'signoff',   label: 'Sign Off',        icon: '\u270E',  desc: 'Signature, name & date block' }
];

var TPL_QUESTION_TYPES = [
    { type: 'smalltext',   label: 'Small Text',   icon: 'Aa', desc: 'Short single-line answer' },
    { type: 'longtext',    label: 'Long Text',    icon: '\u00B6',  desc: 'Multi-line text area' },
    { type: 'number',      label: 'Number',       icon: '#',  desc: 'Numeric input' },
    { type: 'date',        label: 'Date',         icon: '\uD83D\uDCC5', desc: 'Date picker' },
    { type: 'yesno',       label: 'Yes / No',     icon: '\u2713',  desc: 'Two-button toggle' },
    { type: 'multichoice', label: 'Multi-choice',  icon: '\u25C9',  desc: 'Single selection from options' },
    { type: 'checkbox',    label: 'Multi-Select',  icon: '\u2611',  desc: 'Tick multiple options' },
    { type: 'table',       label: 'Table',        icon: '\u25A6',  desc: 'Rows and columns data grid' },
    { type: 'photo',       label: 'Photo Upload', icon: '\uD83D\uDCF7', desc: 'Camera or file upload' }
];

var TPL_SCORING_TYPES = [
    { value: 'none',       label: 'No scoring',       icon: '' },
    { value: 'rag',        label: 'RAG Rating',       icon: '\uD83D\uDEA6' },
    { value: 'score_1_10', label: 'Score (1\u201310)',     icon: '\u2605' },
    { value: 'passfail',   label: 'Pass / Fail',      icon: '\u2713' }
];

function _tplTypeToAnswerType(type) {
    var map = {
        'docheader': 'header', 'section': 'section', 'pagebreak': 'divider', 'signoff': 'signoff',
        'smalltext': 'text', 'longtext': 'textarea', 'number': 'number',
        'date': 'date', 'yesno': 'yesno', 'multichoice': 'multichoice',
        'checkbox': 'checkbox', 'table': 'table', 'photo': 'image'
    };
    return map[type] || 'text';
}

function _tplTypeLabel(type) {
    var all = TPL_OBJECTS.concat(TPL_QUESTION_TYPES);
    var m = all.find(function(o) { return o.type === type; });
    return m ? m.label : type;
}

function _answerTypeToLabel(at) {
    var map = { 'header': 'Document Header', 'section': 'Section', 'divider': 'Page Breaker', 'signoff': 'Sign Off',
        'text': 'Small Text', 'textarea': 'Long Text', 'number': 'Number',
        'date': 'Date', 'yesno': 'Yes / No', 'multichoice': 'Multi-choice',
        'checkbox': 'Multi-Select', 'table': 'Table', 'image': 'Photo Upload' };
    return map[at] || at;
}

async function _tplLoadTemplates() { return _loadFormTemplates(); }
async function _tplSaveTemplate(tmpl) { return _saveFormTemplate(tmpl); }
async function _tplDeleteTemplate(id) { return _deleteFormTemplate(id); }

async function _tplDuplicateTemplate(id) {
    var templates = await _tplLoadTemplates();
    var orig = templates.find(function(t) { return t.id === id; });
    if (!orig) return;
    var dup = JSON.parse(JSON.stringify(orig));
    dup.id = _uid('FTPL-');
    dup.name = orig.name + ' (Copy)';
    dup.created = new Date().toISOString().substring(0, 10);
    dup.fields.forEach(function(f) { f.id = _uid('field-'); });
    await _tplSaveTemplate(dup);
}

/* ═══════════════════════════════════════════════════════════════
   TEMPLATE LIBRARY
   ═══════════════════════════════════════════════════════════════ */

window.renderTemplateLibrary = async function() {
    var templates = await _tplLoadTemplates();
    var el = document.getElementById('mainView');
    var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
    var userDept = user ? user.department : '';

    if (!templates.length) {
        el.innerHTML = '<div class="card p-12 text-center border-t-4 border-t-birds-green">' +
            '<h2 class="text-2xl font-black text-slate-700 mb-2">No Visit Forms Yet</h2>' +
            '<p class="text-sm text-slate-400 mb-6 max-w-md mx-auto">Create scoring questionnaires for store visits \u2014 drag question types, attach scoring, and get auto-calculated summaries.</p>' +
            '<button onclick="setView(\'templatebuilder\')" class="btn-primary rounded-none text-lg px-8 py-3">+ Create Your First Form</button>' +
            '</div>';
        return;
    }

    /* Department filter */
    var tplDepts = [...new Set(templates.map(function(t) { return t.department || 'General'; }))].sort();
    var filterDept = window._currentDeptFilter || userDept || 'All';
    if (filterDept !== 'All' && tplDepts.indexOf(filterDept) === -1) filterDept = 'All';
    window._currentDeptFilter = filterDept;

    var deptFilterOpts = '<option value="All"' + (filterDept === 'All' ? ' selected' : '') + '>All Departments</option>';
    var seniorSet = {};
    if (typeof Users !== 'undefined' && Users.SENIOR_DEPARTMENTS) {
        Users.SENIOR_DEPARTMENTS.forEach(function(d) { seniorSet[d] = true; });
    }
    var seenSenior = false;
    tplDepts.forEach(function(d) {
        if (seniorSet[d] && !seenSenior) {
            deptFilterOpts += '<option disabled style="font-weight:800;color:#5a6577;background:#f1ede8;">── Senior Leadership ──</option>';
            seenSenior = true;
        }
        deptFilterOpts += '<option value="' + d + '"' + (filterDept === d ? ' selected' : '') + '>' + d + '</option>';
    });

    var filtered = filterDept === 'All' ? templates : templates.filter(function(t) {
        return (t.department || 'General') === filterDept;
    });

    var deptOptsList = tplDepts.filter(function(d) { return d !== 'All'; });
    var cards = filtered.map(function(t) {
        var allCount = t.fields ? t.fields.length : 0;
        var scoredCount = t.fields ? t.fields.filter(function(f) { return f.scoringType && f.scoringType !== 'none'; }).length : 0;
        var ragCount = t.fields ? t.fields.filter(function(f) { return f.scoringType === 'rag'; }).length : 0;
        var pfCount = t.fields ? t.fields.filter(function(f) { return f.scoringType === 'passfail'; }).length : 0;
        var created = t.created || '';
        var creatorName = t.creator || '';

        var typeBadges = '';
        if (scoredCount) typeBadges += '<span class="text-[10px] font-black px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">' + scoredCount + ' Scored</span>';
        if (ragCount) typeBadges += '<span class="text-[10px] font-black px-2 py-0.5 rounded" style="background:rgba(164,119,114,0.12);color:var(--edwardian-rose);border:1px solid rgba(164,119,114,0.25);">' + ragCount + ' RAG</span>';
        if (pfCount) typeBadges += '<span class="text-[10px] font-black px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">' + pfCount + ' Pass/Fail</span>';

        var metaLine = '';
        if (creatorName && created) metaLine = escapeHtml(creatorName) + ' \u2022 ' + created;
        else if (creatorName) metaLine = escapeHtml(creatorName);
        else metaLine = created || 'Unknown';

        var deptSelect = '<select onclick="event.stopPropagation()" onchange="window._tplChangeDept(\'' + t.id + '\',this.value)" class="text-[9px] font-bold px-1 py-0.5 rounded bg-slate-100 text-slate-500 border-0 cursor-pointer hover:bg-slate-200">' +
            deptOptsList.map(function(d) { return '<option value="' + escapeHtml(d) + '"' + ((t.department || 'General') === d ? ' selected' : '') + '>' + escapeHtml(d) + '</option>'; }).join('') +
            '</select>';

        return '<div class="card p-5 hover:shadow-lg transition-all group cursor-pointer border-t-2 border-t-birds-green" onclick="window._tplEdit(\'' + t.id + '\')">' +
            '<div class="flex items-start justify-between mb-3">' +
            '<div class="flex-1 min-w-0">' +
            '<h3 class="text-lg font-black text-slate-800 truncate">' + escapeHtml(t.name || 'Untitled') + '</h3>' +
            '<p class="text-xs text-slate-400 mt-0.5">' + escapeHtml(t.description || 'No description') + '</p>' +
            '<div class="mt-1">' + deptSelect + '</div>' +
            '</div>' +
            '<div class="flex gap-1 ml-2">' +
            '<button onclick="event.stopPropagation();window._tplFill(\'' + t.id + '\')" class="px-2 py-1 rounded text-[10px] font-bold bg-birds-green text-white hover:bg-emerald-800" title="Fill In">\u25B6 Fill</button>' +
            '<button onclick="event.stopPropagation();window._tplDuplicate(\'' + t.id + '\')" class="p-1.5 rounded bg-slate-50 text-slate-600 hover:bg-slate-100 text-xs" title="Duplicate">\u2398</button>' +
            '<button onclick="event.stopPropagation();window._tplDelete(\'' + t.id + '\')" class="p-1.5 rounded bg-red-50 text-red-600 hover:bg-red-100 text-xs" title="Delete">\u2715</button>' +
            '</div></div>' +
            '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">' + allCount + ' item' + (allCount !== 1 ? 's' : '') + '</span>' +
            typeBadges +
            '<span class="text-[10px] text-slate-400 ml-auto">' + metaLine + '</span>' +
            '</div></div>';
    }).join('');

    el.innerHTML = '<div class="flex items-center justify-between mb-6">' +
        '<div><h1 class="text-2xl font-black text-slate-800">Store Visit Forms</h1>' +
        '<p class="text-sm text-slate-400">' + filtered.length + ' form' + (filtered.length !== 1 ? 's' : '') + (filterDept !== 'All' ? ' in ' + filterDept : '') + '</p></div>' +
        '<div class="flex items-center gap-3">' +
        '<select id="tpl-dept-filter" onchange="window._currentDeptFilter=this.value;renderTemplateLibrary()" class="text-xs px-3 py-1.5 border border-slate-200 rounded-lg bg-white">' + deptFilterOpts + '</select>' +
        '<button onclick="setView(\'templatebuilder\')" class="btn-primary rounded-none">+ New Form</button>' +
        '</div></div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">' + cards + '</div>';
};

window._tplEdit = function(id) { window._tplBuilderEditId = id; setView('templatebuilder'); };
window._tplChangeDept = async function(id, newDept) {
    var all = await _tplLoadTemplates();
    var t = all.find(function(t) { return t.id === id; });
    if (!t) return;
    t.department = newDept;
    await _saveFormTemplates(all);
    showToast('Moved to ' + newDept, 'success');
    renderTemplateLibrary();
};
window._tplDuplicate = async function(id) { if (!confirm('Duplicate this form template?')) return; await _tplDuplicateTemplate(id); renderTemplateLibrary(); };
window._tplDelete = async function(id) { if (!confirm('Delete this form? This cannot be undone.')) return; await _tplDeleteTemplate(id); renderTemplateLibrary(); };
window._tplFill = function(id) { window._tplFillId = id; setView('templatefill'); };

/* ═══════════════════════════════════════════════════════════════
   FILL IN A TEMPLATE FORM
   ═══════════════════════════════════════════════════════════════ */

function _tplBuildScoringHtml(f, fieldId) {
    if (!f.scoringType || f.scoringType === 'none') return '';
    var h = '<div class="mt-2 pt-2 border-t border-amber-200">';
    if (f.scoringType === 'rag') {
        h += '<label class="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1 block">Scoring</label>';
        h += '<div class="flex gap-2">';
        ['Red','Amber','Green'].forEach(function(v) {
            h += '<button type="button" data-tplfield="' + fieldId + '" data-val="' + v + '" onclick="window._setRag(this)" class="px-4 py-1.5 rounded-lg text-xs font-black form-tpl-field form-tpl-rag transition-all bg-' + (v === 'Red' ? 'red' : v === 'Amber' ? 'amber' : 'emerald') + '-100 text-' + (v === 'Red' ? 'red' : v === 'Amber' ? 'amber' : 'emerald') + '-700 border-2 border-' + (v === 'Red' ? 'red' : v === 'Amber' ? 'amber' : 'emerald') + '-200 hover:bg-' + (v === 'Red' ? 'red' : v === 'Amber' ? 'amber' : 'emerald') + '-200">' + v + '</button>';
        });
        h += '<input type="hidden" data-tplfield="' + fieldId + '" value="" class="form-tpl-field">';
        h += '</div>';
    } else if (f.scoringType === 'score_1_10') {
        h += '<label class="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1 block">Scoring (1\u201310)</label>';
        h += '<div class="flex gap-1">';
        for (var s = 1; s <= 10; s++) {
            h += '<button type="button" data-tplfield="' + fieldId + '" data-score="' + s + '" onclick="window._setScore(this)" class="w-8 h-8 rounded text-xs font-black form-tpl-field form-tpl-score transition-all border-2 bg-slate-100 text-slate-600 border-slate-200 hover:bg-amber-100 hover:text-amber-700 hover:border-amber-300">' + s + '</button>';
        }
        h += '<input type="hidden" data-tplfield="' + fieldId + '" value="" class="form-tpl-field">';
        h += '</div>';
    } else if (f.scoringType === 'passfail') {
        h += '<label class="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1 block">Scoring</label>';
        h += '<div class="flex gap-2">';
        h += '<button type="button" data-tplfield="' + fieldId + '" data-val="Pass" onclick="window._setPassFail(this)" class="px-5 py-1.5 rounded-lg text-xs font-black form-tpl-field form-tpl-pf transition-all bg-emerald-100 text-emerald-700 border-2 border-emerald-200 hover:bg-emerald-200">Pass</button>';
        h += '<button type="button" data-tplfield="' + fieldId + '" data-val="Fail" onclick="window._setPassFail(this)" class="px-5 py-1.5 rounded-lg text-xs font-black form-tpl-field form-tpl-pf transition-all bg-red-100 text-red-700 border-2 border-red-200 hover:bg-red-200">Fail</button>';
        h += '<input type="hidden" data-tplfield="' + fieldId + '" value="" class="form-tpl-field">';
        h += '</div>';
    }
    h += '</div>';
    return h;
}

window.renderTemplateFill = async function() {
    var id = window._tplFillId;
    window._tplFillId = null;
    if (!id) { setView('templatelibrary'); return; }

    var tmpl = await _getFormTemplate(id);
    if (!tmpl) { showToast('Template not found.', 'error'); setView('templatelibrary'); return; }

    var questionsHtml = tmpl.fields.map(function(f, i) {
        var at = f.answerType || 'text';
        var scoringBadge = '';
        if (f.scoringType && f.scoringType !== 'none') {
            var st = TPL_SCORING_TYPES.find(function(s) { return s.value === f.scoringType; });
            scoringBadge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 ml-1">' + (st ? st.icon + ' ' + st.label : 'Scored') + '</span>';
        }

        if (at === 'header') {
            var hc = f.headerConfig || {};
            var hdrHtml = '<div class="p-5 bg-gradient-to-r from-emerald-50 to-white border-l-4 border-emerald-600 rounded-r-lg mb-2">';
            hdrHtml += '<h3 class="text-xl font-extrabold text-emerald-800 font-serif leading-snug mb-2">' + escapeHtml(f.label || 'Section Header') + '</h3>';
            if (f.subLabel) hdrHtml += '<p class="text-xs text-slate-400 font-medium mb-3">' + escapeHtml(f.subLabel) + '</p>';
            var hfItems = [];
            if (hc.showName) hfItems.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Name</label><input type="text" data-tplfield="' + f.id + '" data-hdr="name" class="input-chip rounded-none w-full form-tpl-field" placeholder="Enter name..."></div>');
            if (hc.showJobTitle) hfItems.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Job Title</label><input type="text" data-tplfield="' + f.id + '" data-hdr="jobTitle" value="' + escapeHtml(hc.defaultJobTitle || 'Area Manager') + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="e.g. Area Manager"></div>');
            if (hc.showDate) hfItems.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date</label><input type="date" data-tplfield="' + f.id + '" data-hdr="date" value="' + new Date().toISOString().slice(0,10) + '" class="input-chip rounded-none w-full form-tpl-field"></div>');
            if (hc.showDocRef) hfItems.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Document Ref</label><input type="text" data-tplfield="' + f.id + '" data-hdr="docRef" class="input-chip rounded-none w-full form-tpl-field" placeholder="Auto-generated"></div>');
            if (hc.showDocId) hfItems.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Document ID</label><input type="text" data-tplfield="' + f.id + '" data-hdr="docId" class="input-chip rounded-none w-full form-tpl-field" placeholder="Auto-generated"></div>');
            if (hc.showTraining) hfItems.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Training Document</label><select data-tplfield="' + f.id + '" data-hdr="training" class="input-chip rounded-none w-full form-tpl-field"><option value="No">No</option><option value="Yes">Yes</option></select></div>');
            if (hc.showStore) {
                var bStoreNames = (typeof _getTplStores === 'function') ? _getTplStores() : [];
                var bStoreOpts = bStoreNames.map(function(s) { return '<option>' + escapeHtml(s) + '</option>'; }).join('');
                hfItems.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Store</label><select data-tplfield="' + f.id + '" data-hdr="store" class="input-chip rounded-none w-full form-tpl-field"><option value="">Select store...</option>' + bStoreOpts + '</select></div>');
            }
            if (hfItems.length) hdrHtml += '<div class="grid grid-cols-2 md:grid-cols-3 gap-3">' + hfItems.join('') + '</div>';
            hdrHtml += '</div>';
            return hdrHtml;
        }
        if (at === 'section') {
            return '<div class="my-4 pb-1 border-b-2 border-slate-300"><h3 class="text-lg font-extrabold text-slate-800">' + escapeHtml(f.label || 'Section') + '</h3></div>';
        }
        if (at === 'divider') return '<hr class="border-t border-dashed border-slate-300/80 my-8">';

        var html = '<div class="bg-white rounded-lg p-4 border border-slate-200">';
        if (at !== 'signoff') {
            html += '<label class="text-sm font-bold text-slate-700 mb-2 block"><span class="text-xs text-slate-400 mr-1">Q' + (i + 1) + '.</span> ' + escapeHtml(f.label) + (f.required ? ' <span class="text-red-500">*</span>' : '') + scoringBadge + '</label>';
        }
        if (f.helperText) {
            html += '<p class="text-[11px] text-slate-400 mb-2 italic">' + escapeHtml(f.helperText) + '</p>';
        }

        if (at === 'text') {
            html += '<input type="text" data-tplfield="' + f.id + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Type answer...">';
        } else if (at === 'textarea') {
            html += '<textarea data-tplfield="' + f.id + '" class="w-full p-2 border border-slate-300 rounded text-sm h-20 form-tpl-field" placeholder="Type answer..."></textarea>';
        } else if (at === 'number') {
            html += '<input type="number" data-tplfield="' + f.id + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Enter number..." step="' + (f.numberStep || '1') + '">';
        } else if (at === 'date') {
            html += '<input type="date" data-tplfield="' + f.id + '" class="input-chip rounded-none w-full form-tpl-field" value="' + new Date().toISOString().substring(0, 10) + '">';
        } else if (at === 'yesno') {
            html += '<div class="flex gap-3">';
            html += '<button type="button" data-tplfield="' + f.id + '" data-val="Yes" onclick="window._setYesNo(this)" class="px-6 py-2 rounded-lg text-sm font-black form-tpl-field form-tpl-yesno transition-all bg-emerald-100 text-emerald-700 border-2 border-emerald-200 hover:bg-emerald-200">Yes</button>';
            html += '<button type="button" data-tplfield="' + f.id + '" data-val="No" onclick="window._setYesNo(this)" class="px-6 py-2 rounded-lg text-sm font-black form-tpl-field form-tpl-yesno transition-all bg-red-100 text-red-700 border-2 border-red-200 hover:bg-red-200">No</button>';
            html += '<input type="hidden" data-tplfield="' + f.id + '" value="" class="form-tpl-field"></div>';
        } else if (at === 'multichoice') {
            html += '<div class="grid grid-cols-2 gap-1">' + (f.options||[]).map(function(o) {
                return '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="radio" name="mc-' + f.id + '" data-tplfield="' + f.id + '" value="' + escapeHtml(o) + '" class="form-tpl-field form-tpl-radio rounded"> ' + escapeHtml(o) + '</label>';
            }).join('') + '</div>';
        } else if (at === 'checkbox') {
            html += '<div class="grid grid-cols-2 gap-1">' + (f.options||[]).map(function(o) {
                return '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="checkbox" data-tplfield="' + f.id + '" value="' + escapeHtml(o) + '" class="form-tpl-field form-tpl-checkbox rounded"> ' + escapeHtml(o) + '</label>';
            }).join('') + '</div>';
        } else if (at === 'image') {
            html += '<div class="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-slate-50/50">';
            html += '<input type="file" accept="image/*" data-tplfield="' + f.id + '" class="form-tpl-field w-full text-sm text-slate-500">';
            html += '<div class="mt-2 text-xs text-slate-400">Upload a photo (JPG, PNG)</div></div>';
        } else if (at === 'table') {
            var rows = f.tableRows || 3, cols = f.tableCols || 3;
            var headers = f.tableHeaders || [];
            var rowHdrs = f.tableRowHeaders || [];
            var scoredRows = f.tableScoredRows || [];
            var scoredCols = f.tableScoredCols || [];
            var hasScoring = f.scoringType && f.scoringType !== 'none';
            html += '<div class="overflow-x-auto"><table class="w-full text-sm border border-slate-200"><thead><tr>';
            html += '<th class="bg-slate-100 border border-slate-200 p-2 text-left font-bold text-slate-600 text-xs">' + escapeHtml(f.tableRowHeaderLabel || 'Item') + '</th>';
            for (var c = 0; c < cols; c++) {
                var isScored = hasScoring && scoredCols.indexOf(c) !== -1;
                html += '<th class="bg-slate-100 border border-slate-200 p-2 text-left font-bold text-slate-600 text-xs">' + escapeHtml(headers[c] || 'Col ' + (c+1)) + (isScored ? ' <span style="font-size:9px;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:4px;border:1px solid #fde68a;">&#9733;</span>' : '') + '</th>';
            }
            html += '</tr></thead><tbody>';
            for (var r = 0; r < rows; r++) {
                var rowScored = scoredRows.indexOf(r) !== -1 && hasScoring;
                html += '<tr' + (rowScored ? ' style="background:rgba(255,243,205,0.3)"' : '') + '>';
                html += '<td class="bg-slate-50 border border-slate-200 p-1.5 text-xs font-bold text-slate-500 text-left whitespace-nowrap">' + escapeHtml(rowHdrs[r] || 'Row ' + (r+1)) + '</td>';
                for (var c2 = 0; c2 < cols; c2++) {
                    var isLastCol = (c2 === cols - 1);
                    html += '<td class="border border-slate-200 p-1">';
                    html += '<input type="text" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="' + c2 + '" class="w-full p-1.5 text-sm border-0 bg-transparent form-tpl-field rounded" placeholder="">';
                    if (isLastCol && rowScored) {
                        var scType = f.scoringType || 'score_1_10';
                        html += '<div class="flex gap-0.5 mt-1 justify-center">';
                        if (scType === 'rag') {
                            html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" data-val="Green" onclick="window._setTableCellScore(this)" class="text-[8px] font-bold px-1.5 py-0.5 rounded form-tpl-field form-tpl-rag bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200">G</button>';
                            html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" data-val="Amber" onclick="window._setTableCellScore(this)" class="text-[8px] font-bold px-1.5 py-0.5 rounded form-tpl-field form-tpl-rag bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200">A</button>';
                            html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" data-val="Red" onclick="window._setTableCellScore(this)" class="text-[8px] font-bold px-1.5 py-0.5 rounded form-tpl-field form-tpl-rag bg-red-100 text-red-700 border border-red-300 hover:bg-red-200">R</button>';
                            html += '</div><input type="hidden" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" value="" class="form-tpl-field">';
                        } else if (scType === 'passfail') {
                            html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" data-val="Pass" onclick="window._setTableCellScore(this)" class="text-[8px] font-bold px-1.5 py-0.5 rounded form-tpl-field form-tpl-ync bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200">Pass</button>';
                            html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" data-val="Fail" onclick="window._setTableCellScore(this)" class="text-[8px] font-bold px-1.5 py-0.5 rounded form-tpl-field form-tpl-ync bg-red-100 text-red-700 border border-red-300 hover:bg-red-200">Fail</button>';
                            html += '<input type="hidden" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" value="" class="form-tpl-field">';
                        } else {
                            html += '<input type="number" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" min="0" max="10" class="w-10 p-0.5 text-[10px] border border-amber-300 rounded text-center bg-amber-50 form-tpl-field" placeholder="\u2014">';
                        }
                        html += '</div>';
                    }
                    html += '</td>';
                }
                html += '</tr>';
            }
            html += '</tbody></table></div>';
        } else if (at === 'signoff') {
            html += '<div class="p-5 border-2 border-dashed border-slate-200 rounded-2xl bg-amber-50/50">';
            html += '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">';
            html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Role / Title</label><input type="text" data-tplfield="' + f.id + '" value="' + escapeHtml(f.signoffRole || 'Manager') + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="e.g. Area Manager"></div>';
            html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Sign-off By *</label><input type="text" data-tplfield="' + f.id + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Print Name..."></div>';
            html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Date Signed *</label><input type="date" data-tplfield="' + f.id + '" class="input-chip rounded-none w-full form-tpl-field" value="' + new Date().toISOString().substring(0, 10) + '"></div>';
            html += '</div>';
            html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Signature (sign on screen or use mouse)</label>';
            html += '<div class="border border-slate-300 rounded-lg bg-white overflow-hidden">';
            html += '<canvas id="sig-' + f.id + '" width="400" height="150" class="w-full touch-none cursor-crosshair" style="max-height:150px"></canvas>';
            html += '</div>';
            html += '<div class="flex gap-2 mt-2">';
            html += '<button type="button" onclick="window._sigClear(\'' + f.id + '\')" class="text-[10px] font-bold px-3 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">Clear</button>';
            html += '</div>';
            html += '<input type="hidden" data-tplfield="' + f.id + '" data-sig="true" value="" class="form-tpl-field"></div></div>';
        }

        html += _tplBuildScoringHtml(f, f.id);
        html += '</div>';
        return html;
    }).join('');

    document.getElementById('mainView').innerHTML =
        '<div class="card p-6 border-t-4 border-t-birds-green rounded-none">' +
        '<div class="flex items-center justify-between mb-5"><div>' +
        '<h2 class="text-2xl font-black birds-green">' + escapeHtml(tmpl.name) + '</h2>' +
        '<p class="text-sm text-slate-400">' + escapeHtml(tmpl.description || '') + '</p></div>' +
        '<button onclick="setView(\'templatelibrary\')" class="text-sm font-bold text-slate-500 hover:text-slate-700">\u2190 Back to Forms</button></div>' +
        '<div class="space-y-3 mb-6">' + questionsHtml + '</div>' +
        '<div id="fill-summary"></div>' +
        '<div class="flex gap-3 pt-4 border-t border-slate-200">' +
        '<button onclick="window._tplFillSave(\'' + tmpl.id + '\')" class="btn-primary rounded-none">Save Visit</button>' +
        '<button onclick="window._tplFillSummary(\'' + tmpl.id + '\')" class="btn-secondary rounded-none">Preview Summary</button>' +
        '<button onclick="setView(\'templatelibrary\')" class="bg-red-50 text-red-600 px-5 py-2.5 rounded-none font-bold hover:bg-red-100 transition-colors">Cancel</button>' +
        '</div></div>';
    setTimeout(function() { window._initSignatures(); }, 50);
};

/* ─── Fill helpers ──────────────────────────────────────────── */

window._setYesNo = function(btn) {
    btn.closest('.flex').querySelectorAll('.form-tpl-yesno').forEach(function(b) { b.classList.remove('ring-2', 'ring-offset-1'); });
    btn.classList.add('ring-2', 'ring-offset-1');
    btn.closest('.flex').querySelector('input[type="hidden"]').value = btn.getAttribute('data-val');
};

window._setRag = function(btn) {
    var container = btn.closest('.flex');
    container.querySelectorAll('.form-tpl-rag').forEach(function(b) { b.classList.remove('ring-2', 'ring-offset-1'); });
    btn.classList.add('ring-2', 'ring-offset-1');
    container.querySelector('input[type="hidden"]').value = btn.getAttribute('data-val');
};

window._setScore = function(btn) {
    var container = btn.closest('.flex');
    container.querySelectorAll('.form-tpl-score').forEach(function(b) {
        b.classList.remove('ring-2', 'ring-offset-1', 'bg-amber-200', 'text-amber-800', 'border-amber-300');
        b.classList.add('bg-slate-100', 'text-slate-600', 'border-slate-200');
    });
    btn.classList.remove('bg-slate-100', 'text-slate-600', 'border-slate-200');
    btn.classList.add('ring-2', 'ring-offset-1', 'bg-amber-200', 'text-amber-800', 'border-amber-300');
    container.querySelector('input[type="hidden"]').value = btn.getAttribute('data-score');
};

window._setPassFail = function(btn) {
    var container = btn.closest('.flex');
    container.querySelectorAll('.form-tpl-pf').forEach(function(b) { b.classList.remove('ring-2', 'ring-offset-1'); });
    btn.classList.add('ring-2', 'ring-offset-1');
    container.querySelector('input[type="hidden"]').value = btn.getAttribute('data-val');
};

window._setTableCellScore = function(btn) {
    var td = btn.closest('td');
    var scType = btn.classList.contains('form-tpl-rag') ? 'rag' : btn.classList.contains('form-tpl-ync') ? 'pf' : 'score';
    var cls = scType === 'rag' ? 'form-tpl-rag' : scType === 'pf' ? 'form-tpl-ync' : 'form-tpl-score';
    td.querySelectorAll('.' + cls).forEach(function(b) { b.classList.remove('ring-2', 'ring-offset-1'); });
    btn.classList.add('ring-2', 'ring-offset-1');
    var hidden = td.querySelector('input[type="hidden"]');
    if (hidden) hidden.value = btn.getAttribute('data-val');
};

/* ─── Signature Pad (mouse + touch) ──────────────────────────── */
window._sigClear = function(fieldId) {
    var canvas = document.getElementById('sig-' + fieldId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var hidden = document.querySelector('input[data-sig="true"][data-tplfield="' + fieldId + '"]');
    if (hidden) hidden.value = '';
};

window._initSignatures = function() {
    document.querySelectorAll('canvas[id^="sig-"]').forEach(function(canvas) {
        var fieldId = canvas.id.replace('sig-', '');
        var ctx = canvas.getContext('2d');
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        var drawing = false;
        var lastX = 0, lastY = 0;

        function getPos(e) {
            var rect = canvas.getBoundingClientRect();
            var scaleX = canvas.width / rect.width;
            var scaleY = canvas.height / rect.height;
            var clientX, clientY;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }
            return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
        }

        function startDraw(e) {
            e.preventDefault();
            drawing = true;
            var pos = getPos(e);
            lastX = pos.x; lastY = pos.y;
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
        }

        function draw(e) {
            if (!drawing) return;
            e.preventDefault();
            var pos = getPos(e);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            lastX = pos.x; lastY = pos.y;
        }

        function endDraw() {
            if (!drawing) return;
            drawing = false;
            var hidden = document.querySelector('input[data-sig="true"][data-tplfield="' + fieldId + '"]');
            if (hidden) hidden.value = canvas.toDataURL('image/png');
        }

        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', endDraw);
        canvas.addEventListener('mouseleave', endDraw);
        canvas.addEventListener('touchstart', startDraw, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', endDraw);
        canvas.addEventListener('touchcancel', endDraw);
    });
};

function _tplCollectValues(tmpl) {
    var values = {};
    tmpl.fields.forEach(function(f) {
        var at = f.answerType || 'text';
        if (at === 'multichoice') {
            var checked = document.querySelector('.form-tpl-field.form-tpl-radio[data-tplfield="' + f.id + '"]:checked');
            values[f.id] = checked ? checked.value : '';
        } else if (at === 'checkbox') {
            var cbs = document.querySelectorAll('.form-tpl-field.form-tpl-checkbox[data-tplfield="' + f.id + '"]:checked');
            var sel = [];
            cbs.forEach(function(cb) { sel.push(cb.value); });
            values[f.id] = sel.join(', ');
        } else if (at === 'yesno') {
            var hidden = document.querySelector('input[type="hidden"].form-tpl-field[data-tplfield="' + f.id + '"]');
            values[f.id] = hidden ? hidden.value : '';
        } else if (f.scoringType && f.scoringType !== 'none') {
            var scoreHidden = document.querySelector('input[type="hidden"].form-tpl-field[data-tplfield="' + f.id + '"]');
            values[f.id] = scoreHidden ? scoreHidden.value : '';
        } else if (at === 'table') {
            var rows = f.tableRows || 3, cols = f.tableCols || 3;
            var data = [];
            for (var r = 0; r < rows; r++) {
                var row = [];
                for (var c = 0; c < cols; c++) {
                    var cell = document.querySelector('.form-tpl-field[data-tplfield="' + f.id + '"][data-row="' + r + '"][data-col="' + c + '"]');
                    row.push(cell ? cell.value : '');
                }
                data.push(row.join(' | '));
            }
            values[f.id] = data.join('\n');
            var scoredRows = f.tableScoredRows || [];
            scoredRows.forEach(function(ri) {
                var scoreEl = document.querySelector('.form-tpl-field[data-tplfield="' + f.id + '"][data-row="' + ri + '"][data-col="score"]');
                values[f.id + '_r' + ri + '_cscore'] = scoreEl ? scoreEl.value : '';
            });
        } else if (at === 'header') {
            var hdrParts = [];
            var hdrEls = document.querySelectorAll('[data-tplfield="' + f.id + '"][data-hdr]');
            hdrEls.forEach(function(el) { hdrParts.push(el.value || ''); });
            values[f.id] = hdrParts.join(' | ');
        } else if (at === 'signoff') {
            var els = document.querySelectorAll('.form-tpl-field[data-tplfield="' + f.id + '"]');
            var parts = [];
            els.forEach(function(el) { parts.push(el.value || ''); });
            values[f.id] = parts.join(' | ');
        } else {
            var els2 = document.querySelectorAll('.form-tpl-field[data-tplfield="' + f.id + '"]');
            values[f.id] = els2.length > 0 ? els2[0].value : '';
        }
    });
    return values;
}

window._tplFillSummary = async function(tmplId) {
    var tmpl = await _getFormTemplate(tmplId);
    if (!tmpl) return;
    var values = _tplCollectValues(tmpl);
    var summaryHtml = await _renderSummaryPanel(tmplId, values);
    var el = document.getElementById('fill-summary');
    if (el) el.innerHTML = summaryHtml || '<p class="text-sm text-slate-400">No scored fields to summarize.</p>';
};

window._tplFillSave = async function(tmplId) {
    var tmpl = await _getFormTemplate(tmplId);
    if (!tmpl) return;
    var values = _tplCollectValues(tmpl);
    /* Extract metadata from Document Header fields if present */
    var hdrName = '', hdrJob = '', hdrDate = '', hdrStore = '';
    tmpl.fields.forEach(function(f) {
        if (f.answerType === 'header' && f.headerConfig) {
            var hdrVals = (values[f.id] || '').split(' | ');
            var idx = 0;
            if (f.headerConfig.showName) { hdrName = hdrVals[idx] || ''; idx++; }
            if (f.headerConfig.showJobTitle) { hdrJob = hdrVals[idx] || ''; idx++; }
            if (f.headerConfig.showDate) { hdrDate = hdrVals[idx] || ''; idx++; }
            if (f.headerConfig.showDocRef) { idx++; }
            if (f.headerConfig.showDocId) { idx++; }
            if (f.headerConfig.showTraining) { idx++; }
            if (f.headerConfig.showStore) { hdrStore = hdrVals[idx] || ''; idx++; }
        }
    });
    var docDate = hdrDate || new Date().toISOString().substring(0, 10);
    var tplUser = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
    var docCreator = hdrName || (tplUser ? tplUser.name : '');
    var docCreatorId = tplUser ? tplUser.id : '';
    var docName = (hdrName ? hdrName + ' \u2014 ' : '') + tmpl.name;
    var id = _uid("DOC-");
    var seq = String(Date.now()).slice(-4);
    var ref = 'FV-' + new Date().getFullYear() + '-' + seq;
    var data = {
        id: id, name: docName, title: docName,
        creator: docCreator, creatorId: docCreatorId, createdAt: new Date().toISOString(), date: docDate,
        type: 'Template: ' + tmpl.name, department: tmpl.department || ((typeof Users !== 'undefined' && Users.getCurrentUser()) ? Users.getCurrentUser().department : ''), attentionOf: '', body: '', pin: '',
        reference: ref,
        store: hdrStore || '',
        status: 'Open', replies: [],
        formTemplateId: tmplId, formTemplateName: tmpl.name, formTemplateValues: values
    };
    await _cloudWriteDoc('Open', id, data);
    showToast('Document saved successfully.', 'success');
    openDocumentViewer(id, 'Open', '');
};

/* ═══════════════════════════════════════════════════════════════
   TEMPLATE BUILDER (EDITOR)
   Left sidebar: Objects + Question Types
   Canvas: field cards with drag reorder
   Right sidebar: properties panel
   ═══════════════════════════════════════════════════════════════ */

window.renderTemplateBuilderPage = async function() {
    var editId = window._tplBuilderEditId || null;
    window._tplBuilderEditId = null;

    /* one-time Ctrl+Z listener for undo */
    if (!window._bldUndoListenerAdded) {
        window._bldUndoListenerAdded = true;
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && window._bld && !window._bld.previewMode) {
                e.preventDefault();
                window._bldUndoDelete();
            }
        });
    }

    var existing = null;
    if (editId) {
        var all = await _tplLoadTemplates();
        existing = all.find(function(t) { return t.id === editId; }) || null;
    }

    window._bld = {
        _sessionId: Date.now(),
        tmpl: existing || {
            id: _uid('FTPL-'),
            name: '',
            description: '',
            department: (typeof Users !== 'undefined' && Users.getCurrentUser()) ? Users.getCurrentUser().department : '',
            creator: (typeof Users !== 'undefined' && Users.getCurrentUser()) ? Users.getCurrentUser().name : '',
            creatorId: (typeof Users !== 'undefined' && Users.getCurrentUser()) ? Users.getCurrentUser().id : '',
            createdAt: new Date().toISOString(),
            fields: [
                { id: _uid('hdr-'), label: 'Store Visit Report', answerType: 'header', scoringType: 'none', subLabel: '',
                  headerConfig: { showName: true, showJobTitle: true, showDate: true, showStore: false, showDocRef: true, showDocId: false, showLogo: true, showTraining: false, defaultJobTitle: 'Area Manager' } },
                { id: _uid('sig-'), label: '', answerType: 'signoff', scoringType: 'none', signoffRole: 'Area Manager' }
            ],
            created: new Date().toISOString().substring(0, 10)
        },
        isEdit: !!existing,
        selectedIdx: -1,
        previewMode: false,
        dragIdx: -1
    };
    _bldRender();
};

function _bldRender() {
    var b = window._bld;
    if (!b) return;
    var el = document.getElementById('mainView');
    var savedScrollTop = 0;
    var canvasEl = document.getElementById('bld-canvas');
    if (canvasEl) savedScrollTop = canvasEl.scrollTop;
    var tmpl = b.tmpl;

    /* Department options for builder header */
    var deptOpts = (typeof Users !== 'undefined') ? Users.getDeptOptionsHtml(tmpl.department || '', false) : '<option>General</option>';

    // Canvas
    var canvasHtml = '';
    if (b.previewMode) {
        canvasHtml = _bldPreview(tmpl);
    } else if (!tmpl.fields.length) {
        canvasHtml = '<div class="flex flex-col items-center justify-center h-full text-center py-20">' +
            '<div class="text-6xl mb-4 opacity-20">\uD83D\uDCDD</div>' +
            '<h3 class="text-lg font-black text-slate-400 mb-2">No Questions Yet</h3>' +
            '<p class="text-sm text-slate-400 max-w-sm">Click a question type from the left sidebar to start building.</p></div>';
    } else {
        canvasHtml = tmpl.fields.map(function(f, i) {
            var active = b.selectedIdx === i;
            var ring = active ? 'ring-2 ring-birds-green shadow-md' : '';
            var typeLabel = _answerTypeToLabel(f.answerType);
            var scoringBadge = '';
            if (f.scoringType && f.scoringType !== 'none') {
                var st2 = TPL_SCORING_TYPES.find(function(s) { return s.value === f.scoringType; });
                scoringBadge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">' + (st2 ? st2.icon + ' ' + st2.label : 'Scored') + '</span>';
            }
            var preview = _bldFieldPreview(f);
            return '<div class="rounded-lg border border-slate-200 bg-white p-3 transition-all cursor-pointer hover:border-slate-300 ' + ring + '" ' +
                'onclick="window._bldSelect(' + i + ')" ' +
                'draggable="true" ondragstart="window._bldDragStart(event,' + i + ')" ondragover="event.preventDefault()" ondrop="window._bldDrop(event,' + i + ')" ondragend="window._bldDragEnd()">' +
                '<div class="flex items-start gap-2">' +
                '<div class="flex flex-col items-center gap-0.5 pt-0.5">' +
                '<span class="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing text-xs select-none" title="Drag">\u28FF</span>' +
                '<button onclick="event.stopPropagation();window._bldMoveField(' + i + ',-1)" class="text-slate-300 hover:text-slate-600 text-[10px]">\u25B2</button>' +
                '<button onclick="event.stopPropagation();window._bldMoveField(' + i + ',1)" class="text-slate-300 hover:text-slate-600 text-[10px]">\u25BC</button>' +
                '</div>' +
                '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-1.5 mb-0.5">' +
                '<span class="text-[10px] font-black text-slate-400">' + (['header','section','divider','signoff'].indexOf(f.answerType) === -1 ? 'Q' + (i+1) : '') + '</span>' +
                '<span class="text-xs font-bold text-slate-800 truncate">' + escapeHtml(f.label || (_answerTypeToLabel(f.answerType))) + '</span>' +
                scoringBadge +
                '<span class="text-[9px] text-slate-400 ml-auto flex-shrink-0">' + typeLabel + '</span>' +
                '</div>' + preview +
                '</div>' +
                '<button onclick="event.stopPropagation();window._bldRemoveField(' + i + ')" class="text-slate-300 hover:text-red-500 text-xs flex-shrink-0 mt-0.5" title="Remove">\u2715</button>' +
                '</div></div>';
        }).join('');
    }

    // Properties panel
    var propsHtml = '';
    if (b.selectedIdx >= 0 && tmpl.fields[b.selectedIdx] && !b.previewMode) {
        propsHtml = _bldProperties(tmpl.fields[b.selectedIdx]);
    } else if (!b.previewMode) {
        propsHtml = '<p class="text-[11px] text-slate-400 text-center py-8">Select a question to edit</p>';
    }

    el.innerHTML =
        // COMPACT TOP BAR — single row
        '<div class="flex items-center gap-3 py-2 px-3 bg-white border-b border-slate-200">' +
        '<button onclick="setView(\'templatelibrary\')" class="text-xs font-bold text-slate-500 hover:text-slate-700 flex-shrink-0">\u2190 Library</button>' +
        '<input type="text" id="bld-page-name" value="' + escapeHtml(tmpl.name) + '" class="input-chip rounded-none text-xs px-2 py-1 w-48 flex-shrink-0" placeholder="Form name" onchange="window._bldUpdateMeta()">' +
        '<input type="text" id="bld-page-desc" value="' + escapeHtml(tmpl.description) + '" class="input-chip rounded-none text-xs px-2 py-1 flex-1 min-w-0" placeholder="Description" onchange="window._bldUpdateMeta()">' +
        '<select id="bld-page-dept" onchange="window._bldUpdateMeta()" class="input-chip rounded-none text-xs px-2 py-1 w-44 flex-shrink-0">' + deptOpts + '</select>' +
        '<span class="text-[10px] text-slate-400 flex-shrink-0">' + tmpl.fields.length + ' items</span>' +
        '<button onclick="window._bldTogglePreview()" class="px-3 py-1 rounded text-[11px] font-bold flex-shrink-0 ' + (b.previewMode ? 'bg-birds-green text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">' + (b.previewMode ? '\u2190 Edit' : 'Preview') + '</button>' +
        '<button onclick="window._bldSave(false)" class="bg-slate-200 text-slate-700 hover:bg-slate-300 px-3 py-1 rounded text-[11px] font-bold flex-shrink-0">Save & Stay</button>' +
        '<button onclick="window._bldSave(true)" class="btn-primary rounded px-4 py-1 text-[11px] flex-shrink-0">Save & Exit</button>' +
        '<span id="bld-save-feedback" class="text-xs font-bold text-emerald-600 flex-shrink-0 hidden"></span>' +
        '</div>' +
        // MAIN AREA — full remaining height
        '<div class="flex gap-0" style="height:calc(100vh - 42px)">' +
        // LEFT SIDEBAR — narrow, scrollable
        (!b.previewMode ? '<div class="w-44 flex-shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto p-2">' +
        '<div class="mb-3">' +
        '<h3 class="text-xs font-black text-slate-500 uppercase tracking-wider mb-1 px-1">Sections</h3>' +
        '<div class="space-y-0.5">' +
        TPL_OBJECTS.map(function(o) {
            return '<button onclick="window._bldAdd(\'' + o.type + '\')" class="w-full text-left px-2 py-1.5 rounded text-[11px] font-bold text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 transition-all">' +
                '<span class="mr-1">' + o.icon + '</span>' + o.label + '</button>';
        }).join('') +
        '</div></div>' +
        '<div class="mb-3">' +
        '<h3 class="text-xs font-black text-slate-500 uppercase tracking-wider mb-1 px-1">Add a Question</h3>' +
        '<div class="space-y-0.5">' +
        TPL_QUESTION_TYPES.map(function(q) {
            return '<button onclick="window._bldAdd(\'' + q.type + '\')" class="w-full text-left px-2 py-1.5 rounded text-[11px] font-bold text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 transition-all">' +
                '<span class="mr-1">' + q.icon + '</span>' + q.label + '</button>';
        }).join('') +
        '</div></div>' +
        '</div>' : '') +
        // CANVAS — fills remaining space
        '<div id="bld-canvas" class="flex-1 overflow-y-auto bg-slate-50/50 p-3" ' +
        (!b.previewMode ? 'ondragover="event.preventDefault()" ondrop="window._bldCanvasDrop(event)"' : '') + '>' +
        '<div class="space-y-2">' + (canvasHtml || '<div class="text-center py-16 text-slate-400"><div class="text-3xl mb-3">\uD83D\uDCCB</div><p class="text-sm font-bold mb-1">No items yet</p><p class="text-xs">Click a button on the left to add questions, headers, or dividers</p></div>') + '</div></div>' +
        // RIGHT PROPERTIES — narrow, scrollable
        (!b.previewMode ? '<div id="bld-props" class="w-64 flex-shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-3">' +
        '<h3 class="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">Properties</h3>' +
        propsHtml + '</div>' : '') +
        '</div>';
    if (savedScrollTop) {
        var newCanvas = document.getElementById('bld-canvas');
        if (newCanvas) newCanvas.scrollTop = savedScrollTop;
    }
}

/* ─── Field preview on canvas card ──────────────────────────── */

function _bldFieldPreview(f) {
    var at = f.answerType;
    if (at === 'header') {
        var hc = f.headerConfig || {};
        var hPreview = '<div class="mt-1 border-l-4 border-emerald-600 pl-3 py-1"><h4 class="font-extrabold text-sm text-emerald-800 font-serif">' + escapeHtml(f.label || 'Header') + '</h4>';
        if (f.subLabel) hPreview += '<p class="text-[10px] text-slate-400">' + escapeHtml(f.subLabel) + '</p>';
        var hTags = [];
        if (hc.showName) hTags.push('Name');
        if (hc.showJobTitle) hTags.push('Job Title');
        if (hc.showDate) hTags.push('Date');
        if (hc.showDocRef) hTags.push('Ref');
        if (hc.showDocId) hTags.push('ID');
        if (hc.showLogo) hTags.push('Logo');
        if (hc.showTraining) hTags.push('Training');
        if (hTags.length) hPreview += '<div class="flex flex-wrap gap-1 mt-1">' + hTags.map(function(t) { return '<span class="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200">' + t + '</span>'; }).join('') + '</div>';
        hPreview += '</div>';
        return hPreview;
    }
    if (at === 'section') return '<div class="mt-1 border-l-4 border-slate-400 pl-3 py-1"><h4 class="font-extrabold text-sm text-slate-700">' + escapeHtml(f.label || 'Section') + '</h4></div>';
    if (at === 'divider') return '<hr class="border-t border-dashed border-slate-300 my-2">';
    if (at === 'signoff') return '<div class="mt-1 p-3 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-400">Sign-off Block (' + escapeHtml(f.signoffRole || 'Manager') + ')</div>';
    if (at === 'text') return '<div class="mt-1 bg-slate-50 border border-slate-200 rounded px-3 py-1.5 text-sm text-slate-400">Text answer...</div>';
    if (at === 'textarea') return '<div class="mt-1 bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs text-slate-400 h-10">Long text...</div>';
    if (at === 'number') return '<div class="mt-1 bg-slate-50 border border-slate-200 rounded px-3 py-1.5 text-sm text-slate-400"># Number...</div>';
    if (at === 'date') return '<div class="mt-1 bg-slate-50 border border-slate-200 rounded px-3 py-1.5 text-sm text-slate-400">Date picker...</div>';
    if (at === 'yesno') return '<div class="mt-1 flex gap-2"><span class="px-3 py-0.5 rounded bg-slate-100 text-xs font-bold text-slate-500">Yes</span><span class="px-3 py-0.5 rounded bg-slate-100 text-xs font-bold text-slate-500">No</span></div>';
    if (at === 'multichoice') {
        var mc = (f.options || []).slice(0, 3).map(function(o) { return '<span class="inline-flex items-center gap-1 text-xs bg-slate-100 px-2 py-0.5 rounded mr-1">' + escapeHtml(o) + '</span>'; }).join('');
        return '<div class="mt-1 flex flex-wrap gap-1">' + (mc || '<span class="text-xs text-slate-400">No options set</span>') + '</div>';
    }
    if (at === 'checkbox') {
        var cb = (f.options || []).slice(0, 3).map(function(o) { return '<span class="inline-flex items-center gap-1 text-xs bg-slate-100 px-2 py-0.5 rounded mr-1">' + escapeHtml(o) + '</span>'; }).join('');
        return '<div class="mt-1 flex flex-wrap gap-1">' + (cb || '<span class="text-xs text-slate-400">No options set</span>') + '</div>';
    }
    if (at === 'image') return '<div class="mt-1 p-4 border-2 border-dashed border-slate-200 rounded-lg text-center text-xs text-slate-400">Photo upload area</div>';
    if (at === 'table') {
        var rows = f.tableRows || 3, cols = f.tableCols || 3;
        var hdrs = '<th class="bg-slate-100 border border-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-500">' + escapeHtml(f.tableRowHeaderLabel || 'Item') + '</th>' + (f.tableHeaders || []).slice(0, cols).map(function(h) { return '<th class="bg-slate-100 border border-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-500">' + escapeHtml(h) + '</th>'; }).join('');
        var rowHdrs = f.tableRowHeaders || [];
        var cells = '';
        for (var r = 0; r < Math.min(rows, 2); r++) {
            var lbl = rowHdrs[r] ? '<th class="bg-slate-100 border border-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-500 text-left">' + escapeHtml(rowHdrs[r]) + '</th>' : '';
            cells += '<tr>' + lbl + Array(cols).fill('<td class="border border-slate-200 px-2 py-0.5 text-[9px] text-slate-300">...</td>').join('') + '</tr>';
        }
        return '<div class="mt-1 overflow-x-auto"><table class="w-full text-[10px] border border-slate-200"><thead><tr>' + hdrs + '</tr></thead><tbody>' + cells + '</tbody></table></div>';
    }
    return '';
}

/* ─── Properties panel (right sidebar) ──────────────────────── */

function _bldProperties(f) {
    var at = f.answerType;
    var html = '<div class="space-y-4">';

    // Question text (not for divider/signoff)
    if (at !== 'divider' && at !== 'signoff') {
        html += '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Question Text</label>' +
            '<textarea id="prop-label" class="w-full p-2 border border-slate-300 rounded-lg text-sm h-16" placeholder="Type your question here..." oninput="window._bldUpdateField(true)">' + escapeHtml(f.label || '') + '</textarea></div>';
    }

    // Type-specific props
    if (at === 'header') {
        var hc = f.headerConfig || {};
        html += '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Subtitle / Description</label>' +
            '<input type="text" id="prop-sublabel" value="' + escapeHtml(f.subLabel || '') + '" class="input-chip rounded-none w-full text-xs" placeholder="e.g. Completed during visit" onchange="window._bldUpdateField()"></div>';
        html += '<div class="bg-slate-50 border border-slate-200 rounded-lg p-3 mt-2">';
        html += '<label class="text-xs font-bold text-slate-600 mb-2 block">Document Header Fields</label>';
        html += '<p class="text-[10px] text-slate-400 mb-2">Toggle which fields appear in the document header.</p>';
        var hdrFields = [
            { key: 'showName', label: 'Name', icon: '\uD83D\uDC64' },
            { key: 'showJobTitle', label: 'Job Title', icon: '\uD83D\uDCCB' },
            { key: 'showDate', label: 'Date', icon: '\uD83D\uDCC5' },
            { key: 'showStore', label: 'Store', icon: '\uD83C\uDFEA' },
            { key: 'showDocRef', label: 'Document Ref', icon: '\uD83D\uDCC4' },
            { key: 'showDocId', label: 'Document ID', icon: '\uD83D\uDD11' },
            { key: 'showLogo', label: 'Logo', icon: '\uD83D\uDDBC\uFE0F' },
            { key: 'showTraining', label: 'Training Document', icon: '\uD83C\uDF93' }
        ];
        hdrFields.forEach(function(hf) {
            html += '<label class="flex items-center gap-2 text-xs text-slate-600 mb-1 cursor-pointer">' +
                '<input type="checkbox" class="prop-hdr-cfg" data-key="' + hf.key + '" ' + (hc[hf.key] ? 'checked' : '') + ' onchange="window._bldUpdateField()">' +
                '<span>' + hf.icon + ' ' + hf.label + '</span></label>';
        });
        html += '<div class="mt-2"><label class="text-[10px] font-bold text-slate-500 mb-1 block">Default Job Title</label>' +
            '<input type="text" id="prop-hdr-defaultjob" value="' + escapeHtml(hc.defaultJobTitle || 'Area Manager') + '" class="input-chip rounded-none w-full text-xs" placeholder="e.g. Area Manager" onchange="window._bldUpdateField()"></div>';
        html += '</div>';
    }

    if (at === 'signoff') {
        html += '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Sign-off Role</label>' +
            '<input type="text" id="prop-signoffrole" value="' + escapeHtml(f.signoffRole || 'Manager') + '" class="input-chip rounded-none w-full text-xs" placeholder="e.g. Area Manager" onchange="window._bldUpdateField()"></div>';
    }

    if (at === 'text' || at === 'textarea') {
        // No special props needed
    }

    if (at === 'number') {
        html += '<div class="grid grid-cols-3 gap-2">' +
            '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Min</label>' +
            '<input type="number" id="prop-numbermin" value="' + (f.numberMin !== undefined ? f.numberMin : '') + '" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div>' +
            '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Max</label>' +
            '<input type="number" id="prop-numbermax" value="' + (f.numberMax !== undefined ? f.numberMax : '') + '" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div>' +
            '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Step</label>' +
            '<input type="number" id="prop-numberstep" value="' + (f.numberStep || '1') + '" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div></div>';
    }

    if (at === 'multichoice' || at === 'checkbox') {
        html += '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Options (one per line)</label>' +
            '<textarea id="prop-options" class="w-full h-28 p-2 border border-slate-300 rounded-lg text-sm font-mono" oninput="window._bldUpdateField(true)">' + escapeHtml((f.options || []).join('\n')) + '</textarea></div>';
    }

    if (at === 'table') {
        html += '<div class="grid grid-cols-2 gap-2">' +
            '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Columns</label>' +
            '<input type="number" id="prop-tablecols" value="' + (f.tableCols || 3) + '" min="1" max="10" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div>' +
            '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Rows</label>' +
            '<input type="number" id="prop-tablerows" value="' + (f.tableRows || 3) + '" min="1" max="20" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div></div>';
        html += '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Row Label Header</label>' +
            '<input type="text" id="prop-tablerowheaderlabel" value="' + escapeHtml(f.tableRowHeaderLabel || 'Item') + '" class="input-chip rounded-none w-full text-xs" placeholder="e.g. Item, Question, Area" onchange="window._bldUpdateField()"></div>';
        html += '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Column Headers (one per line)</label>' +
            '<textarea id="prop-tableheaders" class="w-full h-20 p-2 border border-slate-300 rounded-lg text-sm font-mono" onchange="window._bldUpdateField()">' + escapeHtml((f.tableHeaders || []).join('\n')) + '</textarea></div>';
        html += '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Row Labels (one per line)</label>' +
            '<textarea id="prop-tablerowheaders" class="w-full h-20 p-2 border border-slate-300 rounded-lg text-sm font-mono" onchange="window._bldUpdateField()">' + escapeHtml((f.tableRowHeaders || []).join('\n')) + '</textarea></div>';

        // Table row/col scoring (only when scoring is attached)
        if (f.scoringType && f.scoringType !== 'none') {
            var hdrs = f.tableHeaders || [];
            var scoredRows = f.tableScoredRows || [];
            var scoredCols = f.tableScoredCols || [];
            html += '<div class="bg-amber-50 border border-amber-200 rounded-lg p-3">';
            html += '<label class="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2 block">Score These Columns</label>';
            for (var tc = 0; tc < (f.tableCols || 3); tc++) {
                html += '<label class="flex items-center gap-2 text-xs text-amber-700 mb-1 cursor-pointer">' +
                    '<input type="checkbox" class="prop-table-scored-col" data-col="' + tc + '" ' + (scoredCols.indexOf(tc) !== -1 ? 'checked' : '') + ' onchange="window._bldUpdateField()">' +
                    escapeHtml(hdrs[tc] || 'Col ' + (tc + 1)) + '</label>';
            }
            html += '<label class="text-[10px] font-black text-amber-700 uppercase tracking-widest mt-3 mb-2 block">Score These Rows</label>';
            for (var tr = 0; tr < (f.tableRows || 3); tr++) {
                var rowLbl = (f.tableRowHeaders || [])[tr] || 'Row ' + (tr + 1);
                html += '<label class="flex items-center gap-2 text-xs text-amber-700 mb-1 cursor-pointer">' +
                    '<input type="checkbox" class="prop-table-scored-row" data-row="' + tr + '" ' + (scoredRows.indexOf(tr) !== -1 ? 'checked' : '') + ' onchange="window._bldUpdateField()">' +
                    escapeHtml(rowLbl) + '</label>';
            }
            html += '</div>';
        }
    }

    // ─── SCORING ATTACHMENT (for all question types except objects) ───
    if (at !== 'header' && at !== 'section' && at !== 'divider' && at !== 'signoff') {
        html += '<div class="bg-amber-50 border border-amber-200 rounded-lg p-3">' +
            '<label class="text-xs font-bold text-amber-700 mb-1 block">Score This Question?</label>' +
            '<p class="text-[10px] text-amber-600 mb-2">Add a score so this question counts towards the total.</p>' +
            '<div class="space-y-1.5">';
        TPL_SCORING_TYPES.forEach(function(st) {
            var checked = (f.scoringType || 'none') === st.value ? 'checked' : '';
            html += '<label class="flex items-center gap-2 text-xs text-amber-700 cursor-pointer">' +
                '<input type="radio" name="prop-scoring" value="' + st.value + '" ' + checked + ' onchange="window._bldUpdateField()" class="rounded">' +
                (st.icon ? st.icon + ' ' : '') + st.label + '</label>';
        });
        html += '</div></div>';

        // Score weight (when scoring is attached)
        if (f.scoringType && f.scoringType !== 'none') {
            html += '<div class="bg-amber-50 border border-amber-200 rounded-lg p-3">' +
                '<label class="text-xs font-bold text-amber-700 mb-1 block">Importance</label>' +
                '<p class="text-[10px] text-amber-600 mb-2">How much this question matters. 1 = normal, 2 = double, 0.5 = half.</p>' +
                '<input type="number" id="prop-scoreweight" value="' + (f.scoreWeight || 1) + '" min="0.1" max="10" step="0.5" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div>';
        }
    }

    // Required + helper text (for all question types)
    if (at !== 'divider' && at !== 'pagebreak') {
        html += '<div class="bg-slate-50 border border-slate-200 rounded-lg p-3">';
        html += '<label class="flex items-center gap-2 text-xs font-bold text-slate-600 mb-2 cursor-pointer"><input type="checkbox" id="prop-required" ' + (f.required ? 'checked' : '') + ' class="accent-birds-green" onchange="window._bldUpdateField()"><span>Required field</span></label>';
        html += '<div><label class="text-xs font-bold text-slate-500 mb-1 block">Helper Text</label>';
        html += '<p class="text-[10px] text-slate-400 mb-1">Optional hint shown below the question</p>';
        html += '<input type="text" id="prop-helpertext" value="' + escapeHtml(f.helperText || '') + '" class="input-chip rounded-none w-full" placeholder="e.g. Enter a number between 0 and 100" onchange="window._bldUpdateField()"></div>';
        html += '</div>';
    }

    html += '</div>';
    return html;
}

/* ─── Canvas interactions ────────────────────────────────────── */

window._bldSelect = function(idx) {
    var b = window._bld;
    b.selectedIdx = idx;
    // Update canvas highlights only (no full rebuild)
    document.querySelectorAll('#bld-canvas > div.space-y-2 > div').forEach(function(card, i) {
        if (i === idx) { card.className = card.className.replace(/border-slate-200/g, 'border-birds-green') + ' ring-2 ring-birds-green shadow-md'; }
        else { card.className = card.className.replace(/ring-2 ring-birds-green shadow-md/g, '').replace(/border-birds-green/g, 'border-slate-200'); }
    });
    // Update properties panel only
    var propsEl = document.getElementById('bld-props');
    if (propsEl && !b.previewMode) {
        propsEl.innerHTML = '<h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Properties</h3>' + (idx >= 0 && b.tmpl.fields[idx] ? _bldProperties(b.tmpl.fields[idx]) : '<p class="text-xs text-slate-400">Select a question to edit its properties.</p>');
    }
};

window._bldAdd = function(sidebarType) {
    var b = window._bld;
    var answerType = _tplTypeToAnswerType(sidebarType);
    var field = {
        id: _uid('field-'),
        label: '',
        answerType: answerType,
        scoringType: 'none',
        options: undefined,
        subLabel: undefined,
        signoffRole: undefined,
        numberMin: undefined, numberMax: undefined, numberStep: undefined,
        tableCols: undefined, tableRows: undefined, tableHeaders: undefined, tableRowHeaders: undefined,
        tableScoredCols: undefined, tableScoredRows: undefined,
        scoreWeight: undefined
    };
    if (answerType === 'multichoice' || answerType === 'checkbox') field.options = ['Option 1', 'Option 2'];
    if (answerType === 'header') { field.subLabel = ''; field.headerConfig = { showName: true, showJobTitle: true, showDate: true, showStore: false, showDocRef: true, showDocId: false, showLogo: true, showTraining: false, defaultJobTitle: 'Area Manager' }; }
    if (answerType === 'signoff') field.signoffRole = 'Manager';
    if (answerType === 'table') { field.tableCols = 3; field.tableRows = 3; field.tableHeaders = ['Col 1', 'Col 2', 'Col 3']; field.tableRowHeaders = ['Row 1', 'Row 2', 'Row 3']; field.tableRowHeaderLabel = 'Item'; }
    b.tmpl.fields.push(field);
    b.selectedIdx = b.tmpl.fields.length - 1;
    b.previewMode = false;
    _bldRender();
};

/* Undo stack — scoped to current template session */
var _bldUndoStack = [];
var _bldUndoTimer = null;
var _bldUndoSessionId = null;

window._bldRemoveField = function(idx) {
    var b = window._bld;
    var removed = b.tmpl.fields.splice(idx, 1)[0];
    if (b.selectedIdx >= b.tmpl.fields.length) b.selectedIdx = b.tmpl.fields.length - 1;
    _bldRender();
    /* push to undo stack, auto-clear after 8s */
    _bldUndoStack.push({ field: removed, idx: idx, sessionId: b._sessionId });
    clearTimeout(_bldUndoTimer);
    _bldUndoTimer = setTimeout(function() { _bldUndoStack = []; }, 8000);
    var toastEl = showToast('Field removed', 'info', 8000);
    /* add undo button inside the toast */
    var undoBtn = document.createElement('button');
    undoBtn.textContent = ' Undo';
    undoBtn.style.cssText = 'color:white;font-weight:800;text-decoration:underline;margin-left:8px;background:none;border:none;cursor:pointer;padding:0;font-size:13px;';
    undoBtn.onclick = function(e) {
        e.stopPropagation();
        window._bldUndoDelete();
        if (toastEl && toastEl.parentNode) toastEl.style.opacity = '0';
    };
    if (toastEl) toastEl.appendChild(undoBtn);
};

window._bldUndoDelete = function() {
    if (!_bldUndoStack.length) return;
    var b = window._bld;
    var last = _bldUndoStack[_bldUndoStack.length - 1];
    if (!b || last.sessionId !== b._sessionId) { _bldUndoStack = []; return; }
    _bldUndoStack.pop();
    b.tmpl.fields.splice(last.idx, 0, last.field);
    b.selectedIdx = last.idx;
    _bldRender();
    showToast('Field restored', 'success');
};

window._bldMoveField = function(idx, dir) {
    var b = window._bld;
    var newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= b.tmpl.fields.length) return;
    var temp = b.tmpl.fields.splice(idx, 1)[0];
    b.tmpl.fields.splice(newIdx, 0, temp);
    b.selectedIdx = newIdx;
    _bldRender();
};

window._bldUpdateMeta = function() {
    window._bld.tmpl.name = document.getElementById('bld-page-name') ? document.getElementById('bld-page-name').value : '';
    window._bld.tmpl.description = document.getElementById('bld-page-desc') ? document.getElementById('bld-page-desc').value : '';
    window._bld.tmpl.department = document.getElementById('bld-page-dept') ? document.getElementById('bld-page-dept').value : '';
};

window._bldUpdateField = function(textOnly) {
    var b = window._bld;
    var idx = b.selectedIdx;
    if (idx < 0 || !b.tmpl.fields[idx]) return;
    var f = b.tmpl.fields[idx];

    var labelEl = document.getElementById('prop-label');
    if (labelEl) f.label = labelEl.value;

    // Scoring type from radio buttons
    var scoringRadios = document.querySelectorAll('input[name="prop-scoring"]');
    if (scoringRadios.length) {
        scoringRadios.forEach(function(r) {
            if (r.checked) f.scoringType = r.value;
        });
    }

    // Weight
    var wEl = document.getElementById('prop-scoreweight');
    if (wEl) f.scoreWeight = parseFloat(wEl.value) || 1;

    // Required + helper text
    var reqEl = document.getElementById('prop-required');
    if (reqEl) f.required = reqEl.checked;
    var htEl = document.getElementById('prop-helpertext');
    if (htEl) { if (htEl.value.trim()) f.helperText = htEl.value.trim(); else delete f.helperText; }

    // Type-specific
    if (f.answerType === 'header') {
        var sl = document.getElementById('prop-sublabel');
        if (sl) f.subLabel = sl.value;
        var hcChecks = document.querySelectorAll('.prop-hdr-cfg');
        var hc = f.headerConfig || {};
        hcChecks.forEach(function(cb) { hc[cb.getAttribute('data-key')] = cb.checked; });
        var djEl = document.getElementById('prop-hdr-defaultjob');
        if (djEl) hc.defaultJobTitle = djEl.value;
        f.headerConfig = hc;
    }
    if (f.answerType === 'signoff') {
        var sr = document.getElementById('prop-signoffrole');
        if (sr) f.signoffRole = sr.value;
    }
    if (f.answerType === 'multichoice' || f.answerType === 'checkbox') {
        var optEl = document.getElementById('prop-options');
        if (optEl) f.options = optEl.value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
    }
    if (f.answerType === 'number') {
        var nMin = document.getElementById('prop-numbermin');
        var nMax = document.getElementById('prop-numbermax');
        var nStep = document.getElementById('prop-numberstep');
        if (nMin && nMin.value !== '') f.numberMin = parseFloat(nMin.value); else delete f.numberMin;
        if (nMax && nMax.value !== '') f.numberMax = parseFloat(nMax.value); else delete f.numberMax;
        if (nStep) f.numberStep = nStep.value || '1';
    }
    if (f.answerType === 'table') {
        var tc = document.getElementById('prop-tablecols');
        var tr = document.getElementById('prop-tablerows');
        var th = document.getElementById('prop-tableheaders');
        if (tc) f.tableCols = parseInt(tc.value) || 3;
        if (tr) f.tableRows = parseInt(tr.value) || 3;
        if (th) f.tableHeaders = th.value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
        // v132: Trim/extend headers to match column count
        while (f.tableHeaders.length > f.tableCols) f.tableHeaders.pop();
        while (f.tableHeaders.length < f.tableCols) f.tableHeaders.push('Col ' + (f.tableHeaders.length + 1));
        var trh = document.getElementById('prop-tablerowheaders');
        if (trh) f.tableRowHeaders = trh.value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
        var trhl = document.getElementById('prop-tablerowheaderlabel');
        if (trhl) f.tableRowHeaderLabel = trhl.value.trim() || 'Item';
        // Scored columns
        var colChecks = document.querySelectorAll('.prop-table-scored-col');
        if (colChecks.length) {
            f.tableScoredCols = [];
            colChecks.forEach(function(cb) { if (cb.checked) f.tableScoredCols.push(parseInt(cb.getAttribute('data-col'))); });
        }
        // Scored rows
        var rowChecks = document.querySelectorAll('.prop-table-scored-row');
        if (rowChecks.length) {
            f.tableScoredRows = [];
            rowChecks.forEach(function(cb) { if (cb.checked) f.tableScoredRows.push(parseInt(cb.getAttribute('data-row'))); });
        }
        // v132: Trim scored row/col indices that exceed new dimensions
        if (f.tableScoredRows) f.tableScoredRows = f.tableScoredRows.filter(function(r) { return r < f.tableRows; });
        if (f.tableScoredCols) f.tableScoredCols = f.tableScoredCols.filter(function(c) { return c < f.tableCols; });
    }

    // Clean incompatible
    if (f.answerType !== 'header') { delete f.subLabel; delete f.headerConfig; }
    if (f.answerType !== 'signoff') delete f.signoffRole;
    if (f.answerType !== 'multichoice' && f.answerType !== 'checkbox') delete f.options;
    if (f.answerType !== 'number') { delete f.numberMin; delete f.numberMax; delete f.numberStep; }
    if (f.answerType !== 'table') { delete f.tableCols; delete f.tableRows; delete f.tableHeaders; delete f.tableRowHeaders; delete f.tableScoredCols; delete f.tableScoredRows; delete f.tableRowHeaderLabel; }
    if (!f.scoringType || f.scoringType === 'none') { delete f.scoreWeight; delete f.tableScoredCols; delete f.tableScoredRows; }

    // Targeted update: refresh canvas card + rebuild properties panel (needed when scoring type changes show/hide conditional sections)
    // Regenerate just the selected card's HTML
    var canvasCards = document.querySelectorAll('#bld-canvas > div.space-y-2 > div');
    if (canvasCards[idx]) {
        var active = true;
        var ring = 'ring-2 ring-birds-green shadow-md';
        var typeLabel = _answerTypeToLabel(f.answerType);
        var scoringBadge = '';
        if (f.scoringType && f.scoringType !== 'none') {
            var st2 = TPL_SCORING_TYPES.find(function(s) { return s.value === f.scoringType; });
            scoringBadge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">' + (st2 ? st2.icon + ' ' + st2.label : 'Scored') + '</span>';
        }
        var preview = _bldFieldPreview(f);
        canvasCards[idx].outerHTML =
            '<div class="rounded-lg border border-slate-200 bg-white p-3 transition-all cursor-pointer hover:border-slate-300 ' + ring + '" ' +
            'onclick="window._bldSelect(' + idx + ')" ' +
            'draggable="true" ondragstart="window._bldDragStart(event,' + idx + ')" ondragover="event.preventDefault()" ondrop="window._bldDrop(event,' + idx + ')" ondragend="window._bldDragEnd()">' +
            '<div class="flex items-start gap-2">' +
            '<div class="flex flex-col items-center gap-0.5 pt-0.5">' +
            '<span class="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing text-xs select-none" title="Drag">\u28FF</span>' +
            '<button onclick="event.stopPropagation();window._bldMoveField(' + idx + ',-1)" class="text-slate-300 hover:text-slate-600 text-[10px]">\u25B2</button>' +
            '<button onclick="event.stopPropagation();window._bldMoveField(' + idx + ',1)" class="text-slate-300 hover:text-slate-600 text-[10px]">\u25BC</button>' +
            '</div>' +
            '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center gap-1.5 mb-0.5">' +
                '<span class="text-[10px] font-black text-slate-400">' + (['header','section','divider','signoff'].indexOf(f.answerType) === -1 ? 'Q' + (idx+1) : '') + '</span>' +
            '<span class="text-xs font-bold text-slate-800 truncate">' + escapeHtml(f.label || (_answerTypeToLabel(f.answerType))) + '</span>' +
            scoringBadge +
            '<span class="text-[9px] text-slate-400 ml-auto flex-shrink-0">' + typeLabel + '</span>' +
            '</div>' + preview +
            '</div>' +
            '<button onclick="event.stopPropagation();window._bldRemoveField(' + idx + ')" class="text-slate-300 hover:text-red-500 text-xs flex-shrink-0 mt-0.5" title="Remove">\u2715</button>' +
            '</div></div>';
    }
    // Only rebuild properties panel on structural changes (not text typing) to preserve focus
    if (!textOnly) {
        var propsEl2 = document.getElementById('bld-props');
        if (propsEl2 && !b.previewMode) {
            propsEl2.innerHTML = '<h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Properties</h3>' + (idx >= 0 && b.tmpl.fields[idx] ? _bldProperties(b.tmpl.fields[idx]) : '<p class="text-xs text-slate-400">Select a question to edit its properties.</p>');
        }
    }
};

window._bldTogglePreview = function() { window._bld.previewMode = !window._bld.previewMode; _bldRender(); };

/* ─── Drag & Drop ────────────────────────────────────────────── */

window._bldDragStart = function(e, idx) {
    window._bld.dragIdx = idx;
    e.dataTransfer.setData('text/plain', 'reorder:' + idx);
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
};
window._bldDrop = function(e, idx) {
    e.preventDefault(); e.stopPropagation();
    var data = e.dataTransfer.getData('text/plain');
    var b = window._bld;
    if (data && data.indexOf('reorder:') === 0) {
        var fromIdx = parseInt(data.replace('reorder:', ''));
        if (!isNaN(fromIdx) && fromIdx !== idx) {
            var temp = b.tmpl.fields.splice(fromIdx, 1)[0];
            b.tmpl.fields.splice(idx, 0, temp);
            b.selectedIdx = idx;
            _bldRender();
        }
    }
};
window._bldDragEnd = function() { window._bld.dragIdx = -1; if (window._bld && window._bld.tmpl) _bldRender(); };
window._bldCanvasDrop = function(e) { e.preventDefault(); };

/* ─── Save ───────────────────────────────────────────────────── */

window._bldSave = async function(exitAfterSave) {
    var b = window._bld;
    var tmpl = b.tmpl;
    tmpl.name = document.getElementById('bld-page-name') ? document.getElementById('bld-page-name').value.trim() : '';
    tmpl.description = document.getElementById('bld-page-desc') ? document.getElementById('bld-page-desc').value.trim() : '';
    if (!tmpl.name) tmpl.name = 'Untitled Form';
    await _tplSaveTemplate(tmpl);
    var fb = document.getElementById('bld-save-feedback');
    if (fb) {
        fb.textContent = '\u2713 Saved!';
        fb.classList.remove('hidden');
        setTimeout(function() { fb.classList.add('hidden'); }, 2000);
    }
    if (exitAfterSave) setView('templatelibrary');
};

/* ─── Preview ────────────────────────────────────────────────── */

function _bldPreview(tmpl) {
    var storeNames = _getTplStores();
    var storeOpts = storeNames.map(function(s) { return '<option>' + escapeHtml(s) + '</option>'; }).join('');
    var html = '<div class="max-w-2xl mx-auto"><div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">' +
        '<h2 class="text-xl font-black text-slate-800 mb-1">' + escapeHtml(tmpl.name || 'Untitled Form') + '</h2>' +
        '<p class="text-sm text-slate-400 mb-4">' + escapeHtml(tmpl.description || '') + '</p>' +
        '<div class="mb-6"><label class="text-sm font-bold text-slate-700 mb-1.5 block">Store</label>' +
        '<select class="input-chip rounded-none w-full" disabled><option>Select store...</option>' + storeOpts + '</select></div>' +
        '<div class="space-y-6">';

    tmpl.fields.forEach(function(f, i) {
        var at = f.answerType;
        if (at === 'header') {
            var hc = f.headerConfig || {};
            html += '<div class="p-5 bg-gradient-to-r from-emerald-50 to-white border-l-4 border-emerald-600 rounded-r-lg mb-2">';
            html += '<h3 class="text-xl font-extrabold text-emerald-800 font-serif mb-2">' + escapeHtml(f.label || 'Section Header') + '</h3>';
            if (f.subLabel) html += '<p class="text-xs text-slate-400 mb-3">' + escapeHtml(f.subLabel) + '</p>';
            var hpFields = [];
            if (hc.showName) hpFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Name</label><input type="text" class="input-chip rounded-none w-full" placeholder="Enter name..." disabled></div>');
            if (hc.showJobTitle) hpFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Job Title</label><input type="text" class="input-chip rounded-none w-full" value="' + escapeHtml(hc.defaultJobTitle || 'Area Manager') + '" disabled></div>');
            if (hc.showDate) hpFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date</label><input type="date" class="input-chip rounded-none w-full" disabled></div>');
            if (hc.showDocRef) hpFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Document Ref</label><input type="text" class="input-chip rounded-none w-full" placeholder="Auto-generated" disabled></div>');
            if (hc.showDocId) hpFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Document ID</label><input type="text" class="input-chip rounded-none w-full" placeholder="Auto-generated" disabled></div>');
            if (hc.showTraining) hpFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Training Document</label><select class="input-chip rounded-none w-full" disabled><option>No</option><option>Yes</option></select></div>');
            if (hc.showStore) hpFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Store</label><select class="input-chip rounded-none w-full" disabled><option>Select store...</option>' + storeOpts + '</select></div>');
            if (hpFields.length) html += '<div class="grid grid-cols-2 md:grid-cols-3 gap-3">' + hpFields.join('') + '</div>';
            html += '</div>';
        } else if (at === 'section') {
            html += '<div class="my-4 pb-1 border-b-2 border-slate-300"><h3 class="text-lg font-extrabold text-slate-800">' + escapeHtml(f.label || 'Section') + '</h3></div>';
        } else if (at === 'divider') {
            html += '<hr class="border-t border-dashed border-slate-300/80 my-8">';
            } else if (at === 'signoff') {
                html += '<div class="p-5 border-2 border-dashed border-slate-200 rounded-2xl bg-amber-50/50 flex gap-4"><div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Role</label><input type="text" value="' + escapeHtml(f.signoffRole || 'Manager') + '" class="input-chip rounded-none w-full" placeholder="e.g. Area Manager" disabled></div><div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Name</label><input type="text" class="input-chip rounded-none w-full" placeholder="Print Name..." disabled></div><div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date</label><input type="date" class="input-chip rounded-none w-full" disabled></div></div>';
        } else {
            html += '<div class="bg-white rounded-lg p-4 border border-slate-200">';
            html += '<label class="text-sm font-bold text-slate-700 mb-1.5 block"><span class="text-xs text-slate-400 mr-1">Q' + (i + 1) + '.</span> ' + escapeHtml(f.label || 'Question') + (f.required ? ' <span class="text-red-500">*</span>' : '') + '</label>';
            if (f.helperText) html += '<p class="text-[11px] text-slate-400 mb-2 italic">' + escapeHtml(f.helperText) + '</p>';
            if (at === 'text') html += '<input type="text" class="input-chip rounded-none w-full" placeholder="Type answer..." disabled>';
            else if (at === 'textarea') html += '<textarea class="w-full h-20 p-3 border border-slate-300 rounded-lg text-sm" placeholder="Type answer..." disabled></textarea>';
            else if (at === 'number') html += '<input type="number" class="input-chip rounded-none w-full" placeholder="Number..." disabled>';
            else if (at === 'date') html += '<input type="date" class="input-chip rounded-none w-full" disabled>';
            else if (at === 'yesno') html += '<div class="flex gap-2"><button type="button" class="px-6 py-2 rounded-lg font-bold bg-slate-100 text-slate-600">Yes</button><button type="button" class="px-6 py-2 rounded-lg font-bold bg-slate-100 text-slate-600">No</button></div>';
            else if (at === 'multichoice') {
                html += '<div class="grid grid-cols-1 gap-1.5">' + (f.options||[]).map(function(o) {
                    return '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-2 rounded border border-slate-200"><input type="radio" disabled> ' + escapeHtml(o) + '</label>';
                }).join('') + '</div>';
            } else if (at === 'checkbox') {
                html += '<div class="grid grid-cols-1 gap-1.5">' + (f.options||[]).map(function(o) {
                    return '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-2 rounded border border-slate-200"><input type="checkbox" disabled> ' + escapeHtml(o) + '</label>';
                }).join('') + '</div>';
            } else if (at === 'image') {
                html += '<div class="p-6 border-2 border-dashed border-slate-300 rounded-xl text-center text-xs text-slate-400">Photo upload area</div>';
            } else if (at === 'table') {
                var rows = f.tableRows || 3, cols = f.tableCols || 3;
                var rowHdrs = f.tableRowHeaders || [];
                html += '<table class="w-full text-sm border border-slate-200"><thead><tr>';
                html += '<th class="bg-slate-100 border border-slate-200 p-2 text-xs font-bold text-slate-600">' + escapeHtml(f.tableRowHeaderLabel || 'Item') + '</th>';
                for (var c = 0; c < cols; c++) html += '<th class="bg-slate-100 border border-slate-200 p-2 text-xs font-bold text-slate-600">' + escapeHtml((f.tableHeaders||[])[c] || 'Col '+(c+1)) + '</th>';
                html += '</tr></thead><tbody>';
                for (var r = 0; r < rows; r++) {
                    html += '<tr>';
                    html += '<td class="bg-slate-50 border border-slate-200 p-2 text-xs font-bold text-slate-500 text-left">' + escapeHtml(rowHdrs[r] || 'Row '+(r+1)) + '</td>';
                    for (var c2 = 0; c2 < cols; c2++) html += '<td class="border border-slate-200 p-2 text-xs text-slate-300">...</td>';
                    html += '</tr>';
                }
                html += '</tbody></table>';
            }
            html += '</div>';
        }
    });

    html += '</div></div></div>';
    return html;
}
