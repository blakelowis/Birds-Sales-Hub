// === COMPLAINTS HUB - Renders into mainView like other tabs ===

function fuzzyComplaintColMap(raw) {
    var h = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (h === 'shop' || h === 'store' || h === 'branch' || h === 'shopboughtfrom' || h === 'shopbought') return 'Shop bought from';
    if (h.includes('dateof') || h === 'date' || h === 'complaintdate') return 'Date of complaint';
    if (h.includes('typeof') || h === 'type' || h === 'complainttype' || h === 'category') return 'Type of complaint';
    if (h === 'title' || h.includes('customer') || h.includes('fullname') || h === 'name') return 'Customer full name';
    if (h === 'responsibledepartment') return 'Responsible department';
    if (h === 'responsibleperson' || h === 'person') return 'Responsible person';
    if (h.includes('contact') || h === 'phone' || h === 'telephone' || h === 'mobile') return 'Contact Details';
    if (h.includes('voucher') || h.includes('amount')) return 'Voucher amount';
    if (h.includes('nature') || h.includes('complaintdetail') || h.includes('detail') || h.includes('description') || h.includes('narrative') || h.includes('note')) return 'Complaint details';
    if (h.includes('actiontaken') || h.includes('resolution') || h.includes('action')) return 'Action taken / resolution';
    if (h.includes('resolved') || h.includes('closedate')) return 'Resolved Date';
    if (h.includes('product') || h.includes('producttype')) return 'Product Type';
    if (h === 'status' || h === 'complaintstatus') return 'Status';
    if (h.includes('areamanager') || h === 'am' || h.includes('area')) return 'Area manager';
    if (h.includes('storemanager') || h.includes('manager')) return 'Store manager';
    if (h === 'complaintreceivedvia' || h.includes('complaintreceived') || h.includes('receivedvia')) return 'Complaint received via';
    if (h.includes('duedate') || h === 'duedate') return 'Due Date';
    if (h.includes('googlerating') || h.includes('rating')) return 'Google Rating';
    return raw.trim();
}

