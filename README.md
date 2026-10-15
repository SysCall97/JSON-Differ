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

## Web UI

Open `index.html` in browser or visit the live demo above.

### Controls
- **Compare** - Run diff on input JSONs
- **Clear** - Reset everything
- **▼ arrows** - Click to fold/unfold JSON sections
- **Floating buttons** - Jump to removed/modified/added lines

## CLI Usage

```bash
# Compare two files
node diff.js file1.json file2.json

# Save output to file
node diff.js file1.json file2.json -o result.json

# One-shot mode (reads from input/ folder)
node diff.js --once

# Watch mode (continuous)
node diff.js --watch
```

## Claude Code Skill Integration

For use as a Claude Code skill:

### One-shot Mode
```bash
# 1. Place files in input folder
cp original.json input/left.json
cp modified.json input/right.json

# 2. Run comparison
node diff.js --once

# 3. Read result
cat output/result.json
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

## Skill Definition

Add to your Claude Code skills:

```yaml
name: json-diff
description: Compare two JSON files and identify differences
trigger: "compare json", "diff json", "json difference"
steps:
  - Copy left JSON to input/left.json
  - Copy right JSON to input/right.json
  - Run: node /path/to/json_diff/diff.js --once
  - Read output/result.json for structured diff
```

## License

MIT
