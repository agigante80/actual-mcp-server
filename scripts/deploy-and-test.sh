#!/usr/bin/env bash
# deploy-and-test.sh
# Periodic maintenance / update script.
#
# PREREQUISITES: all services must already be installed, configured,
# and running before this script is used for the first time:
#
#   • Actual Budget   (Finance-actual-budget/docker-compose.yml)
#   • Actual MCP Server: TWO containers from the same image:
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
#   7. Run HTTP integration tests against bearer instance (port 3601)
#   8. Run stdio smoke against the same container (both transports covered)
#   9. (full level only) Run the #270 upstream-stall regression check
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
#   bash scripts/deploy-and-test.sh [TEST_LEVEL] [--bank-sync]
#   TEST_LEVEL: sanity | smoke | normal | extended | full (default: full)
#   --bank-sync: opt-in flag to include per-account bank sync tests (GoCardless/SimpleFIN)
#                Skipped by default. Also honoured via MCP_TEST_BANK_SYNC=true env var.

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
DOCKER_DIR="$HOME/docker/librechat-MCP-actual"
DEV_DIR="$HOME/dev-github-personal/actual-mcp-server"
MCP_SERVER_URL="https://localhost:3601/http"
MCP_AUTH_TOKEN="MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6"
STDIO_CONTAINER="actual-mcp-bearer-backend"   # container the stdio smoke execs into
# Parse positional + flag args
TEST_LEVEL="full"
BANK_SYNC_FLAG=""   # empty = disabled
for arg in "$@"; do
  case "$arg" in
    --bank-sync) BANK_SYNC_FLAG="true" ;;
    *)           TEST_LEVEL="$arg"    ;;
  esac
done
# Also honour the environment variable
if [ "${MCP_TEST_BANK_SYNC:-}" = "true" ]; then
  BANK_SYNC_FLAG="true"
fi
HEALTH_RETRIES=30          # × 3s = 90s max wait
# Count registered tools directly from source, stays correct automatically
EXPECTED_TOOL_COUNT=$(grep -c "^\s*'actual_" "$DEV_DIR/src/actualToolsManager.ts")

# ── Colours ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
info() { echo -e "${YELLOW}▶ $*${NC}"; }
err()  { echo -e "${RED}✗ $*${NC}" >&2; }

echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║  Actual MCP Server: Deploy & Integration Test        ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Sync code & rebuild MCP image ──────────────────────────────────────
info "Step 1/9: Sync latest code & rebuild MCP server image..."
bash "$DOCKER_DIR/actual-mcp-server/sync-and-build.sh"
ok "MCP image rebuilt"

# ── 2. Pull latest upstream images ────────────────────────────────────────
info "Step 2/9: Pulling latest upstream images..."

