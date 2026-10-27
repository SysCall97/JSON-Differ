import { TreeEditor, listChanges, pathLabel } from './tree-editor.js';

// The editor UI, mounted inside a shadow root on the Firebase console page
// (so the console's CSS and ours don't affect each other).
const TEMPLATE = `<div class="rte-root" tabindex="-1">

  <header class="header">
    <div class="brand">
      <img id="brandIcon" alt="" width="18" height="18">
      <h1>Tree editor</h1>
    </div>
    <div class="location">
      <label>Database
        <input id="dbUrl" type="url" placeholder="https://your-db.firebaseio.com" spellcheck="false">
      </label>
      <label class="path-label">Path
        <input id="dbPath" type="text" placeholder="/" spellcheck="false">
      </label>
      <button class="btn btn-secondary" id="fetchBtn" title="Sync now: reload this path from Firebase">↻ Sync</button>
    </div>
    <div class="header-right">
      <span class="session" id="session" title=""><span class="dot"></span><span id="sessionText">No console session</span></span>
    </div>
  </header>

  <div class="toolbar">
    <div class="status-group">
      <div class="status" id="status"><span class="dot"></span><span id="statusText">Not loaded</span></div>
      <button class="sync-chip" id="syncChip" title="Auto-sync: click to turn on/off"><span class="dot"></span><span id="syncText">Auto-sync off</span></button>
    </div>
    <div class="actions">
      <button class="file-btn" id="undoBtn" title="Undo (⌘/Ctrl+Z)" disabled>↶ Undo</button>
      <button class="file-btn" id="redoBtn" title="Redo (⇧⌘Z / Ctrl+Y)" disabled>↷ Redo</button>
      <div class="mode-toggle">
        <button id="modeText">Text</button>
        <button id="modeTree" class="active">Tree</button>
      </div>
      <button class="file-btn" id="historyBtn" title="Snapshots saved before each publish — use them to roll back">History <span class="badge" id="historyCount"></span></button>
      <button class="file-btn" id="revertBtn" title="Discard edits and go back to the loaded server data" disabled>Revert</button>
      <button class="file-btn" id="uploadBtn">Upload</button>
      <input type="file" id="fileInput" accept=".json,application/json" hidden>
      <button class="file-btn" id="downloadBtn">Download</button>
      <button class="btn" id="publishBtn" title="Write this JSON back to the database path" disabled>Publish</button>
    </div>
  </div>

  <div class="notice" id="notice" hidden><span id="noticeText"></span><button class="file-btn" id="noticeLoad">Load latest (discard my edits)</button><button class="file-btn" id="noticeDismiss">Keep editing</button></div>
  <div class="error" id="error"><span id="errorText"></span><button class="file-btn" id="errorAction" hidden></button><button class="file-btn" id="errorDetails" hidden>Copy details</button></div>

  <main class="editor">
    <div id="tree"></div>
    <textarea id="text" spellcheck="false" hidden></textarea>
  </main>

  <div class="toast" id="toast"><span class="toast-dot"></span><span class="toast-msg"></span><button id="toastAction">Undo</button></div>

  <!-- Publish confirmation -->
  <div class="modal-backdrop" id="publishModal" hidden>
    <div class="modal">
      <h2>Publish to Realtime Database?</h2>
      <p class="modal-target">This replaces everything at <code id="pubTarget"></code></p>
      <div class="pub-stats" id="pubStats"></div>
      <ul class="pub-list" id="pubList"></ul>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="pubCancel">Cancel</button>
        <button class="btn btn-danger" id="pubConfirm">Publish</button>
      </div>
    </div>
  </div>

  <!-- Conflict -->
  <div class="modal-backdrop" id="conflictModal" hidden>
    <div class="modal">
      <h2>Data changed on the server</h2>
      <p>Someone (or something) updated this path after you loaded it. Publishing now would overwrite their changes.</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="conflictCancel">Cancel</button>
        <button class="btn btn-secondary" id="conflictReload">Reload server data (lose my edits)</button>
        <button class="btn btn-danger" id="conflictOverwrite">Overwrite anyway</button>
      </div>
    </div>
  </div>

  <!-- History / rollback -->
  <div class="modal-backdrop" id="historyModal" hidden>
    <div class="modal">
      <h2>Snapshots</h2>
      <p>Before every publish, the server's data at the path is saved here on this computer. Load a snapshot, check it, then Publish to roll back.</p>
      <label class="check"><input type="checkbox" id="historyAll"> Show all paths</label>
      <ul class="snap-list" id="snapList"></ul>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="historyClose">Close</button>
      </div>
    </div>
  </div>

</div>
`;

