# Upgrading

How to move an existing install to a newer release, what each release requires, and the changes that can stop an upgraded server from starting.

## Requirements

This table names where each requirement is defined rather than copying a value that would go stale. Read the current value from the source.

| Requirement | Source of truth | How it is checked |
|-------------|-----------------|-------------------|
| Node.js floor | `engines.node` in `package.json` | `src/lib/node-version-guard.ts` refuses to run below it, because npm and npx do not enforce `engines`; `npm run node-version-drift` keeps the Dockerfile and workflows consistent with it |
| Actual Budget server range | `SUPPORTED_ACTUAL_SERVER_RANGE` (`minVersion`, `testedMaxMajor`) in `src/lib/constants.ts` | `src/lib/server-version-guard.ts` logs an advisory warning outside the range; it never fails startup or blocks an operation |
| Bundled `@actual-app/api` | `dependencies` in `package.json` | `get_context` with `topic: "server"` reports the resolved version (`actual_server_info` under `MCP_TOOL_SURFACE=legacy`) |
| This server's version | `version` in `package.json`, and the `vX.Y.Z` release tags | `npm run version:check` |

## Steps

### Docker

```bash
docker pull ghcr.io/agigante80/actual-mcp-server:latest
docker stop actual-mcp-server-backend
docker rm actual-mcp-server-backend
# Re-run the original docker run command with the same flags and volumes
```

Also available on Docker Hub: `docker pull agigante80/actual-mcp-server:latest`

### Docker Compose

```bash
docker compose pull
docker compose --profile production up -d
```

### npm or a cloned repo

```bash
git pull
npm install
npm run build
# Then restart the server
```

### npx and stdio

If you run `npx actual-mcp-server` without a globally installed version, npx fetches the latest from the registry automatically. But if you previously installed it globally (`npm install -g actual-mcp-server`), the global install takes precedence, so you must upgrade it explicitly:

```bash
# Upgrade the global install
npm install -g actual-mcp-server

# Or force the registry version without touching your global install
npx actual-mcp-server@latest --http
```

For Claude Desktop (stdio), restart Claude after upgrading.

## Changes that can stop an upgraded server

These notes are copied from [explanation/security-and-privacy.md](../explanation/security-and-privacy.md), which keeps the full context for each.

### The chat preset publishes `actual_budgets_get_months` and the server details (#770)

`MCP_TOOLSETS=chat` now has 16 legacy tools (it had 12): the four added are `actual_budgets_get_months`, `actual_server_info`, `actual_server_get_version` and `actual_preferences_get`, so `list_budget_months` and every `get_context` topic work under the preset. On the compact surface each tool now lists only the actions the toolset can reach: `manage_budget_months` under `chat` offers `set_amount`, `set_amount_batch` and `transfer`, and its text names only tools that are published. A call to an action the toolset hides is still refused, naming `MCP_TOOLSETS` and listing the enabled actions. Nothing changes without `MCP_TOOLSETS` or `MCP_READ_ONLY`.

### The default tool surface is compact (#680)

`MCP_TOOL_SURFACE` now defaults to `compact`: the server publishes 15 tools (`get_context`, `run_query`, `list_entities`, the `manage_*` family and others) over the same 85 operations, instead of 85 `actual_*` tools. A client, prompt or script that calls an `actual_*` name by default now gets a typed refusal naming `MCP_TOOL_SURFACE=legacy`. To keep the old surface, set `MCP_TOOL_SURFACE=legacy`; `all` publishes both. `MCP_TOOLS` entries must be compact names under `compact` (a legacy name there refuses startup and names the setting). `MCP_TOOLSETS` and the `chat` preset keep working: they select the compact tools whose operations they allow, and each action stays refused when its own toolset or `MCP_READ_ONLY` excludes it. See the [migration guide](migrating-to-compact-tools.md) for the full name mapping, the escape hatch and how to re-select saved tool choices.

### Impossible dates are refused (#745)

The transaction, balance and schedule tools (the legacy ones and the compact tools that front them) now refuse a date that is not a real calendar day (`2018-02-30`, `2018-13-45`) with `Invalid date (not a real calendar day)`. Several of them used to accept such a string, store it, or roll it forward to the next month. A script that sends one must send a real day.

