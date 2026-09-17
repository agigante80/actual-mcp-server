#!/usr/bin/env bash
# check-private-leaks-version: 14
#
# The private half of the leak guard: project and folder NAMES that must not become public.
#
# Its companion, check-public-leaks.sh, catches path shapes and addresses without needing to know
# anything about you; this one cannot, because deciding that a name is private requires knowing
# that it is (forge-kit issue #99, split as #156). The first line above is deliberately one whole
# sentence: the component index renders it verbatim.
#
# HONEST STATEMENT OF REACH. This header carried none until #185, which is its own small lesson:
# the public half states four limits carefully and this one stated nothing, so a reader comparing
# them would reasonably infer this half had none.
#
# THE TREE MODES NEVER LOOK AT HISTORY; --history DOES, AND IT IS OPT-IN (#185, #191). `--all`
# enumerates tracked files in the WORKING TREE, `--staged` reads the index, and `--range` enumerates
# two endpoints (`--no-renames --diff-filter=ACMT`, so a renamed-and-edited file and a symlink
# replaced by a file are listed; both were invisible before #208) and reads each file at HEAD, so a
# name added and removed inside the range is invisible at both ends. The tree modes fail closed
# like `--history` (#208): a temp directory that cannot be made, a names file or blob that cannot
# be written, a tracked file this process cannot open, are each exit 2 naming the file. A private folder name committed once and deleted later stays readable
# forever in a public repository, and a NAME is exactly the thing someone scrubs from the tree and
# forgets in the history.
#
# `--history` reads the publishable history: every blob reachable from a branch or a tag, and every
# commit and tag MESSAGE (subject and body). The author, committer and tagger lines are NOT scanned
# by this half either: that identity is what the forge already displays beside every commit, public
# by construction: the forge shows it whether or not the scan does. The reader is the public
# half's: one `git cat-file --batch`, a POSIX awk reader that counts each object's declared BYTES
# (so a forged batch header hides nothing) and puts no content byte through a regex, NUL-bearing
# objects dropped whole, and an object scanned unless EVERY path it ever had is skipped. In this
# mode a listed name is redacted inside the printed PATH as well as in the evidence, since a path
# is the likeliest place for such a name to sit, though a name that appears ONLY in a path is not a
# finding here any more than in the tree modes; --show-names lifts both redactions. The set is
# what a mirror push sends: every ref except refs/stash, plus every worktree's HEAD
# (`--exclude=refs/stash --all`, the exclude before the selector it narrows), so remote-tracking
# refs, refs/notes, filter-branch's refs/original backups and custom namespaces are all in (#210:
# the first cut read branches, tags and remotes only) and a detached HEAD over-reports, the safe
# side. Refs/replace and grafts are ignored or refused, since they make git show what a push does
# not send.
# It is never wired into a hook: a pre-publish step, run by hand.
#
# `--history --orphans` also reads objects no ref reaches (amended or reset away, not yet pruned)
# and the stash, the one ref the set leaves out. A push (`--mirror` included) and a clone over a
# URL never send either; a bundle carries no orphan but `bundle create --all` does carry the
# stash; a clone from a local PATH and any copy of the .git directory carry both. A filter-branch backup under refs/original is a ref and needs no --orphans. With no path,
# the self-skip is the weaker content test.
#
# WHAT --history REFUSES, exit 2: an alternates file (a `git clone --shared`, resolved through
# `git rev-parse --git-path`), GIT_ALTERNATE_OBJECT_DIRECTORIES or GIT_OBJECT_DIRECTORY set, a
# partial clone, which would fetch every missing object during the scan, a store git cannot read in
# full, a path map it cannot parse, and any pipeline stage that fails: a partial scan reporting
# clean is the one outcome worse than no scan. One cosmetic limit: a path containing a TAB prints
# truncated at the tab in the report label; the finding itself is not affected.
#
# Scanning the store by hand (#198):
# pass `grep -a` over a `git cat-file --batch` stream, since tree objects contain NUL and a grep
# then treats it as binary; GNU replaces matched lines with "binary file matches", and a wrapper
# passing `-I` skips the stream and reports no match at all.
#
# IT MATCHES LITERAL NAMES, not shapes. A name shortened, hyphenated differently, or embedded in a
# larger word is a different string and is not found. That is the price of the list being exact, and
# the alternative, matching loosely on names this short, would fire on ordinary prose.
#
# For the going-public case, run a credential scanner as well: `gitleaks git .` walks the whole
# history for SECRETS rather than identity, so it is a companion and not a substitute.
#
#   check-private-leaks.sh [--staged | --range <base> | --all] [--list <path>]
#                          [--allow-file <path>] [--show-names] [paths...]
#   check-private-leaks.sh --history [--orphans] [--list <path>] [--show-names]
#
# Exit 0 clean, 1 on a finding, 2 when it could not run. One line per finding:
#   <file>:<line>: private-name: <redacted>                    (tree modes)
#   <path>@<oid>:<line>: private-name: <redacted>              (--history; commit@, tag@, or blob@
#                                                               when no path is known)
#
# WHY THE LIST IS NOT IN THE REPOSITORY. A committed file enumerating the names you have been
# hiding tells a reader exactly what to search the history for. It converts a guard into an index.
# So the list lives in the unpublished agent config directory, and this runs LOCALLY ONLY. Putting
# it in a CI secret is the same mistake in a place with more readers and worse access controls.
#
# WHY THE REPORT REDACTS BY DEFAULT. The class of leak this component exists to stop is pasted
# output: a traceback, a shell transcript, a failing hook. This hook's own output is exactly that
# kind of text, and printing the matched name in full makes pasting it into a public issue the next
# leak. The file and line are enough to act on; --show-names is there for when you need certainty
# and are not about to paste.
#
# THREE BEHAVIOURS THAT LOOK LIKE LENIENCY AND ARE NOT. Every one of them fails in the direction of
# the guard being REMOVED, which is the only failure mode that matters for something nobody is
# forced to keep:
#
#   - A MISSING LIST exits 0 and says so. A guard that blocks every fresh clone gets uninstalled.
#   - THE OWNING ACCOUNT'S NAME is dropped with a warning rather than obeyed, in the TREE MODES and
#     only when origin's host is a public forge (github.com, gitlab.com, codeberg.org,
#     bitbucket.org): there it is in the public clone URL, so a list containing it refuses every
#     commit that touches the README. Public identity and private identity are different sets. On
#     a private origin the list is obeyed, and --history obeys it everywhere (#209).
#   - A VERY SHORT ENTRY refuses the run. Two characters match nearly every file, and a guard that
#     fires on everything is one its owner switches off within a day.

