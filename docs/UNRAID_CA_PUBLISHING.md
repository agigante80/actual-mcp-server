# Publishing actual-mcp-server to Unraid Community Applications

How this repo is set up for the Unraid Community Applications (CA) catalog, and the
human steps to submit. The generic, step-by-step process lives in the sibling project's
canonical guide:
https://github.com/agigante80/Actual-sync/blob/main/docs/UNRAID_CA_PUBLISHING.md

## What CA does

The CA scanner reads a maintainer profile plus one container template XML from a public
GitHub repo's DEFAULT branch (`main`) over raw URLs, validates well-formedness, and lists
the container so Unraid users can install it with the standard appdata volume mounts.

## Files in this repo (#227)

| File | Role |
|------|------|
| `ca_profile.xml` (repo root) | The `<CommunityApplications>` maintainer profile. |
| `unraid/actual-mcp-server.xml` | The CA container template (image, port 3600, env-var config, PUID/PGID, Data/Logs mounts). |
| `unraid/actual-mcp-icon-512.png` | The 512px icon the template `<Icon>` references. |
| `.github/workflows/unraid-xmllint.yml` | CI gate: `xmllint` well-formedness on the templates, plus a negative check on `tests/fixtures/invalid-unraid.xml`. |
| `docker/entrypoint.sh` + `Dockerfile` | The PUID/PGID privilege-drop that lets the container write the 99:100 appdata mount (the folder-rights fix). |

The `<TemplateURL>` and `<Icon>` in the template are raw URLs pinned to `main`. The
`unraid_template_alignment` unit guard keeps the template port/data-dir/image and the
masked-secret posture from drifting.

## Delivery order (important)

The CA scanner and the raw `<TemplateURL>`/`<Icon>` URLs read the GitHub DEFAULT branch
`main`. This repo is develop-first, so:

1. Land the CA files on `develop` (this ticket).
2. Ship them to `main` via the normal develop-to-main release (the `release` skill).
   Only then are the raw `main` URLs live and the repo scannable.
3. THEN do the human submission below. A develop-only merge is not scannable.

## Human submission steps (authenticated; a maintainer does this once)

1. Confirm the files are on `main` and the raw `<TemplateURL>`/`<Icon>` URLs return 200.
2. Go to https://ca.unraid.net/submit and sign in with the Unraid forum account.
3. Point it at this repo, run Validate and Scan, fix anything flagged, push, re-scan, preview.
4. Submit. Moderation follows. Do NOT use the retired selfhosters request repo.

## Operator security note (baked into the template `<Description>`)

A blank `MCP_SSE_AUTHORIZATION` disables ALL HTTP authentication: the server is then
reachable unauthenticated on the LAN. The template requires the token and masks it, and the
Description tells the operator to set a strong token (`openssl rand -hex 32`) and to use
`MCP_ENABLE_HTTPS` or a reverse proxy for any non-loopback exposure (the bearer token is
plaintext over HTTP). Making HTTP auth required-by-default is tracked as a follow-up.
