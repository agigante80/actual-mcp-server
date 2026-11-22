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

## Short-line layout for four compact descriptions (#683)

Glama gave the four lowest compact tools Conciseness 4 with the same reason each time: one dense paragraph of semicolon-chained clauses. #683 lays each description out as short lines separated by a newline: the first line holds purpose and sibling tools, then one line per action, type or report starting with its name and a colon, and the last line is the `Returns` sentence. No fact was removed except the restated "Read-only" in `summarize_transactions` (its annotation carries it). `summarize_transactions` also gained three facts checked against the handlers: the default range of `by_category` and `by_payee` (first day of the current month to today), the `by_payee` `limit` default of 50 ordered by total, and `exclude_transfers` default true, named only on the `grouped` line. `tests/unit/compact_description_layout.test.js` guards the layout.

Bytes are the UTF-8 length of the description and the size of the `tools/list` entry (`Buffer.byteLength(JSON.stringify(entry))`, a newline costing 2 bytes):

| Tool | Description before | Description after | Entry before | Entry after | Glama TDQS before | Conciseness before |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `list_budget_months` | 782 | 787 | 1,238 | 1,246 | 4.4 | 4 |
| `manage_budget_files` | 1,332 | 1,342 | 2,512 | 2,527 | 4.4 | 4 |
| `list_entities` | 1,256 | 1,230 | 3,711 | 3,694 | 4.6 | 4 |
| `summarize_transactions` | 1,172 | 1,270 | 3,699 | 3,805 | 4.6 | 4 |

