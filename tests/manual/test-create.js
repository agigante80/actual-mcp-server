import fetch from 'node-fetch';

const MCP_URL = "http://localhost:3600/http";
const token = "Bearer 9381d5ca23f3746fdbcd2a9438ebe4cf";
let sessionId;

async function call(method, params) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": token,
      ...(sessionId ? { "mcp-session-id": sessionId } : {})
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
  });
  
  if (!sessionId) sessionId = res.headers.get('mcp-session-id');
  return await res.json();
}

// Initialize
await call("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "test", version: "1.0" }
});

// Create account
const result = await call("tools/call", {
  name: "actual_accounts_create",
  arguments: { name: "Test Account", balance: 0 }
});

console.log(JSON.stringify(result, null, 2));
