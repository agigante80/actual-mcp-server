#!/bin/sh
# #600 test stub, installed as `docker`, `npx` and `curl` by tests/unit/install_snippets.test.js.
# Appends one record per call to $STUB_LOG: the command name and every argument, each
# terminated by a NUL, then a newline. It never runs anything and always exits 0.
{
  printf '%s\0' "${0##*/}" "$@"
  printf '\n'
} >> "$STUB_LOG"
exit 0
