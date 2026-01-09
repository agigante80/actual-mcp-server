#!/bin/bash
cd /home/alien/dev/actual-mcp-server

echo "Cleaning up..."
docker compose -f docker-compose.test.yaml down -v >/dev/null 2>&1

echo "Building images..."
docker compose -f docker-compose.test.yaml build >/dev/null 2>&1

echo "Starting services..."
export PLAYWRIGHT_PROJECT=docker-e2e-full
docker compose -f docker-compose.test.yaml up --abort-on-container-exit

echo "Cleanup (if needed)..."
docker compose -f docker-compose.test.yaml down -v >/dev/null 2>&1
