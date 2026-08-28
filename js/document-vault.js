/* ─── Document Vault Module ─────────────────────────────────────── */
/* Searchable document library with categories, tags, and store      */
/* folders. Stores see their own reports; HQ sees everything.        */
/* Data: SharePoint 'Documents/' folder + IDB cache.                  */
/* ================================================================== */
window.DocumentVault = (function() {
    'use strict';

    var _docs = [];
    var _loaded = false;

    var CATEGORIES = [
        { id: 'policies', label: 'Policies', icon: '📜', color: '#6E8E6D' },
        { id: 'sops', label: 'SOPs', icon: '📋', color: '#3B82F6' },
        { id: 'training', label: 'Training', icon: '📚', color: '#7C3AED' },
        { id: 'reports', label: 'Reports', icon: '📊', color: '#D97706' },
        { id: 'templates', label: 'Templates', icon: '📝', color: '#059669' },
        { id: 'other', label: 'Other', icon: '📁', color: '#6B7280' }
    ];

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _uid() { return 'DOC-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
    function _now() { return new Date().toISOString(); }
    function _today() { return new Date().toISOString().slice(0, 10); }

    /* ─── Data ──────────────────────────────────────────────────── */
    async function _loadDocs() {
        _docs = [];
        try { _docs = await idbGetAll('documents'); } catch(e) {}
        /* Try SharePoint */
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try {
                var files = await GraphClient.listJsonFiles('Documents');
                for (var i = 0; i < files.length; i++) {
                    try {
                        var text = await GraphClient.readFile('Documents/' + files[i].name);
                        if (text) {
                            var doc = JSON.parse(text);
                            if (!_docs.find(function(d) { return d.id === doc.id; })) _docs.push(doc);
                        }
                    } catch(e) {}
                }
            } catch(e) {}
        }
        _docs.sort(function(a, b) { return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''); });
        _loaded = true;
        return _docs;
    }

    async function _saveDoc(doc) {
        await idbPut('documents', doc);
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try {
                await GraphClient.ensureFolder('Documents');
                await GraphClient.writeFile('Documents/' + doc.id + '.json', JSON.stringify(doc, null, 2));
            } catch(e) {}
        }
    }

    async function _deleteDoc(id) {
        await idbDelete('documents', id);
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try { await GraphClient.deleteFile('Documents/' + id + '.json'); } catch(e) {}
        }
    }

    function _canSeeDoc(doc) {
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        if (!user) return true;
        if (typeof Users !== 'undefined' && Users.isAdmin && Users.isAdmin()) return true;
        /* Check area visibility */
        if (doc.areas && doc.areas.length) {
            var userAreas = (typeof Access !== 'undefined' && Access.getAllowedAreas) ? Access.getAllowedAreas() : [];
            if (userAreas.indexOf('all') < 0) {
                if (!doc.areas.some(function(a) { return userAreas.indexOf(a) >= 0; })) return false;
            }
        }
        /* Check store visibility */
        if (doc.storeIds && doc.storeIds.length) {
            var userStores = (typeof Access !== 'undefined' && Access.getAccessibleStores) ? Access.getAccessibleStores() : [];
            if (userStores.indexOf('all') < 0 && !doc.storeIds.some(function(s) { return userStores.indexOf(s) >= 0; })) return false;
        }
        return true;
    }

    function _csvEscape(val) {
        var s = String(val == null ? '' : val);
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /*  BROWSE VIEW                                                 */
    /* ═══════════════════════════════════════════════════════════════ */

    async function renderVault(searchTerm, categoryFilter) {
        await _loadDocs();
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var isAdmin = user && typeof Users !== 'undefined' && Users.isAdmin && Users.isAdmin();

        var visible = _docs.filter(function(d) { return _canSeeDoc(d); });

        /* Apply filters */
        if (searchTerm) {
            var term = searchTerm.toLowerCase();
            visible = visible.filter(function(d) {
                return (d.name || '').toLowerCase().indexOf(term) >= 0
                    || (d.description || '').toLowerCase().indexOf(term) >= 0
                    || (d.tags || []).join(' ').toLowerCase().indexOf(term) >= 0
                    || (d.category || '').toLowerCase().indexOf(term) >= 0;
            });
        }
        if (categoryFilter && categoryFilter !== 'all') {
            visible = visible.filter(function(d) { return d.category === categoryFilter; });
        }

        var catCounts = {};
        visible.forEach(function(d) {
            var cat = d.category || 'other';
            catCounts[cat] = (catCounts[cat] || 0) + 1;
        });

        var html = '<div style="max-width:1000px;margin:0 auto;padding:8px;">'
            + '<div class="flex items-center justify-between mb-4">'
            + '<div><h2 class="text-2xl font-black text-slate-800">Document Vault</h2>'
            + '<p class="text-sm text-slate-400">' + visible.length + ' documents</p></div>'
            + (isAdmin ? '<button onclick="DocumentVault.renderUploadForm()" style="background:#6E8E6D;color:#fff;padding:8px 16px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;">+ Upload</button>' : '')
            + '</div>'
            /* Search */
            + '<div class="mb-4">'
            + '<input id="dv-search" type="text" value="' + _esc(searchTerm || '') + '" placeholder="Search documents..." onkeyup="DocumentVault._onSearch()" class="w-full p-3 border border-slate-200 rounded-lg text-sm">'
            + '</div>'
            /* Category chips */
            + '<div class="flex flex-wrap gap-2 mb-4">'
            + '<button onclick="DocumentVault.renderVault(\'' + _esc(searchTerm || '') + '\',\'all\')" style="padding:6px 12px;border-radius:9999px;border:1px solid ' + (!categoryFilter || categoryFilter === 'all' ? '#6E8E6D' : '#E2E8F0') + ';background:' + (!categoryFilter || categoryFilter === 'all' ? '#6E8E6D' : 'white') + ';color:' + (!categoryFilter || categoryFilter === 'all' ? 'white' : '#64748B') + ';font-size:11px;font-weight:700;cursor:pointer;">All (' + visible.length + ')</button>';
        CATEGORIES.forEach(function(cat) {
            var count = catCounts[cat.id] || 0;
            if (count > 0) {
                html += '<button onclick="DocumentVault.renderVault(\'' + _esc(searchTerm || '') + '\',\'' + cat.id + '\')" style="padding:6px 12px;border-radius:9999px;border:1px solid ' + (categoryFilter === cat.id ? cat.color : '#E2E8F0') + ';background:' + (categoryFilter === cat.id ? cat.color : 'white') + ';color:' + (categoryFilter === cat.id ? 'white' : '#64748B') + ';font-size:11px;font-weight:700;cursor:pointer;">' + cat.icon + ' ' + cat.label + ' (' + count + ')</button>';
            }
        });
        html += '</div>';

        /* Document list */
        if (!visible.length) {
            html += '<div class="card p-8 text-center"><p class="text-slate-400">' + (searchTerm || categoryFilter ? 'No documents match your search' : 'No documents yet') + '</p></div>';
        } else {
            html += '<div class="space-y-2">';
            visible.forEach(function(d) {
                var cat = CATEGORIES.find(function(c) { return c.id === d.category; }) || CATEGORIES[5];
                var tags = (d.tags || []).map(function(t) {
                    return '<span style="background:#F1F5F9;color:#64748B;font-size:9px;font-weight:700;padding:2px 6px;border-radius:9999px;">' + _esc(t) + '</span>';
                }).join('');
                html += '<div class="card p-4 flex items-center gap-4 cursor-pointer hover:shadow-md transition-all" onclick="DocumentVault.viewDocument(\'' + d.id + '\')">'
                    + '<div style="width:40px;height:40px;border-radius:8px;background:' + cat.color + '22;display:flex;align-items:center;justify-content:center;font-size:20px;">' + cat.icon + '</div>'
                    + '<div class="flex-1 min-w-0">'
                    + '<p class="text-sm font-bold text-slate-800 truncate">' + _esc(d.name) + '</p>'
                    + '<p class="text-[10px] text-slate-400">' + cat.label + ' &middot; ' + _esc(d.updatedAt ? new Date(d.updatedAt).toLocaleDateString('en-GB') : (d.createdAt || '').slice(0, 10)) + '</p>'
                    + (tags ? '<div class="flex gap-1 mt-1">' + tags + '</div>' : '')
                    + '</div>'
                    + '<span style="color:#94A3B8;font-size:16px;">&#8250;</span></div>';
            });
            html += '</div>';
        }

        html += '</div>';
        document.getElementById('mainView').innerHTML = html;
    }

    function _onSearch() {
        var term = (document.getElementById('dv-search') || {}).value || '';
        clearTimeout(window._dvSearchTimer);
        window._dvSearchTimer = setTimeout(function() {
            renderVault(term, window._dvCategoryFilter || '');
        }, 300);
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /*  UPLOAD FORM                                                 */
    /* ═══════════════════════════════════════════════════════════════ */

    function renderUploadForm(doc) {
        var isEdit = !!doc;
        var catOptions = CATEGORIES.map(function(c) {
            return '<option value="' + c.id + '"' + ((doc ? doc.category : '') === c.id ? ' selected' : '') + '>' + c.icon + ' ' + c.label + '</option>';
        }).join('');

        var html = '<div style="max-width:700px;margin:0 auto;padding:8px;">'
            + '<div class="flex items-center justify-between mb-4">'
            + '<h2 class="text-xl font-black text-slate-800">' + (isEdit ? 'Edit Document' : 'Upload Document') + '</h2>'
            + '<button onclick="DocumentVault.renderVault()" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;">&larr; Back</button></div>'
            + '<div class="card p-6">'
            + '<div class="space-y-4">'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Document Name *</label>'
            + '<input id="dv-name" value="' + _esc(doc ? doc.name : '') + '" class="w-full p-3 border border-slate-200 rounded-lg text-sm font-bold" placeholder="e.g. Food Safety Policy v3"></div>'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Description</label>'
            + '<textarea id="dv-desc" class="w-full p-3 border border-slate-200 rounded-lg text-sm h-16" placeholder="Brief description...">' + _esc(doc ? doc.description : '') + '</textarea></div>'
            + '<div class="grid grid-cols-2 gap-4">'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Category</label>'
            + '<select id="dv-cat" class="w-full p-3 border border-slate-200 rounded-lg text-sm">' + catOptions + '</select></div>'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Tags</label>'
            + '<input id="dv-tags" value="' + _esc(doc ? (doc.tags || []).join(', ') : '') + '" class="w-full p-3 border border-slate-200 rounded-lg text-sm" placeholder="comma, separated, tags"></div></div>'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Document URL or Link</label>'
            + '<input id="dv-url" value="' + _esc(doc ? doc.url : '') + '" class="w-full p-3 border border-slate-200 rounded-lg text-sm" placeholder="https://... or SharePoint path"></div>'
            + '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">File Upload</label>'
            + '<input id="dv-file" type="file" class="w-full p-3 border border-slate-200 rounded-lg text-sm"></div>'
            + '</div>'
            + '<div class="mt-6 pt-4 border-t border-slate-100">'
            + '<button onclick="DocumentVault._saveDocument(\'' + (isEdit ? doc.id : '') + '\')" style="width:100%;background:#6E8E6D;color:#fff;padding:12px;border-radius:8px;border:none;font-size:13px;font-weight:800;cursor:pointer;">' + (isEdit ? 'Save Changes' : 'Upload Document') + '</button>'
            + '</div></div></div>';

        document.getElementById('mainView').innerHTML = html;
    }

    async function _saveDocument(existingId) {
        var name = (document.getElementById('dv-name') || {}).value || '';
        if (!name.trim()) { alert('Please enter a document name'); return; }
        var desc = (document.getElementById('dv-desc') || {}).value || '';
        var cat = (document.getElementById('dv-cat') || {}).value || 'other';
        var tagsStr = (document.getElementById('dv-tags') || {}).value || '';
        var tags = tagsStr ? tagsStr.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
        var url = (document.getElementById('dv-url') || {}).value || '';

        var doc = {
            id: existingId || _uid(),
            name: name.trim(),
            description: desc.trim(),
            category: cat,
            tags: tags,
            url: url,
            createdAt: existingId ? undefined : _now(),
            updatedAt: _now(),
            areas: [],
            storeIds: []
        };

        await _saveDoc(doc);
        showToast('Document saved', 'success');
        renderVault();
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /*  DOCUMENT DETAIL                                             */
    /* ═══════════════════════════════════════════════════════════════ */

    async function viewDocument(docId) {
        await _loadDocs();
        var doc = _docs.find(function(d) { return d.id === docId; });
        if (!doc) { alert('Document not found'); return; }
        var cat = CATEGORIES.find(function(c) { return c.id === doc.category; }) || CATEGORIES[5];
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var isAdmin = user && typeof Users !== 'undefined' && Users.isAdmin && Users.isAdmin();

        var tags = (doc.tags || []).map(function(t) {
            return '<span style="background:#F1F5F9;color:#64748B;font-size:10px;font-weight:700;padding:3px 10px;border-radius:9999px;">' + _esc(t) + '</span>';
        }).join('');

        var html = '<div style="max-width:700px;margin:0 auto;padding:8px;">'
            + '<button onclick="DocumentVault.renderVault()" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;padding:4px 0;">&larr; Back</button>'
            + '<div class="card p-6 mt-2" style="border-top:3px solid ' + cat.color + ';">'
            + '<div class="flex items-start justify-between mb-4">'
            + '<div>'
            + '<h2 class="text-lg font-black text-slate-800">' + _esc(doc.name) + '</h2>'
            + '<p class="text-xs text-slate-400 mt-1">' + cat.icon + ' ' + cat.label + ' &middot; Updated ' + _esc(doc.updatedAt ? new Date(doc.updatedAt).toLocaleDateString('en-GB') : '') + '</p>'
            + '</div>'
            + (isAdmin ? '<div class="flex gap-2">'
            + '<button onclick="DocumentVault.editDocument(\'' + doc.id + '\')" style="background:#F1F5F9;color:#475569;padding:6px 12px;border-radius:6px;border:none;font-size:11px;font-weight:700;cursor:pointer;">Edit</button>'
            + '<button onclick="if(confirm(\'Delete?\')) DocumentVault._deleteAndReturn(\'' + doc.id + '\')" style="background:#FEF2F2;color:#DC2626;padding:6px 12px;border-radius:6px;border:none;font-size:11px;font-weight:700;cursor:pointer;">Delete</button>'
            + '</div>' : '')
            + '</div>';

        if (doc.description) {
            html += '<div style="margin-bottom:16px;"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Description</p>'
                + '<p class="text-sm text-slate-600" style="white-space:pre-wrap;">' + _esc(doc.description) + '</p></div>';
        }

        if (tags) {
            html += '<div style="margin-bottom:16px;"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tags</p>'
                + '<div class="flex flex-wrap gap-1">' + tags + '</div></div>';
        }

        if (doc.url) {
            html += '<div style="margin-bottom:16px;"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Link</p>'
                + '<a href="' + _esc(doc.url) + '" target="_blank" style="color:#3B82F6;font-size:13px;font-weight:700;text-decoration:underline;">' + _esc(doc.url) + '</a></div>';
        }

        html += '</div></div>';
        document.getElementById('mainView').innerHTML = html;
    }

    function editDocument(docId) {
        _loadDocs().then(function(docs) {
            var doc = docs.find(function(d) { return d.id === docId; });
            if (doc) renderUploadForm(doc);
        });
    }

    async function _deleteAndReturn(docId) {
        await _deleteDoc(docId);
        showToast('Document deleted', 'success');
        renderVault();
    }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        renderVault: renderVault,
        renderUploadForm: renderUploadForm,
        viewDocument: viewDocument,
        editDocument: editDocument,
        _onSearch: _onSearch,
        _saveDocument: _saveDocument,
        _deleteAndReturn: _deleteAndReturn,
        CATEGORIES: CATEGORIES
    };
})();
