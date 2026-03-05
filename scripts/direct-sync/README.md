# scripts/direct-sync/

Direct connectivity test for Actual Budget — **bypasses the MCP layer entirely**.

Use these scripts to:
- Verify that the Actual Budget server is reachable and credentials are correct
- List all accounts in a budget without going through MCP
- Trigger bank sync (GoCardless/SimpleFIN) account-by-account and inspect the raw result
- Diagnose bank sync errors that the MCP server may be obscuring

---

## bank-sync-direct.mjs

Connects directly to Actual Budget, lists accounts, and optionally runs bank sync for each.

### Usage

```bash
# From the project root:
node scripts/direct-sync/bank-sync-direct.mjs [options]

# Or via npm:
npm run direct-sync [-- options]
```

### Options

| Flag | Description |
|------|-------------|
| `--list` / `--dry-run` | List accounts only — skip bank sync |
| `--budget <name>` | Target a specific budget by name (partial match, case-insensitive) |
| `--no-file-log` | Console output only — do not write a `.log` file |
| `--help` | Show inline help |

### Environment variables

The script reads the **same** env vars used by the MCP server — no extra config needed.

| Variable | Required | Description |
|----------|----------|-------------|
| `ACTUAL_SERVER_URL` | ✅ | URL of the Actual Budget server |
| `ACTUAL_PASSWORD` | ✅ | Server login password |
| `ACTUAL_BUDGET_SYNC_ID` | ✅ | Sync ID of the default budget |
| `ACTUAL_BUDGET_PASSWORD` | — | E2E encryption password (if budget is encrypted) |
| `BUDGET_DEFAULT_NAME` | — | Friendly name for the default budget |
| `BUDGET_n_NAME/SYNC_ID/SERVER_URL/PASSWORD/ENCRYPTION_PASSWORD` | — | Additional budgets (same pattern as the MCP server) |
| `ACTUAL_DATA_DIR` | — | Local dir for Actual data files (default: `/tmp/actual-direct-sync-<pid>`) |
| `DIRECT_SYNC_LOG_DIR` | — | Directory for log files (default: `logs/` in project root) |
| `BANK_SYNC_TIMEOUT_MS` | — | Per-account timeout in ms (default: `60000`) |

### Running against the Docker deployment

The Docker project's `.env` contains the real credentials. Source it before running:

```bash
# Option A — source the docker .env
set -a
source /home/alien/docker/librechat-MCP-actual/actual-mcp-server/.env
set +a
node scripts/direct-sync/bank-sync-direct.mjs --list

# Option B — run with env-file via Docker (no credentials leak to shell history)
docker run --rm --env-file /home/alien/docker/librechat-MCP-actual/actual-mcp-server/.env \
  --network librechat-mcpactual_lobe-network \
  -v /tmp/actual-direct-sync:/data \
  -e ACTUAL_DATA_DIR=/data \
  node:22-alpine \
  node /scripts/direct-sync/bank-sync-direct.mjs --list
```

### Output

**Console** (human-readable):
```
2026-03-05 11:30:00.000 [INFO]   ============================================================
2026-03-05 11:30:00.001 [INFO]   Actual Budget Direct Sync Test
2026-03-05 11:30:00.001 [INFO]   Budget   : Main Account
2026-03-05 11:30:00.001 [INFO]   Server   : http://finance-actual-budget-main:5006
2026-03-05 11:30:00.001 [INFO]   Mode     : FULL SYNC
2026-03-05 11:30:00.001 [INFO]   Found 3 account(s):
2026-03-05 11:30:00.001 [INFO]     1. Checking             id="abc..." flags="on-budget, open"
2026-03-05 11:30:00.001 [INFO]     2. Savings              id="def..." flags="on-budget, open"
2026-03-05 11:30:00.001 [INFO]     3. Old Credit Card      id="ghi..." flags="off-budget, closed"
2026-03-05 11:30:01.200 [INFO]     ✓ Checking — bank sync completed
2026-03-05 11:30:61.000 [WARN]   ⚠ Savings — Rate limit exceeded. Retry in ~256 min.
2026-03-05 11:30:01.210 [INFO]     - Old Credit Card — Skipping closed account
2026-03-05 11:30:01.210 [INFO]   SUMMARY  ok=1  not_configured=0  failed=0  skipped=1
```

**Log file** (`logs/direct-sync-2026-03-05T11-30-00.log`):
Each line is a JSON object — machine-readable for later analysis.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All syncs succeeded (or list-only mode) |
| `1` | One or more accounts failed to sync |
| `1` | Fatal error (connection failure, missing env vars) |
