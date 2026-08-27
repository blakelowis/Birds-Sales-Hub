/* ─── Messages — HQ ↔ Store Communication ──────────────────────── */
/* Phase 3: Bidirectional messaging between head office and stores.  */
/* HQ creates messages with predefined response types.              */
/* Stores see messages on their tablet and respond in-app.          */
/* Data: SharePoint JSON files + IDB cache.                         */

window.Messages = (function() {
    'use strict';

    var _messages = [];           /* All loaded messages */
    var _responses = {};          /* messageId → [responses] */
    var _loaded = false;

    var RESPONSE_TYPES = {
        acknowledge: { label: 'Acknowledgement', icon: '\u2714', desc: 'Store taps to confirm read' },
        text:        { label: 'Text Reply', icon: '\u270E', desc: 'Store types a response' },
        yesno:       { label: 'Yes / No', icon: '\u2753', desc: 'Store taps Yes or No' },
        number:      { label: 'Number', icon: '\u2316', desc: 'Store enters a number' },
        photo:       { label: 'Photo + Text', icon: '\uD83D\uDCF7', desc: 'Store uploads photo with optional text' }
    };

    var MESSAGE_TYPES = {
        broadcast:      { label: 'Announcement', color: '#3B82F6', bg: '#EFF6FF' },
        action_required:{ label: 'Action Required', color: '#DC2626', bg: '#FEF2F2' },
        acknowledge:    { label: 'Acknowledgement', color: '#7C3AED', bg: '#F5F3FF' },
        training:       { label: 'Training', color: '#059669', bg: '#ECFDF5' }
    };

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    /* ─── Data: Load all messages from SharePoint ───────────────── */
    async function load() {
        _messages = [];
        _responses = {};
        try {
            var files = await GraphClient.listJsonFiles('Messages');
            for (var i = 0; i < files.length; i++) {
                var text = await GraphClient.readFile('Messages/' + files[i].name);
                if (text) {
                    try { _messages.push(JSON.parse(text)); } catch(e) {}
                }
            }
            _messages.sort(function(a,b) { return (b.createdAt||'').localeCompare(a.createdAt||''); });
            console.log('[Messages] Loaded', _messages.length, 'messages');
        } catch(e) { console.warn('[Messages] Load failed:', e.message); }
        /* Load responses */
        try {
            var respFiles = await GraphClient.listJsonFiles('Messages/Responses');
            for (var i = 0; i < respFiles.length; i++) {
                var text = await GraphClient.readFile('Messages/Responses/' + respFiles[i].name);
                if (text) {
                    try {
                        var resp = JSON.parse(text);
                        var mid = resp.messageId;
                        if (!mid) continue;
                        if (!_responses[mid]) _responses[mid] = [];
                        _responses[mid].push(resp);
                    } catch(e) {}
                }
            }
            console.log('[Messages] Loaded responses for', Object.keys(_responses).length, 'messages');
        } catch(e) {}
        _loaded = true;
    }

    /* ─── Data: Save a message to SharePoint + IDB ─────────────── */
    async function save(msg) {
        var fileName = msg.id + '.json';
        var ok = await GraphClient.writeFile('Messages/' + fileName, JSON.stringify(msg, null, 2));
        if (ok) { await idbPut('messages', msg); }
        return ok;
    }

    /* ─── Data: Save a response to SharePoint + IDB ────────────── */
    async function saveResponse(resp) {
        var fileName = resp.id + '.json';
        var ok = await GraphClient.writeFile('Messages/Responses/' + fileName, JSON.stringify(resp, null, 2));
        if (ok) { await idbPut('message_responses', resp); }
        return ok;
    }

    /* ─── HQ: Create a new message ─────────────────────────────── */
    async function createMessage(opts) {
        var msg = {
            id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2,6),
            type: opts.type || 'broadcast',
            responseType: opts.responseType || 'acknowledge',
            title: opts.title || '',
            body: opts.body || '',
            from: opts.from || '',
            fromName: opts.fromName || '',
            targetStores: opts.targetStores || ['all'],
            responseLabel: opts.responseLabel || 'Response:',
            dueDate: opts.dueDate || '',
            attachmentUrl: opts.attachmentUrl || '',
            attachmentName: opts.attachmentName || '',
            status: 'active',
            createdAt: new Date().toISOString(),
            createdBy: opts.createdBy || ''
        };
        await save(msg);
        return msg;
    }

    /* ─── Store: Submit a response ─────────────────────────────── */
    async function respond(messageId, storeId, storeName, userId, userName, responseType, responseText, responsePhoto) {
        /* Check if already responded */
        var existing = _responses[messageId] || [];
        var already = existing.find(function(r) { return r.storeId === storeId; });
        if (already) return { ok: false, error: 'Already responded' };

        var resp = {
            id: 'resp-' + Date.now() + '-' + Math.random().toString(36).substr(2,6),
            messageId: messageId,
            storeId: storeId,
            storeName: storeName,
            respondedBy: userId,
            respondedByName: userName,
            respondedAt: new Date().toISOString(),
            responseType: responseType,
            responseText: responseText || '',
            responsePhoto: responsePhoto || null,
            status: 'submitted'
        };
        var ok = await saveResponse(resp);
        if (ok) {
            if (!_responses[messageId]) _responses[messageId] = [];
            _responses[messageId].push(resp);
        }
        return { ok: ok };
    }

    /* ─── Data: Get messages for a specific store ───────────────── */
    function getForStore(storeId) {
        return _messages.filter(function(m) {
            if (m.status !== 'active') return false;
            if (!m.targetStores || m.targetStores.indexOf('all') !== -1) return true;
            return m.targetStores.indexOf(storeId) !== -1;
        });
    }

    /* ─── Data: Get responses for a message ─────────────────────── */
    function getResponses(messageId) {
        return _responses[messageId] || [];
    }

    /* ─── Data: Check if a store has responded ──────────────────── */
    function hasStoreResponded(messageId, storeId) {
        var resps = _responses[messageId] || [];
        return resps.some(function(r) { return r.storeId === storeId; });
    }

    /* ─── Data: Count pending stores ────────────────────────────── */
    function countPending(messageId) {
        var msg = _messages.find(function(m) { return m.id === messageId; });
        if (!msg) return { total: 0, responded: 0, pending: 0 };
        var allStores = _getAllStoreNames();
        var targets = (msg.targetStores && msg.targetStores.indexOf('all') === -1) ? msg.targetStores : allStores;
        var responded = (_responses[messageId] || []).length;
        return { total: targets.length, responded: responded, pending: Math.max(0, targets.length - responded) };
    }

    function _getAllStoreNames() {
        if (typeof originalStoreNames !== 'undefined' && originalStoreNames.size > 0) {
            return Array.from(originalStoreNames.keys());
        }
        return [];
    }

    /* ─── HQ Render: Messages Dashboard ─────────────────────────── */
    function renderHQ() {
        var mv = document.getElementById('mainView');
        if (!mv) return;

        var counts = { active: 0, totalResponses: 0 };
        _messages.forEach(function(m) {
            if (m.status === 'active') counts.active++;
            var resps = _responses[m.id] || [];
            counts.totalResponses += resps.length;
        });

        var html = '<div class="card p-6" style="border-top:3px solid #3B82F6;">'
            + '<div class="flex items-center justify-between mb-6">'
            + '<div><h2 class="text-2xl font-black outfit text-slate-800">Messages</h2>'
            + '<p class="text-sm text-slate-500 mt-1">' + counts.active + ' active \u2022 ' + counts.totalResponses + ' total responses</p></div>'
            + '<button onclick="Messages.showCreate()" style="background:#3B82F6;color:#fff;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;">+ New Message</button>'
            + '</div>';

        /* Message list */
        if (_messages.length === 0) {
            html += '<div class="text-center py-12 text-slate-400"><p class="text-lg font-bold">No messages yet</p><p class="text-sm mt-2">Create your first message to get started</p></div>';
        } else {
            html += '<div class="space-y-3">';
            _messages.forEach(function(m) {
                var typeInfo = MESSAGE_TYPES[m.type] || MESSAGE_TYPES.broadcast;
                var respInfo = countPending(m.id);
                var resps = _responses[m.id] || [];
                var statusBadge = m.status === 'active'
                    ? '<span style="background:#DCFCE7;color:#166534;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;">Active</span>'
                    : '<span style="background:#F1F5F9;color:#64748B;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;">Closed</span>';

                html += '<div class="border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors" style="border-left:4px solid ' + typeInfo.color + ';">'
                    + '<div class="flex items-start justify-between">'
                    + '<div class="flex-1">'
                    + '<div class="flex items-center gap-2 mb-1">'
                    + '<span style="background:' + typeInfo.bg + ';color:' + typeInfo.color + ';font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;">' + typeInfo.label + '</span>'
                    + statusBadge
                    + '</div>'
                    + '<h3 class="font-bold text-slate-800 text-base">' + _esc(m.title) + '</h3>'
                    + '<p class="text-sm text-slate-500 mt-1">' + _esc(m.body).substring(0, 120) + (m.body.length > 120 ? '...' : '') + '</p>'
                    + '<div class="flex items-center gap-4 mt-2 text-xs text-slate-400">'
                    + '<span>From: ' + _esc(m.fromName || m.from) + '</span>'
                    + '<span>Responses: ' + resps.length + '</span>'
                    + (m.dueDate ? '<span>Due: ' + _esc(m.dueDate) + '</span>' : '')
                    + '<span>' + new Date(m.createdAt).toLocaleDateString('en-GB') + '</span>'
                    + '</div>'
                    + '</div>'
                    + '<div class="flex gap-2 ml-4">'
                    + '<button onclick="Messages.viewResponses(\'' + m.id + '\')" style="background:#F1F5F9;color:#475569;font-size:11px;font-weight:700;padding:6px 12px;border-radius:6px;border:none;cursor:pointer;">View Responses</button>'
                    + (m.status === 'active' ? '<button onclick="Messages.closeMessage(\'' + m.id + '\')" style="background:#FEF2F2;color:#DC2626;font-size:11px;font-weight:700;padding:6px 12px;border-radius:6px;border:none;cursor:pointer;">Close</button>' : '')
                    + '</div>'
                    + '</div>'
                    + '</div>';
            });
            html += '</div>';
        }

        html += '<div id="messagesCreateArea"></div>'
            + '<div id="messagesResponseArea"></div>'
            + '</div>';
        mv.innerHTML = html;
    }

    /* ─── HQ Render: Create Message Form ────────────────────────── */
    function showCreate() {
        var area = document.getElementById('messagesCreateArea');
        if (!area) return;
        var today = new Date().toISOString().slice(0,10);

        area.innerHTML = '<div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="Messages.closeCreate(event)">'
            + '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">'
            + '<div class="p-6 border-b border-slate-100">'
            + '<h3 class="text-xl font-black outfit text-slate-800">New Message</h3>'
            + '</div>'
            + '<div class="p-6 space-y-4">'

            /* Message type */
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Message Type</label>'
            + '<div class="grid grid-cols-2 gap-2" id="msgTypeGrid">'
            + '<label class="border-2 border-slate-200 rounded-lg p-3 cursor-pointer hover:border-blue-400 transition-colors has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">'
            + '<input type="radio" name="msgType" value="broadcast" checked class="hidden"><span class="text-sm font-bold text-slate-700">\uD83D\uDCE2 Announcement</span></label>'
            + '<label class="border-2 border-slate-200 rounded-lg p-3 cursor-pointer hover:border-red-400 transition-colors has-[:checked]:border-red-500 has-[:checked]:bg-red-50">'
            + '<input type="radio" name="msgType" value="action_required" class="hidden"><span class="text-sm font-bold text-slate-700">\u26A1 Action Required</span></label>'
            + '<label class="border-2 border-slate-200 rounded-lg p-3 cursor-pointer hover:border-purple-400 transition-colors has-[:checked]:border-purple-500 has-[:checked]:bg-purple-50">'
            + '<input type="radio" name="msgType" value="acknowledge" class="hidden"><span class="text-sm font-bold text-slate-700">\u2714 Acknowledgement</span></label>'
            + '<label class="border-2 border-slate-200 rounded-lg p-3 cursor-pointer hover:border-green-400 transition-colors has-[:checked]:border-green-500 has-[:checked]:bg-green-50">'
            + '<input type="radio" name="msgType" value="training" class="hidden"><span class="text-sm font-bold text-slate-700">\uD83C\uDF93 Training</span></label>'
            + '</div></div>'

            /* Response type */
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Store Response</label>'
            + '<select id="msgResponseType" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none">'
            + '<option value="acknowledge">One-tap Acknowledge (I\'ve read this)</option>'
            + '<option value="text">Text Reply</option>'
            + '<option value="yesno">Yes / No</option>'
            + '<option value="number">Number Entry</option>'
            + '<option value="photo">Photo + Text</option>'
            + '</select></div>'

            /* Title */
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Title *</label>'
            + '<input type="text" id="msgTitle" placeholder="e.g. Please explain last week\'s waste" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"></div>'

            /* Body */
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Details</label>'
            + '<textarea id="msgBody" rows="3" placeholder="Additional context or instructions..." class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"></textarea>'
            + '<button onclick="Messages.embedStoreData()" type="button" style="margin-top:4px;background:#F1F5F9;color:#475569;font-size:10px;font-weight:700;padding:4px 10px;border-radius:5px;border:1px solid #E2E8F0;cursor:pointer;">Embed Store Data &#128269;</button>'
            + '</div>'

            /* Response label (for text/number types) */
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Response Prompt</label>'
            + '<input type="text" id="msgResponseLabel" placeholder="e.g. Explanation:" value="Response:" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"></div>'

            /* Target stores */
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Send To</label>'
            + '<label class="flex items-center gap-2 cursor-pointer mb-2">'
            + '<input type="checkbox" id="msgAllStores" checked class="w-4 h-4 rounded border-slate-300 text-blue-600">'
            + '<span class="text-sm font-bold text-slate-700">All Stores</span></label>'
            + '<div id="msgStorePicker" style="display:none;"><div class="text-xs text-slate-400 mb-1">Or select specific stores:</div>'
            + '<div id="msgStoreList" class="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1"></div></div>'
            + '</div>'

            /* Due date */
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Due Date (optional)</label>'
            + '<input type="date" id="msgDueDate" min="' + today + '" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"></div>'

            /* Attachment URL (training link) */
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Link URL (optional)</label>'
            + '<input type="url" id="msgAttachmentUrl" placeholder="https://..." class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"></div>'

            + '</div>'
            + '<div class="p-6 border-t border-slate-100 flex justify-end gap-3">'
            + '<button onclick="Messages.closeCreate()" style="background:#F1F5F9;color:#475569;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;">Cancel</button>'
            + '<button onclick="Messages.doCreate()" style="background:#3B82F6;color:#fff;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;">Send Message</button>'
            + '</div>'
            + '</div></div>';

        /* Populate store list */
        _populateStorePicker();
        /* Toggle store picker */
        document.getElementById('msgAllStores').addEventListener('change', function() {
            document.getElementById('msgStorePicker').style.display = this.checked ? 'none' : 'block';
        });
    }

    function _populateStorePicker() {
        var list = document.getElementById('msgStoreList');
        if (!list) return;
        var names = _getAllStoreNames();
        if (!names.length) { list.innerHTML = '<div class="text-xs text-slate-400">No stores loaded</div>'; return; }
        names.sort();
        list.innerHTML = names.map(function(n) {
            return '<label class="flex items-center gap-2 cursor-pointer">'
                + '<input type="checkbox" class="msg-store-cb w-3 h-3 rounded border-slate-300 text-blue-600" value="' + _esc(n) + '">'
                + '<span class="text-xs text-slate-600">' + _esc(n) + '</span></label>';
        }).join('');
    }

    function closeCreate(e) {
        if (e && e.target && !e.target.classList.contains('fixed')) return;
        var area = document.getElementById('messagesCreateArea');
        if (area) area.innerHTML = '';
    }

    /* ─── Embed store data into message body ─────────────────────── */
    async function embedStoreData() {
        if (typeof DataSnippets === 'undefined') { showToast('Data snippets not loaded', 'error'); return; }
        /* Pick the first selected store, or prompt */
        var allStoresCb = document.getElementById('msgAllStores');
        var stores = [];
        if (allStoresCb && allStoresCb.checked) {
            /* All stores — use first store as example */
            if (typeof originalStoreNames !== 'undefined') {
                originalStoreNames.forEach(function(name, id) { stores.push(name); });
            }
        } else {
            var cbs = document.querySelectorAll('.msg-store-cb:checked');
            cbs.forEach(function(cb) { stores.push(cb.value); });
        }
        if (!stores.length) { showToast('Select at least one store first', 'warning'); return; }
        var storeName = stores[0];
        var text = await DataSnippets.kpiTrendText(storeName, 4);
        var body = document.getElementById('msgBody');
        if (body) {
            body.value = body.value ? body.value + '\n\n' + text : text;
        }
        showToast('Data embedded for ' + storeName, 'success');
    }

    async function doCreate() {
        var title = (document.getElementById('msgTitle').value || '').trim();
        if (!title) { alert('Please enter a title'); return; }
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var targetStores = ['all'];
        var allCb = document.getElementById('msgAllStores');
        if (allCb && !allCb.checked) {
            targetStores = [];
            document.querySelectorAll('.msg-store-cb:checked').forEach(function(cb) { targetStores.push(cb.value); });
            if (!targetStores.length) { alert('Please select at least one store'); return; }
        }
        var msg = await createMessage({
            type: (document.querySelector('input[name="msgType"]:checked') || {}).value || 'broadcast',
            responseType: document.getElementById('msgResponseType').value,
            title: title,
            body: document.getElementById('msgBody').value || '',
            from: user ? (user.department || 'Head Office') : 'Head Office',
            fromName: user ? (user.name || user.displayName || '') : '',
            targetStores: targetStores,
            responseLabel: document.getElementById('msgResponseLabel').value || 'Response:',
            dueDate: document.getElementById('msgDueDate').value || '',
            attachmentUrl: document.getElementById('msgAttachmentUrl').value || '',
            createdBy: user ? user.id : ''
        });
        if (msg) {
            _messages.unshift(msg);
            closeCreate();
            renderHQ();
            if (typeof showToast === 'function') showToast('Message sent to ' + (targetStores[0] === 'all' ? 'all stores' : targetStores.length + ' stores'), 'success');
        }
    }

    /* ─── HQ: View Responses for a Message ─────────────────────── */
    function viewResponses(messageId) {
        var msg = _messages.find(function(m) { return m.id === messageId; });
        if (!msg) return;
        var area = document.getElementById('messagesResponseArea');
        if (!area) return;
        var resps = getResponses(messageId);
        var typeInfo = MESSAGE_TYPES[msg.type] || MESSAGE_TYPES.broadcast;
        var respType = RESPONSE_TYPES[msg.responseType] || RESPONSE_TYPES.acknowledge;

        var html = '<div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="Messages.closeResponses(event)">'
            + '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">'
            + '<div class="p-6 border-b border-slate-100" style="border-left:4px solid ' + typeInfo.color + ';">'
            + '<div class="flex items-center justify-between">'
            + '<div><h3 class="text-lg font-black outfit text-slate-800">' + _esc(msg.title) + '</h3>'
            + '<p class="text-sm text-slate-500 mt-1">' + resps.length + ' responses \u2022 ' + respType.desc + '</p></div>'
            + '<button onclick="Messages.closeResponses()" class="text-slate-400 hover:text-slate-600 text-xl font-bold">&times;</button>'
            + '</div></div>'
            + '<div class="p-6">';

        if (resps.length === 0) {
            html += '<div class="text-center py-8 text-slate-400"><p class="text-sm">No responses yet</p></div>';
        } else {
            html += '<div class="space-y-2">';
            resps.forEach(function(r) {
                var time = '';
                try { time = new Date(r.respondedAt).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); } catch(e) {}
                html += '<div class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">'
                    + '<div class="flex-1">'
                    + '<div class="flex items-center gap-2">'
                    + '<span class="text-sm font-bold text-slate-800">' + _esc(r.storeName) + '</span>'
                    + '<span class="text-xs text-slate-400">\u2022 ' + _esc(r.respondedByName) + '</span>'
                    + '<span class="text-xs text-slate-400">\u2022 ' + time + '</span>'
                    + '</div>'
                    + (r.responseText ? '<p class="text-sm text-slate-600 mt-1">' + _esc(r.responseText) + '</p>' : '')
                    + (r.responsePhoto ? '<img src="' + r.responsePhoto + '" class="mt-2 max-h-32 rounded-lg border">' : '')
                    + '</div>'
                    + '<span class="text-xs font-bold px-2 py-1 rounded-full ' + (r.responseType === 'yesno' ? (r.responseText === 'Yes' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') : 'bg-slate-100 text-slate-600') + '">' + _esc(r.responseText || respType.icon) + '</span>'
                    + '</div>';
            });
            html += '</div>';
        }
        html += '</div></div></div>';
        area.innerHTML = html;
    }

    function closeResponses(e) {
        if (e && e.target && !e.target.classList.contains('fixed')) return;
        var area = document.getElementById('messagesResponseArea');
        if (area) area.innerHTML = '';
    }

    /* ─── HQ: Close a message ───────────────────────────────────── */
    async function closeMessage(messageId) {
        if (!confirm('Close this message? Stores will no longer see it.')) return;
        var msg = _messages.find(function(m) { return m.id === messageId; });
        if (!msg) return;
        msg.status = 'closed';
        msg.closedAt = new Date().toISOString();
        await save(msg);
        renderHQ();
        if (typeof showToast === 'function') showToast('Message closed', 'success');
    }

    /* ─── Store Render: Messages View ───────────────────────────── */
    function renderStore(storeId, storeName) {
        var mv = document.getElementById('mainView');
        if (!mv) return;
        var msgs = getForStore(storeId);

        var html = '<div class="card p-6" style="border-top:3px solid #3B82F6;">'
            + '<div class="mb-6">'
            + '<h2 class="text-2xl font-black outfit text-slate-800">Messages</h2>'
            + '<p class="text-sm text-slate-500 mt-1">' + _esc(storeName) + ' \u2022 ' + msgs.filter(function(m){ return !hasStoreResponded(m.id, storeId); }).length + ' awaiting response</p>'
            + '</div>';

        if (msgs.length === 0) {
            html += '<div class="text-center py-12 text-slate-400"><p class="text-lg font-bold">No messages</p><p class="text-sm mt-2">You\'re all caught up</p></div>';
        } else {
            html += '<div class="space-y-3">';
            msgs.forEach(function(m) {
                var typeInfo = MESSAGE_TYPES[m.type] || MESSAGE_TYPES.broadcast;
                var responded = hasStoreResponded(m.id, storeId);
                var dueClass = '';
                if (m.dueDate) {
                    var today = new Date().toISOString().slice(0,10);
                    if (m.dueDate < today && !responded) dueClass = 'border-red-300 bg-red-50/30';
                }

                html += '<div class="border rounded-xl p-4 transition-colors ' + (dueClass || 'border-slate-200') + '" style="border-left:4px solid ' + typeInfo.color + ';">'
                    + '<div class="flex items-start justify-between">'
                    + '<div class="flex-1">'
                    + '<div class="flex items-center gap-2 mb-1">'
                    + '<span style="background:' + typeInfo.bg + ';color:' + typeInfo.color + ';font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;">' + typeInfo.label + '</span>'
                    + (responded ? '<span style="background:#DCFCE7;color:#166534;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;">\u2714 Responded</span>' : '')
                    + (m.dueDate ? '<span class="text-xs text-slate-400">Due: ' + _esc(m.dueDate) + '</span>' : '')
                    + '</div>'
                    + '<h3 class="font-bold text-slate-800 text-base">' + _esc(m.title) + '</h3>'
                    + '<p class="text-sm text-slate-500 mt-1">' + _esc(m.body) + '</p>'
                    + '<p class="text-xs text-slate-400 mt-2">From: ' + _esc(m.fromName || m.from) + ' \u2022 ' + new Date(m.createdAt).toLocaleDateString('en-GB') + '</p>'
                    + (m.attachmentUrl ? '<a href="' + _esc(m.attachmentUrl) + '" target="_blank" class="text-sm font-bold text-blue-600 hover:underline mt-2 inline-block">Open Link \u2192</a>' : '')
                    + '</div>'
                    + '</div>';

                /* Response area */
                if (!responded) {
                    html += '<div class="mt-4 pt-4 border-t border-slate-100" id="msgResp_' + m.id + '">';
                    if (m.responseType === 'acknowledge') {
                        html += '<button onclick="Messages.storeRespond(\'' + m.id + '\',\'' + _esc(storeId) + '\',\'' + _esc(storeName) + '\',\'acknowledge\',\'Acknowledged\')" '
                            + 'style="width:100%;background:#3B82F6;color:#fff;font-size:14px;font-weight:700;padding:12px;border-radius:8px;border:none;cursor:pointer;">\u2714 I\'ve Read This</button>';
                    } else if (m.responseType === 'yesno') {
                        html += '<div class="flex gap-3">'
                            + '<button onclick="Messages.storeRespond(\'' + m.id + '\',\'' + _esc(storeId) + '\',\'' + _esc(storeName) + '\',\'yesno\',\'Yes\')" '
                            + 'style="flex:1;background:#059669;color:#fff;font-size:14px;font-weight:700;padding:12px;border-radius:8px;border:none;cursor:pointer;">\u2714 Yes</button>'
                            + '<button onclick="Messages.storeRespond(\'' + m.id + '\',\'' + _esc(storeId) + '\',\'' + _esc(storeName) + '\',\'yesno\',\'No\')" '
                            + 'style="flex:1;background:#DC2626;color:#fff;font-size:14px;font-weight:700;padding:12px;border-radius:8px;border:none;cursor:pointer;">\u2718 No</button>'
                            + '</div>';
                    } else if (m.responseType === 'text') {
                        html += '<label class="block text-xs font-bold text-slate-500 mb-1">' + _esc(m.responseLabel) + '</label>'
                            + '<textarea id="msgTxt_' + m.id + '" rows="3" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none mb-2" placeholder="Type your response..."></textarea>'
                            + '<button onclick="Messages.storeRespond(\'' + m.id + '\',\'' + _esc(storeId) + '\',\'' + _esc(storeName) + '\',\'text\',document.getElementById(\'msgTxt_' + m.id + '\').value)" '
                            + 'style="width:100%;background:#3B82F6;color:#fff;font-size:14px;font-weight:700;padding:12px;border-radius:8px;border:none;cursor:pointer;">Submit</button>';
                    } else if (m.responseType === 'number') {
                        html += '<label class="block text-xs font-bold text-slate-500 mb-1">' + _esc(m.responseLabel) + '</label>'
                            + '<input type="number" id="msgNum_' + m.id + '" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-2" placeholder="0">'
                            + '<button onclick="Messages.storeRespond(\'' + m.id + '\',\'' + _esc(storeId) + '\',\'' + _esc(storeName) + '\',\'number\',document.getElementById(\'msgNum_' + m.id + '\').value)" '
                            + 'style="width:100%;background:#3B82F6;color:#fff;font-size:14px;font-weight:700;padding:12px;border-radius:8px;border:none;cursor:pointer;">Submit</button>';
                    } else if (m.responseType === 'photo') {
                        html += '<label class="block text-xs font-bold text-slate-500 mb-1">' + _esc(m.responseLabel) + '</label>'
                            + '<input type="file" id="msgPhoto_' + m.id + '" accept="image/*" capture="environment" class="mb-2 text-sm">'
                            + '<textarea id="msgTxt_' + m.id + '" rows="2" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none mb-2" placeholder="Optional note..."></textarea>'
                            + '<button onclick="Messages.storeRespondPhoto(\'' + m.id + '\',\'' + _esc(storeId) + '\',\'' + _esc(storeName) + '\')" '
                            + 'style="width:100%;background:#3B82F6;color:#fff;font-size:14px;font-weight:700;padding:12px;border-radius:8px;border:none;cursor:pointer;">Submit Photo</button>';
                    }
                    html += '</div>';
                } else {
                    var myResp = (_responses[m.id] || []).find(function(r) { return r.storeId === storeId; });
                    if (myResp) {
                        html += '<div class="mt-4 pt-4 border-t border-slate-100 bg-green-50 rounded-lg p-3">'
                            + '<p class="text-sm text-green-700 font-bold">\u2714 Response submitted: <span class="font-normal">' + _esc(myResp.responseText || 'Acknowledged') + '</span></p>'
                            + '<p class="text-xs text-green-500 mt-1">' + new Date(myResp.respondedAt).toLocaleString('en-GB') + '</p></div>';
                    }
                }
                html += '</div>';
            });
            html += '</div>';
        }
        html += '</div>';
        mv.innerHTML = html;
    }

    /* ─── Store: Submit a text/acknowledge/yesno/number response ── */
    async function storeRespond(messageId, storeId, storeName, responseType, text) {
        if (responseType !== 'acknowledge' && responseType !== 'yesno' && (!text || !text.trim())) {
            if (typeof showToast === 'function') showToast('Please enter a response', 'error');
            return;
        }
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var result = await respond(
            messageId, storeId, storeName,
            user ? user.id : '', user ? (user.name || user.displayName || '') : '',
            responseType, (text || '').trim()
        );
        if (result.ok) {
            if (typeof showToast === 'function') showToast('Response submitted', 'success');
            renderStore(storeId, storeName);
        } else if (result.error === 'Already responded') {
            if (typeof showToast === 'function') showToast('You have already responded to this message', 'info');
        } else {
            if (typeof showToast === 'function') showToast('Failed to submit response', 'error');
        }
    }

    /* ─── Store: Submit photo response ──────────────────────────── */
    async function storeRespondPhoto(messageId, storeId, storeName) {
        var fileInput = document.getElementById('msgPhoto_' + messageId);
        var textInput = document.getElementById('msgTxt_' + messageId);
        var photo = null;
        if (fileInput && fileInput.files && fileInput.files[0]) {
            photo = await new Promise(function(resolve) {
                var reader = new FileReader();
                reader.onload = function(e) { resolve(e.target.result); };
                reader.readAsDataURL(fileInput.files[0]);
            });
        }
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var result = await respond(
            messageId, storeId, storeName,
            user ? user.id : '', user ? (user.name || user.displayName || '') : '',
            'photo', textInput ? textInput.value.trim() : '', photo
        );
        if (result.ok) {
            if (typeof showToast === 'function') showToast('Photo submitted', 'success');
            renderStore(storeId, storeName);
        } else {
            if (typeof showToast === 'function') showToast('Failed to submit', 'error');
        }
    }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        load: load,
        createMessage: createMessage,
        respond: respond,
        getForStore: getForStore,
        getResponses: getResponses,
        hasStoreResponded: hasStoreResponded,
        countPending: countPending,
        renderHQ: renderHQ,
        renderStore: renderStore,
        showCreate: showCreate,
        closeCreate: closeCreate,
        doCreate: doCreate,
        embedStoreData: embedStoreData,
        viewResponses: viewResponses,
        closeResponses: closeResponses,
        closeMessage: closeMessage,
        storeRespond: storeRespond,
        storeRespondPhoto: storeRespondPhoto,
        RESPONSE_TYPES: RESPONSE_TYPES,
        MESSAGE_TYPES: MESSAGE_TYPES
    };
})();
