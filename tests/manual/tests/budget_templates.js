/**
 * tests/budget_templates.js
 *
 * BUDGET TEMPLATES TESTS (#841): manage_budget_months actions apply_templates and run_cleanup
 * against the LIVE server. Both belong to the experimental feature budget_automations
 * (MCP_EXPERIMENTAL), so they are published only when the operator named the feature.
 *
 * SKIPS LOUDLY (one skip line) when the published manage_budget_months action enum does not
 * carry `apply_templates`: a server without the feature is a valid configuration.
 *
 * NEGATIVES ONLY, so the run leaves zero residue: both actions WRITE budgeted amounts, and the
 * shared test budget must not change. Every call below is refused before anything is sent:
 *   - a month far outside the budget's range (refused whether or not Goal templates is on,
 *     because either the flag refusal or the range refusal comes first),
 *   - a field the action does not take, and category_id without overwrite.
 * The positive path is covered by the Docker E2E stack, which turns Goal templates on.
 *
 * Reads from context:  (none)
 * Writes to context:   (none)
 */

import { fail, skip } from '../assert.js';

const ZERO_ID = '00000000-0000-4000-8000-000000000000';

/**
 * @param {{ listTools: Function, callTool: Function }} client
 * @param {object} context
 */
export async function budgetTemplatesTests(client, context) { // eslint-disable-line no-unused-vars
  const { listTools, callTool } = client;
  console.log('\n-- Running BUDGET TEMPLATES TESTS (#841, experimental, negatives only) --');

  const tools = await listTools();
  const tool = tools.find((t) => t.name === 'manage_budget_months');
  const published = tool?.inputSchema?.properties?.action?.enum?.includes('apply_templates');
  if (!published) {
    skip('apply_templates and run_cleanup are not published by this server (MCP_EXPERIMENTAL does not name budget_automations)');
    return;
  }

  const expectRefusal = async (label, call, pattern) => {
    try {
      const res = await call();
      fail(`${label}: did not refuse: ${JSON.stringify(res?.result ?? res).slice(0, 200)}`);
    } catch (err) {
      if (pattern.test(err.message)) console.log(`  ok ${label}: refused`);
      else fail(`${label}: unexpected error: ${err.message}`);
    }
  };

  const rangeOrFlag = /Goal templates are not enabled|outside this budget's range/;
  await expectRefusal('apply_templates [out-of-range month]',
    () => callTool('manage_budget_months', { action: 'apply_templates', month: '2019-01' }), rangeOrFlag);
  await expectRefusal('run_cleanup [out-of-range month]',
    () => callTool('manage_budget_months', { action: 'run_cleanup', month: '2019-01' }), rangeOrFlag);
  await expectRefusal('run_cleanup [foreign field]',
    () => callTool('manage_budget_months', { action: 'run_cleanup', month: '2019-01', category_id: ZERO_ID }), /category_id/);
  await expectRefusal('apply_templates [category without overwrite]',
    () => callTool('manage_budget_months', { action: 'apply_templates', month: '2019-01', category_id: ZERO_ID }), /overwrite/);
}
