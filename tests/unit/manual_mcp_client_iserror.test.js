// tests/unit/manual_mcp_client_iserror.test.js
//
// #769: a tool failure is an `isError` result, no longer a JSON-RPC error. The manual HTTP
// client keeps its historic contract: `callTool` THROWS on it with the tool's own text, and
// `callMCP` hands the envelope back untouched. A success, and a VALID result that merely carries
// an `error` key, must not throw.
//
// Run: node tests/unit/manual_mcp_client_iserror.test.js

import { createClient } from '../manual/mcp-client.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ok: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const fakeRl = { question: async () => '' };
const respond = (result) => async () => ({
  ok: true,
  text: async () => '',
  json: async () => ({ jsonrpc: '2.0', id: 1, result }),
  headers: { get: () => null },
});
const clientFor = (result) => {
  const c = createClient({ url: 'http://stub', rl: fakeRl, fetchImpl: respond(result), retryPauseMs: 0 });
  c.setToken('Bearer x');
  return c;
};
const failure = { isError: true, content: [{ type: 'text', text: 'Validation error: type: Invalid option' }] };

{
  let thrown = null;
  try { await clientFor(failure).callTool('list_entities', { type: 'nope' }); } catch (e) { thrown = e; }
  assert(thrown !== null, 'callTool throws on an isError result');
  assert(thrown?.message === 'Validation error: type: Invalid option', `the message is the tool's text, got ${JSON.stringify(thrown?.message)}`);
}
{
  const env = await clientFor(failure).callMCP('tools/call', { name: 'list_entities', arguments: {} });
  assert(env.isError === true && env.content[0].text.startsWith('Validation error'), 'callMCP returns the isError envelope untouched');
}
{
  const ok = await clientFor({ content: [{ type: 'text', text: '{"result":[1]}' }] }).callTool('list_entities', {});
  assert(JSON.stringify(ok) === '[1]', `a success does not throw and unwraps, got ${JSON.stringify(ok)}`);
}
{
  const valid = await clientFor({ content: [{ type: 'text', text: '{"error":"not found","balance":null}' }] }).callTool('summarize_transactions', {});
  assert(valid && valid.error === 'not found', 'a valid result carrying an error key is returned, not thrown');
}

console.log(`\n[#769 manual client] Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