function normaliseComplaintStatus(raw){
    const s = String(raw || '').toLowerCase().trim().replace(/[\[\]"]/g,'');
    if(s.includes('resolved') && !s.includes('un')) return 'Resolved';
    if(s.includes('awaiting') || s.includes('pending') || s.includes('response')) return 'Awaiting Response';
    if(s.includes('open') || s.includes('unresolved') || s.includes('new') || s.includes('in progress')) return 'Unresolved';
    if(!s) return 'Unresolved';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function CSVToArray(strData) {
    if (typeof Papa !== 'undefined') {
        var result = Papa.parse(strData, { skipEmptyLines: true });
        if (result.data && result.data.length > 0) return result.data;
    }
    var lines = strData.split(/\r?\n/).filter(function(l){ return l.trim(); });
    if (lines.length === 0) return [];
    var headers = lines[0].split(',').map(function(h){ return h.trim(); });
    var colCount = headers.length;
    var rows = [];
    var currentRow = [];
    var inQuotes = false;
    var fieldBuffer = '';
    for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        for (var ci = 0; ci < line.length; ci++) {
            var ch = line[ci];
            if (ch === '"') {
                if (inQuotes && ci + 1 < line.length && line[ci + 1] === '"') {
                    fieldBuffer += '"';
                    ci++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                currentRow.push(fieldBuffer.trim());
                fieldBuffer = '';
            } else {
                fieldBuffer += ch;
            }
        }
        if (!inQuotes) {
            currentRow.push(fieldBuffer.trim());
            if (currentRow.length >= colCount) {
                rows.push(currentRow.slice(0, colCount));
            }
            currentRow = [];
            fieldBuffer = '';
        } else {
            fieldBuffer += '\n';
        }
    }
    if (currentRow.length > 0 || fieldBuffer) {
        currentRow.push(fieldBuffer.trim());
        if (currentRow.length >= colCount) rows.push(currentRow.slice(0, colCount));
    }
    return rows;
}

function parseUKDate(dateStr){
    if (!dateStr) return new Date(0);
    if (dateStr instanceof Date) return dateStr;
    if (typeof dateStr === 'object' && dateStr !== null && typeof dateStr.getTime === 'function') return dateStr;
    if (typeof dateStr === 'number' || (typeof dateStr === 'string' && /^\d{5}$/.test(dateStr.trim()))) {
        const serial = Number(dateStr);
        return new Date((serial - 25569) * 86400 * 1000);
    }
    if (typeof dateStr !== 'string') return new Date(dateStr);
    const parts = dateStr.split('/');
    if(parts.length !== 3) return new Date(dateStr);
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
}

function formatComplaintDate(value){
    if(!value) return "-";
    if(typeof value === "number"){
        const date = new Date((value - 25569) * 86400 * 1000);
        return date.toLocaleDateString("en-GB");
    }
    if(value instanceof Date) return value.toLocaleDateString("en-GB");
    return String(value);
}

function cleanBrackets(str) {
    if(!str) return '';
    return str.replace(/[\[\]"]/g, '').trim();
}

function cleanSharePointValue(val) {
    if (!val) return '';
    var s = String(val).trim();
    if (s.charAt(0) === '{' || s.charAt(0) === '[') {
        try {
            var obj = JSON.parse(s);
            if (Array.isArray(obj) && obj.length > 0 && obj[0] && obj[0].Value != null) return String(obj[0].Value).trim();
            if (obj && obj.Value != null) return String(obj.Value).trim();
        } catch(e) {}
    }
    return s;
}

function fixSharePointCSV(text) {
    var lines = text.split(/\r?\n/);
    var fixed = [];
    for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        if (!line.trim()) { fixed.push(line); continue; }
        var result = '';
        var i = 0;
        while (i < line.length) {
            if (line[i] === '"') {
                i++;
                var fieldContent = '';
                var isJsonBlob = (i < line.length && (line[i] === '{' || line[i] === '['));
                var jsonDepth = 0;
                while (i < line.length) {
                    if (isJsonBlob) {
                        if (line[i] === '{' || line[i] === '[') jsonDepth++;
                        else if (line[i] === '}' || line[i] === ']') {
                            jsonDepth--;
                            if (jsonDepth === 0) {
                                fieldContent += line[i]; i++;
                                if (i < line.length && line[i] === '"') i++;
                                break;
                            }
                        }
                        fieldContent += line[i]; i++;
                    } else {
                        if (line[i] === '"') {
                            if (i + 1 < line.length && line[i + 1] === '"') {
                                fieldContent += '"'; i += 2;
                            } else { i++; break; }
                        } else {
                            fieldContent += line[i]; i++;
                        }
                    }
                }
                result += '"' + fieldContent.replace(/"/g, '""') + '"';
            } else {
                result += line[i]; i++;
            }
        }
        fixed.push(result);
    }
    return fixed.join('\n');
}

function parseComplaintsCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    var rawData = CSVToArray(text);
    if (rawData.length < 2) return [];
    var headers = rawData[0];
    var rows = [];
    var seenKeys = new Set();
    for (var i = 1; i < rawData.length; i++) {
        var row = rawData[i];
        if (!row || row.length < 3) continue;
        var obj = {};
        headers.forEach(function(h, idx) {
            var mapped = fuzzyComplaintColMap(h.trim());
            obj[mapped] = (row[idx] != null) ? String(row[idx]).trim() : '';
        });
        ['Shop bought from','Type of complaint','Responsible person','Responsible department','Complaint received via','Product Type','Status'].forEach(function(k){ if(obj[k]) obj[k] = cleanSharePointValue(obj[k]); });
        var dedupeKey = (obj['Shop bought from'] || '') + '|' + (obj['Date of complaint'] || '') + '|' + (obj['Customer full name'] || '');
        if (dedupeKey === '||') continue;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        rows.push(obj);
    }
    return rows;
}

function parseVoucherAmount(raw) {
    if (!raw) return 0;
    let s = String(raw).trim().toLowerCase().replace(/£/g, '').replace(/,/g, '').replace(/\s/g, '');
    if (!s || s === '0' || s === 'n/a' || s === '-') return 0;
    let n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function formatVoucherTotal(total) {
    return '£' + total.toFixed(2);
}

function avgDaysCloseTime(data) {
    let resolved = data.filter(c => normaliseComplaintStatus(c['Status']) === 'Resolved' && c['Resolved Date']);
    if (resolved.length === 0) return null;
    let totalDays = 0;
    resolved.forEach(c => {
        let created = parseUKDate(c['Date of complaint']);
        let closed = parseUKDate(c['Resolved Date']);
        let diff = (closed - created) / 86400000;
        if (diff >= 0) totalDays += diff;
    });
    return totalDays / resolved.length;
}

// Detail modal (created once, stays in DOM)
(function ensureComplaintModal(){
    if(document.getElementById('complaint-detail-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div id="complaint-detail-modal" class="fixed inset-0 bg-black/50 z-[200] hidden items-start justify-center overflow-y-auto p-6 pt-[10vh]" onclick="if(event.target===this)closeComplaintModal()">
        <div class="bg-white rounded-2xl shadow-2xl max-w-6xl w-full mb-10">
            <div class="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center rounded-t-2xl z-10">
                <h2 class="text-xl font-black text-slate-800">Complaint Details</h2>
                <button onclick="closeComplaintModal()" class="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold">Close</button>
            </div>
            <div id="complaint-modal-content" class="p-6"></div>
        </div>
    </div>`);
})();

window.closeComplaintModal = function(){
    const m = document.getElementById('complaint-detail-modal');
    if(m){ m.classList.add('hidden'); m.classList.remove('flex'); }
};

window.toggleVoucherFilter = function(){
    const el = document.getElementById('comp-filter-voucher');
    if(!el) return;
    el.value = el.value === 'YES' ? 'ALL' : 'YES';
    window.renderComplaintsTable();
};

window._compDataCache = [];

window.openComplaintModal = function(idx){
    const c = window._compDataCache[idx];
    if(!c) return;
    let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">';
    Object.entries(c).forEach(([k,v]) => {
        html += `<div class="bg-slate-50 border border-slate-200 rounded-xl p-4"><div class="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">${escapeHtml(k)}</div><div class="text-sm text-slate-700 whitespace-pre-wrap break-words">${escapeHtml(String(v || '-'))}</div></div>`;
    });
    html += '</div>';
    document.getElementById('complaint-modal-content').innerHTML = html;
    const m = document.getElementById('complaint-detail-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    m.scrollTop = 0;
};

// Render the hub into mainView
window.renderComplaintsHub = function(){
    const mainView = document.getElementById('mainView');
    mainView.innerHTML = `
    <div id="complaints-hub-view">
        <h2 class="text-[36px] font-black birds-green mb-6">Customer Complaints Hub</h2>
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-6 flex gap-6 flex-wrap items-end">
            <div>
                <label class="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Store / Branch</label>
                <select id="comp-filter-store" class="border border-slate-300 p-2.5 rounded-lg w-56 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" onchange="window.renderComplaintsTable()">
                    <option value="ALL">All Stores</option>
                </select>
            </div>
            <div>
                <label class="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Status</label>
                <select id="comp-filter-status" class="border border-slate-300 p-2.5 rounded-lg w-48 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" onchange="window.renderComplaintsTable()">
                    <option value="ALL">All Statuses</option>
                    <option value="Unresolved">Unresolved</option>
                    <option value="Awaiting Response">Awaiting Response</option>
                    <option value="Resolved">Resolved</option>
                </select>
            </div>
            <div>
                <label class="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Area Manager</label>
                <select id="comp-filter-am" class="border border-slate-300 p-2.5 rounded-lg w-56 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" onchange="window.renderComplaintsTable()">
                    <option value="ALL">All Areas</option>
                    <option value="Katie Cartwright">Katie Cartwright</option>
                    <option value="Craig White">Craig White</option>
                    <option value="Paul Reeves">Paul Reeves</option>
                    <option value="Suzanne Green">Suzanne Green</option>
                    <option value="Thomas Henson">Tom Henson</option>
                    <option value="Unassigned">Unassigned</option>
                </select>
            </div>
            <div>
                <label class="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Category</label>
                <select id="comp-filter-type" class="border border-slate-300 p-2.5 rounded-lg w-48 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" onchange="window.renderComplaintsTable()">
                    <option value="ALL">All Categories</option>
                </select>
            </div>
            <div>
                <label class="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Voucher</label>
                <select id="comp-filter-voucher" class="border border-slate-300 p-2.5 rounded-lg w-40 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" onchange="window.renderComplaintsTable()">
                    <option value="ALL">All</option>
                    <option value="YES">Given</option>
                    <option value="NO">None</option>
                </select>
            </div>
            <div>
                <label class="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Date From</label>
                <input type="date" id="comp-filter-date-from" class="border border-slate-300 p-2.5 rounded-lg text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" onchange="window.renderComplaintsTable()">
            </div>
            <div>
                <label class="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Date To</label>
                <input type="date" id="comp-filter-date-to" class="border border-slate-300 p-2.5 rounded-lg text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" onchange="window.renderComplaintsTable()">
            </div>
            <div>
                <label class="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Sort By</label>
                <select id="comp-sort" class="border border-slate-300 p-2.5 rounded-lg w-48 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" onchange="window.renderComplaintsTable()">
                    <option value="date-desc">Date (Newest First)</option>
                    <option value="date-asc">Date (Oldest First)</option>
                    <option value="store-asc">Store (A-Z)</option>
                    <option value="store-desc">Store (Z-A)</option>
                </select>
            </div>
            <div class="ml-auto flex items-center gap-3">
                <div class="flex items-center bg-blue-50 px-4 py-2 rounded-lg border border-blue-100">
                    <div class="flex flex-col">
                        <span class="text-xs font-black text-blue-800 uppercase tracking-wider">Total Filtered</span>
                        <span id="comp-total-count" class="text-lg font-black text-blue-600 leading-none">0</span>
                    </div>
                </div>
                <div id="comp-data-source" class="text-[10px] font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-500"></div>
                <button onclick="generateComplaintsPDF()" class="bg-rose-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md hover:bg-rose-700"> PDF Summary</button>
                <button onclick="generateComplaintsDetailedPDF()" class="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md hover:bg-indigo-700"> Detailed Report</button>
            </div>
        </div>
        <div id="complaints-kpi-row" class="grid grid-cols-3 md:grid-cols-7 gap-3 mb-6"></div>
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <table class="w-full text-left border-collapse">
                <thead class="bg-slate-100 text-slate-500 text-xs uppercase tracking-widest font-black">
                    <tr>
                        <th class="p-4 border-b border-slate-200">DETAILS</th>
                        <th class="p-4 border-b border-slate-200">Date</th>
                        <th class="p-4 border-b border-slate-200">Store</th>
                        <th class="p-4 border-b border-slate-200">Responsible Person</th>
                        <th class="p-4 border-b border-slate-200">Customer Info</th>
                        <th class="p-4 border-b border-slate-200">Category</th>
                        <th class="p-4 border-b border-slate-200">Complaint Details</th>
                        <th class="p-4 border-b border-slate-200">Voucher</th>
                        <th class="p-4 border-b border-slate-200">Status</th>
                    </tr>
                </thead>
                <tbody id="comp-table-body">
                    <tr><td colspan="7" class="p-10 text-center text-slate-400 font-bold italic text-lg">No complaints loaded. Ensure your data folder is anchored and contains the complaints CSV.</td></tr>
                </tbody>
            </table>
        </div>
    </div>`;

    if(window.ComplaintsData && window.ComplaintsData.length > 0){
        const stores = [...new Set(window.ComplaintsData.map(x => x['Shop bought from']))].filter(Boolean).sort();
        const types = [...new Set(window.ComplaintsData.map(x => cleanBrackets(x['Type of complaint'])))].filter(Boolean).sort();
        const storeEl = document.getElementById('comp-filter-store');
        const typeEl = document.getElementById('comp-filter-type');
        if(storeEl) storeEl.innerHTML = '<option value="ALL">All Stores</option>' + stores.map(x => '<option value="'+escapeHtml(x)+'">'+escapeHtml(x)+'</option>').join('');
        if(typeEl) typeEl.innerHTML = '<option value="ALL">All Categories</option>' + types.map(x => '<option value="'+escapeHtml(x)+'">'+escapeHtml(x)+'</option>').join('');
        window.renderComplaintsTable();
    } else {
        const info = document.getElementById('complaints-kpi-row');
        if(info) info.innerHTML = '';
        const tbody = document.getElementById('comp-table-body');
        if(tbody) tbody.innerHTML = '<tr><td colspan="9" class="p-10 text-center text-slate-400 font-bold italic text-lg">No complaints loaded. Ensure your data folder is anchored and contains the complaints CSV.</td></tr>';
    }
};

window.loadComplaintsCSVFile = async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    try {
        var text = await file.text();
        var rows = parseComplaintsCSV(text);
        if (rows.length === 0) { alert('CSV file appears empty or could not be parsed.'); return; }
        console.log('[Complaints] File upload parsed:', rows.length, 'rows from', file.name);
        window.loadComplaintsFromSheet(rows);
    } catch(err) {
        console.error('[Complaints] Failed to parse CSV:', err);
        alert('Failed to parse complaints file: ' + err.message);
    }
    e.target.value = '';
};

window.clearComplaintsCache = async function() {
    if (!confirm('Clear cached complaints data? You can reload from CSV or folder sync.')) return;
    window.ComplaintsData = null;
    try { await idbClear('complaints'); } catch(e) {}
    window.renderComplaintsHub();
    console.log('[Complaints] Cache cleared');
};

window.loadComplaintsFromSheet = function(rows){
    if(!rows || !rows.length){ console.warn('[Complaints] No sheet rows found'); return; }
    window.ComplaintsData = rows;
    window.ComplaintsData.sort((a,b) => parseUKDate(b['Date of complaint']) - parseUKDate(a['Date of complaint']));
    var src = (window.__dataStatus && window.__dataStatus.source === 'folder') ? 'Data Folder' : (window.__dataStatus && window.__dataStatus.source === 'cache') ? 'Cached' : 'Loaded';
    var badge = document.getElementById('comp-data-source');
    if(badge){ badge.innerText = rows.length + ' records from ' + src; badge.className = 'text-[10px] font-bold px-3 py-1 rounded-full ' + (src === 'Data Folder' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'); }
    const stores = [...new Set(window.ComplaintsData.map(x => x['Shop bought from']))].filter(Boolean).sort();
    const statuses = [...new Set(window.ComplaintsData.map(x => x['Status']))].filter(Boolean).sort();
    const types = [...new Set(window.ComplaintsData.map(x => cleanBrackets(x['Type of complaint'])))].filter(Boolean).sort();
    const storeEl = document.getElementById('comp-filter-store');
    const statusEl = document.getElementById('comp-filter-status');
    const typeEl = document.getElementById('comp-filter-type');
    if(storeEl) storeEl.innerHTML = '<option value="ALL">All Stores</option>' + stores.map(x => '<option value="'+escapeHtml(x)+'">'+escapeHtml(x)+'</option>').join('');
    if(statusEl) statusEl.innerHTML = '<option value="ALL">All Statuses</option>' + statuses.map(x => '<option value="'+escapeHtml(x)+'">'+escapeHtml(x)+'</option>').join('');
    if(typeEl) typeEl.innerHTML = '<option value="ALL">All Categories</option>' + types.map(x => '<option value="'+escapeHtml(x)+'">'+escapeHtml(x)+'</option>').join('');
    console.log('[Complaints] loadComplaintsFromSheet called with', rows.length, 'rows — current source:', (window.__dataStatus && window.__dataStatus.source) || 'unknown');
    if(window.renderComplaintsTable) window.renderComplaintsTable();
};

window.renderComplaintsTable = function() {
    if(!window.ComplaintsData || window.ComplaintsData.length === 0) return;
    const filterStore = document.getElementById('comp-filter-store');
    const filterStatus = document.getElementById('comp-filter-status');
    const filterType = document.getElementById('comp-filter-type');
    const filterAM = document.getElementById('comp-filter-am');
    if(!filterStore) return;

    let fStore = filterStore.value;
    let fStatus = filterStatus ? filterStatus.value : 'ALL';
    let fType = filterType ? filterType.value : 'ALL';
    let fAM = filterAM ? filterAM.value : 'ALL';
    let fVoucher = document.getElementById('comp-filter-voucher')?.value || 'ALL';

    let dFrom = document.getElementById('comp-filter-date-from')?.value;
    let dTo = document.getElementById('comp-filter-date-to')?.value;
    let tFrom = dFrom ? new Date(dFrom).getTime() : 0;
    let tTo = dTo ? new Date(dTo).getTime() : Infinity;

    let filtered = window.ComplaintsData.filter(c => {
        if (fStore !== 'ALL' && c['Shop bought from'] !== fStore) return false;
        if (fStatus !== 'ALL' && normaliseComplaintStatus(c['Status']) !== fStatus) return false;
        if (fType !== 'ALL' && cleanBrackets(c['Type of complaint']) !== fType) return false;
        if(fAM !== 'ALL'){
            const id = canonicalStoreId(c['Shop bought from']);
            const am = storeMap.get(id) || 'Unassigned';
            if(am !== fAM) return false;
        }
        let voucherAmt = parseVoucherAmount(c['Voucher amount']);
        if (fVoucher === 'YES' && voucherAmt <= 0) return false;
        if (fVoucher === 'NO' && voucherAmt > 0) return false;
        let cTime = parseUKDate(c['Date of complaint']);
        if(cTime < tFrom || cTime > tTo) return false;
        return true;
    });

    // Sort
    const sortBy = document.getElementById('comp-sort')?.value || 'date-desc';
    if(sortBy === 'date-desc') filtered.sort((a,b) => parseUKDate(b['Date of complaint']) - parseUKDate(a['Date of complaint']));
    else if(sortBy === 'date-asc') filtered.sort((a,b) => parseUKDate(a['Date of complaint']) - parseUKDate(b['Date of complaint']));
    else if(sortBy === 'store-asc') filtered.sort((a,b) => (a['Shop bought from'] || '').localeCompare(b['Shop bought from'] || ''));
    else if(sortBy === 'store-desc') filtered.sort((a,b) => (b['Shop bought from'] || '').localeCompare(a['Shop bought from'] || ''));

    const countEl = document.getElementById('comp-total-count');
    if(countEl) countEl.innerText = filtered.length;

    // KPI Row
    let openCount = filtered.filter(c => normaliseComplaintStatus(c['Status']) !== 'Resolved').length;
    let resolvedCount = filtered.filter(c => normaliseComplaintStatus(c['Status']) === 'Resolved').length;
    let awaitingCount = filtered.filter(c => normaliseComplaintStatus(c['Status']) === 'Awaiting Response').length;
    let resolutionRate = filtered.length ? (resolvedCount / filtered.length * 100).toFixed(1) : "0.0";
    let totalVoucherCost = filtered.reduce((sum, c) => sum + parseVoucherAmount(c['Voucher amount']), 0);
    let avgClose = avgDaysCloseTime(filtered);
    let avgCloseText = avgClose !== null ? avgClose.toFixed(1) + 'd' : 'N/A';
    let storeCounts = {};
    filtered.forEach(c => { const s = c['Shop bought from'] || 'Unknown'; storeCounts[s] = (storeCounts[s] || 0) + 1; });
    const rankedStores = Object.entries(storeCounts).filter(x => x[0] !== 'Unknown').sort((a,b)=>b[1]-a[1]);
    let topStore = rankedStores.length ? rankedStores[0][0] : 'No Data';
    let areaCounts = {};
    filtered.forEach(c => { const s = c['Shop bought from']; if(!s) return; const a = safeGetAM(s); areaCounts[a] = (areaCounts[a] || 0) + 1; });
    const rankedAreas = Object.entries(areaCounts).filter(x => x[0] !== 'Unassigned').sort((a,b)=>b[1]-a[1]);
    let topArea = rankedAreas.length ? rankedAreas[0][0] : 'No Data';

    let kpiRow = document.getElementById('complaints-kpi-row');
    if(kpiRow){
        let voucherActive = fVoucher === 'YES';
        kpiRow.innerHTML = `
        <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">Total</div><div class="text-2xl font-black text-blue-600">${filtered.length}</div></div>
        <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">Unresolved</div><div class="text-2xl font-black text-rose-600">${openCount}</div></div>
        <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">Awaiting</div><div class="text-2xl font-black text-amber-500">${awaitingCount}</div></div>
        <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">Resolved</div><div class="text-2xl font-black text-emerald-600">${resolvedCount}</div></div>
        <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">Resolution %</div><div class="text-2xl font-black text-indigo-600">${resolutionRate}%</div></div>
        <div onclick="window.toggleVoucherFilter()" class="rounded-xl border p-3 shadow-sm cursor-pointer transition-all hover:scale-[1.03] ${voucherActive ? 'bg-violet-100 border-violet-400' : 'bg-white border-slate-200'}"><div class="text-[10px] uppercase font-black text-slate-500">Total Voucher Cost</div><div class="text-2xl font-black ${voucherActive ? 'text-violet-700' : 'text-violet-600'}">${formatVoucherTotal(totalVoucherCost)}</div><div class="text-[9px] font-bold text-slate-400 mt-0.5">${voucherActive ? 'Click to clear filter' : 'Click to show vouchers only'}</div></div>
        <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-sm"><div class="text-[10px] uppercase font-black text-slate-500">Avg Close Time</div><div class="text-2xl font-black text-cyan-600">${avgCloseText}</div><div class="text-[9px] font-bold text-slate-400 mt-0.5">${resolvedCount} resolved</div></div>`;
    }

    let tbody = document.getElementById('comp-table-body');
    if(!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-10 text-center text-slate-400 font-bold italic text-lg">No complaints match the selected filters.</td></tr>';
        return;
    }

    window._compDataCache = filtered;
    tbody.innerHTML = filtered.map((c, idx) => {
        let typeClean = cleanBrackets(c['Type of complaint']);
        let prodClean = cleanBrackets(c['Product Type']);
        const normStatus = normaliseComplaintStatus(c['Status']);
        let isResolved = normStatus === 'Resolved';
        let isAwaiting = normStatus === 'Awaiting Response';
        let voucherAmt = parseVoucherAmount(c['Voucher amount']);
        let severityBadge = '';
        try{
            const complaintAge = Math.floor((new Date() - parseUKDate(c['Date of complaint'])) / 86400000);
            if(!isResolved){
                if(complaintAge >= 30) severityBadge = '<span class="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-black">OVER 30 DAYS</span>';
                else if(complaintAge >= 14) severityBadge = '<span class="bg-amber-100 text-amber-700 px-2 py-1 rounded text-xs font-black">OVER 14 DAYS</span>';
            }
        }catch(e){}
        let statusBadge = isResolved
            ? '<span class="bg-emerald-50 text-slate-800 border border-emerald-200 px-3 py-1 rounded-md text-xs font-black uppercase tracking-wider">Resolved</span>'
            : isAwaiting
            ? '<span class="bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1 rounded-md text-xs font-black uppercase tracking-wider">Awaiting Response</span>'
            : '<span class="bg-rose-50 text-rose-700 border border-rose-200 px-3 py-1 rounded-md text-xs font-black uppercase tracking-wider">Unresolved</span>';
        let voucherBadge = voucherAmt > 0
            ? '<span class="bg-violet-100 text-violet-700 border border-violet-200 px-2 py-0.5 rounded text-xs font-black">£' + voucherAmt.toFixed(2) + '</span>'
            : '<span class="text-slate-300 text-xs font-bold">-</span>';
        let bgClass = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50';

        return `<tr class="${bgClass} hover:bg-slate-100 transition-colors group">
            <td class="p-4 border-b border-slate-100 align-top"><button class="bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-black hover:bg-emerald-700" onclick="openComplaintModal(${idx})"> View</button></td>
            <td class="p-4 border-b border-slate-100 text-sm font-bold text-slate-700 whitespace-nowrap align-top">${formatComplaintDate(c['Date of complaint'])}</td>
            <td class="p-4 border-b border-slate-100 text-sm font-black text-slate-800 align-top">${escapeHtml(c['Shop bought from'] || 'Unknown')}</td>
            <td class="p-2 border-b border-slate-100 text-xs font-bold text-slate-700 align-top">${escapeHtml(c['Responsible person'] || '-')}</td>
            <td class="p-2 border-b border-slate-100 text-sm text-slate-600 align-top w-40"><div class="font-bold text-slate-800 mb-1">${escapeHtml(c['Customer full name'] || 'Anonymous')}</div><div class="text-xs break-all opacity-80">${escapeHtml(c['Contact Details'] || '')}</div></td>
            <td class="p-4 border-b border-slate-100 align-top"><div class="flex flex-col gap-1 items-start">${typeClean ? '<span class="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs font-bold">'+escapeHtml(typeClean)+'</span>' : ''}${prodClean ? '<span class="bg-indigo-50 text-slate-800 border border-indigo-100 px-2 py-0.5 rounded text-xs font-bold">'+escapeHtml(prodClean)+'</span>' : ''}</div></td>
            <td class="p-4 border-b border-slate-100 align-top"><div class="text-sm font-medium text-slate-700 max-w-[320px]">${typeClean || prodClean ? (escapeHtml(typeClean) + (prodClean ? ' \u2022 ' + escapeHtml(prodClean) : '')) : 'Complaint Logged'}</div></td>
            <td class="p-4 border-b border-slate-100 align-top">${voucherBadge}</td>
            <td class="p-4 border-b border-slate-100 align-top"><div class="flex flex-col gap-2">${statusBadge}${severityBadge}</div></td>
        </tr>`;
    }).join('');
};

async function generateComplaintsDetailedPDF() {
    if (typeof window.jspdf === 'undefined') { alert("PDF library missing."); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');
    const data = window._compDataCache || window.ComplaintsData || [];
    if (data.length === 0) { alert("No complaints data to export!"); return; }

    const MINT = [0, 168, 142];
    const CHARCOAL = [55, 55, 55];
    const LIGHT_GREY = [120, 120, 120];
    const PW = 297, PH = 210, MG = 14;

    function findComplaintDetail(row) {
        const candidates = ['Complaint detail','Complaint details','Detail','Details','Description','Additional details','Additional Details','Complaint Description','Complaint narrative','Complaint Narrative','Notes','Complaint notes'];
        for (const k of candidates) { if (row[k] && String(row[k]).trim()) return row[k]; }
        const skip = new Set(['Shop bought from','Date of complaint','Responsible person','Customer full name','Contact Details','Type of complaint','Product Type','Status','Area manager','Area Manager','Store manager','Manager']);
        for (const k of Object.keys(row)) { if (skip.has(k)) continue; const v = String(row[k] || '').trim(); if (v.length > 10 && !/^(yes|no|open|closed|resolved|awaiting|unresolved)$/i.test(v)) return v; }
        return '';
    }

    const STATUS_COLORS = {
        'Resolved':         { border: [5, 150, 105],  bg: [236, 253, 245], badgeBg: [236, 253, 245], badgeFg: [5, 120, 80] },
        'Awaiting Response':{ border: [180, 83, 9],   bg: [255, 251, 235], badgeBg: [255, 251, 235], badgeFg: [180, 83, 9] },
        'Unresolved':       { border: [190, 18, 60],  bg: [254, 242, 242], badgeBg: [254, 242, 242], badgeFg: [190, 18, 60] }
    };

    let openCount = data.filter(c => normaliseComplaintStatus(c['Status']) !== 'Resolved').length;
    let resolvedCount = data.filter(c => normaliseComplaintStatus(c['Status']) === 'Resolved').length;
    let awaitingCount = data.filter(c => normaliseComplaintStatus(c['Status']) === 'Awaiting Response').length;
    let resolutionRate = data.length ? (resolvedCount / data.length * 100).toFixed(1) : "0.0";
    let totalVoucherCost = data.reduce((sum, c) => sum + parseVoucherAmount(c['Voucher amount']), 0);
    let avgClose = avgDaysCloseTime(data);
    let avgCloseText = avgClose !== null ? avgClose.toFixed(1) + 'd' : 'N/A';

    function drawPageHeader(pageNum) {
        doc.setFillColor(...MINT);
        doc.rect(0, 0, PW, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(...CHARCOAL);
        doc.text('Customer Complaints \u2014 Detailed Report', MG, 15);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...LIGHT_GREY);
        doc.text('Generated: ' + new Date().toLocaleString('en-GB') + '  |  ' + data.length + ' complaints (filtered)', MG, 20);

        let y = 24;
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.3);
        doc.line(MG, y, PW - MG, y);
        y += 4;

        const bw = 38, bh = 12;
        const boxes = [
            { label: 'TOTAL', value: String(data.length), bg: [241,245,249], fg: [51,65,85] },
            { label: 'UNRESOLVED', value: String(openCount), bg: [254,242,242], fg: [190,18,60] },
            { label: 'AWAITING', value: String(awaitingCount), bg: [255,251,235], fg: [180,83,9] },
            { label: 'RESOLVED', value: String(resolvedCount), bg: [236,253,245], fg: [5,150,105] },
            { label: 'RESOLUTION %', value: resolutionRate + '%', bg: [238,242,255], fg: [55,53,147] },
            { label: 'VOUCHER TOTAL', value: formatVoucherTotal(totalVoucherCost), bg: [245,243,255], fg: [124,58,237] },
            { label: 'AVG CLOSE', value: avgCloseText, bg: [236,254,255], fg: [14,116,144] }
        ];
        let bx = MG;
        boxes.forEach(b => {
            doc.setFillColor(...b.bg);
            doc.roundedRect(bx, y, bw, bh, 2, 2, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(5);
            doc.setTextColor(...b.fg);
            doc.text(b.label, bx + 3, y + 4);
            doc.setFontSize(12);
            doc.text(b.value, bx + 3, y + 10);
            bx += bw + 3;
        });

        return y + bh + 6;
    }

    function drawFooter(p) {
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.3);
        doc.line(MG, PH - 10, PW - MG, PH - 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(160, 160, 160);
        doc.text('Birds Bakery \u2014 Customer Complaints Report', MG, PH - 6);
        doc.text('Page ' + p, PW - MG, PH - 6, { align: 'right' });
    }

    function wrapText(text, maxWidth) {
        var words = String(text || '').split(/\s+/);
        var lines = [];
        var line = '';
        words.forEach(function(w) {
            var test = line ? line + ' ' + w : w;
            if (doc.getTextWidth(test) > maxWidth && line) {
                lines.push(line);
                line = w;
            } else {
                line = test;
            }
        });
        if (line) lines.push(line);
        return lines;
    }

    let currentY = drawPageHeader(1);
    drawFooter(1);
    let pageNum = 1;

    data.forEach(function(c, idx) {
        var normStatus = normaliseComplaintStatus(c['Status']);
        var sc = STATUS_COLORS[normStatus] || STATUS_COLORS['Unresolved'];
        var statusLabel = normStatus;

        var age = '';
        try {
            var days = Math.floor((new Date() - parseUKDate(c['Date of complaint'])) / 86400000);
            if (normStatus !== 'Resolved' && days >= 30) age = ' [30d+]';
            else if (normStatus !== 'Resolved' && days >= 14) age = ' [14d+]';
        } catch (_) {}

        var detail = findComplaintDetail(c);
        var detailLines = wrapText(detail, PW - MG * 2 - 12);
        var cardHeaderH = 6;
        var detailLineH = 4.2;
        var detailBlockH = detailLines.length > 0 ? detailLines.length * detailLineH + 3 : 0;
        var metaLineH = 4.5;
        var cardPadding = 4;
        var cardH = cardPadding + cardHeaderH + cardPadding + metaLineH + 2 + (detailBlockH > 0 ? detailBlockH + 2 : 0) + cardPadding;

        if (currentY + cardH > PH - 14) {
            pageNum++;
            doc.addPage('l');
            currentY = drawPageHeader(pageNum);
            drawFooter(pageNum);
        }

        doc.setDrawColor(...sc.border);
        doc.setLineWidth(0.8);
        doc.roundedRect(MG, currentY, PW - MG * 2, cardH, 2, 2);

        doc.setFillColor(...sc.bg);
        doc.roundedRect(MG + 0.4, currentY + 0.4, PW - MG * 2 - 0.8, cardH - 0.8, 2, 2, 'F');

        doc.setFillColor(...sc.border);
        doc.rect(MG, currentY, 4, cardH, 'F');

        var ty = currentY + cardPadding + 4;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...CHARCOAL);
        var metaX = MG + 8;
        doc.text(formatComplaintDate(c['Date of complaint']), metaX, ty);
        doc.text(c['Shop bought from'] || 'Unknown', metaX + 25, ty);
        doc.text(cleanBrackets(c['Type of complaint']) || '-', metaX + 70, ty);
        doc.text(c['Customer full name'] || 'Anonymous', metaX + 115, ty);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6);
        doc.setTextColor(...sc.badgeFg);
        doc.setFillColor(...sc.badgeBg);
        var badgeText = statusLabel + age;
        var badgeW = doc.getTextWidth(badgeText) + 8;
        doc.roundedRect(PW - MG - badgeW - 4, ty - 4, badgeW, 6, 1.5, 1.5, 'F');
        doc.text(badgeText, PW - MG - badgeW - 1, ty);

        ty += metaLineH + 1;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        var subParts = [];
        if (c['Responsible person']) subParts.push('Responsible: ' + c['Responsible person']);
        if (cleanBrackets(c['Product Type'])) subParts.push('Product: ' + cleanBrackets(c['Product Type']));
        if (c['Contact Details']) subParts.push('Contact: ' + c['Contact Details']);
        var voucherAmt = parseVoucherAmount(c['Voucher amount']);
        if (voucherAmt > 0) subParts.push('Voucher: £' + voucherAmt.toFixed(2));
        if (subParts.length > 0) {
            doc.text(subParts.join('   |   '), MG + 8, ty);
            ty += 5;
        }

        if (detailLines.length > 0) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(6);
            doc.setTextColor(71, 85, 105);
            doc.text('COMPLAINT DETAIL', MG + 8, ty);
            ty += 4;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(30, 41, 59);
            detailLines.forEach(function(line) {
                doc.text(line, MG + 8, ty);
                ty += detailLineH;
            });
        }

        currentY += cardH + 3;
    });

    var stamp = new Date().toISOString().slice(0, 10);
    doc.save('Complaints_Detailed_' + stamp + '.pdf');
}

async function generateComplaintsPDF() {
    if (typeof window.jspdf === 'undefined') { alert("PDF library missing."); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const data = window._compDataCache || window.ComplaintsData || [];
    if (data.length === 0) { alert("No complaints data to export!"); return; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(18);
    doc.text("Complaints Summary Report", 14, 20);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text("Generated on: " + new Date().toLocaleString(), 14, 26);
    let typeCount = {}, statusCount = {}, storeCount = {};
    data.forEach(c => {
        let type = (c['Type of complaint'] || 'Unknown').replace(/[^a-zA-Z\s]/g, '').trim();
        let status = (c['Status'] || 'Unknown').trim();
        let store = (c['Shop bought from'] || 'Unknown').trim();
        typeCount[type] = (typeCount[type] || 0) + 1;
        statusCount[status] = (statusCount[status] || 0) + 1;
        storeCount[store] = (storeCount[store] || 0) + 1;
    });
    try {
        doc.text("1. Breakdown by Complaint Type", 14, 35);
        doc.autoTable({ startY: 40, head: [['Type', 'Total']], body: Object.entries(typeCount).sort((a,b) => b[1] - a[1]) });
        let nextY = doc.lastAutoTable.finalY + 10;
        doc.text("2. Status Breakdown", 14, nextY);
        doc.autoTable({ startY: nextY + 5, head: [['Status', 'Total']], body: Object.entries(statusCount).sort((a,b) => b[1] - a[1]) });
        nextY = doc.lastAutoTable.finalY + 10;
        doc.text("3. Store Breakdown", 14, nextY);
        doc.autoTable({ startY: nextY + 5, head: [['Store', 'Total']], body: Object.entries(storeCount).sort((a,b) => b[1] - a[1]) });
        const stamp=new Date().toISOString().slice(0,10);
        doc.save('Complaints_Summary_'+stamp+'.pdf');
    } catch (err) { console.error("PDF Export Error:", err); alert("Export failed: " + err.message); }
}
