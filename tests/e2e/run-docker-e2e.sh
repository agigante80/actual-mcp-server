#!/bin/bash
#
# Docker-based E2E Test Runner
# Orchestrates full stack testing: Actual Budget + MCP Server (Docker build) + Test Runner
#
# Usage:
#   ./tests/e2e/run-docker-e2e.sh              # Run tests and cleanup
#   ./tests/e2e/run-docker-e2e.sh --no-cleanup # Leave containers running for debugging
#   ./tests/e2e/run-docker-e2e.sh --build-only # Just build, don't test
#

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.test.yaml"

# Parse arguments
NO_CLEANUP=false
BUILD_ONLY=false
VERBOSE=false
TEST_LEVEL="smoke"  # Default to smoke tests

for arg in "$@"; do
  case $arg in
    smoke|full)
      TEST_LEVEL=$arg
      shift
      ;;
    --no-cleanup)
      NO_CLEANUP=true
      shift
      ;;
    --build-only)
      BUILD_ONLY=true
      shift
      ;;
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [LEVEL] [OPTIONS]"
      echo ""
      echo "Levels:"
      echo "  smoke           Run quick smoke tests (11 tests, ~20s) [default]"
      echo "  full            Run comprehensive tests (63 tests, ~120s)"
      echo ""
      echo "Options:"
      echo "  --no-cleanup    Leave containers running after tests (for debugging)"
      echo "  --build-only    Build images but don't run tests"
      echo "  --verbose, -v   Show detailed output"
      echo "  --help, -h      Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0                    # Run smoke tests"
      echo "  $0 smoke              # Run smoke tests"
      echo "  $0 full               # Run all 63 comprehensive tests"
      echo "  $0 full --no-cleanup  # Run full tests, leave containers running"
      exit 0
      ;;
  esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

# Cleanup function
cleanup() {
  if [ "$NO_CLEANUP" = false ]; then
    log_info "Cleaning up Docker resources..."
    cd "$PROJECT_ROOT"
    docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
    log_success "Cleanup complete"
  else
    log_warn "Skipping cleanup (--no-cleanup flag set)"
    log_info "To manually cleanup: cd $PROJECT_ROOT && docker compose -f docker-compose.test.yaml down -v"
  fi
}

# Set trap to cleanup on exit
if [ "$NO_CLEANUP" = false ]; then
  trap cleanup EXIT
fi

# Function to wait for service health
wait_for_service() {
  local service=$1
  local container_name=$2
  local max_attempts=30
  local attempt=1
  
  while [ $attempt -le $max_attempts ]; do
    # Check health status directly with docker inspect
    health_status=$(docker inspect "$container_name" --format='{{.State.Health.Status}}' 2>/dev/null || echo "none")
    
    if [ "$health_status" = "healthy" ]; then
      log_success "$service is healthy"
      return 0
    fi
    
    if [ $attempt -eq 1 ]; then
      echo -n "  Waiting for $service"
    fi
    echo -n "."
    sleep 2
    attempt=$((attempt + 1))
  done
  
  echo ""
  log_error "$service failed to become healthy after $max_attempts attempts"
  log_info "Showing $service logs:"
  docker compose -f "$COMPOSE_FILE" logs "$service" | tail -50
  return 1
}

# Main execution
cd "$PROJECT_ROOT"

echo ""
log_info "=========================================="
log_info "Docker-based E2E Test Suite"
log_info "=========================================="
echo ""

# Step 0: Clean up any existing containers and volumes
log_info "Step 0/5: Cleaning up previous test environment..."
docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
log_success "Previous environment cleaned"
echo ""

# Step 1: Build MCP server Docker image
log_info "Step 1/5: Building MCP server Docker image..."
if [ "$VERBOSE" = true ]; then
  docker compose -f "$COMPOSE_FILE" build mcp-server-test
else
  docker compose -f "$COMPOSE_FILE" build mcp-server-test > /dev/null 2>&1
fi
log_success "Docker image built successfully"

if [ "$BUILD_ONLY" = true ]; then
  log_success "Build complete (--build-only flag set)"
  exit 0
