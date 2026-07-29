/* ─── Birds Hub — Entra ID Authentication (MSAL.js) ─────────────── */
/* Handles Microsoft Entra login, token management, auto-login,       */
/* and user profile retrieval via Microsoft Graph.                    */

window.BirdsAuth = (function() {
    'use strict';

    /* ─── Configuration ────────────────────────────────────────── */
    var CONFIG = {
        tenantId: '142a5bb2-e3ee-4675-ac9e-7fd88d3946f9',
        clientId: 'b157244e-60d2-441c-8bac-37c8e54b2121',
        /* SharePoint site */
        sharepointHostname: 'birdsofderby.sharepoint.com',
        sitePath: '/sites/RetailAudits',
        drivePath: 'Shared Documents',
        dataFolderPath: 'Retail Audits/Data',
        /* Graph API */
        graphBase: 'https://graph.microsoft.com/v1.0',
        graphScopes: ['User.Read', 'Sites.ReadWrite.All', 'offline_access'],
        /* Auth popup vs redirect */
        usePopup: true
    };

    var _msalInstance = null;
    var _currentUser = null;
    var _accessToken = null;
    var _siteId = null;
    var _driveId = null;

    /* ─── Initialise MSAL ──────────────────────────────────────── */
    function init() {
        if (typeof msal === 'undefined') {
            console.error('[Auth] MSAL.js not loaded');
            return false;
        }
        if (!window.isSecureContext) {
            console.error('[Auth] Not a secure context — MSAL PKCE requires HTTPS or localhost.');
            return false;
        }
        _msalInstance = new msal.PublicClientApplication({
            auth: {
                clientId: CONFIG.clientId,
                authority: 'https://login.microsoftonline.com/' + CONFIG.tenantId,
                redirectUri: window.location.origin + window.location.pathname
            },
            cache: {
                cacheLocation: 'localStorage',
                storeAuthStateInCookie: false
            }
        });
        return true;
    }

    /* ─── Login (popup or redirect) ────────────────────────────── */
    function login() {
        if (!_msalInstance) return Promise.reject('MSAL not initialised');
        var request = { scopes: CONFIG.graphScopes };
        if (CONFIG.usePopup) {
            return _msalInstance.loginPopup(request).then(function(response) {
                console.log('[Auth] Popup login successful');
                return _handleLoginResponse(response);
            });
        } else {
            _msalInstance.loginRedirect(request);
            return Promise.resolve(null);
        }
    }

    /* ─── Silent login (auto-login on page load) ───────────────── */
    function loginSilent() {
        if (!_msalInstance) return Promise.reject('MSAL not initialised');
        var accounts = _msalInstance.getAllAccounts();
        if (!accounts.length) return Promise.reject('No cached account');
        var request = {
            scopes: CONFIG.graphScopes,
            account: accounts[0]
        };
        return _msalInstance.acquireTokenSilent(request).then(function(response) {
            console.log('[Auth] Silent token acquired');
            return _handleLoginResponse(response);
        }).catch(function(error) {
            console.warn('[Auth] Silent token failed:', error.message);
            /* Try popup fallback */
            return _msalInstance.acquireTokenPopup(request).then(function(response) {
                return _handleLoginResponse(response);
            });
        });
    }

    /* ─── Handle login/token response ──────────────────────────── */
    function _handleLoginResponse(response) {
        if (!response || !response.accessToken) return Promise.reject('No access token');
        _accessToken = response.accessToken;
        _currentUser = {
            id: response.account.homeAccountId,
            name: response.account.name,
            email: response.account.username,
            localAccountId: response.account.localAccountId
        };
        /* Fetch full profile from Graph */
        return _fetchUserProfile().then(function(profile) {
            _currentUser = profile;
            /* Cache for quick reload */
            try { localStorage.setItem('birds_auth_user', JSON.stringify(profile)); } catch(e) {}
            try { localStorage.setItem('birds_auth_token', _accessToken); } catch(e) {}
            return _currentUser;
        }).catch(function(e) {
            console.warn('[Auth] Profile fetch failed, using cached:', e.message);
            return _currentUser;
        });
    }

    /* ─── Fetch user profile from Graph ────────────────────────── */
    function _fetchUserProfile() {
        return _graphGet('/me').then(function(me) {
            return {
                id: me.id,
                name: me.displayName || me.mail || me.userPrincipalName,
                email: me.mail || me.userPrincipalName,
                department: me.department || 'General',
                jobTitle: me.jobTitle || '',
                officeLocation: me.officeLocation || ''
            };
        });
    }

    /* ─── Get Graph access token ───────────────────────────────── */
    function getAccessToken() {
        if (_accessToken) return Promise.resolve(_accessToken);
        /* Try to restore from cache */
        return loginSilent().then(function() { return _accessToken; });
    }

    /* ─── Graph API GET helper ─────────────────────────────────── */
    function _graphGet(path) {
        return getAccessToken().then(function(token) {
            return fetch(CONFIG.graphBase + path, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
        }).then(function(resp) {
            if (!resp.ok) throw new Error('Graph GET ' + resp.status);
            return resp.json();
        });
    }

    /* ─── Graph API PUT helper (upload) ────────────────────────── */
    function _graphPut(path, body) {
        return getAccessToken().then(function(token) {
            return fetch(CONFIG.graphBase + path, {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: typeof body === 'string' ? body : JSON.stringify(body)
            });
        }).then(function(resp) {
            if (!resp.ok) throw new Error('Graph PUT ' + resp.status);
            return resp.json();
        });
    }

    /* ─── Graph API DELETE helper ──────────────────────────────── */
    function _graphDelete(path) {
        return getAccessToken().then(function(token) {
            return fetch(CONFIG.graphBase + path, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + token }
            });
        }).then(function(resp) {
            if (!resp.ok && resp.status !== 404) throw new Error('Graph DELETE ' + resp.status);
            return true;
        });
    }

    /* ─── Resolve SharePoint site and drive IDs ────────────────── */
    function resolveSharePointIds() {
        if (_siteId && _driveId) return Promise.resolve();
        // Check localStorage cache first
        try {
            var cached = localStorage.getItem('birds_sp_ids');
            if (cached) {
                var sp = JSON.parse(cached);
                if (sp && sp.siteId && sp.driveId) {
                    _siteId = sp.siteId;
                    _driveId = sp.driveId;
                    console.log('[Auth] SharePoint IDs restored from cache');
                    return Promise.resolve();
                }
            }
        } catch(e) {}
        /* Get site */
        return _graphGet('/sites/' + CONFIG.sharepointHostname + ':' + CONFIG.sitePath)
            .then(function(site) {
                _siteId = site.id;
                console.log('[Auth] SharePoint site resolved:', _siteId);
                /* Get drives (document libraries) */
                return _graphGet('/sites/' + _siteId + '/drives');
            }).then(function(drivesResp) {
                var drives = drivesResp.value || [];
                console.log('[Auth] Available drives:', drives.map(function(d) { return d.name + ' (' + d.id + ')'; }).join(', '));
                var targetDrive = drives.find(function(d) {
                    return d.name === CONFIG.drivePath || d.name === 'Shared Documents' || d.name === 'Documents';
                });
                // Fallback: use the first available drive if no name match
                if (!targetDrive && drives.length > 0) {
                    console.warn('[Auth] No drive matched expected names, using first available drive:', drives[0].name);
                    targetDrive = drives[0];
                }
                if (!targetDrive) {
                    throw new Error('No drives found on this SharePoint site. Check Sites.ReadWrite.All permission is granted.');
                }
                _driveId = targetDrive.id;
                console.log('[Auth] Drive resolved:', _driveId);
                // Cache for next time
                try { localStorage.setItem('birds_sp_ids', JSON.stringify({ siteId: _siteId, driveId: _driveId })); } catch(e) {}
            });
    }

    /* ─── Getters ──────────────────────────────────────────────── */
    function getUser() { return _currentUser; }
    function isLoggedIn() { return !!_accessToken; }
    function getConfig() { return CONFIG; }
    function getSiteId() { return _siteId; }
    function getDriveId() { return _driveId; }

    /* ─── Logout ───────────────────────────────────────────────── */
    function logout() {
        if (_msalInstance) {
            _msalInstance.logoutPopup().catch(function() {
                _msalInstance.logoutRedirect();
            });
        }
        _currentUser = null;
        _accessToken = null;
        _siteId = null;
        _driveId = null;
        try {
            localStorage.removeItem('birds_auth_user');
            localStorage.removeItem('birds_auth_token');
        } catch(e) {}
    }

    /* ─── Expose public API ────────────────────────────────────── */
    return {
        init: init,
        login: login,
        loginSilent: loginSilent,
        logout: logout,
        getUser: getUser,
        isLoggedIn: isLoggedIn,
        getAccessToken: getAccessToken,
        getConfig: getConfig,
        getSiteId: getSiteId,
        getDriveId: getDriveId,
        resolveSharePointIds: resolveSharePointIds,
        /* Expose Graph helpers for graph.js to use */
        _graphGet: _graphGet,
        _graphPut: _graphPut,
        _graphDelete: _graphDelete
    };
})();
