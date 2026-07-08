Run the full local deployment pipeline for the actual-mcp-server dev environment.

## Usage

Accepted arguments: `[smoke|sanity|normal|extended|full] [--bank-sync]`
Default test level if no argument given: `smoke`

## Steps

1. Run the deploy script from the project root:

   ```bash
   cd $HOME/dev-github-personal/actual-mcp-server
   bash scripts/deploy-and-test.sh [ARGUMENTS]
   ```

   - Valid test levels: `sanity` | `smoke` | `normal` | `extended` | `full`
   - Optional flag: `--bank-sync` to include per-account bank sync tests (GoCardless/SimpleFIN)

2. Stream all output to the user as it runs. The script will:
   - Sync latest dev code → Docker build folder & rebuild MCP image
   - Pull latest upstream images (Actual Budget, LibreChat, LobeChat)
   - Recreate both MCP containers (OIDC:3600 + Bearer:3601)
   - Restart LibreChat and LobeChat
   - Wait for the bearer MCP container to become healthy
   - Run HTTP integration tests against the bearer instance (port 3601)
   - Run a stdio smoke against the same container (`docker exec ... --stdio`) so both transports are exercised each run
   - At the `full` level only: run the #270 upstream-stall checks. The stdio regression (`scripts/regression-270-stall.mjs`) is GATED: it injects netem packet loss on the Actual server and asserts a stalled op rejects within a bounded time and releases the api mutex; while `scripts/known-failing/270` exists a reproduced hang is EXPECTED and does not fail the pipeline; deleting that marker (when #270 is fixed) makes it enforcing. The HTTP check (`scripts/diag-270-http.mjs`) is INFORMATIONAL only (never fails the pipeline): the StreamableHTTP client times out a stalled request on its own, so a client-observed rejection cannot prove the server released the mutex. The authoritative, transport-agnostic guarantee (server-side per-op timeout + lock release, shared by stdio and HTTP) is gated by the fast unit test `tests/unit/adapter_op_timeout.test.js` in `test:unit-js`.

3. After completion, summarize:
   - Which Docker images were updated vs already up to date
   - Whether all containers are healthy
   - HTTP integration test result (passed/failed + tool count verified)
   - stdio smoke result (passed/failed + tool count verified)
   - At `full` level: #270 regression result (correct / known-hang-expected / regression)
