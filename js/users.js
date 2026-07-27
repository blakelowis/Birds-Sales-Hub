/* ─── Users Module v134 ────────────────────────────────────────── */
/* User authentication: IDB + filesystem (.users/) + localStorage  */
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

    /* ─── Filesystem helpers (.users/ directory) ────────────────── */
    async function _loadFromFilesystem() {
        if (!directoryHandle) return [];
        try {
            var dir = await directoryHandle.getDirectoryHandle('.users');
            var out = [];
            for await (var entry of dir.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                    try {
                        var data = JSON.parse(await (await entry.getFile()).text());
                        if (data && data.id && data.name) out.push(data);
                    } catch(e) {}
                }
            }
            return out;
        } catch(e) { return []; }
    }

    async function _saveToFilesystem(user) {
        if (!directoryHandle) return;
        try {
            var dir = await directoryHandle.getDirectoryHandle('.users', { create: true });
            var fh = await dir.getFileHandle(user.id + '.json', { create: true });
            var w = await fh.createWritable();
            await w.write(JSON.stringify(user, null, 2));
            await w.close();
        } catch(e) { console.warn('[Users] Filesystem save failed:', e); }
    }

    async function syncAllToFilesystem() {
        if (!directoryHandle || !_users.length) return;
        console.log('[Users] Syncing', _users.length, 'users to filesystem...');
        for (var i = 0; i < _users.length; i++) {
            await _saveToFilesystem(_users[i]);
        }
        console.log('[Users] Filesystem sync complete');
    }

    async function _deleteFromFilesystem(id) {
        if (!directoryHandle) return;
        try {
            var dir = await directoryHandle.getDirectoryHandle('.users');
            await dir.removeEntry(id + '.json');
        } catch(e) {}
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

        /* Load users: filesystem first, then IDB, then bundled fallback */
        var fsUsers = await _loadFromFilesystem();
        if (fsUsers.length) {
            _users = fsUsers;
            for (var i = 0; i < _users.length; i++) {
                await _idbPut(_users[i]);
            }
        } else {
            _users = await _idbGetAll();
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
            if (!found) { _currentUser = null; _clearStored(); }
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
            pin: pin || '',
            created: new Date().toISOString().substring(0, 10)
        };
        _users.push(user);
        await _idbPut(user);
        await _saveToFilesystem(user);
        return user;
    }

    function verify(name, pin) {
        return _users.find(function(u) {
            return u.name.toLowerCase() === name.toLowerCase() && u.pin === pin;
        }) || null;
    }

    function getCurrentUser() { return _currentUser; }

    function setCurrentUser(user) {
        _currentUser = { id: user.id, name: user.name, department: user.department };
        _setStored(_currentUser);
    }

    function clearCurrentUser() {
        _currentUser = null;
        _clearStored();
    }

    /* ─── Login Screen ──────────────────────────────────────────── */
    function renderLoginScreen() {
        /* Hide nav panels */
        document.querySelectorAll('.nav-panel').forEach(function(p) { p.classList.remove('open'); });
        document.querySelectorAll('.nav-tab').forEach(function(t) { t.classList.remove('active'); });

        var depts = getDepartments().map(function(d) {
            return '<option value="' + d + '">' + d + '</option>';
        }).join('') + '<option value="__add_custom__">+ Add Custom Department...</option>';

        var allNames = _users.map(function(u) {
            return '<option value="' + u.id + '" data-dept="' + escapeAttr(u.department) + '">' + escapeHtml(u.name) + '</option>';
        }).join('');

        document.getElementById('mainView').innerHTML = `
        <div style="max-width:440px;margin:40px auto 80px;">
            <div class="card" style="padding:40px 36px;">
                <div style="text-align:center;margin-bottom:28px;">
                    <img src="logo.png" alt="Birds" style="height:56px;margin-bottom:10px;">
                    <h2 style="font-family:'Merriweather',Georgia,serif;font-size:22px;color:#4A4A4A;margin:0 0 4px;">Welcome to The Hub</h2>
                    <p style="color:#7A7A7A;font-size:12px;margin:0;">Sign in to continue</p>
                </div>

                <div style="margin-bottom:14px;">
                    <label style="display:block;font-size:10px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Department</label>
                    <select id="loginDept" onchange="Users._onDeptChange(this,'loginName')" style="width:100%;padding:9px 12px;border:1px solid #E8E5E0;border-radius:8px;font-size:13px;background:#fff;color:#4A4A4A;outline:none;">
                        <option value="">All Departments</option>
                        ${depts}
                    </select>
                </div>

                <div style="margin-bottom:14px;">
                    <label style="display:block;font-size:10px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Name</label>
                    <select id="loginName" onchange="Users._onNameChange()" style="width:100%;padding:9px 12px;border:1px solid #E8E5E0;border-radius:8px;font-size:13px;background:#fff;color:#4A4A4A;outline:none;">
                        <option value="">${_users.length ? 'Select your name...' : 'No accounts yet — create one below'}</option>
                        ${allNames}
                    </select>
                </div>

                <div id="loginPinArea">
                    <div style="margin-bottom:22px;">
                        <label style="display:block;font-size:10px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">PIN</label>
                        <input type="password" id="loginPin" maxlength="8"
                            onkeydown="if(event.key==='Enter')Users.doLogin()"
                            style="width:100%;padding:9px 12px;border:1px solid #E8E5E0;border-radius:8px;font-size:13px;outline:none;"
                            placeholder="Enter your PIN">
                    </div>
                </div>

                <div id="loginError" style="display:none;color:#D94F4F;font-size:12px;font-weight:600;margin-bottom:12px;text-align:center;"></div>

                <button id="loginBtn" onclick="Users.doLogin()" style="width:100%;padding:11px;background:#6E8E6D;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;transition:background .15s;"
                    onmouseover="this.style.background='#5A7A59'" onmouseout="this.style.background='#6E8E6D'">Sign In</button>

                <div style="text-align:center;margin-top:20px;">
                    <a href="#" onclick="Users.showRegister();return false;" style="color:#6E8E6D;font-size:12px;font-weight:600;text-decoration:none;">First time? <span style="text-decoration:underline;">Create Account</span></a>
                </div>
            </div>
            <p style="text-align:center;color:#aaa;font-size:10px;margin-top:16px;">Your account is saved to the data folder for cross-device access</p>
        </div>`;
    }

    /* ─── Register Screen ───────────────────────────────────────── */
    function renderRegisterScreen() {
        var depts = getDepartments().map(function(d) {
            return '<option value="' + d + '">' + d + '</option>';
        }).join('') + '<option value="__add_custom__">+ Add Custom Department...</option>';

        document.getElementById('mainView').innerHTML = `
        <div style="max-width:440px;margin:40px auto 80px;">
            <div class="card" style="padding:40px 36px;">
                <div style="text-align:center;margin-bottom:28px;">
                    <img src="logo.png" alt="Birds" style="height:56px;margin-bottom:10px;">
                    <h2 style="font-family:'Merriweather',Georgia,serif;font-size:22px;color:#4A4A4A;margin:0 0 4px;">Create Account</h2>
                    <p style="color:#7A7A7A;font-size:12px;margin:0;">Set up your profile to get started</p>
                </div>

                <div style="margin-bottom:14px;">
                    <label style="display:block;font-size:10px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Full Name</label>
                    <input type="text" id="regName" style="width:100%;padding:9px 12px;border:1px solid #E8E5E0;border-radius:8px;font-size:13px;outline:none;" placeholder="e.g. John Smith">
                </div>

                <div style="margin-bottom:14px;">
                    <label style="display:block;font-size:10px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Department</label>
                    <select id="regDept" onchange="Users._onDeptChange(this)" style="width:100%;padding:9px 12px;border:1px solid #E8E5E0;border-radius:8px;font-size:13px;background:#fff;color:#4A4A4A;outline:none;">
                        <option value="">Select department...</option>
                        ${depts}
                    </select>
                </div>

                <div style="margin-bottom:14px;">
                    <label style="display:block;font-size:10px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">PIN</label>
                    <input type="password" id="regPin" maxlength="8" style="width:100%;padding:9px 12px;border:1px solid #E8E5E0;border-radius:8px;font-size:13px;outline:none;" placeholder="Choose a PIN (4-8 digits)">
                </div>

                <div style="margin-bottom:22px;">
                    <label style="display:block;font-size:10px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Confirm PIN</label>
                    <input type="password" id="regPinConfirm" maxlength="8"
                        onkeydown="if(event.key==='Enter')Users.doRegister()"
                        style="width:100%;padding:9px 12px;border:1px solid #E8E5E0;border-radius:8px;font-size:13px;outline:none;" placeholder="Re-enter your PIN">
                </div>

                <div id="regError" style="display:none;color:#D94F4F;font-size:12px;font-weight:600;margin-bottom:12px;text-align:center;"></div>

                <button onclick="Users.doRegister()" style="width:100%;padding:11px;background:#6E8E6D;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;transition:background .15s;"
                    onmouseover="this.style.background='#5A7A59'" onmouseout="this.style.background='#6E8E6D'">Create Account</button>

                <div style="text-align:center;margin-top:20px;">
                    <a href="#" onclick="Users.showLogin();return false;" style="color:#6E8E6D;font-size:12px;font-weight:600;text-decoration:none;">&larr; Back to Sign In</a>
                </div>
            </div>
        </div>`;
    }

    /* ─── Name change: detect first-time users ────────────────────── */
    function _onNameChange() {
        var nameSel = document.getElementById('loginName');
        var area = document.getElementById('loginPinArea');
        var errEl = document.getElementById('loginError');
        if (errEl) errEl.style.display = 'none';
        if (!nameSel || !nameSel.value || !area) return;

        var user = getById(nameSel.value);
        if (!user) return;

        if (!user.pin) {
            /* First time — show PIN creation fields */
            area.innerHTML = `
                <div style="margin-bottom:14px;">
                    <label style="display:block;font-size:10px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Create your PIN</label>
                    <input type="password" id="loginPinNew" maxlength="8"
                        style="width:100%;padding:9px 12px;border:1px solid #E8E5E0;border-radius:8px;font-size:13px;outline:none;"
                        placeholder="Choose a 4+ digit PIN">
                </div>
                <div style="margin-bottom:22px;">
                    <label style="display:block;font-size:10px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Confirm PIN</label>
                    <input type="password" id="loginPinConfirm" maxlength="8"
                        onkeydown="if(event.key==='Enter')Users.doFirstLogin()"
                        style="width:100%;padding:9px 12px;border:1px solid #E8E5E0;border-radius:8px;font-size:13px;outline:none;"
                        placeholder="Re-enter your PIN">
                </div>`;
            var btn = document.getElementById('loginBtn');
            if (btn) { btn.textContent = 'Set PIN & Sign In'; btn.onclick = function() { Users.doFirstLogin(); }; }
        } else {
            /* Normal — show PIN entry */
            area.innerHTML = `
                <div style="margin-bottom:22px;">
                    <label style="display:block;font-size:10px;font-weight:700;color:#7A7A7A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">PIN</label>
                    <input type="password" id="loginPin" maxlength="8"
                        onkeydown="if(event.key==='Enter')Users.doLogin()"
                        style="width:100%;padding:9px 12px;border:1px solid #E8E5E0;border-radius:8px;font-size:13px;outline:none;"
                        placeholder="Enter your PIN">
                </div>`;
            var btn = document.getElementById('loginBtn');
            if (btn) { btn.textContent = 'Sign In'; btn.onclick = function() { Users.doLogin(); }; }
        }
    }

    /* ─── First login: set PIN for pre-created accounts ───────────── */
    function doFirstLogin() {
        var nameSel = document.getElementById('loginName');
        var pinNew = document.getElementById('loginPinNew');
        var pinConfirm = document.getElementById('loginPinConfirm');
        var errEl = document.getElementById('loginError');

        if (!nameSel || !nameSel.value) { _showErr(errEl, 'Please select your name'); return; }
        var pin = pinNew ? pinNew.value : '';
        var pin2 = pinConfirm ? pinConfirm.value : '';

        if (!pin) { _showErr(errEl, 'Please choose a PIN'); return; }
        if (pin.length < 4) { _showErr(errEl, 'PIN must be at least 4 digits'); return; }
        if (pin !== pin2) { _showErr(errEl, 'PINs do not match'); return; }

        var user = getById(nameSel.value);
        if (!user) { _showErr(errEl, 'User not found'); return; }

        user.pin = pin;
        _idbPut(user);
        _saveToFilesystem(user);

        setCurrentUser(user);
        updateHeaderBadge();
        showToast('PIN set — welcome, ' + user.name + '!', 'success');
        renderDashboard();
    }

    /* ─── Actions ───────────────────────────────────────────────── */
    function doLogin() {
        var nameSel = document.getElementById('loginName');
        var pinInput = document.getElementById('loginPin');
        var errEl = document.getElementById('loginError');

        if (!nameSel || !nameSel.value) {
            _showErr(errEl, 'Please select your name');
            return;
        }
        if (!pinInput || !pinInput.value) {
            _showErr(errEl, 'Please enter your PIN');
            return;
        }

        var user = getById(nameSel.value);
        if (!user) {
            _showErr(errEl, 'User not found');
            return;
        }
        if (user.pin !== pinInput.value) {
            _showErr(errEl, 'Incorrect PIN');
            pinInput.value = '';
            pinInput.focus();
            return;
        }

        setCurrentUser(user);
        updateHeaderBadge();
        renderDashboard();
    }

    function doRegister() {
        var nameEl = document.getElementById('regName');
        var deptEl = document.getElementById('regDept');
        var pinEl = document.getElementById('regPin');
        var pinConfirmEl = document.getElementById('regPinConfirm');
        var errEl = document.getElementById('regError');

        var name = (nameEl.value || '').trim();
        var dept = deptEl.value;
        var pin = pinEl.value;
        var pin2 = pinConfirmEl.value;

        if (!name) { _showErr(errEl, 'Please enter your name'); return; }
        if (name.length < 2) { _showErr(errEl, 'Name must be at least 2 characters'); return; }
        if (!dept) { _showErr(errEl, 'Please select your department'); return; }
        if (!pin) { _showErr(errEl, 'Please choose a PIN'); return; }
        if (pin.length < 4) { _showErr(errEl, 'PIN must be at least 4 digits'); return; }
        if (pin !== pin2) { _showErr(errEl, 'PINs do not match'); return; }

        /* Check for duplicate name */
        var dup = _users.find(function(u) { return u.name.toLowerCase() === name.toLowerCase(); });
        if (dup) { _showErr(errEl, 'An account with this name already exists'); return; }

        create(name, dept, pin).then(function(user) {
            setCurrentUser(user);
            updateHeaderBadge();
            showToast('Account created — welcome, ' + user.name + '!', 'success');
            renderDashboard();
        });
    }

    function doLogout() {
        clearCurrentUser();
        updateHeaderBadge();
        renderLoginScreen();
    }

    function showRegister() { renderRegisterScreen(); }
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
    }

    /* ─── Name filter + custom department handler ──────────────────── */
    function _onDeptChange(deptSel, nameSelId) {
        if (!deptSel) return;
        var dept = deptSel.value;

        /* Handle "Add Custom Department..." */
        if (dept === '__add_custom__') {
            var newName = prompt('Enter new department name:');
            if (!newName || !newName.trim()) {
                deptSel.value = '';
                return;
            }
            addDepartment(newName.trim()).then(function(added) {
                if (added) {
                    showToast('Department "' + newName.trim() + '" added', 'success');
                } else {
                    showToast('Department already exists', 'warning');
                }
                /* Re-render whichever screen we're on */
                var loginDept = document.getElementById('loginDept');
                var regDept = document.getElementById('regDept');
                if (loginDept) renderLoginScreen();
                else if (regDept) renderRegisterScreen();
            });
            return;
        }

        /* Filter names by department (login screen only) */
        if (!nameSelId) return;
        var nameSel = document.getElementById(nameSelId);
        if (!nameSel) return;

        var filtered = dept ? getByDepartment(dept) : _users;
        var html = '<option value="">' + (filtered.length ? 'Select your name...' : 'No one in this department') + '</option>';
        for (var i = 0; i < filtered.length; i++) {
            html += '<option value="' + filtered[i].id + '">' + escapeHtml(filtered[i].name) + '</option>';
        }
        nameSel.innerHTML = html;
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
        verify: verify,
        getCurrentUser: getCurrentUser,
        setCurrentUser: setCurrentUser,
        clearCurrentUser: clearCurrentUser,
        renderLoginScreen: renderLoginScreen,
        renderRegisterScreen: renderRegisterScreen,
        updateHeaderBadge: updateHeaderBadge,
        doLogin: doLogin,
        doFirstLogin: doFirstLogin,
        doRegister: doRegister,
        syncAllToFilesystem: syncAllToFilesystem,
        doLogout: doLogout,
        showRegister: showRegister,
        showLogin: showLogin,
        _onDeptChange: _onDeptChange,
        _onNameChange: _onNameChange
    };
})();
