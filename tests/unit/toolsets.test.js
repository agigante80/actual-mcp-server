// tests/unit/toolsets.test.js
//
// #483: Server-side toolsets (MCP_TOOLSETS, MCP_TOOLS, MCP_READ_ONLY) and the chat preset.
//
// Run: node tests/unit/toolsets.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  console.log('\n[#483] toolsets and presets unit tests');

  const {
    TOOLSETS,
    TOOLSET_GROUPS,
    PRESETS,
    PRESET_NAMES,
    WRITE_CAPABLE,
    NON_QUEUE_MUTATORS,
    resolvePublishedToolNames,
    getUnpublishedRefusalReason,
  } = await import('../../dist/src/lib/toolsets.js');

  const { buildToolListEntries } = await import('../../dist/src/lib/tool-list-entry.js');
  const actualToolsManager = (await import('../../dist/src/actualToolsManager.js')).default;
  await actualToolsManager.initialize();

  const allRegisteredTools = actualToolsManager.getToolNames();

  // --------------------------------------------------------------------------
  // 1. Partition & Registry Consistency
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Partition and Registry Consistency ---');

  // getToolNames() equals IMPLEMENTED_TOOLS as a set
  const managerSrc = read('src/actualToolsManager.ts');
  const implementedToolsMatch = managerSrc.match(/const IMPLEMENTED_TOOLS\s*=\s*\[([\s\S]*?)\];/);
  assert(implementedToolsMatch, 'could not find IMPLEMENTED_TOOLS in actualToolsManager.ts');
  const implementedNames = [...implementedToolsMatch[1].matchAll(/'(actual_[A-Za-z0-9_]+)'/g)].map((m) => m[1]);

  check(
    allRegisteredTools.length === implementedNames.length &&
      allRegisteredTools.every((t) => implementedNames.includes(t)),
    'getToolNames() equals IMPLEMENTED_TOOLS as a set'
  );

  // Every registered tool belongs to exactly one toolset
  const toolToGroup = new Map();
  let duplicateCount = 0;
  for (const group of TOOLSET_GROUPS) {
    for (const tool of TOOLSETS[group]) {
      if (toolToGroup.has(tool)) {
        duplicateCount++;
        console.error(`Tool ${tool} is in multiple groups: ${toolToGroup.get(tool)} and ${group}`);
      }
      toolToGroup.set(tool, group);
    }
  }

  check(duplicateCount === 0, 'every grouped tool appears in at most one toolset group');
  check(
    allRegisteredTools.every((t) => toolToGroup.has(t)),
    'every registered tool belongs to a toolset group'
  );
  check(
    toolToGroup.size === allRegisteredTools.length,
    `toolset groups exactly partition all registered tools (${toolToGroup.size} / ${allRegisteredTools.length})`
  );

  // --------------------------------------------------------------------------
  // 2. Preset Membership Guard
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Preset Membership Guard ---');

  for (const preset of PRESET_NAMES) {
    const members = PRESETS[preset];
    const allMembersRegistered = members.every((m) => allRegisteredTools.includes(m));
    check(allMembersRegistered, `every tool in preset "${preset}" is registered`);
  }

  // A preset with an unregistered tool fails with an error naming the tool
  assert.throws(
    () => {
      resolvePublishedToolNames(['actual_tool_a'], {
        MCP_TOOLSETS: 'chat',
      });
    },
    /Preset "chat" specifies tool ".*" which is not registered/,
    'resolvePublishedToolNames rejects presets that contain unregistered tools'
  );
  pass('preset guard fails naming unregistered tool');

  // --------------------------------------------------------------------------
  // 3. Positive Scenarios
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Positive Scenarios ---');

  // Default: byte-identical to baseline
  {
    const defaultPublished = resolvePublishedToolNames(allRegisteredTools, {});
    check(defaultPublished.length === allRegisteredTools.length, 'default publishes all registered tools');

    const toolSchemas = {};
    for (const name of defaultPublished) {
      const t = actualToolsManager.getTool(name);
      if (t?.inputSchema) {
        toolSchemas[name] = z.toJSONSchema(t.inputSchema);
      }
    }
    const entries = buildToolListEntries(defaultPublished, (name) => ({
      description: actualToolsManager.getTool(name)?.description,
      schema: toolSchemas[name],
    }));

    const baselineJson = read('tests/unit/fixtures/tools-list-baseline.json');
    const currentJson = JSON.stringify(entries);
    check(
      currentJson === baselineJson,
      'Given no toolset config, then the tools/list payload is byte-identical to the pre-change baseline'
    );
  }

  // Given MCP_TOOLSETS=context,query -> exactly 15 tools
  {
    const published = resolvePublishedToolNames(allRegisteredTools, {
      MCP_TOOLSETS: 'context,query',
    });
    check(published.length === 15, `MCP_TOOLSETS=context,query returns 15 tools (got ${published.length})`);
    check(
      TOOLSETS.context.every((t) => published.includes(t)) &&
        TOOLSETS.query.every((t) => published.includes(t)),
      'published list contains all tools from context and query groups'
    );
  }

  // Given MCP_TOOLSETS=query and MCP_TOOLS=actual_accounts_list -> 2 tools
  {
    const published = resolvePublishedToolNames(allRegisteredTools, {
      MCP_TOOLSETS: 'query',
      MCP_TOOLS: 'actual_accounts_list',
    });
    check(published.length === 2, `MCP_TOOLSETS=query and MCP_TOOLS=actual_accounts_list returns 2 tools (got ${published.length})`);
    check(
      published.includes('actual_query_run') && published.includes('actual_accounts_list'),
      'contains actual_query_run and actual_accounts_list'
    );
  }

  // Given MCP_TOOLSETS=chat -> exactly preset members
  {
    const published = resolvePublishedToolNames(allRegisteredTools, {
      MCP_TOOLSETS: 'chat',
    });
    check(published.length === PRESETS.chat.length, `MCP_TOOLSETS=chat returns ${PRESETS.chat.length} tools`);
    check(
      PRESETS.chat.every((t) => published.includes(t)),
      'MCP_TOOLSETS=chat returns all members of the chat preset'
    );
  }

  // --------------------------------------------------------------------------
  // 4. Negative Scenarios & Rejection
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Negative Scenarios and Dispatch Refusal ---');

  // Unknown toolset typo (MCP_TOOLSETS=transactons) aborts startup
  {
    let threw = false;
    try {
      resolvePublishedToolNames(allRegisteredTools, { MCP_TOOLSETS: 'transactons' });
    } catch (err) {
      threw = true;
      check(
        err.message.includes('transactons') && err.message.includes('Valid names are:'),
        'MCP_TOOLSETS=transactons fails naming the unknown toolset and listing valid names'
      );
    }
    check(threw, 'unknown toolset aborts startup');
  }

  // Unknown tool in MCP_TOOLS aborts startup
  {
    let threw = false;
    try {
      resolvePublishedToolNames(allRegisteredTools, { MCP_TOOLS: 'actual_nonexistent_xyz' });
    } catch (err) {
      threw = true;
      check(err.message.includes('actual_nonexistent_xyz'), 'unknown tool in MCP_TOOLS fails naming the tool');
    }
    check(threw, 'unknown tool in MCP_TOOLS aborts startup');
  }

  // CallTool refusal when tool is hidden by MCP_TOOLSETS
  {
    actualToolsManager.refreshPublishedTools({ MCP_TOOLSETS: 'query' });
    let threw = false;
    try {
      await actualToolsManager.callTool('actual_transactions_delete', {});
    } catch (err) {
      threw = true;
      check(
        err.message.includes('MCP_TOOLSETS'),
        `callTool on hidden tool refuses with error naming MCP_TOOLSETS (got: ${err.message})`
      );
    }
    check(threw, 'callTool on unpublished tool is refused');
  }

  // --------------------------------------------------------------------------
  // 5. Read-Only Mode & WRITE_CAPABLE Call-Graph Derivation
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Read-Only Mode and Write-Capability Derivation ---');

  // Mechanically derive write-capable tools from the actual-adapter source
  function stripComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  function classifyAdapterMethods() {
    let src = stripComments(read('src/lib/actual-adapter.ts'));
    const cut = src.indexOf('\nexport default {');
    assert(cut !== -1, 'could not find default export block in actual-adapter.ts');
    src = src.slice(0, cut);
    const fns = [...src.matchAll(/^export (?:async )?function (\w+)\s*\(/gm)];
    const writes = new Set();
    const reads = new Set();
    fns.forEach((m, i) => {
      const end = i + 1 < fns.length ? fns[i + 1].index : src.length;
      const body = src.slice(m.index, end);
      (/\b(queueWriteOperation|batchBudgetUpdates)\s*\(/.test(body) ? writes : reads).add(m[1]);
    });
    return { writes, reads };
  }

  function adapterCallsOf(toolName) {
    const file = join('src/tools', `${toolName.replace(/^actual_/, '')}.ts`);
    if (!existsSync(join(ROOT, file))) return [];
    return [...new Set([...stripComments(read(file)).matchAll(/adapter\.(\w+)\s*\(/g)].map((m) => m[1]))];
  }

  const { writes } = classifyAdapterMethods();
  const derivedWriteCapable = new Set(NON_QUEUE_MUTATORS);
  for (const name of allRegisteredTools) {
    const calls = adapterCallsOf(name);
    if (calls.some((c) => writes.has(c))) {
      derivedWriteCapable.add(name);
    }
  }

  check(
    derivedWriteCapable.size === WRITE_CAPABLE.size &&
      [...derivedWriteCapable].every((t) => WRITE_CAPABLE.has(t)),
    `WRITE_CAPABLE set in toolsets.ts matches the adapter call-graph derivation (${WRITE_CAPABLE.size} write tools)`
  );

  // MCP_READ_ONLY=true with MCP_TOOLSETS=all publishes no write-capable tool
  {
    const readOnlyPublished = resolvePublishedToolNames(allRegisteredTools, {
      MCP_READ_ONLY: 'true',
      MCP_TOOLSETS: 'all',
    });
    const hasWriteTool = readOnlyPublished.some((t) => WRITE_CAPABLE.has(t));
    check(!hasWriteTool, 'MCP_READ_ONLY=true publishes NO write-capable tool');
    check(
      readOnlyPublished.length === allRegisteredTools.length - WRITE_CAPABLE.size,
      `MCP_READ_ONLY=true publishes exactly all read tools (${readOnlyPublished.length} tools)`
    );

    // CallTool on bank_sync under read-only is refused naming MCP_READ_ONLY
    actualToolsManager.refreshPublishedTools({ MCP_READ_ONLY: 'true', MCP_TOOLSETS: 'all' });
    let threw = false;
    try {
      await actualToolsManager.callTool('actual_bank_sync', {});
    } catch (err) {
      threw = true;
      check(
        err.message.includes('MCP_READ_ONLY'),
        `calling actual_bank_sync under MCP_READ_ONLY refuses with error naming MCP_READ_ONLY (got: ${err.message})`
      );
    }
    check(threw, 'callTool on write tool under MCP_READ_ONLY is refused');
  }

  // Read-only purity: src/lib/toolsets.ts does NOT import or reference ToolAnnotations
  const toolsetsSrc = read('src/lib/toolsets.ts');
  check(
    !toolsetsSrc.includes('ToolAnnotations') && !toolsetsSrc.includes('tool-annotations'),
    'src/lib/toolsets.ts does not branch on or import tool annotations'
  );

  // --------------------------------------------------------------------------
  // 6. server_info tool reporting
  // --------------------------------------------------------------------------
  console.log('\n--- 6. server_info Tool Reporting ---');

  const serverInfoMod = await import('../../dist/src/tools/server_info.js?toolsets=1');
  const serverInfoTool = serverInfoMod.default;

  // With chat preset: published total is 10, registered is 82
  {
    actualToolsManager.refreshPublishedTools({ MCP_TOOLSETS: 'chat' });
    const res = await serverInfoTool.call({});
    check(res.tools.total === 10, `server_info reports published total = 10 (got ${res.tools.total})`);
    check(res.tools.registered === 82, `server_info reports registered total = 82 (got ${res.tools.registered})`);
  }

  // Restore default
  actualToolsManager.refreshPublishedTools({});
  {
    const res = await serverInfoTool.call({});
    check(res.tools.total === 82, `server_info reports published total = 82 under default (got ${res.tools.total})`);
    check(res.tools.registered === 82, `server_info reports registered total = 82 under default (got ${res.tools.registered})`);
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('');
  if (failures === 0) {
    console.log('[#483] All toolsets unit tests passed ✓');
  } else {
    console.error(`[#483] ${failures} test(s) FAILED`);
    process.exit(1);
  }
})();
