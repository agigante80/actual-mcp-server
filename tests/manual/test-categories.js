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
  const result = await res.json();
  return result.result;
}

// Initialize
await call("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "test", version: "1.0" }
});

// Get categories
const result = await call("tools/call", {
  name: "actual_categories_get",
  arguments: {}
});

console.log("Raw response:", JSON.stringify(result, null, 2));

if (result.content && result.content[0]) {
  const parsed = JSON.parse(result.content[0].text);
  console.log("\nParsed data:", JSON.stringify(parsed, null, 2));
}
