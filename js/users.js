/* ─── Users Module v134 ────────────────────────────────────────── */
/* User authentication: IDB + filesystem (users/) + localStorage  */
window.Users = (function() {
    var _db = null;
    var _users = [];
    var _currentUser = null;
    var _customDepts = [];
    var DB_NAME = 'birds_users';
    var DB_VER = 1;

    var BUILTIN_DEPARTMENTS = [
        'General',
        'Area Sales Team',
        'Technical',
        'Training & Development',
        'Retail Auditor',
        'I.T.',
        '--- Senior Leadership ---',
        'Production Manager',
        'Head of Retail',
        'Project Manager',
        'Director'
    ];

    var SENIOR_DEPARTMENTS = [
        'Production Manager',
        'Head of Retail',
        'Project Manager',
        'Director'
    ];

    function getDepartments() {
        var seen = {};
        var result = [];
        BUILTIN_DEPARTMENTS.concat(_customDepts).forEach(function(d) {
            if (d.charAt(0) === '-' && d.charAt(1) === '-') return;
            if (!seen[d]) { seen[d] = true; result.push(d); }
        });
        return result;
    }

    function getDeptOptionsHtml(selected, includeAll) {
        var depts = getDepartments();
        var seniorSet = {};
        SENIOR_DEPARTMENTS.forEach(function(d) { seniorSet[d] = true; });
        var html = '';
        if (includeAll) {
            html += '<option value="__ALL__"' + (selected === '__ALL__' ? ' selected' : '') + '>All Departments</option>';
        }
        var seenSenior = false;
        depts.forEach(function(d) {
            if (seniorSet[d] && !seenSenior) {
                html += '<option disabled style="font-weight:800;color:#5a6577;background:#f1ede8;">── Senior Leadership ──</option>';
                seenSenior = true;
            }
            var members = Users.getByDepartment(d);
            var names = members.map(function(m) { return m.name.split(' ')[0]; }).join(', ');
            html += '<option value="' + d + '"' + (selected === d ? ' selected' : '') + '>' + d + (names ? ' (' + names + ')' : '') + '</option>';
        });
        return html;
    }

    async function _saveCustomDepts() {
        if (!_db) return;
        return new Promise(function(resolve) {
            try {
                var r = _db.transaction('departments', 'readwrite').objectStore('departments').put({ id: 'custom', list: _customDepts });
                r.onsuccess = function() { resolve(true); };
                r.onerror = function() { resolve(false); };
            } catch(e) { resolve(false); }
        });
    }

    async function _loadCustomDepts() {
        if (!_db) return;
        return new Promise(function(resolve) {
            try {
                var r = _db.transaction('departments').objectStore('departments').get('custom');
                r.onsuccess = function() {
                    var rec = r.result;
                    _customDepts = (rec && Array.isArray(rec.list)) ? rec.list : [];
                    resolve();
                };
                r.onerror = function() { _customDepts = []; resolve(); };
            } catch(e) { _customDepts = []; resolve(); }
        });
    }

    async function addDepartment(name) {
        name = (name || '').trim();
        if (!name) return false;
        var all = getDepartments();
        if (all.indexOf(name) !== -1) return false;
        _customDepts.push(name);
        await _saveCustomDepts();
        return true;
    }

    /* ─── IndexedDB helpers ─────────────────────────────────────── */
    function _initIDB() {
        return new Promise(function(resolve) {
            try {
                var req = indexedDB.open(DB_NAME, DB_VER);
                req.onupgradeneeded = function(e) {
                    var d = e.target.result;
                    if (!d.objectStoreNames.contains('users'))
                        d.createObjectStore('users', { keyPath: 'id' });
                    if (!d.objectStoreNames.contains('departments'))
                        d.createObjectStore('departments', { keyPath: 'id' });
                };
                req.onsuccess = function(e) { _db = e.target.result; resolve(); };
                req.onerror = function() { _db = null; resolve(); };
            } catch(e) { _db = null; resolve(); }
        });
    }

    function _idbGetAll() {
        if (!_db) return Promise.resolve([]);
        return new Promise(function(resolve) {
            try {
                var r = _db.transaction('users').objectStore('users').getAll();
                r.onsuccess = function() { resolve(r.result || []); };
                r.onerror = function() { resolve([]); };
            } catch(e) { resolve([]); }
        });
    }

    function _idbPut(user) {
        if (!_db) return Promise.resolve(false);
        return new Promise(function(resolve) {
            try {
                var r = _db.transaction('users', 'readwrite').objectStore('users').put(user);
                r.onsuccess = function() { resolve(true); };
                r.onerror = function() { resolve(false); };
            } catch(e) { resolve(false); }
        });
    }

    function _idbDelete(id) {
        if (!_db) return Promise.resolve(false);
        return new Promise(function(resolve) {
            try {
                var r = _db.transaction('users', 'readwrite').objectStore('users').delete(id);
                r.onsuccess = function() { resolve(true); };
                r.onerror = function() { resolve(false); };
            } catch(e) { resolve(false); }
        });
    }

    /* ─── localStorage ──────────────────────────────────────────── */
    function _getStored() {
        try {
            var d = localStorage.getItem('currentUser');
            return d ? JSON.parse(d) : null;
        } catch(e) { return null; }
    }

    function _setStored(user) {
        try { localStorage.setItem('currentUser', JSON.stringify(user)); } catch(e) {}
    }

    function _clearStored() {
        try { localStorage.removeItem('currentUser'); } catch(e) {}
    }

    /* ─── Public API ────────────────────────────────────────────── */
    async function init() {
        await _initIDB();
        await _loadCustomDepts();

        /* Load users from IDB first */
        _users = await _idbGetAll();

        /* v148: Load from Graph (SharePoint) for cross-device users */
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try {
                var graphItems = await GraphClient.listJsonFiles('users');
                for (var gi = 0; gi < graphItems.length; gi++) {
                    try {
                        var text = await GraphClient.readFile('users/' + graphItems[gi].name);
                        if (text) {
                            var gUser = JSON.parse(text);
                            if (gUser && gUser.id && gUser.name) {
                                var exists = _users.find(function(u) { return u.id === gUser.id; });
                                if (!exists) {
                                    _users.push(gUser);
                                    await _idbPut(gUser);
                                } else if (gUser.email && !exists.email) {
                                    exists.email = gUser.email;
                                    await _idbPut(exists);
                                }
                            }
                        }
                    } catch(e) {}
                }
            } catch(e) { console.warn('[Users] Graph load failed:', e.message); }
        }

        /* If still empty, load from bundled users.json */
        if (!_users.length) {
            try {
                var resp = await fetch('users.json');
                if (resp.ok) {
                    var bundled = await resp.json();
                    if (Array.isArray(bundled) && bundled.length) {
                        _users = bundled;
                        for (var i = 0; i < _users.length; i++) {
                            await _idbPut(_users[i]);
                        }
                    }
                }
            } catch(e) {}
        }

        /* Verify stored user still exists */
        _currentUser = _getStored();
        if (_currentUser) {
            var found = _users.find(function(u) { return u.id === _currentUser.id; });
            if (found) {
                _currentUser = found;
                _setStored(found);
            } else {
                _currentUser = null; _clearStored();
            }
        }
    }

    function getAll() { return _users.slice(); }

    function getByDepartment(dept) {
        if (!dept) return _users.slice();
        return _users.filter(function(u) { return u.department === dept; });
    }

    function getById(id) {
        return _users.find(function(u) { return u.id === id; }) || null;
    }

    async function create(name, department, pin) {
        var id = _uid('user-');
        var user = {
            id: id,
            name: name.trim(),
            department: department,
            created: new Date().toISOString().substring(0, 10)
        };
        _users.push(user);
        await _idbPut(user);
        await _saveUserToGraph(user);
        return user;
    }

    function getCurrentUser() { return _currentUser; }
    function getEffectiveUser() {
        if (typeof Access !== 'undefined' && Access.getImpersonated && Access.getImpersonated()) return Access.getImpersonated();
        return _currentUser || _getStored();
    }
    function canSeeTab(tabId) { return true; }
    function canSeeView(viewId) { return true; }

    /* ─── Role & Area helpers ─────────────────────────────────────── */
    /* Roles: 'shop' | 'area_manager' | 'hq' | 'admin'               */
    /* If no role set, infer from shopStoreId (shop) or default to hq  */
    function getRole(user) {
        user = user || getEffectiveUser();
        if (!user) return 'hq';
        if (user.role === 'admin') return 'admin';
        if (user.userRole) return user.userRole;
        if (user.shopStoreId) return 'shop';
        return 'hq';
    }

    function getArea(user) {
        user = user || _currentUser;
        if (!user) return '';
        if (user.area) return user.area;
        /* Auto-derive from KPI data if area_manager */
        if (getRole(user) === 'area_manager' && user.name && typeof safeGetAM === 'function') {
            return user.name;
        }
        return '';
    }

    function isShop(user) { return getRole(user) === 'shop'; }
    function isAreaManager(user) { var r = getRole(user); return r === 'area_manager'; }
    function isHQ(user) { var r = getRole(user); return r === 'hq' || r === 'admin'; }
    function isAdmin(user) { return getRole(user) === 'admin'; }

    function getStoresForUser(user) {
        user = user || _currentUser;
        var role = getRole(user);
        if (role === 'shop') {
            return user && user.shopStoreId ? [user.shopStoreId] : [];
        }
        if (role === 'area_manager') {
            var area = getArea(user);
            if (!area || typeof originalStoreNames === 'undefined') return [];
            var stores = [];
            originalStoreNames.forEach(function(name, id) {
                if (typeof safeGetAM === 'function' && safeGetAM(name) === area) stores.push(id);
            });
            return stores;
        }
        /* hq + admin: all stores */
        if (typeof originalStoreNames !== 'undefined') {
            var all = [];
            originalStoreNames.forEach(function(name, id) { all.push(id); });
            return all;
        }
        return [];
    }

    function setCurrentUser(user) {
        _currentUser = { id: user.id, name: user.name, department: user.department };
        _setStored(_currentUser);
    }

    function clearCurrentUser() {
        _currentUser = null;
        _clearStored();
    }

    /* ─── Login State ─────────────────────────────────────────────── */
    var _loginSelectedUserId = null;
    var _loginDeptFilter = '';

    /* ─── Login Screen ──────────────────────────────────────────── */
    function renderLoginScreen() {
        document.querySelectorAll('.nav-panel').forEach(function(p) { p.classList.remove('open'); });
        document.querySelectorAll('.nav-tab').forEach(function(t) { t.classList.remove('active'); });
        _loginSelectedUserId = null;
        _loginDeptFilter = '';

        document.getElementById('mainView').innerHTML = `
        <div style="max-width:500px;margin:60px auto;padding:0 16px;text-align:center;">
            <img src="logo.png" alt="Birds" style="height:64px;margin-bottom:16px;">
            <h2 style="font-family:'Merriweather',Georgia,serif;font-size:24px;color:#4A4A4A;margin:0 0 6px;">Welcome to The Hub</h2>
            <p style="color:#7A7A7A;font-size:13px;margin:0 0 32px;">Sign in with your Birds of Derby Microsoft account</p>

            <button onclick="Users.doEntraLogin()" id="entraLoginBtn" style="display:inline-flex;align-items:center;gap:12px;padding:16px 40px;background:#0078D4;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(0,120,212,0.25);transition:all .15s;" onmouseover="this.style.background='#106EBE';this.style.boxShadow='0 6px 20px rgba(0,120,212,0.35)'" onmouseout="this.style.background='#0078D4';this.style.boxShadow='0 4px 16px rgba(0,120,212,0.25)'">
                <svg width="21" height="21" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>
                Sign in with Microsoft
            </button>

            <div id="entraLoginError" style="display:none;color:#D94F4F;font-size:12px;font-weight:600;margin-top:16px;"></div>
        </div>`;
    }

    /* v148: Entra ID login handler */
    var _pendingEntraProfile = null;

    async function doEntraLogin() {
        var errEl = document.getElementById('entraLoginError');
        var btn = document.getElementById('entraLoginBtn');
        if (errEl) errEl.style.display = 'none';
        if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin .6s linear infinite;"></span> Signing in...'; }
        try {
            var profile = await BirdsAuth.login();
            await BirdsAuth.resolveSharePointIds();
            /* Match by email first */
            var matched = _users.find(function(u) {
                return u.email && u.email.toLowerCase() === profile.email.toLowerCase();
            });
            if (matched) {
                /* Existing user — auto-login */
                if (!matched.email) { matched.email = profile.email; await _idbPut(matched); }
                _currentUser = matched;
                _setStored(matched);
                Users.updateHeaderBadge();
                if (typeof Projects !== 'undefined') await Projects.load();
                if (typeof window.syncData === 'function') { try { await window.syncData(); } catch(e) {} }
                renderDashboard();
                return;
            }
            /* No email match — try matching by name (first+last) from Entra profile */
            var entraFirst = (profile.name || '').split(/\s+/)[0] || '';
            var entraLast = (profile.name || '').split(/\s+/).slice(1).join(' ') || '';
            var nameMatched = _users.find(function(u) {
                var parts = (u.name || '').split(/\s+/);
                var uFirst = parts[0] || '';
                var uLast = parts.slice(1).join(' ');
                return uFirst.toLowerCase() === entraFirst.toLowerCase() && uLast.toLowerCase() === entraLast.toLowerCase();
            });
            if (nameMatched) {
                /* Found by name — link email and auto-login */
                nameMatched.email = profile.email;
                await _idbPut(nameMatched);
                await _saveUserToGraph(nameMatched);
                _currentUser = nameMatched;
                _setStored(nameMatched);
                Users.updateHeaderBadge();
                if (typeof Projects !== 'undefined') await Projects.load();
                if (typeof window.syncData === 'function') { try { await window.syncData(); } catch(e) {} }
                renderDashboard();
                return;
            }
            /* New user — show confirmation screen */
            _pendingEntraProfile = profile;
            _renderEntraConfirmScreen(profile);
        } catch(e) {
            console.error('[Auth] Entra login failed:', e);
            if (errEl) { errEl.textContent = e.message || 'Login failed — please try again'; errEl.style.display = 'block'; }
            if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="21" height="21" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg> Sign in with Microsoft'; }
        }
    }

    function _renderEntraConfirmScreen(profile) {
        var nameParts = (profile.name || '').split(/\s+/);
        var firstName = nameParts[0] || '';
        var lastName = nameParts.slice(1).join(' ') || '';
        var deptOpts = ['Sales','HR','Development','Technical','I.T.','Production','Management'].map(function(d){ return '<option value="'+d+'">'+d+'</option>'; }).join('');
        document.getElementById('mainView').innerHTML = `
        <div style="max-width:500px;margin:40px auto;padding:0 16px;">
            <div class="card" style="padding:32px;text-align:center;">
                <div style="width:56px;height:56px;border-radius:50%;background:#0078D4;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;margin:0 auto 16px;">
                    ${firstName[0] || ''}${lastName[0] || ''}
                </div>
                <h2 style="font-family:'Merriweather',Georgia,serif;font-size:18px;color:#4A4A4A;margin:0 0 4px;">Welcome to The Hub</h2>
                <p style="color:#7A7A7A;font-size:12px;margin:0 0 20px;">We don't have an account for <strong>${escapeHtml(profile.email)}</strong> yet.<br>Please confirm your details to get started.</p>

                <div style="text-align:left;margin-bottom:12px;">
                    <label style="font-size:11px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">First Name</label>
                    <input type="text" id="entraFirstName" value="${escapeAttr(firstName)}" style="width:100%;padding:10px;border:1px solid #E8E5E0;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;" />
                </div>
                <div style="text-align:left;margin-bottom:12px;">
                    <label style="font-size:11px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Last Name</label>
                    <input type="text" id="entraLastName" value="${escapeAttr(lastName)}" style="width:100%;padding:10px;border:1px solid #E8E5E0;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;" />
                </div>
                <div style="text-align:left;margin-bottom:12px;">
                    <label style="font-size:11px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Job Title</label>
                    <input type="text" id="entraJobTitle" value="" style="width:100%;padding:10px;border:1px solid #E8E5E0;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;" />
                </div>
                <div style="text-align:left;margin-bottom:20px;">
                    <label style="font-size:11px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Department</label>
                    <select id="entraDept" style="width:100%;padding:10px;border:1px solid #E8E5E0;border-radius:8px;font-size:14px;outline:none;background:#fff;box-sizing:border-box;">
                        ${deptOpts}
                    </select>
                </div>

                <div id="entraConfirmError" style="display:none;color:#D94F4F;font-size:12px;font-weight:600;margin-bottom:10px;"></div>
                <button onclick="Users._confirmEntraUser()" style="width:100%;padding:12px;background:#6E8E6D;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">Confirm &amp; Sign In</button>
                <div style="margin-top:12px;"><a href="#" onclick="Users._cancelEntraConfirm();return false;" style="color:#999;font-size:11px;">&larr; Back to login</a></div>
            </div>
        </div>`;
        setTimeout(function() { var f = document.getElementById('entraFirstName'); if (f) f.focus(); }, 100);
    }

    async function _confirmEntraUser() {
        var firstName = (document.getElementById('entraFirstName').value || '').trim();
        var lastName = (document.getElementById('entraLastName').value || '').trim();
        var jobTitle = (document.getElementById('entraJobTitle').value || '').trim();
        var dept = document.getElementById('entraDept').value;
        var errEl = document.getElementById('entraConfirmError');
        if (!firstName) { if (errEl) { errEl.textContent = 'Please enter your first name'; errEl.style.display = 'block'; } return; }
        var fullName = firstName + (lastName ? ' ' + lastName : '');
        var profile = _pendingEntraProfile;
        var user = {
            id: 'entra-' + (profile.localAccountId || _uid('user-')),
            name: fullName,
            email: profile.email,
            jobTitle: jobTitle,
            department: dept || 'General',
            pin: null,
            created: new Date().toISOString().substring(0, 10)
        };
        _users.push(user);
        await _idbPut(user);
        await _saveUserToGraph(user);
        _pendingEntraProfile = null;
        _currentUser = user;
        _setStored(user);
        Users.updateHeaderBadge();
        if (typeof Projects !== 'undefined') await Projects.load();
        if (typeof window.syncData === 'function') { try { await window.syncData(); } catch(e) {} }
        renderDashboard();
    }

    function _cancelEntraConfirm() {
        _pendingEntraProfile = null;
        if (typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try { BirdsAuth.logout(); } catch(e) {}
        }
        renderLoginScreen();
    }

    /* v148: Save user to Graph (SharePoint) for cross-device access */
    async function _saveUserToGraph(user) {
        if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
            try {
                await GraphClient.ensureFolder('users');
                await GraphClient.writeFile('users/' + user.id + '.json', JSON.stringify(user, null, 2));
            } catch(e) { console.warn('[Users] Graph save failed:', e.message); }
        }
    }

    /* Admin: update a stored user's details (department / job title) */
    async function updateUser(id, updates) {
        var idx = _users.findIndex(function(u) { return u.id === id; });
        if (idx < 0) return false;
        var u = _users[idx];
        var before = JSON.stringify(u);
        ['department', 'jobTitle', 'name', 'email', 'role', 'projectView', 'projectViewDepts', 'shopStoreId', 'userRole', 'area'].forEach(function(k) {
            if (updates && updates[k] !== undefined) u[k] = updates[k];
        });
        if (JSON.stringify(u) === before) return true;
        await _idbPut(u);
        await _saveUserToGraph(u);
        if (_currentUser && _currentUser.id === u.id) {
            _currentUser = u;
            _setStored(u);
            updateHeaderBadge();
        }
        return true;
    }

    /* ─── Logout ────────────────────────────────────────────────── */
    function doLogout() {
        clearCurrentUser();
        updateHeaderBadge();
        if (typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try { BirdsAuth.logout(); } catch(e) {}
        }
        renderLoginScreen();
    }

    function showLogin() { renderLoginScreen(); }

    /* ─── Header Badge ──────────────────────────────────────────── */
    function updateHeaderBadge() {
        var badge = document.getElementById('userBadge');
        var nameEl = document.getElementById('userBadgeName');
        var deptEl = document.getElementById('userBadgeDept');
        if (!badge) return;

        if (_currentUser) {
            badge.classList.remove('hidden');
            badge.classList.add('flex');
            if (nameEl) nameEl.textContent = _currentUser.name;
            if (deptEl) deptEl.textContent = _currentUser.department;
        } else {
            badge.classList.add('hidden');
            badge.classList.remove('flex');
        }
        if (typeof applyNavPermissions === 'function') applyNavPermissions();
    }

    /* ─── Helpers ────────────────────────────────────────────────── */
    function _showErr(el, msg) {
        if (!el) return;
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(function() { el.style.display = 'none'; }, 4000);
    }

    function escapeHtml(v) {
        return String(v || '').replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }

    function escapeAttr(v) {
        return String(v || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    var _pvLabels = {
        '': 'Default (involved only)',
        'mine': 'Only created / assigned to me',
        'department': 'All in my department',
        'multichoice': 'Chosen departments',
        'all': 'All projects (with overview)'
    };
    var _pvOpts = [
        ['', 'Default (involved only)'],
        ['mine', 'Only created / assigned to me'],
        ['department', 'All in my department'],
        ['multichoice', 'Chosen departments'],
        ['all', 'All projects (with overview)']
    ];

    function _userPvToggle(idx, val) {
        var box = document.getElementById('upvd-' + idx);
        if (box) box.style.display = val === 'multichoice' ? 'block' : 'none';
    }

    function saveUserRow(idx, id) {
        var u = _users.find(function(x) { return x.id === id; });
        if (!u) return;
        var jobTitle = document.getElementById('ujt-' + idx) ? document.getElementById('ujt-' + idx).value.trim() : '';
        var department = document.getElementById('udpt-' + idx) ? document.getElementById('udpt-' + idx).value : '';
        var projectView = document.getElementById('upv-' + idx) ? document.getElementById('upv-' + idx).value : '';
        var userRole = document.getElementById('urole-' + idx) ? document.getElementById('urole-' + idx).value : '';
        var depts = [];
        var cbs = document.querySelectorAll('#upvd-' + idx + ' input[type="checkbox"]:checked');
        cbs.forEach(function(cb) { depts.push(cb.value); });
        updateUser(id, { jobTitle: jobTitle, department: department, projectView: projectView, projectViewDepts: depts, userRole: userRole }).then(function() {
            showToast('User updated', 'success');
            renderUserAdmin();
        });
    }

    function renderUserAdmin() {
        var current = getCurrentUser();
        var canEdit = (typeof window.isAdmin === 'function' && isAdmin()) || (current && current.role === 'admin');
        var depts = getDepartments();
        var rows = _users.map(function(u, i) {
            var jobTitleCell = canEdit
                ? '<input type="text" id="ujt-' + i + '" value="' + escapeHtml(u.jobTitle || '') + '" placeholder="Job title" style="padding:6px 8px;border:1px solid #d5ddd0;border-radius:6px;font-size:12px;width:120px;box-sizing:border-box;">'
                : escapeHtml(u.jobTitle || '');
            var deptCell = canEdit
                ? '<select id="udpt-' + i + '" style="padding:6px 8px;border:1px solid #d5ddd0;border-radius:6px;font-size:12px;">' +
                  '<option value="">-- Select --</option>' +
                  depts.map(function(d) { return '<option value="' + escapeHtml(d) + '"' + ((u.department || '') === d ? ' selected' : '') + '>' + escapeHtml(d) + '</option>'; }).join('') +
                  '</select>'
                : escapeHtml(u.department || '');
            var curPv = u.projectView || '';
            var pvSelect = '<select id="upv-' + i + '" onchange="Users.userPvToggle(' + i + ',this.value)" style="padding:6px 8px;border:1px solid #d5ddd0;border-radius:6px;font-size:12px;width:100%;box-sizing:border-box;">' +
                _pvOpts.map(function(o) { return '<option value="' + o[0] + '"' + (curPv === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
                '</select>';
            var selDepts = u.projectViewDepts || [];
            var pvDepts = '<div id="upvd-' + i + '" style="display:' + (curPv === 'multichoice' ? 'block' : 'none') + ';margin-top:4px;max-height:130px;overflow-y:auto;border:1px solid #eee;border-radius:6px;padding:4px;background:#fafaf8;">' +
                depts.map(function(d) { return '<label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#555;padding:2px;"><input type="checkbox" value="' + escapeHtml(d) + '" ' + (selDepts.indexOf(d) >= 0 ? 'checked' : '') + '> ' + escapeHtml(d) + '</label>'; }).join('') +
                '</div>';
            var pvCell = canEdit
                ? (pvSelect + pvDepts)
                : '<span style="font-size:11px;font-weight:700;color:#555;">' + escapeHtml(_pvLabels[curPv] || 'Default') + '</span>';
            var saveBtn = canEdit
                ? '<button onclick="Users.saveUserRow(' + i + ',\'' + u.id + '\')" style="background:#6E8E6D;color:#fff;padding:6px 12px;border:none;border-radius:6px;font-weight:800;font-size:11px;cursor:pointer;white-space:nowrap;">Save</button>'
                : '';
            var curRole = u.userRole || (u.role === 'admin' ? 'admin' : (u.shopStoreId ? 'shop' : 'hq'));
            var roleCell = canEdit
                ? '<select id="urole-' + i + '" style="padding:6px 8px;border:1px solid #d5ddd0;border-radius:6px;font-size:12px;">'
                  + '<option value="hq"' + (curRole === 'hq' ? ' selected' : '') + '>HQ</option>'
                  + '<option value="shop"' + (curRole === 'shop' ? ' selected' : '') + '>Shop</option>'
                  + '<option value="area_manager"' + (curRole === 'area_manager' ? ' selected' : '') + '>Area Manager</option>'
                  + '<option value="admin"' + (curRole === 'admin' ? ' selected' : '') + '>Admin</option>'
                  + '</select>'
                : '<span style="font-size:11px;font-weight:700;color:#555;text-transform:capitalize;">' + escapeHtml(curRole) + '</span>';
            return '<tr style="border-bottom:1px solid #eee;font-size:13px;vertical-align:top;">' +
                '<td style="padding:8px 12px;font-weight:700;">' + escapeHtml(u.name) + '</td>' +
                '<td style="padding:8px 12px;">' + escapeHtml(u.email || '') + '</td>' +
                '<td style="padding:8px 12px;">' + deptCell + '</td>' +
                '<td style="padding:8px 12px;">' + jobTitleCell + '</td>' +
                '<td style="padding:8px 12px;min-width:190px;">' + pvCell + '</td>' +
                '<td style="padding:8px 12px;">' + roleCell + '</td>' +
                '<td style="padding:8px 12px;">' + saveBtn + '</td>' +
                '</tr>';
        }).join('');
        document.getElementById('mainView').innerHTML = '<div style="max-width:1080px;margin:0 auto;padding:16px;"><h2 style="font-family:Merriweather,Georgia,serif;font-size:22px;color:#20231F;margin-bottom:16px;">User Admin</h2>' +
            (canEdit ? '<p style="font-size:12px;color:#6E8E6D;font-weight:700;margin-bottom:12px;">\u270E Edit role, job title, department and Project View, then Save. <b>Role</b> controls what each user can see and access.</p>' : '') +
            '<div style="background:#fff;border:1px solid #d5ddd0;border-radius:12px;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:960px;"><thead><tr style="background:#f8f7f4;font-size:11px;font-weight:800;color:#888;text-transform:uppercase;"><th style="padding:10px 12px;text-align:left;">Name</th><th style="padding:10px 12px;text-align:left;">Email</th><th style="padding:10px 12px;text-align:left;">Department</th><th style="padding:10px 12px;text-align:left;">Job Title</th><th style="padding:10px 12px;text-align:left;">Project View</th><th style="padding:10px 12px;text-align:left;">Role</th><th style="padding:10px 12px;text-align:left;"></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            '<p style="font-size:11px;color:#888;margin-top:12px;">' + _users.length + ' users total &mdash; Roles: <b>Shop</b> = own store only, <b>Area Manager</b> = their area, <b>HQ</b> = all stores, <b>Admin</b> = full access</p>'
            + '<div id="testViewSwitcher" style="margin-top:24px;"></div></div>';
        /* Render test view switcher */
        if (typeof Access !== 'undefined' && Access.renderTestViewSwitcher) {
            var switcherEl = document.getElementById('testViewSwitcher');
            if (switcherEl) switcherEl.innerHTML = Access.renderTestViewSwitcher();
        }
    }

    /* ─── Expose public API ─────────────────────────────────────── */
    return {
        getDepartments: getDepartments,
        getDeptOptionsHtml: getDeptOptionsHtml,
        SENIOR_DEPARTMENTS: SENIOR_DEPARTMENTS,
        addDepartment: addDepartment,
        init: init,
        getAll: getAll,
        getByDepartment: getByDepartment,
        getById: getById,
        create: create,
        getCurrentUser: getCurrentUser,
        setCurrentUser: setCurrentUser,
        clearCurrentUser: clearCurrentUser,
        renderLoginScreen: renderLoginScreen,
        updateHeaderBadge: updateHeaderBadge,
        doEntraLogin: doEntraLogin,
        _confirmEntraUser: _confirmEntraUser,
        _cancelEntraConfirm: _cancelEntraConfirm,
        doLogout: doLogout,
        showLogin: showLogin,
        getEffectiveUser: getEffectiveUser,
        canSeeTab: canSeeTab,
        canSeeView: canSeeView,
        updateUser: updateUser,
        saveUserRow: saveUserRow,
        userPvToggle: _userPvToggle,
        renderUserAdmin: renderUserAdmin,
        getRole: getRole,
        getArea: getArea,
        isShop: isShop,
        isAreaManager: isAreaManager,
        isHQ: isHQ,
        getStoresForUser: getStoresForUser
    };
})();
