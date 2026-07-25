// ===== SHAREPOINT REST API CLIENT (Cookie Auth) =====
// Uses the user's existing SharePoint session cookie — no Azure AD registration needed.
// Only works when the app is hosted inside SharePoint (Site Contents).

const SharePoint = (() => {

  const DEFAULTS = {
    siteUrl: 'https://birdsofderby.sharepoint.com/sites/RetailAudits',
    drivePath: 'Shared Documents/Data'
  };

  function getConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem('birdsSharePointConfig') || '{}');
      return {
        siteUrl: saved.siteUrl || DEFAULTS.siteUrl,
        drivePath: saved.drivePath || DEFAULTS.drivePath
      };
    } catch (_) { return { ...DEFAULTS }; }
  }

  function isConfigured() {
    const c = getConfig();
    return !!(c.siteUrl && c.drivePath);
  }

  // Build the server-relative URL for the data folder
  function buildFolderUrl() {
    const c = getConfig();
    const siteUrl = (c.siteUrl || '').replace(/\/+$/, '');
    const drivePath = (c.drivePath || '').replace(/^\/+/, '').replace(/\/+$/, '');
    // siteUrl is like https://birdsofderby.sharepoint.com/sites/RetailAudits
    // We need /sites/RetailAudits/Shared Documents/Weekly Reports
    const path = new URL(siteUrl).pathname.replace(/\/+$/, '');
    return `${path}/${drivePath}`;
  }

  // List .xlsx, .csv, and .json files in the folder
  async function listFiles() {
    const folderUrl = buildFolderUrl();
    const apiUrl = `/_api/web/GetFolderByServerRelativeUrl('${folderUrl}')/Files?$filter=endswith(Name,'.xlsx') or endswith(Name,'.csv') or endswith(Name,'.json')&$select=Name,TimeLastModified,Length&$orderby=Name desc`;

    const resp = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json;odata=verbose' },
      credentials: 'include'
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`SharePoint list failed (${resp.status}): ${err}`);
    }

    const data = await resp.json();
    return (data.d?.results || []).filter(f => !f.Name.startsWith('~'));
  }

  // Download a single file by name, returns ArrayBuffer
  async function downloadFile(fileName) {
    const folderUrl = buildFolderUrl();
    const fileUrl = `${folderUrl}/${fileName}`;
    const apiUrl = `/_api/web/GetFileByServerRelativeUrl('${fileUrl}')/$value`;

    const resp = await fetch(apiUrl, {
      credentials: 'include'
    });

    if (!resp.ok) throw new Error(`SharePoint download failed for ${fileName} (${resp.status})`);
    return resp.arrayBuffer();
  }

  // Download all .xlsx/.csv files (not .json — those are for tracker sync only)
  async function downloadAllFiles(onProgress) {
    const files = (await listFiles()).filter(f => !f.Name.endsWith('.json'));
    const results = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (onProgress) onProgress(i + 1, files.length, f.Name);
      try {
        const buffer = await downloadFile(f.Name);
        results.push({ name: f.Name, buffer, lastModified: f.TimeLastModified });
      } catch (err) {
        console.warn(`[SharePoint] Failed to download ${f.Name}:`, err);
      }
    }
    return results;
  }

  // Query a SharePoint list directly via REST API (returns items array)
  async function queryList(siteUrl, listTitle, top) {
    const cleanUrl = siteUrl.replace(/\/+$/, '');
    const apiUrl = `${cleanUrl}/_api/web/lists/getbytitle('${encodeURIComponent(listTitle)}')/items?$top=${top || 5000}`;

    const resp = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json;odata=verbose' },
      credentials: 'include'
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`SharePoint list query failed (${resp.status}): ${err}`);
    }

    const data = await resp.json();
    return data.d?.results || [];
  }

  // Download a file as text (for JSON/CSV)
  async function downloadText(fileName) {
    const buffer = await downloadFile(fileName);
    return new TextDecoder('utf-8').decode(buffer);
  }

  // Upload a file to the data folder (creates or overwrites)
  async function uploadFile(fileName, content, contentType) {
    const folderUrl = buildFolderUrl();
    const fileUrl = `${folderUrl}/${fileName}`;
    const blob = typeof content === 'string' ? new Blob([content], { type: contentType || 'text/plain' }) : content;

    // Try to get the file for checkin info (for existing files)
    let requestDigest = '';
    try {
      const ctxResp = await fetch(`/_api/contextinfo`, {
        method: 'POST',
        headers: { 'Accept': 'application/json;odata=verbose' },
        credentials: 'include'
      });
      if (ctxResp.ok) {
        const ctx = await ctxResp.json();
        requestDigest = ctx.d?.GetContextWebInformation?.FormDigestValue || '';
      }
    } catch (_) {}

    const resp = await fetch(`/_api/web/GetFolderByServerRelativeUrl('${folderUrl}')/Files/add('${encodeURIComponent(fileName)}',true)`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json;odata=verbose',
        'X-RequestDigest': requestDigest
      },
      credentials: 'include',
      body: blob
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`SharePoint upload failed for ${fileName} (${resp.status}): ${err}`);
    }
    return true;
  }

  // Create a list item in a SharePoint list
  async function createListItem(listTitle, itemData, siteUrl) {
    const baseUrl = (siteUrl || getConfig().siteUrl).replace(/\/+$/, '');
    const apiUrl = `${baseUrl}/_api/web/lists/getbytitle('${encodeURIComponent(listTitle)}')/items`;

    // Get form digest for POST
    let requestDigest = '';
    try {
      const ctxResp = await fetch(`${baseUrl}/_api/contextinfo`, {
        method: 'POST',
        headers: { 'Accept': 'application/json;odata=verbose' },
        credentials: 'include'
      });
      if (ctxResp.ok) {
        const ctx = await ctxResp.json();
        requestDigest = ctx.d?.GetContextWebInformation?.FormDigestValue || '';
      }
    } catch (_) {}

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json;odata=verbose',
        'Content-Type': 'application/json;odata=verbose',
        'X-RequestDigest': requestDigest
      },
      credentials: 'include',
      body: JSON.stringify(itemData)
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`SharePoint create item failed (${resp.status}): ${err}`);
    }
    return await resp.json();
  }

  return { getConfig, isConfigured, listFiles, downloadFile, downloadAllFiles, downloadText, uploadFile, buildFolderUrl, queryList, createListItem };
})();
