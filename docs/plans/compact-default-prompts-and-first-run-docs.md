# Plan: Compact default, prompts and first-run docs

## Goal

Make the 15-tool compact surface what a new installation gets, so the public tool list is the one Glama scores and the one the docs describe. Then add MCP prompts that name those tools, and rewrite the README opening, install path and capabilities section around them. The default flip is a breaking change for a client that calls `actual_*` names; `MCP_TOOL_SURFACE=legacy` keeps the old list selectable, and removing it is a later decision (#682).

## Done looks like

- #681, then #680 in the same release: the E2E, integration and manual-prompt suites run against compact names, the legacy surface keeps one smoke row per family, and `MCP_TOOL_SURFACE` defaults to `compact`. Released as a minor bump with a BREAKING section in the release notes.
- #660: the server declares the `prompts` capability on HTTP and stdio, with a registry that offers a prompt only when every tool it names is published.
- #661 to #665: five prompts (`monthly_review`, `spending_check`, `spending_patterns`, `budget_cleanup`, `categorize_uncategorized`), each with unit tests and a Docker E2E row, each naming only tools and fields that exist in the shipped compact schemas.
- #666 to #669: the README opens with what the server is for, has one install path that works when pasted and a "Verify your setup" step, lists the 15 tools and the prompts from the registry, and a migration guide maps every `actual_*` name to its compact call.
- Every release in the phase has a green Docker E2E full run and a green full dual-transport run with zero residue on its HEAD.

## Fails if

Premortem: the phase is over and it failed badly. What happened?

- The default flipped and an existing deployment lost its tools silently: no startup log line, no migration guide, release notes without a BREAKING section.
- The suites were migrated to compact names and the legacy surface, still selectable, lost all coverage and broke unnoticed.
- A prompt named a tool, selector value or field that does not exist, or one hidden by `MCP_READ_ONLY` or the surface setting, and a model followed it into a refusal.
- A prompt argument was echoed into the prompt text unvalidated and became an injection path into the model's instructions.
- A prompt told the model to write (categorize, clean up) without asking the user first.
- The README install snippet failed when pasted, as it did before the Docs and README restructure phase.
- Hand-typed tool or prompt tables drifted from the registry within one release.
- The 16th compact tool arrived "just this once" and Tool Count dropped below 5 again.

## Expected work

Not binding. In order:

1. #660 the prompts capability (no prompt shipped yet).
2. #681 with #680, released together as v0.30.0.
3. #661 to #665, one prompt per commit.
4. #666 to #669, the README and the migration guide.

## Out of scope

- Removing the legacy surface (#682) and the camelCase aliases (#657).
- The Glama score itself: a rebuild is triggered by the maintainer in the Glama admin page.
- New tools or new compact actions.