set -uo pipefail

# --- portability ------------------------------------------------------------
# macOS still ships bash 3.2 and a BSD readlink with no -f, and this component is installed into
# other people's repositories. A guard that dies on a contributor's laptop is a guard they remove.
# The lowercase helper assigns to a variable rather than returning a string, so the fast path on
# bash 4 costs no fork at all; the slow path pays one, on the platform that has no alternative.
if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
  set_lower() { LOWER="${1?}"; LOWER="${LOWER,,}"; }
else
  set_lower() { LOWER="$(printf '%s' "${1?}" | tr '[:upper:]' '[:lower:]')"; }
fi
# POSIX stand-in for `readlink -f`, which is enough here: every path this resolves exists, so the
# only job is to make two spellings of the same file compare equal.
abspath() {
  local d b
  d="$(dirname -- "$1")"; b="$(basename -- "$1")"
  d="$(cd -- "$d" 2>/dev/null && pwd -P)" || { printf '%s' "$1"; return; }
  printf '%s/%s' "$d" "$b"
}

SELF="$(abspath "${BASH_SOURCE[0]}")"
MIN_NAME_LEN=3

MODE=all
MODESET=0
BASE=""
LIST="${HOME}/.claude/forge-kit/private-names.txt"
SHOW_NAMES=0
DO_INIT=0
PATHS=()
ORPHANS=0

die()  { printf 'check-private-leaks: %s\n' "$1" >&2; exit 2; }
warn() { printf 'check-private-leaks: %s\n' "$1" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    # One mode per run. The last flag used to win silently, so "--history --staged" scanned the
    # index and reported clean on the history the user asked about.
    --all)         [ "$MODESET" = 0 ] || die "one mode only: --all, --staged, --range or --history"; MODESET=1; MODE=all ;;
    --staged)      [ "$MODESET" = 0 ] || die "one mode only: --all, --staged, --range or --history"; MODESET=1; MODE=staged ;;
    --range)       [ "$MODESET" = 0 ] || die "one mode only: --all, --staged, --range or --history"; MODESET=1
                   MODE=range; shift; [ $# -gt 0 ] || die "--range needs a base ref"; BASE="$1" ;;
    --history)     [ "$MODESET" = 0 ] || die "one mode only: --all, --staged, --range or --history"; MODESET=1; MODE=history ;;
    --orphans)     ORPHANS=1 ;;
    --list)        shift; [ $# -gt 0 ] || die "--list needs a path"; LIST="$1" ;;
    --allow-file)  shift; [ $# -gt 0 ] || die "--allow-file needs a path"; ALLOW_FILE="$1" ;;
    --show-names)  SHOW_NAMES=1 ;;
    --init)        DO_INIT=1 ;;
    # Prints the whole comment header, rather than a hardcoded line range. The range was the bug:
    # growing the header by seven lines truncated --help mid-sentence and dropped the synopsis, and
    # help text that rots silently is worse than none because it still reads as current.
    --help|-h)    awk 'NR==1{next} /^# *[a-z0-9-]+-version: [0-9]+$/{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$SELF"; exit 0 ;;
    --)            shift; while [ $# -gt 0 ]; do PATHS+=("$1"); shift; done; break ;;
    -*)            die "unknown flag: $1" ;;
    *)             PATHS+=("$1") ;;
  esac
  shift
done

SKIP_PATHS=()
ALLOW_FILE="${ALLOW_FILE:-}"
# Paths only, never names. Listing a path discloses nothing; a name here would rebuild
# the index this component exists to avoid — which is why `skip` is the ONLY key.
if [ -n "$ALLOW_FILE" ]; then
  [ -f "$ALLOW_FILE" ] || die "allow-file not found: $ALLOW_FILE"
  lineno=0
  while IFS= read -r raw || [ -n "$raw" ]; do
    lineno=$((lineno+1))
    line="${raw%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%% *}"; val="${line#* }"
    [ "$key" != "$val" ] || die "$ALLOW_FILE:$lineno: entry has no value: $line"
    case "$key" in
      skip) SKIP_PATHS+=("$val") ;;
      root|prefix|email)
        # These belong to check-public-leaks.sh. Sharing one file is intended; silently
        # ignoring a key is not, so say which scanner owns it.
        : ;;
      *) die "$ALLOW_FILE:$lineno: unknown key '$key' (this scanner wants skip)" ;;
    esac
  done < "$ALLOW_FILE"
