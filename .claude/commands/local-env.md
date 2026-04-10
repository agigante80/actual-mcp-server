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
   - Run integration tests against the bearer instance (port 3601)

3. After completion, summarize:
   - Which Docker images were updated vs already up to date
   - Whether all containers are healthy
   - Integration test result (passed/failed + tool count verified)
