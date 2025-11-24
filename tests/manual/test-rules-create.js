// Test rules_create with the exact payload from the user
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
      clientInfo: { name: "test-rules", version: "1.0" }
    });
    console.log("✓ Session initialized:", sessionId);

    console.log("\nTesting rules_create with user's payload (fixed stage to 'post')...");
    const rulePayload = {
      "stage": "post",  // Fixed: was "default", but Actual only accepts "pre" or "post"
      "conditionsOp": "and",
      "conditions": [
        {
          "field": "payee",
          "op": "is",
          "value": "5641e83f-35c8-41c5-b6b1-e049613bd0d3",
          "type": "id"
        }
      ],
      "actions": [
        {
          "op": "set",
          "field": "category",
          "value": "2d46fe6e-d844-42c2-b938-b860c98978f2",
          "type": "id"
        }
      ]
    };

    console.log("Payload:", JSON.stringify(rulePayload, null, 2));
    
    const result = await callMCP("tools/call", {
      name: "actual_rules_create",
      arguments: rulePayload
    });

    console.log("\n✓ Success!");
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error("Full error:", error);
    process.exit(1);
  }
}

test();
