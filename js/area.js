/* ─── Area Manager Dashboard ─────────────────────────────────────── */
/* Multi-store rota overview, headcount/hours/absence alerts,        */
/* leave approval, and messaging to stores.                          */
/* AM is derived from KPI data via safeGetAM().                       */
/* ================================================================== */
window.AreaDashboard = (function() {
    'use strict';

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _today() { return new Date().toISOString().slice(0,10); }

    /* ─── Resolve which stores this AM covers ──────────────────── */
    function _getAMStores() {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (!user) return [];
        var amName = user.name || '';
        if (!amName) return [];
        var stores = [];
        if (typeof originalStoreNames !== 'undefined') {
            originalStoreNames.forEach(function(name, id) {
                if (typeof safeGetAM === 'function' && safeGetAM(name) === amName) {
                    stores.push({ id: id, name: name });
                }
            });
        }
        stores.sort(function(a,b) { return a.name.localeCompare(b.name); });
        return stores;
    }

    /* ─── Main render ──────────────────────────────────────────── */
    async function render() {
        var mv = document.getElementById('mainView');
        if (!mv) return;

        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var role = (typeof Users !== 'undefined') ? Users.getRole() : 'hq';

        /* Role gate: area_manager sees their area; hq/admin sees everything */
        var amStores = _getAMStores();
        if (role === 'hq' || role === 'admin') {
            /* HQ/admin: show all stores as cards */
            amStores = [];
            if (typeof originalStoreNames !== 'undefined') {
                originalStoreNames.forEach(function(name, id) { amStores.push({ id: id, name: name }); });
                amStores.sort(function(a,b) { return a.name.localeCompare(b.name); });
            }
        }

        if (amStores.length === 0) {
            mv.innerHTML = '<div style="max-width:900px;margin:0 auto;padding:24px;text-align:center;">'
                + '<h2 class="text-2xl font-black text-slate-800 mb-2">Area Manager Dashboard</h2>'
                + '<p class="text-sm text-slate-400">No stores found for your area. Contact Head Office if this seems wrong.</p></div>';
            return;
        }

        var html = '<div style="max-width:1100px;margin:0 auto;padding:8px;">'
            + '<div class="mb-6">'
            + '<h2 class="text-2xl font-black text-slate-800">Area Overview</h2>'
            + '<p class="text-sm text-slate-400">' + amStores.length + ' store' + (amStores.length > 1 ? 's' : '') + ' \u2022 ' + (user ? user.name : '') + '</p>'
            + '</div>';

        /* ── Store Cards ── */
        html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">';

        for (var i = 0; i < amStores.length; i++) {
            var store = amStores[i];
            var cardHtml = await _renderStoreCard(store);
            html += cardHtml;
        }
        html += '</div>';

        /* ── Pending Leave Requests ── */
        html += await _renderLeaveSection(amStores);

        html += '</div>';
        mv.innerHTML = html;
    }

    /* ─── Single store card ─────────────────────────────────────── */
    async function _renderStoreCard(store) {
        var staff = [];
        var weekData = null;
        var pendingMsgs = 0;
        try { staff = await Rota.loadStaff(store.id); } catch(e) {}
        try {
            var monday = Rota.getMonday(new Date());
            weekData = await Rota.loadWeek(store.id, monday);
        } catch(e) {}
        try {
            if (typeof Messages !== 'undefined') {
                var msgs = Messages.getForStore(store.id);
                pendingMsgs = msgs.filter(function(m) { return !Messages.hasStoreResponded(m.id, store.id); }).length;
            }
        } catch(e) {}

        var shifts = weekData ? weekData.shifts : {};
        var days = Rota.DAYS;
        var dayLabels = Rota.DAY_LABELS;
        var todayDate = _today();
        var monday = Rota.getMonday(new Date());
        var weekDates = Rota.getWeekDates(monday);

        /* Calculate stats */
        var totalHeadcount = staff.length;
        var absentToday = 0;
        var totalHoursWeek = 0;

        staff.forEach(function(person) {
            var personShifts = shifts[person.id] || {};
            days.forEach(function(day) {
                totalHoursWeek += Rota.calcDayHours(personShifts[day] || {});
            });
            var todayShift = personShifts[new Date().getDay() === 0 ? 'sun' : days[new Date().getDay()]] || {};
            if (todayShift.type === 'sick' || todayShift.type === 'absent' || todayShift.type === 'holiday') absentToday++;
        });

        var absentColor = absentToday > 0 ? '#DC2626' : '#059669';
        var absentBg = absentToday > 0 ? '#FEF2F2' : '#F0FDF4';

        var html = '<div class="card p-4" style="border-top:3px solid #6E8E6D;">'
            + '<div class="flex items-center justify-between mb-3">'
            + '<div>'
            + '<h3 class="text-sm font-black text-slate-800">' + _esc(store.name) + '</h3>'
            + '<p class="text-[10px] text-slate-400">' + totalHeadcount + ' staff \u2022 ' + totalHoursWeek.toFixed(1) + ' hrs/week</p>'
            + '</div>'
            + '<div class="flex items-center gap-2">';

        /* KPI sparkline */
        try {
            if (typeof DataSnippets !== 'undefined') {
                var kpiHtml = await DataSnippets.kpiTrend(store.name, 1);
                html += '<div style="font-size:9px;">' + kpiHtml + '</div>';
            }
        } catch(e) {}

        if (absentToday > 0) {
            html += '<span style="background:' + absentBg + ';color:' + absentColor + ';font-size:10px;font-weight:800;padding:3px 8px;border-radius:99px;">' + absentToday + ' absent today</span>';
        }
        if (pendingMsgs > 0) {
            html += '<span style="background:#EFF6FF;color:#3B82F6;font-size:10px;font-weight:800;padding:3px 8px;border-radius:99px;">' + pendingMsgs + ' messages</span>';
        }
        html += '</div></div>';

        /* Mini rota grid */
        if (staff.length > 0) {
            html += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:9px;">'
                + '<thead><tr style="border-bottom:1px solid #E2E8F0;">'
                + '<th style="padding:3px 4px;text-align:left;min-width:70px;font-size:8px;font-weight:800;color:#64748B;">Name</th>';
            days.forEach(function(day, i) {
                var isToday = weekDates[i] === todayDate;
                html += '<th style="padding:3px;text-align:center;min-width:40px;' + (isToday ? 'background:#6E8E6D;color:#fff;border-radius:3px;' : '') + '">'
                    + '<span style="font-size:7px;font-weight:800;">' + dayLabels[i] + '</span></th>';
            });
            html += '<th style="padding:3px;text-align:center;font-size:8px;font-weight:800;color:#64748B;">H</th></tr></thead><tbody>';

            staff.slice(0, 8).forEach(function(person) {
                var personShifts = shifts[person.id] || {};
                var totalH = 0;
                html += '<tr style="border-bottom:1px solid #F1F5F9;">'
                    + '<td style="padding:2px 4px;font-weight:700;color:#1E293B;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70px;">' + _esc(person.name.split(' ')[0]) + '</td>';
                days.forEach(function(day) {
                    var shift = personShifts[day] || {};
                    var dayType = shift.type || '';
                    var hours = Rota.calcDayHours(shift);
                    totalH += hours;
                    var bg = '', color = '', txt = '';
                    if (dayType === 'off') { bg = '#F8FAFC'; color = '#CBD5E1'; txt = '-'; }
                    else if (dayType === 'sick') { bg = '#FEF2F2'; color = '#DC2626'; txt = 'S'; }
                    else if (dayType === 'holiday') { bg = '#EFF6FF'; color = '#2563EB'; txt = 'H'; }
                    else if (dayType === 'absent') { bg = '#FEF3C7'; color = '#D97706'; txt = 'A'; }
                    else if (shift.start) { bg = '#F0FDF4'; color = '#166534'; txt = shift.start.slice(0,5); }
                    html += '<td style="padding:1px;text-align:center;background:' + bg + ';border:1px solid #E2E8F0;border-radius:2px;color:' + color + ';font-weight:700;font-size:8px;">' + txt + '</td>';
                });
                html += '<td style="padding:2px;text-align:center;font-weight:800;color:#64748B;font-size:8px;">' + totalH.toFixed(0) + '</td>';
                html += '</tr>';
            });

            if (staff.length > 8) {
                html += '<tr><td colspan="9" style="padding:3px;text-align:center;color:#94A3B8;font-size:8px;">+' + (staff.length - 8) + ' more staff</td></tr>';
            }
            html += '</tbody></table></div>';
        } else {
            html += '<p class="text-[10px] text-slate-400 text-center py-2">No staff on rota</p>';
        }

        /* Action buttons */
        html += '<div class="flex gap-2 mt-3">'
            + '<button onclick="AreaDashboard.openStoreRota(\'' + store.id + '\')" style="background:#6E8E6D;color:#fff;font-size:10px;font-weight:700;padding:5px 10px;border-radius:5px;border:none;cursor:pointer;">View Rota</button>'
            + '<button onclick="AreaDashboard.messageStore(\'' + store.id + '\',\'' + _esc(store.name) + '\')" style="background:#3B82F6;color:#fff;font-size:10px;font-weight:700;padding:5px 10px;border-radius:5px;border:none;cursor:pointer;">Message</button>'
            + '</div>';

        html += '</div>';
        return html;
    }

    /* ─── Leave requests section ────────────────────────────────── */
    async function _leaveSectionHTML(amStores) { return ''; }

    async function _renderLeaveSection(amStores) {
        var allLeave = [];
        for (var i = 0; i < amStores.length; i++) {
            try {
                var leave = await Rota.loadLeave(amStores[i].id);
                allLeave = allLeave.concat(leave);
            } catch(e) {}
        }

        var pending = allLeave.filter(function(l) { return l.approved === null || l.approved === undefined; });
        var recent = allLeave.filter(function(l) { return l.approved !== null && l.approved !== undefined; })
            .sort(function(a,b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); })
            .slice(0, 5);

        var html = '<div class="mb-6">'
            + '<h2 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Leave Requests</h2>';

        if (pending.length === 0 && recent.length === 0) {
            html += '<div class="card p-4 text-center text-slate-400"><p class="text-xs">No leave requests</p></div>';
        } else {
            if (pending.length > 0) {
                html += '<div class="space-y-2 mb-4">';
                pending.forEach(function(l) {
                    var typeName = l.type === 'holiday' ? 'Annual Leave' : l.type === 'sick' ? 'Sick Leave' : l.type || 'Leave';
                    html += '<div class="card p-3 flex items-center gap-3" style="border-left:3px solid #D97706;">'
                        + '<div class="flex-1">'
                        + '<p class="text-sm font-bold text-slate-700">' + _esc(l.staffName || 'Unknown') + ' \u2014 ' + _esc(typeName) + '</p>'
                        + '<p class="text-[10px] text-slate-400">' + _esc(l.startDate || '') + ' to ' + _esc(l.endDate || '') + '</p>'
                        + '</div>'
                        + '<button onclick="AreaDashboard.approveLeave(\'' + l.id + '\',true)" style="background:#059669;color:#fff;font-size:10px;font-weight:700;padding:5px 10px;border-radius:5px;border:none;cursor:pointer;">Approve</button>'
                        + '<button onclick="AreaDashboard.approveLeave(\'' + l.id + '\',false)" style="background:#DC2626;color:#fff;font-size:10px;font-weight:700;padding:5px 10px;border-radius:5px;border:none;cursor:pointer;">Reject</button>'
                        + '</div>';
                });
                html += '</div>';
            }
            if (recent.length > 0) {
                html += '<div class="space-y-1">';
                recent.forEach(function(l) {
                    var statusColor = l.approved ? '#059669' : '#DC2626';
                    var statusLabel = l.approved ? 'Approved' : 'Rejected';
                    html += '<div class="card p-2 flex items-center gap-2">'
                        + '<span style="width:6px;height:6px;border-radius:50%;background:' + statusColor + ';"></span>'
                        + '<span class="text-[10px] font-bold text-slate-600">' + _esc(l.staffName || '') + '</span>'
                        + '<span class="text-[10px] text-slate-400">' + _esc(l.startDate || '') + ' \u2013 ' + _esc(l.endDate || '') + '</span>'
                        + '<span style="font-size:9px;font-weight:800;color:' + statusColor + ';margin-left:auto;">' + statusLabel + '</span>'
                        + '</div>';
                });
                html += '</div>';
            }
        }
        html += '</div>';
        return html;
    }

    /* ─── Actions ───────────────────────────────────────────────── */
    function openStoreRota(storeId) {
        if (typeof Rota !== 'undefined') {
            Rota.renderStoreRota(storeId);
        }
    }

    function messageStore(storeId, storeName) {
        if (typeof Messages !== 'undefined') {
            setView('shop-messages');
        }
    }

    async function approveLeave(leaveId, approved) {
        var leave = (await idbGetAll('rota_leave')).find(function(l) { return l.id === leaveId; });
        if (!leave) return;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        leave.approved = approved;
        leave.approvedBy = user ? user.name : '';
        leave.approvedAt = new Date().toISOString();
        await Rota.saveLeave(leave);
        showToast('Leave ' + (approved ? 'approved' : 'rejected'), 'success');
        render();
    }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        render: render,
        openStoreRota: openStoreRota,
        messageStore: messageStore,
        approveLeave: approveLeave
    };
})();