fi

# --history is a mode, and --orphans means nothing without it. Refused rather than ignored: a flag
# that silently does nothing is a scan the user believes ran wider than it did.
if [ "$MODE" = history ]; then
  [ "${#PATHS[@]}" -eq 0 ] || die "--history takes no paths"
else
  [ "$ORPHANS" = 0 ] || die "--orphans is only valid with --history"
fi

# Messages show the list path with the home directory as "~": this scanner's own stderr is exactly
# the text the public half polices, and the default path is under $HOME. A case, not a pattern
# substitution: bash 5 tilde-expands "~" in a replacement string, so `${LIST/#$HOME/~}` printed
# the path unchanged there and only bash 3.2 showed the tilde (review). Segment-anchored, so
# HOME=/h/b never rewrites /h/bee/y.
case "$LIST" in "$HOME"/*) LIST_SHOWN="~${LIST#"$HOME"}" ;; *) LIST_SHOWN="$LIST" ;; esac

# --- --init: write a starter list ------------------------------------------
# The template is HERE rather than in a .txt beside this script, because forge-adapt installs a
# skill's `assets/*.sh` and nothing else: a separate template file would never reach the project,
# and the guidance would point at a file that was not installed. One asset, one marker, and no
# second copy of this text to drift out of step with the rules the script actually enforces.
if [ "$DO_INIT" = 1 ]; then
  [ -e "$LIST" ] && die "refusing to overwrite the existing list at $LIST_SHOWN"
  mkdir -p "$(dirname "$LIST")" || die "could not create $(dirname "$LIST_SHOWN")"
  cat > "$LIST" <<'TEMPLATE'
# private-names.txt -- the identity half of forge-kit's leak guard.
#
# Add the names you do not want reaching a public repository: sibling project names, client
# names, an employer, a filing scheme, the folder your projects live in. One per line. Blank
# lines and lines starting with # are ignored.
#
# THIS FILE MUST STAY UNTRACKED. Its entire security property is that it was never published: a
# committed list of the names you are hiding tells a reader exactly what to search the history
# for, which converts a guard into an index. That is also why this half never runs in CI, and why
# the list must not go in a CI secret. The scanner REFUSES to run against a tracked list.
#
# DO NOT ADD THE OWNING ACCOUNT NAME of a repository hosted on a PUBLIC forge. It is in that
# repository's public clone URL, so it would fire on the README, the workflows and the install
# instructions. Public identity and private identity are different sets. The scanner drops such an
# entry with a warning in the tree modes when origin is github.com, gitlab.com, codeberg.org or
# bitbucket.org; on a private forge origin, and always under --history, the list is obeyed, since
# the going-public scan is exactly where a private organisation name must be caught.
#
# Names shorter than three characters are refused: they match nearly every file, and a guard that
# fires on everything is one you switch off within a day.
#
# Matching is case insensitive and matches anywhere in a line, so a short distinctive name also
# catches the longer names built from it. Prefer the shortest name that is still distinctive.
TEMPLATE
  printf 'check-private-leaks: wrote %s. Add your names to it.\n' "$LIST_SHOWN" >&2
  exit 0
fi

# --- the list ---------------------------------------------------------------
if [ ! -f "$LIST" ]; then
  warn "no private-name list at $LIST_SHOWN, so NAMES ARE NOT BEING CHECKED."
  warn "  this is not an error: the list is deliberately outside the repository, and a machine"
  warn "  that never had one must not be blocked. Run this with --init to write a starter list."
  exit 0
fi

# A TRACKED list is the exact disclosure this component exists to prevent: a committed file
# enumerating the names you are hiding points a reader straight at them. REFUSE rather than warn.
# A warning here would be advice about an active leak, and the fix is one command.
#
# The default path is under the home directory, so this can only fire when someone has pointed
# --list at a file inside the repository. That is the precondition the original design wanted a
# forge-adapt step to enforce; checked here, it is enforced everywhere the guard runs rather than
# only where the installer ran.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
   && git ls-files --error-unmatch -- "$LIST" >/dev/null 2>&1; then
  die "the private-name list at $LIST is TRACKED by this repository.
  That publishes the names you are hiding, which is worse than not checking at all.
  Fix it:  git rm --cached '$LIST'  then add it to .gitignore, or move it to
  ~/.claude/forge-kit/private-names.txt, which no project repository can track."
fi

# Two leading characters and the length, which is enough for the owner to recognise their own name
# and not enough for a reader of a pasted transcript to learn it.
redact() {
  local n="$1" out="${1:0:2}" i
  for ((i = 2; i < ${#n}; i++)); do out+='*'; done
  printf '%s' "$out"
}

# The account that owns this repository on a PUBLIC forge is public by definition: it is in the
# clone URL. A list entry matching it would fire on the README, the workflows, and the install
# instructions. That rationale is true of a public clone URL and false of a private one (#209):
# with origin on a self-hosted Forgejo and GitHub as the second remote, the going-public scan is
# exactly the one the drop used to defeat. So the drop applies ONLY in the tree modes, and ONLY
# when origin's HOST is exactly one of the four public forges below; never in --history, which
# obeys its list and leaves allowlisting to the user. The URL is parsed by FORM, following git's
# URL grammar: on the `scheme://` form the host is the authority minus `user@` (stripped first)
# and `:port` (only this form carries one), and the owner is the first path segment; on the scp
# form (no `/` before the first `:`) the host is the text before the colon, minus `user@`, and the
# owner the first segment after it; a local or relative path, or `file://`, yields no owner. No
# digit heuristic anywhere: all-digit GitHub owners exist, and v9 took `2222` in `host:2222/` for
# the owner. A look-alike host (`github.com.evil.internal`) and `@github.com/` in a path or query
# are not the host; the comparison is exact on the isolated authority.
OWNER=""; OWNER_HOST=""
remote_url="$(git remote get-url origin 2>/dev/null || true)"
if [ -n "$remote_url" ]; then
  u="${remote_url%.git}"
  case "$u" in
    *://*)
      rest="${u#*://}"
      case "$rest" in
        */*) auth="${rest%%/*}"; upath="${rest#*/}" ;;
        *)   auth="$rest"; upath="" ;;
      esac
      # The authority ends at the first of `/`, `?` or `#` (RFC 3986 3.2), not `/` alone: a query or
      # fragment before the first slash let `https://evil.internal?@github.com/o/r` read as
      # github.com and drop a listed owner on a private host (#212).
      auth="${auth%%\?*}"; auth="${auth%%#*}"
      auth="${auth##*@}"; OWNER_HOST="${auth%%:*}"
      [ -n "$OWNER_HOST" ] && OWNER="${upath%%/*}" ;;
    *)
      pre="${u%%:*}"
      case "$u" in
        *:*) case "$pre" in
               */*) : ;;                                   # a path with a colon in it, not scp form
               *)   OWNER_HOST="${pre##*@}"; upath="${u#*:}"; OWNER="${upath%%/*}" ;;
             esac ;;
      esac ;;
  esac
fi
set_lower "$OWNER_HOST"; OWNER_HOST="$LOWER"
DROP_OWNER=0
if [ "$MODE" != history ] && [ -n "$OWNER" ]; then
  case "$OWNER_HOST" in github.com|gitlab.com|codeberg.org|bitbucket.org) DROP_OWNER=1 ;; esac
fi

NAMES=()
lineno=0
while IFS= read -r raw || [ -n "$raw" ]; do
  lineno=$((lineno + 1))
  n="${raw%$'\r'}"
  n="${n#"${n%%[![:space:]]*}"}"
  n="${n%"${n##*[![:space:]]}"}"
  case "$n" in ''|'#'*) continue ;; esac
  if [ "${#n}" -lt "$MIN_NAME_LEN" ]; then
    die "$LIST_SHOWN:$lineno: '$n' is too short (under $MIN_NAME_LEN characters). It would match almost
  every file, and a guard that fires on everything is one you switch off. Use the full name."
  fi
  set_lower "$n";     n_lc="$LOWER"
  set_lower "$OWNER"; owner_lc="$LOWER"
  if [ "$DROP_OWNER" = 1 ] && [ "$n_lc" = "$owner_lc" ]; then
    warn "$LIST_SHOWN:$lineno: dropping '$(redact "$n")': it is the OWNING ACCOUNT of this repository on $OWNER_HOST,"
    warn "  so it appears in the public clone URL and would refuse every commit touching the README."
    warn "  Public identity and private identity are different sets. --history never drops it."
    continue
  fi
  NAMES+=("$n")
done < "$LIST"

[ "${#NAMES[@]}" -gt 0 ] || exit 0

# --- which files ------------------------------------------------------------
FILES=()
if [ "${#PATHS[@]}" -gt 0 ]; then
  MODE=paths
  FILES=("${PATHS[@]}")
else
  # --history needs an object store, not a work tree: a bare mirror about to be published is a
  # natural target. The tree modes need the tree.
  if [ "$MODE" = history ]; then git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"
  else git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "not inside a git work tree (pass explicit paths to scan without git)"; fi
  case "$MODE" in
    history) : ;;
    all)    while IFS= read -r -d '' f; do FILES+=("$f"); done < <(git ls-files -z) ;;
    staged) while IFS= read -r -d '' f; do FILES+=("$f"); done \
              < <(git diff --cached --no-renames --name-only --diff-filter=ACMT -z) ;;
    range)
      # Fail CLOSED on an absent base, rather than passing vacuously.
      git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null \
        || die "base ref not found: $BASE (fetch it first)"
      while IFS= read -r -d '' f; do FILES+=("$f"); done \
        < <(git diff --no-renames --name-only --diff-filter=ACMT -z "$BASE...HEAD") ;;
  esac
fi
[ "$MODE" = history ] || [ "${#FILES[@]}" -gt 0 ] || exit 0

# Unconditional and fatal: a scan that cannot make its temp directory used to continue and
# report clean (#208). A refusal is the honest answer and the hooks treat exit 2 as a block.
TMPD="$(mktemp -d 2>/dev/null)" || die "cannot create a temp directory"
trap 'rm -rf "$TMPD"' EXIT
BLOB="$TMPD/blob"

skip_by_name() {  # skip_by_name <path> [<lowercased basename>]
  # The second argument lets --history, which decides thousands of paths in one loop, pass a
  # basename awk already lowercased, so the loop forks nothing on the bash-3 slow path.
  if [ $# -ge 2 ]; then LOWER="$2"; else set_lower "${1##*/}"; fi
  case "$LOWER" in
    *.png|*.jpg|*.jpeg|*.gif|*.bmp|*.ico|*.webp|*.svgz|*.pdf|*.zip|*.gz|*.bz2|*.xz|*.tar \
    |*.woff|*.woff2|*.ttf|*.otf|*.eot|*.mp3|*.mp4|*.mov|*.wav|*.class|*.jar|*.so|*.dylib \
    |*.dll|*.exe|*.pyc|*.o|*.a|*.wasm) return 0 ;;
    *.lock|package-lock.json|npm-shrinkwrap.json|yarn.lock|pnpm-lock.yaml|composer.lock \
    |gemfile.lock|poetry.lock|cargo.lock|go.sum|*.lockb) return 0 ;;
  esac
  return 1
}


