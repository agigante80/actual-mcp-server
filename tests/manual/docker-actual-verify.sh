#!/bin/bash
# Simple Docker Actual Verification Test
# Verifies Docker Actual Budget starts and is accessible

set -e

TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/.." && pwd)"
ACTUAL_URL="http://localhost:5007"

echo "🎬 Docker Actual Budget Verification Test"
echo "========================================="
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "🧹 Cleaning up..."
    
    cd "$TEST_DIR/docker-actual-test"
    
    # Stop and remove containers
    if command -v docker-compose &> /dev/null; then
        docker-compose down -v --remove-orphans 2>/dev/null || true
    else
        docker compose down -v --remove-orphans 2>/dev/null || true
    fi
    
    echo "✨ Cleanup complete"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required"
    exit 1
fi

# Start Docker Actual Budget
echo "🐳 Starting Docker Actual Budget..."
cd "$TEST_DIR/docker-actual-test"

if command -v docker-compose &> /dev/null; then
    docker-compose up -d
else
    docker compose up -d
fi

# Wait for health check
echo "🏥 Waiting for Actual Budget to start..."
sleep 10

# Check if accessible
if curl -f "$ACTUAL_URL" &> /dev/null; then
    echo "✅ Docker Actual Budget is accessible at $ACTUAL_URL"
else
    echo "❌ Docker Actual Budget is not accessible"
    exit 1
fi

# Show the web interface
echo ""
echo "🎉 SUCCESS: Docker Actual Budget is running!"
echo ""
echo "📋 Next steps for manual testing:"
echo "  1. Open $ACTUAL_URL in your browser"
echo "  2. Create a new budget or upload an existing file"
echo "  3. Note the budget sync ID from the advanced settings"
echo "  4. Configure your .env with:"
echo "     ACTUAL_SERVER_URL=$ACTUAL_URL"
echo "     ACTUAL_PASSWORD=your-budget-password"
echo "     ACTUAL_BUDGET_SYNC_ID=your-sync-id"
echo "  5. Run: npm --silent run start -- --test-actual-tools"
echo ""
echo "💡 This Docker instance will be cleaned up when the script exits."
echo "   Press Ctrl+C to stop and cleanup, or wait 60 seconds..."

# Keep running for 60 seconds to allow manual inspection
sleep 60

echo ""
echo "⏰ Time limit reached, cleaning up..."