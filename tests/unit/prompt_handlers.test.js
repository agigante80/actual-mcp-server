// tests/unit/prompt_handlers.test.js
//
// #660: registerPromptHandlers driven end to end through an SDK Server and Client on an
// InMemoryTransport, so the JSON-RPC codes the client RECEIVES are asserted (a plain Error
// would arrive as -32603). Plus the wiring guard: both transports and the entrypoint.
//
// Run: node tests/unit/prompt_handlers.test.js   (needs `npm run build` first)

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { stripTsComments } from './helpers/source-text.js';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[prompt-handlers]');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { z } = await import('zod');
const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { registerPromptHandlers } = await import('../../dist/src/lib/promptHandlers.js');

const review = {
  name: 'monthly_review',
  title: 'Monthly review',
  description: 'Review a month',
  arguments: [{ name: 'month', description: 'YYYY-MM', required: true }],
  requiredTools: ['get_context'],
  argsSchema: z.strictObject({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
  render: (a) => `Review ${a.month}`,
};
const second = { ...review, name: 'spending_check', title: 'Spending', description: 'Check', arguments: [], argsSchema: z.strictObject({}), render: () => 'Check spending' };
const hidden = { ...review, name: 'hidden_prompt' };

async function connect(offered) {
  const server = new Server({ name: 't', version: '1' }, { capabilities: { prompts: {} } });
  registerPromptHandlers(server, offered);
  const client = new Client({ name: 'c', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
async function errorOf(p) {
  try { await p; } catch (e) { return e; }
  throw new Error('expected a rejection');
}

await check('prompts/list returns name, title, description, arguments in registry order', async () => {
  const c = await connect([review, second]);
  const { prompts } = await c.listPrompts();
  assert.deepStrictEqual(prompts.map((p) => p.name), ['monthly_review', 'spending_check']);
  assert.deepStrictEqual(prompts[0], {
    name: 'monthly_review', title: 'Monthly review', description: 'Review a month',
    arguments: [{ name: 'month', description: 'YYYY-MM', required: true }],
  });
});
await check('prompts/list with nothing offered is an empty list', async () => {
  const c = await connect([]);
  assert.deepStrictEqual((await c.listPrompts()).prompts, []);
});
await check('prompts/get returns one user text message with the rendered text', async () => {
  const c = await connect([review]);
  const r = await c.getPrompt({ name: 'monthly_review', arguments: { month: '2026-10' } });
  assert.strictEqual(r.messages.length, 1);
  assert.deepStrictEqual(r.messages[0], { role: 'user', content: { type: 'text', text: 'Review 2026-10' } });
});
await check('unknown and defined-but-not-offered names give the same -32602 and message shape', async () => {
  const c = await connect([review]); // `hidden` is defined in the registry but not offered
  void hidden;
  const e1 = await errorOf(c.getPrompt({ name: 'no_such_prompt' }));
  const e2 = await errorOf(c.getPrompt({ name: 'hidden_prompt' }));
  assert.strictEqual(e1.code, -32602);
  assert.strictEqual(e2.code, -32602);
  assert.ok(e1.message.endsWith('Unknown prompt: no_such_prompt'), e1.message);
  assert.ok(e2.message.endsWith('Unknown prompt: hidden_prompt'), e2.message);
});
await check('a 200-character name with a newline is cleaned and capped', async () => {
  const c = await connect([review]);
  const e = await errorOf(c.getPrompt({ name: `x\n${'a'.repeat(200)}` }));
  assert.strictEqual(e.code, -32602);
  const echoed = e.message.split('Unknown prompt: ')[1];
  assert.ok(!/[\u0000-\u001f]/.test(echoed), 'no control character');
  assert.ok(echoed.length <= 64 + 3, `length ${echoed.length}`);
  assert.ok(echoed.endsWith('...'));
});
await check('a malformed argument is -32602 naming month, without echoing the value', async () => {
  const c = await connect([review]);
  const e = await errorOf(c.getPrompt({ name: 'monthly_review', arguments: { month: 'October-SECRET-123' } }));
  assert.strictEqual(e.code, -32602);
  assert.ok(e.message.includes('month'), e.message);
  assert.ok(!e.message.includes('SECRET-123'), e.message);
});
await check('a missing required argument is -32602 naming month', async () => {
  const c = await connect([review]);
  const e = await errorOf(c.getPrompt({ name: 'monthly_review' }));
  assert.strictEqual(e.code, -32602);
  assert.ok(e.message.includes('month'), e.message);
});
await check('a hostile unknown argument key is refused, cleaned and capped', async () => {
  const c = await connect([review]);
  const key = `k\u0007${'z'.repeat(10000)}`;
  const e = await errorOf(c.getPrompt({ name: 'monthly_review', arguments: { month: '2026-10', [key]: 'v' } }));
  assert.strictEqual(e.code, -32602);
  assert.ok(!/\u0007/.test(e.message), 'no control character');
  assert.ok(e.message.length < 600, `message length ${e.message.length}`);
});

// Raw requests: the SDK validates the REQUEST against its own schema before our handler runs, so a
// malformed prompts/get used to answer -32603 with the raw ZodError (hostile key echoed uncapped).
const rawGet = (c, params) => errorOf(c.request({ method: 'prompts/get', ...(params === undefined ? {} : { params }) }, z.looseObject({})));
await check('malformed prompts/get: hostile argument key under an unknown name is -32602, bounded, key capped', async () => {
  const c = await connect([review]);
  const key = `EVIL\nKEY${'x'.repeat(300)}`;
  const e = await rawGet(c, { name: 'no_such_prompt', arguments: { [key]: 5 } });
  assert.strictEqual(e.code, -32602, e.message);
  assert.ok(e.message.length < 300, `message length ${e.message.length}`);
  assert.ok(!e.message.includes('x'.repeat(65)), 'hostile key capped at 64');
  assert.ok(!/\n/.test(e.message), 'no newline');
});
await check('malformed prompts/get: a non-string name is -32602 and the value is not echoed', async () => {
  const c = await connect([review]);
  const e = await rawGet(c, { name: 12345 });
  assert.strictEqual(e.code, -32602, e.message);
  assert.ok(!e.message.includes('12345'), e.message);
  assert.ok(e.message.includes('Unknown prompt'), e.message);
});
await check('malformed prompts/get: missing params is -32602, not a crash', async () => {
  const c = await connect([review]);
  const e = await rawGet(c, undefined);
  assert.strictEqual(e.code, -32602, e.message);
});
await check('malformed prompts/get: a non-object arguments value is -32602 on a real prompt', async () => {
  const c = await connect([review]);
  const e = await rawGet(c, { name: 'monthly_review', arguments: 'EVIL' });
  assert.strictEqual(e.code, -32602, e.message);
  assert.ok(!e.message.includes('EVIL'), e.message);
});

// ---------------------------------------------------------------- wiring
const CALL = 'registerPromptHandlers(server, offeredPrompts)';
const hasCall = (src) => stripTsComments(src).includes(CALL);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

await check('the wiring assertion rejects a source with the call removed', () => {
  assert.ok(hasCall(`x;\n${CALL};\n`));
  assert.ok(!hasCall('x;\n'));
  assert.ok(!hasCall(`// ${CALL}\n`));
});
await check('both transports call registerPromptHandlers(server, offeredPrompts)', () => {
  assert.ok(hasCall(read('src/server/stdioServer.ts')), 'stdioServer.ts');
  assert.ok(hasCall(read('src/server/httpServer.ts')), 'httpServer.ts');
});

/** The argument text of each start call, from `await startX(` to the matching `)`. */
function startCalls(src, fn) {
  const code = stripTsComments(src);
  const out = [];
  let from = 0;
  for (;;) {
    const i = code.indexOf(`await ${fn}(`, from);
    if (i < 0) return out;
    let depth = 0;
    let j = i + `await ${fn}`.length;
    for (; j < code.length; j++) {
      if (code[j] === '(') depth++;
      else if (code[j] === ')' && --depth === 0) break;
    }
    out.push(code.slice(i, j + 1));
    from = j;
  }
}
const passesOffered = (call) => /\bofferedPrompts\b/.test(call);
await check('the start-call check can fail: a call without offeredPrompts is detected', () => {
  assert.ok(!passesOffered('await startStdioServer(a, b, outputSchemas)'));
  assert.ok(passesOffered('await startStdioServer(a, b, outputSchemas, offeredPrompts)'));
});
await check('src/index.ts passes offeredPrompts at all three start calls', () => {
  const src = read('src/index.ts');
  const http = startCalls(src, 'startHttpServer');
  const stdio = startCalls(src, 'startStdioServer');
  assert.strictEqual(http.length, 2, 'two startHttpServer calls');
  assert.strictEqual(stdio.length, 1, 'one startStdioServer call');
  for (const call of [...http, ...stdio]) assert.ok(passesOffered(call), call.slice(0, 40));
});
await check('src/index.ts resolves the offered list once', () => {
  const code = stripTsComments(read('src/index.ts'));
  assert.strictEqual(code.split('resolveOfferedPrompts(').length - 1, 1);
});

// The second argument must come from the PUBLISHED tool list: the variable that is also handed to
// every tools/list path (`implementedTools`, from getPublishedToolNames()). getToolNames() is the
// unpublished set and would offer a prompt whose tool tools/list hides.
function resolveSecondArg(src) {
  const code = stripTsComments(src);
  const i = code.indexOf('resolveOfferedPrompts(');
  assert.ok(i >= 0, 'resolveOfferedPrompts call present');
  let depth = 0;
  let j = i + 'resolveOfferedPrompts'.length;
  for (; j < code.length; j++) {
    if (code[j] === '(') depth++;
    else if (code[j] === ')' && --depth === 0) break;
  }
  return { second: code.slice(i + 'resolveOfferedPrompts('.length, j).split(',').slice(1).join(',').trim(), code };
}
const publishedVar = (code) => /const\s+(\w+)\s*=\s*actualToolsManager\.getPublishedToolNames\(\)/.exec(code)?.[1];
const fromPublished = (src) => {
  const { second, code } = resolveSecondArg(src);
  const v = publishedVar(code);
  return !!v && new RegExp(`^new Set\\(\\s*${v}\\s*\\)$`).test(second);
};
await check('src/index.ts builds the offered set from the published tool list', () => {
  assert.ok(fromPublished(read('src/index.ts')));
});
await check('the published-set assertion can fail: the unpublished set and a stray variable are detected', () => {
  const base = read('src/index.ts');
  const bad = base.replace('new Set(implementedTools))', 'new Set(actualToolsManager.getToolNames()))');
  assert.notStrictEqual(bad, base, 'mutation applied');
  assert.ok(!fromPublished(bad));
  assert.ok(!fromPublished(base.replace('new Set(implementedTools))', 'new Set(otherTools))')));
});

console.log(`\n[prompt-handlers] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
