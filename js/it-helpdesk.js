/* ─── IT Helpdesk Module ────────────────────────────────────────── */
/* Store ticket submission + IT team dashboard.                       */
/* Stores raise tickets; IT team (Sam, Glen, Mirel) manages them.    */
/* Data: IDB 'it_tickets' + SharePoint 'IT Helpdesk/Tickets/'.       */
/* ================================================================== */
window.ITHelpdesk = (function() {
    'use strict';

    var _tickets = [];
    var _loaded = false;

    var STATUSES = {
        received:    { label: 'Ticket Received', color: '#3B82F6', bg: '#EFF6FF', icon: '\uD83D\uDCE6' },
        processing:  { label: 'Being Processed', color: '#D97706', bg: '#FEF3C7', icon: '\u2699\uFE0F' },
        resolved:    { label: 'Resolved', color: '#059669', bg: '#ECFDF5', icon: '\u2705' },
        rejected:    { label: 'Closed', color: '#6B7280', bg: '#F3F4F6', icon: '\u274C' }
    };

    var CATEGORIES = [
        'Hardware Issue', 'Software Issue', 'Network / Wi-Fi', 'Printer',
        'EPOS / Till', 'Email / Outlook', 'Password Reset', 'New Equipment',
        'Other'
    ];

    var IT_TEAM_EMAILS = [
        'sam.', 'glen.', 'mirel.'
    ];

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _uid() { return 'ITH-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
    function _now() { return new Date().toISOString(); }
    function _today() { return new Date().toISOString().slice(0, 10); }
    function _ts() { return new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }

    function _isITTeam() {
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        if (!user) return false;
        var email = (user.email || '').toLowerCase();
        var name = (user.name || '').toLowerCase();
        return IT_TEAM_EMAILS.some(function(p) { return email.indexOf(p) >= 0 || name.indexOf(p) >= 0; })
            || (typeof Users !== 'undefined' && Users.isAdmin && Users.isAdmin());
    }

    function _getStoreInfo() {
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var storeId = '';
        var storeName = '';
        if (user) {
            storeId = user.shopStoreId || '';
            if (!storeId && user.email && typeof originalStoreNames !== 'undefined') {
                var username = (user.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
                originalStoreNames.forEach(function(name, id) {
                    if (id === username || id.indexOf(username) >= 0 || username.indexOf(id) >= 0) storeId = id;
                });
            }
            if (storeId && typeof originalStoreNames !== 'undefined') {
                storeName = originalStoreNames.get(storeId) || storeId;
            }
        }
        return { id: storeId, name: storeName || storeId, email: user ? user.email : '' };
    }

    /* ─── Data ──────────────────────────────────────────────────── */
    async function _loadTickets() {
        _tickets = [];
        try {
            var all = await idbGetAll('it_tickets');
            _tickets = all || [];
        } catch(e) { _tickets = []; }
        /* Try SharePoint */
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try {
                var files = await GraphClient.listJsonFiles('IT Helpdesk/Tickets');
                for (var i = 0; i < files.length; i++) {
                    try {
                        var text = await GraphClient.readFile('IT Helpdesk/Tickets/' + files[i].name);
                        if (text) {
                            var ticket = JSON.parse(text);
                            var exists = _tickets.find(function(t) { return t.id === ticket.id; });
                            if (!exists) _tickets.push(ticket);
                        }
                    } catch(e) {}
                }
            } catch(e) {}
        }
        _tickets.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        _loaded = true;
    }

    async function _saveTicket(ticket) {
        await idbPut('it_tickets', ticket);
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try {
                await GraphClient.writeFile('IT Helpdesk/Tickets/' + ticket.id + '.json', JSON.stringify(ticket, null, 2));
            } catch(e) { console.warn('[IT Helpdesk] SharePoint save failed:', e.message); }
        }
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /*  STORE-FACING VIEWS                                           */
    /* ═══════════════════════════════════════════════════════════════ */

    async function renderStoreTicketForm() {
        var mv = document.getElementById('mainView');
        if (!mv) return;
        var store = _getStoreInfo();

        var catOpts = CATEGORIES.map(function(c) { return '<option value="' + _esc(c) + '">' + _esc(c) + '</option>'; }).join('');

        var html = '<div style="max-width:700px;margin:0 auto;padding:8px;">'
            + '<div class="mb-4">'
            + '<button onclick="setView(\'shop-home\')" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;padding:4px 0;">&larr; Back to Home</button>'
            + '<h2 class="text-2xl font-black text-slate-800 mt-2">IT Helpdesk</h2>'
            + '<p class="text-sm text-slate-400">Raise a support ticket with the IT team</p></div>'
            + '<div class="card p-6" style="border-top:3px solid #6E8E6D;">'
            + '<form id="itTicketForm" onsubmit="return false;">'
            + '<div class="mb-4">'
            + '<label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:4px;">Category</label>'
            + '<select id="ithCategory" style="width:100%;padding:10px;border:1px solid #E2E8F0;border-radius:8px;font-size:14px;">'
            + '<option value="">Select a category...</option>' + catOpts + '</select></div>'
            + '<div class="mb-4">'
            + '<label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:4px;">Subject</label>'
            + '<input id="ithSubject" type="text" placeholder="Brief description of the issue" style="width:100%;padding:10px;border:1px solid #E2E8F0;border-radius:8px;font-size:14px;" maxlength="120"></div>'
            + '<div class="mb-4">'
            + '<label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:4px;">Description</label>'
            + '<textarea id="ithDescription" rows="5" placeholder="Describe the issue in detail — what happened, when it started, any error messages..." style="width:100%;padding:10px;border:1px solid #E2E8F0;border-radius:8px;font-size:14px;resize:vertical;"></textarea></div>'
            + '<div class="mb-4">'
            + '<label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:4px;">Priority</label>'
            + '<div style="display:flex;gap:8px;">'
            + '<label style="flex:1;text-align:center;padding:10px;border:2px solid #E2E8F0;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;" class="ith-priority" data-val="low">'
            + '<input type="radio" name="ithPriority" value="low" style="display:none;">Low</label>'
            + '<label style="flex:1;text-align:center;padding:10px;border:2px solid #E2E8F0;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;" class="ith-priority" data-val="medium">'
            + '<input type="radio" name="ithPriority" value="medium" style="display:none;" checked>Medium</label>'
            + '<label style="flex:1;text-align:center;padding:10px;border:2px solid #E2E8F0;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;" class="ith-priority" data-val="high">'
            + '<input type="radio" name="ithPriority" value="high" style="display:none;">High</label>'
            + '<label style="flex:1;text-align:center;padding:10px;border:2px solid #E2E8F0;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:#DC2626;" class="ith-priority" data-val="urgent">'
            + '<input type="radio" name="ithPriority" value="urgent" style="display:none;">Urgent</label>'
            + '</div></div>'
            + '<button id="ithSubmitBtn" onclick="ITHelpdesk._submitTicket()" style="width:100%;padding:12px;background:#6E8E6D;color:#fff;font-size:14px;font-weight:700;border:none;border-radius:8px;cursor:pointer;">Submit Ticket</button>'
            + '</form></div></div>';

        mv.innerHTML = html;

        /* Priority card toggle */
        document.querySelectorAll('.ith-priority').forEach(function(el) {
            el.addEventListener('click', function() {
                document.querySelectorAll('.ith-priority').forEach(function(p) {
                    p.style.borderColor = '#E2E8F0';
                    p.style.background = 'transparent';
                });
                var val = el.getAttribute('data-val');
                el.querySelector('input').checked = true;
                var color = val === 'urgent' ? '#FEE2E2' : val === 'high' ? '#FEF3C7' : '#F0FDF4';
                el.style.borderColor = val === 'urgent' ? '#DC2626' : val === 'high' ? '#D97706' : '#6E8E6D';
                el.style.background = color;
            });
        });
        /* Set default */
        var medBtn = document.querySelector('.ith-priority[data-val="medium"]');
        if (medBtn) { medBtn.style.borderColor = '#6E8E6D'; medBtn.style.background = '#F0FDF4'; }
    }

    async function _submitTicket() {
        var category = document.getElementById('ithCategory').value;
        var subject = document.getElementById('ithSubject').value.trim();
        var description = document.getElementById('ithDescription').value.trim();
        var priority = (document.querySelector('input[name="ithPriority"]:checked') || {}).value || 'medium';
        var store = _getStoreInfo();

        if (!category) { alert('Please select a category.'); return; }
        if (!subject) { alert('Please enter a subject.'); return; }
        if (!description) { alert('Please describe the issue.'); return; }

        var ticket = {
            id: _uid(),
            storeId: store.id,
            storeName: store.name,
            storeEmail: store.email,
            category: category,
            subject: subject,
            description: description,
            priority: priority,
            status: 'received',
            createdAt: _now(),
            updatedAt: _now(),
            responses: [],
            _history: [{ status: 'received', at: _now(), by: store.name || 'Store', note: 'Ticket submitted' }]
        };

        var btn = document.getElementById('ithSubmitBtn');
        btn.textContent = 'Submitting...';
        btn.disabled = true;

        await _saveTicket(ticket);

        btn.textContent = 'Ticket Submitted!';
        btn.style.background = '#059669';
        setTimeout(function() { setView('shop-ith-list'); }, 1000);
    }

    async function renderStoreTicketList() {
        var mv = document.getElementById('mainView');
        if (!mv) return;
        var store = _getStoreInfo();
        await _loadTickets();

        var myTickets = _tickets.filter(function(t) { return t.storeId === store.id; });
        if (!myTickets.length) {
            mv.innerHTML = '<div style="max-width:700px;margin:0 auto;padding:8px;">'
                + '<div class="mb-4"><button onclick="setView(\'shop-home\')" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;padding:4px 0;">&larr; Back to Home</button>'
                + '<h2 class="text-2xl font-black text-slate-800 mt-2">My IT Tickets</h2></div>'
                + '<div class="card p-8 text-center"><p class="text-slate-400 mb-4">No tickets yet</p>'
                + '<button onclick="setView(\'shop-ith-new\')" style="background:#6E8E6D;color:#fff;padding:10px 24px;border-radius:8px;border:none;font-weight:700;cursor:pointer;">Raise a Ticket</button></div></div>';
            return;
        }

        var html = '<div style="max-width:700px;margin:0 auto;padding:8px;">'
            + '<div class="flex items-center justify-between mb-4">'
            + '<div><button onclick="setView(\'shop-home\')" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;padding:4px 0;">&larr; Home</button>'
            + '<h2 class="text-2xl font-black text-slate-800 mt-1">My IT Tickets</h2></div>'
            + '<button onclick="setView(\'shop-ith-new\')" style="background:#6E8E6D;color:#fff;padding:8px 16px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;">+ New Ticket</button>'
            + '</div>';

        myTickets.forEach(function(t) {
            var s = STATUSES[t.status] || STATUSES.received;
            html += '<div class="card p-4 mb-3" style="border-left:4px solid ' + s.color + ';cursor:pointer;" onclick="ITHelpdesk._viewStoreTicket(\'' + t.id + '\')">'
                + '<div class="flex items-center justify-between">'
                + '<div><p class="text-sm font-bold text-slate-800">' + _esc(t.subject) + '</p>'
                + '<p class="text-xs text-slate-400">' + _esc(t.category) + ' &middot; ' + _esc(t.createdAt.slice(0, 10)) + '</p></div>'
                + '<span style="background:' + s.bg + ';color:' + s.color + ';font-size:10px;font-weight:700;padding:4px 10px;border-radius:9999px;white-space:nowrap;">' + s.icon + ' ' + s.label + '</span>'
                + '</div></div>';
        });

        html += '</div>';
        mv.innerHTML = html;
    }

    async function renderStoreTicketDetail(ticketId) {
        var mv = document.getElementById('mainView');
        if (!mv) return;
        await _loadTickets();
        var t = _tickets.find(function(x) { return x.id === ticketId; });
        if (!t) { setView('shop-ith-list'); return; }

        var s = STATUSES[t.status] || STATUSES.received;
        var html = '<div style="max-width:700px;margin:0 auto;padding:8px;">'
            + '<button onclick="setView(\'shop-ith-list\')" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;padding:4px 0;">&larr; My Tickets</button>'
            + '<div class="card p-6 mt-2" style="border-top:3px solid ' + s.color + ';">'
            + '<div class="flex items-center justify-between mb-4">'
            + '<h2 class="text-lg font-black text-slate-800">' + _esc(t.subject) + '</h2>'
            + '<span style="background:' + s.bg + ';color:' + s.color + ';font-size:11px;font-weight:700;padding:4px 12px;border-radius:9999px;">' + s.icon + ' ' + s.label + '</span></div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;font-size:12px;">'
            + '<div><span style="color:#94A3B8;">Category</span><p class="font-bold text-slate-700">' + _esc(t.category) + '</p></div>'
            + '<div><span style="color:#94A3B8;">Priority</span><p class="font-bold text-slate-700" style="color:' + (t.priority === 'urgent' ? '#DC2626' : t.priority === 'high' ? '#D97706' : '#475569') + ';">' + _esc(t.priority.charAt(0).toUpperCase() + t.priority.slice(1)) + '</p></div>'
            + '<div><span style="color:#94A3B8;">Raised</span><p class="font-bold text-slate-700">' + _esc(t.createdAt.slice(0, 10)) + '</p></div>'
            + '<div><span style="color:#94A3B8;">Ticket ID</span><p class="font-bold text-slate-500" style="font-family:monospace;">' + _esc(t.id) + '</p></div>'
            + '</div>'
            + '<div style="margin-bottom:16px;"><span style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em;">Description</span>'
            + '<p class="text-sm text-slate-600 mt-1" style="white-space:pre-wrap;">' + _esc(t.description) + '</p></div>';

        /* Responses / updates */
        if (t.responses && t.responses.length > 0) {
            html += '<div style="margin-top:16px;border-top:1px solid #E2E8F0;padding-top:12px;">'
                + '<span style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em;">Updates from IT</span>';
            t.responses.forEach(function(r) {
                html += '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px;margin-top:8px;">'
                    + '<p class="text-xs text-slate-400">' + _esc(r.from || 'IT Team') + ' &middot; ' + _esc(r.at ? new Date(r.at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '') + '</p>'
                    + '<p class="text-sm text-slate-700 mt-1">' + _esc(r.note) + '</p></div>';
            });
            html += '</div>';
        }

        /* History */
        if (t._history && t._history.length > 0) {
            html += '<div style="margin-top:16px;border-top:1px solid #E2E8F0;padding-top:12px;">'
                + '<span style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em;">Timeline</span>';
            t._history.forEach(function(h) {
                var hs = STATUSES[h.status] || STATUSES.received;
                html += '<div style="display:flex;gap:8px;align-items:flex-start;margin-top:8px;">'
                    + '<div style="width:8px;height:8px;border-radius:50%;background:' + hs.color + ';margin-top:5px;min-width:8px;"></div>'
                    + '<div><p class="text-xs font-bold text-slate-600">' + hs.label + '</p>'
                    + '<p class="text-xs text-slate-400">' + _esc(h.at ? new Date(h.at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '') + ' by ' + _esc(h.by || '') + '</p>'
                    + (h.note ? '<p class="text-xs text-slate-500 mt-1">' + _esc(h.note) + '</p>' : '')
                    + '</div></div>';
            });
            html += '</div>';
        }

        html += '</div></div>';
        mv.innerHTML = html;
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /*  IT TEAM DASHBOARD                                           */
    /* ═══════════════════════════════════════════════════════════════ */

    async function renderITDashboard(filter) {
        var mv = document.getElementById('mainView');
        if (!mv) return;
        await _loadTickets();

        filter = filter || 'open';
        var filtered = _tickets.filter(function(t) {
            if (filter === 'open') return t.status === 'received' || t.status === 'processing';
            if (filter === 'resolved') return t.status === 'resolved' || t.status === 'rejected';
            return true;
        });

        var openCount = _tickets.filter(function(t) { return t.status === 'received'; }).length;
        var processingCount = _tickets.filter(function(t) { return t.status === 'processing'; }).length;
        var resolvedCount = _tickets.filter(function(t) { return t.status === 'resolved' || t.status === 'rejected'; }).length;

        var html = '<div style="max-width:1100px;margin:0 auto;padding:8px;">'
            + '<div class="mb-4">'
            + '<h2 class="text-2xl font-black text-slate-800">IT Helpdesk</h2>'
            + '<p class="text-sm text-slate-400">' + _tickets.length + ' total tickets</p></div>'
            /* Stats row */
            + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">'
            + '<div class="card p-4 text-center" style="border-top:3px solid #3B82F6;cursor:pointer;" onclick="ITHelpdesk.renderITDashboard(\'open\')">'
            + '<p class="text-3xl font-black" style="color:#3B82F6;">' + openCount + '</p>'
            + '<p class="text-xs font-bold text-slate-400">New / Open</p></div>'
            + '<div class="card p-4 text-center" style="border-top:3px solid #D97706;cursor:pointer;" onclick="ITHelpdesk.renderITDashboard(\'processing\')">'
            + '<p class="text-3xl font-black" style="color:#D97706;">' + processingCount + '</p>'
            + '<p class="text-xs font-bold text-slate-400">Processing</p></div>'
            + '<div class="card p-4 text-center" style="border-top:3px solid #059669;cursor:pointer;" onclick="ITHelpdesk.renderITDashboard(\'resolved\')">'
            + '<p class="text-3xl font-black" style="color:#059669;">' + resolvedCount + '</p>'
            + '<p class="text-xs font-bold text-slate-400">Resolved</p></div>'
            + '</div>'
            /* Filter tabs */
            + '<div style="display:flex;gap:8px;margin-bottom:16px;">'
            + '<button onclick="ITHelpdesk.renderITDashboard(\'all\')" style="padding:6px 14px;border-radius:6px;border:1px solid ' + (filter === 'all' ? '#6E8E6D' : '#E2E8F0') + ';background:' + (filter === 'all' ? '#6E8E6D' : 'white') + ';color:' + (filter === 'all' ? 'white' : '#64748B') + ';font-size:11px;font-weight:700;cursor:pointer;">All</button>'
            + '<button onclick="ITHelpdesk.renderITDashboard(\'open\')" style="padding:6px 14px;border-radius:6px;border:1px solid ' + (filter === 'open' ? '#3B82F6' : '#E2E8F0') + ';background:' + (filter === 'open' ? '#3B82F6' : 'white') + ';color:' + (filter === 'open' ? 'white' : '#64748B') + ';font-size:11px;font-weight:700;cursor:pointer;">Open</button>'
            + '<button onclick="ITHelpdesk.renderITDashboard(\'processing\')" style="padding:6px 14px;border-radius:6px;border:1px solid ' + (filter === 'processing' ? '#D97706' : '#E2E8F0') + ';background:' + (filter === 'processing' ? '#D97706' : 'white') + ';color:' + (filter === 'processing' ? 'white' : '#64748B') + ';font-size:11px;font-weight:700;cursor:pointer;">Processing</button>'
            + '<button onclick="ITHelpdesk.renderITDashboard(\'resolved\')" style="padding:6px 14px;border-radius:6px;border:1px solid ' + (filter === 'resolved' ? '#059669' : '#E2E8F0') + ';background:' + (filter === 'resolved' ? '#059669' : 'white') + ';color:' + (filter === 'resolved' ? 'white' : '#64748B') + ';font-size:11px;font-weight:700;cursor:pointer;">Resolved</button>'
            + '</div>';

        if (!filtered.length) {
            html += '<div class="card p-8 text-center"><p class="text-slate-400">No tickets in this category</p></div>';
        } else {
            filtered.forEach(function(t) {
                var st = STATUSES[t.status] || STATUSES.received;
                var priColor = t.priority === 'urgent' ? '#DC2626' : t.priority === 'high' ? '#D97706' : t.priority === 'medium' ? '#6E8E6D' : '#94A3B8';
                html += '<div class="card p-4 mb-3" style="cursor:pointer;border-left:4px solid ' + st.color + ';" onclick="ITHelpdesk._viewITTicket(\'' + t.id + '\')">'
                    + '<div class="flex items-center justify-between flex-wrap gap-2">'
                    + '<div style="min-width:0;">'
                    + '<div class="flex items-center gap-2 flex-wrap">'
                    + '<p class="text-sm font-bold text-slate-800">' + _esc(t.subject) + '</p>'
                    + '<span style="background:' + priColor + '22;color:' + priColor + ';font-size:9px;font-weight:700;padding:2px 8px;border-radius:9999px;text-transform:uppercase;">' + _esc(t.priority) + '</span>'
                    + '</div>'
                    + '<p class="text-xs text-slate-400 mt-1">' + _esc(t.storeName) + ' &middot; ' + _esc(t.category) + ' &middot; ' + _esc((t.createdAt || '').slice(0, 10)) + '</p></div>'
                    + '<span style="background:' + st.bg + ';color:' + st.color + ';font-size:10px;font-weight:700;padding:4px 10px;border-radius:9999px;white-space:nowrap;">' + st.label + '</span>'
                    + '</div></div>';
            });
        }

        html += '</div>';
        mv.innerHTML = html;
    }

    async function renderITTicketDetail(ticketId) {
        var mv = document.getElementById('mainView');
        if (!mv) return;
        await _loadTickets();
        var t = _tickets.find(function(x) { return x.id === ticketId; });
        if (!t) { setView('ith-dashboard'); return; }

        var s = STATUSES[t.status] || STATUSES.received;
        var priColor = t.priority === 'urgent' ? '#DC2626' : t.priority === 'high' ? '#D97706' : '#6E8E6D';

        var html = '<div style="max-width:800px;margin:0 auto;padding:8px;">'
            + '<button onclick="setView(\'ith-dashboard\')" style="background:transparent;color:#6E8E6D;font-size:12px;font-weight:700;border:none;cursor:pointer;padding:4px 0;">&larr; Dashboard</button>'
            + '<div class="card p-6 mt-2" style="border-top:3px solid ' + s.color + ';">'
            + '<div class="flex items-center justify-between mb-4 flex-wrap gap-2">'
            + '<div>'
            + '<p class="text-xs text-slate-400" style="font-family:monospace;">' + _esc(t.id) + '</p>'
            + '<h2 class="text-lg font-black text-slate-800">' + _esc(t.subject) + '</h2></div>'
            + '<div style="display:flex;gap:6px;align-items:center;">'
            + '<span style="background:' + priColor + '22;color:' + priColor + ';font-size:10px;font-weight:700;padding:3px 10px;border-radius:9999px;text-transform:uppercase;">' + _esc(t.priority) + '</span>'
            + '<span style="background:' + s.bg + ';color:' + s.color + ';font-size:10px;font-weight:700;padding:4px 12px;border-radius:9999px;">' + s.icon + ' ' + s.label + '</span>'
            + '</div></div>'
            /* Store info */
            + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;font-size:12px;background:#F8FAFC;padding:12px;border-radius:8px;">'
            + '<div><span style="color:#94A3B8;">Store</span><p class="font-bold text-slate-700">' + _esc(t.storeName) + '</p></div>'
            + '<div><span style="color:#94A3B8;">Category</span><p class="font-bold text-slate-700">' + _esc(t.category) + '</p></div>'
            + '<div><span style="color:#94A3B8;">Raised</span><p class="font-bold text-slate-700">' + _esc(t.createdAt ? new Date(t.createdAt).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '') + '</p></div>'
            + '</div>'
            /* Description */
            + '<div style="margin-bottom:16px;"><span style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;">Description</span>'
            + '<p class="text-sm text-slate-600 mt-1" style="white-space:pre-wrap;background:#F8FAFC;padding:12px;border-radius:8px;">' + _esc(t.description) + '</p></div>';

        /* IT Response box */
        html += '<div style="margin-top:16px;border-top:1px solid #E2E8F0;padding-top:12px;">'
            + '<span style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em;">Add Response / Update</span>'
            + '<textarea id="ithResponseNote" rows="3" placeholder="Type a response or update for the store..." style="width:100%;padding:10px;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;margin-top:8px;resize:vertical;"></textarea>'
            + '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">';

        if (t.status === 'received') {
            html += '<button onclick="ITHelpdesk._updateStatus(\'' + t.id + '\',\'processing\')" style="padding:8px 16px;background:#D97706;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Accept & Process</button>';
        }
        if (t.status === 'processing') {
            html += '<button onclick="ITHelpdesk._updateStatus(\'' + t.id + '\',\'resolved\')" style="padding:8px 16px;background:#059669;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Mark Resolved</button>';
            html += '<button onclick="ITHelpdesk._updateStatus(\'' + t.id + '\',\'rejected\')" style="padding:8px 16px;background:#6B7280;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Close Ticket</button>';
        }
        html += '<button onclick="ITHelpdesk._addResponse(\'' + t.id + '\')" style="padding:8px 16px;background:#3B82F6;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Send Response</button>';
        html += '</div></div>';

        /* Existing responses */
        var allResponses = (t.responses || []).slice().reverse();
        if (allResponses.length > 0) {
            html += '<div style="margin-top:16px;border-top:1px solid #E2E8F0;padding-top:12px;">'
                + '<span style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;">Conversation</span>';
            allResponses.forEach(function(r) {
                var isStore = r.fromType === 'store';
                html += '<div style="background:' + (isStore ? '#F0FDF4' : '#EFF6FF') + ';border:1px solid ' + (isStore ? '#BBF7D0' : '#BFDBFE') + ';border-radius:8px;padding:10px;margin-top:8px;">'
                    + '<p class="text-xs font-bold" style="color:' + (isStore ? '#166534' : '#1E40AF') + ';">' + _esc(r.from || 'Unknown') + '</p>'
                    + '<p class="text-sm text-slate-700 mt-1">' + _esc(r.note) + '</p>'
                    + '<p class="text-xs text-slate-400 mt-1">' + _esc(r.at ? new Date(r.at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '') + '</p></div>';
            });
            html += '</div>';
        }

        /* History timeline */
        if (t._history && t._history.length > 0) {
            html += '<div style="margin-top:16px;border-top:1px solid #E2E8F0;padding-top:12px;">'
                + '<span style="font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;">Timeline</span>';
            t._history.forEach(function(h) {
                var hs = STATUSES[h.status] || STATUSES.received;
                html += '<div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;">'
                    + '<div style="width:8px;height:8px;border-radius:50%;background:' + hs.color + ';margin-top:5px;min-width:8px;"></div>'
                    + '<div><p class="text-xs text-slate-500">' + hs.label + ' &middot; ' + _esc(h.by || '') + ' &middot; ' + _esc(h.at ? new Date(h.at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '') + '</p>'
                    + (h.note ? '<p class="text-xs text-slate-400">' + _esc(h.note) + '</p>' : '')
                    + '</div></div>';
            });
            html += '</div>';
        }

        html += '</div></div>';
        mv.innerHTML = html;
    }

    /* ─── Actions ───────────────────────────────────────────────── */
    async function _updateStatus(ticketId, newStatus) {
        await _loadTickets();
        var t = _tickets.find(function(x) { return x.id === ticketId; });
        if (!t) return;
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var note = (document.getElementById('ithResponseNote') || {}).value || '';

        t.status = newStatus;
        t.updatedAt = _now();
        if (!t._history) t._history = [];
        t._history.push({ status: newStatus, at: _now(), by: user ? user.name : 'IT Team', note: note || '' });

        if (note) {
            if (!t.responses) t.responses = [];
            t.responses.push({ from: user ? user.name : 'IT Team', fromType: 'it', note: note, at: _now() });
        }

        await _saveTicket(t);
        renderITTicketDetail(ticketId);
    }

    async function _addResponse(ticketId) {
        var note = (document.getElementById('ithResponseNote') || {}).value.trim();
        if (!note) { alert('Please type a response.'); return; }
        await _loadTickets();
        var t = _tickets.find(function(x) { return x.id === ticketId; });
        if (!t) return;
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;

        if (!t.responses) t.responses = [];
        t.responses.push({ from: user ? user.name : 'IT Team', fromType: 'it', note: note, at: _now() });
        t.updatedAt = _now();
        await _saveTicket(t);
        renderITTicketDetail(ticketId);
    }

    async function _viewStoreTicket(ticketId) { window._ithDetailId = ticketId; setView('shop-ith-detail'); }
    async function _viewITTicket(ticketId) { window._ithDetailId = ticketId; setView('ith-detail'); }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        renderStoreTicketForm: renderStoreTicketForm,
        renderStoreTicketList: renderStoreTicketList,
        renderStoreTicketDetail: renderStoreTicketDetail,
        renderITDashboard: renderITDashboard,
        renderITTicketDetail: renderITTicketDetail,
        _submitTicket: _submitTicket,
        _updateStatus: _updateStatus,
        _addResponse: _addResponse,
        _viewStoreTicket: _viewStoreTicket,
        _viewITTicket: _viewITTicket,
        _isITTeam: _isITTeam,
        _loadTickets: _loadTickets,
        STATUSES: STATUSES,
        CATEGORIES: CATEGORIES
    };
})();
