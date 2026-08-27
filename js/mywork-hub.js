/* ─── My Work Hub ────────────────────────────────────────────────── */
/* Tabbed dashboard: Overview, Todos, Contacts.                       */
/* Wraps existing Projects.renderMyWork() + new personal features.     */
/* ================================================================== */
window.MyWorkHub = (function() {
    'use strict';

    var _currentTab = 'overview';
    var TABS = [
        { id: 'overview', label: 'Overview', icon: '\uD83C\uDFE0' },
        { id: 'todos',    label: 'Todos',    icon: '\u2611' },
        { id: 'contacts', label: 'Contacts', icon: '\uD83D\uDC64' }
    ];

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _today() { return new Date().toISOString().slice(0,10); }

    async function render() {
        var mv = document.getElementById('mainView');
        if (!mv) return;

        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var userName = user ? user.name : '';
        var dept = user ? user.department : '';

        /* Tab bar */
        var tabBarHtml = '<div style="display:flex;gap:0;margin-bottom:16px;background:#fff;border:1px solid #E8E5E0;border-radius:10px;overflow:hidden;">';
        TABS.forEach(function(tab) {
            var isActive = tab.id === _currentTab;
            tabBarHtml += '<button onclick="MyWorkHub.switchTab(\'' + tab.id + '\')" '
                + 'style="flex:1;padding:10px 14px;font-size:12px;font-weight:800;border:none;cursor:pointer;transition:all .15s;'
                + (isActive ? 'background:#6E8E6D;color:#fff;' : 'background:transparent;color:#64748B;')
                + '">' + tab.icon + ' ' + tab.label + '</button>';
        });
        tabBarHtml += '</div>';

        /* Quick links to Kanban + Calendar */
        var quickLinks = '<div class="flex gap-2 mb-4">'
            + '<button onclick="setView(\'kanban\')" style="background:#F1F5F9;color:#475569;font-size:11px;font-weight:700;padding:6px 14px;border-radius:6px;border:1px solid #E2E8F0;cursor:pointer;">\uD83D\uDCCA Kanban Board</button>'
            + '<button onclick="setView(\'calendar\')" style="background:#F1F5F9;color:#475569;font-size:11px;font-weight:700;padding:6px 14px;border-radius:6px;border:1px solid #E2E8F0;cursor:pointer;">\uD83D\uDCC5 Calendar</button>'
            + '</div>';

        var html = '<div style="max-width:900px;margin:0 auto;padding:8px;">'
            + '<div class="mb-4">'
            + '<h2 class="text-2xl font-black text-slate-800">My Work</h2>'
            + '<p class="text-sm text-slate-400">' + _esc(userName) + ' \u2022 ' + _esc(dept) + '</p>'
            + '</div>'
            + tabBarHtml
            + quickLinks
            + '<div id="myworkTabContent"></div>'
            + '</div>';

        mv.innerHTML = html;
        await _renderTab();
    }

    async function _renderTab() {
        var area = document.getElementById('myworkTabContent');
        if (!area) return;

        if (_currentTab === 'overview') {
            /* Delegate to existing Projects.renderMyWork() logic inline */
            if (typeof Projects !== 'undefined' && Projects.renderMyWork) {
                /* Temporarily replace mainView content */
                area.innerHTML = '<div id="myworkOverviewInner"></div>';
                var origMain = document.getElementById('mainView');
                /* We'll render into the inner div */
                area.innerHTML = '';
                /* Call existing renderMyWork but redirect output */
                await _renderOverview(area);
            } else {
                area.innerHTML = '<div class="card p-6 text-center text-slate-400"><p class="text-sm">Projects module not loaded</p></div>';
            }
        } else if (_currentTab === 'todos') {
            if (typeof MyWorkTodos !== 'undefined') {
                await MyWorkTodos.renderInto(area);
            } else {
                area.innerHTML = '<div class="card p-6 text-center text-slate-400"><p class="text-sm">Todos module not loaded</p></div>';
            }
        } else if (_currentTab === 'contacts') {
            if (typeof MyWorkContacts !== 'undefined') {
                await MyWorkContacts.renderInto(area);
            } else {
                area.innerHTML = '<div class="card p-6 text-center text-slate-400"><p class="text-sm">Contacts module not loaded</p></div>';
            }
        }
    }

    /* ─── Overview tab: compact summary of projects + tasks ──── */
    async function _renderOverview(container) {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (!user) { container.innerHTML = '<p class="text-sm text-slate-400">Not logged in</p>'; return; }

        var html = '';

        /* Project stages needing action */
        if (typeof Projects !== 'undefined' && Projects.getStagesForUser) {
            var myStages = Projects.getStagesForUser(user.id);
            if (myStages.length) {
                html += '<div class="mb-5"><h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">\u26A1 Needs Your Action (' + myStages.length + ')</h3><div class="space-y-2">';
                myStages.forEach(function(item) {
                    var p = item.project;
                    var s = item.stage;
                    html += '<div class="card p-3 border-l-4 border-l-amber-400 cursor-pointer hover:shadow-sm transition-all" onclick="Projects.renderProjectDetail(\'' + p.id + '\')">'
                        + '<p class="text-sm font-bold text-slate-700">' + _esc(s.title) + '</p>'
                        + '<p class="text-[10px] text-slate-400">' + _esc(p.name) + ' \u2022 Stage #' + (item.stageIndex + 1) + '</p>'
                        + '</div>';
                });
                html += '</div></div>';
            } else {
                html += '<div class="card p-4 text-center mb-5" style="background:rgba(135,157,130,0.04);"><p class="text-sm font-bold text-slate-500">\u2714 All clear \u2014 nothing needs your action</p></div>';
            }
        }

        /* Kanban tasks due today */
        if (typeof MyWorkKanban !== 'undefined') {
            try {
                var allTasks = await idbGetAll('my_todos');
                var userId = user.id;
                var myTasks = allTasks.filter(function(t) { return !t.userId || t.userId === userId; });
                var todayStr = _today();
                var overdue = myTasks.filter(function(t) { return t.dueDate && t.dueDate < todayStr && t.status !== 'done'; });
                var dueToday = myTasks.filter(function(t) { return t.dueDate === todayStr && t.status !== 'done'; });
                var inProgress = myTasks.filter(function(t) { return t.status === 'in_progress'; });

                if (overdue.length || dueToday.length || inProgress.length) {
                    html += '<div class="mb-5"><h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">\uD83D\uDCC5 Tasks</h3><div class="space-y-2">';
                    overdue.forEach(function(t) {
                        html += '<div class="card p-3 border-l-4 border-l-red-400" style="background:#FEF2F2;">'
                            + '<p class="text-sm font-bold text-red-700">\u26A0 Overdue: ' + _esc(t.title) + '</p>'
                            + '<p class="text-[10px] text-red-400">Due: ' + _esc(t.dueDate) + '</p></div>';
                    });
                    dueToday.forEach(function(t) {
                        html += '<div class="card p-3 border-l-4 border-l-amber-400">'
                            + '<p class="text-sm font-bold text-slate-700">' + _esc(t.title) + '</p>'
                            + '<p class="text-[10px] text-slate-400">Due today</p></div>';
                    });
                    inProgress.filter(function(t) { return t.dueDate !== todayStr; }).slice(0, 3).forEach(function(t) {
                        html += '<div class="card p-3 border-l-4 border-l-blue-400">'
                            + '<p class="text-sm font-bold text-slate-700">' + _esc(t.title) + '</p>'
                            + '<p class="text-[10px] text-slate-400">In progress' + (t.dueDate ? ' \u2022 Due ' + _esc(t.dueDate) : '') + '</p></div>';
                    });
                    html += '</div></div>';
                }
            } catch(e) {}
        }

        /* Pending messages */
        if (typeof Messages !== 'undefined') {
            try {
                var u = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
                var storeId = u ? (u.shopStoreId || '') : '';
                if (storeId) {
                    var msgs = Messages.getForStore(storeId);
                    var pending = msgs.filter(function(m) { return !Messages.hasStoreResponded(m.id, storeId); });
                    if (pending.length) {
                        html += '<div class="mb-5"><h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">\uD83D\uDCE8 Pending Messages (' + pending.length + ')</h3><div class="space-y-2">';
                        pending.slice(0, 3).forEach(function(m) {
                            var typeInfo = (Messages.MESSAGE_TYPES || {})[m.type] || { color: '#3B82F6', label: 'Message' };
                            html += '<div class="card p-3 border-l-4 cursor-pointer hover:shadow-sm transition-all" style="border-left-color:' + typeInfo.color + ';" onclick="setView(\'shop-messages\')">'
                                + '<p class="text-sm font-bold text-slate-700">' + _esc(m.title) + '</p>'
                                + '<p class="text-[10px] text-slate-400">' + _esc(typeInfo.label) + (m.dueDate ? ' \u2022 Due ' + _esc(m.dueDate) : '') + '</p>'
                                + '</div>';
                        });
                        html += '</div></div>';
                    }
                }
            } catch(e) {}
        }

        if (!html) {
            html = '<div class="card p-8 text-center" style="background:rgba(135,157,130,0.04);">'
                + '<p class="text-sm font-bold text-slate-500">Nothing here yet \u2014 create a project, task, or template to get started</p>'
                + '<div class="flex gap-3 justify-center mt-4">'
                + '<button onclick="setView(\'kanban\')" style="background:#6E8E6D;color:white;padding:6px 14px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">+ New Task</button>'
                + '<button onclick="setView(\'projects\')" style="background:rgba(85,91,110,0.08);color:#555B6E;padding:6px 14px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">+ Project</button>'
                + '</div></div>';
        }

        container.innerHTML = html;
    }

    function switchTab(tabId) {
        _currentTab = tabId;
        /* Update tab bar UI */
        document.querySelectorAll('#mainView button').forEach(function(btn) {
            /* Reset all tabs */
        });
        render();
    }

    return {
        render: render,
        switchTab: switchTab
    };
})();
