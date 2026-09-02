#!/usr/bin/env python3
# block-closing-keyword-version: 1
"""
PreToolUse(Bash) hook: block a git commit whose message would make GitHub CLOSE
an issue the author is deliberately leaving open.

WHY THIS EXISTS, and why a hook rather than a convention.

GitHub treats a closing keyword followed by an issue reference as an instruction
to close. It does not care that the surrounding sentence says the opposite, so a
line written specifically to record that a ticket was NOT fixed closes it anyway.
When the commit reaches the default branch the issue is closed as COMPLETED,
attributed to the commit author.

Two properties make it nearly undetectable by eye:

1. Closing keywords are INERT on non-default branches, so in a develop-to-main
   workflow the close fires when the release fast-forwards main, days after the
   commit was written, detached from anything anyone did that day.
2. In the timeline it is indistinguishable from a deliberate close.

It fired three times in this repository in one afternoon (#391, #414, #416), the
second and third AFTER the hazard had been filed as a ticket and written into the
project's memory, by the same author, using the same phrase. A convention that
its own author breaks twice within two hours of documenting it is not a control.

WHAT IT DOES NOT DO. It does not ban closing keywords. Roughly twenty commits in
this repository use `Closes #N` correctly and deliberately, and banning those
would be wrong and would train people to bypass the hook, which is worse than not
having one. It keys on NEGATION: a phrase saying a ticket is not being fixed,
sitting immediately before its number.

TWO PRECISION RULES, both learned by this hook misfiring on its own development:

1. `git commit` must be INVOKED, not mentioned. The first version matched the
   substring anywhere, so it blocked a call that was writing DOCUMENTATION about
   this hook, and then blocked the edits to its own test file. A guard that fires
   on text about itself is noise, and noise is how a guard gets switched off.
2. When the message is passed with -m, only that is scanned. It is the text
   GitHub will read; the rest of the command line is not.

Fails OPEN on anything it cannot parse. A missed deferral note is a tracker
inaccuracy; a hook that wedges every commit in the repo is an outage.
"""

import json
import re
import sys

# Keywords GitHub acts on. Case-insensitive, optional colon, then whitespace.
KEYWORDS = r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)"
REF = r"#\d+"

# The ONE dangerous shape, and being precise here is the whole design.
#
# GitHub acts only when the reference IMMEDIATELY follows the keyword, with at most a
# colon and whitespace between them. So "fixed: #391" closes and "fixed, see #391" does
# not. An earlier draft also flagged a reference-first form and allowed slack characters
# between keyword and reference. Both were wrong in the expensive direction: they blocked
# messages GitHub would never act on, including the very remedy this hook recommends.
PATTERNS = [
    (
        re.compile(
            r"(?:rather\s+than|instead\s+of|not|n't|never|without|short\s+of|no)\s+"
            + KEYWORDS + r"\s*:?\s+" + REF,
            re.IGNORECASE,
        ),
        "a negation immediately before a closing keyword and its issue reference",
    ),
]

# The invocation must sit at a statement boundary: the start of the command, or after a
# shell separator, optionally preceded by environment assignments. `(` is deliberately NOT
# a boundary here: it appears constantly inside quoted prose and was the source of the
# false positives that blocked this hook's own development.
COMMIT_RE = re.compile(
    r"(?:\A|[;&|\n]|&&|\|\|)\s*(?:\w+=\S+\s+)*git\s+"
    r"(?:-C\s+\S+\s+|-\S+\s+|--\S+=\S+\s+)*commit\b"
)

# A -m message in single or double quotes. When present, it is the only thing scanned.
MESSAGE_RE = re.compile(
    r"""-m\s+("(?:[^"\\]|\\.)*"|'(?:[^']|'\\'')*')""",
    re.DOTALL,
)


def is_git_commit(command: str) -> bool:
    return bool(COMMIT_RE.search(command or ""))


def scan_target(command: str) -> str:
    """The text GitHub would actually read, when it can be isolated.

    FAILS TOWARD SCANNING MORE, and review found out why the hard way. The narrowing was matching
    `-m "..."` with a backslash-escape rule, which is not the shape this project's commits take:
    the standard form here is `git commit -m "$(cat <<'EOF' ... EOF\n)"`, whose body contains RAW
    double quotes. The first one terminated the match, and everything after it, including the
    trailing deferral line, went unscanned. Measured on this repository: 19 of the last 30 commit
    bodies contain a quote character, and the deferral line is always last. So the hook would NOT
    have caught the real #416 commit, which is the incident it was written for.

    The precision that stopped the false positives is COMMIT_RE's invocation boundary, not this
    narrowing, so widening here costs nothing that was paid for. Narrow ONLY when the extraction
    plausibly covers the message: no heredoc, and the last extracted message reaches the tail of
    the command.
    """
    command = command or ""
    if "<<" in command:
        return command                       # heredoc: the body is not inside the -m token
    matches = list(MESSAGE_RE.finditer(command))
    if not matches:
        return command
    # If anything substantive follows the last extracted message, the extraction did not cover the
    # message and the narrowed scan would be blind to it.
    # Trailing OPTIONS are fine and must not force a widened scan: `--author="..."` is not the
    # message and GitHub never reads it. Anything else after the last message means the extraction
    # did not cover the message, so widen.
    tail = command[matches[-1].end():].strip()
    option_tail = r"""[\s;&|)'"]*(?:--?[\w-]+(?:=(?:"[^"]*"|'[^']*'|\S+))?\s*)*"""
    if tail and not re.fullmatch(option_tail, tail):
        return command
    return "\n".join(m.group(1) for m in matches)


def find_hits(text: str):
    hits = []
    for pattern, why in PATTERNS:
        for m in pattern.finditer(text or ""):
            hits.append((m.group(0).strip(), why))
    return hits


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)  # fail open
    if not isinstance(payload, dict):
        sys.exit(0)

    if payload.get("tool_name") != "Bash":
        sys.exit(0)
    command = (payload.get("tool_input") or {}).get("command", "")
    if not isinstance(command, str) or not is_git_commit(command):
        sys.exit(0)

    hits = find_hits(scan_target(command))
    if not hits:
        sys.exit(0)

    lines = [
        "Project rule violated. This commit message would make GitHub CLOSE an issue",
        "you are saying you did NOT fix.",
        "",
        "A closing keyword followed by an issue reference closes that issue, even when the",
        "sentence around it says the opposite. The close fires when the commit reaches the",
        "DEFAULT BRANCH, which in this repo means during a release, days later, looking like",
        "a deliberate close. This has already happened three times here: #391, #414, #416.",
        "",
        "Findings:",
    ]
    for text, why in hits[:10]:
        lines.append("  %r :: %s" % (text, why))
    if len(hits) > 10:
        lines.append("  (and %d more)" % (len(hits) - 10))
    lines += [
        "",
        "How to fix: break the ADJACENCY between the keyword and the reference.",
        "  Put a comma and 'see' between them, or name the ticket before the verb.",
        "  'Filed rather than fixed, see #391'   /   'Filed as #391 rather than fixed here'",
        "",
        "A deliberate 'Closes #N' is NOT blocked and never should be: this hook keys on",
        "the negation, not on the keyword.",
    ]
    reason = "\n".join(lines)

    print(json.dumps({
        "decision": "block",
        "reason": reason,
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }))
    sys.exit(0)


if __name__ == "__main__":
    main()
