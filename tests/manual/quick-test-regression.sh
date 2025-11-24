#!/bin/bash
# Quick Test Runner for Regression Fixes
# Uses existing Actual Budget container on port 5006

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "🔧 Quick Regression Test Setup"
echo "================================"
echo ""

# Check if Actual is running
echo "Checking Actual Budget server (port 5006)..."
if curl -sf http://localhost:5006 > /dev/null 2>&1; then
    echo "✓ Actual Budget is running on port 5006"
else
    echo "❌ Actual Budget is not running"
    echo "The container 'finance-actual-budget-main' should be running"
    echo "Try: docker ps | grep actual"
    exit 1
fi

# Start MCP server in background
echo ""
echo "Starting MCP server on port 3600..."
cd "$PROJECT_ROOT"

# Kill any existing MCP server on port 3600
if lsof -Pi :3600 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Stopping existing server on port 3600..."
    kill $(lsof -Pi :3600 -sTCP:LISTEN -t) 2>/dev/null || true
    sleep 2
fi

# Build and start MCP server
npm run build > /dev/null 2>&1
echo "✓ Build complete"

echo "Starting MCP HTTP server (background)..."
npm run start -- --http > /tmp/mcp-server-test.log 2>&1 &
MCP_PID=$!
echo "✓ MCP server started (PID: $MCP_PID)"

# Wait for server to be ready
echo "Waiting for MCP server to be ready..."
for i in {1..30}; do
    if curl -sf http://localhost:3600/http > /dev/null 2>&1; then
        echo "✓ MCP server is ready"
        break
    fi
    sleep 1
done

# Check if server is actually running
if ! curl -sf http://localhost:3600/http > /dev/null 2>&1; then
    echo "❌ MCP server failed to start"
    echo "Log output:"
    tail -20 /tmp/mcp-server-test.log
    kill $MCP_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo "🧪 Running Regression Tests..."
echo "================================"
echo ""

# Get the auth token from environment or use default
AUTH_TOKEN="${MCP_AUTH_TOKEN:-9381d5ca23f3746fdbcd2a9438ebe4cf}"

# Run the tests
cd "$SCRIPT_DIR"
if node actual-mcp-integration-test.js http://localhost:3600/http "$AUTH_TOKEN" full yes; then
    echo ""
    echo "✅ All regression tests passed!"
    RESULT=0
else
    echo ""
    echo "❌ Some tests failed"
    RESULT=1
fi

# Cleanup
echo ""
echo "Stopping MCP server..."
kill $MCP_PID 2>/dev/null || true
sleep 1

echo "✓ Cleanup complete"
echo ""

exit $RESULT
