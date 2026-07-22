/* ══════════════════════════════════════════════════════════════
   STORE VISIT QUESTIONNAIRE BUILDER
   Create scoring forms for store visits
   ══════════════════════════════════════════════════════════════ */

const TPL_STORES = ['Derbion Crown Walk','Lister Gate','West Bridgford','Sutton Lakeside','Victoria Centre','Long Eaton','Park Farm','East Leake','Melton Road','Teal Park','Lansdowne Drive','Branston','Burton','Sutton','Stretton','Swadlincote','Training'];

const TPL_ANSWER_TYPES = [
    { value: 'text',       label: 'Text Answer',     icon: 'Aa' },
    { value: 'textarea',   label: 'Long Text',       icon: '¶' },
    { value: 'multichoice', label: 'Multi-Choice',   icon: '☑' },
    { value: 'yesno',      label: 'Yes / No',        icon: '✓' },
    { value: 'rag',        label: 'RAG Rating',      icon: '🚦' },
    { value: 'score',      label: 'Score (1-10)',    icon: '★' }
];

/* ─── Storage (Graph API via documents.js) ──────────────────── */

async function _tplLoadTemplates() { return _loadFormTemplates(); }
async function _tplSaveTemplates(templates) { return _saveFormTemplates(templates); }
async function _tplSaveTemplate(tmpl) { return _saveFormTemplate(tmpl); }
async function _tplDeleteTemplate(id) { return _deleteFormTemplate(id); }

async function _tplDuplicateTemplate(id) {
    var templates = await _tplLoadTemplates();
    var orig = templates.find(t => t.id === id);
    if (!orig) return;
    var dup = JSON.parse(JSON.stringify(orig));
    dup.id = 'FTPL-' + Date.now();
    dup.name = orig.name + ' (Copy)';
    dup.created = new Date().toISOString().substring(0, 10);
    dup.fields.forEach(f => { f.id = 'field-' + Date.now() + '-' + Math.random().toString(36).substr(2,4); });
    await _tplSaveTemplate(dup);
}

/* ═══════════════════════════════════════════════════════════════
   TEMPLATE LIBRARY
   ═══════════════════════════════════════════════════════════════ */

window.renderTemplateLibrary = async function() {
    var templates = await _tplLoadTemplates();
    var el = document.getElementById('mainView');

    if (!templates.length) {
        el.innerHTML = '<div class="card p-12 text-center">' +
            '<div class="text-6xl mb-4 opacity-30">📋</div>' +
            '<h2 class="text-2xl font-black text-slate-700 mb-2">No Visit Forms Yet</h2>' +
            '<p class="text-sm text-slate-400 mb-6 max-w-md mx-auto">Create scoring questionnaires for store visits — questions with scoring, RAG ratings, and auto-calculated summaries.</p>' +
            '<button onclick="setView(\'templatebuilder\')" class="btn-primary rounded-none text-lg px-8 py-3">+ Create Your First Form</button>' +
            '</div>';
        return;
    }

    var cards = templates.map(function(t) {
        var qCount = t.fields ? t.fields.length : 0;
        var scoreCount = t.fields ? t.fields.filter(f => f.scored).length : 0;
        var created = t.created || 'Unknown';

        return '<div class="card p-5 hover:shadow-lg transition-shadow group cursor-pointer" onclick="window._tplFill(\'' + t.id + '\')">' +
            '<div class="flex items-start justify-between mb-3">' +
            '<div class="flex-1 min-w-0">' +
            '<h3 class="text-lg font-black text-slate-800 truncate">' + escapeHtml(t.name || 'Untitled') + '</h3>' +
            '<p class="text-xs text-slate-400 mt-0.5">' + escapeHtml(t.description || 'No description') + '</p>' +
            '</div>' +
            '<div class="flex gap-1 ml-2">' +
            '<button onclick="event.stopPropagation();window._tplEdit(\'' + t.id + '\')" class="p-1.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs" title="Edit">✏️</button>' +
            '<button onclick="event.stopPropagation();window._tplDuplicate(\'' + t.id + '\')" class="p-1.5 rounded bg-slate-50 text-slate-600 hover:bg-slate-100 text-xs" title="Duplicate">📋</button>' +
            '<button onclick="event.stopPropagation();window._tplDelete(\'' + t.id + '\', \'' + escapeHtml(t.name) + '\')" class="p-1.5 rounded bg-red-50 text-red-600 hover:bg-red-100 text-xs" title="Delete">🗑️</button>' +
            '</div>' +
            '</div>' +
            '<div class="flex items-center gap-3 text-xs text-slate-500">' +
            '<span class="font-bold">' + qCount + ' question' + (qCount !== 1 ? 's' : '') + '</span>' +
            (scoreCount ? '<span class="text-amber-600 font-bold">' + scoreCount + ' scored</span>' : '') +
            '<span class="text-slate-400">' + created + '</span>' +
            '</div>' +
            '</div>';
    }).join('');

    el.innerHTML = '<div class="flex items-center justify-between mb-6">' +
        '<div><h1 class="text-2xl font-black text-slate-800">Visit Form Templates</h1>' +
        '<p class="text-sm text-slate-400">' + templates.length + ' form' + (templates.length !== 1 ? 's' : '') + '</p></div>' +
        '<button onclick="setView(\'templatebuilder\')" class="btn-primary rounded-none">+ New Form</button>' +
        '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">' + cards + '</div>';
};

