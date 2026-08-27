/* ─── My Work: Personal Todos ────────────────────────────────────── */
/* Simple checklist with lists. Stored in IDB 'my_lists' +           */
/* individual items in 'my_todos' (shared with Kanban).               */
/* ================================================================== */
window.MyWorkTodos = (function() {
    'use strict';

    var _lists = [];
    var _currentList = null;

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _today() { return new Date().toISOString().slice(0,10); }
    function _uid() { return 'list-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2,6); }

    async function _loadLists() {
        try { _lists = await idbGetAll('my_lists'); } catch(e) { _lists = []; }
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        if (user && user.id) {
            _lists = _lists.filter(function(l) { return !l.userId || l.userId === user.id; });
        }
        _lists.sort(function(a,b) { return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''); });
    }

    async function _saveList(list) {
        list.updatedAt = new Date().toISOString();
        try { await idbPut('my_lists', list); } catch(e) {}
        try {
            if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
                await GraphClient.writeFile('My Work/Lists/' + list.id + '.json', JSON.stringify(list, null, 2));
            }
        } catch(e) {}
    }

    async function _deleteList(listId) {
        try { await idbDelete('my_lists', listId); } catch(e) {}
        try {
            if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
                await GraphClient.deleteFile('My Work/Lists/' + listId + '.json');
            }
        } catch(e) {}
    }

    /* ─── Render into a container (for hub tab) ────────────────── */
    async function renderInto(container) {
        await _loadLists();

        if (_currentList) {
            _renderListDetail(container);
            return;
        }

        var html = '<div class="flex items-center justify-between mb-4">'
            + '<h3 class="text-sm font-black text-slate-500 uppercase tracking-widest">My Lists (' + _lists.length + ')</h3>'
            + '<button onclick="MyWorkTodos.showCreateList()" style="background:#6E8E6D;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;">+ New List</button>'
            + '</div>';

        if (_lists.length === 0) {
            html += '<div class="card p-8 text-center text-slate-400">'
                + '<p class="text-lg font-bold">No lists yet</p>'
                + '<p class="text-sm mt-2">Create a list to organize your personal todos</p>'
                + '</div>';
        } else {
            html += '<div class="space-y-2">';
            _lists.forEach(function(list) {
                var items = list.items || [];
                var done = items.filter(function(i) { return i.done; }).length;
                var total = items.length;
                var pct = total > 0 ? Math.round((done / total) * 100) : 0;

                html += '<div class="card p-4 cursor-pointer hover:shadow-md transition-all" onclick="MyWorkTodos.openList(\'' + list.id + '\')">'
                    + '<div class="flex items-center justify-between">'
                    + '<div class="flex-1">'
                    + '<p class="text-sm font-bold text-slate-700">' + _esc(list.name) + '</p>'
                    + '<p class="text-[10px] text-slate-400">' + total + ' item' + (total !== 1 ? 's' : '') + (done > 0 ? ' \u2022 ' + done + ' done' : '') + '</p>'
                    + '</div>'
                    + '<div class="flex items-center gap-3">'
                    + (total > 0 ? '<div style="width:40px;height:4px;background:#E2E8F0;border-radius:2px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:#6E8E6D;border-radius:2px;"></div></div>' : '')
                    + '<button onclick="event.stopPropagation();MyWorkTodos.deleteList(\'' + list.id + '\')" style="background:transparent;color:#CBD5E1;border:none;cursor:pointer;font-size:14px;" title="Delete">&times;</button>'
                    + '</div></div></div>';
            });
            html += '</div>';
        }

        html += '<div id="todoCreateArea"></div>';
        container.innerHTML = html;
    }

    function _renderListDetail(container) {
        var list = _lists.find(function(l) { return l.id === _currentList; });
        if (!list) { _currentList = null; renderInto(container); return; }

        var items = list.items || [];
        var done = items.filter(function(i) { return i.done; }).length;

        var html = '<div class="flex items-center gap-3 mb-4">'
            + '<button onclick="MyWorkTodos.closeList()" style="background:transparent;color:#64748B;font-size:16px;border:none;cursor:pointer;">\u2190</button>'
            + '<div class="flex-1"><h3 class="text-lg font-black text-slate-800">' + _esc(list.name) + '</h3>'
            + '<p class="text-[10px] text-slate-400">' + done + '/' + items.length + ' done</p></div>'
            + '<button onclick="MyWorkTodos.showAddItem()" style="background:#6E8E6D;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;">+ Add</button>'
            + '</div>';

        if (items.length === 0) {
            html += '<div class="card p-6 text-center text-slate-400"><p class="text-sm">No items yet</p></div>';
        } else {
            html += '<div class="space-y-1">';
            items.forEach(function(item, idx) {
                var checkBg = item.done ? '#6E8E6D' : 'transparent';
                var checkBorder = item.done ? '#6E8E6D' : '#CBD5E1';
                var textStyle = item.done ? 'text-decoration:line-through;color:#94A3B8;' : 'color:#1E293B;';

                html += '<div class="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors">'
                    + '<button onclick="MyWorkTodos.toggleItem(\'' + list.id + '\',' + idx + ')" '
                    + 'style="width:22px;height:22px;border-radius:6px;border:2px solid ' + checkBorder + ';background:' + checkBg + ';cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;flex-shrink:0;">'
                    + (item.done ? '\u2714' : '') + '</button>'
                    + '<span class="text-sm font-bold flex-1" style="' + textStyle + '">' + _esc(item.text) + '</span>'
                    + '<button onclick="MyWorkTodos.deleteItem(\'' + list.id + '\',' + idx + ')" style="background:transparent;color:#CBD5E1;border:none;cursor:pointer;font-size:14px;">&times;</button>'
                    + '</div>';
            });
            html += '</div>';
        }

        html += '<div id="todoCreateArea"></div>';
        container.innerHTML = html;
    }

    function showCreateList() {
        var area = document.getElementById('todoCreateArea');
        if (!area) return;
        area.innerHTML = '<div class="card p-4 mt-4">'
            + '<label class="block text-xs font-bold text-slate-500 mb-1">List Name *</label>'
            + '<div class="flex gap-2">'
            + '<input type="text" id="todoListName" class="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" placeholder="e.g. Weekly checklist">'
            + '<button onclick="MyWorkTodos.doCreateList()" style="background:#6E8E6D;color:#fff;padding:8px 16px;border-radius:6px;font-weight:700;font-size:12px;border:none;cursor:pointer;">Create</button>'
            + '<button onclick="document.getElementById(\'todoCreateArea\').innerHTML=\'\'" style="background:#F1F5F9;color:#475569;padding:8px 12px;border-radius:6px;font-weight:700;font-size:12px;border:none;cursor:pointer;">Cancel</button>'
            + '</div></div>';
        document.getElementById('todoListName').focus();
    }

    async function doCreateList() {
        var name = (document.getElementById('todoListName').value || '').trim();
        if (!name) { alert('Enter a list name'); return; }
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var list = {
            id: _uid(),
            name: name,
            items: [],
            userId: user ? user.id : '',
            createdAt: new Date().toISOString()
        };
        await _saveList(list);
        _lists.unshift(list);
        document.getElementById('todoCreateArea').innerHTML = '';
        var container = document.getElementById('myworkTabContent');
        if (container) renderInto(container);
        if (typeof showToast === 'function') showToast('List created', 'success');
    }

    async function deleteList(listId) {
        if (!confirm('Delete this list and all its items?')) return;
        await _deleteList(listId);
        _lists = _lists.filter(function(l) { return l.id !== listId; });
        var container = document.getElementById('myworkTabContent');
        if (container) renderInto(container);
    }

    function openList(listId) {
        _currentList = listId;
        var container = document.getElementById('myworkTabContent');
        if (container) renderInto(container);
    }

    function closeList() {
        _currentList = null;
        var container = document.getElementById('myworkTabContent');
        if (container) renderInto(container);
    }

    function showAddItem() {
        var area = document.getElementById('todoCreateArea');
        if (!area) return;
        area.innerHTML = '<div class="card p-4 mt-4">'
            + '<label class="block text-xs font-bold text-slate-500 mb-1">New Item</label>'
            + '<div class="flex gap-2">'
            + '<input type="text" id="todoItemText" class="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" placeholder="What needs to be done?">'
            + '<button onclick="MyWorkTodos.doAddItem()" style="background:#6E8E6D;color:#fff;padding:8px 16px;border-radius:6px;font-weight:700;font-size:12px;border:none;cursor:pointer;">Add</button>'
            + '</div></div>';
        document.getElementById('todoItemText').focus();
    }

    async function doAddItem() {
        var text = (document.getElementById('todoItemText').value || '').trim();
        if (!text) return;
        var list = _lists.find(function(l) { return l.id === _currentList; });
        if (!list) return;
        if (!list.items) list.items = [];
        list.items.push({ text: text, done: false, addedAt: new Date().toISOString() });
        await _saveList(list);
        document.getElementById('todoCreateArea').innerHTML = '';
        var container = document.getElementById('myworkTabContent');
        if (container) _renderListDetail(container);
    }

    async function toggleItem(listId, idx) {
        var list = _lists.find(function(l) { return l.id === listId; });
        if (!list || !list.items || !list.items[idx]) return;
        list.items[idx].done = !list.items[idx].done;
        await _saveList(list);
        var container = document.getElementById('myworkTabContent');
        if (container) _renderListDetail(container);
    }

    async function deleteItem(listId, idx) {
        var list = _lists.find(function(l) { return l.id === listId; });
        if (!list || !list.items || !list.items[idx]) return;
        list.items.splice(idx, 1);
        await _saveList(list);
        var container = document.getElementById('myworkTabContent');
        if (container) _renderListDetail(container);
    }

    return {
        renderInto: renderInto,
        showCreateList: showCreateList,
        doCreateList: doCreateList,
        deleteList: deleteList,
        openList: openList,
        closeList: closeList,
        showAddItem: showAddItem,
        doAddItem: doAddItem,
        toggleItem: toggleItem,
        deleteItem: deleteItem
    };
})();
