// Background worker:
//  - keeps the latest console session token (memory only: chrome.storage.session)
//  - performs Realtime Database REST calls for the in-console editor
//  - toolbar icon toggles the editor on a Firebase console tab

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg) return;
  if (msg.type === 'session' && typeof msg.token === 'string') {
    saveSession(msg.token, msg.kind, 'page');
    return;
  }
  if (msg.type === 'diag') {
    chrome.storage.session.get('diag').then(({ diag }) => {
      const all = diag || {};
      all[msg.frame] = { ...msg.diag, received: Date.now() };
      chrome.storage.session.set({ diag: all });
    });
    return;
  }
  if (msg.type === 'getDiag') {
    chrome.storage.session.get(['diag', 'consoleSession', 'seenRequests']).then(({ diag, consoleSession, seenRequests: seen }) => reply({
      diag: diag || {},
      requests: seen || {},
      session: consoleSession ? { kind: consoleSession.kind, source: consoleSession.source, at: consoleSession.at, preview: `${consoleSession.token.slice(0, 6)}… (${consoleSession.token.length} chars)` } : null,
      version: chrome.runtime.getManifest().version,
    }));
    return true;
  }
  if (msg.type === 'sessionInfo') {
    sessionInfo().then(reply);
    return true;
  }
  if (msg.type === 'rtdb') {
    rtdb(msg).then(reply, (e) => reply({ ok: false, status: 0, text: String(e && e.message || e) }));
    return true;
  }
});

async function getToken() {
  const { consoleSession } = await chrome.storage.session.get('consoleSession');
  if (consoleSession && consoleSession.token) return { token: consoleSession.token, manual: false, kind: consoleSession.kind || 'google' };
  return null;
}

async function sessionInfo() {
  const { consoleSession } = await chrome.storage.session.get('consoleSession');
  return { manual: false, at: consoleSession ? consoleSession.at : null };
}

const RTDB_URL = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)?\.(firebaseio\.com|firebasedatabase\.app)\//i;

async function rtdb({ method, url, body, ifMatch }) {
  if (!RTDB_URL.test(url) || !['GET', 'PUT'].includes(method)) return { ok: false, status: 0, text: 'Blocked request' };
  const auth = await getToken();
  if (!auth) return { ok: false, noSession: true };
  // Google OAuth access tokens go in the Authorization header;
  // Firebase ID tokens go in the ?auth= query parameter.
  const headers = {};
  if (auth.kind === 'google') headers.Authorization = `Bearer ${auth.token}`;
  else { const u = new URL(url); u.searchParams.set('auth', auth.token); url = u.toString(); }
  if (method === 'GET') headers['X-Firebase-ETag'] = 'true';
  if (ifMatch) headers['if-match'] = ifMatch;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = undefined; }
  if (res.status === 401 && !auth.manual) {
    // expired: forget it; the console sends a fresh one when it reconnects
    const { consoleSession } = await chrome.storage.session.get('consoleSession');
    if (consoleSession && consoleSession.token === auth.token) await chrome.storage.session.remove('consoleSession');
  }
  return { ok: res.ok, status: res.status, statusText: res.statusText, data, text, etag: res.headers.get('ETag'), manual: auth.manual };
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'toggleTree' });
    if (res && res.ok) return;
  } catch { /* not a console tab */ }
  chrome.tabs.create({ url: 'https://console.firebase.google.com/' });
});

function saveSession(token, kind, source) {
  if (!token || token.length < 20) return;
  chrome.storage.session.set({
    consoleSession: { token, kind: kind || (token.startsWith('ya29.') ? 'google' : 'firebase'), source, at: Date.now() },
  });
}

// Also watch requests the console (page, iframes or workers) sends to the
// database hosts: their URL or Authorization header can carry the session.
// Requests made by this extension itself are ignored.
const seenRequests = {};
chrome.webRequest.onBeforeSendHeaders.addListener((d) => {
  if (d.tabId < 0 || (d.initiator && !d.initiator.startsWith('https://console.firebase.google.com'))) return;
  const key = `${d.type} ${new URL(d.url).hostname}`;
  seenRequests[key] = (seenRequests[key] || 0) + 1;
  chrome.storage.session.set({ seenRequests });
  try {
    const u = new URL(d.url);
    const p = u.searchParams.get('access_token') || u.searchParams.get('auth');
    if (p) return saveSession(p, null, `request:${d.type}`);
  } catch { /* ignore */ }
  const auth = (d.requestHeaders || []).find((h) => h.name.toLowerCase() === 'authorization');
  if (auth && /^Bearer\s+/i.test(auth.value)) saveSession(auth.value.replace(/^Bearer\s+/i, ''), 'google', `header:${d.type}`);
}, { urls: ['https://*.firebaseio.com/*', 'https://*.firebasedatabase.app/*', 'wss://*.firebaseio.com/*', 'wss://*.firebasedatabase.app/*'] }, ['requestHeaders', 'extraHeaders']);