window._tplEdit = function(id) {
    window._tplBuilderEditId = id;
    setView('templatebuilder');
};

window._tplDuplicate = async function(id) {
    if (!confirm('Duplicate this form template?')) return;
    await _tplDuplicateTemplate(id);
    renderTemplateLibrary();
};

window._tplDelete = async function(id, name) {
    if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
    await _tplDeleteTemplate(id);
    renderTemplateLibrary();
};

window._tplFill = function(id) {
    window._tplFillId = id;
    setView('templatefill');
};

/* ═══════════════════════════════════════════════════════════════
   FILL IN A TEMPLATE FORM
   ═══════════════════════════════════════════════════════════════ */

window.renderTemplateFill = async function() {
    var id = window._tplFillId;
    window._tplFillId = null;
    if (!id) { setView('templatelibrary'); return; }

    var tmpl = await _getFormTemplate(id);
    if (!tmpl) { alert('Template not found.'); setView('templatelibrary'); return; }

    var storeNames = TPL_STORES;
    var storeOpts = storeNames.map(s => '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>').join('');

    var amOpts = AM_LIST.map(a => '<option value="' + escapeHtml(a) + '">' + escapeHtml(a) + '</option>').join('');

    // Build questions
    var questionsHtml = tmpl.fields.map(function(f, i) {
        var at = f.answerType || 'text';
        var scoreLabel = f.scored ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 ml-1">SCORED</span>' : '';
        var html = '<div class="bg-white rounded-lg p-4 border border-slate-200">';
        html += '<label class="text-sm font-bold text-slate-700 mb-2 block"><span class="text-xs text-slate-400 mr-1">Q' + (i + 1) + '.</span> ' + escapeHtml(f.label) + scoreLabel + '</label>';

        switch(at) {
            case 'text':
                html += '<input type="text" data-tplfield="' + f.id + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Type answer...">';
                break;
            case 'textarea':
                html += '<textarea data-tplfield="' + f.id + '" class="w-full p-2 border border-slate-300 rounded text-sm h-20 form-tpl-field" placeholder="Type answer..."></textarea>';
                break;
            case 'multichoice':
                html += '<div class="grid grid-cols-2 gap-1">' + (f.options||[]).map(function(o) {
                    return '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="radio" name="mc-' + f.id + '" data-tplfield="' + f.id + '" value="' + escapeHtml(o) + '" class="form-tpl-field form-tpl-radio rounded"> ' + escapeHtml(o) + '</label>';
                }).join('') + '</div>';
                break;
            case 'yesno':
                html += '<div class="flex gap-2">';
                html += '<button type="button" data-tplfield="' + f.id + '" data-val="Yes" onclick="window._setYesNo(this)" class="px-5 py-1.5 rounded text-sm font-bold form-tpl-field form-tpl-yesno transition-all bg-slate-100 text-slate-600 hover:bg-slate-200">Yes</button>';
                html += '<button type="button" data-tplfield="' + f.id + '" data-val="No" onclick="window._setYesNo(this)" class="px-5 py-1.5 rounded text-sm font-bold form-tpl-field form-tpl-yesno transition-all bg-slate-100 text-slate-600 hover:bg-slate-200">No</button>';
                html += '<input type="hidden" data-tplfield="' + f.id + '" value="" class="form-tpl-field">';
                html += '</div>';
                break;
            case 'rag':
                html += '<div class="flex gap-2">';
                html += '<button type="button" data-tplfield="' + f.id + '" data-val="Red" onclick="window._setRag(this)" class="px-4 py-1.5 rounded text-sm font-bold form-tpl-field form-tpl-rag transition-all bg-slate-100 text-slate-600 hover:bg-slate-200">Red</button>';
                html += '<button type="button" data-tplfield="' + f.id + '" data-val="Amber" onclick="window._setRag(this)" class="px-4 py-1.5 rounded text-sm font-bold form-tpl-field form-tpl-rag transition-all bg-slate-100 text-slate-600 hover:bg-slate-200">Amber</button>';
                html += '<button type="button" data-tplfield="' + f.id + '" data-val="Green" onclick="window._setRag(this)" class="px-4 py-1.5 rounded text-sm font-bold form-tpl-field form-tpl-rag transition-all bg-slate-100 text-slate-600 hover:bg-slate-200">Green</button>';
                html += '<input type="hidden" data-tplfield="' + f.id + '" value="" class="form-tpl-field">';
                html += '</div>';
                break;
            case 'score':
                var min = f.scoreMin || 1, max = f.scoreMax || 10;
                html += '<div class="flex gap-1 flex-wrap">';
                for (var s = min; s <= max; s++) {
                    html += '<button type="button" data-tplfield="' + f.id + '" data-score="' + s + '" onclick="window._setScore(this)" class="w-9 h-9 rounded text-sm font-bold form-tpl-field form-tpl-score transition-all bg-slate-100 text-slate-600 hover:bg-slate-200">' + s + '</button>';
                }
                html += '<input type="hidden" data-tplfield="' + f.id + '" value="" class="form-tpl-field">';
                html += '</div>';
                break;
        }
        html += '</div>';
        return html;
    }).join('');

    document.getElementById('mainView').innerHTML =
        '<div class="card p-6 border-t-4 border-t-birds-green rounded-none">' +
        '<div class="flex items-center justify-between mb-4">' +
        '<div>' +
        '<h2 class="text-2xl font-black birds-green">' + escapeHtml(tmpl.name) + '</h2>' +
        '<p class="text-sm text-slate-400">' + escapeHtml(tmpl.description || '') + '</p>' +
        '</div>' +
        '<button onclick="setView(\'templatelibrary\')" class="text-sm font-bold text-slate-500 hover:text-slate-700">← Back</button>' +
        '</div>' +
        // Store + AM + Date
        '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">' +
        '<div><label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Store *</label>' +
        '<select id="fill-store" class="input-chip rounded-none w-full"><option value="">Select store...</option>' + storeOpts + '</select></div>' +
        '<div><label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Area Manager</label>' +
        '<select id="fill-am" class="input-chip rounded-none w-full"><option value="">Select...</option>' + amOpts + '</select></div>' +
        '<div><label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Date</label>' +
        '<input type="date" id="fill-date" class="input-chip rounded-none w-full" value="' + new Date().toISOString().substring(0, 10) + '"></div>' +
        '</div>' +
        // Questions
        '<div class="space-y-3 mb-6">' + questionsHtml + '</div>' +
        // Summary placeholder
        '<div id="fill-summary"></div>' +
        // Actions
        '<div class="flex gap-3 pt-4 border-t">' +
        '<button onclick="window._tplFillSave(\'' + tmpl.id + '\')" class="btn-primary rounded-none">Save Visit</button>' +
        '<button onclick="window._tplFillSummary(\'' + tmpl.id + '\')" class="btn-secondary rounded-none">Preview Summary</button>' +
        '<button onclick="setView(\'templatelibrary\')" class="bg-red-50 text-red-600 px-5 py-2.5 rounded-none font-bold">Cancel</button>' +
        '</div></div>';
};

