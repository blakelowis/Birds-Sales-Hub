// === TRACKER TAB — Manual Data Entry Grid ===
// Stores: EHO rating, visit date, audit sector scores, total, audit date
// Auto-saves to shared folder (tracker_data.json) + IndexedDB
// Manual JSON import/export as fallback

var _trackerSaveTimer = null;
var _trackerLoading = false;
var _trackerSort = { col: 'name', dir: 'asc' };
var _trackerDataCache = {};

// === RAG Helpers ===
function trackerEhoRag(rating) {
    var r = parseInt(rating) || 0;
    if (r === 5) return 'bg-emerald-100 text-emerald-700 border-emerald-300';
    if (r === 4) return 'bg-green-100 text-green-700 border-green-300';
    if (r === 3) return 'bg-amber-100 text-amber-700 border-amber-300';
    if (r === 2) return 'bg-orange-100 text-orange-700 border-orange-300';
    if (r === 1) return 'bg-red-100 text-red-700 border-red-300';
    return 'bg-slate-100 text-slate-400 border-slate-200';
}

function trackerScoreRag(val) {
    var v = parseFloat(val) || 0;
    if (val === '' || val === undefined || val === null) return '';
    if (v === 0) return 'bg-red-100 text-red-700 font-black';
    if (v < 80) return 'bg-red-50 text-red-600 font-bold';
    if (v < 90) return 'bg-orange-50 text-orange-600 font-bold';
    if (v < 95) return 'bg-amber-50 text-amber-700 font-bold';
    return 'bg-emerald-50 text-emerald-700 font-black';
}

function trackerScoreBadge(val) {
    if (val === '' || val === undefined || val === null) return '';
    var cls = trackerScoreRag(val);
    return '<span class="inline-block px-1.5 py-0.5 rounded text-[11px] ' + cls + '">' + escapeHtml(val) + '</span>';
}

function trackerNextDueBadge(visitStr) {
    if (!visitStr) return '<span class="text-[10px] text-slate-400">—</span>';
    var visitDate = parseUKDate(visitStr);
    if (!visitDate || isNaN(visitDate.getTime())) return '<span class="text-[10px] text-slate-400">—</span>';
    var nextDue = new Date(visitDate);
    nextDue.setFullYear(nextDue.getFullYear() + 1);
    var now = new Date();
    var days = Math.ceil((nextDue - now) / 86400000);
    var dueStr = nextDue.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    if (days < 0) return '<span class="text-[10px] font-black text-red-600">' + dueStr + '</span>';
    if (days < 30) return '<span class="text-[10px] font-black text-amber-600">' + dueStr + '</span>';
    if (days < 90) return '<span class="text-[10px] font-bold text-blue-600">' + dueStr + '</span>';
    return '<span class="text-[10px] font-bold text-emerald-600">' + dueStr + '</span>';
}

var _trackerColDef = [
    { key: 'name',       label: 'Store',         cls: 'text-slate-500' },
    { key: 'am',         label: 'Area',           cls: 'text-slate-500' },
    { key: 'ehoRating',  label: 'EHO Rating',     cls: 'text-amber-600' },
    { key: 'inspectionDate', label: 'Inspection Date', cls: 'text-amber-600' },
    { key: 'ehoDue',     label: 'Next EHO Due',   cls: 'text-amber-600' },
    { key: 'food',       label: 'Food',           cls: 'text-emerald-600' },
    { key: 'fire',       label: 'Fire',           cls: 'text-emerald-600' },
    { key: 'hs',         label: 'H&S',            cls: 'text-emerald-600' },
    { key: 'journey',    label: 'Journey',        cls: 'text-emerald-600' },
    { key: 'coffee',     label: 'Coffee',         cls: 'text-emerald-600' },
    { key: 'focus',      label: 'Focus',          cls: 'text-emerald-600' },
    { key: 'total',      label: 'Total %',        cls: 'text-blue-600' },
    { key: 'auditDate',  label: 'Audit Date',     cls: 'text-blue-600' }
];

function buildStoresFromMap() {
    var s = [];
    var seen = {};
    storeMap.forEach(function(am, branchId) {
        if (am === 'Unassigned' || am === 'Training') return;
        var displayName = (typeof originalStoreNames !== 'undefined' && originalStoreNames.get(branchId)) || branchId;
        var cid = canonicalStoreId(displayName);
        if (!seen[cid]) {
            seen[cid] = true;
            s.push({ id: branchId, name: displayName, am: am });
        }
    });
    s.sort(function(a, b) { return a.name.localeCompare(b.name); });
    return s;
}

function buildStoresFromEhoData(saved) {
    var s = [];
    var seen = {};
    Object.keys(saved).forEach(function(storeId) {
        var d = saved[storeId];
        var displayName = (typeof originalStoreNames !== 'undefined' && originalStoreNames.get(storeId)) || storeId;
        var am = (typeof storeMap !== 'undefined' && storeMap.get(storeId)) || 'Unassigned';
        if (am === 'Training') return;
        var cid = canonicalStoreId(displayName);
        if (!seen[cid]) {
            seen[cid] = true;
            s.push({ id: storeId, name: displayName, am: am });
        }
    });
    s.sort(function(a, b) { return a.name.localeCompare(b.name); });
    return s;
}

function mergeStoreLists(mapStores, dataStores) {
    var seen = {};
    var merged = [];
    mapStores.forEach(function(s) {
        var cid = canonicalStoreId(s.name);
        if (!seen[cid]) { seen[cid] = true; merged.push(s); }
    });
    dataStores.forEach(function(s) {
        var cid = canonicalStoreId(s.name);
        if (!seen[cid]) { seen[cid] = true; merged.push(s); }
    });
    merged.sort(function(a, b) { return a.name.localeCompare(b.name); });
    return merged;
}

