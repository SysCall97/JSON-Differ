// Tree editor: render JSON as a tree with duplicate (+), remove (−),
// inline key/value editing, folding, undo/redo and change animations.
// No inline handlers, so it is safe under the extension's CSP.

const esc = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isObj = (v) => v !== null && typeof v === 'object';
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const LINE_H = 22;

export function pathLabel(path) {
  if (!path.length) return '(root)';
  return path.map((k, i) => (typeof k === 'number' ? `[${k}]` : (i ? '.' : '') + k)).join('');
}

export class TreeEditor {
  /**
   * @param {HTMLElement} view   scrollable container
   * @param {object} opts
   *   onChange()                       called after every change (incl. undo/redo)
   *   onError(msg)                     validation errors (e.g. duplicate key)
   *   onToast(html, color, action)     change notifications
   */
  constructor(view, opts = {}) {
    this.view = view;
    this.opts = opts;
    this.root = undefined;
    this.collapsed = new WeakSet();
    this.nodes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.busy = false;
    this.view.classList.add('tree-view');
    this._bind();
  }

  // ---------- public API ----------
  load(value, { resetHistory = true } = {}) {
    this.root = value;
    this.collapsed = new WeakSet();
    if (resetHistory) { this.undoStack = []; this.redoStack = []; }
    this.render();
  }

  get value() { return this.root; }