### A transaction update refuses `transfer_id` and any unknown key (#746)

`manage_transactions` `update` and the legacy `actual_transactions_update` no longer accept `transfer_id`. With `transfer_id: null` on a transfer side, upstream wrote a second mirror row in the other account (money duplicated, reported as success); a transfer link has no safe edit. A call that sends it is now refused with `unexpected field(s): transfer_id`. The legacy `fields` object is also strict now: any key it does not declare is refused with the same message instead of being dropped silently. A script that sends a stray key in `fields` must stop sending it; the twelve declared keys are unchanged.

### A note on an unknown id is refused (#757)

`actual_notes_update`, and `set_note` in `manage_accounts`, `manage_categories` and `manage_payees`, now fail with an error result (`Entity "<id>" not found`) when the id names no entity, instead of answering `{ error }` as a success. Nothing was ever written for the unknown id; only the shape of the answer changed. A client that read the `error` field must check for a tool error instead. The same holds for a note write on a budget that cannot be opened (an encrypted budget without its key, for example): that refusal is an error result too.

### An unknown payee id on a rule listing is refused (#818)

`list_entities` with `type: rule` and an unknown `payee_id`, and the legacy `actual_payee_rules_get`, now fail with an error result (`Payee "<id>" not found`) instead of answering `{ error, rules: [], count: 0 }` as a success. A payee that exists but has no rules still answers `{ rules: [], count: 0 }`. A client that read the `error` field must check for a tool error instead.

### Account group sort_order is removed (#817)

`sort_order` on `actual_account_groups_create`, `actual_account_groups_update` and the account group rows of `manage_accounts` is removed. Actual never stored it: its group model strips the field, so a call that sent it succeeded and changed nothing. A call that still sends `sort_order` is now refused, naming the field, and a group update without `name` is refused too, because `name` is the only field Actual keeps and its own update requires it. Drop `sort_order` from stored prompts and scripts.

### HTTP auth is required by default (#242)

An existing HTTP deployment on a non-loopback bind with no token and no OIDC that previously started open will now refuse to start. The startup error names the fix: set `MCP_SSE_AUTHORIZATION` (generate with `openssl rand -hex 32`), or `AUTH_PROVIDER=oidc`, or `MCP_ALLOW_UNAUTHENTICATED=true` to keep the old open behavior. See [authentication.md](authentication.md) before choosing the last one.

### An invalid `AUTH_BUDGET_ACL` refuses startup (#551)

Before #551 an invalid value was logged once and then treated as "no ACL", so every authenticated user could reach every budget. A deployment whose value was silently invalid will refuse its first restart after upgrading, including one with `AUTH_PROVIDER=none` or `AUTH_BUDGET_ACL_SOURCE=actual`, where the variable was previously ignored. The fix is to correct the JSON or unset the variable.

### A short or example token refuses an exposed bind (#611)

An HTTP deployment on `0.0.0.0` whose `MCP_SSE_AUTHORIZATION` is shorter than 32 characters, or is one of the example values from our docs, now refuses to start. Publishing the container port on `127.0.0.1` does not help, because the container itself still binds `0.0.0.0`. Generate a real token with `openssl rand -hex 32`.

### An open server answers only loopback names (#612)

