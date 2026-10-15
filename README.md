# JSON Differ

A visual JSON comparison tool with side-by-side diff view, foldable JSON trees, and CLI support for automation.

## Live Demo

**[https://syscall97.github.io/JSON-Differ/](https://syscall97.github.io/JSON-Differ/)**

## Features

- **Side-by-side diff view** with line numbers
- **Color-coded changes**: Red (removed), Yellow (modified), Green (added)
- **Foldable JSON** - collapse/expand nested objects and arrays
- **Floating nav buttons** - jump to next change of each type
- **File upload** or paste JSON directly
- **Synced scrolling** between panels
- **CLI tool** for automation and AI/skill integration

---

## Quick Install (Claude Code Skill)

```bash
curl -fsSL https://raw.githubusercontent.com/SysCall97/JSON-Differ/main/install-skill.sh | bash
```

This installs the `json-diff` CLI command and sets up the skill for Claude Code.

---

## CLI Usage

```bash
# Compare two files
json-diff file1.json file2.json

# Save output to file
json-diff file1.json file2.json -o result.json

# One-shot mode (reads from input/ folder)
json-diff --once

# Watch mode (continuous)
json-diff --watch
```

Or run directly with node:
```bash
node diff.js file1.json file2.json
```

---

## Claude Code Skill Integration

After installation, use in Claude Code conversations:

```
"Compare these two JSON files"
"What changed between old.json and new.json?"
"Diff these JSONs and show me the differences"
```

### Programmatic Usage (for skills)

```bash
# 1. Place files
cp original.json ~/.claude/tools/json-diff/input/left.json
cp modified.json ~/.claude/tools/json-diff/input/right.json

# 2. Run
json-diff --once

# 3. Read result
cat ~/.claude/tools/json-diff/output/result.json
```

### Output Format

```json
{
  "identical": false,
  "diffCount": 3,
  "diffs": [
    { "type": "removed", "path": "config.oldKey", "value": "old" },
    { "type": "added", "path": "config.newKey", "value": "new" },
    { "type": "modified", "path": "version", "oldValue": "1.0", "newValue": "2.0" }
  ],
  "summary": "Found 3 difference(s)",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Diff Types

| Type | Description |
|------|-------------|
| `removed` | Key exists in left JSON only |
| `added` | Key exists in right JSON only |
| `modified` | Key exists in both, value differs |

---

## Web UI

Open `index.html` locally or visit the [live demo](https://syscall97.github.io/JSON-Differ/).

### Controls
- **Compare** - Run diff on input JSONs
- **Clear** - Reset everything
- **▼ arrows** - Click to fold/unfold JSON sections
- **Floating buttons** (right side) - Jump to removed/modified/added lines

---

## Manual Installation

```bash
git clone https://github.com/SysCall97/JSON-Differ.git
cd JSON-Differ
node diff.js --help
```

## License

MIT
