#!/bin/sh
set -e

SERVER_URL="${ACTUAL_SERVER_URL:-http://localhost:5006}"
PASSWORD="${ACTUAL_PASSWORD:-test123}"
ZIP_FILE="${1:-test-data/2026-01-08-Test Budget.zip}"

echo "=== Importing Test Budget to Actual Server ==="
echo "Server: $SERVER_URL"
echo "Zip file: $ZIP_FILE"
echo ""

if [ ! -f "$ZIP_FILE" ]; then
  echo "❌ Zip file not found: $ZIP_FILE"
  exit 1
fi

# Step 1: Login and get token
echo "🔐 Logging in..."
TOKEN=$(curl -sf -X POST "$SERVER_URL/account/login" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$PASSWORD\"}" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed"
  exit 1
fi
echo "✓ Logged in"
echo ""

# Step 2: Upload the zip file using the import endpoint
echo "📤 Uploading budget file..."

# Extract just the filename for the budget name and create a file ID
BUDGET_NAME=$(basename "$ZIP_FILE" .zip)
FILE_ID=$(echo "$BUDGET_NAME" | tr '[:upper:] ' '[:lower:]-')

RESPONSE=$(curl -w "\n%{http_code}" -X POST "$SERVER_URL/sync/upload-user-file" \
  -H "X-ACTUAL-TOKEN: $TOKEN" \
  -H "X-ACTUAL-FILE-ID: $FILE_ID" \
  -H "X-ACTUAL-NAME: $BUDGET_NAME" \
  -H "X-ACTUAL-FORMAT: blob" \
  -H "Content-Type: application/encrypted-file" \
  --data-binary "@$ZIP_FILE")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Budget uploaded successfully!"
  echo ""
  
  # Extract the groupId (sync ID) from the response
  SYNC_ID=$(echo "$BODY" | grep -o '"groupId":"[^"]*"' | cut -d'"' -f4)
  
  if [ -n "$SYNC_ID" ]; then
    echo "📝 Sync ID: $SYNC_ID"
    # Save to a file for the bootstrap script to use
    echo "$SYNC_ID" > /tmp/actual-sync-id.txt
    echo ""
    echo "✅ Sync ID saved for E2E testing"
  else
    echo "⚠️  No sync ID in response"
    echo "Response: $BODY"
  fi
  
  echo ""
  echo "🌐 Open http://localhost:${SERVER_URL##*:} to see your imported budget"
else
  echo "❌ Upload failed with HTTP $HTTP_CODE"
  echo "Response: $BODY"
  echo ""
  echo "💡 Note: This script expects a CLEAN Actual Budget instance."
  echo "   Run 'docker compose down -v' to reset all data."
  exit 1
fi
