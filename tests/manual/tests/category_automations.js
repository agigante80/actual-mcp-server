/**
 * tests/category_automations.js
 *
 * CATEGORY AUTOMATIONS TESTS (#840): list_entities type category_automations against the
 * LIVE server. The action belongs to the experimental feature budget_automations
 * (MCP_EXPERIMENTAL), so it is published only when the operator named the feature.
 *
 * SKIPS LOUDLY (one skip line) when the published list_entities enum does not carry
 * `category_automations`: a server without the feature is a valid configuration, and a skip
 * is neither a pass nor a failure. It runs in the release gate only when the gate container
 * (the local-env compose file, outside this repo) sets MCP_EXPERIMENTAL=budget_automations;
 * the Docker E2E stack (tests/e2e/compose.yaml) covers the action whatever that file says.
 *
 * Everything it writes is created and removed here: a DISPOSABLE group and category (never an
 * existing one, because the note is overwritten), removed in a finally.
 *
 * Reads from context:  (none)
 * Writes to context:   (none)
 */

import { fail, skip } from '../assert.js';

/**
 * @param {{ listTools: Function, callTool: Function }} client
 * @param {object} context
 */
export async function categoryAutomationsTests(client, context) { // eslint-disable-line no-unused-vars
  const { listTools, callTool } = client;
  console.log('\n-- Running CATEGORY AUTOMATIONS TESTS (#840, experimental) --');

  const tools = await listTools();
  const entity = tools.find((t) => t.name === 'list_entities');
  const published = entity?.inputSchema?.properties?.type?.enum?.includes('category_automations');
  if (!published) {
    skip('category_automations is not published by this server (MCP_EXPERIMENTAL does not name budget_automations)');
    return;
  }

  const stamp = Date.now();
  let groupId = null;
  let categoryId = null;
  try {
    const grp = await callTool('manage_categories', { action: 'create', entity: 'category_group', name: `MCP-AutoGroup-${stamp}` });
    groupId = grp?.id ?? grp?.result?.id ?? grp?.result ?? null;
    const cat = await callTool('manage_categories', { action: 'create', entity: 'category', name: `MCP-AutoCat-${stamp}`, group_id: groupId });
    categoryId = cat?.categoryId ?? cat?.id ?? cat?.result ?? null;
    if (!categoryId) {
      fail(`category_automations: the disposable category was not created: ${JSON.stringify(cat).slice(0, 200)}`);
      return;
    }

    // Positive: a note-managed category returns the directive line of its note.
    await callTool('manage_categories', { action: 'set_note', id: categoryId, note: 'Rent\npay #template 50' });
    const res = await callTool('list_entities', { type: 'category_automations', category_id: categoryId });
    const data = res?.result ?? res;
    if (data?.source === 'notes' && JSON.stringify(data?.noteDirectives) === JSON.stringify(['#template 50'])) {
      console.log(`  ok category_automations [note-managed]: ${JSON.stringify(data.noteDirectives)}`);
    } else {
      fail(`category_automations [note-managed]: expected source notes and ["#template 50"], got ${JSON.stringify(data).slice(0, 300)}`);
    }

    // Positive: with the note cleared the same category returns no directives.
    await callTool('manage_categories', { action: 'set_note', id: categoryId, note: '' });
    const cleared = await callTool('list_entities', { type: 'category_automations', category_id: categoryId });
    const clearedData = cleared?.result ?? cleared;
    if (clearedData?.source === 'notes' && Array.isArray(clearedData.noteDirectives) && clearedData.noteDirectives.length === 0) {
      console.log('  ok category_automations [note cleared]: no directives');
    } else {
      fail(`category_automations [note cleared]: expected no directives, got ${JSON.stringify(clearedData).slice(0, 300)}`);
    }

    // Negative: a field list_entities does not take for this type is refused, naming the field.
    try {
      await callTool('list_entities', { type: 'category_automations', category_id: categoryId, query: 'x' });
      fail('category_automations [foreign field]: did not refuse a query field');
    } catch (err) {
      if (/query/.test(err.message)) console.log('  ok category_automations [foreign field]: refused naming the field');
      else fail(`category_automations [foreign field]: unexpected error: ${err.message}`);
    }
  } catch (err) {
    fail(`category_automations round-trip: ${err.message}`);
  } finally {
    if (categoryId) { try { await callTool('manage_categories', { action: 'delete', entity: 'category', id: categoryId }); } catch { /* residue sweep covers */ } }
    if (groupId) { try { await callTool('manage_categories', { action: 'delete', entity: 'category_group', id: groupId }); } catch { /* residue sweep covers */ } }
  }

  // Negative: an unknown category id is a refusal, not a success-shaped answer.
  try {
    const res = await callTool('list_entities', { type: 'category_automations', category_id: '00000000-0000-4000-8000-000000000000' });
    fail(`category_automations [unknown id]: did not refuse: ${JSON.stringify(res?.result ?? res).slice(0, 200)}`);
  } catch (err) {
    if (err.message.includes('not found')) console.log('  ok category_automations [unknown id]: refused with a useful error');
    else fail(`category_automations [unknown id]: unexpected error: ${err.message}`);
  }
}