let root;                                     // ShadowRoot
const $ = (id) => root.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const state = {
  mode: 'tree',          // 'tree' | 'text'
  original: undefined,   // last data read from / written to the server
  etag: null,            // ETag of `original` (for conflict detection)
  loadedFrom: null,      // { db, path } the data came from
  loadedAt: null,
};

let tree;

// ---------- Location helpers ----------
function normalizeDb(url) {
  url = (url || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  return url.replace(/\/+$/, '');
}
function normalizePath(p) {
  const parts = (p || '').split('/').map((s) => s.trim()).filter(Boolean);
  return '/' + parts.join('/');
}
function buildUrl(db, path) {
  const segs = normalizePath(path).split('/').filter(Boolean).map(encodeURIComponent);
  return `${normalizeDb(db)}/${segs.join('/')}.json`;
}
function currentLocation() {
  return { db: normalizeDb($('dbUrl').value), path: normalizePath($('dbPath').value) };
}

// ---------- Session ----------
// No sign-in: requests are sent with this console tab's own session (picked up
// from the console's database connection), so the editor can do exactly what
// the user can do in the console. If none has been seen yet, we ask the
// console's connection to reconnect, which makes it send its session again.
async function sessionInfo() {
  return (await chrome.runtime.sendMessage({ type: 'sessionInfo' })) || {};
}

async function refreshSession() {
  const info = await sessionInfo();
  const el = $('session');
  if (info.at) {
    el.className = 'session ok';
    $('sessionText').textContent = 'Console session';
    el.title = `Using this console's session (updated ${new Date(info.at).toLocaleTimeString()})`;
  } else {
    el.className = 'session missing';
    $('sessionText').textContent = 'Connecting…';
    el.title = "Waiting for the console's database connection";
  }
  return !!info.at;
}

let lastNudge = 0;
function nudgeConsole() {
  // Handled by session-capture.js in the page: a quick offline/online blip
  // makes the console's database connection reconnect and re-authenticate.
  if (Date.now() - lastNudge < 8000) return;
  lastNudge = Date.now();
  window.postMessage({ __rtdbTree: 'nudge' }, location.origin);
}

async function ensureSession(timeout = 7000) {
  if (await refreshSession()) return true;
  nudgeConsole();
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    if (await refreshSession()) return true;
  }
  return false;
}

// ---------- REST (proxied through the background worker) ----------
async function rtdb(method, { body, ifMatch, loc } = {}, attempt = 0) {
  const { db, path } = loc || currentLocation();
  if (!db) throw new Error('Enter the database URL first.');
  const res = await chrome.runtime.sendMessage({ type: 'rtdb', method, url: buildUrl(db, path), body, ifMatch });
  if (!res) throw new Error('The extension did not respond. Reload this page.');
  if (res.noSession || (res.status === 401 && !res.manual)) {
    // no session yet, or it expired: get a fresh one from the console and retry once
    if (attempt < 3 && await ensureSession()) return rtdb(method, { body, ifMatch, loc }, attempt + 1);
    const err = new Error("Couldn't pick up this console's database session. Reload the page and try again.");
    err.noSession = true;
    throw err;
  }
  if (res.ok) return { data: res.data, etag: res.etag };

  const msg = (res.data && res.data.error) || res.text || res.statusText || 'Request failed';
  // Database lives in another region → the error names the right URL
  const region = /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app/i.exec(msg);
  if (region && normalizeDb(region[0]) !== db && attempt < 2) {
    if (!loc) $('dbUrl').value = normalizeDb(region[0]);
    return rtdb(method, { body, ifMatch, loc: loc ? { ...loc, db: normalizeDb(region[0]) } : undefined }, attempt + 1);
  }
  const err = new Error(friendlyError(res.status, msg));
  err.status = res.status;
  throw err;
}

