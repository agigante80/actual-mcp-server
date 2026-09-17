#!/usr/bin/env bash
# check-public-leaks-version: 13
#
# The public half of the leak guard: home paths, unlisted "~/" roots and reachable addresses.
#
# Stops the developer's own machine leaking into a repository that is about to be made public
# (forge-kit issue #99, split as #155). It catches by SHAPE and by ALLOWLIST, so it needs no list
# of private names and can therefore run in CI, in the open, for every contributor. The first line
# above is deliberately one whole sentence: the component index renders it verbatim.
#
# HONEST STATEMENT OF REACH. This would not have caught the leak that prompted the ticket. That was
# a set of real sibling-project folder names sitting in prose as demo data, and a folder name in
# prose contains no path and no "@". Rules A and C catch the pasted-traceback class, which is the
# one that recurs. Rule B catches the "~/" class, which is the one that survived a full history
# scrub. NOTHING PUBLIC CATCHES A BARE PROJECT NAME: that needs the list, the list cannot live in
# the repository it protects, and so it lives outside it and is checked by the private half. A
# guard that overstates its reach is worse than a narrow one that admits it.
#
# THE TREE MODES NEVER LOOK AT HISTORY; --history DOES, AND IT IS OPT-IN (#185, #191). `--all`
# enumerates `git ls-files`: tracked files in the WORKING TREE. `--staged` reads the index. `--range`
# enumerates `git diff --no-renames --name-only --diff-filter=ACMT` between two endpoints and reads
# each file at HEAD, so a file added AND deleted inside the range is excluded at both ends. A home
# path committed in one commit and removed in the next is invisible to all three, in the public
# repository where it stays readable forever, and that is exactly the going-public moment this
# component exists for. `--no-renames` and the `T` are load-bearing (#208): with rename detection
# on, a renamed-and-edited file is status R and was listed by nothing, so the commit hook said
# clean on an ordinary `git mv` plus an appended leak; a symlink replaced by a file is T and was
# invisible the same way. The tree modes also FAIL CLOSED like `--history` now: a temp directory
# that cannot be made, a blob git has but cannot write, a tracked file this process cannot open,
# are each exit 2 with the file named, where every one used to be exit 0.
#
# `--history` reads the publishable history: every blob reachable from EVERY REF EXCEPT refs/stash,
# plus every worktree's HEAD (`--exclude=refs/stash --all`, the exclude BEFORE the selector it
# narrows), and every commit and tag MESSAGE (subject and body; the author, committer and tagger
# lines are what the forge already shows beside each commit and are not scanned). That set is what
# a mirror push sends: branches, tags, remote-tracking refs (a branch that exists only on the remote
# is already on a forge), refs/notes, filter-branch's refs/original backups, refs/pull and any
# custom namespace (#210: the first cut read branches, tags and remotes only, so a scrubbed
# history whose backup ref still held the leak scanned clean). A detached HEAD is over-reporting,
# since a push sends refs/ only, which is the safe side. Not reached, by design: refs/stash, which no
# push sends (--orphans reaches it), and a tag message embedded in a commit's mergetag header. One `git cat-file --batch` streams the
# objects and a POSIX awk reader counts each object's declared BYTES, so a blob whose first line
# forges a batch header cannot hide the line after it (a line-oriented reader would skip it). The
# reader puts no content byte, and no path byte, through a regex: Apple's awk aborts the moment a
# regex meets a byte over 0x7F (every such byte under a C locale on glibc; an invalid sequence under
# a UTF-8 one), and a reader that only counts and slices cannot meet that on any libc. LC_ALL=C is
# there for byte-length semantics, not to avoid that abort. Objects containing NUL are dropped
# whole, the stream's equivalent of grep -I (a genuine \001 byte drops one too, since NUL is mapped
# to it for awk's sake; the tree modes would read that file). Refs/replace and grafts are ignored
# or refused, because they make git show a different object than the one a push sends.
# An object is scanned unless EVERY path it has ever had is skipped (the binary and lockfile names,
# the allow-file `skip` entries, the scanner's own past copies), so identical content at
# "zzz.md" and "aaa.lock" is still reported. Cost on this repository, 4,300 reachable objects and
# 23 MB of content: about 3 s of CPU under bash 5 and twice that under bash 3.2 (measured 2026-09-14
# on a loaded machine; the reader itself is a tenth of that, the rest is bash judging matches),
# against fourteen seconds process-per-blob. The tagged stream materialises the whole readable
# history under TMPDIR once, and `hits` can equal it again, so budget twice the readable content on
# disk; awk holds the largest kept object twice in memory. NEVER wired into a hook: it is a
# pre-publish step, run by hand, and its evidence is REDACTED by default (see below).
#
# COST AND ITS LIMITS (#211). Rule C is linear in the line length in both modes: the anchored
# RE_MAIL keeps grep on its DFA, LC_ALL=C on the tree-mode grep keeps it there under any locale,
# and judge() splits the address with `IFS=@ read` rather than `${addr#*@}`. A 1 MB token followed
# by an address costs 0.08 s where it once cost minutes, which is what matters: a hook that stalls
# is a hook that gets --no-verify, and that is how this guard gets removed. Two things are NOT
# linear and are #217 rather than part of that claim: `redact`'s append loop, so a REDACTED
# --history report over a long match is still slow (20 s at 128 KB, 81 s at 256 KB, four times per
# doubling), which is why the timing cases that use a glued match pass --show-evidence; and rules A
# and B's own bash-side work on pathological paths.
#
# TWO SHAPES THIS DELIBERATELY DOES NOT REPORT, both consequences of the above, both pinned by a
# test case so they cannot be rediscovered as bugs:
#   1. An address glued to a home path or root, `/home/alice/alice@corp.io` and
#      `~/secret/alice@corp.io`: rules A and B end in `/?`, which consumes the byte rule C's anchor
#      needs, so the path row is reported and the address is not. Dropping that `/?` would change
#      five existing cases for a shape no real tree here has produced. A separator between the two
#      (`/home/alice/notes alice@corp.io`) reports both.
#   2. An accented local part or domain in TREE mode, `jose@corp.io` with an acute e, `zoe@corp.io`
#      with a diaeresis, `alice@corpe.io` likewise: LC_ALL=C narrows `[A-Za-z]` to ASCII, where a
#      territory UTF-8 locale would admit Latin letters with diacritics. This is not a new blind
#      spot: --history has always run under C, and CI runs under C.UTF-8, where GNU grep already
#      misses them; the pin makes the laptop hook path match them. Widening the three classes with
#      \x80-\xff is linear and was costed, and it glues any preceding multibyte byte into the
#      evidence, so it is a maintainer decision rather than an oversight.
#
# `--history --orphans` also reads objects no ref reaches: a leak amended or reset away is still
# in the local store until `git gc` prunes it, and so is a stash entry, which is the one ref the
# set above leaves out. A push (a `--mirror` push included) and a clone over a URL never send
# either; a bundle never carries an orphan but `bundle create --all` does carry the stash; a clone
# from a local PATH (git hardlinks the object store) and any copy of the .git directory carry
# both, which is the case the flag exists for. It is NOT what reaches a filter-branch
# backup: refs/original is a ref, a mirror push sends it, and plain --history reads it. An object that is also reachable keeps
# its paths and its skips; a true orphan has no path, so nothing is skipped by name for it and the
# self-skip falls back to a weaker content test (shebang plus marker line).
#
# WHAT --history REFUSES, exit 2, because a store it cannot read honestly is worse than none: an
# alternates file (a `git clone --shared`, resolved through `git rev-parse --git-path` so a linked
# worktree's .git FILE is handled), GIT_ALTERNATE_OBJECT_DIRECTORIES or GIT_OBJECT_DIRECTORY set (the
# second re-points the alternates check itself), and a partial clone, which would otherwise fetch
# every missing object from its remote during the scan. It also refuses, exit 2, a store git cannot
# read in full (an object reported "missing"), a path map it cannot parse (a path containing a
# newline), and any pipeline stage that fails, since a partial scan reporting clean is the one
# outcome worse than no scan. One cosmetic limit: a path containing a TAB prints truncated at the
# tab in the report label; the finding itself is not affected. The alternatives to this reader, a
# bash `read -N` (bash 4.1, and it drops NUL uncounted), a helper in another language (forge-adapt
# installs assets/*.sh only) and `cat-file -Z` (git 2.42), were each costed in #191 and rejected
# because this one adds no floor.
#
# The store holds more than file contents: on this repository, 1,639 blobs against 527 commit
# objects. Whoever scans the store by hand (#198):
# pass `grep -a` over a `git cat-file --batch` stream, because tree objects contain NUL and a grep
# then treats the stream as binary, GNU replacing matched lines with "binary file matches" and a
# wrapper that passes `-I` skipping the stream and reporting no match at all.
#
# A history-aware CREDENTIAL scanner is still a companion, not a substitute: `gitleaks git .` hunts
# secrets and this hunts the developer's IDENTITY, which is a different subject with a different
# false-positive profile. Running both is the answer.
#
# AND BOTH PATH RULES JUDGE THE FIRST SEGMENT ONLY. Rule A asks who "/home/<name>/" belongs to and
# rule B asks whether "~/<root>" may be shown; NEITHER looks below that. So a private directory name
# under an allowed root ("~/work/<client>/repo", "/home/user/clients/<client>/build.log") is
# invisible here, and the segments above the project are exactly what the ticket called the worse
# half of the leak. Catching those needs the name, which is the private half's job. This was found
# by review AFTER the paragraph above shipped, which is the argument for the paragraph.
#
#   check-public-leaks.sh [--staged | --range <base> | --all] [--allow-file <path>] [paths...]
#   check-public-leaks.sh --history [--orphans] [--show-evidence] [--allow-file <path>]
#
# Exit 0 clean, 1 when something was found, 2 when it could not run. One line per violation:
#   <file>:<line>: <rule>: <evidence>                        (tree modes)
#   <path>@<oid>:<line>: <rule>: <evidence>                  (--history; commit@, tag@, or blob@
#                                                             when no path is known)
# In --history the evidence is redacted to two leading characters (/home/al***/, ~/se****/,
# al******) because a pre-publish report is exactly the text that gets pasted into a public
# issue; --show-evidence prints it whole.
#
# WHY RULE B IS AN ALLOWLIST AND THE OTHER TWO ARE NOT. Shape can decide "/home/alice/" is a person
# and "/home/user/" is a placeholder. Shape cannot decide whether "~/foo" is private, because the
# string carries no marker either way. So the test is inverted: an allowlist of roots a document is
# allowed to show. That catches the case by construction rather than by enumeration, and it needs
# one thing from the project, a canonical example root, agreed once.
#
# WHY BINARIES ARE DETECTED BY PIPING INTO grep -I. The obvious alternative, asking git for a
# numstat, is EMPTY in a full-tree mode because nothing is staged, so every binary then reaches a
# command substitution, which drops null bytes and warns once per occurrence. A full scan prints a
# wall of warnings and reads font files as text.
#
# WHY THE SCRIPT SKIPS ITSELF. Its own source has to carry the patterns, so scanning it would
# report the guard as a leak. Its TEST is not skipped here: it is excluded by an allow-file entry
# in the project that runs it, which keeps the exemption visible in that project's own config
# rather than hidden in this file.

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