window.renderTracker = function() {
    var mainView = document.getElementById('mainView');
    if (!mainView) return;

    var stores = buildStoresFromMap();
    var ams = AM_LIST.filter(function(a) { return a !== 'Unassigned'; });

    var headerCells = _trackerColDef.map(function(col) {
        var arrow = '';
        if (_trackerSort.col === col.key) arrow = _trackerSort.dir === 'asc' ? ' ▲' : ' ▼';
        return '<th class="tracker-th p-3 text-[10px] font-black ' + col.cls + ' uppercase tracking-wider cursor-pointer select-none hover:bg-slate-100 transition-colors sticky top-0 z-20 bg-slate-100" data-col="' + col.key + '" onclick="trackerHeaderSort(\'' + col.key + '\')">' + col.label + arrow + '</th>';
    }).join('');

    function renderTable(saved, overrideStores) {
        _trackerDataCache = saved;
        var activeStores = overrideStores || stores;
        mainView.innerHTML = `
    <div id="tracker-view" class="flex flex-col" style="height:calc(100vh - 120px)">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 shrink-0">
            <h2 class="text-2xl font-black outfit birds-green uppercase tracking-tight">EHO & Audit Tracker</h2>
            <div class="flex flex-wrap gap-2">
                <button onclick="trackerRefreshFromFolder()" class="btn-primary text-xs">Refresh from Folder</button>
            </div>
        </div>
        <div id="trackerSyncStatus" class="text-xs font-bold text-slate-400 mb-2 shrink-0"></div>

        <div class="bg-white rounded-xl border border-slate-200 p-4 mb-4 shadow-sm shrink-0">
            <div class="flex flex-wrap gap-3 items-end">
                <div class="filter-group">
                    <label>Area Manager</label>
                    <select id="trackerFilterAM" onchange="trackerApplyFilter()">
                        <option value="ALL">All Areas</option>
                        ${ams.map(a => '<option value="' + escapeHtml(a) + '">' + escapeHtml(a) + '</option>').join('')}
                    </select>
                </div>
                <div class="filter-group">
                    <label>Search Store</label>
                    <input type="text" id="trackerFilterSearch" placeholder="Type to search..." oninput="trackerApplyFilter()" class="w-56">
                </div>
                <div class="filter-group">
                    <label>EHO Status</label>
                    <select id="trackerFilterEHO" onchange="trackerApplyFilter()">
                        <option value="ALL">All</option>
                        <option value="overdue">Overdue</option>
                        <option value="duesoon">Due Soon (6 weeks)</option>
                        <option value="indate">In Date</option>
                        <option value="nodate">No Date Set</option>
                    </select>
                </div>
                <button onclick="trackerClearFilters()" class="btn text-xs">Clear Filters</button>
                <button onclick="trackerExportPNG()" class="btn-primary text-xs">Export PNG</button>
                <button onclick="trackerPrintPDF()" class="bg-rose-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md hover:bg-rose-700">PDF Export</button>
                <span id="trackerRowCount" class="text-xs font-bold text-slate-400 ml-auto"></span>
            </div>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-sm min-h-0 flex-1">
            <div class="overflow-auto h-full relative">
                <table class="w-full text-left border-collapse" id="trackerTable">
                    <thead class="bg-slate-100 border-b-2 border-slate-200">
                        <tr>
                            ${headerCells}
                        </tr>
                    </thead>
                    <tbody id="trackerTableBody">
                        ${activeStores.map(function(s) {
                            var d = saved[s.id] || {};
                            return trackerRowHTML(s.id, s.name, s.am, d);
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div id="trackerKpis" class="grid grid-cols-2 md:grid-cols-7 gap-4 mt-4 shrink-0"></div>
    </div>`;
        window._trackerStores = activeStores;
        trackerRenderKpis(activeStores, saved);
        trackerApplyFilter();
    }

    // Always render immediately with empty data
    renderTable({});

    // Load data: always read from folder first, merge with IDB by newest timestamp, fall back to defaults
    if (typeof idbGetAll === 'function' && typeof db !== 'undefined' && db) {
        trackerLoadFromFolder().then(function(folderData) {
            if (folderData && Object.keys(folderData).length > 0) {
                // Merge folder data with IDB — keep newer version of each record
                return idbGetAll('eho_data').then(function(idbRows) {
                    var idbMap = {};
                    idbRows.forEach(function(r) { idbMap[r.StoreId] = r; });
                    var merged = {};
                    Object.keys(folderData).forEach(function(k) {
                        var folderRec = folderData[k];
                        var idbRec = idbMap[k];
                        if (idbRec && idbRec.updatedAt && folderRec.updatedAt && new Date(idbRec.updatedAt) > new Date(folderRec.updatedAt)) {
                            merged[k] = idbRec;
                        } else {
                            merged[k] = folderRec;
                        }
                        delete idbMap[k];
                    });
                    // Any records only in IDB (from unsaved edits) keep them
                    Object.keys(idbMap).forEach(function(k) { merged[k] = idbMap[k]; });
                    return Promise.all(Object.keys(merged).map(function(k) { return idbPut('eho_data', merged[k]); })).then(function() {
                        var withData = mergeStoreLists(stores, buildStoresFromEhoData(merged));
                        return { data: merged, stores: withData };
                    });
                });
            }
            // No folder data — try IndexedDB
            return idbGetAll('eho_data').then(function(rows) {
                var saved = {};
                rows.forEach(function(r) { saved[r.StoreId] = r; });
                if (Object.keys(saved).length > 0) {
                    var withData = mergeStoreLists(stores, buildStoresFromEhoData(saved));
                    return { data: saved, stores: withData };
                }
                // Nothing anywhere — load defaults
                return fetch('./tracker_defaults.json').then(function(r) { return r.json(); }).then(function(defaults) {
                    var storesData = defaults.stores || {};
                    return Promise.all(Object.keys(storesData).map(function(k) { return idbPut('eho_data', storesData[k]); })).then(function() {
                        console.log('[Tracker] Loaded defaults from tracker_defaults.json');
                        var withData = mergeStoreLists(stores, buildStoresFromEhoData(storesData));
                        return { data: storesData, stores: withData };
                    });
                });
            });
        }).then(function(result) {
            if (result && result.data && Object.keys(result.data).length > 0 && currentView === 'tracker') {
                stores = result.stores;
                renderTable(result.data, stores);
            }
        }).catch(function(e) { console.warn('[Tracker] Load failed:', e); });
    }
};



