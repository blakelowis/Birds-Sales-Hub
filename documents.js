window.currentLoadedDocs = { open: [], resolved: [], archived: [] };
window.unlockedDocs = new Set();

const _docDepartments = [
    'Head of Retail', 'Food Safety', 'Health & Safety',
    'Training & Development', 'Area Team', 'Auditor',
    'ALL Team', 'General'
];

/* ─── Load ──────────────────────────────────────────────────── */
async function loadDocuments() {
    const result = { open: [], resolved: [], archived: [] };
    try {
        const root = await directoryHandle.getDirectoryHandle("Documents");
        for (const fName of ["Open", "Resolved", "Archive"]) {
            try {
                const folder = await root.getDirectoryHandle(fName);
                for await (const entry of folder.values()) {
                    if (entry.kind === "file" && entry.name.endsWith(".json")) {
                        const file = await entry.getFile();
                        const key = fName === "Archive" ? "archived" : fName.toLowerCase();
                        if (result[key]) result[key].push(JSON.parse(await file.text()));
                    }
                }
            } catch (e) { continue; }
        }
    } catch (e) { console.error(e); }
    return result;
}

/* ─── Write helper ──────────────────────────────────────────── */
async function writeDocumentFile(doc, folder) {
    const docsRoot = await directoryHandle.getDirectoryHandle("Documents", { create: true });
    const target = await docsRoot.getDirectoryHandle(folder, { create: true });
    const fileHandle = await target.getFileHandle(doc.id + ".json", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(doc, null, 2));
    await writable.close();
}

/* ─── Evidence URL ──────────────────────────────────────────── */
async function resolveDocumentEvidenceUrl(doc) {
    if (!doc.evidenceFile) return null;
    try {
        const ev = await directoryHandle.getDirectoryHandle("Evidence");
        const fh = await ev.getFileHandle(doc.evidenceFile);
        return URL.createObjectURL(await fh.getFile());
    } catch (e) { return null; }
}

