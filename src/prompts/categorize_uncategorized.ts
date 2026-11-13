import { z } from 'zod';
import type { PromptDefinition } from './registry.js';
import { optionalDayArgSchema } from './dates.js';

/**
 * categorize_uncategorized (#665): propose categories from payee history, confirm with the user,
 * apply in ONE batch, then offer a rule. The text is guidance only; enforcement of writes stays in
 * the tools. `since` has no default: nothing here reads the server clock.
 */

const TEMPLATE = `Help me categorise my uncategorised transactions{since_clause}. Follow these steps in order, and never change anything before I confirm.

1. Call search_transactions with by uncategorized, include_transactions true and limit 50{since_args}. If totalCount is 0, say so and stop. Work on the transactions returned; if hasMore is true, tell me how many remain and offer another round with offset 50 once this one is done.
2. Call list_entities with type category, so you only propose categories that exist and know their ids.
3. Call summarize_transactions once with report grouped, start_date 2000-01-01, end_date set to the dateRange.endDate from step 1, group_by ["payee", "category"], include_income true and payee_ids set to the distinct payee ids from step 1. Each group is one payee and one category with its transactionCount; ignore groups whose categoryId is null. For each payee, propose the category with the highest transactionCount. If a payee has no categorised group, its top two categories have the same count, or the transaction has no payee, mark it unsure and do not guess. If no transaction has a payee, skip this call.
4. Show me a table: date, payee, amount, proposed category, confidence (the transactionCount behind it). List the unsure ones separately.
5. Ask me to confirm or correct each proposal. Wait for my answer.
6. Apply the confirmed assignments in ONE call to manage_transactions with action update_batch, where updates is a list of { id, fields: { category } } with category ids from step 2. Leave unsure and unconfirmed transactions out. The batch is not atomic: report successCount and every item in failed. Then call search_transactions with by uncategorized{since_args} again and report the new totalCount.
7. Call list_entities with type rule once. For each payee I confirmed to the same category three or more times in this round, and that no existing rule already matches on that payee, offer to create a rule with manage_rules action create: conditions [{ field "payee", op "is", value the payee id }] and actions [{ field "category", op "set", value the category id }]. Create a rule only if I say yes.

Amounts are integer cents; divide by 100 and show currency.`;

const categorize_uncategorized: PromptDefinition = {
  name: 'categorize_uncategorized',
  title: 'Categorise uncategorised transactions',
  description:
    'Find uncategorised transactions, propose categories from payee history, confirm, apply in one batch, and offer rules for repeat payees.',
  arguments: [
    {
      name: 'since',
      description:
        'Only transactions on or after this day, YYYY-MM-DD. Omit for all uncategorised transactions.',
      required: false,
    },
  ],
  requiredTools: [
    'list_entities',
    'search_transactions',
    'summarize_transactions',
    'manage_transactions',
    'manage_rules',
  ],
  argsSchema: z.strictObject({ since: optionalDayArgSchema() }),
  render(args) {
    const since = args.since as string | undefined;
    return TEMPLATE.replaceAll('{since_clause}', since ? ` since ${since}` : '').replaceAll(
      '{since_args}',
      since ? `, start_date ${since}` : '',
    );
  },
};

export default categorize_uncategorized;