pull_image() {
  local image="$1"
  local label="$2"
  local output
  output=$(docker pull "$image" 2>&1)
  if echo "$output" | grep -q "Status: Downloaded newer image"; then
    ok "$label: new image downloaded"
  elif echo "$output" | grep -q "Status: Image is up to date"; then
    ok "$label: already up to date"
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
info "Step 3/9: Recreating both MCP server containers (OIDC:3600 + Bearer:3601)..."
docker compose \
  -f "$DOCKER_DIR/actual-mcp-server/docker-compose-local-build.yaml" \
  up -d --force-recreate
ok "actual-mcp-server-backend (OIDC, port 3600) recreated"
ok "actual-mcp-bearer-backend (Bearer, port 3601) recreated"

# ── 4. Restart LibreChat ────────────────────────────────────────────────────
info "Step 4/9: Restarting LibreChat (ai-librechat, ai-librechat-rag-api)..."
docker compose \
  -f "$DOCKER_DIR/LibreChat/docker-compose.yml" \
  up -d --force-recreate ai-librechat ai-librechat-rag-api
ok "LibreChat restarted (mongo/pgvector/meilisearch untouched)"

# ── 5. Restart LobeChat ────────────────────────────────────────────────────
info "Step 5/9: Restarting LobeChat (lobe)..."
docker compose \
  -f "$DOCKER_DIR/lobechatAI/docker-compose.yml" \
  up -d --force-recreate lobe
ok "LobeChat restarted (postgres/minio/casdoor untouched)"

# ── 6. Wait for bearer MCP server health ─────────────────────────────────
info "Step 6/9: Waiting for actual-mcp-bearer-backend (port 3601) to become healthy..."
for i in $(seq 1 "$HEALTH_RETRIES"); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' actual-mcp-bearer-backend 2>/dev/null || true)
  if [ "$STATUS" = "healthy" ]; then
    ok "MCP bearer server healthy (attempt $i)"
    break
  fi
  if [ "$i" -eq "$HEALTH_RETRIES" ]; then
    err "MCP server did not become healthy after $((HEALTH_RETRIES * 3))s, aborting tests"
    docker logs --tail 30 actual-mcp-bearer-backend >&2
    exit 1
  fi
  echo "  ($i/${HEALTH_RETRIES}) status=${STATUS:-unknown}, waiting 3s..."
  sleep 3
done

# ── 7. Run HTTP integration tests against bearer instance (port 3601) ──────
BANK_SYNC_LABEL=""
if [ -n "$BANK_SYNC_FLAG" ]; then
  BANK_SYNC_LABEL=" + bank-sync"
fi
info "Step 7/9: HTTP integration tests against bearer instance port 3601 (level=${TEST_LEVEL}${BANK_SYNC_LABEL}, tools=${EXPECTED_TOOL_COUNT})..."
echo ""
EXPECTED_TOOL_COUNT="$EXPECTED_TOOL_COUNT" \
  MCP_TEST_BANK_SYNC="${BANK_SYNC_FLAG}" \
  NODE_TLS_REJECT_UNAUTHORIZED=0 \
  node "$DEV_DIR/tests/manual/index.js" \
  "$MCP_SERVER_URL" \
  "$MCP_AUTH_TOKEN" \
  "$TEST_LEVEL" \
  yes
echo ""

# ── 8. Run stdio smoke against the same container ──────────────────────────
# The HTTP suite above never touches the stdio transport. This runs the server
# over stdin/stdout (docker exec into the bearer container, reusing its config)
# and does a real MCP round-trip, so both transports are exercised every run.
info "Step 8/9: stdio smoke against ${STDIO_CONTAINER} (functional round-trip, tools=${EXPECTED_TOOL_COUNT})..."
echo ""
EXPECTED_TOOL_COUNT="$EXPECTED_TOOL_COUNT" \
  MCP_STDIO_CONTAINER="$STDIO_CONTAINER" \
  node "$DEV_DIR/scripts/stdio-smoke.mjs"
echo ""

# ── 9. (full level only) #270 upstream-stall regression (stdio + HTTP) ──────
# Reproduces the personal-finance production hang: a stalled upstream operation
# must reject within a bounded time (per-op timeout) and release the global api
# mutex, instead of hanging forever and wedging every subsequent tool call.
# stdio hits this on every op (legacy init+download); HTTP hits it at session
# open / pool init. Heavy (injects netem packet loss on the Actual server via a
# privileged sidecar), so it runs only at the `full` level. While
# scripts/known-failing/270 exists the bug is expected: a reproduced hang is
# reported but does NOT fail the pipeline. Deleting that marker (done when #270
# is fixed) makes both checks enforcing.
KNOWN_FAILING_270="$DEV_DIR/scripts/known-failing/270"

# run_270_regression <label> <script> [env assignments...]
# Applies the marker-gated verdict. Exits the pipeline on a real failure.
run_270_regression() {
  local label="$1"; shift
  local script="$1"; shift
  info "  #270 regression (${label})..."
  set +e
  env "$@" node "$script"
  local rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    ok "  #270/${label}: stalled op rejected within bound (correct)"
    if [ -f "$KNOWN_FAILING_270" ]; then
      err "  #270/${label} now behaves correctly but scripts/known-failing/270 still exists. Delete it so the regression enforces."
      exit 1
    fi
  elif [ "$rc" -eq 2 ]; then
    if [ -f "$KNOWN_FAILING_270" ]; then
      info "  #270/${label} hang reproduced (EXPECTED while scripts/known-failing/270 exists). Not failing the pipeline."
    else
      err "  #270/${label} regression FAILED: stalled op hung and no known-failing marker is present."
      exit 1
    fi
  else
    err "  #270/${label} regression harness error (rc=$rc)."
    exit 1
  fi
  echo ""
}

if [ "$TEST_LEVEL" = "full" ]; then
  info "Step 9/9: #270 upstream-stall regression (stdio gated) + HTTP diagnostic..."
  echo ""
  # stdio: deterministic, gated. A stdio client has no request timeout, so a
  # server-side op hang is directly observable and this is a valid #270 gate.
  run_270_regression "stdio" "$DEV_DIR/scripts/regression-270-stall.mjs" "MCP_STDIO_CONTAINER=$STDIO_CONTAINER"
  # HTTP: informational only. The StreamableHTTP client times out a stalled
  # request (~11s), so a client-observed rejection cannot prove the server
  # released the mutex; that server-side guarantee is gated by the unit test
  # tests/unit/adapter_op_timeout.test.js instead. This never fails the pipeline.
  info "  #270 HTTP diagnostic (informational; server-side guarantee is in tests/unit/adapter_op_timeout.test.js)..."
  set +e
  env "MCP_AUTH_TOKEN=$MCP_AUTH_TOKEN" "MCP_HTTP_URL=$MCP_SERVER_URL" \
    node "$DEV_DIR/scripts/diag-270-http.mjs"
  set -e
  echo ""
else
  info "Step 9/9: #270 upstream-stall regression skipped (runs at 'full' level only; current level=${TEST_LEVEL})."
fi
ok "All done: deploy-and-test complete (HTTP + stdio${TEST_LEVEL:+, level=$TEST_LEVEL})"