window._tplFillSummary = async function(tmplId) {
    var values = {};
    var tmpl = await _getFormTemplate(tmplId);
    if (!tmpl) return;

    tmpl.fields.forEach(function(f) {
        var at = f.answerType || 'text';
        if (at === 'multichoice') {
            var checked = document.querySelector('.form-tpl-field.form-tpl-radio[data-tplfield="' + f.id + '"]:checked');
            values[f.id] = checked ? checked.value : '';
        } else if (at === 'score' || at === 'yesno' || at === 'rag') {
            var hidden = document.querySelector('input[type="hidden"].form-tpl-field[data-tplfield="' + f.id + '"]');
            values[f.id] = hidden ? hidden.value : '';
        } else {
            var el = document.querySelector('.form-tpl-field[data-tplfield="' + f.id + '"]');
            values[f.id] = el ? el.value : '';
        }
    });

    var summaryHtml = await _renderSummaryPanel(tmplId, values);
    var el = document.getElementById('fill-summary');
    if (el) el.innerHTML = summaryHtml || '<p class="text-sm text-slate-400">No scored fields to summarize.</p>';
};

window._tplFillSave = async function(tmplId) {
    var store = document.getElementById('fill-store')?.value;
    if (!store) { alert('Select a store.'); return; }

    var tmpl = await _getFormTemplate(tmplId);
    if (!tmpl) return;

    var values = {};
    tmpl.fields.forEach(function(f) {
        var at = f.answerType || 'text';
        if (at === 'multichoice') {
            var checked = document.querySelector('.form-tpl-field.form-tpl-radio[data-tplfield="' + f.id + '"]:checked');
            values[f.id] = checked ? checked.value : '';
        } else if (at === 'score' || at === 'yesno' || at === 'rag') {
            var hidden = document.querySelector('input[type="hidden"].form-tpl-field[data-tplfield="' + f.id + '"]');
            values[f.id] = hidden ? hidden.value : '';
        } else {
            var el = document.querySelector('.form-tpl-field[data-tplfield="' + f.id + '"]');
            values[f.id] = el ? el.value : '';
        }
    });

    var id = "DOC-" + Date.now();
    var data = {
        id: id,
        name: store + ' — ' + tmpl.name,
        creator: document.getElementById('fill-am')?.value || '',
        date: document.getElementById('fill-date')?.value || new Date().toISOString().substring(0, 10),
        type: 'Template: ' + tmpl.name,
        department: '',
        attentionOf: '',
        body: '',
        pin: '',
        status: 'Open',
        replies: [],
        formTemplateId: tmplId,
        formTemplateName: tmpl.name,
        formTemplateValues: values
    };

    await _cloudWriteDoc('Open', id, data);
    alert('Visit saved: ' + data.name);
    setView('templatelibrary');
};

