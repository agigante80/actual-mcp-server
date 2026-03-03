# AI Prompt Tests — Manual Copy-Paste Suite

**Project:** Actual MCP Server  
**Purpose:** Copy-paste prompts for manually testing all 62 MCP tools via an AI chat session  
**Last Updated:** 2026-03-03

---

## How It Works

This folder contains **three sequentially numbered prompts**. You paste them one at a time into the **same AI chat session**, progressing from lightweight smoke testing to full comprehensive coverage.

Because all three prompts run in the **same chat session**, the AI retains:
- The `{TS}` session timestamp generated in Prompt 1
- All entity IDs created in earlier prompts (accounts, payees, categories, rules, etc.)

---

## The Three Prompts

| File | Coverage | When to use |
|------|----------|-------------|
| [`prompt-1-smoke.txt`](./prompt-1-smoke.txt) | **Phase 1** — 7 read-only tools | Always run first. Confirms the server is up and connected. |
| [`prompt-2-core.txt`](./prompt-2-core.txt) | **Phases 2–6b** — ~39 CRUD tools | Paste after Prompt 1 passes. Tests accounts, categories, payees, rules, transactions, schedules. |
| [`prompt-3-advanced.txt`](./prompt-3-advanced.txt) | **Phases 7–12** — ~14 tools + full cleanup | Paste after Prompt 2 passes. Tests budgets, summaries, query engine, session management, and cleans up everything. |

---

## Step-by-Step Usage

1. **Start the MCP server** and open a new chat session in LibreChat, LobeChat, or any MCP-enabled client with a model that has tool access.

2. **Paste Prompt 1** (`prompt-1-smoke.txt` — everything below `─── PROMPT START`).  
   The AI will test 7 read-only tools and produce one status line per tool.

3. If **all Phase 1 tools pass**, paste **Prompt 2** into the **same chat session**.  
   The AI continues from Phase 2 using the same `{TS}` and resumes numbering automatically.

4. If **all Phase 2 tools pass** and you want deeper coverage, paste **Prompt 3** into the **same chat session**.  
   The AI tests advanced features and cleans up all test data.

5. **If any tool fails**: the AI will stop and report the failure. Fix the issue before pasting the next prompt.

---

## Phase Overview

| Phase | Prompt | Tools | Domain |
|-------|--------|-------|--------|
| 1 | Prompt 1 | 7 | Server info, read-only lists, `actual_get_id_by_name` |
| 2 | Prompt 2 | 6 | Account CRUD |
| 3 | Prompt 2 | 6 | Category Group & Category CRUD |
| 4 | Prompt 2 | 5 | Payee CRUD + rules + merge |
| 5 | Prompt 2 | 4 | Rules CRUD |
| 5b | Prompt 2 | 3 | Batch update, uncategorized, rules upsert |
| 6 | Prompt 2 | 11 | Transaction CRUD + search |
| 6b | Prompt 2 | 4 | Schedule CRUD |
| 7 | Prompt 3 | 2 | Transaction summaries |
| 8 | Prompt 3 | 11 | Budget management |
| 9 | Prompt 3 | 2 | Advanced query + bank sync |
| 10 | Prompt 3 | 2 | Session management |
| 11 | Prompt 3 | — | Concurrency (optional, skipped by default) |
| 12 | Prompt 3 | — | Full cleanup |

**Total: 62 tools across 3 prompts**

---

## Naming Convention

All test data created by the AI follows the `MCP-{Type}-{TS}` pattern (e.g. `MCP-Account-2026-03-03T14-30-22-456Z`). This matches the automated `tests/manual/` JS scripts so the same cleanup logic can identify and delete test artifacts.

---

## Adding a New Tool

When adding a new MCP tool, update the appropriate prompt file to include it:
- Determine which phase it belongs to (by domain — see table above)
- Add both a **positive** and a **negative** test scenario
- Update the phase header tool count in the prompt file
- Update the total tool count in this README (Phase Overview table above)

See [`docs/NEW_TOOL_CHECKLIST.md`](../../docs/NEW_TOOL_CHECKLIST.md) Step 6 for the full process.
