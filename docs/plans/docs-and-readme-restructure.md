# Plan: Docs and README restructure

## Goal

A newcomer can install the server from the README without hitting a broken command, every fact about tools and configuration has one source that a check keeps true, the docs tree is organised by what the reader wants to do (guides, reference, explanation, development) with one topic or one client per file, and the repository root holds only files that tooling expects there. It splits #599, which was reviewed by Copilot and Codex (gpt-6-astra, ultra) in two bounded rounds before these tickets were filed.

## Done looks like

- Every install path the README and the guides document works when pasted: no comment inside a `docker run` continuation, no `localhost` Actual URL inside a container, a production compose service that pulls a real image, reads `.env` and maps the token, and a dev profile bound to `127.0.0.1`. A snippet argument check (stub `docker`, `npx`, `curl` on PATH) and a CI startup smoke that runs the documented `docker run` and waits for `/health` prove it.
- Tool counts, toolset sizes and the write-tool count are generated from the registry; `docs/reference/tools.md` is generated and checked; no hand-typed count in prose disagrees with the registry, the Unraid XML or `ca_profile.xml`.
- `docs/reference/configuration.md` is the only env inventory; the README env table is gone; `config-drift` checks names and documented defaults against `src/config.ts` and `.env.example`.
- The docs tree is `docs/README.md` (index), `guides/` (with `clients/`, one page per client), `reference/`, `explanation/`, `development/`, plus `roadmap.md`, `plans/` and `audit/` unchanged. Names are lowercase kebab-case. No stubs at old paths.
- `npm run docs:check` runs in CI: offline link and anchor check (lychee, with a negative fixture), the recursive version-marker guard, and the generators' `--check` modes.
- The README is about 200 lines, under 25,000 bytes, has its first install block before line 40, and the Docker Hub description is rendered from it.
- The root drops `docker-compose.test.yaml`, `playwright.config.docker.ts` and `knip.json`, and the `examples/` and `test-data/` directories, and the full dual-transport run passes after the moves.
- `.github/SUPPORT.md` and a Code of Conduct exist, and the PR template is shorter.

## Fails if

Premortem: the phase is over and it failed badly. What happened?

- The README install broke again while CI stayed green, because the snippet check parsed text instead of running the block with stub binaries, or because the startup smoke ran a different command from the one the README shows.
- Docs drifted again within a month because a second authoritative inventory of tools or env vars survived outside `docs/reference/` (contextual examples and hand-written descriptions are fine; a full list is not).
- The link check passed while readers hit 404s: it ran without fragments, its fixture was never shown to fail, or the Docker Hub description still linked a deleted guide (`docker/description/long.md:248` links `MCP_CLIENTS_SETUP.md`, and Docker Hub republishes it on every release tag).
- A ticket left CI red in an intermediate state: the docs index linked pages a later ticket creates, or a file moved before the link check existed.
- A doc moved into a subfolder kept its `**Version:**` marker, which `scripts/version-bump.js` does not reach, so it froze silently. The recursive marker guard must exist before the first move.
- The test stack moved and the full dual-transport run was not repeated, so the next release found the breakage instead.
- A guard was silently disabled by a move: a workflow path filter (`template-lockstep.yml`) stopped matching, or a test kept passing because the file it reads disappeared.
- The restructure grew into rewriting every doc's prose. The work moves, splits and de-duplicates; rewrites are limited to the README and the new client pages.
- A root file moved that tooling expects at root (the default Playwright config, compose, Dockerfile), and editors or contributors lost it.

## Expected work

Not binding. Dependency order:

1. Independent first: install fixes (T1), stale counts and wording (T2), the `docs:check` orchestrator with link check and marker guard (T3), community files (T10).
2. After T3: generated tool reference (T4), single configuration reference (T5), non-client docs tree (T6), lean root (T9).
3. After T6: client guides (T7).
4. After T4, T5 and T7: README as front door and Docker Hub from README (T8).

## Out of scope

- Publishing to the official MCP Registry (T11): a distribution change and a minor release, in Backlog.
- `llms.txt`, a demo GIF, `CHANGELOG.md`, a `.mcpb` bundle.
- Archiving or deleting `docs/plans/` or `docs/audit/`; git history is the archive and phase tooling reads `plans/`.
- `VERSION`, `types/`, `generated/` and `scripts/version-bump.js` (do-not-modify tier).
- Generating `configuration.md` from Zod metadata (a source change to `src/config.ts`).
