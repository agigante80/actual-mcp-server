#!/bin/bash
# migrate-test-files.sh - Safe migration with verification

set -e  # Exit on error

echo "🚀 Starting test file organization..."
echo ""

# Create backup tag
TAG_NAME="pre-test-migration-$(date +%Y%m%d-%H%M%S)"
git tag -a "$TAG_NAME" -m "Backup before test file migration"
echo "✅ Created backup tag: $TAG_NAME"

# Phase 1: Move manual tests (6 files)
echo ""
echo "📦 Phase 1: Moving manual test scripts..."

move_and_verify() {
  local src=$1
  local dest=$2
  
  echo "  Moving: $src → $dest"
  
  # Check if file is tracked by git
  if git ls-files --error-unmatch "$src" &>/dev/null; then
    # Tracked file - use git mv
    git mv "$src" "$dest"
  else
    # Untracked file - use regular mv and add
    mv "$src" "$dest"
    git add "$dest"
  fi
  
  # Verify file exists
  if [ -f "$dest" ]; then
    echo "    ✅ File moved successfully"
  else
    echo "    ❌ ERROR: File not found at destination!"
    exit 1
  fi
}

# Manual tests → tests/manual/
move_and_verify "test-critical-tools.mjs" "tests/manual/test-critical-tools.mjs"
move_and_verify "test-full-integration.mjs" "tests/manual/test-full-integration.mjs"
move_and_verify "test-lobechat-discovery.mjs" "tests/manual/test-lobechat-discovery.mjs"
move_and_verify "test-graphql-detection.mjs" "tests/manual/test-graphql-detection.mjs"
move_and_verify "test-mcp-response.js" "tests/manual/test-mcp-response.js"
move_and_verify "verify-tool-description.mjs" "tests/manual/verify-tool-description.mjs"

echo ""
echo "📦 Phase 2: Moving integration test scenarios..."

# Integration tests → tests/integration/
move_and_verify "test-account-filtering.cjs" "tests/integration/test-account-filtering.cjs"
move_and_verify "test-account-validation.cjs" "tests/integration/test-account-validation.cjs"
move_and_verify "test-amount-search-scenarios.cjs" "tests/integration/test-amount-search-scenarios.cjs"
move_and_verify "test-search-tools-direct.cjs" "tests/integration/test-search-tools-direct.cjs"

# Commit the moves
git add -A
git commit -m "refactor: organize test files into tests/manual and tests/integration

- Moved 6 manual test scripts to tests/manual/ (standalone test executables)
- Moved 4 integration test scenarios to tests/integration/ (feature tests)
- No code changes, only file moves (preserves git history)
- Addresses file organization issue identified in project reassessment

Files moved:
- test-critical-tools.mjs → tests/manual/
- test-full-integration.mjs → tests/manual/
- test-lobechat-discovery.mjs → tests/manual/
- test-graphql-detection.mjs → tests/manual/
- test-mcp-response.js → tests/manual/
- verify-tool-description.mjs → tests/manual/
- test-account-filtering.cjs → tests/integration/
- test-account-validation.cjs → tests/integration/
- test-amount-search-scenarios.cjs → tests/integration/
- test-search-tools-direct.cjs → tests/integration/"

echo ""
echo "✅ Phase 2 complete!"

# Run test suite
echo ""
echo "🧪 Running test suite to verify nothing broke..."
npm run test:adapter

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ All tests passing!"
  echo ""
  echo "🎉 File organization complete!"
  echo "📊 Summary:"
  echo "  - Moved 10 files from root to tests/"
  echo "  - 6 files → tests/manual/"
  echo "  - 4 files → tests/integration/"
  echo "  - Git history preserved"
  echo "  - Test suite passing"
  echo ""
  echo "📝 Backup tag: $TAG_NAME"
  echo "   Rollback: git reset --hard $TAG_NAME"
else
  echo ""
  echo "⚠️  Tests failed - review output above"
  echo "   Rollback: git reset --hard $TAG_NAME"
  exit 1
fi