function trackerRowHTML(id, name, am, d) {
    var ehoCsv = (typeof window._ehoRatings !== 'undefined' && window._ehoRatings.get(name.toLowerCase())) || window._ehoRatings.get(id.toLowerCase()) || null;
    var rating = d.ehoRating || (ehoCsv ? String(ehoCsv.rating) : '');
    var visit = d.ehoVisit || '';
    var inspectionDate = d.inspectionDate || (ehoCsv ? ehoCsv.inspectionDate : '') || '';
    var food = d.food !== undefined && d.food !== null ? d.food : '';
    var fire = d.fire !== undefined && d.fire !== null ? d.fire : '';
    var hs = d.hs !== undefined && d.hs !== null ? d.hs : '';
    var journey = d.journey !== undefined && d.journey !== null ? d.journey : '';
    var coffee = d.coffee !== undefined && d.coffee !== null ? d.coffee : '';
    var focus = d.focus !== undefined && d.focus !== null ? d.focus : '';
    var total = d.total !== undefined && d.total !== null ? d.total : '';
    var auditDate = d.auditDate || '';

    var ratingOpts = '<option value=""></option>';
    for (var i = 1; i <= 5; i++) {
        ratingOpts += '<option value="' + i + '"' + (String(rating) === String(i) ? ' selected' : '') + '>' + i + ' Star</option>';
    }

    var nextDueVal = d.nextDue || '';
    if (!nextDueVal && ehoCsv && ehoCsv.nextDue) {
        nextDueVal = ehoCsv.nextDue;
    } else if (!nextDueVal && visit) {
        var vd = parseUKDate(visit);
        if (vd && !isNaN(vd.getTime())) {
            var nd = new Date(vd);
            nd.setFullYear(nd.getFullYear() + 1);
            nextDueVal = nd.toISOString().slice(0, 10);
        }
    }

    var nextDueRagCls = 'border-slate-200';
    if (nextDueVal) {
        var nrd = parseUKDate(nextDueVal);
        if (nrd && !isNaN(nrd.getTime())) {
            var nrDays = Math.ceil((nrd - new Date()) / 86400000);
            if (nrDays < 0) nextDueRagCls = 'border-red-400 bg-red-50 text-red-700 font-bold';
            else if (nrDays < 30) nextDueRagCls = 'border-amber-400 bg-amber-50 text-amber-700 font-bold';
            else if (nrDays < 90) nextDueRagCls = 'border-blue-400 bg-blue-50 text-blue-700 font-bold';
            else nextDueRagCls = 'border-emerald-400 bg-emerald-50 text-emerald-700 font-bold';
        }
    }
    var nextDueInput = '<input type="text" value="' + escapeHtml(nextDueVal) + '" placeholder="dd/mm/yyyy" class="w-24 text-[10px] border rounded px-1 py-1 focus:ring-2 focus:ring-emerald-500 outline-none ' + nextDueRagCls + '" onchange="trackerField(\'' + id + '\',\'nextDue\',this.value)">';


    var inspRagCls = 'border-slate-200';
    if (inspectionDate) {
        var inspD = parseUKDate(inspectionDate);
        if (inspD && !isNaN(inspD.getTime())) {
            var inspAge = Math.floor((Date.now() - inspD.getTime()) / 86400000);
            if (inspAge > 730) inspRagCls = 'border-red-400 bg-red-50 text-red-700 font-bold';
            else if (inspAge > 365) inspRagCls = 'border-amber-400 bg-amber-50 text-amber-700 font-bold';
            else inspRagCls = 'border-emerald-400 bg-emerald-50 text-emerald-700 font-bold';
        }
    }

    var starHtml = '';
    if (rating) {
        var starColors = { '5': 'text-emerald-500', '4': 'text-green-500', '3': 'text-amber-500', '2': 'text-orange-500', '1': 'text-red-500' };
        var sc = starColors[String(rating)] || 'text-slate-300';
        starHtml = '<div class="flex items-center gap-0.5">';
        for (var si = 0; si < 5; si++) {
            starHtml += '<svg class="w-3 h-3 ' + (si < parseInt(rating) ? sc : 'text-slate-200') + '" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';
        }
        starHtml += '</div>';
    }

        var baseScoreCls = 'w-14 text-xs border rounded px-1 py-1 text-center focus:ring-2 focus:ring-emerald-500 outline-none';
        var ehoStatus = 'nodate'; var ehoDueDays = '9999'; if (nextDueVal) { var nd = parseUKDate(nextDueVal); if (nd && !isNaN(nd.getTime())) { var days = Math.ceil((nd - new Date()) / 86400000); ehoDueDays = String(days); if (days < 0) ehoStatus = 'overdue'; else if (days <= 42) ehoStatus = 'duesoon'; else ehoStatus = 'indate'; } }
        return '<tr class="tracker-row border-b border-slate-100 hover:bg-slate-50 transition-colors" data-storeid="' + escapeHtml(id) + '" data-am="' + escapeHtml(am) + '" data-rating="' + escapeHtml(rating) + '" data-total="' + escapeHtml(total) + '" data-name="' + escapeHtml(name.toLowerCase()) + '" data-nextdue="' + escapeHtml(nextDueVal) + '" data-ehodue="' + ehoDueDays + '" data-ehostatus="' + ehoStatus + '">' +
        '<td class="p-2 border-b border-slate-100 sticky left-0 bg-white hover:bg-slate-50 z-10"><span class="text-xs font-black text-slate-800">' + escapeHtml(name) + '</span></td>' +
        '<td class="p-2 border-b border-slate-100"><select class="w-24 text-[10px] border border-slate-200 rounded px-1 py-1 focus:ring-2 focus:ring-emerald-500 outline-none" onchange="trackerField(\'' + id + '\',\'am\',this.value)">' + AM_LIST.filter(function(a){return a!=='Unassigned'}).map(function(a){return '<option value="'+escapeHtml(a)+'"'+(a===am?' selected':'')+'>'+escapeHtml(a)+'</option>'}).join('') + '</select></td>' +
        '<td class="p-2 border-b border-slate-100"><div class="flex items-center gap-1"><select class="w-20 text-xs border border-slate-200 rounded px-1 py-1 focus:ring-2 focus:ring-emerald-500 outline-none" onchange="trackerField(\'' + id + '\',\'ehoRating\',this.value)">' + ratingOpts + '</select>' + starHtml + '</div></td>' +
        '<td class="p-2 border-b border-slate-100"><input type="text" value="' + escapeHtml(inspectionDate) + '" placeholder="dd/mm/yyyy" class="w-24 text-[10px] border rounded px-1 py-1 focus:ring-2 focus:ring-emerald-500 outline-none ' + inspRagCls + '" onchange="trackerField(\'' + id + '\',\'inspectionDate\',this.value)"></td>' +
        '<td class="p-2 border-b border-slate-100">' + nextDueInput + '</td>' +
        '<td class="p-2 border-b border-slate-100"><input type="number" min="0" max="100" value="' + escapeHtml(food) + '" class="' + baseScoreCls + ' ' + trackerScoreRag(food) + '" onchange="trackerField(\'' + id + '\',\'food\',this.value)"></td>' +
        '<td class="p-2 border-b border-slate-100"><input type="number" min="0" max="100" value="' + escapeHtml(fire) + '" class="' + baseScoreCls + ' ' + trackerScoreRag(fire) + '" onchange="trackerField(\'' + id + '\',\'fire\',this.value)"></td>' +
        '<td class="p-2 border-b border-slate-100"><input type="number" min="0" max="100" value="' + escapeHtml(hs) + '" class="' + baseScoreCls + ' ' + trackerScoreRag(hs) + '" onchange="trackerField(\'' + id + '\',\'hs\',this.value)"></td>' +
        '<td class="p-2 border-b border-slate-100"><input type="number" min="0" max="100" value="' + escapeHtml(journey) + '" class="' + baseScoreCls + ' ' + trackerScoreRag(journey) + '" onchange="trackerField(\'' + id + '\',\'journey\',this.value)"></td>' +
        '<td class="p-2 border-b border-slate-100"><input type="number" min="0" max="100" value="' + escapeHtml(coffee) + '" class="' + baseScoreCls + ' ' + trackerScoreRag(coffee) + '" onchange="trackerField(\'' + id + '\',\'coffee\',this.value)"></td>' +
        '<td class="p-2 border-b border-slate-100"><input type="number" min="0" max="100" value="' + escapeHtml(focus) + '" class="' + baseScoreCls + ' ' + trackerScoreRag(focus) + '" onchange="trackerField(\'' + id + '\',\'focus\',this.value)"></td>' +
        '<td class="p-2 border-b border-slate-100"><input type="number" min="0" max="100" value="' + escapeHtml(total) + '" class="w-16 text-xs border rounded px-1 py-1 text-center font-black focus:ring-2 focus:ring-emerald-500 outline-none ' + trackerScoreRag(total) + '" onchange="trackerField(\'' + id + '\',\'total\',this.value)"></td>' +
        '<td class="p-2 border-b border-slate-100"><input type="text" value="' + escapeHtml(auditDate) + '" placeholder="dd/mm/yyyy" class="w-24 text-xs border border-slate-200 rounded px-1 py-1 focus:ring-2 focus:ring-emerald-500 outline-none" onchange="trackerField(\'' + id + '\',\'auditDate\',this.value)"></td>' +
        '</tr>';
}

