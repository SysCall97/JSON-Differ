// Runs in the Firebase console page itself (MAIN world, before the console's
// own scripts). The console's Realtime Database connection authenticates with
// the signed-in user's credential; we look only at traffic to RTDB hosts,
// pick that credential up and hand it to the extension, so the editor acts
// with exactly the user's own console permissions. Nothing else is read.
(() => {
  if (window.__rtdbTreeCapture) return;
  window.__rtdbTreeCapture = true;

  const RTDB_HOST = /\.(firebaseio\.com|firebasedatabase\.app)$/i;
  const GOOGLE_TOKEN = /ya29\.[0-9A-Za-z_\-.]+/;
  let latest = null;     // { token, kind }

  // What we've observed, for the diagnostics view (no credentials, only shapes)
  const diag = { page: location.pathname, ws: {}, http: {}, lp: {}, frames: 0, authFrames: 0, credKind: null, credPreview: null, at: null };
  let diagTimer = null;
  const postDiag = () => {
    clearTimeout(diagTimer);
    diagTimer = setTimeout(() => window.postMessage({ __rtdbTree: 'diag', diag }, location.origin), 300);
  };

  const hostOf = (url) => { try { return new URL(url, location.href).hostname; } catch { return ''; } };
  const isRtdb = (url) => RTDB_HOST.test(hostOf(url));

  function report(token, kind) {
    if (!token || token.length < 20) return;
    diag.credKind = kind;
    diag.credPreview = `${token.slice(0, 6)}… (${token.length} chars)`;
    diag.at = Date.now();
    postDiag();
    if (latest && latest.token === token) return;
    latest = { token, kind };
    post();
  }
  const post = () => latest && window.postMessage({ __rtdbTree: 'session', token: latest.token, kind: latest.kind }, location.origin);

  // RTDB wire protocol: {"t":"d","d":{"r":1,"a":"auth"|"gauth","b":{"cred":"…"}}}
  function inspect(text) {
    if (typeof text !== 'string' || !text) return;
    if (text.includes('"cred"')) {
      try {
        const o = JSON.parse(text);
        const d = o && o.d;
        if (d && (d.a === 'auth' || d.a === 'gauth') && d.b && typeof d.b.cred === 'string') {
          diag.authFrames++;
          return report(d.b.cred, d.a === 'gauth' ? 'google' : (d.b.cred.startsWith('ya29.') ? 'google' : 'firebase'));
        }
      } catch { /* not a full frame */ }
      const m = /"cred"\s*:\s*"([^"]+)"/.exec(text);
      if (m) { diag.authFrames++; return report(m[1], m[1].startsWith('ya29.') ? 'google' : 'firebase'); }
    }
    const g = GOOGLE_TOKEN.exec(text);
    if (g) report(g[0], 'google');
  }

  // 1) WebSocket
  const wsSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (isRtdb(this.url)) {
        const h = hostOf(this.url);
        diag.ws[h] = (diag.ws[h] || 0) + 1;
        diag.frames++;
        inspect(data);
        postDiag();
      }
    } catch { /* ignore */ }
    return wsSend.apply(this, arguments);
  };

  // 2) fetch / XHR to RTDB REST endpoints
  const noteHttp = (url, authHeader) => {
    const h = hostOf(url);
    diag.http[h] = (diag.http[h] || 0) + 1;
    postDiag();
    try {
      const u = new URL(url, location.href);
      const p = u.searchParams.get('access_token') || u.searchParams.get('auth');
      if (p) report(p, p.startsWith('ya29.') ? 'google' : 'firebase');
    } catch { /* ignore */ }
    if (authHeader) {
      const v = String(authHeader).replace(/^Bearer\s+/i, '');
      if (v !== authHeader || v.startsWith('ya29.')) report(v, 'google');
    }
  };
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      if (url && isRtdb(url)) {
        const h = (init && init.headers) || (input && input.headers);
        const auth = h ? (h instanceof Headers ? h.get('Authorization') : (h.Authorization || h.authorization)) : null;
        noteHttp(url, auth);
      }
    } catch { /* ignore */ }
    return origFetch.apply(this, arguments);
  };
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__rtdbUrl = isRtdb(url) ? String(url) : null;
    this.__rtdbAuth = null;
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__rtdbUrl && /^authorization$/i.test(name)) this.__rtdbAuth = value;
    return xhrHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try { if (this.__rtdbUrl) { noteHttp(this.__rtdbUrl, this.__rtdbAuth); inspect(typeof body === 'string' ? body : ''); } } catch { /* ignore */ }
    return xhrSend.apply(this, arguments);
  };

  // 3) Long-polling fallback: <script src="https://…firebaseio.com/.lp?…&d0=<base64>…">
  const decodeLp = (src) => {
    try {
      const u = new URL(src);
      const h = u.hostname;
      diag.lp[h] = (diag.lp[h] || 0) + 1;
      postDiag();
      const parts = [...u.searchParams.entries()].filter(([k]) => /^d\d+$/.test(k)).sort((a, b) => +a[0].slice(1) - +b[0].slice(1));
      if (!parts.length) return;
      const b64 = parts.map(([, v]) => v).join('').replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '=');
      inspect(atob(b64));
    } catch { /* ignore */ }
  };
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  if (srcDesc && srcDesc.set) {
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      ...srcDesc,
      set(v) { try { if (isRtdb(v)) decodeLp(String(v)); } catch { /* ignore */ } return srcDesc.set.call(this, v); },
    });
  }

  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.tagName === 'SCRIPT' && n.src && isRtdb(n.src)) decodeLp(n.src);
    }
  }).observe(document, { childList: true, subtree: true });

  // The isolated content script asks for the latest state when it starts
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.__rtdbTree === 'hello') { post(); postDiag(); }
    // Make the console's database connection reconnect (and so re-send its
    // session): the Firebase SDK drops and re-opens it on offline/online.
    if (e.data.__rtdbTree === 'nudge') {
      diag.nudges = (diag.nudges || 0) + 1;
      window.dispatchEvent(new Event('offline'));
      setTimeout(() => window.dispatchEvent(new Event('online')), 400);
    }
  });
})();
