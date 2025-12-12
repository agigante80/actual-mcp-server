#!/bin/bash
# Validates Docker Hub short description length
# Short descriptions must be <= 100 characters

set -e

SHORT_DESC_FILE="docker/description/short.md"

if [ ! -f "$SHORT_DESC_FILE" ]; then
  echo "❌ Error: $SHORT_DESC_FILE not found"
  exit 1
fi

# Read short description and remove newlines
SHORT_DESC=$(cat "$SHORT_DESC_FILE" | tr -d '\n')
CHAR_COUNT=${#SHORT_DESC}

echo "Docker Hub Short Description Validation"
echo "========================================"
echo "File: $SHORT_DESC_FILE"
echo "Content: $SHORT_DESC"
echo "Character count: $CHAR_COUNT / 100"

if [ $CHAR_COUNT -gt 100 ]; then
  echo ""
  echo "❌ VALIDATION FAILED"
  echo "Short description exceeds 100 characters by $((CHAR_COUNT - 100))"
  echo ""
  echo "Please shorten the description in $SHORT_DESC_FILE"
  exit 1
fi

echo ""
echo "✅ VALIDATION PASSED"
echo "Short description is within the 100 character limit"
echo "Remaining characters: $((100 - CHAR_COUNT))"
exit 0
