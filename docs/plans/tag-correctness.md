# Plan: Tag correctness

## Goal

Make the tag tools match what a tag is in Actual: the `#word` written in a transaction's notes, with the tags table holding only its colour and description. A live review on 2026-11-21 (develop `1db5b599`, `@actual-app/api` 26.11.0) found that the tools work but accept names that can never match a note, wipe metadata on a repeated create, leak a raw upstream error on a duplicate rename, and never tell the model how a transaction gets a tag. Fix those, in order, and say the truth in the descriptions.

## Done looks like

- #699: `create` and `update` refuse a tag name containing `#` or whitespace and a colour that is not a hex colour, on both surfaces, before any upstream call. Existing bad rows can still be renamed and deleted.
- #700: `create` on an existing name keeps the colour and description the caller did not send.
- #701: renaming onto an existing name returns a typed conflict refusal that names the tag, never `SyncError: invalid-schema`.
- #702: the tag descriptions (`manage_tags`, `list_entities`, the legacy `actual_tags_*`, and the notes field of `manage_transactions` where bytes allow) say that a tag is the `#word` in notes, that rename does not rewrite notes, and that the list is tag metadata, not the set of tags in use. An E2E row tags a transaction through its notes and finds it again.
- #703: `hasTags` and `hasAnyTag` are accepted on a rule's `notes` condition if the API takes them, with the probed value format recorded; otherwise the ticket is closed as not planned with the evidence.
- Every ticket is one commit with a patch bump on `develop`. Every size ceiling stays green. The phase ends with a green Docker E2E full run and `bash scripts/deploy-and-test.sh full` green over HTTP and stdio with zero residue, then a release to `main`, then a check that Glama built the release.
- Glama: the local TDQS harness is run before and after #702 on every tool whose description changed, no tool drops, and after the release the Glama listing is read tool by tool (not only the headline): `manage_tags` and `list_entities` scores, and the Coherence dimensions, are recorded in the phase outcome.

## Fails if

Premortem: the phase is over and it failed badly. What happened?

- The name validation of #699 was also applied on delete or on the `id` path, so a budget that already holds a `two words` tag could no longer remove it.
- The colour rule was guessed. The Actual UI writes a format we refuse (a named colour, an 8 digit hex), so a tag created in the UI could not be updated through us. Check what the UI stores first.
- #700 read the tag list outside the write cycle, so two creates raced, or nested an adapter session and stalled 30 seconds (the never-nest rule).
- #700 turned a create on a tombstoned name into a revival of the old colour, surprising a user who deleted that tag.
- #701 matched the upstream message text instead of checking the list first, or refused a rename of a tag onto its own name.
- #702 made the descriptions longer to please the scorer and broke the 3,900 byte per-tool ceiling or the legacy list ceiling, or the ceiling was raised to make room.
- #702 promised behaviour we do not implement (that rename updates notes, that the list shows tags in use), which is the invention this phase exists to remove.
- The Glama check was the headline number only. A per-tool score dropped (`manage_tags` got longer and vaguer) and nobody read it, or Glama never built the release and the listing still showed the old text.
- #703 was implemented from the upstream source alone and the API refuses the operator, or accepts it with a value format we documented wrongly.
- A new test left a tag or a tagged transaction behind and the zero-residue gate went red on the release run.

## Expected work

Not binding. In order:

1. #699 name and colour validation.
2. #700 non-destructive create.
3. #701 typed refusal on a duplicate rename.
4. #702 descriptions and the tagging E2E, with TDQS before and after.
5. #703 rule operators (independent; after #702).
6. Full runs, release, Glama review.

## Out of scope

- #704 to #708 (API 26.12.0, the `manage_tags` merge, dashboards): Backlog until upstream publishes 26.12.0.
- Rewriting notes on a tag rename, and listing the tags actually used in notes: the API offers neither, and we do not build what the API does not offer.
- New lows from reviews of this phase go to Backlog only if a user could hit them; otherwise they are fixed in the round or dropped.