/* ─── Render Document Hub ───────────────────────────────────── */
async function renderDocuments(useCache = false) {
    if (!directoryHandle) {
        document.getElementById("mainView").innerHTML = `
            <div class="card p-12 text-center rounded-none">
                <h2 class="text-3xl font-black outfit birds-green mb-2">Document Hub</h2>
                <p class="text-slate-500 font-bold mb-4">Master folder not anchored.</p>
            </div>`;
        return;
    }
    if (!useCache) window.currentLoadedDocs = await loadDocuments();
    const docs = window.currentLoadedDocs;
    const allDocs = [...docs.open, ...docs.resolved, ...(docs.archived || [])];

    const attentionOptions = [...new Set(allDocs.map(d => d.attentionOf).filter(Boolean))].sort();
    const authorOptions = [...new Set(allDocs.map(d => d.creator).filter(Boolean))].sort();
    const deptOptions = [...new Set(allDocs.map(d => d.department).filter(Boolean))].sort();

    const fStatus = document.getElementById("filter-status")?.value || "All";
    const fAttention = document.getElementById("filter-attention")?.value || "All";
    const fAuthor = document.getElementById("filter-author")?.value || "All";
    const fDept = document.getElementById("filter-dept")?.value || "All";
    const fSort = document.getElementById("filter-sort")?.value || "newest";

    const filterDoc = (d, label) => {
        if (fStatus !== "All" && fStatus !== label) return false;
        if (fAttention !== "All" && d.attentionOf !== fAttention) return false;
        if (fAuthor !== "All" && d.creator !== fAuthor) return false;
        if (fDept !== "All" && d.department !== fDept) return false;
        return true;
    };

    const sortDocs = (arr) => [...arr].sort((a, b) => {
        const da = new Date(a.date || 0).getTime() || 0;
        const db = new Date(b.date || 0).getTime() || 0;
        return fSort === "oldest" ? da - db : db - da;
    });

    const docCard = (doc, folder) => {
        const replies = Array.isArray(doc.replies) ? doc.replies : [];
        const lastReply = replies[replies.length - 1];
        const borderClass = folder === 'Open' ? 'border-l-amber-400' : folder === 'Archive' ? 'border-l-purple-400' : 'border-l-birds-green';
        const pinned = doc.pin ? '<span class="text-amber-500 font-bold text-[10px]">PINNED</span>' : '';
        return `
        <div class="card p-5 border-l-4 rounded-none ${borderClass} mb-4 bg-white shadow-sm">
            <div class="flex items-start justify-between">
                <h4 class="font-black text-slate-800">${escapeHtml(doc.title || doc.name)}</h4>
                ${pinned}
            </div>
            <p class="text-xs font-bold text-slate-500">${escapeHtml(doc.type)} • ${escapeHtml(doc.date)}</p>
            <p class="text-xs font-bold text-slate-400">Author: ${escapeHtml(doc.creator || '—')}${doc.attentionOf ? ` • For: ${escapeHtml(doc.attentionOf)}` : ''}</p>
            ${doc.department ? `<p class="text-[10px] font-bold text-slate-400 uppercase">${escapeHtml(doc.department)}</p>` : ''}
            ${lastReply ? `<p class="text-xs text-slate-400 mt-2 italic">${replies.length} repl${replies.length === 1 ? 'y' : 'ies'} — latest from ${escapeHtml(lastReply.author)}: "${escapeHtml(String(lastReply.body || '').slice(0, 60))}${String(lastReply.body || '').length > 60 ? '…' : ''}"</p>` : ''}
            <div class="flex gap-2 mt-3">
                <button onclick="openDocumentViewer('${doc.id}', '${folder}')" class="btn-primary rounded-none text-sm flex-1">Open</button>
                ${folder === 'Open' ? `<button onclick="resolveDocument('${doc.id}')" class="bg-emerald-50 text-emerald-700 rounded-none text-sm flex-1 py-2 font-bold hover:bg-emerald-100">Resolve</button>` : ''}
                ${folder === 'Open' ? `<button onclick="archiveDocument('${doc.id}', '${folder}')" class="bg-purple-50 text-purple-700 rounded-none text-sm flex-1 py-2 font-bold hover:bg-purple-100">Archive</button>` : ''}
                ${folder === 'Archive' ? `<button onclick="relaunchDocument('${doc.id}')" class="bg-blue-50 text-blue-700 rounded-none text-sm flex-1 py-2 font-bold hover:bg-blue-100">Relaunch</button>` : ''}
                ${folder === 'Archive' ? `<button onclick="permanentDeleteDocument('${doc.id}')" class="bg-red-100 text-red-700 rounded-none text-sm flex-1 py-2 font-bold hover:bg-red-200">Delete</button>` : ''}
                ${folder === 'Resolved' ? `<button onclick="relaunchResolvedDocument('${doc.id}')" class="bg-blue-50 text-blue-700 rounded-none text-sm flex-1 py-2 font-bold hover:bg-blue-100">Relaunch</button>` : ''}
                ${folder === 'Resolved' ? `<button onclick="deleteDocument('${doc.id}', '${folder}')" class="bg-red-50 text-red-600 rounded-none text-sm flex-1 py-2 font-bold hover:bg-red-100">Delete</button>` : ''}
            </div>
        </div>`;
    };

    const activeAttention = fAttention;
    document.getElementById("mainView").innerHTML = `
        <h2 class="text-[36px] font-black outfit birds-green mb-6">Document Hub</h2>
        <div class="flex flex-wrap gap-2 mb-4">
            <button class="px-4 py-2 text-xs font-black uppercase tracking-wider rounded-none transition-all ${fAttention === 'All' ? 'bg-birds-green text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" onclick="document.getElementById('filter-attention').value='All';renderDocuments(true)">All</button>
            ${attentionOptions.map(a => `<button class="px-4 py-2 text-xs font-black uppercase tracking-wider rounded-none transition-all ${fAttention === a ? 'bg-birds-green text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" onclick="document.getElementById('filter-attention').value='${escapeHtml(a)}';renderDocuments(true)">${escapeHtml(a)}</button>`).join('')}
        </div>
        <div class="flex flex-wrap gap-3 mb-6">
            <select id="filter-status" class="input-chip rounded-none" onchange="renderDocuments(true)">
                <option value="All" ${fStatus === 'All' ? 'selected' : ''}>All Statuses</option>
                <option value="Open" ${fStatus === 'Open' ? 'selected' : ''}>Open</option>
                <option value="Resolved" ${fStatus === 'Resolved' ? 'selected' : ''}>Resolved</option>
            </select>
            <select id="filter-dept" class="input-chip rounded-none" onchange="renderDocuments(true)">
                <option value="All">All Departments</option>
                ${deptOptions.map(a => `<option value="${escapeHtml(a)}" ${fDept === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
            </select>
            <select id="filter-attention" class="hidden" onchange="renderDocuments(true)">
                <option value="All">All — Attention Of</option>
                ${attentionOptions.map(a => `<option value="${escapeHtml(a)}" ${fAttention === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
            </select>
            <select id="filter-author" class="input-chip rounded-none" onchange="renderDocuments(true)">
                <option value="All">All Authors</option>
                ${authorOptions.map(a => `<option value="${escapeHtml(a)}" ${fAuthor === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
            </select>
            <select id="filter-sort" class="input-chip rounded-none" onchange="renderDocuments(true)">
                <option value="newest" ${fSort === 'newest' ? 'selected' : ''}>Newest First</option>
                <option value="oldest" ${fSort === 'oldest' ? 'selected' : ''}>Oldest First</option>
            </select>
            <button onclick="renderDocumentCreate()" class="btn-primary rounded-none">+ New Document</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div><h3 class="font-black text-slate-400 uppercase mb-4">Open (${docs.open.filter(d => filterDoc(d, 'Open')).length})</h3>${sortDocs(docs.open.filter(d => filterDoc(d, 'Open'))).map(d => docCard(d, 'Open')).join('') || '<p class="text-slate-400 italic text-sm">No documents.</p>'}</div>
            <div><h3 class="font-black text-slate-400 uppercase mb-4">Resolved (${docs.resolved.filter(d => filterDoc(d, 'Resolved')).length})</h3>${sortDocs(docs.resolved.filter(d => filterDoc(d, 'Resolved'))).map(d => docCard(d, 'Resolved')).join('') || '<p class="text-slate-400 italic text-sm">No documents.</p>'}</div>
        </div>`;
}

/* ─── Create Document ───────────────────────────────────────── */
function renderDocumentCreate() {
    const today = new Date().toISOString().substring(0, 10);
    document.getElementById('mainView').innerHTML = `
    <div class="card p-6 border-t-4 border-t-birds-green rounded-none">
        <h2 class="text-2xl font-black birds-green mb-4">Create New Document</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Author Name</label>
                <input type="text" id="doc-author" class="input-chip rounded-none w-full">
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Date</label>
                <input type="date" id="doc-date" class="input-chip rounded-none w-full" value="${today}">
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Department</label>
                <select id="doc-department" class="input-chip rounded-none w-full">
                    ${_docDepartments.map(d => `<option value="${d}">${d}</option>`).join('')}
                </select>
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Attention Of</label>
                <select id="doc-attention" class="input-chip rounded-none w-full">
                    ${_docDepartments.map(d => `<option value="${d}">${d}</option>`).join('')}
                </select>
            </div>
            <div class="md:col-span-2">
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Document Name / Title</label>
                <input type="text" id="doc-name" class="input-chip rounded-none w-full">
            </div>
            <div>
                <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Document Type</label>
                <select id="doc-type" class="input-chip rounded-none w-full">
                    <option value="General query">General query</option>
                    <option value="Investigation">Investigation</option>
                    <option value="Review">Review</option>
                    <option value="Issue raised">Issue raised</option>
                    <option value="Feedback">Feedback from department</option>
                </select>
            </div>
        </div>
        <div class="mb-4">
            <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Document PIN (optional — locks the document so only people with the PIN can open it)</label>
            <input type="password" id="doc-pin" class="input-chip rounded-none w-full md:w-1/2">
        </div>
        <div class="mb-4">
            <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Document Body</label>
            <textarea id="doc-body" class="w-full h-64 p-4 border border-slate-300 rounded-lg resize-y"></textarea>
        </div>
        <div class="mb-4">
            <label class="text-xs font-black text-slate-500 uppercase tracking-widest mb-1 block">Attach Evidence (optional)</label>
            <input type="file" id="doc-evidence" class="text-sm">
        </div>
        <div class="flex gap-3 pt-4 border-t">
            <button onclick="saveDocumentRecord()" class="btn-primary rounded-none">Save Document</button>
            <button onclick="renderDocuments()" class="bg-red-50 text-red-600 px-5 py-2.5 rounded-none font-bold">Discard</button>
        </div>
    </div>`;
}

async function saveDocumentRecord() {
    if (!directoryHandle) return alert("Select Data Folder first");
    const author = document.getElementById("doc-author")?.value?.trim();
    const body = document.getElementById("doc-body")?.value?.trim();
    if (!author || !body) { alert('Author and body are required.'); return; }

    const id = "DOC-" + Date.now();
    const data = {
        id,
        creator: author,
        date: document.getElementById("doc-date")?.value || new Date().toISOString().substring(0, 10),
        attentionOf: document.getElementById("doc-attention")?.value || '',
        department: document.getElementById("doc-department")?.value || '',
        name: document.getElementById("doc-name")?.value || 'Untitled',
        type: document.getElementById("doc-type")?.value || 'General query',
        body,
        pin: document.getElementById("doc-pin")?.value || "",
        status: "Open",
        replies: []
    };

    const fileInput = document.getElementById("doc-evidence");
    if (fileInput.files.length > 0) {
        try {
            const evFolder = await directoryHandle.getDirectoryHandle("Evidence", { create: true });
            const file = fileInput.files[0];
            const safeName = `${id}_evidence.${file.name.split('.').pop()}`;
            const handle = await evFolder.getFileHandle(safeName, { create: true });
            const writable = await handle.createWritable();
            await writable.write(file);
            await writable.close();
            data.evidenceFile = safeName;
        } catch (e) { console.warn('Evidence save failed:', e); }
    }

    const docsRoot = await directoryHandle.getDirectoryHandle("Documents", { create: true });
    const folder = await docsRoot.getDirectoryHandle("Open", { create: true });
    const fileHandle = await folder.getFileHandle(id + ".json", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    alert("Document Saved");
    renderDocuments();
}

/* ─── Add Reply ─────────────────────────────────────────────── */
async function addDocumentReply(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    const author = document.getElementById("reply-author")?.value?.trim();
    const body = document.getElementById("reply-body")?.value?.trim();
    if (!author || !body) { alert('Author and reply body are required.'); return; }

    const reply = {
        author,
        date: document.getElementById("reply-date")?.value || new Date().toISOString().substring(0, 10),
        body,
        photo: null
    };

    const fileInput = document.getElementById("reply-photo");
    if (fileInput.files.length > 0) {
        try {
            const reader = new FileReader();
            reply.photo = await new Promise((resolve) => {
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(fileInput.files[0]);
            });
        } catch (e) { console.warn('Photo read failed:', e); }
    }

    if (!doc.replies) doc.replies = [];
    doc.replies.push(reply);
    await writeDocumentFile(doc, folder);
    renderLinearViewer(doc, await resolveDocumentEvidenceUrl(doc), folder);
}

/* ─── Document Viewer ───────────────────────────────────────── */
async function openDocumentViewer(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return alert("Document not found.");
    if (doc.pin && !window.unlockedDocs.has(id)) {
        const input = prompt("Enter PIN:");
        if (input !== doc.pin) return alert("Access Denied");
        window.unlockedDocs.add(id);
    }
    const evidenceUrl = await resolveDocumentEvidenceUrl(doc);
    renderLinearViewer(doc, evidenceUrl, folder);
}

function renderLinearViewer(doc, evidenceUrl, folder) {
    const replies = Array.isArray(doc.replies) ? doc.replies : [];
    const today = new Date().toISOString().substring(0, 10);

    const replyHtml = replies.length ? replies.map((r, idx) => `
        <div class="bg-slate-50 border-l-4 border-l-slate-300 rounded-none p-4 mb-3" id="reply-${idx}">
            <div class="flex items-center justify-between mb-1">
                <p class="text-xs font-bold text-slate-500">${escapeHtml(r.author)} • ${escapeHtml(r.date)}</p>
                <button onclick="editReplyInline('${doc.id}','${folder}',${idx})" class="text-[10px] font-bold text-birds-green hover:underline">Edit</button>
            </div>
            <div id="reply-body-${idx}" class="text-sm text-slate-800 whitespace-pre-wrap">${escapeHtml(r.body)}</div>
            ${r.photo ? `<img src="${r.photo}" class="mt-2 max-w-xs rounded border border-slate-200" />` : ''}
        </div>`).join('') : '';

    document.getElementById("mainView").innerHTML = `
        <div id="print-doc-area" class="card p-8 bg-white rounded-none">
            <div class="flex items-start justify-between mb-2">
                <h2 class="text-3xl font-black" id="doc-title-display">${escapeHtml(doc.name)}</h2>
                ${doc.pin ? '<span class="text-amber-500 font-bold text-xs bg-amber-50 px-2 py-1 rounded">PINNED</span>' : ''}
            </div>
            <p class="text-xs font-bold text-slate-500 mb-1">ID: ${escapeHtml(doc.id)} | Author: ${escapeHtml(doc.creator)} | Type: ${escapeHtml(doc.type)}${doc.department ? ` | Dept: ${escapeHtml(doc.department)}` : ''}</p>
            <p class="text-xs font-bold text-slate-400 mb-4">Created: ${escapeHtml(doc.date)}${doc.attentionOf ? ` | For: ${escapeHtml(doc.attentionOf)}` : ''}</p>

            <div id="doc-body-container">
                <div class="text-sm leading-relaxed p-5 bg-slate-50 rounded-none mb-2 whitespace-pre-wrap" id="doc-body-display">${escapeHtml(doc.body)}</div>
                <button onclick="editDocumentBodyInline('${doc.id}','${folder}')" class="text-[10px] font-bold text-birds-green hover:underline mb-4 print:hidden">Edit Document</button>
            </div>

            ${evidenceUrl ? `<img src="${evidenceUrl}" class="w-64 mb-6 border-4 border-slate-50" />` : ''}

            ${replies.length ? `<div class="mb-6"><h3 class="text-sm font-black uppercase text-slate-400 mb-3">Replies (${replies.length})</h3>${replyHtml}</div>` : '<p class="text-sm text-slate-400 italic mb-6">No replies yet.</p>'}

            <div class="print:hidden border-t pt-6 mb-6">
                <h3 class="text-sm font-black uppercase text-slate-400 mb-3">Add a Reply</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <input type="text" id="reply-author" class="input-chip rounded-none w-full" placeholder="Your name">
                    <input type="date" id="reply-date" class="input-chip rounded-none w-full" value="${today}">
                </div>
                <textarea id="reply-body" class="w-full h-28 p-3 mb-3 border border-slate-300 rounded-lg resize-y" placeholder="Reply message..."></textarea>
                <div class="mb-3">
                    <label class="text-xs font-bold text-slate-500 mb-1 block">Attach Photo (optional)</label>
                    <input type="file" id="reply-photo" accept="image/*" class="text-sm">
                </div>
                <button onclick="addDocumentReply('${doc.id}', '${folder}')" class="btn-primary rounded-none text-sm">Save Reply</button>
            </div>

            <div class="print:hidden flex flex-wrap gap-2">
                <button onclick="renderDocuments()" class="btn-secondary rounded-none">Back</button>
                <button onclick="window.print()" class="btn-secondary rounded-none">Print PDF</button>
                ${doc.pin ? `<button onclick="removeDocumentPin('${doc.id}','${folder}')" class="bg-amber-50 text-amber-700 rounded-none font-bold px-4 py-2 hover:bg-amber-100">Unpin</button>` : `<button onclick="setDocumentPin('${doc.id}','${folder}')" class="bg-slate-100 text-slate-600 rounded-none font-bold px-4 py-2 hover:bg-slate-200">Pin</button>`}
                ${folder === 'Open' ? `<button onclick="resolveDocument('${doc.id}')" class="bg-emerald-50 text-emerald-700 rounded-none font-bold px-4 py-2 hover:bg-emerald-100">Resolve</button>` : ''}
                ${folder === 'Open' ? `<button onclick="archiveDocument('${doc.id}','${folder}')" class="bg-purple-50 text-purple-700 rounded-none font-bold px-4 py-2 hover:bg-purple-100">Archive</button>` : ''}
                ${folder === 'Archive' ? `<button onclick="relaunchDocument('${doc.id}')" class="bg-blue-50 text-blue-700 rounded-none font-bold px-4 py-2 hover:bg-blue-100">Relaunch</button>` : ''}
                ${folder === 'Archive' ? `<button onclick="permanentDeleteDocument('${doc.id}')" class="bg-red-100 text-red-700 rounded-none font-bold px-4 py-2 hover:bg-red-200">Delete</button>` : ''}
                ${folder === 'Resolved' ? `<button onclick="relaunchResolvedDocument('${doc.id}')" class="bg-blue-50 text-blue-700 rounded-none font-bold px-4 py-2 hover:bg-blue-100">Relaunch</button>` : ''}
                ${folder === 'Resolved' ? `<button onclick="deleteDocument('${doc.id}','${folder}')" class="bg-red-50 text-red-600 rounded-none font-bold px-4 py-2 hover:bg-red-100">Delete</button>` : ''}
            </div>
        </div>`;
}

/* ─── Edit Document Body (inline) ───────────────────────────── */
async function editDocumentBodyInline(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    const container = document.getElementById('doc-body-container');
    if (!container) return;
    container.innerHTML = `
        <textarea id="doc-body-edit" class="w-full h-64 p-4 mb-2 border border-slate-300 rounded-lg resize-y text-sm">${escapeHtml(doc.body)}</textarea>
        <div class="flex gap-2 mb-4">
            <button onclick="saveDocumentBodyInline('${id}','${folder}')" class="bg-emerald-50 text-emerald-700 rounded-none font-bold px-4 py-1.5 text-xs hover:bg-emerald-100">Save</button>
            <button onclick="cancelDocumentBodyInline('${id}','${folder}')" class="bg-red-50 text-red-600 rounded-none font-bold px-4 py-1.5 text-xs hover:bg-red-100">Cancel</button>
        </div>`;
    document.getElementById('doc-body-edit').focus();
}

async function saveDocumentBodyInline(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    const newBody = document.getElementById('doc-body-edit')?.value;
    if (newBody === null) return;
    doc.body = newBody;
    await writeDocumentFile(doc, folder);
    const container = document.getElementById('doc-body-container');
    if (container) {
        container.innerHTML = `
            <div class="text-sm leading-relaxed p-5 bg-slate-50 rounded-none mb-2 whitespace-pre-wrap" id="doc-body-display">${escapeHtml(doc.body)}</div>
            <button onclick="editDocumentBodyInline('${id}','${folder}')" class="text-[10px] font-bold text-birds-green hover:underline mb-4 print:hidden">Edit Document</button>`;
    }
}

async function cancelDocumentBodyInline(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    const container = document.getElementById('doc-body-container');
    if (container) {
        container.innerHTML = `
            <div class="text-sm leading-relaxed p-5 bg-slate-50 rounded-none mb-2 whitespace-pre-wrap" id="doc-body-display">${escapeHtml(doc.body)}</div>
            <button onclick="editDocumentBodyInline('${id}','${folder}')" class="text-[10px] font-bold text-birds-green hover:underline mb-4 print:hidden">Edit Document</button>`;
    }
}

/* ─── Edit Reply (inline) ───────────────────────────────────── */
async function editReplyInline(id, folder, idx) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc || !doc.replies[idx]) return;
    const reply = doc.replies[idx];
    const bodyEl = document.getElementById('reply-body-' + idx);
    if (!bodyEl) return;
    bodyEl.outerHTML = `
        <div id="reply-body-${idx}">
            <textarea id="reply-edit-${idx}" class="w-full h-28 p-3 mb-2 border border-slate-300 rounded-lg resize-y text-sm">${escapeHtml(reply.body)}</textarea>
            <div class="flex gap-2">
                <button onclick="saveReplyInline('${id}','${folder}',${idx})" class="bg-emerald-50 text-emerald-700 rounded-none font-bold px-3 py-1 text-xs hover:bg-emerald-100">Save</button>
                <button onclick="cancelReplyInline('${id}','${folder}',${idx})" class="bg-red-50 text-red-600 rounded-none font-bold px-3 py-1 text-xs hover:bg-red-100">Cancel</button>
            </div>
        </div>`;
    document.getElementById('reply-edit-' + idx).focus();
}

async function saveReplyInline(id, folder, idx) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc || !doc.replies[idx]) return;
    const newBody = document.getElementById('reply-edit-' + idx)?.value;
    if (newBody === null) return;
    doc.replies[idx].body = newBody;
    await writeDocumentFile(doc, folder);
    const wrapper = document.getElementById('reply-body-' + idx);
    if (wrapper) {
        wrapper.outerHTML = `<div id="reply-body-${idx}" class="text-sm text-slate-800 whitespace-pre-wrap">${escapeHtml(newBody)}</div>`;
    }
}

async function cancelReplyInline(id, folder, idx) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc || !doc.replies[idx]) return;
    const wrapper = document.getElementById('reply-body-' + idx);
    if (wrapper) {
        wrapper.outerHTML = `<div id="reply-body-${idx}" class="text-sm text-slate-800 whitespace-pre-wrap">${escapeHtml(doc.replies[idx].body)}</div>`;
    }
}

/* ─── Pin / Unpin ───────────────────────────────────────────── */
async function setDocumentPin(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    const pin = prompt("Set a PIN for this document (leave blank for none):");
    if (pin === null) return;
    doc.pin = pin;
    await writeDocumentFile(doc, folder);
    alert(pin ? "Document pinned." : "PIN cleared.");
    renderLinearViewer(doc, await resolveDocumentEvidenceUrl(doc), folder);
}

async function removeDocumentPin(id, folder) {
    const doc = window.currentLoadedDocs[folder.toLowerCase()]?.find(d => d.id === id);
    if (!doc) return;
    if (!confirm("Remove PIN from this document?")) return;
    doc.pin = "";
    window.unlockedDocs.add(id);
    await writeDocumentFile(doc, folder);
    alert("PIN removed.");
    renderLinearViewer(doc, await resolveDocumentEvidenceUrl(doc), folder);
}

/* ─── Resolve / Archive / Relaunch / Delete ─────────────────── */
async function resolveDocument(id) {
    const note = prompt("How was this resolved?");
    if (!note) return;
    const docsRoot = await directoryHandle.getDirectoryHandle("Documents", { create: true });
    const openFolder = await docsRoot.getDirectoryHandle("Open");
    const resolvedFolder = await docsRoot.getDirectoryHandle("Resolved", { create: true });

    const fileHandle = await openFolder.getFileHandle(id + ".json");
    const file = await fileHandle.getFile();
    const doc = JSON.parse(await file.text());

    doc.status = "Resolved";
    doc.resolution = note;
    doc.resolvedDate = new Date().toISOString().substring(0, 10);

    const newHandle = await resolvedFolder.getFileHandle(id + ".json", { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(JSON.stringify(doc, null, 2));
    await writable.close();

    await openFolder.removeEntry(id + ".json");
    alert("Document Resolved.");
    renderDocuments();
}

async function archiveDocument(id, folder) {
    if (!confirm("Archive this document?")) return;
    const docsRoot = await directoryHandle.getDirectoryHandle("Documents", { create: true });
    const source = await docsRoot.getDirectoryHandle(folder);
    const archiveFolder = await docsRoot.getDirectoryHandle("Archive", { create: true });

    const fileHandle = await source.getFileHandle(id + ".json");
    const file = await fileHandle.getFile();
    const doc = JSON.parse(await file.text());

    doc.status = "Archived";
    doc.archivedDate = new Date().toISOString().substring(0, 10);

    const newHandle = await archiveFolder.getFileHandle(id + ".json", { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(JSON.stringify(doc, null, 2));
    await writable.close();

    await source.removeEntry(id + ".json");
    alert("Document Archived.");
    renderDocuments();
}

async function relaunchDocument(id) {
    if (!confirm("Relaunch this document to Open?")) return;
    const docsRoot = await directoryHandle.getDirectoryHandle("Documents", { create: true });
    const archiveFolder = await docsRoot.getDirectoryHandle("Archive");
    const openFolder = await docsRoot.getDirectoryHandle("Open", { create: true });

    const fileHandle = await archiveFolder.getFileHandle(id + ".json");
    const file = await fileHandle.getFile();
    const doc = JSON.parse(await file.text());

    doc.status = "Open";
    delete doc.archivedDate;

    const newHandle = await openFolder.getFileHandle(id + ".json", { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(JSON.stringify(doc, null, 2));
    await writable.close();

    await archiveFolder.removeEntry(id + ".json");
    alert("Document relaunched to Open.");
    renderDocuments();
}

async function permanentDeleteDocument(id) {
    if (!confirm("PERMANENTLY delete this archived document? This cannot be undone.")) return;
    const docsRoot = await directoryHandle.getDirectoryHandle("Documents", { create: true });
    const archiveFolder = await docsRoot.getDirectoryHandle("Archive");
    await archiveFolder.removeEntry(id + ".json");
    alert("Document deleted.");
    renderDocuments();
}

async function relaunchResolvedDocument(id) {
    if (!confirm("Relaunch this resolved document back to Open?")) return;
    const docsRoot = await directoryHandle.getDirectoryHandle("Documents", { create: true });
    const resolvedFolder = await docsRoot.getDirectoryHandle("Resolved");
    const openFolder = await docsRoot.getDirectoryHandle("Open", { create: true });

    const fileHandle = await resolvedFolder.getFileHandle(id + ".json");
    const file = await fileHandle.getFile();
    const doc = JSON.parse(await file.text());

    doc.status = "Open";

    const newHandle = await openFolder.getFileHandle(id + ".json", { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(JSON.stringify(doc, null, 2));
    await writable.close();

    await resolvedFolder.removeEntry(id + ".json");
    alert("Document relaunched to Open.");
    renderDocuments();
}

async function deleteDocument(id, folder) {
    if (!confirm("Permanently delete this document?")) return;
    const root = await directoryHandle.getDirectoryHandle("Documents");
    const target = await root.getDirectoryHandle(folder);
    await target.removeEntry(id + ".json");
    alert("Document deleted.");
    renderDocuments();
}

/* ─── Archive Tab ───────────────────────────────────────────── */
async function renderDocumentArchive() {
    if (!directoryHandle) {
        document.getElementById("mainView").innerHTML = `
            <div class="card p-12 text-center rounded-none">
                <h2 class="text-3xl font-black outfit text-purple-600 mb-2">Document Archive</h2>
                <p class="text-slate-500 font-bold mb-4">Master folder not anchored.</p>
            </div>`;
        return;
    }
    if (!window.currentLoadedDocs || !window.currentLoadedDocs.archived) {
        window.currentLoadedDocs = await loadDocuments();
    }
    const docs = window.currentLoadedDocs.archived || [];

    const sortDocs = (arr) => [...arr].sort((a, b) => {
        const da = new Date(a.archivedDate || a.date || 0).getTime() || 0;
        const db = new Date(b.archivedDate || b.date || 0).getTime() || 0;
        return db - da;
    });

    const docCard = (doc) => {
        const replies = Array.isArray(doc.replies) ? doc.replies : [];
        const lastReply = replies[replies.length - 1];
        return `
        <div class="card p-5 border-l-4 rounded-none border-l-purple-400 mb-4 bg-white shadow-sm">
            <h4 class="font-black text-slate-800">${escapeHtml(doc.title || doc.name)}</h4>
            <p class="text-xs font-bold text-slate-500">${escapeHtml(doc.type)} • ${escapeHtml(doc.date)}</p>
            <p class="text-xs font-bold text-slate-400">Author: ${escapeHtml(doc.creator || '—')}${doc.attentionOf ? ` • For: ${escapeHtml(doc.attentionOf)}` : ''}</p>
            ${doc.department ? `<p class="text-[10px] font-bold text-slate-400 uppercase">${escapeHtml(doc.department)}</p>` : ''}
            ${doc.archivedDate ? `<p class="text-xs font-bold text-purple-500">Archived: ${escapeHtml(doc.archivedDate)}</p>` : ''}
            ${lastReply ? `<p class="text-xs text-slate-400 mt-2 italic">${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}</p>` : ''}
            <div class="flex gap-2 mt-4">
                <button onclick="openDocumentViewer('${doc.id}', 'Archive')" class="btn-primary rounded-none text-sm flex-1">Open</button>
                <button onclick="relaunchDocument('${doc.id}')" class="bg-blue-50 text-blue-700 rounded-none text-sm flex-1 py-2 font-bold hover:bg-blue-100">Relaunch</button>
                <button onclick="permanentDeleteDocument('${doc.id}')" class="bg-red-100 text-red-700 rounded-none text-sm flex-1 py-2 font-bold hover:bg-red-200">Delete</button>
            </div>
        </div>`;
    };

    document.getElementById("mainView").innerHTML = `
        <h2 class="text-[36px] font-black outfit text-purple-600 mb-6">Document Archive</h2>
        <p class="text-slate-500 font-bold mb-6">${docs.length} archived document${docs.length !== 1 ? 's' : ''}</p>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            ${docs.length ? sortDocs(docs).map(d => docCard(d)).join('') : '<div class="card p-12 text-center col-span-full"><p class="text-slate-400 font-bold">No archived documents.</p></div>'}
        </div>`;
}
