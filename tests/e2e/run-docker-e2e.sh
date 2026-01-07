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
    docker-compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
    log_success "Cleanup complete"
  else
    log_warn "Skipping cleanup (--no-cleanup flag set)"
    log_info "To manually cleanup: cd $PROJECT_ROOT && docker-compose -f docker-compose.test.yaml down -v"
  fi
}

# Set trap to cleanup on exit
if [ "$NO_CLEANUP" = false ]; then
  trap cleanup EXIT
fi

# Main execution
cd "$PROJECT_ROOT"

echo ""
log_info "=========================================="
log_info "Docker-based E2E Test Suite"
log_info "=========================================="
echo ""

# Step 1: Build MCP server Docker image
log_info "Step 1/4: Building MCP server Docker image..."
if [ "$VERBOSE" = true ]; then
  docker-compose -f "$COMPOSE_FILE" build mcp-server-test
else
  docker-compose -f "$COMPOSE_FILE" build mcp-server-test > /dev/null 2>&1
fi
log_success "Docker image built successfully"

if [ "$BUILD_ONLY" = true ]; then
  log_success "Build complete (--build-only flag set)"
  exit 0
fi

# Step 2: Start services
log_info "Step 2/4: Starting services (Actual Budget + MCP Server)..."
docker-compose -f "$COMPOSE_FILE" up -d actual-budget-test mcp-server-test

# Step 3: Wait for services to be healthy
log_info "Step 3/4: Waiting for services to be ready..."

wait_for_service() {
  local service=$1
  local max_attempts=30
  local attempt=1
  
  while [ $attempt -le $max_attempts ]; do
    if docker-compose -f "$COMPOSE_FILE" ps | grep "$service" | grep -q "healthy"; then
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
  docker-compose -f "$COMPOSE_FILE" logs "$service" | tail -50
  return 1
}

wait_for_service "actual-budget-test" || exit 1
wait_for_service "mcp-server-test" || exit 1

echo ""
log_success "All services are ready"
echo ""

# Show service info
log_info "Service URLs:"
echo "  • Actual Budget: http://localhost:5007"
echo "  • MCP Server:    http://localhost:3602/http"
echo "  • Health Check:  http://localhost:3602/health"
echo ""

# Step 4: Run E2E tests
log_info "Step 4/4: Running E2E tests..."
echo ""

if [ "$VERBOSE" = true ]; then
  docker-compose -f "$COMPOSE_FILE" run --rm e2e-test-runner
  TEST_EXIT_CODE=$?
else
  docker-compose -f "$COMPOSE_FILE" run --rm e2e-test-runner 2>&1 | tee /tmp/e2e-docker-test-output.log
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
  echo "     docker-compose -f $COMPOSE_FILE logs mcp-server-test"
  echo "     docker-compose -f $COMPOSE_FILE logs actual-budget-test"
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
