import fetch from 'node-fetch';

const MCP_URL = "http://localhost:3600/http";
const token = "Bearer 9381d5ca23f3746fdbcd2a9438ebe4cf";

async function test() {
  // Initialize
  let response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": token
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" }
      }
    })
  });
  
  const initResult = await response.json();
  const sessionId = response.headers.get('mcp-session-id');
  console.log("Session:", sessionId);
  
  // List tools
  response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": token,
      "mcp-session-id": sessionId
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    })
  });
  
  const toolsResult = await response.json();
  console.log("Tools response:", JSON.stringify(toolsResult, null, 2));
}

test().catch(console.error);
