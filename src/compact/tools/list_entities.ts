import { showDiscoveredBudgets } from '../../lib/budgetSelector.js';
import { z } from 'zod';
import { SCHEDULE_DATES_CAP } from '../../lib/constants.js';
import { CommonSchemas } from '../../lib/schemas/common.js';
import { FULL_SURFACE, type CompactActionRow, type CompactRoute, type CompactToolSpec, type DescriptionContext } from '../types.js';

/**
 * list_entities (#672): the compact front for the sixteen list, lookup and search tools.
 * Selector `type` is required. Every action is read-only. Nothing here imports the adapter.
 *
 * A row has a default legacy tool; a field route sends the call to another one when its
 * trigger field is present (query to the search tool, name to the id lookup, and so on).
 * The compact `type` values are singular and the legacy `type` enums are plural, so each
 * route carries the plural as a FIXED argument: a value translation, not a key rename.
 * Every legacy name below is a static table value; none is ever read from input.
 */

// Each schema object is built ONCE and shared by every row that uses it, so the flat
// published schema keeps the key typed (it types a key only when all targets share the object).
const query = z
  .union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)])
  .describe('Name pattern, or an array matching if ANY matches. Only for type account, category, payee.');
const matchType = z
  .enum(['contains', 'startsWith', 'endsWith', 'exact', 'fuzzy'])
  .describe('How query matches (default contains; case-insensitive; fuzzy tolerates typos). Needs query.');
const limit = z.number().int().min(1).max(100).describe('Maximum matches (default 10). Needs query.');
const name = z
  .string()
  .min(1, 'name cannot be empty')
  .describe('Exact name to resolve to an id. Only for type account, category, payee, schedule; not with query or schedule_id.');
const sort = z.enum(['frequency']).describe('frequency: most used payees of recent transactions. Only for type payee, alone.');
const payeeId = CommonSchemas.payeeId.describe('Payee UUID: list only its rules. Only for type rule.');
const scheduleId = CommonSchemas.scheduleId.describe('Schedule UUID: list its dates. Only for type schedule; not with name.');
const start = CommonSchemas.date.describe('First date, YYYY-MM-DD (default today). Needs schedule_id.');
const end = CommonSchemas.date.describe('Last date, YYYY-MM-DD, inclusive. Needs schedule_id.');
const count = z.number().int().min(1).max(SCHEDULE_DATES_CAP).describe(`How many dates to return, 1 to ${SCHEDULE_DATES_CAP}. Needs schedule_id.`);
const id = z.string().min(1).describe('Required for type note: an account, category, category group or payee UUID, or budget-YYYY-MM.');
// Only the experimental category_automations row uses this field (feature budget_automations), so it is
// dropped from the published schema whenever that action is narrowed away.
const categoryId = z.string().min(1).describe('UUID.');
const scope = z
  .enum(['configured', 'server'])
  .describe('For budget_file only. configured (default): ' +
    (showDiscoveredBudgets ? 'permitted configured and shared files. Locked rows are encrypted, lack a server key and cannot be switched to.' : 'configured files.') +
    ' server: Actual server files.');

const none = z.object({});
const searchFields = z.object({ query, match_type: matchType.optional(), limit: limit.optional() });
const nameFields = z.object({ name });
const sortFields = z.object({ sort });
const datesFields = z.object({ schedule_id: scheduleId, start: start.optional(), end: end.optional(), count: count.optional() });
const scopeFields = z.object({ scope: scope.optional() });

const searchRoute = (plural: string): CompactRoute => ({
  triggers: ['query', 'match_type', 'limit'],
  legacy: 'actual_entities_search',
  fields: searchFields,
  rename: { match_type: 'matchType' },
  fixed: { type: plural },
});
const nameRoute = (plural: string): CompactRoute => ({
  triggers: ['name'],
  legacy: 'actual_get_id_by_name',
  fields: nameFields,
  fixed: { type: plural },
});

const row = (legacy: string, routes?: readonly CompactRoute[]): CompactActionRow => ({ legacy, fields: none, ...(routes ? { routes } : {}) });

/**
 * The description for the actions a process offers. With the experimental feature off (the default)
 * `category_automations` is not named and the text is byte-identical to the one before that action existed.
 * With it on, four lines are shortened: this entry sits at the 3,900 byte per-tool ceiling by default, so
 * the new action pays for itself (tests/unit/tools_list_size_budget.test.js measures the feature-on run).
 */