function friendlyError(status, msg) {
  if (status === 401) return 'Console session expired. Reload this page, then Sync again.';
  if (status === 403 || /permission denied/i.test(msg)) return `Permission denied — your account can't ${'access'} this path (same as in the console).\n(${msg})`;
  if (status === 404) return `Database not found. Check the database URL.\n(${msg})`;
  return `${status}: ${msg}`;
}

// ---------- Load / publish ----------
async function fetchData({ keepHistory = false, force = false } = {}) {
  if (!force && isDirty() && !confirm('You have unpublished changes. Discard them and fetch from the server?')) return;
  setBusy('Fetching…', $('fetchBtn'));
  try {
    const { data, etag } = await rtdb('GET');
    applyServerData(data, etag, keepHistory);
    showError('');
    if (data === null) showToast('No data at this path yet — edit the <code>null</code> value to create it.', '#58a6ff', null);
  } catch (e) {
    showError(e.message, e.noSession
      ? { action: { label: 'Reload page', fn: () => location.reload() }, details: true }
      : {});
  } finally {
    setBusy(null, $('fetchBtn'));
    refreshStatus();
  }
}

function applyServerData(data, etag, keepHistory) {
  state.original = data;
  state.etag = etag;
  state.loadedFrom = currentLocation();
  state.loadedAt = new Date();
  state.rollbackOf = null;
  state.remote = null;
  $('notice').hidden = true;
  tree.load(clone(data), { resetHistory: !keepHistory });
  syncText();
  refreshHistoryCount();
  const key = state.loadedFrom.db + state.loadedFrom.path;
  if (sync.key !== key) startSync();
}

function openPublish() {
  let data;
  try { data = currentValue(); } catch (e) { return showError(e.message); }
  if (state.loadedFrom === null) return showError('Fetch the data first, so changes can be checked before publishing.');
  const loc = currentLocation();
  if (loc.db !== state.loadedFrom.db || loc.path !== state.loadedFrom.path) {
    return showError(`Database or path changed since loading (${state.loadedFrom.path}). Fetch again before publishing.`);
  }
  const changes = listChanges(state.original, data);
  if (!changes.length) return showToast('Nothing to publish — no changes.', '#8b949e', null);

  const counts = { added: 0, removed: 0, modified: 0 };
  changes.forEach((c) => counts[c.type]++);
  $('pubTarget').textContent = `${loc.db}${loc.path}`;
  let warn = '';
  if (loc.path === '/') warn += '<p style="color:#ff7b72">⚠ This is the database root — the whole database will be replaced.</p>';
  if (data === null) warn += '<p style="color:#ff7b72">⚠ The value is null — this deletes the path.</p>';
  $('pubStats').innerHTML = `
    <span><i style="background:#3fb950"></i>${counts.added} added</span>
    <span><i style="background:#d29922"></i>${counts.modified} modified</span>
    <span><i style="background:#f85149"></i>${counts.removed} removed</span>${warn}`;
  const short = (v) => { const s = JSON.stringify(v); return s.length > 80 ? s.slice(0, 77) + '…' : s; };
  const items = changes.slice(0, 200).map((c) => {
    const p = esc(pathLabel(c.path));
    if (c.type === 'added') return `<li class="added">+ ${p}: ${esc(short(c.value))}</li>`;
    if (c.type === 'removed') return `<li class="removed">− ${p}</li>`;
    return `<li class="modified">~ ${p}: ${esc(short(c.oldValue))} → ${esc(short(c.value))}</li>`;
  });
  if (changes.length > 200) items.push(`<li class="more">…and ${changes.length - 200} more</li>`);
  $('pubList').innerHTML = items.join('');
  $('publishModal').hidden = false;
  $('pubConfirm').focus();
}