An HTTP server running without a token or OIDC now accepts only `localhost`, `127.0.0.1`, `[::1]`, its concrete bind address, its advertised host (`MCP_BRIDGE_PUBLIC_HOST` or the detected LAN IP, since #615) and the names in `MCP_ALLOWED_HOSTS` as the `Host` header; any other name gets 403 `Invalid Host: <name>`. That includes a container reaching it by service name and a reverse proxy that forwards the public host (Caddy does by default, the nginx example sets `proxy_set_header Host $host`). Add the name to `MCP_ALLOWED_HOSTS`, or better, configure a token. The URL the server prints at startup works as printed: v0.25.0 refused its own advertised host on a wildcard bind (#615), so from v0.25.1 a `MCP_ALLOWED_HOSTS` entry for it is no longer needed.

### `/mcp-info` advertises the address you used, and 401s carry a challenge (#777)

`advertisedUrl` in `GET /mcp-info` and `/mcp-info/http` used to be the detected LAN IP and the internal listen port, which behind a published port is the container's internal address. It now takes host and port from the request `Host` header (scheme and path stay the configured ones) unless `MCP_BRIDGE_PUBLIC_HOST` is set, in which case it is unchanged. A `Host` that is not a plain host name, IPv4 address or bracketed IPv6 literal with an optional port leaves the field out of the document. The response sends `Vary: Host`. If a script reads `advertisedUrl` from the probe, read it from a request made with the name you actually use. Separately, every 401 from a token server now carries a `WWW-Authenticate: Bearer` challenge; nothing else about the 401 changed.

### Old logs can hold budget data (v0.22.38)

Logs written by earlier versions can contain budget data (tool results at `info`, failed-call arguments at `error`). Purge them or let rotation remove them, including copies held by a log shipper or in Claude Desktop's MCP log files.

## Tool failures are isError results and a bad call is -32602 (#769)

A failed tool call now reaches the client as a tool result with `isError: true` whose single text block is the tool's own message (a Zod validation failure, a typed refusal such as "not found", a hidden tool, an upstream failure). Before, the same failure was a JSON-RPC `error` object. Protocol faults are still JSON-RPC errors, but their code and text changed: an unknown tool name and a malformed `tools/call` envelope (a missing or non-string `name`, `arguments` that is not an object) are protocol faults and answer JSON-RPC `-32602`, with `Unknown tool: <name>` (the name is cut to 64 characters) or one of two fixed `Invalid tools/call params` texts, never a schema dump and never an echo of the value sent. A call that omits `arguments` still runs with `{}`. Clients and scripts that detect failure by reading `error` in the JSON-RPC response must also check `result.isError`; an MCP SDK client that throws on the old shape now gets a normal result to inspect. An unknown tool was `-32603` with `Tool not found: <name>` and is now `-32602` with `Unknown tool: <name>`; a client that matched the old code or text must change.

## An account close is refused when its category cannot be kept, and a delete reports transfers (#768)

`actual_accounts_close` and `manage_accounts` `close` now refuse two pairings when the closing account has a non-zero balance and a destination: an on-budget account closed into an off-budget one without `transferCategoryId` ("needs transferCategoryId"), and a `transferCategoryId` on any other pairing ("has no effect"), because Actual keeps a category on the closing transaction only for the first pairing. Both used to succeed and either leave an uncategorised outflow or drop the category silently; nothing is written now. A zero-balance close ignores both arguments as before. `actual_accounts_delete` and `manage_accounts` `delete` now answer `{ success, detachedTransfers }`: the number of transfers in the account whose other half stays in its account with the transfer link removed.

## A rule condition on `transfer` or `parent` is refused (#766)

`manage_rules` (`create`, `create_batch`, `upsert`, `update`) and the legacy `actual_rules_create`, `actual_rules_update`, `actual_rules_create_or_update` and `actual_rules_create_batch` used to store a condition on the field `transfer` or `parent` and report success. Actual's rule engine never sets those two fields on the transaction it evaluates, so such a rule could never match (under any operator, `isNot` included). A call that sends one is now refused with `Condition field "transfer" never matches in a rule` (or `parent`) and that rule is not written; in a `create_batch` it is reported in `failed` and the other rules are still created, so do not resend the whole batch. Rules already stored with such a condition are untouched, and keep doing nothing, until a caller sends the condition again. To find transfers or split parents use `run_query` (`actual_query_run` on the legacy surface) with `transfer_id` or `is_parent`.

## A payee name in `payee` is refused on transaction update (#743)

`actual_transactions_update`, `actual_transactions_update_batch` and `manage_transactions` `update` and `update_batch` used to accept a payee name in `payee`, report success and leave the transaction with no payee. `payee` now takes an id only and a name there is refused; pass the name as `payee_name`, which matches an existing payee (any case) or creates one.

## An unknown account is refused on transaction update and import (#744)

`actual_transactions_update`, `actual_transactions_update_batch`, `actual_transactions_import` and `manage_transactions` `update`, `update_batch` and `import` used to accept an account id that does not exist, report success and write a row whose account points at nothing, which no listing tool returns. They now refuse it with `Account "<id>" not found` (an update or import is refused as a whole, a batch fails only that item) and write nothing. A closed account is still accepted. A script that moves or imports into an account id that does not exist now gets that refusal.

## An unknown payee or category id is refused on transaction create and update (#747)

`actual_transactions_create`, `actual_transactions_update`, `actual_transactions_update_batch` and `manage_transactions` `create`, `update` and `update_batch` used to accept a `payee` or `category` id (also a split child's category) that does not exist, report success and store the row with that payee or category empty. They now refuse it with `Payee "<id>" not found` or `Category "<id>" not found` and write nothing: `create` answers `success: false`, `update` is refused, and `update_batch` fails only that item. `null` still clears a field, a hidden category is accepted (a transfer payee is accepted on update only, see the next section), and a category group id is not a category. A script or saved prompt that sends a stale id now gets that refusal.

## A transfer payee is refused on transaction create (#793)

`actual_transactions_create` and `manage_transactions` `create` used to accept a `payee` id that is the transfer payee of an account and report success. Upstream does not run the transfer logic on create, so that wrote one side of a transfer only: the row had the transfer payee and no link, and the other account got no mirror row, leaving the two balances apart. They now refuse it with `Payee "<id>" is the transfer payee of an account` and write nothing (`create` answers `success: false`); to move money between accounts use `manage_transactions` with `action: transfer` (legacy `actual_transfers_create`). Under `MCP_TOOLSETS=chat` that operation is not published while `create` is: an operator whose users move money between accounts adds the `transactions` toolset. Ordinary payees, `payee_name` and no payee are unchanged. The asymmetry is deliberate: `update` onto a transfer payee still mirrors, because upstream runs the transfer logic there. A rule that sets a transfer payee after the write is not seen by this check.

## An ambiguous `payee_name` is refused on transaction create and import (#752)

`actual_transactions_create`, `actual_transactions_import` and `manage_transactions` `create` and `import` used to attach the row to an arbitrary one of two payees that share the `payee_name` you sent, and report success. They now refuse it with `Payee name "<name>" matches <n> payees, so it does not identify one: <ids>` and write nothing (an import is refused as a whole, `create` answers `success: false`). Pass `payee` with the id you mean instead. A transfer payee never counts, and a name that matches one payee, or none, behaves as before. A saved prompt that sent a duplicated payee name now gets that refusal.

## A name shared by several entities is refused by the name lookup (#801)

`list_entities` with `name` and `actual_get_id_by_name` used to return one arbitrary id when two accounts, payees, categories or schedules share a name, and the filter tools that accept a name in place of an id named only the first duplicate. They now refuse it with `Name "<name>" matches <n> of them, so it does not identify one: <ids>` and change nothing; use the id of the one you mean. A name that matches one entity, or none, behaves as before.

## An import row with an unknown key is refused (#749)

`actual_transactions_import` and `manage_transactions` `import` used to let a row carry any key. An unknown one reached Actual's database layer, which failed the whole import with `Field "x" does not exist on table transactions` and the row JSON. A row now takes only these keys: `date`, `amount`, `payee`, `payee_name`, `imported_payee`, `category`, `notes`, `cleared`, `imported_id`, `account`, `subtransactions`, `transfer_id` and `reconciled`. A split child in `subtransactions` takes only `amount`, `category`, `notes` and `payee`. A row or child with any other key refuses the whole call before anything is written, naming the key (`Unrecognized key: "bogus"`, or `unexpected field(s): bogus` on the legacy tool). What used to pass and now refuses: a row copied from a transaction read back, carrying its `id` or `tombstone`, or a child with a `date`. `account` must now be an account UUID, so a non-UUID `account` value that used to pass is refused too. Send only the keys above.

## A transaction update refuses null for account, date and amount (#814)

`manage_transactions` `update` and `update_batch`, and the legacy `actual_transactions_update` and `actual_transactions_update_batch`, used to accept `null` for `account`, `date` and `amount`, and the write then failed upstream with `"amount" is required for table "transactions"` and the row JSON. They are NOT NULL columns, so the call is now refused before anything is written, naming the key (`amount: cannot be null; omit it to leave it unchanged`). A batch holding one such item is refused as a whole. Omit the key to leave the value unchanged. `null` still clears `payee`, `category`, `notes` and the other optional keys.

## A transaction update with no field, and an unknown key in a batch item, are refused (#815)

`actual_transactions_update` with `fields: {}`, `actual_transactions_update_batch` items with an empty `fields`, and `manage_transactions` `update_batch` items with no field besides `id` used to be accepted and reported as an update although nothing changed. They are now refused with `update needs at least one field to change besides id`, and a refusal in a batch refuses the whole call before anything is written. The legacy batch also used to strip an unknown key, and `subtransactions`, `imported_id`, `reconciled` and `transfer_id`, silently; it now refuses them, naming the key (`unexpected field(s): bogus`). `null` still counts as a change. A script that sent a stray key in a batch item must stop sending it. To split a transaction use `actual_transactions_update`.

## A transfer payee cannot be renamed, and a payee's notes are stored on create (#765)

`actual_payees_update` and `manage_payees` `update` with a `name` on a transfer payee (the payee Actual creates for each account) used to report success and change nothing, because a transfer payee shows its account's name. They now refuse it with `"<name>" is a transfer payee: its name is its account's name, so it cannot be renamed here. Rename the account instead.` and write nothing, also when `category` is sent with it; `category` alone on a transfer payee still works. `actual_payees_create` and `manage_payees` `create` used to drop the `notes` argument and return an id with no note. They now store it as the payee's note (read it with `list_entities` type `note`); if the note cannot be stored the error names the new payee id and says the payee exists, so do not create it again.

## An income category is refused on budget writes, and amounts are bounded (#759)

`actual_budgets_set_amount` and `manage_budget_months` `set_amount` (also a `set_amount_batch` item) on an income category of an envelope budget used to report success and write a row nothing reads. They are now refused with `Category "<name>" (<id>) is not an expense category` and nothing is written (`set_amount` answers `success: false`; a batch fails only that item). A tracking budget still accepts an income amount. `actual_budgets_transfer` and `manage_budget_months` `transfer` refuse an income category as source or target on both budget types, where the old call lowered the source and moved the money out of view into "to budget". An amount above 2251799813685247 (or below its negative) is refused at validation naming the limit, instead of failing inside the write; `hold` is unchanged.

## The budget listing marks the active budget, and the switch text is corrected (#787)

`list_entities` with `type: "budget_file"` (`actual_budgets_list_available`) now adds `active: true` to the row of the budget the calling session is on, and to no other row; a caller with no session, or whose active budget is not in its permitted list, sees no marked row. The switch behaviour did not change, only its description: a switch takes effect at once in the session, other open sessions keep their budget, and the choice is remembered per caller, so a new session of the same caller starts on it. All holders of the one legacy `MCP_SSE_AUTHORIZATION` token are one caller; use `MCP_STATIC_TOKENS` for separate callers. The listing hint no longer says a partial name works: the switch has always required the exact name (case-insensitive). A client that read "this session only" as private to the session should expect the shared preference described here.

## A split's total is kept on update and delete (#748)

Upstream accepts a write that leaves a split's children not summing to the parent and marks the parent with a `SplitTransactionError`. Four writes did that and reported success: changing only the parent amount, changing a child amount, deleting a child, and the same amount edits through `update_batch`. They are now refused with a message naming the split. A caller that edited one side alone must send the parent with `subtransactions` that sum to its amount instead. Still allowed: an amount that keeps the sum equal (this also repairs a split already in error), deleting the only child of a split, deleting the parent, and any edit that does not change an amount. In a batch the refused item lands in `failed` and the others are written.

## Related

- [deployment.md](deployment.md): Docker and Compose profiles.
- [troubleshooting.md](troubleshooting.md): what to check when the upgraded server misbehaves.
