/* ─── My Work: Personal Contacts ─────────────────────────────────── */
/* Personal contact list for quick reference.                         */
/* Stored in IDB 'my_contacts' store.                                 */
/* ================================================================== */
window.MyWorkContacts = (function() {
    'use strict';

    var _contacts = [];

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _uid() { return 'contact-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2,6); }

    async function _loadContacts() {
        try { _contacts = await idbGetAll('my_contacts'); } catch(e) { _contacts = []; }
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        if (user && user.id) {
            _contacts = _contacts.filter(function(c) { return !c.userId || c.userId === user.id; });
        }
        _contacts.sort(function(a,b) { return (a.name || '').localeCompare(b.name || ''); });
    }

    async function _saveContact(contact) {
        contact.updatedAt = new Date().toISOString();
        try { await idbPut('my_contacts', contact); } catch(e) {}
        try {
            if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
                await GraphClient.writeFile('My Work/Contacts/' + contact.id + '.json', JSON.stringify(contact, null, 2));
            }
        } catch(e) {}
    }

    async function _deleteContact(contactId) {
        try { await idbDelete('my_contacts', contactId); } catch(e) {}
        try {
            if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
                await GraphClient.deleteFile('My Work/Contacts/' + contactId + '.json');
            }
        } catch(e) {}
    }

    /* ─── Render into a container (for hub tab) ────────────────── */
    async function renderInto(container) {
        await _loadContacts();

        var html = '<div class="flex items-center justify-between mb-4">'
            + '<h3 class="text-sm font-black text-slate-500 uppercase tracking-widest">Contacts (' + _contacts.length + ')</h3>'
            + '<button onclick="MyWorkContacts.showCreate()" style="background:#6E8E6D;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;">+ Add Contact</button>'
            + '</div>';

        /* Search */
        html += '<div class="mb-4"><input type="text" id="contactSearch" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" placeholder="Search contacts..." oninput="MyWorkContacts.filterList(this.value)"></div>';

        if (_contacts.length === 0) {
            html += '<div class="card p-8 text-center text-slate-400">'
                + '<p class="text-lg font-bold">No contacts yet</p>'
                + '<p class="text-sm mt-2">Add people you work with regularly for quick access</p>'
                + '</div>';
        } else {
            html += '<div id="contactList" class="space-y-2">';
            _contacts.forEach(function(c) {
                html += _renderContactCard(c);
            });
            html += '</div>';
        }

        html += '<div id="contactCreateArea"></div>';
        container.innerHTML = html;
    }

    function _renderContactCard(c) {
        var roleColors = {
            manager: '#6E8E6D', team: '#3B82F6', supplier: '#D97706', other: '#64748B'
        };
        var color = roleColors[c.role] || '#64748B';

        var initials = (c.name || '?').split(' ').map(function(w) { return w.charAt(0); }).join('').substring(0, 2).toUpperCase();

        return '<div class="card p-4 flex items-center gap-4">'
            + '<div style="width:40px;height:40px;border-radius:10px;background:' + color + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0;">' + _esc(initials) + '</div>'
            + '<div class="flex-1 min-w-0">'
            + '<p class="text-sm font-bold text-slate-700">' + _esc(c.name) + '</p>'
            + '<p class="text-[10px] text-slate-400">' + _esc(c.role || '') + (c.store ? ' \u2022 ' + _esc(c.store) : '') + '</p>'
            + '</div>'
            + '<div class="flex items-center gap-2 flex-shrink-0">'
            + (c.phone ? '<a href="tel:' + _esc(c.phone) + '" style="background:#F1F5F9;color:#475569;font-size:11px;font-weight:700;padding:6px 10px;border-radius:6px;text-decoration:none;display:inline-block;">\uD83D\uDCDE Call</a>' : '')
            + (c.email ? '<a href="mailto:' + _esc(c.email) + '" style="background:#F1F5F9;color:#475569;font-size:11px;font-weight:700;padding:6px 10px;border-radius:6px;text-decoration:none;display:inline-block;">\u2709 Email</a>' : '')
            + '<button onclick="MyWorkContacts.deleteContact(\'' + c.id + '\')" style="background:transparent;color:#CBD5E1;border:none;cursor:pointer;font-size:14px;" title="Delete">&times;</button>'
            + '</div></div>';
    }

    function filterList(query) {
        var q = (query || '').toLowerCase();
        var list = document.getElementById('contactList');
        if (!list) return;
        var filtered = _contacts.filter(function(c) {
            return !q || (c.name || '').toLowerCase().indexOf(q) >= 0
                || (c.role || '').toLowerCase().indexOf(q) >= 0
                || (c.store || '').toLowerCase().indexOf(q) >= 0
                || (c.email || '').toLowerCase().indexOf(q) >= 0;
        });
        list.innerHTML = filtered.map(function(c) { return _renderContactCard(c); }).join('');
    }

    function showCreate() {
        var area = document.getElementById('contactCreateArea');
        if (!area) return;

        area.innerHTML = '<div class="card p-5 mt-4" style="border-top:3px solid #6E8E6D;">'
            + '<h4 class="text-sm font-black text-slate-700 mb-3">New Contact</h4>'
            + '<div class="grid grid-cols-2 gap-3 mb-3">'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Name *</label>'
            + '<input type="text" id="ctName" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" placeholder="Full name"></div>'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Role</label>'
            + '<select id="ctRole" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"><option value="">--</option><option value="manager">Manager</option><option value="team">Team Member</option><option value="supplier">Supplier</option><option value="other">Other</option></select></div>'
            + '</div>'
            + '<div class="grid grid-cols-2 gap-3 mb-3">'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Phone</label>'
            + '<input type="tel" id="ctPhone" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" placeholder="07..."></div>'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Email</label>'
            + '<input type="email" id="ctEmail" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" placeholder="name@company.com"></div>'
            + '</div>'
            + '<div class="mb-3"><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Store / Location</label>'
            + '<input type="text" id="ctStore" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" placeholder="e.g. Branston"></div>'
            + '<div class="mb-3"><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Notes</label>'
            + '<textarea id="ctNotes" rows="2" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none resize-none" placeholder="Any extra info..."></textarea></div>'
            + '<div class="flex gap-2">'
            + '<button onclick="MyWorkContacts.doCreate()" style="background:#6E8E6D;color:#fff;padding:8px 16px;border-radius:6px;font-weight:700;font-size:12px;border:none;cursor:pointer;">Save Contact</button>'
            + '<button onclick="document.getElementById(\'contactCreateArea\').innerHTML=\'\'" style="background:#F1F5F9;color:#475569;padding:8px 12px;border-radius:6px;font-weight:700;font-size:12px;border:none;cursor:pointer;">Cancel</button>'
            + '</div></div>';
        document.getElementById('ctName').focus();
    }

    async function doCreate() {
        var name = (document.getElementById('ctName').value || '').trim();
        if (!name) { alert('Enter a name'); return; }
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var contact = {
            id: _uid(),
            name: name,
            role: document.getElementById('ctRole').value || '',
            phone: document.getElementById('ctPhone').value || '',
            email: document.getElementById('ctEmail').value || '',
            store: document.getElementById('ctStore').value || '',
            notes: document.getElementById('ctNotes').value || '',
            userId: user ? user.id : '',
            createdAt: new Date().toISOString()
        };
        await _saveContact(contact);
        _contacts.push(contact);
        _contacts.sort(function(a,b) { return (a.name || '').localeCompare(b.name || ''); });
        document.getElementById('contactCreateArea').innerHTML = '';
        var container = document.getElementById('myworkTabContent');
        if (container) renderInto(container);
        if (typeof showToast === 'function') showToast('Contact added', 'success');
    }

    async function deleteContact(contactId) {
        if (!confirm('Delete this contact?')) return;
        await _deleteContact(contactId);
        _contacts = _contacts.filter(function(c) { return c.id !== contactId; });
        var container = document.getElementById('myworkTabContent');
        if (container) renderInto(container);
    }

    return {
        renderInto: renderInto,
        showCreate: showCreate,
        doCreate: doCreate,
        deleteContact: deleteContact,
        filterList: filterList
    };
})();
