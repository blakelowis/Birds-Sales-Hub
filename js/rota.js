/* ─── Rota Module ────────────────────────────────────────────────── */
/* Staff scheduling: weekly rota grid, shift entry, hours tracking.   */
/* Store view: simple grid. HQ view: multi-store dashboard.           */
/* Data: IDB + SharePoint JSON files.                                 */
/* ================================================================== */
window.Rota = (function() {
    'use strict';

    var DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
    var DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var DAY_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var POSITIONS = ['Manager','Asst Manager','Third','Staff'];

    var SHIFT_PRESETS = [
        { label: 'Early',   start: '06:00', end: '14:00', breakStart: '10:00', breakEnd: '10:30', color: '#6E8E6D' },
        { label: 'Late',    start: '12:00', end: '20:00', breakStart: '16:00', breakEnd: '16:30', color: '#3B82F6' },
        { label: 'Close',   start: '14:00', end: '22:00', breakStart: '18:00', breakEnd: '18:30', color: '#7C3AED' },
        { label: 'Full',    start: '07:00', end: '15:00', breakStart: '11:00', breakEnd: '11:30', color: '#D97706' },
        { label: 'Short',   start: '09:00', end: '13:00', breakStart: null,    breakEnd: null,    color: '#059669' }
    ];

    var SPECIAL_TYPES = [
        { type: 'off',     label: 'Off',     color: '#94A3B8', bg: '#F1F5F9' },
        { type: 'sick',    label: 'Sick',    color: '#DC2626', bg: '#FEF2F2' },
        { type: 'holiday', label: 'Holiday', color: '#2563EB', bg: '#EFF6FF' },
        { type: 'absent',  label: 'Absent',  color: '#D97706', bg: '#FEF3C7' }
    ];

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _uid(prefix) { return (prefix||'r') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2,6); }
    function _today() { return new Date().toISOString().slice(0,10); }

    /* ─── Week helpers ──────────────────────────────────────────── */
    function getMonday(date) {
        var d = new Date(date);
        var day = d.getDay();
        var diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        return d.toISOString().slice(0,10);
    }

    function getWeekDates(mondayStr) {
        var mon = new Date(mondayStr);
        return DAYS.map(function(_, i) {
            var d = new Date(mon);
            d.setDate(mon.getDate() + i);
            return d.toISOString().slice(0,10);
        });
    }

    function formatTime(t) {
        if (!t) return '';
        return t;
    }

    function calcShiftHours(start, end, breakMin) {
        if (!start || !end) return 0;
        var s = start.split(':').map(Number);
        var e = end.split(':').map(Number);
        var mins = (e[0] * 60 + e[1]) - (s[0] * 60 + s[1]);
        if (mins < 0) mins += 24 * 60; /* overnight */
        mins -= (breakMin || 0);
        return Math.max(0, mins / 60);
    }

    function calcDayHours(shift) {
        if (!shift || shift.type === 'off' || shift.type === 'sick' || shift.type === 'holiday' || shift.type === 'absent') return 0;
        if (!shift.start || !shift.end) return 0;
        var breakMins = 0;
        if (shift.breakStart && shift.breakEnd) {
            var bs = shift.breakStart.split(':').map(Number);
            var be = shift.breakEnd.split(':').map(Number);
            breakMins = (be[0] * 60 + be[1]) - (bs[0] * 60 + bs[1]);
        }
        return calcShiftHours(shift.start, shift.end, breakMins);
    }

    /* ─── Data: Staff CRUD ──────────────────────────────────────── */
    async function loadStaff(storeId) {
        var all = await idbGetAll('rota_staff');
        return all.filter(function(s) { return s.storeId === storeId; })
            .sort(function(a,b) {
                var po = { 'Manager': 0, 'Asst Manager': 1, 'Third': 2, 'Staff': 3 };
                return (po[a.position] || 3) - (po[b.position] || 3) || (a.name || '').localeCompare(b.name || '');
            });
    }

    async function saveStaff(staff) {
        await idbPut('rota_staff', staff);
        try {
            if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
                await GraphClient.writeFile('Rota/Staff/' + staff.id + '.json', JSON.stringify(staff, null, 2));
            }
        } catch(e) {}
    }

    async function deleteStaff(staffId) {
        await idbDelete('rota_staff', staffId);
        try {
            if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
                await GraphClient.deleteFile('Rota/Staff/' + staffId + '.json');
            }
        } catch(e) {}
    }

    /* ─── Data: Week Rota CRUD ──────────────────────────────────── */
    async function loadWeek(storeId, weekStart) {
        var all = await idbGetAll('rota_week');
        return all.find(function(w) { return w.storeId === storeId && w.weekStart === weekStart; }) || null;
    }

    async function loadWeekRange(storeId, startDate, endDate) {
        var all = await idbGetAll('rota_week');
        return all.filter(function(w) {
            return w.storeId === storeId && w.weekStart >= startDate && w.weekStart <= endDate;
        });
    }

    async function saveWeek(weekData) {
        weekData.updatedAt = new Date().toISOString();
        await idbPut('rota_week', weekData);
        try {
            if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
                await GraphClient.writeFile('Rota/Weeks/' + weekData.id + '.json', JSON.stringify(weekData, null, 2));
            }
        } catch(e) {}
    }

    /* ─── Data: Leave/Request CRUD ──────────────────────────────── */
    async function loadLeave(storeId) {
        var all = await idbGetAll('rota_leave');
        return all.filter(function(l) { return l.storeId === storeId; })
            .sort(function(a,b) { return (b.startDate || '').localeCompare(a.startDate || ''); });
    }

    async function saveLeave(leave) {
        await idbPut('rota_leave', leave);
        try {
            if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
                await GraphClient.writeFile('Rota/Leave/' + leave.id + '.json', JSON.stringify(leave, null, 2));
            }
        } catch(e) {}
    }

    async function deleteLeave(leaveId) {
        await idbDelete('rota_leave', leaveId);
        try {
            if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
                await GraphClient.deleteFile('Rota/Leave/' + leaveId + '.json');
            }
        } catch(e) {}
    }

    /* ─── Store Rota Grid ───────────────────────────────────────── */
    var _currentMonday = null;
    var _storeId = '';

    async function renderStoreRota(storeId) {
        _storeId = storeId || '';
        if (!_currentMonday) _currentMonday = getMonday(new Date());

        var mv = document.getElementById('mainView');
        if (!mv) return;

        var staff = await loadStaff(_storeId);
        var weekData = await loadWeek(_storeId, _currentMonday);
        var weekDates = getWeekDates(_currentMonday);
        var shifts = weekData ? weekData.shifts : {};

        /* Week header */
        var mon = new Date(_currentMonday);
        var sun = new Date(_currentMonday);
        sun.setDate(sun.getDate() + 6);
        var dateRange = mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' – ' + sun.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

        var html = '<div style="max-width:1100px;margin:0 auto;padding:8px;">'
            /* Header */
            + '<div class="flex items-center justify-between mb-4">'
            + '<div>'
            + '<h2 class="text-2xl font-black text-slate-800">Weekly Rota</h2>'
            + '<p class="text-sm text-slate-400">' + _esc(dateRange) + '</p>'
            + '</div>'
            + '<div class="flex items-center gap-2">'
            + '<button onclick="Rota.prevWeek()" style="background:#F1F5F9;color:#475569;font-size:12px;font-weight:700;padding:8px 12px;border-radius:6px;border:1px solid #E2E8F0;cursor:pointer;">&#8249; Prev</button>'
            + '<button onclick="Rota.thisWeek()" style="background:#6E8E6D;color:#fff;font-size:11px;font-weight:700;padding:8px 12px;border-radius:6px;border:none;cursor:pointer;">Today</button>'
            + '<button onclick="Rota.nextWeek()" style="background:#F1F5F9;color:#475569;font-size:12px;font-weight:700;padding:8px 12px;border-radius:6px;border:1px solid #E2E8F0;cursor:pointer;">Next &#8250;</button>'
            + '<button onclick="Rota.exportWeekCSV()" style="background:#fff;color:#6E8E6D;font-size:11px;font-weight:700;padding:8px 12px;border-radius:6px;border:1px solid #6E8E6D;cursor:pointer;">Export CSV</button>'
            + '<button onclick="Rota.exportAllWeeksCSV()" style="background:#fff;color:#475569;font-size:11px;font-weight:700;padding:8px 12px;border-radius:6px;border:1px solid #E2E8F0;cursor:pointer;" title="Export all weeks for payroll">Export All</button>'
            + '</div></div>';

        /* Rota table */
        html += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">'
            + '<thead><tr style="background:#F8FAFC;border-bottom:2px solid #E2E8F0;">'
            + '<th style="padding:8px 12px;text-align:left;min-width:140px;font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;">Staff</th>';

        DAYS.forEach(function(day, i) {
            var d = new Date(weekDates[i]);
            var isToday = weekDates[i] === _today();
            var dayBg = isToday ? 'background:#6E8E6D;color:#fff;' : '';
            html += '<th style="padding:8px;text-align:center;min-width:100px;' + dayBg + '">'
                + '<div style="font-size:10px;font-weight:800;text-transform:uppercase;">' + DAY_LABELS[i] + '</div>'
                + '<div style="font-size:9px;opacity:0.7;">' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '</div>'
                + '</th>';
        });
        html += '<th style="padding:8px;text-align:center;min-width:60px;font-size:10px;font-weight:800;color:#64748B;">HRS</th>';
        html += '</tr></thead><tbody>';

        if (staff.length === 0) {
            html += '<tr><td colspan="9" style="padding:24px;text-align:center;color:#94A3B8;">No staff added yet. Click "+ Add Staff" to get started.</td></tr>';
        }

        staff.forEach(function(person) {
            var personShifts = shifts[person.id] || {};
            var totalHours = 0;

            html += '<tr style="border-bottom:1px solid #F1F5F9;">'
                + '<td style="padding:8px 12px;">'
                + '<div style="font-weight:700;color:#1E293B;font-size:12px;cursor:pointer;" onclick="Rota.showEditStaff(\'' + person.id + '\')">' + _esc(person.name) + ' <span style="font-size:8px;color:#94A3B8;">&#9998;</span></div>'
                + '<div style="font-size:9px;color:#94A3B8;">' + _esc(person.position || '') + ' \u2022 #' + _esc(person.employeeNo || '') + '</div>'
                + '</td>';

        DAYS.forEach(function(day, i) {
            var shift = personShifts[day] || {};
            var dayType = shift.type || 'shift';
            var hours = calcDayHours(shift);
            totalHours += hours;

            var cellBg = '', cellText = '', cellColor = '';
            if (dayType === 'off' || dayType === 'sick' || dayType === 'holiday' || dayType === 'absent') {
                var spec = SPECIAL_TYPES.find(function(s) { return s.type === dayType; });
                cellBg = spec ? spec.bg : '#F1F5F9';
                cellColor = spec ? spec.color : '#94A3B8';
                cellText = spec ? spec.label : dayType;
            } else if (shift.start) {
                cellBg = '#F0FDF4';
                cellColor = '#166534';
                cellText = shift.start + '-' + shift.end;
                if (shift.breakStart) cellText += '<br><span style="font-size:8px;color:#94A3B8;">Break ' + shift.breakStart + '</span>';
            }

            html += '<td style="padding:4px;text-align:center;cursor:pointer;min-width:100px;'
                + 'background:' + cellBg + ';border:1px solid #E2E8F0;border-radius:4px;'
                + 'font-size:11px;font-weight:600;color:' + cellColor + ';'
                + 'transition:all .1s;" '
                + 'onclick="Rota.editShift(\'' + person.id + '\',\'' + day + '\',\'' + weekDates[i] + '\')" '
                + 'onmouseover="this.style.opacity=\'0.8\'" onmouseout="this.style.opacity=\'1\'">'
                + cellText + '</td>';
        });

        var contracted = person.contractedHours || 0;
        var hrsColor = contracted > 0 ? (totalHours > contracted ? '#DC2626' : totalHours < contracted ? '#D97706' : '#059669') : '#64748B';
        html += '<td style="padding:8px;text-align:center;font-weight:800;color:' + hrsColor + ';">' + totalHours.toFixed(1) + (contracted > 0 ? '/' + contracted : '') + '</td>';
        html += '</tr>';
        });

        /* Totals row */
        html += '<tr style="background:#F8FAFC;border-top:2px solid #E2E8F0;">'
            + '<td style="padding:8px 12px;font-weight:800;font-size:10px;color:#64748B;text-transform:uppercase;">Daily Total</td>';
        var grandTotal = 0;
        DAYS.forEach(function(day) {
            var dayTotal = 0;
            staff.forEach(function(person) {
                var personShifts = (weekData && weekData.shifts) ? (weekData.shifts[person.id] || {}) : {};
                dayTotal += calcDayHours(personShifts[day] || {});
            });
            grandTotal += dayTotal;
            html += '<td style="padding:8px;text-align:center;font-weight:800;font-size:11px;color:#1E293B;">' + dayTotal.toFixed(1) + '</td>';
        });
        html += '<td style="padding:8px;text-align:center;font-weight:800;font-size:11px;color:#6E8E6D;">' + grandTotal.toFixed(1) + '</td>';
        html += '</tr>';

        html += '</tbody></table></div>';

        /* Action buttons */
        var shareBtn = (typeof Access !== 'undefined' && typeof Users !== 'undefined' && Users.getRole() !== 'shop')
            ? '<button onclick="Access.showShareModal(\'rota\',[\'' + _esc(_storeId) + '\'])" style="background:#3B82F6;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;">Share</button>'
            : '';
        html += '<div class="flex gap-2 mt-4">'
            + '<button onclick="Rota.showAddStaff()" style="background:#6E8E6D;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;">+ Add Staff</button>'
            + '<button onclick="Rota.fillFromPrevious()" style="background:#F1F5F9;color:#475569;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;border:1px solid #E2E8F0;cursor:pointer;">Copy Last Week</button>'
            + '<button onclick="Rota.printRota()" style="background:#F1F5F9;color:#475569;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;border:1px solid #E2E8F0;cursor:pointer;">Print</button>'
            + shareBtn
            + '</div>';

        html += '<div id="rotaModal"></div>';
        mv.innerHTML = html;
    }

    /* ─── Week Navigation ───────────────────────────────────────── */
    function prevWeek() {
        var d = new Date(_currentMonday);
        d.setDate(d.getDate() - 7);
        _currentMonday = d.toISOString().slice(0,10);
        renderStoreRota(_storeId);
    }

    function nextWeek() {
        var d = new Date(_currentMonday);
        d.setDate(d.getDate() + 7);
        _currentMonday = d.toISOString().slice(0,10);
        renderStoreRota(_storeId);
    }

    function thisWeek() {
        _currentMonday = getMonday(new Date());
        renderStoreRota(_storeId);
    }

    /* ─── Edit Shift Modal ──────────────────────────────────────── */
    async function editShift(staffId, day, dateStr) {
        var modal = document.getElementById('rotaModal');
        if (!modal) return;

        var weekData = await loadWeek(_storeId, _currentMonday) || { id: _uid('rw'), storeId: _storeId, weekStart: _currentMonday, shifts: {} };
        if (!weekData.shifts) weekData.shifts = {};
        if (!weekData.shifts[staffId]) weekData.shifts[staffId] = {};
        var shift = weekData.shifts[staffId][day] || {};

        var html = '<div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="Rota.closeModal(event)">'
            + '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onclick="event.stopPropagation()">'
            + '<div class="p-5 border-b border-slate-100">'
            + '<h3 class="text-lg font-black text-slate-800">Edit Shift</h3>'
            + '<p class="text-xs text-slate-400">' + DAY_FULL[DAYS.indexOf(day)] + ' ' + _esc(dateStr) + '</p>'
            + '</div>'
            + '<div class="p-5 space-y-3">'

            /* Quick presets */
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-2">Quick Fill</label>'
            + '<div class="flex flex-wrap gap-1">';
        SHIFT_PRESETS.forEach(function(p) {
            html += '<button onclick="Rota.applyPreset(\'' + staffId + '\',\'' + day + '\',\'' + p.start + '\',\'' + p.end + '\',' + (p.breakStart ? "'" + p.breakStart + "'" : 'null') + ',' + (p.breakEnd ? "'" + p.breakEnd + "'" : 'null') + ')" '
                + 'style="background:' + p.color + ';color:#fff;font-size:10px;font-weight:700;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;">' + p.label + '</button>';
        });
        SPECIAL_TYPES.forEach(function(s) {
            html += '<button onclick="Rota.applySpecial(\'' + staffId + '\',\'' + day + '\',\'' + s.type + '\')" '
                + 'style="background:' + s.color + ';color:#fff;font-size:10px;font-weight:700;padding:5px 10px;border-radius:4px;border:none;cursor:pointer;">' + s.label + '</button>';
        });
        html += '</div></div>';

        /* Manual times */
        html += '<div class="grid grid-cols-2 gap-2">'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Start</label>'
            + '<input type="time" id="rotaStart" value="' + _esc(shift.start || '') + '" class="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"></div>'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">End</label>'
            + '<input type="time" id="rotaEnd" value="' + _esc(shift.end || '') + '" class="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"></div>'
            + '</div>'
            + '<div class="grid grid-cols-2 gap-2">'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Break Start</label>'
            + '<input type="time" id="rotaBreakStart" value="' + _esc(shift.breakStart || '') + '" class="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"></div>'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Break End</label>'
            + '<input type="time" id="rotaBreakEnd" value="' + _esc(shift.breakEnd || '') + '" class="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"></div>'
            + '</div>';

        html += '</div>'
            + '<div class="p-5 border-t border-slate-100 flex justify-end gap-2">'
            + '<button onclick="Rota.saveShiftFromModal(\'' + staffId + '\',\'' + day + '\')" style="background:#6E8E6D;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;">Save</button>'
            + '<button onclick="Rota.clearModal()" style="background:#F1F5F9;color:#475569;font-size:12px;font-weight:700;padding:8px 12px;border-radius:6px;border:none;cursor:pointer;">Clear</button>'
            + '</div></div></div>';

        modal.innerHTML = html;
    }

    function closeModal(e) {
        if (e && e.target && !e.target.classList.contains('fixed')) return;
        clearModal();
    }

    function clearModal() {
        var modal = document.getElementById('rotaModal');
        if (modal) modal.innerHTML = '';
    }

    async function applyPreset(staffId, day, start, end, breakStart, breakEnd) {
        var weekData = await loadWeek(_storeId, _currentMonday) || { id: _uid('rw'), storeId: _storeId, weekStart: _currentMonday, shifts: {} };
        if (!weekData.shifts) weekData.shifts = {};
        if (!weekData.shifts[staffId]) weekData.shifts[staffId] = {};
        weekData.shifts[staffId][day] = { type: 'shift', start: start, end: end, breakStart: breakStart || '', breakEnd: breakEnd || '' };
        await saveWeek(weekData);
        clearModal();
        renderStoreRota(_storeId);
    }

    async function applySpecial(staffId, day, type) {
        var weekData = await loadWeek(_storeId, _currentMonday) || { id: _uid('rw'), storeId: _storeId, weekStart: _currentMonday, shifts: {} };
        if (!weekData.shifts) weekData.shifts = {};
        if (!weekData.shifts[staffId]) weekData.shifts[staffId] = {};
        weekData.shifts[staffId][day] = { type: type };
        await saveWeek(weekData);
        clearModal();
        renderStoreRota(_storeId);
    }

    async function saveShiftFromModal(staffId, day) {
        var start = document.getElementById('rotaStart').value;
        var end = document.getElementById('rotaEnd').value;
        var breakStart = document.getElementById('rotaBreakStart').value;
        var breakEnd = document.getElementById('rotaBreakEnd').value;

        var weekData = await loadWeek(_storeId, _currentMonday) || { id: _uid('rw'), storeId: _storeId, weekStart: _currentMonday, shifts: {} };
        if (!weekData.shifts) weekData.shifts = {};
        if (!weekData.shifts[staffId]) weekData.shifts[staffId] = {};

        if (!start && !end) {
            weekData.shifts[staffId][day] = { type: 'off' };
        } else {
            weekData.shifts[staffId][day] = { type: 'shift', start: start, end: end, breakStart: breakStart, breakEnd: breakEnd };
        }
        await saveWeek(weekData);
        clearModal();
        renderStoreRota(_storeId);
    }

    /* ─── Add Staff Modal ───────────────────────────────────────── */
    function showAddStaff() {
        var modal = document.getElementById('rotaModal');
        if (!modal) return;

        modal.innerHTML = '<div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="Rota.closeModal(event)">'
            + '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onclick="event.stopPropagation()">'
            + '<div class="p-5 border-b border-slate-100"><h3 class="text-lg font-black text-slate-800">Add Staff Member</h3></div>'
            + '<div class="p-5 space-y-3">'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Name *</label>'
            + '<input type="text" id="rotaStaffName" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Full name"></div>'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Employee Number</label>'
            + '<input type="text" id="rotaStaffNo" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 1234"></div>'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Position</label>'
            + '<select id="rotaStaffPos" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">'
            + '<option value="Staff">Staff</option><option value="Third">Third</option><option value="Asst Manager">Asst Manager</option><option value="Manager">Manager</option></select></div>'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Contracted Hours/Week</label>'
            + '<input type="number" id="rotaStaffHours" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 36" min="0"></div>'
            + '<div class="grid grid-cols-2 gap-2">'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Annual Holiday Days</label>'
            + '<input type="number" id="rotaStaffHoliday" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="28" min="0"></div>'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Annual Sick Days</label>'
            + '<input type="number" id="rotaStaffSick" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="10" min="0"></div>'
            + '</div>'
            + '</div>'
            + '<div class="p-5 border-t border-slate-100 flex justify-end gap-2">'
            + '<button onclick="Rota.doAddStaff()" style="background:#6E8E6D;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;">Add</button>'
            + '<button onclick="Rota.clearModal()" style="background:#F1F5F9;color:#475569;font-size:12px;font-weight:700;padding:8px 12px;border-radius:6px;border:none;cursor:pointer;">Cancel</button>'
            + '</div></div></div>';
        document.getElementById('rotaStaffName').focus();
    }

    async function doAddStaff() {
        var name = (document.getElementById('rotaStaffName').value || '').trim();
        if (!name) { alert('Enter a name'); return; }
        var staff = {
            id: _uid('rs'),
            storeId: _storeId,
            name: name,
            employeeNo: document.getElementById('rotaStaffNo').value || '',
            position: document.getElementById('rotaStaffPos').value || 'Staff',
            contractedHours: parseInt(document.getElementById('rotaStaffHours').value) || 0,
            annualHolidayDays: parseInt(document.getElementById('rotaStaffHoliday').value) || 28,
            annualSickDays: parseInt(document.getElementById('rotaStaffSick').value) || 10,
            createdAt: new Date().toISOString()
        };
        await saveStaff(staff);
        clearModal();
        renderStoreRota(_storeId);
        if (typeof showToast === 'function') showToast('Staff member added', 'success');
    }

    /* ─── Copy from Previous Week ───────────────────────────────── */
    async function fillFromPrevious() {
        var prevMon = new Date(_currentMonday);
        prevMon.setDate(prevMon.getDate() - 7);
        var prevMonday = prevMon.toISOString().slice(0,10);
        var prevWeek = await loadWeek(_storeId, prevMonday);
        if (!prevWeek) { alert('No rota found for the previous week.'); return; }
        var currentWeek = await loadWeek(_storeId, _currentMonday) || { id: _uid('rw'), storeId: _storeId, weekStart: _currentMonday, shifts: {} };
        currentWeek.shifts = JSON.parse(JSON.stringify(prevWeek.shifts || {}));
        await saveWeek(currentWeek);
        renderStoreRota(_storeId);
        if (typeof showToast === 'function') showToast('Copied from previous week', 'success');
    }

    /* ─── Print ─────────────────────────────────────────────────── */
    function printRota() {
        window.print();
    }

    /* ─── HQ Admin: Store Picker + Rota ─────────────────────────── */
    async function renderHQAdmin() {
        var mv = document.getElementById('mainView');
        if (!mv) return;

        var stores = [];
        if (typeof originalStoreNames !== 'undefined') {
            originalStoreNames.forEach(function(name, id) { stores.push({ id: id, name: name }); });
            stores.sort(function(a,b) { return a.name.localeCompare(b.name); });
        }

        /* Scope stores by role */
        var role = (typeof Users !== 'undefined') ? Users.getRole() : 'hq';
        if (role === 'shop') {
            /* Shop users: redirect to their own rota */
            var user = Users.getCurrentUser();
            if (user && user.shopStoreId) {
                _storeId = user.shopStoreId;
                _currentMonday = getMonday(new Date());
                renderStoreRota(user.shopStoreId);
                return;
            }
        }
        if (role === 'area_manager') {
            /* Area managers: only their stores */
            var accessibleIds = (typeof Access !== 'undefined') ? Access.getAccessibleStores() : [];
            stores = stores.filter(function(s) { return accessibleIds.indexOf(s.id) >= 0; });
        }
        /* hq + admin: all stores (no filter) */

        var html = '<div style="max-width:1100px;margin:0 auto;padding:8px;">'
            + '<div class="flex items-center justify-between mb-4">'
            + '<div>'
            + '<h2 class="text-2xl font-black text-slate-800">Rota Admin</h2>'
            + '<p class="text-sm text-slate-400">' + stores.length + ' store' + (stores.length !== 1 ? 's' : '') + ' available</p>'
            + '</div>'
            + '<div id="rotaShareBtn"></div>'
            + '</div>'
            + '<div class="mb-4">'
            + '<label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Select Store</label>'
            + '<select id="hqRotaStorePick" onchange="Rota.onHQStoreChange()" class="w-full max-w-sm border border-slate-200 rounded-lg px-3 py-2 text-sm">'
            + '<option value="">-- Choose a store --</option>';
        stores.forEach(function(s) {
            html += '<option value="' + _esc(s.id) + '">' + _esc(s.name) + '</option>';
        });
        html += '</select></div>'
            + '<div id="hqRotaGrid"></div></div>';
        mv.innerHTML = html;
    }

    function onHQStoreChange() {
        var sel = document.getElementById('hqRotaStorePick');
        var storeId = sel ? sel.value : '';
        var grid = document.getElementById('hqRotaGrid');
        if (!grid) return;
        if (!storeId) { grid.innerHTML = '<p class="text-sm text-slate-400 text-center py-8">Select a store to view its rota</p>'; return; }
        _storeId = storeId;
        _currentMonday = getMonday(new Date());
        renderStoreRota(storeId);
    }

    /* ─── Edit Staff Modal ──────────────────────────────────────── */
    async function showEditStaff(staffId) {
        var staff = (await loadStaff(_storeId)).find(function(s) { return s.id === staffId; });
        if (!staff) return;
        var modal = document.getElementById('rotaModal');
        if (!modal) return;

        modal.innerHTML = '<div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="Rota.closeModal(event)">'
            + '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onclick="event.stopPropagation()">'
            + '<div class="p-5 border-b border-slate-100"><h3 class="text-lg font-black text-slate-800">Edit Staff</h3></div>'
            + '<div class="p-5 space-y-3">'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Name *</label>'
            + '<input type="text" id="rotaEditName" value="' + _esc(staff.name) + '" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Employee Number</label>'
            + '<input type="text" id="rotaEditNo" value="' + _esc(staff.employeeNo || '') + '" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Position</label>'
            + '<select id="rotaEditPos" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">'
            + '<option value="Staff"' + (staff.position === 'Staff' ? ' selected' : '') + '>Staff</option>'
            + '<option value="Third"' + (staff.position === 'Third' ? ' selected' : '') + '>Third</option>'
            + '<option value="Asst Manager"' + (staff.position === 'Asst Manager' ? ' selected' : '') + '>Asst Manager</option>'
            + '<option value="Manager"' + (staff.position === 'Manager' ? ' selected' : '') + '>Manager</option></select></div>'
            + '<div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Contracted Hours/Week</label>'
            + '<input type="number" id="rotaEditHours" value="' + (staff.contractedHours || '') + '" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" min="0"></div>'
            + '</div>'
            + '<div class="p-5 border-t border-slate-100 flex justify-between">'
            + '<button onclick="Rota.doDeleteStaff(\'' + staffId + '\')" style="background:#FEE2E2;color:#DC2626;font-size:11px;font-weight:700;padding:6px 12px;border-radius:6px;border:none;cursor:pointer;">Delete</button>'
            + '<div class="flex gap-2">'
            + '<button onclick="Rota.doSaveStaff(\'' + staffId + '\')" style="background:#6E8E6D;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;">Save</button>'
            + '<button onclick="Rota.clearModal()" style="background:#F1F5F9;color:#475569;font-size:12px;font-weight:700;padding:8px 12px;border-radius:6px;border:none;cursor:pointer;">Cancel</button>'
            + '</div></div></div>';
    }

    async function doSaveStaff(staffId) {
        var all = await loadStaff(_storeId);
        var staff = all.find(function(s) { return s.id === staffId; });
        if (!staff) return;
        staff.name = (document.getElementById('rotaEditName').value || '').trim();
        staff.employeeNo = document.getElementById('rotaEditNo').value || '';
        staff.position = document.getElementById('rotaEditPos').value || 'Staff';
        staff.contractedHours = parseInt(document.getElementById('rotaEditHours').value) || 0;
        if (!staff.name) { alert('Name is required'); return; }
        await saveStaff(staff);
        clearModal();
        renderStoreRota(_storeId);
        if (typeof showToast === 'function') showToast('Staff updated', 'success');
    }

    async function doDeleteStaff(staffId) {
        if (!confirm('Remove this staff member from the rota?')) return;
        await deleteStaff(staffId);
        clearModal();
        renderStoreRota(_storeId);
        if (typeof showToast === 'function') showToast('Staff removed', 'success');
    }

    /* ─── CSV Export for Payroll ───────────────────────────────── */
    function _csvEscape(val) {
        var s = String(val == null ? '' : val);
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    function _downloadCSV(csvContent, filename) {
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function exportWeekCSV(storeId, weekStart) {
        storeId = storeId || _storeId;
        weekStart = weekStart || _currentMonday;
        if (!storeId) { alert('No store selected'); return; }
        var staff = await loadStaff(storeId);
        var weekData = await loadWeek(storeId, weekStart);
        var shifts = weekData ? weekData.shifts : {};
        var weekDates = getWeekDates(weekStart);

        var rows = ['Staff Name,Position,Contracted Hours,Day,Date,Shift Start,Shift End,Break Start,Break End,Hours,Type'];
        staff.forEach(function(person) {
            var personShifts = shifts[person.id] || {};
            var totalHours = 0;
            DAYS.forEach(function(day, i) {
                var shift = personShifts[day] || {};
                var dayType = shift.type || '';
                var hours = calcDayHours(shift);
                totalHours += hours;
                rows.push([
                    _csvEscape(person.name),
                    _csvEscape(person.position || ''),
                    person.contractedHours || 0,
                    DAY_LABELS[i],
                    weekDates[i] || '',
                    shift.start || '',
                    shift.end || '',
                    shift.breakStart || '',
                    shift.breakEnd || '',
                    hours.toFixed(2),
                    dayType || (shift.start ? 'Working' : '')
                ].join(','));
            });
            /* Total row */
            var contracted = person.contractedHours || 0;
            var overtime = Math.max(0, totalHours - contracted);
            rows.push([
                _csvEscape(person.name + ' (TOTAL)'),
                '',
                contracted,
                '',
                '',
                '',
                '',
                '',
                '',
                totalHours.toFixed(2),
                overtime > 0 ? 'OT: ' + overtime.toFixed(2) : ''
            ].join(','));
        });

        var csv = rows.join('\n');
        var storeName = (typeof originalStoreNames !== 'undefined' && storeId) ? (originalStoreNames.get(storeId) || storeId) : storeId;
        _downloadCSV(csv, 'Rota_' + storeName.replace(/[^a-zA-Z0-9]/g, '_') + '_' + weekStart + '.csv');
        if (typeof showToast === 'function') showToast('Rota exported for payroll', 'success');
    }

    async function exportAllWeeksCSV(storeId) {
        storeId = storeId || _storeId;
        if (!storeId) { alert('No store selected'); return; }
        var staff = await loadStaff(storeId);
        var allWeeks = (await idbGetAll('rota_week')).filter(function(w) { return w.storeId === storeId; });
        allWeeks.sort(function(a, b) { return (a.weekStart || '').localeCompare(b.weekStart || ''); });

        var rows = ['Staff Name,Position,Contracted Hours,Week Starting,Mon,Tue,Wed,Thu,Fri,Sat,Sun,Total Hours,Overtime'];
        staff.forEach(function(person) {
            allWeeks.forEach(function(week) {
                var shifts = week.shifts || {};
                var personShifts = shifts[person.id] || {};
                var dayHours = [];
                var totalHours = 0;
                DAYS.forEach(function(day) {
                    var shift = personShifts[day] || {};
                    var hours = calcDayHours(shift);
                    dayHours.push(hours);
                    totalHours += hours;
                });
                var contracted = person.contractedHours || 0;
                var overtime = Math.max(0, totalHours - contracted);
                rows.push([
                    _csvEscape(person.name),
                    _csvEscape(person.position || ''),
                    contracted,
                    week.weekStart || '',
                    dayHours[1].toFixed(2),
                    dayHours[2].toFixed(2),
                    dayHours[3].toFixed(2),
                    dayHours[4].toFixed(2),
                    dayHours[5].toFixed(2),
                    dayHours[6].toFixed(2),
                    dayHours[0].toFixed(2),
                    totalHours.toFixed(2),
                    overtime > 0 ? overtime.toFixed(2) : ''
                ].join(','));
            });
        });

        var csv = rows.join('\n');
        var storeName = (typeof originalStoreNames !== 'undefined' && storeId) ? (originalStoreNames.get(storeId) || storeId) : storeId;
        _downloadCSV(csv, 'Rota_AllWeeks_' + storeName.replace(/[^a-zA-Z0-9]/g, '_') + '.csv');
        if (typeof showToast === 'function') showToast('All weeks exported for payroll', 'success');
    }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        renderStoreRota: renderStoreRota,
        renderHQAdmin: renderHQAdmin,
        onHQStoreChange: onHQStoreChange,
        showEditStaff: showEditStaff,
        doSaveStaff: doSaveStaff,
        doDeleteStaff: doDeleteStaff,
        prevWeek: prevWeek,
        nextWeek: nextWeek,
        thisWeek: thisWeek,
        editShift: editShift,
        closeModal: closeModal,
        clearModal: clearModal,
        applyPreset: applyPreset,
        applySpecial: applySpecial,
        saveShiftFromModal: saveShiftFromModal,
        showAddStaff: showAddStaff,
        doAddStaff: doAddStaff,
        fillFromPrevious: fillFromPrevious,
        printRota: printRota,
        exportWeekCSV: exportWeekCSV,
        exportAllWeeksCSV: exportAllWeeksCSV,
        loadStaff: loadStaff,
        loadWeek: loadWeek,
        loadLeave: loadLeave,
        saveLeave: saveLeave,
        calcDayHours: calcDayHours,
        getMonday: getMonday,
        getWeekDates: getWeekDates,
        DAYS: DAYS,
        DAY_LABELS: DAY_LABELS,
        SHIFT_PRESETS: SHIFT_PRESETS,
        SPECIAL_TYPES: SPECIAL_TYPES
    };
})();
