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
    { type: 'titleblock', label: 'Title Block',  icon: 'Aa', desc: 'Section header with sub-title' },
    { type: 'pagebreak', label: 'Page Breaker',  icon: '\u2014',  desc: 'Visual divider between sections' },
    { type: 'signoff',   label: 'Sign Off',      icon: '\u270E',  desc: 'Signature, name & date block' }
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
        'titleblock': 'header', 'pagebreak': 'divider', 'signoff': 'signoff',
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
    var map = { 'header': 'Title Block', 'divider': 'Page Breaker', 'signoff': 'Sign Off',
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
    dup.id = 'FTPL-' + Date.now();
    dup.name = orig.name + ' (Copy)';
    dup.created = new Date().toISOString().substring(0, 10);
    dup.fields.forEach(function(f) { f.id = 'field-' + Date.now() + '-' + Math.random().toString(36).substr(2,4); });
    await _tplSaveTemplate(dup);
}

/* ═══════════════════════════════════════════════════════════════
   TEMPLATE LIBRARY
   ═══════════════════════════════════════════════════════════════ */

window.renderTemplateLibrary = async function() {
    var templates = await _tplLoadTemplates();
    var el = document.getElementById('mainView');

    if (!templates.length) {
        el.innerHTML = '<div class="card p-12 text-center border-t-4 border-t-birds-green">' +
            '<div class="text-6xl mb-4 opacity-30">\u2611</div>' +
            '<h2 class="text-2xl font-black text-slate-700 mb-2">No Visit Forms Yet</h2>' +
            '<p class="text-sm text-slate-400 mb-6 max-w-md mx-auto">Create scoring questionnaires for store visits \u2014 drag question types, attach scoring, and get auto-calculated summaries.</p>' +
            '<button onclick="setView(\'templatebuilder\')" class="btn-primary rounded-none text-lg px-8 py-3">+ Create Your First Form</button>' +
            '</div>';
        return;
    }

    var cards = templates.map(function(t) {
        var qCount = t.fields ? t.fields.filter(function(f) { return ['text','textarea','number','date','yesno','multichoice','checkbox','table','image'].indexOf(f.answerType) !== -1; }).length : 0;
        var scoredCount = t.fields ? t.fields.filter(function(f) { return f.scoringType && f.scoringType !== 'none'; }).length : 0;
        var ragCount = t.fields ? t.fields.filter(function(f) { return f.scoringType === 'rag'; }).length : 0;
        var pfCount = t.fields ? t.fields.filter(function(f) { return f.scoringType === 'passfail'; }).length : 0;
        var created = t.created || 'Unknown';

        var typeBadges = '';
        if (scoredCount) typeBadges += '<span class="text-[10px] font-black px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">' + scoredCount + ' Scored</span>';
        if (ragCount) typeBadges += '<span class="text-[10px] font-black px-2 py-0.5 rounded" style="background:rgba(164,119,114,0.12);color:var(--edwardian-rose);border:1px solid rgba(164,119,114,0.25);">' + ragCount + ' RAG</span>';
        if (pfCount) typeBadges += '<span class="text-[10px] font-black px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">' + pfCount + ' Pass/Fail</span>';

        return '<div class="card p-5 hover:shadow-lg transition-all group cursor-pointer border-t-2 border-t-birds-green" onclick="window._tplFill(\'' + t.id + '\')">' +
            '<div class="flex items-start justify-between mb-3">' +
            '<div class="flex-1 min-w-0">' +
            '<h3 class="text-lg font-black text-slate-800 truncate">' + escapeHtml(t.name || 'Untitled') + '</h3>' +
            '<p class="text-xs text-slate-400 mt-0.5">' + escapeHtml(t.description || 'No description') + '</p>' +
            '</div>' +
            '<div class="flex gap-1 ml-2">' +
            '<button onclick="event.stopPropagation();window._tplEdit(\'' + t.id + '\')" class="p-1.5 rounded" style="background:rgba(85,91,110,0.08);color:#555B6E;" title="Edit">\u270f</button>' +
            '<button onclick="event.stopPropagation();window._tplDuplicate(\'' + t.id + '\')" class="p-1.5 rounded bg-slate-50 text-slate-600 hover:bg-slate-100 text-xs" title="Duplicate">\u2398</button>' +
            '<button onclick="event.stopPropagation();window._tplDelete(\'' + t.id + '\')" class="p-1.5 rounded bg-red-50 text-red-600 hover:bg-red-100 text-xs" title="Delete">\u2715</button>' +
            '</div></div>' +
            '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">' + qCount + ' question' + (qCount !== 1 ? 's' : '') + '</span>' +
            typeBadges +
            '<span class="text-[10px] text-slate-400 ml-auto">' + created + '</span>' +
            '</div></div>';
    }).join('');

    el.innerHTML = '<div class="flex items-center justify-between mb-6">' +
        '<div><h1 class="text-2xl font-black text-slate-800">Store Visit Forms</h1>' +
        '<p class="text-sm text-slate-400">' + templates.length + ' form' + (templates.length !== 1 ? 's' : '') + ' available</p></div>' +
        '<button onclick="setView(\'templatebuilder\')" class="btn-primary rounded-none">+ New Form</button>' +
        '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">' + cards + '</div>';
};