MODE=all
MODESET=0
BASE=""
ALLOW_FILE=""
PATHS=()
ORPHANS=0
SHOW_EVIDENCE=0

die() { printf 'check-public-leaks: %s\n' "$1" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    # One mode per run. The last flag used to win silently, so "--history --staged" scanned the
    # index and reported clean on the history the user asked about.
    --all)        [ "$MODESET" = 0 ] || die "one mode only: --all, --staged, --range or --history"; MODESET=1; MODE=all ;;
    --staged)     [ "$MODESET" = 0 ] || die "one mode only: --all, --staged, --range or --history"; MODESET=1; MODE=staged ;;
    --range)      [ "$MODESET" = 0 ] || die "one mode only: --all, --staged, --range or --history"; MODESET=1
                  MODE=range; shift; [ $# -gt 0 ] || die "--range needs a base ref"; BASE="$1" ;;
    --history)    [ "$MODESET" = 0 ] || die "one mode only: --all, --staged, --range or --history"; MODESET=1; MODE=history ;;
    --orphans)    ORPHANS=1 ;;
    --show-evidence) SHOW_EVIDENCE=1 ;;
    --allow-file) shift; [ $# -gt 0 ] || die "--allow-file needs a path"; ALLOW_FILE="$1" ;;
    # Prints the whole comment header, rather than a hardcoded line range. The range was the bug:
    # growing the header by seven lines truncated --help mid-sentence and dropped the synopsis, and
    # help text that rots silently is worse than none because it still reads as current.
    --help|-h)    awk 'NR==1{next} /^# *[a-z0-9-]+-version: [0-9]+$/{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$SELF"; exit 0 ;;
    --)           shift; while [ $# -gt 0 ]; do PATHS+=("$1"); shift; done; break ;;
    -*)           die "unknown flag: $1" ;;
    *)            PATHS+=("$1") ;;
  esac
  shift
