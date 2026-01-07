#!/bin/bash
# Cleanup root markdown files - move to docs/archive/

set -e

echo "🧹 Cleaning up root markdown files..."
echo ""

# Files to archive (completed fixes and refactoring docs)
ARCHIVE_FILES=(
  "FILE_ORGANIZATION_PLAN.md"
  "FILE_ORGANIZATION_COMPLETION_REPORT.md"
  "LOBECHAT_FIX.md"
  "QUERY_TOOL_FIX.md"
  "SEARCH_TOOLS_FIX.md"
  "SCHEMA_VALIDATION_COMPLETE.md"
  "AUTOMATION_SETUP_COMPLETE.md"
)

# Create archive directory if needed
mkdir -p docs/archive/2026-01-07-cleanup

echo "📦 Archiving completed documentation..."
for file in "${ARCHIVE_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  Moving: $file → docs/archive/2026-01-07-cleanup/"
    git mv "$file" "docs/archive/2026-01-07-cleanup/"
  else
    echo "  ⚠️  Not found: $file"
  fi
done

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📁 Files remaining in root:"
ls -1 *.md 2>/dev/null || echo "  (none)"
echo ""
echo "📁 Archived files:"
ls -1 docs/archive/2026-01-07-cleanup/
