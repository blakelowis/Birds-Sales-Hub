// ===== MICROSOFT GRAPH API CLIENT =====
// Provides direct SharePoint access via Azure AD authentication.
// Requires: Azure AD App Registration with Sites.ReadWrite.All permission.
// Falls back to local folder (FSA) if not configured or auth fails.

var GraphAPI = (function() {

  var _config = null;
  var _accessToken = null;
  var _tokenExpiry = 0;
  var _initialized = false;
  var _driveInfo = null;

  var _msalInstance = null;
  var SCOPES = ['Sites.ReadWrite.All', 'User.Read'];
  var GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

  async function init(config) {
    if (!config || !config.clientId || !config.tenantId) {
      throw new Error('Azure AD config incomplete');
    }
    _config = config;

    if (!window.msal) {
      await loadScript('https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js');
    }
    if (!window.msal) {
      throw new Error('Failed to load MSAL.js');
    }

    var msalConfig = {
      auth: {
        clientId: _config.clientId,
        authority: 'https://login.microsoftonline.com/' + _config.tenantId,
        redirectUri: window.location.origin
      },
      cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: false
      }
    };

    _msalInstance = new msal.PublicClientApplication(msalConfig);
    _initialized = true;
    _driveInfo = null;
    console.log('[GraphAPI] Initialized with tenant:', _config.tenantId);
  }

  function isAuthenticated() {
    return _initialized && _accessToken && Date.now() < _tokenExpiry;
  }

  async function acquireToken() {
    if (!_msalInstance) throw new Error('GraphAPI not initialized');

    var accounts = _msalInstance.getAllAccounts();
    if (accounts.length > 0) {
      try {
        var response = await _msalInstance.acquireTokenSilent({ scopes: SCOPES, account: accounts[0] });
        _accessToken = response.accessToken;
        _tokenExpiry = response.expiresOn;
        return _accessToken;
      } catch (silentErr) {
        console.log('[GraphAPI] Silent token failed, trying interactive');
      }
    }

    var response = await _msalInstance.loginPopup({ scopes: SCOPES });
    _accessToken = response.accessToken;
    _tokenExpiry = response.expiresOn;
    return _accessToken;
  }

  async function getDriveId() {
    if (_driveInfo) return _driveInfo;
    var siteHost = (_config.siteUrl || '').replace(/\/+$/, '').split('//')[1];
    var resp = await graphFetch(GRAPH_BASE + '/sites/' + encodeURIComponent(siteHost));
    var site = await resp.json();
    var libraryPath = _config.libraryPath || 'Shared Documents';
    var drivesResp = await graphFetch(GRAPH_BASE + '/sites/' + site.id + '/drives');
    var drives = await drivesResp.json();
    var drive = (drives.value || []).find(function(d) {
      return d.name === libraryPath || d.displayName === libraryPath ||
             d.name === libraryPath.replace('Shared Documents/', '');
    });
    if (!drive) throw new Error('Drive not found: ' + libraryPath);
    _driveInfo = { siteId: site.id, driveId: drive.id };
    return _driveInfo;
  }

  // ===== FILE OPERATIONS =====

  async function listFiles() {
    await acquireToken();
    var driveInfo = await getDriveId();
    var resp = await graphFetch(GRAPH_BASE + '/drives/' + driveInfo.driveId + '/root/children?$select=name,lastModifiedDateTime,size&$orderby=name desc');
    var data = await resp.json();
    return (data.value || []).filter(function(f) { return !f.name.startsWith('~'); });
  }

  async function listFilesInFolder(folderName) {
    await acquireToken();
    var driveInfo = await getDriveId();
    var path = '/' + folderName;
    var resp = await graphFetch(GRAPH_BASE + '/drives/' + driveInfo.driveId + '/root:' + path + ':/children?$select=name,lastModifiedDateTime,size&$orderby=name desc');
    var data = await resp.json();
    return (data.value || []).filter(function(f) { return !f.name.startsWith('~'); });
  }

  async function downloadFile(fileName) {
    await acquireToken();
    var driveInfo = await getDriveId();
    var path = '/' + fileName;
    var resp = await graphFetch(GRAPH_BASE + '/drives/' + driveInfo.driveId + '/root:' + path + ':/content');
    if (!resp.ok) throw new Error('Download failed: ' + fileName);
    return await resp.arrayBuffer();
  }

  async function downloadFileFromFolder(folderName, fileName) {
    await acquireToken();
    var driveInfo = await getDriveId();
    var path = '/' + folderName + '/' + fileName;
    var resp = await graphFetch(GRAPH_BASE + '/drives/' + driveInfo.driveId + '/root:' + path + ':/content');
    if (!resp.ok) throw new Error('Download failed: ' + folderName + '/' + fileName);
    return await resp.arrayBuffer();
  }

  async function downloadFileAsText(fileName) {
    var buffer = await downloadFile(fileName);
    return new TextDecoder('utf-8').decode(buffer);
  }

  async function downloadFileAsTextFromFolder(folderName, fileName) {
    var buffer = await downloadFileFromFolder(folderName, fileName);
    return new TextDecoder('utf-8').decode(buffer);
  }

  async function uploadFile(fileName, content, contentType) {
    await acquireToken();
    var driveInfo = await getDriveId();
    var path = '/' + fileName;
    var body = typeof content === 'string' ? new Blob([content], { type: contentType || 'text/plain' }) : content;
    var resp = await graphFetch(GRAPH_BASE + '/drives/' + driveInfo.driveId + '/root:' + path + ':/content', { method: 'PUT', body: body });
    if (!resp.ok) throw new Error('Upload failed: ' + fileName);
    return await resp.json();
  }

  async function uploadFileToFolder(folderName, fileName, content, contentType) {
    await acquireToken();
    var driveInfo = await getDriveId();
    var path = '/' + folderName + '/' + fileName;
    var body = typeof content === 'string' ? new Blob([content], { type: contentType || 'text/plain' }) : content;
    var resp = await graphFetch(GRAPH_BASE + '/drives/' + driveInfo.driveId + '/root:' + path + ':/content', { method: 'PUT', body: body });
    if (!resp.ok) throw new Error('Upload failed: ' + folderName + '/' + fileName);
    return await resp.json();
  }

  async function deleteFileFromFolder(folderName, fileName) {
    await acquireToken();
    var driveInfo = await getDriveId();
    var path = '/' + folderName + '/' + fileName;
    var resp = await graphFetch(GRAPH_BASE + '/drives/' + driveInfo.driveId + '/root:' + path, { method: 'DELETE' });
    if (!resp.ok && resp.status !== 404) throw new Error('Delete failed: ' + folderName + '/' + fileName + ' (' + resp.status + ')');
  }

  // ===== HELPER =====

  async function graphFetch(url, options) {
    options = options || {};
    var headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + _accessToken;
    if (options.body && typeof options.body !== 'string' && !(options.body instanceof Blob)) {
      headers['Content-Type'] = 'application/json';
    }
    options.headers = headers;
    return fetch(url, options);
  }

  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function() { reject(new Error('Failed to load: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function getConfig() { return _config; }

  function logout() {
    _accessToken = null;
    _tokenExpiry = 0;
    _driveInfo = null;
    if (_msalInstance) { _msalInstance.logoutPopup().catch(function() {}); }
    _initialized = false;
    _config = null;
  }

  return {
    init: init,
    isAuthenticated: isAuthenticated,
    acquireToken: acquireToken,
    getDriveId: getDriveId,
    listFiles: listFiles,
    listFilesInFolder: listFilesInFolder,
    downloadFile: downloadFile,
    downloadFileFromFolder: downloadFileFromFolder,
    downloadFileAsText: downloadFileAsText,
    downloadFileAsTextFromFolder: downloadFileAsTextFromFolder,
    uploadFile: uploadFile,
    uploadFileToFolder: uploadFileToFolder,
    deleteFileFromFolder: deleteFileFromFolder,
    getConfig: getConfig,
    logout: logout
  };

})();
