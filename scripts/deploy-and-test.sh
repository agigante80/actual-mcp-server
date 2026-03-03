#!/usr/bin/env bash
# deploy-and-test.sh
# Periodic maintenance / update script.
#
# PREREQUISITES — all services must already be installed, configured,
# and running before this script is used for the first time:
#
#   • Actual Budget   (Finance-actual-budget/docker-compose.yml)
#   • Actual MCP Server — TWO containers from the same image:
#       - actual-mcp-server-backend  port 3600  OIDC/Casdoor  (LibreChat, LobeChat)
#       - actual-mcp-bearer-backend  port 3601  Bearer token  (automated tests)
#     Both defined in: actual-mcp-server/docker-compose-local-build.yaml
#   • LibreChat       (LibreChat/docker-compose.yml)
#   • LobeChat        (lobechatAI/docker-compose.yml)
#
# This script does NOT perform first-time installation. It simply keeps
# everything up to date and verifies the MCP server is working correctly:
#
#   1. Sync latest dev code → docker build folder & rebuild MCP image
#   2. Pull latest upstream images (actual-budget, librechat, lobechat)
#   3. Recreate BOTH MCP containers (OIDC:3600 + Bearer:3601)
#   4. Independently restart LibreChat        (picks up new image if any)
#   5. Independently restart LobeChat         (picks up new image if any)
#   6. Wait for actual-mcp-bearer-backend (port 3601) to become healthy
#   7. Run integration tests against bearer instance (port 3601)
#
# DOCUMENTATION
#   Each service has its own README in $DOCKER_DIR and its subdirectories.
#   Consult them if a service needs first-time setup or troubleshooting:
#     $DOCKER_DIR/README.md                          ← environment overview
#     $DOCKER_DIR/actual-mcp-server/DEPLOYMENT.md   ← MCP server deploy guide (both instances)
#     $DOCKER_DIR/Finance-actual-budget/README.md    ← Actual Budget setup
#     $DOCKER_DIR/LibreChat/                         ← LibreChat config files
#     $DOCKER_DIR/lobechatAI/                        ← LobeChat config files
#
# Usage:
#   bash scripts/deploy-and-test.sh [TEST_LEVEL]
#   TEST_LEVEL: sanity | smoke | normal | extended | full (default: full)

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
DOCKER_DIR="$HOME/docker/librechat-MCP-actual"
DEV_DIR="$HOME/dev/actual-mcp-server"
MCP_SERVER_URL="http://localhost:3601/http"
MCP_AUTH_TOKEN="MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6"
TEST_LEVEL="${1:-full}"
HEALTH_RETRIES=30          # × 3s = 90s max wait
# Count registered tools directly from source — stays correct automatically
EXPECTED_TOOL_COUNT=$(grep -c "^\s*'actual_" "$DEV_DIR/src/actualToolsManager.ts")

# ── Colours ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
info() { echo -e "${YELLOW}▶ $*${NC}"; }
err()  { echo -e "${RED}✗ $*${NC}" >&2; }

echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║  Actual MCP Server — Deploy & Integration Test       ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Sync code & rebuild MCP image ──────────────────────────────────────
info "Step 1/7 — Sync latest code & rebuild MCP server image..."
bash "$DOCKER_DIR/actual-mcp-server/sync-and-build.sh"
ok "MCP image rebuilt"

# ── 2. Pull latest upstream images ────────────────────────────────────────
info "Step 2/7 — Pulling latest upstream images..."

pull_image() {
  local image="$1"
  local label="$2"
  local output
  output=$(docker pull "$image" 2>&1)
  if echo "$output" | grep -q "Status: Downloaded newer image"; then
    ok "$label — new image downloaded"
  elif echo "$output" | grep -q "Status: Image is up to date"; then
    ok "$label — already up to date"
  else
    # Print last line as summary
    echo "  $image: $(echo "$output" | tail -1)"
  fi
}

pull_image "actualbudget/actual-server:latest"                      "Actual Budget"
pull_image "ghcr.io/danny-avila/librechat:latest"                   "LibreChat"
pull_image "ghcr.io/danny-avila/librechat-rag-api-dev-lite:latest"  "LibreChat RAG API"
pull_image "lobehub/lobe-chat-database:latest"                      "LobeChat"

# ── 3. Recreate MCP server containers ─────────────────────────────────────
info "Step 3/7 — Recreating both MCP server containers (OIDC:3600 + Bearer:3601)..."
docker compose \
  -f "$DOCKER_DIR/actual-mcp-server/docker-compose-local-build.yaml" \
  up -d --force-recreate
ok "actual-mcp-server-backend (OIDC, port 3600) recreated"
ok "actual-mcp-bearer-backend (Bearer, port 3601) recreated"

# ── 4. Restart LibreChat ────────────────────────────────────────────────────
info "Step 4/7 — Restarting LibreChat (ai-librechat, ai-librechat-rag-api)..."
docker compose \
  -f "$DOCKER_DIR/LibreChat/docker-compose.yml" \
  up -d --force-recreate ai-librechat ai-librechat-rag-api
ok "LibreChat restarted (mongo/pgvector/meilisearch untouched)"

# ── 5. Restart LobeChat ────────────────────────────────────────────────────
info "Step 5/7 — Restarting LobeChat (lobe)..."
docker compose \
  -f "$DOCKER_DIR/lobechatAI/docker-compose.yml" \
  up -d --force-recreate lobe
ok "LobeChat restarted (postgres/minio/casdoor untouched)"

# ── 6. Wait for bearer MCP server health ─────────────────────────────────
info "Step 6/7 — Waiting for actual-mcp-bearer-backend (port 3601) to become healthy..."
for i in $(seq 1 "$HEALTH_RETRIES"); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' actual-mcp-bearer-backend 2>/dev/null || true)
  if [ "$STATUS" = "healthy" ]; then
    ok "MCP bearer server healthy (attempt $i)"
    break
  fi
  if [ "$i" -eq "$HEALTH_RETRIES" ]; then
    err "MCP server did not become healthy after $((HEALTH_RETRIES * 3))s — aborting tests"
    docker logs --tail 30 actual-mcp-bearer-backend >&2
    exit 1
  fi
  echo "  ($i/${HEALTH_RETRIES}) status=${STATUS:-unknown} — waiting 3s..."
  sleep 3
done

# ── 7. Run integration tests against bearer instance (port 3601) ───────────
info "Step 7/7 — Running integration tests against bearer instance port 3601 (level=${TEST_LEVEL}, tools=${EXPECTED_TOOL_COUNT})..."
echo ""
EXPECTED_TOOL_COUNT="$EXPECTED_TOOL_COUNT" node "$DEV_DIR/tests/manual/index.js" \
  "$MCP_SERVER_URL" \
  "$MCP_AUTH_TOKEN" \
  "$TEST_LEVEL" \
  yes
echo ""
ok "All done — deploy-and-test complete"
