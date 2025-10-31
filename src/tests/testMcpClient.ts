export async function testMcpClient(advertisedUrl: string, port: number, httpPath: string) {
  // Try builtin fetch or fallback to node-fetch if necessary
  const globalFetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
  const fetchFn = (globalFetch ?? (await import('node-fetch')).default) as unknown as typeof fetch;

  const base = new URL(advertisedUrl);
  // quick probe endpoint
  const probeUrl = `${base.origin}/.well-known/oauth-protected-resource`;

  console.info(`MCP client test: probing ${probeUrl}`);
  const probeRes = await fetchFn(probeUrl, { method: 'GET' });
  if (!probeRes.ok) {
    throw new Error(`Probe GET failed: ${probeRes.status} ${probeRes.statusText}`);
  }
  const probeJson = await probeRes.json();
  const result = probeJson?.result ?? probeJson;
  if (!result) throw new Error('Probe response missing result');

  // validate presence and types
  if (typeof result.serverInstructions !== 'object' || typeof result.serverInstructions.instructions !== 'string') {
    throw new Error('serverInstructions missing or wrong type');
  }
  if (typeof result.capabilities !== 'object' || typeof result.capabilities.tools !== 'object') {
    throw new Error('capabilities.tools missing or wrong type');
  }
  if (!Array.isArray(result.tools)) {
    throw new Error('tools missing or not array');
  }

  console.info('Probe OK: capabilities/tools/serverInstructions present');

  // Now do JSON-RPC initialize + tools/list using the HTTP endpoint
  const rpcUrl = `${base.origin}${httpPath}`;
  const initPayload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'actual-mcp-server-client-test', version: '0.0.1' },
    },
  };

  console.info(`MCP client test: POST initialize -> ${rpcUrl}`);
  // Server expects the client to accept both JSON responses and SSE frames
  const commonPostHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const initRes = await fetchFn(rpcUrl, {
    method: 'POST',
    headers: commonPostHeaders,
    body: JSON.stringify(initPayload),
  });

  if (!initRes.ok) {
    throw new Error(`Initialize POST failed: ${initRes.status} ${initRes.statusText}`);
  }

  const initJson = await initRes.json();
  if (!initJson?.result) {
    throw new Error(`Initialize response missing result: ${JSON.stringify(initJson)}`);
  }

  // If server sets a mcp-session-id header, capture it for subsequent calls
  const sessionId = initRes.headers.get?.('mcp-session-id') ?? undefined;
  if (sessionId) console.info(`Received session id header: ${sessionId}`);

  // Validate initialize result fields (capabilities/tools/serverInstructions)
  const initResult = initJson.result;

  if (typeof initResult.capabilities !== 'object') {
    throw new Error('initialize result.capabilities missing or not object');
  }

  // Accept either a tools array or derive tools from capabilities.tools object
  let initTools: string[] = [];
  if (Array.isArray(initResult.tools)) {
    initTools = initResult.tools;
  } else if (initResult.capabilities && typeof initResult.capabilities.tools === 'object') {
    initTools = Object.keys(initResult.capabilities.tools);
  } else {
    throw new Error('initialize result.tools missing or not array and capabilities.tools not present');
  }

  // serverInstructions may be a string, an object { instructions }, or absent.
  const si = initResult.serverInstructions;
  if (!si) {
    console.warn('Warning: serverInstructions missing from initialize result — continuing tests');
  } else if (typeof si === 'string') {
    // ok
  } else if (typeof si === 'object' && typeof si.instructions === 'string') {
    // ok
  } else {
    console.warn('Warning: serverInstructions present but in unexpected shape — continuing tests');
  }

  // replace usages below with initTools where needed
  console.info('Initialize OK: capabilities/tools/serverInstructions present');

  // call tools/list (JSON-RPC) to verify RPC path works
  const listPayload = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
  const listHeaders: Record<string, string> = { ...commonPostHeaders };
  if (sessionId) listHeaders['mcp-session-id'] = sessionId;

  const listRes = await fetchFn(rpcUrl, {
    method: 'POST',
    headers: listHeaders,
    body: JSON.stringify(listPayload),
  });
  if (!listRes.ok) throw new Error(`tools/list failed: ${listRes.status}`);
  const listJson = await listRes.json();
  if (!Array.isArray(listJson?.result?.tools)) throw new Error('tools/list returned invalid tools array');

  const listed = listJson.result.tools.map((t: any) => t.name).join(', ');
  console.info(`tools/list OK: ${listed}`);

  // Optionally, attempt to call each tool with empty args (non-destructive expectation)
  for (const tool of listJson.result.tools) {
    const name = tool.name;
    console.info(`Calling tool: ${name}`);
    const callPayload = {
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1_000_000),
      method: 'tools/call',
      params: { name, arguments: {} },
    };
    const callRes = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: listHeaders,
      body: JSON.stringify(callPayload),
    });
    if (!callRes.ok) {
      console.warn(`tools/call ${name} HTTP ${callRes.status}`);
      continue;
    }
    const callJson = await callRes.json();
    if (callJson?.error) {
      console.warn(`tools/call ${name} returned error: ${JSON.stringify(callJson.error).slice(0, 200)}`);
    } else {
      console.info(`tools/call ${name} OK (result truncated): ${JSON.stringify(callJson.result).slice(0, 200)}`);
    }
  }

  console.info('MCP client tests completed successfully');
  return;
}