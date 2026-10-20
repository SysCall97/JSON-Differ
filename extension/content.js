// Runs on console.firebase.google.com.
// 1. Relays the console session token (captured by session-capture.js) to the extension.
// 2. On Realtime Database pages, adds a "Tree editor" tab next to Data / Rules / …
//    and shows the editor in place of the tab content (no new browser tab).

(() => {
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    try {
      if (e.data.__rtdbTree === 'session' && e.data.token) {
        chrome.runtime.sendMessage({ type: 'session', token: e.data.token, kind: e.data.kind });
      } else if (e.data.__rtdbTree === 'diag' && e.data.diag) {
        chrome.runtime.sendMessage({ type: 'diag', diag: e.data.diag, frame: window === window.top ? 'top' : location.href });
      }
    } catch { /* extension reloaded */ }
  });
  window.postMessage({ __rtdbTree: 'hello' }, location.origin);

  if (window !== window.top) return;   // UI only in the top frame

  // /project/<id>/database/<instance>/<section>/<encoded path>
  const DB_PAGE = /\/project\/([^/]+)\/database\/([^/]+)(?:\/([a-z]+))?(?:\/([^?#]*))?/;
  const TAB_LABEL = 'Tree editor';

  let host = null;          // shadow host for the editor
  let panel = null;         // panel.js module
  let active = false;
  let ourTab = null;
  let fallbackBtn = null;
  let suppressed = [];      // [el, removedClasses, ariaSelected] of the console's active tab
  let lastPath = '/';

  // ---------- context ----------
  function decodeConsolePath(raw) {
    if (!raw) return '/';
    let s = raw.replace(/~([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    try { s = decodeURIComponent(s); } catch { /* keep */ }
    return '/' + s.split('/').filter(Boolean).join('/');
  }

  function findDbUrl(instance) {
    const text = document.body ? document.body.innerText : '';
    const re = /https:\/\/([a-z0-9-]+)(?:\.[a-z0-9-]+)?\.(?:firebaseio\.com|firebasedatabase\.app)/gi;
    let m;
    while ((m = re.exec(text))) if (m[1] === instance) return m[0];
    for (const a of document.querySelectorAll('a[href*="firebaseio.com"], a[href*="firebasedatabase.app"]')) {
      try { const u = new URL(a.href); if (u.hostname.split('.')[0] === instance) return u.origin; } catch { /* skip */ }
    }
    return `https://${instance}.firebaseio.com`;   // editor follows the "other region" error if needed
  }

  function getContext() {
    const m = DB_PAGE.exec(location.pathname);
    if (!m) return null;
    const instance = decodeURIComponent(m[2]);
    if (m[3] === 'data') lastPath = decodeConsolePath(m[4]);
    return { project: m[1], instance, db: findDbUrl(instance), path: lastPath, section: m[3] || 'data' };
  }

  // ---------- console tab bar ----------
  const label = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = (el) => el.getClientRects().length > 0;

  function findTabBar() {
    const cands = [...document.querySelectorAll('a[href], [role="tab"], button')].filter(visible);
    const dataTab = cands.find((el) => label(el) === 'data' && !el.closest('[data-rte-tab]'));
    const rulesTab = cands.find((el) => label(el) === 'rules');
    if (!dataTab || !rulesTab) return null;
    let bar = dataTab.parentElement;
    while (bar && !bar.contains(rulesTab)) bar = bar.parentElement;
    if (!bar) return null;
    const itemOf = (el) => { let x = el; while (x.parentElement !== bar) x = x.parentElement; return x; };
    return { bar, dataItem: itemOf(dataTab), rulesItem: itemOf(rulesTab) };
  }

  function makeTab(rulesItem) {
    const tab = rulesItem.cloneNode(true);
    const all = [tab, ...tab.querySelectorAll('*')];
    for (const el of all) {
      el.removeAttribute('id');
      el.removeAttribute('href');
      el.removeAttribute('aria-selected');
      el.removeAttribute('aria-current');
      el.removeAttribute('aria-controls');
      for (const a of [...el.attributes]) if (/^(ng|_ng|routerlink)/i.test(a.name)) el.removeAttribute(a.name);
      [...el.classList].filter((c) => /active|selected/i.test(c)).forEach((c) => el.classList.remove(c));
    }
    // Replace the visible "Rules" text
    const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
    let replaced = false;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue.trim().toLowerCase() === 'rules') { n.nodeValue = n.nodeValue.replace(/rules/i, TAB_LABEL); replaced = true; break; }
    }
    if (!replaced) tab.textContent = TAB_LABEL;
    tab.setAttribute('data-rte-tab', '');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('tabindex', '0');
    tab.title = 'Edit this node as a JSON tree';
    tab.style.cursor = 'pointer';
    const go = (e) => { e.preventDefault(); e.stopPropagation(); activate(); };
    tab.addEventListener('click', go, true);
    tab.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); });
    return tab;
  }

  function ensureTab() {
    const found = findTabBar();
    if (!found) return false;
    const { bar, dataItem, rulesItem } = found;
    if (ourTab && ourTab.isConnected && ourTab.parentElement === bar) return true;
    ourTab = makeTab(rulesItem);
    dataItem.after(ourTab);
    if (!bar.__rteBound) {
      bar.__rteBound = true;
      // Clicking any console tab leaves the tree editor
      bar.addEventListener('click', (e) => {
        if (active && !e.target.closest('[data-rte-tab]')) deactivate();
      }, true);
    }
    if (active) markActive(true);
    return true;
  }

  // Swap the console's "active" look onto our tab while the editor is open
  function markActive(on) {
    if (!ourTab) return;
    ourTab.classList.toggle('rte-tab-active', on);
    ourTab.setAttribute('aria-selected', String(on));
    if (on) {
      const bar = ourTab.parentElement;
      suppressed = [];
      for (const el of bar.querySelectorAll('*')) {
        if (el.closest('[data-rte-tab]')) continue;
        const cls = [...el.classList].filter((c) => /active|selected/i.test(c));
        const sel = el.getAttribute('aria-selected');
        if (cls.length || sel === 'true') {
          suppressed.push([el, cls, sel]);
          cls.forEach((c) => el.classList.remove(c));
          if (sel === 'true') el.setAttribute('aria-selected', 'false');
        }
      }
    } else {
      for (const [el, cls, sel] of suppressed) {
        cls.forEach((c) => el.classList.add(c));
        if (sel !== null) el.setAttribute('aria-selected', sel);
      }
      suppressed = [];
    }
  }

  // ---------- panel ----------
  async function ensurePanel() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'rtdb-tree-editor-host';
    host.style.display = 'none';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    panel = await import(chrome.runtime.getURL('panel.js'));
    panel.mount(shadow);
  }

  // Cover the area under the tab bar (or most of the window if no tab bar was found)
  function place() {
    if (!host || !active) return;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let top = 72, left = 24, width = vw - 48;
    if (ourTab && ourTab.isConnected) {
      let box = ourTab.parentElement;
      while (box.parentElement && box.getBoundingClientRect().width < 480) box = box.parentElement;
      const r = box.getBoundingClientRect();
      top = Math.max(ourTab.parentElement.getBoundingClientRect().bottom, 0) + 8;
      left = r.left;
      width = r.width;
    }
    Object.assign(host.style, {
      position: 'fixed', top: `${top}px`, left: `${left}px`, width: `${width}px`,
      height: `${Math.max(320, vh - top - 12)}px`, zIndex: '900', display: 'block',
    });
  }

  async function activate() {
    const ctx = getContext();
    if (!ctx) return;
    await ensurePanel();
    active = true;
    markActive(true);
    place();
    panel.open(ctx);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    markActive(false);
    host.style.display = 'none';      // state is kept; reopening shows the same edits
  }

  // ---------- fallback button (if the tab bar can't be found) ----------
  function showFallback(show) {
    if (show && !fallbackBtn) {
      fallbackBtn = document.createElement('button');
      fallbackBtn.id = 'rtdb-tree-editor-btn';
      fallbackBtn.innerHTML = '<span class="rte-icon">{ }</span><span class="rte-label">Tree editor</span>';
      fallbackBtn.addEventListener('click', () => (active ? deactivate() : activate()));
    }
    if (show && !fallbackBtn.isConnected && document.body) document.body.appendChild(fallbackBtn);
    if (!show && fallbackBtn && fallbackBtn.isConnected) fallbackBtn.remove();
  }

  // ---------- route watching (the console is a single-page app) ----------
  let lastUrl = '';
  let missingSince = 0;
  function tick() {
    const ctx = getContext();
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Navigating elsewhere in the console closes the editor (edits are kept)
      if (active && (!ctx || ctx.section !== 'data')) deactivate();
    }
    if (!ctx) { showFallback(false); missingSince = 0; return; }
    const ok = ensureTab();
    if (ok) { showFallback(false); missingSince = 0; }
    else {
      missingSince = missingSince || Date.now();
      showFallback(Date.now() - missingSince > 4000);   // give the console time to render its tabs
    }
    place();
  }
  setInterval(tick, 500);
  window.addEventListener('resize', place);
  document.addEventListener('scroll', place, true);

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === 'toggleTree') {
      if (!getContext()) { reply({ ok: false }); return; }
      active ? deactivate() : activate();
      reply({ ok: true });
    }
  });
})();
