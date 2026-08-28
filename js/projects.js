/* ─── Projects Module v135 ────────────────────────────────────── */
/* Staged workflow tracker with assignments, notifications,       */
/* department grouping, email alerts, and "My Work" integration   */

window.Projects = (function() {
    var _projects = [];
    var PROJECT_PREFIX = 'PRJ-';

    /* ─── Department list: sourced from Users module ──────────── */
    function _getDepts() {
        return (typeof Users !== 'undefined' && Users.getDepartments) ? Users.getDepartments() : ['General'];
    }

    /* Management / senior users see an all-projects overview */
    function _isManagement(user) {
        if (!user) return false;
        if (typeof window.isAdmin === 'function' && isAdmin()) return true;
        var dept = String(user.department || '').toLowerCase();
        if (dept.indexOf('management') >= 0) return true;
        if (typeof Users !== 'undefined' && Users.SENIOR_DEPARTMENTS) {
            return Users.SENIOR_DEPARTMENTS.some(function(d) { return d === user.department; });
        }
        return false;
    }

    /* Central project-visibility gate (used by the list AND the detail view) */
    function _projectVisible(p, user) {
        if (!user) return true;
        if (typeof window.isAdmin === 'function' && isAdmin()) return true;
        /* Check team membership */
        var inTeam = p.team && p.team.indexOf(user.id) >= 0;
        /* Check area membership — if project has areas, user must be in one of them */
        var inArea = true;
        if (p.areas && p.areas.length) {
            var userAreas = (typeof Access !== 'undefined' && Access.getAllowedAreas) ? Access.getAllowedAreas() : [];
            if (userAreas.indexOf('all') < 0) {
                inArea = p.areas.some(function(a) { return userAreas.indexOf(a) >= 0; });
            }
        }
        var involved =
            p.createdBy === user.id ||
            inTeam ||
            (p.stages && p.stages.some(function(s) { return _isUserAssignedToStage(s, user.id); })) ||
            p.department === user.department ||
            (p.members && p.members.indexOf(user.id) >= 0);
        var pv = user.projectView || '';
        if (pv === 'mine') return p.createdBy === user.id || inTeam || (p.stages && p.stages.some(function(s) { return _isUserAssignedToStage(s, user.id); }));
        if (pv === 'department') return (p.department === user.department || involved) && inArea;
        if (pv === 'multichoice') {
            var depts = user.projectViewDepts || [];
            if (!depts.length) return involved && inArea;
            return (depts.indexOf(p.department) >= 0 || involved) && inArea;
        }
        if (pv === 'all') return inArea;
        return involved && inArea;
    }

    /* ─── Storage: birds_documents IDB + Graph API (SharePoint) ── */
    function _path(id) { return 'Projects/' + id + '.json'; }

    async function _saveToFilesystem(project) {
        if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
            try {
                await GraphClient.ensureFolder('Projects');
                await GraphClient.writeFile('Projects/' + project.id + '.json', JSON.stringify(project, null, 2));
            } catch(e) { console.warn('[Projects] Graph save failed:', e.message); }
        }
    }

    async function _deleteFromFilesystem(id) {
        if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
            try { await GraphClient.deleteFile('Projects/' + id + '.json'); } catch(e) {}
        }
    }

    async function _loadFromFilesystem() {
        if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
            try {
                var items = await GraphClient.listJsonFiles('Projects');
                var results = [];
                for (var item of items) {
                    try {
                        var text = await GraphClient.readFile('Projects/' + item.name);
                        if (text) results.push(JSON.parse(text));
                    } catch(e) {}
                }
                return results;
            } catch(e) { console.warn('[Projects] Graph load failed:', e.message); return []; }
        }
        return [];
    }

    async function _loadAll() {
        if (!window._localDocsConnection) { try { await _localDocsInit(); } catch(e) { console.warn('[Projects] _localDocsInit failed:', e.message); } }

        /* Try reading projects_master.json first (fast, single file) */
        if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
            try {
                var masterText = await GraphClient.readFile('projects_master.json');
                if (masterText) {
                    var master = JSON.parse(masterText);
                    if (master && master.projects && master.projects.length) {
                        _projects = master.projects.slice();
                        // Load full files for projects where current user is involved (stages needed for MyWork)
                        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
                        if (user && user.id) {
                            for (var mi2 = 0; mi2 < _projects.length; mi2++) {
                                if (_projects[mi2]._assignedUsers && _projects[mi2]._assignedUsers.indexOf(user.id) >= 0) {
                                    try {
                                        var fullText = await GraphClient.readFile('Projects/' + _projects[mi2].id + '.json');
                                        if (fullText) {
                                            var fullP = JSON.parse(fullText);
                                            if (fullP && fullP.stages && fullP.stages.length) _projects[mi2] = fullP;
                                        }
                                    } catch(e) {}
                                }
                            }
                        }
                        for (var mi = 0; mi < _projects.length; mi++) { await _idbPut(_path(_projects[mi].id), JSON.stringify(_projects[mi])); }
                        console.log('[Projects] Loaded', master.projects.length, 'projects from master');
                        return _projects;
                    }
                }
            } catch(e) { console.warn('[Projects] Master load failed:', e.message); }
        }

        /* Fallback: load individual files (no filtering — render functions handle visibility) */
        var fsProjects = await _loadFromFilesystem();
        if (fsProjects.length) {
            _projects = fsProjects;
            for (var i = 0; i < _projects.length; i++) { await _idbPut(_path(_projects[i].id), JSON.stringify(_projects[i])); }
            // Build master for next time
            setTimeout(function() { buildProjectsMaster().catch(function() {}); }, 500);
            return _projects;
        }

        /* Fallback to IDB */
        if (!window._localDocsConnection) {
            try { await _localDocsInit(); } catch(e) {}
        }
        if (!window._localDocsConnection) { console.warn('[Projects] No IDB connection — returning empty'); return []; }
        return new Promise(function(resolve) {
            try {
                var tx = window._localDocsConnection.transaction('files', 'readonly');
                var store = tx.objectStore('files');
                var results = [];
                var req = store.openCursor();
                req.onsuccess = function(e) {
                    var cursor = e.target.result;
                    if (cursor) {
                        var key = cursor.value.path;
                        if (key && key.indexOf('Projects/') === 0 && key.endsWith('.json')) {
                            try { results.push(JSON.parse(cursor.value.data)); } catch(ex) {}
                        }
                        cursor.continue();
                    } else {
                        resolve(results);
                    }
                };
                req.onerror = function() { resolve([]); };
            } catch(e) { resolve([]); }
        });
    }

    function _idbPut(path, data) {
        if (!window._localDocsConnection) return Promise.resolve(false);
        return new Promise(function(resolve) {
            try {
                var tx = window._localDocsConnection.transaction('files', 'readwrite');
                var req = tx.objectStore('files').put({ path: path, data: data });
                req.onsuccess = function() { resolve(true); };
                req.onerror = function() { resolve(false); };
            } catch(e) { resolve(false); }
        });
    }

    async function _save(project) {
        if (!window._localDocsConnection) await _localDocsInit();
        /* Save to IDB (awaited) */
        await _idbPut(_path(project.id), JSON.stringify(project));
        /* Save to filesystem (shared across users) */
        await _saveToFilesystem(project);
        /* Also store in runtime cache */
        var idx = _projects.findIndex(function(p) { return p.id === project.id; });
        if (idx >= 0) _projects[idx] = project; else _projects.unshift(project);
    }

    async function _delete(id) {
        if (!window._localDocsConnection) return;
        try {
            var tx = window._localDocsConnection.transaction('files', 'readwrite');
            tx.objectStore('files').delete(_path(id));
        } catch(e) {}
        await _deleteFromFilesystem(id);
    }

    /* ─── Load / Refresh ──────────────────────────────────────── */
    async function load() {
        _projects = await _loadAll();
        _projects.sort(function(a, b) {
            return (b.createdAt || '').localeCompare(a.createdAt || '');
        });
        return _projects;
    }

    function getAll() { return _projects.slice(); }

    function getById(id) { return _projects.find(function(p) { return p.id === id; }) || null; }

    /* ─── Filtered views ──────────────────────────────────────── */
    function getActive() {
        return _projects.filter(function(p) { return p.status === 'active'; });
    }

    function getCompleted() {
        return _projects.filter(function(p) { return p.status === 'resolved'; });
    }

    function getForUser(userId) {
        return _projects.filter(function(p) {
            if (p.createdBy === userId) return true;
            return p.stages.some(function(s) {
                return _isUserAssignedToStage(s, userId);
            });
        });
    }

    function getForDepartment(dept) {
        if (!dept) return _projects.slice();
        return _projects.filter(function(p) { return p.department === dept; });
    }

    /* ─── Helper: is user assigned to a stage? ────────────────── */
    function _isUserAssignedToStage(stage, userId) {
        if (stage.assignType === 'department') {
            var user = (typeof Users !== 'undefined') ? Users.getById(userId) : null;
            if (!user) return false;
            /* Check multi-dept array first, fall back to single dept */
            if (stage.assignDepartments && stage.assignDepartments.length) {
                return stage.assignDepartments.indexOf(user.department) !== -1;
            }
            return stage.assignDepartment && user.department === stage.assignDepartment;
        }
        if (stage.assignType === 'custom') return false;
        return stage.assignedTo && stage.assignedTo.indexOf(userId) !== -1;
    }

    /* Get projects where the user has an active (pending/in_progress) stage */
    function getAssignedToUser(userId) {
        return _projects.filter(function(p) {
            if (p.status !== 'active' || !p.stages) return false;
            var currentIdx = p.currentStageIndex || 0;
            for (var i = currentIdx; i < p.stages.length; i++) {
                if (_isUserAssignedToStage(p.stages[i], userId)) return true;
            }
            return false;
        });
    }

    /* Get stages waiting on a specific user */
    function getStagesForUser(userId) {
        var results = [];
        _projects.forEach(function(p) {
            if (p.status !== 'active' || !p.stages) return;
            var currentIdx = p.currentStageIndex || 0;
            for (var i = currentIdx; i < p.stages.length; i++) {
                var s = p.stages[i];
                if (_isUserAssignedToStage(s, userId)) {
                    results.push({ project: p, stage: s, stageIndex: i });
                }
            }
        });
        return results;
    }

    /* Get stages the user is waiting on (someone else has it) */
    function getWaitingOnOthers(userId) {
        var results = [];
        _projects.forEach(function(p) {
            if (p.status !== 'active' || !p.stages) return;
            var currentIdx = p.currentStageIndex || 0;
            for (var i = currentIdx; i < p.stages.length; i++) {
                var s = p.stages[i];
                if (s.status !== 'completed' && !_isUserAssignedToStage(s, userId) && (s.assignedTo.length || s.assignType)) {
                    results.push({ project: p, stage: s, stageIndex: i });
                    break;
                }
            }
        });
        return results;
    }

    /* ─── Create project ──────────────────────────────────────── */
    async function create(name, description, department, startDate, endDate, team, areas) {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var project = {
            id: PROJECT_PREFIX + new Date().getFullYear() + '-' + _uid('').substring(0, 8),
            name: name.trim(),
            description: (description || '').trim(),
            department: department || 'General',
            status: 'active',
            createdBy: user ? user.id : '',
            createdByName: user ? user.name : 'Unknown',
            createdAt: new Date().toISOString().substring(0, 10),
            startDate: startDate || '',
            endDate: endDate || '',
            overrunReason: '',
            overrunImprovement: '',
            currentStageIndex: 0,
            stages: [],
            team: team || [],
            areas: areas || []
        };
        _projects.unshift(project);
        await _save(project);
        return project;
    }

    /* ─── Project presets (saved templates) ───────────────────── */
    async function _loadPresets() {
        if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
            try {
                var text = await GraphClient.readFile('project_presets.json');
                if (text) { var p = JSON.parse(text); if (p && p.presets) return p.presets; }
            } catch(e) { console.warn('[Projects] Presets load failed:', e.message); }
        }
        return [];
    }

    async function _savePresets(presets) {
        if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
            try {
                await GraphClient.writeFile('project_presets.json', JSON.stringify({ presets: presets }, null, 2));
            } catch(e) { console.warn('[Projects] Presets save failed:', e.message); }
        }
    }

    async function saveProjectAsPreset(projectId) {
        var p = getById(projectId);
        if (!p) return null;
        var preset = {
            id: 'PRESET-' + Date.now().toString(36),
            name: p.name,
            description: p.description || '',
            department: p.department || 'General',
            createdByName: p.createdByName || '',
            createdAt: new Date().toISOString().substring(0, 10),
            stages: (p.stages || []).map(function(s) {
                return {
                    title: s.title,
                    description: s.description || '',
                    assignedTo: (s.assignedTo || []).slice(),
                    assignType: s.assignType || 'persons',
                    assignDepartments: (s.assignDepartments || []).slice(),
                    assignDepartment: s.assignDepartment || '',
                    assignCustom: s.assignCustom || '',
                    dueDate: s.dueDate || ''
                };
            })
        };
        var presets = await _loadPresets();
        presets = presets.filter(function(x) { return x.name !== preset.name; });
        presets.unshift(preset);
        await _savePresets(presets);
        return preset;
    }

    async function deleteProjectPreset(presetId) {
        var presets = await _loadPresets();
        presets = presets.filter(function(p) { return p.id !== presetId; });
        await _savePresets(presets);
    }

    async function createFromPreset(presetId) {
        var presets = await _loadPresets();
        var preset = presets.find(function(p) { return p.id === presetId; });
        if (!preset) return null;
        var project = await create(preset.name, preset.description, preset.department);
        for (var i = 0; i < (preset.stages || []).length; i++) {
            var st = preset.stages[i];
            var stage = await addStage(project.id, st.title, st.description, st.assignedTo, st.dueDate);
            if (stage) {
                stage.assignType = st.assignType;
                stage.assignDepartments = (st.assignDepartments || []).slice();
                stage.assignDepartment = st.assignDepartment;
                stage.assignCustom = st.assignCustom;
            }
        }
        await _save(project);
        return project;
    }

    /* ─── Stage management ────────────────────────────────────── */
    async function addStage(projectId, title, description, assignedTo, dueDate) {
        var p = getById(projectId);
        if (!p) return null;
        var stage = {
            id: 'stage-' + Date.now().toString(36),
            title: title.trim(),
            description: (description || '').trim(),
            assignedTo: assignedTo || [],
            assignType: window._lastAssignType || 'persons',
            assignDepartments: window._lastAssignDepartments || [],
            assignDepartment: (window._lastAssignDepartments && window._lastAssignDepartments.length) ? window._lastAssignDepartments[0] : '',
            assignCustom: window._lastAssignCustom || '',
            dueDate: dueDate || '',
            status: 'pending',
            completedBy: null,
            completedAt: null,
            completedByName: null,
            overview: '',
            documents: [],
            templates: [],
            photos: [],
            notes: []
        };
        p.stages.push(stage);
        await _save(p);
        return stage;
    }

    async function updateStage(projectId, stageId, updates) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        Object.keys(updates).forEach(function(k) { stage[k] = updates[k]; });
        await _save(p);
    }

    async function completeStage(projectId, stageId, overview) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        stage.status = 'completed';
        stage.completedBy = user ? user.id : '';
        stage.completedByName = user ? user.name : 'Unknown';
        stage.completedAt = new Date().toISOString().substring(0, 10);
        stage.overview = overview || '';
        /* Advance to next stage */
        var stageIdx = p.stages.indexOf(stage);
        if (stageIdx >= p.currentStageIndex) {
            p.currentStageIndex = stageIdx + 1;
        }
        /* Check if all stages complete */
        if (p.currentStageIndex >= p.stages.length) {
            p.status = 'needs_resolution';
        }
        await _save(p);
    }

    async function resolveProject(projectId) {
        var p = getById(projectId);
        if (!p) return;
        p.status = 'resolved';
        p.resolvedAt = new Date().toISOString().substring(0, 10);
        await _save(p);
    }

    async function deleteProject(projectId) {
        _projects = _projects.filter(function(p) { return p.id !== projectId; });
        await _delete(projectId);
    }

    /* ─── Email notification ──────────────────────────────────── */
    function emailNextStage(projectId, stageId) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        var stageIdx = p.stages.indexOf(stage);
        var nextStage = p.stages[stageIdx + 1];
        if (!nextStage) {
            showToast('No next stage', 'warning');
            return;
        }
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var assigneeNames = '';
        if (nextStage.assignType === 'department' && nextStage.assignDepartment) {
            var emailDeptMembers = (typeof Users !== 'undefined') ? Users.getByDepartment(nextStage.assignDepartment) : [];
            var emailDeptNames = emailDeptMembers.map(function(m) { return m.name; }).join(', ');
            assigneeNames = nextStage.assignDepartment + (emailDeptNames ? ' (' + emailDeptNames + ')' : ' (no members)');
        } else if (nextStage.assignType === 'custom' && nextStage.assignCustom) {
            assigneeNames = nextStage.assignCustom;
        } else {
            assigneeNames = (nextStage.assignedTo || []).map(function(uid) {
                var u = (typeof Users !== 'undefined') ? Users.getById(uid) : null;
                return u ? u.name : uid;
            }).join(', ') || 'Unassigned';
        }

        var subject = encodeURIComponent('Stage Complete: ' + stage.title + ' — ' + p.name);
        var body = encodeURIComponent(
            'Project: ' + p.name + '\n' +
            'Department: ' + p.department + '\n\n' +
            'Stage Completed: ' + stage.title + '\n' +
            (stage.overview ? 'Summary: ' + stage.overview + '\n\n' : '\n') +
            'Next Stage: ' + nextStage.title + '\n' +
            'Description: ' + nextStage.description + '\n' +
            'Assigned to: ' + assigneeNames + '\n\n' +
            'Please log in to The Hub to begin this stage.\n\n' +
            '— ' + (user ? user.name : 'Project Leader')
        );
        window.open('mailto:?subject=' + subject + '&body=' + body, '_self');
    }

    /* ─── Progress calculation ────────────────────────────────── */
    function getProgress(project) {
        if (!project.stages || !project.stages.length) return 0;
        var done = project.stages.filter(function(s) { return s.status === 'completed'; }).length;
        return Math.round((done / project.stages.length) * 100);
    }
    
    function getCurrentStage(project) {
        if (project.stages && project.currentStageIndex < project.stages.length) {
            return project.stages[project.currentStageIndex];
        }
        return null;
    }

    function getStageRag(stage) {
        if (stage.status === 'completed') return 'green';
        if (!stage.dueDate) return null;
        var now = new Date();
        var due = new Date(stage.dueDate + 'T23:59:59');
        var diff = Math.ceil((due - now) / 86400000);
        if (diff < 0) return 'red';
        if (diff <= 3) return 'amber';
        return 'green';
    }

    function getProjectRag(project) {
        if (project.status === 'resolved') return 'green';
        if (!project.endDate) return null;
        var now = new Date();
        var end = new Date(project.endDate + 'T23:59:59');
        var diff = Math.ceil((end - now) / 86400000);
        if (diff < 0) return 'red';
        if (diff <= 7) return 'amber';
        /* Also check if any stage is overdue */
        var hasOverdue = project.stages && project.stages.some(function(s) { return getStageRag(s) === 'red'; });
        if (hasOverdue) return 'amber';
        return 'green';
    }

    function _ragColor(rag) {
        if (rag === 'red') return { bg: '#fef2f2', color: '#dc2626', border: '#fca5a5', label: 'Overdue' };
        if (rag === 'amber') return { bg: '#fef9ee', color: '#d97706', border: '#fcd34d', label: 'At Risk' };
        if (rag === 'green') return { bg: '#f0fdf4', color: '#16a34a', border: '#86efac', label: 'On Track' };
        return null;
    }

    /* ─── Generate email body for all assigned users ──────────── */
    function emailAllAssignees(projectId) {
        var p = getById(projectId);
        if (!p) return;
        var currentStage = getCurrentStage(p);
        if (!currentStage) { showToast('No active stage', 'warning'); return; }
        emailNextStage(projectId, currentStage.id);
    }

    /* ═══════════════════════════════════════════════════════════════
       UI: PROJECT CREATION FORM
       ═══════════════════════════════════════════════════════════════ */
    function renderCreateProject() {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var deptOptions = (typeof Users !== 'undefined') ? Users.getDeptOptionsHtml(user ? user.department : 'General', false) : '<option>General</option>';
        deptOptions += '<option value="__add_custom__">+ Add Custom Department...</option>';
        var dept = user ? user.department : 'General';
        var users = (typeof Users !== 'undefined') ? Users.getAll() : [];
        var allUsersHtml = users.map(function(u) {
            return '<option value="' + u.id + '">' + escapeHtml(u.name) + ' (' + escapeHtml(u.department) + ')</option>';
        }).join('');
        /* Area options from DEFAULT_AREA_MAPPING */
        var areaNames = typeof AM_LIST !== 'undefined' ? AM_LIST.slice() : [];
        var areaChecks = areaNames.filter(function(a) { return a !== 'Unassigned'; }).map(function(a) {
            return '<label class="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-50 cursor-pointer">' +
                '<input type="checkbox" value="' + escapeHtml(a) + '" class="prj-area-cb accent-[#6E8E6D]">' +
                '<span class="text-sm">' + escapeHtml(a) + '</span>' +
                '</label>';
        }).join('');

        document.getElementById('mainView').innerHTML = `
        <div style="max-width:700px;margin:0 auto;">
            <div class="card p-6 border-t-4 border-t-birds-green rounded-none">
                <div class="flex items-center justify-between mb-5">
                    <div>
                        <h2 class="text-2xl font-black birds-green">Create New Project</h2>
                        <p class="text-sm text-slate-400">Set up a staged workflow — add stages and assign team members as you go.</p>
                    </div>
                    <button onclick="setView('projects')" class="text-sm font-bold text-slate-500 hover:text-slate-700">\u2190 Back</button>
                </div>

                <div class="space-y-4">
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Project Name *</label>
                        <input type="text" id="prj-name" class="w-full p-3 border border-slate-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-birds-green outline-none" placeholder="e.g. New Product Integration — Farmhouse Loaf">
                    </div>
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Description</label>
                        <textarea id="prj-desc" class="w-full p-3 border border-slate-200 rounded-lg text-sm resize-y h-20 focus:ring-2 focus:ring-birds-green outline-none" placeholder="Brief description of the project goals..."></textarea>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Department</label>
                            <select id="prj-dept" onchange="Projects._onDeptChange(this)" class="w-full p-3 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-birds-green outline-none">${deptOptions}</select>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Start Date <span class="text-slate-300">(optional)</span></label>
                            <input type="date" id="prj-start" class="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-birds-green outline-none">
                        </div>
                        <div>
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Target End Date <span class="text-slate-300">(optional)</span></label>
                            <input type="date" id="prj-end" class="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-birds-green outline-none">
                        </div>
                    </div>
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Team Members <span class="text-slate-300">(who is involved?)</span></label>
                        <select id="prj-team" multiple class="w-full p-3 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-birds-green outline-none" size="4">${allUsersHtml}</select>
                        <p class="text-[10px] text-slate-400 mt-1">Hold Ctrl/Cmd to select multiple. Team members can always see this project.</p>
                    </div>
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Visible to Areas <span class="text-slate-300">(leave empty = visible to all)</span></label>
                        <div style="max-height:120px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fafaf8;">
                            ${areaChecks}
                        </div>
                        <p class="text-[10px] text-slate-400 mt-1">If no areas selected, everyone can see this project. Area managers only see projects matching their area.</p>
                    </div>
                </div>

                <div class="mt-6 pt-4 border-t border-slate-100">
                    <button onclick="Projects._doCreate()" style="background:#6E8E6D;color:white;padding:10px 24px;border-radius:8px;font-weight:800;font-size:13px;border:none;cursor:pointer;">Create Project & Add First Stage</button>
                </div>
            </div>
        </div>`;
    }

    async function _doCreate() {
        var name = document.getElementById('prj-name');
        var desc = document.getElementById('prj-desc');
        var dept = document.getElementById('prj-dept');
        var startDate = document.getElementById('prj-start');
        var endDate = document.getElementById('prj-end');
        if (!name || !name.value.trim()) { showToast('Please enter a project name', 'error'); return; }
        /* Collect team members */
        var teamSelect = document.getElementById('prj-team');
        var team = [];
        if (teamSelect) {
            for (var i = 0; i < teamSelect.options.length; i++) {
                if (teamSelect.options[i].selected) team.push(teamSelect.options[i].value);
            }
        }
        /* Collect areas */
        var areas = [];
        document.querySelectorAll('.prj-area-cb:checked').forEach(function(cb) { areas.push(cb.value); });
        var p = await create(name.value, desc ? desc.value : '', dept ? dept.value : 'General', startDate ? startDate.value : '', endDate ? endDate.value : '', team, areas);
        showToast('Project created — now add your first stage', 'success');
        renderProjectDetail(p.id);
    }

    /* ═══════════════════════════════════════════════════════════════
       UI: ADD STAGE FORM
       ═══════════════════════════════════════════════════════════════ */
    function renderAddStage(projectId) {
        var p = getById(projectId);
        if (!p) return;
        var users = (typeof Users !== 'undefined') ? Users.getAll() : [];
        var depts = [...new Set(users.map(function(u) { return u.department || 'General'; }))].sort();
        var deptChecks = depts.map(function(d) {
            return '<label class="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-50 cursor-pointer">' +
                '<input type="checkbox" value="' + escapeHtml(d) + '" class="stage-dept-cb accent-[#6E8E6D]">' +
                '<span class="text-sm">' + escapeHtml(d) + '</span>' +
                '</label>';
        }).join('');
        var userChecks = users.map(function(u) {
            return '<label class="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-50 cursor-pointer">' +
                '<input type="checkbox" value="' + u.id + '" class="stage-assign-cb accent-[#6E8E6D]">' +
                '<span class="text-sm">' + escapeHtml(u.name) + ' <span class="text-[10px] text-slate-400">(' + escapeHtml(u.department) + ')</span></span>' +
                '</label>';
        }).join('');

        document.getElementById('stageForm-' + projectId).innerHTML = `
            <div class="card p-5 mt-3 rounded-none" style="border:2px dashed #6E8E6D;">
                <h4 class="text-sm font-black birds-green mb-3">Add New Stage</h4>
                <div class="space-y-3">
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Stage Title *</label>
                        <input type="text" id="stage-title" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-birds-green outline-none" placeholder="e.g. Food Safety Review">
                    </div>
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Description / Instructions</label>
                        <textarea id="stage-desc" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm resize-y h-16 focus:ring-2 focus:ring-birds-green outline-none" placeholder="What does this person need to do?"></textarea>
                    </div>
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Due Date <span class="text-slate-300">(optional)</span></label>
                        <input type="date" id="stage-due" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-birds-green outline-none">
                    </div>

                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Assign To</label>
                        <div class="flex gap-2 mb-3">
                            <label class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50 text-sm has-[:checked]:bg-[#6E8E6D] has-[:checked]:text-white has-[:checked]:border-[#6E8E6D] transition-all">
                                <input type="radio" name="assignType" value="department" onchange="Projects._switchAssignType('department')" class="accent-[#6E8E6D]"> Department
                            </label>
                            <label class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50 text-sm has-[:checked]:bg-[#6E8E6D] has-[:checked]:text-white has-[:checked]:border-[#6E8E6D] transition-all">
                                <input type="radio" name="assignType" value="persons" checked onchange="Projects._switchAssignType('persons')" class="accent-[#6E8E6D]"> Person(s)
                            </label>
                            <label class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50 text-sm has-[:checked]:bg-[#6E8E6D] has-[:checked]:text-white has-[:checked]:border-[#6E8E6D] transition-all">
                                <input type="radio" name="assignType" value="custom" onchange="Projects._switchAssignType('custom')" class="accent-[#6E8E6D]"> External / Custom
                            </label>
                        </div>

                        <div id="assign-dept-panel" class="hidden">
                            <div class="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                                ${deptChecks}
                            </div>
                            <p class="text-[10px] text-slate-400 mt-1">Select one or more departments</p>
                        </div>
                        <div id="assign-persons-panel" class="max-h-40 overflow-y-auto border border-slate-200 rounded-lg">
                            ${userChecks}
                        </div>
                        <div id="assign-custom-panel" class="hidden">
                            <input type="text" id="stage-assign-custom" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-birds-green outline-none" placeholder="e.g. External Auditor, Contractor name...">
                            <p class="text-[10px] text-slate-400 mt-1">Free text for external references</p>
                        </div>
                    </div>
                </div>
                <div class="flex gap-2 mt-3">
                    <button onclick="Projects._doAddStage('${projectId}')" style="background:#6E8E6D;color:white;padding:7px 16px;border-radius:6px;font-weight:800;font-size:12px;border:none;cursor:pointer;">Add Stage</button>
                    <button onclick="document.getElementById('stageForm-${projectId}').innerHTML=''" style="background:transparent;color:#999;padding:7px 16px;border-radius:6px;font-weight:700;font-size:12px;border:1px solid #E8E5E0;cursor:pointer;">Cancel</button>
                </div>
            </div>`;
        document.getElementById('stage-title').focus();
    }

    function _switchAssignType(type) {
        var deptPanel = document.getElementById('assign-dept-panel');
        var personsPanel = document.getElementById('assign-persons-panel');
        var customPanel = document.getElementById('assign-custom-panel');
        if (deptPanel) deptPanel.classList.toggle('hidden', type !== 'department');
        if (personsPanel) personsPanel.classList.toggle('hidden', type !== 'persons');
        if (customPanel) customPanel.classList.toggle('hidden', type !== 'custom');
    }

    function _collectStageAssignment() {
        var typeEl = document.querySelector('input[name="assignType"]:checked');
        var type = typeEl ? typeEl.value : 'persons';
        window._lastAssignType = type;
        var assignedTo = [];
        var assignDepartments = [];
        var assignCustom = '';

        if (type === 'department') {
            document.querySelectorAll('.stage-dept-cb:checked').forEach(function(cb) {
                assignDepartments.push(cb.value);
            });
            /* Resolve departments to user IDs */
            if (assignDepartments.length && typeof Users !== 'undefined') {
                assignDepartments.forEach(function(dept) {
                    Users.getByDepartment(dept).forEach(function(u) { if (assignedTo.indexOf(u.id) === -1) assignedTo.push(u.id); });
                });
            }
        } else if (type === 'custom') {
            var customEl = document.getElementById('stage-assign-custom');
            assignCustom = customEl ? customEl.value.trim() : '';
        } else {
            /* persons */
            document.querySelectorAll('.stage-assign-cb:checked').forEach(function(cb) {
                assignedTo.push(cb.value);
            });
        }
        window._lastAssignDepartments = assignDepartments;
        window._lastAssignCustom = assignCustom;
        return { assignedTo: assignedTo, assignType: type, assignDepartments: assignDepartments, assignCustom: assignCustom };
    }

    async function _doAddStage(projectId) {
        var title = document.getElementById('stage-title');
        var desc = document.getElementById('stage-desc');
        var dueDate = document.getElementById('stage-due');
        if (!title || !title.value.trim()) { showToast('Please enter a stage title', 'error'); return; }
        var assignment = _collectStageAssignment();
        var s = await addStage(projectId, title.value, desc ? desc.value : '', assignment.assignedTo, dueDate ? dueDate.value : '');
        showToast('Stage added', 'success');
        renderProjectDetail(projectId);
    }

    /* ═══════════════════════════════════════════════════════════════
       UI: PROJECT DETAIL VIEW
       ═══════════════════════════════════════════════════════════════ */
    async function renderProjectDetail(projectId) {
        // Load full project data if we only have summary from master
        var p = getById(projectId);
        if (!p) { showToast('Project not found', 'error'); setView('projects'); return; }
        if (!p.stages || !p.stages.length) {
            var full = await loadProjectDetail(projectId);
            if (full) p = full;
        }
        /* Security gate: block users who cannot see this project */
        var _guardUser = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (_guardUser && !_projectVisible(p, _guardUser)) {
            document.getElementById('mainView').innerHTML = '<div class="card p-8 text-center"><h2 class="text-xl font-black text-slate-700 mb-2">Access Denied</h2><p class="text-sm text-slate-400">You do not have permission to view this project.</p><button onclick="setView(\'projects\')" style="background:#6E8E6D;color:white;padding:8px 16px;border-radius:6px;font-weight:800;font-size:12px;border:none;cursor:pointer;margin-top:12px;">Back to Projects</button></div>';
            return;
        }
        var progress = getProgress(p);
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var currentIdx = p.currentStageIndex || 0;
        var statusColors = {
            active: 'background:rgba(245,158,11,0.15);color:#b45309;',
            resolved: 'background:rgba(135,157,130,0.12);color:#5B8C7A;',
            needs_resolution: 'background:rgba(107,114,128,0.15);color:#374151;'
        };
        var statusLabels = { active: 'Active', resolved: 'Resolved', needs_resolution: 'Ready to Resolve' };

        var stagesHtml = p.stages.map(function(s, idx) {
            var isCurrent = idx === currentIdx && p.status === 'active';
            var isPast = s.status === 'completed';
            var isFuture = idx > currentIdx || (idx === currentIdx && s.status !== 'completed' && !isCurrent);
            var isYourTurn = false;
            if (isCurrent && user) {
                if (s.assignType === 'department') {
                    var userDepts = (s.assignDepartments && s.assignDepartments.length) ? s.assignDepartments : (s.assignDepartment ? [s.assignDepartment] : []);
                    isYourTurn = userDepts.indexOf(user.department) !== -1;
                } else if (s.assignType !== 'custom') {
                    isYourTurn = s.assignedTo && s.assignedTo.indexOf(user.id) !== -1;
                }
            }

            var borderColor = isPast ? '#6E8E6D' : isCurrent ? '#D97706' : '#E8E5E0';
            var bgColor = isPast ? 'rgba(135,157,130,0.04)' : isYourTurn ? 'rgba(255,243,205,0.5)' : isCurrent ? 'rgba(255,243,205,0.2)' : 'transparent';
            var statusIcon = isPast ? '\u2705' : isYourTurn ? '\u26A1' : isCurrent ? '\U0001F7E1' : '\u23F3';
            var statusLabel = isPast ? 'Completed' : isYourTurn ? 'YOUR TURN' : isCurrent ? 'In Progress' : 'Waiting';
            var statusColor = isPast ? '#6E8E6D' : isYourTurn ? '#D94F4F' : isCurrent ? '#D97706' : '#999';
            /* Creator/admin may edit FUTURE stages; the active (current) stage and completed stages are locked */
            var canEditStage = user && !isPast && idx > currentIdx && (p.createdBy === user.id || (typeof window.isAdmin === 'function' && isAdmin()));

            var assigneeNames = '';
            var assignBadge = '';
            if (s.assignType === 'department') {
                var deptList = (s.assignDepartments && s.assignDepartments.length) ? s.assignDepartments : (s.assignDepartment ? [s.assignDepartment] : []);
                var deptMembers = [];
                if (typeof Users !== 'undefined') {
                    deptList.forEach(function(dept) {
                        Users.getByDepartment(dept).forEach(function(m) {
                            if (deptMembers.indexOf(m.name) === -1) deptMembers.push(m.name);
                        });
                    });
                }
                assigneeNames = deptList.join(', ') + (deptMembers.length ? ' (' + deptMembers.join(', ') + ')' : ' (no members)');
                assignBadge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 ml-1">DEPT</span>';
            } else if (s.assignType === 'custom' && s.assignCustom) {
                assigneeNames = s.assignCustom;
                assignBadge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 ml-1">EXTERNAL</span>';
            } else {
                assigneeNames = (s.assignedTo || []).map(function(uid) {
                    var u = (typeof Users !== 'undefined') ? Users.getById(uid) : null;
                    return u ? u.name : uid;
                }).join(', ') || 'Unassigned';
            }

            var completedByInfo = '';
            if (isPast && s.completedByName) {
                completedByInfo = '<div class="text-[11px] text-slate-400 mt-1">Completed by ' + escapeHtml(s.completedByName) + (s.completedAt ? ' on ' + s.completedAt : '') + '</div>';
            }

            var overviewHtml = '';
            if (isPast && s.overview) {
                overviewHtml = '<div class="mt-2 p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600 whitespace-pre-wrap">' + escapeHtml(s.overview) + '</div>';
            }

            /* Linked documents for this stage */
            var stageDocs = (s.documents || []);
            var linkedDocsHtml = '';
            if (stageDocs.length) {
                linkedDocsHtml = '<div class="mt-2 pt-2 border-t border-slate-100"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Linked Documents</p>' +
                    stageDocs.map(function(d) {
                        return '<div class="flex items-center gap-2 py-1">' +
                            '<button onclick="event.stopPropagation();if(typeof openDocumentViewer===\'function\')openDocumentViewer(\'' + d.docId + '\',\'Open\',\'\')" class="text-xs font-bold text-birds-green hover:underline">' + escapeHtml(d.docRef || d.docId) + '</button>' +
                            '<span class="text-[10px] text-slate-400">' + escapeHtml(d.title || '') + '</span>' +
                            '</div>';
                    }).join('') + '</div>';
            }

            var actionHtml = '';
            if (isCurrent && !isPast) {
                if (isYourTurn) {
                    actionHtml = `
                        <div class="mt-3 pt-3 border-t border-slate-200">
                            <div class="mb-2">
                                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Stage Overview / Summary</label>
                                <textarea id="stage-overview-${s.id}" class="w-full p-2 border border-slate-200 rounded text-xs h-16 resize-y focus:ring-2 focus:ring-birds-green outline-none" placeholder="Summarize what was done in this stage..."></textarea>
                            </div>
                            <div class="flex gap-2 flex-wrap">
                                <button onclick="Projects._doCompleteStage('${p.id}','${s.id}')" style="background:#6E8E6D;color:white;padding:6px 14px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">\u2714 Mark Complete</button>
                                <button onclick="Projects._createStageDoc('${p.id}','${s.id}')" style="background:transparent;color:#2563EB;padding:6px 14px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #2563EB;cursor:pointer;">+ Create Document</button>
                                <button onclick="Projects._emailNextStage('${p.id}','${s.id}')" style="background:transparent;color:#6E8E6D;padding:6px 14px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #6E8E6D;cursor:pointer;">\u2709 Email Next Stage</button>
                            </div>
                        </div>`;
                } else {
                    actionHtml = `
                        <div class="mt-3 pt-3 border-t border-slate-200">
                            <p class="text-[11px] text-slate-400 italic">Waiting for ${escapeHtml(assigneeNames)} to complete this stage.</p>
                            <button onclick="Projects._emailNextStage('${p.id}','${s.id}')" style="background:transparent;color:#6E8E6D;padding:5px 12px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #6E8E6D;cursor:pointer;">\u2709 Email Assignee</button>
                        </div>`;
                }
            }

            return `
            <div class="rounded-lg p-4 mb-3" style="border-left:4px solid ${borderColor};background:${bgColor};">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-lg">${statusIcon}</span>
                            <h4 class="text-sm font-black text-slate-800">${escapeHtml(s.title)}</h4>
                            <span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:9999px;color:${statusColor};background:${isPast ? 'rgba(135,157,130,0.1)' : isYourTurn ? 'rgba(217,79,79,0.1)' : 'rgba(156,163,175,0.1)'};text-transform:uppercase;letter-spacing:.05em;">${statusLabel}</span>
                            ${function(){ var r = getStageRag(s); if(!r) return ''; var rc = _ragColor(r); return '<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:9999px;color:' + rc.color + ';background:' + rc.bg + ';border:1px solid ' + rc.border + ';">' + rc.label + '</span>'; }()}
                        </div>
                        <p class="text-xs text-slate-500">${escapeHtml(s.description || 'No description')}</p>
                        <p class="text-[11px] text-slate-400 mt-1">Assigned: <strong>${escapeHtml(assigneeNames)}</strong>${assignBadge}${s.dueDate ? ' \u2022 Due: <strong>' + escapeHtml(s.dueDate) + '</strong>' : ''}</p>
                        ${completedByInfo}
                        ${overviewHtml}
                        ${linkedDocsHtml}
                    </div>
                    <div class="flex flex-col items-end gap-1">
                        <span class="text-xs font-black text-slate-300">#${idx + 1}</span>
                        ${canEditStage ? '<button onclick="Projects.editStage(\'' + p.id + '\',\'' + s.id + '\')" style="background:transparent;color:#6E8E6D;padding:4px 10px;border-radius:6px;font-weight:800;font-size:10px;border:1px solid #6E8E6D;cursor:pointer;">\u270E Edit</button>' : ''}
                    </div>
                </div>
                ${actionHtml}
            </div>`;
        }).join('');

        var stagesEmpty = p.stages.length === 0 ? `
            <div class="text-center py-8 text-slate-400">
                <div class="text-4xl mb-2 opacity-30">\u2611</div>
                <p class="text-sm font-bold">No stages yet</p>
                <p class="text-xs">Click "Add Stage" to start building your workflow.</p>
            </div>` : '';

        document.getElementById('mainView').innerHTML = `
        <div style="max-width:800px;margin:0 auto;">
            <div class="mb-4">
                <button onclick="setView('projects')" class="text-sm font-bold text-slate-500 hover:text-slate-700">\u2190 Back to Projects</button>
            </div>

            <div class="card p-6 border-t-4 rounded-none" style="border-top-color:${p.status === 'active' ? '#D97706' : '#6E8E6D'};">
                <div class="flex items-start justify-between mb-4">
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <h2 class="text-xl font-black text-slate-800">${escapeHtml(p.name)}</h2>
                            <span class="text-[10px] font-black px-2 py-0.5 rounded-full" style="${statusColors[p.status] || ''}">${statusLabels[p.status] || p.status}</span>
                        </div>
                        <p class="text-xs text-slate-400">${escapeHtml(p.description || '')}</p>
                        <p class="text-[11px] text-slate-400 mt-1">
                            Created by ${escapeHtml(p.createdByName || 'Unknown')} \u2022 ${escapeHtml(p.createdAt || '')} \u2022 Dept: ${escapeHtml(p.department)}
                        </p>
                        ${function() {
                            var tags = [];
                            if (p.team && p.team.length) {
                                var teamNames = p.team.map(function(uid) {
                                    var u = (typeof Users !== 'undefined') ? Users.getById(uid) : null;
                                    return u ? u.name : uid;
                                });
                                tags.push('<span style="background:#EFF6FF;color:#1E40AF;font-size:10px;font-weight:700;padding:2px 8px;border-radius:9999px;">Team: ' + escapeHtml(teamNames.join(', ')) + '</span>');
                            }
                            if (p.areas && p.areas.length) {
                                tags.push('<span style="background:#F0FDF4;color:#166534;font-size:10px;font-weight:700;padding:2px 8px;border-radius:9999px;">Areas: ' + escapeHtml(p.areas.join(', ')) + '</span>');
                            }
                            if (tags.length) return '<div class="flex flex-wrap gap-1 mt-2">' + tags.join('') + '</div>';
                            return '';
                        }()}
                        ${function(){ var rag = getProjectRag(p); if(!rag) return ''; var rc = _ragColor(rag); return '<div class="mt-2 flex items-center gap-2"><span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:9999px;color:' + rc.color + ';background:' + rc.bg + ';border:1px solid ' + rc.border + ';">' + rc.label + '</span></div>'; }()}
                        ${(p.startDate || p.endDate) ? '<div class="mt-2 flex items-center gap-3 text-[11px] text-slate-400">' + (p.startDate ? '<span>Start: <strong>' + escapeHtml(p.startDate) + '</strong></span>' : '') + (p.endDate ? '<span>Target End: <strong>' + escapeHtml(p.endDate) + '</strong></span>' : '') + '</div>' : ''}
                        ${p.overrunReason ? '<div class="mt-2 p-2 bg-red-50 border border-red-200 rounded text-[11px]"><strong class="text-red-700">Overrun Reason:</strong> ' + escapeHtml(p.overrunReason) + (p.overrunImprovement ? '<br><strong class="text-red-700">Improvements:</strong> ' + escapeHtml(p.overrunImprovement) : '') + '</div>' : ''}
                    </div>
                    <div class="text-right flex-shrink-0" style="position:relative;">
                        <button onclick="Projects.toggleSidePanel('${p.id}')" style="background:transparent;color:#555B6E;padding:6px 14px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #555B6E;cursor:pointer;margin-bottom:4px;">\u2630 Menu</button>
                        ${p.status === 'needs_resolution' ? '<button onclick="Projects._doResolve(\'' + p.id + '\')" style="background:#6E8E6D;color:white;padding:6px 14px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">\u2714 Resolve Project</button>' : ''}
                        ${p.status === 'active' ? '<button onclick="Projects._doResolve(\'' + p.id + '\')" style="background:transparent;color:#999;padding:6px 14px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #E8E5E0;cursor:pointer;">Resolve Early</button>' : ''}
                        <button onclick="if(confirm(\'Delete this project permanently? This cannot be undone.\')){Projects._doDeleteProject(\'' + p.id + '\')}" style="background:transparent;color:#D94F4F;padding:6px 14px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #D94F4F;cursor:pointer;margin-top:4px;">\uD83D\uDDD1 Delete</button>
                        <div id="projectSidePanel" style="display:none;position:absolute;top:0;right:0;width:250px;background:#fff;border:1px solid #d5ddd0;border-radius:12px;padding:16px;box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:100;text-align:left;">
                            <div style="font-size:13px;font-weight:900;color:#20231F;margin-bottom:12px;">Project Menu</div>
                            <button onclick="Projects.reportIssue('${p.id}')" style="display:block;width:100%;text-align:left;padding:8px 12px;background:#fef2f2;color:#D94F4F;border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;margin-bottom:6px;">\u26A0 Report Issue</button>
                            <button onclick="Projects.togglePause('${p.id}')" style="display:block;width:100%;text-align:left;padding:8px 12px;background:#fff7ed;color:#D97706;border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;margin-bottom:6px;">\u23F8 Pause / Resume Project</button>
                            <button onclick="Projects.addSideNote('${p.id}')" style="display:block;width:100%;text-align:left;padding:8px 12px;background:#f0f9ff;color:#2563eb;border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;margin-bottom:6px;">\uD83D\uDCDD Add Side Note</button>
                            <button onclick="Projects.generateProjectReport('${p.id}')" style="display:block;width:100%;text-align:left;padding:8px 12px;background:#f5f5f5;color:#555B6E;border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;margin-bottom:6px;">\uD83D\uDCC4 Generate Report</button>
                            <button onclick="Projects.renderMemberModal('${p.id}')" style="display:block;width:100%;text-align:left;padding:8px 12px;background:#f5f5f5;color:#555B6E;border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;margin-bottom:6px;">\uD83D\uDC65 Invite Members</button>
                            <button onclick="Projects.saveProjectAsPreset('${p.id}').then(function(){ showToast('Project saved as template', 'success'); })" style="display:block;width:100%;text-align:left;padding:8px 12px;background:#f5f5f5;color:#555B6E;border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;margin-bottom:6px;">\uD83D\uDDC4 Save as Template</button>
                            <button onclick="Projects._doResolve('${p.id}')" style="display:block;width:100%;text-align:left;padding:8px 12px;background:rgba(135,157,130,0.1);color:#6E8E6D;border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;">\u2714 Resolve Project</button>
                        </div>
                    </div>
                </div>

                <!-- Progress bar -->
                ${p.stages && p.stages.length ? `
                <div class="mb-5">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Progress</span>
                        <span class="text-xs font-bold text-slate-600">${p.stages ? p.stages.filter(function(s){return s.status==='completed'}).length : 0}/${p.stages ? p.stages.length : 0} stages</span>
                    </div>
                    <div style="height:8px;background:#E8E5E0;border-radius:4px;overflow:hidden;">
                        <div style="height:100%;width:${progress}%;background:linear-gradient(90deg,#6E8E6D,#5A7A59);border-radius:4px;transition:width .3s;"></div>
                    </div>
                </div>` : ''}

                <!-- Store Context Panel (auto-populated if store detected) -->
                <div id="projectStoreContext-${p.id}" class="mb-4" style="display:none;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;"></div>
                <script>
                (function() {
                    var desc = ${JSON.stringify(p.description || '')};
                    var name = ${JSON.stringify(p.name || '')};
                    var storeMatch = desc.match(/Store:\\s*([^\\n]+)/i) || name.match(/(?:at|for)\\s+([A-Z][a-z]+(?:\\s[A-Z][a-z]+)*)/);
                    if (storeMatch && typeof StoreContext !== 'undefined') {
                        var storeName = storeMatch[1].trim();
                        var el = document.getElementById('projectStoreContext-${p.id}');
                        if (el) { el.style.display = 'block'; StoreContext.render(storeName, 'projectStoreContext-${p.id}'); }
                    }
                })();
                </script>

                <!-- Stages list -->
                <div class="mb-4">
                    <div class="flex items-center justify-between mb-3">
                        <h3 class="text-xs font-black text-slate-400 uppercase tracking-widest">Stages</h3>
                        ${p.status === 'active' ? '<button onclick="Projects.renderAddStage(\'' + p.id + '\')" style="background:rgba(110,142,109,0.1);color:#6E8E6D;padding:4px 12px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">+ Add Stage</button>' : ''}
                    </div>
                    ${stagesHtml}
                    ${stagesEmpty}
                </div>

                <!-- Add stage form container -->
                <div id="stageForm-${p.id}"></div>
            </div>
        </div>`;
    }

    async function _doCompleteStage(projectId, stageId) {
        var overviewEl = document.getElementById('stage-overview-' + stageId);
        var overview = overviewEl ? overviewEl.value : '';
        await completeStage(projectId, stageId, overview);
        showToast('Stage completed!', 'success');
        renderProjectDetail(projectId);
    }

    /* ─── Edit a FUTURE (pending) stage — creator only; active stage is locked ─── */
    async function editStage(projectId, stageId) {
        var p = getById(projectId);
        var s = p ? p.stages.find(function(x) { return x.id === stageId; }) : null;
        if (!p || !s) return;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (!(user && (p.createdBy === user.id || (typeof window.isAdmin === 'function' && isAdmin())))) { showToast('Only the project creator can edit stages', 'error'); return; }
        var users = (typeof Users !== 'undefined') ? Users.getAll() : [];
        var depts = [...new Set(users.map(function(u) { return u.department || 'General'; }))].sort();
        var assignType = s.assignType || 'persons';
        var deptChecks = depts.map(function(d) {
            return '<label class="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-50 cursor-pointer"><input type="checkbox" value="' + escapeHtml(d) + '" class="medit-dept-cb accent-[#6E8E6D]" ' + ((s.assignDepartments || []).indexOf(d) >= 0 ? 'checked' : '') + '><span class="text-sm">' + escapeHtml(d) + '</span></label>';
        }).join('');
        var userChecks = users.map(function(u) {
            return '<label class="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-50 cursor-pointer"><input type="checkbox" value="' + u.id + '" class="medit-assign-cb accent-[#6E8E6D]" ' + ((s.assignedTo || []).indexOf(u.id) >= 0 ? 'checked' : '') + '><span class="text-sm">' + escapeHtml(u.name) + ' <span class="text-[10px] text-slate-400">(' + escapeHtml(u.department) + ')</span></span></label>';
        }).join('');
        var radio = function(v, label, active) {
            return '<label class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-sm" style="' + (active ? 'background:#6E8E6D;color:#fff;border-color:#6E8E6D;' : '') + '"><input type="radio" name="medit-assignType" value="' + v + '" ' + (active ? 'checked' : '') + ' onchange="Projects._meditSwitch(\'' + v + '\',this)" class="accent-[#6E8E6D]"> ' + label + '</label>';
        };
        var modal = document.createElement('div');
        modal.id = 'stageEditModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">' +
            '<div class="flex items-center justify-between mb-4"><h3 class="text-lg font-black text-slate-800">Edit Stage: ' + escapeHtml(s.title) + '</h3><button onclick="document.getElementById(\'stageEditModal\').remove()" class="text-slate-400 hover:text-slate-600 text-xl font-bold">\u2715</button></div>' +
            '<div class="space-y-3">' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Stage Title *</label><input type="text" id="medit-title" value="' + escapeHtml(s.title) + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Description / Instructions</label><textarea id="medit-desc" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm h-16">' + escapeHtml(s.description || '') + '</textarea></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Due Date</label><input type="date" id="medit-due" value="' + escapeHtml(s.dueDate || '') + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm"></div>' +
            '<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Assign To</label>' +
            '<div class="flex gap-2 mb-3">' + radio('department', 'Department', assignType === 'department') + radio('persons', 'Person(s)', assignType === 'persons') + radio('custom', 'External / Custom', assignType === 'custom') + '</div>' +
            '<div id="medit-dept-panel" style="display:' + (assignType === 'department' ? 'block' : 'none') + '"><div class="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">' + deptChecks + '</div></div>' +
            '<div id="medit-persons-panel" style="display:' + (assignType === 'persons' ? 'block' : 'none') + '"><div class="max-h-40 overflow-y-auto border border-slate-200 rounded-lg">' + userChecks + '</div></div>' +
            '<div id="medit-custom-panel" style="display:' + (assignType === 'custom' ? 'block' : 'none') + '"><input type="text" id="medit-custom" value="' + escapeHtml(s.assignCustom || '') + '" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm" placeholder="e.g. External Auditor..."></div>' +
            '</div></div>' +
            '<div class="flex gap-2 mt-4"><button onclick="Projects._doSaveStageEdit(\'' + projectId + '\',\'' + stageId + '\')" style="background:#6E8E6D;color:#fff;padding:8px 16px;border-radius:6px;font-weight:800;font-size:12px;border:none;cursor:pointer;">Save Stage</button>' +
            '<button onclick="document.getElementById(\'stageEditModal\').remove()" style="background:transparent;color:#999;padding:8px 16px;border-radius:6px;font-weight:700;font-size:12px;border:1px solid #E8E5E0;cursor:pointer;">Cancel</button></div></div>';
        document.body.appendChild(modal);
    }

    function _meditSwitch(type, radio) {
        var m = document.getElementById('stageEditModal');
        if (!m) return;
        m.querySelectorAll('input[name="medit-assignType"]').forEach(function(r) { r.checked = r.value === type; });
        m.querySelectorAll('input[name="medit-assignType"]').forEach(function(r) {
            var lbl = r.closest('label');
            if (lbl) { lbl.style.background = r.value === type ? '#6E8E6D' : ''; lbl.style.color = r.value === type ? '#fff' : ''; lbl.style.borderColor = r.value === type ? '#6E8E6D' : ''; }
        });
        ['medit-dept-panel', 'medit-persons-panel', 'medit-custom-panel'].forEach(function(id) {
            var el = document.getElementById(id); if (el) el.style.display = 'none';
        });
        var target = type === 'department' ? 'medit-dept-panel' : type === 'custom' ? 'medit-custom-panel' : 'medit-persons-panel';
        var t = document.getElementById(target); if (t) t.style.display = 'block';
    }

    async function _doSaveStageEdit(projectId, stageId) {
        var p = getById(projectId);
        if (!p) return;
        var title = (document.getElementById('medit-title') ? document.getElementById('medit-title').value : '').trim();
        if (!title) { showToast('Stage title is required', 'warning'); return; }
        var assignType = '';
        var r = document.querySelector('input[name="medit-assignType"]:checked'); if (r) assignType = r.value;
        var assignDepartments = []; var cbs = document.querySelectorAll('.medit-dept-cb:checked'); cbs.forEach(function(cb) { assignDepartments.push(cb.value); });
        var assignedTo = []; var ubs = document.querySelectorAll('.medit-assign-cb:checked'); ubs.forEach(function(cb) { assignedTo.push(cb.value); });
        var assignCustom = document.getElementById('medit-custom') ? document.getElementById('medit-custom').value.trim() : '';
        await updateStage(projectId, stageId, {
            title: title,
            description: (document.getElementById('medit-desc') ? document.getElementById('medit-desc').value : '').trim(),
            dueDate: document.getElementById('medit-due') ? document.getElementById('medit-due').value : '',
            assignType: assignType || 'persons',
            assignDepartments: assignDepartments,
            assignDepartment: assignDepartments[0] || '',
            assignedTo: assignedTo,
            assignCustom: assignCustom
        });
        var m = document.getElementById('stageEditModal'); if (m) m.remove();
        showToast('Stage updated', 'success');
        renderProjectDetail(projectId);
    }

    /* ─── Invite members so they can see/join a project ───────── */
    function renderMemberModal(projectId) {
        var p = getById(projectId);
        if (!p) return;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (!(user && (p.createdBy === user.id || (typeof window.isAdmin === 'function' && isAdmin())))) { showToast('Only the creator can invite members', 'error'); return; }
        var users = (typeof Users !== 'undefined') ? Users.getAll() : [];
        var members = p.members || [];
        var checks = users.map(function(u) {
            return '<label class="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50 cursor-pointer"><input type="checkbox" value="' + u.id + '" class="member-cb accent-[#6E8E6D]" ' + (members.indexOf(u.id) >= 0 ? 'checked' : '') + '><span class="text-sm">' + escapeHtml(u.name) + ' <span class="text-[10px] text-slate-400">(' + escapeHtml(u.department) + ')</span></span></label>';
        }).join('');
        var modal = document.createElement('div');
        modal.id = 'memberModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">' +
            '<div class="flex items-center justify-between mb-3"><h3 class="text-lg font-black text-slate-800">Invite Members</h3><button onclick="document.getElementById(\'memberModal\').remove()" class="text-slate-400 hover:text-slate-600 text-xl font-bold">\u2715</button></div>' +
            '<p class="text-xs text-slate-400 mb-3">Invited members can see this project even if it is outside their usual project view.</p>' +
            '<div class="max-h-64 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">' + (checks || '<p class="text-sm text-slate-400">No users available.</p>') + '</div>' +
            '<div class="flex gap-2 mt-4"><button onclick="Projects._saveMembers(\'' + projectId + '\')" style="background:#6E8E6D;color:#fff;padding:8px 16px;border-radius:6px;font-weight:800;font-size:12px;border:none;cursor:pointer;">Save Members</button>' +
            '<button onclick="document.getElementById(\'memberModal\').remove()" style="background:transparent;color:#999;padding:8px 16px;border-radius:6px;font-weight:700;font-size:12px;border:1px solid #E8E5E0;cursor:pointer;">Cancel</button></div></div>';
        document.body.appendChild(modal);
    }

    async function _saveMembers(projectId) {
        var p = getById(projectId);
        if (!p) return;
        var members = [];
        var cbs = document.querySelectorAll('.member-cb:checked');
        cbs.forEach(function(cb) { members.push(cb.value); });
        p.members = members;
        await _save(p);
        var m = document.getElementById('memberModal'); if (m) m.remove();
        showToast('Members updated', 'success');
        renderProjectDetail(projectId);
    }

    async function _doResolve(projectId) {
        var p = getById(projectId);
        if (!p) return;
        if (!confirm('Resolve this project? This marks it as complete.')) return;
        /* If past end date, prompt for overrun reason */
        if (p.endDate && new Date() > new Date(p.endDate + 'T23:59:59')) {
            var reason = prompt('This project has overrun its target end date (' + p.endDate + ').\n\nPlease provide a reason (optional):');
            if (reason === null) return;
            var improvement = prompt('What improvements could be made next time? (optional):');
            if (improvement === null) return;
            p.overrunReason = reason || '';
            p.overrunImprovement = improvement || '';
            await _save(p);
        }
        await resolveProject(projectId);
        showToast('Project resolved', 'success');
        renderProjectDetail(projectId);
    }

    async function _doDeleteProject(projectId) {
        await deleteProject(projectId);
        showToast('Project deleted', 'success');
        setView('projects');
    }

    /* ─── Create document linked to a project stage ───────────── */
    function _createStageDoc(projectId, stageId) {
        window._projectStageContext = { projectId: projectId, stageId: stageId };
        setView('documentcreate');
    }

    async function _linkDocToStage(projectId, stageId, docId, docRef, docTitle) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        if (!stage.documents) stage.documents = [];
        /* Avoid duplicates */
        if (stage.documents.some(function(d) { return d.docId === docId; })) return;
        stage.documents.push({ docId: docId, docRef: docRef, title: docTitle });
        await _save(p);
    }

    /* ═══════════════════════════════════════════════════════════════
       UI: PROJECT LIST VIEW
       ═══════════════════════════════════════════════════════════════ */
    async function renderProjectsList() {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var active = getActive();
        var completed = getCompleted();
        var presets = [];
        try { presets = await _loadPresets(); } catch(e) {}

        /* Project visibility is controlled by the user's "Project View" setting (set by an admin) */
        var visible = user ? active.filter(function(p) { return _projectVisible(p, user); }) : active;
        var completedVisible = user ? completed.filter(function(p) { return _projectVisible(p, user); }) : completed;

        /* Group by department */
        var grouped = {};
        visible.forEach(function(p) {
            var dept = p.department || 'General';
            if (!grouped[dept]) grouped[dept] = [];
            grouped[dept].push(p);
        });

        var cardsHtml = '';
        var deptKeys = Object.keys(grouped).sort();
        if (deptKeys.length === 0 && !visible.length && !completedVisible.length) {
            cardsHtml = '<div class="text-center py-12 text-slate-400 col-span-full"><p class="text-lg font-black">No Projects Yet</p><p class="text-sm mt-1">Create your first project to start tracking staged workflows.</p></div>';
        } else {
            deptKeys.forEach(function(dept) {
                cardsHtml += '<div class="col-span-full mb-1"><h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-2 mt-4">' + escapeHtml(dept) + '</h3></div>';
                grouped[dept].forEach(function(p) { cardsHtml += _renderProjectCard(p); });
            });
            if (completedVisible.length) {
                cardsHtml += '<div class="col-span-full mb-1"><h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-2 mt-4">Completed</h3></div>';
                completedVisible.forEach(function(p) { cardsHtml += _renderProjectCard(p); });
            }
        }

        /* Management / admin overview of ALL projects (active + resolved) — also shown when a user's Project View is "All projects" */
        var mgmtHtml = '';
        if (_isManagement(user) || (user && user.projectView === 'all')) {
            var allProj = active.concat(completed);
            if (allProj.length) {
                var mgmtRows = allProj.map(function(p) {
                    var progress = getProgress(p);
                    var rag = getProjectRag(p);
                    var rc = rag ? _ragColor(rag) : null;
                    return '<div class="card p-3 cursor-pointer hover:shadow-md transition-all border-t-2 ' + (p.status === 'resolved' ? 'border-t-emerald-500' : 'border-t-amber-400') + '" onclick="Projects.renderProjectDetail(\'' + p.id + '\')">' +
                        '<div class="flex items-center justify-between mb-1"><span class="text-xs font-black text-slate-800 truncate">' + escapeHtml(p.name) + '</span>' +
                        (rc ? '<span style="font-size:8px;font-weight:800;padding:2px 6px;border-radius:9999px;color:' + rc.color + ';background:' + rc.bg + ';border:1px solid ' + rc.border + ';white-space:nowrap;">' + rc.label + '</span>' : '') +
                        '</div>' +
                        '<p class="text-[10px] text-slate-400 mb-1">' + escapeHtml(p.department) + ' \u2022 ' + (p.stages ? p.stages.filter(function(s){return s.status==='completed';}).length : 0) + '/' + (p.stages ? p.stages.length : 0) + ' stages \u2022 ' + escapeHtml(p.status) + '</p>' +
                        '<div style="height:4px;background:#E8E5E0;border-radius:3px;overflow:hidden;"><div style="height:100%;width:' + progress + '%;background:' + (p.status === 'resolved' ? '#6E8E6D' : '#D97706') + ';"></div></div>' +
                        '</div>';
                }).join('');
                mgmtHtml = '<div class="mb-8">' +
                    '<div class="flex items-center justify-between mb-3">' +
                    '<h3 class="text-sm font-black text-slate-500 uppercase tracking-widest">\uD83D\uDCCD All Projects \u2014 Management Review</h3>' +
                    '<span class="text-[11px] text-slate-400">' + allProj.length + ' active + resolved</span>' +
                    '</div>' +
                    '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">' + mgmtRows + '</div></div>';
            }
        }

        var presetsHtml = '';
        if (presets && presets.length) {
            presetsHtml = '<div class="mb-8">' +
                '<div class="flex items-center justify-between mb-3">' +
                '<h3 class="text-sm font-black text-slate-500 uppercase tracking-widest">\uD83D\uDCCB Saved Project Templates</h3>' +
                '<span class="text-[11px] text-slate-400">Reusable project structures \u2014 click \u201cUse template\u201d to start a new project from one</span>' +
                '</div>' +
                '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">' +
                presets.map(function(pr) {
                    return '<div class="card p-4 border-t-2 border-t-slate-300">' +
                        '<h4 class="text-sm font-black text-slate-700 mb-1">' + escapeHtml(pr.name) + '</h4>' +
                        '<p class="text-[11px] text-slate-400 mb-2 line-clamp-2">' + escapeHtml(pr.description || 'No description') + '</p>' +
                        '<p class="text-[10px] font-bold text-slate-400 mb-3">' + (pr.stages ? pr.stages.length : 0) + ' stages \u2022 ' + escapeHtml(pr.department || 'General') + '</p>' +
                        '<div class="flex gap-2">' +
                        '<button onclick="Projects.createFromPreset(\'' + pr.id + '\').then(function(){ showToast(\'Project created from template\', \'success\'); Projects.renderProjectsList(); })" style="background:#6E8E6D;color:white;padding:6px 12px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;flex:1;">Use template</button>' +
                        '<button onclick="Projects.deleteProjectPreset(\'' + pr.id + '\').then(function(){ Projects.renderProjectsList(); })" class="bg-red-50 text-red-600 text-xs font-bold px-2 rounded hover:bg-red-100" title="Delete template">\u2715</button>' +
                        '</div></div>';
                }).join('') +
                '</div></div>';
        }

        document.getElementById('mainView').innerHTML = `
        <div>
            <div class="flex items-center justify-between mb-5">
                <div>
                    <h2 class="text-2xl font-black text-slate-800">Projects</h2>
                    <p class="text-sm text-slate-400">${visible.length} active project${visible.length !== 1 ? 's' : ''}</p>
                </div>
                <button onclick="Projects.renderCreateProject()" style="background:#6E8E6D;color:white;padding:8px 18px;border-radius:8px;font-weight:800;font-size:12px;border:none;cursor:pointer;">+ New Project</button>
            </div>
            ${mgmtHtml}
            ${presetsHtml}
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                ${cardsHtml}
            </div>
        </div>`;
    }

    function _renderProjectCard(p) {
        var progress = getProgress(p);
        var currentStage = getCurrentStage(p);
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var isYourTurn = currentStage && user && _isUserAssignedToStage(currentStage, user.id);
        var statusColors = {
            active: 'border-t-amber-400',
            resolved: 'border-t-emerald-500',
            needs_resolution: 'border-t-slate-400'
        };

        var nextAssignee = '';
        if (currentStage) {
            if (currentStage.assignType === 'department') {
                var deptList = (currentStage.assignDepartments && currentStage.assignDepartments.length) ? currentStage.assignDepartments : (currentStage.assignDepartment ? [currentStage.assignDepartment] : []);
                var deptNames = [];
                if (typeof Users !== 'undefined') {
                    deptList.forEach(function(dept) {
                        var nm = Users.getByDepartment(dept);
                        deptNames.push(dept + ' (' + nm.map(function(m) { return m.name.split(' ')[0]; }).join(', ') + ')');
                    });
                }
                nextAssignee = deptNames.join(', ');
            } else if (currentStage.assignType === 'custom' && currentStage.assignCustom) {
                nextAssignee = currentStage.assignCustom;
            } else if (currentStage.assignedTo && currentStage.assignedTo.length) {
                nextAssignee = currentStage.assignedTo.map(function(uid) {
                    var u = (typeof Users !== 'undefined') ? Users.getById(uid) : null;
                    return u ? u.name.split(' ')[0] : '';
                }).filter(Boolean).join(', ');
            }
        }

        var creatorMeta = '';
        if (p.createdByName || p.createdAt) {
            var parts = [];
            if (p.createdByName) parts.push(escapeHtml(p.createdByName));
            if (p.createdAt) parts.push(new Date(p.createdAt).toLocaleDateString('en-GB'));
            creatorMeta = parts.join(' \u2022 ');
        }

        return `
        <div class="card p-4 cursor-pointer hover:shadow-md transition-all border-t-2 ${statusColors[p.status] || 'border-t-slate-300'}" onclick="Projects.renderProjectDetail('${p.id}')" style="${isYourTurn ? 'background:rgba(255,243,205,0.3);' : ''}">
            ${isYourTurn ? '<div style="font-size:9px;font-weight:800;color:#D94F4F;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">\u26A1 Your Turn</div>' : ''}
            <div class="flex items-center gap-2 mb-1">
                <h3 class="text-sm font-black text-slate-800 truncate flex-1">${escapeHtml(p.name)}</h3>
                ${function(){ var rag = getProjectRag(p); if(!rag) return ''; var rc = _ragColor(rag); return '<span style="font-size:8px;font-weight:800;padding:2px 6px;border-radius:9999px;color:' + rc.color + ';background:' + rc.bg + ';border:1px solid ' + rc.border + ';white-space:nowrap;">' + rc.label + '</span>'; }()}
            </div>
            <p class="text-[11px] text-slate-400 mb-2 line-clamp-1">${escapeHtml(p.description || 'No description')}</p>
            ${function() {
                var tags = [];
                if (p.team && p.team.length) {
                    var count = p.team.length;
                    tags.push('<span style="background:#EFF6FF;color:#1E40AF;font-size:9px;font-weight:700;padding:1px 6px;border-radius:9999px;">Team: ' + count + '</span>');
                }
                if (p.areas && p.areas.length) {
                    tags.push('<span style="background:#F0FDF4;color:#166534;font-size:9px;font-weight:700;padding:1px 6px;border-radius:9999px;">Areas: ' + p.areas.length + '</span>');
                }
                if (tags.length) return '<div class="flex flex-wrap gap-1 mb-2">' + tags.join('') + '</div>';
                return '';
            }()}
            <div style="height:5px;background:#E8E5E0;border-radius:3px;overflow:hidden;margin-bottom:8px;">
                <div style="height:100%;width:${progress}%;background:${p.status === 'resolved' ? '#6E8E6D' : '#D97706'};border-radius:3px;"></div>
            </div>
            <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold text-slate-400">${p.stages ? p.stages.filter(function(s){return s.status==='completed'}).length : 0}/${p.stages ? p.stages.length : 0} stages</span>
                ${currentStage && p.status === 'active' ? '<span class="text-[10px] font-bold text-slate-400">Next: ' + escapeHtml(nextAssignee || 'Unassigned') + '</span>' : ''}
            </div>
            ${creatorMeta ? '<div class="text-[9px] text-slate-400 mt-1">' + creatorMeta + '</div>' : ''}
        </div>`;
    }

    /* ═══════════════════════════════════════════════════════════════
       UI: MY WORK DASHBOARD
       ═══════════════════════════════════════════════════════════════ */
    async function renderMyWork() {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (!user) { showToast('Not logged in', 'error'); return; }

        /* Load docs fresh from storage */
        var allDocs = { open: [], resolved: [], archived: [] };
        try { allDocs = await loadDocuments(); } catch(e) { console.warn('[MyWork] loadDocuments failed:', e.message); }

        /* Load folders */
        var folders = [];
        try { folders = await _loadFolderManifest(); } catch(e) {}

        /* Load templates */
        var templates = [];
        try { templates = await _loadFormTemplates(); } catch(e) {}

        var myStages = getStagesForUser(user.id);
        var waitingOn = getWaitingOnOthers(user.id);

        /* All docs the user is involved in: created, assigned, or replied to */
        var allDocList = [].concat(allDocs.open || [], allDocs.resolved || [], allDocs.archived || []);
        var myDocs = allDocList.filter(function(d) {
            return d.creatorId === user.id || d.creator === user.name ||
                d.attentionOf === user.name ||
                (d.replies && d.replies.some(function(r) { return r.author === user.name; }));
        });
        /* Sort newest first */
        myDocs.sort(function(a, b) { return (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || ''); });

        /* User's own folders */
        var myFolders = folders;

        /* Templates relevant to user — personal (mine), shared with my department/group, or all team */
        var myTemplates = templates.filter(function(t) {
            if (t.ownerId && t.ownerId === user.id) return true; /* owners always see their own */
            if (t.scope === 'personal') return t.ownerId === user.id;
            if (t.scope === 'department') return t.sharedDepartments && t.sharedDepartments.indexOf(user.department) >= 0;
            if (t.scope === 'group') return t.sharedUsers && t.sharedUsers.indexOf(user.id) >= 0;
            return true;
        });

        var actionsHtml = '';
        var waitingHtml = '';

        /* Stages needing my action */
        myStages.forEach(function(item) {
            var p = item.project;
            var s = item.stage;
            actionsHtml += `
            <div class="card p-4 border-l-4 border-l-amber-400 cursor-pointer hover:shadow-md transition-all" style="background:rgba(255,243,205,0.2);" onclick="Projects.renderProjectDetail('${p.id}')">
                <div class="flex items-center gap-2 mb-1">
                    <span style="font-size:10px;font-weight:800;color:#D94F4F;padding:2px 6px;border-radius:4px;background:rgba(217,79,79,0.1);text-transform:uppercase;">\u26A1 Your Turn</span>
                    <span class="text-[10px] font-bold text-slate-400">${escapeHtml(p.department)}</span>
                </div>
                <h4 class="text-sm font-black text-slate-800">${escapeHtml(s.title)}</h4>
                <p class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(p.name)} \u2022 Stage #${item.stageIndex + 1}</p>
                <p class="text-[11px] text-slate-500 mt-1">${escapeHtml(s.description || '')}</p>
                <div class="flex gap-2 mt-2">
                    <button onclick="event.stopPropagation();Projects.renderProjectDetail('${p.id}')" style="background:#6E8E6D;color:white;padding:4px 10px;border-radius:4px;font-weight:800;font-size:10px;border:none;cursor:pointer;">Open</button>
                    <button onclick="event.stopPropagation();Projects._emailNextStage('${p.id}','${s.id}')" style="background:transparent;color:#6E8E6D;padding:4px 10px;border-radius:4px;font-weight:700;font-size:10px;border:1px solid #6E8E6D;cursor:pointer;">\u2709 Email</button>
                </div>
            </div>`;
        });

        /* Waiting on others */
        waitingOn.forEach(function(item) {
            var p = item.project;
            var s = item.stage;
            var names = (s.assignedTo || []).map(function(uid) {
                var u = (typeof Users !== 'undefined') ? Users.getById(uid) : null;
                return u ? u.name.split(' ')[0] : '';
            }).filter(Boolean).join(', ');
            waitingHtml += `
            <div class="card p-4 border-l-4 border-l-slate-300 cursor-pointer hover:shadow-md transition-all" onclick="Projects.renderProjectDetail('${p.id}')">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-[10px] font-bold text-slate-400">${escapeHtml(p.department)}</span>
                </div>
                <h4 class="text-sm font-bold text-slate-600">${escapeHtml(s.title)}</h4>
                <p class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(p.name)} \u2022 Waiting on: <strong>${escapeHtml(names)}</strong></p>
            </div>`;
        });

        /* Document cards */
        var myCompleted = myDocs.filter(function(d) { return (allDocs.resolved || []).indexOf(d) >= 0 || (allDocs.archived || []).indexOf(d) >= 0; });
        var docsHtml = '';
        if (myDocs.length) {
            docsHtml = '<div class="mb-6">' +
                '<div class="flex items-center justify-between mb-3">' +
                '<h3 class="text-xs font-black text-slate-400 uppercase tracking-widest">\uD83D\uDCCB My Documents (' + myDocs.length + ')</h3>' +
                '<div class="flex items-center gap-3">' +
                (myCompleted.length ? '<button onclick="window.clearMyCompletedWork()" title="Delete your completed (resolved/archived) documents" style="background:rgba(217,79,79,0.08);color:#D94F4F;padding:4px 10px;border-radius:6px;font-weight:800;font-size:10px;border:1px solid rgba(217,79,79,0.25);cursor:pointer;">\u2715 Clear ' + myCompleted.length + ' completed</button>' : '') +
                (myDocs.length > 10 ? '<button onclick="renderDocuments()" class="text-[11px] font-bold text-birds-green hover:underline">View all (' + myDocs.length + ')</button>' : '') +
                '</div>' +
                '</div>' +
                '<div class="space-y-2">' +
                myDocs.slice(0, 10).map(function(d) {
                    var status = 'Open';
                    if ((allDocs.resolved || []).indexOf(d) >= 0) status = 'Resolved';
                    else if ((allDocs.archived || []).indexOf(d) >= 0) status = 'Archived';
                    var statusColor = status === 'Open' ? '#6E8E6D' : status === 'Resolved' ? '#2563EB' : '#999';
                    var docMeta = '';
                    if (d.creator && d.date) docMeta = escapeHtml(d.creator) + ' \u2022 ' + escapeHtml(d.date);
                    else if (d.creator) docMeta = escapeHtml(d.creator);
                    else docMeta = escapeHtml(d.date || '');
                    return '<div class="card p-3 cursor-pointer hover:shadow-sm transition-all" onclick="openDocumentViewer(\'' + d.id + '\',\'' + status + '\',\'' + (d.userFolderId || '') + '\')">' +
                        '<div class="flex items-center justify-between"><h4 class="text-sm font-bold text-slate-700">' + escapeHtml(d.name || 'Untitled') + '</h4>' +
                        '<div class="flex items-center gap-1"><span style="font-size:9px;font-weight:800;color:white;padding:2px 6px;border-radius:4px;background:' + statusColor + ';">' + status + '</span>' +
                        '<button onclick="event.stopPropagation();window.deleteWorkDocument(\'' + d.id + '\',\'' + status + '\')" title="Delete this document" style="background:transparent;color:#D94F4F;border:none;cursor:pointer;font-size:12px;font-weight:800;padding:0 2px;">\u2715</button></div></div>' +
                        '<p class="text-[10px] text-slate-400">' + escapeHtml(d.type || '') + (docMeta ? ' \u2022 ' + docMeta : '') + (d.userFolderName ? ' \u2022 ' + escapeHtml(d.userFolderName) : '') + '</p></div>';
                }).join('') +
                '</div></div>';
        }

        /* Folder cards */
        var foldersHtml = '';
        if (myFolders.length) {
            foldersHtml = '<div class="mb-6">' +
                '<h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">\uD83D\uDCC2 My Folders (' + myFolders.length + ')</h3>' +
                '<div class="grid grid-cols-2 md:grid-cols-3 gap-3">' +
                myFolders.map(function(f) {
                    var folderDocs = allDocList.filter(function(d) { return d.userFolderId === f.id; });
                    return '<div class="card p-4 cursor-pointer hover:shadow-md transition-all" onclick="setView(\'documents\')">' +
                        '<div class="text-lg mb-1">\uD83D\uDCC1</div>' +
                        '<h4 class="text-sm font-black text-slate-700">' + escapeHtml(f.name) + '</h4>' +
                        '<p class="text-[10px] text-slate-400">' + folderDocs.length + ' document' + (folderDocs.length !== 1 ? 's' : '') + '</p>' +
                        '</div>';
                }).join('') +
                '</div></div>';
        }

        /* Template cards */
        var templatesHtml = '';
        if (myTemplates.length) {
            templatesHtml = '<div class="mb-6">' +
                '<h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">\uD83D\uDCCB My Templates (' + myTemplates.length + ')</h3>' +
                '<div class="grid grid-cols-2 md:grid-cols-3 gap-3">' +
                myTemplates.slice(0, 6).map(function(t) {
                    return '<div class="card p-4 cursor-pointer hover:shadow-md transition-all" onclick="window._tplFill && _tplFill(\'' + t.id + '\')">' +
                        '<div class="text-lg mb-1">\uD83D\uDCC4</div>' +
                        '<h4 class="text-sm font-black text-slate-700">' + escapeHtml(t.name) + '</h4>' +
                        '<p class="text-[10px] text-slate-400">' + escapeHtml(t.department || 'General') + '</p>' +
                        '</div>';
                }).join('') +
                '</div></div>';
        }

        document.getElementById('mainView').innerHTML = `
        <div style="max-width:900px;margin:0 auto;">
            <div class="mb-5">
                <h2 class="text-2xl font-black text-slate-800">My Work</h2>
                <p class="text-sm text-slate-400">${escapeHtml(user.name)} \u2022 ${escapeHtml(user.department)}</p>
            </div>

            ${myStages.length ? `
            <div class="mb-6">
                <h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">\u26A1 Needs Your Action (${myStages.length})</h3>
                <div class="space-y-3">${actionsHtml}</div>
            </div>` : `
            <div class="card p-6 text-center mb-6" style="background:rgba(135,157,130,0.04);">
                <p class="text-sm font-bold text-slate-500">\u2714 All clear \u2014 nothing needs your action right now</p>
            </div>`}

            ${waitingOn.length ? `
            <div class="mb-6">
                <h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">\u23F3 Waiting on Others (${waitingOn.length})</h3>
                <div class="space-y-3">${waitingHtml}</div>
            </div>` : ''}

            ${foldersHtml}
            ${docsHtml}
            ${templatesHtml}

            ${(!myStages.length && !waitingOn.length && !myDocs.length && !myFolders.length && !myTemplates.length) ? `
            <div class="card p-8 text-center" style="background:rgba(135,157,130,0.04);">
                <p class="text-sm font-bold text-slate-500">Nothing here yet \u2014 create a project, document, or template to get started</p>
                <div class="flex gap-3 justify-center mt-4">
                    <button onclick="setView('projectcreate')" style="background:#6E8E6D;color:white;padding:6px 14px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">+ Project</button>
                    <button onclick="setView('documentcreate')" style="background:rgba(85,91,110,0.08);color:#555B6E;padding:6px 14px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">+ Document</button>
                </div>
            </div>` : ''}
        </div>`;
    }

    /* ─── Helpers ──────────────────────────────────────────────── */
    function escapeHtml(v) {
        return String(v || '').replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }

    /* ─── Custom department handler for project creation ────────── */
    function _onDeptChange(sel) {
        if (!sel) return;
        if (sel.value === '__add_custom__') {
            var name = prompt('Enter new department name:');
            if (!name || !name.trim()) { sel.value = ''; return; }
            if (typeof Users !== 'undefined' && Users.addDepartment) {
                Users.addDepartment(name.trim()).then(function(added) {
                    if (added) { showToast('Department "' + name.trim() + '" added', 'success'); }
                    else { showToast('Department already exists', 'warning'); }
                    renderCreateProject();
                });
            }
        }
    }

    /* ─── End of Project PDF Report ─────────────────────────────── */
    function generateProjectReport(projectId) {
        var p = getById(projectId);
        if (!p) return;
        if (typeof window.jspdf === 'undefined') { alert('PDF library not loaded, please try again.'); return; }
        var { jsPDF } = window.jspdf;
        var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        var ml = 20, mr = 190, y = 20;
        var lineH = 7;

        function checkPage(need) { if (y + need > 275) { doc.addPage(); y = 20; } }
        function addLine(label, value, bold) { checkPage(lineH); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100); doc.text(label + ':', ml, y); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setTextColor(30); doc.text(String(value || '\u2014'), ml + 35, y); y += lineH; }
        function addHeading(text) { checkPage(12); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(40); doc.text(text, ml, y); y += 10; doc.setDrawColor(200); doc.line(ml, y - 5, mr, y - 5); }
        function addBody(text) { checkPage(lineH); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(60); var lines = doc.splitTextToSize(String(text || ''), mr - ml); doc.text(lines, ml, y); y += lines.length * 5; }

        /* Title */
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.setTextColor(30);
        doc.text('End of Project Report', ml, y); y += 12;
        doc.setDrawColor(110, 142, 109);
        doc.setLineWidth(0.8);
        doc.line(ml, y - 5, mr, y - 5); y += 5;

        /* Project Info */
        addHeading('Project Details');
        addLine('Project Name', p.name);
        addLine('Description', p.description || '\u2014');
        addLine('Department', p.department);
        addLine('Created By', p.createdByName || 'Unknown');
        addLine('Created', p.createdAt || '\u2014');
        addLine('Start Date', p.startDate || '\u2014');
        addLine('Target End Date', p.endDate || '\u2014');
        addLine('Resolved', p.resolvedAt || '\u2014');
        addLine('Status', p.status === 'resolved' ? 'Resolved' : p.status);

        /* Timeframe Assessment */
        y += 5;
        addHeading('Timeframe Assessment');
        if (p.startDate && p.endDate) {
            var start = new Date(p.startDate);
            var end = new Date(p.endDate);
            var resolved = p.resolvedAt ? new Date(p.resolvedAt) : new Date();
            var plannedDays = Math.ceil((end - start) / 86400000);
            var actualDays = Math.ceil((resolved - start) / 86400000);
            addLine('Planned Duration', plannedDays + ' days');
            addLine('Actual Duration', actualDays + ' days');
            var diff = actualDays - plannedDays;
            if (diff <= 0) {
                addLine('Result', 'Completed on time' + (diff < 0 ? ' (' + Math.abs(diff) + ' days early)' : ''), true);
            } else {
                addLine('Result', 'Overrun by ' + diff + ' day' + (diff !== 1 ? 's' : ''), true);
            }
        } else if (p.endDate) {
            addLine('Target End', p.endDate);
            addLine('Actual End', p.resolvedAt || 'Not yet resolved');
        } else {
            addBody('No timeframe was set for this project.');
        }

        /* Overrun Details */
        if (p.overrunReason) {
            y += 3;
            addHeading('Overrun Analysis');
            addLine('Reason', p.overrunReason);
            if (p.overrunImprovement) addLine('Improvements', p.overrunImprovement);
        }

        /* Stage Summary */
        y += 3;
        addHeading('Stage Summary');
        if (!p.stages.length) {
            addBody('No stages were created for this project.');
        } else {
            p.stages.forEach(function(s, idx) {
                checkPage(25);
                var stagRag = getStageRag(s);
                var ragLabel = stagRag ? (stagRag.charAt(0).toUpperCase() + stagRag.slice(1)) : 'N/A';
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.setTextColor(30);
                doc.text('Stage ' + (idx + 1) + ': ' + s.title, ml, y); y += 6;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(100);
                doc.text('Assigned: ' + (s.assignType === 'department' ? (s.assignDepartments && s.assignDepartments.length ? s.assignDepartments.join(', ') : s.assignDepartment || 'Unassigned') : s.assignType === 'custom' ? s.assignCustom : (s.assignedTo || []).map(function(uid) { var u = (typeof Users !== 'undefined') ? Users.getById(uid) : null; return u ? u.name : ''; }).filter(Boolean).join(', ') || 'Unassigned'), ml, y); y += 5;
                doc.text('Status: ' + (s.status === 'completed' ? 'Completed' : 'Pending') + '  |  Due: ' + (s.dueDate || 'Not set') + (s.completedAt ? '  |  Completed: ' + s.completedAt : '') + '  |  RAG: ' + ragLabel, ml, y); y += 5;
                if (s.overview) { addBody('Summary: ' + s.overview); }
                if (s.documents && s.documents.length) {
                    doc.setFont('helvetica', 'italic');
                    doc.setFontSize(9);
                    doc.setTextColor(100);
                    s.documents.forEach(function(d) {
                        checkPage(5);
                        doc.text('\u2022 Document: ' + (d.docRef || d.docId) + ' \u2014 ' + (d.title || ''), ml + 3, y); y += 5;
                    });
                }
                y += 2;
            });
        }

        /* Footer */
        checkPage(15);
        y += 5;
        doc.setDrawColor(200);
        doc.line(ml, y, mr, y); y += 8;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text('Generated: ' + new Date().toLocaleString('en-GB') + '  |  The Birds Executive Hub', ml, y);

        doc.save('Project_Report_' + (p.name || 'untitled').replace(/\s+/g, '_') + '.pdf');
        showToast('PDF report downloaded', 'success');
    }

    /* ─── Build projects_master.json ────────────────────────── */
    async function buildProjectsMaster() {
        if (typeof GraphClient === 'undefined' || !BirdsAuth || !BirdsAuth.isLoggedIn()) return;
        try {
            /* Reload full project files */
            var fullProjects = await _loadFromFilesystem();
            if (!fullProjects || !fullProjects.length) return;
            var summary = fullProjects.map(function(p) {
                var assignedUsers = [];
                p.stages.forEach(function(s) {
                    if (s.assignedTo && s.assignedTo.length) { s.assignedTo.forEach(function(uid) { if (assignedUsers.indexOf(uid) < 0) assignedUsers.push(uid); }); }
                });
                return { id: p.id, name: p.name, description: p.description, department: p.department, status: p.status, createdBy: p.createdBy, createdByName: p.createdByName, createdAt: p.createdAt, stageCount: p.stages.length, _assignedUsers: assignedUsers, members: p.members || [] };
            });
            var jsonText = JSON.stringify({ version: 1, generated: new Date().toISOString(), projectCount: summary.length, projects: summary }, null, 2);
            await GraphClient.writeFile('projects_master.json', jsonText);
            console.log('[Projects] Master built with', summary.length, 'projects');
        } catch(e) { console.warn('[Projects] Master build failed:', e.message); }
    }

    /* ─── Load full project detail from individual file ──────── */
    async function loadProjectDetail(projectId) {
        var p = getById(projectId);
        if (!p) return null;
        /* If loaded from master (no stages), fetch full file */
        if (!p.stages || !p.stages.length) {
            try {
                if (typeof GraphClient !== 'undefined' && BirdsAuth && BirdsAuth.isLoggedIn()) {
                    var text = await GraphClient.readFile('Projects/' + projectId + '.json');
                    if (text) {
                        var full = JSON.parse(text);
                        if (full && full.stages) {
                            var idx = _projects.indexOf(p);
                            if (idx >= 0) _projects[idx] = full;
                            await _idbPut(_path(projectId), JSON.stringify(full));
                            return full;
                        }
                    }
                }
            } catch(e) { console.warn('[Projects] Detail load failed:', e.message); }
        }
        return p;
    }

    /* ─── Side panel functions ───────────────────────────────── */
    var _sidePanelOpen = false;
    function toggleSidePanel(projectId) {
        _sidePanelOpen = !_sidePanelOpen;
        var el = document.getElementById('projectSidePanel');
        if (el) el.style.display = _sidePanelOpen ? 'block' : 'none';
    }
    async function reportIssue(projectId) {
        var p = getById(projectId);
        if (!p) return;
        var issue = prompt('Describe the issue:');
        if (!issue) return;
        if (!p.issues) p.issues = [];
        p.issues.push({ text: issue, reportedBy: (typeof Users !== 'undefined' && Users.getCurrentUser() ? Users.getCurrentUser().name : 'Unknown'), date: new Date().toISOString().slice(0,10) });
        await _save(p);
        toggleSidePanel(projectId); renderProjectDetail(projectId);
    }
    async function togglePause(projectId) {
        var p = getById(projectId);
        if (!p) return;
        if (p.status === 'paused') { p.status = 'active'; showToast('Project resumed', 'success'); }
        else { p.status = 'paused'; showToast('Project paused', 'info'); }
        await _save(p);
        toggleSidePanel(projectId); renderProjectDetail(projectId);
    }
    async function addSideNote(projectId) {
        var p = getById(projectId);
        if (!p) return;
        var note = prompt('Add a side note:');
        if (!note) return;
        if (!p.notes) p.notes = [];
        p.notes.push({ text: note, author: (typeof Users !== 'undefined' && Users.getCurrentUser() ? Users.getCurrentUser().name : 'Unknown'), date: new Date().toISOString().slice(0,10) });
        await _save(p);
        toggleSidePanel(projectId); renderProjectDetail(projectId);
    }

    /* ─── Public API ────────────────────────────────────────────── */
    return {
        _onDeptChange: _onDeptChange,
        _createStageDoc: _createStageDoc,
        _linkDocToStage: _linkDocToStage,
        _switchAssignType: _switchAssignType,
        _collectStageAssignment: _collectStageAssignment,
        load: load,
        getAll: getAll,
        getById: getById,
        getActive: getActive,
        getCompleted: getCompleted,
        getForUser: getForUser,
        getForDepartment: getForDepartment,
        getAssignedToUser: getAssignedToUser,
        getStagesForUser: getStagesForUser,
        getWaitingOnOthers: getWaitingOnOthers,
        create: create,
        addStage: addStage,
        updateStage: updateStage,
        completeStage: completeStage,
        saveProjectAsPreset: saveProjectAsPreset,
        deleteProjectPreset: deleteProjectPreset,
        createFromPreset: createFromPreset,
        resolve: resolveProject,
        _save: _save,
        _delete: _delete,
        renderAddStage: renderAddStage,
        renderProjectDetail: renderProjectDetail,
        renderProjectsList: renderProjectsList,
        renderMyWork: renderMyWork,
        _doCreate: _doCreate,
        _doAddStage: _doAddStage,
        _doCompleteStage: _doCompleteStage,
        editStage: editStage,
        _meditSwitch: _meditSwitch,
        _doSaveStageEdit: _doSaveStageEdit,
        renderMemberModal: renderMemberModal,
        _saveMembers: _saveMembers,
        _doResolve: _doResolve,
        _doDeleteProject: _doDeleteProject,
        _emailNextStage: emailNextStage,
        generateProjectReport: generateProjectReport,
        buildProjectsMaster: buildProjectsMaster,
        loadProjectDetail: loadProjectDetail,
        toggleSidePanel: toggleSidePanel,
        reportIssue: reportIssue,
        togglePause: togglePause,
        addSideNote: addSideNote
    };
})();
