// Webview side of the JSON Tree editor.
// The text document (owned by VS Code) is the source of truth: every tree edit
// is sent to the extension as the new file text, and every document change
// (typing in a text editor, VS Code undo/redo, git checkout) comes back here.
import { TreeEditor } from './tree-editor.js';

const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);

let indent = 2;            // detected from the file
let trailingNewline = true;
let lastText = null;       // last text we sent or received, to ignore echoes
let loaded = false;

const tree = new TreeEditor($('tree'), {
  firebaseKeys: false,     // plain JSON: any key is allowed
  onChange: () => sendEdit(),
  onError: (msg) => showBanner(msg),
  onToast: showToast,
});

function detectFormat(text) {
  trailingNewline = /\n$/.test(text);
  const m = /\n([ \t]+)\S/.exec(text);
  if (!m) { indent = 2; return; }
  indent = m[1][0] === '\t' ? '\t' : Math.min(m[1].length, 8);
}

function serialize(value) {
  return JSON.stringify(value, null, indent) + (trailingNewline ? '\n' : '');
}

function sendEdit() {
  if (tree.value === undefined) return;
  const text = serialize(tree.value);
  if (text === lastText) return;
  lastText = text;
  vscode.postMessage({ type: 'edit', text });
  updateInfo();
}

function setText(text) {
  if (text === lastText && loaded) return;
  lastText = text;
  if (!text.trim()) {
    showInvalid('This file is empty.', 'Start with an empty object', () => {
      tree.load({});
      loaded = true;
      showValid();
      sendEdit();
    });
    return;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    const jsonc = /\/\/|\/\*|,\s*[}\]]/.test(text);
    showInvalid(
      jsonc
        ? 'This file has comments or trailing commas (JSONC). The tree editor only edits strict JSON.'
        : `This file isn't valid JSON: ${e.message}`,
      'Open as Text', () => vscode.postMessage({ type: 'openAsText' }));
    return;
  }
  detectFormat(text);
  if (!loaded) {
    tree.load(value);
    loaded = true;
  } else {
    // Changed outside the tree (text editor, undo/redo, git…): refresh, keep folds, glow changes
    const before = tree.value;
    tree.refresh(value, changedPaths(before, value));
  }
  showValid();
  updateInfo();
}

// Paths that differ between two values (for the glow after outside changes)
function changedPaths(a, b, path = [], out = []) {
  if (out.length > 60 || JSON.stringify(a) === JSON.stringify(b)) return out;
  const isObj = (v) => v !== null && typeof v === 'object';
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const key = Array.isArray(b) ? +k : k;
      changedPaths(a[k], b[k], [...path, key], out);
    }
  } else out.push(path);
  return out;
}

function showValid() {
  $('invalid').classList.remove('visible');
  $('tree').classList.remove('hidden');
  hideBanner();
}

function showInvalid(message, actionLabel, action) {
  $('tree').classList.add('hidden');
  $('invalidMsg').textContent = message;
  const btn = $('invalidAction');
  btn.textContent = actionLabel;
  btn.onclick = action;
  $('invalid').classList.add('visible');
  $('info').textContent = '';
}

function updateInfo() {
  const v = tree.value;
  if (v === undefined) return;
  const n = v && typeof v === 'object' ? Object.keys(v).length : 0;
  $('info').textContent = Array.isArray(v) ? `Array · ${n} item${n === 1 ? '' : 's'}`
    : v && typeof v === 'object' ? `Object · ${n} key${n === 1 ? '' : 's'}` : typeof v;
}

let bannerTimer;
function showBanner(msg) {
  $('bannerText').textContent = msg;
  $('banner').classList.add('visible');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideBanner, 5000);
}
function hideBanner() { $('banner').classList.remove('visible'); }

function showToast(html, color, action) {
  const t = $('toast');
  t.querySelector('.toast-msg').innerHTML = html;
  t.querySelector('.toast-dot').style.background = color;
  const btn = $('toastAction');
  // "Undo" in the toast uses VS Code's own undo, so it matches Ctrl+Z
  const act = action && /^(Undo|Redo)$/.test(action.label)
    ? { label: action.label, fn: () => vscode.postMessage({ type: action.label.toLowerCase() }) }
    : action;
  btn.textContent = act ? act.label : '';
  btn.onclick = () => { t.classList.remove('visible'); act && act.fn(); };
  t.classList.add('visible');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('visible'), 3500);
}

// Fold / unfold everything
function setAllFolded(folded) {
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return;
    if (folded) tree.collapsed.add(v); else tree.collapsed.delete(v);
    Object.values(v).forEach(walk);
  };
  walk(tree.value);
  if (folded && tree.value && typeof tree.value === 'object') tree.collapsed.delete(tree.value); // keep the root open
  tree.render();
}

$('expandAll').addEventListener('click', () => setAllFolded(false));
$('collapseAll').addEventListener('click', () => setAllFolded(true));
$('openText').addEventListener('click', () => vscode.postMessage({ type: 'openAsText' }));
$('bannerClose').addEventListener('click', hideBanner);

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg && msg.type === 'update') setText(msg.text);
});

vscode.postMessage({ type: 'ready' });
