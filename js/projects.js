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

    /* ─── Storage: birds_documents IDB via _localDocs* ────────── */
    function _path(id) { return 'Projects/' + id + '.json'; }

    async function _loadAll() {
        if (!window._localDocsConnection) { try { await _localDocsInit(); } catch(e) {} }
        if (!window._localDocsConnection) return [];
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

    async function _save(project) {
        if (!window._localDocsConnection) await _localDocsInit();
        if (!window._localDocsConnection) return;
        return new Promise(function(resolve) {
            try {
                var tx = window._localDocsConnection.transaction('files', 'readwrite');
                tx.objectStore('files').put({ path: _path(project.id), data: JSON.stringify(project) });
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function() { resolve(); };
            } catch(e) { resolve(); }
        });
    }

    async function _delete(id) {
        if (!window._localDocsConnection) return;
        return new Promise(function(resolve) {
            try {
                var tx = window._localDocsConnection.transaction('files', 'readwrite');
                tx.objectStore('files').delete(_path(id));
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function() { resolve(); };
            } catch(e) { resolve(); }
        });
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
        if (stage.assignType === 'department' && stage.assignDepartment) {
            var user = (typeof Users !== 'undefined') ? Users.getById(userId) : null;
            return user && user.department === stage.assignDepartment;
        }
        if (stage.assignType === 'custom') return false;
        return stage.assignedTo && stage.assignedTo.indexOf(userId) !== -1;
    }

    /* Get projects where the user has an active (pending/in_progress) stage */
    function getAssignedToUser(userId) {
        return _projects.filter(function(p) {
            if (p.status !== 'active') return false;
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
            if (p.status !== 'active') return;
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
            if (p.status !== 'active') return;
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
    async function create(name, description, department) {
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
            currentStageIndex: 0,
            stages: []
        };
        _projects.unshift(project);
        await _save(project);
        return project;
    }

    /* ─── Stage management ────────────────────────────────────── */
    async function addStage(projectId, title, description, assignedTo) {
        var p = getById(projectId);
        if (!p) return null;
        var stage = {
            id: 'stage-' + Date.now().toString(36),
            title: title.trim(),
            description: (description || '').trim(),
            assignedTo: assignedTo || [],
            assignType: window._lastAssignType || 'persons',
            assignDepartment: window._lastAssignDepartment || '',
            assignCustom: window._lastAssignCustom || '',
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
        if (!project.stages.length) return 0;
        var done = project.stages.filter(function(s) { return s.status === 'completed'; }).length;
        return Math.round((done / project.stages.length) * 100);
    }

    function getCurrentStage(project) {
        if (project.currentStageIndex < project.stages.length) {
            return project.stages[project.currentStageIndex];
        }
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
        if (!name || !name.value.trim()) { showToast('Please enter a project name', 'error'); return; }
        var p = await create(name.value, desc ? desc.value : '', dept ? dept.value : 'General');
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
        var deptOpts = (typeof Users !== 'undefined') ? Users.getDeptOptionsHtml('', false) : '<option>General</option>';
        deptOpts += '<option value="__add_custom__">+ Add Custom Department...</option>';
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
                            <select id="stage-assign-dept" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-birds-green outline-none">${deptOpts}</select>
                            <p class="text-[10px] text-slate-400 mt-1">Everyone in this department will be notified</p>
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
        var assignDepartment = '';
        var assignCustom = '';

        if (type === 'department') {
            var deptEl = document.getElementById('stage-assign-dept');
            assignDepartment = deptEl ? deptEl.value : '';
            /* Resolve department to user IDs for assignedTo */
            if (assignDepartment && typeof Users !== 'undefined') {
                Users.getByDepartment(assignDepartment).forEach(function(u) { assignedTo.push(u.id); });
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
        window._lastAssignDepartment = assignDepartment;
        window._lastAssignCustom = assignCustom;
        return { assignedTo: assignedTo, assignType: type, assignDepartment: assignDepartment, assignCustom: assignCustom };
    }

    async function _doAddStage(projectId) {
        var title = document.getElementById('stage-title');
        var desc = document.getElementById('stage-desc');
        if (!title || !title.value.trim()) { showToast('Please enter a stage title', 'error'); return; }
        var assignment = _collectStageAssignment();
        var s = await addStage(projectId, title.value, desc ? desc.value : '', assignment.assignedTo);
        showToast('Stage added', 'success');
        renderProjectDetail(projectId);
    }

    /* ═══════════════════════════════════════════════════════════════
       UI: PROJECT DETAIL VIEW
       ═══════════════════════════════════════════════════════════════ */
    function renderProjectDetail(projectId) {
        var p = getById(projectId);
        if (!p) { showToast('Project not found', 'error'); setView('projects'); return; }
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
                if (s.assignType === 'department' && s.assignDepartment) {
                    isYourTurn = user.department === s.assignDepartment;
                } else if (s.assignType !== 'custom') {
                    isYourTurn = s.assignedTo && s.assignedTo.indexOf(user.id) !== -1;
                }
            }

            var borderColor = isPast ? '#6E8E6D' : isCurrent ? '#D97706' : '#E8E5E0';
            var bgColor = isPast ? 'rgba(135,157,130,0.04)' : isYourTurn ? 'rgba(255,243,205,0.5)' : isCurrent ? 'rgba(255,243,205,0.2)' : 'transparent';
            var statusIcon = isPast ? '\u2705' : isYourTurn ? '\u26A1' : isCurrent ? '\U0001F7E1' : '\u23F3';
            var statusLabel = isPast ? 'Completed' : isYourTurn ? 'YOUR TURN' : isCurrent ? 'In Progress' : 'Waiting';
            var statusColor = isPast ? '#6E8E6D' : isYourTurn ? '#D94F4F' : isCurrent ? '#D97706' : '#999';

            var assigneeNames = '';
            var assignBadge = '';
            if (s.assignType === 'department' && s.assignDepartment) {
                var deptMembers = (typeof Users !== 'undefined') ? Users.getByDepartment(s.assignDepartment) : [];
                var deptNames = deptMembers.map(function(m) { return m.name; }).join(', ');
                assigneeNames = s.assignDepartment + (deptNames ? ' (' + deptNames + ')' : ' (no members)');
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
                        </div>
                        <p class="text-xs text-slate-500">${escapeHtml(s.description || 'No description')}</p>
                        <p class="text-[11px] text-slate-400 mt-1">Assigned: <strong>${escapeHtml(assigneeNames)}</strong>${assignBadge}</p>
                        ${completedByInfo}
                        ${overviewHtml}
                        ${linkedDocsHtml}
                    </div>
                    <div class="text-xs font-black text-slate-300">#${idx + 1}</div>
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
                    </div>
                    <div class="text-right flex-shrink-0">
                        ${p.status === 'needs_resolution' ? '<button onclick="Projects._doResolve(\'' + p.id + '\')" style="background:#6E8E6D;color:white;padding:6px 14px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">\u2714 Resolve Project</button>' : ''}
                        ${p.status === 'active' ? '<button onclick="Projects._doResolve(\'' + p.id + '\')" style="background:transparent;color:#999;padding:6px 14px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #E8E5E0;cursor:pointer;">Resolve Early</button>' : ''}
                    </div>
                </div>

                <!-- Progress bar -->
                ${p.stages.length ? `
                <div class="mb-5">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Progress</span>
                        <span class="text-xs font-bold text-slate-600">${p.stages.filter(function(s){return s.status==='completed'}).length}/${p.stages.length} stages</span>
                    </div>
                    <div style="height:8px;background:#E8E5E0;border-radius:4px;overflow:hidden;">
                        <div style="height:100%;width:${progress}%;background:linear-gradient(90deg,#6E8E6D,#5A7A59);border-radius:4px;transition:width .3s;"></div>
                    </div>
                </div>` : ''}

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

    async function _doResolve(projectId) {
        if (!confirm('Resolve this project? This marks it as complete.')) return;
        await resolveProject(projectId);
        showToast('Project resolved', 'success');
        renderProjectDetail(projectId);
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
    function renderProjectsList() {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var active = getActive();
        var completed = getCompleted();

        /* Only show projects the user is involved in */
        var visible = user ? active.filter(function(p) {
            return p.createdBy === user.id ||
                p.stages.some(function(s) { return _isUserAssignedToStage(s, user.id); }) ||
                p.department === user.department;
        }) : active;

        var completedVisible = user ? completed.filter(function(p) {
            return p.createdBy === user.id ||
                p.stages.some(function(s) { return _isUserAssignedToStage(s, user.id); }) ||
                p.department === user.department;
        }) : completed;

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

        document.getElementById('mainView').innerHTML = `
        <div>
            <div class="flex items-center justify-between mb-5">
                <div>
                    <h2 class="text-2xl font-black text-slate-800">Projects</h2>
                    <p class="text-sm text-slate-400">${visible.length} active project${visible.length !== 1 ? 's' : ''}</p>
                </div>
                <button onclick="Projects.renderCreateProject()" style="background:#6E8E6D;color:white;padding:8px 18px;border-radius:8px;font-weight:800;font-size:12px;border:none;cursor:pointer;">+ New Project</button>
            </div>
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
            if (currentStage.assignType === 'department' && currentStage.assignDepartment) {
                var nm = (typeof Users !== 'undefined') ? Users.getByDepartment(currentStage.assignDepartment) : [];
                nextAssignee = currentStage.assignDepartment + ' (' + nm.map(function(m) { return m.name.split(' ')[0]; }).join(', ') + ')';
            } else if (currentStage.assignType === 'custom' && currentStage.assignCustom) {
                nextAssignee = currentStage.assignCustom;
            } else if (currentStage.assignedTo && currentStage.assignedTo.length) {
                nextAssignee = currentStage.assignedTo.map(function(uid) {
                    var u = (typeof Users !== 'undefined') ? Users.getById(uid) : null;
                    return u ? u.name.split(' ')[0] : '';
                }).filter(Boolean).join(', ');
            }
        }

        return `
        <div class="card p-4 cursor-pointer hover:shadow-md transition-all border-t-2 ${statusColors[p.status] || 'border-t-slate-300'}" onclick="Projects.renderProjectDetail('${p.id}')" style="${isYourTurn ? 'background:rgba(255,243,205,0.3);' : ''}">
            ${isYourTurn ? '<div style="font-size:9px;font-weight:800;color:#D94F4F;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">\u26A1 Your Turn</div>' : ''}
            <h3 class="text-sm font-black text-slate-800 mb-1 truncate">${escapeHtml(p.name)}</h3>
            <p class="text-[11px] text-slate-400 mb-2 line-clamp-1">${escapeHtml(p.description || 'No description')}</p>
            <div style="height:5px;background:#E8E5E0;border-radius:3px;overflow:hidden;margin-bottom:8px;">
                <div style="height:100%;width:${progress}%;background:${p.status === 'resolved' ? '#6E8E6D' : '#D97706'};border-radius:3px;"></div>
            </div>
            <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold text-slate-400">${p.stages.filter(function(s){return s.status==='completed'}).length}/${p.stages.length} stages</span>
                ${currentStage && p.status === 'active' ? '<span class="text-[10px] font-bold text-slate-400">Next: ' + escapeHtml(nextAssignee || 'Unassigned') + '</span>' : ''}
            </div>
        </div>`;
    }

    /* ═══════════════════════════════════════════════════════════════
       UI: MY WORK DASHBOARD
       ═══════════════════════════════════════════════════════════════ */
    function renderMyWork() {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (!user) { showToast('Not logged in', 'error'); return; }

        var myStages = getStagesForUser(user.id);
        var waitingOn = getWaitingOnOthers(user.id);
        var myDocs = window.currentLoadedDocs ? (window.currentLoadedDocs.open || []) : [];
        var myAssignedDocs = myDocs.filter(function(d) {
            return d.attentionOf === user.name || d.creator === user.name ||
                (d.replies && d.replies.some(function(r) { return r.author === user.name; }));
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
                <p class="text-sm font-bold text-slate-500">\u2714 All clear — nothing needs your action right now</p>
            </div>`}

            ${waitingOn.length ? `
            <div class="mb-6">
                <h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">\u23F3 Waiting on Others (${waitingOn.length})</h3>
                <div class="space-y-3">${waitingHtml}</div>
            </div>` : ''}

            ${myAssignedDocs.length ? `
            <div class="mb-6">
                <h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">\uD83D\uDCCB Recent Documents (${myAssignedDocs.length})</h3>
                <div class="space-y-2">
                    ${myAssignedDocs.slice(0, 5).map(function(d) {
                        return '<div class="card p-3 cursor-pointer hover:shadow-sm transition-all" onclick="openDocumentViewer(\'' + d.id + '\',\'Open\',\'' + (d.userFolderId || '') + '\')">' +
                            '<h4 class="text-sm font-bold text-slate-700">' + escapeHtml(d.name || 'Untitled') + '</h4>' +
                            '<p class="text-[10px] text-slate-400">' + escapeHtml(d.type || '') + ' \u2022 ' + escapeHtml(d.date || '') + '</p></div>';
                    }).join('')}
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
        getProgress: getProgress,
        getCurrentStage: getCurrentStage,
        create: create,
        addStage: addStage,
        completeStage: completeStage,
        resolveProject: resolveProject,
        deleteProject: deleteProject,
        emailNextStage: emailNextStage,
        renderCreateProject: renderCreateProject,
        renderAddStage: renderAddStage,
        renderProjectDetail: renderProjectDetail,
        renderProjectsList: renderProjectsList,
        renderMyWork: renderMyWork,
        _doCreate: _doCreate,
        _doAddStage: _doAddStage,
        _doCompleteStage: _doCompleteStage,
        _doResolve: _doResolve,
        _emailNextStage: emailNextStage
    };
})();
