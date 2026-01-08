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

for arg in "$@"; do
  case $arg in
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
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --no-cleanup    Leave containers running after tests (for debugging)"
      echo "  --build-only    Build images but don't run tests"
      echo "  --verbose, -v   Show detailed output"
      echo "  --help, -h      Show this help message"
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

log_info "Step 4/5: Bootstrapping Actual Budget and importing test data..."
if docker compose -f "$COMPOSE_FILE" up actual-budget-bootstrap; then
  log_success "Bootstrap complete"
else
  log_error "Bootstrap failed!"
  docker compose -f "$COMPOSE_FILE" logs actual-budget-bootstrap | tail -50
  exit 1
fi

# Step 5: Start MCP server
log_info "Starting MCP server..."
# Use 'create' then 'docker start' (not compose start) to avoid depends_on check
docker compose -f "$COMPOSE_FILE" create mcp-server-test
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
log_info "Step 6/6: Running E2E tests..."
echo ""

# Create and run Playwright container without depends_on check
docker compose -f "$COMPOSE_FILE" create e2e-test-runner

if [ "$VERBOSE" = true ]; then
  docker start -a e2e-test-runner
  TEST_EXIT_CODE=$?
else
  docker start -a e2e-test-runner 2>&1 | tee /tmp/e2e-docker-test-output.log
  TEST_EXIT_CODE=${PIPESTATUS[0]}
fi

echo ""

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
