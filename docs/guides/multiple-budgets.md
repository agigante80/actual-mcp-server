# Multiple budgets

Configure several Actual Budget files so the AI can switch between them at runtime with `actual_budgets_list_available` and `actual_budgets_switch`. The variables are a dynamic family read by `src/lib/budget-registry.ts`; their reference rows are under "Multi-budget (dynamic family)" in [reference/configuration.md](../reference/configuration.md).

## Variables

`BUDGET_N_SERVER_URL` and `BUDGET_N_PASSWORD` fall back to `ACTUAL_SERVER_URL` and `ACTUAL_PASSWORD` when omitted.

| Variable | Required | Fallback |
|----------|----------|---------|
| `BUDGET_DEFAULT_NAME` | No | `"Default"` |
| `BUDGET_N_NAME` | Yes (enables group) | _(none)_ |
| `BUDGET_N_SYNC_ID` | Yes | _(none)_ |
| `BUDGET_N_SERVER_URL` | No | `ACTUAL_SERVER_URL` |
| `BUDGET_N_PASSWORD` | No | `ACTUAL_PASSWORD` |
| `BUDGET_N_ENCRYPTION_PASSWORD` | No | _(none)_ |

## Example

```bash
# Default budget
ACTUAL_SERVER_URL=http://actual:5006
ACTUAL_PASSWORD=my-password
ACTUAL_BUDGET_SYNC_ID=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
BUDGET_DEFAULT_NAME=Personal

# Budget 1 (same server, same password)
BUDGET_1_NAME=Family
BUDGET_1_SYNC_ID=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb

# Budget 2 (different server)
BUDGET_2_NAME=Business
BUDGET_2_SERVER_URL=https://actual-office.example.com
BUDGET_2_PASSWORD=office-password
BUDGET_2_SYNC_ID=cccccccc-cccc-cccc-cccc-cccccccccccc
```

## Number budgets consecutively

Number budgets from 1 with no gaps. Enumeration stops at the first missing `BUDGET_n_NAME`, so a gap (for example `BUDGET_1_*` and `BUDGET_3_*` with no `BUDGET_2_*`) means `BUDGET_3` and every later budget are ignored. The server logs a `[CONFIG] ... IGNORED` warning at startup naming the skipped and ignored indices (#289), but does not fail; renumber consecutively to load them.

## Who can reach which budget

On HTTP with `MCP_STATIC_TOKENS` each client's `budgets` list names budgets by these registry names, and with OIDC `AUTH_BUDGET_ACL` restricts by sync id. See [authentication.md](authentication.md).

One budget is open per process. Two clients working on different budgets at the same time force a budget reload on every alternation, which serialises all sessions for the reload; for heavy concurrent use of different budgets run one server per budget (see "One static token per client" in [security-and-privacy.md](../explanation/security-and-privacy.md)).
