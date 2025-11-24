#!/bin/bash
# =============================================================================
# Regression Tests for Recently Fixed Tools
# =============================================================================
# Tests the specific fixes made to:
# - rules_create: Optional 'op' field (defaults to 'set')
# - budget_updates_batch: Error resilience with large batches
# - accounts_update: Strict validation and field completeness
# - payees_update: Strict validation and category field support
#
# Requirements:
# - Actual Budget server running (default: http://localhost:5006)
# - MCP server running (default: http://localhost:3600)
# - Auth token for MCP server
#
# Usage:
#   ./test-regression-fixes.sh [MCP_URL] [TOKEN]
#   
# Example:
#   ./test-regression-fixes.sh http://localhost:3600/http YOUR_TOKEN_HERE
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

MCP_URL="${1:-http://localhost:3600/http}"
TOKEN="${2}"
ACTUAL_URL="${ACTUAL_SERVER_URL:-http://localhost:5006}"

echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}  Regression Tests for Recently Fixed Tools${NC}"
echo -e "${BLUE}=================================================${NC}"
echo ""
echo "MCP Server: $MCP_URL"
echo "Actual Budget: $ACTUAL_URL"
echo ""

# Check if Actual is running
echo -e "${YELLOW}Checking Actual Budget server...${NC}"
if curl -sf "$ACTUAL_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Actual Budget server is running${NC}"
else
    echo -e "${RED}❌ Actual Budget server is not accessible at $ACTUAL_URL${NC}"
    echo "Please start Actual Budget first:"
    echo "  cd tests/manual/test-stack/actual && docker compose up -d"
    exit 1
fi

# Check if MCP server is accessible
echo -e "${YELLOW}Checking MCP server...${NC}"
if curl -sf "$MCP_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ MCP server is accessible${NC}"
else
    echo -e "${RED}❌ MCP server is not accessible at $MCP_URL${NC}"
    echo "Please start MCP server first:"
    echo "  npm run build && npm run start -- --http"
    exit 1
fi

# Prompt for token if not provided
if [ -z "$TOKEN" ]; then
    echo ""
    echo -e "${YELLOW}No auth token provided${NC}"
    read -p "Enter MCP auth token (or press Enter if none required): " TOKEN
    echo ""
fi

# Build first to ensure latest code
echo -e "${YELLOW}Building project...${NC}"
cd "$PROJECT_ROOT"
npm run build > /dev/null 2>&1
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# Run the integration test with 'full' level to hit all regression tests
echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}  Running Full Integration Tests${NC}"
echo -e "${BLUE}  (Includes all regression test scenarios)${NC}"
echo -e "${BLUE}=================================================${NC}"
echo ""

cd "$SCRIPT_DIR"

# Run with full test level and auto-cleanup
if [ -n "$TOKEN" ]; then
    node actual-mcp-integration-test.js "$MCP_URL" "$TOKEN" full yes
else
    node actual-mcp-integration-test.js "$MCP_URL" "" full yes
fi

echo ""
echo -e "${GREEN}=================================================${NC}"
echo -e "${GREEN}  ✓ Regression Tests Complete${NC}"
echo -e "${GREEN}=================================================${NC}"
echo ""
echo "The following fixes were tested:"
echo "  ✓ rules_create: Optional 'op' field (defaults to 'set')"
echo "  ✓ budget_updates_batch: Large batch handling (35 ops)"
echo "  ✓ budget_updates_batch: Error resilience (partial failures)"
echo "  ✓ accounts_update: Strict validation (rejects invalid fields)"
echo "  ✓ accounts_update: Multiple fields (name, notes, offbudget)"
echo "  ✓ payees_update: Category field support"
echo "  ✓ payees_update: Strict validation (rejects invalid fields)"
echo ""
