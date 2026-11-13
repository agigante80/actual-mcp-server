# Prompts reference

The server advertises the MCP `prompts` capability (#660). A prompt is a ready-made instruction a client can offer the user as a command, for example a slash command in Claude Desktop. It carries no budget data: it is static text with the caller's arguments filled in, and it names tools the model should call. A prompt never grants access: every tool it names is still subject to authentication, the budget ACL, `MCP_READ_ONLY`, `MCP_TOOLSETS` and `MCP_TOOLS`.

A prompt is offered only when every tool it names is published. Prompts name compact tools, so none is offered on the `legacy` surface (the default until the compact default ships, #680); set `MCP_TOOL_SURFACE=compact` or `all`. On `prompts/get` a hidden prompt is refused exactly like an unknown one (`-32602`, `Unknown prompt`). An invalid or unknown argument is `-32602` too, and the message never echoes the value.

Defaults that depend on the date (a month, a day) are resolved by the server's local clock, which is UTC in the Docker image, and the rendered text always carries the concrete value.

| Prompt | Title | Arguments | Required tools |
|--------|-------|-----------|----------------|
| `monthly_review` | Monthly budget review | `month` (optional, `YYYY-MM`, default the server's current month) | `get_context`, `list_budget_months`, `summarize_transactions`, `search_transactions` |
| `spending_check` | Spending check | `date` (optional, `YYYY-MM-DD`, default the server's today) | `list_budget_months`, `summarize_transactions` |

## monthly_review

Budget versus actual for one month: the overspent and the unused categories, income versus expenses with the savings rate, and two or three suggestions for next month. The text is read-only and tells the model not to write. All four required tools are read tools, so the prompt stays offered under `MCP_READ_ONLY=true` on the `compact` and `all` surfaces and is hidden on `legacy`.

| Argument | Required | Validation |
|----------|----------|------------|
| `month` | No | `YYYY-MM`, month 01 to 12, at most 7 characters. An unknown key is refused. |

## spending_check

A quick mid-month pace check as of one day: am I on track overall, which categories are over budget or on pace to be, and how much can I still spend (the month's `totalBalance`). The server renders the day of the month, the days in the month and the first day, so the model does no date arithmetic. The overall budget is the sum of the per-category budgeted amounts, because `totalBudgeted` is negative in an envelope budget. The text is read-only. Both required tools are read tools, so the prompt stays offered under `MCP_READ_ONLY=true` on the `compact` and `all` surfaces and is hidden on `legacy`.

| Argument | Required | Validation |
|----------|----------|------------|
| `date` | No | `YYYY-MM-DD`, a real calendar day (`2026-02-31` and `2026-02-29` are refused, `2024-02-29` is accepted), at most 10 characters. The default is the server's local today, which is UTC in the Docker image, so near local midnight it can be a day off your own date. An unknown key is refused. |