# The names as a grep pattern file, written once. -F is literal, so nothing in a name is a regex.
PATFILE="$TMPD/names"
printf '%s\n' "${NAMES[@]}" > "$PATFILE" || die "could not write the names file"

violations=0
# --- history mode --------------------------------------------------------------
# The reader. One awk program, POSIX, run under LC_ALL=C over the --batch stream with NUL already
# mapped to \001 by tr. It is in the r<0 state between objects, where the only thing it will accept
# is a header; inside an object it COUNTS: r starts at the declared size plus the newline git adds,
# every line subtracts its length plus one, and the object ends when r reaches zero. A content line
# that looks like a header is therefore content. No regex touches a content line (see the header
# for why); index, substr and length are byte operations. It emits "<label>\t<line>\t<text>" for
# every content line of every object it keeps, and DROPS an object when it contains NUL (seen as
# \001, so a genuine \001 byte drops it too), or when it is the scanner's own source: an oid marked
# "cand" (some path has this scanner's basename) is self when it carries the marker line; an oid
# with NO known path (--orphans) is self under the weaker content test of shebang plus marker on
# lines 1 and 2. Once an object is dropped nothing more of it is buffered, so memory is bounded by
# the largest KEPT object, not the largest object. The record on which r reaches zero and that is
# empty is git's terminator, not a line, and is never emitted.
# The "r < 0 {" line is the load-bearing one, and the contract test mutates exactly it.
READER='
BEGIN {
  r = -1
  while ((getline l < labels) > 0) {
    split(l, a, "\t"); label[a[1]] = a[2]
    if (a[2] != "") haspath[a[1]] = 1
    if (a[3] == "cand") cand[a[1]] = 1
  }
  close(labels)
}
r < 0 {
  if (NF == 3 && (length($1) == 40 || length($1) == 64) && ($2 == "blob" || $2 == "commit" || $2 == "tag") && $3 ~ /^[0-9]+$/) {
    oid = $1; type = $2; r = $3 + 1; n = 0; drop = 0; cnt = 0; body = (type == "blob")
    if (type == "blob") { lab = ((oid in label) && label[oid] != "") ? label[oid] "@" oid : "blob@" oid } else lab = type "@" oid
    next
  }
  print "malformed cat-file header: " $0 > "/dev/stderr"; exit 2
}
{
  r -= length($0) + 1; n++
  if (!drop) {
    if (n == 1) first = $0
    if (index($0, "\001")) drop = 1
    else if (substr($0, 1, 8) == "# check-" && index($0, "-leaks-version: ")) {
      if (oid in cand) drop = 1
      else if (orphans && n == 2 && !(oid in haspath) && substr(first, 1, 2) == "#!") drop = 1
    }
    if (drop) split("", buf)
    else if (body) { if (!(r <= 0 && $0 == "")) buf[cnt++] = n "\t" $0 }
    else if ($0 == "") body = 1
  }
  if (r <= 0) {
    if (!drop) for (i = 0; i < cnt; i++) print lab "\t" buf[i]
    split("", buf); r = -1
  }
}
END { if (r > 0) { print "truncated cat-file stream" > "/dev/stderr"; exit 2 } }
'