fi

# Step 2: Start Actual Budget server and bootstrap
log_info "Step 2/5: Starting Actual Budget server..."
docker compose -f "$COMPOSE_FILE" up -d actual-budget-test

log_info "Step 3/5: Waiting for Actual Budget to be ready..."
sleep 3
MAX_WAIT=30
COUNT=0
while ! curl -sf http://localhost:5007/health > /dev/null 2>&1; do
  if [ $COUNT -ge $MAX_WAIT ]; then
    log_error "Actual Budget failed to start after ${MAX_WAIT} seconds"
    docker compose -f "$COMPOSE_FILE" logs actual-budget-test | tail -50
    exit 1
  fi
  echo -n "."
  sleep 2
  COUNT=$((COUNT + 2))
done
echo ""
log_success "Actual Budget is ready"

# `docker compose up <service>` EXITS 0 EVEN WHEN THE CONTAINER FAILS, so a bare `if compose up`
# can never detect a failed bootstrap and its error branch is dead code. Verified on this machine
# with a service whose command is `exit 7`: plain `up` exits 0, `up --exit-code-from <svc>` exits 7.
# Both bootstraps therefore use --exit-code-from. This mattered more once #423 removed the
# `depends_on: service_completed_successfully` from mcp-server-test (that dependency was the only
# other thing checking the stdio bootstrap, and it broke every non-stdio level).
log_info "Step 4/5: Bootstrapping Actual Budget and importing test data..."
if docker compose -f "$COMPOSE_FILE" up --exit-code-from actual-budget-bootstrap --abort-on-container-exit actual-budget-bootstrap; then
  log_success "Bootstrap complete"
else
  log_error "Bootstrap failed!"
  docker compose -f "$COMPOSE_FILE" logs actual-budget-bootstrap | tail -50
  exit 1
fi

# Step 4b (#423): the SECOND Actual server, used only by the stdio leg, and its bootstrap.
#
# It has to be brought up HERE, with `up`, and not left to step 5. `docker compose create` only
# CREATES dependency containers, it never starts them and it does not build a missing image, so
# the first version of this change left `actual-budget-stdio-bootstrap` unbuilt: the run died at
# `No such image` before a single test ran. The existing bootstrap works only because step 4 uses
# `up`, which builds on demand. Mirroring steps 2 to 4 exactly is what keeps that true.
#
# Skipped when the stdio leg is off, so an HTTP-only run does not pay for a second server.
if [ "$TEST_LEVEL" = "full" ] && [ "${RUN_STDIO_E2E:-true}" = "true" ]; then
  log_info "Step 4b: Starting the dedicated stdio Actual Budget server..."
  docker compose -f "$COMPOSE_FILE" up -d actual-budget-stdio-test

  STDIO_WAIT=0
  while ! curl -sf http://localhost:5008/health > /dev/null 2>&1; do
    if [ $STDIO_WAIT -ge 30 ]; then
      log_error "The stdio Actual Budget server failed to start after 30 seconds"
      docker compose -f "$COMPOSE_FILE" logs actual-budget-stdio-test | tail -50
      exit 1
    fi
    echo -n "."
    sleep 2
    STDIO_WAIT=$((STDIO_WAIT + 2))
  done
  echo ""
  log_success "The stdio Actual Budget server is ready"

  log_info "Step 4c: Bootstrapping the stdio budget..."
  if docker compose -f "$COMPOSE_FILE" up --exit-code-from actual-budget-stdio-bootstrap --abort-on-container-exit actual-budget-stdio-bootstrap; then
    log_success "Stdio bootstrap complete"
  else
    log_error "Stdio bootstrap failed!"
    docker compose -f "$COMPOSE_FILE" logs actual-budget-stdio-bootstrap | tail -50
    exit 1
  fi
fi

# Step 5: Start MCP server
log_info "Starting MCP server..."
# Use 'create' then 'docker start' (not compose start) to avoid depends_on check.
# `create` neither starts a dependency nor builds a missing image, which is why every service
# this stack needs is brought up explicitly above.
if ! docker compose -f "$COMPOSE_FILE" create mcp-server-test; then
  log_error "Could not create the MCP server container"
  exit 1
