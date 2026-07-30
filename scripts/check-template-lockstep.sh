#!/usr/bin/env bash
# Assert every work issue-template - and the canonical ticket-standards doc - share one
# template-version marker (lockstep).
#
# Divergence is exactly what makes ticket-gate's version check mis-fire across ticket
# types (it reads the version and compares every ticket against it), and it lets the
# canonical rules doc drift apart from the forms that implement it. This is the mechanical
# anti-drift lock. Templates that carry no marker (e.g. contribution.yml) are exempt.
#
# Usage: check-template-lockstep.sh [ISSUE_TEMPLATE_DIR] [CANONICAL_DOC]
#   With no argument, resolves the first existing of
#   .forgejo/ISSUE_TEMPLATE, .gitea/ISSUE_TEMPLATE, .github/ISSUE_TEMPLATE (host-aware),
#   and includes docs/guides/ticket-standards.md if present.
#   An explicit ISSUE_TEMPLATE_DIR is honoured as-is (the tests pass an absolute fixture
#   path); the canonical doc is then only checked when passed explicitly as $2, so unit
#   tests stay hermetic and never pick up the real repo doc.
#
# The canonical doc is OPTIONAL by design: a downstream project can adopt this guard for
# template lockstep without having adopted the canonical-doc pattern, so an absent doc is a
# vacuous pass for the doc portion, not a failure.
#
# Requires bash 4+ (associative arrays) and GNU grep (grep -P), same as the repo's other
# marker guards.
set -uo pipefail

if [ "$#" -eq 0 ]; then
  cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
fi

resolve_dir() {
  local d
  for d in .forgejo/ISSUE_TEMPLATE .gitea/ISSUE_TEMPLATE .github/ISSUE_TEMPLATE; do
    [ -d "$d" ] && { printf '%s\n' "$d"; return 0; }
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
  DOC="docs/guides/ticket-standards.md"
fi

# First template-version marker per file (positional-first, matching the ver_of discipline
# the other guards use: the marker is the first template-version string in the file).
tver() { grep -oP 'template-version: \K\d+' "$1" | head -1; }

declare -A versions=()
seen=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  v=$(tver "$f")
  [ -n "$v" ] || continue          # no marker -> exempt (e.g. contribution.yml)
  versions["$f"]=$v
  seen=$((seen + 1))
done < <(find "$DIR" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)

if [ -n "$DOC" ] && [ -f "$DOC" ]; then
  dv=$(tver "$DOC")
  if [ -n "$dv" ]; then
    versions["$DOC"]=$dv
    seen=$((seen + 1))
  fi
fi

if [ "$seen" -lt 2 ]; then
  echo "check-template-lockstep: fewer than 2 versioned files; nothing to lock."
  exit 0
fi

uniq_vers=$(printf '%s\n' "${versions[@]}" | sort -un)
if [ "$(printf '%s\n' "$uniq_vers" | wc -l)" -eq 1 ]; then
  echo "check-template-lockstep: all $seen versioned files at template-version $uniq_vers."
  exit 0
fi

echo "check-template-lockstep: template-version DRIFT (expected one shared version):"
while IFS= read -r f; do
  echo "  v${versions[$f]}  $f"
done < <(printf '%s\n' "${!versions[@]}" | sort)
echo ""
echo "All work templates and the canonical ticket-standards doc must share one template-version."
exit 1
