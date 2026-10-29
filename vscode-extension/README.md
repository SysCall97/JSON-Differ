# JSON Tree Editor

Edit `.json` files in VS Code as a tree — the same editor as the
[RTDB Tree Editor](https://chromewebstore.google.com/detail/rtdb-tree-editor/jhaiapddcbedapdpbghcbcdnfnfdhfbf) Chrome extension.


## Features

- **Add** a key/value pair or array item to any object or array (**+**)
- **Duplicate** any node as its next sibling (⧉) — handy for config entries, levels, fixtures
- **Remove** nodes (**−**), with a short animation so you can see what changed
- **Rename keys and edit values inline** — click a key or value; type `42`, `true`, `null`, `"text"`, `{}` or `[]`
- **Drag to reorder** array items (⠿ handle), with edge auto-scroll
- **Fold / unfold** nodes, or Expand all / Collapse all

It's a normal VS Code editor for the file: **Save**, the unsaved dot, **Undo/Redo** (Ctrl/⌘+Z),
Git diffs and the text editor all stay in sync. Change the file anywhere else and the tree updates,
with the changed lines highlighted.

## Usage

- Open a `.json` file and click the **tree icon** in the editor title bar, or
- right-click a `.json` file in the Explorer → **Open as JSON Tree**, or
- run **JSON Tree: Open as JSON Tree** from the Command Palette.

Click **Open as Text** to switch back.

To always open JSON files as a tree, right-click a `.json` file → **Open With…** →
**Configure default editor for '*.json'…** → **JSON Tree**.

## Notes

- **Strict JSON only.** Files with comments or trailing commas (JSONC, e.g. `tsconfig.json`,
  `settings.json`) open with an *Open as Text* prompt instead.
- **The file is re-formatted when you edit in the tree.** Indentation (spaces or tabs) and the
  trailing newline are kept, but the whole file is written in standard `JSON.stringify` layout.
- **Large numbers.** Integers above 2^53 (9007199254740991) lose precision in JavaScript; avoid
  editing such files in the tree.

## License

MIT