fi
docker start mcp-server-e2e-test

# Wait for MCP server to be ready
log_info "Waiting for MCP server to be ready..."

wait_for_service "mcp-server-test" "mcp-server-e2e-test" || exit 1

echo ""
log_success "All services are ready"
echo ""

# Show service info
log_info "Service URLs:"
echo "  • Actual Budget: http://localhost:5007"
echo "  • MCP Server:    http://localhost:3602/http"
echo "  • Health Check:  http://localhost:3602/health"
echo ""

# Test MCP server is actually responding
log_info "Testing MCP server..."
if curl -sf http://localhost:3602/health > /dev/null; then
  log_success "MCP server is responding"
else
  log_error "MCP server is not responding"
  exit 1
fi
echo ""

# Step 6: Run E2E tests
if [ "$TEST_LEVEL" = "full" ]; then
  log_info "Step 6/6: Running FULL E2E tests (63 tests - all 51 tools + errors)..."
  PLAYWRIGHT_PROJECT="docker-e2e-full"
else
  log_info "Step 6/6: Running SMOKE E2E tests (11 quick tests)..."
  PLAYWRIGHT_PROJECT="docker-e2e-smoke"
fi
echo ""

# Export environment variable for docker compose
export PLAYWRIGHT_PROJECT

# Run test container with proper environment variable
# Note: Using 'docker compose run --no-deps' to skip dependency checks (already started manually)
if [ "$VERBOSE" = true ]; then
  docker compose -f "$COMPOSE_FILE" run --rm --no-deps e2e-test-runner
  TEST_EXIT_CODE=$?
else
  docker compose -f "$COMPOSE_FILE" run --rm --no-deps e2e-test-runner 2>&1 | tee /tmp/e2e-docker-test-output.log
  TEST_EXIT_CODE=${PIPESTATUS[0]}
fi

echo ""