// === Field Change Handler ===
window.trackerField = function(storeId, field, value) {
    var rec = _trackerDataCache[storeId] || { StoreId: storeId };
    rec[field] = value;
    rec.updatedAt = new Date().toISOString();
    _trackerDataCache[storeId] = rec;
    idbPut('eho_data', rec);
    trackerScheduleSave();
    // Update row data attributes for sort without full re-render
    var row = document.querySelector('.tracker-row[data-storeid="' + storeId.replace(/"/g, '') + '"]');
    if (!row) return;
    if (field === 'ehoRating') row.setAttribute('data-rating', value);
    if (field === 'total') row.setAttribute('data-total', value);
    if (field === 'am') row.setAttribute('data-am', value);
    if (field === 'nextDue') row.setAttribute('data-nextdue', value);
    if (field === 'inspectionDate') {
        // Recalculate next due from inspection date
        var nd = '';
        if (value) {
            var vd = parseUKDate(value);
            if (vd && !isNaN(vd.getTime())) {
                var ndt = new Date(vd);
                ndt.setFullYear(ndt.getFullYear() + 1);
                nd = ndt.toISOString().slice(0, 10);
            }
        }
        row.setAttribute('data-nextdue', nd);
        var cells = row.querySelectorAll('td');
        if (cells[4]) cells[4].innerHTML = trackerNextDueBadge(nd);
    }
    if (field === 'ehoVisit') {
        var nd = '';
        if (value) {
            var vd = parseUKDate(value);
            if (vd && !isNaN(vd.getTime())) {
                var ndt = new Date(vd);
                ndt.setFullYear(ndt.getFullYear() + 1);
                nd = ndt.toISOString().slice(0, 10);
            }
        }
        row.setAttribute('data-nextdue', nd);
        var cells = row.querySelectorAll('td');
        if (cells[4]) cells[4].innerHTML = trackerNextDueBadge(value);
    }
};

function trackerScheduleSave() {
    if (_trackerSaveTimer) clearTimeout(_trackerSaveTimer);
    var statusEl = document.getElementById('trackerSyncStatus');
    if (statusEl) statusEl.textContent = 'Saving...';
    _trackerSaveTimer = setTimeout(function() { trackerSaveToFolder(); }, 800);
}

async function trackerSaveToFolder() {
    var statusEl = document.getElementById('trackerSyncStatus');
    try {
        var rows = await idbGetAll('eho_data');
        var data = {};
        rows.forEach(function(r) { data[r.StoreId] = r; });
        _trackerDataCache = data;
        var exportObj = { version: 1, exportedAt: new Date().toISOString(), stores: data };
        var json = JSON.stringify(exportObj, null, 2);

        if (window.__azureConfig && typeof GraphAPI !== 'undefined' && GraphAPI.isAuthenticated()) {
            await GraphAPI.uploadFile('tracker_data.json', json, 'application/json');
            if (statusEl) statusEl.textContent = 'Saved to SharePoint';
        } else {
            if (statusEl) statusEl.textContent = 'Not signed in — data kept locally';
        }
        trackerRefreshKpis();
    } catch(e) {
        console.warn('[Tracker] Save failed:', e);
        if (statusEl) statusEl.textContent = 'Save failed — data kept locally';
    }
}

function trackerRefreshKpis() {
    var activeStores = window._trackerStores;
    if (activeStores && activeStores.length > 0) {
        trackerRenderKpis(activeStores, _trackerDataCache);
    }
}

async function trackerLoadFromFolder() {
    if (window.__azureConfig && typeof GraphAPI !== 'undefined' && GraphAPI.isAuthenticated()) {
        try {
            var cloudText = await GraphAPI.downloadFileAsText('tracker_data.json');
            var importObj = JSON.parse(cloudText);
            return importObj.stores || importObj;
        } catch(e) {
            console.log('[Tracker] Cloud load unavailable:', e.message);
            return null;
        }
    }
    return null;
}

// === Sortable Column Headers ===
window.trackerHeaderSort = function(colKey) {
    if (_trackerSort.col === colKey) {
        _trackerSort.dir = _trackerSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        _trackerSort.col = colKey;
        _trackerSort.dir = (colKey === 'name' || colKey === 'am') ? 'asc' : 'desc';
    }
    // Update header arrows
    document.querySelectorAll('.tracker-th').forEach(function(th) {
        var k = th.getAttribute('data-col');
        var arrow = '';
        if (k === _trackerSort.col) arrow = _trackerSort.dir === 'asc' ? ' ▲' : ' ▼';
        // Remove label text, re-add with arrow
        var def = _trackerColDef.find(function(c) { return c.key === k; });
        if (def) th.textContent = def.label + arrow;
    });
    trackerApplyFilter();
};

// === Refresh from shared folder (gentle in-place update) ===
window.trackerRefreshFromFolder = async function() {
    var statusEl = document.getElementById('trackerSyncStatus');
    if (statusEl) statusEl.textContent = 'Refreshing from folder...';
    try {
        var folderData = await trackerLoadFromFolder();
        if (folderData && Object.keys(folderData).length > 0) {
            // Merge folder data with IDB — keep newer version of each record
            var idbRows = await idbGetAll('eho_data');
            var idbMap = {};
            idbRows.forEach(function(r) { idbMap[r.StoreId] = r; });
            var mergedData = {};
            Object.keys(folderData).forEach(function(k) {
                var folderRec = folderData[k];
                var idbRec = idbMap[k];
                if (idbRec && idbRec.updatedAt && folderRec.updatedAt && new Date(idbRec.updatedAt) > new Date(folderRec.updatedAt)) {
                    mergedData[k] = idbRec;
                } else {
                    mergedData[k] = folderRec;
                }
                delete idbMap[k];
            });
            Object.keys(idbMap).forEach(function(k) { mergedData[k] = idbMap[k]; });
            _trackerDataCache = mergedData;
            var keys = Object.keys(mergedData);
            for (var i = 0; i < keys.length; i++) {
                await idbPut('eho_data', mergedData[keys[i]]);
            }
            if (statusEl) statusEl.textContent = 'Refreshed ' + keys.length + ' stores from folder';
            // Merge store list — include any stores in tracker data not in storeMap
            var merged = mergeStoreLists(buildStoresFromMap(), buildStoresFromEhoData(mergedData));
            window._trackerStores = merged;
            // Re-render only the table body and KPIs, preserving scroll position
            var tbody = document.getElementById('trackerTableBody');
            if (tbody) {
                tbody.innerHTML = merged.map(function(s) {
                    var d = mergedData[s.id] || {};
                    return trackerRowHTML(s.id, s.name, s.am, d);
                }).join('');
                trackerRenderKpis(merged, mergedData);
                trackerApplyFilter();
            } else {
                renderTracker();
            }
        } else {
            if (statusEl) statusEl.textContent = 'No data in folder yet';
        }
    } catch(e) {
        console.warn('[Tracker] Refresh failed:', e);
        if (statusEl) statusEl.textContent = 'Refresh failed';
    }
};

// === Filters + Sort ===
window.trackerApplyFilter = function() {
    var amFilter = document.getElementById('trackerFilterAM').value;
    var search = (document.getElementById('trackerFilterSearch').value || '').toLowerCase();
    var ehoFilter = document.getElementById('trackerFilterEHO').value;
    var tbody = document.getElementById('trackerTableBody');
    if (!tbody) return;
    var rows = Array.from(tbody.querySelectorAll('.tracker-row'));
    var visible = 0;

    // Filter
    rows.forEach(function(row) {
        var show = true;
        if (amFilter !== 'ALL' && row.getAttribute('data-am') !== amFilter) show = false;
        if (search && !row.getAttribute('data-name').includes(search)) show = false;
        if (ehoFilter !== 'ALL' && row.getAttribute('data-ehostatus') !== ehoFilter) show = false;
        row.style.display = show ? '' : 'none';
        if (show) visible++;
    });

    // Sort visible rows
    var visibleRows = rows.filter(function(r) { return r.style.display !== 'none'; });
    var col = _trackerSort.col;
    var dir = _trackerSort.dir === 'asc' ? 1 : -1;

    visibleRows.sort(function(a, b) {
        if (col === 'name') return dir * (a.getAttribute('data-name') || '').localeCompare(b.getAttribute('data-name') || '');
        if (col === 'am') return dir * (a.getAttribute('data-am') || '').localeCompare(b.getAttribute('data-am') || '');
        if (col === 'ehoRating') {
            var aR = parseInt(a.getAttribute('data-rating')) || 0;
            var bR = parseInt(b.getAttribute('data-rating')) || 0;
            return dir * (aR - bR);
        }
        if (col === 'ehoDue') {
            var aD = parseInt(a.getAttribute('data-ehodue')) || 9999;
            var bD = parseInt(b.getAttribute('data-ehodue')) || 9999;
            return dir * (aD - bD);
        }
        if (col === 'total') {
            var aT = parseFloat(a.getAttribute('data-total')) || 0;
            var bT = parseFloat(b.getAttribute('data-total')) || 0;
            return dir * (aT - bT);
        }
        // Default sort: overdue first (ascending by days remaining)
        var aS = parseInt(a.getAttribute('data-ehodue')) || 9999;
        var bS = parseInt(b.getAttribute('data-ehodue')) || 9999;
        return aS - bS;
    });

    visibleRows.forEach(function(row) { tbody.appendChild(row); });
    document.getElementById('trackerRowCount').textContent = visible + ' of ' + rows.length + ' stores';
};

window.trackerClearFilters = function() {
    document.getElementById('trackerFilterAM').value = 'ALL';
    document.getElementById('trackerFilterSearch').value = '';
    document.getElementById('trackerFilterEHO').value = 'ALL';
    _trackerSort = { col: 'name', dir: 'asc' };
    // Reset header arrows
    document.querySelectorAll('.tracker-th').forEach(function(th) {
        var k = th.getAttribute('data-col');
        var def = _trackerColDef.find(function(c) { return c.key === k; });
        if (def) th.textContent = def.label;
    });
    trackerApplyFilter();
};

// === KPIs ===
function trackerRenderKpis(stores, saved) {
    var el = document.getElementById('trackerKpis');
    if (!el) return;

    var total = stores.length;
    var r5 = 0, r4 = 0, r3below = 0, rNoRating = 0, overdue = 0, audited = 0;
    var now = new Date();

    stores.forEach(function(s) {
        var d = saved[s.id] || {};
        var r = parseInt(d.ehoRating) || 0;
        if (!r && typeof window._ehoRatings !== 'undefined') {
            var ehoCsv = window._ehoRatings.get(s.name.toLowerCase()) || window._ehoRatings.get(s.id.toLowerCase());
            if (ehoCsv) r = parseInt(ehoCsv.rating) || 0;
        }
        if (r === 5) r5++;
        else if (r === 4) r4++;
        else if (r > 0 && r <= 3) r3below++;
        else rNoRating++;

        var dueDate = null;
        if (d.ehoVisit) {
            dueDate = parseUKDate(d.ehoVisit);
            if (dueDate && !isNaN(dueDate.getTime())) {
                var nd = new Date(dueDate);
                nd.setFullYear(nd.getFullYear() + 1);
                dueDate = nd;
            } else {
                dueDate = null;
            }
        }
        if (!dueDate && typeof window._ehoRatings !== 'undefined') {
            var ehoCsv = window._ehoRatings.get(s.name.toLowerCase()) || window._ehoRatings.get(s.id.toLowerCase());
            if (ehoCsv && ehoCsv.nextDue) {
                dueDate = parseUKDate(ehoCsv.nextDue);
            }
        }
        if (dueDate && !isNaN(dueDate.getTime()) && dueDate < now) overdue++;

        if (d.total) audited++;
    });

    el.innerHTML =
        '<div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">Total Stores</div><div class="text-2xl font-black text-blue-600">' + total + '</div></div>' +
        '<div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">5 Star</div><div class="text-2xl font-black text-emerald-600">' + r5 + '</div></div>' +
        '<div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">4 Star</div><div class="text-2xl font-black text-green-600">' + r4 + '</div></div>' +
        '<div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">3 Star or Below</div><div class="text-2xl font-black text-amber-600">' + r3below + '</div></div>' +
        '<div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">No Rating</div><div class="text-2xl font-black text-slate-400">' + rNoRating + '</div></div>' +
        '<div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">EHO Overdue</div><div class="text-2xl font-black text-red-600">' + overdue + '</div></div>' +
        '<div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">Audited</div><div class="text-2xl font-black text-indigo-600">' + audited + '</div></div>';
}

// === Save to JSON File ===
window.trackerSaveToFile = async function() {
    try {
        var rows = await idbGetAll('eho_data');
        var data = {};
        rows.forEach(function(r) { data[r.StoreId] = r; });
        var exportObj = { version: 1, exportedAt: new Date().toISOString(), stores: data };
        var json = JSON.stringify(exportObj, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        safeDownload(blob, 'tracker_data_' + new Date().toISOString().slice(0, 10) + '.json');
        if (typeof U !== 'undefined' && U.toast) U.toast('Tracker data saved');
    } catch(e) {
        alert('Save failed: ' + e.message);
    }
};

// === Load from JSON File ===
window.trackerLoadFromFile = async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    try {
        var text = await file.text();
        var importObj = JSON.parse(text);
        var stores = importObj.stores || importObj;
        var count = 0;
        var keys = Object.keys(stores);
        for (var i = 0; i < keys.length; i++) {
            var rec = stores[keys[i]];
            if (rec && rec.StoreId) {
                await idbPut('eho_data', rec);
                count++;
            }
        }
        if (typeof U !== 'undefined' && U.toast) U.toast('Loaded ' + count + ' stores');
        renderTracker();
    } catch(e) {
        alert('Load failed: ' + e.message);
    }
    e.target.value = '';
};

// === PDF Print ===
window.trackerPrintPDF = function() {
    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
        alert('PDF library not loaded');
        return;
    }
    var { jsPDF } = window.jspdf;
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    var MINT = [0, 168, 142];
    var CHARCOAL = [55, 55, 55];
    var LIGHT_GREY = [120, 120, 120];
    var PW = 297, PH = 210, MG = 14;

    doc.setFillColor(...MINT);
    doc.rect(0, 0, PW, 2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...CHARCOAL);
    doc.text('EHO & Audit Tracker', MG, 15);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...LIGHT_GREY);
    doc.text('Generated: ' + new Date().toLocaleDateString('en-GB'), MG, 21);

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(MG, 24, PW - MG, 24);

    var rows = [];
    var totalScore = 0, scoreCount = 0, eho5 = 0, eho4 = 0, ehoBelow = 0, overdue = 0;
    var sectorTotals = { food: 0, fire: 0, hs: 0, journey: 0, coffee: 0, focus: 0 };
    var sectorCounts = { food: 0, fire: 0, hs: 0, journey: 0, coffee: 0, focus: 0 };
    var now = new Date();
    var sectorKeys = ['food', 'fire', 'hs', 'journey', 'coffee', 'focus'];

    document.querySelectorAll('.tracker-row').forEach(function(tr) {
        if (tr.style.display === 'none') return;
        var cells = tr.querySelectorAll('td');
        var getText = function(el) {
            var input = el.querySelector('input, select');
            return input ? (input.value || '') : (el.textContent || '').trim();
        };
        var r = [
            cells[0] ? getText(cells[0]) : '',
            cells[1] ? getText(cells[1]) : '',
            cells[2] ? getText(cells[2]) : '',
            cells[3] ? getText(cells[3]) : '',
            cells[4] ? getText(cells[4]) : '',
            cells[5] ? getText(cells[5]) : '',
            cells[6] ? getText(cells[6]) : '',
            cells[7] ? getText(cells[7]) : '',
            cells[8] ? getText(cells[8]) : '',
            cells[9] ? getText(cells[9]) : '',
            cells[10] ? getText(cells[10]) : '',
            cells[11] ? getText(cells[11]) : '',
            cells[12] ? getText(cells[12]) : ''
        ];
        rows.push(r);

        // KPI aggregation
        var t = parseFloat(r[11]);
        if (!isNaN(t) && t > 0) { totalScore += t; scoreCount++; }
        var eho = parseInt(r[2]);
        if (eho === 5) eho5++;
        else if (eho === 4) eho4++;
        else if (eho > 0 && eho <= 3) ehoBelow++;

        sectorKeys.forEach(function(sk, idx) {
            var v = parseFloat(r[5 + idx]);
            if (!isNaN(v) && v > 0) { sectorTotals[sk] += v; sectorCounts[sk]++; }
        });

        if (r[4]) {
            var nd = parseUKDate(r[4]);
            if (nd && !isNaN(nd.getTime()) && nd < now) overdue++;
        }
    });

    var avgTotal = scoreCount > 0 ? (totalScore / scoreCount).toFixed(1) : 'N/A';
    var y = 30;

    // KPI boxes
    var bw = 36, bh = 14;
    var kpis = [
        { label: 'STORES', value: String(rows.length), bg: [241,245,249], fg: [51,65,85] },
        { label: '5 STAR', value: String(eho5), bg: [236,253,245], fg: [5,150,105] },
        { label: '4 STAR', value: String(eho4), bg: [250,252,255], fg: [34,119,247] },
        { label: '3 & BELOW', value: String(ehoBelow), bg: [255,251,235], fg: [180,83,9] },
        { label: 'EHO OVERDUE', value: String(overdue), bg: [254,242,242], fg: [190,18,60] },
        { label: 'AVG TOTAL', value: avgTotal + '%', bg: [236,254,255], fg: [14,116,144] }
    ];
    var bx = MG;
    kpis.forEach(function(k) {
        doc.setFillColor(...k.bg);
        doc.roundedRect(bx, y, bw, bh, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6);
        doc.setTextColor(...k.fg);
        doc.text(k.label, bx + 3, y + 5);
        doc.setFontSize(13);
        doc.text(k.value, bx + 3, y + 11);
        bx += bw + 3;
    });
    y += bh + 6;

    // Sector averages
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...CHARCOAL);
    doc.text('Sector Averages:', MG, y);
    var sx = MG + 30;
    var sectorLabels = ['Food', 'Fire', 'H&S', 'Journey', 'Coffee', 'Focus'];
    sectorKeys.forEach(function(sk, idx) {
        var avg = sectorCounts[sk] > 0 ? (sectorTotals[sk] / sectorCounts[sk]).toFixed(1) : 'N/A';
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(sectorLabels[idx] + ': ' + avg + '%', sx, y);
        sx += 30;
    });
    y += 6;

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(MG, y, PW - MG, y);
    y += 3;

    // Table
    doc.autoTable({
        startY: y,
        head: [['Store', 'Area', 'EHO', 'Insp. Date', 'Next Due', 'Food', 'Fire', 'H&S', 'Journey', 'Coffee', 'Focus', 'Total', 'Audit Date']],
        body: rows,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: MINT, fontSize: 7, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
            0: { cellWidth: 28, fontStyle: 'bold' },
            1: { cellWidth: 22 },
            2: { cellWidth: 14 },
            3: { cellWidth: 18 },
            4: { cellWidth: 18 },
            11: { cellWidth: 15, fontStyle: 'bold' },
            12: { cellWidth: 18 }
        },
        margin: { left: MG, right: MG },
        didParseCell: function(hookData) {
            if (hookData.section === 'body' && hookData.column.index === 11) {
                var val = parseFloat(hookData.cell.raw);
                if (!isNaN(val)) {
                    if (val >= 95) hookData.cell.styles.textColor = [5, 150, 105];
                    else if (val >= 90) hookData.cell.styles.textColor = [180, 83, 9];
                    else if (val >= 80) hookData.cell.styles.textColor = [234, 88, 12];
                    else hookData.cell.styles.textColor = [190, 18, 60];
                }
            }
            if (hookData.section === 'body' && hookData.column.index >= 5 && hookData.column.index <= 10) {
                var val = parseFloat(hookData.cell.raw);
                if (!isNaN(val)) {
                    if (val >= 95) hookData.cell.styles.textColor = [5, 150, 105];
                    else if (val >= 90) hookData.cell.styles.textColor = [14, 116, 144];
                    else if (val >= 80) hookData.cell.styles.textColor = [180, 83, 9];
                    else if (val > 0) hookData.cell.styles.textColor = [190, 18, 60];
                }
            }
        },
        didDrawPage: function(hookData) {
            // Footer on each page
            doc.setDrawColor(220, 220, 220);
            doc.setLineWidth(0.3);
            doc.line(MG, PH - 10, PW - MG, PH - 10);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(160, 160, 160);
            doc.text('Birds Bakery \u2014 EHO & Audit Tracker', MG, PH - 6);
            doc.text('Page ' + hookData.pageNumber, PW - MG, PH - 6, { align: 'right' });
        }
    });

    doc.save('tracker_' + new Date().toISOString().slice(0, 10) + '.pdf');
};

