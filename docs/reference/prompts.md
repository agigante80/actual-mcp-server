# Prompts reference

The server advertises the MCP `prompts` capability (#660). A prompt is a ready-made instruction a client can offer the user as a command, for example a slash command in Claude Desktop. It carries no budget data: it is static text with the caller's arguments filled in, and it names tools the model should call. A prompt never grants access: every tool it names is still subject to authentication, the budget ACL, `MCP_READ_ONLY`, `MCP_TOOLSETS` and `MCP_TOOLS`.

A prompt is offered only when every tool it names is published. Prompts name compact tools, so none is offered on the `legacy` surface (the default until the compact default ships, #680); set `MCP_TOOL_SURFACE=compact` or `all`. On `prompts/get` a hidden prompt is refused exactly like an unknown one (`-32602`, `Unknown prompt`). An invalid or unknown argument is `-32602` too, and the message never echoes the value and carries one readable text per argument (the client adds the single `MCP error -32602` prefix). An empty or blank optional argument (`""`, `"   "`) means "not provided" and the default applies; surrounding whitespace is trimmed (`" 3 "` is 3). An unknown argument name is refused even when its value is blank. A non-string value (`null`, a number) is still refused.

Defaults that depend on the date (a month, a day) are resolved by the server's local clock, which is UTC in the Docker image, and the rendered text always carries the concrete value.

| Prompt | Title | Arguments | Required tools |
|--------|-------|-----------|----------------|
| `monthly_review` | Monthly budget review | `month` (optional, `YYYY-MM`, default the server's current month) | `get_context`, `list_budget_months`, `summarize_transactions`, `search_transactions` |
| `spending_check` | Spending check | `date` (optional, `YYYY-MM-DD`, default the server's today) | `list_budget_months`, `summarize_transactions` |
| `spending_patterns` | Spending patterns | `end_month` (optional, `YYYY-MM`, default the month before the server's current month), `months` (optional, 1 to 24, default 6) | `summarize_transactions`, `list_budget_months` |
| `budget_cleanup` | Budget cleanup | `date` (optional, `YYYY-MM-DD`, default the server's today) | `list_entities`, `summarize_transactions`, `list_budget_months` |
| `categorize_uncategorized` | Categorise uncategorised transactions | `since` (optional, `YYYY-MM-DD`, default none: all uncategorised transactions). Hidden under `MCP_READ_ONLY=true` and on `legacy` | `list_entities`, `search_transactions`, `summarize_transactions`, `manage_transactions`, `manage_rules` |

## monthly_review

Budget versus actual for one month: the overspent and the unused categories, income versus expenses with the savings rate, and two or three suggestions for next month. The text is read-only and tells the model not to write. All four required tools are read tools, so the prompt stays offered under `MCP_READ_ONLY=true` on the `compact` and `all` surfaces and is hidden on `legacy`. A month outside the budget's range (`list_budget_months` with that month fails with `No budget exists for month`) is handled in the text (#781): it first calls `list_budget_months` with no month, and when the month is not in that list says the budget does not cover it, skips step 2 and the searches in step 4, and answers from the transaction summary alone.

| Argument | Required | Validation |
|----------|----------|------------|
| `month` | No | `YYYY-MM`, month 01 to 12, at most 7 characters. A bad value is refused with `month: must be YYYY-MM`. An unknown key is refused. |

## spending_check

A quick mid-month pace check as of one day: am I on track overall, which categories are over budget or on pace to be, and how much can I still spend (the month's `totalBalance`). The server renders the day of the month, the days in the month and the first day, so the model does no date arithmetic. The overall budget is the sum of the per-category budgeted amounts, because `totalBudgeted` is negative in an envelope budget. The text is read-only. Both required tools are read tools, so the prompt stays offered under `MCP_READ_ONLY=true` on the `compact` and `all` surfaces and is hidden on `legacy`. For a month the budget does not cover (#781), the text lists the budget months first, skips the budget read, reports only the spending so far, and says that no pace verdict and no amount left to spend can be given, including on day 1, where it does not ask for over-budget categories it cannot know.

| Argument | Required | Validation |
|----------|----------|------------|
| `date` | No | `YYYY-MM-DD`, a real calendar day (`2026-02-31` and `2026-02-29` are refused, `2024-02-29` is accepted), at most 10 characters; a bad value is refused with `date: must be YYYY-MM-DD, a real calendar day`. The default is the server's local today, which is UTC in the Docker image, so near local midnight it can be a day off your own date. An unknown key is refused. |

## spending_patterns

Spending trends over the last N full months: overall direction, the categories that changed most, the savings rate trend and anything unusual. It is a fixed script whatever `months` is: the month list from `list_budget_months`, a `grouped` report by month, a `grouped` report by category and month, and the last month of the range from `list_budget_months` (four calls, or three when the budget does not cover that month and the budget read is skipped), and the server renders the concrete start and end dates with integer month arithmetic. The text is read-only. Both required tools are read tools, so the prompt stays offered under `MCP_READ_ONLY=true` on the `compact` and `all` surfaces and is hidden on `legacy`. The arguments are declared `end_month` first, then `months`, because a client that passes arguments by position maps tokens by that order. Claude Code does (measured on 2.1.330; other clients were not checked): give `end_month` first, so a lone `2026-09` after the command sets the month. A call that sends `6 2026-09` is refused with both fields named. If `end_month` is not a budget month (#781), the text lists the budget months first and skips the budget comparison; the two transaction summaries still run.

| Argument | Required | Validation |
|----------|----------|------------|
| `end_month` | No | `YYYY-MM`, month 01 to 12, at most 7 characters; a bad value is refused with `end_month: must be YYYY-MM`. The default is the month before the server's local current month (UTC in the Docker image). An unknown key is refused. |
| `months` | No | A string of an integer from 1 to 24, no leading zero, default 6 (surrounding whitespace is trimmed first). A bad value is refused with `months: must be a whole number from 1 to 24`. 1 renders as `1 full month`. |

## budget_cleanup

A read-only structure review as of one day: duplicate and unused payees, rules that overlap or point at unused or missing payees and categories, unused categories with a zero budget and balance, empty groups, and open accounts with a zero balance. "Unused" means no transaction and no transfer in the six months that end with the date's month, and the server renders the window start by integer month arithmetic. Transfers are counted in `transferCount`, not `transactionCount`, on every group, so an account whose only activity is transfers, or a category used only on transfers to an off-budget account, is in use and is not proposed for closing or deletion. It proposes changes, names the `manage_` action each needs, and asks which to apply; the text says no `manage_` tool is called in the turn. The required tools are read tools, so the prompt stays offered under `MCP_READ_ONLY=true` on the `compact` and `all` surfaces and is hidden on `legacy`. If the date's month is not a budget month (#781), the text lists the budget months first, says the six month window lies outside the months the budget covers, reports duplicates only (payees, rules, category names), marks nothing as unused, stale or closable, skips step 5 and the budget check in step 4, and proposes no category deletion, because its balance cannot be checked.

| Argument | Required | Validation |
|----------|----------|------------|
| `date` | No | `YYYY-MM-DD`, a real calendar day (`2026-02-31` is refused), at most 10 characters; a bad value is refused with `date: must be YYYY-MM-DD, a real calendar day`. The default is the server's local today (UTC in the Docker image). An unknown key is refused. |

## categorize_uncategorized

Categorise uncategorised transactions: find them (50 per round), propose a category per payee from its history (the most frequent category, with the count as confidence, and "unsure" when there is no history, a tie or no payee), ask for confirmation, apply the confirmed ones in ONE `manage_transactions` `update_batch` call, then offer a rule for each payee confirmed to the same category three or more times. A rule is created only on a yes and an existing rule is never modified. The text is guidance only; enforcement stays in the tools. The prompt names write tools, so it is hidden under `MCP_READ_ONLY=true` (a model told to apply categories could only be refused) and on the `legacy` surface, and offered on `compact` and `all`.

| Argument | Required | Validation |
|----------|----------|------------|
| `since` | No | `YYYY-MM-DD`, a real calendar day (`2026-02-30` is refused), at most 10 characters; a bad value is refused with `since: must be YYYY-MM-DD, a real calendar day`. Omitted: all uncategorised transactions. There is no default, so the server clock is not read. An unknown key is refused. |
