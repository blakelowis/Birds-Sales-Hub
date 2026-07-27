window.currentLoadedDocs = { open: [], resolved: [], archived: [] };
window.unlockedDocs = new Set();
window.currentUserFolder = null;
window.unlockedFolders = new Set();
var _busyOps = new Set();

window._openLinkedDoc = function(docId) {
    var folders = ['open', 'resolved', 'archived'];
    for (var i = 0; i < folders.length; i++) {
        var docs = window.currentLoadedDocs[folders[i]] || [];
        var found = docs.find(function(d) { return d.id === docId; });
        if (found) { openDocumentViewer(docId, folders[i], found.userFolderId || ''); return; }
    }
    showToast('Linked document not found. It may have been deleted.', 'error');
};

function _getDocDepartments() {
    var base = (typeof Users !== 'undefined' && Users.getDepartments) ? Users.getDepartments() : ['General'];
    return base.concat(['+ Add Custom Department...']);
}

window.Documents = window.Documents || {};
Documents._onDocDeptChange = function(sel) {
    if (!sel) return;
    if (sel.value === '+ Add Custom Department...') {
        var name = prompt('Enter new department name:');
        if (!name || !name.trim()) { sel.value = ''; return; }
        if (typeof Users !== 'undefined' && Users.addDepartment) {
            Users.addDepartment(name.trim()).then(function(added) {
                if (added) { showToast('Department "' + name.trim() + '" added', 'success'); }
                else { showToast('Department already exists', 'warning'); }
                /* Re-render the create form to reflect new department list */
                if (typeof renderCreateDocument === 'function') renderCreateDocument();
            });
        }
    }
};

/* ─── Cloud helpers ──────────────────────────────────────────── */
function _isDocsCloud() {
    return false; /* Test mode — force local storage for document isolation */
}

/* ─── Local IndexedDB fallback for documents ──────────────────── */
var _localDocsDB = 'birds_documents';
async function _localDocsInit() {
    return new Promise(function(resolve) {
        try {
        var req = indexedDB.open(_localDocsDB, 1);
        req.onupgradeneeded = function(e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
        };
        req.onsuccess = function(e) { window._localDocsConnection = e.target.result; resolve(); };
        req.onerror = function() { window._localDocsConnection = null; resolve(); };
        } catch(e) { window._localDocsConnection = null; resolve(); }
    });
}
async function _localDocsGet(folder) {
    if (!window._localDocsConnection) await _localDocsInit();
    if (!window._localDocsConnection) {
        return _masterFolderDocs(folder);
    }
    return new Promise(function(resolve) {
        try {
        var tx = window._localDocsConnection.transaction('files', 'readonly');
        var store = tx.objectStore('files');
        var results = [];
        var deletedIds = {};
        var req = store.openCursor();
        req.onsuccess = function(e) {
            var cursor = e.target.result;
            if (cursor) {
                var p = cursor.value.path;
                if (p && p.indexOf('__deleted__/') === 0) {
                    try {
                        var info = cursor.value.data;
                        if (info && info.folder === folder) deletedIds[info.id] = true;
                    } catch(ex) {}
                } else if (p && p.indexOf('Documents/' + folder + '/') === 0) {
                    try { results.push(JSON.parse(cursor.value.data)); } catch(ex) {}
                }
                cursor.continue();
            } else {
                if (results.length) { resolve(results); return; }
                _masterFolderDocs(folder).then(function(docs) {
                    if (docs.length > 0) {
                        var puts = [];
                        docs.forEach(function(d) {
                            if (d && d.id && !deletedIds[d.id]) {
                                puts.push(_localDocsPut(folder, d.id, d));
                            }
                        });
                        docs = docs.filter(function(d) { return d && d.id && !deletedIds[d.id]; });
                        Promise.all(puts).then(function() { resolve(docs); });
                    } else {
                        resolve(docs);
                    }
                });
            }
        };
        req.onerror = function() {
            _masterFolderDocs(folder).then(resolve);
        };
        } catch(e) {
            _masterFolderDocs(folder).then(resolve);
        }
    });
}

async function _masterFolderDocs(folder) {
    if (!directoryHandle) return [];
    var paths = [
        'Documents/' + folder,
        'Data/Documents/' + folder,
        'Master Folder/Data/Documents/' + folder,
        'Data/' + folder,
        folder
    ];
    for (var path of paths) {
        var parts = path.split('/').filter(Boolean);
        var handle = directoryHandle;
        try {
            for (var part of parts) handle = await handle.getDirectoryHandle(part);
            var docs = [];
            for await (var entry of handle.values()) {
                if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.json')) continue;
                try {
                    var data = JSON.parse(await (await entry.getFile()).text());
                    if (data && typeof data === 'object') docs.push(data);
                } catch (e) {}
            }
            if (docs.length) return docs;
        } catch (e) {}
    }
    return [];
}
async function _localDocsPut(folder, id, data) {
    if (!window._localDocsConnection) await _localDocsInit();
    /* Save to IDB */
    if (window._localDocsConnection) {
        try {
            var tx = window._localDocsConnection.transaction('files', 'readwrite');
            tx.objectStore('files').put({ path: 'Documents/' + folder + '/' + id + '.json', data: JSON.stringify(data) });
        } catch(e) {}
    }
    /* Save to filesystem (shared across users) */
    if (typeof directoryHandle !== 'undefined' && directoryHandle) {
        try {
            var dir = await directoryHandle.getDirectoryHandle('Documents', { create: true });
            var subDir = await dir.getDirectoryHandle(folder, { create: true });
            var fh = await subDir.getFileHandle(id + '.json', { create: true });
            var w = await fh.createWritable();
            await w.write(JSON.stringify(data, null, 2));
            await w.close();
        } catch(e) { console.warn('[Docs] Filesystem save failed:', e.message); }
    }
}
async function _localDocsDelete(folder, id) {
    if (!window._localDocsConnection) await _localDocsInit();
    /* Try to also delete from filesystem */
    if (typeof directoryHandle !== 'undefined' && directoryHandle) {
        var fsPaths = ['Documents/' + folder, 'Data/Documents/' + folder, 'Master Folder/Data/Documents/' + folder];
        for (var fp of fsPaths) {
            try {
                var h = directoryHandle;
                for (var part of fp.split('/').filter(Boolean)) h = await h.getDirectoryHandle(part);
                await h.removeEntry(id + '.json');
            } catch (e) { /* file may not exist on this path */ }
        }
    }
    /* Delete from IDB + write tombstone */
    if (!window._localDocsConnection) return;
    return new Promise(function(resolve) {
        var tx = window._localDocsConnection.transaction('files', 'readwrite');
        var store = tx.objectStore('files');
        store.delete('Documents/' + folder + '/' + id + '.json');
        store.put({ path: '__deleted__/' + folder + '/' + id, data: { folder: folder, id: id, ts: Date.now() } });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { resolve(); };
    });
}
async function _localDocsGetText(path) {
    if (!window._localDocsConnection) await _localDocsInit();
    if (!window._localDocsConnection) return null;
    return new Promise(function(resolve) {
        var tx = window._localDocsConnection.transaction('files', 'readonly');
        var req = tx.objectStore('files').get(path);
        req.onsuccess = function(e) { resolve(e.target.result ? e.target.result.data : null); };
        req.onerror = function() { resolve(null); };
    });
}

async function _localDocsGetTextFromMasterFolder(paths) {
    if (!directoryHandle) return null;
    for (var path of paths) {
        var parts = path.split('/').filter(Boolean);
        var handle = directoryHandle;
        try {
            for (var part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part);
            var fileHandle = await handle.getFileHandle(parts[parts.length - 1]);
            return await (await fileHandle.getFile()).text();
        } catch (e) {}
    }
    return null;
}
async function _localDocsPutText(path, text) {
    if (!window._localDocsConnection) await _localDocsInit();
    /* Save to IDB */
    if (window._localDocsConnection) {
        try {
            var tx = window._localDocsConnection.transaction('files', 'readwrite');
            tx.objectStore('files').put({ path: path, data: text });
        } catch(e) {}
    }
    /* Save to filesystem (shared across users) */
    if (typeof directoryHandle !== 'undefined' && directoryHandle) {
        try {
            var parts = path.split('/').filter(Boolean);
            var handle = directoryHandle;
            for (var i = 0; i < parts.length - 1; i++) {
                handle = await handle.getDirectoryHandle(parts[i], { create: true });
            }
            var fh = await handle.getFileHandle(parts[parts.length - 1], { create: true });
            var w = await fh.createWritable();
            await w.write(text);
            await w.close();
        } catch(e) { console.warn('[Docs] Filesystem text save failed:', e.message); }
    }
}

/* ─── Cloud helpers that use local storage ──────────────────── */
async function _cloudListDocs(folder) { return await _localDocsGet(folder); }
async function _cloudWriteDoc(folder, id, data) { await _localDocsPut(folder, id, data); }
async function _cloudDeleteDoc(folder, id) { await _localDocsDelete(folder, id); }
async function _cloudMoveDoc(fromFolder, toFolder, id) {
    var data = await _localDocsGetText('Documents/' + fromFolder + '/' + id + '.json');
    if (data) {
        await _localDocsPutText('Documents/' + toFolder + '/' + id + '.json', data);
        await _localDocsDelete(fromFolder, id);
        try { return JSON.parse(data); } catch (e) { return null; }
    }
    return null;
}
async function _cloudGetDoc(folder, id) {
    var data = await _localDocsGetText('Documents/' + folder + '/' + id + '.json');
    if (data) { try { return JSON.parse(data); } catch (e) { return null; } }
    // Fallback: try reading from the file system directly
    var text = await _localDocsGetTextFromMasterFolder(['Documents/' + folder + '/' + id + '.json', folder + '/' + id + '.json']);
    if (text) {
        try { var doc = JSON.parse(text); } catch (e) { return null; }
        await _localDocsPut(folder, id, doc);
        return doc;
    }
    return null;
}
async function _cloudReadEvidence(fileName) {
    if (!window._localDocsConnection) await _localDocsInit();
    if (!window._localDocsConnection) return null;
    return new Promise(function(resolve) {
        var tx = window._localDocsConnection.transaction('files', 'readonly');
        var req = tx.objectStore('files').get('Evidence/' + fileName);
        req.onsuccess = function(e) { resolve(e.target.result ? e.target.result.data : null); };
        req.onerror = function() { resolve(null); };
    });
}
async function _cloudWriteEvidence(fileName, file) {
    if (!window._localDocsConnection) await _localDocsInit();
    if (!window._localDocsConnection) return;
    return new Promise(function(resolve) {
        var reader = new FileReader();
        reader.onload = function() {
            var tx = window._localDocsConnection.transaction('files', 'readwrite');
            tx.objectStore('files').put({ path: 'Evidence/' + fileName, data: reader.result });
            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() { resolve(); };
        };
        reader.onerror = function() { resolve(); };
        reader.readAsDataURL(file);
    });
}

/* ─── User Folder Manifest (local storage) ──────────────────── */
async function _loadFolderManifest() {
    try {
        var text = await _localDocsGetText('Documents/folders.json');
        return text ? JSON.parse(text).folders || [] : [];
    } catch(e) { return []; }
}

async function _saveFolderManifest(folders) {
    await _localDocsPutText('Documents/folders.json', JSON.stringify({ folders }, null, 2));
}

async function _createUserFolder(name, pin) {
    var folders = await _loadFolderManifest();
    var id = _uid('FOLDER-');
    folders.push({ id, name, pin: pin || '', created: new Date().toISOString().substring(0, 10) });
    await _saveFolderManifest(folders);
    return id;
}

async function _deleteUserFolder(id) {
    var folders = await _loadFolderManifest();
    folders = folders.filter(f => f.id !== id);
    await _saveFolderManifest(folders);
    for (var status of ['Open', 'Resolved', 'Archive']) {
        var docs = await _cloudListDocs(status);
        for (var doc of docs) {
            if (doc.userFolderId === id) { delete doc.userFolderId; await _cloudWriteDoc(status, doc.id, doc); }
        }
    }
}

async function _renameUserFolder(id, newName) {
    var folders = await _loadFolderManifest();
    var f = folders.find(f => f.id === id);
    if (f) { f.name = newName; await _saveFolderManifest(folders); }
}

async function _setFolderPin(id, pin) {
    var folders = await _loadFolderManifest();
    var f = folders.find(f => f.id === id);
    if (f) { f.pin = pin; await _saveFolderManifest(folders); }
}

async function _getFolderById(id) {
    var folders = await _loadFolderManifest();
    return folders.find(f => f.id === id) || null;
}

async function _isFolderUnlocked(id) {
    if (!id) return true;
    if (window.unlockedFolders.has(id)) return true;
    var folder = await _getFolderById(id);
    if (!folder || !folder.pin) return true;
    return false;
}

async function _promptFolderPin(id) {
    var folder = await _getFolderById(id);
    if (!folder || !folder.pin) return true;
    var input = prompt('Enter PIN for folder "' + folder.name + '":');
    if (input === folder.pin) { window.unlockedFolders.add(id); return true; }
    showToast('Incorrect PIN.', 'error');
    return false;
}

