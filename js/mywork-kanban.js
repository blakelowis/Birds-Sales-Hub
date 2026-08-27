/* ─── My Work: Kanban Board ──────────────────────────────────────── */
/* Drag-and-drop task board using SortableJS.                         */
/* Tasks stored in IDB 'my_todos' store.                              */
/* Columns: To Do → In Progress → Done                                */
/* ================================================================== */
window.MyWorkKanban = (function() {
    'use strict';

    var COLUMNS = [
        { id: 'todo',       label: 'To Do',       color: '#64748B', bg: '#F8FAFC' },
        { id: 'in_progress', label: 'In Progress', color: '#D97706', bg: '#FFFBEB' },
        { id: 'done',       label: 'Done',         color: '#059669', bg: '#ECFDF5' }
    ];

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function _today() { return new Date().toISOString().slice(0,10); }

    async function _loadTasks() {
        try { return await idbGetAll('my_todos'); } catch(e) { return []; }
    }

    async function _saveTask(task) {
        try { await idbPut('my_todos', task); } catch(e) {}
        /* Also persist to SharePoint if available */
        try {
            if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
                await GraphClient.writeFile('My Work/Todos/' + task.id + '.json', JSON.stringify(task, null, 2));
            }
        } catch(e) {}
    }

    async function _deleteTask(taskId) {
        try { await idbDelete('my_todos', taskId); } catch(e) {}
        try {
            if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
                await GraphClient.deleteFile('My Work/Todos/' + taskId + '.json');
            }
        } catch(e) {}
    }

    /* ─── Main render ──────────────────────────────────────────── */
    async function render() {
        var mv = document.getElementById('mainView');
        if (!mv) return;

        var tasks = await _loadTasks();
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var userId = user ? user.id : '';

        /* Filter to current user's tasks */
        tasks = tasks.filter(function(t) { return !t.userId || t.userId === userId; });

        /* Sort: in_progress first, then todo, then done; within each by priority then due date */
        var priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        tasks.sort(function(a, b) {
            var colA = COLUMNS.findIndex(function(c) { return c.id === a.status; });
            var colB = COLUMNS.findIndex(function(c) { return c.id === b.status; });
            if (colA !== colB) return colA - colB;
            var pA = priorityOrder[a.priority] || 2;
            var pB = priorityOrder[b.priority] || 2;
            if (pA !== pB) return pA - pB;
            return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
        });

        var html = '<div style="max-width:1200px;margin:0 auto;padding:8px;">'
            + '<div class="flex items-center justify-between mb-4">'
            + '<div><h2 class="text-2xl font-black text-slate-800">My Tasks</h2>'
            + '<p class="text-sm text-slate-400">' + tasks.length + ' task' + (tasks.length !== 1 ? 's' : '') + '</p></div>'
            + '<button onclick="MyWorkKanban.showCreate()" style="background:#6E8E6D;color:#fff;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;">+ New Task</button>'
            + '</div>';

        /* Kanban columns */
        html += '<div id="kanbanBoard" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">';

        COLUMNS.forEach(function(col) {
            var colTasks = tasks.filter(function(t) { return t.status === col.id; });
            html += '<div>'
                + '<div style="background:' + col.bg + ';padding:10px 14px;border-radius:10px 10px 0 0;border-bottom:3px solid ' + col.color + ';">'
                + '<div class="flex items-center justify-between">'
                + '<span style="font-size:12px;font-weight:800;color:' + col.color + ';text-transform:uppercase;letter-spacing:0.05em;">' + col.label + '</span>'
                + '<span style="background:' + col.color + ';color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;">' + colTasks.length + '</span>'
                + '</div></div>'
                + '<div class="kanban-column" data-status="' + col.id + '" style="min-height:200px;padding:8px;background:' + col.bg + ';border-radius:0 0 10px 10px;border:1px solid #E8E5E0;border-top:none;">';

            colTasks.forEach(function(task) {
                html += _renderCard(task);
            });

            html += '</div></div>';
        });

        html += '</div></div>';
        html += '<div id="kanbanCreateArea"></div>';
        mv.innerHTML = html;

        /* Initialize SortableJS on each column */
        _initSortable();
    }

    function _renderCard(task) {
        var priorityColors = {
            urgent: { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' },
            high:   { bg: '#FFF7ED', text: '#EA580C', border: '#FED7AA' },
            medium: { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' },
            low:    { bg: '#F0FDF4', text: '#16A34A', border: '#BBF7D0' }
        };
        var pc = priorityColors[task.priority] || priorityColors.medium;
        var isOverdue = task.dueDate && task.dueDate < _today() && task.status !== 'done';
        var dueClass = isOverdue ? 'color:#DC2626;font-weight:800;' : 'color:#94A3B8;';

        return '<div class="kanban-card" data-id="' + task.id + '" style="background:#fff;border:1px solid #E8E5E0;border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:grab;transition:box-shadow .15s;">'
            + '<div class="flex items-start justify-between mb-1">'
            + '<span style="background:' + pc.bg + ';color:' + pc.text + ';font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;border:1px solid ' + pc.border + ';">' + _esc(task.priority || 'medium') + '</span>'
            + '<button onclick="MyWorkKanban.deleteTask(\'' + task.id + '\')" style="background:transparent;border:none;color:#CBD5E1;font-size:14px;cursor:pointer;padding:0;line-height:1;" title="Delete">&times;</button>'
            + '</div>'
            + '<p style="font-size:13px;font-weight:700;color:#1E293B;margin:4px 0 2px;">' + _esc(task.title) + '</p>'
            + (task.description ? '<p style="font-size:11px;color:#94A3B8;margin:0 0 4px;">' + _esc(task.description).substring(0, 80) + '</p>' : '')
            + '<div class="flex items-center gap-2 mt-2">'
            + (task.dueDate ? '<span style="font-size:10px;' + dueClass + '">&#128197; ' + _esc(task.dueDate) + '</span>' : '')
            + (task.category ? '<span style="font-size:9px;background:#F1F5F9;color:#64748B;padding:1px 6px;border-radius:4px;">' + _esc(task.category) + '</span>' : '')
            + '</div>'
            + '</div>';
    }

    /* ─── SortableJS init ──────────────────────────────────────── */
    function _initSortable() {
        if (typeof Sortable === 'undefined') {
            console.warn('[Kanban] SortableJS not loaded');
            return;
        }
        document.querySelectorAll('.kanban-column').forEach(function(col) {
            new Sortable(col, {
                group: 'kanban',
                animation: 150,
                ghostClass: 'kanban-ghost',
                dragClass: 'kanban-drag',
                handle: '.kanban-card',
                onEnd: async function(evt) {
                    var taskId = evt.item.getAttribute('data-id');
                    var newStatus = evt.to.getAttribute('data-status');
                    if (!taskId || !newStatus) return;
                    var tasks = await _loadTasks();
                    var task = tasks.find(function(t) { return t.id === taskId; });
                    if (task) {
                        task.status = newStatus;
                        task.updatedAt = new Date().toISOString();
                        if (newStatus === 'done' && !task.completedAt) {
                            task.completedAt = new Date().toISOString();
                        }
                        await _saveTask(task);
                    }
                }
            });
        });
    }

    /* ─── Create task modal ────────────────────────────────────── */
    function showCreate() {
        var area = document.getElementById('kanbanCreateArea');
        if (!area) return;

        area.innerHTML = '<div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="MyWorkKanban.closeCreate(event)">'
            + '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-md" onclick="event.stopPropagation()">'
            + '<div class="p-6 border-b border-slate-100"><h3 class="text-xl font-black text-slate-800">New Task</h3></div>'
            + '<div class="p-6 space-y-4">'
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Title *</label>'
            + '<input type="text" id="kbTitle" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" placeholder="What needs to be done?"></div>'
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Description</label>'
            + '<textarea id="kbDesc" rows="2" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none resize-none" placeholder="Details..."></textarea></div>'
            + '<div class="grid grid-cols-2 gap-3">'
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Priority</label>'
            + '<select id="kbPriority" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>'
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Due Date</label>'
            + '<input type="date" id="kbDue" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>'
            + '</div>'
            + '<div><label class="block text-xs font-bold text-slate-500 mb-1">Category</label>'
            + '<select id="kbCategory" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"><option value="">None</option><option>Work</option><option>Personal</option><option>Training</option><option>Follow-up</option><option>Project</option></select></div>'
            + '</div>'
            + '<div class="p-6 border-t border-slate-100 flex justify-end gap-3">'
            + '<button onclick="MyWorkKanban.closeCreate()" style="background:#F1F5F9;color:#475569;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;">Cancel</button>'
            + '<button onclick="MyWorkKanban.doCreate()" style="background:#6E8E6D;color:#fff;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;">Create Task</button>'
            + '</div></div></div>';
    }

    function closeCreate(e) {
        if (e && e.target && !e.target.classList.contains('fixed')) return;
        var area = document.getElementById('kanbanCreateArea');
        if (area) area.innerHTML = '';
    }

    async function doCreate() {
        var title = (document.getElementById('kbTitle').value || '').trim();
        if (!title) { alert('Please enter a title'); return; }
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        var task = {
            id: 'todo-' + Date.now() + '-' + Math.random().toString(36).substr(2,6),
            title: title,
            description: (document.getElementById('kbDesc').value || '').trim(),
            priority: document.getElementById('kbPriority').value,
            dueDate: document.getElementById('kbDue').value || '',
            category: document.getElementById('kbCategory').value || '',
            status: 'todo',
            userId: user ? user.id : '',
            userName: user ? (user.name || user.displayName || '') : '',
            createdAt: new Date().toISOString()
        };
        await _saveTask(task);
        closeCreate();
        render();
        if (typeof showToast === 'function') showToast('Task created', 'success');
    }

    async function deleteTask(taskId) {
        if (!confirm('Delete this task?')) return;
        await _deleteTask(taskId);
        render();
    }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        render: render,
        showCreate: showCreate,
        closeCreate: closeCreate,
        doCreate: doCreate,
        deleteTask: deleteTask
    };
})();
