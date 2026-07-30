#!/usr/bin/env bash
# Contract test for check-template-lockstep.sh.
# Builds fixture template dirs and asserts the guard's exit code:
#   all markers equal            -> 0 (locked)
#   any marker diverges          -> 1 (drift, listed)
#   unmarked template            -> exempt (e.g. contribution.yml)
#   fewer than 2 versioned files -> 0 (nothing to lock)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/check-template-lockstep.sh"

pass=0
fail=0

# mk <dir> <name> <version|->   ("-" writes a template with NO marker)
mk() {
  local d="$1" name="$2" ver="$3"
  if [ "$ver" = "-" ]; then
    printf 'name: %s\nbody: []\n' "$name" > "$d/$name.yml"
  else
    printf 'name: %s\n        <!-- template-version: %s -->\nbody: []\n' "$name" "$ver" > "$d/$name.yml"
  fi
}

# run <desc> <expected-exit> <dir> [canonical-doc]
run() {
  bash "$SCRIPT" "$3" ${4:+"$4"} >/dev/null 2>&1
  local rc=$?
  if [ "$rc" -eq "$2" ]; then
    echo "  ok: $1"
    pass=$((pass + 1))
  else
    echo "  FAIL: $1 (expected exit $2, got $rc)"
    fail=$((fail + 1))
  fi
}

t=$(mktemp -d)

d="$t/eq"; mkdir -p "$d"
mk "$d" feature 4; mk "$d" bug 4; mk "$d" security 4
run "all templates at the same version passes" 0 "$d"

d="$t/drift"; mkdir -p "$d"
mk "$d" feature 5; mk "$d" bug 4; mk "$d" security 4
run "one lagging template fails" 1 "$d"

d="$t/exempt"; mkdir -p "$d"
mk "$d" feature 4; mk "$d" bug 4; mk "$d" contribution -
run "an unmarked template is exempt" 0 "$d"

d="$t/single"; mkdir -p "$d"
mk "$d" feature 4
run "a single versioned template has nothing to lock" 0 "$d"

d="$t/mixdrift"; mkdir -p "$d"
mk "$d" feature 4; mk "$d" bug 5; mk "$d" contribution -
run "drift is caught even with an exempt file present" 1 "$d"

d="$t/withdoc"; mkdir -p "$d"
mk "$d" feature 4; mk "$d" bug 4
printf 'canonical\n<!-- template-version: 4 -->\n' > "$t/doc-ok.md"
run "canonical doc at the matching version passes" 0 "$d" "$t/doc-ok.md"

printf 'canonical\n<!-- template-version: 5 -->\n' > "$t/doc-drift.md"
run "canonical doc at a different version fails" 1 "$d" "$t/doc-drift.md"

rm -rf "$t"

# The no-arg path is what CI invokes: it resolves the template dir and the canonical doc
# itself. Exercise it against the real repo (which is in lockstep) so a regression in
# resolve_dir or the default-doc wiring cannot ship green.
if bash "$SCRIPT" >/dev/null 2>&1; then
  echo "  ok: no-arg run resolves the real repo and passes"
  pass=$((pass + 1))
else
  echo "  FAIL: no-arg run against the real repo (expected exit 0)"
  fail=$((fail + 1))
fi

echo ""
echo "template-lockstep tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
