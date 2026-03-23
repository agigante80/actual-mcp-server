# Getting Started: Talk to Your Budget with Claude

This guide walks you through connecting **Claude Desktop** (Anthropic's AI assistant app) to your **Actual Budget** instance using the Actual MCP Server. Once set up, you can manage your budget conversationally — ask questions, log expenses, analyse spending trends — all in plain English.

> **New to Actual Budget?** Set it up first at [actualbudget.org](https://actualbudget.org/) before continuing.  
> **New to Claude Desktop?** Download it at [claude.ai/download](https://claude.ai/download).

---

## How it works (the short version)

```
You (in Claude) ──► Claude Desktop ──► Actual MCP Server ──► Actual Budget
```

You type a message like *"How much did I spend on groceries last month?"* — Claude calls the Actual MCP Server behind the scenes, which talks to your Actual Budget, and Claude gives you a natural-language answer. You never have to leave the chat.

---

## What you'll need

- ✅ **Actual Budget** running (local or self-hosted) — [setup guide](https://actualbudget.org/docs/install/)
- ✅ **Claude Desktop** installed — [download here](https://claude.ai/download) (free plan works)
- ✅ **Docker** installed — [get Docker](https://docs.docker.com/get-docker/) (used to run the MCP server)
- ✅ A few minutes and a terminal (the command-line app on your computer)

> **Terminal on Mac**: Press `Cmd + Space`, type `Terminal`, press Enter.  
> **Terminal on Windows**: Press `Win + R`, type `cmd`, press Enter.  
> **Terminal on Linux**: You already know where it is 🙂

---

## Step 1 — Find your Actual Budget credentials

The MCP server needs three pieces of information to connect to your Actual Budget:

1. **Server URL** — where Actual Budget is running  
   - If it's on the same computer: `http://localhost:5006`  
   - If it's on another machine on your network: `http://192.168.1.x:5006` (replace with your machine's local IP)

2. **Server password** — the password you use when you log in to Actual Budget

3. **Budget Sync ID** — a unique identifier for your specific budget file  
   - Open Actual Budget in your browser  
   - Go to **Settings** (the gear icon)  
   - Scroll down and click **Show Advanced Settings**  
   - Copy the value shown as **Sync ID** — it looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

Keep these handy; you'll use them in the next step.

---

## Step 2 — Create a secret token

The MCP server uses a secret token to make sure only you (and Claude) can talk to it. Think of it like a password specifically for this connection.

Run this command in your terminal to generate a strong random token:

```bash
openssl rand -hex 32
```

You'll get something like:

```
a3f8c2d1e9b7...4f6e0a2c8d5b
```

**Copy this value and keep it somewhere safe** — you'll use it twice (in the server config and in Claude's config).

> **Don't have `openssl`?** Any long random string works. You can also use a [random password generator](https://1password.com/password-generator/) and set it to 64 characters.

---

## Step 3 — Start the Actual MCP Server

The MCP server is the bridge between Claude and Actual Budget. You run it once and leave it running in the background.

Paste this command into your terminal, replacing the placeholder values with the ones you found in Step 1 and Step 2:

```bash
docker run -d \
  --name actual-mcp \
  --restart unless-stopped \
  -p 3600:3600 \
  -e ACTUAL_SERVER_URL=http://localhost:5006 \
  -e ACTUAL_PASSWORD=your_actual_password \
  -e ACTUAL_BUDGET_SYNC_ID=your-sync-id-here \
  -e MCP_SSE_AUTHORIZATION=your_secret_token \
  -v actual-mcp-data:/data \
  ghcr.io/agigante80/actual-mcp-server:latest
```

**What each part does:**

| Part | What it means |
|------|--------------|
| `docker run -d` | Start the server in the background (detached) |
| `--name actual-mcp` | Give the container a friendly name so you can manage it later |
| `--restart unless-stopped` | Automatically restart if your computer reboots |
| `-p 3600:3600` | Make the server reachable on port 3600 of your computer |
| `ACTUAL_SERVER_URL` | Where your Actual Budget is running |
| `ACTUAL_PASSWORD` | Your Actual Budget login password |
| `ACTUAL_BUDGET_SYNC_ID` | Which budget file to use (from Step 1) |
| `MCP_SSE_AUTHORIZATION` | Your secret token (from Step 2) |
| `-v actual-mcp-data:/data` | Save data between restarts |

### Verify the server is running

```bash
curl http://localhost:3600/health
```

You should see something like:

```json
{"status":"ok","transport":"http","version":"..."}
```

If you see that, the server is up and ready. 🎉

> **Troubleshooting**: If the health check fails, check the container logs with `docker logs actual-mcp` to see what went wrong.

---

## Step 4 — Configure Claude Desktop

Claude Desktop reads its MCP server configuration from a JSON file on your computer. You need to add the Actual MCP Server to that file.

### Find your config file

| Operating System | Config file location |
|-----------------|---------------------|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

> **On Mac**, `~/Library` is a hidden folder. Open Finder, click **Go** in the menu bar, then **Go to Folder**, and paste `~/Library/Application Support/Claude/`.

### Edit the config file

Open the file in any text editor (Notepad on Windows, TextEdit on Mac, etc.).

If the file is **empty or new**, replace its entire contents with:

```json
{
  "mcpServers": {
    "actual-budget": {
      "type": "http",
      "url": "http://localhost:3600/http",
      "headers": {
        "Authorization": "Bearer your_secret_token"
      }
    }
  }
}
```

If the file **already has content**, add the `"actual-budget"` block inside the existing `"mcpServers"` section. For example:

```json
{
  "mcpServers": {
    "some-other-server": { ... },
    "actual-budget": {
      "type": "http",
      "url": "http://localhost:3600/http",
      "headers": {
        "Authorization": "Bearer your_secret_token"
      }
    }
  }
}
```

**Replace `your_secret_token`** with the token you generated in Step 2.

**What each field does:**

| Field | What it means |
|-------|--------------|
| `"actual-budget"` | A label for this connection (you can rename it) |
| `"type": "http"` | Use the HTTP protocol to talk to the server |
| `"url"` | The address of the MCP server on your computer |
| `"Authorization"` | Your secret token, prefixed with `Bearer ` |

### Restart Claude Desktop

After saving the file, **fully quit and reopen Claude Desktop** — changes to the config only take effect on restart.

> **On Mac**: Right-click the Claude icon in the Dock and choose **Quit**, then reopen it from Applications.  
> **On Windows**: Right-click the Claude icon in the system tray and choose **Exit**, then reopen it.

---

## Step 5 — Verify the connection

In Claude Desktop, start a new conversation and type:

```
Can you check if you're connected to my Actual Budget?
```

Claude will use the `actual_server_info` tool to test the connection and tell you what it finds. If it replies with your server version and a list of available tools — you're all set!

If something goes wrong, see [Troubleshooting](#troubleshooting) below.

---

## Step 6 — Try your first budget questions

Here are some prompts to get you started. Copy and paste them into Claude:

### Check your finances
```
What's my current account balance for all accounts?
```
```
How much did I spend last month, broken down by category?
```
```
What are my top 5 spending categories this year?
```

### Log a transaction
```
I just paid $47.50 for groceries at Whole Foods. Add it to my budget.
```
```
Add a $12 coffee expense from today to my dining out category.
```

### Plan your budget
```
I want to budget $400 for groceries next month. Can you set that up?
```
```
Show me which categories I went over budget in the last 3 months.
```

### Explore your data
```
Find all transactions from Amazon in the last 6 months and total them up.
```
```
Which payees did I spend the most with last year?
```

---

## Keeping it running

### Stop the MCP server
```bash
docker stop actual-mcp
```

### Start it again
```bash
docker start actual-mcp
```

### Update to the latest version
```bash
docker stop actual-mcp
docker rm actual-mcp
docker pull ghcr.io/agigante80/actual-mcp-server:latest
# Then re-run the docker run command from Step 3
```

### Check server logs (useful for debugging)
```bash
docker logs actual-mcp --tail 50
```

---

## Troubleshooting

### "I don't see any tools in Claude"
- Make sure Claude Desktop was **fully restarted** after editing the config file
- Double-check the JSON in the config file — a missing comma or bracket will break it
- Try a [JSON validator](https://jsonlint.com/) if you're unsure the file is valid

### "Connection refused" or health check fails
- Make sure the Docker container is running: `docker ps | grep actual-mcp`
- If it's not listed, start it: `docker start actual-mcp`
- Check for errors: `docker logs actual-mcp`

### "Unauthorized" or auth errors
- Make sure the token in your Claude config exactly matches what you set in `MCP_SSE_AUTHORIZATION`
- The token in the config must have `Bearer ` before it (with a space): `"Bearer abc123..."`
- The `MCP_SSE_AUTHORIZATION` environment variable must be the **raw token only** — no `Bearer ` prefix there

### "Actual Budget not found" or sync errors
- Verify your `ACTUAL_SERVER_URL` is reachable: `curl http://localhost:5006`
- Check that the Sync ID is correct (Settings → Show Advanced Settings → Sync ID in Actual Budget)
- Make sure your Actual Budget server is running

### Claude says it can't find a category or account
- Ask Claude to list your accounts or categories first: *"List all my accounts"* / *"List all budget categories"*
- Category and account names are case-sensitive

---

## Next steps

Once you're comfortable, explore the full capabilities:

- **[62 available tools](../../README.md#available-tools)** — a complete list of everything Claude can do with your budget
- **[AI Client Setup Guide](AI_CLIENT_SETUP.md)** — advanced options: LibreChat, LobeChat, Docker networking, HTTPS/TLS
- **[Deployment Guide](DEPLOYMENT.md)** — running the MCP server with Docker Compose, production config

---

*Part of the [Actual MCP Server](https://github.com/agigante80/actual-mcp-server) project.*