function describe(ctx: DescriptionContext): string {
  const automations = ctx.hasAction('category_automations');
  return (
    'List, search or look up budget entities of one `type`: account, account_group, category, category_group, payee, tag, rule, schedule, note' +
    (automations ? ', category_automations' : '') +
    ' or budget_file. For the whole budget structure, server details or preferences in one call use get_context instead.\n' +
    (automations
      ? 'Type alone lists every entity; a field the type does not take is refused.\n'
      : 'With only type it lists every entity of that type. A field the type does not take is refused naming the field.\n') +
    'account, category, payee: query (string or array) with match_type and limit to search by name, or name to resolve one exact name to its id, refused with the candidate ids when several share it.\n' +
    (automations
      ? 'payee: also sort frequency (the 10 most used in the last 12 weeks).\n'
      : 'payee: also sort frequency (the 10 most used payees of the last 12 weeks; a transfer payee can appear, with transfer_acct null).\n') +
    (automations
      ? 'schedule: name to resolve its id, or schedule_id with start, end and count (default and max 366) to list its dates.\n'
      : 'schedule: name to resolve its id, or schedule_id with start, end and count (default and maximum 366) to list the dates it falls on.\n') +
    'rule: payee_id to list that payee\'s rules.\n' +
    (automations
      ? 'tag: the tag list.\nnote: requires id.\n'
      : 'tag: the tag list (colour, description); tags used only in notes are not listed.\nnote: requires id (an entity UUID or budget-YYYY-MM).\n') +
    (automations ? 'category_automations (experimental): requires category_id; scheduleMissing: true fails an apply.\n' : '') +
    'budget_file: scope configured (default; active true marks this session\'s budget) or server.\n' +
    'query and name are mutually exclusive, as are schedule_id and name; match_type and limit need query; start, end and count need schedule_id; sort allows no other field.\n' +
    'Returns the list for the type; a query returns { matches, count, total, truncated }, a name returns the id, a schedule_id returns { schedule_id, name, dates, count, truncated }, and a note returns { found, id, note }.'
  );
}

export const listEntities: CompactToolSpec = {
  name: 'list_entities',
  domain: 'Context and lookup',
  summary: 'List or look up accounts, categories, payees, rules, schedules, tags, notes or budget files, and resolve a name to an id.',
  examplePrompt: 'List my payees whose name contains Market.',
  description: describe(FULL_SURFACE),
  describeFor: describe,
  selector: 'type',
  actions: new Map<string, CompactActionRow>([
    ['account', row('actual_accounts_list', [searchRoute('accounts'), nameRoute('accounts')])],
    ['account_group', row('actual_account_groups_list')],
    ['category', row('actual_categories_get', [searchRoute('categories'), nameRoute('categories')])],
    ['category_group', row('actual_category_groups_get')],
    ['payee', row('actual_payees_get', [
      searchRoute('payees'),
      nameRoute('payees'),
      { triggers: ['sort'], legacy: 'actual_payees_common_list', fields: sortFields, drop: ['sort'] },
    ])],
    ['tag', row('actual_tags_list')],
    ['rule', { legacy: 'actual_rules_get', fields: none, routes: [
      { triggers: ['payee_id'], legacy: 'actual_payee_rules_get', fields: z.object({ payee_id: payeeId }), rename: { payee_id: 'payeeId' } },
    ] }],
    ['schedule', row('actual_schedules_get', [
      nameRoute('schedules'),
      { triggers: ['schedule_id', 'start', 'end', 'count'], legacy: 'actual_schedules_dates', fields: datesFields },
    ])],
    ['note', { legacy: 'actual_notes_get', fields: z.object({ id }) }],
    ['budget_file', { legacy: 'actual_budgets_list_available', fields: scopeFields, drop: ['scope'], routes: [
      { triggers: ['scope'], when: (call) => call.scope === 'server', triggerValue: 'server', phrase: 'scope server', legacy: 'actual_budgets_get_all', fields: scopeFields, drop: ['scope'] },
    ] }],
    // LAST, so the default (feature off) narrowed surface stays byte-identical: experimental feature budget_automations.
    ['category_automations', { legacy: 'actual_categories_get_automations', fields: z.object({ category_id: categoryId }), rename: { category_id: 'categoryId' } }],
  ]),
};
