# TDQS baseline

A local measurement of our tool definitions against Glama's Tool Definition Quality Score (#640). Glama grades every listed MCP server with TDQS; its spec publishes the exact scoring prompts and formulas, so we can score ourselves before Glama does.

| | |
| :--- | :--- |
| Date | 2026-11-12 |
| Spec | TDQS v1.3, https://github.com/glama-ai/tool-definition-quality-score |
| Scorer | `opencode/deepseek-v4.1-flash-free` through the opencode CLI (default effort; the CLI exposes no temperature) |
| Runs | 3 per tool; coherence 3 runs at baseline and 1 after (see Deviations); every per-tool score is the median of the 3 |
| Measured | every published tool, from `tools/list` on develop `07883c05` (v0.27.4); after the rewrites, the same capture of the #640 change |
| Harness | `scripts/tdqs/tdqs.mjs` with the verbatim Appendix A and B system prompts beside it |
| Raw output | `docs/audit/tdqs-raw/before/` and `docs/audit/tdqs-raw/after/` |

## Formulas

- Per tool: TDQS = 0.25 purpose + 0.20 usage guidelines + 0.20 behavioral transparency + 0.15 parameter semantics + 0.10 conciseness + 0.10 contextual completeness, each dimension scored 1 to 5.
- Description quality = 0.6 × mean(TDQS) + 0.4 × min(TDQS). The worst tool carries 40% of it.
- Overall = 0.7 × description quality + 0.3 × coherence. Tier A starts at 3.5, B at 3.0.

## Re-running it

```bash
npm run build
export TDQS_CLI=opencode TDQS_OPENCODE="$(command -v opencode)" TDQS_MODEL=opencode/deepseek-v4.1-flash-free
node scripts/tdqs/tdqs.mjs capture . tools.json          # offline tools/list, dummy Actual settings (85 legacy tools)
node scripts/tdqs/tdqs.mjs capture . compact.json --surface compact   # the 15 compact tools (#679); a repo .env cannot change either surface
node scripts/tdqs/tdqs.mjs score tools.json runs --runs 3 # add --only a,b to score some tools
node scripts/tdqs/tdqs.mjs coherence tools.json coh       # Appendix B, 3 runs
node scripts/tdqs/tdqs.mjs report tools.json runs coh     # medians, tiers, aggregates as JSON
```

The scorer runs with `OPENCODE_PERMISSION` denying edit, bash and webfetch, from an empty scratch directory. No API key and no npm dependency is involved. No CI job runs this: the score is nondeterministic and the free model can leave the opencode list at any time.

## Deviations and limits

