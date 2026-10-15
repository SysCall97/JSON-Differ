#!/bin/bash
# JSON Diff Skill Installer for Claude Code

set -e

INSTALL_DIR="$HOME/.claude/tools/json-diff"
REPO_URL="https://github.com/SysCall97/JSON-Differ.git"

echo "Installing JSON Diff skill for Claude Code..."

# Create directory
mkdir -p "$HOME/.claude/tools"

# Clone or update repo
if [ -d "$INSTALL_DIR" ]; then
    echo "Updating existing installation..."
    cd "$INSTALL_DIR" && git pull
else
    echo "Cloning repository..."
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

# Create input/output folders
mkdir -p "$INSTALL_DIR/input" "$INSTALL_DIR/output"

# Make diff.js executable
chmod +x "$INSTALL_DIR/diff.js"

# Create a wrapper script for easy CLI access
WRAPPER="$HOME/.local/bin/json-diff"
mkdir -p "$HOME/.local/bin"

cat > "$WRAPPER" << 'WRAPPER_EOF'
#!/bin/bash
node "$HOME/.claude/tools/json-diff/diff.js" "$@"
WRAPPER_EOF

chmod +x "$WRAPPER"

echo ""
echo "✓ Installation complete!"
echo ""
echo "Usage:"
echo "  json-diff file1.json file2.json           # Compare two files"
echo "  json-diff file1.json file2.json -o out    # Save to file"
echo "  json-diff --once                          # Use input/left.json & right.json"
echo ""
echo "Skill location: $INSTALL_DIR"
echo "CLI wrapper: $WRAPPER"
echo ""
echo "Make sure ~/.local/bin is in your PATH:"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