async function publish(force = false) {
  $('publishModal').hidden = true;
  $('conflictModal').hidden = true;
  state.publishing = true;
  let data;
  try { data = currentValue(); } catch (e) { return showError(e.message); }
  setBusy('Publishing…', $('publishBtn'));
  let snap = null;
  try {
    // Save what is on the server right now, so this publish can be rolled back.
    // Normal publish: the ETag check guarantees the server still holds state.original.
    // Forced overwrite: the server changed, so read its current value first.
    const before = force ? (await rtdb('GET')).data : state.original;
    snap = await saveSnapshot(state.loadedFrom, before, state.rollbackOf ? 'Before rollback' : 'Before publish');
    await rtdb('PUT', { body: data, ifMatch: force ? null : state.etag });
    state.rollbackOf = null;
    // Re-read so the editor shows exactly what the server stored (RTDB drops empty objects, etc.)
    const fresh = await rtdb('GET');
    const normalized = JSON.stringify(fresh.data) !== JSON.stringify(data);
    applyServerData(fresh.data, fresh.etag, true);
    showError('');
    showToast((normalized
      ? 'Published. The server dropped empty objects/arrays or nulls — showing what was stored.'
      : `Published to <code>${esc(state.loadedFrom.path)}</code>.`) + ' Previous data saved.',
      '#3fb950', { label: 'Roll back', fn: () => loadSnapshot(snap.id, { publish: true }) });
    refreshHistoryCount();
  } catch (e) {
    if (snap) { await deleteSnapshot(snap.id); snap = null; }   // nothing was written
    if (e.status === 412) {
      $('conflictModal').hidden = false;
    } else {
      showError(e.message);
    }
  } finally {
    state.publishing = false;
    setBusy(null, $('publishBtn'));
    refreshStatus();
  }
}

// ---------- Snapshots (rollback) ----------
// Stored in chrome.storage.local (unlimitedStorage): an index plus one key per snapshot.
const MAX_PER_PATH = 30;

async function snapIndex() {
  const { snapIndex } = await chrome.storage.local.get('snapIndex');
  return snapIndex || [];
}

async function saveSnapshot(loc, data, label) {
  const json = JSON.stringify(data === undefined ? null : data);
  const meta = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, db: loc.db, path: loc.path, at: Date.now(), label, size: json.length };
  let index = await snapIndex();
  index.push(meta);
  // keep the newest MAX_PER_PATH per db+path
  const same = index.filter((m) => m.db === loc.db && m.path === loc.path).sort((a, b) => b.at - a.at);
  const drop = same.slice(MAX_PER_PATH).map((m) => m.id);
  index = index.filter((m) => !drop.includes(m.id));
  await chrome.storage.local.set({ snapIndex: index, [`snap:${meta.id}`]: json });
  if (drop.length) await chrome.storage.local.remove(drop.map((id) => `snap:${id}`));
  return meta;
}

async function readSnapshot(id) {
  const key = `snap:${id}`;
  const got = await chrome.storage.local.get(key);
  return got[key] === undefined ? undefined : JSON.parse(got[key]);
}

async function deleteSnapshot(id) {
  const index = (await snapIndex()).filter((m) => m.id !== id);
  await chrome.storage.local.set({ snapIndex: index });
  await chrome.storage.local.remove(`snap:${id}`);
}

async function refreshHistoryCount() {
  const loc = currentLocation();
  const n = (await snapIndex()).filter((m) => m.db === loc.db && m.path === loc.path).length;
  $('historyCount').textContent = n ? String(n) : '';
}

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

async function renderHistory() {
  const loc = currentLocation();
  const all = $('historyAll').checked;
  const list = (await snapIndex())
    .filter((m) => all || (m.db === loc.db && m.path === loc.path))
    .sort((a, b) => b.at - a.at);
  const ul = $('snapList');
  if (!list.length) {
    ul.innerHTML = `<li class="empty">${all ? 'No snapshots yet.' : 'No snapshots for this path yet — one is saved automatically before each publish.'}</li>`;
    return;
  }
  const latestId = {};
  list.forEach((m) => { const k = m.db + m.path; if (!latestId[k]) latestId[k] = m.id; });
  ul.innerHTML = list.map((m) => `
    <li class="${latestId[m.db + m.path] === m.id ? 'latest' : ''}">
      <div class="snap-info">
        <span class="snap-title">${esc(m.label)} · ${new Date(m.at).toLocaleString()}</span>
        <span class="snap-meta" title="${esc(m.db + m.path)}">${all ? esc(m.db.replace(/^https:\/\//, '') + m.path) + ' · ' : ''}${fmtSize(m.size)}</span>
      </div>
      <div class="snap-actions">
        <button class="file-btn" data-act="load" data-id="${m.id}" title="Load into the editor (then Publish to roll back)">Load</button>
        <button class="file-btn" data-act="download" data-id="${m.id}">Download</button>
        <button class="file-btn" data-act="delete" data-id="${m.id}" title="Delete snapshot">✕</button>
      </div>
    </li>`).join('');
}

