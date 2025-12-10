import fetch from 'node-fetch';

// Initialize
const initResponse = await fetch("http://localhost:3600/http", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer 9381d5ca23f3746fdbcd2a9438ebe4cf",
    "Accept": "application/json, text/event-stream"
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" }
    }
  })
});

const initData = await initResponse.json();
const sessionId = initResponse.headers.get('mcp-session-id');
console.log("Session ID:", sessionId);

// Create category group first
const createResponse = await fetch("http://localhost:3600/http", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer 9381d5ca23f3746fdbcd2a9438ebe4cf",
    "Accept": "application/json, text/event-stream",
    "mcp-session-id": sessionId
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "actual_category_groups_create",
      arguments: { name: "Test Group" }
    }
  })
});

const createData = await createResponse.json();
console.log("\nCreate result:", JSON.stringify(createData, null, 2));

if (createData.result && createData.result.content) {
  const content = JSON.parse(createData.result.content[0].text);
  const groupId = content.id || content;
  console.log("Group ID:", groupId);
  
  // Now try to update
  const updateResponse = await fetch("http://localhost:3600/http", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer 9381d5ca23f3746fdbcd2a9438ebe4cf",
      "Accept": "application/json, text/event-stream",
      "mcp-session-id": sessionId
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "actual_category_groups_update",
        arguments: { id: groupId, fields: { name: "Updated Group" } }
      }
    })
  });
  
  const updateData = await updateResponse.json();
  console.log("\nUpdate result:", JSON.stringify(updateData, null, 2));
}
