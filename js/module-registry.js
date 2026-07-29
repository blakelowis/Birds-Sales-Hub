/* ─── Module Registry v1 ──────────────────────────────────────── */
/* Central system for discovering, registering, loading, testing   */
/* and managing division modules. Config stored in modules.json    */

window.ModuleRegistry = (function() {
    'use strict';

    var _modules = {};
    var _config = null;
    var _loaded = {};

    /* ─── Default config ─────────────────────────────────────── */
    var DEFAULT_CONFIG = {
        divisions: {
            retail: { label: 'Retail', modules: [] },
            bakery: { label: 'Bakery', modules: [] }
        },
        shared: ['documents', 'projects', 'templates', 'mywork', 'archive'],
        modulePositions: {},
        fullScopeRoles: ['Director', 'Project Manager', 'Head of Retail', 'admin']
    };

    /* Module IDs that are built-in views, NOT module files */
    var BUILTIN_IDS = ['sales', 'audits', 'tracker', 'complaints', 'documents', 'projects',
        'templates', 'mywork', 'archive', 'overview', 'trends', 'masterreview', 'areas',
        'storecards', 'storereports', 'leaderboard', 'halloffame', 'winners', 'champions',
        'auditexport', 'documentcreate', 'documentarchive', 'templatelibrary', 'templatebuilder',
        'templatefill', 'adminmodules', 'adminusers', 'banding', 'missingweeks', 'control',
        'auditperform', 'projectcreate', 'production', 'testmodule', 'tastepanels', 'trials',
        'productdev', 'missingweeks'];

    /* ─── Module contract ────────────────────────────────────── */
    /* Every module MUST call register() with this shape:          */
    /* { id, name, division, icon, order, init, render, destroy } */
    function register(def) {
        if (!def || !def.id) { console.error('[ModuleRegistry] Module missing id'); return false; }
        if (_modules[def.id]) { console.warn('[ModuleRegistry] Duplicate module:', def.id); return false; }
        _modules[def.id] = {
            id: def.id,
            name: def.name || def.id,
            division: def.division || 'shared',
            icon: def.icon || '',
            order: def.order || 99,
            init: def.init || function() {},
            render: def.render || function(c) { c.innerHTML = '<p>Module not implemented.</p>'; },
            destroy: def.destroy || function() {},
            status: 'registered',
            registeredAt: Date.now()
        };
        console.log('[ModuleRegistry] Registered:', def.id);
        return true;
    }

    /* ─── Get registered module ──────────────────────────────── */
    function get(id) { return _modules[id] || null; }
    function getAll() { return Object.values(_modules); }
    function getByDivision(division) {
        return Object.values(_modules).filter(function(m) { return m.division === division; });
    }

    /* ─── Config: load from modules.json (IDB → Graph → filesystem) */
    async function loadConfig() {
        if (_config) return _config;

        /* Try IDB first (birds_documents store) */
        try {
            var text = await _localDocsGetText('Config/modules.json');
            if (text) { _config = JSON.parse(text); } 
        } catch(e) {}

        /* Try filesystem fallback */
        if (!_config && window.directoryHandle) {
            try {
                var cfgFolder = null;
                for await (var entry of window.directoryHandle.values()) {
                    if (entry.kind === 'directory' && entry.name === 'Config') { cfgFolder = entry; break; }
                }
                if (cfgFolder) {
                    for await (var sub of cfgFolder.values()) {
                        if (sub.kind === 'file' && sub.name === 'modules.json') {
                            var file = await sub.getFile();
                            var text = await file.text();
                            _config = JSON.parse(text);
                        }
                    }
                }
            } catch(e) {}
        }

        /* Use defaults if nothing loaded */
        if (!_config) {
            _config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }

        /* Clean stale built-in IDs from config */
        var changed = false;
        Object.keys(_config.divisions || {}).forEach(function(divId) {
            var before = _config.divisions[divId].modules.length;
            _config.divisions[divId].modules = _config.divisions[divId].modules.filter(function(mid) {
                return BUILTIN_IDS.indexOf(mid) === -1;
            });
            if (_config.divisions[divId].modules.length !== before) changed = true;
        });
        if (changed) { await saveConfig(_config); console.log('[ModuleRegistry] Cleaned stale module IDs from config'); }

        return _config;
    }

    /* ─── Config: save to IDB + filesystem ───────────────────── */
    async function saveConfig(cfg) {
        _config = cfg;
        await _localDocsPutText('Config/modules.json', JSON.stringify(cfg, null, 2));
    }

    function getConfig() { return _config || JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }

    /* ─── Sandbox test: load a module JS in isolated context ─── */
    async function testModule(id) {
        var result = { passed: false, checks: [], errors: [] };

        /* Check 1: Module registered? */
        if (!_modules[id]) {
            result.errors.push('Module "' + id + '" not registered — JS may not have loaded');
            return result;
        }
        result.checks.push({ name: 'Registration', ok: true });

        var mod = _modules[id];

        /* Check 2: Required fields? */
        var requiredFields = ['name', 'division', 'render'];
        var missingFields = requiredFields.filter(function(f) { return !mod[f]; });
        if (missingFields.length) {
            result.errors.push('Missing required fields: ' + missingFields.join(', '));
            return result;
        }
        result.checks.push({ name: 'Contract fields', ok: true });

        /* Check 3: init() runs without error? */
        try {
            if (typeof mod.init === 'function') await mod.init();
            result.checks.push({ name: 'init()', ok: true });
        } catch(e) {
            result.errors.push('init() threw: ' + e.message);
            return result;
        }

        /* Check 4: render() runs in hidden div? */
        try {
            var testDiv = document.createElement('div');
            testDiv.style.cssText = 'position:absolute;left:-9999px;width:400px;height:300px;';
            document.body.appendChild(testDiv);
            if (typeof mod.render === 'function') await mod.render(testDiv);
            var hasContent = testDiv.innerHTML.trim().length > 0;
            document.body.removeChild(testDiv);
            if (!hasContent) {
                result.errors.push('render() produced no output');
                return result;
            }
            result.checks.push({ name: 'render()', ok: true });
        } catch(e) {
            if (testDiv.parentNode) document.body.removeChild(testDiv);
            result.errors.push('render() threw: ' + e.message);
            return result;
        }

        /* Check 5: destroy() runs without error? */
        try {
            if (typeof mod.destroy === 'function') mod.destroy();
            result.checks.push({ name: 'destroy()', ok: true });
        } catch(e) {
            result.errors.push('destroy() threw: ' + e.message);
            return result;
        }

        result.passed = true;
        mod.status = 'tested';
        return result;
    }

    /* ─── Load module JS files from filesystem ────────────────── */
    async function loadModuleScripts(divisionFilter) {
        var cfg = await loadConfig();
        var moduleIds = [];

        /* Only load modules for the requested division (or all for admins) */
        if (divisionFilter && cfg.divisions[divisionFilter]) {
            moduleIds = moduleIds.concat(cfg.divisions[divisionFilter].modules);
        }
        /* Full-scope users get all divisions */
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var isFullScope = user && (cfg.fullScopeRoles || []).indexOf(user.department) !== -1;
        var isAdmin = user && user.role === 'admin';
        if (isFullScope || isAdmin) {
            Object.keys(cfg.divisions).forEach(function(div) {
                cfg.divisions[div].modules.forEach(function(mid) {
                    if (moduleIds.indexOf(mid) === -1) moduleIds.push(mid);
                });
            });
        }

        /* Filter to only modules that look like real module IDs (contain no special patterns) */
        var VALID_MOD_PATTERN = /^[a-z][a-z0-9_-]+$/;

        for (var i = 0; i < moduleIds.length; i++) {
            var mid = moduleIds[i];
            if (_loaded[mid]) continue;

            /* Skip IDs that are clearly built-in views, not module files */
            if (BUILTIN_IDS.indexOf(mid) !== -1) continue;
            if (!/^[a-z][a-z0-9_-]+$/.test(mid)) continue;

            /* Try filesystem: read JS text and eval */
            if (window.directoryHandle) {
                try {
                    var modFolder = null;
                    for await (var entry of window.directoryHandle.values()) {
                        if (entry.kind === 'directory' && entry.name === 'Modules') { modFolder = entry; break; }
                    }
                    if (modFolder) {
                        var found = false;
                        for await (var file of modFolder.values()) {
                            if (file.kind === 'file' && file.name === mid + '.js') {
                                var f = await file.getFile();
                                var text = await f.text();
                                var scriptEl = document.createElement('script');
                                scriptEl.textContent = text;
                                document.head.appendChild(scriptEl);
                                _loaded[mid] = true;
                                found = true;
                                console.log('[ModuleRegistry] Loaded from filesystem:', mid);
                                break;
                            }
                        }
                        if (found) continue;
                    }
                } catch(e) { /* skip */ }
            }

            /* Fallback: try <script src> for served modules */
            if (!_loaded[mid]) {
                try {
                    await _loadScript('Modules/' + mid + '.js');
                    _loaded[mid] = true;
                    console.log('[ModuleRegistry] Loaded from web root:', mid);
                } catch(e) {
                    /* Module file not found — skip silently */
                }
            }
        }
    }

    /* ─── Load script by injecting <script> ──────────────────── */
    function _loadScript(path) {
        return new Promise(function(resolve, reject) {
            var existing = document.querySelector('script[src*="' + path + '"]');
            if (existing) { resolve(); return; }
            var script = document.createElement('script');
            script.src = path;
            script.onload = resolve;
            script.onerror = function() { reject(new Error('Failed to load ' + path)); };
            document.head.appendChild(script);
        });
    }

    /* ─── Scan Data/Modules/ folder for JS files ─────────────── */
    async function scanModulesFolder() {
        var discovered = [];

        if (window.directoryHandle) {
            try {
                var modFolder = null;
                for await (var entry of window.directoryHandle.values()) {
                    if (entry.kind === 'directory' && entry.name === 'Modules') { modFolder = entry; break; }
                }
                if (!modFolder) return discovered;
                for await (var file of modFolder.values()) {
                    if (file.kind === 'file' && file.name.endsWith('.js')) {
                        discovered.push({
                            filename: file.name,
                            id: file.name.replace('.js', ''),
                            registered: !!_modules[file.name.replace('.js', '')]
                        });
                    }
                }
            } catch(e) { console.warn('[ModuleRegistry] Folder scan failed:', e.message); }
        }

        return discovered;
    }

    /* ─── Render admin module panel ──────────────────────────── */
    async function renderAdminPanel() {
        var cfg = await loadConfig();
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (!user || user.role !== 'admin') {
            return '<div class="card p-8 text-center"><h2 class="text-xl font-black text-slate-700">Access Denied</h2><p class="text-sm text-slate-400 mt-2">Admin privileges required.</p></div>';
        }

        var scanned = await scanModulesFolder();
        var allMods = getAll();

        /* ── Published modules (in config + registered) ── */
        var publishedHtml = '';
        Object.keys(cfg.divisions).forEach(function(divId) {
            var div = cfg.divisions[divId];
            var modList = div.modules.map(function(mid) {
                var mod = _modules[mid];
                var label = mod ? (mod.icon + ' ' + mod.name) : mid;
                var status = mod ? (mod.status === 'tested' ? 'tested' : 'registered') : 'not loaded';
                var statusColor = status === 'tested' ? 'emerald' : status === 'registered' ? 'blue' : 'red';
                return '<div class="flex items-center justify-between py-2 px-3 bg-white border border-slate-200 rounded-lg">' +
                    '<div class="flex items-center gap-2">' +
                    '<span class="text-sm font-bold text-slate-700">' + label + '</span>' +
                    '<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-' + statusColor + '-100 text-' + statusColor + '-600">' + status + '</span>' +
                    '</div>' +
                    '<div class="flex gap-1">' +
                    '<button onclick="ModuleRegistry._testFromAdmin(\'' + mid + '\')" class="text-[10px] font-bold px-2 py-1 rounded bg-blue-100 text-blue-600 hover:bg-blue-200">Test</button>' +
                    '<button onclick="ModuleRegistry._unpublishModule(\'' + mid + '\',\'' + divId + '\')" class="text-[10px] font-bold px-2 py-1 rounded bg-red-100 text-red-600 hover:bg-red-200">Remove</button>' +
                    '</div></div>';
            }).join('');
            publishedHtml += '<div class="mb-4">' +
                '<h3 class="text-sm font-black text-slate-600 uppercase tracking-wider mb-2">' + div.label + '</h3>' +
                '<div class="space-y-1">' + (modList || '<p class="text-xs text-slate-400">No modules published</p>') + '</div></div>';
        });

        /* ── Discovered files (in Modules/ folder but not published) ── */
        var discovered = scanned.filter(function(s) {
            return cfg.divisions.bakery ? cfg.divisions.bakery.modules.indexOf(s.id) === -1 : true;
        });
        var discoveredAll = scanned;
        var scanHtml = '';
        if (discoveredAll.length) {
            scanHtml = discoveredAll.map(function(s) {
                var isPublished = false;
                Object.values(cfg.divisions).forEach(function(d) { if (d.modules.indexOf(s.id) !== -1) isPublished = true; });
                var badge = isPublished
                    ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-600">published</span>'
                    : '<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-600">draft</span>';
                var actionBtns = '';
                if (isPublished) {
                    actionBtns = '<button onclick="ModuleRegistry._testFromAdmin(\'' + s.id + '\')" class="text-[10px] font-bold px-2 py-1 rounded bg-blue-100 text-blue-600 hover:bg-blue-200">Test</button>';
                } else {
                    actionBtns = '<button onclick="ModuleRegistry._loadTestPublish(\'' + s.id + '\')" class="text-[10px] font-bold px-2 py-1 rounded bg-emerald-100 text-emerald-600 hover:bg-emerald-200">Load & Test</button>' +
                        '<button onclick="ModuleRegistry._publishModule(\'' + s.id + '\')" class="text-[10px] font-bold px-2 py-1 rounded bg-birds-green text-white hover:bg-emerald-800">Publish</button>';
                }
                return '<div class="flex items-center justify-between py-2 px-3 bg-white border border-slate-200 rounded-lg">' +
                    '<div class="flex items-center gap-2"><span class="text-sm font-bold text-slate-700">' + s.filename + '</span>' + badge + '</div>' +
                    '<div class="flex gap-1">' + actionBtns + '</div></div>';
            }).join('');
        } else {
            scanHtml = '<p class="text-sm text-slate-400">No module files found in Data/Modules/</p>';
        }

        /* ── Upload area ── */
        var uploadHtml = '<div class="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-birds-green transition-colors">' +
            '<p class="text-sm font-bold text-slate-600 mb-2">Upload Module JavaScript</p>' +
            '<p class="text-xs text-slate-400 mb-4">Upload a .js file → it appears as Draft → Load & Test → Publish</p>' +
            '<input type="file" id="moduleUploadInput" accept=".js" class="hidden" onchange="ModuleRegistry._handleUpload(event)">' +
            '<button onclick="document.getElementById(\'moduleUploadInput\').click()" class="btn-primary rounded-none text-sm">Choose File</button></div>';

        /* ── Placement selector (for publishing) ── */
        var placementHtml = '<div class="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200">' +
            '<p class="text-xs font-bold text-slate-600 mb-2">Quick Publish to Division</p>' +
            '<div class="flex gap-2 items-end">' +
            '<select id="pub-module-select" class="text-xs px-3 py-1.5 border border-slate-200 rounded-lg bg-white">' +
            '<option value="">Select module...</option>' +
            discoveredAll.filter(function(s) {
                var isPublished = false;
                Object.values(cfg.divisions).forEach(function(d) { if (d.modules.indexOf(s.id) !== -1) isPublished = true; });
                return !isPublished;
            }).map(function(s) { return '<option value="' + s.id + '">' + s.filename + '</option>'; }).join('') +
            '</select>' +
            '<select id="pub-division-select" class="text-xs px-3 py-1.5 border border-slate-200 rounded-lg bg-white">' +
            Object.keys(cfg.divisions).map(function(d) { return '<option value="' + d + '">' + cfg.divisions[d].label + '</option>'; }).join('') +
            '</select>' +
            '<button onclick="ModuleRegistry._publishToDivision()" class="text-xs font-bold px-4 py-1.5 rounded bg-birds-green text-white hover:bg-emerald-800">Publish</button>' +
            '</div></div>';

        return '<div class="space-y-6">' +
            '<div><h1 class="text-2xl font-black text-slate-800">Admin — Module Management</h1>' +
            '<p class="text-sm text-slate-400 mt-1">Upload → Draft → Test → Publish → Live in nav</p></div>' +

            '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">' +
            '<div>' +
            '<h2 class="text-lg font-black text-slate-700 mb-3">Published Modules</h2>' + publishedHtml +
            '</div>' +
            '<div>' +
            '<h2 class="text-lg font-black text-slate-700 mb-3">Discovered Files</h2>' + scanHtml +
            placementHtml +
            '</div>' +
            '</div>' +

            '<div><h2 class="text-lg font-black text-slate-700 mb-3">Upload New Module</h2>' + uploadHtml + '</div>' +
            '<div id="moduleTestResult"></div>' +
            '</div>';
    }

    /* ─── Admin actions ──────────────────────────────────────── */
    async function _testFromAdmin(id) {
        var el = document.getElementById('moduleTestResult');
        if (!el) return;
        el.innerHTML = '<div class="card p-4 border-l-4 border-l-blue-500"><p class="text-sm font-bold text-blue-600">Testing module "' + id + '"...</p></div>';

        var result = await testModule(id);
        if (result.passed) {
            el.innerHTML = '<div class="card p-4 border-l-4 border-l-emerald-500 bg-emerald-50">' +
                '<p class="text-sm font-black text-emerald-700 mb-2">✓ "' + id + '" passed all checks</p>' +
                result.checks.map(function(c) { return '<p class="text-xs text-emerald-600">✓ ' + c.name + '</p>'; }).join('') +
                '</div>';
        } else {
            el.innerHTML = '<div class="card p-4 border-l-4 border-l-red-500 bg-red-50">' +
                '<p class="text-sm font-black text-red-700 mb-2">✗ "' + id + '" failed</p>' +
                result.errors.map(function(e) { return '<p class="text-xs text-red-600">✗ ' + e + '</p>'; }).join('') +
                '</div>';
        }
    }

    /* ─── Load a discovered module from filesystem + add to config + test */
    async function _loadAndTest(id) {
        var el = document.getElementById('moduleTestResult');
        if (!el) return;
        el.innerHTML = '<div class="card p-4 border-l-4 border-l-blue-500"><p class="text-sm font-bold text-blue-600">Loading module "' + id + '" from filesystem...</p></div>';

        /* Read from filesystem */
        var loaded = false;
        if (window.directoryHandle) {
            try {
                var modFolder = null;
                for await (var entry of window.directoryHandle.values()) {
                    if (entry.kind === 'directory' && entry.name === 'Modules') { modFolder = entry; break; }
                }
                if (modFolder) {
                    for await (var file of modFolder.values()) {
                        if (file.kind === 'file' && file.name === id + '.js') {
                            var f = await file.getFile();
                            var text = await f.text();
                            var scriptEl = document.createElement('script');
                            scriptEl.textContent = text;
                            document.head.appendChild(scriptEl);
                            _loaded[id] = true;
                            loaded = true;
                            console.log('[ModuleRegistry] Loaded from filesystem:', id);
                            break;
                        }
                    }
                }
            } catch(e) { console.warn('[ModuleRegistry] Load failed:', e.message); }
        }

        if (!loaded || !_modules[id]) {
            el.innerHTML = '<div class="card p-4 border-l-4 border-l-red-500 bg-red-50">' +
                '<p class="text-sm font-black text-red-700">✗ Could not load or register "' + id + '"</p>' +
                '<p class="text-xs text-red-600 mt-1">Make sure the file calls ModuleRegistry.register() with id: "' + id + '"</p></div>';
            return;
        }

        /* Now test it */
        var result = await testModule(id);
        if (result.passed) {
            el.innerHTML = '<div class="card p-4 border-l-4 border-l-emerald-500 bg-emerald-50">' +
                '<p class="text-sm font-black text-emerald-700 mb-2">✓ "' + id + '" loaded and passed all checks</p>' +
                result.checks.map(function(c) { return '<p class="text-xs text-emerald-600">✓ ' + c.name + '</p>'; }).join('') +
                '<p class="text-xs text-emerald-500 mt-2">Module tested. Click Publish to make it live in a division.</p>' +
                '</div>';
        } else {
            el.innerHTML = '<div class="card p-4 border-l-4 border-l-red-500 bg-red-50">' +
                '<p class="text-sm font-black text-red-700 mb-2">✗ "' + id + '" loaded but failed tests</p>' +
                result.errors.map(function(e) { return '<p class="text-xs text-red-600">✗ ' + e + '</p>'; }).join('') +
                '</div>';
        }
    }

    async function _handleUpload(event) {
        var file = event.target.files[0];
        if (!file) return;
        var text = await file.text();
        var filename = file.name;
        var moduleId = filename.replace('.js', '');

        /* Write to filesystem if available */
        if (window.directoryHandle) {
            try {
                var modFolder = null;
                for await (var entry of window.directoryHandle.values()) {
                    if (entry.kind === 'directory' && entry.name === 'Modules') { modFolder = entry; break; }
                }
                if (!modFolder) modFolder = await window.directoryHandle.getDirectoryHandle('Modules', { create: true });
                var fh = await modFolder.getFileHandle(filename, { create: true });
                var ws = await fh.createWritable();
                await ws.write(text);
                await ws.close();
            } catch(e) {
                showToast('Upload failed: ' + e.message, 'error');
                return;
            }
        }

        /* Also write to web root Modules/ so <script src> can find it */
        try {
            var webModFolder = null;
            for await (var entry of window.directoryHandle.values()) {
                if (entry.kind === 'directory' && entry.name === 'Modules') { webModFolder = entry; break; }
            }
        } catch(e) {}

        /* Load the module immediately via eval */
        try {
            var scriptEl = document.createElement('script');
            scriptEl.textContent = text;
            document.head.appendChild(scriptEl);
            _loaded[moduleId] = true;
            if (!_modules[moduleId]) {
                showToast('File uploaded but module "' + moduleId + '" did not register. Check that it calls ModuleRegistry.register()', 'error');
            }
        } catch(e) {
            showToast('Upload eval error: ' + e.message, 'error');
        }

        showToast('File uploaded as draft. Click Publish to make it live.', 'success');

        /* Re-render admin panel */
        if (typeof setView === 'function') setView('adminmodules');
    }

    /* ─── Publish a module (add to bakery config) ──────────── */
    async function _publishModule(id) {
        var cfg = await loadConfig();
        if (!cfg.divisions.bakery) cfg.divisions.bakery = { label: 'Bakery', modules: [] };
        if (cfg.divisions.bakery.modules.indexOf(id) !== -1) {
            showToast('"' + id + '" is already published', 'info');
            return;
        }
        cfg.divisions.bakery.modules.push(id);
        await saveConfig(cfg);
        showToast('"' + id + '" published to Bakery', 'success');
        /* Re-render nav + admin */
        await _renderBakeryNav();
        if (typeof setView === 'function') setView('adminmodules');
    }

    /* ─── Publish to a specific division ──────────────────── */
    async function _publishToDivision() {
        var sel = document.getElementById('pub-module-select');
        var divSel = document.getElementById('pub-division-select');
        if (!sel || !divSel) return;
        var id = sel.value;
        var divId = divSel.value;
        if (!id || !divId) { showToast('Select a module and division', 'error'); return; }

        var cfg = await loadConfig();
        if (!cfg.divisions[divId]) cfg.divisions[divId] = { label: divId, modules: [] };
        if (cfg.divisions[divId].modules.indexOf(id) !== -1) {
            showToast('"' + id + '" is already published to ' + cfg.divisions[divId].label, 'info');
            return;
        }
        cfg.divisions[divId].modules.push(id);
        await saveConfig(cfg);
        showToast('"' + id + '" published to ' + cfg.divisions[divId].label, 'success');
        await _renderBakeryNav();
        if (typeof setView === 'function') setView('adminmodules');
    }

    /* ─── Unpublish a module (remove from config) ─────────── */
    async function _unpublishModule(id, divId) {
        var cfg = await loadConfig();
        if (cfg.divisions[divId]) {
            cfg.divisions[divId].modules = cfg.divisions[divId].modules.filter(function(m) { return m !== id; });
            await saveConfig(cfg);
        }
        showToast('"' + id + '" removed from ' + (cfg.divisions[divId] ? cfg.divisions[divId].label : divId), 'success');
        await _renderBakeryNav();
        if (typeof setView === 'function') setView('adminmodules');
    }

    /* ─── Load + test (discovered file, no publish) ──────── */
    async function _loadTestPublish(id) {
        var el = document.getElementById('moduleTestResult');
        if (!el) return;
        el.innerHTML = '<div class="card p-4 border-l-4 border-l-blue-500"><p class="text-sm font-bold text-blue-600">Loading and testing "' + id + '"...</p></div>';

        /* Load from filesystem */
        if (window.directoryHandle) {
            try {
                var modFolder = null;
                for await (var entry of window.directoryHandle.values()) {
                    if (entry.kind === 'directory' && entry.name === 'Modules') { modFolder = entry; break; }
                }
                if (modFolder) {
                    var fh = await modFolder.getFileHandle(id + '.js');
                    var file = await fh.getFile();
                    var text = await file.text();
                    var scriptEl = document.createElement('script');
                    scriptEl.textContent = text;
                    document.head.appendChild(scriptEl);
                    _loaded[id] = true;
                }
            } catch(e) {}
        }

        var result = await testModule(id);
        if (result.passed) {
            el.innerHTML = '<div class="card p-4 border-l-4 border-l-emerald-500 bg-emerald-50">' +
                '<p class="text-sm font-black text-emerald-700 mb-2">✓ "' + id + '" passed all checks</p>' +
                result.checks.map(function(c) { return '<p class="text-xs text-emerald-600">✓ ' + c.name + '</p>'; }).join('') +
                '<p class="text-xs text-emerald-500 mt-2">Ready to publish. Click Publish to make it live.</p>' +
                '</div>';
        } else {
            el.innerHTML = '<div class="card p-4 border-l-4 border-l-red-500 bg-red-50">' +
                '<p class="text-sm font-black text-red-700 mb-2">✗ "' + id + '" failed tests</p>' +
                result.errors.map(function(e) { return '<p class="text-xs text-red-600">✗ ' + e + '</p>'; }).join('') +
                '</div>';
        }
    }

    /* ─── Full-scope check ───────────────────────────────────── */
    function isFullScope(user) {
        if (!user) return false;
        if (user.role === 'admin') return true;
        var cfg = _config || DEFAULT_CONFIG;
        return (cfg.fullScopeRoles || []).indexOf(user.department) !== -1;
    }

    /* ─── Get nav modules for current user ───────────────────── */
    async function getNavModules() {
        var cfg = await loadConfig();
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var fullScope = isFullScope(user);

        var result = { divisions: {}, shared: cfg.shared || [] };

        Object.keys(cfg.divisions).forEach(function(divId) {
            var div = cfg.divisions[divId];
            result.divisions[divId] = {
                label: div.label,
                modules: fullScope ? div.modules : (user && _isUserInDivision(user, divId) ? div.modules : [])
            };
        });

        return result;
    }

    function _isUserInDivision(user, divId) {
        if (!user) return false;
        /* Map existing departments to divisions */
        var retailDepts = ['General', 'Area Sales Team', 'Technical', 'Training & Development', 'Retail Auditor', 'Head of Retail', 'Production Manager', 'Project Manager', 'Director', 'IT'];
        var bakeryDepts = ['Bakery', 'Production', 'Quality', 'NPD'];
        if (divId === 'retail') return retailDepts.indexOf(user.department) !== -1;
        if (divId === 'bakery') return bakeryDepts.indexOf(user.department) !== -1;
        return false;
    }

    /* ─── Expose public API ──────────────────────────────────── */
    return {
        register: register,
        get: get,
        getAll: getAll,
        getByDivision: getByDivision,
        loadConfig: loadConfig,
        saveConfig: saveConfig,
        getConfig: getConfig,
        testModule: testModule,
        loadModuleScripts: loadModuleScripts,
        scanModulesFolder: scanModulesFolder,
        renderAdminPanel: renderAdminPanel,
        isFullScope: isFullScope,
        getNavModules: getNavModules,
        _testFromAdmin: _testFromAdmin,
        _loadAndTest: _loadAndTest,
        _loadTestPublish: _loadTestPublish,
        _handleUpload: _handleUpload,
        _publishModule: _publishModule,
        _publishToDivision: _publishToDivision,
        _unpublishModule: _unpublishModule
    };
})();