# Every pipeline in here checks EVERY stage. A stage that fails leaves a partial map or a partial
# stream, and a partial scan that reports clean is the exact outcome this mode exists to prevent.
pipe_ok() {  # pipe_ok <what> <PIPESTATUS...>
  local what="$1"; shift; local st
  for st in "$@"; do [ "$st" = 0 ] || die "$what failed (a stage exited $st); nothing was scanned"; done
}

history_scan() {
  # Refusals first. Each is a store this scanner would read as if it were the repository, and is not.
  # Replacement refs and grafts make git SHOW a different object than the one a push sends; the
  # env var turns the first off for every git call below, and the second cannot be turned off.
  export GIT_NO_REPLACE_OBJECTS=1
  local grafts
  grafts="$(git rev-parse --git-path info/grafts 2>/dev/null)"
  [ -n "$grafts" ] && [ -f "$grafts" ] && die "refusing --history: info/grafts exists, and grafts hide objects a push still sends"
  [ -z "${GIT_OBJECT_DIRECTORY:-}" ] || die "refusing --history: GIT_OBJECT_DIRECTORY is set"
  [ -z "${GIT_ALTERNATE_OBJECT_DIRECTORIES:-}" ] || die "refusing --history: GIT_ALTERNATE_OBJECT_DIRECTORIES is set"
  local alt promisor
  alt="$(git rev-parse --git-path objects/info/alternates 2>/dev/null)"
  [ -n "$alt" ] && [ -f "$alt" ] && die "refusing --history: objects/info/alternates points outside this repository ($alt)"
  promisor="$(git config --get extensions.partialclone 2>/dev/null || true)"
  [ -n "$promisor" ] || promisor="$(git config --get-regexp '^remote\..*\.promisor$' true 2>/dev/null | sed -n 's/^remote\.\(.*\)\.promisor.*/\1/p' | head -1)"
  [ -z "$promisor" ] || die "refusing --history: this is a partial clone; --history would fetch every missing object from $promisor"

  local objects="$TMPD/objects" types="$TMPD/types" pathmap="$TMPD/paths" labels="$TMPD/labels" oids="$TMPD/oids"
  local tagged="$TMPD/tagged" hits="$TMPD/hits"
  # Enumerate the publishable set: every ref except refs/stash, plus every worktree's HEAD, which is
  # what a mirror push sends (#210: --branches --tags --remotes missed refs/original, refs/notes
  # and every custom namespace). --exclude narrows only the selector AFTER it, so it must precede
  # --all; the other way round the stash is scanned and the suite's stash case fails. No
  # --single-worktree: a linked worktree's detached HEAD over-reports, the safe side.
  # --batch-all-objects (--orphans) carries no path; the map below still supplies paths for
  # whatever is reachable.
  if [ "$ORPHANS" = 1 ]; then
    git cat-file --batch-all-objects --batch-check='%(objectname) %(objecttype)' > "$types"; pipe_ok "git cat-file --batch-check" "${PIPESTATUS[@]}"
    : > "$objects"
  else
    git rev-list --objects --exclude=refs/stash --all > "$objects"; pipe_ok "git rev-list" "${PIPESTATUS[@]}"
    cut -d' ' -f1 "$objects" | git cat-file --batch-check='%(objectname) %(objecttype)' > "$types"; pipe_ok "git cat-file --batch-check" "${PIPESTATUS[@]}"
  fi
  # An object git cannot read prints "<oid> missing" with exit 0. That is a store this scanner
  # cannot read honestly, so it refuses rather than scanning what is left.
  local unreadable
  unreadable="$(LC_ALL=C awk '$2 != "blob" && $2 != "commit" && $2 != "tag" && $2 != "tree" { print; exit }' "$types")"
  [ -z "$unreadable" ] || die "refusing --history: git cannot read every object ($unreadable); repair the store first"
  # Every path each blob has ever had, from every commit's diff against every parent (-m: a merge
  # resolved to content in neither parent has no other entry). -z then tr, because --raw quotes
  # unusual paths without it. Deletions carry the null oid and drop out with the "D" status.
  # The -c overrides pin the output shape against user config that would otherwise change it
  # silently: log.showSignature injects lines, log.diffMerges=combined changes the record shape and
  # the field that holds the merge result, diff.relative drops entries outside the cwd, and
  # log.showRoot=false drops the root commit. Each was reproduced hiding a reachable leak.
  # The parser then REFUSES a record that is not the five-field meta line it expects (a path
  # containing a newline, split by tr, is the known way to produce one), because a desynchronised
  # map suppresses every older entry. The shape test uses no regex over the path line.
  git -c log.showRoot=true -c log.showSignature=false -c log.diffMerges=separate -c diff.relative=false \
      log -m --exclude=refs/stash --all --raw --no-abbrev --no-renames --format= -z \
    | LC_ALL=C tr '\0' '\n' \
    | LC_ALL=C awk '
        NR % 2 == 1 { if (substr($0, 1, 1) != ":" || split($0, a, " ") != 5) { print "path map desynchronised at record " NR ": " $0 > "/dev/stderr"; exit 2 }
                      oid = a[4]; st = a[5]; next }
        st != "D" && oid !~ /^0+$/ { print oid "\t" $0 }' \
    | LC_ALL=C sort -u > "$pathmap"; pipe_ok "the path map (git log --raw)" "${PIPESTATUS[@]}"
  # Decide, per object, whether it is read and under what label. A blob is read unless EVERY path
  # it ever had is skipped; when its only unskipped paths carry this scanner's basename it is a
  # candidate for the identity test, which the reader completes by looking for the marker line. An
  # object with no path at all (--orphans, or a blob the map never saw) is read.
  # One sorted merge of every (blob, path) pair, the rev-list path first for each blob, then one
  # sequential read: no process runs per object, which is what keeps this under a second.
  local merged="$TMPD/merged"
  {
    # No regex over a line that carries a path (the header says why): the path is what follows the
    # first space.
    # && inside the group: a brace group's pipeline status is its LAST command's, so without it a
    # failure of the first awk would be invisible to pipe_ok (found in review round 2).
    LC_ALL=C awk '{ i = index($0, " "); p = i ? substr($0, i + 1) : ""; if (p != "") print $1 "\t0\t" p }' "$objects" \
    && LC_ALL=C awk -F'\t' '{ print $1 "\t1\t" $2 }' "$pathmap"
  } | LC_ALL=C sort -t'	' -k1,1 -k2,2 -k3,3 -u \
    | LC_ALL=C awk -F'\t' -v types="$types" '
        BEGIN { while ((getline l < types) > 0) { split(l, a, " "); t[a[1]] = a[2] } close(types) }
        t[$1] == "blob" { seen[$1] = 1; n = split($3, b, "/"); print $1 "\t" $3 "\t" tolower(b[n]) }
        END { for (o in t) if (t[o] == "blob" && !(o in seen)) print o "\t\t" }' > "$merged"; pipe_ok "the object merge" "${PIPESTATUS[@]}"
  local oid type path lower cur="" keep="" selfnamed=0 first="" selfbase="${SELF##*/}"
  set_lower "$selfbase"; local selflower="$LOWER"
  : > "$labels"
  finish_blob() {
    [ -n "$cur" ] || return 0
    if [ "$keep" = blob ]; then printf '%s\n' "$cur" >> "$labels"
    elif [ -n "$keep" ]; then printf '%s\t%s\t\n' "$cur" "$keep" >> "$labels"
    elif [ "$selfnamed" = 1 ]; then printf '%s\t%s\tcand\n' "$cur" "$first" >> "$labels"
    fi
  }
  while read -r oid type; do
    case "$type" in commit|tag) printf '%s\n' "$oid" >> "$labels" ;; esac
  done < "$types"
  while IFS='	' read -r oid path lower; do
    if [ "$oid" != "$cur" ]; then finish_blob; cur="$oid"; keep=""; selfnamed=0; first=""; fi
    [ -n "$path" ] || { keep=blob; continue; }
    [ -n "$first" ] || first="$path"
    [ -z "$keep" ] || continue
    skip_by_name "$path" "$lower" && continue
    # An allow-file skip applies to a KNOWN path, same as the tree-mode loop. A blob with no
    # path at all (--orphans, or one the map never saw) never reaches here: the empty-path
    # branch above already resolved it to `keep=blob` and moved on, so it cannot be silenced
    # by a path glob and is not meant to be.
    for s in ${SKIP_PATHS+"${SKIP_PATHS[@]}"}; do
      case "$path" in $s) continue 2 ;; esac
    done
    [ "$lower" != "$selflower" ] || { selfnamed=1; continue; }
    keep="$path"
  done < "$merged"
  finish_blob
  cut -f1 "$labels" > "$oids"
  [ -s "$oids" ] || return 0
  # Read. One cat-file, one tr, one awk; then ONE grep over the tagged stream for any name, and one
  # awk over the hit lines that matches in the TEXT column only (the label is part of the grepped
  # line, and a listed name in a PATH is not a finding: the tree modes never report a path either),
  # redacts names inside the printed path and in the evidence, and prints one finding per
  # occurrence. -a on the grep: the stream carries raw bytes. No process runs per finding.
  git cat-file --batch < "$oids" \
    | LC_ALL=C tr '\0' '\001' \
    | LC_ALL=C awk -v labels="$labels" -v orphans="$ORPHANS" "$READER" > "$tagged"; pipe_ok "the history reader" "${PIPESTATUS[@]}"
  LC_ALL=C grep -aiF -f "$PATFILE" "$tagged" > "$hits" || true
  [ -s "$hits" ] || return 0
  local found
  found="$(LC_ALL=C awk -v names="$PATFILE" -v show="$SHOW_NAMES" '
    function redact(n,  i, o) { o = substr(n, 1, 2); for (i = 3; i <= length(n); i++) o = o "*"; return o }
    function hide(p,  k, lp, ln, i, out) {   # redact every listed name inside a path, case-insensitively
      if (show) return p
      for (k = 1; k <= nn; k++) {
        ln = lname[k]; lp = tolower(p); out = ""
        while ((i = index(lp, ln)) > 0) { out = out substr(p, 1, i - 1) redact(substr(p, i, length(ln))); p = substr(p, i + length(ln)); lp = substr(lp, i + length(ln)) }
        p = out p
      }
      return p
    }
    # Longest name first, so a list holding both "secret" and "secretproj" redacts the whole longer
    # name in a path (never "se****proj") and reports one finding per occurrence, as grep -o
    # does in the tree mode. Insertion sort: the list is short and this runs once.
    BEGIN {
      while ((getline l < names) > 0) { name[++nn] = l }
      close(names)
      for (i = 2; i <= nn; i++) { v = name[i]; j = i - 1; while (j > 0 && length(name[j]) < length(v)) { name[j + 1] = name[j]; j-- } name[j + 1] = v }
      for (i = 1; i <= nn; i++) lname[i] = tolower(name[i])
    }
    {
      i1 = index($0, "\t"); lab = substr($0, 1, i1 - 1); rest = substr($0, i1 + 1)
      i2 = index(rest, "\t"); ln = substr(rest, 1, i2 - 1); text = substr(rest, i2 + 1)
      # The oid follows the LAST "@": a path may itself contain one (npm @scope/ directories).
      at = 0; j = 0; while ((j = index(substr(lab, at + 1), "@")) > 0) at += j
      path = substr(lab, 1, at - 1); oid = substr(lab, at)
      ltext = tolower(text)
      # One finding per position: a byte already inside the match of a longer name is not reported
      # again for a shorter name listed beside it.
      split("", taken)
      for (k = 1; k <= nn; k++) {
        pos = 1
        while ((i = index(substr(ltext, pos), lname[k])) > 0) {
          start = pos + i - 1; len = length(name[k]); free = 1
          for (q = start; q < start + len; q++) if (q in taken) { free = 0; break }
          if (free) {
            for (q = start; q < start + len; q++) taken[q] = 1
            hit = substr(text, start, len)
            print hide(path) oid ":" ln ": private-name: " (show ? hit : redact(hit))
          }
          pos = start + len
        }
      }
    }' "$hits")"
  [ -n "$found" ] || return 0
  printf '%s\n' "$found"
  violations=$(( violations + $(printf '%s\n' "$found" | grep -c .) ))
}

