// tests/unit/zod_error_format.test.js  (#206)
// Unit-tests the actionable Zod error formatter: every issue class, the leaf-hint
// resolver over optional/default/array/object wrappers, the no-leak / key-sanitisation
// security guarantees, and two real tools driven through the live callTool path.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'dummy';

let failures = 0;
const pass = (l) => console.log(`  ✓ ${l}`);
const fail = (l, d = '') => { console.error(`  ✗ FAIL: ${l}${d ? ` (${d})` : ''}`); failures++; };
const eq = (got, want, l) => got === want ? pass(l) : fail(l, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const ok = (cond, l, d = '') => cond ? pass(l) : fail(l, d);

(async () => {
  const { z } = await import('zod');
  const { formatZodError } = await import('../../dist/src/lib/zod-error-format.js');

  // A schema exercising each issue class plus wrapper kinds for hint resolution.
  const Schema = z.object({
    account: z.string().regex(/^[0-9a-f-]{36}$/, 'Invalid account ID format (expected UUID)').describe('Account UUID'),
    amount: z.number().int('Amount must be an integer (cents)').describe('Amount in cents'),
    note: z.string().describe('Free text').optional(),                 // ZodOptional wrapper
    role: z.enum(['admin', 'user', 'guest']).default('user'),          // ZodDefault wrapper
    tags: z.array(z.string().describe('A tag')),                       // ZodArray element hint
    limit: z.number().min(1).max(100),
    query: z.string().min(1),
  }).strict();

  // Each probe invalidates exactly one field (the rest of `base` is valid), so the
  // full message equals `Validation error: ` + the single rendered fragment. Comparing
  // the whole string avoids splitting on ", " (which appears inside messages).
  const fmt = (input) => {
    const r = Schema.safeParse(input);
    if (r.success) throw new Error('expected a validation failure');
    return formatZodError(r.error, Schema);
  };
  const one = (input, fragment, label) => eq(fmt(input), `Validation error: ${fragment}`, label);

  const base = { account: '00000000-0000-0000-0000-000000000000', amount: 100, tags: ['a'], limit: 5, query: 'x' };

  console.log('\n[#206] missing required -> "is required" + describe() hint');
  one({ ...base, account: undefined }, 'account is required (Account UUID)', 'missing field reads "is required" with hint');
  one({ ...base, amount: undefined }, 'amount is required (Amount in cents)', 'missing number field with hint');

  console.log('\n[#206] type mismatch -> "expected X, received Y" + hint');
  one({ ...base, amount: 'fifty' }, 'amount: expected number, received string (Amount in cents)', 'wrong-type appends hint');

  console.log('\n[#206] custom messages pass through unchanged');
  one({ ...base, amount: 12.5 }, 'amount: Amount must be an integer (cents)', 'custom int message preserved');
  one({ ...base, account: 'bad' }, 'account: Invalid account ID format (expected UUID)', 'custom regex message preserved');

  console.log('\n[#206] enum -> allowed values');
  one({ ...base, role: 'root' }, 'role: allowed values: admin, user, guest', 'enum lists allowed values');

  console.log('\n[#206] range -> at most / at least, grammatical units');
  one({ ...base, limit: 999 }, 'limit: must be at most 100', 'too_big number, no unit');
  one({ ...base, query: '' }, 'query: must be at least 1 character', 'too_small string, singular unit');

  console.log('\n[#206] unrecognized key -> "unexpected field(s)", no empty-path prefix');
  const unrec = fmt({ ...base, bogusKey: 'v' });
  eq(unrec, 'Validation error: unexpected field(s): bogusKey', 'unrecognized key rendered, no empty-path prefix');
  ok(!unrec.includes(', :') && !unrec.includes(': :'), 'no stray empty-path segment', unrec);

  console.log('\n[#206] leaf-hint resolver over wrappers');
  // optional-wrapped field still resolves its inner describe()
  one({ ...base, note: 123 }, 'note: expected string, received number (Free text)', 'hint resolved through ZodOptional');
  // array element describe() resolves by numeric path segment
  one({ ...base, tags: [5] }, 'tags.0: expected string, received number (A tag)', 'hint resolved through ZodArray element');

  console.log('\n[#206] default-branch issue codes + invalid_type hardening');
  {
    // z.literal mismatch is invalid_value with a single-element values array
    const Lit = z.object({ status: z.literal('active') }).strict();
    eq(formatZodError(Lit.safeParse({ status: 'off' }).error, Lit),
      'Validation error: status: allowed values: active', 'literal mismatch lists the single allowed value');
    // .refine() failure has code "custom"; the default branch passes its message through with the path
    const Ref = z.object({ pin: z.string().refine(() => false, 'must be 4 digits') }).strict();
    eq(formatZodError(Ref.safeParse({ pin: 'x' }).error, Ref),
      'Validation error: pin: must be 4 digits', 'refine (custom code) renders via default branch');
    // HARDENING: a custom invalid_type message that happens to start with the default prefix
    // but carries no "received <word>" token must pass through unchanged, not garble to "received invalid".
    const Tricky = z.object({ x: z.string({ error: 'Invalid input: expected a 36-char id' }) }).strict();
    eq(formatZodError(Tricky.safeParse({ x: 9 }).error, Tricky),
      'Validation error: x: Invalid input: expected a 36-char id', 'custom invalid_type message without "received" passes through');
  }

  console.log('\n[#206] restored pointer: categoryGroupId describe surfaces the list tool');
  {
    const { CommonSchemas } = await import('../../dist/src/lib/schemas/common.js');
    const G = z.object({ group_id: CommonSchemas.categoryGroupId }).strict();
    eq(formatZodError(G.safeParse({}).error, G),
      'Validation error: group_id is required (Category group UUID; list with actual_category_groups_get)',
      'missing group_id surfaces the actual_category_groups_get pointer');
  }

  console.log('\n[#206] graceful: no schema, empty error');
  ok(typeof formatZodError({ issues: [] }) === 'string', 'empty issues returns a string, never throws');
  {
    const r = Schema.safeParse({ ...base, amount: undefined });
    eq(formatZodError(r.error).split(', ').length >= 1, true, 'formats with no schema arg (no hints) without throwing');
  }

  console.log('\n[#206] SECURITY: output never leaks value / internals; key bounded + sanitised');
  {
    const secret = 'SUPER_SECRET_VALUE_12345';
    const msg = fmt({ ...base, amount: secret });
    ok(!msg.includes(secret), 'rejected input VALUE never appears in output', msg);
    ok(!/\bat \/|\.ts:\d|\.js:\d|node_modules|\/home\/|SELECT |password=/i.test(msg), 'no stack frame / path / SQL / env leak', msg);
  }
  {
    // hostile key: 4 KB with control chars and newlines must be stripped + capped at 64
    const hostile = 'x'.repeat(4096) + '\u0000\u0007\nevil';
    const r = Schema.safeParse({ ...base, [hostile]: 1 });
    const msg = formatZodError(r.error, Schema);
    const echoed = msg.replace(/^Validation error: unexpected field\(s\): /, '');
    ok(!/[\u0000-\u001f\u007f]/.test(echoed), 'control characters stripped from echoed key');
    ok(echoed.length <= 67, 'echoed key length-capped (<=64 + ellipsis)', `len ${echoed.length}`);
    ok(echoed.startsWith('xxxx'), 'echoed key is the (truncated) offending key', echoed.slice(0, 8));
  }

  console.log('\n[#206] live path: two real tools through callTool');
  {
    const manager = (await import('../../dist/src/actualToolsManager.js')).default;
    await manager.initialize();
    const call = async (name, args) => {
      try { await manager.callTool(name, args); return null; }
      catch (e) { return e?.message ?? String(e); }
    };
    eq(await call('actual_transactions_create', {}),
      'Validation error: account is required (Account UUID), date is required (Date in YYYY-MM-DD format), amount is required (Amount in cents (negative for expenses, positive for income))',
      'transactions_create missing-fields wired end to end');
    eq(await call('actual_entities_search', { type: 'payees', query: 'x', matchType: 'regex' }),
      'Validation error: matchType: allowed values: contains, startsWith, endsWith, exact, fuzzy',
      'entities_search enum wired end to end');
    // bespoke->central unification: accounts_update bad UUID uses the shared prefix
    eq(await call('actual_accounts_update', { id: 'not-a-uuid', fields: { name: 'x' } }),
      'Validation error: id: Invalid account ID format (expected UUID)',
      'accounts_update ZodError unified onto central prefix');
    // domain (non-Zod) message preserved
    eq(await call('actual_accounts_update', { id: '00000000-0000-0000-0000-000000000000', fields: {} }),
      'No fields provided to update. Include at least one field: name, offbudget, or closed.',
      'accounts_update domain message preserved');
    // unrecognized field in strict sub-object (matches the e2e /unexpected field/i assertion)
    eq(await call('actual_accounts_update', { id: '00000000-0000-0000-0000-000000000000', fields: { invalidField: 'x' } }),
      'Validation error: unexpected field(s): invalidField',
      'accounts_update unrecognized field wired end to end');
  }

  console.log('');
  if (failures === 0) console.log('[#206] All zod-error-format tests passed ✓');
  else { console.error(`[#206] ${failures} test(s) FAILED`); process.exit(2); }
})().catch((e) => { console.error('[#206] harness crashed:', e); process.exit(2); });
