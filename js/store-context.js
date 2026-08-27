/* ─── Store Context Panel ────────────────────────────────────────── */
/* Cross-module data hub: KPIs, audits, complaints, rota for any     */
/* store. Rendered as a sidebar or inline panel.                      */
/* ================================================================== */
window.StoreContext = (function() {
    'use strict';

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    /* ─── Render full context panel into a container ────────────── */
    async function render(storeName, containerId, options) {
        options = options || {};
        var el = document.getElementById(containerId);
        if (!el) return;

        var storeId = options.storeId || (typeof canonicalStoreId === 'function' ? canonicalStoreId(storeName) : '');

        el.innerHTML = '<div style="padding:12px;text-align:center;color:#94A3B8;font-size:11px;">Loading store data...</div>';

        try {
            var html = _buildHeader(storeName, options);

            /* KPI Trend */
            html += '<div style="padding:12px;border-bottom:1px solid #F1F5F9;">';
            html += '<h4 style="font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">KPI Trend (4 weeks)</h4>';
            html += '<div id="sc-kpi-' + containerId + '">Loading...</div>';
            html += '</div>';

            /* Audit Actions */
            html += '<div style="padding:12px;border-bottom:1px solid #F1F5F9;">';
            html += '<h4 style="font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Audit Actions</h4>';
            html += '<div id="sc-audit-' + containerId + '">Loading...</div>';
            html += '</div>';

            /* Complaints */
            html += '<div style="padding:12px;border-bottom:1px solid #F1F5F9;">';
            html += '<h4 style="font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Complaints (30 days)</h4>';
            html += '<div id="sc-complaint-' + containerId + '">Loading...</div>';
            html += '</div>';

            /* Rota */
            if (storeId) {
                html += '<div style="padding:12px;border-bottom:1px solid #F1F5F9;">';
                html += '<h4 style="font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Rota This Week</h4>';
                html += '<div id="sc-rota-' + containerId + '">Loading...</div>';
                html += '</div>';
            }

            /* Messages */
            html += '<div style="padding:12px;">';
            html += '<h4 style="font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Recent Messages</h4>';
            html += '<div id="sc-msgs-' + containerId + '">Loading...</div>';
            html += '</div>';

            /* Quick links */
            html += _buildQuickLinks(storeName, storeId, options);

            el.innerHTML = html;

            /* Load data async into sub-containers */
            _loadSections(storeName, storeId, containerId);
        } catch(e) {
            el.innerHTML = '<div style="padding:12px;color:#DC2626;font-size:11px;">Error loading store context</div>';
        }
    }

    function _buildHeader(storeName, options) {
        var html = '<div style="padding:12px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;border-radius:8px 8px 0 0;">'
            + '<div class="flex items-center justify-between">'
            + '<div>'
            + '<h3 style="font-size:14px;font-weight:800;color:#1E293B;">' + _esc(storeName) + '</h3>';
        if (options.subtitle) html += '<p style="font-size:10px;color:#94A3B8;">' + _esc(options.subtitle) + '</p>';
        html += '</div>';
        if (options.onClose) {
            html += '<button onclick="' + options.onClose + '" style="background:none;border:none;color:#94A3B8;cursor:pointer;font-size:16px;padding:4px;">&#10005;</button>';
        }
        html += '</div></div>';
        return html;
    }

    function _buildQuickLinks(storeName, storeId, options) {
        var html = '<div style="padding:12px;background:#F8FAFC;border-radius:0 0 8px 8px;">'
            + '<div class="flex flex-wrap gap-2">';
        if (storeId) {
            html += '<a href="#" onclick="setView(\'rota\');return false;" style="font-size:10px;font-weight:700;color:#6E8E6D;text-decoration:none;padding:4px 8px;background:#F0FDF4;border-radius:4px;border:1px solid #BBF7D0;">Rota &#8594;</a>';
        }
        html += '<a href="#" onclick="setView(\'shop-complaint\');return false;" style="font-size:10px;font-weight:700;color:#D97706;text-decoration:none;padding:4px 8px;background:#FEF3C7;border-radius:4px;border:1px solid #FDE68A;">Complaints &#8594;</a>';
        html += '<a href="#" onclick="setView(\'shop-incident\');return false;" style="font-size:10px;font-weight:700;color:#DC2626;text-decoration:none;padding:4px 8px;background:#FEF2F2;border-radius:4px;border:1px solid #FECACA;">Incidents &#8594;</a>';
        html += '<a href="#" onclick="setView(\'shop-messages\');return false;" style="font-size:10px;font-weight:700;color:#3B82F6;text-decoration:none;padding:4px 8px;background:#EFF6FF;border-radius:4px;border:1px solid #BFDBFE;">Messages &#8594;</a>';
        html += '</div></div>';
        return html;
    }

    async function _loadSections(storeName, storeId, containerId) {
        /* Load each section async */
        if (typeof DataSnippets !== 'undefined') {
            try {
                var kpiEl = document.getElementById('sc-kpi-' + containerId);
                if (kpiEl) kpiEl.innerHTML = await DataSnippets.kpiTrend(storeName, 4);
            } catch(e) {}

            try {
                var auditEl = document.getElementById('sc-audit-' + containerId);
                if (auditEl) auditEl.innerHTML = await DataSnippets.auditSummary(storeName);
            } catch(e) {}

            try {
                var cmpEl = document.getElementById('sc-complaint-' + containerId);
                if (cmpEl) cmpEl.innerHTML = await DataSnippets.complaintSummary(storeName, 30);
            } catch(e) {}

            try {
                var rotaEl = document.getElementById('sc-rota-' + containerId);
                if (rotaEl && storeId) rotaEl.innerHTML = await DataSnippets.rotaSummary(storeId);
            } catch(e) {}
        }

        /* Messages */
        try {
            var msgsEl = document.getElementById('sc-msgs-' + containerId);
            if (msgsEl && typeof Messages !== 'undefined' && storeId) {
                var msgs = Messages.getForStore(storeId);
                var recent = msgs.slice(-3).reverse();
                if (recent.length === 0) {
                    msgsEl.innerHTML = '<p style="font-size:10px;color:#94A3B8;">No messages</p>';
                } else {
                    var mhtml = '<div class="space-y-1">';
                    recent.forEach(function(m) {
                        var typeColors = { broadcast: '#3B82F6', action_required: '#DC2626', acknowledge: '#059669', training: '#7C3AED' };
                        var color = typeColors[m.type] || '#94A3B8';
                        mhtml += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;">'
                            + '<span style="width:6px;height:6px;border-radius:50%;background:' + color + ';flex-shrink:0;"></span>'
                            + '<span style="font-size:10px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">' + _esc(m.title || m.subject || 'Message') + '</span>'
                            + '</div>';
                    });
                    mhtml += '</div>';
                    msgsEl.innerHTML = mhtml;
                }
            }
        } catch(e) {}
    }

    /* ─── Compact inline snippet (for embedding in notes/projects) ─ */
    async function inlineSnippet(storeName) {
        if (typeof DataSnippets === 'undefined') return '';
        var html = '<div style="padding:8px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-size:11px;">'
            + '<div style="font-weight:800;color:#1E293B;margin-bottom:4px;">' + _esc(storeName) + '</div>';
        html += await DataSnippets.kpiTrend(storeName, 4);
        html += await DataSnippets.auditSummary(storeName);
        html += '</div>';
        return html;
    }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        render: render,
        inlineSnippet: inlineSnippet
    };
})();