done

# Trailing sentence punctuation belongs to the prose, not to the name. Only the tail is stripped,
# so "~/.claude" keeps the dot that is part of the directory name. The angle bracket is deliberately
# NOT in the set: stripping it would turn the "<user>" placeholder into "<user", which no longer
# matches the placeholder list, and the guard would start rejecting the documentation forms it
# exists to permit. Defined here, ahead of the allow-file parser below, because the prefix key
# needs it to refuse a dead entry before judge() (which needs it too) is ever reached.
TAIL_PUNCT='.,;:!?)]}"'"'"
# Assigns to STRIPPED rather than printing, like set_lower: a command substitution forks, and
# --history judges thousands of matches in one run.
strip_tail() {
  local s="$1" c
  while [ -n "$s" ]; do
    c="${s: -1}"
    case "$TAIL_PUNCT" in
      *"$c"*) s="${s%?}" ;;
      *) break ;;
    esac
  done
  STRIPPED="$s"
}

# --- the allowed sets ------------------------------------------------------
# Roots a document may show. "<root>" is the generic placeholder for projects that have not agreed
# a canonical example root yet; the others are either the canonical root or real, published
# locations that any reader can visit on their own machine.
# The dotfile entries are not a nod to convenience. Every one of them names a location that is
# identical on every machine, so it discloses nothing about whose machine it is, which is the only
# question this rule asks.
ALLOW_ROOTS=(projects .claude .config .local .cache dev code src work '<root>'
             .ssh .bashrc .bash_profile .zshrc .profile .gitconfig .npmrc)
