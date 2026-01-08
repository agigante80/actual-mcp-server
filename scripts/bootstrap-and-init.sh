#!/bin/sh
set -e

# Bootstrap Actual server and create test budget via HTTP API
# This script:
# 1. Waits for server to be healthy
# 2. POSTs to /bootstrap to set password
# 3. Runs init script to create test budget with data
# 4. Prints sync ID for MCP connection

SERVER_URL="${ACTUAL_SERVER_URL:-http://localhost:5006}"
PASSWORD="${ACTUAL_PASSWORD:-test123}"
INIT_SCRIPT="${1:-scripts/init-actual-with-runimport.js}"

echo "=== Actual Budget Bootstrap & Init ==="
echo "Server URL: $SERVER_URL"
echo "Password: [hidden]"
echo "Init script: $INIT_SCRIPT"
echo ""

# Function to check if server needs bootstrap
needs_bootstrap() {
  response=$(curl -s "${SERVER_URL}/account/needs-bootstrap" || echo '{"error": true}')
  echo "$response" | grep -q '"bootstrapped":false'
}

# Function to wait for server
wait_for_server() {
  # Skip wait if already verified externally
  echo "DEBUG: SKIP_SERVER_WAIT='$SKIP_SERVER_WAIT'"
  if [ "$SKIP_SERVER_WAIT" = "true" ]; then
    echo "✅ Skipping server wait (already verified externally)"
    return 0
  fi
  
  echo "Waiting for Actual server to be ready..."
  max_attempts=30
  attempt=0
  
  while [ $attempt -lt $max_attempts ]; do
    if curl -sf "${SERVER_URL}/health" > /dev/null 2>&1 || \
       curl -sf "${SERVER_URL}/account/needs-bootstrap" > /dev/null 2>&1; then
      echo "✅ Server is ready!"
      return 0
    fi
    
    attempt=$((attempt + 1))
    echo "Attempt $attempt/$max_attempts - waiting..."
    sleep 2
  done
  
  echo "❌ Server failed to start after ${max_attempts} attempts"
  return 1
}

# Function to bootstrap password
bootstrap_password() {
  echo ""
  echo "Checking if server needs bootstrap..."
  
  if ! needs_bootstrap; then
    echo "✅ Server already bootstrapped (password already set)"
    return 0
  fi
  
  echo "Bootstrapping password via /account/bootstrap endpoint..."
  
  response=$(curl -sf -X POST \
    -H "Content-Type: application/json" \
    -d "{\"password\": \"${PASSWORD}\"}" \
    "${SERVER_URL}/account/bootstrap" 2>&1)
  
  if [ $? -eq 0 ]; then
    echo "✅ Password bootstrap successful!"
    return 0
  else
    echo "❌ Bootstrap failed: $response"
    return 1
  fi
}

# Function to create test budget
create_test_budget() {
  echo ""
  echo "📦 Importing test budget..."
  
  if [ -f "test-data/2026-01-08-Test Budget.zip" ]; then
    if sh scripts/import-test-budget.sh; then
      echo "✅ Test budget imported successfully!"
      return 0
    else
      echo "❌ Failed to import test budget"
      return 1
    fi
  else
    echo "⚠️  No test budget zip file found"
    echo "Create one by exporting a budget from Actual and place it in test-data/"
    return 1
  fi
}

# Function to get sync ID
get_sync_id() {
  echo ""
  echo "Getting budget sync ID..."
  
  # The init script should output the sync ID
  # If we need to query it, we'd use the API here
  echo "Note: Sync ID should be output by init script"
}

# Main execution
main() {
  if ! wait_for_server; then
    exit 1
  fi
  
  if ! bootstrap_password; then
    exit 1
  fi
  
  if ! create_test_budget; then
    exit 1
  fi
  
  get_sync_id
  
  echo ""
  echo "=== Bootstrap Complete ==="
  echo "✅ Server ready for MCP connection"
  echo ""
  echo "Environment variables:"
  echo "  ACTUAL_SERVER_URL=$SERVER_URL"
  echo "  ACTUAL_PASSWORD=$PASSWORD"
  
  if [ -f /tmp/actual-sync-id.txt ]; then
    SYNC_ID=$(cat /tmp/actual-sync-id.txt)
    echo "  ACTUAL_BUDGET_SYNC_ID=\"$SYNC_ID\""
  else
    echo "  ACTUAL_BUDGET_SYNC_ID=\"2026-01-08-Test Budget\""
  fi
  
  echo ""
  echo "🌐 Open http://${SERVER_URL##http://} to verify the budget"
}

main