function renderUserFolderList() {
    var container = document.getElementById('user-folders-container');
    if (!container) return;
    _loadFolderManifest().then(function(folders) {
        if (!folders.length) { container.innerHTML = '<p class="text-xs text-slate-400 italic">No custom folders yet.</p>'; return; }
        container.innerHTML = folders.map(function(f) {
            var isActive = window.currentUserFolder === f.id;
            var pinBadge = f.pin ? ' <span class="text-amber-500">🔒</span>' : '';
            return '<button onclick="enterUserFolder(\'' + f.id + '\')" class="px-3 py-2 rounded-none text-sm font-bold transition-all ' +
                (isActive ? 'bg-birds-green text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">' +
                escapeHtml(f.name) + pinBadge + '</button>';
        }).join('');
    });
}

window.enterUserFolder = async function(id) {
    var ok = await _isFolderUnlocked(id);
    if (!ok) { var unlocked = await _promptFolderPin(id); if (!unlocked) return; }
    window.currentUserFolder = id;
    renderDocuments(true);
};

window.renameUserFolderPrompt = async function(id) {
    var folder = await _getFolderById(id);
    if (!folder) return;
    var newName = prompt('Rename folder:', folder.name);
    if (newName && newName.trim()) { await _renameUserFolder(id, newName.trim()); renderDocuments(true); }
};

window.deleteUserFolderConfirm = async function(id) {
    var folder = await _getFolderById(id);
    if (!folder) return;
    if (!confirm('Delete folder "' + folder.name + '"? Documents will remain in their status folders.')) return;
    await _deleteUserFolder(id);
    if (window.currentUserFolder === id) window.currentUserFolder = null;
    renderDocuments(true);
};

window.changeFolderPin = async function(id) {
    var folder = await _getFolderById(id);
    if (!folder) return;
    var newPin = prompt('Set PIN for "' + folder.name + '" (leave blank to remove):', folder.pin || '');
    if (newPin === null) return;
    await _setFolderPin(id, newPin);
    showToast(newPin ? 'PIN updated.' : 'PIN removed.', 'success');
    renderDocuments(true);
};

window.showCreateFolderModal = function() {
    var overlay = document.createElement('div');
    overlay.id = 'create-folder-modal';
    overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="bg-white p-6 rounded-none shadow-xl w-full max-w-md">' +
        '<h3 class="text-lg font-black mb-4">Create New Folder</h3>' +
        '<div class="mb-3"><label class="text-xs font-bold text-slate-500 mb-1 block">Folder Name</label>' +
        '<input type="text" id="new-folder-name" class="input-chip rounded-none w-full" placeholder="e.g. HR Documents"></div>' +
        '<div class="mb-4"><label class="text-xs font-bold text-slate-500 mb-1 block">PIN (optional)</label>' +
        '<input type="password" id="new-folder-pin" class="input-chip rounded-none w-full" placeholder="Leave blank for no PIN"></div>' +
        '<div class="flex gap-2">' +
        '<button onclick="submitCreateFolder()" style="background:var(--edwardian-rose);color:white;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">Create</button>' +
        '<button onclick="document.getElementById(\'create-folder-modal\').remove()" style="background:rgba(85,91,110,0.08);color:#555B6E;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">Cancel</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    document.getElementById('new-folder-name').focus();
};

window.submitCreateFolder = async function() {
    var name = document.getElementById('new-folder-name')?.value?.trim();
    var pin = document.getElementById('new-folder-pin')?.value || '';
    if (!name) { showToast('Folder name is required.', 'warning'); return; }
    await _createUserFolder(name, pin);
    document.getElementById('create-folder-modal')?.remove();
    renderDocuments(true);
};

async function moveDocToFolder(id, folder, currentFolderId) {
    var doc = await _cloudGetDoc(folder, id);
    if (!doc) { showToast("Document not found.", 'error'); return; }
    var folders = await _loadFolderManifest();
    if (!folders.length) { showToast("No custom folders exist. Create one first.", 'warning'); return; }
    var choice = prompt("Move to which folder?\n\nAvailable:\n" + folders.map((f, i) => (i + 1) + '. ' + f.name).join('\n') + "\n\nType number or folder name:");
    if (!choice) return;
    var targetFolder = null;
    var num = parseInt(choice);
    if (!isNaN(num) && num >= 1 && num <= folders.length) targetFolder = folders[num - 1];
    else targetFolder = folders.find(f => f.name.toLowerCase() === choice.trim().toLowerCase());
    if (!targetFolder) { showToast("Folder not found.", 'error'); return; }
    doc.userFolderId = targetFolder.id;
    await writeDocumentFile(doc, folder);
    showToast("Moved to " + targetFolder.name, 'success');
    window.currentUserFolder = targetFolder.id;
    renderDocuments();
}

/* ─── Form Template Storage (local storage) ──────────────────── */
async function _loadFormTemplates() {
    try {
        var text = await _localDocsGetText('Document Templates/form-templates.json');
        if (!text) text = await _localDocsGetTextFromMasterFolder([
            'Document Templates/form-templates.json',
            'Data/Document Templates/form-templates.json',
            'Master Folder/Data/Document Templates/form-templates.json'
        ]);
        return text ? JSON.parse(text).templates || [] : [];
    } catch(e) { return []; }
}

async function _saveFormTemplates(templates) {
    await _localDocsPutText('Document Templates/form-templates.json', JSON.stringify({ templates }, null, 2));
}

async function _saveFormTemplate(tmpl) {
    var templates = await _loadFormTemplates();
    var idx = templates.findIndex(t => t.id === tmpl.id);
    if (idx >= 0) templates[idx] = tmpl; else templates.push(tmpl);
    await _saveFormTemplates(templates);
}

async function _deleteFormTemplate(id) {
    var templates = await _loadFormTemplates();
    templates = templates.filter(t => t.id !== id);
    await _saveFormTemplates(templates);
}

async function _getFormTemplate(id) {
    var templates = await _loadFormTemplates();
    return templates.find(t => t.id === id) || null;
}

/* ─── Template Builder redirect ────────────────────────────────── */
window.openTemplateBuilder = async function(editId) {
    if (editId) window._tplBuilderEditId = editId;
    setView('templatebuilder');
};

/* ─── Render form template fields for document create ────────── */
function _renderFormTemplateFields(templateId, existingValues) {
    return _getFormTemplate(templateId).then(function(tmpl) {
        if (!tmpl) return '<p class="text-sm text-red-500">Template not found.</p>';
        var html = '<div style="background:rgba(135,157,130,0.08);border:1px solid rgba(135,157,130,0.25);" class="rounded-lg p-4 mb-4">';
        html += '<h4 style="color:var(--edwardian-sage-dark);" class="text-sm font-black uppercase tracking-widest mb-3">' + escapeHtml(tmpl.name) + '</h4>';
        html += '<div class="space-y-4">';
        tmpl.fields.forEach(function(f, i) {
            var val = (existingValues && existingValues[f.id]) || '';
            var at = f.answerType || 'text';
            var scoreLabel = f.scored ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 ml-1">SCORED</span>' : '';
            html += '<div class="bg-white rounded-lg p-3 border border-slate-200">';
            html += '<label class="text-sm font-bold text-slate-700 mb-2 block"><span class="text-xs text-slate-400 mr-1">Q' + (i + 1) + '.</span> ' + escapeHtml(f.label) + scoreLabel + '</label>';
            switch(at) {
                case 'text':
                    html += '<input type="text" data-tplfield="' + f.id + '" value="' + escapeHtml(val) + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Type answer...">';
                    break;
                case 'textarea':
                    html += '<textarea data-tplfield="' + f.id + '" class="w-full p-2 border border-slate-300 rounded text-sm h-20 form-tpl-field" placeholder="Type answer...">' + escapeHtml(val) + '</textarea>';
                    break;
                case 'multichoice':
                    var checked = val ? val.split(',').map(s => s.trim()) : [];
                    html += '<div class="grid grid-cols-2 gap-1">' + (f.options||[]).map(function(o) {
                        return '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="radio" name="mc-' + f.id + '" data-tplfield="' + f.id + '" value="' + escapeHtml(o) + '" ' + (val === o ? 'checked' : '') + ' class="form-tpl-field form-tpl-radio rounded"> ' + escapeHtml(o) + '</label>';
                    }).join('') + '</div>';
                    break;
                case 'yesno':
                    html += '<div class="flex gap-3">';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="Yes" onclick="window._setYesNo(this)" class="px-6 py-2 rounded-lg text-sm font-black form-tpl-field form-tpl-yesno transition-all ' +
                        (val === 'Yes' ? 'bg-emerald-100 text-emerald-700 border-2 border-emerald-200 ring-2 ring-offset-1' : 'bg-emerald-100 text-emerald-700 border-2 border-emerald-200 hover:bg-emerald-200') + '">Yes</button>';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="No" onclick="window._setYesNo(this)" class="px-6 py-2 rounded-lg text-sm font-black form-tpl-field form-tpl-yesno transition-all ' +
                        (val === 'No' ? 'bg-red-100 text-red-700 border-2 border-red-200 ring-2 ring-offset-1' : 'bg-red-100 text-red-700 border-2 border-red-200 hover:bg-red-200') + '">No</button>';
                    html += '<input type="hidden" data-tplfield="' + f.id + '" value="' + escapeHtml(val) + '" class="form-tpl-field">';
                    html += '</div>';
                    break;
                case 'rag':
                    html += '<div class="flex gap-2">';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="Red" onclick="window._setRag(this)" class="px-4 py-1.5 rounded-lg text-xs font-black form-tpl-field form-tpl-rag transition-all ' +
                        (val === 'Red' ? 'bg-red-100 text-red-700 border-2 border-red-200 ring-2 ring-offset-1' : 'bg-red-100 text-red-700 border-2 border-red-200 hover:bg-red-200') + '">Red</button>';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="Amber" onclick="window._setRag(this)" class="px-4 py-1.5 rounded-lg text-xs font-black form-tpl-field form-tpl-rag transition-all ' +
                        (val === 'Amber' ? 'bg-amber-100 text-amber-700 border-2 border-amber-200 ring-2 ring-offset-1' : 'bg-amber-100 text-amber-700 border-2 border-amber-200 hover:bg-amber-200') + '">Amber</button>';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="Green" onclick="window._setRag(this)" class="px-4 py-1.5 rounded-lg text-xs font-black form-tpl-field form-tpl-rag transition-all ' +
                        (val === 'Green' ? 'bg-emerald-100 text-emerald-700 border-2 border-emerald-200 ring-2 ring-offset-1' : 'bg-emerald-100 text-emerald-700 border-2 border-emerald-200 hover:bg-emerald-200') + '">Green</button>';
                    html += '<input type="hidden" data-tplfield="' + f.id + '" value="' + escapeHtml(val) + '" class="form-tpl-field">';
                    html += '</div>';
                    break;
                case 'score':
                    var min = f.scoreMin || 1, max = f.scoreMax || 10;
                    var scoreVal = parseInt(val) || 0;
                    html += '<div class="flex gap-1">';
                    for (var s = min; s <= max; s++) {
                        html += '<button type="button" data-tplfield="' + f.id + '" data-score="' + s + '" onclick="window._setScore(this)" class="w-8 h-8 rounded text-xs font-black form-tpl-field form-tpl-score transition-all border-2 ' +
                            (scoreVal === s ? 'bg-amber-200 text-amber-800 border-amber-300 ring-2 ring-offset-1' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-amber-100 hover:text-amber-700 hover:border-amber-300') + '">' + s + '</button>';
                    }
                    html += '<input type="hidden" data-tplfield="' + f.id + '" value="' + escapeHtml(val) + '" class="form-tpl-field">';
                    html += '</div>';
                    break;
                case 'three_col':
                    var labels = f.colLabels || ['Field 1', 'Field 2', 'Field 3'];
                    var parts = (val || '').split(' | ');
                    html += '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">';
                    labels.forEach(function(l, subIdx) {
                        html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">' + escapeHtml(l) + '</label>';
                        html += '<input type="text" data-tplfield="' + f.id + '" value="' + escapeHtml(parts[subIdx] || '') + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Answer..."></div>';
                    });
                    html += '</div>';
                    break;
                case 'signoff':
                    var parts = (val || '').split(' | ');
                    html += '<div class="p-4 border-2 border-dashed border-slate-200 rounded-xl bg-amber-50/50 flex flex-col md:flex-row gap-3">';
                    html += '<div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Role / Title</label>';
                    html += '<input type="text" data-tplfield="' + f.id + '" value="' + escapeHtml(parts[0] || f.signoffRole || 'Manager') + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="e.g. Area Manager"></div>';
                    html += '<div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Name</label>';
                    html += '<input type="text" data-tplfield="' + f.id + '" value="' + escapeHtml(parts[1] || '') + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Enter name..."></div>';
                    html += '<div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date</label>';
                    html += '<input type="date" data-tplfield="' + f.id + '" value="' + escapeHtml(parts[2] || new Date().toISOString().slice(0,10)) + '" class="input-chip rounded-none w-full form-tpl-field"></div>';
                    html += '<input type="hidden" data-tplfield="' + f.id + '" value="' + escapeHtml(parts[3] || '') + '" class="form-tpl-field">';
                    html += '</div>';
                    break;
                case 'header':
                    var hc = f.headerConfig || {};
                    var hdrVals = (val || '').split(' | ');
                    html += '<div class="p-4 bg-gradient-to-r from-emerald-50 to-white border-l-4 border-emerald-600 rounded-r-lg mb-2">';
                    html += '<h3 class="text-lg font-extrabold text-slate-800 mb-2">' + escapeHtml(f.label || 'Section Header') + '</h3>';
                    if (f.subLabel) html += '<p class="text-xs text-slate-400 mb-3">' + escapeHtml(f.subLabel) + '</p>';
                    var hFields = [];
                    if (hc.showName) hFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Name</label><input type="text" data-tplfield="' + f.id + '" data-hdr="name" value="' + escapeHtml(hdrVals[0] || '') + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Enter name..."></div>');
                    if (hc.showJobTitle) hFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Job Title</label><input type="text" data-tplfield="' + f.id + '" data-hdr="jobTitle" value="' + escapeHtml(hdrVals[1] || hc.defaultJobTitle || '') + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="e.g. Area Manager"></div>');
                    if (hc.showDate) hFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date</label><input type="date" data-tplfield="' + f.id + '" data-hdr="date" value="' + escapeHtml(hdrVals[2] || new Date().toISOString().slice(0,10)) + '" class="input-chip rounded-none w-full form-tpl-field"></div>');
                    if (hc.showDocRef) hFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Document Ref</label><input type="text" data-tplfield="' + f.id + '" data-hdr="docRef" value="' + escapeHtml(hdrVals[3] || '') + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Auto-generated"></div>');
                    if (hc.showDocId) hFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Document ID</label><input type="text" data-tplfield="' + f.id + '" data-hdr="docId" value="' + escapeHtml(hdrVals[4] || '') + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Auto-generated"></div>');
                    if (hc.showTraining) hFields.push('<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Training Document</label><select data-tplfield="' + f.id + '" data-hdr="training" class="input-chip rounded-none w-full form-tpl-field"><option value="No"' + (hdrVals[5] !== 'Yes' ? ' selected' : '') + '>No</option><option value="Yes"' + (hdrVals[5] === 'Yes' ? ' selected' : '') + '>Yes</option></select></div>');
                    if (hFields.length) html += '<div class="grid grid-cols-2 md:grid-cols-3 gap-3">' + hFields.join('') + '</div>';
                    html += '</div>';
                    break;
                case 'section':
                    html += '<div class="my-4 pb-1 border-b-2 border-slate-300">';
                    html += '<h3 class="text-lg font-extrabold text-slate-800">' + escapeHtml(f.label || 'Section') + '</h3>';
                    html += '</div>';
                    break;
                case 'divider':
                    html += '<hr class="my-2 border-slate-200">';
                    break;
                case 'number':
                    html += '<input type="number" data-tplfield="' + f.id + '" value="' + escapeHtml(val) + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Enter number..." ' + (f.numberMin !== undefined ? 'min="' + f.numberMin + '"' : '') + ' ' + (f.numberMax !== undefined ? 'max="' + f.numberMax + '"' : '') + ' step="' + (f.numberStep || '1') + '">';
                    break;
                case 'date':
                    html += '<input type="date" data-tplfield="' + f.id + '" value="' + escapeHtml(val || new Date().toISOString().slice(0,10)) + '" class="input-chip rounded-none w-full form-tpl-field">';
                    break;
                case 'checkbox':
                    var cbVals = val ? val.split(',').map(s => s.trim()) : [];
                    html += '<div class="grid grid-cols-2 gap-1">' + (f.options||[]).map(function(o) {
                        return '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="checkbox" data-tplfield="' + f.id + '" value="' + escapeHtml(o) + '" ' + (cbVals.indexOf(o) >= 0 ? 'checked' : '') + ' class="form-tpl-field form-tpl-checkbox rounded"> ' + escapeHtml(o) + '</label>';
                    }).join('') + '</div>';
                    break;
                case 'image':
                    html += '<div class="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center bg-slate-50/50">';
                    html += '<input type="file" accept="image/*" data-tplfield="' + f.id + '" class="form-tpl-field w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100">';
                    if (val) html += '<p class="mt-1 text-xs text-slate-500">Current: ' + escapeHtml(val) + '</p>';
                    html += '</div>';
                    break;
                case 'table':
                    var rows = f.tableRows || 3, cols = f.tableCols || 3;
                    var headers = f.tableHeaders || [];
                    var rowHdrs = f.tableRowHeaders || [];
                    var scoredRows = f.tableScoredRows || [];
                    var hasScoring = f.scoringType && f.scoringType !== 'none';
                    var tableVals = (val || '').split('\n');
                    html += '<div class="overflow-x-auto"><table class="w-full text-sm border border-slate-200">';
                    html += '<thead><tr>';
                    html += '<th class="bg-slate-100 border border-slate-200 p-2 text-left font-bold text-slate-600 text-xs">' + escapeHtml(f.tableRowHeaderLabel || 'Item') + '</th>';
                    for (var tc = 0; tc < cols; tc++) {
                        html += '<th class="bg-slate-100 border border-slate-200 p-2 text-left font-bold text-slate-600 text-xs">' + escapeHtml(headers[tc] || 'Col ' + (tc+1)) + '</th>';
                    }
                    html += '</tr></thead><tbody>';
                    for (var tr = 0; tr < rows; tr++) {
                        var rowParts = (tableVals[tr] || '').split(' | ');
                        var rowScored = scoredRows.indexOf(tr) !== -1 && hasScoring;
                        html += '<tr' + (rowScored ? ' style="background:rgba(255,243,205,0.3)"' : '') + '>';
                        html += '<td class="bg-slate-50 border border-slate-200 p-1.5 text-xs font-bold text-slate-500 text-left whitespace-nowrap">' + escapeHtml(rowHdrs[tr] || 'Row ' + (tr+1)) + '</td>';
                        for (var tc = 0; tc < cols; tc++) {
                            var isLastCol = (tc === cols - 1);
                            html += '<td class="border border-slate-200 p-1"><input type="text" data-tplfield="' + f.id + '" data-row="' + tr + '" data-col="' + tc + '" value="' + escapeHtml(rowParts[tc] || '') + '" class="w-full p-1.5 text-sm border-0 bg-transparent form-tpl-field focus:bg-white focus:ring-1 focus:ring-emerald-300 rounded" placeholder="">';
                            if (isLastCol && rowScored) {
                                var scType = f.scoringType || 'score_1_10';
                                var existingScore = (existingValues && existingValues[f.id + '_r' + tr + '_c' + 'score']) || '';
                                html += '<div class="flex gap-0.5 mt-1 justify-center">';
                                if (scType === 'rag') {
                                    html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + tr + '" data-col="score" data-val="Green" onclick="window._setTableCellScore(this)" class="text-[8px] font-bold px-1.5 py-0.5 rounded form-tpl-field form-tpl-rag bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200' + (existingScore === 'Green' ? ' ring-1 ring-offset-0' : '') + '">G</button>';
                                    html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + tr + '" data-col="score" data-val="Amber" onclick="window._setTableCellScore(this)" class="text-[8px] font-bold px-1.5 py-0.5 rounded form-tpl-field form-tpl-rag bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200' + (existingScore === 'Amber' ? ' ring-1 ring-offset-0' : '') + '">A</button>';
                                    html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + tr + '" data-col="score" data-val="Red" onclick="window._setTableCellScore(this)" class="text-[8px] font-bold px-1.5 py-0.5 rounded form-tpl-field form-tpl-rag bg-red-100 text-red-700 border border-red-300 hover:bg-red-200' + (existingScore === 'Red' ? ' ring-1 ring-offset-0' : '') + '">R</button>';
                                    html += '</div><input type="hidden" data-tplfield="' + f.id + '" data-row="' + tr + '" data-col="score" value="' + escapeHtml(existingScore) + '" class="form-tpl-field">';
                                } else if (scType === 'passfail') {
                                    html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + tr + '" data-col="score" data-val="Pass" onclick="window._setTableCellScore(this)" class="text-[8px] font-bold px-1.5 py-0.5 rounded form-tpl-field form-tpl-ync bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200' + (existingScore === 'Pass' ? ' ring-1 ring-offset-0' : '') + '">Pass</button>';
                                    html += '<button type="button" data-tplfield="' + f.id + '" data-row="' + tr + '" data-col="score" data-val="Fail" onclick="window._setTableCellScore(this)" class="text-[8px] font-bold px-1.5 py-0.5 rounded form-tpl-field form-tpl-ync bg-red-100 text-red-700 border border-red-300 hover:bg-red-200' + (existingScore === 'Fail' ? ' ring-1 ring-offset-0' : '') + '">Fail</button>';
                                    html += '<input type="hidden" data-tplfield="' + f.id + '" data-row="' + tr + '" data-col="score" value="' + escapeHtml(existingScore) + '" class="form-tpl-field">';
                                } else {
                                    html += '<input type="number" data-tplfield="' + f.id + '" data-row="' + tr + '" data-col="score" min="0" max="10" value="' + escapeHtml(existingScore) + '" class="w-10 p-0.5 text-[10px] border border-amber-300 rounded text-center bg-amber-50 form-tpl-field" placeholder="\u2014">';
                                }
                                html += '</div>';
                            }
                            html += '</td>';
                        }
                        html += '</tr>';
                    }
                    html += '</tbody></table></div>';
                    break;
            }
            // Scoring attachment for any field type (rag/score_1_10/passfail)
            if (f.scoringType && f.scoringType !== 'none' && ['rag','score','yesno','header','divider','signoff','table','image','three_col'].indexOf(at) === -1) {
                html += '<div class="mt-2 pt-2 border-t border-amber-200">';
                if (f.scoringType === 'rag') {
                    var rv = val || '';
                    html += '<label class="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1 block">Scoring</label>';
                    html += '<div class="flex gap-2">';
                    ['Red','Amber','Green'].forEach(function(v) {
                        var active = rv === v ? ' ring-2 ring-offset-1' : '';
                        html += '<button type="button" data-tplfield="' + f.id + '" data-val="' + v + '" onclick="window._setRag(this)" class="px-4 py-1.5 rounded-lg text-xs font-black form-tpl-field form-tpl-rag transition-all border-2 ' +
                            'bg-' + (v === 'Red' ? 'red' : v === 'Amber' ? 'amber' : 'emerald') + '-100 text-' + (v === 'Red' ? 'red' : v === 'Amber' ? 'amber' : 'emerald') + '-700 border-' + (v === 'Red' ? 'red' : v === 'Amber' ? 'amber' : 'emerald') + '-200 hover:bg-' + (v === 'Red' ? 'red' : v === 'Amber' ? 'amber' : 'emerald') + '-200' + active + '">' + v + '</button>';
                    });
                    html += '<input type="hidden" data-tplfield="' + f.id + '" value="' + escapeHtml(val) + '" class="form-tpl-field">';
                    html += '</div>';
                } else if (f.scoringType === 'score_1_10') {
                    var sv = parseInt(val) || 0;
                    html += '<label class="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1 block">Scoring (1\u201310)</label>';
                    html += '<div class="flex gap-1">';
                    for (var sc = 1; sc <= 10; sc++) {
                        var sActive = sv === sc ? ' ring-2 ring-offset-1 bg-amber-200 text-amber-800 border-amber-300' : '';
                        html += '<button type="button" data-tplfield="' + f.id + '" data-score="' + sc + '" onclick="window._setScore(this)" class="w-8 h-8 rounded text-xs font-black form-tpl-field form-tpl-score transition-all border-2 bg-slate-100 text-slate-600 border-slate-200 hover:bg-amber-100 hover:text-amber-700 hover:border-amber-300' + sActive + '">' + sc + '</button>';
                    }
                    html += '<input type="hidden" data-tplfield="' + f.id + '" value="' + escapeHtml(val) + '" class="form-tpl-field">';
                    html += '</div>';
                } else if (f.scoringType === 'passfail') {
                    html += '<label class="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1 block">Scoring</label>';
                    html += '<div class="flex gap-2">';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="Pass" onclick="window._setPassFail(this)" class="px-5 py-1.5 rounded-lg text-xs font-black form-tpl-field form-tpl-pf transition-all bg-emerald-100 text-emerald-700 border-2 border-emerald-200 hover:bg-emerald-200' + (val === 'Pass' ? ' ring-2 ring-offset-1' : '') + '">Pass</button>';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="Fail" onclick="window._setPassFail(this)" class="px-5 py-1.5 rounded-lg text-xs font-black form-tpl-field form-tpl-pf transition-all bg-red-100 text-red-700 border-2 border-red-200 hover:bg-red-200' + (val === 'Fail' ? ' ring-2 ring-offset-1' : '') + '">Fail</button>';
                    html += '<input type="hidden" data-tplfield="' + f.id + '" value="' + escapeHtml(val) + '" class="form-tpl-field">';
                    html += '</div>';
                }
                html += '</div>';
        }
        // Scoring attachment display for standalone fields
        if (f.scoringType && f.scoringType !== 'none' && ['rag','score','yesno','header','divider','signoff','table','image','three_col'].indexOf(at) === -1) {
            var sVal = val || '';
            var sDisplay = '', sClass = '';
            if (f.scoringType === 'rag') {
                sDisplay = sVal || '\u2014';
                sClass = sVal === 'Green' ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : sVal === 'Amber' ? 'bg-amber-50 text-amber-700 border-amber-200' : sVal === 'Red' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
            } else if (f.scoringType === 'score_1_10') {
                var sv2 = parseInt(sVal) || 0;
                sDisplay = sVal ? sVal + ' / ' + (f.scoreMax || 10) : '\u2014';
                sClass = sv2 >= 8 ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : sv2 >= 4 ? 'bg-amber-50 text-amber-700 border-amber-200' : sv2 > 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
            } else if (f.scoringType === 'passfail') {
                sDisplay = sVal || '\u2014';
                sClass = sVal === 'Pass' ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : sVal === 'Fail' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
            }
            html += '<div class="mt-2 pt-2 border-t border-amber-200">';
            html += '<span class="text-[10px] font-black text-amber-600 uppercase tracking-widest mr-2">Score:</span>';
            html += '<span class="text-xs font-black border px-2 py-0.5 rounded ' + sClass + '">' + escapeHtml(sDisplay) + '</span>';
            html += '</div>';
        }
        html += '</div>';
        });
        html += '</div></div>';
        return html;
    });
}

/* ─── Render form template fields read-only (viewer) ─────────── */
async function _renderFormTemplateView(templateId, existingValues) {
    var tmpl = await _getFormTemplate(templateId);
    if (!tmpl) return '<p class="text-sm text-red-500">Template not found.</p>';
    var html = '<div class="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">';
    html += '<h4 class="text-sm font-black text-slate-600 uppercase tracking-widest mb-3">' + escapeHtml(tmpl.name) + '</h4>';
    html += '<div class="space-y-3">';
    tmpl.fields.forEach(function(f, i) {
        var val = (existingValues && existingValues[f.id]) || '';
        var at = f.answerType || 'text';
        var scoreLabel = f.scored ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 ml-1">SCORED</span>' : '';
        
        if (at === 'header') {
            var hc = f.headerConfig || {};
            var hdrVals = (val || '').split(' | ');
            html += '<div class="p-5 bg-gradient-to-r from-emerald-50 to-white border-l-4 border-emerald-600 rounded-r-lg mb-4">';
            html += '<h3 class="text-xl font-extrabold text-emerald-800 font-serif leading-snug mb-2">' + escapeHtml(f.label || 'Section Header') + '</h3>';
            if (f.subLabel) html += '<p class="text-xs text-slate-400 font-medium mb-3">' + escapeHtml(f.subLabel) + '</p>';
            var hItems = [];
            if (hc.showName && hdrVals[0]) hItems.push('<div><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Name</span><p class="text-sm font-bold text-slate-800">' + escapeHtml(hdrVals[0]) + '</p></div>');
            if (hc.showJobTitle && hdrVals[1]) hItems.push('<div><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Job Title</span><p class="text-sm font-bold text-slate-800">' + escapeHtml(hdrVals[1]) + '</p></div>');
            if (hc.showDate && hdrVals[2]) hItems.push('<div><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Date</span><p class="text-sm font-bold text-slate-800">' + escapeHtml(hdrVals[2]) + '</p></div>');
            if (hc.showDocRef && hdrVals[3]) hItems.push('<div><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Document Ref</span><p class="text-sm font-bold text-slate-800">' + escapeHtml(hdrVals[3]) + '</p></div>');
            if (hc.showDocId && hdrVals[4]) hItems.push('<div><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Document ID</span><p class="text-sm font-bold text-slate-800">' + escapeHtml(hdrVals[4]) + '</p></div>');
            if (hc.showTraining && hdrVals[5]) hItems.push('<div><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Training</span><p class="text-sm font-bold text-slate-800">' + escapeHtml(hdrVals[5]) + '</p></div>');
            if (hItems.length) html += '<div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">' + hItems.join('') + '</div>';
            html += '</div>';
            return;
        }
        if (at === 'section') {
            html += '<div class="my-4 pb-1 border-b-2 border-slate-300">';
            html += '<h3 class="text-lg font-extrabold text-slate-800">' + escapeHtml(f.label || 'Section') + '</h3>';
            html += '</div>';
            return;
        }
        if (at === 'divider') {
            html += '<hr class="border-t border-dashed border-slate-300/80 my-8">';
            return;
        }

        html += '<div class="bg-white rounded-lg p-3 border border-slate-200">';
        if (at !== 'signoff') {
            html += '<label class="text-xs font-bold text-slate-500 mb-1 block"><span class="text-slate-400">Q' + (i + 1) + '.</span> ' + escapeHtml(f.label) + (f.required ? ' <span class="text-red-500">*</span>' : '') + scoreLabel + '</label>';
        }
        if (f.helperText) html += '<p class="text-[11px] text-slate-400 mb-1.5 italic">' + escapeHtml(f.helperText) + '</p>';
        
        switch(at) {
            case 'text':
                html += '<p class="text-sm font-bold text-slate-800">' + escapeHtml(val || '—') + '</p>';
                break;
            case 'textarea':
                html += '<p class="text-sm text-slate-700 whitespace-pre-wrap">' + escapeHtml(val || '—') + '</p>';
                break;
            case 'multichoice':
                var vc = val === 'Red' ? 'text-red-600 bg-red-50' : val === 'Amber' ? 'text-amber-600 bg-amber-50' : 'text-slate-800 bg-slate-50';
                html += '<p class="text-sm font-bold ' + vc + ' px-3 py-1 rounded inline-block">' + escapeHtml(val || '—') + '</p>';
                break;
            case 'yesno':
                var ycStyle = val === 'Yes' ? 'style="color:var(--edwardian-sage-dark);background:rgba(135,157,130,0.08);"' : '';
                var yc = val === 'Yes' ? '' : val === 'No' ? 'text-red-600 bg-red-50' : 'text-slate-400 bg-slate-50';
                html += '<p class="text-sm font-bold ' + yc + ' px-3 py-1 rounded inline-block" ' + ycStyle + '>' + escapeHtml(val || '—') + '</p>';
                break;
            case 'rag':
                var rcStyle = val === 'Green' ? 'style="color:var(--edwardian-sage-dark);background:rgba(135,157,130,0.08);"' : '';
                var rc = val === 'Green' ? '' : val === 'Amber' ? 'text-amber-700 bg-amber-50' : val === 'Red' ? 'text-red-700 bg-red-50' : 'text-slate-400 bg-slate-50';
                html += '<p class="text-sm font-bold ' + rc + ' px-3 py-1 rounded inline-block" ' + rcStyle + '>' + escapeHtml(val || '—') + '</p>';
                break;
            case 'score':
                var sv = parseInt(val) || 0;
                var scStyle = sv >= 8 ? 'style="color:var(--edwardian-sage-dark);background:rgba(135,157,130,0.08);"' : '';
                var sc = sv >= 8 ? '' : sv >= 4 ? 'text-amber-600 bg-amber-50' : sv > 0 ? 'text-red-600 bg-red-50' : 'text-slate-400 bg-slate-50';
                html += '<p class="text-sm font-bold ' + sc + ' px-3 py-1 rounded inline-block" ' + scStyle + '>' + (val || '—') + ' / ' + (f.scoreMax || 10) + '</p>';
                break;
            case 'three_col':
                var labels = f.colLabels || ['Field 1', 'Field 2', 'Field 3'];
                var vals = (val || '').split(' | ');
                html += '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">';
                labels.forEach(function(l, subIdx) {
                    var subVal = vals[subIdx] || '';
                    html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">' + escapeHtml(l) + '</label>';
                    html += '<p class="text-sm font-bold text-slate-800">' + escapeHtml(subVal || '—') + '</p></div>';
                });
                html += '</div>';
                break;
            case 'signoff':
                var vals = (val || '').split(' | ');
                var roleVal, nameVal, dateVal, sigVal = '';
                if (vals.length >= 4) {
                    roleVal = vals[0] || f.signoffRole || 'Manager';
                    nameVal = vals[1] || '';
                    dateVal = vals[2] || '';
                    sigVal = vals[3] || '';
                } else {
                    roleVal = f.signoffRole || 'Manager';
                    nameVal = vals[0] || '';
                    dateVal = vals[1] || '';
                    for (var si = 2; si < vals.length; si++) {
                        if (vals[si] && vals[si].indexOf('data:image') === 0) { sigVal = vals[si]; break; }
                        else if (vals[si]) dateVal = dateVal || vals[si];
                    }
                }
                html += '<div class="p-5 border-2 border-dashed border-slate-200 rounded-2xl bg-amber-50/50">';
                html += '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">';
                html += '  <div>';
                html += '    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Role / Title</label>';
                html += '    <p class="text-sm font-black text-slate-800 font-serif mt-1">' + escapeHtml(roleVal) + '</p>';
                html += '  </div>';
                html += '  <div>';
                html += '    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Sign-off By</label>';
                html += '    <p class="text-sm font-bold text-slate-800 mt-1">' + escapeHtml(nameVal || '—') + '</p>';
                html += '  </div>';
                html += '  <div>';
                html += '    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date Signed</label>';
                html += '    <p class="text-sm font-bold text-slate-800 mt-1">' + escapeHtml(dateVal || '—') + '</p>';
                html += '  </div>';
                html += '</div>';
                if (sigVal) {
                    html += '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Signature</label>';
                    html += '<img src="' + sigVal + '" alt="Signature" class="h-20 border border-slate-200 rounded bg-white"></div>';
                } else {
                    html += '<div class="flex items-center gap-1.5 text-slate-400 font-bold text-xs"><span class="text-sm">&#x2717;</span> Not signed</div>';
                }
                html += '</div>';
                break;
            case 'number':
                html += '<p class="text-sm font-bold text-slate-800">' + escapeHtml(val || '—') + '</p>';
                break;
            case 'date':
                html += '<p class="text-sm font-bold text-slate-800">' + escapeHtml(val || '—') + '</p>';
                break;
            case 'checkbox':
                html += '<p class="text-sm font-bold text-slate-800">' + escapeHtml(val || '—') + '</p>';
                break;
            case 'image':
                html += '<p class="text-sm text-slate-600">' + escapeHtml(val || 'No photo uploaded') + '</p>';
                break;
            case 'table':
                var tableRows = (val || '').split('\n');
                var headers = f.tableHeaders || [];
                var rowHdrs = f.tableRowHeaders || [];
                var numCols = f.tableCols || 3;
                var scoredRows = f.tableScoredRows || [];
                var hasScoring = f.scoringType && f.scoringType !== 'none';
                html += '<div class="overflow-x-auto"><table class="w-full text-sm border border-slate-200">';
                html += '<thead><tr>';
                html += '<th class="bg-slate-100 border border-slate-200 p-2 text-left font-bold text-slate-600 text-xs">' + escapeHtml(f.tableRowHeaderLabel || 'Item') + '</th>';
                for (var hc = 0; hc < numCols; hc++) {
                    html += '<th class="bg-slate-100 border border-slate-200 p-2 text-left font-bold text-slate-600 text-xs">' + escapeHtml(headers[hc] || 'Col ' + (hc+1)) + '</th>';
                }
                html += '</tr></thead><tbody>';
                tableRows.forEach(function(row, ri) {
                    var cells = row.split(' | ');
                    var rowScored = scoredRows.indexOf(ri) !== -1 && hasScoring;
                    var existingScore = (existingValues && existingValues[f.id + '_r' + ri + '_c' + 'score']) || '';
                    html += '<tr' + (rowScored ? ' style="background:rgba(255,243,205,0.3)"' : '') + '>';
                    html += '<td class="bg-slate-50 border border-slate-200 p-2 text-xs font-bold text-slate-500 text-left">' + escapeHtml(rowHdrs[ri] || 'Row ' + (ri+1)) + '</td>';
                    for (var cc = 0; cc < numCols; cc++) {
                        var isLastCol = (cc === numCols - 1);
                        html += '<td class="border border-slate-200 p-2 text-sm">' + escapeHtml(cells[cc] || '\u2014');
                        if (isLastCol && rowScored) {
                            var scType = f.scoringType || 'score_1_10';
                            var scoreDisplay = '', scoreStyle = '';
                            if (scType === 'rag') {
                                scoreDisplay = existingScore || '\u2014';
                                scoreStyle = existingScore === 'Green' ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : existingScore === 'Amber' ? 'background:rgba(245,158,11,0.1);color:#92400e;border-color:rgba(245,158,11,0.3);' : existingScore === 'Red' ? 'background:rgba(239,68,68,0.1);color:#991b1b;border-color:rgba(239,68,68,0.3);' : 'background:#f8fafc;color:#94a3b8;border-color:#e2e8f0;';
                            } else if (scType === 'passfail') {
                                scoreDisplay = existingScore || '\u2014';
                                scoreStyle = existingScore === 'Pass' ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : existingScore === 'Fail' ? 'background:rgba(239,68,68,0.1);color:#991b1b;border-color:rgba(239,68,68,0.3);' : 'background:#f8fafc;color:#94a3b8;border-color:#e2e8f0;';
                            } else {
                                var sv = parseInt(existingScore) || 0;
                                var max = f.scoreMax || 10;
                                scoreDisplay = existingScore ? existingScore + '/' + max : '\u2014';
                                scoreStyle = sv >= 8 ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : sv >= 4 ? 'background:rgba(245,158,11,0.1);color:#92400e;border-color:rgba(245,158,11,0.3);' : sv > 0 ? 'background:rgba(239,68,68,0.1);color:#991b1b;border-color:rgba(239,68,68,0.3);' : 'background:#f8fafc;color:#94a3b8;border-color:#e2e8f0;';
                            }
                            html += '<div class="mt-1 text-center"><span class="inline-block text-[9px] font-black border px-1.5 py-0.5 rounded" style="' + scoreStyle + '">' + escapeHtml(scoreDisplay) + '</span></div>';
                        }
                        html += '</td>';
                    }
                    html += '</tr>';
                });
                html += '</tbody></table></div>';
                break;
        }
        html += '</div>';
    });
    html += '</div></div>';
    return html;
}

function _gatherFormTemplateFields(templateId) {
    return _getFormTemplate(templateId).then(function(tmpl) {
        if (!tmpl) return null;
        var values = {};
        tmpl.fields.forEach(function(f) {
            var at = f.answerType || 'text';
            if (at === 'multichoice') {
                var checked = document.querySelector('.form-tpl-field.form-tpl-radio[data-tplfield="' + f.id + '"]:checked');
                values[f.id] = checked ? checked.value : '';
            } else if (at === 'checkbox') {
                var checked = document.querySelectorAll('.form-tpl-field.form-tpl-checkbox[data-tplfield="' + f.id + '"]:checked');
                var sel = [];
                checked.forEach(function(cb) { sel.push(cb.value); });
                values[f.id] = sel.join(', ');
            } else if (at === 'yesno') {
                var hidden = document.querySelector('input[type="hidden"].form-tpl-field[data-tplfield="' + f.id + '"]');
                values[f.id] = hidden ? hidden.value : '';
            } else if (f.scoringType && f.scoringType !== 'none') {
                var scoreHidden = document.querySelector('input[type="hidden"].form-tpl-field[data-tplfield="' + f.id + '"]');
                values[f.id] = scoreHidden ? scoreHidden.value : '';
            } else if (at === 'three_col') {
                var els = document.querySelectorAll('input.form-tpl-field[data-tplfield="' + f.id + '"]');
                var parts = [];
                els.forEach(function(el) { parts.push(el.value || ''); });
                values[f.id] = parts.join(' | ');
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
            } else if (at === 'table') {
                var els = document.querySelectorAll('input.form-tpl-field[data-tplfield="' + f.id + '"]');
                var rows = f.tableRows || 3, cols = f.tableCols || 3;
                var data = [];
                for (var r = 0; r < rows; r++) {
                    var row = [];
                    for (var c = 0; c < cols; c++) {
                        var cell = document.querySelector('input.form-tpl-field[data-tplfield="' + f.id + '"][data-row="' + r + '"][data-col="' + c + '"]');
                        row.push(cell ? cell.value : '');
                    }
                    data.push(row.join(' | '));
                }
                values[f.id] = data.join('\n');
                // Gather table row score values (hidden inputs for RAG/PF, number inputs for score)
                var scoredRows = f.tableScoredRows || [];
                scoredRows.forEach(function(ri) {
                    var scoreEl = document.querySelector('input.form-tpl-field[data-tplfield="' + f.id + '"][data-row="' + ri + '"][data-col="score"]');
                    values[f.id + '_r' + ri + '_c' + 'score'] = scoreEl ? scoreEl.value : '';
                });
            } else if (at === 'image') {
                var fileInput = document.querySelector('input[type="file"].form-tpl-field[data-tplfield="' + f.id + '"]');
                values[f.id] = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0].name : '';
            } else {
                var el = document.querySelector('.form-tpl-field[data-tplfield="' + f.id + '"]');
                values[f.id] = el ? el.value : '';
            }
        });
        // Required fields are visual only — no save blocking
        return { templateId: templateId, templateName: tmpl.name, values: values };
    });
}

/* ─── Scoring & Summary Calculator ───────────────────────────── */
async function _calculateFormSummary(templateId, values) {
    var tmpl = await _getFormTemplate(templateId);
    if (!tmpl) return null;

    // Support both old `scored` field and new `scoringType` attachment layer
    var scoredFields = tmpl.fields.filter(function(f) {
        if (f.scoringType && f.scoringType !== 'none') return true;
        if (f.scored) return true;
        return false;
    });
    var ragFields = scoredFields.filter(function(f) { return f.scoringType === 'rag'; });
    var summary = {
        totalScore: 0,
        maxScore: 0,
        scorePercent: 0,
        yesCount: 0,
        noCount: 0,
        ragRedCount: 0,
        ragAmberCount: 0,
        ragGreenCount: 0,
        fieldResults: [],
        categories: [],
        overallRating: ''
    };

    // Build category map by walking fields in order
    var currentCategory = 'General';
    var categoryMap = {};
    var categoryOrder = ['General'];

    tmpl.fields.forEach(function(f) {
        if (f.answerType === 'header' || f.answerType === 'section') {
            currentCategory = f.label || 'Section';
            if (!categoryMap[currentCategory]) {
                categoryMap[currentCategory] = { name: currentCategory, totalScore: 0, maxScore: 0, percent: 0, fieldResults: [] };
                categoryOrder.push(currentCategory);
            }
            return;
        }
        if (f.answerType === 'divider' || f.answerType === 'signoff' || f.answerType === 'pagebreak') return;

        var isScored = (f.scoringType && f.scoringType !== 'none') || f.scored;
        if (!isScored) return;

        // Ensure current category exists
        if (!categoryMap[currentCategory]) {
            categoryMap[currentCategory] = { name: currentCategory, totalScore: 0, maxScore: 0, percent: 0, fieldResults: [] };
        }

        var weight = f.scoreWeight || 1;
        var val = 0;
        var max = f.scoreMax || 10;
        var rawVal = values[f.id] || '';
        var st = f.scoringType || 'none';

        if (st === 'rag') {
            val = rawVal === 'Green' ? max : rawVal === 'Amber' ? Math.round(max * 0.5) : 0;
        } else if (st === 'score_1_10') {
            val = parseFloat(rawVal) || 0;
        } else if (st === 'passfail') {
            val = rawVal === 'Pass' ? max : 0;
        } else if (f.answerType === 'number') {
            val = parseFloat(rawVal) || 0;
        } else if (f.answerType === 'yesno') {
            val = rawVal === 'Yes' ? max : 0;
        } else if (f.answerType === 'multichoice' && f.options && f.options.length > 1) {
            val = rawVal ? Math.round(max * 0.8) : 0;
        } else {
            val = rawVal ? max : 0;
        }

        var weightedVal = val * weight;
        var weightedMax = max * weight;
        summary.totalScore += weightedVal;
        summary.maxScore += weightedMax;

        var fieldResult = {
            label: f.label,
            type: f.answerType,
            scoringType: st,
            value: val,
            max: max,
            weight: weight,
            percent: max > 0 ? Math.round((val / max) * 100) : 0,
            category: currentCategory
        };
        summary.fieldResults.push(fieldResult);
        categoryMap[currentCategory].totalScore += weightedVal;
        categoryMap[currentCategory].maxScore += weightedMax;
        categoryMap[currentCategory].fieldResults.push(fieldResult);
    });

    // Table row/col scoring (new scoringType attachment)
    tmpl.fields.filter(function(f) { return f.answerType === 'table' && f.scoringType && f.scoringType !== 'none' && f.tableScoredRows && f.tableScoredRows.length; }).forEach(function(f) {
        // Find category for this table
        var tableCat = 'General';
        for (var ti = 0; ti < tmpl.fields.length; ti++) {
            if (tmpl.fields[ti].id === f.id) break;
            if (tmpl.fields[ti].answerType === 'header' || tmpl.fields[ti].answerType === 'section') tableCat = tmpl.fields[ti].label || 'Section';
        }
        if (!categoryMap[tableCat]) {
            categoryMap[tableCat] = { name: tableCat, totalScore: 0, maxScore: 0, percent: 0, fieldResults: [] };
        }
        var weight = f.scoreWeight || 1;
        var rows = f.tableRows || 3;
        var headers = f.tableHeaders || [];
        var rowHdrs = f.tableRowHeaders || [];
        var scoredRows = f.tableScoredRows || [];
        var max = f.scoreMax || 10;
        var scType = f.scoringType || 'score_1_10';
        scoredRows.forEach(function(rowIdx) {
            if (rowIdx >= rows) return;
            var key = f.id + '_r' + rowIdx + '_c' + 'score';
            var rawVal = values[key] || '';
            if (!rawVal) return;
            var val = 0;
            if (scType === 'rag') {
                val = rawVal === 'Green' ? max : rawVal === 'Amber' ? Math.round(max * 0.5) : 0;
            } else if (scType === 'passfail') {
                val = rawVal === 'Pass' ? max : 0;
            } else {
                val = parseFloat(rawVal) || 0;
            }
            var weightedVal = val * weight;
            var weightedMax = max * weight;
            summary.totalScore += weightedVal;
            summary.maxScore += weightedMax;
            var trResult = {
                label: (rowHdrs[rowIdx] || 'Row ' + (rowIdx+1)),
                type: 'table_row',
                scoringType: scType,
                rawValue: rawVal,
                value: val,
                max: max,
                weight: weight,
                percent: max > 0 ? Math.round((val / max) * 100) : 0,
                category: tableCat
            };
            summary.fieldResults.push(trResult);
            categoryMap[tableCat].totalScore += weightedVal;
            categoryMap[tableCat].maxScore += weightedMax;
            categoryMap[tableCat].fieldResults.push(trResult);
        });
    });

    // Build categories array
    categoryOrder.forEach(function(catName) {
        if (categoryMap[catName]) {
            var c = categoryMap[catName];
            c.percent = c.maxScore > 0 ? Math.round((c.totalScore / c.maxScore) * 100) : 0;
            summary.categories.push(c);
        }
    });

    // Yes/No counts (from scored yesno fields)
    var yesNoFields = scoredFields.filter(function(f) { return f.answerType === 'yesno'; });
    yesNoFields.forEach(function(f) {
        var val = values[f.id] || '';
        if (val === 'Yes') summary.yesCount++;
        else if (val === 'No') summary.noCount++;
    });

    // RAG counts
    ragFields.forEach(function(f) {
        var val = values[f.id] || '';
        if (val === 'Red') summary.ragRedCount++;
        else if (val === 'Amber') summary.ragAmberCount++;
        else if (val === 'Green') summary.ragGreenCount++;
    });

    // Count table_row RAG values too
    summary.fieldResults.forEach(function(r) {
        if (r.type === 'table_row' && r.scoringType === 'rag') {
            var rv = r.rawValue || '';
            if (rv === 'Red') summary.ragRedCount++;
            else if (rv === 'Amber') summary.ragAmberCount++;
            else if (rv === 'Green') summary.ragGreenCount++;
        }
    });

    // Calculate percentage
    if (summary.maxScore > 0) {
        summary.scorePercent = Math.round((summary.totalScore / summary.maxScore) * 100);
    }

    // Overall rating from score
    if (summary.scorePercent >= 90) summary.overallRating = 'Excellent';
    else if (summary.scorePercent >= 75) summary.overallRating = 'Good';
    else if (summary.scorePercent >= 50) summary.overallRating = 'Needs Improvement';
    else if (summary.scorePercent > 0) summary.overallRating = 'Poor';

    // Factor in RAG
    if (ragFields.length > 0) {
        var totalRag = summary.ragRedCount + summary.ragAmberCount + summary.ragGreenCount;
        if (totalRag > 0) {
            var redRate = summary.ragRedCount / totalRag;
            if (redRate > 0.5) summary.overallRating = 'Fail';
            else if (redRate > 0.25 || summary.ragAmberCount > summary.ragGreenCount) summary.overallRating = 'Needs Improvement';
            else if (summary.overallRating === '') summary.overallRating = 'Good';
        }
    }

    // Factor in Yes/No
    if (yesNoFields.length > 0) {
        var noRate = summary.noCount / yesNoFields.length;
        if (noRate > 0.5 && summary.overallRating === '') summary.overallRating = 'Needs Improvement';
    }

    return summary;
}

/* ─── Render Summary Panel ───────────────────────────────────── */
async function _renderSummaryPanel(templateId, values) {
    var summary = await _calculateFormSummary(templateId, values);
    if (!summary || summary.maxScore === 0 && summary.yesCount + summary.noCount === 0 && summary.ragRedCount + summary.ragAmberCount + summary.ragGreenCount === 0) {
        return '';
    }

    var ratingColorStyle = 'color:#64748b;';
    var ratingContainerStyle = 'border-top:4px solid #94a3b8;';
    if (summary.overallRating === 'Excellent') { ratingColorStyle = 'color:var(--edwardian-sage-dark);'; ratingContainerStyle = 'border-top:4px solid var(--edwardian-sage);background:rgba(135,157,130,0.08);border:1px solid rgba(135,157,130,0.25);'; }
    else if (summary.overallRating === 'Good') { ratingColorStyle = 'color:var(--edwardian-sage);'; ratingContainerStyle = 'border-top:4px solid var(--edwardian-sage);background:rgba(135,157,130,0.08);border:1px solid rgba(135,157,130,0.25);'; }
    else if (summary.overallRating === 'Needs Improvement') { ratingColorStyle = 'color:#92400e;'; ratingContainerStyle = 'border-top:4px solid #f59e0b;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);'; }
    else if (summary.overallRating === 'Poor' || summary.overallRating === 'Fail') { ratingColorStyle = 'color:#991b1b;'; ratingContainerStyle = 'border-top:4px solid #ef4444;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);'; }

    var html = '<div style="' + ratingContainerStyle + '" class="rounded-xl p-5 mb-4">';
    html += '<h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Visit Summary & Scoring</h3>';

    // Overall rating hero
    if (summary.overallRating) {
        html += '<div class="text-center mb-4">';
        html += '<div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Overall Rating</div>';
        html += '<div class="text-3xl font-black" style="' + ratingColorStyle + '">' + escapeHtml(summary.overallRating) + '</div>';
        html += '</div>';
    }

    // Score bar
    if (summary.maxScore > 0) {
        var pct = summary.scorePercent;
        var barColorStyle = pct >= 80 ? 'background:var(--edwardian-sage);' : pct >= 40 ? 'background:#f59e0b;' : 'background:#ef4444;';
        var barTextColorStyle = pct >= 80 ? 'color:var(--edwardian-sage-dark);' : pct >= 40 ? 'color:#92400e;' : 'color:#991b1b;';
        html += '<div class="bg-white rounded-lg p-3 border border-slate-100 mb-3">';
        html += '<div class="flex items-center justify-between mb-1.5">';
        html += '<span class="text-xs font-bold text-slate-500">SCORE</span>';
        html += '<span class="text-sm font-black" style="' + barTextColorStyle + '">' + summary.totalScore + ' / ' + summary.maxScore + ' (' + pct + '%)</span>';
        html += '</div>';
        html += '<div class="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">';
        html += '<div class="h-full rounded-full transition-all" style="' + barColorStyle + 'width:' + pct + '%"></div>';
        html += '</div>';
        html += '</div>';
    }

    // Yes/No + RAG counts in a clean grid
    var hasYesNo = summary.yesCount + summary.noCount > 0;
    var hasRag = summary.ragRedCount + summary.ragAmberCount + summary.ragGreenCount > 0;
    if (hasYesNo || hasRag) {
        html += '<div class="grid grid-cols-2 gap-2 mb-3">';
        if (hasYesNo) {
            html += '<div class="bg-white rounded-lg p-2.5 border border-slate-100 text-center">';
            html += '<div class="text-[9px] font-bold text-slate-400 uppercase mb-1">Yes / No</div>';
            html += '<div class="flex justify-center gap-3">';
            html += '<span class="text-sm font-black" style="color:var(--edwardian-sage-dark);">' + summary.yesCount + ' Yes</span>';
            html += '<span class="text-sm font-black text-red-600">' + summary.noCount + ' No</span>';
            html += '</div></div>';
        }
        if (hasRag) {
            html += '<div class="bg-white rounded-lg p-2.5 border border-slate-100 text-center">';
            html += '<div class="text-[9px] font-bold text-slate-400 uppercase mb-1">RAG Rating</div>';
            html += '<div class="flex justify-center gap-3">';
            html += '<span class="text-sm font-black" style="color:var(--edwardian-sage-dark);">' + summary.ragGreenCount + ' G</span>';
            html += '<span class="text-sm font-black text-amber-600">' + summary.ragAmberCount + ' A</span>';
            html += '<span class="text-sm font-black text-red-600">' + summary.ragRedCount + ' R</span>';
            html += '</div></div>';
        }
        html += '</div>';
    }

    // Section score cards (replaces horizontal bars + pie chart)
    if (summary.categories.length > 1 || (summary.categories.length === 1 && summary.categories[0].name !== 'General')) {
        html += '<div class="pt-3 border-t border-slate-200 mb-3">';
        html += '<div class="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Section Scores</div>';
        html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">';
        var pieColors = ['#879d82', '#555B6E', '#a47772', '#f59e0b', '#6366f1', '#ec4899'];
        summary.categories.forEach(function(cat, ci) {
            if (cat.maxScore === 0) return;
            var cpct = cat.percent;
            var color = pieColors[ci % pieColors.length];
            var borderColor = cpct >= 80 ? 'border-emerald-300' : cpct >= 40 ? 'border-amber-300' : 'border-red-300';
            var pctColor = cpct >= 80 ? 'color:var(--edwardian-sage-dark);' : cpct >= 40 ? 'color:#92400e;' : 'color:#991b1b;';
            var icon = cpct >= 80 ? '\u2713' : cpct >= 40 ? '\u26A0' : '\u2717';
            var ringGrad = 'conic-gradient(' + color + ' ' + (cpct * 3.6) + 'deg, #e2e8f0 ' + (cpct * 3.6) + 'deg)';
            html += '<div class="bg-white rounded-xl p-4 border-2 ' + borderColor + ' shadow-sm">';
            html += '<div class="flex items-start gap-3">';
            html += '<div class="w-14 h-14 rounded-full flex-shrink-0 flex items-center justify-center" style="background:' + ringGrad + ';">';
            html += '<div class="w-10 h-10 rounded-full bg-white flex items-center justify-center"><span class="text-sm font-black" style="' + pctColor + '">' + cpct + '%</span></div></div>';
            html += '<div class="flex-1 min-w-0">';
            html += '<div class="text-sm font-bold text-slate-800 truncate">' + escapeHtml(cat.name) + '</div>';
            html += '<div class="text-[11px] font-bold mt-0.5" style="' + pctColor + '">' + icon + ' ' + cat.totalScore + ' / ' + cat.maxScore + '</div>';
            html += '<div class="flex gap-2 mt-1.5">';
            var gCount = 0, aCount = 0, rCount = 0;
            cat.fieldResults.forEach(function(fr) {
                if (fr.rawValue === 'Green' || fr.value === 'Pass' || (fr.type !== 'rag' && fr.type !== 'passfail' && fr.value >= 8)) gCount++;
                else if (fr.rawValue === 'Amber' || (fr.type !== 'rag' && fr.type !== 'passfail' && fr.value >= 4)) aCount++;
                else if (fr.rawValue === 'Red' || fr.value === 'Fail' || (fr.type !== 'rag' && fr.type !== 'passfail' && fr.value > 0 && fr.value < 4)) rCount++;
            });
            if (gCount) html += '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:rgba(135,157,130,0.12);color:var(--edwardian-sage-dark);">' + gCount + ' G</span>';
            if (aCount) html += '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700;">' + aCount + ' A</span>';
            if (rCount) html += '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700;">' + rCount + ' R</span>';
            html += '</div>';
            html += '</div></div>';
            // Expandable question list
            if (cat.fieldResults.length > 0) {
                html += '<div class="mt-3 pt-2 border-t border-slate-100">';
                html += '<details><summary class="text-[10px] font-bold text-slate-400 cursor-pointer select-none hover:text-slate-600">' + cat.fieldResults.length + ' questions</summary>';
                html += '<div class="mt-1.5 space-y-1">';
                cat.fieldResults.forEach(function(fr) {
                    var display = '', badgeClass = '';
                    if (fr.scoringType === 'rag' || fr.type === 'rag' || fr.type === 'table_row') {
                        var rv = fr.rawValue || fr.value || '';
                        display = rv || '\u2014';
                        badgeClass = rv === 'Green' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : rv === 'Amber' ? 'bg-amber-50 text-amber-700 border-amber-200' : rv === 'Red' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
                    } else if (fr.scoringType === 'passfail') {
                        display = fr.value || '\u2014';
                        badgeClass = fr.value === 'Pass' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : fr.value === 'Fail' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
                    } else {
                        display = (fr.value || 0) + ' / ' + (fr.max || 10);
                        badgeClass = fr.value >= 8 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : fr.value >= 4 ? 'bg-amber-50 text-amber-700 border-amber-200' : fr.value > 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
                    }
                    html += '<div class="flex items-center justify-between text-[11px] bg-slate-50 rounded px-2 py-1">';
                    html += '<span class="font-bold text-slate-600 truncate">' + escapeHtml(fr.label) + '</span>';
                    html += '<span class="font-black border px-1.5 py-0.5 rounded text-[10px] flex-shrink-0 ml-2 ' + badgeClass + '">' + escapeHtml(display) + '</span>';
                    html += '</div>';
                });
                html += '</div></details></div>';
            }
            html += '</div>';
        });
        html += '</div></div>';
    }

    // Field breakdown (flat list when no sections, or all results below section cards)
    var nonTableResults = summary.fieldResults.filter(function(r) { return r.type !== 'table_row'; });
    if (nonTableResults.length > 0) {
        var hasMultipleCats = summary.categories.length > 1;
        html += '<div class="pt-3 border-t border-slate-200">';
        html += '<div class="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Question Breakdown</div>';
        html += '<div class="space-y-1.5">';
        var lastCat = '';
        nonTableResults.forEach(function(r) {
            if (hasMultipleCats && r.category && r.category !== lastCat) {
                lastCat = r.category;
                html += '<div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2 mb-1 pt-2 border-t border-slate-100">' + escapeHtml(r.category) + '</div>';
            }
            var st = r.scoringType || 'none';
            if (st === 'score_1_10' || r.type === 'score') {
                var max = r.max || 10;
                var v = r.value || 0;
                var fcStyle = v >= 8 ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : '';
                var fc = v >= 8 ? '' : v >= 4 ? 'bg-amber-50 text-amber-700 border-amber-200' : v > 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
                html += '<div class="flex items-center justify-between text-xs bg-white rounded px-2.5 py-1.5 border border-slate-100">';
                html += '<span class="font-bold text-slate-600">' + escapeHtml(r.label) + '</span>';
                html += '<span class="font-black border px-2 py-0.5 rounded ' + fc + '" ' + (fcStyle ? 'style="' + fcStyle + '"' : '') + '>' + v + ' / ' + max + '</span>';
                html += '</div>';
            } else if (st === 'passfail') {
                var pfStyle = r.value === 'Pass' ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : 'bg-red-50 text-red-700 border-red-200';
                var pf = r.value === 'Pass' ? '' : r.value === 'Fail' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
                html += '<div class="flex items-center justify-between text-xs bg-white rounded px-2.5 py-1.5 border border-slate-100">';
                html += '<span class="font-bold text-slate-600">' + escapeHtml(r.label) + '</span>';
                html += '<span class="font-black border px-2 py-0.5 rounded ' + pf + '" style="' + pfStyle + '">' + escapeHtml(r.value || '\u2014') + '</span>';
                html += '</div>';
            } else if (st === 'rag' || r.type === 'rag') {
                var ragcStyle = r.value === 'Green' ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : '';
                var ragc = r.value === 'Green' ? '' : r.value === 'Amber' ? 'bg-amber-50 text-amber-700 border-amber-200' : r.value === 'Red' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
                html += '<div class="flex items-center justify-between text-xs bg-white rounded px-2.5 py-1.5 border border-slate-100">';
                html += '<span class="font-bold text-slate-600">' + escapeHtml(r.label) + '</span>';
                html += '<span class="font-black border px-2 py-0.5 rounded ' + ragc + '" ' + (ragcStyle ? 'style="' + ragcStyle + '"' : '') + '>' + escapeHtml(r.value || '\u2014') + '</span>';
                html += '</div>';
            } else if (r.type === 'yesno') {
                var yncStyle = r.value === 'Yes' ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : '';
                var ync = r.value === 'Yes' ? '' : r.value === 'No' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
                html += '<div class="flex items-center justify-between text-xs bg-white rounded px-2.5 py-1.5 border border-slate-100">';
                html += '<span class="font-bold text-slate-600">' + escapeHtml(r.label) + '</span>';
                html += '<span class="font-black border px-2 py-0.5 rounded ' + ync + '" ' + (yncStyle ? 'style="' + yncStyle + '"' : '') + '>' + escapeHtml(r.value || '\u2014') + '</span>';
                html += '</div>';
            } else if (r.type === 'table_col') {
                html += '<div class="flex items-center justify-between text-xs bg-white rounded px-2.5 py-1.5 border border-slate-100">';
                html += '<span class="font-bold text-slate-600">' + escapeHtml(r.label) + '</span>';
                html += '<span class="font-black border px-2 py-0.5 rounded bg-slate-50 text-slate-600 border-slate-200">' + r.value + ' / ' + r.max + '</span>';
                html += '</div>';
            } else if (r.type === 'table_row') {
                var rv = r.rawValue || '';
                var trDisplay = '', trClass = '';
                if (st === 'rag') {
                    trDisplay = rv || '\u2014';
                    trClass = rv === 'Green' ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : rv === 'Amber' ? 'bg-amber-50 text-amber-700 border-amber-200' : rv === 'Red' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
                } else if (st === 'passfail') {
                    trDisplay = rv || '\u2014';
                    trClass = rv === 'Pass' ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : rv === 'Fail' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
                } else {
                    trDisplay = r.value + ' / ' + r.max;
                    trClass = r.value >= 8 ? 'background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);border-color:rgba(135,157,130,0.25);' : r.value >= 4 ? 'bg-amber-50 text-amber-700 border-amber-200' : r.value > 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200';
                }
                html += '<div class="flex items-center justify-between text-xs bg-white rounded px-2.5 py-1.5 border border-slate-100">';
                html += '<span class="font-bold text-slate-600">' + escapeHtml(r.label) + '</span>';
                html += '<span class="font-black border px-2 py-0.5 rounded ' + trClass + '">' + escapeHtml(trDisplay) + '</span>';
                html += '</div>';
            } else {
                html += '<div class="flex items-center justify-between text-xs bg-white rounded px-2.5 py-1.5 border border-slate-100">';
                html += '<span class="font-bold text-slate-600">' + escapeHtml(r.label) + '</span>';
                html += '<span class="font-black border px-2 py-0.5 rounded bg-slate-50 text-slate-400 border-slate-200">' + r.value + ' / ' + r.max + '</span>';
                html += '</div>';
            }
        });
        html += '</div></div>';
    }


    html += '</div>';
    return html;
}

/* ─── CSV Export ───────────────────────────────────────────── */
window._downloadSummaryCSV = async function() {
    var url = new URL(window.location.href);
    var folder = url.searchParams.get('folder') || '';
    var docId = url.searchParams.get('id') || '';
    if (!docId) return;
    var doc = await _cloudGetDoc(folder, docId);
    if (!doc || !doc.formTemplateId || !doc.formTemplateValues) { showToast('No form data to export.', 'warning'); return; }
    var tmpl = await _getFormTemplate(doc.formTemplateId);
    if (!tmpl) return;

    var rows = [['Question', 'Answer', 'Scoring Type', 'Score', 'Max', 'Weight', 'Percent']];
    tmpl.fields.forEach(function(f) {
        if (f.answerType === 'header' || f.answerType === 'section' || f.answerType === 'divider' || f.answerType === 'pagebreak' || f.answerType === 'signoff') return;
        var val = doc.formTemplateValues[f.id] || '';
        var st = f.scoringType || 'none';
        var score = '', max = '', weight = f.scoreWeight || 1, pct = '';
        if (st !== 'none') {
            max = f.scoreMax || 10;
            if (st === 'rag') score = val === 'Green' ? max : val === 'Amber' ? Math.round(max * 0.5) : 0;
            else if (st === 'passfail') score = val === 'Pass' ? max : 0;
            else if (st === 'score_1_10') score = parseFloat(val) || 0;
            else if (f.answerType === 'yesno') score = val === 'Yes' ? max : 0;
            else score = val ? max : 0;
            pct = max > 0 ? Math.round((score / max) * 100) + '%' : '';
            score = score + ' / ' + max;
            max = max;
        }
        rows.push([f.label || '', val, st === 'none' ? '' : st, score, max, weight > 1 ? weight : '', pct]);
    });

    // Table rows
    tmpl.fields.filter(function(f) { return f.answerType === 'table'; }).forEach(function(f) {
        var rowHdrs = f.tableRowHeaders || [];
        var headers = f.tableHeaders || [];
        var scoredRows = f.tableScoredRows || [];
        var tableVals = (doc.formTemplateValues[f.id] || '').split('\n');
        tableVals.forEach(function(row, ri) {
            var cells = row.split(' | ');
            var cellStr = cells.map(function(c, ci) { return (headers[ci] || 'Col ' + (ci+1)) + ': ' + c; }).join('; ');
            var scoreInfo = '';
            if (scoredRows.indexOf(ri) !== -1 && f.scoringType && f.scoringType !== 'none') {
                var rawScore = doc.formTemplateValues[f.id + '_r' + ri + '_c' + 'score'] || '';
                scoreInfo = ' [Score: ' + rawScore + ']';
            }
            rows.push([(rowHdrs[ri] || 'Row ' + (ri+1)) + ' (' + (f.label || 'Table') + ')', cellStr + scoreInfo, '', '', '', '', '']);
        });
    });

    var csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (doc.name || doc.id || 'document') + '_summary.csv';
    link.click();
    URL.revokeObjectURL(link.href);
};

/* ─── Load ──────────────────────────────────────────────────── */
async function loadDocuments() {
    const result = { open: [], resolved: [], archived: [] };
    result.open = await _cloudListDocs('Open');
    result.resolved = await _cloudListDocs('Resolved');
    result.archived = await _cloudListDocs('Archive');
    // Enrich with folder names
    const folders = await _loadFolderManifest();
    const folderMap = {};
    folders.forEach(f => folderMap[f.id] = f.name);
    [result.open, result.resolved, result.archived].forEach(arr => {
        arr.forEach(doc => {
            if (doc.userFolderId && folderMap[doc.userFolderId]) {
                doc.userFolderName = folderMap[doc.userFolderId];
            }
        });
    });
    return result;
}

/* ─── Write helper ──────────────────────────────────────────── */
async function writeDocumentFile(doc, folder) {
    await _cloudWriteDoc(folder, doc.id, doc);
}

/* ─── Evidence URL ──────────────────────────────────────────── */
async function resolveDocumentEvidenceUrl(doc) {
    if (!doc.evidenceFile) return null;
    return await _cloudReadEvidence(doc.evidenceFile);
}

/* ─── Render Document Hub ───────────────────────────────────── */
async function renderDocuments(useCache = false) {
    if (!useCache) window.currentLoadedDocs = await loadDocuments();
    const docs = window.currentLoadedDocs;
    const allDocs = [...docs.open, ...docs.resolved, ...(docs.archived || [])];

    const attentionOptions = [...new Set(allDocs.map(d => d.attentionOf).filter(Boolean))].sort();
    const authorOptions = [...new Set(allDocs.map(d => d.creator).filter(Boolean))].sort();
    const deptOptions = [...new Set(allDocs.map(d => d.department).filter(Boolean))].sort();

    const fStatus = document.getElementById("filter-status")?.value || "All";
    const fAttention = document.getElementById("filter-attention")?.value || "All";
    const fAuthor = document.getElementById("filter-author")?.value || "All";
    const fDept = document.getElementById("filter-dept")?.value || window._currentDeptFilter || "All";
    const fSort = document.getElementById("filter-sort")?.value || "newest";
    if (fDept !== "All" && fDept !== window._currentDeptFilter) window._currentDeptFilter = fDept;

    const filterDoc = (d, label) => {
        if (fStatus !== "All" && fStatus !== label) return false;
        if (fAttention !== "All" && d.attentionOf !== fAttention) return false;
        if (fAuthor !== "All" && d.creator !== fAuthor) return false;
        if (fDept !== "All" && d.department !== fDept) return false;
        return true;
    };

    const sortDocs = (arr) => [...arr].sort((a, b) => {
        const da = new Date(a.date || 0).getTime() || 0;
        const db = new Date(b.date || 0).getTime() || 0;
        return fSort === "oldest" ? da - db : db - da;
    });

    const docCard = (doc, folder) => {
        const replies = Array.isArray(doc.replies) ? doc.replies : [];
        const lastReply = replies[replies.length - 1];
        const borderStyle = folder === 'Archive' ? ' style="border-left:4px solid var(--edwardian-rose);"' : '';
        const borderClass = folder === 'Open' ? 'border-l-amber-400' : folder === 'Archive' ? '' : 'border-l-birds-green';
        const pinned = doc.pin ? '<span class="text-amber-500 font-bold text-[10px]">PINNED</span>' : '';
        const ufId = doc.userFolderId || '';
        const ufBadge = ufId ? `<span class="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">📁 ${escapeHtml(doc.userFolderName || 'Folder')}</span>` : '';
        return `
        <div class="card p-5 border-l-4 rounded-none ${borderClass} mb-4 bg-white shadow-sm"${borderStyle}>
            <div class="flex items-start justify-between">
                <h4 class="font-black text-slate-800">${escapeHtml(doc.title || doc.name)}</h4>
                <div class="flex items-center gap-2">${pinned} ${ufBadge}</div>
            </div>
            <p class="text-xs font-bold text-slate-500">${doc.reference ? '<span class="font-mono text-birds-green">' + escapeHtml(doc.reference) + '</span> \u2022 ' : ''}${escapeHtml(doc.type)} \u2022 ${escapeHtml(doc.date)}</p>
            <p class="text-xs font-bold text-slate-400">Author: ${escapeHtml(doc.creator || '\u2014')}${doc.attentionOf ? ' \u2022 For: ' + escapeHtml(doc.attentionOf) : ''}</p>
            ${doc.department ? `<p class="text-[10px] font-bold text-slate-400 uppercase">${escapeHtml(doc.department)}</p>` : ''}
            ${doc.parentDocRef ? '<p class="text-[10px] font-bold text-slate-400">Follow-up from: <span class="font-mono">' + (doc.parentDocId ? '<button onclick="event.stopPropagation();window._openLinkedDoc(\'' + escapeHtml(doc.parentDocId) + '\')" class="text-birds-green hover:underline cursor-pointer">' + escapeHtml(doc.parentDocRef) + '</button>' : escapeHtml(doc.parentDocRef)) + '</span></p>' : ''}
            ${lastReply ? `<p class="text-xs text-slate-400 mt-2 italic">${replies.length} repl${replies.length === 1 ? 'y' : 'ies'} — latest from ${escapeHtml(lastReply.author)}: "${escapeHtml(String(lastReply.body || '').slice(0, 60))}${String(lastReply.body || '').length > 60 ? '\u2026' : ''}"</p>` : ''}
            <div class="flex gap-2 mt-3">
                <button onclick="openDocumentViewer('${doc.id}', '${folder}', '${ufId}')" style="background:var(--edwardian-rose);color:white;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;display:flex;flex:1;">Open</button>
                ${folder === 'Open' ? `<button onclick="resolveDocument('${doc.id}', '${ufId}')" style="background:var(--edwardian-rose);color:white;" class="rounded-none text-sm flex-1 py-2 font-bold">Resolve</button>` : ''}
                ${folder === 'Open' ? `<button onclick="archiveDocument('${doc.id}', '${folder}', '${ufId}')" style="background:rgba(164,119,114,0.08);color:var(--edwardian-rose);" class="rounded-none text-sm flex-1 py-2 font-bold">Archive</button>` : ''}
                ${folder === 'Archive' ? `<button onclick="relaunchDocument('${doc.id}', '${ufId}')" style="background:rgba(85,91,110,0.08);color:#555B6E;" class="rounded-none text-sm flex-1 py-2 font-bold">Relaunch</button>` : ''}
                ${folder === 'Archive' ? `<button onclick="permanentDeleteDocument('${doc.id}')" class="bg-red-100 text-red-700 rounded-none text-sm flex-1 py-2 font-bold hover:bg-red-200">Delete</button>` : ''}
                ${folder === 'Resolved' ? `<button onclick="relaunchResolvedDocument('${doc.id}', '${ufId}')" style="background:rgba(85,91,110,0.08);color:#555B6E;" class="rounded-none text-sm flex-1 py-2 font-bold">Relaunch</button>` : ''}
                ${folder === 'Resolved' ? `<button onclick="deleteDocument('${doc.id}', '${folder}')" class="bg-red-50 text-red-600 rounded-none text-sm flex-1 py-2 font-bold hover:bg-red-100">Delete</button>` : ''}
            </div>
        </div>`;
    };

    const activeAttention = fAttention;

    // If viewing a user folder, show folder-specific view
    if (window.currentUserFolder) {
        var ufFolders = await _loadFolderManifest();
        var activeFolder = ufFolders.find(f => f.id === window.currentUserFolder);
        var folderName = activeFolder ? activeFolder.name : 'Unknown Folder';
        var folderAllDocs = [...docs.open, ...docs.resolved, ...docs.archived];
        var folderDocs = folderAllDocs.filter(d => d.userFolderId === window.currentUserFolder);

        var fStatus2 = document.getElementById("filter-status")?.value || "All";
        var fAttention2 = document.getElementById("filter-attention")?.value || "All";
        var fAuthor2 = document.getElementById("filter-author")?.value || "All";
        var fDept2 = document.getElementById("filter-dept")?.value || window._currentDeptFilter || "All";
        var fSort2 = document.getElementById("filter-sort")?.value || "newest";
        if (fDept2 !== "All" && fDept2 !== window._currentDeptFilter) window._currentDeptFilter = fDept2;

        var filteredDocs = folderDocs.filter(d => {
            if (fStatus2 !== "All" && d.status !== fStatus2) return false;
            if (fAttention2 !== "All" && d.attentionOf !== fAttention2) return false;
            if (fAuthor2 !== "All" && d.creator !== fAuthor2) return false;
            if (fDept2 !== "All" && d.department !== fDept2) return false;
            return true;
        });

        var sortedDocs = [...filteredDocs].sort((a, b) => {
            const da = new Date(a.date || 0).getTime() || 0;
            const db = new Date(b.date || 0).getTime() || 0;
            return fSort2 === "oldest" ? da - db : db - da;
        });

        var openCount = folderDocs.filter(d => d.status === 'Open').length;
        var resolvedCount = folderDocs.filter(d => d.status === 'Resolved').length;
        var archivedCount = folderDocs.filter(d => d.status === 'Archived').length;

        document.getElementById("mainView").innerHTML = `
            <div class="flex items-center gap-3 mb-6">
                <button onclick="window.currentUserFolder=null;renderDocuments()" class="text-slate-400 hover:text-slate-600 text-2xl font-bold">←</button>
                <h2 class="text-[36px] font-black outfit birds-green">📁 ${escapeHtml(folderName)}</h2>
                <span class="text-sm font-bold text-slate-400">${folderDocs.length} documents</span>
                <button onclick="renameUserFolderPrompt('${window.currentUserFolder}')" class="text-xs font-bold text-slate-400 hover:text-slate-600 bg-slate-100 px-3 py-1 rounded-none">✏️ Rename</button>
                <button onclick="deleteUserFolderConfirm('${window.currentUserFolder}')" class="text-xs font-bold text-slate-400 hover:text-red-500 bg-slate-100 px-3 py-1 rounded-none">🗑️ Delete</button>
                ${activeFolder && activeFolder.pin ? `<button onclick="changeFolderPin('${window.currentUserFolder}')" class="text-xs font-bold text-amber-600 hover:text-amber-700 bg-amber-50 px-3 py-1 rounded-none">🔒 Change PIN</button>` : `<button onclick="changeFolderPin('${window.currentUserFolder}')" class="text-xs font-bold text-slate-400 hover:text-slate-600 bg-slate-100 px-3 py-1 rounded-none">🔓 Set PIN</button>`}
            </div>
            <div class="flex gap-3 mb-4 text-xs font-bold">
                <span class="bg-amber-50 text-amber-700 px-3 py-1 rounded-none">Open: ${openCount}</span>
                <span style="background:rgba(135,157,130,0.08);color:var(--edwardian-sage-dark);" class="px-3 py-1 rounded-none">Resolved: ${resolvedCount}</span>
                <span style="background:rgba(164,119,114,0.15);color:var(--edwardian-rose);" class="px-3 py-1 rounded-none">Archived: ${archivedCount}</span>
            </div>
            <div class="flex flex-wrap gap-3 mb-6">
                <select id="filter-status" class="input-chip rounded-none" onchange="renderDocuments(true)">
                    <option value="All" ${fStatus2 === 'All' ? 'selected' : ''}>All Statuses</option>
                    <option value="Open" ${fStatus2 === 'Open' ? 'selected' : ''}>Open</option>
                    <option value="Resolved" ${fStatus2 === 'Resolved' ? 'selected' : ''}>Resolved</option>
                    <option value="Archived" ${fStatus2 === 'Archived' ? 'selected' : ''}>Archived</option>
                </select>
                <select id="filter-dept" class="input-chip rounded-none" onchange="window._currentDeptFilter=this.value;renderDocuments(true)">
                    <option value="All">All Departments</option>
                    ${(() => {
                        var sSet = {};
                        if (typeof Users !== 'undefined' && Users.SENIOR_DEPARTMENTS) Users.SENIOR_DEPARTMENTS.forEach(function(d) { sSet[d] = true; });
                        var sSeen = false;
                        return deptOptions.map(a => {
                            var sep = '';
                            if (sSet[a] && !sSeen) { sSeen = true; sep = '<option disabled style="font-weight:800;color:#5a6577;background:#f1ede8;">── Senior Leadership ──</option>'; }
                            return sep + `<option value="${escapeHtml(a)}" ${fDept2 === a ? 'selected' : ''}>${escapeHtml(a)}</option>`;
                        }).join('');
                    })()}
                </select>
                <select id="filter-author" class="input-chip rounded-none" onchange="renderDocuments(true)">
                    <option value="All">All Authors</option>
                    ${authorOptions.map(a => `<option value="${escapeHtml(a)}" ${fAuthor2 === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
                </select>
                <select id="filter-sort" class="input-chip rounded-none" onchange="renderDocuments(true)">
                    <option value="newest" ${fSort2 === 'newest' ? 'selected' : ''}>Newest First</option>
                    <option value="oldest" ${fSort2 === 'oldest' ? 'selected' : ''}>Oldest First</option>
                </select>
                <button onclick="renderDocumentCreate()" style="background:var(--edwardian-rose);color:white;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">+ New Document</button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                ${sortedDocs.length ? sortedDocs.map(d => docCard(d, d.status === 'Archived' ? 'Archive' : d.status)).join('') : '<p class="text-slate-400 italic text-sm col-span-full">No documents in this folder.</p>'}
            </div>`;
        return;
    }

    document.getElementById("mainView").innerHTML = `
        <h2 class="text-[36px] font-black outfit birds-green mb-6">Document Hub</h2>
        <div class="flex flex-wrap gap-2 mb-4">
            <button class="px-4 py-2 text-xs font-black uppercase tracking-wider rounded-none transition-all ${fAttention === 'All' ? 'bg-birds-green text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" onclick="document.getElementById('filter-attention').value='All';renderDocuments(true)">All</button>
            ${attentionOptions.map(a => `<button class="px-4 py-2 text-xs font-black uppercase tracking-wider rounded-none transition-all ${fAttention === a ? 'bg-birds-green text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" onclick="document.getElementById('filter-attention').value='${escapeHtml(a)}';renderDocuments(true)">${escapeHtml(a)}</button>`).join('')}
        </div>
        <div class="flex flex-wrap gap-3 mb-6">
            <select id="filter-status" class="input-chip rounded-none" onchange="renderDocuments(true)">
                <option value="All" ${fStatus === 'All' ? 'selected' : ''}>All Statuses</option>
                <option value="Open" ${fStatus === 'Open' ? 'selected' : ''}>Open</option>
                <option value="Resolved" ${fStatus === 'Resolved' ? 'selected' : ''}>Resolved</option>
            </select>
            <select id="filter-dept" class="input-chip rounded-none" onchange="window._currentDeptFilter=this.value;renderDocuments(true)">
                <option value="All">All Departments</option>
                ${(() => {
                    var sSet2 = {};
                    if (typeof Users !== 'undefined' && Users.SENIOR_DEPARTMENTS) Users.SENIOR_DEPARTMENTS.forEach(function(d) { sSet2[d] = true; });
                    var sSeen2 = false;
                    return deptOptions.map(a => {
                        var sep = '';
                        if (sSet2[a] && !sSeen2) { sSeen2 = true; sep = '<option disabled style="font-weight:800;color:#5a6577;background:#f1ede8;">── Senior Leadership ──</option>'; }
                        return sep + `<option value="${escapeHtml(a)}" ${fDept === a ? 'selected' : ''}>${escapeHtml(a)}</option>`;
                    }).join('');
                })()}
            </select>
            <select id="filter-attention" class="hidden" onchange="renderDocuments(true)">
                <option value="All">All — Attention Of</option>
                ${attentionOptions.map(a => `<option value="${escapeHtml(a)}" ${fAttention === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
            </select>
            <select id="filter-author" class="input-chip rounded-none" onchange="renderDocuments(true)">
                <option value="All">All Authors</option>
                ${authorOptions.map(a => `<option value="${escapeHtml(a)}" ${fAuthor === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
            </select>
            <select id="filter-sort" class="input-chip rounded-none" onchange="renderDocuments(true)">
                <option value="newest" ${fSort === 'newest' ? 'selected' : ''}>Newest First</option>
                <option value="oldest" ${fSort === 'oldest' ? 'selected' : ''}>Oldest First</option>
            </select>
            <button onclick="renderDocumentCreate()" style="background:var(--edwardian-rose);color:white;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">+ New Document</button>
        </div>

        <!-- User Folders -->
        <div class="mb-6 border border-slate-200 rounded-none p-4 bg-slate-50">
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-black text-slate-500 uppercase tracking-widest">📁 Folders</h3>
                <button onclick="showCreateFolderModal()" class="text-xs font-bold text-birds-green hover:underline">+ New Folder</button>
            </div>
            <div id="user-folders-container" class="flex flex-wrap gap-2"></div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div><h3 class="font-black text-slate-400 uppercase mb-4">Open (${docs.open.filter(d => filterDoc(d, 'Open')).length})</h3>${sortDocs(docs.open.filter(d => filterDoc(d, 'Open'))).map(d => docCard(d, 'Open')).join('') || '<p class="text-slate-400 italic text-sm">No documents.</p>'}</div>
            <div><h3 class="font-black text-slate-400 uppercase mb-4">Resolved (${docs.resolved.filter(d => filterDoc(d, 'Resolved')).length})</h3>${sortDocs(docs.resolved.filter(d => filterDoc(d, 'Resolved'))).map(d => docCard(d, 'Resolved')).join('') || '<p class="text-slate-400 italic text-sm">No documents.</p>'}</div>
        </div>`;

    // Render folder list after DOM is ready
    setTimeout(renderUserFolderList, 50);
}

/* ─── Create Document ───────────────────────────────────────── */
async function renderDocumentCreate() {
    const today = new Date().toISOString().substring(0, 10);
    var folders = await _loadFolderManifest();
    var folderOptions = folders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
    var templates = await _loadFormTemplates();
    var tplOptions = templates.length ? '<option value="">-- No template --</option>' + templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('') : '';

    /* Project context */
    var stageCtx = window._projectStageContext || null;
    var projectInfo = '';
    var defaultDept = '';
    if (stageCtx && typeof Projects !== 'undefined') {
        var proj = Projects.getById(stageCtx.projectId);
        if (proj) {
            defaultDept = proj.department || '';
            var stage = proj.stages.find(function(s) { return s.id === stageCtx.stageId; });
            projectInfo = '<div class="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg"><p class="text-xs font-bold text-blue-700">Linked to Project: ' + escapeHtml(proj.name) + '</p>' +
                (stage ? '<p class="text-[11px] text-blue-500">Stage: ' + escapeHtml(stage.title) + '</p>' : '') +
                '</div>';
        }
    }

    document.getElementById('mainView').innerHTML = `
    <div class="card p-6 border-t-4 border-t-birds-green rounded-none">
        <h2 class="text-2xl font-black birds-green mb-4">Create New Document</h2>
        ${projectInfo}

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Author</label>
                <input type="text" id="doc-author" class="input-chip rounded-none w-full bg-slate-50" value="${escapeAttr((typeof Users !== 'undefined' && Users.getCurrentUser()) ? Users.getCurrentUser().name : '')}" readonly>
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Date</label>
                <input type="date" id="doc-date" class="input-chip rounded-none w-full" value="${today}">
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Department</label>
                <select id="doc-department" onchange="Documents._onDocDeptChange(this)" class="input-chip rounded-none w-full">
                    ${_getDocDepartments().map(d => `<option value="${d}"${d === defaultDept ? ' selected' : ''}>${d}</option>`).join('')}
                </select>
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Attention Of</label>
                <select id="doc-attention" onchange="Documents._onDocDeptChange(this)" class="input-chip rounded-none w-full">
                    ${_getDocDepartments().map(d => `<option value="${d}">${d}</option>`).join('')}
                </select>
            </div>
            <div class="md:col-span-2">
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Document Name / Title</label>
                <input type="text" id="doc-name" class="input-chip rounded-none w-full">
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Reference Number</label>
                <input type="text" id="doc-reference" class="input-chip rounded-none w-full" placeholder="Auto-generated if blank">
            </div>
            <div></div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Document Type</label>
                <select id="doc-type" class="input-chip rounded-none w-full">
                    <option value="General query">General query</option>
                    <option value="Investigation">Investigation</option>
                    <option value="Review">Review</option>
                    <option value="Issue raised">Issue raised</option>
                    <option value="Feedback">Feedback from department</option>
                </select>
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Save to Folder</label>
                <select id="doc-user-folder" class="input-chip rounded-none w-full">
                    <option value="">-- No folder (status only) --</option>
                    ${folderOptions}
                </select>
            </div>
            ${tplOptions ? `<div class="md:col-span-2">
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Form Template (optional)</label>
                <select id="doc-form-template" class="input-chip rounded-none w-full" onchange="_previewDocTemplate(this.value)">
                    ${tplOptions}
                </select>
            </div>
            <div class="md:col-span-2">
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Follow-up Template (when resolved)</label>
                <select id="doc-followup-template" class="input-chip rounded-none w-full">
                    <option value="">-- No follow-up --</option>
                    ${templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
                </select>
                <p class="text-[10px] text-slate-400 mt-1">When this document is resolved, a new document will be created from this template.</p>
            </div>` : ''}
        </div>
        <div id="doc-template-preview"></div>
        <div class="mb-4">
            <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Document PIN (optional)</label>
            <input type="password" id="doc-pin" class="input-chip rounded-none w-full md:w-1/2">
        </div>
        <div class="mb-4">
            <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Document Body / Notes</label>
            <textarea id="doc-body" class="w-full h-40 p-4 border border-slate-300 rounded-lg resize-y" placeholder="Additional notes or free text..."></textarea>
        </div>
        <div class="mb-4">
            <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Attach Evidence (optional)</label>
            <input type="file" id="doc-evidence" class="text-sm">
        </div>
        <div class="flex gap-3 pt-4 border-t">
            <button onclick="saveDocumentRecord()" style="background:var(--edwardian-rose);color:white;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">Save Document</button>
            <button onclick="renderDocuments()" style="background:rgba(85,91,110,0.08);color:#555B6E;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">Discard</button>
        </div>
    </div>`;
}

window._previewDocTemplate = async function(templateId) {
    var container = document.getElementById('doc-template-preview');
    if (!container) return;
    if (!templateId) { container.innerHTML = ''; return; }
    container.innerHTML = await _renderFormTemplateFields(templateId);
    if (typeof window._initSignatures === 'function') window._initSignatures();
};

async function saveDocumentRecord() {
    var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
    const author = user ? user.name : (document.getElementById("doc-author")?.value?.trim() || 'Unknown');
    const authorId = user ? user.id : '';

    const id = _uid("DOC-");
    const formTemplateId = document.getElementById("doc-form-template")?.value || '';
    const body = document.getElementById("doc-body")?.value?.trim() || '';
    const userFolderId = document.getElementById("doc-user-folder")?.value || '';

    const data = {
        id,
        creator: author,
        creatorId: authorId,
        createdAt: new Date().toISOString(),
        date: document.getElementById("doc-date")?.value || new Date().toISOString().substring(0, 10),
        attentionOf: document.getElementById("doc-attention")?.value || '',
        department: document.getElementById("doc-department")?.value || '',
        name: document.getElementById("doc-name")?.value || 'Untitled',
        title: document.getElementById("doc-name")?.value || 'Untitled',
        type: document.getElementById("doc-type")?.value || 'General query',
        body,
        pin: document.getElementById("doc-pin")?.value || "",
        status: "Open",
        replies: []
    };

    // Reference number — auto-generate if blank
    var refInput = (document.getElementById("doc-reference")?.value || '').trim();
    if (refInput) {
        data.reference = refInput;
    } else {
        var typePrefix = { 'General query': 'GQ', 'Investigation': 'INV', 'Review': 'REV', 'Issue raised': 'IR', 'Feedback': 'FB' };
        var prefix = typePrefix[data.type] || 'DOC';
        var seq = String(Date.now()).slice(-4);
        data.reference = prefix + '-' + new Date().getFullYear() + '-' + seq;
    }

    if (userFolderId) data.userFolderId = userFolderId;

    // Gather form template fields
    if (formTemplateId) {
        var formData = await _gatherFormTemplateFields(formTemplateId);
        if (formData) {
            data.formTemplateId = formTemplateId;
            data.formTemplateName = formData.templateName;
            data.formTemplateValues = formData.values;
        }
    }

    // Follow-up template
    var followupId = document.getElementById("doc-followup-template")?.value || '';
    if (followupId) data.followupTemplateId = followupId;

    const fileInput = document.getElementById("doc-evidence");
    if (fileInput.files.length > 0) {
        try {
            const file = fileInput.files[0];
            const safeName = `${id}_evidence.${file.name.split('.').pop()}`;
            await _cloudWriteEvidence(safeName, file);
            data.evidenceFile = safeName;
        } catch (e) { console.warn('Evidence save failed:', e); }
    }

    await _cloudWriteDoc('Open', id, data);
    showToast('Document Saved', 'success');
    if (userFolderId) {
        window.currentUserFolder = userFolderId;
    }
    /* Link to project stage if context exists */
    var stageCtx = window._projectStageContext;
    if (stageCtx && typeof Projects !== 'undefined' && Projects._linkDocToStage) {
        await Projects._linkDocToStage(stageCtx.projectId, stageCtx.stageId, id, data.reference, data.name);
        window._projectStageContext = null;
        /* Return to project detail */
        showToast('Document linked to project stage', 'success');
        Projects.renderProjectDetail(stageCtx.projectId);
        return;
    }
    renderDocuments();
}

/* ─── Add Reply ─────────────────────────────────────────────── */
async function addDocumentReply(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    const author = document.getElementById("reply-author")?.value?.trim();
    const body = document.getElementById("reply-body")?.value?.trim();
    if (!author || !body) { showToast('Author and reply body are required.', 'warning'); return; }

    const reply = {
        author,
        date: document.getElementById("reply-date")?.value || new Date().toISOString().substring(0, 10),
        body,
        photo: null
    };

    const fileInput = document.getElementById("reply-photo");
    if (fileInput.files.length > 0) {
        try {
            const reader = new FileReader();
            reply.photo = await new Promise((resolve) => {
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(fileInput.files[0]);
            });
        } catch (e) { console.warn('Photo read failed:', e); }
    }

    if (!doc.replies) doc.replies = [];
    doc.replies.push(reply);
    await writeDocumentFile(doc, folder);
    renderLinearViewer(doc, await resolveDocumentEvidenceUrl(doc), folder, doc.userFolderId || '');
}

/* ─── Document Viewer ───────────────────────────────────────── */
async function openDocumentViewer(id, folder, userFolderId) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return showToast("Document not found.", 'error');
    if (doc.pin && !window.unlockedDocs.has(id)) {
        const input = prompt("Enter PIN:");
        if (input !== doc.pin) return showToast("Access Denied", 'error');
        window.unlockedDocs.add(id);
    }
    const evidenceUrl = await resolveDocumentEvidenceUrl(doc);
    renderLinearViewer(doc, evidenceUrl, folder, userFolderId);
}

async function renderLinearViewer(doc, evidenceUrl, folder, userFolderId) {
    const replies = Array.isArray(doc.replies) ? doc.replies : [];
    const today = new Date().toISOString().substring(0, 10);

    const replyHtml = replies.length ? replies.map((r, idx) => `
        <div class="reply-item bg-slate-50 border-l-4 border-l-slate-300 rounded-none p-4 mb-3" id="reply-${idx}">
            <div class="flex items-center justify-between mb-1">
                <p class="text-xs font-bold text-slate-500">${escapeHtml(r.author)} • ${escapeHtml(r.date)}</p>
                <button onclick="editReplyInline('${doc.id}','${folder}',${idx})" class="text-[10px] font-bold text-birds-green hover:underline print:hidden">Edit</button>
            </div>
            <div id="reply-body-${idx}" class="text-sm text-slate-800 whitespace-pre-wrap">${escapeHtml(r.body)}</div>
            ${r.photo ? `<img src="${r.photo}" class="mt-2 max-w-xs rounded border border-slate-200" />` : ''}
        </div>`).join('') : '';

    // Render form template fields (read-only view)
    var formTplHtml = '';
    var summaryHtml = '';
    if (doc.formTemplateId && doc.formTemplateValues) {
        formTplHtml = await _renderFormTemplateView(doc.formTemplateId, doc.formTemplateValues);
        summaryHtml = await _renderSummaryPanel(doc.formTemplateId, doc.formTemplateValues);
    }

    document.getElementById("mainView").innerHTML = `
            <div id="print-doc-area" class="card p-8 bg-white rounded-none">
            <div class="flex items-start gap-4 mb-4">
                <img src="logo.png" alt="" class="w-14 h-14 object-contain flex-shrink-0 mt-1" onerror="this.style.display='none'">
                <div class="flex-1">
                    <div class="flex items-start justify-between mb-2">
                        <h2 class="text-2xl font-black" id="doc-title-display">${escapeHtml(doc.name)}</h2>
                        <div class="flex items-center gap-2">
                            ${doc.pin ? '<span class="text-amber-500 font-bold text-xs bg-amber-50 px-2 py-1 rounded">PINNED</span>' : ''}
                            ${doc.status ? '<span class="text-xs font-bold px-2 py-1 rounded" style="' +
                                (doc.status === 'Open' ? 'background:rgba(245,158,11,0.15);color:#b45309;' :
                                 doc.status === 'Resolved' ? 'background:rgba(135,157,130,0.12);color:var(--edwardian-sage-dark);' :
                                 'background:rgba(164,119,114,0.15);color:var(--edwardian-rose);') + '">' + escapeHtml(doc.status) + '</span>' : ''}
                        </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold text-slate-500 mb-1">
                        ${doc.formTemplateId ? '<span>Template: <span class="font-mono text-birds-green">' + escapeHtml(doc.formTemplateName || doc.templateName || doc.formTemplateId) + '</span></span>' : ''}
                        ${doc.reference ? '<span>Doc No: <span class="font-mono text-birds-green">' + escapeHtml(doc.reference) + '</span></span>' : ''}
                        <span>Author: ${escapeHtml(doc.creator)}</span>
                        <span>Type: ${escapeHtml(doc.type)}</span>
                        ${doc.department ? '<span>Dept: ' + escapeHtml(doc.department) + '</span>' : ''}
                    </div>
                    <p class="text-[11px] font-bold text-slate-400 mb-3">Created: ${escapeHtml(doc.date)}${doc.attentionOf ? ' | For: ' + escapeHtml(doc.attentionOf) : ''}${doc.parentDocRef ? ' | Follow-up from: <span class="font-mono">' + (doc.parentDocId ? '<button onclick="event.stopPropagation();window._openLinkedDoc(\'' + escapeHtml(doc.parentDocId) + '\')" class="text-birds-green hover:underline cursor-pointer">' + escapeHtml(doc.parentDocRef) + '</button>' : escapeHtml(doc.parentDocRef)) + '</span>' : ''}</p>
                </div>
            </div>

            ${summaryHtml}

            <div id="doc-body-container">
                <div class="text-sm leading-relaxed p-5 bg-slate-50 rounded-none mb-2 whitespace-pre-wrap" id="doc-body-display">${escapeHtml(doc.body)}</div>
                <button onclick="editDocumentBodyInline('${doc.id}','${folder}')" class="text-[10px] font-bold text-birds-green hover:underline mb-4 print:hidden">Edit Document</button>
            </div>

            ${formTplHtml}

            ${doc.templateFields && Object.keys(doc.templateFields).length > 0 ? `
                <div class="mb-4">
                    <h3 class="text-xs font-black uppercase text-slate-400 mb-2">Template: ${escapeHtml(doc.formTemplateName || doc.templateName || 'Unknown')}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        ${Object.entries(doc.templateFields).map(([k, v]) => `
                            <div class="bg-slate-50 border border-slate-200 rounded p-3">
                                <div class="text-[10px] font-black text-slate-400 uppercase">${escapeHtml(k)}</div>
                                <div class="text-sm font-bold text-slate-700">${escapeHtml(v) || '<span class="text-slate-300 italic">Empty</span>'}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${(doc.formTemplateName || doc.templateName) && !doc.templateFields ? `<p class="text-xs text-slate-400 italic mb-4">Template: ${escapeHtml(doc.formTemplateName || doc.templateName)}</p>` : ''}

            <div id="doc-form-edit-container"></div>

            ${evidenceUrl ? `<img src="${evidenceUrl}" class="w-64 mb-6 border-4 border-slate-50" />` : ''}

            ${replies.length ? `<div class="mb-6"><h3 class="text-sm font-black uppercase text-slate-400 mb-3">Replies (${replies.length})</h3>${replyHtml}</div>` : '<p class="text-sm text-slate-400 italic mb-6 print:hidden">No replies yet.</p>'}

            <div class="border-t pt-6 mb-6">
                <h3 class="text-sm font-black uppercase text-slate-400 mb-3">Reply with template</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 print:hidden">
                    <input type="text" id="reply-author" class="input-chip rounded-none w-full" placeholder="Your name">
                    <input type="date" id="reply-date" class="input-chip rounded-none w-full" value="${today}">
                </div>
                <textarea id="reply-body" class="w-full h-28 p-3 mb-3 border border-slate-300 rounded-lg resize-y" placeholder="Reply message..."></textarea>
                <div class="mb-3 print:hidden">
                    <label class="text-xs font-bold text-slate-500 mb-1 block">Attach Photo (optional)</label>
                    <input type="file" id="reply-photo" accept="image/*" class="text-sm">
                </div>
                <button onclick="addDocumentReply('${doc.id}', '${folder}')" class="print:hidden" style="background:var(--edwardian-rose);color:white;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">Save Reply</button>
            </div>

            <div class="print:hidden flex flex-wrap gap-2">
                <button onclick="${userFolderId ? 'enterUserFolder(\'' + userFolderId + '\')' : 'renderDocuments()'}" style="background:rgba(85,91,110,0.08);color:#555B6E;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">Back</button>
                <button onclick="window.print()" class="btn" style="background: var(--edwardian-rose); color: white; padding: 8px 16px; border-radius: 6px; font-weight: 800; font-size: 13px;">Print PDF</button>
                ${doc.formTemplateId && doc.formTemplateValues ? '<button onclick="window._downloadSummaryCSV()" style="background:var(--edwardian-sage);color:white;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">\u2B07 Download CSV</button>' : ''}
                ${doc.formTemplateId && doc.status !== 'Archived' ? '<button onclick="window._toggleFormEdit(\'' + doc.id + '\',\'' + folder + '\')" id="btn-edit-form" style="background:rgba(85,91,110,0.08);color:#555B6E;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">\u270f Edit Answers</button>' : ''}
                <button onclick="moveDocToFolder('${doc.id}','${folder}','${userFolderId || ''}')" class="bg-slate-100 text-slate-600 rounded-none font-bold px-4 py-2 hover:bg-slate-200">📁 Move to Folder</button>
                ${doc.pin ? `<button onclick="removeDocumentPin('${doc.id}','${folder}','${userFolderId || ''}')" class="bg-amber-50 text-amber-700 rounded-none font-bold px-4 py-2 hover:bg-amber-100">Unpin</button>` : `<button onclick="setDocumentPin('${doc.id}','${folder}','${userFolderId || ''}')" class="bg-slate-100 text-slate-600 rounded-none font-bold px-4 py-2 hover:bg-slate-200">Pin</button>`}
                ${folder === 'Open' ? `<button onclick="resolveDocument('${doc.id}','${userFolderId || ''}')" style="background:var(--edwardian-rose);color:white;" class="rounded-none font-bold px-4 py-2">Resolve</button>` : ''}
                ${folder === 'Open' ? `<button onclick="archiveDocument('${doc.id}','${folder}','${userFolderId || ''}')" style="background:rgba(164,119,114,0.08);color:var(--edwardian-rose);" class="rounded-none font-bold px-4 py-2">Archive</button>` : ''}
                ${folder === 'Archive' ? `<button onclick="relaunchDocument('${doc.id}','${userFolderId || ''}')" style="background:rgba(85,91,110,0.08);color:#555B6E;" class="rounded-none font-bold px-4 py-2">Relaunch</button>` : ''}
                ${folder === 'Archive' ? `<button onclick="permanentDeleteDocument('${doc.id}')" class="bg-red-100 text-red-700 rounded-none font-bold px-4 py-2 hover:bg-red-200">Delete</button>` : ''}
                ${folder === 'Resolved' ? `<button onclick="relaunchResolvedDocument('${doc.id}','${userFolderId || ''}')" style="background:rgba(85,91,110,0.08);color:#555B6E;" class="rounded-none font-bold px-4 py-2">Relaunch</button>` : ''}
                ${folder === 'Resolved' ? `<button onclick="deleteDocument('${doc.id}','${folder}')" class="bg-red-50 text-red-600 rounded-none font-bold px-4 py-2 hover:bg-red-100">Delete</button>` : ''}
            </div>
        </div>`;
}

/* ─── Edit Document Body (inline) ───────────────────────────── */
async function editDocumentBodyInline(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    const container = document.getElementById('doc-body-container');
    if (!container) return;
    container.innerHTML = `
        <textarea id="doc-body-edit" class="w-full h-64 p-4 mb-2 border border-slate-300 rounded-lg resize-y text-sm">${escapeHtml(doc.body)}</textarea>
        <div class="flex gap-2 mb-4">
            <button onclick="saveDocumentBodyInline('${id}','${folder}')" style="background:var(--edwardian-rose);color:white;" class="rounded-none font-bold px-4 py-1.5 text-xs">Save</button>
            <button onclick="cancelDocumentBodyInline('${id}','${folder}')" class="bg-red-50 text-red-600 rounded-none font-bold px-4 py-1.5 text-xs hover:bg-red-100">Cancel</button>
        </div>`;
    document.getElementById('doc-body-edit').focus();
}

async function saveDocumentBodyInline(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    const newBody = document.getElementById('doc-body-edit')?.value;
    if (newBody === null) return;
    doc.body = newBody;
    await writeDocumentFile(doc, folder);
    const container = document.getElementById('doc-body-container');
    if (container) {
        container.innerHTML = `
            <div class="text-sm leading-relaxed p-5 bg-slate-50 rounded-none mb-2 whitespace-pre-wrap" id="doc-body-display">${escapeHtml(doc.body)}</div>
            <button onclick="editDocumentBodyInline('${id}','${folder}')" class="text-[10px] font-bold text-birds-green hover:underline mb-4 print:hidden">Edit Document</button>`;
    }
}

async function cancelDocumentBodyInline(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    const container = document.getElementById('doc-body-container');
    if (container) {
        container.innerHTML = `
            <div class="text-sm leading-relaxed p-5 bg-slate-50 rounded-none mb-2 whitespace-pre-wrap" id="doc-body-display">${escapeHtml(doc.body)}</div>
            <button onclick="editDocumentBodyInline('${id}','${folder}')" class="text-[10px] font-bold text-birds-green hover:underline mb-4 print:hidden">Edit Document</button>`;
    }
}

/* ─── Edit Form Template Answers (inline) ──────────────────── */
window._formEditDocId = null;
window._formEditFolder = null;

window._toggleFormEdit = async function(docId, folder) {
    var container = document.getElementById('doc-form-edit-container');
    if (!container) return;
    if (container.innerHTML.trim()) {
        container.innerHTML = '';
        return;
    }
    var doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(function(d) { return d.id === docId; });
    if (!doc || !doc.formTemplateId) return;
    window._formEditDocId = docId;
    window._formEditFolder = folder;
    var editableHtml = await _renderFormTemplateFields(doc.formTemplateId, doc.formTemplateValues || {});
    container.innerHTML = '<div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">' +
        '<h4 class="text-xs font-black text-amber-700 uppercase tracking-widest mb-3">Edit Form Answers</h4>' +
        editableHtml +
        '<div class="flex gap-2 mt-4">' +
        '<button onclick="window._saveFormEdit()" style="background:var(--edwardian-rose);color:white;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">Save Changes</button>' +
        '<button onclick="document.getElementById(\'doc-form-edit-container\').innerHTML=\'\'" class="bg-red-50 text-red-600 px-4 py-2 rounded-none font-bold text-xs hover:bg-red-100">Cancel</button>' +
        '</div></div>';
    if (typeof window._initSignatures === 'function') window._initSignatures();
};

window._saveFormEdit = async function() {
    var docId = window._formEditDocId;
    var folder = window._formEditFolder;
    if (!docId || !folder) return;
    var doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(function(d) { return d.id === docId; });
    if (!doc) return;
    var tmpl = await _getFormTemplate(doc.formTemplateId);
    if (!tmpl) return;
    var values = _tplCollectValues(tmpl);
    doc.formTemplateValues = values;
    await writeDocumentFile(doc, folder);
    document.getElementById('doc-form-edit-container').innerHTML = '';
    openDocumentViewer(docId, folder, doc.userFolderId || '');
};

/* ─── Edit Reply (inline) ───────────────────────────────────── */
async function editReplyInline(id, folder, idx) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc || !doc.replies[idx]) return;
    const reply = doc.replies[idx];
    const bodyEl = document.getElementById('reply-body-' + idx);
    if (!bodyEl) return;
    bodyEl.outerHTML = `
        <div id="reply-body-${idx}">
            <textarea id="reply-edit-${idx}" class="w-full h-28 p-3 mb-2 border border-slate-300 rounded-lg resize-y text-sm">${escapeHtml(reply.body)}</textarea>
            <div class="flex gap-2">
                <button onclick="saveReplyInline('${id}','${folder}',${idx})" style="background:var(--edwardian-rose);color:white;" class="rounded-none font-bold px-3 py-1 text-xs">Save</button>
                <button onclick="cancelReplyInline('${id}','${folder}',${idx})" class="bg-red-50 text-red-600 rounded-none font-bold px-3 py-1 text-xs hover:bg-red-100">Cancel</button>
            </div>
        </div>`;
    document.getElementById('reply-edit-' + idx).focus();
}

async function saveReplyInline(id, folder, idx) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc || !doc.replies[idx]) return;
    const newBody = document.getElementById('reply-edit-' + idx)?.value;
    if (newBody === null) return;
    doc.replies[idx].body = newBody;
    await writeDocumentFile(doc, folder);
    const wrapper = document.getElementById('reply-body-' + idx);
    if (wrapper) {
        wrapper.outerHTML = `<div id="reply-body-${idx}" class="text-sm text-slate-800 whitespace-pre-wrap">${escapeHtml(newBody)}</div>`;
    }
}

async function cancelReplyInline(id, folder, idx) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc || !doc.replies[idx]) return;
    const wrapper = document.getElementById('reply-body-' + idx);
    if (wrapper) {
        wrapper.outerHTML = `<div id="reply-body-${idx}" class="text-sm text-slate-800 whitespace-pre-wrap">${escapeHtml(doc.replies[idx].body)}</div>`;
    }
}

/* ─── Pin / Unpin ───────────────────────────────────────────── */
async function setDocumentPin(id, folder, userFolderId) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    const pin = prompt("Set a PIN for this document (leave blank for none):");
    if (pin === null) return;
    doc.pin = pin;
    await writeDocumentFile(doc, folder);
    showToast(pin ? "Document pinned." : "PIN cleared.", 'success');
    renderLinearViewer(doc, await resolveDocumentEvidenceUrl(doc), folder, userFolderId);
}

async function removeDocumentPin(id, folder, userFolderId) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    if (!confirm("Remove PIN from this document?")) return;
    doc.pin = "";
    window.unlockedDocs.add(id);
    await writeDocumentFile(doc, folder);
    showToast("PIN removed.", 'success');
    renderLinearViewer(doc, await resolveDocumentEvidenceUrl(doc), folder, userFolderId);
}

/* ─── Resolve / Archive / Relaunch / Delete ─────────────────── */
async function resolveDocument(id, userFolderId) {
    if (_busyOps.has(id)) return; _busyOps.add(id);
    const note = prompt("How was this resolved?");
    if (!note) { _busyOps.delete(id); return; }
    var doc = await _cloudGetDoc('Open', id);
    if (!doc) { showToast("Document not found.", 'error'); _busyOps.delete(id); return; }
    doc.status = "Resolved";
    doc.resolution = note;
    doc.resolvedDate = new Date().toISOString().substring(0, 10);
    await _cloudWriteDoc('Resolved', id, doc);
    await _cloudDeleteDoc('Open', id);

    // Offer follow-up document creation
    if (doc.followupTemplateId) {
        var createFollowup = confirm("Create a follow-up document from template?");
        if (createFollowup) {
            await _createFollowupDocument(doc);
        }
    }

    showToast("Document Resolved.", 'success');
    _busyOps.delete(id);
    if (userFolderId) { window.currentUserFolder = userFolderId; }
    renderDocuments();
}

async function _createFollowupDocument(originalDoc) {
    var tmpl = await _getFormTemplate(originalDoc.followupTemplateId);
    if (!tmpl) { showToast("Follow-up template not found.", 'error'); return; }
    var id = _uid("DOC-");
    var typePrefix = { 'General query': 'GQ', 'Investigation': 'INV', 'Review': 'REV', 'Issue raised': 'IR', 'Feedback': 'FB' };
    var prefix = typePrefix[originalDoc.type] || 'DOC';
    var seq = String(Date.now()).slice(-4);
    var newData = {
        id: id,
        creator: originalDoc.creator || '',
        date: new Date().toISOString().substring(0, 10),
        attentionOf: originalDoc.attentionOf || '',
        department: originalDoc.department || '',
        name: (originalDoc.name || 'Untitled') + ' (Follow-up)',
        title: (originalDoc.title || 'Untitled') + ' (Follow-up)',
        type: originalDoc.type || 'General query',
        body: 'Follow-up from: ' + (originalDoc.reference || originalDoc.id),
        status: 'Open',
        replies: [],
        reference: prefix + '-' + new Date().getFullYear() + '-' + seq,
        formTemplateId: originalDoc.followupTemplateId,
        formTemplateName: tmpl.name,
        formTemplateValues: {},
        parentDocId: originalDoc.id,
        parentDocRef: originalDoc.reference || ''
    };
    if (originalDoc.userFolderId) newData.userFolderId = originalDoc.userFolderId;
    await _cloudWriteDoc('Open', id, newData);
    openDocumentViewer(id, 'Open', newData.userFolderId || '');
}

async function archiveDocument(id, folder, userFolderId) {
    if (_busyOps.has(id)) return; _busyOps.add(id);
    if (!confirm("Archive this document?")) { _busyOps.delete(id); return; }
    var doc = await _cloudGetDoc(folder, id);
    if (!doc) { showToast("Document not found.", 'error'); _busyOps.delete(id); return; }
    doc.status = "Archived";
    doc.archivedDate = new Date().toISOString().substring(0, 10);
    await _cloudWriteDoc('Archive', id, doc);
    await _cloudDeleteDoc(folder, id);
    showToast("Document Archived.", 'success');
    _busyOps.delete(id);
    if (userFolderId) { window.currentUserFolder = userFolderId; }
    renderDocuments();
}

async function relaunchDocument(id, userFolderId) {
    if (_busyOps.has(id)) return; _busyOps.add(id);
    if (!confirm("Relaunch this document to Open?")) { _busyOps.delete(id); return; }
    var doc = await _cloudGetDoc('Archive', id);
    if (!doc) { showToast("Document not found.", 'error'); _busyOps.delete(id); return; }
    doc.status = "Open";
    delete doc.archivedDate;
    await _cloudWriteDoc('Open', id, doc);
    await _cloudDeleteDoc('Archive', id);
    showToast("Document relaunched to Open.", 'success');
    _busyOps.delete(id);
    if (userFolderId) { window.currentUserFolder = userFolderId; }
    renderDocuments();
}

async function permanentDeleteDocument(id) {
    if (_busyOps.has(id)) return; _busyOps.add(id);
    if (!confirm("PERMANENTLY delete this archived document? This cannot be undone.")) { _busyOps.delete(id); return; }
    var doc = await _cloudGetDoc('Archive', id);
    await _cloudDeleteDoc('Archive', id);
    if (doc && doc.evidenceFile && window._localDocsConnection) {
        try {
            var tx = window._localDocsConnection.transaction('files', 'readwrite');
            tx.objectStore('files').delete('Evidence/' + doc.evidenceFile);
        } catch (e) {}
    }
    showToast("Document deleted.", 'success');
    _busyOps.delete(id);
    renderDocuments();
}

async function relaunchResolvedDocument(id, userFolderId) {
    if (_busyOps.has(id)) return; _busyOps.add(id);
    if (!confirm("Relaunch this resolved document back to Open?")) { _busyOps.delete(id); return; }
    var doc = await _cloudGetDoc('Resolved', id);
    if (!doc) { showToast("Document not found.", 'error'); _busyOps.delete(id); return; }
    doc.status = "Open";
    await _cloudWriteDoc('Open', id, doc);
    await _cloudDeleteDoc('Resolved', id);
    showToast("Document relaunched to Open.", 'success');
    _busyOps.delete(id);
    if (userFolderId) { window.currentUserFolder = userFolderId; }
    renderDocuments();
}

async function deleteDocument(id, folder) {
    if (_busyOps.has(id)) return; _busyOps.add(id);
    if (!confirm("Permanently delete this document?")) { _busyOps.delete(id); return; }
    await _cloudDeleteDoc(folder, id);
    showToast("Document deleted.", 'success');
    _busyOps.delete(id);
    renderDocuments();
}

/* ─── Archive Tab ───────────────────────────────────────────── */
async function renderDocumentArchive() {
    if (!window.currentLoadedDocs || !window.currentLoadedDocs.archived) {
        window.currentLoadedDocs = await loadDocuments();
    }
    const docs = window.currentLoadedDocs.archived || [];
    var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
    var userDept = user ? user.department : '';

    /* Department filter */
    var archDepts = [...new Set(docs.map(function(d) { return d.department || 'General'; }))].sort();
    var filterDept = window._currentDeptFilter || userDept || 'All';
    if (filterDept !== 'All' && archDepts.indexOf(filterDept) === -1) filterDept = 'All';
    window._currentDeptFilter = filterDept;

    var deptFilterOpts = '<option value="All"' + (filterDept === 'All' ? ' selected' : '') + '>All Departments</option>';
    var archSeniorSet = {};
    if (typeof Users !== 'undefined' && Users.SENIOR_DEPARTMENTS) {
        Users.SENIOR_DEPARTMENTS.forEach(function(d) { archSeniorSet[d] = true; });
    }
    var archSeenSenior = false;
    archDepts.forEach(function(d) {
        if (archSeniorSet[d] && !archSeenSenior) {
            deptFilterOpts += '<option disabled style="font-weight:800;color:#5a6577;background:#f1ede8;">── Senior Leadership ──</option>';
            archSeenSenior = true;
        }
        deptFilterOpts += '<option value="' + d + '"' + (filterDept === d ? ' selected' : '') + '>' + d + '</option>';
    });

    var filtered = filterDept === 'All' ? docs : docs.filter(function(d) {
        return (d.department || 'General') === filterDept;
    });

    const sortDocs = (arr) => [...arr].sort((a, b) => {
        const da = new Date(a.archivedDate || a.date || 0).getTime() || 0;
        const db = new Date(b.archivedDate || b.date || 0).getTime() || 0;
        return db - da;
    });

    const docCard = (doc) => {
        const replies = Array.isArray(doc.replies) ? doc.replies : [];
        const lastReply = replies[replies.length - 1];
        return `
        <div class="card p-5 border-l-4 rounded-none mb-4 bg-white shadow-sm" style="border-left:4px solid var(--edwardian-rose);">
            <h4 class="font-black text-slate-800">${escapeHtml(doc.title || doc.name)}</h4>
            <p class="text-xs font-bold text-slate-500">${doc.reference ? '<span class="font-mono text-birds-green">' + escapeHtml(doc.reference) + '</span> \u2022 ' : ''}${escapeHtml(doc.type)} \u2022 ${escapeHtml(doc.date)}</p>
            <p class="text-xs font-bold text-slate-400">Author: ${escapeHtml(doc.creator || '\u2014')}${doc.attentionOf ? ' \u2022 For: ' + escapeHtml(doc.attentionOf) : ''}</p>
            ${doc.department ? `<p class="text-[10px] font-bold text-slate-400 uppercase">${escapeHtml(doc.department)}</p>` : ''}
            ${doc.parentDocRef ? '<p class="text-[10px] font-bold text-slate-400">Follow-up from: <span class="font-mono">' + (doc.parentDocId ? '<button onclick="event.stopPropagation();window._openLinkedDoc(\'' + escapeHtml(doc.parentDocId) + '\')" class="text-birds-green hover:underline cursor-pointer">' + escapeHtml(doc.parentDocRef) + '</button>' : escapeHtml(doc.parentDocRef)) + '</span></p>' : ''}
            ${doc.archivedDate ? `<p class="text-xs font-bold" style="color:var(--edwardian-rose);">Archived: ${escapeHtml(doc.archivedDate)}</p>` : ''}
            ${lastReply ? `<p class="text-xs text-slate-400 mt-2 italic">${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}</p>` : ''}
            <div class="flex gap-2 mt-4">
                <button onclick="openDocumentViewer('${doc.id}', 'Archive', '${doc.userFolderId || ''}')" style="background:var(--edwardian-rose);color:white;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;display:flex;flex:1;">Open</button>
                <button onclick="relaunchDocument('${doc.id}', '${doc.userFolderId || ''}')" style="background:rgba(85,91,110,0.08);color:#555B6E;" class="rounded-none text-sm flex-1 py-2 font-bold">Relaunch</button>
                <button onclick="permanentDeleteDocument('${doc.id}')" class="bg-red-100 text-red-700 rounded-none text-sm flex-1 py-2 font-bold hover:bg-red-200">Delete</button>
            </div>
        </div>`;
    };

    document.getElementById("mainView").innerHTML = `
        <div class="flex items-center justify-between mb-6">
            <div>
                <h2 class="text-[36px] font-black outfit" style="color:var(--edwardian-rose);">Document Archive</h2>
                <p class="text-slate-500 font-bold">${filtered.length} archived document${filtered.length !== 1 ? 's' : ''}${filterDept !== 'All' ? ' in ' + filterDept : ''}</p>
            </div>
            <select onchange="window._currentDeptFilter=this.value;renderDocumentArchive()" class="text-xs px-3 py-1.5 border border-slate-200 rounded-lg bg-white">${deptFilterOpts}</select>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            ${filtered.length ? sortDocs(filtered).map(d => docCard(d)).join('') : '<div class="card p-12 text-center col-span-full"><p class="text-slate-400 font-bold">No archived documents.</p></div>'}
        </div>`;
}