# Segments that are obviously a stand-in for a person rather than a person.
PLACEHOLDER_USERS=(user users username youruser '<user>' '<username>' '<name>' '<you>' '...' '$USER' '${USER}' '$HOME')
ALLOW_PREFIXES=()
ALLOW_EMAILS=()
SKIP_PATHS=()

if [ -n "$ALLOW_FILE" ]; then
  [ -f "$ALLOW_FILE" ] || die "allow-file not found: $ALLOW_FILE"
  lineno=0
  while IFS= read -r raw || [ -n "$raw" ]; do
    lineno=$((lineno + 1))
    line="${raw%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"          # strip leading whitespace
    line="${line%"${line##*[![:space:]]}"}"          # strip trailing whitespace
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%% *}"; val="${line#* }"
    [ "$key" != "$val" ] || die "$ALLOW_FILE:$lineno: entry has no value: $line"
    case "$key" in
      # A root is written the way it appears in prose, "~/name", so the config reads like the
      # thing it permits.
      root)   ALLOW_ROOTS+=("${val#\~/}") ;;
      # Rule A matches "/home/<seg>" or "/Users/<seg>" and nothing deeper, so a prefix with more
      # than one segment, or one under any other root, can never equal a match. It would parse
      # cleanly and silently do nothing, which is the config bug every other key here refuses.
      prefix)
        pfx="${val%/}"
        case "$pfx" in
          /home/*|/Users/*) : ;;
          *) die "$ALLOW_FILE:$lineno: prefix must start /home/ or /Users/ (rule A matches no other root): $pfx" ;;
        esac
        rest="${pfx#/*/}"
        case "$rest" in
          */*|'') die "$ALLOW_FILE:$lineno: prefix must name exactly one segment, because rule A matches one segment and nothing deeper: $pfx" ;;
        esac
        # A segment that is entirely punctuation ("..", "...") is never a username: judge() will
        # never see it as one either (it returns before ALLOW_PREFIXES is consulted), so an entry
        # naming one could never match anything. Refuse it rather than accept a dead entry.
        strip_tail "$rest"
        [ -n "$STRIPPED" ] || die "$ALLOW_FILE:$lineno: prefix segment cannot be a username (entirely punctuation), so this entry could never match: $pfx"
        ALLOW_PREFIXES+=("$pfx") ;;
      email)  ALLOW_EMAILS+=("$val") ;;
      skip)   SKIP_PATHS+=("$val") ;;
      # REFUSE rather than skip the entry. A silently ignored line in a security config is a guard
      # that reports a coverage it does not have, which is the failure this whole component exists
      # to end.
      *)      die "$ALLOW_FILE:$lineno: unknown key '$key' (want root, prefix, email or skip)" ;;
    esac
  done < "$ALLOW_FILE"
fi

# One builtin per lookup, not one iteration per entry: --history judges thousands of matches
# against these lists in a single run, and a bash loop is the slow part of bash.
in_list() { local n="$1"; shift; local IFS=$'\n'; case "$IFS$*$IFS" in *"$IFS$n$IFS"*) return 0 ;; esac; return 1; }

# --history is a mode, and the two flags that modify it mean nothing without it. Refused rather
# than ignored: a flag that silently does nothing is a scan the user believes ran wider than it did.
if [ "$MODE" = history ]; then
  [ "${#PATHS[@]}" -eq 0 ] || die "--history takes no paths"
else
  [ "$ORPHANS" = 0 ] || die "--orphans is only valid with --history"
  [ "$SHOW_EVIDENCE" = 0 ] || die "--show-evidence is only valid with --history"
fi

# --- which files ------------------------------------------------------------
in_git() { git rev-parse --is-inside-work-tree >/dev/null 2>&1; }

FILES=()
if [ "${#PATHS[@]}" -gt 0 ]; then
  MODE=paths
  FILES=("${PATHS[@]}")
else
  # --history needs an object store, not a work tree: a bare mirror about to be published is a
  # natural target. The tree modes need the tree.
  if [ "$MODE" = history ]; then git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"
  else in_git || die "not inside a git work tree (pass explicit paths to scan without git)"; fi
  case "$MODE" in
    history) : ;;
    all)
      while IFS= read -r -d '' f; do FILES+=("$f"); done < <(git ls-files -z) ;;
    staged)
      while IFS= read -r -d '' f; do FILES+=("$f"); done \
        < <(git diff --cached --no-renames --name-only --diff-filter=ACMT -z) ;;
    range)
      # Fail CLOSED on a base ref that is not present, rather than passing vacuously. The same
      # posture the repo's other range guards take: a check that cannot run must not report clean.
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

# --- what is not worth scanning --------------------------------------------
skip_by_name() {  # skip_by_name <path> [<lowercased basename>]
  # Suffixes match anywhere in the path; the named lockfiles must match the BASENAME, or a path
  # like "vendor/package-lock.json" slips through while "package-lock.json" at the root is caught.
  # The second argument lets --history, which decides thousands of paths in one loop, pass a
  # basename awk already lowercased, so the loop forks nothing on the bash-3 slow path.
  if [ $# -ge 2 ]; then LOWER="$2"; else set_lower "${1##*/}"; fi
  case "$LOWER" in
    *.png|*.jpg|*.jpeg|*.gif|*.bmp|*.ico|*.webp|*.svgz|*.pdf|*.zip|*.gz|*.bz2|*.xz|*.tar \
    |*.woff|*.woff2|*.ttf|*.otf|*.eot|*.mp3|*.mp4|*.mov|*.wav|*.class|*.jar|*.so|*.dylib \
    |*.dll|*.exe|*.pyc|*.o|*.a|*.wasm) return 0 ;;
    # A lockfile is generated, is enormous, and its registry URLs are full of shapes that look
    # like findings. Nobody writes prose in one.
    *.lock|package-lock.json|npm-shrinkwrap.json|yarn.lock|pnpm-lock.yaml|composer.lock \
    |gemfile.lock|poetry.lock|cargo.lock|go.sum|*.lockb) return 0 ;;
  esac
  local s
  for s in ${SKIP_PATHS+"${SKIP_PATHS[@]}"}; do
    [ "$1" = "$s" ] && return 0
    case "$1" in */"$s") return 0 ;; esac
  done
  return 1
}