window.trackerExportPNG = function() {
    if (typeof html2canvas === 'undefined') { alert('html2canvas not loaded'); return; }

    var MINT = '#00A88E';
    var CHARCOAL = '#373737';
    var LIGHT_GREY = '#888888';

    // Collect data from visible rows
    var rows = [];
    var totalScore = 0, scoreCount = 0, eho5 = 0, eho4 = 0, ehoBelow = 0, overdue = 0;
    var sectorTotals = { food: 0, fire: 0, hs: 0, journey: 0, coffee: 0 };
    var sectorCounts = { food: 0, fire: 0, hs: 0, journey: 0, coffee: 0 };
    var now = new Date();
    var sectorKeys = ['food', 'fire', 'hs', 'journey', 'coffee'];
    var sectorLabels = ['Food', 'Fire', 'H&S', 'Journey', 'Coffee'];

    document.querySelectorAll('.tracker-row').forEach(function(tr) {
        if (tr.style.display === 'none') return;
        var cells = tr.querySelectorAll('td');
        var getText = function(el) {
            var input = el.querySelector('input, select');
            return input ? (input.value || '') : (el.textContent || '').trim();
        };
        var r = [];
        for (var i = 0; i < 13; i++) r.push(cells[i] ? getText(cells[i]) : '');
        rows.push(r);

        var t = parseFloat(r[11]);
        if (!isNaN(t) && t > 0) { totalScore += t; scoreCount++; }
        var eho = parseInt(r[2]);
        if (eho === 5) eho5++;
        else if (eho === 4) eho4++;
        else if (eho > 0 && eho <= 3) ehoBelow++;

        sectorKeys.forEach(function(sk, idx) {
            var v = parseFloat(r[5 + idx]);
            if (!isNaN(v) && v > 0) { sectorTotals[sk] += v; sectorCounts[sk]++; }
        });

        if (r[4]) {
            var nd = parseUKDate(r[4]);
            if (nd && !isNaN(nd.getTime()) && nd < now) overdue++;
        }
    });

    var avgTotal = scoreCount > 0 ? (totalScore / scoreCount).toFixed(1) : 'N/A';

    function scoreColor(v) {
        var n = parseFloat(v);
        if (isNaN(n) || v === '') return '#64748b';
        if (n >= 95) return '#059669';
        if (n >= 90) return '#0e7490';
        if (n >= 80) return '#b45309';
        return '#be123c';
    }

    function scoreBg(v) {
        var n = parseFloat(v);
        if (isNaN(n) || v === '') return 'transparent';
        if (n >= 95) return '#ecfdf5';
        if (n >= 90) return '#f0fdfa';
        if (n >= 80) return '#fffbeb';
        return '#fef2f2';
    }

    function statusBadge(s) {
        if (s === 'Resolved') return '<span style="background:#ecfdf5;color:#059669;border:1px solid #6ee7b7;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:900;">Resolved</span>';
        if (s === 'Unresolved') return '<span style="background:#fef2f2;color:#be123c;border:1px solid #fecdd3;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:900;">Unresolved</span>';
        return '<span style="background:#fffbeb;color:#b45309;border:1px solid #fde68a;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:900;">' + escapeHtml(s) + '</span>';
    }

    // Build sector averages HTML
    var sectorAvgHtml = '<span style="font-weight:900;font-size:12px;color:' + CHARCOAL + ';margin-right:8px;">Sector Averages:</span>';
    sectorKeys.forEach(function(sk, idx) {
        var avg = sectorCounts[sk] > 0 ? (sectorTotals[sk] / sectorCounts[sk]).toFixed(1) + '%' : 'N/A';
        sectorAvgHtml += '<span style="font-size:12px;color:#64748b;margin-right:14px;"><strong>' + sectorLabels[idx] + ':</strong> ' + avg + '</span>';
    });

    // Build table rows HTML
    var tableRowsHtml = rows.map(function(r, idx) {
        var bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        var cells = [
            '<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-weight:900;font-size:12px;color:' + CHARCOAL + ';white-space:nowrap;">' + escapeHtml(r[0]) + '</td>',
            '<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#64748b;">' + escapeHtml(r[1]) + '</td>',
            '<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:700;">' + (r[2] || '-') + '</td>',
            '<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#64748b;">' + escapeHtml(r[3]) + '</td>',
            '<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#64748b;">' + escapeHtml(r[4]) + '</td>'
        ];
        // Sector scores (cols 5-10) with colour
        for (var si = 5; si <= 10; si++) {
            var val = r[si];
            var c = scoreColor(val);
            var bg2 = scoreBg(val);
            cells.push('<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:700;text-align:center;color:' + c + ';background:' + bg2 + ';">' + escapeHtml(val || '') + '</td>');
        }
        // Total (col 11)
        var tc = scoreColor(r[11]);
        var tbg = scoreBg(r[11]);
        cells.push('<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:900;text-align:center;color:' + tc + ';background:' + tbg + ';">' + escapeHtml(r[11] || '') + '</td>');
        // Audit date (col 12)
        cells.push('<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#64748b;">' + escapeHtml(r[12]) + '</td>');
        return '<tr style="background:' + bg + ';">' + cells.join('') + '</tr>';
    }).join('');

    // Full export HTML
    var exportHtml = '<div style="padding:24px;background:white;width:1400px;font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;">' +
        // Header
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
            '<div><div style="font-size:28px;font-weight:900;color:' + CHARCOAL + ';text-transform:uppercase;letter-spacing:-0.02em;">EHO & Audit Tracker</div>' +
            '<div style="font-size:12px;color:' + LIGHT_GREY + ';margin-top:4px;">Generated: ' + new Date().toLocaleDateString('en-GB') + '  |  ' + rows.length + ' stores</div></div>' +
            '<div style="display:flex;gap:8px;">' +
                '<div style="background:#f0fdfa;border:1px solid #99f6e4;padding:12px 18px;border-radius:8px;text-align:center;"><div style="font-size:10px;font-weight:900;color:' + LIGHT_GREY + ';text-transform:uppercase;">Stores</div><div style="font-size:24px;font-weight:900;color:' + CHARCOAL + ';">' + rows.length + '</div></div>' +
                '<div style="background:#ecfdf5;border:1px solid #6ee7b7;padding:12px 18px;border-radius:8px;text-align:center;"><div style="font-size:10px;font-weight:900;color:' + LIGHT_GREY + ';text-transform:uppercase;">5 Star</div><div style="font-size:24px;font-weight:900;color:#059669;">' + eho5 + '</div></div>' +
                '<div style="background:#f0fdfa;border:1px solid #99f6e4;padding:12px 18px;border-radius:8px;text-align:center;"><div style="font-size:10px;font-weight:900;color:' + LIGHT_GREY + ';text-transform:uppercase;">4 Star</div><div style="font-size:24px;font-weight:900;color:#22c55e;">' + eho4 + '</div></div>' +
                '<div style="background:#fffbeb;border:1px solid #fde68a;padding:12px 18px;border-radius:8px;text-align:center;"><div style="font-size:10px;font-weight:900;color:' + LIGHT_GREY + ';text-transform:uppercase;">3 & Below</div><div style="font-size:24px;font-weight:900;color:#b45309;">' + ehoBelow + '</div></div>' +
                '<div style="background:#fef2f2;border:1px solid #fecdd3;padding:12px 18px;border-radius:8px;text-align:center;"><div style="font-size:10px;font-weight:900;color:' + LIGHT_GREY + ';text-transform:uppercase;">EHO Overdue</div><div style="font-size:24px;font-weight:900;color:#be123c;">' + overdue + '</div></div>' +
                '<div style="background:#f0fdfa;border:1px solid #99f6e4;padding:12px 18px;border-radius:8px;text-align:center;"><div style="font-size:10px;font-weight:900;color:' + LIGHT_GREY + ';text-transform:uppercase;">Avg Total</div><div style="font-size:24px;font-weight:900;color:#0e7490;">' + avgTotal + '%</div></div>' +
            '</div>' +
        '</div>' +
        // Sector averages
        '<div style="padding:10px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px;">' + sectorAvgHtml + '</div>' +
        // Table
        '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
            '<thead><tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0;">' +
                '<th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Store</th>' +
                '<th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">Area</th>' +
                '<th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">EHO</th>' +
                '<th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">Insp. Date</th>' +
                '<th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">Next Due</th>' +
                '<th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">Food</th>' +
                '<th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">Fire</th>' +
                '<th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">H&S</th>' +
                '<th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">Journey</th>' +
                '<th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">Coffee</th>' +
                '<th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">Focus</th>' +
                '<th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">Total</th>' +
                '<th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;">Audit Date</th>' +
            '</tr></thead>' +
            '<tbody>' + tableRowsHtml + '</tbody>' +
        '</table>' +
        // Footer
        '<div style="margin-top:12px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:10px;color:' + LIGHT_GREY + ';display:flex;justify-content:space-between;">' +
            '<span>Birds Bakery \u2014 EHO & Audit Tracker</span>' +
            '<span>' + new Date().toLocaleString('en-GB') + '</span>' +
        '</div>' +
    '</div>';

    var tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '0';
    tempDiv.innerHTML = exportHtml;
    document.body.appendChild(tempDiv);

    html2canvas(tempDiv.firstElementChild, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false }).then(function(canvas) {
        canvas.toBlob(function(blob) {
            safeDownload(blob, 'tracker_' + new Date().toISOString().slice(0, 10) + '.png');
        });
        tempDiv.remove();
    }).catch(function(e) {
        console.warn('[Tracker] PNG export failed:', e);
        tempDiv.remove();
    });
};
