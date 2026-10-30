#!/usr/bin/env bash
# check-template-lockstep-version: 2
# Assert every work issue-template - and the canonical ticket-standards doc - share one
# template-version marker (lockstep).
#
# Divergence is exactly what makes ticket-gate's version check mis-fire across ticket
# types (it reads the version and compares every ticket against it), and it lets the
# canonical rules doc drift apart from the forms that implement it. This is the mechanical
# anti-drift lock. Templates that carry no marker (e.g. contribution.yml) are exempt.
#
# Usage: check-template-lockstep.sh [ISSUE_TEMPLATE_DIR] [CANONICAL_DOC]
#   With no argument, resolves the first existing template dir, HOST-grouped so a live
#   Forgejo/Gitea dir always outranks a stale retained .github one, uppercase before the
#   legacy lowercase variant within each host (.forgejo/ISSUE_TEMPLATE, .forgejo/issue_template,
#   .gitea/ISSUE_TEMPLATE, .gitea/issue_template, .github/ISSUE_TEMPLATE), warns when both
#   casings of one host exist, and checks docs/development/ticket-standards.md as the
#   canonical doc.
#   An explicit ISSUE_TEMPLATE_DIR is honoured as-is (the tests pass an absolute fixture
#   path); the canonical doc is then only checked when passed explicitly as $2, so unit
#   tests stay hermetic and never pick up the real repo doc.
#
# Project adaptation: missing canonical doc fails (#605). Whenever a canonical doc is in play
# (the no-arg default, or an explicit $2) and the file does not exist, the guard prints
# "canonical doc not found: <path>" to stderr and exits 1. Before #605 an absent doc was
# silently dropped from the lock, so a stale default path passed and unlocked the doc. A
# downstream project that has not adopted the canonical-doc pattern opts out by passing only
# the template dir ($1), which checks the templates alone.
#
# Exit: 0 locked (or nothing to lock), 1 drift or a missing canonical doc, 2 the repository root
# could not be entered (fails closed: running from the wrong directory would report "nothing to
# check" as a pass).
#
# Where this lives (#506): forge-adapt's templates mode copies it into a project's scripts/, so it is
# shipped as an asset of forge-kit-adapt, which gives it the version marker above and lets drift see
# an installed copy that is behind. Its contract test, scripts/test-template-lockstep.sh, is kit-only
# and is not copied downstream.
#
# Portability (#538): runs under bash 3.2 (stock macOS /bin/bash) with BSD or GNU grep, sed and sort.
# It needs no associative array and no PCRE, because either one made it print an error and then
# exit 0 over drift on a stock Mac. Versions are kept in a newline list of version<TAB>path records.
set -uo pipefail

if [ "$#" -eq 0 ]; then
  CDPATH= cd -- "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" \
    || { echo "check-template-lockstep: cannot enter the repository root" >&2; exit 2; }
fi

resolve_dir() {
  # Uppercase is canonical. The lowercase variants are accepted because forge-adapt v34 and
  # earlier instructed `.forgejo/issue_template` on Forgejo installs (issue #61); those repos
  # must not be left silently unguarded. Ordering is HOST-grouped (all Forgejo dirs before
  # Gitea before GitHub): a migrated repo that kept a stale `.github/ISSUE_TEMPLATE` must have
  # its LIVE lowercase Forgejo dir checked, not the stale GitHub one. Within a host, uppercase
  # wins and a WARNING names the duplicate: a silent first-match would recreate the original
  # bug one level down.
  # The -ef guard keeps case-insensitive filesystems (macOS) from warning about one directory
  # reachable under two names.
  local d lower
  for d in .forgejo/ISSUE_TEMPLATE .forgejo/issue_template \
           .gitea/ISSUE_TEMPLATE .gitea/issue_template .github/ISSUE_TEMPLATE; do
    [ -d "$d" ] || continue
    case "$d" in
      */ISSUE_TEMPLATE)
        lower="${d%/*}/issue_template"
        if [ -d "$lower" ] && ! [ "$lower" -ef "$d" ]; then
          echo "check-template-lockstep: WARNING: both $d and $lower exist; checking $d (merge the two)" >&2
        fi ;;
    esac
    printf '%s\n' "$d"; return 0
  done
  return 1
}

DIR="${1:-$(resolve_dir || true)}"
if [ -z "${DIR:-}" ] || [ ! -d "$DIR" ]; then
  echo "check-template-lockstep: no ISSUE_TEMPLATE directory found; nothing to check."
  exit 0
fi

# Canonical standards doc: participates in the same lock. Defaults only in the no-arg (CI)
# invocation; pass it explicitly as $2 to exercise it from a test.
DOC="${2:-}"
if [ "$#" -eq 0 ]; then
  DOC="docs/development/ticket-standards.md"
fi
if [ -n "$DOC" ] && [ ! -f "$DOC" ]; then
  echo "check-template-lockstep: canonical doc not found: $DOC" >&2
  exit 1
fi

# First template-version marker per file (positional-first, matching the ver_of discipline
# the other guards use: the marker is the first template-version string in the file). Exactly one
# space after the colon, as ticket-gate Step 0a and check-ticket-mechanics.sh read it.
tver() { grep -o 'template-version: [0-9][0-9]*' "$1" | head -1 | sed 's/.*: //'; }

TAB=$(printf '\t')
NL='
'
recs=""          # newline-separated "version<TAB>path" records
seen=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  v=$(tver "$f")
  [ -n "$v" ] || continue          # no marker -> exempt (e.g. contribution.yml)
  recs="$recs$v$TAB$f$NL"
  seen=$((seen + 1))
done < <(find "$DIR" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)

if [ -n "$DOC" ]; then
  dv=$(tver "$DOC")
  if [ -n "$dv" ]; then
    recs="$recs$dv$TAB$DOC$NL"
    seen=$((seen + 1))
  fi
fi

if [ "$seen" -lt 2 ]; then
  echo "check-template-lockstep: fewer than 2 versioned files; nothing to lock."
  exit 0
fi

uniq_vers=$(printf '%s' "$recs" | cut -f1 | sort -un)
if [ "$(printf '%s\n' "$uniq_vers" | wc -l)" -eq 1 ]; then
  echo "check-template-lockstep: all $seen versioned files at template-version $uniq_vers."
  exit 0
fi

echo "check-template-lockstep: template-version DRIFT (expected one shared version):"
while IFS="$TAB" read -r v f; do
  echo "  v$v  $f"
done < <(printf '%s' "$recs" | sort -t "$TAB" -k2)
echo ""
echo "All work templates and the canonical ticket-standards doc must share one template-version."
exit 1