# --- the three rules --------------------------------------------------------
# The backtick is excluded from both character classes for one reason found by running this over a
# real tree: a markdown code span is the commonest way a path appears in prose, and reading
# "~/name`" as the root means the project's own allow-file entry never matches it.
RE_HOME='(/home|/Users)/[^/[:space:]"`]+/?'
RE_ROOT='~/[^/[:space:]"`]+/?'
# The leading "(^|[^class])" is the half of #211 that makes rule C linear: unanchored, the local
# part's "+" run can start at EVERY position of a long word-class byte run, and grep leaves its DFA
# to retry each one (64 KB of [A-Za-z0-9] then one address: 105 s before, milliseconds after). The
# match therefore carries one leading byte where the line does not start with the address, and
# judge() strips it before dispatching. The other half is LC_ALL=C on the tree-mode grep below.
RE_MAIL='(^|[^A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
RE_ANY="$RE_HOME|$RE_ROOT|$RE_MAIL"

violations=0
report() { printf '%s:%s: %s: %s\n' "$1" "$2" "$3" "$4"; violations=$((violations + 1)); }

# Two leading characters and stars for the rest, the private half's shape. Applied in --history
# only, because that report is a pre-publish artifact and the likeliest thing to be pasted.
redact() {
  local n="$1" out="${1:0:2}" i
  for ((i = 2; i < ${#n}; i++)); do out+='*'; done
  printf '%s' "$out"
}
show_evidence() {  # show_evidence <rule> <evidence>: what the report prints for it
  if [ "$MODE" != history ] || [ "$SHOW_EVIDENCE" = 1 ]; then printf '%s' "$2"; return; fi
  local e="$2" root seg
  case "$1" in
    home-path) root="${e%%/*}"; e="${e#/}"; root="/${e%%/*}"; e="${e#*/}"; seg="${e%%/*}"
               printf '%s/%s/' "$root" "$(redact "$seg")" ;;
    home-root) e="${e#\~/}"; seg="${e%%/*}"; printf '~/%s/' "$(redact "$seg")" ;;
    *)         printf '%s' "$(redact "$e")" ;;
  esac
}

