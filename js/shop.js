/* ─── Shop Tools Module v2 ───────────────────────────────────────── */
/* Store hub home screen + incident/complaint/uniform forms.          */
/* Gated by user.shopStoreId — shops see home + forms; HQ sees the   */
/* backend data tables.                                               */
/* ================================================================== */
window.ShopTools = (function() {
    var _shopStoreId = '';
    var _storeName = '';
    var _isShop = false;
    var _backendViews = {};
    var _testMode = false;

    /* ─── Restrict shop users to the Shop Tools tab only ──────── */
    function _restrictShopUser() {
        _init();
        if (!_isShop) return;
        document.querySelectorAll('.nav-tab').forEach(function(t) {
            if (t.getAttribute('data-tab') !== 'shop') t.style.display = 'none';
        });
        var shopTab = document.querySelector('.nav-tab[data-tab="shop"]');
        if (shopTab) shopTab.style.display = '';
        if (typeof setActiveTab === 'function') setActiveTab('shop');
    }

    /* ─── Init / helpers ────────────────────────────────────────── */
    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _init() {
        var u = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        /* Auto-detect the store from the user's email (e.g. branston@... → Branston) */
        _shopStoreId = u ? (u.shopStoreId || '') : '';
        if (!_shopStoreId && u && u.email && typeof originalStoreNames !== 'undefined') {
            var username = (u.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            var keys = [];
            originalStoreNames.forEach(function(name, id) { keys.push(id); });
            for (var i = 0; i < keys.length; i++) {
                var cid = keys[i];
                if (cid === username || cid.indexOf(username) >= 0 || username.indexOf(cid) >= 0) {
                    _shopStoreId = cid;
                    break;
                }
            }
        }
        _isShop = !!_shopStoreId;
        if (_isShop && typeof originalStoreNames !== 'undefined') {
            _storeName = originalStoreNames.get(_shopStoreId) || _shopStoreId;
        }
    }

    function uid() { return 'SHP-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
    function today() { return new Date().toISOString().substring(0, 10); }

    async function _loadReports(folder) {
        if (typeof GraphClient === 'undefined' || !BirdsAuth || !BirdsAuth.isLoggedIn()) return [];
        try {
            var items = await GraphClient.listJsonFiles('Shop Tools/' + folder);
            var results = [];
            for (var i = 0; i < items.length; i++) {
                try {
                    var t = await GraphClient.readFile('Shop Tools/' + folder + '/' + items[i].name);
                    if (t) { var obj = JSON.parse(t); if (obj && obj.id) results.push(obj); }
                } catch(e) {}
            }
            results.sort(function(a,b){ return (b.submittedAt||'').localeCompare(a.submittedAt||''); });
            /* Ensure entries match their folder type (incidents ≠ complaints) */
            var typeMap = { 'incidents': 'incident', 'complaints': 'complaint', 'uniform-orders': 'uniform' };
            results = results.filter(function(r){ return !r.type || r.type === (typeMap[folder] || folder); });
            return results;
        } catch(e) { return []; }
    }

    async function _saveReport(folder, data) {
        if (typeof GraphClient === 'undefined' || !BirdsAuth || !BirdsAuth.isLoggedIn()) { showToast('Not connected — cannot save.', 'error'); return false; }
        try {
            data.submittedAt = new Date().toISOString();
            if (!data.id) data.id = uid();
            await GraphClient.writeFile('Shop Tools/' + folder + '/' + data.id + '.json', JSON.stringify(data, null, 2));
            return true;
        } catch(e) { showToast('Save failed: ' + e.message, 'error'); return false; }
    }

    function _isHQ() { _init(); return !_isShop; }

    /* ═══════════════════════════════════════════════════════════════
       STORE HUB: Home screen — Messages + Quick Actions + Activity
       ═══════════════════════════════════════════════════════════════ */
    /* ─── SMART DASHBOARD ──────────────────────────────────────── */
    window.renderShopHome = async function() {
        _init();
        var mv = document.getElementById('mainView');
        if (!mv) return;

        /* Gather all data in parallel */
        var pendingMsgs = 0, taskMsgs = [], recentReports = [];
        var openTickets = 0, latestTicket = null;
        var rotaGaps = 0, staffCount = 0;
        var overdueActions = 0;
        var kpiData = null;

        try {
            if (typeof Messages !== 'undefined' && _shopStoreId) {
                var msgs = Messages.getForStore(_shopStoreId);
                pendingMsgs = msgs.filter(function(m) { return !Messages.hasStoreResponded(m.id, _shopStoreId); }).length;
                taskMsgs = msgs.filter(function(m) { return m.type === 'action_required' && !Messages.hasStoreResponded(m.id, _shopStoreId); });
            }
        } catch(e) {}

        try {
            if (typeof ITHelpdesk !== 'undefined') {
                await ITHelpdesk._loadTickets();
                var allTickets = ITHelpdesk._loadTickets ? [] : [];
                /* Access tickets through the module's internal state */
                var tickets = [];
                try { tickets = await idbGetAll('it_tickets'); } catch(e) {}
                var myTickets = tickets.filter(function(t) { return t.storeId === _shopStoreId; });
                openTickets = myTickets.filter(function(t) { return t.status === 'received' || t.status === 'processing'; }).length;
                latestTicket = myTickets.find(function(t) { return t.status === 'received' || t.status === 'processing'; }) || null;
            }
        } catch(e) {}

        try {
            if (typeof Rota !== 'undefined' && _shopStoreId) {
                var currentMonday = Rota.getMonday(new Date());
                var staff = await Rota.loadStaff(_shopStoreId);
                var weekData = await Rota.loadWeek(_shopStoreId, currentMonday);
                staffCount = staff.length;
                if (staff.length > 0 && weekData && weekData.shifts) {
                    var shifts = weekData.shifts;
                    var todayIdx = new Date().getDay();
                    Rota.DAYS.forEach(function(day, i) {
                        staff.forEach(function(person) {
                            var shift = (shifts[person.id] || {})[day] || {};
                            if (!shift.start && !shift.type && i <= todayIdx) rotaGaps++;
                        });
                    });
                }
            }
        } catch(e) {}

        try {
            var actions = await idbGetAll('actions');
            var today = new Date().toISOString().slice(0, 10);
            overdueActions = actions.filter(function(a) {
                return a.Store === _storeName && a.Status !== 'Closed' && a.DueDate && a.DueDate < today;
            }).length;
        } catch(e) {}

        try {
            var rawKpis = await idbGetAll('kpi');
            var latestWeek = Math.max(...rawKpis.map(function(k) { return Number(k.Week) || 0; }));
            var storeKpis = rawKpis.filter(function(k) {
                var cid = typeof canonicalStoreId === 'function' ? canonicalStoreId(k.Branch || k.BranchId || '') : (k.Branch || k.BranchId || '');
                return cid === _shopStoreId || (k.Branch || '').toLowerCase() === (_storeName || '').toLowerCase();
            });
            kpiData = storeKpis.find(function(k) { return k.Week == latestWeek; }) || null;
        } catch(e) {}

        try {
            var incidents = await _loadReports('incidents');
            var complaints = await _loadReports('complaints');
            var uniforms = await _loadReports('uniform-orders');
            recentReports = incidents.concat(complaints, uniforms)
                .sort(function(a,b){ return (b.submittedAt||'').localeCompare(a.submittedAt||''); })
                .slice(0, 3);
        } catch(e) {}

        var userName = (typeof Users !== 'undefined' && Users.getCurrentUser()) ? Users.getCurrentUser().name : '';
        var greeting = _getGreeting();
        var todayDate = new Date().toISOString().slice(0, 10);

        /* ── Build HTML ── */
        var html = '<div style="max-width:1000px;margin:0 auto;padding:8px;">';

        /* Header */
        html += '<div class="mb-4">'
            + '<h1 class="text-2xl font-black text-slate-800">' + greeting + ', ' + _esc(userName.split(' ')[0] || 'there') + '</h1>'
            + '<p class="text-sm text-slate-400 mt-1">' + _esc(_storeName || _shopStoreId) + '</p>'
            + '</div>';

        /* ── KPI Snapshot (one line) ── */
        if (kpiData) {
            var salesVal = ((kpiData.Sales || 0) * 100).toFixed(1);
            var productVal = ((kpiData.Product || 0) * 100).toFixed(1);
            var wasteVal = ((kpiData.Waste || 0) * 100).toFixed(1);
            var labourVal = ((kpiData.Labour || 0) * 100).toFixed(1);
            var kpiColor = salesVal >= 95 ? '#059669' : salesVal >= 90 ? '#D97706' : '#DC2626';
            html += '<div onclick="setView(\'shop-scorecard\')" class="card p-3 mb-4 cursor-pointer hover:shadow-md transition-all" style="border-left:4px solid ' + kpiColor + ';">'
                + '<div class="flex items-center justify-between">'
                + '<div class="flex items-center gap-4">'
                + '<div><span class="text-[10px] font-bold text-slate-400 uppercase">Sales</span><p class="text-lg font-black" style="color:' + (salesVal >= 95 ? '#059669' : salesVal >= 90 ? '#D97706' : '#DC2626') + ';">' + salesVal + '%</p></div>'
                + '<div><span class="text-[10px] font-bold text-slate-400 uppercase">Product</span><p class="text-lg font-black" style="color:' + (productVal >= 95 ? '#059669' : '#DC2626') + ';">' + productVal + '%</p></div>'
                + '<div><span class="text-[10px] font-bold text-slate-400 uppercase">Waste</span><p class="text-lg font-black" style="color:' + (wasteVal <= 3 ? '#059669' : '#DC2626') + ';">' + wasteVal + '%</p></div>'
                + '<div><span class="text-[10px] font-bold text-slate-400 uppercase">Labour</span><p class="text-lg font-black" style="color:' + (labourVal <= 12 ? '#059669' : '#DC2626') + ';">' + labourVal + '%</p></div>'
                + '</div>'
                + '<span class="text-slate-400">Week ' + kpiData.Week + ' &#8250;</span>'
                + '</div></div>';
        }

        /* ── Needs Attention ── */
        var attentionItems = [];
        if (pendingMsgs > 0) attentionItems.push({ icon: '\uD83D\uDCE8', text: pendingMsgs + ' pending message' + (pendingMsgs > 1 ? 's' : ''), color: '#3B82F6', bg: '#EFF6FF', view: 'shop-messages' });
        if (openTickets > 0) attentionItems.push({ icon: '\uD83D\uDCE6', text: openTickets + ' open IT ticket' + (openTickets > 1 ? 's' : ''), color: '#D97706', bg: '#FEF3C7', view: 'shop-ith-list' });
        if (rotaGaps > 0) attentionItems.push({ icon: '\uD83D\uDCC5', text: rotaGaps + ' shift' + (rotaGaps > 1 ? 's' : '') + ' with no cover', color: '#DC2626', bg: '#FEF2F2', view: 'rota' });
        if (overdueActions > 0) attentionItems.push({ icon: '\u26A0', text: overdueActions + ' overdue action' + (overdueActions > 1 ? 's' : ''), color: '#DC2626', bg: '#FEF2F2', view: 'shop-home' });

        if (attentionItems.length > 0) {
            html += '<div class="mb-4">'
                + '<h2 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Needs Attention</h2>'
                + '<div class="space-y-2">';
            attentionItems.forEach(function(item) {
                html += '<div onclick="setView(\'' + item.view + '\')" class="card p-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition-all" style="border-left:4px solid ' + item.color + ';background:' + item.bg + ';">'
                    + '<span style="font-size:18px;">' + item.icon + '</span>'
                    + '<p class="text-sm font-bold flex-1" style="color:' + item.color + ';">' + item.text + '</p>'
                    + '<span style="color:' + item.color + ';font-size:16px;">&#8250;</span>'
                    + '</div>';
            });
            html += '</div></div>';
        } else {
            html += '<div class="card p-4 mb-4 text-center" style="background:#F0FDF4;border-left:4px solid #059669;">'
                + '<p class="text-sm font-bold" style="color:#059669;">All clear! Nothing needs your attention right now.</p></div>';
        }

        /* ── HQ Tasks (action_required messages) ── */
        if (taskMsgs.length > 0) {
            html += '<div class="mb-4">'
                + '<h2 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">HQ Tasks</h2>'
                + '<div class="space-y-2">';
            taskMsgs.slice(0, 5).forEach(function(msg) {
                var due = msg.dueDate || '';
                var isOverdue = due && due < todayDate;
                html += '<div class="card p-3 flex items-center gap-3" style="' + (isOverdue ? 'border-left:3px solid #DC2626;' : 'border-left:3px solid #6E8E6D;') + '">'
                    + '<button onclick="event.stopPropagation();ShopTools._completeTask(\'' + msg.id + '\')" style="width:22px;height:22px;min-width:22px;border-radius:5px;border:2px solid #6E8E6D;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;color:#6E8E6D;">&#10003;</button>'
                    + '<div class="flex-1 min-w-0">'
                    + '<p class="text-sm font-bold text-slate-700 truncate">' + _esc(msg.title || msg.subject || 'Task') + '</p>'
                    + '<p class="text-[10px] text-slate-400 truncate">' + _esc(msg.body || msg.message || '') + '</p>'
                    + '</div>'
                    + (due ? '<span style="font-size:9px;white-space:nowrap;color:' + (isOverdue ? '#DC2626' : '#94A3B8') + ';font-weight:' + (isOverdue ? '800' : '400') + ';">' + _esc(due) + '</span>' : '')
                    + '</div>';
            });
            html += '</div></div>';
        }

        /* ── Quick Actions ── */
        html += '<div class="mb-4">'
            + '<h2 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Quick Actions</h2>'
            + '<div class="grid grid-cols-3 gap-3">';
        html += _quickActionCard('shop-incident', 'Incident', 'Record an incident', '#D94F4F', '#FEF2F2', '\u26A0');
        html += _quickActionCard('shop-complaint', 'Complaint', 'Log a complaint', '#D97706', '#FEF3C7', '\uD83D\uDCAC');
        html += _quickActionCard('shop-uniform', 'Uniform', 'Request uniforms', '#2563EB', '#EFF6FF', '\uD83C\uDFF5');
        html += _quickActionCard('rota', 'Rota', 'Manage staff rota', '#6E8E6D', '#F0FDF4', '\uD83D\uDCC5');
        html += _quickActionCard('shop-trends', 'Trends', 'View KPI trends', '#059669', '#F0FDF4', '\uD83D\uDCC8');
        html += _quickActionCard('shop-scorecard', 'Scorecard', 'This week\'s score', '#3B82F6', '#EFF6FF', '\uD83C\uDFAF');
        html += '</div></div>';

        /* ── Recent Activity (last 3) ── */
        if (recentReports.length > 0) {
            html += '<div>'
                + '<div class="flex items-center justify-between mb-2">'
                + '<h2 class="text-xs font-black text-slate-400 uppercase tracking-widest">Recent</h2>'
                + '<button onclick="setView(\'shop-home\')" style="background:transparent;color:#6E8E6D;font-size:10px;font-weight:700;border:none;cursor:pointer;">View All &#8250;</button>'
                + '</div>'
                + '<div class="space-y-2">';
            recentReports.forEach(function(r) {
                var typeColors = { incident: '#D94F4F', complaint: '#D97706', uniform: '#2563EB' };
                var typeLabels = { incident: 'Incident', complaint: 'Complaint', uniform: 'Uniform' };
                var color = typeColors[r.type] || '#7A7A7A';
                var label = typeLabels[r.type] || r.type;
                var dateStr = r.date || (r.submittedAt ? r.submittedAt.substring(0, 10) : '');
                html += '<div class="card p-3 flex items-center gap-3">'
                    + '<div style="width:4px;height:28px;border-radius:2px;background:' + color + ';"></div>'
                    + '<div class="flex-1">'
                    + '<p class="text-sm font-bold text-slate-700">' + _esc(label) + '</p>'
                    + '<p class="text-[10px] text-slate-400">' + _esc(dateStr) + '</p>'
                    + '</div>'
                    + '<button onclick="ShopTools._viewReport(\'' + r.id + '\',\'' + (r.type === 'incident' ? 'incidents' : r.type === 'complaint' ? 'complaints' : 'uniform-orders') + '\')" style="background:#F1F5F9;color:#475569;font-size:10px;font-weight:700;padding:5px 10px;border-radius:5px;border:none;cursor:pointer;">View</button>'
                    + '</div>';
            });
            html += '</div></div>';
        }

        html += '</div>';
        mv.innerHTML = html;
    };

    /* ─── Complete a task (acknowledge an action_required message) ── */
    window._completeTask = async function(messageId) {
        if (typeof Messages === 'undefined' || !_shopStoreId) return;
        try {
            await Messages.respond(messageId, { type: 'acknowledge', storeId: _shopStoreId, respondedBy: (Users.getCurrentUser() || {}).name || '' });
            showToast('Task marked complete', 'success');
            renderShopHome();
        } catch(e) { showToast('Could not complete task', 'error'); }
    };

    function _getGreeting() {
        var h = new Date().getHours();
        if (h < 12) return 'Good morning';
        if (h < 17) return 'Good afternoon';
        return 'Good evening';
    }

    function _quickActionCard(view, title, desc, color, bg, icon) {
        return '<div onclick="setView(\'' + view + '\')" class="card p-4 cursor-pointer hover:shadow-md transition-all text-center" style="border-top:3px solid ' + color + ';">'
            + '<div style="font-size:28px;margin-bottom:8px;">' + icon + '</div>'
            + '<p class="text-sm font-bold text-slate-700">' + _esc(title) + '</p>'
            + '<p class="text-[11px] text-slate-400 mt-1">' + _esc(desc) + '</p>'
            + '</div>';
    }

    /* ─── Shop Messages view (delegates to Messages module) ───── */
    window.renderShopMessages = async function() {
        _init();
        if (typeof Messages === 'undefined') {
            document.getElementById('mainView').innerHTML = '<div class="card p-8 text-center text-slate-400"><p class="text-lg font-bold">Messages not available</p></div>';
            return;
        }
        Messages.renderStore(_shopStoreId, _storeName);
    };

    window._toggleTestMode = function() {
        _testMode = !_testMode;
        var el = document.getElementById('shop-test-badge');
        if (el) el.style.display = _testMode ? '' : 'none';
        showToast('Test mode ' + (_testMode ? 'ON — entries will be flagged as test data' : 'OFF'), _testMode ? 'warning' : 'info');
    };

    window._deleteAllTest = async function(folder) {
        var reports = await _loadReports(folder);
        var test = reports.filter(function(r){ return r.testMode; });
        if (!test.length) { showToast('No test entries to delete.', 'info'); return; }
        if (!confirm('Delete ' + test.length + ' test entries from ' + folder + '? This cannot be undone.')) return;
        for (var i = 0; i < test.length; i++) {
            try { await (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn() ? GraphClient.deleteFile('Shop Tools/' + folder + '/' + test[i].id + '.json') : Promise.resolve()); } catch(e) {}
        }
        showToast('Deleted ' + test.length + ' test entries.', 'success');
        if (folder === 'incidents') window.renderShopIncident();
        else if (folder === 'complaints') window.renderShopComplaint();
        else if (folder === 'uniform-orders') window.renderShopUniform();
    };

    function _viewModeFor(type) {
        _init();
        if (!_isHQ()) return 'form';
        if (_backendViews[type] === undefined) _backendViews[type] = true;
        return _backendViews[type] ? 'backend' : 'form';
    }

    /* ═══════════════════════════════════════════════════════════════
       SHARED: Backend data table
       ═══════════════════════════════════════════════════════════════ */
    async function _renderBackend(type, title, cols, rowFn, currentView) {
        var reports = await _loadReports(type);
        var mv = document.getElementById('mainView');
        var mode = _viewModeFor(type);
        var rowsHtml = reports.length ? reports.map(rowFn).join('') : '<tr><td colspan="' + (cols.length+1) + '" class="text-center text-slate-400 italic py-8">No reports yet.</td></tr>';
        var colH = cols.map(function(c){ return '<th class="p-2 text-left text-[10px] font-black text-slate-500 uppercase">' + c + '</th>'; }).join('');
        mv.innerHTML = '<div style="max-width:1100px;margin:0 auto;padding:8px;">' +
            '<div class="flex items-center justify-between mb-4">' +
            '<div><h2 class="text-2xl font-black text-slate-800">' + title + '</h2><p class="text-sm text-slate-400">' + reports.length + ' report' + (reports.length !== 1 ? 's' : '') + ' &mdash; ' + (mode === 'backend' ? 'Backend view' : 'Form view') + '</p></div>' +
            '<div class="flex items-center gap-3">' +
            '<button onclick="ShopTools._deleteAllTest(\'' + type + '\')" class="text-[11px] font-bold px-3 py-1 rounded border bg-red-50 text-red-600 border-red-200 hover:bg-red-100" style="cursor:pointer;" title="Delete all test entries">\uD83D\uDDD1 Delete tests</button>' +
            '<button onclick="ShopTools._toggleView(\'' + type + '\',\'' + currentView + '\')" class="text-xs font-bold px-3 py-1.5 rounded border ' + (mode === 'form' ? 'bg-birds-green text-white border-birds-green' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50') + '" style="cursor:pointer;">\u270E Form view</button>' +
            '<button onclick="ShopTools._toggleView(\'' + type + '\',\'' + currentView + '\')" class="text-xs font-bold px-3 py-1.5 rounded border ' + (mode === 'backend' ? 'bg-birds-green text-white border-birds-green' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50') + '" style="cursor:pointer;">\uD83D\uDCCA Backend</button>' +
            '</div>' +
            '</div>' +
            '</div>' +
            (mode === 'backend' ? '<div class="overflow-x-auto bg-white border border-slate-200 rounded-lg"><table class="w-full text-sm"><thead><tr class="border-b border-slate-200">' + colH + '<th class="p-2"></th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' : '') +
            '</div>';
    }

    /* ═══════════════════════════════════════════════════════════════
       INCIDENT / ACCIDENT REPORT
       ═══════════════════════════════════════════════════════════════ */
    window.renderShopIncident = async function() {
        _init();
        if (_viewModeFor('incidents') === 'backend') {
            return _renderBackend('incidents', 'Incident / Accident Reports', ['Date','Store','Person','Type','Follow-up','Checklist'], function(r) {
                var cl = r.postIncidentChecklist || '';
                var clParts = cl ? cl.split(',') : [];
                var clBadge = clParts.length ? '<span class="text-[10px] font-black text-slate-600 bg-slate-100 px-2 py-0.5 rounded" title="' + escapeHtml(cl) + '">' + clParts.length + ' ticked</span>' : '<span class="text-[10px] text-slate-400">—</span>';
                return '<tr class="border-b border-slate-100">' +
                    '<td class="p-2 text-xs font-bold">' + escapeHtml(r.date || '') + '</td>' +
                    '<td class="p-2 text-xs font-bold">' + escapeHtml(r.storeName || '') + '</td>' +
                    '<td class="p-2 text-xs text-slate-700">' + escapeHtml(r.personInvolved || '') + '</td>' +
                    '<td class="p-2 text-xs">' + escapeHtml(r.incidentType || '') + '</td>' +
                    '<td class="p-2">' + (r.followUp ? '<span class="text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded">Yes</span>' : '<span class="text-[10px] text-slate-400">No</span>') + '</td>' +
                    '<td class="p-2">' + clBadge + '</td>' +
                    '<td class="p-2"><button onclick="ShopTools._viewReport(\'' + r.id + '\',\'incidents\')" class="text-[10px] font-bold text-birds-green hover:underline">View</button></td></tr>';
            }, 'shop-incident');
        }
        _renderIncidentForm();
    };

    function _renderIncidentForm() {
        _init();
        var mv = document.getElementById('mainView');
        var reporterName = (typeof Users !== 'undefined' && Users.getCurrentUser() ? Users.getCurrentUser().name : '');
        mv.innerHTML = '<div style="max-width:1080px;margin:0 auto;padding:8px;">' +
            '<h2 class="text-2xl font-black text-slate-800 mb-1">Incident / Accident Report</h2>' +
            '<p class="text-sm text-slate-400 mb-6">Record an incident or accident at your store.</p>' +
            '<div class="flex items-center gap-3 mb-4"><button onclick="ShopTools._toggleTestMode()" class="text-[11px] font-bold px-3 py-1 rounded border ' + (_testMode ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100') + '" style="cursor:pointer;">\uD83E\uDDEA Test mode: ' + (_testMode ? 'ON' : 'OFF') + '</button>' +
            '<span id="shop-test-badge" style="display:' + (_testMode ? '' : 'none') + ';font-size:10px;font-weight:800;background:#FEF3C7;color:#92400E;padding:3px 10px;border-radius:99px;">\uD83E\uDDEA TEST DATA</span></div>' +
            '<div style="display:grid;grid-template-columns:1fr 250px;gap:20px;align-items:start;">' +

            /* ── LEFT: form fields ── */
            '<div class="card p-6 border-t-4 border-t-red-500">' +
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date *</label><input type="date" id="inc-date" value="' + today() + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Time</label><input type="time" id="inc-time" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Store *</label><input type="text" id="inc-store" value="' + escapeHtml(_storeName) + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50" readonly></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Person involved *</label><input type="text" id="inc-person" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm" placeholder="Full name"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Incident type *</label><select id="inc-type" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"><option value="">-- Select --</option><option>Slip / Trip</option><option>Burn / Scald</option><option>Cut / Laceration</option><option>Lifting / Muscle</option><option>Equipment</option><option>Fall from height</option><option>Chemical / Substance</option><option>Violence / Verbal abuse</option><option>Other</option></select></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Witness(es)</label><input type="text" id="inc-witness" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm" placeholder="Names separated by commas"></div>' +
            '</div>' +
            '<div class="mb-4"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Description of incident *</label><textarea id="inc-desc" class="w-full h-24 p-2.5 border border-slate-200 rounded-lg text-sm resize-y" placeholder="What happened, where, how..."></textarea></div>' +
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">First aid given?</label><select id="inc-firstaid" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"><option value="">--</option><option>Yes</option><option>No</option></select></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Hospital visit?</label><select id="inc-hospital" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"><option value="">--</option><option>Yes</option><option>No</option></select></div>' +
            '</div>' +
            '<div class="mb-4"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Immediate action taken</label><textarea id="inc-action" class="w-full h-16 p-2.5 border border-slate-200 rounded-lg text-sm resize-y"></textarea></div>' +
            '<div class="mb-4"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Evidence / Photos (optional)</label><input type="file" id="inc-photo" accept="image/*" class="text-sm"></div>' +
            '<div class="flex items-center gap-2 mb-4">' +
            '<input type="checkbox" id="inc-followup" class="accent-red-500"><label for="inc-followup" class="text-sm font-bold text-slate-700">Follow-up required</label>' +
            '</div>' +
            '<div class="mb-4"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Reported by *</label><input type="text" id="inc-reporter" value="' + escapeHtml(reporterName) + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"></div>' +
            '<div class="flex gap-3"><button onclick="ShopTools._saveIncident()" style="background:#D94F4F;color:#fff;padding:10px 20px;border-radius:8px;font-weight:800;font-size:13px;border:none;cursor:pointer;">Submit Report</button>' +
            (_isHQ() ? '<button onclick="ShopTools._toggleView(\'incidents\',\'shop-incident\')" style="background:rgba(85,91,110,0.08);color:#555B6E;padding:10px 20px;border-radius:8px;font-weight:800;font-size:13px;border:none;cursor:pointer;">Back to Backend</button>' : '') +
            '</div></div>' +

            /* ── RIGHT: checklist sidebar ── */
            '<div>' +
            '<div class="card p-4 border-t-4 border-t-red-500" style="position:sticky;top:8px;background:#fffdf5;">' +
            '<h3 class="text-xs font-black text-red-700 uppercase tracking-widest mb-1">\u2611 Incident checklist</h3>' +
            '<p class="text-[10px] text-slate-400 mb-3">Tick as you complete each step</p>' +
            '<div class="space-y-1">' +
            '<label class="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white px-3 py-2 rounded border border-slate-200 cursor-pointer hover:bg-red-50"><input type="checkbox" value="Isolated the area" class="inc-checklist-cb accent-red-500"> Isolated the area</label>' +
            '<label class="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white px-3 py-2 rounded border border-slate-200 cursor-pointer hover:bg-red-50"><input type="checkbox" value="Team member with injured person" class="inc-checklist-cb accent-red-500"> Team member with person</label>' +
            '<label class="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white px-3 py-2 rounded border border-slate-200 cursor-pointer hover:bg-red-50"><input type="checkbox" value="Notified Area Manager" class="inc-checklist-cb accent-red-500"> Notified Area Manager</label>' +
            '<label class="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white px-3 py-2 rounded border border-slate-200 cursor-pointer hover:bg-red-50"><input type="checkbox" value="Notified Health and Safety" class="inc-checklist-cb accent-red-500"> Notified Health &amp; Safety</label>' +
            '<label class="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white px-3 py-2 rounded border border-slate-200 cursor-pointer hover:bg-red-50"><input type="checkbox" value="Got contact information" class="inc-checklist-cb accent-red-500"> Got contact info</label>' +
            '<label class="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white px-3 py-2 rounded border border-slate-200 cursor-pointer hover:bg-red-50"><input type="checkbox" value="Safe to continue service" class="inc-checklist-cb accent-red-500"> Area safe for service</label>' +
            '</div></div></div>' +

            '</div></div>';
    }

    window._saveIncident = async function() {
        var date = document.getElementById('inc-date')?.value?.trim();
        var person = document.getElementById('inc-person')?.value?.trim();
        var desc = document.getElementById('inc-desc')?.value?.trim();
        if (!date || !person || !desc) { showToast('Date, person and description are required.', 'warning'); return; }
        var checklist = []; var cls = document.querySelectorAll('.inc-checklist-cb:checked'); cls.forEach(function(cb){ checklist.push(cb.value); });
        var data = {
            id: uid(), type: 'incident', date: date, time: document.getElementById('inc-time')?.value?.trim() || '',
            storeId: _shopStoreId, storeName: document.getElementById('inc-store')?.value?.trim() || '',
            personInvolved: person,
            incidentType: document.getElementById('inc-type')?.value || '',
            witness: document.getElementById('inc-witness')?.value?.trim() || '',
            description: desc,
            firstAid: document.getElementById('inc-firstaid')?.value || '',
            hospitalVisit: document.getElementById('inc-hospital')?.value || '',
            immediateAction: document.getElementById('inc-action')?.value?.trim() || '',
            postIncidentChecklist: checklist.join(', '),
            followUp: document.getElementById('inc-followup')?.checked || false,
            reporter: document.getElementById('inc-reporter')?.value?.trim() || '',
            evidenceFile: '', status: 'Open', testMode: _testMode
        };
        var fileInput = document.getElementById('inc-photo');
        if (fileInput && fileInput.files.length > 0) {
            try {
                var reader = new FileReader();
                data.evidenceFile = await new Promise(function(resolve) { reader.onload = function() { resolve(reader.result); }; reader.readAsDataURL(fileInput.files[0]); });
            } catch(e) {}
        }
        var ok = await _saveReport('incidents', data);
        if (ok) {
            showToast('Incident report saved.', 'success');
            window.renderShopIncident();
        }
    };

    /* ═══════════════════════════════════════════════════════════════
       CUSTOMER COMPLAINT
       ═══════════════════════════════════════════════════════════════ */
    window.renderShopComplaint = async function() {
        _init();
        if (_viewModeFor('complaints') === 'backend') {
            return _renderBackend('complaints', 'Customer Complaints', ['Date','Store','Customer','Category','Severity'], function(r) {
                var ragStyle = r.severity === 'Green' ? 'bg-emerald-100 text-emerald-700' : r.severity === 'Amber' ? 'bg-amber-100 text-amber-700' : r.severity === 'Red' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500';
                return '<tr class="border-b border-slate-100">' +
                    '<td class="p-2 text-xs font-bold">' + escapeHtml(r.date || '') + '</td>' +
                    '<td class="p-2 text-xs font-bold">' + escapeHtml(r.storeName || '') + '</td>' +
                    '<td class="p-2 text-xs text-slate-700">' + escapeHtml(r.customerName || '') + '</td>' +
                    '<td class="p-2 text-xs">' + escapeHtml(r.category || '') + '</td>' +
                    '<td class="p-2"><span class="text-[10px] font-black px-2 py-0.5 rounded ' + ragStyle + '">' + escapeHtml(r.severity || '—') + '</span></td>' +
                    '<td class="p-2"><button onclick="ShopTools._viewReport(\'' + r.id + '\',\'complaints\')" class="text-[10px] font-bold text-birds-green hover:underline">View</button></td></tr>';
            }, 'shop-complaint');
        }
        _renderComplaintForm();
    };

    function _renderComplaintForm() {
        _init();
        var mv = document.getElementById('mainView');
        mv.innerHTML = '<div style="max-width:700px;margin:0 auto;padding:8px;">' +
            '<h2 class="text-2xl font-black text-slate-800 mb-1">Customer Complaint</h2>' +
            '<p class="text-sm text-slate-400 mb-6">Log a customer complaint received at your store.</p>' +
            '<div class="flex items-center gap-3 mb-4"><button onclick="ShopTools._toggleTestMode()" class="text-[11px] font-bold px-3 py-1 rounded border ' + (_testMode ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100') + '" style="cursor:pointer;">\uD83E\uDDEA Test mode: ' + (_testMode ? 'ON' : 'OFF') + '</button>' +
            '<span id="shop-test-badge" style="display:' + (_testMode ? '' : 'none') + ';font-size:10px;font-weight:800;background:#FEF3C7;color:#92400E;padding:3px 10px;border-radius:99px;">\uD83E\uDDEA TEST DATA</span></div>' +
            '<div class="card p-6 border-t-4 border-t-amber-500">' +
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date *</label><input type="date" id="cmp-date" value="' + today() + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Store *</label><input type="text" id="cmp-store" value="' + escapeHtml(_storeName) + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50" readonly></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Customer name</label><input type="text" id="cmp-customer" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm" placeholder="Full name"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Category *</label><select id="cmp-category" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"><option value="">-- Select --</option><option>Product quality</option><option>Food safety / hygiene</option><option>Staff conduct</option><option>Pricing / payment</option><option>Availability</option><option>Wait time</option><option>Cleanliness</option><option>Other</option></select></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Severity</label><select id="cmp-severity" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"><option value="">-- Select --</option><option value="Green">Green — minor / resolved</option><option value="Amber">Amber — needs attention</option><option value="Red">Red — serious</option></select></div>' +
            '</div>' +
            '<div class="mb-4"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Complaint details *</label><textarea id="cmp-desc" class="w-full h-24 p-2.5 border border-slate-200 rounded-lg text-sm resize-y" placeholder="What the customer said, what happened..."></textarea></div>' +
            '<div class="mb-4"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Action taken (tick all that apply)</label>' +
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-1">' +
            '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="checkbox" value="Apologised" class="cmp-action-cb accent-amber-500"> Apologised</label>' +
            '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="checkbox" value="Offered replacement" class="cmp-action-cb accent-amber-500"> Offered replacement</label>' +
            '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="checkbox" value="Offered refund" class="cmp-action-cb accent-amber-500"> Offered refund</label>' +
            '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="checkbox" value="Offered extra item(s)" class="cmp-action-cb accent-amber-500"> Offered extra item(s)</label>' +
            '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="checkbox" value="Needs follow-up by Head Office" class="cmp-action-cb accent-amber-500"> Needs follow-up by Head Office</label>' +
            '<label class="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"><input type="checkbox" value="Customer details form" class="cmp-action-cb accent-amber-500"> Customer details form (if applicable)</label>' +
            '</div></div>' +
            '<div class="mb-4"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Evidence (optional)</label><input type="file" id="cmp-photo" accept="image/*" class="text-sm"></div>' +
            '<div class="flex items-center gap-2 mb-4">' +
            '<input type="checkbox" id="cmp-followup" class="accent-amber-500"><label for="cmp-followup" class="text-sm font-bold text-slate-700">Follow-up required</label>' +
            '</div>' +
            '<div class="mb-4"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Reported by *</label><input type="text" id="cmp-reporter" value="' + escapeHtml((typeof Users !== 'undefined' && Users.getCurrentUser() ? Users.getCurrentUser().name : '')) + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"></div>' +
            '<div class="flex gap-3"><button onclick="ShopTools._saveComplaint()" style="background:#D97706;color:#fff;padding:10px 20px;border-radius:8px;font-weight:800;font-size:13px;border:none;cursor:pointer;">Submit Complaint</button>' +
            (_isHQ() ? '<button onclick="ShopTools._toggleView(\'complaints\',\'shop-complaint\')" style="background:rgba(85,91,110,0.08);color:#555B6E;padding:10px 20px;border-radius:8px;font-weight:800;font-size:13px;border:none;cursor:pointer;">Back to Backend</button>' : '') +
            '</div></div></div>';
    }

    window._saveComplaint = async function() {
        var date = document.getElementById('cmp-date')?.value?.trim();
        var desc = document.getElementById('cmp-desc')?.value?.trim();
        if (!date || !desc) { showToast('Date and complaint details are required.', 'warning'); return; }
        var actions = []; var cbs = document.querySelectorAll('.cmp-action-cb:checked'); cbs.forEach(function(cb){ actions.push(cb.value); });
        var data = {
            id: uid(), type: 'complaint', date: date,
            storeId: _shopStoreId, storeName: document.getElementById('cmp-store')?.value?.trim() || '',
            customerName: document.getElementById('cmp-customer')?.value?.trim() || '',
            category: document.getElementById('cmp-category')?.value || '',
            severity: document.getElementById('cmp-severity')?.value || '',
            description: desc,
            actionTaken: actions.join(', '),
            followUp: document.getElementById('cmp-followup')?.checked || false,
            reporter: document.getElementById('cmp-reporter')?.value?.trim() || '',
            evidenceFile: '', status: 'Open', testMode: _testMode
        };
        var fileInput = document.getElementById('cmp-photo');
        if (fileInput && fileInput.files.length > 0) {
            try {
                var reader = new FileReader();
                data.evidenceFile = await new Promise(function(resolve) { reader.onload = function() { resolve(reader.result); }; reader.readAsDataURL(fileInput.files[0]); });
            } catch(e) {}
        }
        var ok = await _saveReport('complaints', data);
        if (ok) {
            showToast('Complaint logged.', 'success');
            window.renderShopComplaint();
        }
    };

    /* ═══════════════════════════════════════════════════════════════
       UNIFORM ORDERING
       ═══════════════════════════════════════════════════════════════ */
    window.renderShopUniform = async function() {
        _init();
        if (_viewModeFor('uniform') === 'backend') {
            var orders = await _loadReports('uniform-orders');
            var stock = await _loadStock();
            var mv = document.getElementById('mainView');
            var total = (stock.tShirtXS||0)+(stock.tShirtS||0)+(stock.tShirtM||0)+(stock.tShirtL||0)+(stock.tShirtXL||0)+(stock.tShirtXXL||0)+(stock.tShirtXXXL||0)+(stock.apron||0);
            var stockSizes = ['XS','S','M','L','XL','XXL','XXXL'];
            var stockInputs = stockSizes.map(function(s) {
                return '<div><label class="text-[9px] font-black text-slate-400 uppercase block">T-Shirt ' + s + '</label><input type="number" id="stk-tshirt-' + s.toLowerCase() + '" value="' + (stock['tShirt'+s]||0) + '" min="0" class="w-full p-2 border border-slate-200 rounded-lg text-xs" style="width:60px;"></div>';
            }).join('');
            stockInputs += '<div><label class="text-[9px] font-black text-slate-400 uppercase block">Apron</label><input type="number" id="stk-apron" value="' + (stock.apron||0) + '" min="0" class="w-full p-2 border border-slate-200 rounded-lg text-xs" style="width:60px;"></div>';
            var stockHtml = '<div class="card p-4 mb-6"><div class="flex items-center justify-between mb-3"><h3 class="text-sm font-black text-slate-700">\uD83D\uDCE6 Master Stock Levels</h3><span class="text-[11px] text-slate-400">' + total + ' items in stock</span></div><div class="flex flex-wrap gap-3 mb-3">' + stockInputs + '</div><button onclick="ShopTools._saveStockFromUI()" style="background:#6E8E6D;color:#fff;padding:6px 14px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">Save Stock</button></div>';

            var rowsHtml = orders.length ? orders.map(function(r) {
                var totalIt = (r.tshirtXS||0)+(r.tshirtS||0)+(r.tshirtM||0)+(r.tshirtL||0)+(r.tshirtXL||0)+(r.tshirtXXL||0)+(r.tshirtXXXL||0)+(r.apron||0);
                var stColors = { 'Received':'bg-blue-100 text-blue-700', 'Being processed':'bg-amber-100 text-amber-700', 'Order processed':'bg-emerald-100 text-emerald-700' };
                var stCls = stColors[r.status] || 'bg-slate-100 text-slate-500';
                return '<tr class="border-b border-slate-100">' +
                    '<td class="p-2 text-xs font-bold">' + escapeHtml(r.date||'') + '</td>' +
                    '<td class="p-2 text-xs font-bold">' + escapeHtml(r.storeName||'') + '</td>' +
                    '<td class="p-2 text-xs">' + escapeHtml(r.requester||'') + '</td>' +
                    '<td class="p-2 text-xs">' + totalIt + ' items</td>' +
                    '<td class="p-2"><span class="text-[10px] font-black px-2 py-0.5 rounded ' + stCls + '">' + escapeHtml(r.status||'Received') + '</span></td>' +
                    '<td class="p-2"><select onchange="ShopTools._updateOrderStatus(\'' + r.id + '\',this.value)" class="text-[10px] font-bold border border-slate-200 rounded px-1 py-0.5" onclick="event.stopPropagation()"><option value="">Change...</option><option value="Received">Received</option><option value="Being processed">Being processed</option><option value="Order processed">Order processed</option></select></td>' +
                    '</tr>';
            }).join('') : '<tr><td colspan="6" class="text-center text-slate-400 italic py-8">No orders yet.</td></tr>';

            mv.innerHTML = '<div style="max-width:1100px;margin:0 auto;padding:8px;">' +
                '<div class="flex items-center justify-between mb-4">' +
                '<div><h2 class="text-2xl font-black text-slate-800">Uniform Orders</h2><p class="text-sm text-slate-400">' + orders.length + ' order' + (orders.length!==1?'s':'') + ' &mdash; Backend view</p></div>' +
                '<div class="flex items-center gap-3">' +
                '<button onclick="ShopTools._toggleView(\'uniform\',\'shop-uniform\')" class="text-xs font-bold px-3 py-1.5 rounded border bg-white text-slate-600 border-slate-200 hover:bg-slate-50">\u270E Form view</button>' +
                '<button onclick="ShopTools._toggleView(\'uniform\',\'shop-uniform\')" class="text-xs font-bold px-3 py-1.5 rounded border bg-birds-green text-white border-birds-green">\uD83D\uDCCA Backend</button>' +
                '</div></div>' +
                stockHtml +
                '<div class="overflow-x-auto bg-white border border-slate-200 rounded-lg"><table class="w-full text-sm"><thead><tr class="border-b border-slate-200"><th class="p-2 text-left text-[10px] font-black text-slate-500 uppercase">Date</th><th class="p-2 text-left text-[10px] font-black text-slate-500 uppercase">Store</th><th class="p-2 text-left text-[10px] font-black text-slate-500 uppercase">Employee</th><th class="p-2 text-left text-[10px] font-black text-slate-500 uppercase">Items</th><th class="p-2 text-left text-[10px] font-black text-slate-500 uppercase">Status</th><th class="p-2"></th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
            return;
        }
        _renderUniformForm();
    };

    function _renderUniformForm() {
        _init();
        var sizes = ['XS','S','M','L','XL','XXL','XXXL'];
        var sizeInputs = sizes.map(function(s) {
            return '<div><label class="text-[10px] font-black text-slate-400 uppercase block mb-1">T-Shirt ' + s + '</label><input type="number" id="uni-tshirt-' + s.toLowerCase() + '" value="0" min="0" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm" style="width:70px;"></div>';
        }).join('');
        var mv = document.getElementById('mainView');
        mv.innerHTML = '<div style="max-width:700px;margin:0 auto;padding:8px;">' +
            '<h2 class="text-2xl font-black text-slate-800 mb-1">Uniform Ordering</h2>' +
            '<p class="text-sm text-slate-400 mb-6">Order replacement uniform items for your store.</p>' +
            '<div class="flex items-center gap-3 mb-4"><button onclick="ShopTools._toggleTestMode()" class="text-[11px] font-bold px-3 py-1 rounded border ' + (_testMode ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100') + '" style="cursor:pointer;">\uD83E\uDDEA Test mode: ' + (_testMode ? 'ON' : 'OFF') + '</button>' +
            '<span id="shop-test-badge" style="display:' + (_testMode ? '' : 'none') + ';font-size:10px;font-weight:800;background:#FEF3C7;color:#92400E;padding:3px 10px;border-radius:99px;">\uD83E\uDDEA TEST DATA</span></div>' +
            '<div class="card p-6 border-t-4 border-t-blue-500">' +
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Date *</label><input type="date" id="uni-date" value="' + today() + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Store *</label><input type="text" id="uni-store" value="' + escapeHtml(_storeName) + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50" readonly></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Employee name *</label><input type="text" id="uni-requester" value="' + escapeHtml((typeof Users !== 'undefined' && Users.getCurrentUser() ? Users.getCurrentUser().name : '')) + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"></div>' +
            '</div>' +
            '<h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">T-Shirts</h3>' +
            '<div class="flex flex-wrap gap-3 mb-4">' + sizeInputs + '</div>' +
            '<div class="mb-4"><label class="text-[10px] font-black text-slate-400 uppercase mb-1 block">Apron (one size)</label><input type="number" id="uni-apron" value="0" min="0" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm" style="width:100px;"></div>' +
            '<div class="mb-4"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Notes / Specific requirements</label><textarea id="uni-notes" class="w-full h-16 p-2.5 border border-slate-200 rounded-lg text-sm resize-y"></textarea></div>' +
            '<div class="flex gap-3"><button onclick="ShopTools._saveUniform()" style="background:#2563EB;color:#fff;padding:10px 20px;border-radius:8px;font-weight:800;font-size:13px;border:none;cursor:pointer;">Submit Order</button>' +
            (_isHQ() ? '<button onclick="ShopTools._toggleView(\'uniform\',\'shop-uniform\')" style="background:rgba(85,91,110,0.08);color:#555B6E;padding:10px 20px;border-radius:8px;font-weight:800;font-size:13px;border:none;cursor:pointer;">Back to Backend</button>' : '') +
            '</div></div></div>';
    }

    window._saveUniform = async function() {
        var date = document.getElementById('uni-date')?.value?.trim();
        var requester = document.getElementById('uni-requester')?.value?.trim();
        if (!date || !requester) { showToast('Date and requester are required.', 'warning'); return; }
        var sizes = ['XS','S','M','L','XL','XXL','XXXL'];
        var data = {
            id: uid(), type: 'uniform', date: date,
            storeId: _shopStoreId, storeName: document.getElementById('uni-store')?.value?.trim() || '',
            requester: requester, status: 'Received', notes: document.getElementById('uni-notes')?.value?.trim() || ''
        };
        sizes.forEach(function(s) { data['tshirt' + s] = parseInt(document.getElementById('uni-tshirt-' + s.toLowerCase())?.value || 0) || 0; });
        data.apron = parseInt(document.getElementById('uni-apron')?.value || 0) || 0;
        data.testMode = _testMode;
        var total = (data.tshirtXS||0)+(data.tshirtS||0)+(data.tshirtM||0)+(data.tshirtL||0)+(data.tshirtXL||0)+(data.tshirtXXL||0)+(data.tshirtXXXL||0)+data.apron;
        if (total === 0) { showToast('Please add at least one item to order.', 'warning'); return; }
        var ok = await _saveReport('uniform-orders', data);
        if (ok) {
            /* Auto-decrement the master stock levels */
            try {
                var stk = await _loadStock();
                sizes.forEach(function(s) { stk['tShirt' + s] = Math.max(0, (stk['tShirt' + s] || 0) - (data['tshirt' + s] || 0)); });
                stk.apron = Math.max(0, (stk.apron || 0) - (data.apron || 0));
                await _saveStock(stk);
            } catch(e) {}
            showToast('Uniform order submitted. Stock updated.', 'success');
            window.renderShopUniform();
        }
    };

    async function _loadStock() {
        if (typeof GraphClient === 'undefined' || !BirdsAuth || !BirdsAuth.isLoggedIn()) return {};
        try {
            var t = await GraphClient.readFile('Shop Tools/uniform-stock.json');
            if (t) { var s = JSON.parse(t); return s || {}; }
        } catch(e) {}
        return { tShirtXS: 20, tShirtS: 20, tShirtM: 20, tShirtL: 20, tShirtXL: 15, tShirtXXL: 10, tShirtXXXL: 5, apron: 20 };
    }

    async function _saveStock(stock) {
        if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
            await GraphClient.writeFile('Shop Tools/uniform-stock.json', JSON.stringify(stock, null, 2));
        }
    }

    async function _updateOrderStatus(id, status) {
        if (typeof GraphClient === 'undefined' || !BirdsAuth || !BirdsAuth.isLoggedIn()) { showToast('Not connected.', 'error'); return; }
        var t = await GraphClient.readFile('Shop Tools/uniform-orders/' + id + '.json');
        if (!t) { showToast('Order not found.', 'error'); return; }
        var r = JSON.parse(t);
        r.status = status;
        await GraphClient.writeFile('Shop Tools/uniform-orders/' + id + '.json', JSON.stringify(r, null, 2));
        showToast('Order marked as ' + status, 'success');
        window.renderShopUniform();
    }

    window._updateOrderStatus = _updateOrderStatus;

    window._saveStockFromUI = async function() {
        var stock = {};
        ['XS','S','M','L','XL','XXL','XXXL'].forEach(function(s) {
            stock['tShirt' + s] = parseInt(document.getElementById('stk-tshirt-' + s.toLowerCase())?.value || 0) || 0;
        });
        stock.apron = parseInt(document.getElementById('stk-apron')?.value || 0) || 0;
        await _saveStock(stock);
        showToast('Stock levels saved.', 'success');
        window.renderShopUniform();
    };

    /* ─── View a single report ────────────────────────────────── */
    window._viewReport = async function(id, folder) {
        if (typeof GraphClient === 'undefined' || !BirdsAuth || !BirdsAuth.isLoggedIn()) { showToast('Not connected.', 'error'); return; }
        try {
            var t = await GraphClient.readFile('Shop Tools/' + folder + '/' + id + '.json');
            if (!t) { showToast('Report not found.', 'error'); return; }
            var r = JSON.parse(t);
            var mv = document.getElementById('mainView');
            var props = Object.keys(r).map(function(k) {
                if (k === 'id' || k === 'submittedAt' || k === 'evidenceFile') return '';
                var v = r[k];
                if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
                if (k === 'voucher') v = v ? '\u00a3' + parseFloat(v).toFixed(2) : '—';
                return '<div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-[10px] font-black text-slate-400 uppercase">' + escapeHtml(k) + '</span><span class="text-sm font-bold text-slate-700">' + escapeHtml(String(v || '—')) + '</span></div>';
            }).join('');
            mv.innerHTML = '<div style="max-width:900px;margin:0 auto;padding:8px;"><button onclick="' + (folder === 'incidents' ? 'renderShopIncident' : folder === 'complaints' ? 'renderShopComplaint' : 'renderShopUniform') + '()" class="text-sm font-bold text-slate-500 hover:text-slate-700 mb-4 block">\u2190 Back</button>' +
                '<div style="display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start;">'
                + '<div class="card p-6"><h2 class="text-xl font-black text-slate-800 mb-4">' + escapeHtml(r.type || 'Report') + ' — ' + escapeHtml(r.id) + '</h2>' +
                props +
                (r.evidenceFile ? '<div class="mt-4"><img src="' + r.evidenceFile + '" class="max-w-full max-h-64 rounded border"/></div>' : '') +
                '<div class="flex gap-3 mt-4">' +
                '<button onclick="ShopTools._exportReportPDF(\'' + id + '\',\'' + folder + '\')" style="background:#555B6E;color:#fff;padding:8px 16px;border-radius:6px;font-weight:800;font-size:12px;border:none;cursor:pointer;">\uD83D\uDCC4 Export PDF</button>' +
                (folder === 'incidents' || folder === 'complaints' ? '<button onclick="ShopTools._investigate(\'' + id + '\',\'' + folder + '\')" style="background:#6E8E6D;color:#fff;padding:8px 16px;border-radius:6px;font-weight:800;font-size:12px;border:none;cursor:pointer;">\uD83D\uDD0D Investigate (create project)</button>' : '') +
                '</div></div>'
                + (r.storeName ? '<div id="reportStoreContext" style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;"></div>' : '')
                + '</div></div>';
            /* Load store context panel async */
            if (r.storeName && typeof StoreContext !== 'undefined') {
                setTimeout(function() { StoreContext.render(r.storeName, 'reportStoreContext'); }, 50);
            }
        } catch(e) { showToast('Error loading report.', 'error'); }
    };

    window._exportReportPDF = async function(id, folder) {
        if (typeof GraphClient === 'undefined' || !BirdsAuth || !BirdsAuth.isLoggedIn()) { showToast('Not connected.', 'error'); return; }
        var t = await GraphClient.readFile('Shop Tools/' + folder + '/' + id + '.json');
        if (!t) { showToast('Report not found.', 'error'); return; }
        var r = JSON.parse(t);
        if (typeof window.jspdf === 'undefined' || typeof html2canvas === 'undefined') { alert('PDF libraries not loaded — please try again.'); return; }
        var { jsPDF } = window.jspdf;
        var doc = new jsPDF('p', 'mm', 'a4');
        var y = 20, ml = 18, pageH = 277;
        var typeLabel = folder === 'incidents' ? 'Incident / Accident Report' : folder === 'complaints' ? 'Customer Complaint' : 'Uniform Order';
        doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(30); doc.text(typeLabel, ml, y); y += 10;
        doc.setFontSize(10); doc.setTextColor(100); doc.text(r.storeName || '—', ml, y); y += 6;
        doc.text('Date: ' + (r.date || '—') + '  |  ID: ' + r.id, ml, y); y += 10;
        doc.setDrawColor(180); doc.line(ml, y, 190, y); y += 6;
        function add(k, v) {
            if (y > pageH) { doc.addPage(); y = 20; }
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(80);
            doc.text(k + ':', ml, y);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(50);
            var lines = doc.splitTextToSize(String(v || '—'), 170 - ml);
            doc.text(lines, ml + 36, y);
            y += Math.max(7, lines.length * 4.5);
        }
        var skip = ['id','type','submittedAt','evidenceFile'];
        Object.keys(r).forEach(function(k) { if (skip.indexOf(k) === -1) { add(k, typeof r[k] === 'boolean' ? (r[k] ? 'Yes' : 'No') : r[k]); } });
        if (r.evidenceFile && r.evidenceFile.indexOf('data:image') === 0) {
            if (y + 60 > pageH) { doc.addPage(); y = 20; }
            try {
                var img = new Image(); img.src = r.evidenceFile;
                await new Promise(function(resolve) { img.onload = resolve; setTimeout(resolve, 3000); });
                doc.addImage(img, 'PNG', ml, y, 80, 60);
            } catch(e) {}
        }
        doc.save((r.storeName || 'report') + '_' + folder + '_' + r.date + '.pdf');
    };

    window._investigate = async function(reportId, folder) {
        if (typeof GraphClient === 'undefined' || !BirdsAuth || !BirdsAuth.isLoggedIn()) { showToast('Not connected.', 'error'); return; }
        var t = await GraphClient.readFile('Shop Tools/' + folder + '/' + reportId + '.json');
        if (!t) { showToast('Report not found.', 'error'); return; }
        var r = JSON.parse(t);
        var label = folder === 'incidents' ? 'Incident' : 'Complaint';
        var storeName = r.storeName || '';
        var name = 'Investigation: ' + label + ' — ' + storeName + ' ' + (r.date || '');
        var desc = 'Auto-created from ' + folder + ' report ' + reportId + '.\nStore: ' + storeName + '\nDate: ' + (r.date || '') + '\n' + (r.description || '');
        if (typeof Projects === 'undefined') { showToast('Projects module not available.', 'error'); return; }
        var project = await Projects.create(name, desc, 'Technical');

        /* Auto-populate first stage with store data */
        var dataNotes = '';
        if (typeof DataSnippets !== 'undefined' && storeName) {
            try {
                var kpiText = await DataSnippets.kpiTrendText(storeName, 4);
                dataNotes += '\n\n--- Store Data Snapshot ---\n' + kpiText;
                var allActions = [];
                try { allActions = await idbGetAll('actions'); } catch(e) {}
                var storeActions = allActions.filter(function(a) { return (a.Store || '').toLowerCase() === storeName.toLowerCase(); });
                var openActions = storeActions.filter(function(a) { return !(a.Status || '').toLowerCase().includes('closed'); });
                var criticalActions = openActions.filter(function(a) { return (a.Critical || '').toLowerCase() === 'yes'; });
                dataNotes += '\nAudit: ' + openActions.length + ' open actions' + (criticalActions.length ? ', ' + criticalActions.length + ' critical' : '');
            } catch(e) {}
        }

        await Projects.addStage(project.id, 'Review ' + label + ' report', 'Review the ' + folder + ' report and gather any additional evidence or witness statements.' + dataNotes, [], '');
        await Projects.addStage(project.id, 'Findings & root cause', 'Document investigation findings, root cause and contributing factors.', [], '');
        await Projects.addStage(project.id, 'Corrective actions & sign off', 'Record corrective actions, preventive measures and sign off.', [], '');
        await Projects._save(project);
        showToast('Project created — opening...', 'success');
        Projects.renderProjectDetail(project.id);
    };

    /* ─── Backend toggle ──────────────────────────────────────── */
    window._toggleView = function(type, currentView) {
        _backendViews[type] = !_backendViews[type];
        if (currentView === 'shop-incident') window.renderShopIncident();
        else if (currentView === 'shop-complaint') window.renderShopComplaint();
        else if (currentView === 'shop-uniform') window.renderShopUniform();
    };

    /* ─── Store Trends View ────────────────────────────────────── */
    window.renderStoreTrends = async function() {
        _init();
        var mv = document.getElementById('mainView');
        if (!mv) return;
        var storeName = _storeName || _shopStoreId;
        if (!_shopStoreId) { mv.innerHTML = '<div class="card p-8 text-center"><p class="text-slate-400">No store associated with your account.</p></div>'; return; }

        var raw = await idbGetAll('kpi');
        /* Filter to this store only */
        var storeKpis = raw.filter(function(k) {
            var cid = typeof canonicalStoreId === 'function' ? canonicalStoreId(k.Branch || k.BranchId || '') : (k.Branch || k.BranchId || '');
            return cid === _shopStoreId || (k.Branch || '').toLowerCase() === storeName.toLowerCase();
        }).sort(function(a, b) { return ((a.Week || 0) - (b.Week || 0)); });

        if (!storeKpis.length) {
            mv.innerHTML = '<div style="max-width:800px;margin:0 auto;padding:8px;">'
                + '<h2 class="text-2xl font-black text-slate-800 mb-2">My Trends</h2>'
                + '<div class="card p-8 text-center"><p class="text-slate-400">No KPI data found for your store yet.</p></div></div>';
            return;
        }

        var latest = storeKpis[storeKpis.length - 1];
        var html = '<div style="max-width:800px;margin:0 auto;padding:8px;">'
            + '<div class="mb-4">'
            + '<button onclick="setView(\'shop-home\')" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;padding:4px 0;">&larr; Back to Home</button>'
            + '<h2 class="text-2xl font-black text-slate-800 mt-1">' + _esc(storeName) + ' Trends</h2>'
            + '<p class="text-sm text-slate-400">' + storeKpis.length + ' weeks of data</p></div>';

        /* KPI Cards */
        var metrics = [
            { key: 'Sales', label: 'Sales', color: '#6E8E6D', good: 95 },
            { key: 'Product', label: 'Product', color: '#3B82F6', good: 95 },
            { key: 'Waste', label: 'Waste', color: '#DC2626', good: 3, lower: true },
            { key: 'Labour', label: 'Labour', color: '#D97706', good: 12, lower: true },
            { key: 'Energy', label: 'Energy', color: '#7C3AED', good: 5, lower: true }
        ];

        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:16px;">';
        metrics.forEach(function(m) {
            var val = latest[m.key] || 0;
            var displayVal = m.key === 'Energy' ? (val * 100).toFixed(1) + '%' : (val * 100).toFixed(1) + '%';
            var isGood = m.lower ? val <= m.good / 100 : val >= m.good / 100;
            html += '<div class="card p-4 text-center" style="border-top:3px solid ' + m.color + ';">'
                + '<p class="text-xs font-bold text-slate-400 uppercase">' + m.label + '</p>'
                + '<p class="text-2xl font-black" style="color:' + (isGood ? '#059669' : '#DC2626') + ';">' + displayVal + '</p>'
                + '<p class="text-[10px] text-slate-400">Week ' + latest.Week + '</p></div>';
        });
        html += '</div>';

        /* Simple trend table */
        html += '<div class="card p-4"><h3 class="text-sm font-black text-slate-600 mb-3">Weekly Trend</h3>'
            + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;">'
            + '<thead><tr style="border-bottom:2px solid #E2E8F0;">'
            + '<th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:800;color:#64748B;">Week</th>';
        metrics.forEach(function(m) {
            html += '<th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:800;color:#64748B;">' + m.label + '</th>';
        });
        html += '</tr></thead><tbody>';
        storeKpis.slice(-12).forEach(function(k) {
            html += '<tr style="border-bottom:1px solid #F1F5F9;">'
                + '<td style="padding:6px 8px;font-weight:700;">W' + k.Week + '</td>';
            metrics.forEach(function(m) {
                var val = k[m.key] || 0;
                var display = (val * 100).toFixed(1) + '%';
                var isGood = m.lower ? val <= m.good / 100 : val >= m.good / 100;
                html += '<td style="padding:6px 8px;text-align:right;color:' + (isGood ? '#059669' : '#DC2626') + ';font-weight:700;">' + display + '</td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table></div></div></div>';
        mv.innerHTML = html;
    };

    /* ─── Store Scorecard View ─────────────────────────────────── */
    window.renderStoreScorecard = async function() {
        _init();
        var mv = document.getElementById('mainView');
        if (!mv) return;
        var storeName = _storeName || _shopStoreId;
        if (!_shopStoreId) { mv.innerHTML = '<div class="card p-8 text-center"><p class="text-slate-400">No store associated with your account.</p></div>'; return; }

        var raw = await idbGetAll('kpi');
        var storeKpis = raw.filter(function(k) {
            var cid = typeof canonicalStoreId === 'function' ? canonicalStoreId(k.Branch || k.BranchId || '') : (k.Branch || k.BranchId || '');
            return cid === _shopStoreId || (k.Branch || '').toLowerCase() === storeName.toLowerCase();
        }).sort(function(a, b) { return ((b.Week || 0) - (a.Week || 0)); });

        if (!storeKpis.length) {
            mv.innerHTML = '<div style="max-width:800px;margin:0 auto;padding:8px;">'
                + '<h2 class="text-2xl font-black text-slate-800 mb-2">My Scorecard</h2>'
                + '<div class="card p-8 text-center"><p class="text-slate-400">No KPI data found for your store yet.</p></div></div>';
            return;
        }

        var latest = storeKpis[0];
        var prev = storeKpis.length > 1 ? storeKpis[1] : null;

        var html = '<div style="max-width:800px;margin:0 auto;padding:8px;">'
            + '<div class="mb-4">'
            + '<button onclick="setView(\'shop-home\')" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;padding:4px 0;">&larr; Back to Home</button>'
            + '<h2 class="text-2xl font-black text-slate-800 mt-1">' + _esc(storeName) + ' Scorecard</h2>'
            + '<p class="text-sm text-slate-400">Week ' + latest.Week + ', ' + latest.Year + '</p></div>';

        var metrics = [
            { key: 'Sales', label: 'Sales', color: '#6E8E6D', good: 95, icon: '\uD83D\uDCC8' },
            { key: 'Product', label: 'Product', color: '#3B82F6', good: 95, icon: '\uD83C\uDF7D\uFE0F' },
            { key: 'Waste', label: 'Waste', color: '#DC2626', good: 3, lower: true, icon: '\uD83D\uDDD1\uFE0F' },
            { key: 'Labour', label: 'Labour', color: '#D97706', good: 12, lower: true, icon: '\uD83D\uDC64' },
            { key: 'Energy', label: 'Energy', color: '#7C3AED', good: 5, lower: true, icon: '\u26A1' },
            { key: 'ATV', label: 'ATV', color: '#059669', good: 8, lower: true, icon: '\uD83D\uDCB3' }
        ];

        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px;">';
        metrics.forEach(function(m) {
            var val = latest[m.key] || 0;
            var prevVal = prev ? (prev[m.key] || 0) : null;
            var displayVal = (val * 100).toFixed(1) + '%';
            var isGood = m.lower ? val <= m.good / 100 : val >= m.good / 100;
            var change = '';
            if (prevVal !== null) {
                var diff = ((val - prevVal) * 100).toFixed(1);
                if (diff > 0) change = '<span style="color:#059669;">+' + diff + '%</span>';
                else if (diff < 0) change = '<span style="color:#DC2626;">' + diff + '%</span>';
                else change = '<span style="color:#94A3B8;">0%</span>';
            }
            html += '<div class="card p-4" style="border-left:4px solid ' + m.color + ';">'
                + '<div class="flex items-center justify-between mb-1">'
                + '<span class="text-xs font-bold text-slate-400">' + m.icon + ' ' + m.label + '</span>'
                + '<span class="text-xs">' + change + '</span></div>'
                + '<p class="text-2xl font-black" style="color:' + (isGood ? '#059669' : '#DC2626') + ';">' + displayVal + '</p>'
                + '<div style="height:4px;background:#F1F5F9;border-radius:2px;margin-top:6px;">'
                + '<div style="height:100%;width:' + Math.min(100, val * 100) + '%;background:' + (isGood ? '#059669' : '#DC2626') + ';border-radius:2px;"></div></div></div>';
        });
        html += '</div>';

        /* Audit score if available */
        var audits = await idbGetAll('audits');
        var storeAudit = audits.find(function(a) { return a.Store === storeName || a.BranchId === _shopStoreId; });
        if (storeAudit && storeAudit.Score) {
            html += '<div class="card p-4 mb-4" style="border-left:4px solid #6E8E6D;">'
                + '<div class="flex items-center justify-between">'
                + '<div><p class="text-xs font-bold text-slate-400">Latest Audit Score</p>'
                + '<p class="text-3xl font-black" style="color:' + (storeAudit.Score >= 80 ? '#059669' : storeAudit.Score >= 60 ? '#D97706' : '#DC2626') + ';">' + storeAudit.Score + '%</p></div>'
                + '<div class="text-right"><p class="text-xs text-slate-400">Week ' + (storeAudit.Week || '?') + '</p>'
                + '<p class="text-xs text-slate-400">' + (storeAudit.Auditor || '') + '</p></div></div></div>';
        }

        /* Share button */
        html += '<div class="mt-4 text-center">'
            + '<button onclick="shareScorecard(\'' + _esc(storeName).replace(/'/g, "\\'") + '\')" style="background:#fff;color:#6E8E6D;font-size:12px;font-weight:700;padding:8px 20px;border-radius:8px;border:1px solid #6E8E6D;cursor:pointer;">📋 Copy Report to Clipboard</button>'
            + '</div>';

        html += '</div>';
        mv.innerHTML = html;
    };

    return {
        _restrictShopUser: _restrictShopUser,
        renderShopHome: window.renderShopHome,
        renderShopMessages: window.renderShopMessages,
        renderShopIncident: window.renderShopIncident,
        renderShopComplaint: window.renderShopComplaint,
        renderShopUniform: window.renderShopUniform,
        renderStoreTrends: window.renderStoreTrends,
        renderStoreScorecard: window.renderStoreScorecard,
        _saveIncident: window._saveIncident,
        _saveComplaint: window._saveComplaint,
        _saveUniform: window._saveUniform,
        _viewReport: window._viewReport,
        _exportReportPDF: window._exportReportPDF,
        _investigate: window._investigate,
        _toggleView: window._toggleView,
        _updateOrderStatus: window._updateOrderStatus,
        _saveStockFromUI: window._saveStockFromUI,
        _toggleTestMode: window._toggleTestMode,
        _deleteAllTest: window._deleteAllTest,
        _completeTask: window._completeTask
    };
})();