- **Not comparable with a Glama-hosted score.** Glama does not publish which model it grades with; a different model gives different numbers. These figures compare our own before and after, nothing else.
- **Scorer re-pinned.** The ticket first pinned Gemini 4 Argon (via the agy CLI). Its quota ran out mid-baseline (reset about 2026-11-14); agy Opus 5.5 and Grok were also out of quota, and Codex is at its usage limit until 2026-12-08. On the maintainer's instruction to proceed with whatever AI was available, the scorer was re-pinned to DeepSeek, a different lab from the implementer's model, so it does not grade its own prose. Baseline and re-score both used DeepSeek; nothing is mixed.
- **Batching.** Appendix A scores one tool per call. To keep the run count practical, up to 10 tools go in one call with an added instruction that each is scored independently and returned as one object of the Appendix A output format in a JSON array. A batch can let the scorer judge tools against each other.
- **No temperature control.** The opencode CLI has no temperature flag; the median of 3 runs is the only damping.
- **Four after-scores predate the review fixes.** Code review of the rewrites changed the wording of `transactions_create` (it now says the returned id is null with the current Actual API and to find the row with `actual_query_run`), `accounts_create` (how to make an off-budget account), `payees_create` and `rules_get` (one sentence each). A re-score of those four on the final text was started on 2026-11-12, but every scorer call timed out with no answer: the free opencode endpoints (DeepSeek, and GLM as a probe) stopped responding. Their after-scores in the tables below are for the reviewed-before text; the final text only adds facts the scorer had marked missing, so it is not expected to score lower, but that is unmeasured.
- **After coherence is one run.** The 3-run after coherence also stalled: run 1 finished (3.3, inside the baseline's 2.5 to 3.3 spread), runs 2 and 3 timed out. The Aggregates row "After" therefore uses the baseline coherence median of 3.
- **Side data.** A partial Opus 5.5 baseline taken on 2026-11-11 while Argon was out of quota is not used anywhere in this document.

## How the 10 were chosen

The 10 lowest baseline medians, ascending. Three tools tied at 3.5 for the last two places (`categories_update`, `rules_get`, `schedules_get`); the tie was broken by the mean of the 3 run scores, lowest first (3.50, 3.57 and 3.63), so `schedules_get` stayed out. It is now the weakest tool.

Each rewrite states verb, resource and scope, when to use a named sibling instead, side effects and failure modes consistent with its annotations, and the return shape, and cuts text that only restated the schema. The 10 rewrites add 2,997 bytes net to `tools/list` (the ticket caps them at 3,000), measured by `tests/unit/tools_list_size_budget.test.js`, whose total ceiling was raised in the same commit with its reason. No schema, behaviour or annotation value changed. Three parameter descriptions in the search tools lost text that restated the schema ("Optional: ", "(default: 100)").

The ticket's negative scenarios rest on existing guards: an amount of `12.5` is still rejected (`tests/unit/zod_error_format.test.js:51`, unchanged), a rewrite that pushes the total above the then-current `TOTAL_CEILING` fails `tools_list_size_budget.test.js` naming the total, a rewrite naming a tool the `chat` preset hides fails `toolsets.test.js`, and a prose read-only claim on a write tool can only be caught by the re-score's `annotation_contradiction` field, which was false in every run of every rewritten tool.

## What to do next

- **Re-score the four reviewed tools** and the 3-run after coherence once a free scorer answers again, then update the tables.
- **Next weakest tools.** After the rewrites the minimum is `schedules_get` at 3.5, then `budgets_get_all`, `categories_create`, `category_groups_create`, `payees_get` and `schedules_create` at 3.6. Because the minimum carries 40% of description quality, raising those six lifts the overall more than polishing tools already above 4.5.
- **Coherence is the ceiling.** Coherence did not measurably move (one after run scored 3.3, the baseline median is 3) and holds 30% of the overall. The scorer marks disambiguation and tool count lowest: it flags overlapping tools (for example `transactions_aggregate` against `account_flow_summary`) and the sheer number of tools. Description rewrites barely move it; fewer or clearly separated tools would. The per-group decisions are in [tool-overlap.md](tool-overlap.md).

## Increment: Glama's own scores (#650)

After v0.27.1 Glama published its own TDQS for this server: average 4.0, minimum 2.9. #650 took the 14 weakest tools on Glama's list that #640 had not rewritten, read from Glama's score page on 2026-11-12:

| Tool | Glama score (v0.27.1) |
| :--- | ---: |
| `actual_transactions_get` | 3.2 |
| `actual_category_groups_get` | 3.3 |
| `actual_budgets_getMonth` | 3.5 |
| `actual_categories_delete` | 3.5 |
| `actual_category_groups_create` | 3.5 |
| `actual_category_groups_update` | 3.5 |
| `actual_budgets_resetHold` | 3.6 |
| `actual_budgets_transfer` | 3.6 |
| `actual_categories_create` | 3.6 |
| `actual_payee_rules_get` | 3.6 |
| `actual_payees_update` | 3.6 |
| `actual_schedules_create` | 3.6 |
| `actual_schedules_delete` | 3.6 |
| `actual_transactions_import` | 3.6 |

Each was rewritten to the same rules as the #640 ten, with every claim checked against the adapter or the upstream source: deleting a schedule also deletes its rule, deleting a category moves none of its transactions, `actual_category_groups_get` returns each group with its categories, and an import always runs the rules. `actual_accounts_create` (a #640 tool) lost its "in Actual Budget." phrase. The 15 edits add 2,217 bytes net to `tools/list` (118,125 to 120,342, 158 bytes under the total ceiling), inside the unchanged ceilings, so neither ceiling was raised.

**Measurement.** Glama is the measurement: its after-scores appear once it builds a release containing #650. The local DeepSeek re-score did not run, because the free opencode endpoint still timed out on 2026-11-12 (a one-word probe got no answer in 90 seconds). The mechanical guard is `tests/unit/tool_description_checklist.test.js`: each of the 24 rewritten descriptions has a sentence starting `Returns`, names at least one other published tool, and carries none of "in Actual Budget.", "Perfect for" or "Ideal for". Before the rewrites it failed on all 14 tools plus `actual_accounts_create`.

## Per-tool baseline

| Tool | Purpose | Guidelines | Transparency | Params | Concise | Complete | TDQS | Tier |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| account_flow_summary | 5 | 4 | 5 | 3 | 4 | 5 | 4.3 | A |
| account_groups_create | 5 | 4 | 4 | 3 | 4 | 4 | 4.1 | A |
| account_groups_delete | 5 | 4 | 5 | 3 | 4 | 4 | 4.3 | A |
| account_groups_list | 5 | 4 | 4 | 4 | 5 | 4 | 4.4 | A |
| account_groups_update | 5 | 5 | 4 | 3 | 5 | 4 | 4.4 | A |
| accounts_close | 5 | 5 | 5 | 3 | 4 | 4 | 4.5 | A |
| accounts_create | 4 | 2 | 2 | 3 | 4 | 3 | 3.2 | B |
| accounts_delete | 5 | 4 | 5 | 3 | 5 | 4 | 4.4 | A |
| accounts_get_balance | 4 | 3 | 4 | 3 | 4 | 4 | 3.7 | A |
| accounts_list | 4 | 2 | 3 | 4 | 4 | 4 | 3.7 | A |
| accounts_reopen | 5 | 4 | 5 | 3 | 4 | 4 | 4.3 | A |
| accounts_update | 4 | 3 | 3 | 3 | 4 | 3 | 3.2 | B |
| bank_sync | 5 | 4 | 5 | 3 | 4 | 5 | 4.4 | A |
| budget_updates_batch | 5 | 4 | 5 | 4 | 4 | 5 | 4.6 | A |
| budgets_export | 5 | 4 | 4 | 3 | 4 | 4 | 4.1 | A |
| budgets_get_all | 4 | 3 | 3 | 4 | 4 | 3 | 3.6 | A |
| budgets_getMonth | 4 | 3 | 4 | 3 | 5 | 4 | 3.7 | A |
| budgets_getMonths | 4 | 3 | 4 | 4 | 4 | 4 | 3.8 | A |
| budgets_holdForNextMonth | 5 | 4 | 5 | 4 | 4 | 5 | 4.6 | A |
| budgets_import | 5 | 5 | 5 | 4 | 4 | 5 | 4.8 | A |
| budgets_list_available | 5 | 4 | 4 | 4 | 5 | 4 | 4.4 | A |
| budgets_resetHold | 5 | 3 | 3 | 3 | 5 | 4 | 3.8 | A |
| budgets_setAmount | 5 | 5 | 4 | 4 | 4 | 4 | 4.5 | A |
| budgets_setCarryover | 5 | 4 | 4 | 4 | 4 | 4 | 4.3 | A |
| budgets_switch | 5 | 5 | 4 | 3 | 5 | 4 | 4.4 | A |
| budgets_transfer | 5 | 3 | 4 | 3 | 5 | 4 | 3.8 | A |
| categories_create | 4 | 4 | 3 | 3 | 4 | 3 | 3.6 | A |
| categories_delete | 5 | 3 | 4 | 3 | 5 | 4 | 3.9 | A |
| categories_get | 5 | 3 | 4 | 4 | 4 | 4 | 4.1 | A |
| categories_update | 5 | 3 | 3 | 3 | 4 | 3 | 3.5 | A |
| category_groups_create | 5 | 3 | 3 | 3 | 4 | 3 | 3.6 | A |
| category_groups_delete | 5 | 3 | 4 | 3 | 5 | 4 | 4 | A |
| category_groups_get | 5 | 3 | 4 | 4 | 4 | 4 | 4.1 | A |
| category_groups_update | 5 | 3 | 3 | 3 | 5 | 3 | 3.7 | A |
| entities_search | 5 | 5 | 5 | 4 | 4 | 5 | 4.7 | A |
| get_context | 5 | 5 | 4 | 3 | 4 | 4 | 4.4 | A |
| get_id_by_name | 5 | 4 | 3 | 3 | 3 | 3 | 3.7 | A |
| notes_get | 5 | 4 | 4 | 3 | 4 | 4 | 4.1 | A |
| notes_update | 5 | 4 | 5 | 4 | 4 | 4 | 4.5 | A |
| payee_rules_get | 5 | 3 | 3 | 3 | 5 | 3 | 3.7 | A |
| payees_common_list | 5 | 5 | 4 | 4 | 5 | 4 | 4.6 | A |
| payees_create | 4 | 2 | 2 | 3 | 4 | 3 | 3 | B |
| payees_delete | 5 | 4 | 5 | 3 | 5 | 4 | 4.4 | A |
| payees_get | 4 | 3 | 4 | 4 | 4 | 4 | 3.6 | A |
| payees_merge | 5 | 4 | 5 | 4 | 4 | 5 | 4.6 | A |
| payees_update | 5 | 3 | 3 | 4 | 4 | 4 | 3.9 | A |
| preferences_get | 5 | 4 | 5 | 4 | 5 | 4 | 4.7 | A |
| query_run | 5 | 5 | 5 | 5 | 4 | 5 | 4.9 | A |
| recurring_expenses_summary | 5 | 4 | 5 | 4 | 4 | 5 | 4.5 | A |
| rules_create | 4 | 4 | 4 | 5 | 4 | 4 | 4.2 | A |
| rules_create_batch | 5 | 4 | 5 | 3 | 4 | 5 | 4.4 | A |
| rules_create_or_update | 5 | 4 | 5 | 4 | 4 | 5 | 4.6 | A |
| rules_delete | 5 | 4 | 4 | 3 | 5 | 4 | 4.2 | A |
| rules_get | 4 | 3 | 3 | 4 | 4 | 3 | 3.5 | A |
| rules_update | 5 | 4 | 4 | 4 | 4 | 4 | 4.3 | A |
| schedules_create | 4 | 3 | 3 | 3 | 4 | 3 | 3.6 | A |
| schedules_dates | 5 | 5 | 5 | 4 | 4 | 5 | 4.8 | A |
| schedules_delete | 5 | 3 | 4 | 3 | 5 | 4 | 4 | A |
| schedules_get | 4 | 3 | 3 | 4 | 4 | 3 | 3.5 | A |
| schedules_update | 5 | 4 | 4 | 4 | 5 | 4 | 4.4 | A |
| server_get_version | 5 | 5 | 4 | 4 | 5 | 5 | 4.7 | A |
| server_info | 4 | 4 | 4 | 4 | 5 | 5 | 4.2 | A |
| session_close | 5 | 5 | 5 | 3 | 5 | 4 | 4.6 | A |
| session_list | 5 | 4 | 4 | 4 | 5 | 4 | 4.4 | A |
| tags_create | 5 | 3 | 5 | 4 | 4 | 4 | 4 | A |
| tags_delete | 5 | 4 | 5 | 3 | 5 | 4 | 4.4 | A |
| tags_list | 5 | 3 | 4 | 4 | 5 | 4 | 4.2 | A |
| tags_update | 5 | 4 | 5 | 4 | 4 | 4 | 4.6 | A |
| transactions_aggregate | 5 | 4 | 5 | 4 | 4 | 4 | 4.5 | A |
| transactions_create | 4 | 2 | 2 | 3 | 4 | 2 | 2.9 | C |
| transactions_delete | 5 | 4 | 5 | 3 | 4 | 4 | 4.3 | A |
| transactions_filter | 4 | 3 | 3 | 3 | 4 | 3 | 3.4 | B |
| transactions_get | 4 | 3 | 4 | 3 | 4 | 4 | 3.7 | A |
| transactions_import | 5 | 4 | 4 | 3 | 4 | 3 | 4 | A |
| transactions_merge | 5 | 5 | 5 | 4 | 4 | 5 | 4.7 | A |
| transactions_search_by_amount | 5 | 4 | 3 | 4 | 4 | 3 | 4 | A |
| transactions_search_by_category | 4 | 3 | 3 | 3 | 4 | 3 | 3.4 | B |
| transactions_search_by_month | 4 | 3 | 3 | 3 | 4 | 3 | 3.4 | B |
| transactions_search_by_payee | 4 | 3 | 3 | 3 | 4 | 3 | 3.4 | B |
| transactions_summary_by_category | 5 | 4 | 4 | 3 | 4 | 4 | 4.1 | A |
| transactions_summary_by_payee | 4 | 3 | 4 | 3 | 4 | 4 | 3.7 | A |
| transactions_uncategorized | 5 | 4 | 5 | 4 | 4 | 5 | 4.6 | A |
| transactions_update | 4 | 3 | 4 | 4 | 4 | 3 | 3.7 | A |
| transactions_update_batch | 5 | 5 | 5 | 4 | 4 | 5 | 4.8 | A |
| transfers_create | 5 | 4 | 5 | 4 | 4 | 3 | 4.3 | A |

## Aggregates

| | Mean | Min (tool) | Description quality | Coherence | Overall | Tier |
| :--- | ---: | :--- | ---: | ---: | ---: | :---: |
| Baseline | 4.1 | 2.9 (transactions_create) | 3.6 | 3 | 3.4 | B |
| After | 4.3 | 3.5 (schedules_get) | 4 | 3 | 3.7 | A |

## Before and after

| Tool | Before | After | After runs | Contradiction flagged |
| :--- | ---: | ---: | :--- | :---: |
| transactions_create | 2.9 | 4.8 | 4.8, 4.8, 4.8 | no |
| payees_create | 3 | 4.3 | 4.3, 4.3, 4.4 | no |
| accounts_create | 3.2 | 4.5 | 4.3, 4.5, 4.6 | no |
| accounts_update | 3.2 | 4.6 | 4.6, 4.5, 4.8 | no |
| transactions_filter | 3.4 | 4.8 | 4.8, 4.8, 4.8 | no |
| transactions_search_by_category | 3.4 | 4.8 | 4.8, 4.8, 4.6 | no |
| transactions_search_by_month | 3.4 | 4.8 | 4.8, 4.8, 4.6 | no |
| transactions_search_by_payee | 3.4 | 4.8 | 4.8, 4.8, 4.6 | no |
| categories_update | 3.5 | 4.5 | 4.6, 4.5, 4.5 | no |
| rules_get | 3.5 | 4.5 | 4.5, 4.5, 4.8 | no |

## Coherence medians

| | Disambiguation | Naming | Tool count | Completeness | Score | Run scores |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| Baseline | 2 | 3 | 2 | 4 | 3 | 3.3, 2.5, 3 |
| After (1 run) | 3 | 3 | 2 | 5 | 3.3 | 3.3 |

## Compact surface (#679)

The 15-tool compact surface (`MCP_TOOL_SURFACE=compact`, #671 to #678) scored with the same harness, captured with `capture . compact.json --surface compact`. Every score and coherence run went into a new directory, as the harness stamp requires.

| | |
| :--- | :--- |
| Date | 2026-11-13 |
| Scorer | `opencode/deepseek-v4.1-flash-free` through the opencode CLI, the same pin as the 85-tool baseline above, so the comparison is like for like on the scorer. The tool sets differ (15 compact tools against 85 legacy tools), so per-tool figures describe different descriptions |
| Runs | 3 per tool and 3 coherence runs, before and after tuning; no run stalled, and one batch answer (`run3-batch01`, after) was unparseable once and parsed on the harness retry |
| Measured | develop `46986920` plus the tuning below |
| Tuning rounds used | 1 of at most 3, then stopped (see Gaps) |
| Raw output | `docs/audit/tdqs-raw/compact-before/` (first scoring) and `docs/audit/tdqs-raw/compact-after/` (after tuning); each holds the captured `tools.json` and the `report` output as `report.json` |

### Result

| | Mean | Min (tool) | Description quality | Disambiguation | Naming | Tool count | Completeness | Coherence (run scores) | Overall |
| :--- | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 85 tools, baseline | 4.1 | 2.9 (transactions_create) | 3.6 | 2 | 3 | 2 | 4 | 3 (3.3, 2.5, 3) | 3.4 |
| 85 tools, after #640 | 4.3 | 3.5 (schedules_get) | 4 | 3 | 3 | 2 | 5 | 3.3 (1 run) | 3.7 |
| 15 tools, before tuning | 4.7 | 4.5 (list_budget_months) | 4.6 | 4 | 5 | 5 | 4 | 4.8 (4.8, 4.5, 4.8) | 4.7 |
| 15 tools, after tuning | 4.7 | 4.5 (search_transactions, summarize_transactions, list_budget_months) | 4.6 | 4 | 5 | 5 | 4 | 4.5 (5, 4.3, 4.5) | 4.6 |

The 85-tool "after" row uses the baseline coherence median for its overall, as the Aggregates table above does. Every compact tool is at least 4.5, so the minimum target (4.0) is met; the weakest single dimension is `list_budget_months` parameter semantics at 3 in every run. No compact tool had an annotation contradiction flagged in any run.

### Per-tool scores after tuning

| Tool | Purpose | Guidelines | Transparency | Params | Concise | Complete | TDQS | Before | Runs |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| get_context | 5 | 5 | 4 | 4 | 4 | 5 | 4.6 | 4.6 | 4.5, 4.8, 4.6 |
| list_budget_months | 5 | 5 | 4 | 3 | 5 | 5 | 4.5 | 4.5 | 4.5, 4.7, 4.5 |
| list_entities | 5 | 5 | 4 | 4 | 4 | 5 | 4.6 | 4.6 | 4.5, 4.8, 4.6 |
| manage_accounts | 5 | 4 | 5 | 4 | 4 | 5 | 4.6 | 4.8 | 4.6, 4.8, 4.6 |
| manage_budget_files | 5 | 5 | 5 | 4 | 4 | 5 | 4.8 | 4.8 | 4.8, 4.8, 4.8 |
| manage_budget_months | 5 | 5 | 5 | 4 | 4 | 5 | 4.8 | 4.8 | 4.7, 4.8, 4.8 |
| manage_categories | 5 | 4 | 5 | 4 | 4 | 5 | 4.6 | 4.8 | 4.5, 4.9, 4.6 |
| manage_payees | 5 | 4 | 5 | 4 | 4 | 5 | 4.6 | 4.8 | 4.5, 4.9, 4.6 |
| manage_rules | 5 | 5 | 5 | 4 | 4 | 5 | 4.8 | 4.9 | 4.7, 4.9, 4.8 |
| manage_schedules | 5 | 5 | 5 | 4 | 4 | 5 | 4.8 | 4.8 | 4.8, 4.8, 4.8 |
| manage_tags | 5 | 5 | 5 | 4 | 5 | 5 | 4.7 | 4.8 | 4.6, 4.7, 4.9 |
| manage_transactions | 5 | 4 | 5 | 4 | 4 | 5 | 4.7 | 4.7 | 4.6, 4.8, 4.7 |
| run_query | 5 | 5 | 5 | 5 | 4 | 5 | 4.9 | 4.9 | 4.9, 4.9, 4.9 |
| search_transactions | 5 | 5 | 4 | 4 | 4 | 4 | 4.5 | 4.6 | 4.5, 4.8, 4.5 |
| summarize_transactions | 5 | 5 | 4 | 4 | 4 | 4 | 4.5 | 4.6 | 4.5, 4.6, 4.5 |

### Tuning round 1

The first scoring left coherence at 4 on Disambiguation and Completeness. Two of the three Disambiguation justifications named the same overlap: `set_note` is offered by `manage_accounts`, `manage_categories` and `manage_payees`, and `manage_accounts` accepts any entity UUID. Round 1 reworded the three `set_note` sentences (description text only, 319 bytes added in total, no field, action or behaviour changed): each now says which tool sets the note of which entity kind. The re-score did not move the medians: Disambiguation 5, 4, 4 and Completeness 5, 4, 4 across the three runs, against 4, 4, 5 and 5, 4, 4 before. The per-tool scores moved by at most 0.2 either way, which is the scorer's own run-to-run spread (single runs differ by up to 0.4). The total of the 15 entries grew from 40,681 to 41,000 bytes and `COMPACT_TOTAL_CEILING` rose by the same 319 bytes, to 45,119.

### Gaps (not met, with the reason)

- **Coherence is 4, not 5, on Disambiguation and Completeness** (median of 3, both before and after tuning). Disambiguation: the justifications cite the read overlap among `get_context`, `list_entities`, `run_query`, `search_transactions`, `summarize_transactions` and `list_budget_months`, which the descriptions already bound by naming the sibling to use instead; the run-to-run result is 4, 4, 5 (before) and 5, 4, 4 (after), so one more rewording cannot be told from noise. Completeness: the cited gaps are not description defects but missing operations: creating or deleting budget files, assigning a tag to a transaction, merging categories, transaction attachments. Closing them needs new actions, which this ticket does not allow, and no description sentence can state an operation that does not exist. Tuning stopped after one round because the two remaining dimensions are either scorer noise or outside what a description edit may change.
- **Minimum TDQS is met (4.5)**; the weakest dimension in the set is `list_budget_months` parameter semantics (3 in every run, one parameter, `month`, already described in the schema).
- **Not comparable with a Glama-hosted score**, as stated in Deviations above. Coherence run scores vary by 0.7 across three runs, so a one-run coherence figure is not a reliable difference.

## Glama's own scores for the compact surface (v0.30.0)

Read from Glama's admin score pages on 2026-11-14, after Glama built and scored release 0.30.0 (main `1cce9f7b`, compact default, 15 public tools). This is Glama's scorer, not the local DeepSeek harness, so these figures are the measurement the local estimates above were standing in for.

| | v0.29.0 (85 legacy tools) | v0.30.0 (15 compact tools) |
| :--- | ---: | ---: |
| Server coherence grade | B | A |
| Disambiguation | 2 | 5 |
| Naming consistency | 4 | 5 |
| Tool count | 2 | 5 |
| Completeness | 5 | 4 |
| TDQS average | 4.3 | 4.8 |
| TDQS lowest tool | 3.3 | 4.4 |
| Tools scored | 85 of 85 | 15 of 15 |

Per tool (v0.30.0):

| Tool | Glama TDQS |
| :--- | ---: |
| `manage_rules` | 5.0 |
| `manage_accounts` | 4.9 |
| `manage_payees` | 4.9 |
| `manage_transactions` | 4.9 |
| `run_query` | 4.9 |
| `search_transactions` | 4.9 |
| `manage_budget_months` | 4.8 |
| `manage_schedules` | 4.8 |
| `manage_tags` | 4.8 |
| `get_context` | 4.7 |
| `manage_categories` | 4.7 |
| `list_entities` | 4.6 |
| `summarize_transactions` | 4.6 |
| `list_budget_months` | 4.4 |
| `manage_budget_files` | 4.4 |

**What is left.** Completeness is the only coherence dimension below 5. Glama's stated reason: tags can be created and deleted, but no tool assigns a tag to a transaction (the transaction fields omit tags), and notes can be set per entity but not listed or deleted on their own; it adds that `run_query` and the entity tools are a workaround for both. Both are missing operations, not description defects, which matches the local Completeness gap recorded above. On TDQS the two lowest tools are `list_budget_months` and `manage_budget_files` at 4.4; because the worst tool carries 40% of description quality, they are the next rewrite targets.

**Local estimate against Glama.** The local DeepSeek harness put the compact surface at 4.6 with a 4.5 minimum and coherence 4 on Disambiguation; Glama scored 4.8, 4.4 and 5. The weakest dimension in the local set was `list_budget_months` parameter semantics, and that tool is also at the bottom of Glama's list.
