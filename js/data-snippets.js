/* ─── Data Snippets Module ───────────────────────────────────────── */
/* Reusable HTML summary generators for KPI, audit, complaint, rota.  */
/* Used by store context panel, projects, and messages.               */
/* ================================================================== */
window.DataSnippets = (function() {
    'use strict';

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function _pct(v) { return (v * 100).toFixed(1) + '%'; }
    function _money(v) { return '\u00a3' + Math.abs(v).toFixed(0); }
    function _arrow(curr, prev, inverse) {
        var diff = curr - prev;
        if (Math.abs(diff) < 0.005) return '<span style="color:#94A3B8;">&#8212;</span>';
        var good = inverse ? diff < 0 : diff > 0;
        var color = good ? '#059669' : '#DC2626';
        var icon = diff > 0 ? '&#9650;' : '&#9660;';
        return '<span style="color:' + color + ';font-weight:800;">' + icon + ' ' + (Math.abs(diff) * 100).toFixed(1) + '%</span>';
    }

    /* ─── KPI Trend (last N weeks for a store) ─────────────────── */
    async function kpiTrend(storeName, weeks) {
        weeks = weeks || 4;
        var allKpis = await idbGetAll('kpi');
        var cid = typeof canonicalStoreId === 'function' ? canonicalStoreId(storeName) : storeName.toLowerCase().replace(/[^a-z0-9]/g,'');
        var storeKpis = allKpis.filter(function(k) {
            var kid = typeof canonicalStoreId === 'function' ? canonicalStoreId(k.Branch) : (k.BranchId || '');
            return kid === cid || (k.Branch || '').toLowerCase() === storeName.toLowerCase();
        }).sort(function(a,b) { return (b.Week || 0) - (a.Week || 0); });

        if (!storeKpis.length) return '<p class="text-xs text-slate-400">No KPI data available</p>';

        var latest = storeKpis[0];
        var prev = storeKpis.length > 1 ? storeKpis[1] : null;

        var metrics = [
            { key: 'Sales', label: 'Sales', inverse: false, format: 'pct' },
            { key: 'Product', label: 'Product', inverse: true, format: 'pct' },
            { key: 'Waste', label: 'Waste', inverse: true, format: 'pct' },
            { key: 'Labour', label: 'Labour', inverse: true, format: 'pct' },
            { key: 'ATV', label: 'ATV', inverse: false, format: 'money' },
            { key: 'Energy', label: 'Energy', inverse: true, format: 'pct' }
        ];

        var html = '<div style="font-size:11px;">';
        html += '<div class="flex items-center gap-2 mb-2"><span style="font-weight:800;color:#1E293B;">Wk ' + (latest.Week || '?') + '</span>';
        if (latest.Year) html += '<span style="font-size:9px;color:#94A3B8;">' + latest.Year + '</span>';
        html += '</div>';
        html += '<div class="grid grid-cols-3 gap-2">';

        metrics.forEach(function(m) {
            var curr = latest[m.key] || 0;
            var prevVal = prev ? (prev[m.key] || 0) : null;
            var trend = prevVal !== null ? _arrow(curr, prevVal, m.inverse) : '';
            var value = m.format === 'money' ? _money(curr) : _pct(curr);
            var color = '#1E293B';
            if (m.inverse) {
                color = curr > 0.1 ? '#DC2626' : curr > 0.05 ? '#D97706' : '#059669';
            } else {
                color = curr >= 0 ? '#059669' : '#DC2626';
            }
            html += '<div style="padding:4px 6px;background:#F8FAFC;border-radius:4px;border:1px solid #E2E8F0;">'
                + '<div style="font-size:9px;font-weight:800;color:#64748B;text-transform:uppercase;">' + m.label + '</div>'
                + '<div style="font-size:13px;font-weight:800;color:' + color + ';">' + value + '</div>'
                + '<div>' + trend + '</div>'
                + '</div>';
        });

        html += '</div></div>';
        return html;
    }

    /* ─── Audit Actions summary ─────────────────────────────────── */
    async function auditSummary(storeName) {
        var allActions = [];
        try { allActions = await idbGetAll('actions'); } catch(e) {}
        var storeActions = allActions.filter(function(a) {
            return (a.Store || '').toLowerCase() === storeName.toLowerCase();
        });

        var open = storeActions.filter(function(a) { return !(a.Status || '').toLowerCase().includes('closed'); });
        var critical = open.filter(function(a) { return (a.Critical || '').toLowerCase() === 'yes'; });
        var overdue = open.filter(function(a) {
            if (!a.AuditDate) return false;
            var d = new Date(a.AuditDate);
            var days = (new Date() - d) / 86400000;
            return days > 14;
        });

        var total = storeActions.length;
        var closedCount = total - open.length;

        if (total === 0) return '<p class="text-xs text-slate-400">No audit actions</p>';

        var html = '<div style="font-size:11px;">'
            + '<div class="flex gap-3 mb-2">'
            + '<div style="padding:4px 8px;background:#F0FDF4;border-radius:4px;border:1px solid #BBF7D0;">'
            + '<span style="font-size:10px;font-weight:800;color:#059669;">' + closedCount + ' closed</span></div>'
            + '<div style="padding:4px 8px;background:#FEF3C7;border-radius:4px;border:1px solid #FDE68A;">'
            + '<span style="font-size:10px;font-weight:800;color:#D97706;">' + open.length + ' open</span></div>'
            + (critical.length > 0 ? '<div style="padding:4px 8px;background:#FEF2F2;border-radius:4px;border:1px solid #FECACA;">'
            + '<span style="font-size:10px;font-weight:800;color:#DC2626;">' + critical.length + ' critical</span></div>' : '')
            + (overdue.length > 0 ? '<div style="padding:4px 8px;background:#FEF2F2;border-radius:4px;border:1px solid #FECACA;">'
            + '<span style="font-size:10px;font-weight:800;color:#DC2626;">' + overdue.length + ' overdue</span></div>' : '')
            + '</div></div>';
        return html;
    }

    /* ─── Complaints summary ────────────────────────────────────── */
    async function complaintSummary(storeName, days) {
        days = days || 30;
        var allComplaints = [];
        try {
            if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
                var items = await GraphClient.listJsonFiles('Shop Tools/complaints');
                for (var i = 0; i < items.length; i++) {
                    try {
                        var t = await GraphClient.readFile('Shop Tools/complaints/' + items[i].name);
                        if (t) { var obj = JSON.parse(t); if (obj && obj.id) allComplaints.push(obj); }
                    } catch(e) {}
                }
            }
        } catch(e) {}

        var cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        var storeComplaints = allComplaints.filter(function(c) {
            var matchStore = (c.storeName || '').toLowerCase() === storeName.toLowerCase();
            var matchDate = c.date && new Date(c.date) >= cutoff;
            return matchStore && matchDate;
        });

        var red = storeComplaints.filter(function(c) { return c.severity === 'Red'; });
        var amber = storeComplaints.filter(function(c) { return c.severity === 'Amber'; });

        if (storeComplaints.length === 0) return '<p class="text-xs text-slate-400">No complaints in last ' + days + ' days</p>';

        var html = '<div style="font-size:11px;">'
            + '<div class="flex gap-2 mb-1">'
            + '<span style="padding:3px 6px;background:#F1F5F9;border-radius:4px;font-size:10px;font-weight:800;color:#475569;">' + storeComplaints.length + ' total</span>';
        if (red.length) html += '<span style="padding:3px 6px;background:#FEF2F2;border-radius:4px;font-size:10px;font-weight:800;color:#DC2626;">' + red.length + ' red</span>';
        if (amber.length) html += '<span style="padding:3px 6px;background:#FEF3C7;border-radius:4px;font-size:10px;font-weight:800;color:#D97706;">' + amber.length + ' amber</span>';
        html += '</div></div>';
        return html;
    }

    /* ─── Rota summary ──────────────────────────────────────────── */
    async function rotaSummary(storeId) {
        if (typeof Rota === 'undefined') return '<p class="text-xs text-slate-400">Rota not loaded</p>';

        var staff = await Rota.loadStaff(storeId);
        var monday = Rota.getMonday(new Date());
        var weekData = await Rota.loadWeek(storeId, monday);
        var shifts = weekData ? weekData.shifts : {};
        var today = new Date().toISOString().slice(0,10);
        var days = Rota.DAYS;

        var headcount = staff.length;
        var totalHours = 0;
        var absentToday = 0;

        staff.forEach(function(person) {
            var personShifts = shifts[person.id] || {};
            days.forEach(function(day) {
                totalHours += Rota.calcDayHours(personShifts[day] || {});
            });
            var todayDay = days[new Date().getDay()];
            var todayShift = personShifts[todayDay] || {};
            if (todayShift.type === 'sick' || todayShift.type === 'absent' || todayShift.type === 'holiday') absentToday++;
        });

        var html = '<div style="font-size:11px;" class="flex gap-3">'
            + '<div style="padding:4px 8px;background:#F0FDF4;border-radius:4px;border:1px solid #BBF7D0;">'
            + '<span style="font-size:9px;font-weight:800;color:#64748B;">Staff</span>'
            + '<div style="font-size:14px;font-weight:800;color:#1E293B;">' + headcount + '</div></div>'
            + '<div style="padding:4px 8px;background:#EFF6FF;border-radius:4px;border:1px solid #BFDBFE;">'
            + '<span style="font-size:9px;font-weight:800;color:#64748B;">Hours</span>'
            + '<div style="font-size:14px;font-weight:800;color:#1E293B;">' + totalHours.toFixed(0) + '</div></div>';
        if (absentToday > 0) {
            html += '<div style="padding:4px 8px;background:#FEF2F2;border-radius:4px;border:1px solid #FECACA;">'
                + '<span style="font-size:9px;font-weight:800;color:#64748B;">Absent</span>'
                + '<div style="font-size:14px;font-weight:800;color:#DC2626;">' + absentToday + '</div></div>';
        }
        html += '</div>';
        return html;
    }

    /* ─── Full store dossier (combined) ─────────────────────────── */
    async function storeDossier(storeName, storeId) {
        storeId = storeId || (typeof canonicalStoreId === 'function' ? canonicalStoreId(storeName) : '');

        var html = '<div class="space-y-3">';

        html += '<div><h4 style="font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">KPI Trend</h4>';
        html += await kpiTrend(storeName, 4);
        html += '</div>';

        html += '<div><h4 style="font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Audit Actions</h4>';
        html += await auditSummary(storeName);
        html += '</div>';

        html += '<div><h4 style="font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Complaints (30 days)</h4>';
        html += await complaintSummary(storeName, 30);
        html += '</div>';

        if (storeId) {
            html += '<div><h4 style="font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Rota</h4>';
            html += await rotaSummary(storeId);
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    /* ─── Plain-text version (for messages/notes) ───────────────── */
    async function kpiTrendText(storeName, weeks) {
        weeks = weeks || 4;
        var allKpis = await idbGetAll('kpi');
        var cid = typeof canonicalStoreId === 'function' ? canonicalStoreId(storeName) : storeName.toLowerCase().replace(/[^a-z0-9]/g,'');
        var storeKpis = allKpis.filter(function(k) {
            var kid = typeof canonicalStoreId === 'function' ? canonicalStoreId(k.Branch) : (k.BranchId || '');
            return kid === cid || (k.Branch || '').toLowerCase() === storeName.toLowerCase();
        }).sort(function(a,b) { return (b.Week || 0) - (a.Week || 0); });

        if (!storeKpis.length) return 'No KPI data for ' + storeName;
        var latest = storeKpis[0];
        return storeName + ' Wk' + (latest.Week||'?') + ': Sales ' + _pct(latest.Sales||0)
            + ', Product ' + _pct(latest.Product||0)
            + ', Waste ' + _pct(latest.Waste||0)
            + ', Labour ' + _pct(latest.Labour||0)
            + ', ATV ' + _money(latest.ATV||0);
    }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        kpiTrend: kpiTrend,
        auditSummary: auditSummary,
        complaintSummary: complaintSummary,
        rotaSummary: rotaSummary,
        storeDossier: storeDossier,
        kpiTrendText: kpiTrendText
    };
})();
