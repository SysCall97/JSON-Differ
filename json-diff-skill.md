# JSON Diff Skill for Claude Code

## Installation

### Quick Install (one command)
```bash
curl -fsSL https://raw.githubusercontent.com/SysCall97/JSON-Differ/main/install-skill.sh | bash
```

### Manual Install
1. Clone the repo:
```bash
git clone https://github.com/SysCall97/JSON-Differ.git ~/.claude/tools/json-diff
```

2. Add to your Claude Code settings (`~/.claude/settings.json`):
```json
{
  "skills": {
    "json-diff": {
      "path": "~/.claude/tools/json-diff",
      "command": "node ~/.claude/tools/json-diff/diff.js"
    }
  }
}
```

## Usage

### Via CLI
```bash
# Compare two files directly
node ~/.claude/tools/json-diff/diff.js file1.json file2.json

# Output to file
node ~/.claude/tools/json-diff/diff.js file1.json file2.json -o result.json
```

### In Claude Code conversation
Just ask Claude to compare JSONs:
- "Compare these two JSON files"
- "What's the difference between config-old.json and config-new.json"
- "Diff these JSONs: {...} and {...}"
