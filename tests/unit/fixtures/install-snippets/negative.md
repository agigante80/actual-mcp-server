# #600 install-snippets fixtures

Kept under tests/unit/fixtures/ so the real scan never reads them. Each block is found by
the heading above it; tests/unit/install_snippets.test.js names the failure it must produce.

## comment-in-continuation

```bash
docker run -d \
  -p 3600:3600 \
  # Use the same URL you type in your browser
  --env-file .env \
  ghcr.io/agigante80/actual-mcp-server:latest
```

## text-after-continuation

```bash
docker run -d \
  --env-file .env \
  -v actual-mcp-data:/app/data \        # required
  ghcr.io/agigante80/actual-mcp-server:latest
```

## localhost-url

```bash
docker run -d \
  --env-file .env \
  -e ACTUAL_SERVER_URL=http://localhost:5006 \
  ghcr.io/agigante80/actual-mcp-server:latest
```

## token-inline

```bash
docker run -d \
  --env-file .env \
  -e MCP_SSE_AUTHORIZATION="$(openssl rand -hex 32)" \
  ghcr.io/agigante80/actual-mcp-server:latest
```

## fragment-outside-allowlist

<!-- install-snippets: fragment -->
```bash
docker run --cap-drop=ALL
```

## wget-marked

<!-- runnable: wget-marked -->
```bash
wget https://example.invalid/x
docker run -d --env-file .env ghcr.io/agigante80/actual-mcp-server:latest
```

## upgrade-comment-only

```bash
docker pull ghcr.io/agigante80/actual-mcp-server:latest
docker stop actual-mcp-server-backend
docker rm actual-mcp-server-backend
# Re-run with same flags as original docker run
```