// Put a snapshot into the editor. With publish: true, go straight to the publish preview.
async function loadSnapshot(id, { publish: andPublish = false } = {}) {
  const meta = (await snapIndex()).find((m) => m.id === id);
  const data = await readSnapshot(id);
  if (!meta || data === undefined) return showError('Snapshot not found.');
  const loc = currentLocation();
  if (meta.db !== loc.db || meta.path !== loc.path) {
    if (isDirty() && !confirm('Switch to the snapshot\'s path? Unpublished changes here will be lost.')) return;
    $('dbUrl').value = meta.db;
    $('dbPath').value = meta.path;
    await fetchData({ force: true });          // need the current server data + ETag for that path
    if (state.loadedFrom === null) return;
  }
  $('historyModal').hidden = true;
  if (state.mode === 'text') setMode('tree');
  tree.replace(clone(data));
  state.rollbackOf = id;
  showToast(`Loaded snapshot from ${new Date(meta.at).toLocaleString()}. Review it, then Publish to roll back.`, '#58a6ff',
    { label: 'Publish', fn: openPublish });
  if (andPublish) openPublish();
}

// ---------- Mode / text sync ----------
function currentValue() {
  if (state.mode === 'text') {
    const text = $('text').value.trim();
    if (!text) throw new Error('The JSON is empty.');
    try { return JSON.parse(text); } catch (e) { throw new Error(`Invalid JSON: ${e.message}`); }
  }
  return tree.value;
}

function syncText() {
  $('text').value = tree.value === undefined ? '' : JSON.stringify(tree.value, null, 2);
}

function setMode(mode) {
  if (mode === state.mode) return;
  if (mode === 'tree') {
    const text = $('text').value.trim();
    if (text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { return showError(`Invalid JSON: ${e.message}`); }
      if (JSON.stringify(parsed) !== JSON.stringify(tree.value)) {
        tree.replace(parsed, { flash: false });   // text edits become one undoable step
      }
    }
  }
  state.mode = mode;
  $('tree').hidden = mode !== 'tree';
  $('text').hidden = mode !== 'text';
  $('modeTree').classList.toggle('active', mode === 'tree');
  $('modeText').classList.toggle('active', mode === 'text');
  showError('');
  refreshStatus();
}

// ---------- Status ----------
function isDirty() {
  if (state.loadedFrom === null) return false;
  try { return JSON.stringify(currentValue()) !== JSON.stringify(state.original); } catch { return true; }
}

let statusTimer;
function refreshStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    const el = $('status');
    if (el.classList.contains('busy')) return;
    $('undoBtn').disabled = state.mode !== 'tree' || !tree.canUndo;
    $('redoBtn').disabled = state.mode !== 'tree' || !tree.canRedo;
    const loaded = state.loadedFrom !== null;
    $('publishBtn').disabled = !loaded;
    if (!loaded) {
      el.className = 'status';
      $('statusText').textContent = tree.value === undefined ? 'Not loaded' : 'Local JSON (not linked to a database path)';
      $('revertBtn').disabled = true;
      return;
    }
    const time = state.loadedAt.toLocaleTimeString();
    let changes = 0;
    try { changes = listChanges(state.original, currentValue()).length; } catch { changes = -1; }
    $('revertBtn').disabled = changes === 0;
    if (changes === 0) {
      el.className = 'status clean';
      $('statusText').textContent = `In sync with ${state.loadedFrom.path} · loaded ${time}`;
    } else {
      el.className = 'status dirty';
      $('statusText').textContent = changes < 0
        ? 'Text has invalid JSON'
        : `${changes} unpublished change${changes > 1 ? 's' : ''} · ${state.loadedFrom.path}`;
    }
  }, 120);
}

function setBusy(label, btn) {
  const el = $('status');
  if (label) {
    el.className = 'status busy';
    $('statusText').textContent = label;
    btn && btn.classList.add('loading');
  } else {
    el.classList.remove('busy');
    btn && btn.classList.remove('loading');
  }
}

