window.currentLoadedDocs = { open: [], resolved: [], archived: [] };
window.unlockedDocs = new Set();
window.currentUserFolder = null;
window.unlockedFolders = new Set();

const _docDepartments = [
    'Head of Retail', 'Food Safety', 'Health & Safety',
    'Training & Development', 'Area Team', 'Auditor',
    'ALL Team', 'General'
];

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
        var req = store.openCursor();
        req.onsuccess = function(e) {
            var cursor = e.target.result;
            if (cursor) {
                if (cursor.value.path.startsWith('Documents/' + folder + '/')) {
                    try { results.push(JSON.parse(cursor.value.data)); } catch(ex) {}
                }
                cursor.continue();
            } else {
                if (results.length) { resolve(results); return; }
                _masterFolderDocs(folder).then(function(docs) {
                    if (docs.length > 0) {
                        docs.forEach(function(d) {
                            if (d && d.id) {
                                _localDocsPut(folder, d.id, d);
                            }
                        });
                    }
                    resolve(docs);
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
    return new Promise(function(resolve) {
        var tx = window._localDocsConnection.transaction('files', 'readwrite');
        tx.objectStore('files').put({ path: 'Documents/' + folder + '/' + id + '.json', data: JSON.stringify(data) });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { resolve(); };
    });
}
async function _localDocsDelete(folder, id) {
    if (!window._localDocsConnection) await _localDocsInit();
    return new Promise(function(resolve) {
        var tx = window._localDocsConnection.transaction('files', 'readwrite');
        tx.objectStore('files').delete('Documents/' + folder + '/' + id + '.json');
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { resolve(); };
    });
}
async function _localDocsGetText(path) {
    if (!window._localDocsConnection) await _localDocsInit();
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
    return new Promise(function(resolve) {
        var tx = window._localDocsConnection.transaction('files', 'readwrite');
        tx.objectStore('files').put({ path: path, data: text });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { resolve(); };
    });
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
        return JSON.parse(data);
    }
    return null;
}
async function _cloudGetDoc(folder, id) {
    var data = await _localDocsGetText('Documents/' + folder + '/' + id + '.json');
    if (data) return JSON.parse(data);
    // Fallback: try reading from the file system directly
    var text = await _localDocsGetTextFromMasterFolder(['Documents/' + folder + '/' + id + '.json', folder + '/' + id + '.json']);
    if (text) {
        var doc = JSON.parse(text);
        await _localDocsPut(folder, id, doc);
        return doc;
    }
    return null;
}
async function _cloudReadEvidence(fileName) { return null; }
async function _cloudWriteEvidence(fileName, file) { }

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
    var id = 'FOLDER-' + Date.now();
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
    alert('Incorrect PIN.');
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
    alert(newPin ? 'PIN updated.' : 'PIN removed.');
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
    if (!name) { alert('Folder name is required.'); return; }
    await _createUserFolder(name, pin);
    document.getElementById('create-folder-modal')?.remove();
    renderDocuments(true);
};

async function moveDocToFolder(id, folder, currentFolderId) {
    var doc = await _cloudGetDoc(folder, id);
    if (!doc) { alert("Document not found."); return; }
    var folders = await _loadFolderManifest();
    if (!folders.length) { alert("No custom folders exist. Create one first."); return; }
    var choice = prompt("Move to which folder?\n\nAvailable:\n" + folders.map((f, i) => (i + 1) + '. ' + f.name).join('\n') + "\n\nType number or folder name:");
    if (!choice) return;
    var targetFolder = null;
    var num = parseInt(choice);
    if (!isNaN(num) && num >= 1 && num <= folders.length) targetFolder = folders[num - 1];
    else targetFolder = folders.find(f => f.name.toLowerCase() === choice.trim().toLowerCase());
    if (!targetFolder) { alert("Folder not found."); return; }
    doc.userFolderId = targetFolder.id;
    await writeDocumentFile(doc, folder);
    alert("Moved to " + targetFolder.name);
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
                    html += '<div class="flex gap-2">';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="Yes" onclick="window._setYesNo(this)" class="px-5 py-1.5 rounded text-sm font-bold form-tpl-field form-tpl-yesno transition-all ' +
                        (val === 'Yes' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">Yes</button>';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="No" onclick="window._setYesNo(this)" class="px-5 py-1.5 rounded text-sm font-bold form-tpl-field form-tpl-yesno transition-all ' +
                        (val === 'No' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">No</button>';
                    html += '<input type="hidden" data-tplfield="' + f.id + '" value="' + escapeHtml(val) + '" class="form-tpl-field">';
                    html += '</div>';
                    break;
                case 'rag':
                    html += '<div class="flex gap-2">';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="Red" onclick="window._setRag(this)" class="px-4 py-1.5 rounded text-sm font-bold form-tpl-field form-tpl-rag transition-all ' +
                        (val === 'Red' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">Red</button>';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="Amber" onclick="window._setRag(this)" class="px-4 py-1.5 rounded text-sm font-bold form-tpl-field form-tpl-rag transition-all ' +
                        (val === 'Amber' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">Amber</button>';
                    html += '<button type="button" data-tplfield="' + f.id + '" data-val="Green" onclick="window._setRag(this)" class="px-4 py-1.5 rounded text-sm font-bold form-tpl-field form-tpl-rag transition-all ' +
                        (val === 'Green' ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">Green</button>';
                    html += '<input type="hidden" data-tplfield="' + f.id + '" value="' + escapeHtml(val) + '" class="form-tpl-field">';
                    html += '</div>';
                    break;
                case 'score':
                    var min = f.scoreMin || 1, max = f.scoreMax || 10;
                    var scoreVal = parseInt(val) || 0;
                    html += '<div class="flex gap-1 flex-wrap">';
                    for (var s = min; s <= max; s++) {
                        html += '<button type="button" data-tplfield="' + f.id + '" data-score="' + s + '" onclick="window._setScore(this)" class="w-9 h-9 rounded text-sm font-bold form-tpl-field form-tpl-score transition-all ' +
                            (scoreVal === s ? 'bg-birds-green text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">' + s + '</button>';
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
                    html += '<p class="text-sm font-black text-slate-800">' + escapeHtml(f.signoffRole || 'Manager') + '</p></div>';
                    html += '<div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Name</label>';
                    html += '<input type="text" data-tplfield="' + f.id + '" value="' + escapeHtml(parts[0] || '') + '" class="input-chip rounded-none w-full form-tpl-field" placeholder="Enter name..."></div>';
                    html += '<div class="flex-grow"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date</label>';
                    html += '<input type="date" data-tplfield="' + f.id + '" value="' + escapeHtml(parts[1] || new Date().toISOString().slice(0,10)) + '" class="input-chip rounded-none w-full form-tpl-field"></div>';
                    html += '<input type="hidden" data-tplfield="' + f.id + '" value="' + escapeHtml(parts[2] || '') + '" class="form-tpl-field">';
                    html += '</div>';
                    break;
                case 'header':
                    html += '<div class="my-2 border-b border-slate-200 pb-2">';
                    html += '<h3 class="text-lg font-extrabold text-slate-800">' + escapeHtml(f.label || 'Section Header') + '</h3>';
                    if (f.subLabel) html += '<p class="text-xs text-slate-400 mt-0.5">' + escapeHtml(f.subLabel) + '</p>';
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
                    var tableVals = (val || '').split('\n');
                    html += '<div class="overflow-x-auto"><table class="w-full text-sm border border-slate-200">';
                    html += '<thead><tr>';
                    for (var tc = 0; tc < cols; tc++) {
                        html += '<th class="bg-slate-100 border border-slate-200 p-2 text-left font-bold text-slate-600 text-xs">' + escapeHtml(headers[tc] || 'Col ' + (tc+1)) + '</th>';
                    }
                    html += '</tr></thead><tbody>';
                    for (var tr = 0; tr < rows; tr++) {
                        var rowParts = (tableVals[tr] || '').split(' | ');
                        html += '<tr>';
                        for (var tc = 0; tc < cols; tc++) {
                            html += '<td class="border border-slate-200 p-1"><input type="text" data-tplfield="' + f.id + '" data-row="' + tr + '" data-col="' + tc + '" value="' + escapeHtml(rowParts[tc] || '') + '" class="w-full p-1.5 text-sm border-0 bg-transparent form-tpl-field focus:bg-white focus:ring-1 focus:ring-emerald-300 rounded" placeholder=""></td>';
                        }
                        html += '</tr>';
                    }
                    html += '</tbody></table></div>';
                    break;
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
            html += '<div class="my-6 border-b border-emerald-600/20 pb-2">';
            html += '<h3 class="text-xl font-extrabold text-emerald-800 font-serif leading-snug">' + escapeHtml(f.label || 'Section Header') + '</h3>';
            if (f.subLabel) html += '<p class="text-xs text-slate-400 font-medium mt-0.5">' + escapeHtml(f.subLabel) + '</p>';
            html += '</div>';
            return;
        }
        if (at === 'divider') {
            html += '<hr class="border-t border-dashed border-slate-300/80 my-8">';
            return;
        }

        html += '<div class="bg-white rounded-lg p-3 border border-slate-200">';
        if (at !== 'signoff') {
            html += '<label class="text-xs font-bold text-slate-500 mb-1 block"><span class="text-slate-400">Q' + (i + 1) + '.</span> ' + escapeHtml(f.label) + scoreLabel + '</label>';
        }
        
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
                var nameVal = vals[0] || '';
                var dateVal = vals[1] || '';
                var signedVal = vals[2] || '';
                html += '<div class="p-5 border-2 border-dashed border-slate-200 rounded-2xl bg-amber-50/50 flex flex-col md:flex-row justify-between items-stretch gap-6">';
                html += '  <div class="flex-grow min-w-[120px]">';
                html += '    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Role / Title</label>';
                html += '    <p class="text-sm font-black text-slate-800 font-serif mt-1">' + escapeHtml(f.signoffRole || 'Manager') + '</p>';
                html += '  </div>';
                html += '  <div class="flex-grow">';
                html += '    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Sign-off By</label>';
                html += '    <p class="text-sm font-bold text-slate-800 mt-1">' + escapeHtml(nameVal || '—') + '</p>';
                html += '  </div>';
                html += '  <div class="flex-grow">';
                html += '    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date Signed</label>';
                html += '    <p class="text-sm font-bold text-slate-800 mt-1">' + escapeHtml(dateVal || '—') + '</p>';
                html += '  </div>';
                html += '  <div class="flex-grow flex flex-col justify-center min-w-[120px]">';
                html += '    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Signature Status</label>';
                html += '    <div class="flex items-center gap-1.5 text-emerald-700 font-black text-xs mt-1">';
                html += '      <span class="text-sm">✔️</span> Signed Electronically';
                html += '    </div>';
                html += '  </div>';
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
                var numCols = f.tableCols || 3;
                html += '<div class="overflow-x-auto"><table class="w-full text-sm border border-slate-200">';
                html += '<thead><tr>';
                for (var hc = 0; hc < numCols; hc++) {
                    html += '<th class="bg-slate-100 border border-slate-200 p-2 text-left font-bold text-slate-600 text-xs">' + escapeHtml(headers[hc] || 'Col ' + (hc+1)) + '</th>';
                }
                html += '</tr></thead><tbody>';
                tableRows.forEach(function(row) {
                    var cells = row.split(' | ');
                    html += '<tr>';
                    for (var cc = 0; cc < numCols; cc++) {
                        html += '<td class="border border-slate-200 p-2 text-sm">' + escapeHtml(cells[cc] || '—') + '</td>';
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

/* ─── Score / YesNo / Rag handlers ───────────────────────────── */
window._setScore = function(btn) {
    var score = btn.getAttribute('data-score');
    var hidden = btn.closest('.flex').querySelector('input[type="hidden"]');
    if (hidden) hidden.value = score;
    btn.closest('.flex').querySelectorAll('.form-tpl-score').forEach(function(b) { b.className = b.className.replace(/bg-birds-green text-white/, 'bg-slate-100 text-slate-600'); });
    btn.className = btn.className.replace(/bg-slate-100 text-slate-600/, 'bg-birds-green text-white');
};

window._setYesNo = function(btn) {
    var val = btn.getAttribute('data-val');
    var hidden = btn.parentElement.querySelector('input[type="hidden"]');
    if (hidden) hidden.value = val;
    btn.parentElement.querySelectorAll('.form-tpl-yesno').forEach(function(b) { b.className = b.className.replace(/bg-emerald-500 text-white/, 'bg-slate-100 text-slate-600').replace(/bg-red-500 text-white/, 'bg-slate-100 text-slate-600'); });
    btn.className = btn.className.replace('bg-slate-100 text-slate-600', val === 'Yes' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white');
};

window._setRag = function(btn) {
    var val = btn.getAttribute('data-val');
    var hidden = btn.parentElement.querySelector('input[type="hidden"]');
    if (hidden) hidden.value = val;
    btn.parentElement.querySelectorAll('.form-tpl-rag').forEach(function(b) { b.className = b.className.replace(/bg-red-500 text-white/, 'bg-slate-100 text-slate-600').replace(/bg-amber-500 text-white/, 'bg-slate-100 text-slate-600').replace(/bg-green-500 text-white/, 'bg-slate-100 text-slate-600'); });
    btn.className = btn.className.replace('bg-slate-100 text-slate-600', val === 'Red' ? 'bg-red-500 text-white' : val === 'Amber' ? 'bg-amber-500 text-white' : 'bg-green-500 text-white');
};

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
            } else if (at === 'score' || at === 'yesno' || at === 'rag') {
                var hidden = document.querySelector('input[type="hidden"].form-tpl-field[data-tplfield="' + f.id + '"]');
                values[f.id] = hidden ? hidden.value : '';
            } else if (at === 'three_col') {
                var els = document.querySelectorAll('input.form-tpl-field[data-tplfield="' + f.id + '"]');
                var parts = [];
                els.forEach(function(el) { parts.push(el.value || ''); });
                values[f.id] = parts.join(' | ');
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
            } else if (at === 'image') {
                var fileInput = document.querySelector('input[type="file"].form-tpl-field[data-tplfield="' + f.id + '"]');
                values[f.id] = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0].name : '';
            } else {
                var el = document.querySelector('.form-tpl-field[data-tplfield="' + f.id + '"]');
                values[f.id] = el ? el.value : '';
            }
        });
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
        overallRating: ''
    };

    scoredFields.forEach(function(f) {
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
        summary.fieldResults.push({
            label: f.label,
            type: f.answerType,
            scoringType: st,
            value: val,
            max: max,
            weight: weight,
            percent: max > 0 ? Math.round((val / max) * 100) : 0
        });
    });

    // Table row/col scoring (new scoringType attachment)
    tmpl.fields.filter(function(f) { return f.answerType === 'table' && f.scoringType && f.scoringType !== 'none' && f.tableScoredCols && f.tableScoredCols.length; }).forEach(function(f) {
        var weight = f.scoreWeight || 1;
        var cols = f.tableCols || 3;
        var rows = f.tableRows || 3;
        var headers = f.tableHeaders || [];
        var scoredCols = f.tableScoredCols || [];
        var max = f.scoreMax || 10;
        scoredCols.forEach(function(colIdx) {
            if (colIdx >= cols) return;
            var colTotal = 0;
            var colCount = 0;
            for (var r = 0; r < rows; r++) {
                var key = f.id + '_r' + r + '_c' + colIdx;
                var v = parseFloat(values[key]) || 0;
                if (v > 0) { colTotal += v; colCount++; }
            }
            var avg = colCount > 0 ? colTotal / colCount : 0;
            var weightedVal = avg * weight;
            var weightedMax = max * weight;
            summary.totalScore += weightedVal;
            summary.maxScore += weightedMax;
            summary.fieldResults.push({
                label: (headers[colIdx] || 'Col ' + (colIdx + 1)) + ' (table)',
                type: 'table_col',
                value: Math.round(avg),
                max: max,
                weight: weight,
                percent: max > 0 ? Math.round((avg / max) * 100) : 0
            });
        });
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

    // Field breakdown
    if (summary.fieldResults.length > 0) {
        html += '<div class="pt-3 border-t border-slate-200">';
        html += '<div class="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Question Breakdown</div>';
        html += '<div class="space-y-1.5">';
        summary.fieldResults.forEach(function(r) {
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
    const fDept = document.getElementById("filter-dept")?.value || "All";
    const fSort = document.getElementById("filter-sort")?.value || "newest";

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
            <p class="text-xs font-bold text-slate-500">${escapeHtml(doc.type)} • ${escapeHtml(doc.date)}</p>
            <p class="text-xs font-bold text-slate-400">Author: ${escapeHtml(doc.creator || '—')}${doc.attentionOf ? ` • For: ${escapeHtml(doc.attentionOf)}` : ''}</p>
            ${doc.department ? `<p class="text-[10px] font-bold text-slate-400 uppercase">${escapeHtml(doc.department)}</p>` : ''}
            ${lastReply ? `<p class="text-xs text-slate-400 mt-2 italic">${replies.length} repl${replies.length === 1 ? 'y' : 'ies'} — latest from ${escapeHtml(lastReply.author)}: "${escapeHtml(String(lastReply.body || '').slice(0, 60))}${String(lastReply.body || '').length > 60 ? '…' : ''}"</p>` : ''}
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
        var fDept2 = document.getElementById("filter-dept")?.value || "All";
        var fSort2 = document.getElementById("filter-sort")?.value || "newest";

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
                <select id="filter-dept" class="input-chip rounded-none" onchange="renderDocuments(true)">
                    <option value="All">All Departments</option>
                    ${deptOptions.map(a => `<option value="${escapeHtml(a)}" ${fDept2 === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
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
            <select id="filter-dept" class="input-chip rounded-none" onchange="renderDocuments(true)">
                <option value="All">All Departments</option>
                ${deptOptions.map(a => `<option value="${escapeHtml(a)}" ${fDept === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
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

    document.getElementById('mainView').innerHTML = `
    <div class="card p-6 border-t-4 border-t-birds-green rounded-none">
        <h2 class="text-2xl font-black birds-green mb-4">Create New Document</h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Author Name</label>
                <input type="text" id="doc-author" class="input-chip rounded-none w-full">
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Date</label>
                <input type="date" id="doc-date" class="input-chip rounded-none w-full" value="${today}">
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Department</label>
                <select id="doc-department" class="input-chip rounded-none w-full">
                    ${_docDepartments.map(d => `<option value="${d}">${d}</option>`).join('')}
                </select>
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Attention Of</label>
                <select id="doc-attention" class="input-chip rounded-none w-full">
                    ${_docDepartments.map(d => `<option value="${d}">${d}</option>`).join('')}
                </select>
            </div>
            <div class="md:col-span-2">
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Document Name / Title</label>
                <input type="text" id="doc-name" class="input-chip rounded-none w-full">
            </div>
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
};

async function saveDocumentRecord() {
    const author = document.getElementById("doc-author")?.value?.trim();
    if (!author) { alert('Author is required.'); return; }

    const id = "DOC-" + Date.now();
    const formTemplateId = document.getElementById("doc-form-template")?.value || '';
    const body = document.getElementById("doc-body")?.value?.trim() || '';
    const userFolderId = document.getElementById("doc-user-folder")?.value || '';

    const data = {
        id,
        creator: author,
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
    alert("Document Saved");
    if (userFolderId) {
        window.currentUserFolder = userFolderId;
    }
    renderDocuments();
}

/* ─── Add Reply ─────────────────────────────────────────────── */
async function addDocumentReply(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    const author = document.getElementById("reply-author")?.value?.trim();
    const body = document.getElementById("reply-body")?.value?.trim();
    if (!author || !body) { alert('Author and reply body are required.'); return; }

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
    if (!doc) return alert("Document not found.");
    if (doc.pin && !window.unlockedDocs.has(id)) {
        const input = prompt("Enter PIN:");
        if (input !== doc.pin) return alert("Access Denied");
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
            <div class="flex items-start justify-between mb-2">
                <h2 class="text-3xl font-black" id="doc-title-display">${escapeHtml(doc.name)}</h2>
                <div class="flex items-center gap-2">
                    ${doc.pin ? '<span class="text-amber-500 font-bold text-xs bg-amber-50 px-2 py-1 rounded">PINNED</span>' : ''}
                    ${doc.status ? '<span class="text-xs font-bold px-2 py-1 rounded" style="' +
                        (doc.status === 'Open' ? 'background:rgba(245,158,11,0.15);color:#b45309;' :
                         doc.status === 'Resolved' ? 'background:rgba(135,157,130,0.12);color:var(--edwardian-sage-dark);' :
                         'background:rgba(164,119,114,0.15);color:var(--edwardian-rose);') + '">' + escapeHtml(doc.status) + '</span>' : ''}
                </div>
            </div>
            <p class="text-xs font-bold text-slate-500 mb-1">ID: ${escapeHtml(doc.id)} | Author: ${escapeHtml(doc.creator)} | Type: ${escapeHtml(doc.type)}${doc.department ? ` | Dept: ${escapeHtml(doc.department)}` : ''}</p>
            <p class="text-xs font-bold text-slate-400 mb-4">Created: ${escapeHtml(doc.date)}${doc.attentionOf ? ` | For: ${escapeHtml(doc.attentionOf)}` : ''}</p>

            ${summaryHtml}

            <div id="doc-body-container">
                <div class="text-sm leading-relaxed p-5 bg-slate-50 rounded-none mb-2 whitespace-pre-wrap" id="doc-body-display">${escapeHtml(doc.body)}</div>
                <button onclick="editDocumentBodyInline('${doc.id}','${folder}')" class="text-[10px] font-bold text-birds-green hover:underline mb-4 print:hidden">Edit Document</button>
            </div>

            ${formTplHtml}

            ${doc.templateFields && Object.keys(doc.templateFields).length > 0 ? `
                <div class="mb-4">
                    <h3 class="text-xs font-black uppercase text-slate-400 mb-2">Template: ${escapeHtml(doc.templateName || 'Unknown')}</h3>
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

            ${doc.templateName && !doc.templateFields ? `<p class="text-xs text-slate-400 italic mb-4">Template: ${escapeHtml(doc.templateName)}</p>` : ''}

            ${evidenceUrl ? `<img src="${evidenceUrl}" class="w-64 mb-6 border-4 border-slate-50" />` : ''}

            ${replies.length ? `<div class="mb-6"><h3 class="text-sm font-black uppercase text-slate-400 mb-3">Replies (${replies.length})</h3>${replyHtml}</div>` : '<p class="text-sm text-slate-400 italic mb-6">No replies yet.</p>'}

            <div class="print:hidden border-t pt-6 mb-6">
                <h3 class="text-sm font-black uppercase text-slate-400 mb-3">Add a Reply</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <input type="text" id="reply-author" class="input-chip rounded-none w-full" placeholder="Your name">
                    <input type="date" id="reply-date" class="input-chip rounded-none w-full" value="${today}">
                </div>
                <textarea id="reply-body" class="w-full h-28 p-3 mb-3 border border-slate-300 rounded-lg resize-y" placeholder="Reply message..."></textarea>
                <div class="mb-3">
                    <label class="text-xs font-bold text-slate-500 mb-1 block">Attach Photo (optional)</label>
                    <input type="file" id="reply-photo" accept="image/*" class="text-sm">
                </div>
                <button onclick="addDocumentReply('${doc.id}', '${folder}')" style="background:var(--edwardian-rose);color:white;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">Save Reply</button>
            </div>

            <div class="print:hidden flex flex-wrap gap-2">
                <button onclick="${userFolderId ? 'enterUserFolder(\'' + userFolderId + '\')' : 'renderDocuments()'}" style="background:rgba(85,91,110,0.08);color:#555B6E;padding:8px 16px;border-radius:6px;font-weight:800;font-size:13px;">Back</button>
                <button onclick="window.print()" class="btn" style="background: var(--edwardian-rose); color: white; padding: 8px 16px; border-radius: 6px; font-weight: 800; font-size: 13px;">Print PDF</button>
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
    alert(pin ? "Document pinned." : "PIN cleared.");
    renderLinearViewer(doc, await resolveDocumentEvidenceUrl(doc), folder, userFolderId);
}

async function removeDocumentPin(id, folder, userFolderId) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    if (!confirm("Remove PIN from this document?")) return;
    doc.pin = "";
    window.unlockedDocs.add(id);
    await writeDocumentFile(doc, folder);
    alert("PIN removed.");
    renderLinearViewer(doc, await resolveDocumentEvidenceUrl(doc), folder, userFolderId);
}

/* ─── Resolve / Archive / Relaunch / Delete ─────────────────── */
async function resolveDocument(id, userFolderId) {
    const note = prompt("How was this resolved?");
    if (!note) return;
    var doc = await _cloudGetDoc('Open', id);
    if (!doc) { alert("Document not found."); return; }
    doc.status = "Resolved";
    doc.resolution = note;
    doc.resolvedDate = new Date().toISOString().substring(0, 10);
    await _cloudWriteDoc('Resolved', id, doc);
    await _cloudDeleteDoc('Open', id);
    alert("Document Resolved.");
    if (userFolderId) { window.currentUserFolder = userFolderId; }
    renderDocuments();
}

async function archiveDocument(id, folder, userFolderId) {
    if (!confirm("Archive this document?")) return;
    var doc = await _cloudGetDoc(folder, id);
    if (!doc) { alert("Document not found."); return; }
    doc.status = "Archived";
    doc.archivedDate = new Date().toISOString().substring(0, 10);
    await _cloudWriteDoc('Archive', id, doc);
    await _cloudDeleteDoc(folder, id);
    alert("Document Archived.");
    if (userFolderId) { window.currentUserFolder = userFolderId; }
    renderDocuments();
}

async function relaunchDocument(id, userFolderId) {
    if (!confirm("Relaunch this document to Open?")) return;
    var doc = await _cloudGetDoc('Archive', id);
    if (!doc) { alert("Document not found."); return; }
    doc.status = "Open";
    delete doc.archivedDate;
    await _cloudWriteDoc('Open', id, doc);
    await _cloudDeleteDoc('Archive', id);
    alert("Document relaunched to Open.");
    if (userFolderId) { window.currentUserFolder = userFolderId; }
    renderDocuments();
}

async function permanentDeleteDocument(id) {
    if (!confirm("PERMANENTLY delete this archived document? This cannot be undone.")) return;
    await _cloudDeleteDoc('Archive', id);
    alert("Document deleted.");
    renderDocuments();
}

async function relaunchResolvedDocument(id, userFolderId) {
    if (!confirm("Relaunch this resolved document back to Open?")) return;
    var doc = await _cloudGetDoc('Resolved', id);
    if (!doc) { alert("Document not found."); return; }
    doc.status = "Open";
    await _cloudWriteDoc('Open', id, doc);
    await _cloudDeleteDoc('Resolved', id);
    alert("Document relaunched to Open.");
    if (userFolderId) { window.currentUserFolder = userFolderId; }
    renderDocuments();
}

async function deleteDocument(id, folder) {
    if (!confirm("Permanently delete this document?")) return;
    await _cloudDeleteDoc(folder, id);
    alert("Document deleted.");
    renderDocuments();
}

/* ─── Archive Tab ───────────────────────────────────────────── */
async function renderDocumentArchive() {
    if (!window.currentLoadedDocs || !window.currentLoadedDocs.archived) {
        window.currentLoadedDocs = await loadDocuments();
    }
    const docs = window.currentLoadedDocs.archived || [];

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
            <p class="text-xs font-bold text-slate-500">${escapeHtml(doc.type)} • ${escapeHtml(doc.date)}</p>
            <p class="text-xs font-bold text-slate-400">Author: ${escapeHtml(doc.creator || '—')}${doc.attentionOf ? ` • For: ${escapeHtml(doc.attentionOf)}` : ''}</p>
            ${doc.department ? `<p class="text-[10px] font-bold text-slate-400 uppercase">${escapeHtml(doc.department)}</p>` : ''}
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
        <h2 class="text-[36px] font-black outfit mb-6" style="color:var(--edwardian-rose);">Document Archive</h2>
        <p class="text-slate-500 font-bold mb-6">${docs.length} archived document${docs.length !== 1 ? 's' : ''}</p>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            ${docs.length ? sortDocs(docs).map(d => docCard(d)).join('') : '<div class="card p-12 text-center col-span-full"><p class="text-slate-400 font-bold">No archived documents.</p></div>'}
        </div>`;
}
