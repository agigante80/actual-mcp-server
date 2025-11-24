#!/bin/bash
# Full Integration Test Runner
# Starts Docker Actual Budget, builds & starts MCP server, runs integration test
# Preserves test data for manual review in browser

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ACTUAL_URL="http://localhost:5006"
MCP_URL="http://localhost:3600/http"

# Test level: smoke, accounts, normal, or full
TEST_LEVEL="${1:-full}"

echo "🎬 Full MCP Integration Test with Docker Actual"
echo "================================================"
echo "Test Level: $TEST_LEVEL"
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "🧹 Stopping MCP server..."
    pkill -f "node dist/src/index.js" 2>/dev/null || true
    
    echo "🐳 Stopping Docker Actual Budget..."
    cd "$PROJECT_ROOT"
    docker-compose -f docker-compose.yaml --profile fullstack down 2>/dev/null || true
    
    echo "✨ Cleanup complete"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Step 1: Check/Start Docker Actual Budget
echo "🐳 Checking Docker Actual Budget..."
cd "$PROJECT_ROOT"

# Check if Actual Budget is already running on port 5006
if docker ps | grep -q "5006"; then
    EXISTING_CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "actual|finance" | head -1)
    echo "   ✅ Actual Budget already running: $EXISTING_CONTAINER"
    echo "   Using existing instance at $ACTUAL_URL"
elif docker ps | grep -q "actual-budget-server"; then
    echo "   Docker Actual container exists, restarting..."
    docker restart actual-budget-server
else
    echo "   Starting new Actual Budget container..."
    docker-compose -f docker-compose.yaml --profile fullstack up -d actual-server
fi

# Wait for Actual to be ready
echo "⏳ Waiting for Actual Budget to start..."
for i in {1..30}; do
    if curl -sf "$ACTUAL_URL" >/dev/null 2>&1; then
        echo "✅ Actual Budget is running at $ACTUAL_URL"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Actual Budget failed to start after 30 seconds"
        exit 1
    fi
    sleep 1
done

# Step 2: Build MCP Server
echo ""
echo "🔧 Building MCP server..."
cd "$PROJECT_ROOT"
npm run build || exit 1

# Step 3: Start MCP Server
echo ""
echo "🚀 Starting MCP server..."
node dist/src/index.js --http > /tmp/mcp-server.log 2>&1 &
MCP_PID=$!

# Wait for MCP server to start
echo "⏳ Waiting for MCP server to start..."
sleep 5

if ! curl -sf "http://localhost:3600/health" >/dev/null 2>&1; then
    echo "❌ MCP server failed to start"
    echo "Last 20 lines of log:"
    tail -20 /tmp/mcp-server.log
    exit 1
fi

echo "✅ MCP server is running at $MCP_URL"

# Step 4: Get auth token from environment or .env
if [ -z "$MCP_AUTH_TOKEN" ]; then
    if [ -f "$PROJECT_ROOT/.env" ]; then
        # Try MCP_AUTH_TOKEN first, then MCP_SSE_AUTHORIZATION
        MCP_AUTH_TOKEN=$(grep "^MCP_AUTH_TOKEN=" "$PROJECT_ROOT/.env" | cut -d'=' -f2)
        if [ -z "$MCP_AUTH_TOKEN" ]; then
            MCP_AUTH_TOKEN=$(grep "^MCP_SSE_AUTHORIZATION=" "$PROJECT_ROOT/.env" | cut -d'=' -f2)
        fi
    fi
fi

if [ -n "$MCP_AUTH_TOKEN" ]; then
    echo "✅ Using auth token from .env"
else
    echo ""
    echo "⚠️  No auth token found in environment or .env"
    echo "   Server may require authentication"
fi

# Step 5: Run Integration Test (NO CLEANUP)
echo ""
echo "🧪 Running integration test (preserving data for manual review)..."
echo "   Test Level: $TEST_LEVEL"
echo "   MCP URL: $MCP_URL"
echo "   Auth Token: ${MCP_AUTH_TOKEN:0:10}..."
echo ""

cd "$PROJECT_ROOT"
if [ -n "$MCP_AUTH_TOKEN" ]; then
    node tests/manual/actual-mcp-integration-test.js "$MCP_URL" "$MCP_AUTH_TOKEN" "$TEST_LEVEL" no
else
    node tests/manual/actual-mcp-integration-test.js "$MCP_URL" "" "$TEST_LEVEL" no
fi

# Step 6: Summary and Manual Review Instructions
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ INTEGRATION TEST COMPLETE - Data Preserved for Review"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📍 Services Running:"
echo "   • Actual Budget:  $ACTUAL_URL"
echo "   • MCP Server:     $MCP_URL"
echo "   • MCP Logs:       /tmp/mcp-server.log"
echo ""
echo "📊 Manual Review Instructions:"
echo "   1. Open Actual Budget: $ACTUAL_URL"
echo "   2. Check for test accounts starting with 'MCP-Test-'"
echo "   3. Verify categories, payees, transactions if full test"
echo "   4. Check database directly:"
echo "      sqlite3 test-actual-data/_test-budget/db.sqlite \\"
echo "        \"SELECT name, tombstone FROM accounts WHERE name LIKE 'MCP-Test%';\""
echo ""
echo "🔍 Verification:"
echo "   All test data should have tombstone=0 and be visible in UI"
echo ""
echo "🛑 To stop services:"
echo "   Press Ctrl+C or run:"
echo "   pkill -f 'node dist/src/index.js'"
echo "   docker-compose -f docker-compose.yaml down"
echo ""

# Keep services running
echo "⏸️  Services will continue running until you press Ctrl+C..."
echo ""

# Wait indefinitely
tail -f /tmp/mcp-server.log
