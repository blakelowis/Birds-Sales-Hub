/* ─── Projects Module v2 ────────────────────────────────────────── */
/* Flexible staged projects with side-timeline, issue sub-loops,   */
/* timestamped notes, attachments, and template/preset system      */

window.Projects = (function() {
    var _projects = [];
    var _templates = [];
    var PROJECT_PREFIX = 'PRJ-';
    var TPL_PREFIX = 'TPL-';

    /* ─── Data Model ────────────────────────────────────────── */
    /*
    Project = {
        id: 'PRJ-2026-abc123',
        name: string,
        description: string,
        department: string,
        status: 'active' | 'completed' | 'archived',
        health: 'green' | 'amber' | 'red' | null,
        createdBy: userId,
        createdByName: string,
        createdAt: ISO date,
        startDate: ISO date,
        endDate: ISO date,
        currentStageIndex: number,
        stages: [Stage],
        timeline: [TimelineEntry],   // master audit trail
        tags: [string],
        presetId: string | null       // if created from template
    }

    Stage = {
        id: 'stage-xxx',
        title: string,
        description: string,
        status: 'pending' | 'in_progress' | 'completed',
        assignedTo: [userId],
        assignType: 'persons' | 'department' | 'custom',
        assignDepartments: [string],
        assignCustom: string,
        dueDate: string,
        startedAt: ISO datetime | null,
        completedAt: ISO datetime | null,
        completedBy: userId | null,
        completedByName: string | null,
        notes: [Note],
        attachments: [Attachment],
        issues: [Issue]               // side-branch sub-loops
    }

    Issue = {
        id: 'issue-xxx',
        title: string,
        description: string,
        status: 'open' | 'resolved',
        severity: 'low' | 'medium' | 'high',
        createdAt: ISO datetime,
        resolvedAt: ISO datetime | null,
        resolvedBy: userId | null,
        notes: [Note],
        attachments: [Attachment]
    }

    Note = {
        id: 'note-xxx',
        text: string,
        author: userId,
        authorName: string,
        createdAt: ISO datetime,
        type: 'note' | 'update' | 'issue' | 'milestone'
    }

    Attachment = {
        id: 'att-xxx',
        name: string,
        type: string (mime),
        size: number,
        data: string (base64),
        uploadedBy: userId,
        uploadedAt: ISO datetime
    }

    TimelineEntry = {
        id: 'tl-xxx',
        timestamp: ISO datetime,
        type: 'created' | 'stage_started' | 'stage_completed' | 'issue_opened' | 'issue_resolved' | 'note_added' | 'status_change',
        stageTitle: string | null,
        issueTitle: string | null,
        by: userId,
        byName: string,
        summary: string
    }

    Template = {
        id: 'TPL-xxx',
        name: string,
        description: string,
        department: string,
        stages: [{title, description, assignType, assignDepartments}],
        createdBy: userId,
        createdAt: ISO date,
        isBuiltIn: boolean
    }
    */

    /* ─── Storage ───────────────────────────────────────────── */
    function _path(id) { return 'Projects/' + id + '.json'; }
    function _tplPath(id) { return 'Projects/Templates/' + id + '.json'; }

    async function _saveToFilesystem(project) {
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try {
                await GraphClient.ensureFolder('Projects');
                await GraphClient.writeFile('Projects/' + project.id + '.json', JSON.stringify(project, null, 2));
            } catch(e) {}
        }
        if (window.directoryHandle) {
            try {
                var prjFolder = null;
                for await (var entry of window.directoryHandle.values()) {
                    if (entry.kind === 'directory' && entry.name === 'Projects') { prjFolder = entry; break; }
                }
                if (!prjFolder) prjFolder = await window.directoryHandle.getDirectoryHandle('Projects', { create: true });
                var fh = await prjFolder.getFileHandle(project.id + '.json', { create: true });
                var ws = await fh.createWritable();
                await ws.write(JSON.stringify(project, null, 2));
                await ws.close();
            } catch(e) { console.warn('[Projects] Filesystem save failed:', e.message); }
        }
    }

    async function _saveTemplateToFilesystem(tpl) {
        if (window.directoryHandle) {
            try {
                var prjFolder = null;
                for await (var entry of window.directoryHandle.values()) {
                    if (entry.kind === 'directory' && entry.name === 'Projects') { prjFolder = entry; break; }
                }
                if (!prjFolder) prjFolder = await window.directoryHandle.getDirectoryHandle('Projects', { create: true });
                var tplFolder = null;
                for await (var sub of prjFolder.values()) {
                    if (sub.kind === 'directory' && sub.name === 'Templates') { tplFolder = sub; break; }
                }
                if (!tplFolder) tplFolder = await prjFolder.getDirectoryHandle('Templates', { create: true });
                var fh = await tplFolder.getFileHandle(tpl.id + '.json', { create: true });
                var ws = await fh.createWritable();
                await ws.write(JSON.stringify(tpl, null, 2));
                await ws.close();
            } catch(e) {}
        }
    }

    async function _deleteFromFilesystem(id) {
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try { await GraphClient.deleteFile('Projects/' + id + '.json'); } catch(e) {}
        }
        if (window.directoryHandle) {
            try {
                var prjFolder = null;
                for await (var entry of window.directoryHandle.values()) {
                    if (entry.kind === 'directory' && entry.name === 'Projects') { prjFolder = entry; break; }
                }
                if (prjFolder) await prjFolder.removeEntry(id + '.json');
            } catch(e) {}
        }
    }

    async function _loadFromFilesystem() {
        if (typeof GraphClient !== 'undefined' && typeof BirdsAuth !== 'undefined' && BirdsAuth.isLoggedIn()) {
            try {
                var items = await GraphClient.listJsonFiles('Projects');
                var results = [];
                for (var item of items) {
                    if (item.name.startsWith('TPL-')) continue;
                    try {
                        var text = await GraphClient.readFile('Projects/' + item.name);
                        if (text) results.push(JSON.parse(text));
                    } catch(e) {}
                }
                return results;
            } catch(e) {}
        }
        if (window.directoryHandle) {
            try {
                var prjFolder = null;
                for await (var entry of window.directoryHandle.values()) {
                    if (entry.kind === 'directory' && entry.name === 'Projects') { prjFolder = entry; break; }
                }
                if (!prjFolder) return [];
                var results = [];
                for await (var subEntry of prjFolder.values()) {
                    if (subEntry.kind === 'file' && subEntry.name.endsWith('.json') && !subEntry.name.startsWith('TPL-')) {
                        try {
                            var file = await subEntry.getFile();
                            var text = await file.text();
                            results.push(JSON.parse(text));
                        } catch(e) {}
                    }
                }
                return results;
            } catch(e) {}
        }
        return [];
    }

    async function _loadTemplatesFromFilesystem() {
        var results = [];
        if (window.directoryHandle) {
            try {
                var prjFolder = null;
                for await (var entry of window.directoryHandle.values()) {
                    if (entry.kind === 'directory' && entry.name === 'Projects') { prjFolder = entry; break; }
                }
                if (!prjFolder) return [];
                var tplFolder = null;
                for await (var sub of prjFolder.values()) {
                    if (sub.kind === 'directory' && sub.name === 'Templates') { tplFolder = sub; break; }
                }
                if (!tplFolder) return [];
                for await (var f of tplFolder.values()) {
                    if (f.kind === 'file' && f.name.endsWith('.json')) {
                        try {
                            var file = await f.getFile();
                            results.push(JSON.parse(await file.text()));
                        } catch(e) {}
                    }
                }
            } catch(e) {}
        }
        return results;
    }

    async function _loadAll() {
        var fsProjects = await _loadFromFilesystem();
        if (fsProjects.length) {
            _projects = fsProjects;
            return _projects;
        }
        return [];
    }

    async function _save(project) {
        /* Strip large attachment data before saving to filesystem to avoid quota issues */
        var toSave = JSON.parse(JSON.stringify(project));
        toSave.stages.forEach(function(s) {
            if (s.attachments) s.attachments = s.attachments.map(function(a) { return { id: a.id, name: a.name, type: a.type, size: a.size, uploadedBy: a.uploadedBy, uploadedAt: a.uploadedAt }; });
            if (s.issues) s.issues.forEach(function(iss) {
                if (iss.attachments) iss.attachments = iss.attachments.map(function(a) { return { id: a.id, name: a.name, type: a.type, size: a.size, uploadedBy: a.uploadedBy, uploadedAt: a.uploadedAt }; });
            });
        });
        await _saveToFilesystem(toSave);
        var idx = _projects.findIndex(function(p) { return p.id === project.id; });
        if (idx >= 0) _projects[idx] = project; else _projects.unshift(project);
    }

    async function _delete(id) {
        await _deleteFromFilesystem(id);
    }

    /* ─── Helpers ────────────────────────────────────────────── */
    function _uid() { return Math.random().toString(36).substring(2, 10); }
    function _now() { return new Date().toISOString(); }
    function _today() { return new Date().toISOString().substring(0, 10); }
    function _escapeHtml(v) {
        return String(v || '').replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }

    function _addTimeline(project, type, summary, stageTitle, issueTitle) {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (!project.timeline) project.timeline = [];
        project.timeline.push({
            id: 'tl-' + _uid(),
            timestamp: _now(),
            type: type,
            stageTitle: stageTitle || null,
            issueTitle: issueTitle || null,
            by: user ? user.id : '',
            byName: user ? user.name : 'Unknown',
            summary: summary
        });
    }

    /* ─── Load / Refresh ──────────────────────────────────────── */
    async function load() {
        _projects = await _loadAll();
        _projects.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        return _projects;
    }

    async function loadTemplates() {
        _templates = await _loadTemplatesFromFilesystem();
        return _templates;
    }

    function getAll() { return _projects.slice(); }
    function getById(id) { return _projects.find(function(p) { return p.id === id; }) || null; }
    function getActive() { return _projects.filter(function(p) { return p.status === 'active'; }); }
    function getCompleted() { return _projects.filter(function(p) { return p.status === 'completed'; }); }
    function getArchived() { return _projects.filter(function(p) { return p.status === 'archived'; }); }

    function getProgress(project) {
        if (!project.stages || !project.stages.length) return 0;
        var done = project.stages.filter(function(s) { return s.status === 'completed'; }).length;
        return Math.round((done / project.stages.length) * 100);
    }

    function getCurrentStage(project) {
        if (project.currentStageIndex < (project.stages || []).length) {
            return project.stages[project.currentStageIndex];
        }
        return null;
    }

    function _getDaysElapsed(project) {
        if (!project.createdAt) return 0;
        var start = new Date(project.createdAt);
        var end = project.status === 'completed' ? new Date(project.completedAt || _now()) : new Date();
        return Math.max(0, Math.floor((end - start) / 86400000));
    }

    function _getRag(project) {
        if (project.health) return project.health;
        if (project.status === 'completed' || project.status === 'archived') return 'green';
        if (!project.endDate) return null;
        var now = new Date();
        var end = new Date(project.endDate + 'T23:59:59');
        var diff = Math.ceil((end - now) / 86400000);
        if (diff < 0) return 'red';
        if (diff <= 7) return 'amber';
        var hasOverdue = (project.stages || []).some(function(s) {
            if (s.status === 'completed' || !s.dueDate) return false;
            return new Date(s.dueDate + 'T23:59:59') < now;
        });
        if (hasOverdue) return 'amber';
        return 'green';
    }

    /* ─── Create project ──────────────────────────────────────── */
    async function create(name, description, department, startDate, endDate, presetId) {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var project = {
            id: PROJECT_PREFIX + new Date().getFullYear() + '-' + _uid(),
            name: name.trim(),
            description: (description || '').trim(),
            department: department || 'General',
            status: 'active',
            health: null,
            createdBy: user ? user.id : '',
            createdByName: user ? user.name : 'Unknown',
            createdAt: _now(),
            startDate: startDate || _today(),
            endDate: endDate || '',
            currentStageIndex: 0,
            stages: [],
            timeline: [],
            tags: [],
            presetId: presetId || null
        };
        _addTimeline(project, 'created', 'Project created');
        _projects.unshift(project);
        await _save(project);
        return project;
    }

    /* ─── Stage management ────────────────────────────────────── */
    function _createStage(title, description, assignType, assignDepartments, assignCustom, assignedTo, dueDate) {
        return {
            id: 'stage-' + _uid(),
            title: title.trim(),
            description: (description || '').trim(),
            status: 'pending',
            startedAt: null,
            completedAt: null,
            completedBy: null,
            completedByName: null,
            assignedTo: assignedTo || [],
            assignType: assignType || 'persons',
            assignDepartments: assignDepartments || [],
            assignCustom: assignCustom || '',
            dueDate: dueDate || '',
            notes: [],
            attachments: [],
            issues: []
        };
    }

    async function addStage(projectId, title, description, assignType, assignDepartments, assignCustom, assignedTo, dueDate) {
        var p = getById(projectId);
        if (!p) return null;
        var stage = _createStage(title, description, assignType, assignDepartments, assignCustom, assignedTo, dueDate);
        p.stages.push(stage);
        _addTimeline(p, 'stage_started', 'Stage added: ' + title, title);
        await _save(p);
        return stage;
    }

    async function startStage(projectId, stageId) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage || stage.status !== 'pending') return;
        stage.status = 'in_progress';
        stage.startedAt = _now();
        _addTimeline(p, 'stage_started', 'Stage started: ' + stage.title, stage.title);
        await _save(p);
    }

    async function completeStage(projectId, stageId, summary) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        stage.status = 'completed';
        stage.completedAt = _now();
        stage.completedBy = user ? user.id : null;
        stage.completedByName = user ? user.name : null;
        if (summary) {
            stage.notes.push({ id: 'note-' + _uid(), text: summary, author: user ? user.id : '', authorName: user ? user.name : 'Unknown', createdAt: _now(), type: 'milestone' });
        }
        _addTimeline(p, 'stage_completed', 'Stage completed: ' + stage.title + (summary ? ' — ' + summary.substring(0, 80) : ''), stage.title);
        var stageIdx = p.stages.indexOf(stage);
        if (stageIdx >= p.currentStageIndex) p.currentStageIndex = stageIdx + 1;
        if (p.currentStageIndex >= p.stages.length) {
            p.status = 'completed';
            p.completedAt = _now();
            _addTimeline(p, 'status_change', 'Project completed');
        }
        await _save(p);
    }

    async function updateStage(projectId, stageId, updates) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        Object.keys(updates).forEach(function(k) { stage[k] = updates[k]; });
        await _save(p);
    }

    async function removeStage(projectId, stageId) {
        var p = getById(projectId);
        if (!p) return;
        var idx = p.stages.findIndex(function(s) { return s.id === stageId; });
        if (idx === -1) return;
        var stage = p.stages[idx];
        p.stages.splice(idx, 1);
        if (p.currentStageIndex >= p.stages.length) p.currentStageIndex = Math.max(0, p.stages.length - 1);
        _addTimeline(p, 'status_change', 'Stage removed: ' + stage.title, stage.title);
        await _save(p);
    }

    /* ─── Notes ──────────────────────────────────────────────── */
    async function addNote(projectId, stageId, text, type) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var note = { id: 'note-' + _uid(), text: text, author: user ? user.id : '', authorName: user ? user.name : 'Unknown', createdAt: _now(), type: type || 'note' };
        stage.notes.push(note);
        _addTimeline(p, 'note_added', text.substring(0, 100) + (text.length > 100 ? '...' : ''), stage.title);
        await _save(p);
        return note;
    }

    /* ─── Issues (side-branch) ──────────────────────────────── */
    async function openIssue(projectId, stageId, title, description, severity) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var issue = {
            id: 'issue-' + _uid(),
            title: title.trim(),
            description: (description || '').trim(),
            status: 'open',
            severity: severity || 'medium',
            createdAt: _now(),
            resolvedAt: null,
            resolvedBy: null,
            notes: [],
            attachments: []
        };
        if (!stage.issues) stage.issues = [];
        stage.issues.push(issue);
        _addTimeline(p, 'issue_opened', 'Issue opened: ' + title, stage.title, title);
        await _save(p);
        return issue;
    }

    async function resolveIssue(projectId, stageId, issueId, note) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        var issue = (stage.issues || []).find(function(i) { return i.id === issueId; });
        if (!issue) return;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        issue.status = 'resolved';
        issue.resolvedAt = _now();
        issue.resolvedBy = user ? user.id : null;
        if (note) {
            issue.notes.push({ id: 'note-' + _uid(), text: note, author: user ? user.id : '', authorName: user ? user.name : 'Unknown', createdAt: _now(), type: 'note' });
        }
        _addTimeline(p, 'issue_resolved', 'Issue resolved: ' + issue.title + (note ? ' — ' + note.substring(0, 60) : ''), stage.title, issue.title);
        await _save(p);
    }

    async function addIssueNote(projectId, stageId, issueId, text) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        var issue = (stage.issues || []).find(function(i) { return i.id === issueId; });
        if (!issue) return;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        issue.notes.push({ id: 'note-' + _uid(), text: text, author: user ? user.id : '', authorName: user ? user.name : 'Unknown', createdAt: _now(), type: 'note' });
        await _save(p);
    }

    /* ─── Attachments ────────────────────────────────────────── */
    async function addAttachment(projectId, stageId, file) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        return new Promise(function(resolve) {
            var reader = new FileReader();
            reader.onload = function() {
                var base64 = reader.result;
                var att = { id: 'att-' + _uid(), name: file.name, type: file.type, size: file.size, data: base64, uploadedBy: user ? user.id : '', uploadedAt: _now() };
                stage.attachments.push(att);
                _addTimeline(p, 'note_added', 'File attached: ' + file.name, stage.title);
                _save(p).then(function() { resolve(att); });
            };
            reader.readAsDataURL(file);
        });
    }

    async function removeAttachment(projectId, stageId, attId) {
        var p = getById(projectId);
        if (!p) return;
        var stage = p.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return;
        stage.attachments = stage.attachments.filter(function(a) { return a.id !== attId; });
        await _save(p);
    }

    /* ─── Project actions ──────────────────────────────────── */
    async function archiveProject(projectId) {
        var p = getById(projectId);
        if (!p) return;
        p.status = 'archived';
        _addTimeline(p, 'status_change', 'Project archived');
        await _save(p);
    }

    async function reopenProject(projectId) {
        var p = getById(projectId);
        if (!p) return;
        p.status = 'active';
        p.completedAt = null;
        _addTimeline(p, 'status_change', 'Project reopened');
        await _save(p);
    }

    async function deleteProject(projectId) {
        _projects = _projects.filter(function(p) { return p.id !== projectId; });
        await _delete(projectId);
    }

    async function setHealth(projectId, health) {
        var p = getById(projectId);
        if (!p) return;
        p.health = health;
        await _save(p);
    }

    /* ─── Templates / Presets ────────────────────────────────── */
    async function saveAsTemplate(projectId, name) {
        var p = getById(projectId);
        if (!p) return null;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var tpl = {
            id: TPL_PREFIX + _uid(),
            name: name || p.name + ' (Template)',
            description: p.description,
            department: p.department,
            stages: p.stages.map(function(s) {
                return { title: s.title, description: s.description, assignType: s.assignType, assignDepartments: s.assignDepartments || [], assignCustom: s.assignCustom || '' };
            }),
            createdBy: user ? user.id : '',
            createdAt: _today(),
            isBuiltIn: false
        };
        _templates.unshift(tpl);
        await _saveTemplateToFilesystem(tpl);
        return tpl;
    }

    async function createFromTemplate(tplId, name, startDate, endDate) {
        var tpl = _templates.find(function(t) { return t.id === tplId; });
        if (!tpl) return null;
        var p = await create(name || tpl.name, tpl.description, tpl.department, startDate, endDate, tpl.id);
        for (var i = 0; i < tpl.stages.length; i++) {
            var ts = tpl.stages[i];
            await addStage(p.id, ts.title, ts.description, ts.assignType, ts.assignDepartments, ts.assignCustom, [], '');
        }
        return getById(p.id);
    }

    async function deleteTemplate(tplId) {
        _templates = _templates.filter(function(t) { return t.id !== tplId; });
        if (window.directoryHandle) {
            try {
                var prjFolder = null;
                for await (var entry of window.directoryHandle.values()) {
                    if (entry.kind === 'directory' && entry.name === 'Projects') { prjFolder = entry; break; }
                }
                if (prjFolder) {
                    var tplFolder = null;
                    for await (var sub of prjFolder.values()) {
                        if (sub.kind === 'directory' && sub.name === 'Templates') { tplFolder = sub; break; }
                    }
                    if (tplFolder) await tplFolder.removeEntry(tplId + '.json');
                }
            } catch(e) {}
        }
    }

    function getTemplates() { return _templates.slice(); }

    /* ═══════════════════════════════════════════════════════════════
       UI: PROJECTS OVERVIEW — SUMMARY + FILTERS + CARDS
       ═══════════════════════════════════════════════════════════════ */
    var _filterState = { status: 'all', dept: 'all', health: 'all', search: '' };

    async function renderProjectsList() {
        if (!_projects.length) { try { await load(); } catch(e) {} }
        if (!_templates.length) { try { await loadTemplates(); } catch(e) {} }
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var isAdmin = user && user.role === 'admin';
        var all = getAll();
        var active = getActive();
        var completed = getCompleted();
        var archived = getArchived();

        var totalOpenIssues = 0;
        var yourTurnCount = 0;
        all.forEach(function(p) {
            (p.stages || []).forEach(function(s) {
                (s.issues || []).forEach(function(i) { if (i.status === 'open') totalOpenIssues++; });
                if (p.status === 'active' && s.status !== 'completed' && user && _isUserAssignedToStage(s, user.id)) yourTurnCount++;
            });
        });

        var depts = [];
        all.forEach(function(p) { if (p.department && depts.indexOf(p.department) === -1) depts.push(p.department); });
        depts.sort();

        var filtered = all.filter(function(p) {
            if (_filterState.status !== 'all' && p.status !== _filterState.status) return false;
            if (_filterState.dept !== 'all' && p.department !== _filterState.dept) return false;
            if (_filterState.health !== 'all') {
                var rag = _getRag(p);
                if (rag !== _filterState.health) return false;
            }
            if (_filterState.search) {
                var q = _filterState.search.toLowerCase();
                if ((p.name || '').toLowerCase().indexOf(q) === -1 && (p.description || '').toLowerCase().indexOf(q) === -1 && (p.id || '').toLowerCase().indexOf(q) === -1) return false;
            }
            return true;
        });

        var filteredActive = filtered.filter(function(p) { return p.status === 'active'; });
        var filteredCompleted = filtered.filter(function(p) { return p.status === 'completed'; });
        var filteredArchived = filtered.filter(function(p) { return p.status === 'archived'; });

        var activeHtml = filteredActive.length ? filteredActive.map(function(p) { return _renderProjectCard(p); }).join('') :
            '<div class="text-center py-8 text-slate-400 col-span-full"><p class="text-lg font-black">' + (_filterState.status !== 'all' || _filterState.dept !== 'all' || _filterState.health !== 'all' || _filterState.search ? 'No Matching Projects' : 'No Active Projects') + '</p><p class="text-sm mt-1">' + (_filterState.status !== 'all' || _filterState.dept !== 'all' || _filterState.health !== 'all' || _filterState.search ? 'Try adjusting your filters.' : 'Create a new project or start from a template.') + '</p></div>';

        var completedHtml = filteredCompleted.length ? filteredCompleted.map(function(p) { return _renderProjectCard(p); }).join('') : '';

        var archivedHtml = filteredArchived.length ? '<details class="col-span-full"><summary class="text-xs font-black text-slate-400 uppercase tracking-widest cursor-pointer mb-2">Archived (' + filteredArchived.length + ')</summary><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">' + filteredArchived.map(function(p) { return _renderProjectCard(p); }).join('') + '</div></details>' : '';

        var tplHtml = '';
        if (_templates.length && _filterState.status === 'all') {
            tplHtml = '<div class="col-span-full mt-6 mb-2"><h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Templates / Presets</h3></div>' +
                _templates.map(function(t) {
                    return '<div class="card p-3 border-t-2 border-t-purple-400 cursor-pointer hover:shadow-md transition-all" onclick="Projects.renderCreateFromTemplate(\'' + t.id + '\')">' +
                        '<div class="flex items-center gap-2 mb-1"><span class="text-purple-600 text-sm">&#x1F4CB;</span>' +
                        '<h4 class="text-sm font-black text-slate-800">' + _escapeHtml(t.name) + '</h4></div>' +
                        '<p class="text-[11px] text-slate-400">' + (t.stages || []).length + ' stages pre-configured</p>' +
                        (isAdmin ? '<button onclick="event.stopPropagation();Projects._doDeleteTemplate(\'' + t.id + '\')" class="text-[10px] text-red-400 hover:text-red-600 mt-1">Delete</button>' : '') +
                        '</div>';
                }).join('');
        }

        document.getElementById('mainView').innerHTML = `
        <div>
            <!-- Summary Stats Row -->
            <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
                <div class="card p-3 text-center" style="border-top:3px solid #D97706;">
                    <p class="text-2xl font-black text-slate-800">${active.length}</p>
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active</p>
                </div>
                <div class="card p-3 text-center" style="border-top:3px solid #6E8E6D;">
                    <p class="text-2xl font-black text-slate-800">${completed.length}</p>
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Completed</p>
                </div>
                <div class="card p-3 text-center" style="border-top:3px solid #9CA3AF;">
                    <p class="text-2xl font-black text-slate-800">${archived.length}</p>
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Archived</p>
                </div>
                <div class="card p-3 text-center" style="border-top:3px solid ${totalOpenIssues > 0 ? '#DC2626' : '#6E8E6D'};">
                    <p class="text-2xl font-black" style="color:${totalOpenIssues > 0 ? '#DC2626' : '#16A34A'};">${totalOpenIssues}</p>
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Open Issues</p>
                </div>
                <div class="card p-3 text-center" style="border-top:3px solid ${yourTurnCount > 0 ? '#F59E0B' : '#9CA3AF'};">
                    <p class="text-2xl font-black" style="color:${yourTurnCount > 0 ? '#D97706' : '#94A3B8'};">${yourTurnCount}</p>
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Your Turn</p>
                </div>
            </div>

            <!-- Header + Filters -->
            <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
                <div>
                    <h2 class="text-2xl font-black text-slate-800">Projects</h2>
                    <p class="text-sm text-slate-400">${filtered.length} of ${all.length} projects</p>
                </div>
                <div class="flex flex-wrap gap-2 items-center">
                    <input type="text" id="prjSearch" value="${_escapeHtml(_filterState.search)}" placeholder="Search projects..."
                        oninput="Projects._onFilterChange('search', this.value)"
                        class="p-2 border border-slate-200 rounded-lg text-xs font-bold focus:ring-2 focus:ring-birds-green outline-none" style="width:160px;">
                    <select id="prjFilterStatus" onchange="Projects._onFilterChange('status', this.value)" class="p-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-birds-green outline-none">
                        <option value="all"${_filterState.status === 'all' ? ' selected' : ''}>All Status</option>
                        <option value="active"${_filterState.status === 'active' ? ' selected' : ''}>Active</option>
                        <option value="completed"${_filterState.status === 'completed' ? ' selected' : ''}>Completed</option>
                        <option value="archived"${_filterState.status === 'archived' ? ' selected' : ''}>Archived</option>
                    </select>
                    <select id="prjFilterDept" onchange="Projects._onFilterChange('dept', this.value)" class="p-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-birds-green outline-none">
                        <option value="all"${_filterState.dept === 'all' ? ' selected' : ''}>All Departments</option>
                        ${depts.map(function(d) { return '<option value="' + _escapeHtml(d) + '"' + (_filterState.dept === d ? ' selected' : '') + '>' + _escapeHtml(d) + '</option>'; }).join('')}
                    </select>
                    <select id="prjFilterHealth" onchange="Projects._onFilterChange('health', this.value)" class="p-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-birds-green outline-none">
                        <option value="all"${_filterState.health === 'all' ? ' selected' : ''}>All Health</option>
                        <option value="green"${_filterState.health === 'green' ? ' selected' : ''}>On Track</option>
                        <option value="amber"${_filterState.health === 'amber' ? ' selected' : ''}>At Risk</option>
                        <option value="red"${_filterState.health === 'red' ? ' selected' : ''}>Overdue</option>
                    </select>
                    <button onclick="Projects.renderCreateProject()" style="background:#6E8E6D;color:white;padding:8px 16px;border-radius:8px;font-weight:800;font-size:12px;border:none;cursor:pointer;">+ New Project</button>
                </div>
            </div>

            <!-- Project Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                ${activeHtml}
                ${completedHtml ? '<div class="col-span-full mt-4 mb-1"><h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Completed (' + filteredCompleted.length + ')</h3></div>' + completedHtml : ''}
                ${archivedHtml}
                ${tplHtml}
            </div>
        </div>`;
    }

    function _onFilterChange(key, value) {
        _filterState[key] = value;
        renderProjectsList();
        if (key === 'search') {
            var el = document.getElementById('prjSearch');
            if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        }
    }

    function _renderProjectCard(p) {
        var progress = getProgress(p);
        var rag = _getRag(p);
        var daysElapsed = _getDaysElapsed(p);
        var currentStage = getCurrentStage(p);
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var isYourTurn = currentStage && user && _isUserAssignedToStage(currentStage, user.id);
        var openIssues = 0;
        var totalNotes = 0;
        (p.stages || []).forEach(function(s) {
            (s.issues || []).forEach(function(i) { if (i.status === 'open') openIssues++; });
            totalNotes += (s.notes || []).length;
        });

        var statusLabel = p.status === 'active' ? 'Active' : p.status === 'completed' ? 'Completed' : 'Archived';
        var statusColor = p.status === 'active' ? '#D97706' : p.status === 'completed' ? '#16A34A' : '#9CA3AF';
        var statusBg = p.status === 'active' ? 'rgba(245,158,11,0.12)' : p.status === 'completed' ? 'rgba(22,163,74,0.08)' : 'rgba(156,163,175,0.08)';

        var ragHtml = '';
        if (rag) {
            var rc = _ragColor(rag);
            ragHtml = '<span style="font-size:8px;font-weight:800;padding:2px 6px;border-radius:9999px;color:' + rc.color + ';background:' + rc.bg + ';border:1px solid ' + rc.border + ';">' + rc.label + '</span>';
        }

        var issueHtml = openIssues ? '<span class="text-[10px] font-bold text-red-500 flex items-center gap-0.5"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#DC2626;"></span>' + openIssues + ' issue' + (openIssues > 1 ? 's' : '') + '</span>' : '';

        var daysLeft = '';
        if (p.status === 'active' && p.endDate) {
            var end = new Date(p.endDate + 'T23:59:59');
            var diff = Math.ceil((end - new Date()) / 86400000);
            daysLeft = diff < 0 ? '<span class="text-[9px] font-bold text-red-500">' + Math.abs(diff) + 'd overdue</span>' :
                diff === 0 ? '<span class="text-[9px] font-bold text-amber-500">Due today</span>' :
                '<span class="text-[9px] font-bold text-slate-400">' + diff + 'd left</span>';
        }

        var stageDots = '';
        if ((p.stages || []).length > 0 && (p.stages || []).length <= 10) {
            stageDots = '<div class="flex gap-1 mt-1">' + p.stages.map(function(s) {
                var c = s.status === 'completed' ? '#6E8E6D' : s.status === 'in_progress' ? '#D97706' : '#E8E5E0';
                return '<div style="width:8px;height:8px;border-radius:50%;background:' + c + ';" title="' + _escapeHtml(s.title) + '"></div>';
            }).join('') + '</div>';
        }

        var assignees = [];
        if (currentStage) {
            if (currentStage.assignType === 'department') {
                assignees = (currentStage.assignDepartments || []).slice(0, 2);
            } else if (currentStage.assignedTo && currentStage.assignedTo.length) {
                assignees = currentStage.assignedTo.slice(0, 2).map(function(uid) {
                    var u = (typeof Users !== 'undefined') ? Users.getById(uid) : null;
                    return u ? u.name.split(' ')[0] : '';
                }).filter(Boolean);
            }
        }

        return '<div class="card p-4 cursor-pointer hover:shadow-md transition-all ' + (isYourTurn ? 'ring-2 ring-amber-400' : '') + '" onclick="Projects.renderProjectDetail(\'' + p.id + '\')">' +
            (isYourTurn ? '<div class="text-[9px] font-black text-amber-600 uppercase tracking-wider mb-1">Your Turn</div>' : '') +
            '<div class="flex items-center justify-between mb-1">' +
            '<h3 class="text-sm font-black text-slate-800 truncate flex-1">' + _escapeHtml(p.name) + '</h3>' +
            '<span class="text-[9px] font-bold px-2 py-0.5 rounded-full ml-2" style="color:' + statusColor + ';background:' + statusBg + ';">' + statusLabel + '</span>' +
            '</div>' +
            '<p class="text-[11px] text-slate-400 mb-2 line-clamp-1">' + _escapeHtml(p.description || 'No description') + '</p>' +
            '<div style="height:5px;background:#E8E5E0;border-radius:3px;overflow:hidden;margin-bottom:6px;">' +
            '<div style="height:100%;width:' + progress + '%;background:linear-gradient(90deg,#6E8E6D,#5A7A59);border-radius:3px;transition:width 0.3s;"></div></div>' +
            stageDots +
            '<div class="flex items-center justify-between mt-2">' +
            '<div class="flex items-center gap-2">' +
            '<span class="text-[10px] font-bold text-slate-400">' + (p.stages || []).length + ' stages \u2022 ' + daysElapsed + 'd</span>' +
            (assignees.length ? '<span class="text-[9px] text-slate-400">\u2022 ' + assignees.join(', ') + '</span>' : '') +
            '</div>' +
            '<div class="flex items-center gap-2">' + ragHtml + issueHtml + daysLeft + '</div>' +
            '</div>' +
            '</div>';
    }

    function _ragColor(rag) {
        if (rag === 'red') return { bg: '#fef2f2', color: '#dc2626', border: '#fca5a5', label: 'Overdue' };
        if (rag === 'amber') return { bg: '#fef9ee', color: '#d97706', border: '#fcd34d', label: 'At Risk' };
        if (rag === 'green') return { bg: '#f0fdf4', color: '#16a34a', border: '#86efac', label: 'On Track' };
        return { bg: '#f8fafc', color: '#94a3b8', border: '#cbd5e1', label: 'Unknown' };
    }

    function _isUserAssignedToStage(stage, userId) {
        if (stage.assignType === 'department') {
            var user = (typeof Users !== 'undefined') ? Users.getById(userId) : null;
            if (!user) return false;
            if (stage.assignDepartments && stage.assignDepartments.length) return stage.assignDepartments.indexOf(user.department) !== -1;
            return false;
        }
        if (stage.assignType === 'custom') return false;
        return stage.assignedTo && stage.assignedTo.indexOf(userId) !== -1;
    }

    /* ═══════════════════════════════════════════════════════════════
       UI: CREATE PROJECT
       ═══════════════════════════════════════════════════════════════ */
    function renderCreateProject() {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var deptOptions = (typeof Users !== 'undefined') ? Users.getDeptOptionsHtml(user ? user.department : 'General', false) : '<option>General</option>';

        var tplOptions = _templates.map(function(t) {
            return '<option value="' + t.id + '">' + _escapeHtml(t.name) + ' (' + (t.stages || []).length + ' stages)</option>';
        }).join('');

        document.getElementById('mainView').innerHTML = `
        <div style="max-width:600px;margin:0 auto;">
            <div class="card p-6 border-t-4 border-t-birds-green rounded-none">
                <div class="flex items-center justify-between mb-5">
                    <div><h2 class="text-2xl font-black birds-green">New Project</h2></div>
                    <button onclick="setView('projects')" class="text-sm font-bold text-slate-500 hover:text-slate-700">\u2190 Back</button>
                </div>
                <div class="space-y-4">
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Project Name *</label>
                        <input type="text" id="prj-name" class="w-full p-3 border border-slate-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-birds-green outline-none" placeholder="e.g. New Product Integration">
                    </div>
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Description</label>
                        <textarea id="prj-desc" class="w-full p-3 border border-slate-200 rounded-lg text-sm resize-y h-20 focus:ring-2 focus:ring-birds-green outline-none" placeholder="What is this project about?"></textarea>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Department</label>
                            <select id="prj-dept" class="w-full p-3 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-birds-green outline-none">${deptOptions}</select></div>
                        <div></div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Start Date</label>
                            <input type="date" id="prj-start" class="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-birds-green outline-none"></div>
                        <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Target End Date</label>
                            <input type="date" id="prj-end" class="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-birds-green outline-none"></div>
                    </div>
                    ${tplOptions ? '<div class="pt-3 border-t border-slate-100"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Start from Template (optional)</label><select id="prj-template" class="w-full p-3 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-birds-green outline-none"><option value="">Blank project</option>' + tplOptions + '</select></div>' : ''}
                </div>
                <div class="mt-5 pt-4 border-t border-slate-100">
                    <button onclick="Projects._doCreate()" style="background:#6E8E6D;color:white;padding:10px 24px;border-radius:8px;font-weight:800;font-size:13px;border:none;cursor:pointer;">Create Project</button>
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
        var tplEl = document.getElementById('prj-template');
        if (!name || !name.value.trim()) { showToast('Enter a project name', 'error'); return; }
        var tplId = tplEl ? tplEl.value : '';
        if (tplId) {
            var p = await createFromTemplate(tplId, name.value, startDate ? startDate.value : '', endDate ? endDate.value : '');
            if (p) { showToast('Project created from template', 'success'); renderProjectDetail(p.id); return; }
        }
        var p = await create(name.value, desc ? desc.value : '', dept ? dept.value : 'General', startDate ? startDate.value : '', endDate ? endDate.value : '');
        showToast('Project created', 'success');
        renderProjectDetail(p.id);
    }

    function renderCreateFromTemplate(tplId) {
        var tpl = _templates.find(function(t) { return t.id === tplId; });
        if (!tpl) return;
        document.getElementById('mainView').innerHTML = `
        <div style="max-width:600px;margin:0 auto;">
            <div class="card p-6 border-t-4 border-t-purple-500 rounded-none">
                <div class="flex items-center justify-between mb-5">
                    <div><h2 class="text-xl font-black text-purple-700">Create from Template</h2><p class="text-sm text-slate-400 mt-1">Using: ${_escapeHtml(tpl.name)}</p></div>
                    <button onclick="setView('projects')" class="text-sm font-bold text-slate-500 hover:text-slate-700">\u2190 Back</button>
                </div>
                <div class="space-y-4">
                    <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Project Name *</label>
                        <input type="text" id="prj-name" class="w-full p-3 border border-slate-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-birds-green outline-none" value="${_escapeHtml(tpl.name)}"></div>
                    <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Description</label>
                        <textarea id="prj-desc" class="w-full p-3 border border-slate-200 rounded-lg text-sm resize-y h-16 focus:ring-2 focus:ring-birds-green outline-none">${_escapeHtml(tpl.description || '')}</textarea></div>
                    <div class="grid grid-cols-2 gap-4">
                        <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Start Date</label>
                            <input type="date" id="prj-start" class="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-birds-green outline-none"></div>
                        <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Target End Date</label>
                            <input type="date" id="prj-end" class="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-birds-green outline-none"></div>
                    </div>
                    <div class="p-3 bg-slate-50 rounded-lg"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Pre-configured Stages</p>
                    ${(tpl.stages || []).map(function(s, i) { return '<div class="text-xs text-slate-600 py-1">' + (i + 1) + '. ' + _escapeHtml(s.title) + '</div>'; }).join('')}</div>
                </div>
                <div class="mt-4 pt-4 border-t border-slate-100">
                    <button onclick="Projects._doCreate()" style="background:#7C3AED;color:white;padding:10px 24px;border-radius:8px;font-weight:800;font-size:13px;border:none;cursor:pointer;">Create from Template</button>
                </div>
            </div>
        </div>`;
    }

    /* ═══════════════════════════════════════════════════════════════
       UI: PROJECT DETAIL — DASHBOARD + STAGES + TIMELINE
       ═══════════════════════════════════════════════════════════════ */
    async function renderProjectDetail(projectId) {
        var p = getById(projectId);
        if (!p) { showToast('Project not found', 'error'); setView('projects'); return; }
        var progress = getProgress(p);
        var rag = _getRag(p);
        var daysElapsed = _getDaysElapsed(p);
        var currentIdx = p.currentStageIndex || 0;
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        var isAdmin = user && user.role === 'admin';

        var totalIssues = 0, openIssues = 0, totalNotes = 0, totalAtts = 0;
        (p.stages || []).forEach(function(s) {
            (s.issues || []).forEach(function(i) { totalIssues++; if (i.status === 'open') openIssues++; });
            totalNotes += (s.notes || []).length;
            totalAtts += (s.attachments || []).length;
        });

        var daysLeft = '';
        if (p.endDate) {
            var end = new Date(p.endDate + 'T23:59:59');
            var diff = Math.ceil((end - new Date()) / 86400000);
            daysLeft = diff < 0 ? '<span class="text-red-500">' + Math.abs(diff) + ' days overdue</span>' :
                diff === 0 ? '<span class="text-amber-500">Due today</span>' :
                diff + ' days remaining';
        }

        /* ── Side Timeline ── */
        var timelineHtml = '';
        var tlEntries = (p.timeline || []).slice().reverse().slice(0, 30);
        timelineHtml = tlEntries.map(function(tl) {
            var iconMap = { created: '&#x1F4DD;', stage_completed: '&#x2705;', stage_started: '&#x25B6;', issue_opened: '&#x26A0;', issue_resolved: '&#x2714;', status_change: '&#x1F4CB;', note_added: '&#x1F4AC;' };
            var icon = iconMap[tl.type] || '&#x1F4AC;';
            var ts = new Date(tl.timestamp);
            var timeStr = ts.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            return '<div class="flex gap-2 mb-3">' +
                '<div class="flex flex-col items-center"><span class="text-sm">' + icon + '</span><div style="width:1px;flex:1;background:#E8E5E0;"></div></div>' +
                '<div class="flex-1 min-w-0 pb-1"><p class="text-[11px] text-slate-600 leading-tight">' + _escapeHtml(tl.summary) + '</p>' +
                '<p class="text-[9px] text-slate-400 mt-0.5">' + _escapeHtml(tl.byName) + ' \u2022 ' + timeStr + '</p></div></div>';
        }).join('');

        /* ── Stages ── */
        var stagesHtml = (p.stages || []).map(function(s, idx) {
            var isCurrent = idx === currentIdx && p.status === 'active';
            var isPast = s.status === 'completed';
            var isYourTurn = isCurrent && user && _isUserAssignedToStage(s, user.id);
            var borderLeft = isPast ? '#6E8E6D' : isCurrent ? '#D97706' : '#E8E5E0';
            var bgTint = isYourTurn ? 'rgba(255,243,205,0.3)' : isPast ? 'rgba(135,157,130,0.03)' : 'transparent';
            var statusBadge = isPast ? '<span class="text-[9px] font-black px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">DONE</span>' :
                isYourTurn ? '<span class="text-[9px] font-black px-2 py-0.5 rounded bg-amber-100 text-amber-700">YOUR TURN</span>' :
                isCurrent ? '<span class="text-[9px] font-black px-2 py-0.5 rounded bg-blue-100 text-blue-700">IN PROGRESS</span>' :
                '<span class="text-[9px] font-black px-2 py-0.5 rounded bg-slate-100 text-slate-500">PENDING</span>';

            var assigneeStr = '';
            if (s.assignType === 'department') {
                assigneeStr = (s.assignDepartments || []).join(', ');
            } else if (s.assignType === 'custom') {
                assigneeStr = s.assignCustom || 'External';
            } else {
                assigneeStr = (s.assignedTo || []).map(function(uid) { var u = (typeof Users !== 'undefined') ? Users.getById(uid) : null; return u ? u.name : ''; }).filter(Boolean).join(', ') || 'Unassigned';
            }

            var stageIssues = (s.issues || []);
            var stageOpenIssues = stageIssues.filter(function(i) { return i.status === 'open'; });
            var stageClosedIssues = stageIssues.filter(function(i) { return i.status === 'resolved'; });
            var issuesHtml = '';
            if (stageIssues.length) {
                issuesHtml = '<div class="mt-3 pt-2 border-t border-slate-100"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Issues (' + stageOpenIssues.length + ' open, ' + stageClosedIssues.length + ' resolved)</p>';
                stageIssues.forEach(function(iss) {
                    var isResolved = iss.status === 'resolved';
                    var sevColor = iss.severity === 'high' ? 'text-red-600 bg-red-50' : iss.severity === 'medium' ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-50';
                    issuesHtml += '<div class="p-2 mb-1 rounded-lg ' + (isResolved ? 'bg-slate-50 opacity-60' : 'bg-red-50/50 border border-red-100') + '">' +
                        '<div class="flex items-center justify-between">' +
                        '<span class="text-xs font-bold ' + (isResolved ? 'text-slate-400 line-through' : 'text-slate-700') + '">' + _escapeHtml(iss.title) + '</span>' +
                        '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded ' + sevColor + '">' + iss.severity + '</span></div>' +
                        (!isResolved ? '<button onclick="Projects._doResolveIssue(\'' + p.id + '\',\'' + s.id + '\',\'' + iss.id + '\')" class="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 mt-1">Resolve</button>' : '<span class="text-[9px] text-slate-400">Resolved ' + new Date(iss.resolvedAt).toLocaleDateString('en-GB') + '</span>') +
                        '</div>';
                });
                issuesHtml += '</div>';
            }

            var attHtml = '';
            var atts = s.attachments || [];
            if (atts.length) {
                attHtml = '<div class="mt-2 pt-2 border-t border-slate-100"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Files</p>' +
                    atts.map(function(a) {
                        var isImage = a.type && a.type.indexOf('image') !== -1;
                        return '<div class="flex items-center gap-2 py-1">' +
                            (isImage && a.data ? '<img src="' + a.data + '" class="w-8 h-8 rounded object-cover cursor-pointer" onclick="window.open(\'' + a.data + '\',\'_blank\')">' : '<span class="text-sm">&#x1F4C4;</span>') +
                            '<span class="text-xs text-slate-600 truncate flex-1">' + _escapeHtml(a.name) + '</span>' +
                            '<span class="text-[9px] text-slate-400">' + (a.size ? Math.round(a.size / 1024) + 'KB' : '') + '</span>' +
                            '<button onclick="Projects._doRemoveAtt(\'' + p.id + '\',\'' + s.id + '\',\'' + a.id + '\')" class="text-[9px] text-red-400 hover:text-red-600">x</button>' +
                            '</div>';
                    }).join('') + '</div>';
            }

            var notesHtml = (s.notes || []).slice().reverse().map(function(n) {
                var nts = new Date(n.createdAt);
                var nTime = nts.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + nts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                var typeColor = n.type === 'milestone' ? 'text-emerald-600' : n.type === 'issue' ? 'text-red-500' : 'text-slate-500';
                var typeIcon = n.type === 'milestone' ? '&#x2B50; ' : n.type === 'issue' ? '&#x26A0; ' : '';
                return '<div class="py-2 border-b border-slate-50">' +
                    '<p class="text-xs text-slate-600 whitespace-pre-wrap">' + typeIcon + _escapeHtml(n.text) + '</p>' +
                    '<p class="text-[9px] ' + typeColor + ' mt-0.5">' + _escapeHtml(n.authorName) + ' \u2022 ' + nTime + '</p></div>';
            }).join('');

            var actionsHtml = '';
            if (p.status === 'active') {
                actionsHtml = '<div class="flex gap-2 flex-wrap mt-3">';
                if (isCurrent && !isPast) {
                    if (!s.startedAt && s.status === 'pending') {
                        actionsHtml += '<button onclick="Projects._doStartStage(\'' + p.id + '\',\'' + s.id + '\')" style="background:#2563EB;color:white;padding:5px 12px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">Start Stage</button>';
                    }
                    if (s.status !== 'completed') {
                        actionsHtml += '<button onclick="Projects._doCompleteStage(\'' + p.id + '\',\'' + s.id + '\')" style="background:#6E8E6D;color:white;padding:5px 12px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">\u2714 Complete</button>';
                    }
                }
                actionsHtml += '<button onclick="Projects._showAddNote(\'' + p.id + '\',\'' + s.id + '\')" style="background:transparent;color:#555;padding:5px 12px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #ddd;cursor:pointer;">+ Note</button>';
                actionsHtml += '<button onclick="Projects._showAddIssue(\'' + p.id + '\',\'' + s.id + '\')" style="background:transparent;color:#D94F4F;padding:5px 12px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #D94F4F;cursor:pointer;">+ Issue</button>';
                actionsHtml += '<label style="background:transparent;color:#2563EB;padding:5px 12px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #2563EB;cursor:pointer;display:inline-block;">+ File<input type="file" class="hidden" onchange="Projects._doAddFile(\'' + p.id + '\',\'' + s.id + '\',this.files[0])"></label>';
                if (isAdmin || (idx === p.stages.length - 1 && isPast)) {
                    actionsHtml += '<button onclick="Projects._doRemoveStage(\'' + p.id + '\',\'' + s.id + '\')" style="background:transparent;color:#999;padding:5px 8px;border-radius:6px;font-weight:700;font-size:11px;border:none;cursor:pointer;" title="Remove stage">&#x2715;</button>';
                }
                actionsHtml += '</div>';
            }

            var issueFormHtml = '<div id="issueForm-' + s.id + '"></div>';
            var noteFormHtml = '<div id="noteForm-' + s.id + '"></div>';

            return '<div class="rounded-lg p-4 mb-3" style="border-left:4px solid ' + borderLeft + ';background:' + bgTint + ';">' +
                '<div class="flex items-start justify-between gap-3">' +
                '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-2 mb-1">' +
                '<span class="text-[10px] font-black text-slate-300">#' + (idx + 1) + '</span>' +
                '<h4 class="text-sm font-black text-slate-800">' + _escapeHtml(s.title) + '</h4>' +
                statusBadge +
                '</div>' +
                '<p class="text-xs text-slate-500">' + _escapeHtml(s.description || 'No description') + '</p>' +
                '<p class="text-[11px] text-slate-400 mt-1">' + _escapeHtml(assigneeStr) + (s.dueDate ? ' \u2022 Due: ' + _escapeHtml(s.dueDate) : '') + '</p>' +
                (s.startedAt ? '<p class="text-[9px] text-slate-400">Started: ' + new Date(s.startedAt).toLocaleDateString('en-GB') + '</p>' : '') +
                (s.completedAt ? '<p class="text-[9px] text-emerald-600">Completed by ' + _escapeHtml(s.completedByName || '?') + ' on ' + new Date(s.completedAt).toLocaleDateString('en-GB') + '</p>' : '') +
                attHtml +
                issuesHtml +
                (notesHtml ? '<div class="mt-2 pt-2 border-t border-slate-100"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Log</p>' + notesHtml + '</div>' : '') +
                noteFormHtml +
                issueFormHtml +
                '</div></div>' +
                actionsHtml +
                '</div>';
        }).join('');

        var stagesEmpty = !(p.stages || []).length ? '<div class="text-center py-8 text-slate-400"><p class="text-sm font-bold">No stages yet</p><p class="text-xs">Add your first stage below.</p></div>' : '';

        document.getElementById('mainView').innerHTML = `
        <div>
            <div class="mb-4"><button onclick="setView('projects')" class="text-sm font-bold text-slate-500 hover:text-slate-700">\u2190 Back to Projects</button></div>

            <!-- Header Card -->
            <div class="card p-5 border-t-4 rounded-none mb-4" style="border-top-color:${p.status === 'active' ? '#D97706' : '#6E8E6D'};">
                <div class="flex items-start justify-between">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <h2 class="text-xl font-black text-slate-800">${_escapeHtml(p.name)}</h2>
                            ${rag ? (function(){ var rc = _ragColor(rag); return '<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:9999px;color:' + rc.color + ';background:' + rc.bg + ';border:1px solid ' + rc.border + ';">' + rc.label + '</span>'; })() : ''}
                            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full" style="color:${p.status === 'active' ? '#D97706' : '#6E8E6D'};background:${p.status === 'active' ? 'rgba(245,158,11,0.12)' : 'rgba(22,163,74,0.08)'};">${p.status === 'active' ? 'ACTIVE' : p.status === 'completed' ? 'COMPLETED' : 'ARCHIVED'}</span>
                        </div>
                        <p class="text-xs text-slate-400">${_escapeHtml(p.description || '')}</p>
                        <p class="text-[10px] text-slate-400 mt-1">Created by ${_escapeHtml(p.createdByName || 'Unknown')} \u2022 ${_escapeHtml(p.department)}</p>
                    </div>
                    <div class="flex gap-2 flex-shrink-0 ml-4">
                        <button onclick="Projects._doSaveAsTemplate('${p.id}')" style="background:transparent;color:#7C3AED;padding:6px 12px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #7C3AED;cursor:pointer;" title="Save as template">Save as Template</button>
                        ${p.status === 'active' ? '<button onclick="Projects._doArchiveProject(\'' + p.id + '\')" style="background:transparent;color:#999;padding:6px 12px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #ddd;cursor:pointer;">Archive</button>' : ''}
                        ${p.status === 'archived' ? '<button onclick="Projects._doReopenProject(\'' + p.id + '\')" style="background:transparent;color:#2563EB;padding:6px 12px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #2563EB;cursor:pointer;">Reopen</button>' : ''}
                        <button onclick="if(confirm('Delete?'))Projects._doDeleteProject('${p.id}')" style="background:transparent;color:#D94F4F;padding:6px 12px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #D94F4F;cursor:pointer;">Delete</button>
                    </div>
                </div>

                <!-- Metrics Row -->
                <div class="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4 pt-3 border-t border-slate-100">
                    <div>
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Progress</p>
                        <p class="text-lg font-black text-slate-800">${progress}%</p>
                        <div style="height:3px;background:#E8E5E0;border-radius:2px;overflow:hidden;margin-top:2px;"><div style="height:100%;width:${progress}%;background:linear-gradient(90deg,#6E8E6D,#5A7A59);border-radius:2px;"></div></div>
                    </div>
                    <div>
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Stages</p>
                        <p class="text-lg font-black text-slate-800">${(p.stages || []).filter(function(s){return s.status==='completed'}).length}/${(p.stages || []).length}</p>
                    </div>
                    <div>
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Elapsed</p>
                        <p class="text-lg font-black text-slate-800">${daysElapsed}d</p>
                    </div>
                    <div>
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">${p.endDate ? 'Deadline' : 'No Deadline'}</p>
                        <p class="text-xs font-bold text-slate-600">${daysLeft || '\u2014'}</p>
                    </div>
                    <div>
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Issues</p>
                        <p class="text-lg font-black" style="color:${openIssues > 0 ? '#DC2626' : '#6E8E6D'};">${openIssues}</p>
                        <p class="text-[9px] text-slate-400">${totalIssues} total</p>
                    </div>
                    <div>
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Activity</p>
                        <p class="text-lg font-black text-slate-800">${totalNotes + totalAtts + (p.timeline || []).length}</p>
                        <p class="text-[9px] text-slate-400">${totalNotes} notes \u2022 ${totalAtts} files</p>
                    </div>
                </div>
            </div>

            <!-- Two-column: Stages + Timeline -->
            <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div class="lg:col-span-3">
                    <div class="flex items-center justify-between mb-3">
                        <h3 class="text-xs font-black text-slate-400 uppercase tracking-widest">Stages</h3>
                        ${p.status === 'active' ? '<button onclick="Projects._showAddStage(\'' + p.id + '\')" style="background:rgba(110,142,109,0.1);color:#6E8E6D;padding:4px 12px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">+ Add Stage</button>' : ''}
                    </div>
                    <div id="addStageForm-${p.id}"></div>
                    ${stagesHtml}
                    ${stagesEmpty}
                </div>
                <div class="lg:col-span-1">
                    <div class="card p-4 rounded-none sticky top-4" style="max-height:calc(100vh - 200px);overflow-y:auto;">
                        <h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Activity Timeline</h3>
                        ${timelineHtml || '<p class="text-[11px] text-slate-400">No activity yet</p>'}
                    </div>
                </div>
            </div>
        </div>`;
    }

    /* ─── UI Action Handlers ──────────────────────────────────── */
    async function _doStartStage(projectId, stageId) {
        await startStage(projectId, stageId);
        showToast('Stage started', 'success');
        renderProjectDetail(projectId);
    }

    async function _doCompleteStage(projectId, stageId) {
        var note = prompt('Stage summary (optional):');
        if (note === null) note = '';
        await completeStage(projectId, stageId, note);
        showToast('Stage completed', 'success');
        renderProjectDetail(projectId);
    }

    async function _doRemoveStage(projectId, stageId) {
        if (!confirm('Remove this stage?')) return;
        await removeStage(projectId, stageId);
        showToast('Stage removed', 'success');
        renderProjectDetail(projectId);
    }

    function _showAddStage(projectId) {
        var users = (typeof Users !== 'undefined') ? Users.getAll() : [];
        var userChecks = users.map(function(u) {
            return '<label class="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-50 cursor-pointer">' +
                '<input type="checkbox" value="' + u.id + '" class="stage-assign-cb accent-[#6E8E6D]">' +
                '<span class="text-xs">' + _escapeHtml(u.name) + ' <span class="text-[9px] text-slate-400">(' + _escapeHtml(u.department) + ')</span></span></label>';
        }).join('');

        document.getElementById('addStageForm-' + projectId).innerHTML = `
        <div class="card p-4 mb-3 rounded-none" style="border:2px dashed #6E8E6D;">
            <h4 class="text-sm font-black birds-green mb-3">Add Stage</h4>
            <div class="space-y-3">
                <input type="text" id="newStageTitle" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-birds-green outline-none" placeholder="Stage title *">
                <textarea id="newStageDesc" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm resize-y h-14 focus:ring-2 focus:ring-birds-green outline-none" placeholder="Description / instructions"></textarea>
                <input type="date" id="newStageDue" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-birds-green outline-none">
                <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Assign</label>
                    <div class="max-h-32 overflow-y-auto border border-slate-200 rounded-lg">${userChecks}</div></div>
            </div>
            <div class="flex gap-2 mt-3">
                <button onclick="Projects._doAddStage('${projectId}')" style="background:#6E8E6D;color:white;padding:6px 14px;border-radius:6px;font-weight:800;font-size:11px;border:none;cursor:pointer;">Add</button>
                <button onclick="document.getElementById('addStageForm-${projectId}').innerHTML=''" style="background:transparent;color:#999;padding:6px 14px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #E8E5E0;cursor:pointer;">Cancel</button>
            </div>
        </div>`;
        document.getElementById('newStageTitle').focus();
    }

    async function _doAddStage(projectId) {
        var title = document.getElementById('newStageTitle');
        var desc = document.getElementById('newStageDesc');
        var due = document.getElementById('newStageDue');
        if (!title || !title.value.trim()) { showToast('Enter a stage title', 'error'); return; }
        var assignedTo = [];
        document.querySelectorAll('.stage-assign-cb:checked').forEach(function(cb) { assignedTo.push(cb.value); });
        await addStage(projectId, title.value, desc ? desc.value : '', 'persons', [], '', assignedTo, due ? due.value : '');
        showToast('Stage added', 'success');
        renderProjectDetail(projectId);
    }

    function _showAddNote(projectId, stageId) {
        var el = document.getElementById('noteForm-' + stageId);
        if (!el) return;
        el.innerHTML = '<div class="mt-2 p-2 bg-slate-50 rounded-lg">' +
            '<textarea id="noteText-' + stageId + '" class="w-full p-2 border border-slate-200 rounded text-xs h-14 resize-y focus:ring-2 focus:ring-birds-green outline-none" placeholder="Add a note..."></textarea>' +
            '<div class="flex gap-2 mt-1"><button onclick="Projects._doAddNote(\'' + projectId + '\',\'' + stageId + '\')" class="text-[10px] font-bold px-3 py-1 rounded bg-birds-green text-white">Save</button>' +
            '<button onclick="document.getElementById(\'noteForm-' + stageId + '\').innerHTML=\'\'" class="text-[10px] font-bold px-3 py-1 rounded bg-slate-100 text-slate-500">Cancel</button></div></div>';
        document.getElementById('noteText-' + stageId).focus();
    }

    async function _doAddNote(projectId, stageId) {
        var el = document.getElementById('noteText-' + stageId);
        if (!el || !el.value.trim()) return;
        await addNote(projectId, stageId, el.value.trim());
        showToast('Note added', 'success');
        renderProjectDetail(projectId);
    }

    function _showAddIssue(projectId, stageId) {
        var el = document.getElementById('issueForm-' + stageId);
        if (!el) return;
        el.innerHTML = '<div class="mt-2 p-2 bg-red-50 rounded-lg border border-red-100">' +
            '<input type="text" id="issueTitle-' + stageId + '" class="w-full p-2 border border-red-200 rounded text-xs mb-1 focus:ring-2 focus:ring-red-300 outline-none" placeholder="Issue title *">' +
            '<textarea id="issueDesc-' + stageId + '" class="w-full p-2 border border-red-200 rounded text-xs h-10 resize-y focus:ring-2 focus:ring-red-300 outline-none" placeholder="Details"></textarea>' +
            '<div class="flex gap-2 mt-1"><select id="issueSev-' + stageId + '" class="text-[10px] px-2 py-1 border border-red-200 rounded"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select>' +
            '<button onclick="Projects._doAddIssue(\'' + projectId + '\',\'' + stageId + '\')" class="text-[10px] font-bold px-3 py-1 rounded bg-red-500 text-white">Log Issue</button>' +
            '<button onclick="document.getElementById(\'issueForm-' + stageId + '\').innerHTML=\'\'" class="text-[10px] font-bold px-3 py-1 rounded bg-slate-100 text-slate-500">Cancel</button></div></div>';
        document.getElementById('issueTitle-' + stageId).focus();
    }

    async function _doAddIssue(projectId, stageId) {
        var titleEl = document.getElementById('issueTitle-' + stageId);
        var descEl = document.getElementById('issueDesc-' + stageId);
        var sevEl = document.getElementById('issueSev-' + stageId);
        if (!titleEl || !titleEl.value.trim()) { showToast('Enter an issue title', 'error'); return; }
        await openIssue(projectId, stageId, titleEl.value, descEl ? descEl.value : '', sevEl ? sevEl.value : 'medium');
        showToast('Issue logged', 'success');
        renderProjectDetail(projectId);
    }

    async function _doResolveIssue(projectId, stageId, issueId) {
        var note = prompt('Resolution notes (optional):');
        if (note === null) return;
        await resolveIssue(projectId, stageId, issueId, note);
        showToast('Issue resolved', 'success');
        renderProjectDetail(projectId);
    }

    async function _doAddFile(projectId, stageId, file) {
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { showToast('File too large (max 5MB)', 'error'); return; }
        await addAttachment(projectId, stageId, file);
        showToast('File attached', 'success');
        renderProjectDetail(projectId);
    }

    async function _doRemoveAtt(projectId, stageId, attId) {
        if (!confirm('Remove this file?')) return;
        await removeAttachment(projectId, stageId, attId);
        renderProjectDetail(projectId);
    }

    async function _doSaveAsTemplate(projectId) {
        var name = prompt('Template name:', getById(projectId).name + ' (Template)');
        if (!name) return;
        var tpl = await saveAsTemplate(projectId, name);
        if (tpl) { showToast('Template saved', 'success'); loadTemplates(); }
    }

    async function _doDeleteTemplate(tplId) {
        if (!confirm('Delete this template?')) return;
        await deleteTemplate(tplId);
        showToast('Template deleted', 'success');
        renderProjectsList();
    }

    async function _doArchiveProject(projectId) {
        if (!confirm('Archive this project?')) return;
        await archiveProject(projectId);
        showToast('Project archived', 'success');
        renderProjectDetail(projectId);
    }

    async function _doReopenProject(projectId) {
        await reopenProject(projectId);
        showToast('Project reopened', 'success');
        renderProjectDetail(projectId);
    }

    async function _doDeleteProject(projectId) {
        await deleteProject(projectId);
        showToast('Project deleted', 'success');
        setView('projects');
    }

    /* ─── My Work ────────────────────────────────────────────── */
    async function renderMyWork() {
        var user = (typeof Users !== 'undefined') ? Users.getCurrentUser() : null;
        if (!user) return;

        var myProjects = getActive().filter(function(p) {
            return p.createdBy === user.id || (p.stages || []).some(function(s) { return _isUserAssignedToStage(s, user.id); });
        });

        var yourTurnProjects = [];
        var assignedProjects = [];
        myProjects.forEach(function(p) {
            var hasYourTurn = (p.stages || []).some(function(s) {
                var isCurrent = (p.stages || []).indexOf(s) === p.currentStageIndex && p.status === 'active';
                return isCurrent && s.status !== 'completed' && _isUserAssignedToStage(s, user.id);
            });
            if (hasYourTurn) yourTurnProjects.push(p); else assignedProjects.push(p);
        });

        var totalOpenIssues = 0;
        yourTurnProjects.concat(assignedProjects).forEach(function(p) {
            (p.stages || []).forEach(function(s) {
                (s.issues || []).forEach(function(i) { if (i.status === 'open') totalOpenIssues++; });
            });
        });

        var yourTurnHtml = yourTurnProjects.length ? yourTurnProjects.map(function(p) { return _renderProjectCard(p); }).join('') :
            '<div class="text-center py-4 text-slate-400 col-span-full"><p class="text-sm font-bold">Nothing needs your attention</p></div>';

        var assignedHtml = assignedProjects.length ? assignedProjects.map(function(p) { return _renderProjectCard(p); }).join('') : '';

        var allDocs = { open: [], resolved: [], archived: [] };
        try { allDocs = await loadDocuments(); } catch(e) {}
        var allDocList = [].concat(allDocs.open || [], allDocs.resolved || [], allDocs.archived || []);
        var myDocs = allDocList.filter(function(d) {
            return d.creatorId === user.id || d.creator === user.name || d.attentionOf === user.name;
        }).slice(0, 10);

        var docHtml = myDocs.length ? myDocs.map(function(d) {
            var isRecent = false;
            try { var created = new Date(d.createdAt || d.date); isRecent = (Date.now() - created.getTime()) < 7 * 86400000; } catch(e) {}
            return '<div class="py-2 border-b border-slate-50 flex items-center justify-between">' +
                '<div><p class="text-xs font-bold text-slate-700">' + _escapeHtml(d.docRef || d.docType || 'Document') + '</p>' +
                '<p class="text-[10px] text-slate-400">' + _escapeHtml(d.createdAt || d.date || '') + '</p></div>' +
                (isRecent ? '<span class="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">NEW</span>' : '') +
                '</div>';
        }).join('') : '<p class="text-sm text-slate-400">No recent documents.</p>';

        document.getElementById('mainView').innerHTML = `
        <div>
            <h2 class="text-2xl font-black text-slate-800 mb-4">My Work</h2>

            <!-- Summary Stats -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <div class="card p-3 text-center" style="border-top:3px solid ${yourTurnProjects.length > 0 ? '#F59E0B' : '#9CA3AF'};">
                    <p class="text-2xl font-black" style="color:${yourTurnProjects.length > 0 ? '#D97706' : '#94A3B8'};">${yourTurnProjects.length}</p>
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Your Turn</p>
                </div>
                <div class="card p-3 text-center" style="border-top:3px solid #2563EB;">
                    <p class="text-2xl font-black text-slate-800">${myProjects.length}</p>
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">My Projects</p>
                </div>
                <div class="card p-3 text-center" style="border-top:3px solid ${totalOpenIssues > 0 ? '#DC2626' : '#6E8E6D'};">
                    <p class="text-2xl font-black" style="color:${totalOpenIssues > 0 ? '#DC2626' : '#16A34A'};">${totalOpenIssues}</p>
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Open Issues</p>
                </div>
                <div class="card p-3 text-center" style="border-top:3px solid #6E8E6D;">
                    <p class="text-2xl font-black text-slate-800">${myDocs.length}</p>
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">My Documents</p>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <!-- Projects Column -->
                <div>
                    ${yourTurnProjects.length ? '<div class="mb-4"><h3 class="text-xs font-black text-amber-500 uppercase tracking-widest mb-2">Your Turn (' + yourTurnProjects.length + ')</h3><div class="grid grid-cols-1 gap-3">' + yourTurnHtml + '</div></div>' : ''}
                    ${assignedProjects.length ? '<div class="mb-4"><h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Assigned to You (' + assignedProjects.length + ')</h3><div class="grid grid-cols-1 gap-3">' + assignedHtml + '</div></div>' : ''}
                    ${!myProjects.length ? '<div class="text-center py-8 text-slate-400"><p class="text-sm font-bold">No active projects assigned to you.</p></div>' : ''}
                </div>

                <!-- Documents Column -->
                <div>
                    <h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Recent Documents</h3>
                    <div class="card p-4">${docHtml}</div>
                </div>
            </div>
        </div>`;
    }

    /* ─── Expose public API ──────────────────────────────────── */
    return {
        load: load,
        loadTemplates: loadTemplates,
        getAll: getAll,
        getById: getById,
        getActive: getActive,
        getCompleted: getCompleted,
        getArchived: getArchived,
        getTemplates: getTemplates,
        getProgress: getProgress,
        getCurrentStage: getCurrentStage,
        create: create,
        addStage: addStage,
        startStage: startStage,
        completeStage: completeStage,
        updateStage: updateStage,
        removeStage: removeStage,
        addNote: addNote,
        openIssue: openIssue,
        resolveIssue: resolveIssue,
        addIssueNote: addIssueNote,
        addAttachment: addAttachment,
        removeAttachment: removeAttachment,
        archiveProject: archiveProject,
        reopenProject: reopenProject,
        deleteProject: deleteProject,
        setHealth: setHealth,
        saveAsTemplate: saveAsTemplate,
        createFromTemplate: createFromTemplate,
        deleteTemplate: deleteTemplate,
        renderProjectsList: renderProjectsList,
        renderCreateProject: renderCreateProject,
        renderCreateFromTemplate: renderCreateFromTemplate,
        renderProjectDetail: renderProjectDetail,
        renderMyWork: renderMyWork,
        _onFilterChange: _onFilterChange,
        _doCreate: _doCreate,
        _doAddStage: _doAddStage,
        _doStartStage: _doStartStage,
        _doCompleteStage: _doCompleteStage,
        _doRemoveStage: _doRemoveStage,
        _doAddNote: _doAddNote,
        _doAddIssue: _doAddIssue,
        _doResolveIssue: _doResolveIssue,
        _doAddFile: _doAddFile,
        _doRemoveAtt: _doRemoveAtt,
        _doSaveAsTemplate: _doSaveAsTemplate,
        _doDeleteTemplate: _doDeleteTemplate,
        _doArchiveProject: _doArchiveProject,
        _doReopenProject: _doReopenProject,
        _doDeleteProject: _doDeleteProject,
        _showAddStage: _showAddStage,
        _showAddNote: _showAddNote,
        _showAddIssue: _showAddIssue
    };
})();
