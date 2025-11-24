// Test server_info tool
import fetch from 'node-fetch';

const MCP_URL = "http://localhost:3600/http";
const AUTH_TOKEN = "Bearer 9381d5ca23f3746fdbcd2a9438ebe4cf";

let sessionId = null;
let requestId = 1;

async function callMCP(method, params = {}) {
  const payload = {
    jsonrpc: "2.0",
    id: requestId++,
    method,
    params
  };

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": AUTH_TOKEN,
    ...(sessionId ? { "mcp-session-id": sessionId } : {})
  };

  const response = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const newSessionId = response.headers.get('mcp-session-id');
  if (newSessionId && !sessionId) {
    sessionId = newSessionId;
  }

  const result = await response.json();
  
  if (result.error) {
    throw new Error(`MCP Error ${result.error.code}: ${result.error.message}`);
  }

  return result.result;
}

async function test() {
  try {
    console.log("Initializing session...");
    await callMCP("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-server-info", version: "1.0" }
    });
    console.log("✓ Session initialized:", sessionId);

    console.log("\nCalling actual_server_info...");
    
    const result = await callMCP("tools/call", {
      name: "actual_server_info",
      arguments: {}
    });

    console.log("\n✓ Server Info:");
    
    if (result.content && result.content[0]) {
      const data = JSON.parse(result.content[0].text);
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error("\n❌ Error:");
    console.error("Message:", error.message);
    process.exit(1);
  }
}

test();