  /** Replace the whole value as one undoable step. */
  replace(value, { flash = true } = {}) {
    this._pushUndo();
    this.root = value;
    this.collapsed = new WeakSet();
    this.render(flash ? [] : null, 'edit');
    this._changed();
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() { this._step('undo'); }
  redo() { this._step('redo'); }

  // ---------- rendering ----------
  render(flashPath = null, flashKind = 'add', gapIndex = null) {
    const view = this.view;
    const scroll = view.scrollTop;
    const lines = [];
    this.nodes = [];

    const prim = (v, id) => {
      const attr = `data-edit="value" data-node="${id}" title="Click to edit"`;
      if (typeof v === 'string') return `<span class="t-str t-edit" ${attr}>${esc(JSON.stringify(v))}</span>`;
      if (typeof v === 'number') return `<span class="t-num t-edit" ${attr}>${v}</span>`;
      if (isObj(v)) return `<span class="t-edit" ${attr}>${Array.isArray(v) ? '[]' : '{}'}</span>`;
      return `<span class="t-lit t-edit" ${attr}>${v}</span>`;
    };
    const line = (code, gutter = '', btnId = null) => {
      const btns = btnId !== null
        ? `<button class="t-btn t-dup" data-node="${btnId}" title="Duplicate as next sibling">+</button>` +
          `<button class="t-btn t-del" data-node="${btnId}" title="Remove">−</button>`
        : '';
      lines.push(`<div class="t-line"><span class="t-gutter">${gutter}</span><span class="t-code">${code}</span>${btns}</div>`);
    };

    const walk = (v, key, path, depth, isLast) => {
      const id = this.nodes.length;
      const node = { path, start: lines.length, end: 0 };
      this.nodes.push(node);
      const indent = '  '.repeat(depth);
      const keyHtml = typeof key === 'string'
        ? `<span class="t-key t-edit" data-edit="key" data-node="${id}" title="Click to rename">${esc(JSON.stringify(key))}</span>: `
        : '';
      const comma = isLast ? '' : ',';
      const btnId = path.length ? id : null;

      if (isObj(v)) {
        const isArr = Array.isArray(v);
        const entries = isArr ? v.map((x, i) => [i, x]) : Object.entries(v);
        const [o, c] = isArr ? ['[', ']'] : ['{', '}'];
        if (entries.length === 0) {
          line(indent + keyHtml + prim(v, id) + comma, '', btnId);
        } else if (this.collapsed.has(v)) {
          const label = `${entries.length} ${isArr ? 'item' : 'key'}${entries.length > 1 ? 's' : ''}`;
          line(`${indent}${keyHtml}${o}<span class="t-preview"> … ${label} </span>${c}${comma}`,
            `<span class="t-fold closed" data-node="${id}">▼</span>`, btnId);
        } else {
          line(indent + keyHtml + o, `<span class="t-fold" data-node="${id}">▼</span>`);
          entries.forEach(([k, x], i) => walk(x, k, [...path, k], depth + 1, i === entries.length - 1));
          line(indent + c + comma, '', btnId);
        }
      } else {
        line(indent + keyHtml + prim(v, id) + comma, '', btnId);
      }
      node.end = lines.length - 1;
    };

    if (this.root === undefined) {
      view.innerHTML = '<div class="t-empty">No data loaded.</div>';
      return;
    }
    walk(this.root, null, [], 0, true);
    view.innerHTML = lines.join('');
    view.scrollTop = scroll;

    const els = view.querySelectorAll('.t-line');
    if (flashPath) {
      const node = this._find(flashPath);
      if (node) {
        for (let i = node.start; i <= node.end; i++) els[i].classList.add(`t-flash-${flashKind}`);
        this._scrollTo(node.start, node.end);
      }
    }
    if (gapIndex !== null && els.length) {
      const i = Math.min(gapIndex, els.length - 1);
      els[i].classList.add('t-gap');
      this._scrollTo(i);
    }
  }

  // ---------- mutations ----------
  duplicate(path) {
    const parentPath = path.slice(0, -1);
    const last = path[path.length - 1];
    const parent = this._get(parentPath);
    const original = this._get(path);
    const copy = clone(original);
    if (isObj(original) && this.collapsed.has(original)) this.collapsed.add(copy);

    this._pushUndo();
    let newPath;
    if (Array.isArray(parent)) {
      parent.splice(last + 1, 0, copy);
      newPath = [...parentPath, last + 1];
    } else {
      let newKey = `${last}_copy`, n = 2;
      while (has(parent, newKey)) newKey = `${last}_copy${n++}`;
      const rebuilt = {};
      for (const k of Object.keys(parent)) {
        rebuilt[k] = parent[k];
        if (k === last) rebuilt[newKey] = copy;
      }
      this._set(parentPath, rebuilt);
      newPath = [...parentPath, newKey];
    }
    this.render(newPath, 'add');
    this._changed();
    this._toast(`Added copy at <code>${esc(pathLabel(newPath))}</code>`, '#3fb950');
  }

  remove(path) {
    if (this.busy) return;
    const node = this._find(path);
    const els = this.view.querySelectorAll('.t-line');
    this.busy = true;
    if (node) for (let i = node.start; i <= node.end; i++) els[i].classList.add('t-leave');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      this.busy = false;
      const parent = this._get(path.slice(0, -1));
      const last = path[path.length - 1];
      this._pushUndo();
      if (Array.isArray(parent)) parent.splice(last, 1);
      else delete parent[last];
      this.render(null, null, node ? node.start : null);
      this._changed();
      this._toast(`Removed <code>${esc(pathLabel(path))}</code>`, '#f85149');
    }, reduce ? 0 : 450);
  }

  rename(path, newKey) {
    const oldKey = path[path.length - 1];
    if (newKey === oldKey) return this.render();
    if (newKey === '') return this._error('Key cannot be empty.');
    if (/[.#$\[\]\/]/.test(newKey)) return this._error('Firebase keys cannot contain . # $ [ ] or /');
    const parentPath = path.slice(0, -1);
    const parent = this._get(parentPath);
    if (has(parent, newKey)) return this._error(`Key "${newKey}" already exists here.`);
    this._pushUndo();
    const rebuilt = {};
    for (const k of Object.keys(parent)) rebuilt[k === oldKey ? newKey : k] = parent[k];
    this._set(parentPath, rebuilt);
    this.render([...parentPath, newKey], 'edit');
    this._changed();
  }

  setValue(path, text) {
    let value;
    try { value = JSON.parse(text); } catch { value = text; }   // not JSON → plain string
    if (JSON.stringify(value) === JSON.stringify(this._get(path))) return this.render();
    this._pushUndo();
    this._set(path, value);
    this.render(path, 'edit');
    this._changed();
  }

  // ---------- internals ----------
  _get(path) { return path.reduce((o, k) => o[k], this.root); }
  _set(path, value) {
    if (path.length === 0) this.root = value;
    else this._get(path.slice(0, -1))[path[path.length - 1]] = value;
  }
  _find(path) {
    const key = JSON.stringify(path);
    return this.nodes.find((n) => JSON.stringify(n.path) === key);
  }
  _changed() { this.opts.onChange && this.opts.onChange(); }
  _error(msg) { this.render(); this.opts.onError && this.opts.onError(msg); }
  _toast(html, color, action) { this.opts.onToast && this.opts.onToast(html, color, action || { label: 'Undo', fn: () => this.undo() }); }

  _pushUndo() {
    this.undoStack.push(JSON.stringify(this.root));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  _step(dir) {
    const from = dir === 'undo' ? this.undoStack : this.redoStack;
    const to = dir === 'undo' ? this.redoStack : this.undoStack;
    if (!from.length || this.busy) return;
    const before = this.root;
    to.push(JSON.stringify(this.root));
    this.root = JSON.parse(from.pop());
    this.collapsed = new WeakSet();
    const changed = diffPath(before, this.root, []);
    this.render(changed, 'edit');
    this._changed();
    const where = changed && changed.length ? ` at <code>${esc(pathLabel(changed))}</code>` : '';
    this._toast((dir === 'undo' ? 'Undid last change' : 'Redid change') + where, '#d29922',
      dir === 'undo' ? { label: 'Redo', fn: () => this.redo() } : { label: 'Undo', fn: () => this.undo() });
  }

  _scrollTo(start, end = start) {
    const els = this.view.querySelectorAll('.t-line');
    const first = els[start], last = els[end];
    if (!first || !last) return;
    const v = this.view;
    const top = first.offsetTop, bottom = last.offsetTop + LINE_H;
    if (top >= v.scrollTop + 8 && bottom <= v.scrollTop + v.clientHeight - 8) return;
    const h = bottom - top;
    const target = h < v.clientHeight ? top - (v.clientHeight - h) / 2 : top - 8;
    v.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  _highlight(id, on, del) {
    const node = this.nodes[id];
    if (!node) return;
    const els = this.view.querySelectorAll('.t-line');
    for (let i = node.start; i <= node.end; i++) els[i].classList.toggle(del ? 't-target-del' : 't-target', on);
  }

  _startEdit(el) {
    const node = this.nodes[+el.dataset.node];
    if (!node || el.querySelector('input')) return;
    const kind = el.dataset.edit;
    const path = node.path;
    const current = kind === 'key' ? path[path.length - 1] : JSON.stringify(this._get(path));

    const input = document.createElement('input');
    input.className = 't-input';
    input.value = current;
    input.spellcheck = false;
    input.title = kind === 'key'
      ? 'Enter to save · Esc to cancel · Tab to edit value'
      : 'JSON literal: "text", 42, true, null, {} or []. Plain text is saved as a string.';
    const fit = () => { input.style.width = `${Math.max(3, input.value.length + 2)}ch`; };
    fit();
    el.textContent = '';
    el.classList.remove('t-edit');
    el.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save, next) => {
      if (done) return;
      done = true;
      if (!save) return this.render();
      if (kind === 'key') this.rename(path, input.value);
      else this.setValue(path, input.value);
      if (next) {
        const valueEl = this.view.querySelector(`[data-edit="value"][data-node="${el.dataset.node}"]`);
        if (valueEl) this._startEdit(valueEl);
      }
    };
    input.addEventListener('input', () => {
      fit();
      if (kind === 'key') {
        const parent = this._get(path.slice(0, -1));
        const v = input.value;
        input.classList.toggle('invalid', v !== current && (v === '' || has(parent, v)));
      }
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Tab' && kind === 'key') { e.preventDefault(); finish(true, true); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  _bind() {
    const v = this.view;
    v.addEventListener('click', (e) => {
      const btn = e.target.closest('.t-btn');
      if (btn) {
        const path = this.nodes[+btn.dataset.node].path;
        return btn.classList.contains('t-del') ? this.remove(path) : this.duplicate(path);
      }
      const editEl = e.target.closest('[data-edit]');
      if (editEl) return this._startEdit(editEl);
      const fold = e.target.closest('.t-fold');
      if (fold) {
        const val = this._get(this.nodes[+fold.dataset.node].path);
        this.collapsed.has(val) ? this.collapsed.delete(val) : this.collapsed.add(val);
        this.render();
      }
    });
    v.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('.t-btn');
      if (btn) this._highlight(+btn.dataset.node, true, btn.classList.contains('t-del'));
    });
    v.addEventListener('mouseout', (e) => {
      const btn = e.target.closest('.t-btn');
      if (btn) this._highlight(+btn.dataset.node, false, btn.classList.contains('t-del'));
    });
  }
}

// Deepest path in `b` where it differs from `a` (used to highlight undo/redo)
function diffPath(a, b, path) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return path;
  if (Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
        if (i >= b.length) return path;
        if (i >= a.length || a.length !== b.length) return [...path, i];
        return diffPath(a[i], b[i], [...path, i]);
      }
    }
    return path;
  }
  const added = Object.keys(b).find((k) => !has(a, k));
  if (added !== undefined) return [...path, added];
  if (Object.keys(a).some((k) => !has(b, k))) return path;
  for (const k of Object.keys(b)) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return diffPath(a[k], b[k], [...path, k]);
  }
  return path;
}

// Flat list of leaf-level changes between two JSON values (for the publish preview)
export function listChanges(a, b, path = [], out = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (isObj(a) && isObj(b) && Object.keys(a).length && Object.keys(b).length) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const key = Array.isArray(b) && /^\d+$/.test(k) ? +k : k;
      if (!has(a, k)) out.push({ type: 'added', path: [...path, key], value: b[k] });
      else if (!has(b, k)) out.push({ type: 'removed', path: [...path, key], value: a[k] });
      else listChanges(a[k], b[k], [...path, key], out);
    }
    return out;
  }
  if (a === undefined || a === null) out.push({ type: 'added', path, value: b });
  else if (b === undefined || b === null) out.push({ type: 'removed', path, value: a });
  else out.push({ type: 'modified', path, oldValue: a, value: b });
  return out;
}