if [ "$MODE" = history ]; then
  history_scan
  [ "$violations" -eq 0 ] || exit 1
  exit 0
fi

for f in "${FILES[@]}"; do
  skip_by_name "$f" && continue
  for s in ${SKIP_PATHS+"${SKIP_PATHS[@]}"}; do
    case "$f" in $s) continue 2 ;; esac
  done
  case "$MODE" in
    # ":0:$f", never ":$f": git reads ":<stage>:<path>" first, so a path shaped "0:x" was taken
    # for a stage spec and skipped (#208). Only a BLOB is read: a gitlink names a commit, and when
    # that commit happens to be in the store `git show` prints it and its message was scanned as
    # the file (review); a path git cannot show at all is skipped as before. A blob git has but
    # could not write (disk full under TMPDIR) is a refusal, since the old "|| continue" turned
    # that into a clean report. The whole group's stderr is closed, so neither git's message nor
    # the shell's own notice for a child killed by a signal (RLIMIT_FSIZE, an OOM kill) can print
    # this script's path; the message names the file, never $TMPD.
    staged) [ "$(git cat-file -t ":0:$f" 2>/dev/null)" = blob ] || continue
            { git show ":0:$f" > "$BLOB"; } 2>/dev/null || die "could not read $f"; scanfile="$BLOB" ;;
    range)  [ "$(git cat-file -t "HEAD:$f" 2>/dev/null)" = blob ] || continue
            { git show "HEAD:$f" > "$BLOB"; } 2>/dev/null || die "could not read $f"; scanfile="$BLOB" ;;
    *)      scanfile="$f" ;;
  esac
  # A tracked SYMLINK is its target text in git, and the worktree read followed it: a dangling
  # link whose target is a home path was reported by --staged and clean under --all, the pre-push
  # hook's mode (review of #208). The link text is what git commits, so it is what is scanned.
  if [ "$MODE" != staged ] && [ "$MODE" != range ] && [ -L "$scanfile" ]; then
    { readlink -- "$scanfile" > "$BLOB"; } 2>/dev/null || die "could not read $f"; scanfile="$BLOB"
  fi
  [ -f "$scanfile" ] || continue
  # A tracked file this process cannot OPEN (mode 000) used to fall through the greps below and
  # read as clean (#208); it is a refusal, and the message names the file, not the script.
  [ -r "$scanfile" ] || die "could not read $f"
  # Compared against the NAMED path, never the file being read. In --staged and --range that file
  # is a temp blob, so comparing it here would never match and the scanner would report its own
  # source. Every project that vendors this asset and wires the commit hook hits that on the
  # commit that installs it, which is how it was found.
  # Gated on the basename first: abspath forks three times, and paying that on every file in the
  # tree costs more than the scan itself. Only a file that could BE the script is resolved.
  case "${f##*/}" in
    "${SELF##*/}") [ "$(abspath "$f")" = "$SELF" ] && continue ;;
  esac
  # Read by grep, never through a command substitution: null bytes would be dropped and warned
  # about once per occurrence, so a full scan would print a wall of noise and read fonts as text.
  # The file is read by REDIRECTION, never as an operand: a tracked file named "-v" was an option
  # and one named "-" was stdin, and both were unscanned (#208). stderr is closed before the open so
  # a bash diagnostic, which carries this script's absolute path, cannot print.
  grep -Iq . 2>/dev/null < "$scanfile" || continue

  # ONE grep per file, matching every name at once from a pattern file, rather than one grep per
  # (file x name). At ten names and five thousand files the old shape was fifty thousand process
  # spawns on every push, in a component shipped into other people's repositories.
  while IFS= read -r g; do
    [ -n "$g" ] || continue
    hit="${g#*:}"
    if [ "$SHOW_NAMES" = 1 ]; then shown="$hit"; else shown="$(redact "$hit")"; fi
    printf '%s:%s: private-name: %s\n' "$f" "${g%%:*}" "$shown"
    violations=$((violations + 1))
  done < <(grep -noiF -f "$PATFILE" 2>/dev/null < "$scanfile")
done

[ "$violations" -eq 0 ] || exit 1
exit 0
