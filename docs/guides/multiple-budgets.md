# Multiple budgets

Configure several Actual Budget files so the AI can switch between them at runtime with `manage_budget_files` (`switch`) and `list_entities` (`type: "budget_file"`); under `MCP_TOOL_SURFACE=legacy` those are `actual_budgets_switch` and `actual_budgets_list_available`. The variables are a dynamic family read by `src/lib/budget-registry.ts`; their reference rows are under "Multi-budget (dynamic family)" in [reference/configuration.md](../reference/configuration.md).

## Discover shared budgets

With `AUTH_PROVIDER=oidc` and `AUTH_BUDGET_ACL_SOURCE=actual`, set
`AUTH_BUDGET_DISCOVERY=true` to list budgets shared with each user on
`ACTUAL_SERVER_URL`. Keep the configured default Sync ID. A static entry
takes precedence for the same Sync ID, including its name and encryption
password. A granted encrypted file with no configured key appears after the usable
budgets with `locked: true`. Listing it does not open it. A matching keyless static entry supplies its name and server origin.
When several entries share that Sync ID, the first in registry order wins.
Without a matching entry, the row uses the discovered name and the configured
Actual server origin. The row's hint explains which setting is missing.

An operator can add or complete a `BUDGET_n_*` entry for that Sync ID with
`BUDGET_n_ENCRYPTION_PASSWORD`. Configure it only if every user Actual shares
the file with may read it through this server, including users who were never
given the encryption password.

Use `list_entities` with `type: "budget_file"`, then `manage_budget_files` with
`action: "switch"` and the name or Sync ID. The switch searches usable budgets
by configured name first, then by exact Sync ID, then by file name. Names match
case-insensitively. If several usable files share a name, use an unambiguous
Sync ID. If configured budgets share a Sync ID across servers, use their
distinct configured names. The switch takes effect at once in this session and other open sessions keep their budget. It is also remembered per caller, so a new session of the same caller starts on the switched budget (when configured budgets on different servers share a Sync ID, it starts on the first selectable match in registry order instead); all holders of the one legacy `MCP_SSE_AUTHORIZATION` token are one caller (use `MCP_STATIC_TOKENS` for separate callers), and a caller with no identity remembers nothing. The budget listing marks this session's budget with `active: true`. A switch needs the exact name (case-insensitive), not a partial one.

The switch checks locked files only after the usable lookup finds no match.
An exact locked Sync ID or a unique locked name then gives the missing-key
refusal. If a locked budget and a usable shared file are both named `Home`,
switching to `Home` is refused as ambiguous and lists both Sync IDs: switch by
Sync ID instead. Two locked files with one name are refused as ambiguous the
same way. If a locked file's
Sync ID is `Home` and a usable configured budget is named `Home`, the same
input selects the configured budget.

With OIDC budget discovery enabled, a fresh session chooses its starting budget in this order:

1. Restore the Sync ID from the user's last explicit switch if it is still selectable. If configured budgets on different servers share that ID, the first selectable match in registry order wins, even if the user last switched to the second.
2. Otherwise open the first selectable configured budget (the default, then `BUDGET_1`, `BUDGET_2`, and so on).
3. Otherwise open a discovered file automatically if it is the user's only permitted file and is selectable. Encrypted files count toward the total even when their key is unavailable.
4. With several permitted files or only unusable files, the session can list files but must switch to a selectable one before reading or writing. A user with no grants receives HTTP 403 at initialize.

Opening a budget successfully during initialization pins it for the session. A new share or a rename leaves the choice in place.
If the pinned budget loses access, data calls return `Budget ACL:` after the next permission refresh
(up to 60 seconds), until the user switches. Only an explicit switch saves a preference for future sessions.

If opening a discovered starting budget fails, the session keeps its reserved slot when available.
You can still list and switch. Each data call retries the selected file and reports an open error
if the retry fails. A successful retry uses the shared connection. An explicit switch then pins
the budget. If the session cannot reclaim its slot, initialization fails.

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

On HTTP with `MCP_STATIC_TOKENS` each client's `budgets` list names budgets by these registry names, and with OIDC `AUTH_BUDGET_ACL` restricts by sync id (or, with `AUTH_BUDGET_ACL_SOURCE=actual`, Actual's own per-budget access lists do). See [authentication.md](authentication.md).

One budget is open per process. Two clients working on different budgets at the same time force a budget reload on every alternation, which serialises all sessions for the reload; for heavy concurrent use of different budgets run one server per budget (see "One static token per client" in [security-and-privacy.md](../explanation/security-and-privacy.md)).
