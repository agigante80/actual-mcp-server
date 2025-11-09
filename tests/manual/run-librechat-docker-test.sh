#!/bin/bash
# LibreChat Docker Integration Test Runner
# This script sets up and runs a comprehensive integration test with Docker LibreChat

set -e

echo "🎬 LibreChat Docker Integration Test"
echo "====================================="
echo ""

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed"
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose is required but not installed"
    exit 1
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed"
    exit 1
fi

echo "✅ All prerequisites are available"
echo ""

# Build the project
echo "🔧 Building the project..."
npm run build

# Run the integration test
echo "🚀 Starting LibreChat Docker integration test..."
echo "This will:"
echo "  - Start a temporary LibreChat Docker instance"
echo "  - Start the MCP server with HTTP interface"
echo "  - Test MCP server connectivity from LibreChat"
echo "  - Test basic tool execution"
echo "  - Clean up all resources"
echo ""

# Run the test with timeout
timeout 300 node dist/test/integration/librechat-docker.test.js || {
    exit_code=$?
    if [ $exit_code -eq 124 ]; then
        echo "⚠️  Test timed out after 5 minutes - forcing cleanup"
        # Force cleanup any hanging containers
        docker ps -q --filter "name=librechat-mcp-test" | xargs -r docker kill
        docker ps -aq --filter "name=librechat-mcp-test" | xargs -r docker rm -f
        echo "🧹 Forced cleanup completed"
        exit 1
    else
        exit $exit_code
    fi
}

echo ""
echo "🎉 LibreChat Docker integration test completed!"