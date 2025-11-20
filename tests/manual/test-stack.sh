#!/bin/bash
# =============================================================================
# Test Stack Orchestrator
# =============================================================================
# Manages Actual Budget + MCP Server + LibreChat stack for integration testing
#
# Usage:
#   ./test-stack.sh                    # Start all services and run tests
#   ./test-stack.sh --only actual      # Start only Actual Budget
#   ./test-stack.sh --only mcp         # Start only MCP Server
#   ./test-stack.sh --only librechat   # Start only LibreChat
#   ./test-stack.sh --skip actual      # Start MCP + LibreChat
#   ./test-stack.sh --skip tests       # Start all services without tests
#   ./test-stack.sh --clean            # Clean up all containers and volumes
#   ./test-stack.sh --status           # Show status of all services
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_DIR="$PROJECT_ROOT/tests/manual/test-stack"

# Service flags
START_ACTUAL=true
START_MCP=true
START_LIBRECHAT=true
RUN_TESTS=true
CLEAN_ONLY=false
STATUS_ONLY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --only)
            START_ACTUAL=false
            START_MCP=false
            START_LIBRECHAT=false
            case $2 in
                actual) START_ACTUAL=true ;;
                mcp) START_MCP=true ;;
                librechat) START_LIBRECHAT=true ;;
                *) echo "Unknown service: $2"; exit 1 ;;
            esac
            shift 2
            ;;
        --skip)
            case $2 in
                actual) START_ACTUAL=false ;;
                mcp) START_MCP=false ;;
                librechat) START_LIBRECHAT=false ;;
                tests) RUN_TESTS=false ;;
                *) echo "Unknown service: $2"; exit 1 ;;
            esac
            shift 2
            ;;
        --clean)
            CLEAN_ONLY=true
            shift
            ;;
        --status)
            STATUS_ONLY=true
            shift
            ;;
        --help|-h)
            head -n 20 "$0" | tail -n +3 | sed 's/^# //'
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# =============================================================================
# Utility Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing=()
    
    command -v docker >/dev/null 2>&1 || missing+=("docker")
    command -v docker-compose >/dev/null 2>&1 || missing+=("docker-compose")
    
    if [ ${#missing[@]} -ne 0 ]; then
        log_error "Missing required tools: ${missing[*]}"
        exit 1
    fi
    
    log_success "All prerequisites available"
}

wait_for_service() {
    local name=$1
    local url=$2
    local max_attempts=${3:-30}
    local attempt=1
    
    log_info "Waiting for $name to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -sf "$url" >/dev/null 2>&1; then
            log_success "$name is ready"
            return 0
        fi
        
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo ""
    log_error "$name failed to start within ${max_attempts} attempts"
    return 1
}

# =============================================================================
# Cleanup Functions
# =============================================================================

cleanup_containers() {
    log_info "Stopping and removing containers..."
    
    # Stop containers by name pattern
    local containers=(
        "finance-actual-budget-main"
        "actual-mcp-server"
        "ai-librechat"
        "ai-mongo"
        "ai-meilisearch"
        "ai-pgvector"
        "ai-librechat-rag-api"
    )
    
    for container in "${containers[@]}"; do
        if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
            log_info "Removing container: $container"
            docker stop "$container" 2>/dev/null || true
            docker rm -f "$container" 2>/dev/null || true
        fi
    done
    
    log_success "Container cleanup complete"
}

cleanup_networks() {
    log_info "Cleaning up networks..."
    
    local networks=("actual-net" "librechat-net")
    
    for network in "${networks[@]}"; do
        if docker network ls --format '{{.Name}}' | grep -q "^${network}$"; then
            log_info "Removing network: $network"
            docker network rm "$network" 2>/dev/null || true
        fi
    done
    
    log_success "Network cleanup complete"
}

cleanup_volumes() {
    log_warning "Volume cleanup not performed (preserves data)"
    log_info "To manually clean volumes, run: docker volume prune"
}

full_cleanup() {
    echo ""
    log_info "=== Cleaning up test stack ==="
    cleanup_containers
    cleanup_networks
    cleanup_volumes
    log_success "Cleanup complete"
    echo ""
}

# =============================================================================
# Status Functions
# =============================================================================

show_status() {
    echo ""
    log_info "=== Test Stack Status ==="
    echo ""
    
    local containers=(
        "finance-actual-budget-main:5006:Actual Budget"
        "actual-mcp-server:3600:MCP Server"
        "ai-librechat:3080:LibreChat"
    )
    
    for entry in "${containers[@]}"; do
        IFS=':' read -r container port name <<< "$entry"
        
        if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
            local status=$(docker ps --filter "name=^${container}$" --format '{{.Status}}')
            echo -e "${GREEN}✓${NC} $name ($container)"
            echo "  Status: $status"
            echo "  Port: $port"
            
            # Check if port is responding
            if curl -sf "http://localhost:$port" >/dev/null 2>&1 || \
               curl -sf "http://localhost:$port/health" >/dev/null 2>&1; then
                echo -e "  Health: ${GREEN}Responding${NC}"
            else
                echo -e "  Health: ${YELLOW}Not responding${NC}"
            fi
        else
            echo -e "${RED}✗${NC} $name ($container)"
            echo "  Status: Not running"
        fi
        echo ""
    done
}

# =============================================================================
# Service Management Functions
# =============================================================================

start_actual() {
    log_info "=== Starting Actual Budget ==="
    
    # Create compose file
    mkdir -p "$TEST_DIR/actual"
    cat > "$TEST_DIR/actual/docker-compose.yml" <<'EOF'
networks:
  actual-net:
    name: actual-net

services:
  actual-main:
    image: actualbudget/actual-server:latest
    container_name: finance-actual-budget-main
    ports:
      - "5006:5006"
    environment:
      - TZ=Europe/Madrid
    volumes:
      - ./data-main:/data
    restart: unless-stopped
    networks:
      - actual-net
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:5006"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
EOF
    
    cd "$TEST_DIR/actual"
    
    log_info "Starting Actual Budget container..."
    docker-compose up -d
    
    wait_for_service "Actual Budget" "http://localhost:5006" 30
    
    log_success "Actual Budget started successfully"
    echo ""
}

start_mcp() {
    log_info "=== Starting MCP Server ==="
    
    # Check if .env exists
    if [ ! -f "$PROJECT_ROOT/.env" ]; then
        log_error ".env file not found in project root"
        log_info "Creating template .env file..."
        
        cat > "$PROJECT_ROOT/.env" <<'EOF'
# Actual Budget Configuration
ACTUAL_SERVER_URL=http://actual-main:5006
ACTUAL_PASSWORD=your-password-here
ACTUAL_BUDGET_SYNC_ID=your-sync-id-here

# MCP Server Configuration
MCP_SSE_AUTHORIZATION=test-token-12345
EOF
        
        log_warning ".env file created with template values"
        log_warning "Please update ACTUAL_PASSWORD and ACTUAL_BUDGET_SYNC_ID"
        
        read -p "Press Enter to continue or Ctrl+C to exit and configure .env..."
    fi
    
    # Create compose file
    mkdir -p "$TEST_DIR/mcp"
    cat > "$TEST_DIR/mcp/docker-compose.yml" <<'EOF'
networks:
  librechat-net:
    name: librechat-net
  actual-net:
    name: actual-net

services:
  actual-mcp-server:
    image: ghcr.io/agigante80/actual-mcp-server:development
    container_name: actual-mcp-server
    ports:
      - "3600:3600"
    environment:
      - ACTUAL_SERVER_URL=${ACTUAL_SERVER_URL:-http://finance-actual-budget-main:5006}
      - ACTUAL_PASSWORD=${ACTUAL_PASSWORD}
      - ACTUAL_BUDGET_SYNC_ID=${ACTUAL_BUDGET_SYNC_ID}
      - MCP_BRIDGE_PORT=3600
      - MCP_BRIDGE_DATA_DIR=/data
      - MCP_SSE_AUTHORIZATION=${MCP_SSE_AUTHORIZATION}
      - MCP_TRANSPORT_MODE=--http
    volumes:
      - ./actual-data:/data
    restart: unless-stopped
    networks:
      - librechat-net
      - actual-net
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3600/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
EOF
    
    # Copy .env to MCP directory
    cp "$PROJECT_ROOT/.env" "$TEST_DIR/mcp/.env"
    
    cd "$TEST_DIR/mcp"
    
    log_info "Starting MCP Server container..."
    docker-compose up -d
    
    wait_for_service "MCP Server" "http://localhost:3600/health" 30
    
    log_success "MCP Server started successfully"
    echo ""
}

start_librechat() {
    log_info "=== Starting LibreChat ==="
    
    # Check if LibreChat .env exists
    mkdir -p "$TEST_DIR/librechat"
    
    if [ ! -f "$TEST_DIR/librechat/.env" ]; then
        log_info "Creating LibreChat .env file..."
        
        # Generate random values
        local uid=$(id -u)
        local gid=$(id -g)
        local jwt_secret=$(openssl rand -hex 32)
        local jwt_refresh=$(openssl rand -hex 32)
        local creds_key=$(openssl rand -hex 32)
        local creds_iv=$(openssl rand -hex 16)
        local meili_key=$(openssl rand -hex 16)
        
        cat > "$TEST_DIR/librechat/.env" <<EOF
# Server Configuration
HOST=0.0.0.0
PORT=3080
TZ=Europe/Madrid

# User/Group IDs
UID=$uid
GID=$gid
PUID=$uid
PGID=$gid

# MongoDB
MONGO_URI=mongodb://ai-mongo:27017/LibreChat

# Security
JWT_SECRET=$jwt_secret
JWT_REFRESH_SECRET=$jwt_refresh
CREDS_KEY=$creds_key
CREDS_IV=$creds_iv

# MeiliSearch
MEILI_MASTER_KEY=$meili_key
MEILI_HOST=http://ai-meilisearch:7700

# PostgreSQL (for RAG)
POSTGRES_DB=librechat
POSTGRES_USER=librechat
POSTGRES_PASSWORD=librechat_password

# RAG API
RAG_PORT=8000
RAG_API_URL=http://ai-librechat-rag-api:8000

# Debug (optional)
DEBUG_LOGGING=false
EOF
        
        log_success "LibreChat .env file created"
    fi
    
    # Create librechat.yaml with MCP configuration
    if [ ! -f "$TEST_DIR/librechat/librechat.yaml" ]; then
        log_info "Creating LibreChat configuration with MCP server..."
        
        local mcp_token="${MCP_SSE_AUTHORIZATION:-test-token-12345}"
        
        cat > "$TEST_DIR/librechat/librechat.yaml" <<EOF
version: 1.1.5

mcpServers:
  actual-mcp:
    type: "streamable-http"
    url: "http://actual-mcp-server:3600/http"
    headers:
      Authorization: "Bearer $mcp_token"
    serverInstructions: true
    timeout: 30000
EOF
        
        log_success "LibreChat configuration created with MCP server"
    fi
    
    # Create compose file
    cat > "$TEST_DIR/librechat/docker-compose.yml" <<'EOF'
version: '3.8'

networks:
  librechat-net:
    name: librechat-net

services:
  ai-librechat:
    container_name: ai-librechat
    image: ghcr.io/danny-avila/librechat:latest
    restart: unless-stopped
    user: "${UID}:${GID}"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    ports:
      - "3080:3080"
    depends_on:
      - ai-mongo
      - ai-meilisearch
      - ai-pgvector
      - ai-librechat-rag-api
    environment:
      - TZ=${TZ}
      - HOST=0.0.0.0
      - PORT=3080
      - MONGO_URI=mongodb://ai-mongo:27017/LibreChat
      - MEILI_HOST=http://ai-meilisearch:7700
      - MEILI_MASTER_KEY=${MEILI_MASTER_KEY}
      - RAG_PORT=${RAG_PORT:-8000}
      - RAG_API_URL=http://ai-librechat-rag-api:${RAG_PORT:-8000}
    volumes:
      - ./.env:/app/.env
      - ./librechat.yaml:/app/librechat.yaml
      - ./images:/app/client/public/images
      - ./logs:/app/logs
      - ./data:/app/data
    networks:
      - librechat-net
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3080/api/health"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s

  ai-mongo:
    container_name: ai-mongo
    image: mongo:4.4.6
    restart: unless-stopped
    user: "${UID}:${GID}"
    volumes:
      - ./mongo-data:/data/db
    command: mongod --noauth
    networks:
      - librechat-net

  ai-meilisearch:
    container_name: ai-meilisearch
    image: getmeili/meilisearch:v1.12.3
    restart: unless-stopped
    user: "${UID}:${GID}"
    environment:
      - MEILI_HOST=http://ai-meilisearch:7700
      - MEILI_NO_ANALYTICS=true
      - MEILI_MASTER_KEY=${MEILI_MASTER_KEY}
    volumes:
      - ./meilisearch-data:/meili_data
    networks:
      - librechat-net

  ai-pgvector:
    container_name: ai-pgvector
    image: ankane/pgvector:latest
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    restart: unless-stopped
    volumes:
      - ./pgvector-data:/var/lib/postgresql/data
    networks:
      - librechat-net

  ai-librechat-rag-api:
    container_name: ai-librechat-rag-api
    image: ghcr.io/danny-avila/librechat-rag-api-dev-lite:latest
    environment:
      - DB_HOST=ai-pgvector
      - RAG_PORT=${RAG_PORT:-8000}
      - MEILI_HOST=http://ai-meilisearch:7700
      - MEILI_MASTER_KEY=${MEILI_MASTER_KEY}
      - POSTGRES_DB=${POSTGRES_DB}
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    restart: unless-stopped
    depends_on:
      - ai-pgvector
      - ai-meilisearch
    networks:
      - librechat-net
EOF
    
    cd "$TEST_DIR/librechat"
    
    log_info "Starting LibreChat stack..."
    docker-compose up -d
    
    log_info "Waiting for all LibreChat services to be ready (this may take 1-2 minutes)..."
    wait_for_service "LibreChat" "http://localhost:3080" 60
    
    log_success "LibreChat started successfully"
    log_info "Access LibreChat at: http://localhost:3080"
    echo ""
}

# =============================================================================
# Testing Functions
# =============================================================================

run_integration_tests() {
    log_info "=== Running Integration Tests ==="
    echo ""
    
    # Test 1: Actual Budget API
    if [ "$START_ACTUAL" = true ]; then
        log_info "Test 1: Actual Budget API"
        if curl -sf "http://localhost:5006" >/dev/null 2>&1; then
            log_success "✓ Actual Budget is responding"
        else
            log_error "✗ Actual Budget is not responding"
        fi
    fi
    
    # Test 2: MCP Server Health
    if [ "$START_MCP" = true ]; then
        log_info "Test 2: MCP Server Health"
        if curl -sf "http://localhost:3600/health" >/dev/null 2>&1; then
            log_success "✓ MCP Server health check passed"
            
            # Get health response
            local health=$(curl -s "http://localhost:3600/health")
            echo "  Response: $health"
        else
            log_error "✗ MCP Server health check failed"
        fi
    fi
    
    # Test 3: MCP Server → Actual Connection
    if [ "$START_ACTUAL" = true ] && [ "$START_MCP" = true ]; then
        log_info "Test 3: MCP → Actual Budget Connection"
        
        local logs=$(docker logs actual-mcp-server 2>&1 | tail -20)
        if echo "$logs" | grep -q "Starting Actual MCP Server"; then
            log_success "✓ MCP Server started successfully"
        else
            log_warning "⚠ Could not verify MCP startup in logs"
        fi
        
        if echo "$logs" | grep -q "error\|Error\|ERROR\|failed\|Failed"; then
            log_warning "⚠ Found errors in MCP Server logs:"
            echo "$logs" | grep -i "error\|failed" | head -5
        else
            log_success "✓ No errors found in MCP Server logs"
        fi
    fi
    
    # Test 4: LibreChat Accessibility
    if [ "$START_LIBRECHAT" = true ]; then
        log_info "Test 4: LibreChat Web Interface"
        if curl -sf "http://localhost:3080" >/dev/null 2>&1; then
            log_success "✓ LibreChat web interface is accessible"
        else
            log_warning "⚠ LibreChat may still be initializing"
        fi
    fi
    
    # Test 5: MCP Configuration in LibreChat
    if [ "$START_LIBRECHAT" = true ] && [ "$START_MCP" = true ]; then
        log_info "Test 5: LibreChat MCP Configuration"
        
        if docker exec ai-librechat test -f /app/librechat.yaml 2>/dev/null; then
            log_success "✓ librechat.yaml is mounted correctly"
            
            local mcp_config=$(docker exec ai-librechat cat /app/librechat.yaml 2>/dev/null | grep -A 5 "actual-mcp")
            if [ ! -z "$mcp_config" ]; then
                log_success "✓ MCP server configuration found in librechat.yaml"
            else
                log_warning "⚠ MCP server configuration not found in librechat.yaml"
            fi
        else
            log_warning "⚠ librechat.yaml not found in container"
        fi
    fi
    
    echo ""
    log_success "Integration tests complete"
    echo ""
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    cd "$PROJECT_ROOT"
    
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║         Actual MCP + LibreChat Test Stack Manager         ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
    
    check_prerequisites
    
    # Handle special modes
    if [ "$CLEAN_ONLY" = true ]; then
        full_cleanup
        exit 0
    fi
    
    if [ "$STATUS_ONLY" = true ]; then
        show_status
        exit 0
    fi
    
    # Clean up any existing containers
    log_info "Cleaning up any existing test containers..."
    cleanup_containers
    echo ""
    
    # Start requested services
    [ "$START_ACTUAL" = true ] && start_actual
    [ "$START_MCP" = true ] && start_mcp
    [ "$START_LIBRECHAT" = true ] && start_librechat
    
    # Run tests if requested
    [ "$RUN_TESTS" = true ] && run_integration_tests
    
    # Show final status
    show_status
    
    # Show next steps
    echo ""
    log_info "=== Next Steps ==="
    echo ""
    
    if [ "$START_ACTUAL" = true ]; then
        echo "  • Actual Budget: http://localhost:5006"
    fi
    
    if [ "$START_MCP" = true ]; then
        echo "  • MCP Server Health: http://localhost:3600/health"
    fi
    
    if [ "$START_LIBRECHAT" = true ]; then
        echo "  • LibreChat: http://localhost:3080"
        echo ""
        log_info "In LibreChat:"
        echo "  1. Register/login"
        echo "  2. Look for 'actual-mcp' in the MCP servers list"
        echo "  3. Enable it and start chatting with your budget!"
    fi
    
    echo ""
    log_info "To view logs:"
    [ "$START_ACTUAL" = true ] && echo "  docker logs finance-actual-budget-main -f"
    [ "$START_MCP" = true ] && echo "  docker logs actual-mcp-server -f"
    [ "$START_LIBRECHAT" = true ] && echo "  docker logs ai-librechat -f"
    
    echo ""
    log_info "To stop everything:"
    echo "  $0 --clean"
    echo ""
    
    log_success "Test stack is ready! 🚀"
    echo ""
}

# Run main function
main
