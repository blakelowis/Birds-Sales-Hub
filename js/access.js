/* ─── Access Control Module ──────────────────────────────────────── */
/* Role-based view filtering, nav visibility, and sharing.            */
/* Works with Users.getRole() and shared_views IDB store.             */
/* ================================================================== */
window.Access = (function() {
    'use strict';

    /* ─── View → minimum role mapping ──────────────────────────── */
    /* If a view isn't listed, it's visible to all roles.            */
    var VIEW_ROLES = {
        'area':             ['area_manager', 'hq', 'admin'],
        'rota-admin':       ['hq', 'admin'],
        'adminusers':       ['admin'],
        'control':          ['admin'],
        'trends':           ['hq', 'admin'],
        'halloffame':       ['hq', 'admin'],
        'banding':          ['hq', 'admin'],
        'missingweeks':     ['hq', 'admin'],
        'storecards':       ['hq', 'admin'],
        'scorecards':       ['hq', 'admin'],
        'charts':           ['hq', 'admin'],
        'auditexport':      ['hq', 'admin'],
        'masterreview':     ['hq', 'admin'],
        'ith-dashboard':    ['hq', 'admin']
    };

    /* ─── Tab → minimum role mapping ───────────────────────────── */
    var TAB_ROLES = {
        'sales':    ['hq', 'admin'],
        'audits':   ['hq', 'admin'],
        'docs':     ['area_manager', 'hq', 'admin'],
        'shop':     ['shop', 'area_manager', 'hq', 'admin']
    };

    function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    /* ─── Can the current user see a specific view? ────────────── */
    function canView(viewId) {
        var role = (typeof Users !== 'undefined' && Users.getRole) ? Users.getRole() : 'shop';
        var required = VIEW_ROLES[viewId];
        if (!required) return true; /* no restriction */
        return required.indexOf(role) >= 0;
    }

    /* ─── Can the current user see a specific tab? ─────────────── */
    function canTab(tabId) {
        var role = (typeof Users !== 'undefined' && Users.getRole) ? Users.getRole() : 'shop';
        var required = TAB_ROLES[tabId];
        if (!required) return true;
        return required.indexOf(role) >= 0;
    }

    /* ─── Apply nav visibility based on role ───────────────────── */
    function applyNavPermissions() {
        var role = (typeof Users !== 'undefined' && Users.getRole) ? Users.getRole() : 'shop';

        /* Hide/show tabs */
        document.querySelectorAll('.nav-tab').forEach(function(tab) {
            var tabId = tab.getAttribute('data-tab');
            if (tabId && !canTab(tabId)) {
                tab.style.display = 'none';
            } else {
                tab.style.display = '';
            }
        });

        /* Hide/show nav panels */
        document.querySelectorAll('.nav-panel').forEach(function(panel) {
            var panelId = panel.getAttribute('data-panel');
            if (panelId && !canTab(panelId)) {
                panel.style.display = 'none';
            } else {
                panel.style.display = '';
            }
        });

        /* Auto-switch to shop tab if current tab is hidden */
        var activeTab = document.querySelector('.nav-tab.active');
        if (activeTab && activeTab.style.display === 'none') {
            if (role === 'shop') {
                if (typeof setActiveTab === 'function') setActiveTab('shop');
            } else {
                /* Find first visible tab */
                var firstVisible = document.querySelector('.nav-tab[style*=""],.nav-tab:not([style*="display"])');
                if (firstVisible) {
                    var tabId = firstVisible.getAttribute('data-tab');
                    if (typeof setActiveTab === 'function') setActiveTab(tabId);
                }
            }
        }
    }

    /* ─── Get stores the current user can access ───────────────── */
    /* Includes own stores + shared stores.                          */
    function getAccessibleStores() {
        var own = (typeof Users !== 'undefined') ? Users.getStoresForUser() : [];
        var shared = getSharedStoreIds();
        /* Merge and deduplicate */
        var map = {};
        own.forEach(function(id) { map[id] = true; });
        shared.forEach(function(id) { map[id] = true; });
        return Object.keys(map);
    }

    /* ─── Sharing: CRUD ────────────────────────────────────────── */
    async function shareView(view, storeIds, sharedWithNames) {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var record = {
            id: 'sh-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2,6),
            view: view,
            storeIds: storeIds,
            sharedBy: user ? user.name : '',
            sharedById: user ? user.id : '',
            sharedWith: sharedWithNames || [],
            createdAt: new Date().toISOString(),
            active: true
        };
        await idbPut('shared_views', record);
        /* Sync to SharePoint */
        try {
            if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
                await GraphClient.writeFile('Shared/' + record.id + '.json', JSON.stringify(record, null, 2));
            }
        } catch(e) {}
        return record;
    }

    async function revokeShare(shareId) {
        await idbDelete('shared_views', shareId);
        try {
            if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
                await GraphClient.deleteFile('Shared/' + shareId + '.json');
            }
        } catch(e) {}
    }

    async function getMyShares() {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (!user) return [];
        var all = await idbGetAll('shared_views');
        return all.filter(function(s) { return s.sharedById === user.id && s.active; });
    }

    async function getSharedWithMe() {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (!user) return [];
        var all = await idbGetAll('shared_views');
        var name = user.name || '';
        return all.filter(function(s) {
            return s.active && s.sharedWith && s.sharedWith.indexOf(name) >= 0;
        });
    }

    function getSharedStoreIds() {
        /* Synchronous version — reads from cached data */
        /* For the full async version, use getSharedWithMe() */
        return window._cachedSharedStoreIds || [];
    }

    async function refreshSharedStores() {
        var shares = await getSharedWithMe();
        var ids = [];
        shares.forEach(function(s) {
            (s.storeIds || []).forEach(function(id) { if (ids.indexOf(id) < 0) ids.push(id); });
        });
        window._cachedSharedStoreIds = ids;
        return ids;
    }

    /* ─── Share modal ──────────────────────────────────────────── */
    function showShareModal(view, storeIds) {
        var modal = document.getElementById('rotaModal') || document.createElement('div');
        modal.id = 'shareModal';
        if (!document.getElementById('shareModal')) document.body.appendChild(modal);

        var users = (typeof Users !== 'undefined') ? Users.getAll() : [];
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var otherUsers = users.filter(function(u) { return u.id !== (user || {}).id; });

        var html = '<div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="Access.closeShareModal(event)">'
            + '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-md" onclick="event.stopPropagation()">'
            + '<div class="p-5 border-b border-slate-100">'
            + '<h3 class="text-lg font-black text-slate-800">Share View</h3>'
            + '<p class="text-xs text-slate-400">Select who to share this view with</p>'
            + '</div>'
            + '<div class="p-5">'
            + '<div class="space-y-2 max-h-60 overflow-y-auto">';

        otherUsers.forEach(function(u) {
            html += '<label class="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">'
                + '<input type="checkbox" value="' + _esc(u.name) + '" class="share-user-cb accent-birds-green" style="width:18px;height:18px;">'
                + '<div>'
                + '<p class="text-sm font-bold text-slate-700">' + _esc(u.name) + '</p>'
                + '<p class="text-[10px] text-slate-400">' + _esc(u.department || u.jobTitle || '') + '</p>'
                + '</div>'
                + '</label>';
        });

        html += '</div></div>'
            + '<div class="p-5 border-t border-slate-100 flex justify-end gap-2">'
            + '<button onclick="Access.doShare(\'' + view + '\',\'' + (storeIds || []).join(',') + '\')" style="background:#6E8E6D;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;">Share</button>'
            + '<button onclick="Access.closeShareModal()" style="background:#F1F5F9;color:#475569;font-size:12px;font-weight:700;padding:8px 12px;border-radius:6px;border:none;cursor:pointer;">Cancel</button>'
            + '</div></div></div>';

        modal.innerHTML = html;
    }

    function closeShareModal(e) {
        if (e && e.target && !e.target.classList.contains('fixed')) return;
        var modal = document.getElementById('shareModal');
        if (modal) modal.innerHTML = '';
    }

    async function doShare(view, storeIdsCSV) {
        var cbs = document.querySelectorAll('.share-user-cb:checked');
        var names = [];
        cbs.forEach(function(cb) { names.push(cb.value); });
        if (!names.length) { showToast('Select at least one person', 'warning'); return; }
        var storeIds = storeIdsCSV ? storeIdsCSV.split(',') : [];
        await shareView(view, storeIds, names);
        closeShareModal();
        showToast('Shared with ' + names.length + ' person' + (names.length > 1 ? 's' : ''), 'success');
    }

    /* ─── Test View / Impersonation ──────────────────────────────── */
    var _impersonated = null;

    function startImpersonation(userObj) {
        if (!userObj || !userObj.id) return;
        _impersonated = userObj;
        var banner = document.getElementById('impersonateBanner');
        var detail = document.getElementById('impersonateBannerDetail');
        if (banner) { banner.style.display = 'flex'; }
        if (detail) { detail.textContent = 'Viewing as: ' + userObj.name + ' (' + (userObj.department || user.role || '') + ')'; }
        applyNavPermissions();
    }

    function stopImpersonation() {
        _impersonated = null;
        var banner = document.getElementById('impersonateBanner');
        if (banner) { banner.style.display = 'none'; }
        applyNavPermissions();
    }

    function getImpersonated() { return _impersonated; }

    function renderTestViewSwitcher() {
        if (typeof Users === 'undefined') return '';
        var current = Users.getCurrentUser();
        if (!current || current.role !== 'admin') return '';

        var users = typeof usersData !== 'undefined' ? usersData : [];
        if (!users.length && typeof Users.getUsersList === 'function') users = Users.getUsersList();

        var html = '<div class="card p-6" style="border-top:3px solid #7C3AED;">'
            + '<h3 class="text-lg font-black text-slate-800 mb-2">Test View / Impersonation</h3>'
            + '<p class="text-sm text-slate-400 mb-4">Switch to see the app as another user. Your admin access is preserved.</p>';

        if (_impersonated) {
            html += '<div style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:8px;padding:12px;margin-bottom:12px;">'
                + '<p class="text-sm font-bold text-purple-800">Currently viewing as: ' + _esc(_impersonated.name) + '</p>'
                + '<button onclick="Access.stopImpersonation(); setView(\'adminusers\');" style="margin-top:8px;background:#7C3AED;color:#fff;padding:6px 14px;border-radius:6px;border:none;font-size:12px;font-weight:700;cursor:pointer;">Back to Admin</button></div>';
        }

        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;">';

        users.forEach(function(u) {
            if (u.id === current.id) return;
            html += '<div class="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg hover:border-purple-300 transition-colors">'
                + '<div><p class="text-sm font-bold text-slate-700">' + _esc(u.name) + '</p>'
                + '<p class="text-[10px] text-slate-400">' + _esc(u.department || '') + '</p></div>'
                + '<button onclick="Access.startImpersonation(' + _esc(JSON.stringify(u).replace(/"/g, '&quot;')) + '); setView(\'overview\');" style="background:#7C3AED;color:#fff;padding:4px 10px;border-radius:5px;border:none;font-size:10px;font-weight:700;cursor:pointer;">View as</button>'
                + '</div>';
        });

        html += '</div></div>';
        return html;
    }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        canView: canView,
        canTab: canTab,
        applyNavPermissions: applyNavPermissions,
        getAccessibleStores: getAccessibleStores,
        shareView: shareView,
        revokeShare: revokeShare,
        getMyShares: getMyShares,
        getSharedWithMe: getSharedWithMe,
        getSharedStoreIds: getSharedStoreIds,
        refreshSharedStores: refreshSharedStores,
        showShareModal: showShareModal,
        closeShareModal: closeShareModal,
        doShare: doShare,
        startImpersonation: startImpersonation,
        stopImpersonation: stopImpersonation,
        getImpersonated: getImpersonated,
        renderTestViewSwitcher: renderTestViewSwitcher,
        VIEW_ROLES: VIEW_ROLES,
        TAB_ROLES: TAB_ROLES
    };
})();
