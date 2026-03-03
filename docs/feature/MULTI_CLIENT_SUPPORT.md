# Multi-Client Support

**Status:** Planned — v0.6.x (Q3 2026)  
**Priority:** 🟢 Low  
**Effort:** ~1 week  
**Blocker:** None

---

## Overview

Broaden the server's client compatibility beyond LibreChat — verify and document Claude Desktop, add REST API endpoints alongside MCP, and publish client SDK examples.

## Scope

### 1. Claude Desktop Integration
- [ ] Test all 56+ tools with Claude Desktop's MCP plugin
- [ ] Document configuration (`claude_desktop_config.json` snippets)
- [ ] Identify and fix any tool name/schema incompatibilities
- [ ] Add Claude Desktop to official README "Verified Clients" section

### 2. REST API Wrapper
- [ ] Expose each MCP tool as a REST endpoint: `POST /api/tools/{tool_name}`
- [ ] Accept JSON body matching the tool's input schema
- [ ] Return JSON matching the MCP tool response format
- [ ] Protect with same auth middleware as MCP transport

### 3. Client SDK Examples
- [ ] Python example: call tools via `httpx` + SSE
- [ ] JavaScript/Node example: native MCP SDK (`@modelcontextprotocol/sdk`)
- [ ] `examples/` directory in repo with working scripts

## New Files

```
examples/python/basic_usage.py
examples/node/basic_usage.mjs
src/server/restRouter.ts        # REST adapter
docs/clients/CLAUDE_DESKTOP.md
docs/clients/REST_API.md
```

## References

- [Claude Desktop MCP docs](https://docs.anthropic.com/en/docs/claude-desktop)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [`src/server/httpServer.ts`](../../src/server/httpServer.ts)