The 15 compact entries went from 41,000 to 41,112 bytes (112 more, under the ticket's 400 cap and the unchanged `COMPACT_TOTAL_CEILING` of 45,119). Most of the growth is the three `summarize_transactions` facts.

**After scores.** Read from Glama's admin TDQS page on 2026-11-18, after Glama built and scored release 0.30.1 (main `2b2d87c9`, 15 of 15 tools). `manage_budget_files` also carries the #684 change, so its row measures both tickets together.

| Tool | TDQS before | TDQS after | Behavior | Conciseness | Completeness | Parameters | Purpose | Usage |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `list_budget_months` | 4.4 | 4.7 | 4 | 5 | 5 | 4 | 5 | 5 |
| `manage_budget_files` | 4.4 | 4.9 | 5 | 4 | 5 | 5 | 5 | 5 |
| `list_entities` | 4.6 | 4.6 | 4 | 4 | 5 | 4 | 5 | 5 |
| `summarize_transactions` | 4.6 | 4.9 | 5 | 4 | 5 | 5 | 5 | 5 |

Conciseness moved on one tool of four (`list_budget_months`, 4 to 5). The other three stayed at 4, now with different reasons: `list_entities` for per-type prose that repeats schema constraints, `manage_budget_files` for the "import is DESTRUCTIVE" framing that repeats the annotation, and `summarize_transactions` for restated defaults and a "dense run-on formatting" that the reviewer still finds harder to scan than a list, although the description is now one line per report. So the layout was not the whole of what Glama penalised, as the known risk below said. The TDQS gains on `list_budget_months` and `summarize_transactions` come from other dimensions as much as from layout, and a single scorer run varies by up to 0.4, so they are not attributed to the layout alone.

Server level: TDQS average 4.8 (unchanged at one decimal; the mean of the per-tool figures went from 4.75 to 4.83), lowest tool 4.4 to 4.6 (`list_entities`). Coherence is unchanged: A, with Disambiguation 5, Naming 5, Tool count 5, Completeness 4. Glama's Completeness reason changed: it now names the missing tool to delete an uploaded budget file (the #684 description states that nothing removes it) and no direct read of one transaction by id outside `run_query`. By the published formula (0.7 times description quality, itself 0.6 mean plus 0.4 minimum, plus 0.3 times coherence) the overall works out at about 4.74, from about 4.65; Glama shows only the letter grades, so those two figures are computed here, not read.

**Known risk.** Layout may not be what Glama penalised: `manage_rules` is also one paragraph (1,419 bytes, no line breaks) and scored Conciseness 5, and single runs of this kind of scorer differ by up to 0.4. The increment is done when the rewrite ships and the scores are recorded, whichever way they move.

## Behaviour disclosure for manage_budget_files (#684)

Glama scored `manage_budget_files` Behavior 3 (TDQS 4.4, tied lowest) on v0.30.0. The reviewer named no missing fact; its reason was that the headline safety traits repeat the annotations. #684 adds the behaviour facts the annotations cannot carry, each re-read in the code on develop `2ee2720d` before it was written, and drops the bare "Writes." that only restated `readOnlyHint: false`. Every existing fact and capitalised warning token stays. `missingBehaviourFacts` in `tests/unit/compact_manage_budget_files.test.js` (one regular expression per fact) was red on the #683 description with all six facts missing and returns `[]` after; the same file checks the switch line keeps "unconfigured or not permitted" as one case (#570) and that the description matches no configured value or path scope.

| | Description bytes | Entry bytes | Compact total |
| :--- | ---: | ---: | ---: |
| Before (#683 layout) | 1,342 | 2,527 | 41,112 |
| After | 1,785 | 2,971 | 41,556 |

Net growth is 443 bytes of description and 444 of entry (cap 500); `COMPACT_TOTAL_CEILING` (45,119) and the per-tool ceiling (3,900) are unchanged.

**Facts shipped, and what proved each one:**

1. Import reversibility ("Nothing removes the uploaded server file"). Rests on an absence: `grep` over `src/` finds no `unlink`, `rm` or `delete-budget` call, and no tool fronts upstream `deleteBudget`. The first draft also said the import replaced a local copy that only a re-import could restore. The review dropped that: in the installed `@actual-app/api` 26.11.0 `importActual` passes no local id and `importBuffer` then takes a fresh one (`node_modules/@actual-app/api/dist/index.js` 130355 and 62451), so re-importing an export only adds another server file. The older "REPLACES" wording on the line above it predates this ticket, rests on the same premise and is tracked in #687. **Resolved in #687:** a live run confirmed the import adds a copy and replaces nothing, and that wording was removed from every text.
2. Switch and export reversibility ("undo it by switching back"; "only deleting the file on the server host removes it"). A switch only rewrites the session slot and preference (`src/lib/actual-adapter.ts` 4886 to 4911 and 4936 to 4938), so a second switch reverses it. The export is a plain `writeFile` (`src/tools/budgets_export.ts` 102), and the same absence check as fact 1 shows no tool removes it.
3. Switch load ("a load failure can surface on the next call instead"). Same server: the reload is awaited, so it fails the switch (`src/lib/actual-adapter.ts` 4900). Different server: a failed pool load is only logged (4964 to 4976). stdio: no load at switch time (4956 to 4960); the next operation's precondition loads it (287 to 304).
4. Export contents ("the whole active budget (every account and transaction)"). Upstream `exportBuffer` zips the budget's entire `db.sqlite` plus `metadata.json` (`node_modules/@actual-app/api/dist/index.js` 62394 to 62425, v26.11.0); `src/tools/budgets_export.ts` 14 states the same.
5. Limits ("max 4096 characters", "max 67108864 characters", "a long import can time out"). `src/compact/tools/manage_budget_files.ts` 33 and 41 (base64 and path caps); the import runs under its own bound (`src/lib/actual-adapter.ts` 5309). The bound's value is not published.
6. After an import ("success or failure, the next call from every session (this one included) reloads that session's own configured budget, so later calls do not reach the imported budget"). Before the import every pool entry is set to `imported:pending` (`src/lib/actual-adapter.ts` 5291); on success `importBudgetTracked` records an `imported:` sentinel no configured sync id can equal (`src/lib/budgetLoader.ts` 461 to 480), and on failure `trackBudgetMutation` marks the api uninitialised (418). Either way the per-operation precondition re-selects the session's own budget (`src/lib/actual-adapter.ts` 280 to 310, called at 736, 806 and 960). The ticket asked for the failed case only; the review showed the conditional wording told a model that a successful import leaves later calls on the imported budget, so follow-up writes would land in the configured budget unnoticed. The old clause "so this session's active budget changes to one outside the configured list" was replaced by "only while importing" for the same reason.

**Not published**, per the ticket: the import timeout value, the export directory, the fact that `path` is not restricted to a directory, any typed-refusal wording, and the upstream behaviours not checkable here (in-flight calls during a switch, encryption of an export, partial replacement on a failed import).

**After scores.** Read from Glama's admin TDQS page on 2026-11-18 for release 0.30.1: Behavior 3 to 5, TDQS 4.4 to 4.9 (Conciseness 4, every other dimension 5). The reviewer's Behavior reason cites the facts this ticket added: the upload becomes a new server file that nothing removes, the reload after an import applies to every session, a load failure can surface on the next call, and the timeout risk. It also cites "REPLACES that budget's local copy", the older import wording that #687 holds to be false; if #687 confirms that and the wording is corrected, this score was partly earned by a wrong sentence and should be read again.

## Scores after the corrected import wording and the by_payee fix (v0.30.3)

Read from Glama's admin TDQS page on 2026-11-18, after Glama built and scored release 0.30.3 (main `216bc481`, 15 of 15 tools). Glama never built 0.30.2, so this one build measures both description changes since 0.30.1: #687 in `manage_budget_files` (an import ADDS a budget, it does not replace one) and #685 with #686 in `summarize_transactions` (the `by_payee` line now states the order and what `limit` keeps).

| Tool | TDQS v0.30.1 | TDQS v0.30.3 | Behavior | Conciseness | Completeness | Parameters | Purpose | Usage |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `manage_budget_files` | 4.9 | 4.8 | 5 | 4 | 5 | 4 | 5 | 5 |
| `summarize_transactions` | 4.9 | 4.9 | 5 | 4 | 5 | 5 | 5 | 5 |

`manage_budget_files` answers the question the #684 note left open. Behavior stays 5 with the false "REPLACES" sentence gone: the reviewer now cites "imports ADD a new local/server copy rather than replacing" among the disclosed side effects, so the score was not resting on the wrong sentence. The 0.1 drop comes from Parameters, 5 to 4, with the reason that the description "mostly reinforces rather than extends the schema" (schema coverage 83%). The #687 change did not touch the parameter text, so this is within the run-to-run spread of the scorer (up to 0.4, see the known risk above) and not a regression to chase.

`summarize_transactions` is unchanged on every dimension. Conciseness stays 4 for the same reason as before: the per-report block is dense and hard to scan.

Server level: TDQS average 4.8 over 15 tools, lowest tool `list_entities` at 4.6, both unchanged. The other 13 tools kept their 0.30.1 ratings because unchanged definitions share the same evaluation.

## Scores after the Tag correctness phase (v0.33.0)

Read from Glama's admin score and TDQS pages on 2026-11-21, after Glama built and scored release 0.33.0 (main `bfc74fa3`, 15 of 15 tools). The phase (#699 to #703) changed the text of five tools: every one now says that a tag is the `#word` inside a transaction's notes, and `manage_rules` documents the `hasTags` and `hasAnyTag` operators. The other ten definitions are unchanged and kept their earlier evaluation.

**Server level.**

| Measure | v0.32.0 | v0.33.0 |
| :--- | ---: | ---: |
| Coherence: Disambiguation | 4 | 5 |
| Coherence: Naming | 5 | 5 |
| Coherence: Tool Count | 5 | 5 |
| Coherence: Completeness | 4 | 5 |
| TDQS average (as Glama shows it) | 4.8 | 4.8 |
| TDQS per-tool mean | 4.82 | 4.77 |
| TDQS lowest tool | 4.6 | 4.5 |
| Discovery | 92% | 92% |

Completeness reached 5 without a new operation. At v0.32.0 the reason for the 4 was "tags can be defined but no visible way to attach or remove tags on individual transactions". The operation always existed (write the `#word` into the notes); the texts did not say so. The v0.33.0 reason lists tags among the full-lifecycle entities and calls the one omission it names (deleting an uploaded budget file) "intentional or server-limited rather than agent-blocking". Disambiguation is back to 5: the overlaps the v0.32.0 run cited (`get_context` against `list_entities`, `search_transactions` against `run_query`) are now described as "called out and resolved in the descriptions". None of those four descriptions changed their routing sentences in this phase, so this move is scorer spread, not an effect of the change.

**The five changed tools.**

| Tool | TDQS v0.32.0 | TDQS v0.33.0 | Behavior | Conciseness | Completeness | Parameters | Purpose | Usage |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `search_transactions` | 4.9 | 4.5 | 3 | 4 | 5 | 5 | 5 | 5 |
| `manage_tags` | 4.8 | 4.6 | 4 | 4 | 5 | 4 | 5 | 5 |
| `manage_transactions` | 4.9 | 4.7 | 4 | 4 | 5 | 5 | 5 | 5 |
| `list_entities` | 4.6 | 4.8 | 5 | 4 | 5 | 4 | 5 | 5 |
| `manage_rules` | 5.0 | 4.9 | 5 | 4 | 5 | 5 | 5 | 5 |

Glama's reasons for every score below 5:

- `search_transactions` Behavior 3: the reviewer lists the disclosed behaviours as "valuable" (off-budget accounts excluded from `filter`, an unknown name returns an error field, the return shape varies by mode) and takes the points for placement: they are "compressed into the same dense block as the parameter lists rather than called out as distinct behaviors". No missing fact is named.
- `manage_tags` Behavior 4 and `manage_transactions` Behavior 4: no statement of authentication or permission requirements or of rate limits; for `manage_tags` also whether a soft-deleted tag can be recovered other than by recreating it. `manage_tags` Parameters 4 comes with praise only (80% schema coverage is the stated baseline).
- `list_entities` Parameters 4: the description "largely restates what the schema already says" (92% coverage).
- Conciseness 4 on all five, and on every other tool except `list_budget_months`: one dense block, hard to scan per action or per mode; `list_entities`, `get_context` and `run_query` are also told that their "Read-only" sentence repeats the annotation.

**Reading.** The three drops are on tools whose text grew by a tag sentence, and in each case the reason is the density of the block, not the new sentence. The `search_transactions` move from 4.9 to 4.5 is the full 0.4 single-run spread recorded above, on a description whose behaviour facts did not change. Under Glama's published weighting the description-quality term went from about 4.73 to 4.66 and the coherence term from 4.5 to 5.0, so the server total rose (about 4.66 to 4.76).

**What the scores leave open.** Two things recur across all 15 tools and are the only route to more points: per-action or per-mode line layout (the #683 layout change moved Conciseness on one of four tools, so the evidence that layout pays is weak), and removing the "Read-only" sentence where the annotation already says it. Authentication and rate-limit statements are asked for on two write tools; the server has no per-tool permission model and no rate limit of its own, so there is no true sentence to add beyond what the server instructions already say. No ticket was filed from these scores.

## Scores after the search_transactions layout and the rule operator text (v0.34.2)

Read from Glama's admin releases and TDQS pages on 2026-11-22, after Glama built release 0.34.2 (main `8271d651`, 15 of 15 tools). Since v0.33.0 two compact descriptions changed: `search_transactions` (#712: one line per mode plus a Behavior line) and `manage_rules` (#711: the operator sentence now lists every operator each condition field takes). The server-level Coherence scores were not re-read.

| Measure | v0.33.0 | v0.34.2 |
| :--- | ---: | ---: |
| TDQS average | 4.8 | 4.7 |
| TDQS lowest tool | 4.5 (`search_transactions`) | 4.2 (`manage_rules`) |

| Tool | TDQS v0.33.0 | TDQS v0.34.2 | Behavior | Conciseness | Completeness | Parameters | Purpose | Usage |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `search_transactions` | 4.5 | 4.6 | 4 | 4 | 5 | 4 | 5 | 5 |
| `manage_rules` | 4.9 | 4.2 | 3 | 4 | 5 | 3 | 5 | 5 |

The other 13 tools, lowest first: `manage_tags` 4.6; `get_context`, `list_budget_months`, `manage_categories`, `manage_transactions` 4.7; `list_entities`, `manage_budget_files`, `manage_budget_months`, `manage_schedules` 4.8; `manage_accounts`, `manage_payees`, `run_query`, `summarize_transactions` 4.9.

Glama's reasons for every score below 5 on the two changed tools:

- `search_transactions` Behavior 4 (was 3): the behaviours are now credited (off-budget inclusion per mode, the two default limits, paging, the amount scan guard, the error field for an unknown name, refused fields named). The missing point is for result ordering and an example call.
- `search_transactions` Conciseness 4: the layout is praised ("compact one-line-per-mode entries with no filler prose"); the only waste named is the amount and date format line, which repeats the schema.
- `search_transactions` Parameters 4 (was 5): the mode-to-field mapping is credited; the same cents and `YYYY-MM-DD` lines are said to restate the schema (94% coverage).
- `manage_rules` Behavior 3 (was 5): the reviewer lists the same disclosures as before (nothing written when ids are invalid, no rollback in `create_batch`, delete cannot be undone, schedule-owned rules refused) and then scores them as "additive-but-not-load-bearing" because the annotations carry the safety signal. The behaviour text did not change between the two releases.
- `manage_rules` Conciseness 4: the operator section is "a dense run-on that a reader must parse field by field"; a bulleted structure is suggested.
- `manage_rules` Parameters 3 (was 5): 86% schema coverage is called the baseline, and the operator mapping is described as real meaning the schema lacks, yet the score is 3.

**Reading.** #712 did what it set out to do: Behavior on `search_transactions` went from 3 to 4 and the layout drew praise. The total moved only 0.1 because Parameters fell a point in the same run. The `manage_rules` drop of 0.7 is larger than the 0.4 single-run spread recorded above. Two of its three reasons contradict the score they come with (Behavior on unchanged text, Parameters with praise only), so part of the drop is scorer variance; the one concrete complaint is the density of the longer operator sentence, which #711 made longer on purpose so that the description matches what the server accepts.

**What the scores leave open.** Three text changes are named by the reviewer: lay the `manage_rules` operator section out as one line per field group (the layout that just worked on `search_transactions`), drop the cents and date format line from `search_transactions` where the schema already says it, and state the result ordering of `search_transactions`. None is filed as a ticket: description tickets are not chained from Glama scores without the maintainer's decision.

The "Read-only" sentence removal (#713) is on `develop` and is not in this release, so it is not reflected in these scores.

## Layout of the remaining one-line descriptions: rescoped (2026-11-22, #714)

#714 was written to lay out all ten one-line compact descriptions. The readings above do not support that: layout moved Conciseness on one of four tools in #683 and on none in #712, and one unchanged description moved 0.7 between two readings. The ticket was rescoped to `manage_rules` alone, the one description whose operator section a reviewer called a run-on, and the other nine stay one line by decision.

`manage_rules` is now 14 lines (longest 216 characters) with one line per condition field group and one per action. The text is unchanged: with newlines replaced by spaces it equals the previous description character for character. Published size: compact 42,809 to 42,823 bytes.

Reopen the ten-tool question only if a later reading shows Conciseness rising on the laid-out tools by more than the 0.4 scorer noise.
