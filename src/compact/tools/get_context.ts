import { z } from 'zod';
import type { CompactToolSpec } from '../types.js';

/**
 * get_context (#672): the compact front for the four context tools. One selector, `topic`,
 * optional and defaulting to `structure`. Every action is read-only. Nothing here imports the
 * adapter: the dispatcher reaches Actual only through callOperation (#671).
 *
 * Mapping (#670 section 7): structure -> actual_get_context, server -> actual_server_info,
 * version -> actual_server_get_version, preferences -> actual_preferences_get.
 */

const includeAccounts = z.boolean().describe('Include the accounts section (default true). topic structure only.');
const includeCategories = z.boolean().describe('Include the categories and category groups section (default true). topic structure only.');
const includePayees = z.boolean().describe('Include the payees section (default true). topic structure only.');
const includeClosed = z.boolean().describe('Include closed accounts (default false, they are left out). topic structure only.');
const payeeLimit = z
  .number()
  .int()
  .min(1)
  .max(2000)
  .describe('Maximum payees to return, 1 to 2000 (default 500). topic structure only.');

// Optional wrappers are built ONCE: the flat published schema keeps a key typed only when
// every target declares the very same schema object.
const structureFields = z
  .object({
    include_accounts: includeAccounts.optional(),
    include_categories: includeCategories.optional(),
    include_payees: includePayees.optional(),
    include_closed: includeClosed.optional(),
    payee_limit: payeeLimit.optional(),
  })
  .refine((v) => !(v.include_accounts === false && v.include_categories === false && v.include_payees === false), {
    message: 'include_accounts, include_categories and include_payees cannot all be false: leave at least one true',
    path: ['include_accounts'],
  });

const none = z.object({});

export const getContext: CompactToolSpec = {
  name: 'get_context',
  description:
    'Read the budget structure or the Actual server details in one call; start here to learn what exists before reading or changing anything. ' +
    'Read-only: it never creates, changes or deletes data. ' +
    'Use list_entities instead to list or look up one kind of entity (accounts, categories, payees, rules, schedules, tags, notes, budget files) or to resolve a name to an id; ' +
    'this tool returns the whole structure at once. ' +
    'Pick one `topic` (default structure). ' +
    'structure: accounts, categories with their groups and payees together, optional include_accounts, include_categories, include_payees, include_closed (closed accounts are left out unless true) and payee_limit (1 to 2000, default 500); ' +
    'a section you exclude is omitted, and at least one of the three include_* flags must stay true. ' +
    'server: the MCP server version, name, Node.js and SDK versions, tool count and uptime, no other fields. ' +
    'version: the Actual server version string, not the MCP server version, no other fields. ' +
    'preferences: the synced display preferences (number format, date format, currency, first day of the week), no other fields; amounts stay integer cents whatever it says. ' +
    'A field given for a topic that does not take it is refused naming the field. ' +
    'Returns the topic\'s result object: the accounts, category groups with nested categories and payees for structure, the server details for server, the version string for version, and the preference values for preferences.',
  selector: 'topic',
  defaultAction: 'structure',
  actions: new Map([
    ['structure', { legacy: 'actual_get_context', fields: structureFields, rename: {
      include_accounts: 'includeAccounts',
      include_categories: 'includeCategories',
      include_payees: 'includePayees',
      include_closed: 'includeClosed',
      payee_limit: 'payeeLimit',
    } }],
    ['server', { legacy: 'actual_server_info', fields: none }],
    ['version', { legacy: 'actual_server_get_version', fields: none }],
    ['preferences', { legacy: 'actual_preferences_get', fields: none }],
  ]),
};
