/* ─── My Work: Calendar View ─────────────────────────────────────── */
/* Shows tasks with due dates on a calendar using Vanilla Calendar Pro */
/* Tasks from IDB 'my_todos' store.                                    */
/* ================================================================== */
window.MyWorkCalendar = (function() {
    'use strict';

    var _calendar = null;
    var _tasks = [];

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _today() { return new Date().toISOString().slice(0,10); }

    async function _loadTasks() {
        try { _tasks = await idbGetAll('my_todos'); } catch(e) { _tasks = []; }
        var user = (typeof Users !== 'undefined') ? Users.getEffectiveUser() : null;
        if (user && user.id) {
            _tasks = _tasks.filter(function(t) { return !t.userId || t.userId === user.id; });
        }
    }

    /* ─── Main render ──────────────────────────────────────────── */
    async function render() {
        var mv = document.getElementById('mainView');
        if (!mv) return;

        await _loadTasks();

        var html = '<div style="max-width:1000px;margin:0 auto;padding:8px;">'
            + '<div class="flex items-center justify-between mb-4">'
            + '<div><h2 class="text-2xl font-black text-slate-800">Calendar</h2>'
            + '<p class="text-sm text-slate-400">' + _tasks.length + ' task' + (_tasks.length !== 1 ? 's' : '') + ' with due dates</p></div>'
            + '<button onclick="setView(\'kanban\')" style="background:#6E8E6D;color:#fff;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;">Kanban Board</button>'
            + '</div>'
            + '<div class="card p-4" style="border-top:3px solid #6E8E6D;">'
            + '<div id="myWorkCalendar"></div>'
            + '</div>'
            + '<div id="calendarDayDetail" class="mt-4"></div>'
            + '</div>';

        mv.innerHTML = html;

        /* Initialize Vanilla Calendar Pro */
        _initCalendar();
    }

    function _initCalendar() {
        if (typeof VanillaCalendar === 'undefined') {
            document.getElementById('myWorkCalendar').innerHTML = '<p class="text-sm text-slate-400 p-4">Calendar library not loaded. Check your connection.</p>';
            return;
        }

        /* Build events from tasks */
        var events = _tasks
            .filter(function(t) { return t.dueDate; })
            .map(function(t) {
                var priorityColors = { urgent: '#DC2626', high: '#EA580C', medium: '#D97706', low: '#16A34A' };
                var statusColors = { done: '#059669', in_progress: '#D97706', todo: '#64748B' };
                var isDone = t.status === 'done';
                return {
                    date: t.dueDate,
                    title: (isDone ? '\u2714 ' : '') + t.title,
                    description: t.description || '',
                    color: isDone ? '#D1FAE5' : (priorityColors[t.priority] || '#FEF3C7'),
                    textColor: isDone ? '#059669' : (statusColors[t.status] || '#64748B'),
                    _task: t
                };
            });

        _calendar = new VanillaCalendar('#myWorkCalendar', {
            settings: {
                lang: 'en-GB',
                selection: {
                    day: 'single'
                },
                visibility: {
                    theme: 'light'
                }
            },
            events: events,
            onSelect: function(data) {
                if (data.date) _showDayDetail(data.date);
            }
        });

        _calendar.init();
    }

    function _showDayDetail(dateStr) {
        var detail = document.getElementById('calendarDayDetail');
        if (!detail) return;

        var dayTasks = _tasks.filter(function(t) { return t.dueDate === dateStr; });
        if (dayTasks.length === 0) {
            detail.innerHTML = '<div class="card p-4 text-center text-slate-400"><p class="text-sm">No tasks due on ' + _esc(dateStr) + '</p></div>';
            return;
        }

        var priorityColors = {
            urgent: { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' },
            high:   { bg: '#FFF7ED', text: '#EA580C', border: '#FED7AA' },
            medium: { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' },
            low:    { bg: '#F0FDF4', text: '#16A34A', border: '#BBF7D0' }
        };

        var html = '<div class="card p-4" style="border-top:3px solid #6E8E6D;">'
            + '<h3 class="text-sm font-black text-slate-700 mb-3">Tasks due on ' + _esc(dateStr) + '</h3>'
            + '<div class="space-y-2">';

        dayTasks.forEach(function(t) {
            var pc = priorityColors[t.priority] || priorityColors.medium;
            var statusBadge = t.status === 'done'
                ? '<span style="background:#D1FAE5;color:#059669;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;">Done</span>'
                : t.status === 'in_progress'
                ? '<span style="background:#FEF3C7;color:#D97706;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;">In Progress</span>'
                : '<span style="background:#F1F5F9;color:#64748B;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;">To Do</span>';

            html += '<div class="flex items-center gap-3 p-3 rounded-lg border border-slate-100 bg-white">'
                + '<div style="width:4px;height:32px;border-radius:2px;background:' + pc.text + ';"></div>'
                + '<div class="flex-1">'
                + '<p class="text-sm font-bold text-slate-700">' + _esc(t.title) + '</p>'
                + (t.description ? '<p class="text-xs text-slate-400">' + _esc(t.description).substring(0, 60) + '</p>' : '')
                + '</div>'
                + statusBadge
                + '</div>';
        });

        html += '</div></div>';
        detail.innerHTML = html;
    }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        render: render
    };
})();