// ---------- UI helpers ----------
function showError(msg, { action, details } = {}) {
  const el = $('error');
  $('errorText').textContent = msg;
  el.classList.toggle('visible', !!msg);
  const a = $('errorAction');
  a.hidden = !action;
  if (action) { a.textContent = action.label; a.onclick = action.fn; }
  $('errorDetails').hidden = !details;
}

async function copyDetails() {
  const d = await chrome.runtime.sendMessage({ type: 'getDiag' });
  const text = JSON.stringify({ ...d, consoleUrl: location.pathname, dbUrl: $('dbUrl').value, path: $('dbPath').value }, null, 2);
  await navigator.clipboard.writeText(text);
  showToast('Connection details copied (no credentials included).', '#3fb950', null);
}

function showToast(html, color, action) {
  const t = $('toast');
  t.querySelector('.toast-msg').innerHTML = html;
  t.querySelector('.toast-dot').style.background = color;
  const btn = $('toastAction');
  btn.textContent = action ? action.label : '';
  btn.onclick = () => { t.classList.remove('visible'); action && action.fn(); };
  t.classList.add('visible');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('visible'), 4000);
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function download() {
  let data;
  try { data = currentValue(); } catch (e) { return showError(e.message); }
  if (data === undefined) return showError('Nothing to download.');
  const loc = currentLocation();
  const base = (loc.path === '/' ? (loc.db.replace(/^https?:\/\//, '').split('.')[0] || 'data') : loc.path.split('/').filter(Boolean).join('_')) || 'data';
  downloadJson(data, `${base}.json`);
}

function downloadJson(data, name) {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Live sync ----------
// Keeps the editor in step with Firebase. Uses the Realtime Database streaming
// API (server-sent events) as a change signal; each change triggers one GET so
// the data and its ETag are exactly what the REST API returns. Falls back to
// polling every 10 s if streaming isn't available.
const sync = { enabled: true, mode: 'off', es: null, poll: null, timer: null, busy: false, again: false, fails: 0, key: '' };
const POLL_MS = 10000;

function setSyncMode(mode) {
  sync.mode = mode;
  const chip = $('syncChip');
  chip.className = `sync-chip ${mode}`;
  const text = {
    live: ['Live', 'Auto-sync on: changes made in Firebase appear here right away. Click to turn off.'],
    connecting: ['Connecting…', 'Connecting to Firebase for live updates…'],
    polling: ['Auto-sync · 10 s', 'Live updates unavailable; checking Firebase every 10 seconds. Click to turn off.'],
    off: ['Auto-sync off', 'Auto-sync is off. Click to turn it on, or use ↻ Sync.'],
  }[mode];
  $('syncText').textContent = text[0];
  chip.title = text[1];
}

function stopSync() {
  if (sync.es) { sync.es.close(); sync.es = null; }
  clearInterval(sync.poll); sync.poll = null;
  clearTimeout(sync.timer);
  sync.key = '';
}

async function startSync() {
  stopSync();
  if (!sync.enabled || !state.loadedFrom) return setSyncMode('off');
  const loc = state.loadedFrom;
  const key = loc.db + loc.path;
  sync.key = key;
  setSyncMode('connecting');
  let tok = await chrome.runtime.sendMessage({ type: 'sessionToken' });
  if (!tok && await ensureSession()) tok = await chrome.runtime.sendMessage({ type: 'sessionToken' });
  if (sync.key !== key) return;
  if (!tok || typeof EventSource === 'undefined') return startPolling(key);
  const url = new URL(buildUrl(loc.db, loc.path));
  url.searchParams.set(tok.kind === 'firebase' ? 'auth' : 'access_token', tok.token);
  let es;
  try { es = new EventSource(url.toString()); } catch { return startPolling(key); }
  sync.es = es;
  const onEvent = () => { sync.fails = 0; if (sync.mode !== 'live') setSyncMode('live'); scheduleSync(); };
  es.addEventListener('put', onEvent);
  es.addEventListener('patch', onEvent);
  es.addEventListener('keep-alive', () => { if (sync.mode !== 'live') setSyncMode('live'); });
  es.addEventListener('auth_revoked', () => { es.close(); retryStream(key); });   // token expired
  es.addEventListener('cancel', () => { es.close(); startPolling(key); });       // e.g. permission change
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) retryStream(key);
    else setSyncMode('connecting');                                              // browser is reconnecting
  };
}

function retryStream(key) {
  if (sync.key !== key) return;
  sync.fails++;
  if (sync.fails > 2) return startPolling(key);
  clearTimeout(sync.timer);
  sync.timer = setTimeout(async () => { await ensureSession(); if (sync.key === key) startSync(); }, 1500 * sync.fails);
}

function startPolling(key) {
  if (sync.key !== key) return;
  if (sync.es) { sync.es.close(); sync.es = null; }
  clearInterval(sync.poll);
  setSyncMode('polling');
  let n = 0;
  sync.poll = setInterval(() => {
    syncFromServer();
    if (++n % 6 === 0) { sync.fails = 0; startSync(); }   // try live updates again every minute
  }, POLL_MS);
}

function scheduleSync() {
  clearTimeout(sync.timer);
  sync.timer = setTimeout(syncFromServer, 350);
}

async function syncFromServer({ manual = false } = {}) {
  const loc = state.loadedFrom;
  if (!loc) return;
  if (sync.busy || state.publishing) { sync.again = true; return; }
  sync.busy = true;
  try {
    const { data, etag } = await rtdb('GET', { loc });
    if (state.loadedFrom !== loc) return;
    if (JSON.stringify(data) === JSON.stringify(state.original)) {
      if (etag) state.etag = etag;
      if (manual) showToast('Already up to date.', '#3fb950', null);
      return;
    }
    if (!isDirty()) {
      const changes = listChanges(state.original, data);
      state.original = data;
      state.etag = etag;
      state.loadedAt = new Date();
      if (state.mode === 'text') { tree.root = clone(data); syncText(); }
      else { tree.refresh(clone(data), changes.map((c) => c.path)); syncText(); }
      showToast(`Updated from Firebase · ${changes.length} change${changes.length === 1 ? '' : 's'}`, '#58a6ff', null);
      refreshStatus();
    } else {
      // Don't overwrite the user's edits: tell them, and let them choose
      state.remote = { data, etag };
      $('noticeText').textContent = 'This node changed in Firebase while you were editing.';
      $('notice').hidden = false;
    }
  } catch (e) {
    if (manual) showError(e.message);
  } finally {
    sync.busy = false;
    if (sync.again) { sync.again = false; scheduleSync(); }
  }
}

// ---------- Mount / open ----------
/** Build the editor inside `shadowRoot`. Call once. */
export function mount(shadowRoot) {
  root = shadowRoot;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = chrome.runtime.getURL('panel.css');
  root.appendChild(style);
  const wrap = document.createElement('div');
  wrap.innerHTML = TEMPLATE;
  root.appendChild(wrap.firstElementChild);
  $('brandIcon').src = chrome.runtime.getURL('icons/icon48.png');

  tree = new TreeEditor($('tree'), {
    onChange: () => { syncText(); refreshStatus(); },
    onError: showError,
    onToast: showToast,
  });
  tree.load(undefined);

  // ---------- Wiring ----------
  $('fetchBtn').addEventListener('click', () => {
    const loc = currentLocation(), loaded = state.loadedFrom;
    // Same node already loaded: sync it (keeps your edits if you have any); otherwise load the typed path
    if (loaded && loc.db === loaded.db && loc.path === loaded.path) {
      if (isDirty()) return fetchData();          // asks before discarding edits
      return syncFromServer({ manual: true });
    }
    fetchData();
  });
  $('syncChip').addEventListener('click', () => {
    sync.enabled = !sync.enabled;
    chrome.storage.local.set({ autoSync: sync.enabled });
    if (sync.enabled) { startSync(); showToast('Auto-sync on.', '#3fb950', null); }
    else { stopSync(); setSyncMode('off'); showToast('Auto-sync off — use ↻ Sync to refresh.', '#8b949e', null); }
  });
  $('noticeLoad').addEventListener('click', () => {
    if (!state.remote) return;
    applyServerData(state.remote.data, state.remote.etag, false);
    showToast('Loaded the latest data from Firebase.', '#58a6ff', null);
    refreshStatus();
  });
  $('noticeDismiss').addEventListener('click', () => { $('notice').hidden = true; });
  chrome.storage.local.get('autoSync').then(({ autoSync }) => {
    sync.enabled = autoSync !== false;
    if (!sync.enabled) setSyncMode('off');
  });
  setSyncMode('off');
  $('dbPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchData(); });
  $('dbUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchData(); });
  $('publishBtn').addEventListener('click', openPublish);
  $('pubCancel').addEventListener('click', () => { $('publishModal').hidden = true; });
  $('pubConfirm').addEventListener('click', () => publish(false));
  $('conflictCancel').addEventListener('click', () => { $('conflictModal').hidden = true; });
  $('conflictOverwrite').addEventListener('click', () => publish(true));
  $('conflictReload').addEventListener('click', () => { $('conflictModal').hidden = true; fetchData({ force: true }); });
  $('undoBtn').addEventListener('click', () => tree.undo());
  $('redoBtn').addEventListener('click', () => tree.redo());
  $('modeTree').addEventListener('click', () => setMode('tree'));
  $('modeText').addEventListener('click', () => setMode('text'));
  $('text').addEventListener('input', refreshStatus);
  $('revertBtn').addEventListener('click', () => {
    if (!confirm('Discard all unpublished changes?')) return;
    if (state.mode === 'text') setMode('tree');
    tree.replace(clone(state.original));
    showToast('Reverted to the loaded server data.', '#d29922', { label: 'Undo', fn: () => tree.undo() });
  });
  $('downloadBtn').addEventListener('click', download);
  $('uploadBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((text) => {
      let parsed;
      try { parsed = JSON.parse(text); } catch (err) { return showError(`${file.name}: invalid JSON (${err.message})`); }
      if (state.mode === 'text') setMode('tree');
      tree.replace(parsed);
      showToast(`Loaded <code>${esc(file.name)}</code> into the editor (not published yet).`, '#58a6ff', { label: 'Undo', fn: () => tree.undo() });
    });
    e.target.value = '';
  });

  $('errorDetails').addEventListener('click', copyDetails);
  // Keys only while focus is inside the editor, so the console's own shortcuts keep working.
  // Esc closes modals; ⌘/Ctrl+Z undo, ⇧⌘Z / Ctrl+Y redo (tree, not while typing), ⌘/Ctrl+S publish.
  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { root.querySelectorAll('.modal-backdrop').forEach((m) => { m.hidden = true; }); return; }
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); openPublish(); return; }
    const target = e.composedPath()[0];
    if (state.mode !== 'tree' || (target.closest && target.closest('input, textarea'))) return;
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); tree.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); tree.redo(); }
  });

  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  setInterval(() => { if (root.host.isConnected && root.host.style.display !== 'none') refreshSession(); }, 4000);


  $('historyBtn').addEventListener('click', async () => {
    await renderHistory();
    $('historyModal').hidden = false;
  });
  $('historyClose').addEventListener('click', () => { $('historyModal').hidden = true; });
  $('historyAll').addEventListener('change', renderHistory);
  $('snapList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'load') return loadSnapshot(id);
    if (btn.dataset.act === 'download') {
      const meta = (await snapIndex()).find((m) => m.id === id);
      const data = await readSnapshot(id);
      const name = `${(meta.path.split('/').filter(Boolean).join('_') || 'root')}-${new Date(meta.at).toISOString().replace(/[:.]/g, '-')}.json`;
      return downloadJson(data, name);
    }
    if (btn.dataset.act === 'delete') {
      if (!confirm('Delete this snapshot? You will not be able to roll back to it.')) return;
      await deleteSnapshot(id);
      renderHistory();
      refreshHistoryCount();
    }
  });


  refreshSession();
}

/**
 * Show data for { db, path }. Re-fetches when the path changed, unless there
 * are unpublished edits (those are kept until the user fetches).
 */
export function open({ db, path }) {
  db = normalizeDb(db);
  path = normalizePath(path);
  refreshSession();
  const loaded = state.loadedFrom;
  if (loaded && loaded.db === db && loaded.path === path) return;     // same node: keep everything
  if (loaded && isDirty()) {
    showToast(`Showing your unpublished edits for <code>${esc(loaded.path)}</code>.`, '#d29922',
      { label: `Open ${esc(path)}`, fn: () => { $('dbUrl').value = db; $('dbPath').value = path; fetchData(); } });
    return;
  }
  $('dbUrl').value = db;
  $('dbPath').value = path;
  fetchData({ force: true });
}

export { isDirty };