window.renderTemplateBuilderPage = async function() {
    var editId = window._tplBuilderEditId || null;
    window._tplBuilderEditId = null;

    var existing = null;
    if (editId) {
        var all = await _tplLoadTemplates();
        existing = all.find(t => t.id === editId) || null;
    }

    window._bld = {
        tmpl: existing || {
            id: 'FTPL-' + Date.now(),
            name: '',
            description: '',
            fields: [],
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

    // Question cards on canvas
    var canvasHtml = '';
    if (b.previewMode) {
        canvasHtml = _bldRenderPreview(tmpl);
    } else if (!tmpl.fields.length) {
        canvasHtml = '<div class="flex flex-col items-center justify-center h-full text-center py-20">' +
            '<div class="text-6xl mb-4 opacity-20">📝</div>' +
            '<h3 class="text-lg font-black text-slate-400 mb-2">No Questions Yet</h3>' +
            '<p class="text-sm text-slate-400 max-w-sm">Click "Add Question" below to start building your visit form.</p>' +
            '</div>';
    } else {
        canvasHtml = tmpl.fields.map(function(f, i) {
            var at = TPL_ANSWER_TYPES.find(t => t.value === f.answerType) || TPL_ANSWER_TYPES[0];
            var active = b.selectedIdx === i;
            var selectedRing = active ? 'ring-2 ring-birds-green shadow-md' : '';
            var scoreLabel = f.scored ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 ml-1">SCORED</span>' : '';
            var preview = _bldQuestionPreview(f);

            return '<div class="rounded-xl border border-slate-200 bg-white p-4 transition-all cursor-pointer hover:border-slate-300 ' + selectedRing + '" ' +
                'onclick="window._bldSelectField(' + i + ')" ' +
                'draggable="true" ' +
                'ondragstart="window._bldDragStart(event, ' + i + ')" ' +
                'ondragover="event.preventDefault()" ' +
                'ondrop="window._bldDrop(event, ' + i + ')" ' +
                'ondragend="window._bldDragEnd()">' +
                '<div class="flex items-start gap-3">' +
                '<div class="flex flex-col items-center gap-1 pt-0.5">' +
                '<span class="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing text-sm select-none" title="Drag to reorder">⣿</span>' +
                '<button onclick="event.stopPropagation();window._bldMoveField(' + i + ', -1)" class="text-slate-300 hover:text-slate-600 text-xs" title="Move up">▲</button>' +
                '<button onclick="event.stopPropagation();window._bldMoveField(' + i + ', 1)" class="text-slate-300 hover:text-slate-600 text-xs" title="Move down">▼</button>' +
                '</div>' +
                '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-2 mb-1">' +
                '<span class="text-xs font-black text-slate-400">Q' + (i + 1) + '</span>' +
                '<span class="text-sm font-bold text-slate-800">' + escapeHtml(f.label || 'Untitled question') + '</span>' +
                scoreLabel +
                '<span class="text-[10px] text-slate-400 ml-auto">' + at.icon + ' ' + at.label + '</span>' +
                '</div>' +
                preview +
                '</div>' +
                '<button onclick="event.stopPropagation();window._bldRemoveField(' + i + ')" class="text-slate-300 hover:text-red-500 text-sm flex-shrink-0 mt-1" title="Remove">✕</button>' +
                '</div>' +
                '</div>';
        }).join('');
    }

    // Properties panel
    var propsHtml = '';
    if (b.selectedIdx >= 0 && tmpl.fields[b.selectedIdx] && !b.previewMode) {
        propsHtml = _bldQuestionProperties(tmpl.fields[b.selectedIdx]);
    } else if (!b.previewMode) {
        propsHtml = '<div class="text-center py-12 text-sm text-slate-400">' +
            '<div class="text-4xl mb-3 opacity-30">☝️</div>' +
            'Select a question to<br>edit its properties</div>';
    }

    // Build store list
    var storeNames = TPL_STORES;
    var storeOpts = storeNames.map(s => '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>').join('');

    el.innerHTML =
        // Header
        '<div class="card p-4 mb-4">' +
        '<div class="flex items-center gap-4 flex-wrap">' +
        '<button onclick="setView(\'templatelibrary\')" class="text-sm font-bold text-slate-500 hover:text-slate-700">← Library</button>' +
        '<div class="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">' +
        '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Form Name</label>' +
        '<input type="text" id="bld-page-name" value="' + escapeHtml(tmpl.name) + '" class="input-chip rounded-none w-full mt-1" placeholder="e.g. Q3 Store Visit" onchange="window._bldUpdateMeta()"></div>' +
        '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Description</label>' +
        '<input type="text" id="bld-page-desc" value="' + escapeHtml(tmpl.description) + '" class="input-chip rounded-none w-full mt-1" placeholder="What this form covers" onchange="window._bldUpdateMeta()"></div>' +
        '</div>' +
        '<div class="flex gap-2">' +
        '<button onclick="window._bldTogglePreview()" class="px-4 py-2 rounded-none text-sm font-bold ' + (b.previewMode ? 'bg-birds-green text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">' + (b.previewMode ? '← Edit' : 'Preview') + '</button>' +
        '<button onclick="window._bldSave()" class="btn-primary rounded-none px-6">Save Form</button>' +
        '</div>' +
        '</div>' +
        '</div>' +
        // Main: canvas + properties
        '<div class="flex gap-4" style="min-height: calc(100vh - 220px)">' +
        // Canvas
        '<div class="flex-1 card p-4 overflow-y-auto" style="max-height:calc(100vh - 260px)" ' +
        (!b.previewMode ? 'ondragover="event.preventDefault()" ondrop="window._bldCanvasDrop(event)"' : '') + '>' +
        '<div class="flex items-center justify-between mb-4">' +
        '<h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest">' + (b.previewMode ? 'PREVIEW' : 'QUESTIONS') + ' — ' + tmpl.fields.length + '</h3>' +
        (!b.previewMode ? '<button onclick="window._bldAddQuestion()" class="text-xs font-bold text-birds-green hover:underline">+ Add Question</button>' : '') +
        '</div>' +
        // Store dropdown always at top
        '<div class="bg-white rounded-xl border border-slate-200 p-4 mb-3">' +
        '<label class="text-sm font-bold text-slate-700 mb-1.5 block">Store</label>' +
        '<select class="input-chip rounded-none w-full" ' + (b.previewMode ? 'disabled' : '') + '>' +
        '<option value="">Select store...</option>' + storeOpts + '</select>' +
        '</div>' +
        '<div class="space-y-2">' + canvasHtml + '</div>' +
        '</div>' +
        // Properties sidebar
        (!b.previewMode ? '<div class="w-80 flex-shrink-0 card p-4 overflow-y-auto" style="max-height:calc(100vh - 260px)">' +
        '<h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Question Properties</h3>' +
        propsHtml +
        '</div>' : '') +
        '</div>';
}

/* ─── Question preview on canvas card ────────────────────────── */

function _bldQuestionPreview(f) {
    switch(f.answerType) {
        case 'text':
            return '<div class="mt-1 bg-slate-50 border border-slate-200 rounded px-3 py-1.5 text-sm text-slate-400">Text answer...</div>';
        case 'textarea':
            return '<div class="mt-1 bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs text-slate-400 h-10">Long text answer...</div>';
        case 'multichoice':
            var mc = (f.options || []).slice(0, 4).map(function(o) {
                return '<span class="inline-flex items-center gap-1 text-xs bg-slate-100 px-2 py-0.5 rounded mr-1"><span class="w-3 h-3 border border-slate-300 rounded-sm"></span>' + escapeHtml(o) + '</span>';
            }).join('');
            return '<div class="mt-1 flex flex-wrap gap-1">' + (mc || '<span class="text-xs text-slate-400">No options set</span>') + '</div>';
        case 'yesno':
            return '<div class="mt-1 flex gap-2"><span class="px-3 py-0.5 rounded bg-slate-100 text-xs font-bold text-slate-500">Yes</span><span class="px-3 py-0.5 rounded bg-slate-100 text-xs font-bold text-slate-500">No</span></div>';
        case 'rag':
            return '<div class="mt-1 flex gap-2"><span class="px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs font-bold">Red</span><span class="px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-bold">Amber</span><span class="px-2 py-0.5 rounded bg-green-100 text-green-700 text-xs font-bold">Green</span></div>';
        case 'score':
            var min = f.scoreMin || 1, max = f.scoreMax || 10;
            var btns = '';
            for (var s = min; s <= Math.min(max, min + 9); s++) {
                btns += '<span class="w-6 h-6 rounded bg-slate-100 text-slate-500 text-[10px] font-bold flex items-center justify-center">' + s + '</span>';
            }
            if (max > min + 9) btns += '<span class="text-xs text-slate-400">...' + max + '</span>';
            return '<div class="mt-1 flex flex-wrap gap-1">' + btns + '</div>';
        default:
            return '';
    }
}

/* ─── Question properties panel (right sidebar) ──────────────── */

function _bldQuestionProperties(f) {
    var at = TPL_ANSWER_TYPES.find(t => t.value === f.answerType) || TPL_ANSWER_TYPES[0];

    var html = '<div class="space-y-4">' +
        '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Question Text</label>' +
        '<textarea id="prop-label" class="w-full p-2 border border-slate-300 rounded-lg text-sm h-20" onchange="window._bldUpdateField()">' + escapeHtml(f.label) + '</textarea></div>' +
        '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Answer Type</label>' +
        '<select id="prop-type" class="input-chip rounded-none w-full" onchange="window._bldUpdateFieldType()">' +
        TPL_ANSWER_TYPES.map(function(t) {
            return '<option value="' + t.value + '" ' + (t.value === f.answerType ? 'selected' : '') + '>' + t.icon + ' ' + t.label + '</option>';
        }).join('') +
        '</select></div>';

    // Score toggle
    html += '<div class="bg-amber-50 border border-amber-200 rounded-lg p-3">' +
        '<label class="flex items-center gap-3 cursor-pointer">' +
        '<input type="checkbox" id="prop-scored" ' + (f.scored ? 'checked' : '') + ' onchange="window._bldUpdateField()" class="rounded">' +
        '<div><span class="text-sm font-bold text-amber-700">Score this question</span>' +
        '<p class="text-[10px] text-amber-500">Include in overall score calculation</p></div>' +
        '</label></div>';

    // Type-specific options
    if (f.answerType === 'multichoice') {
        html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Answer Options (one per line)</label>' +
            '<textarea id="prop-options" class="w-full h-28 p-2 border border-slate-300 rounded-lg text-sm font-mono" onchange="window._bldUpdateField()">' +
            escapeHtml((f.options || []).join('\n')) + '</textarea></div>';
    }

    if (f.answerType === 'score') {
        html += '<div class="grid grid-cols-2 gap-2">' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Min</label>' +
            '<input type="number" id="prop-scoremin" value="' + (f.scoreMin || 1) + '" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Max</label>' +
            '<input type="number" id="prop-scoremax" value="' + (f.scoreMax || 10) + '" class="input-chip rounded-none w-full" onchange="window._bldUpdateField()"></div>' +
            '</div>';
    }

    if (f.answerType === 'rag') {
        html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">RAG Labels</label>' +
            '<div class="space-y-1">' +
            '<input type="text" id="prop-ragred" value="' + escapeHtml(f.ragRedLabel || 'Fail / Critical') + '" class="input-chip rounded-none w-full text-xs" placeholder="Red label" onchange="window._bldUpdateField()">' +
            '<input type="text" id="prop-ragamber" value="' + escapeHtml(f.ragAmberLabel || 'Needs Improvement') + '" class="input-chip rounded-none w-full text-xs" placeholder="Amber label" onchange="window._bldUpdateField()">' +
            '<input type="text" id="prop-raggreen" value="' + escapeHtml(f.ragGreenLabel || 'Good / Pass') + '" class="input-chip rounded-none w-full text-xs" placeholder="Green label" onchange="window._bldUpdateField()">' +
            '</div></div>';
    }

    html += '</div>';
    return html;
}

/* ─── Canvas interactions ────────────────────────────────────── */

window._bldSelectField = function(idx) {
    window._bld.selectedIdx = idx;
    _bldRender();
};

window._bldAddQuestion = function() {
    var b = window._bld;
    var field = {
        id: 'field-' + Date.now() + '-' + Math.random().toString(36).substr(2,4),
        label: '',
        answerType: 'text',
        scored: false,
        options: undefined,
        scoreMin: undefined,
        scoreMax: undefined,
        ragRedLabel: undefined,
        ragAmberLabel: undefined,
        ragGreenLabel: undefined
    };
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
    var b = window._bld;
    b.tmpl.name = document.getElementById('bld-page-name')?.value || '';
    b.tmpl.description = document.getElementById('bld-page-desc')?.value || '';
};

window._bldUpdateField = function() {
    var b = window._bld;
    var idx = b.selectedIdx;
    if (idx < 0 || !b.tmpl.fields[idx]) return;
    var f = b.tmpl.fields[idx];

    var labelEl = document.getElementById('prop-label');
    var typeEl = document.getElementById('prop-type');
    var scoredEl = document.getElementById('prop-scored');

    if (labelEl) f.label = labelEl.value;
    if (typeEl) f.answerType = typeEl.value;
    if (scoredEl) f.scored = scoredEl.checked;

    if (f.answerType === 'multichoice') {
        var optEl = document.getElementById('prop-options');
        if (optEl) f.options = optEl.value.split('\n').map(s => s.trim()).filter(Boolean);
    }
    if (f.answerType === 'score') {
        var minEl = document.getElementById('prop-scoremin');
        var maxEl = document.getElementById('prop-scoremax');
        if (minEl) f.scoreMin = parseInt(minEl.value) || 1;
        if (maxEl) f.scoreMax = parseInt(maxEl.value) || 10;
    }
    if (f.answerType === 'rag') {
        var rr = document.getElementById('prop-ragred');
        var ra = document.getElementById('prop-ragamber');
        var rg = document.getElementById('prop-raggreen');
        if (rr) f.ragRedLabel = rr.value;
        if (ra) f.ragAmberLabel = ra.value;
        if (rg) f.ragGreenLabel = rg.value;
    }

    // Clean incompatible props
    if (f.answerType !== 'multichoice') delete f.options;
    if (f.answerType !== 'score') { delete f.scoreMin; delete f.scoreMax; }
    if (f.answerType !== 'rag') { delete f.ragRedLabel; delete f.ragAmberLabel; delete f.ragGreenLabel; }

    _bldRender();
};

window._bldUpdateFieldType = function() {
    var b = window._bld;
    var idx = b.selectedIdx;
    if (idx < 0 || !b.tmpl.fields[idx]) return;
    var f = b.tmpl.fields[idx];
    var newType = document.getElementById('prop-type')?.value || f.answerType;
    var oldType = f.answerType;

    f.answerType = newType;

    if (oldType !== newType) {
        if (newType === 'multichoice' && !f.options) f.options = ['Option 1', 'Option 2'];
        if (newType === 'score' && f.scoreMin === undefined) { f.scoreMin = 1; f.scoreMax = 10; f.scored = true; }
        if (newType === 'rag' && !f.ragRedLabel) { f.ragRedLabel = 'Fail / Critical'; f.ragAmberLabel = 'Needs Improvement'; f.ragGreenLabel = 'Good / Pass'; f.scored = true; }
    }

    _bldRender();
};

window._bldTogglePreview = function() {
    window._bld.previewMode = !window._bld.previewMode;
    _bldRender();
};

/* ─── Drag & Drop ────────────────────────────────────────────── */

window._bldDragStart = function(e, idx) {
    window._bld.dragIdx = idx;
    e.dataTransfer.setData('text/plain', 'reorder:' + idx);
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
};

window._bldDrop = function(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    var data = e.dataTransfer.getData('text/plain');
    var b = window._bld;

    if (data && data.startsWith('reorder:')) {
        var fromIdx = parseInt(data.replace('reorder:', ''));
        if (!isNaN(fromIdx) && fromIdx !== idx) {
            var temp = b.tmpl.fields.splice(fromIdx, 1)[0];
            b.tmpl.fields.splice(idx, 0, temp);
            b.selectedIdx = idx;
            _bldRender();
        }
    }
};

window._bldDragEnd = function() {
    window._bld.dragIdx = -1;
    document.querySelectorAll('.bld-canvas-field').forEach(function(el) { el.style.opacity = '1'; });
};

window._bldCanvasDrop = function(e) {
    e.preventDefault();
};

/* ─── Save ───────────────────────────────────────────────────── */

window._bldSave = async function() {
    var b = window._bld;
    var tmpl = b.tmpl;
    tmpl.name = document.getElementById('bld-page-name')?.value?.trim() || '';
    tmpl.description = document.getElementById('bld-page-desc')?.value?.trim() || '';
    if (!tmpl.name) { alert('Form name is required.'); return; }
    if (!tmpl.fields.length) { alert('Add at least one question.'); return; }
    // Validate questions have text
    var empty = tmpl.fields.find(f => !f.label?.trim());
    if (empty) { alert('All questions need question text.'); return; }
    await _tplSaveTemplate(tmpl);
    alert('Form saved: ' + tmpl.name);
    setView('templatelibrary');
};

/* ═══════════════════════════════════════════════════════════════
   LIVE PREVIEW — shows as it will appear when filled in
   ═══════════════════════════════════════════════════════════════ */

function _bldRenderPreview(tmpl) {
    var storeNames = TPL_STORES;
    var storeOpts = storeNames.map(s => '<option>' + escapeHtml(s) + '</option>').join('');

    var html = '<div class="max-w-2xl mx-auto">' +
        '<div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">' +
        '<h2 class="text-xl font-black text-slate-800 mb-1">' + escapeHtml(tmpl.name || 'Untitled Form') + '</h2>' +
        '<p class="text-sm text-slate-400 mb-4">' + escapeHtml(tmpl.description || '') + '</p>' +
        // Store dropdown
        '<div class="mb-6"><label class="text-sm font-bold text-slate-700 mb-1.5 block">Store</label>' +
        '<select class="input-chip rounded-none w-full" disabled><option>Select store...</option>' + storeOpts + '</select></div>' +
        '<div class="space-y-6">';

    tmpl.fields.forEach(function(f, i) {
        html += _bldPreviewQuestion(f, i);
    });

    html += '</div>' +
        // Summary preview
        '<div class="mt-6 pt-4 border-t border-slate-200 bg-slate-50 rounded-lg p-4">' +
        '<h4 class="text-sm font-black text-slate-500 uppercase tracking-widest mb-3">Summary</h4>' +
        '<div class="grid grid-cols-2 gap-3">' +
        '<div class="bg-white rounded p-3 text-center"><div class="text-2xl font-black text-slate-800">--</div><div class="text-[10px] text-slate-400">Score</div></div>' +
        '<div class="bg-white rounded p-3 text-center"><div class="text-2xl font-black text-slate-800">--</div><div class="text-[10px] text-slate-400">RAG</div></div>' +
        '</div></div>' +
        '</div></div>';
    return html;
}

function _bldPreviewQuestion(f, i) {
    var req = f.required ? ' <span class="text-red-500">*</span>' : '';
    var wrap = '<div class="form-group">';
    var label = '<label class="text-sm font-bold text-slate-700 mb-1.5 block"><span class="text-xs text-slate-400 mr-1">Q' + (i + 1) + '.</span> ' + escapeHtml(f.label || 'Question') + req + '</label>';

    switch(f.answerType) {
        case 'text':
            return wrap + label + '<input type="text" class="input-chip rounded-none w-full" placeholder="Type answer..."></div>';
        case 'textarea':
            return wrap + label + '<textarea class="w-full h-20 p-3 border border-slate-300 rounded-lg text-sm" placeholder="Type answer..."></textarea></div>';
        case 'multichoice':
            var mc = (f.options || []).map(function(o) {
                return '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-2 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="radio" name="preview-' + f.id + '" class="rounded"> ' + escapeHtml(o) + '</label>';
            }).join('');
            return wrap + label + '<div class="grid grid-cols-1 gap-1.5">' + mc + '</div></div>';
        case 'yesno':
            return wrap + label + '<div class="flex gap-2"><button type="button" class="px-6 py-2 rounded-lg font-bold bg-slate-100 text-slate-600 hover:bg-emerald-100 hover:text-emerald-700 transition-all">Yes</button><button type="button" class="px-6 py-2 rounded-lg font-bold bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-700 transition-all">No</button></div></div>';
        case 'rag':
            return wrap + label + '<div class="flex gap-2">' +
                '<button type="button" class="px-4 py-2 rounded-lg font-bold bg-red-100 text-red-700 hover:bg-red-200 transition-all">🔴 ' + escapeHtml(f.ragRedLabel || 'Red') + '</button>' +
                '<button type="button" class="px-4 py-2 rounded-lg font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-all">🟠 ' + escapeHtml(f.ragAmberLabel || 'Amber') + '</button>' +
                '<button type="button" class="px-4 py-2 rounded-lg font-bold bg-green-100 text-green-700 hover:bg-green-200 transition-all">🟢 ' + escapeHtml(f.ragGreenLabel || 'Green') + '</button>' +
                '</div></div>';
        case 'score':
            var min = f.scoreMin || 1, max = f.scoreMax || 10;
            var btns = '';
            for (var s = min; s <= max; s++) {
                btns += '<button type="button" class="w-9 h-9 rounded-lg text-sm font-bold bg-slate-100 text-slate-600 hover:bg-birds-green hover:text-white transition-all">' + s + '</button>';
            }
            return wrap + label + '<div class="flex flex-wrap gap-1.5">' + btns + '</div></div>';
        default:
            return '';
    }
}