# One match, one verdict. Shared by the tree modes and --history so the rules cannot drift between
# them: <label> is the file in a tree mode and "<path>@<oid>" in history.
judge() {
  local f="$1" n="$2" m="$3" raw seg allowed rawt p root addr local_part domain
  # Rule C's anchor (#211) leaves one leading byte on the match, and the dispatch below keys on the
  # FIRST byte, so "see docs/alice@corp.io" would arrive as "/alice@corp.io" and be judged a home
  # path. Strip it BEFORE the dispatch, never inside the email arm. A match that already starts
  # with a class byte, or that is a rule A or rule B match, is left exactly as it was.
  case "$m" in
    [A-Za-z0-9._%+-]*@*|/home/*|/Users/*|'~'/*) ;;
    *@*) m="${m#?}" ;;
  esac
  case "$m" in
    /*)
      raw="${m%/}"; seg="${raw##*/}"
      # Checked against BOTH forms: "..." is entirely punctuation, so stripping the trailing dots
      # would leave nothing to compare and the guard would reject its own documented placeholder.
      in_list "$seg" "${PLACEHOLDER_USERS[@]}" && return 0
      strip_tail "$seg"; in_list "$STRIPPED" "${PLACEHOLDER_USERS[@]}" && return 0
      # A segment that strips to nothing is entirely punctuation ("..", "...", a lone "}"): a
      # path idiom or a code fragment, not a person. No allow-file entry can name it (the prefix
      # parser above refuses to accept one), so without this it could never be suppressed.
      [ -n "$STRIPPED" ] || return 0
      # Punctuation is stripped here for the same reason as the placeholder check above, and
      # its absence was a real false positive: with `prefix /home/runner`, an allowed path at
      # the end of a sentence or inside brackets still reported a leak.
      allowed=0
      strip_tail "$raw"; rawt="$STRIPPED"
      for p in ${ALLOW_PREFIXES+"${ALLOW_PREFIXES[@]}"}; do
        case "$rawt" in "$p"|"$p"/*) allowed=1; break ;; esac
      done
      [ "$allowed" = 1 ] && return 0
      report "$f" "$n" home-path "$(show_evidence home-path "$m")" ;;
    '~'/*)
      strip_tail "${m%/}"; root="${STRIPPED#\~/}"
      # A root that strips to nothing is entirely punctuation ("~/..", "~/}"): a path idiom or a
      # code fragment, not a person's home. No allow-file `root` entry could name it either.
      [ -n "$root" ] || return 0
      in_list "$root" "${ALLOW_ROOTS[@]}" && return 0
      report "$f" "$n" home-root "$(show_evidence home-root "$m")" ;;
    *)
      strip_tail "$m"; addr="$STRIPPED"
      # IFS=@ read, not "${addr#*@}": that expansion is quadratic in the match length (3.1 s at
      # 64 KB, 48 s at 256 KB), which would move the cost the anchor removed into bash (#211).
      IFS=@ read -r local_part domain <<< "$addr"
      # An address that cannot reach a mailbox is not a leak. noreply is the convention; the rest
      # are the TLDs reserved by RFC 2606 and RFC 6761 precisely so documentation can use them.
      set_lower "$local_part"
      case "$LOWER" in
        noreply*|no-reply*|donotreply*) return 0 ;;
        # "git@host" is the SSH clone user, not a mailbox. It is in the clone URL of essentially
        # every repository, so leaving it to each project's allow-file would make the first run of
        # this guard noise rather than signal.
        git) return 0 ;;
      esac
      set_lower "$domain"
      case "$LOWER" in
        *.example|*.invalid|*.test|*.localhost|*.local) return 0 ;;
        example.com|example.org|example.net|*.example.com|*.example.org|*.example.net) return 0 ;;
      esac
      in_list "$addr" ${ALLOW_EMAILS+"${ALLOW_EMAILS[@]}"} && return 0
      report "$f" "$n" email "$(show_evidence email "$addr")" ;;
  esac
}

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
    else if (body) { if (!(r <= 0 && $0 == "")) buf[cnt++] = n "\t " $0 }
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
    [ "$lower" != "$selflower" ] || { selfnamed=1; continue; }
    keep="$path"
  done < "$merged"
  finish_blob
  cut -f1 "$labels" > "$oids"
  [ -s "$oids" ] || return 0
  # Read. One cat-file, one tr, one awk; then ONE grep over the tagged stream and one more over the
  # hit lines only, with the tag prefix as an alternation branch so the label, the line and every
  # match arrive in order and no process runs per hit. -a on both: the stream carries raw bytes.
  git cat-file --batch < "$oids" \
    | LC_ALL=C tr '\0' '\001' \
    | LC_ALL=C awk -v labels="$labels" -v orphans="$ORPHANS" "$READER" > "$tagged"; pipe_ok "the history reader" "${PIPESTATUS[@]}"
  LC_ALL=C grep -aE "$RE_ANY" "$tagged" > "$hits" || true
  # Into a file, not a process substitution: bash reads a pipe one byte per syscall, and this loop
  # read 25x slower from one on the store this was measured on.
  LC_ALL=C grep -aoE '^[^	]*	[^	]*	|'"$RE_ANY" "$hits" > "$TMPD/matches" || true
  local lab="" n="" g
  while IFS= read -r g; do
    case "$g" in
      *"	")   lab="${g%%	*}"; n="${g#*	}"; n="${n%	}" ;;
      *)      [ -n "$lab" ] && judge "$lab" "$n" "$g" ;;
    esac
  done < "$TMPD/matches"
}

if [ "$MODE" = history ]; then
  history_scan
  [ "$violations" -eq 0 ] || exit 1
  exit 0
fi

for f in "${FILES[@]}"; do
  skip_by_name "$f" && continue

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

  # Never report the guard's own source: it has to contain the patterns to apply them.
  # Compared against the NAMED path, never the file being read. In --staged and --range that file
  # is a temp blob, so comparing it here would never match and the scanner would report its own
  # source. Every project that vendors this asset and wires the commit hook hits that on the
  # commit that installs it, which is how it was found.
  # Gated on the basename first: abspath forks three times, and paying that on every file in the
  # tree costs more than the scan itself. Only a file that could BE the script is resolved.
  case "${f##*/}" in
    "${SELF##*/}") [ "$(abspath "$f")" = "$SELF" ] && continue ;;
  esac

  # Binary detection reads the file, never a shell variable, so null bytes are neither dropped nor
  # warned about. -I makes grep treat a binary file as non-matching, so an empty result means
  # "binary or empty", and both are nothing to scan.
  # The file is read by REDIRECTION, never as an operand: a tracked file named "-v" was an option
  # and one named "-" was stdin, and both were unscanned (#208). stderr is closed before the open so
  # a bash diagnostic, which carries this script's absolute path, cannot print.
  grep -Iq . 2>/dev/null < "$scanfile" || continue

  # ONE grep per file, not one per rule. The rules are distinguished by the SHAPE of the match,
  # which they already are: only rule A's starts with a slash and only rule B's with a tilde. Three
  # passes cost three process spawns per file, and process spawn is the whole cost here.
  while IFS= read -r g; do
    [ -n "$g" ] || continue
    judge "$f" "${g%%:*}" "${g#*:}"
    # LC_ALL=C is the second half of #211 and it is not cosmetic: under a territory UTF-8 locale
    # grep stays off its byte-wise DFA and the anchored regex is still quadratic (162 s at 1 MB
    # against 0.08 s under C). The history pipeline above has always run under C; this is the path
    # a hook takes, and it did not. The cost is the letter-class narrowing named in the header.
  done < <(LC_ALL=C grep -onE "$RE_ANY" 2>/dev/null < "$scanfile")
done

[ "$violations" -eq 0 ] || exit 1
exit 0
