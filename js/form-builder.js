/* ─── Form Builder Module ───────────────────────────────────────── */
/* Admin creates custom forms → stores submit → HQ reviews.           */
/* Data: IDB 'form_templates' + 'form_submissions' + SharePoint.      */
/* ================================================================== */
window FormBuilder = (function() {
    'use strict';

    var FIELD_TYPES = [
        { type: 'text', label: 'Text', icon: 'T' },
        { type: 'textarea', label: 'Long Text', icon: '...' },
        { type: 'number', label: 'Number', icon: '#' },
        { type: 'select', label: 'Dropdown', icon: '▾' },
        { type: 'date', label: 'Date', icon: '📅' },
        { type: 'photo', label: 'Photo', icon: '📷' },
        { type: 'checkbox', label: 'Yes / No', icon: '☑' }
    ];

    var STATUS_PIPE = [
        { id: 'submitted', label: 'Submitted', color: '#3B82F6', bg: '#EFF6FF' },
        { id: 'in_review', label: 'In Review', color: '#D97706', bg: '#FEF3C7' },
        { id: 'approved', label: 'Approved', color: '#059669', bg: '#ECFDF5' },
        { id: 'rejected', label: 'Rejected', color: '#DC2626', bg: '#FEF2F2' },
        { id: 'completed', label: 'Completed', color: '#6B7280', bg: '#F3F4F6' }
    ];

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _uid() { return 'FB-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
    function _now() { return new Date().toISOString(); }
    function _today() { return new Date().toISOString().slice(0, 10); }

    /* ─── Data: Templates ──────────────────────────────────────── */
    async function _loadTemplates() {
        var templates = [];
        try { templates = await idbGetAll('form_templates'); } catch(e) {}
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try {
                var files = await GraphClient.listJsonFiles('Forms/Templates');
                for (var i = 0; i < files.length; i++) {
                    try {
                        var text = await GraphClient.readFile('Forms/Templates/' + files[i].name);
                        if (text) {
                            var t = JSON.parse(text);
                            if (!templates.find(function(x) { return x.id === t.id; })) templates.push(t);
                        }
                    } catch(e) {}
                }
            } catch(e) {}
        }
        return templates;
    }

    async function _saveTemplate(template) {
        await idbPut('form_templates', template);
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try {
                await GraphClient.ensureFolder('Forms/Templates');
                await GraphClient.writeFile('Forms/Templates/' + template.id + '.json', JSON.stringify(template, null, 2));
            } catch(e) {}
        }
    }

    async function _deleteTemplate(id) {
        await idbDelete('form_templates', id);
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try { await GraphClient.deleteFile('Forms/Templates/' + id + '.json'); } catch(e) {}
        }
    }

    /* ─── Data: Submissions ────────────────────────────────────── */
    async function _loadSubmissions() {
        var subs = [];
        try { subs = await idbGetAll('form_submissions'); } catch(e) {}
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try {
                var files = await GraphClient.listJsonFiles('Forms/Submissions');
                for (var i = 0; i < files.length; i++) {
                    try {
                        var text = await GraphClient.readFile('Forms/Submissions/' + files[i].name);
                        if (text) {
                            var s = JSON.parse(text);
                            if (!subs.find(function(x) { return x.id === s.id; })) subs.push(s);
                        }
                    } catch(e) {}
                }
            } catch(e) {}
        }
        subs.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        return subs;
    }

    async function _saveSubmission(sub) {
        await idbPut('form_submissions', sub);
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try {
                await GraphClient.ensureFolder('Forms/Submissions');
                await GraphClient.writeFile('Forms/Submissions/' + sub.id + '.json', JSON.stringify(sub, null, 2));
            } catch(e) {}
        }
    }

    function _csvEscape(val) {
        var s = String(val == null ? '' : val);
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function _downloadCSV(csv, filename) {
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /*  ADMIN: FORM BUILDER                                         */
    /* ═══════════════════════════════════════════════════════════════ */

    async function renderFormBuilder() {
        var templates = await _loadTemplates();
        var submissions = await _loadSubmissions();

        var html = '<div style="max-width:1000px;margin:0 auto;padding:8px;">'
            + '<div class="flex items-center justify-between mb-4">'
            + '<div><h2 class="text-2xl font-black text-slate-800">Form Builder</h2>'
            + '<p class="text-sm text-slate-400">' + templates.length + ' templates, ' + submissions.length + ' submissions</p></div>'
            + '<button onclick="FormBuilder.renderCreateTemplate()" style="background:#6E8E6D;color:#fff;padding:8px 16px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;">+ New Form</button>'
            + '</div>';

        if (!templates.length) {
            html += '<div class="card p-8 text-center"><p class="text-slate-400 mb-2">No form templates yet</p>'
                + '<button onclick="FormBuilder.renderCreateTemplate()" style="background:#6E8E6D;color:#fff;padding:8px 16px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;">Create your first form</button></div>';
        } else {
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">';
            templates.forEach(function(t) {
                var fieldCount = (t.fields || []).length;
                var subCount = submissions.filter(function(s) { return s.templateId === t.id; }).length;
                html += '<div class="card p-4" style="border-top:3px solid ' + (t.color || '#6E8E6D') + ';">'
                    + '<div class="flex items-center justify-between mb-2">'
                    + '<h3 class="text-sm font-black text-slate-800">' + _esc(t.name) + '</h3>'
                    + '<span style="font-size:18px;">' + (t.icon || '📋') + '</span></div>'
                    + '<p class="text-xs text-slate-400 mb-3">' + _esc(t.description || '') + '</p>'
                    + '<div class="flex items-center gap-2 text-[10px] text-slate-400 mb-3">'
                    + '<span>' + fieldCount + ' fields</span>'
                    + '<span>&middot;</span>'
                    + '<span>' + subCount + ' submissions</span>'
                    + '<span>&middot;</span>'
                    + '<span>' + _esc(t.visibleTo || 'all') + '</span></div>'
                    + '<div class="flex gap-2">'
                    + '<button onclick="FormBuilder.editTemplate(\'' + t.id + '\')" style="flex:1;background:#F1F5F9;color:#475569;padding:6px;border-radius:6px;border:none;font-size:11px;font-weight:700;cursor:pointer;">Edit</button>'
                    + '<button onclick="FormBuilder.previewTemplate(\'' + t.id + '\')" style="flex:1;background:#EFF6FF;color:#3B82F6;padding:6px;border-radius:6px;border:none;font-size:11px;font-weight:700;cursor:pointer;">Preview</button>'
                    + '<button onclick="if(confirm(\'Delete this form?\')) FormBuilder.deleteTemplateConfirm(\'' + t.id + '\')" style="background:#FEF2F2;color:#DC2626;padding:6px 10px;border-radius:6px;border:none;font-size:11px;font-weight:700;cursor:pointer;">&#128465;</button>'
                    + '</div></div>';
            });
            html += '</div>';
        }

        html += '</div>';
        document.getElementById('mainView').innerHTML = html;
    }

    function renderCreateTemplate() {
        _renderTemplateEditor(null);
    }

    function editTemplate(id) {
        _loadTemplates().then(function(templates) {
            var t = templates.find(function(x) { return x.id === id; });
            if (t) _renderTemplateEditor(t);
        });
    }

    function _renderTemplateEditor(template) {
        var isEdit = !!template;
        var name = template ? template.name : '';
        var desc = template ? template.description : '';
        var icon = template ? template.icon : '📋';
        var color = template ? (template.color || '#6E8E6D') : '#6E8E6D';
        var visibleTo = template ? (template.visibleTo || 'all') : 'all';
        var fields = template ? (template.fields || []) : [];
        var approvalRole = template ? (template.approvalRole || 'hq') : 'hq';

        var html = '<div style="max-width:700px;margin:0 auto;padding:8px;">'
            + '<div class="flex items-center justify-between mb-4">'
            + '<h2 class="text-xl font-black text-slate-800">' + (isEdit ? 'Edit Form' : 'Create Form') + '</h2>'
            + '<button onclick="FormBuilder.renderFormBuilder()" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;">&larr; Back</button></div>'
            + '<div class="card p-6">'
            + '<div class="space-y-4">'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Form Name</label>'
            + '<input id="fb-name" value="' + _esc(name) + '" placeholder="e.g. Stock Order, Maintenance Request" class="w-full p-3 border border-slate-200 rounded-lg text-sm font-bold"></div>'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Description</label>'
            + '<textarea id="fb-desc" class="w-full p-3 border border-slate-200 rounded-lg text-sm h-16" placeholder="What is this form for?">' + _esc(desc) + '</textarea></div>'
            + '<div class="grid grid-cols-3 gap-4">'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Icon</label>'
            + '<input id="fb-icon" value="' + _esc(icon) + '" class="w-full p-3 border border-slate-200 rounded-lg text-sm text-center"></div>'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Colour</label>'
            + '<input id="fb-color" type="color" value="' + color + '" class="w-full p-1 border border-slate-200 rounded-lg h-[42px]"></div>'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Visible To</label>'
            + '<select id="fb-visible" class="w-full p-3 border border-slate-200 rounded-lg text-sm">'
            + '<option value="all"' + (visibleTo === 'all' ? ' selected' : '') + '>All Stores</option>'
            + '<option value="shop"' + (visibleTo === 'shop' ? ' selected' : '') + '>Shop Only</option>'
            + '<option value="hq"' + (visibleTo === 'hq' ? ' selected' : '') + '>HQ Only</option>'
            + '</select></div></div>'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Approval Route</label>'
            + '<select id="fb-approval" class="w-full p-3 border border-slate-200 rounded-lg text-sm">'
            + '<option value="hq"' + (approvalRole === 'hq' ? ' selected' : '') + '>HQ / Area Manager</option>'
            + '<option value="it"' + (approvalRole === 'it' ? ' selected' : '') + '>I.T. Team</option>'
            + '<option value="admin"' + (approvalRole === 'admin' ? ' selected' : '') + '>Admin Only</option>'
            + '<option value="auto"' + (approvalRole === 'auto' ? ' selected' : '') + '>Auto-Approve</option>'
            + '</select></div></div>'
            /* Fields editor */
            + '<div class="mt-6 pt-4 border-t border-slate-100">'
            + '<div class="flex items-center justify-between mb-3">'
            + '<h3 class="text-sm font-black text-slate-600">Form Fields</h3>'
            + '<button onclick="FormBuilder._addField()" style="background:#6E8E6D;color:#fff;padding:4px 12px;border-radius:6px;border:none;font-size:11px;font-weight:700;cursor:pointer;">+ Add Field</button></div>'
            + '<div id="fb-fields" class="space-y-3">';

        fields.forEach(function(f, i) {
            html += _renderFieldEditor(f, i);
        });

        html += '</div></div>'
            + '<div class="mt-6 pt-4 border-t border-slate-100">'
            + '<button onclick="FormBuilder._saveTemplate(\'' + (isEdit ? template.id : '') + '\')" style="width:100%;background:#6E8E6D;color:#fff;padding:12px;border-radius:8px;border:none;font-size:13px;font-weight:800;cursor:pointer;">' + (isEdit ? 'Save Changes' : 'Create Form') + '</button>'
            + '</div></div></div>';

        document.getElementById('mainView').innerHTML = html;
    }

    function _renderFieldEditor(field, index) {
        var types = FIELD_TYPES.map(function(t) {
            return '<option value="' + t.type + '"' + ((field.type || 'text') === t.type ? ' selected' : '') + '>' + t.icon + ' ' + t.label + '</option>';
        }).join('');
        return '<div class="card p-3" data-field-idx="' + index + '" style="border-left:3px solid #E2E8F0;">'
            + '<div class="flex items-center gap-2 mb-2">'
            + '<span style="color:#94A3B8;font-size:14px;cursor:move;">⋮⋮</span>'
            + '<input type="text" value="' + _esc(field.label || '') + '" placeholder="Field label" class="flex-1 p-2 border border-slate-200 rounded text-sm font-bold fb-field-label">'
            + '<select class="p-2 border border-slate-200 rounded text-xs fb-field-type">' + types + '</select>'
            + '<label class="flex items-center gap-1 text-xs"><input type="checkbox" class="fb-field-required"' + (field.required ? ' checked' : '') + '> Req</label>'
            + '<button onclick="FormBuilder._removeField(' + index + ')" style="background:transparent;color:#DC2626;border:none;cursor:pointer;font-size:14px;">&#10005;</button>'
            + '</div>'
            + '<div class="fb-field-options" style="display:' + (field.type === 'select' ? 'block' : 'none') + ';">'
            + '<input type="text" value="' + _esc((field.options || []).join(', ')) + '" placeholder="Option 1, Option 2, Option 3" class="w-full p-2 border border-slate-200 rounded text-xs fb-field-options-input" style="font-style:italic;">'
            + '<p class="text-[10px] text-slate-400 mt-1">Comma-separated options</p></div>'
            + '</div>';
    }

    var _templateFields = [];

    function _addField() {
        _templateFields.push({ label: '', type: 'text', required: false, options: [] });
        _refreshFieldsUI();
    }

    function _removeField(idx) {
        _templateFields.splice(idx, 1);
        _refreshFieldsUI();
    }

    function _refreshFieldsUI() {
        var container = document.getElementById('fb-fields');
        if (!container) return;
        container.innerHTML = '';
        _templateFields.forEach(function(f, i) {
            container.innerHTML += _renderFieldEditor(f, i);
        });
        /* Show/hide options for select fields */
        container.querySelectorAll('.fb-field-type').forEach(function(sel, i) {
            sel.addEventListener('change', function() {
                _templateFields[i].type = this.value;
                var optDiv = this.closest('.card').querySelector('.fb-field-options');
                if (optDiv) optDiv.style.display = this.value === 'select' ? 'block' : 'none';
            });
        });
    }

    async function _saveTemplate(existingId) {
        var name = (document.getElementById('fb-name') || {}).value || '';
        if (!name.trim()) { alert('Please enter a form name'); return; }
        var desc = (document.getElementById('fb-desc') || {}).value || '';
        var icon = (document.getElementById('fb-icon') || {}).value || '📋';
        var color = (document.getElementById('fb-color') || {}).value || '#6E8E6D';
        var visibleTo = (document.getElementById('fb-visible') || {}).value || 'all';
        var approvalRole = (document.getElementById('fb-approval') || {}).value || 'hq';

        /* Collect fields from DOM */
        var fieldCards = document.querySelectorAll('#fb-fields .card');
        var fields = [];
        fieldCards.forEach(function(card) {
            var label = (card.querySelector('.fb-field-label') || {}).value || '';
            var type = (card.querySelector('.fb-field-type') || {}).value || 'text';
            var required = (card.querySelector('.fb-field-required') || {}).checked || false;
            var optionsStr = (card.querySelector('.fb-field-options-input') || {}).value || '';
            var options = optionsStr ? optionsStr.split(',').map(function(o) { return o.trim(); }).filter(Boolean) : [];
            if (label.trim()) fields.push({ label: label.trim(), type: type, required: required, options: options });
        });

        var template = {
            id: existingId || _uid(),
            name: name.trim(),
            description: desc.trim(),
            icon: icon,
            color: color,
            visibleTo: visibleTo,
            approvalRole: approvalRole,
            fields: fields,
            createdAt: existingId ? undefined : _now(),
            updatedAt: _now()
        };

        await _saveTemplate(template);
        showToast('Form saved', 'success');
        renderFormBuilder();
    }

    async function deleteTemplateConfirm(id) {
        await _deleteTemplate(id);
        showToast('Form deleted', 'success');
        renderFormBuilder();
    }

    function previewTemplate(id) {
        _loadTemplates().then(function(templates) {
            var t = templates.find(function(x) { return x.id === id; });
            if (!t) return;
            _renderSubmissionForm(t, true);
        });
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /*  STORE: SUBMIT FORM                                         */
    /* ═══════════════════════════════════════════════════════════════ */

    async function renderStoreForms() {
        var templates = await _loadTemplates();
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var role = user ? (typeof Users !== 'undefined' ? Users.getRole(user) : 'shop') : 'shop';

        /* Filter templates by visibility */
        templates = templates.filter(function(t) {
            if (t.visibleTo === 'all') return true;
            if (t.visibleTo === 'shop' && role === 'shop') return true;
            if (t.visibleTo === 'hq' && (role === 'hq' || role === 'admin' || role === 'area_manager')) return true;
            return false;
        });

        var html = '<div style="max-width:700px;margin:0 auto;padding:8px;">'
            + '<div class="mb-4">'
            + '<button onclick="setView(\'shop-home\')" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;padding:4px 0;">&larr; Back to Home</button>'
            + '<h2 class="text-2xl font-black text-slate-800 mt-1">Forms</h2>'
            + '<p class="text-sm text-slate-400">Submit requests and reports</p></div>';

        if (!templates.length) {
            html += '<div class="card p-8 text-center"><p class="text-slate-400">No forms available for your role.</p></div>';
        } else {
            templates.forEach(function(t) {
                html += '<div onclick="FormBuilder.renderSubmitForm(\'' + t.id + '\')" class="card p-4 mb-3 cursor-pointer hover:shadow-md transition-all" style="border-left:4px solid ' + (t.color || '#6E8E6D') + ';">'
                    + '<div class="flex items-center gap-3">'
                    + '<span style="font-size:24px;">' + (t.icon || '📋') + '</span>'
                    + '<div class="flex-1"><h3 class="text-sm font-black text-slate-800">' + _esc(t.name) + '</h3>'
                    + '<p class="text-xs text-slate-400">' + _esc(t.description || '') + '</p></div>'
                    + '<span style="color:#94A3B8;font-size:18px;">&#8250;</span></div></div>';
            });
        }
        html += '</div>';
        document.getElementById('mainView').innerHTML = html;
    }

    async function renderSubmitForm(templateId, isPreview) {
        var templates = await _loadTemplates();
        var t = templates.find(function(x) { return x.id === templateId; });
        if (!t) { alert('Form not found'); return; }

        _renderSubmissionForm(t, isPreview);
    }

    function _renderSubmissionForm(t, isPreview) {
        var html = '<div style="max-width:700px;margin:0 auto;padding:8px;">'
            + '<div class="mb-4">'
            + '<button onclick="' + (isPreview ? 'FormBuilder.renderFormBuilder()' : 'setView(\'shop-forms\')') + '" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;padding:4px 0;">&larr; ' + (isPreview ? 'Back to Builder' : 'Back to Forms') + '</button>'
            + '<h2 class="text-xl font-black text-slate-800 mt-1">' + (t.icon || '📋') + ' ' + _esc(t.name) + '</h2>'
            + '<p class="text-sm text-slate-400">' + _esc(t.description || '') + '</p></div>'
            + '<div class="card p-6">';

        if (isPreview) {
            html += '<div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:8px 12px;margin-bottom:16px;"><p class="text-xs font-bold text-amber-800">Preview Mode — submissions are not saved</p></div>';
        }

        html += '<div class="space-y-4">';
        (t.fields || []).forEach(function(f, i) {
            html += '<div>';
            html += '<label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">' + _esc(f.label) + (f.required ? ' *' : '') + '</label>';
            if (f.type === 'text') {
                html += '<input id="fbf-' + i + '" type="text" class="w-full p-3 border border-slate-200 rounded-lg text-sm" placeholder="Enter ' + _esc(f.label.toLowerCase()) + '">';
            } else if (f.type === 'textarea') {
                html += '<textarea id="fbf-' + i + '" class="w-full p-3 border border-slate-200 rounded-lg text-sm h-20" placeholder="Enter ' + _esc(f.label.toLowerCase()) + '"></textarea>';
            } else if (f.type === 'number') {
                html += '<input id="fbf-' + i + '" type="number" class="w-full p-3 border border-slate-200 rounded-lg text-sm" placeholder="0">';
            } else if (f.type === 'date') {
                html += '<input id="fbf-' + i + '" type="date" class="w-full p-3 border border-slate-200 rounded-lg text-sm">';
            } else if (f.type === 'select') {
                html += '<select id="fbf-' + i + '" class="w-full p-3 border border-slate-200 rounded-lg text-sm">'
                    + '<option value="">Select...</option>';
                (f.options || []).forEach(function(opt) {
                    html += '<option value="' + _esc(opt) + '">' + _esc(opt) + '</option>';
                });
                html += '</select>';
            } else if (f.type === 'checkbox') {
                html += '<label class="flex items-center gap-2"><input id="fbf-' + i + '" type="checkbox" class="w-5 h-5 accent-[#6E8E6D]"><span class="text-sm">Yes</span></label>';
            } else if (f.type === 'photo') {
                html += '<input id="fbf-' + i + '" type="file" accept="image/*" capture="environment" class="w-full p-3 border border-slate-200 rounded-lg text-sm">';
            }
            html += '</div>';
        });
        html += '</div>';

        if (!isPreview) {
            html += '<div class="mt-6 pt-4 border-t border-slate-100">'
                + '<button onclick="FormBuilder._submitForm(\'' + t.id + '\')" id="fbSubmitBtn" style="width:100%;background:#6E8E6D;color:#fff;padding:12px;border-radius:8px;border:none;font-size:13px;font-weight:800;cursor:pointer;">Submit</button></div>';
        }

        html += '</div></div>';
        document.getElementById('mainView').innerHTML = html;
    }

    async function _submitForm(templateId) {
        var templates = await _loadTemplates();
        var t = templates.find(function(x) { return x.id === templateId; });
        if (!t) return;

        var store = {};
        if (typeof ShopTools !== 'undefined' && ShopTools._getStoreInfo) {
            store = ShopTools._getStoreInfo();
        } else {
            var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
            store = { id: '', name: user ? user.name : '', email: user ? user.email : '' };
        }

        var answers = {};
        var missingRequired = false;
        (t.fields || []).forEach(function(f, i) {
            var el = document.getElementById('fbf-' + i);
            if (!el) return;
            var val = f.type === 'checkbox' ? el.checked : el.value;
            if (f.type === 'photo' && el.files && el.files[0]) {
                /* Read photo as base64 */
                var reader = new FileReader();
                reader.onload = function(e) { answers[f.label] = e.target.result; };
                reader.readAsDataURL(el.files[0]);
                val = '[photo]';
            }
            answers[f.label] = val;
            if (f.required && (!val || val === '' || val === false)) missingRequired = true;
        });

        if (missingRequired) { alert('Please fill in all required fields'); return; }

        var submission = {
            id: _uid(),
            templateId: t.id,
            templateName: t.name,
            storeId: store.id || '',
            storeName: store.name || '',
            storeEmail: store.email || '',
            answers: answers,
            status: t.approvalRole === 'auto' ? 'approved' : 'submitted',
            createdAt: _now(),
            responses: []
        };

        var btn = document.getElementById('fbSubmitBtn');
        if (btn) { btn.textContent = 'Submitting...'; btn.disabled = true; }

        await _saveSubmission(submission);
        showToast('Form submitted!', 'success');
        if (typeof setView === 'function') setView('shop-forms');
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /*  HQ/ADMIN: REVIEW DASHBOARD                                 */
    /* ═══════════════════════════════════════════════════════════════ */

    async function renderReviewDashboard(filter) {
        var submissions = await _loadSubmissions();
        var templates = await _loadTemplates();
        filter = filter || 'pending';

        var filtered = submissions.filter(function(s) {
            if (filter === 'pending') return s.status === 'submitted' || s.status === 'in_review';
            if (filter === 'approved') return s.status === 'approved';
            if (filter === 'rejected') return s.status === 'rejected';
            if (filter === 'completed') return s.status === 'completed';
            return true;
        });

        var pendingCount = submissions.filter(function(s) { return s.status === 'submitted'; }).length;
        var approvedCount = submissions.filter(function(s) { return s.status === 'approved'; }).length;
        var completedCount = submissions.filter(function(s) { return s.status === 'completed'; }).length;

        var html = '<div style="max-width:1100px;margin:0 auto;padding:8px;">'
            + '<div class="flex items-center justify-between mb-4">'
            + '<div><h2 class="text-2xl font-black text-slate-800">Form Submissions</h2>'
            + '<p class="text-sm text-slate-400">' + submissions.length + ' total</p></div>'
            + '<button onclick="FormBuilder.exportSubmissionsCSV()" style="background:#fff;color:#6E8E6D;font-size:11px;font-weight:700;padding:8px 16px;border-radius:6px;border:1px solid #6E8E6D;cursor:pointer;">Export CSV</button>'
            + '</div>'
            /* Stats */
            + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">'
            + '<div class="card p-4 text-center" style="border-top:3px solid #3B82F6;cursor:pointer;" onclick="FormBuilder.renderReviewDashboard(\'pending\')">'
            + '<p class="text-3xl font-black" style="color:#3B82F6;">' + pendingCount + '</p><p class="text-xs font-bold text-slate-400">Pending</p></div>'
            + '<div class="card p-4 text-center" style="border-top:3px solid #059669;cursor:pointer;" onclick="FormBuilder.renderReviewDashboard(\'approved\')">'
            + '<p class="text-3xl font-black" style="color:#059669;">' + approvedCount + '</p><p class="text-xs font-bold text-slate-400">Approved</p></div>'
            + '<div class="card p-4 text-center" style="border-top:3px solid #6B7280;cursor:pointer;" onclick="FormBuilder.renderReviewDashboard(\'completed\')">'
            + '<p class="text-3xl font-black" style="color:#6B7280;">' + completedCount + '</p><p class="text-xs font-bold text-slate-400">Completed</p></div>'
            + '</div>'
            /* Filter tabs */
            + '<div style="display:flex;gap:8px;margin-bottom:16px;">'
            + ['all','pending','approved','rejected','completed'].map(function(f) {
                return '<button onclick="FormBuilder.renderReviewDashboard(\'' + f + '\')" style="padding:6px 14px;border-radius:6px;border:1px solid ' + (filter === f ? '#6E8E6D' : '#E2E8F0') + ';background:' + (filter === f ? '#6E8E6D' : 'white') + ';color:' + (filter === f ? 'white' : '#64748B') + ';font-size:11px;font-weight:700;cursor:pointer;">' + f.charAt(0).toUpperCase() + f.slice(1) + '</button>';
            }).join('')
            + '</div>';

        if (!filtered.length) {
            html += '<div class="card p-8 text-center"><p class="text-slate-400">No submissions in this category</p></div>';
        } else {
            filtered.forEach(function(s) {
                var st = STATUS_PIPE.find(function(x) { return x.id === s.status; }) || STATUS_PIPE[0];
                html += '<div class="card p-4 mb-3 cursor-pointer hover:shadow-md transition-all" style="border-left:4px solid ' + st.color + ';" onclick="FormBuilder.renderSubmissionDetail(\'' + s.id + '\')">'
                    + '<div class="flex items-center justify-between">'
                    + '<div class="flex-1 min-w-0">'
                    + '<div class="flex items-center gap-2">'
                    + '<p class="text-sm font-bold text-slate-800">' + _esc(s.templateName || 'Form') + '</p>'
                    + '<span style="background:' + st.bg + ';color:' + st.color + ';font-size:9px;font-weight:700;padding:2px 8px;border-radius:9999px;">' + st.label + '</span></div>'
                    + '<p class="text-xs text-slate-400 mt-1">' + _esc(s.storeName || '') + ' &middot; ' + _esc((s.createdAt || '').slice(0, 10)) + '</p></div>'
                    + '<span style="color:#94A3B8;font-size:16px;">&#8250;</span></div></div>';
            });
        }
        html += '</div>';
        document.getElementById('mainView').innerHTML = html;
    }

    async function renderSubmissionDetail(subId) {
        var submissions = await _loadSubmissions();
        var s = submissions.find(function(x) { return x.id === subId; });
        if (!s) { alert('Submission not found'); return; }
        var templates = await _loadTemplates();
        var t = templates.find(function(x) { return x.id === s.templateId; });
        var st = STATUS_PIPE.find(function(x) { return x.id === s.status; }) || STATUS_PIPE[0];

        var html = '<div style="max-width:700px;margin:0 auto;padding:8px;">'
            + '<button onclick="FormBuilder.renderReviewDashboard()" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;padding:4px 0;">&larr; Back</button>'
            + '<div class="card p-6 mt-2" style="border-top:3px solid ' + st.color + ';">'
            + '<div class="flex items-center justify-between mb-4">'
            + '<div><h2 class="text-lg font-black text-slate-800">' + _esc(s.templateName || 'Form') + '</h2>'
            + '<p class="text-xs text-slate-400">' + _esc(s.storeName || '') + ' &middot; ' + _esc(s.createdAt || '') + '</p></div>'
            + '<span style="background:' + st.bg + ';color:' + st.color + ';font-size:11px;font-weight:700;padding:4px 12px;border-radius:9999px;">' + st.label + '</span></div>'
            /* Answers */
            + '<div class="space-y-3 mb-4">';
        Object.keys(s.answers || {}).forEach(function(key) {
            var val = s.answers[key];
            html += '<div><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">' + _esc(key) + '</p>';
            if (typeof val === 'string' && val.startsWith('data:image')) {
                html += '<img src="' + val + '" style="max-width:200px;border-radius:8px;margin-top:4px;">';
            } else {
                html += '<p class="text-sm text-slate-700">' + _esc(String(val)) + '</p>';
            }
            html += '</div>';
        });
        html += '</div>';

        /* Responses */
        if (s.responses && s.responses.length) {
            html += '<div class="mb-4"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Responses</p>';
            s.responses.forEach(function(r) {
                html += '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px;margin-bottom:6px;">'
                    + '<p class="text-xs font-bold text-slate-600">' + _esc(r.from || 'Unknown') + ' &middot; ' + _esc(r.at ? new Date(r.at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '') + '</p>'
                    + '<p class="text-sm text-slate-700 mt-1">' + _esc(r.note) + '</p></div>';
            });
            html += '</div>';
        }

        /* Actions */
        html += '<div class="pt-4 border-t border-slate-100">';
        if (s.status === 'submitted' || s.status === 'in_review') {
            html += '<textarea id="fb-review-note" rows="3" placeholder="Add a note (optional)..." class="w-full p-3 border border-slate-200 rounded-lg text-sm mb-3"></textarea>'
                + '<div class="flex gap-2">'
                + '<button onclick="FormBuilder._updateStatus(\'' + s.id + '\',\'approved\')" style="flex:1;background:#059669;color:#fff;padding:10px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;">Approve</button>'
                + '<button onclick="FormBuilder._updateStatus(\'' + s.id + '\',\'rejected\')" style="flex:1;background:#DC2626;color:#fff;padding:10px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;">Reject</button>'
                + '<button onclick="FormBuilder._addResponse(\'' + s.id + '\')" style="flex:1;background:#3B82F6;color:#fff;padding:10px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;">Respond</button>'
                + '</div>';
        } else if (s.status === 'approved') {
            html += '<button onclick="FormBuilder._updateStatus(\'' + s.id + '\',\'completed\')" style="width:100%;background:#6B7280;color:#fff;padding:10px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;">Mark Completed</button>';
        }
        html += '</div></div></div>';
        document.getElementById('mainView').innerHTML = html;
    }

    async function _updateStatus(subId, newStatus) {
        var submissions = await _loadSubmissions();
        var s = submissions.find(function(x) { return x.id === subId; });
        if (!s) return;
        var note = (document.getElementById('fb-review-note') || {}).value || '';
        s.status = newStatus;
        s.updatedAt = _now();
        if (!s.responses) s.responses = [];
        if (note) s.responses.push({ from: 'HQ', note: note, at: _now() });
        await _saveSubmission(s);
        showToast('Status updated', 'success');
        renderSubmissionDetail(subId);
    }

    async function _addResponse(subId) {
        var note = (document.getElementById('fb-review-note') || {}).value.trim();
        if (!note) { alert('Please type a response'); return; }
        var submissions = await _loadSubmissions();
        var s = submissions.find(function(x) { return x.id === subId; });
        if (!s) return;
        if (!s.responses) s.responses = [];
        s.responses.push({ from: 'HQ', note: note, at: _now() });
        s.updatedAt = _now();
        await _saveSubmission(s);
        showToast('Response sent', 'success');
        renderSubmissionDetail(subId);
    }

    /* ─── CSV Export ────────────────────────────────────────────── */
    async function exportSubmissionsCSV() {
        var submissions = await _loadSubmissions();
        if (!submissions.length) { alert('No submissions to export'); return; }
        var headers = ['ID','Template','Store','Status','Submitted','Updated'];
        /* Collect all unique field labels */
        var allFields = [];
        submissions.forEach(function(s) {
            Object.keys(s.answers || {}).forEach(function(k) {
                if (allFields.indexOf(k) < 0) allFields.push(k);
            });
        });
        headers = headers.concat(allFields);

        var rows = [headers.join(',')];
        submissions.forEach(function(s) {
            var row = [
                _csvEscape(s.id), _csvEscape(s.templateName), _csvEscape(s.storeName),
                _csvEscape(s.status), _csvEscape(s.createdAt), _csvEscape(s.updatedAt || '')
            ];
            allFields.forEach(function(f) {
                row.push(_csvEscape(s.answers ? s.answers[f] : ''));
            });
            rows.push(row.join(','));
        });
        _downloadCSV(rows.join('\n'), 'Form_Submissions_' + _today() + '.csv');
        showToast('Submissions exported', 'success');
    }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        renderFormBuilder: renderFormBuilder,
        renderCreateTemplate: renderCreateTemplate,
        editTemplate: editTemplate,
        deleteTemplateConfirm: deleteTemplateConfirm,
        previewTemplate: previewTemplate,
        renderStoreForms: renderStoreForms,
        renderSubmitForm: renderSubmitForm,
        renderReviewDashboard: renderReviewDashboard,
        renderSubmissionDetail: renderSubmissionDetail,
        exportSubmissionsCSV: exportSubmissionsCSV,
        _addField: _addField,
        _removeField: _removeField,
        _saveTemplate: _saveTemplate,
        _submitForm: _submitForm,
        _updateStatus: _updateStatus,
        _addResponse: _addResponse,
        FIELD_TYPES: FIELD_TYPES,
        STATUS_PIPE: STATUS_PIPE
    };
})();
