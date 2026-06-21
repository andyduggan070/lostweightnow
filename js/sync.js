/* Google Drive cloud sync. Uses Google Identity Services for OAuth and the
   Drive REST API with the drive.file scope, so it can only touch files it
   creates. Registers a save-hook with the store so local edits get pushed. */

import { $ } from "./util.js";
import { state, save, persist, replaceState, setOnSave } from "./store.js";
import { mergeStates } from "./domain.js";
import { renderAll } from "./render.js";

const SYNC_KEY = "lwn-sync-v1";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "LostWeightNow";
const DATA_FILE = "lostweightnow-data.json";

export let syncCfg = loadSyncCfg();
let gisLoaded = false, tokenClient = null, accessToken = null, pushTimer = null, syncing = false;

function loadSyncCfg() {
  try { return Object.assign({ clientId: "", connected: false, folderId: "", fileId: "", lastSync: 0 },
    JSON.parse(localStorage.getItem(SYNC_KEY) || "{}")); }
  catch { return { clientId: "", connected: false, folderId: "", fileId: "", lastSync: 0 }; }
}
function saveSyncCfg() { localStorage.setItem(SYNC_KEY, JSON.stringify(syncCfg)); }

function driveSay(msg) { const el = $("#driveStatus"); if (el) el.textContent = msg; }

function loadGis() {
  return new Promise((resolve, reject) => {
    if (gisLoaded && window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => { gisLoaded = true; resolve(); };
    s.onerror = () => reject(new Error("Could not load Google sign-in. Check your connection."));
    document.head.appendChild(s);
  });
}

// Request an OAuth access token. interactive=false tries silently (no popup).
function getToken(interactive) {
  return new Promise((resolve, reject) => {
    if (!syncCfg.clientId) return reject(new Error("Enter your Google OAuth Client ID first."));
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: syncCfg.clientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        accessToken = resp.access_token;
        resolve(accessToken);
      },
      error_callback: (err) => reject(new Error(err.type || "sign-in failed"))
    });
    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

async function driveFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) } });
  if (res.status === 401) { accessToken = null; throw new Error("auth-expired"); }
  if (!res.ok) throw new Error(`Drive API ${res.status}`);
  return res;
}

async function ensureFolder() {
  if (syncCfg.folderId) return syncCfg.folderId;
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`)).json();
  if (found.files && found.files.length) { syncCfg.folderId = found.files[0].id; saveSyncCfg(); return syncCfg.folderId; }
  const made = await (await driveFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
  })).json();
  syncCfg.folderId = made.id; saveSyncCfg(); return made.id;
}

async function findDataFile(folderId) {
  if (syncCfg.fileId) return syncCfg.fileId;
  const q = encodeURIComponent(`name='${DATA_FILE}' and '${folderId}' in parents and trashed=false`);
  const found = await (await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`)).json();
  if (found.files && found.files.length) { syncCfg.fileId = found.files[0].id; saveSyncCfg(); }
  return syncCfg.fileId || null;
}

async function downloadRemote(fileId) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return res.json();
}

async function uploadRemote(folderId, data) {
  const body = new Blob([JSON.stringify(data)], { type: "application/json" });
  if (syncCfg.fileId) {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${syncCfg.fileId}?uploadType=media`,
      { method: "PATCH", body });
    return syncCfg.fileId;
  }
  const meta = { name: DATA_FILE, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  form.append("file", body);
  const made = await (await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    { method: "POST", body: form })).json();
  syncCfg.fileId = made.id; saveSyncCfg(); return made.id;
}

// Pull remote, merge with local, push the merged result back.
export async function cloudSync({ interactive = false } = {}) {
  if (!syncCfg.connected || !syncCfg.clientId || syncing) return;
  syncing = true;
  try {
    driveSay("Syncing…");
    await loadGis();
    if (!accessToken) await getToken(interactive);
    const folderId = await ensureFolder();
    const fileId = await findDataFile(folderId);
    if (fileId) {
      const remote = await downloadRemote(fileId);
      const merged = mergeStates(state, remote);
      const changed = JSON.stringify(merged) !== JSON.stringify(state);
      replaceState(merged);
      persist();
      if (changed) renderAll();
    }
    await uploadRemote(folderId, state);
    syncCfg.lastSync = Date.now(); saveSyncCfg();
    driveSay(`✓ Synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  } catch (err) {
    if (err.message === "auth-expired" && !interactive) {
      syncing = false; return cloudSync({ interactive: true });
    }
    driveSay("Sync failed: " + err.message);
  } finally {
    syncing = false;
    renderDriveControls();
  }
}

// debounce pushes triggered by local edits
function scheduleCloudPush() {
  if (!syncCfg.connected) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => cloudSync(), 2500);
}
setOnSave(scheduleCloudPush);

export function renderDriveControls() {
  const idInput = $("#driveClientId");
  if (!idInput) return;
  if (document.activeElement !== idInput) idInput.value = syncCfg.clientId || "";
  $("#driveConnectBtn").hidden = syncCfg.connected;
  $("#driveSyncBtn").hidden = !syncCfg.connected;
  $("#driveDisconnectBtn").hidden = !syncCfg.connected;
  if (syncCfg.connected && !$("#driveStatus").textContent) {
    driveSay(syncCfg.lastSync ? `Connected · last sync ${new Date(syncCfg.lastSync).toLocaleString()}` : "Connected.");
  }
}

export function setupSync() {
  renderDriveControls();
  $("#driveClientId").addEventListener("change", () => {
    syncCfg.clientId = $("#driveClientId").value.trim();
    saveSyncCfg();
  });
  $("#driveConnectBtn").addEventListener("click", async () => {
    syncCfg.clientId = $("#driveClientId").value.trim();
    if (!syncCfg.clientId) { driveSay("Enter your Google OAuth Client ID first."); return; }
    saveSyncCfg();
    try {
      driveSay("Connecting…");
      await loadGis();
      await getToken(true);            // interactive consent on first connect
      syncCfg.connected = true; saveSyncCfg();
      await cloudSync({ interactive: true });
      renderDriveControls();
    } catch (err) { driveSay("Could not connect: " + err.message); }
  });
  $("#driveSyncBtn").addEventListener("click", () => cloudSync({ interactive: true }));
  $("#driveDisconnectBtn").addEventListener("click", () => {
    Object.assign(syncCfg, { connected: false, folderId: "", fileId: "", lastSync: 0 });
    accessToken = null; saveSyncCfg(); driveSay("Disconnected. Your data stays on this device.");
    renderDriveControls();
  });
}

// Used by the backup import flow to adopt a Client ID from a restored file.
export function setSyncClientId(id) { syncCfg.clientId = id; saveSyncCfg(); }
