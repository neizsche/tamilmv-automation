#!/bin/bash
# setup-hooks.sh
# Run this script after cloning the repo to install Git hooks.

HOOKS_DIR=".git/hooks"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing Git hooks..."

cat > "$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/bash
echo ""
echo "🧪 Running unit tests before commit..."
echo ""

npm test

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Tests failed! Commit aborted."
    echo "   Fix the failing tests above and try again."
    echo ""
    exit 1
fi

echo ""
echo "✅ All tests passed! Proceeding with commit."
echo ""
exit 0
EOF

chmod +x "$HOOKS_DIR/pre-commit"

echo "✅ Git hooks installed successfully!"
echo "   Tests will now run automatically before every commit."