# Step 6b (#383): the SAME suite over stdio, on the HOST rather than in the runner container.
#
# It cannot run in that container: it mounts only tests/, the config and the two package files,
# so it has neither the server's dist/ nor a docker socket and no route to a stdio server.
# Giving the test runner the docker socket to save a process boundary is not a trade worth
# making. The host has both docker and node (CI does `npm ci` before calling this script), and
# this is the same approach tests/manual/mcp-client-stdio.js already uses.
#
# Sequential, not parallel. #423 gave the stdio leg its OWN Actual server, so the two no longer
# share a rate-limit window, but they still share this host's CPU and the one MCP container, and
# a parallel run would make a failure in either leg hard to attribute. Roughly doubles the E2E
# wall clock.
#
# ON by default at the full level since #423, and GATING. Set RUN_STDIO_E2E=false to skip it.
# History, because the default flipped twice: #383 landed the infrastructure but the leg could
# not even start (Playwright refused the config: the HTML report was nested inside test-results),
# and once that was fixed four tests in the write-heavy block failed on Actual's rate limiter,
# which the two legs shared. #423 fixed the reporter path and gave stdio a dedicated server.
if [ "$TEST_LEVEL" = "full" ] && [ $TEST_EXIT_CODE -eq 0 ] && [ "${RUN_STDIO_E2E:-true}" = "true" ]; then
  # COOL-DOWN, now 0 by default (#423). It existed because both legs shared one Actual server and
  # therefore one 60-second rate-limit window: the pacer in tests/shared/e2e-helpers.ts is module
  # scoped, so it shares a window only WITHIN a process, and these legs are different processes.
  # The stdio leg started with its own counter at zero while the window was still full from HTTP,
  # and its first login was refused. Because Playwright restarts a worker after a failure, that
  # one refusal became 39 server restarts and 377 rate-limit errors in CI.
  #
  # The stdio leg now has its OWN server (actual-budget-stdio-test), so there is no shared window
  # left to drain and the wait is pure wall clock. The knob is KEPT rather than deleted: if the
  # legs ever share a server again, this is the first thing to turn back up.
  STDIO_COOLDOWN_S="${STDIO_COOLDOWN_S:-0}"
  # Numeric guard: `set -e` is active, so a non-integer here (STDIO_COOLDOWN_S=75s, say) would
  # abort the whole run with "integer expression expected" rather than warn.
  case "$STDIO_COOLDOWN_S" in
    ''|*[!0-9]*) log_warn "STDIO_COOLDOWN_S is not a whole number of seconds; ignoring it"; STDIO_COOLDOWN_S=0 ;;
  esac
  if [ "$STDIO_COOLDOWN_S" -gt 0 ]; then
    log_info "Cooling down ${STDIO_COOLDOWN_S}s before the stdio leg..."
    sleep "$STDIO_COOLDOWN_S"
  fi

  # Point the leg at its OWN server and its OWN budget. Both are required and neither can be
  # inherited: `docker exec` inherits the container's CONFIGURED env, which names the HTTP leg's
  # server, and the HTTP sync id is at /tmp/actual-sync-id.txt inside the same container.
  export MCP_STDIO_SERVER_URL="${MCP_STDIO_SERVER_URL:-http://actual-budget-stdio-test:5006}"
  export MCP_STDIO_SYNC_ID_FILE="${MCP_STDIO_SYNC_ID_FILE:-/tmp-stdio/actual-sync-id.txt}"

  log_info "Step 6b: Running the same suite over STDIO (host-side, docker exec)..."
  echo ""
  # set -e is active, so capture the exit through an `if` (a bare `cmd; rc=$?` would exit the
  # script the moment playwright fails, before the advisory check below ever runs).
  if MCP_TEST_TRANSPORT=stdio npx playwright test \
    --config=playwright.config.docker.ts --project=docker-e2e-full-stdio; then
    STDIO_EXIT_CODE=0
  else
    STDIO_EXIT_CODE=$?
  fi
  # GATING since #423. stdio is the transport half our Claude Desktop and Claude Code users run,
  # and an advisory gate on the half with the largest desktop install base is not a gate.
  # STDIO_E2E_GATING=false downgrades it to advisory for a local run that is deliberately dirty.
  if [ $STDIO_EXIT_CODE -ne 0 ]; then
    if [ "${STDIO_E2E_GATING:-true}" = "true" ]; then
      log_error "STDIO transport FAILED (the HTTP transport passed)."
      log_info "Re-run just it with:"
      log_info "  MCP_STDIO_SERVER_URL=http://actual-budget-stdio-test:5006 MCP_STDIO_SYNC_ID_FILE=/tmp-stdio/actual-sync-id.txt \\"
      log_info "  MCP_TEST_TRANSPORT=stdio npx playwright test --config=playwright.config.docker.ts --project=docker-e2e-full-stdio"
      TEST_EXIT_CODE=$STDIO_EXIT_CODE
    else
      log_warn "STDIO transport had failures (advisory: STDIO_E2E_GATING=false)."
    fi
  else
    log_success "STDIO transport passed"
  fi
  echo ""
fi

# Check results
if [ $TEST_EXIT_CODE -eq 0 ]; then
  log_success "=========================================="
  log_success "All E2E tests passed! ✨"
  log_success "=========================================="
  exit 0
else
  log_error "=========================================="
  log_error "E2E tests failed"
  log_error "=========================================="
  log_warn "Test output saved to: /tmp/e2e-docker-test-output.log"
  log_info ""
  log_info "Debug tips:"
  echo "  1. Check service logs:"
  echo "     docker compose -f $COMPOSE_FILE logs mcp-server-test"
  echo "     docker compose -f $COMPOSE_FILE logs actual-budget-test"
  echo ""
  echo "  2. Access services directly:"
  echo "     curl http://localhost:3602/health"
  echo "     curl http://localhost:5007"
  echo ""
  echo "  3. Re-run with --no-cleanup to inspect containers:"
  echo "     $0 --no-cleanup"
  echo ""
  exit 1
fi