window._tplEdit = function(id) { window._tplBuilderEditId = id; setView('templatebuilder'); };
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
    if (!tmpl) { alert('Template not found.'); setView('templatelibrary'); return; }

    var storeNames = _getTplStores();
    var storeOpts = storeNames.map(function(s) { return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>'; }).join('');
    var amOpts = AM_LIST.map(function(a) { return '<option value="' + escapeHtml(a) + '">' + escapeHtml(a) + '</option>'; }).join('');

    var questionsHtml = tmpl.fields.map(function(f, i) {
        var at = f.answerType || 'text';
        var scoringBadge = '';
        if (f.scoringType && f.scoringType !== 'none') {
            var st = TPL_SCORING_TYPES.find(function(s) { return s.value === f.scoringType; });
            scoringBadge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 ml-1">' + (st ? st.icon + ' ' + st.label : 'Scored') + '</span>';
        }

        if (at === 'header') {
            return '<div class="my-6 border-b border-emerald-600/20 pb-2"><h3 class="text-xl font-extrabold text-emerald-800 font-serif leading-snug">' + escapeHtml(f.label || 'Section Header') + '</h3>' + (f.subLabel ? '<p class="text-xs text-slate-400 font-medium mt-0.5">' + escapeHtml(f.subLabel) + '</p>' : '') + '</div>';
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
            for (var c = 0; c < cols; c++) {
                html += '<th class="bg-slate-100 border border-slate-200 p-2 text-left font-bold text-slate-600 text-xs">' + escapeHtml(headers[c] || 'Col ' + (c+1)) + (hasScoring && scoredCols.indexOf(c) !== -1 ? ' \u2605' : '') + '</th>';
            }
            if (scoredRows.length && hasScoring) html += '<th class="bg-amber-50 border border-slate-200 p-2 text-center font-bold text-amber-700 text-xs" style="min-width:50px">Score</th>';
            html += '</tr></thead><tbody>';
            for (var r = 0; r < rows; r++) {
                var rowScored = scoredRows.indexOf(r) !== -1 && hasScoring;
                html += '<tr' + (rowScored ? ' style="background:rgba(255,243,205,0.3)"' : '') + '>';
                html += '<td class="bg-slate-50 border border-slate-200 p-1.5 text-xs font-bold text-slate-500 text-left whitespace-nowrap">' + escapeHtml(rowHdrs[r] || 'Row ' + (r+1)) + '</td>';
                for (var c2 = 0; c2 < cols; c2++) {
                    html += '<td class="border border-slate-200 p-1"><input type="text" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="' + c2 + '" class="w-full p-1.5 text-sm border-0 bg-transparent form-tpl-field rounded" placeholder=""></td>';
                }
                if (rowScored) {
                    var scType = f.scoringType || 'score_1_10';
                    html += '<td class="border border-slate-200 p-1 text-center" style="min-width:120px">';
                    if (scType === 'rag') {
                        html += '<div class="flex gap-1 justify-center">';
                        html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" data-val="Green" onclick="window._setTableCellScore(this)" class="text-[10px] font-bold px-2 py-1 rounded form-tpl-field form-tpl-rag bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200">G</button>';
                        html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" data-val="Amber" onclick="window._setTableCellScore(this)" class="text-[10px] font-bold px-2 py-1 rounded form-tpl-field form-tpl-rag bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200">A</button>';
                        html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" data-val="Red" onclick="window._setTableCellScore(this)" class="text-[10px] font-bold px-2 py-1 rounded form-tpl-field form-tpl-rag bg-red-100 text-red-700 border border-red-300 hover:bg-red-200">R</button>';
                        html += '</div><input type="hidden" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" value="" class="form-tpl-field">';
                    } else if (scType === 'passfail') {
                        html += '<div class="flex gap-1 justify-center">';
                        html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" data-val="Pass" onclick="window._setTableCellScore(this)" class="text-[10px] font-bold px-2 py-1 rounded form-tpl-field form-tpl-ync bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200">Pass</button>';
                        html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" data-val="Fail" onclick="window._setTableCellScore(this)" class="text-[10px] font-bold px-2 py-1 rounded form-tpl-field form-tpl-ync bg-red-100 text-red-700 border border-red-300 hover:bg-red-200">Fail</button>';
                        html += '</div><input type="hidden" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" value="" class="form-tpl-field">';
                    } else {
                        html += '<input type="number" data-tplfield="' + f.id + '" data-row="' + r + '" data-col="score" min="0" max="10" class="w-12 p-1 text-sm border border-amber-300 rounded text-center bg-amber-50 form-tpl-field" placeholder="\u2014">';
                    }
                    html += '</td>';
                }
                html += '</tr>';
            }
            html += '</tbody></table></div>';
        } else if (at === 'signoff') {
            html += '<div class="p-5 border-2 border-dashed border-slate-200 rounded-2xl bg-amber-50/50 flex flex-col md:flex-row justify-between items-stretch gap-4">';
            html += '<div class="flex-grow min-w-[120px]"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Role / Title</label><p class="text-sm font-black text-slate-800 font-serif mt-1.5">' + escapeHtml(f.signoffRole || 'Manager') + '</p></div>';
            html += '<div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Sign-off By *</label><input type="text" data-tplfield="' + f.id + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Print Name..."></div>';
            html += '<div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Date Signed *</label><input type="date" data-tplfield="' + f.id + '" class="input-chip rounded-none w-full form-tpl-field" value="' + new Date().toISOString().substring(0, 10) + '"></div>';
            html += '<div class="flex-grow flex flex-col justify-end min-w-[120px]"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Signature</label>';
            html += '<button type="button" class="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-black rounded-lg transition-colors" onclick="this.textContent=\'Signed\'; this.disabled=true;">Sign Document</button></div></div>';
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
        '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">' +
        '<div><label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Store *</label>' +
        '<select id="fill-store" class="input-chip rounded-none w-full"><option value="">Select store...</option>' + storeOpts + '</select></div>' +
        '<div><label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Area Manager</label>' +
        '<select id="fill-am" class="input-chip rounded-none w-full"><option value="">Select...</option>' + amOpts + '</select></div>' +
        '<div><label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Visit Date</label>' +
        '<input type="date" id="fill-date" class="input-chip rounded-none w-full" value="' + new Date().toISOString().substring(0, 10) + '"></div></div>' +
        '<div class="space-y-3 mb-6">' + questionsHtml + '</div>' +
        '<div id="fill-summary"></div>' +
        '<div class="flex gap-3 pt-4 border-t border-slate-200">' +
        '<button onclick="window._tplFillSave(\'' + tmpl.id + '\')" class="btn-primary rounded-none">Save Visit</button>' +
        '<button onclick="window._tplFillSummary(\'' + tmpl.id + '\')" class="btn-secondary rounded-none">Preview Summary</button>' +
        '<button onclick="setView(\'templatelibrary\')" class="bg-red-50 text-red-600 px-5 py-2.5 rounded-none font-bold hover:bg-red-100 transition-colors">Cancel</button>' +
        '</div></div>';
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

function _tplCollectValues(tmpl) {
    var values = {};
    tmpl.fields.forEach(function(f) {
        var at = f.answerType || 'text';
        if (at === 'multichoice') {
            var checked = document.querySelector('.form-tpl-field.form-tpl-radio[data-tplfield="' + f.id + '"]:checked');
            values[f.id] = checked ? checked.value : '';
        } else if (at === 'yesno' || (f.scoringType && f.scoringType !== 'none')) {
            var hidden = document.querySelector('input[type="hidden"].form-tpl-field[data-tplfield="' + f.id + '"]');
            values[f.id] = hidden ? hidden.value : '';
        } else if (at === 'table') {
            var els = document.querySelectorAll('.form-tpl-field[data-tplfield="' + f.id + '"]');
            els.forEach(function(el) {
                var r = el.getAttribute('data-row'), c = el.getAttribute('data-col');
                if (r !== null && c !== null) values[f.id + '_r' + r + '_c' + c] = el.value;
            });
            values[f.id] = Array.from(els).map(function(el) { return el.value; }).join(' | ');
        } else if (at === 'signoff') {
            var inputs = document.querySelectorAll('.form-tpl-field[data-tplfield="' + f.id + '"]');
            values[f.id] = Array.from(inputs).map(function(el) { return el.value; }).join(' | ');
        } else {
            var els2 = document.querySelectorAll('.form-tpl-field[data-tplfield="' + f.id + '"]');
            values[f.id] = els2.length > 0 ? Array.from(els2).map(function(el) { return el.value; }).join(' | ') : '';
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
    var store = document.getElementById('fill-store') && document.getElementById('fill-store').value;
    if (!store) { alert('Select a store.'); return; }
    var tmpl = await _getFormTemplate(tmplId);
    if (!tmpl) return;
    var values = _tplCollectValues(tmpl);
    var id = "DOC-" + Date.now();
    var data = {
        id: id, name: store + ' \u2014 ' + tmpl.name, title: store + ' \u2014 ' + tmpl.name,
        creator: document.getElementById('fill-am') ? document.getElementById('fill-am').value : '',
        date: document.getElementById('fill-date') ? document.getElementById('fill-date').value : new Date().toISOString().substring(0, 10),
        type: 'Template: ' + tmpl.name, department: '', attentionOf: '', body: '', pin: '',
        status: 'Open', replies: [],
        formTemplateId: tmplId, formTemplateName: tmpl.name, formTemplateValues: values
    };
    await _cloudWriteDoc('Open', id, data);
    alert('Visit saved: ' + data.name);
    setView('templatelibrary');
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

    var existing = null;
    if (editId) {
        var all = await _tplLoadTemplates();
        existing = all.find(function(t) { return t.id === editId; }) || null;
    }

    window._bld = {
        tmpl: existing || {
            id: 'FTPL-' + Date.now(),
            name: '',
            description: '',
            fields: [
                { id: 'hdr-' + Date.now(), label: 'Store Visit Report', answerType: 'header', scoringType: 'none', subLabel: 'Completed by Area Manager' },
                { id: 'sig-' + Date.now(), label: '', answerType: 'signoff', scoringType: 'none', signoffRole: 'Area Manager' }
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
    var tmpl = b.tmpl;

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
            return '<div class="rounded-xl border border-slate-200 bg-white p-4 transition-all cursor-pointer hover:border-slate-300 ' + ring + '" ' +
                'onclick="window._bldSelect(' + i + ')" ' +
                'draggable="true" ondragstart="window._bldDragStart(event,' + i + ')" ondragover="event.preventDefault()" ondrop="window._bldDrop(event,' + i + ')" ondragend="window._bldDragEnd()">' +
                '<div class="flex items-start gap-3">' +
                '<div class="flex flex-col items-center gap-1 pt-0.5">' +
                '<span class="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing text-sm select-none" title="Drag">\u28FF</span>' +
                '<button onclick="event.stopPropagation();window._bldMoveField(' + i + ',-1)" class="text-slate-300 hover:text-slate-600 text-xs">\u25B2</button>' +
                '<button onclick="event.stopPropagation();window._bldMoveField(' + i + ',1)" class="text-slate-300 hover:text-slate-600 text-xs">\u25BC</button>' +
                '</div>' +
                '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-2 mb-1">' +
                '<span class="text-xs font-black text-slate-400">' + (['header','divider','signoff'].indexOf(f.answerType) === -1 ? 'Q' + (i+1) : '') + '</span>' +
                '<span class="text-sm font-bold text-slate-800">' + escapeHtml(f.label || (_answerTypeToLabel(f.answerType))) + '</span>' +
                scoringBadge +
                '<span class="text-[10px] text-slate-400 ml-auto">' + typeLabel + '</span>' +
                '</div>' + preview +
                '</div>' +
                '<button onclick="event.stopPropagation();window._bldRemoveField(' + i + ')" class="text-slate-300 hover:text-red-500 text-sm flex-shrink-0 mt-1" title="Remove">\u2715</button>' +
                '</div></div>';
        }).join('');
    }

    // Properties panel
    var propsHtml = '';
    if (b.selectedIdx >= 0 && tmpl.fields[b.selectedIdx] && !b.previewMode) {
        propsHtml = _bldProperties(tmpl.fields[b.selectedIdx]);
    } else if (!b.previewMode) {
        propsHtml = '<div class="text-center py-12 text-sm text-slate-400">' +
            '<div class="text-4xl mb-3 opacity-30">\u261D\uFE0F</div>' +
            'Select a question to<br>edit its properties</div>';
    }

    el.innerHTML =
        '<div class="card p-4 mb-4"><div class="flex items-center gap-4 flex-wrap">' +
        '<button onclick="setView(\'templatelibrary\')" class="text-sm font-bold text-slate-500 hover:text-slate-700">\u2190 Library</button>' +
        '<div class="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">' +
        '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Form Name</label>' +
        '<input type="text" id="bld-page-name" value="' + escapeHtml(tmpl.name) + '" class="input-chip rounded-none w-full mt-1" placeholder="e.g. Q3 Store Visit" onchange="window._bldUpdateMeta()"></div>' +
        '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Description</label>' +
        '<input type="text" id="bld-page-desc" value="' + escapeHtml(tmpl.description) + '" class="input-chip rounded-none w-full mt-1" placeholder="What this form covers" onchange="window._bldUpdateMeta()"></div>' +
        '</div>' +
        '<div class="flex gap-2">' +
        '<button onclick="window._bldTogglePreview()" class="px-4 py-2 rounded-none text-sm font-bold ' + (b.previewMode ? 'bg-birds-green text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">' + (b.previewMode ? '\u2190 Edit' : 'Preview') + '</button>' +
        '<button onclick="window._bldSave()" class="btn-primary rounded-none px-6">Save Form</button>' +
        '</div></div></div>' +
        // Main area: left sidebar + canvas + properties
        '<div class="flex gap-3" style="min-height:calc(100vh - 220px)">' +
        // LEFT SIDEBAR
        (!b.previewMode ? '<div class="w-52 flex-shrink-0 card p-3 overflow-y-auto" style="max-height:calc(100vh - 260px)">' +
        '<div class="mb-4">' +
        '<h3 class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Objects</h3>' +
        '<div class="space-y-1">' +
        TPL_OBJECTS.map(function(o) {
            return '<button onclick="window._bldAdd(\'' + o.type + '\')" class="w-full text-left px-3 py-2 rounded-lg text-xs font-bold text-slate-600 bg-slate-50 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 transition-all">' +
                '<span class="mr-2">' + o.icon + '</span>' + o.label + '</button>';
        }).join('') +
        '</div></div>' +
        '<div class="mb-4">' +
        '<h3 class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Question Types</h3>' +
        '<div class="space-y-1">' +
        TPL_QUESTION_TYPES.map(function(q) {
            return '<button onclick="window._bldAdd(\'' + q.type + '\')" class="w-full text-left px-3 py-2 rounded-lg text-xs font-bold text-slate-600 bg-slate-50 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 transition-all">' +
                '<span class="mr-2">' + q.icon + '</span>' + q.label + '</button>';
        }).join('') +
        '</div></div>' +
        '</div>' : '') +
        // CANVAS
        '<div class="flex-1 card p-4 overflow-y-auto" style="max-height:calc(100vh - 260px)" ' +
        (!b.previewMode ? 'ondragover="event.preventDefault()" ondrop="window._bldCanvasDrop(event)"' : '') + '>' +
        '<div class="flex items-center justify-between mb-4">' +
        '<h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest">' + (b.previewMode ? 'PREVIEW' : 'QUESTIONS') + ' \u2014 ' + tmpl.fields.length + '</h3>' +
        '</div>' +
        '<div class="space-y-2">' + canvasHtml + '</div></div>' +
        // RIGHT PROPERTIES
        (!b.previewMode ? '<div class="w-72 flex-shrink-0 card p-4 overflow-y-auto" style="max-height:calc(100vh - 260px)">' +
        '<h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Properties</h3>' +
        propsHtml + '</div>' : '') +
        '</div>';
}

/* ─── Field preview on canvas card ──────────────────────────── */

function _bldFieldPreview(f) {
    var at = f.answerType;
    if (at === 'header') return '<div class="mt-1 border-l-4 border-emerald-600 pl-3 py-1"><h4 class="font-extrabold text-sm text-emerald-800 font-serif">' + escapeHtml(f.label || 'Header') + '</h4>' + (f.subLabel ? '<p class="text-[10px] text-slate-400">' + escapeHtml(f.subLabel) + '</p>' : '') + '</div>';
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
        var hdrs = (f.tableHeaders || []).slice(0, cols).map(function(h) { return '<th class="bg-slate-100 border border-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-500">' + escapeHtml(h) + '</th>'; }).join('');
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
        html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Question Text</label>' +
            '<textarea id="prop-label" class="w-full p-2 border border-slate-300 rounded-lg text-sm h-16" onchange="window._bldUpdateField()">' + escapeHtml(f.label || '') + '</textarea></div>';
    }

    // Type-specific props
    if (at === 'header') {
        html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Sub-header / Description</label>' +
            '<input type="text" id="prop-sublabel" value="' + escapeHtml(f.subLabel || '') + '" class="input-chip rounded-none w-full text-xs" onchange="window._bldUpdateField()"></div>';
    }

    if (at === 'signoff') {
        html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Sign-off Role</label>' +
            '<input type="text" id="prop-signoffrole" value="' + escapeHtml(f.signoffRole || 'Manager') + '" class="input-chip rounded-none w-full text-xs" placeholder="e.g. Area Manager" onchange="window._bldUpdateField()"></div>';
    }

    if (at === 'text' || at === 'textarea') {
        // No special props needed
    }

    if (at === 'number') {
        html += '<div class="grid grid-cols-3 gap-2">' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Min</label>' +
            '<input type="number" id="prop-numbermin" value="' + (f.numberMin !== undefined ? f.numberMin : '') + '" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Max</label>' +
            '<input type="number" id="prop-numbermax" value="' + (f.numberMax !== undefined ? f.numberMax : '') + '" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Step</label>' +
            '<input type="number" id="prop-numberstep" value="' + (f.numberStep || '1') + '" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div></div>';
    }

    if (at === 'multichoice' || at === 'checkbox') {
        html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Options (one per line)</label>' +
            '<textarea id="prop-options" class="w-full h-28 p-2 border border-slate-300 rounded-lg text-sm font-mono" onchange="window._bldUpdateField()">' + escapeHtml((f.options || []).join('\n')) + '</textarea></div>';
    }

    if (at === 'table') {
        html += '<div class="grid grid-cols-2 gap-2">' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Columns</label>' +
            '<input type="number" id="prop-tablecols" value="' + (f.tableCols || 3) + '" min="1" max="10" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Rows</label>' +
            '<input type="number" id="prop-tablerows" value="' + (f.tableRows || 3) + '" min="1" max="20" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div></div>';
        html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Column Headers (one per line)</label>' +
            '<textarea id="prop-tableheaders" class="w-full h-20 p-2 border border-slate-300 rounded-lg text-sm font-mono" onchange="window._bldUpdateField()">' + escapeHtml((f.tableHeaders || []).join('\n')) + '</textarea></div>';
        html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Row Labels (one per line)</label>' +
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
    if (at !== 'header' && at !== 'divider' && at !== 'signoff') {
        html += '<div class="bg-amber-50 border border-amber-200 rounded-lg p-3">' +
            '<label class="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2 block">Attach Scoring</label>' +
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
                '<label class="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-1 block">Weight (multiplier)</label>' +
                '<input type="number" id="prop-scoreweight" value="' + (f.scoreWeight || 1) + '" min="0.1" max="10" step="0.5" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div>';
        }
    }

    // Required + helper text (for all question types)
    if (at !== 'divider' && at !== 'pagebreak') {
        html += '<div class="bg-slate-50 border border-slate-200 rounded-lg p-3">';
        html += '<label class="flex items-center gap-2 text-xs font-bold text-slate-600 mb-2 cursor-pointer"><input type="checkbox" id="prop-required" ' + (f.required ? 'checked' : '') + ' class="accent-birds-green" onchange="window._bldUpdateField()"><span>Required field</span></label>';
        html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Helper Text (shown below question)</label>';
        html += '<input type="text" id="prop-helpertext" value="' + escapeHtml(f.helperText || '') + '" class="input-chip rounded-none w-full" placeholder="Optional hint or instruction..." onchange="window._bldUpdateField()"></div>';
        html += '</div>';
    }

    html += '</div>';
    return html;
}

/* ─── Canvas interactions ────────────────────────────────────── */

window._bldSelect = function(idx) { window._bld.selectedIdx = idx; _bldRender(); };

window._bldAdd = function(sidebarType) {
    var b = window._bld;
    var answerType = _tplTypeToAnswerType(sidebarType);
    var field = {
        id: 'field-' + Date.now() + '-' + Math.random().toString(36).substr(2,4),
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
    if (answerType === 'header') field.subLabel = '';
    if (answerType === 'signoff') field.signoffRole = 'Manager';
    if (answerType === 'table') { field.tableCols = 3; field.tableRows = 3; field.tableHeaders = ['Col 1', 'Col 2', 'Col 3']; field.tableRowHeaders = ['Row 1', 'Row 2', 'Row 3']; }
    b.tmpl.fields.push(field);
    b.selectedIdx = b.tmpl.fields.length - 1;
    b.previewMode = false;
    _bldRender();
};

window._bldRemoveField = function(idx) {
    var b = window._bld;
    b.tmpl.fields.splice(idx, 1);
    if (b.selectedIdx >= b.tmpl.fields.length) b.selectedIdx = b.tmpl.fields.length - 1;
    _bldRender();
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
};

window._bldUpdateField = function() {
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
        var trh = document.getElementById('prop-tablerowheaders');
        if (trh) f.tableRowHeaders = trh.value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
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
    }

    // Clean incompatible
    if (f.answerType !== 'header') delete f.subLabel;
    if (f.answerType !== 'signoff') delete f.signoffRole;
    if (f.answerType !== 'multichoice' && f.answerType !== 'checkbox') delete f.options;
    if (f.answerType !== 'number') { delete f.numberMin; delete f.numberMax; delete f.numberStep; }
    if (f.answerType !== 'table') { delete f.tableCols; delete f.tableRows; delete f.tableHeaders; delete f.tableRowHeaders; delete f.tableScoredCols; delete f.tableScoredRows; }
    if (!f.scoringType || f.scoringType === 'none') { delete f.scoreWeight; delete f.tableScoredCols; delete f.tableScoredRows; }

    _bldRender();
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

window._bldSave = async function() {
    var b = window._bld;
    var tmpl = b.tmpl;
    tmpl.name = document.getElementById('bld-page-name') ? document.getElementById('bld-page-name').value.trim() : '';
    tmpl.description = document.getElementById('bld-page-desc') ? document.getElementById('bld-page-desc').value.trim() : '';
    if (!tmpl.name) { alert('Form name is required.'); return; }
    if (!tmpl.fields.length) { alert('Add at least one question.'); return; }
    var empty = tmpl.fields.find(function(f) {
        if (f.answerType === 'header' || f.answerType === 'divider' || f.answerType === 'signoff') return false;
        return !f.label || !f.label.trim();
    });
    if (empty) { alert('All questions need question text.'); return; }
    await _tplSaveTemplate(tmpl);
    alert('Form saved: ' + tmpl.name);
    setView('templatelibrary');
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
            html += '<div class="my-6 border-b border-emerald-600/20 pb-2"><h3 class="text-xl font-extrabold text-emerald-800 font-serif">' + escapeHtml(f.label || 'Header') + '</h3>' + (f.subLabel ? '<p class="text-xs text-slate-400 mt-0.5">' + escapeHtml(f.subLabel) + '</p>' : '') + '</div>';
        } else if (at === 'divider') {
            html += '<hr class="border-t border-dashed border-slate-300/80 my-8">';
        } else if (at === 'signoff') {
            html += '<div class="p-5 border-2 border-dashed border-slate-200 rounded-2xl bg-amber-50/50 flex gap-4"><div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Role</label><p class="text-sm font-black">' + escapeHtml(f.signoffRole || 'Manager') + '</p></div><div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Name</label><input type="text" class="input-chip rounded-none w-full" placeholder="Print Name..." disabled></div><div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date</label><input type="date" class="input-chip rounded-none w-full" disabled></div></div>';
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
