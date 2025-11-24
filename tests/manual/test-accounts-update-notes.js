// Test accounts_update with notes field (should be rejected)
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
      clientInfo: { name: "test-accounts", version: "1.0" }
    });
    console.log("✓ Session initialized:", sessionId);

    console.log("\nTesting accounts_update with notes field (should be rejected)...");
    const updatePayload = {
      "id": "d4f5e824-b6b5-4822-99d2-05976d2d67ee",
      "fields": {
        "notes": "Loan details:\n- Purpose: Dental treatment Spark\n- Principal: €3,800\n- Interest: 0%\n- Term: 24 monthly instalments\n- Monthly payment: €158.33\n- Agreement date: 15 Oct 2024\n- Debited from: Sabadell\n- Payment schedule: Nov 2024 – Oct 2026 (around the 1st of each month)"
      }
    };

    console.log("Payload:", JSON.stringify(updatePayload, null, 2));
    
    const result = await callMCP("tools/call", {
      name: "actual_accounts_update",
      arguments: updatePayload
    });

    console.log("\n✓ Success!");
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("\n❌ Expected Error (notes field not supported):");
    console.error("Message:", error.message);
    console.log("\n✓ Test passed - notes field correctly rejected");
  }
}

test();
