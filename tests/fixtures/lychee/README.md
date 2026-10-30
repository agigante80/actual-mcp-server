# Lychee negative fixture

This directory is the deliberately broken negative fixture for the docs:check
links module (#602). The real `npm run docs:check` run excludes it with
`--exclude-path tests/fixtures/lychee`, and `tests/unit/docs_links_fixture.test.js`
copies these files into a temp tree and asserts that every broken link in
`page.md` is reported.

## Real heading

Nothing in this file is broken.
