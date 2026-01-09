#!/bin/bash
# Test script for batch budget updates using Docker infrastructure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🧪 Testing Batch Budget Updates (Docker)"
echo "========================================================================"
echo ""

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Start the Docker stack
echo "🐳 Starting Docker test environment..."
cd "$PROJECT_ROOT"
docker compose -f docker-compose.test.yaml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check if services are running
if ! docker compose -f docker-compose.test.yaml ps | grep -q "actual-budget-test.*Up"; then
    echo "❌ Actual Budget test container is not running"
    docker compose -f docker-compose.test.yaml logs actual-budget-test
    exit 1
fi

if ! docker compose -f docker-compose.test.yaml ps | grep -q "mcp-server-test.*Up"; then
    echo "❌ MCP Server test container is not running"
    docker compose -f docker-compose.test.yaml logs mcp-server-test
    exit 1
fi

echo "✅ Services are ready"
echo ""

# Run the test script inside the MCP server container
echo "🚀 Running batch budget update tests..."
docker compose -f docker-compose.test.yaml exec -T mcp-server-test \
    node tests/test-batch-budget-updates.mjs

TEST_EXIT_CODE=$?

# Cleanup
echo ""
echo "🧹 Cleaning up Docker environment..."
docker compose -f docker-compose.test.yaml down -v

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ All batch budget update tests passed!"
    exit 0
else
    echo ""
    echo "❌ Some tests failed (exit code: $TEST_EXIT_CODE)"
    exit $TEST_EXIT_CODE
fi
