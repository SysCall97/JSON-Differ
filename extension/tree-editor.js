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
    const line = (code, gutter = '', btnId = null, handle = '', addId = null) => {
      const add = addId !== null
        ? `<button class="t-btn t-add" data-node="${addId}" title="Add a child (key: value) inside this node" aria-label="Add child">+</button>` : '';
      const btns = add + (btnId !== null
        ? `<button class="t-btn t-dup" data-node="${btnId}" title="Duplicate — copy this node and paste it as the next sibling" aria-label="Duplicate"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="9.5" height="9.5" rx="2"/><path d="M11 5V3a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 2 3v6A1.5 1.5 0 0 0 3.5 10.5H5"/></svg></button>` +
          `<button class="t-btn t-del" data-node="${btnId}" title="Remove">−</button>`
        : '');
      lines.push(`<div class="t-line" data-i="${lines.length}"><span class="t-handle">${handle}</span><span class="t-gutter">${gutter}</span><span class="t-code">${code}</span>${btns}</div>`);
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
      // array items get a drag handle (drag within the same array to reorder)
      const handle = typeof key === 'number'
        ? `<span class="t-drag" draggable="true" data-node="${id}" title="Drag to reorder">⠿</span>` : '';

      if (isObj(v)) {
        const isArr = Array.isArray(v);
        const entries = isArr ? v.map((x, i) => [i, x]) : Object.entries(v);
        const [o, c] = isArr ? ['[', ']'] : ['{', '}'];
        if (entries.length === 0) {
          line(indent + keyHtml + prim(v, id) + comma, '', btnId, handle, id);
        } else if (this.collapsed.has(v)) {
          const label = `${entries.length} ${isArr ? 'item' : 'key'}${entries.length > 1 ? 's' : ''}`;
          line(`${indent}${keyHtml}${o}<span class="t-preview"> … ${label} </span>${c}${comma}`,
            `<span class="t-fold closed" data-node="${id}">▼</span>`, btnId, handle, id);
        } else {
          line(indent + keyHtml + o, `<span class="t-fold" data-node="${id}">▼</span>`, null, handle);
          entries.forEach(([k, x], i) => walk(x, k, [...path, k], depth + 1, i === entries.length - 1));
          line(indent + c + comma, '', btnId, '', id);
        }
      } else {
        line(indent + keyHtml + prim(v, id) + comma, '', btnId, handle);
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
    this._mountAddRow();

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

  /** Open the inline "add child" row for the object/array at `path`. */
  startAdd(path) {
    const v = this._get(path);
    if (!isObj(v)) return;
    this.collapsed.delete(v);
    this.adding = { path, draft: { key: '', value: '' }, focus: true };
    this.render();
  }

  cancelAdd() {
    this.adding = null;
    this.render();
  }

  /** Add `key: value` (or an array item) to the node at `path`. Returns an error message or null. */
  addChild(path, key, text) {
    const target = this._get(path);
    if (!isObj(target)) return 'This node can no longer have children.';
    if (!text.trim()) return 'Enter a value.';
    let value;
    try { value = JSON.parse(text); } catch { value = text; }
    let newPath;
    if (Array.isArray(target)) {
      this._pushUndo();
      target.push(value);
      newPath = [...path, target.length - 1];
    } else {
      if (!key.trim()) return 'Enter a key.';
      if (/[.#$\[\]\/]/.test(key)) return 'Keys cannot contain . # $ [ ] or /';
      if (has(target, key)) return `"${key}" already exists here.`;
      this._pushUndo();
      target[key] = value;
      newPath = [...path, key];
    }
    this.adding = null;
    this.render(newPath, 'add');
    this._changed();
    this._toast(`Added <code>${esc(pathLabel(newPath))}</code>`, '#3fb950');
    return null;
  }

  _mountAddRow() {
    if (!this.adding) return;
    const node = this._find(this.adding.path);
    const target = node && this._get(this.adding.path);
    if (!node || !isObj(target)) { this.adding = null; return; }
    const els = this.view.querySelectorAll('.t-line');
    const isArray = Array.isArray(target);
    const empty = (isArray ? target.length : Object.keys(target).length) === 0;
    const { row, focus } = buildAddRow({
      isArray, nextIndex: isArray ? target.length : 0, depth: this.adding.path.length + 1, draft: this.adding.draft,
      onSubmit: (k, val) => this.addChild(this.adding.path, k, val),
      onCancel: () => this.cancelAdd(),
    });
    if (empty) els[node.start].after(row); else els[node.end].before(row);
    if (this.adding.focus) {
      this.adding.focus = false;
      focus();
      const r = row.getBoundingClientRect(), v = this.view.getBoundingClientRect();
      if (r.bottom > v.bottom || r.top < v.top) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /** Move an array item to index `to` within the same array (reorder). */
  move(path, to) {
    const parentPath = path.slice(0, -1);
    const arr = this._get(parentPath);
    const from = path[path.length - 1];
    if (!Array.isArray(arr) || from === to || to < 0 || to >= arr.length) return;
    const pk = JSON.stringify(parentPath);
    const ranges = this.nodes
      .filter((n) => n.path.length === path.length && typeof n.path[n.path.length - 1] === 'number' && JSON.stringify(n.path.slice(0, -1)) === pk)
      .sort((x, y) => x.path[x.path.length - 1] - y.path[y.path.length - 1])
      .map((n) => ({ start: n.start, end: n.end }));
    this._pushUndo();
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    const order = [...Array(arr.length).keys()];
    order.splice(from, 1);
    order.splice(to, 0, from);
    const newPath = [...parentPath, to];
    this.render(newPath, 'swap');
    if (ranges.length === arr.length) animateReorderLines(this.view, ranges, order, from, LINE_H);
    this._changed();
    this._toast(`Moved <code>${esc(pathLabel(path))}</code> → <code>${esc(pathLabel(newPath))}</code>`, '#58a6ff');
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

  _flash(path, kind) {
    const node = this._find(path);
    if (!node) return;
    const els = this.view.querySelectorAll('.t-line');
    for (let i = node.start; i <= node.end; i++) els[i].classList.add(`t-flash-${kind}`);
  }

  _mark(node, cls, on) {
    if (!node) return;
    const els = this.view.querySelectorAll('.t-line');
    for (let i = node.start; i <= node.end; i++) els[i] && els[i].classList.toggle(cls, on);
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
        if (btn.classList.contains('t-add')) return this.startAdd(path);
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
    // Drag an array item's handle within the same array to reorder it
    let drag = null;   // { node, items, drop }
    let doDrop = null;
    const scroller = makeAutoScroller(v, { onDrop: () => doDrop && doDrop() });
    v.addEventListener('dragstart', (e) => {
      const h = e.target.closest && e.target.closest('.t-drag');
      if (!h) return;
      const node = this.nodes[+h.dataset.node];
      const parentKey = JSON.stringify(node.path.slice(0, -1));
      const items = this.nodes.filter((n) => n.path.length === node.path.length &&
        typeof n.path[n.path.length - 1] === 'number' && JSON.stringify(n.path.slice(0, -1)) === parentKey);
      drag = { node, items, drop: null };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', pathLabel(node.path));
      const els = v.querySelectorAll('.t-line');
      this._mark(node, 't-drag-src', true);                 // whole item is selected
      let ghostH = (node.end - node.start + 1) * LINE_H;
      if (e.dataTransfer.setDragImage) {
        const ghost = makeDragGhost(v, els, node.start, node.end);
        ghostH = ghost.offsetHeight || ghostH;
        e.dataTransfer.setDragImage(ghost, 16, 12);
      }
      scroller.start({ previewAbove: 12, previewBelow: ghostH - 12 });
    });
    // Pressing / hovering the handle selects the whole item
    let pressed = null;
    v.addEventListener('mousedown', (e) => {
      const h = e.target.closest && e.target.closest('.t-drag');
      if (!h) return;
      pressed = this.nodes[+h.dataset.node];
      this._mark(pressed, 't-drag-src', true);
    });
    document.addEventListener('mouseup', () => {
      if (pressed && !drag) this._mark(pressed, 't-drag-src', false);
      pressed = null;
    });
    v.addEventListener('mouseover', (e) => {
      const h = e.target.closest && e.target.closest('.t-drag');
      if (h && !drag) this._highlight(+h.dataset.node, true, false);
    });
    v.addEventListener('mouseout', (e) => {
      const h = e.target.closest && e.target.closest('.t-drag');
      if (h) this._highlight(+h.dataset.node, false, false);
    });
    const setDrop = (drop) => {
      if (drag.drop && drag.drop.el) drag.drop.el.classList.remove(drag.drop.cls);
      drag.drop = drop;
      if (drop && drop.el) drop.el.classList.add(drop.cls);
    };
    v.addEventListener('dragover', (e) => {
      if (!drag) return;
      const lineEl = e.target.closest && e.target.closest('.t-line');
      const idx = lineEl ? +lineEl.dataset.i : -1;
      const target = drag.items.find((n) => n.start <= idx && idx <= n.end) || null;
      if (!target) return setDrop(null);
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const from = drag.node.path[drag.node.path.length - 1];
      const pos = dropPosition(v.querySelectorAll('.t-line'), target, from, e.clientY);
      if (pos.to === from) return setDrop({ to: from });   // no-op: no marker
      if (!drag.drop || drag.drop.el !== pos.el || drag.drop.cls !== pos.cls) setDrop(pos);
    });
    doDrop = () => {
      if (!drag) return;
      const path = drag.node.path, drop = drag.drop;
      setDrop(null);
      drag = null;
      scroller.stop();
      if (drop && drop.to !== path[path.length - 1]) this.move(path, drop.to);
      else this.render();
    };
    v.addEventListener('drop', (e) => { if (drag) { e.preventDefault(); doDrop(); } });
    v.addEventListener('dragend', () => {
      scroller.stop();
      if (!drag) return;
      setDrop(null);
      this._mark(drag.node, 't-drag-src', false);
      drag = null;
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

// Inline "add child" row, like the + in the Firebase console
function buildAddRow({ isArray, nextIndex, depth, draft, onSubmit, onCancel }) {
  const el = (tag, cls, props = {}) => Object.assign(document.createElement(tag), { className: cls, ...props });
  const row = el('div', 't-add-row');
  row.style.paddingLeft = `calc(40px + ${depth * 2}ch)`;
  const keyEl = isArray
    ? el('span', 't-add-index', { textContent: `[${nextIndex}]`, title: 'New item goes at the end of the array' })
    : el('input', 't-input t-add-key', { placeholder: 'key', value: draft.key || '', spellcheck: false });
  const valEl = el('input', 't-input t-add-value', {
    placeholder: 'value', value: draft.value || '', spellcheck: false,
    title: 'JSON value: "text", 42, true, null, {} or [] — plain text is saved as a string',
  });
  const ok = el('button', 't-add-ok', { textContent: 'Add', type: 'button' });
  const cancel = el('button', 't-add-cancel', { textContent: 'Cancel', type: 'button' });
  const err = el('span', 't-add-err');
  row.append(keyEl, el('span', 't-add-colon', { textContent: ':' }), valEl, ok, cancel, err);
  const submit = () => {
    const msg = onSubmit(isArray ? null : keyEl.value, valEl.value);
    if (msg) err.textContent = msg;
  };
  row.addEventListener('input', (e) => {
    err.textContent = '';
    if (e.target === keyEl) draft.key = keyEl.value;
    if (e.target === valEl) draft.value = valEl.value;
  });
  row.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.target === keyEl && !valEl.value) valEl.focus(); else submit();
    }
  });
  row.addEventListener('click', (e) => e.stopPropagation());
  ok.addEventListener('click', submit);
  cancel.addEventListener('click', onCancel);
  return { row, focus: () => (isArray ? valEl : keyEl).focus() };
}

// Auto-scroll while dragging near (or past) the top/bottom edge of the tree.
// It follows the dragged item's preview, not just the cursor: scrolling starts
// when the preview's top/bottom reaches the edge zone. Starts slow, speeds up
// the deeper you go into the zone and the longer you hold there.
function makeAutoScroller(view, { onDrop } = {}) {
  const ZONE = 80;                 // px from the edge where scrolling starts
  const MIN = 25, MAX = 260;       // px/second at the zone start / at the edge
  const HOLD_BOOST = 2.5;          // up to this many × faster after holding ~2 s
  let y = null, raf = 0, active = false, last = 0, holdSince = 0, dirNow = 0;
  let above = 12, below = 12;      // preview extent above/below the cursor
  let bands = [];
  // Thin strips over the very top/bottom edge of the tree. Chrome's own drag
  // auto-scroll kicks in there (fast and jumpy); covering them leaves only ours.
  const makeBands = () => {
    const r = view.getBoundingClientRect();
    const H = 28;
    return [[r.top, 'top'], [r.bottom - H, 'bottom']].map(([t, pos]) => {
      const b = document.createElement('div');
      b.className = `t-scroll-band ${pos}`;
      Object.assign(b.style, { position: 'fixed', left: `${r.left}px`, width: `${r.width}px`, top: `${t}px`, height: `${H}px`, zIndex: '650' });
      b.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; y = e.clientY; });
      b.addEventListener('drop', (e) => { e.preventDefault(); onDrop && onDrop(); });
      view.parentNode.appendChild(b);
      return b;
    });
  };
  const onMove = (e) => { if (e.clientY || e.clientX) y = e.clientY; };
  const tick = (now) => {
    if (!active) return;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    let dir = 0, depth = 0;
    if (y !== null) {
      const r = view.getBoundingClientRect();
      const topProbe = y - above, bottomProbe = y + below;
      if (topProbe < r.top + ZONE && view.scrollTop > 0) { dir = -1; depth = r.top + ZONE - topProbe; }
      else if (bottomProbe > r.bottom - ZONE && view.scrollTop + view.clientHeight < view.scrollHeight) {
        dir = 1; depth = bottomProbe - (r.bottom - ZONE);
      }
    }
    if (dir !== dirNow) {
      dirNow = dir; holdSince = now;
      bands.forEach((b) => b.classList.toggle('active', (dir < 0 && b.classList.contains('top')) || (dir > 0 && b.classList.contains('bottom'))));
    }
    if (dir && dt) {
      const t = Math.min(depth / ZONE, 1);
      const held = Math.min((now - holdSince) / 2000, 1);
      const speed = (MIN + (MAX - MIN) * t * t) * (1 + (HOLD_BOOST - 1) * held);
      view.scrollTop += dir * speed * dt;
    }
    raf = requestAnimationFrame(tick);
  };
  return {
    start({ previewAbove = 12, previewBelow = 12 } = {}) {
      above = previewAbove; below = Math.min(previewBelow, 160);
      active = true; y = null; last = 0; dirNow = 0;
      window.addEventListener('dragover', onMove, true);
      window.addEventListener('drag', onMove, true);
      bands = makeBands();
      raf = requestAnimationFrame(tick);
    },
    stop() {
      active = false; cancelAnimationFrame(raf);
      window.removeEventListener('dragover', onMove, true);
      window.removeEventListener('drag', onMove, true);
      bands.forEach((b) => b.remove());
      bands = [];
    },
  };
}

// Drag image showing the whole item being dragged (not just its first line)
function makeDragGhost(view, els, start, end) {
  const ghost = document.createElement('div');
  ghost.className = 't-drag-ghost';
  const max = 14;
  for (let k = start; k <= end && k < start + max; k++) {
    const c = els[k].cloneNode(true);
    c.classList.remove('t-drag-src', 't-target', 't-drop-before', 't-drop-after', 't-flash-add', 't-flash-edit', 't-flash-swap', 't-gap');
    ghost.appendChild(c);
  }
  if (end - start + 1 > max) {
    const more = document.createElement('div');
    more.className = 't-ghost-more';
    more.textContent = `… ${end - start + 1 - max} more lines`;
    ghost.appendChild(more);
  }
  ghost.style.width = `${Math.min(view.clientWidth - 24, 520)}px`;
  view.appendChild(ghost);
  setTimeout(() => ghost.remove(), 0);
  return ghost;
}

// FLIP animation for a reorder: every line slides from where it was to where it is now.
// `ranges` are the array items' old line ranges (in old order), `order` lists the
// old indices in their new order, `moved` is the old index of the dragged item.
function animateReorderLines(view, ranges, order, moved, lineH) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !ranges.length) return;
  const els = view.querySelectorAll('.t-line');
  const anim = [];
  let k = ranges[0].start;
  for (const oi of order) {
    const r = ranges[oi];
    for (let off = 0; off <= r.end - r.start; off++, k++) {
      const el = els[k];
      const d = (r.start + off - k) * lineH;
      if (!el || !d) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${d}px)`;
      el.style.position = 'relative';
      el.style.zIndex = oi === moved ? '2' : '1';
      if (oi === moved) el.classList.add('t-swapping');
      anim.push(el);
    }
  }
  view.getBoundingClientRect();   // apply the start positions before animating
  requestAnimationFrame(() => {
    for (const el of anim) {
      el.style.transition = 'transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1)';
      el.style.transform = '';
    }
    setTimeout(() => {
      for (const el of anim) {
        el.style.transition = el.style.position = el.style.zIndex = '';
        el.classList.remove('t-swapping');
      }
    }, 500);
  });
}

// Where would the dragged item land? Upper half of an item = before it, lower half = after.
function dropPosition(els, target, from, clientY) {
  const top = els[target.start].getBoundingClientRect().top;
  const bottom = els[target.end].getBoundingClientRect().bottom;
  const after = clientY > (top + bottom) / 2;
  const ti = target.path[target.path.length - 1];
  let to = after ? ti + 1 : ti;
  if (from < to) to -= 1;                       // removing the item shifts later ones up
  return { to, el: after ? els[target.end] : els[target.start], cls: after ? 't-drop-after' : 't-drop-before' };
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
