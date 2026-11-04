// #628: the default budget is registered from ACTUAL_SERVER_URL, read once at import, so this
// case needs its own process. A userinfo credential in ACTUAL_SERVER_URL must not appear in the
// registry listing: the default entry shows the origin only.
//
// Run: node tests/unit/budgets_serverurl_redaction_default.test.js

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ACTUAL_SERVER_URL = 'https://proxyuser:proxypass@actual.example';
process.env.ACTUAL_PASSWORD = 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = '00000000-0000-0000-0000-000000000000';
process.env.MCP_BRIDGE_DATA_DIR = mkdtempSync(join(tmpdir(), 'unit628d-'));

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;

log('\n[#628] default budget: getBudgetRegistry hides userinfo');
const reg = adapter.getBudgetRegistry();
check(reg.length >= 1, `the registry has the default entry (got ${reg.length})`);
check(reg[0]?.serverUrl === 'https://actual.example', `the default entry shows the origin (got ${reg[0]?.serverUrl})`);
check(!JSON.stringify(reg).includes('proxypass') && !JSON.stringify(reg).includes('proxyuser'),
  'no registry entry contains the credential');

log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
