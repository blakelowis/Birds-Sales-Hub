/* ─── Birds Hub — Microsoft Graph API Client ─────────────────────── */
/* Replaces filesystem operations with SharePoint Graph API calls.     */
/* Reads/writes to: /sites/{site}/drives/{drive}/Retail Audits/Data/  */

window.GraphClient = (function() {
    'use strict';

    var _fileCache = {};          /* path → { text, etag, ts } */
    var _folderChildrenCache = {}; /* folderPath → { items, ts } */
    var CACHE_TTL = 30000;        /* 30s cache for reads */

    /* ─── Helper: build SharePoint item path ───────────────────── */
    function _itemPath(relativePath) {
        var base = '/drives/' + BirdsAuth.getDriveId() + '/root:/' + BirdsAuth.getConfig().dataFolderPath;
        if (relativePath) base += '/' + relativePath;
        return encodeURI(base).replace(/#/g, '%23');
    }

    /* ─── Read a file's text content ───────────────────────────── */
    function readFile(relativePath) {
        var cacheKey = relativePath;
        var cached = _fileCache[cacheKey];
        if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
            return Promise.resolve(cached.text);
        }
        var path = _itemPath(relativePath) + ':/content';
        return BirdsAuth.getAccessToken().then(function(token) {
            return fetch('https://graph.microsoft.com/v1.0' + path, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
        }).then(function(resp) {
            if (resp.status === 404) return null;
            if (!resp.ok) throw new Error('File read failed: ' + resp.status);
            return resp.text();
        }).then(function(text) {
            if (text !== null) {
                _fileCache[cacheKey] = { text: text, ts: Date.now() };
            }
            return text;
        }).catch(function(e) {
            console.warn('[Graph] Read failed:', relativePath, e.message);
            return null;
        });
    }

    /* ─── Read a file as ArrayBuffer (for binary files like XLSX) ─ */
    function readFileBinary(relativePath) {
        var path = _itemPath(relativePath) + ':/content';
        return BirdsAuth.getAccessToken().then(function(token) {
            return fetch('https://graph.microsoft.com/v1.0' + path, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
        }).then(function(resp) {
            if (resp.status === 404) return null;
            if (!resp.ok) throw new Error('File read failed: ' + resp.status);
            return resp.arrayBuffer();
        }).catch(function(e) {
            console.warn('[Graph] Binary read failed:', relativePath, e.message);
            return null;
        });
    }

    /* ─── Write text content to a file (with optional eTag for conditional write) ─ */
    function writeFile(relativePath, text, etag) {
        var path = _itemPath(relativePath) + ':/content';
        return BirdsAuth.getAccessToken().then(function(token) {
            var headers = {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'text/plain'
            };
            if (etag) { headers['If-Match'] = etag; }
            return fetch('https://graph.microsoft.com/v1.0' + path, {
                method: 'PUT',
                headers: headers,
                body: text
            });
        }).then(function(resp) {
            if (resp.status === 412) { console.warn('[Graph] Write conflict (412) — file modified by another user'); return false; }
            if (!resp.ok) throw new Error('File write failed: ' + resp.status);
            /* Invalidate cache */
            delete _fileCache[relativePath];
            var parentFolder = relativePath.lastIndexOf('/') >= 0 ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
            delete _folderChildrenCache[parentFolder];
            return true;
        }).catch(function(e) {
            console.warn('[Graph] Write failed:', relativePath, e.message);
            return false;
        });
    }

    /* ─── Rename a file (atomic lock mechanism) ────────────────── */
    function renameFile(oldName, newName) {
        var path = _itemPath(oldName);
        return BirdsAuth.getAccessToken().then(function(token) {
            return fetch('https://graph.microsoft.com/v1.0' + path, {
                method: 'PATCH',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: newName,
                    '@microsoft.graph.conflictBehavior': 'replace'
                })
            });
        }).then(function(resp) {
            if (!resp.ok) throw new Error('Rename failed: ' + resp.status);
            delete _fileCache[oldName];
            delete _fileCache[newName];
            delete _folderChildrenCache[''];
            return resp.json();
        }).catch(function(e) {
            console.warn('[Graph] Rename failed:', oldName, '->', newName, e.message);
            return null;
        });
    }

    /* ─── Read file + eTag (for conditional write) ─────────────── */
    function readFileWithEtag(relativePath) {
        var path = _itemPath(relativePath) + ':/content';
        return BirdsAuth.getAccessToken().then(function(token) {
            return fetch('https://graph.microsoft.com/v1.0' + path, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
        }).then(function(resp) {
            if (resp.status === 404) return null;
            if (!resp.ok) throw new Error('File read failed: ' + resp.status);
            return resp.text().then(function(text) {
                return { text: text, etag: resp.headers.get('ETag') || '' };
            });
        }).catch(function(e) {
            console.warn('[Graph] Read w/etag failed:', relativePath, e.message);
            return null;
        });
    }

    /* ─── Delete a file ────────────────────────────────────────── */
    function deleteFile(relativePath) {
        var path = _itemPath(relativePath);
        return BirdsAuth._graphDelete(path).then(function() {
            delete _fileCache[relativePath];
            delete _folderChildrenCache[''];
            return true;
        }).catch(function(e) {
            console.warn('[Graph] Delete failed:', relativePath, e.message);
            return false;
        });
    }

    /* ─── List children of a folder ────────────────────────────── */
    function listFolder(relativeFolderPath) {
        var cacheKey = relativeFolderPath;
        var cached = _folderChildrenCache[cacheKey];
        if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
            return Promise.resolve(cached.items);
        }
        var path = _itemPath(relativeFolderPath) + ':/children';
        return BirdsAuth._graphGet(path).then(function(resp) {
            var items = (resp.value || []).map(function(item) {
                return {
                    name: item.name,
                    size: item.size,
                    isFolder: !!item.folder,
                    id: item.id,
                    webUrl: item.webUrl,
                    lastModified: item.lastModifiedDateTime
                };
            });
            _folderChildrenCache[cacheKey] = { items: items, ts: Date.now() };
            return items;
        }).catch(function(e) {
            console.warn('[Graph] List folder failed:', relativeFolderPath, e.message);
            return [];
        });
    }

    /* ─── List all .json files in a folder (recursive 1 level) ─── */
    function listJsonFiles(relativeFolderPath) {
        return listFolder(relativeFolderPath).then(function(items) {
            return items.filter(function(item) {
                return !item.isFolder && item.name.endsWith('.json');
            });
        });
    }

    /* ─── Read all .json files in a folder and parse them ──────── */
    function readAllJson(relativeFolderPath) {
        return listJsonFiles(relativeFolderPath).then(function(files) {
            var reads = files.map(function(f) {
                var filePath = relativeFolderPath ? relativeFolderPath + '/' + f.name : f.name;
                return readFile(filePath).then(function(text) {
                    try { return JSON.parse(text); }
                    catch(e) { console.warn('[Graph] JSON parse failed:', f.name); return null; }
                }).catch(function() { return null; });
            });
            return Promise.all(reads);
        }).then(function(results) {
            return results.filter(Boolean);
        });
    }

    /* ─── Ensure a folder exists (create if missing) ───────────── */
    function ensureFolder(relativeFolderPath) {
        if (!relativeFolderPath) return Promise.resolve();
        var parts = relativeFolderPath.split('/').filter(Boolean);
        var current = '';
        var chain = Promise.resolve();
        parts.forEach(function(part) {
            current = current ? current + '/' + part : part;
            chain = chain.then(function() {
                return _createFolderIfMissing(current);
            });
        });
        return chain;
    }

    function _createFolderIfMissing(relativeFolderPath) {
        /* Try to list the folder — if it fails, create it */
        var parentPath = relativeFolderPath.substring(0, relativeFolderPath.lastIndexOf('/'));
        var folderName = relativeFolderPath.substring(relativeFolderPath.lastIndexOf('/') + 1);
        var parentItemPath = _itemPath(parentPath) + ':/children';
        return BirdsAuth._graphGet(parentItemPath).then(function(resp) {
            var existing = (resp.value || []).find(function(item) {
                return item.folder && item.name.toLowerCase() === folderName.toLowerCase();
            });
            if (existing) return existing.id;
            /* Create folder */
            var createPath = _itemPath(parentPath) + ':/children';
            return BirdsAuth.getAccessToken().then(function(token) {
                return fetch('https://graph.microsoft.com/v1.0' + createPath, {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: folderName,
                        folder: {},
                        '@microsoft.graph.conflictBehavior': 'fail'
                    })
                });
            }).then(function(resp) {
                if (resp.ok) return resp.json().then(function(r) { return r.id; });
                if (resp.status === 409) return null; /* already exists */
                throw new Error('Create folder failed: ' + resp.status);
            });
        }).catch(function(e) {
            console.warn('[Graph] ensureFolder failed:', relativeFolderPath, e.message);
            return null;
        });
    }

    /* ─── Batch read: read from multiple paths, fallback chain ─── */
    function readWithFallback(paths) {
        /* Try each path in order, return first hit */
        var chain = Promise.resolve(null);
        paths.forEach(function(p) {
            chain = chain.then(function(result) {
                if (result !== null) return result;
                return readFile(p);
            });
        });
        return chain;
    }

    /* ─── Clear all caches ─────────────────────────────────────── */
    function clearCache() {
        _fileCache = {};
        _folderChildrenCache = {};
    }

    /* ─── Expose public API ────────────────────────────────────── */
    return {
        readFile: readFile,
        readFileBinary: readFileBinary,
        readFileWithEtag: readFileWithEtag,
        writeFile: writeFile,
        renameFile: renameFile,
        deleteFile: deleteFile,
        listFolder: listFolder,
        listJsonFiles: listJsonFiles,
        readAllJson: readAllJson,
        ensureFolder: ensureFolder,
        readWithFallback: readWithFallback,
        clearCache: clearCache
    };
})();
