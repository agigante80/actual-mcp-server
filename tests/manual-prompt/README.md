# AI Prompt Tests: Manual Copy-Paste Suite

**Project:** Actual MCP Server  
**Purpose:** Copy-paste prompts for manually testing every MCP operation via an AI chat session  
**Last Updated:** 2026-11-13  

---

## How It Works

This folder contains **three sequentially numbered prompts**. You paste them one at a time into the **same AI chat session**, progressing from lightweight smoke testing to full comprehensive coverage.

The prompts target a chat client on the **default compact tool surface** (`MCP_TOOL_SURFACE=compact`): 15 tools over 85 operations. Each tool takes one selector argument (`topic`, `type`, `by`, `report` or `action`) that picks the operation. Every (tool, selector value) pair must be named on at least one prompt line; `tests/unit/new_tool_completeness.test.js` enforces that.

Because all three prompts run in the **same chat session**, the AI retains:
- The `{TS}` session timestamp generated in Prompt 1
- All entity IDs created in earlier prompts (accounts, payees, categories, rules, etc.)

---

## The Three Prompts

| File | Coverage | When to use |
|------|----------|-------------|
| [`prompt-1-smoke.txt`](./prompt-1-smoke.txt) | **Phase 1**: 9 read-only operations | Always run first. Confirms the server is up and connected. |
| [`prompt-2-core.txt`](./prompt-2-core.txt) | **Phases 2 to 6c**: ~51 CRUD operations | Paste after Prompt 1 passes. Tests accounts, categories, payees, rules, transactions, schedules, tags. |
| [`prompt-3-advanced.txt`](./prompt-3-advanced.txt) | **Phases 7 to 12**: ~25 operations + full cleanup | Paste after Prompt 2 passes. Tests summaries, budgets, query engine, notes, preferences, the export/import round trip, and cleans up everything. Phase 10 (session management) sits in a block marked `[legacy or all surface only: skip on compact]`. |

---

## Step-by-Step Usage

1. **Start the MCP server** and open a new chat session in LibreChat, LobeChat, or any MCP-enabled client with a model that has tool access. Leave the tool surface at its default (compact).

2. **Paste Prompt 1** (`prompt-1-smoke.txt`: everything below `─── PROMPT START`).  
   The AI will test 9 read-only operations and produce one status line per operation.

3. If **all Phase 1 operations pass**, paste **Prompt 2** into the **same chat session**.  
   The AI continues from Phase 2 using the same `{TS}` and resumes numbering automatically.

4. If **all Phase 2 operations pass** and you want deeper coverage, paste **Prompt 3** into the **same chat session**.  
   The AI tests advanced features and cleans up all test data.

5. **If any operation fails**: the AI will stop and report the failure. Fix the issue before pasting the next prompt.

---

## Phase Overview

| Phase | Prompt | Tools | Domain |
|-------|--------|-------|--------|
| 1 | Prompt 1 | 9 | Server info and read-only lists: `get_context` (topics server, version, structure), `list_entities` (types account, category_group, category, payee, name lookup, query search) |
| 2 | Prompt 2 | 6 | Account CRUD: `manage_accounts`, `summarize_transactions` report balance |
| 2b | Prompt 2 | 4 | Account group CRUD (#429): `manage_accounts` with entity account_group |
| 3 | Prompt 2 | 6 | Category Group & Category CRUD: `manage_categories` |
| 4 | Prompt 2 | 6 | Payee CRUD + rules + merge + common list (#451): `manage_payees`, `list_entities` |
| 5 | Prompt 2 | 4 | Rules CRUD: `manage_rules` |
| 5b | Prompt 2 | 4 | Batch update, uncategorized, rules upsert, rules batch (#485) |
| 6 | Prompt 2 | 12 | Transaction CRUD + search + splits (#305) + transfers (#451): `manage_transactions`, `search_transactions` |
| 6b | Prompt 2 | 5 | Schedule CRUD + upcoming dates (#479): `manage_schedules` |
| 6c | Prompt 2 | 4 | Tag CRUD (#184, covered here since #451): `manage_tags` |
| 7 | Prompt 3 | 5 | `summarize_transactions` reports by_category, by_payee, grouped, account_flow, recurring (#451) |
| 8 | Prompt 3 | 11 | Budget management: `manage_budget_months`, `manage_budget_files`, `list_budget_months` |
| 9 | Prompt 3 | 2 | Advanced query + bank sync: `run_query`, `manage_accounts` action bank_sync |
| 9b | Prompt 3 | 2 | Notes (get + set): `list_entities` type note, the `set_note` actions |
| 9c | Prompt 3 | 1 | Preferences (synced display settings, #333): `get_context` topic preferences |
| 9d | Prompt 3 | 2 | Budget export + import round trip (#332/#334). **Import half needs a disposable budget**: it creates and loads a new budget |
| 10 | Prompt 3 | 2 | Session management (`actual_session_list`, `actual_session_close`). **Legacy or all surface only**: the block is skipped on compact, so it is counted separately from the compact total |
| 11 | Prompt 3 |  | Concurrency (optional, skipped by default) |
| 12 | Prompt 3 |  | Full cleanup |

**Total: 85 tools across 3 prompts**

The 85 nominal operations include the 2 session operations of Phase 10. On the compact surface that
block is skipped, so a compact run reaches at most 83.

---

## Naming Convention

All test data created by the AI follows the `MCP-{Type}-{TS}` pattern (e.g. `MCP-Account-2026-03-03T14-30-22-456Z`). This matches the automated `tests/manual/` JS scripts so the same cleanup logic can identify and delete test artifacts.

---

## Adding a New Tool or Operation

When adding a new MCP operation, update the appropriate prompt file to include it:
- Determine which phase it belongs to (by domain: see table above)
- Name the compact tool and its selector value together on one prompt line (for example `manage_tags, action: "create"`). The completeness guard fails if any (tool, selector value) pair of a compact tool is missing from the prompts, and fails if a prompt names a legacy `actual_*` tool (only the two session tools inside the marked Phase 10 block are exempt)
- Add both a **positive** and a **negative** test scenario
- Update the phase header operation count in the prompt file and keep the tally lines consistent: each `Total` line must equal the sum of the `Phase ... X / n` lines above it, and the Total in this README must equal the sum of the Phase Overview rows
- Update the total in this README (Phase Overview table above)

See [`docs/development/new-tool-checklist.md`](../../docs/development/new-tool-checklist.md) for the full process, including the compact flow.
