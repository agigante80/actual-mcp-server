#!/usr/bin/env python3
# block-dashes-version: 5
"""
Canonical forge-kit PreToolUse hook: block the unicode em dash (U+2014) and
en dash (U+2013) from being written into files or shell commands.

This is the superset of the four hand-rolled variants found across projects.
It covers Write, Edit, MultiEdit, NotebookEdit, and Bash, reports each hit with
line and surrounding context, and fails OPEN (never blocks a real tool call
because the hook could not parse its own input).

Why a hook and not a guideline: the no-dash rule is easy for a model to forget
mid-output. A PreToolUse deny is the only reliable enforcement point.

Two ways this hook reaches a project, and the opt-in rule that separates them:

1. Registered by the plugin (hooks/hooks.json, active in EVERY project where
   forge-kit-governance is enabled). The no-dash rule is opinionated, so a
   plugin-registered copy enforces ONLY where the project opted in by creating
   the sentinel file `.claude/no-dashes`. Everywhere else it exits silently.

2. Installed into the project itself (`.claude/hooks/block-dashes.py`, wired in
   that project's settings.json, which is what forge-adapt does for a cloned
   library). Copying the script into the project IS the opt-in, so this copy
   always enforces and needs no sentinel.

The two are told apart by this file's own path shape: a copy sitting in a
`.claude/hooks/` directory is a deliberate project install; anything else is not.
That keeps pre-existing project installs working unchanged, and it holds whatever
the working directory is and whichever variables Claude Code happens to export.

Wiring is handled for you, but note that hooks/hooks.json is read only when the
forge-kit-governance PLUGIN is installed, which the quick-start flow does not do
(it installs forge-kit-adapt alone). Without it, forge-adapt falls back to a
project-local copy. See hooks/README.md for both shapes.

The correct fix on a hit is to RESTRUCTURE the sentence, never to swap in an
ASCII hyphen. See the guidance emitted in the block reason.
"""

import json
import os
import pathlib
import sys

EM_DASH = "—"
EN_DASH = "–"


SENTINEL = pathlib.Path(".claude") / "no-dashes"


def _resolve(path):
    """Absolute Path, or None if the value is empty or unresolvable."""
    if not path:
        return None
    try:
        return pathlib.Path(path).resolve()
    except (OSError, ValueError, TypeError):
        return None


def _is_project_install(here: pathlib.Path) -> bool:
    """True when this script sits in a project's own `.claude/hooks/` directory.

    Keyed on the path SHAPE, so it holds no matter what the working directory is
    and whether CLAUDE_PROJECT_DIR was exported. That is the whole point. An
    earlier version inferred "project install" from `here` being under the
    project root, falling back to the payload's `cwd` when the variable was
    missing. `cwd` is the session's working directory, not the project root, so
    starting a session in a subdirectory made the check fail, sent control down
    the plugin branch, looked for the sentinel in the wrong place, and silently
    disabled the guard.
    """
    parent = here.parent
    return parent.name == "hooks" and parent.parent.name == ".claude"


def enforcement_enabled(payload: dict) -> bool:
    """True when this project has opted in to the no-dash rule.

    A copy installed into the project is itself the opt-in and always enforces.
    The plugin-registered copy is live in every project, so it enforces only
    where `.claude/no-dashes` exists.

    Fails OPEN when neither can be established, in keeping with the rest of this
    hook: never block a call we cannot reason about.
    """
    here = _resolve(__file__)
    if here is None:
        return False
    if _is_project_install(here):
        return True

    # Not a `.claude/hooks/` copy: either the plugin's own, or this repo running
    # the hook against itself from `plugins/<group>/hooks/`. Both need the root.
    root = _resolve(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or "")
    if root is None:
        return False
    try:
        here.relative_to(root)
    except ValueError:
        return (root / SENTINEL).exists()   # plugin copy: opt-in required
    return True                             # inside the project: opt-in implied


def collect_texts(tool_name: str, tool_input: dict):
    """Return the list of new-content text fields relevant to this tool."""
    if tool_name == "Edit":
        return [tool_input.get("new_string", "")]
    if tool_name == "MultiEdit":
        return [e.get("new_string", "") for e in tool_input.get("edits", [])]
    if tool_name == "Write":
        return [tool_input.get("content", "")]
    if tool_name == "NotebookEdit":
        return [tool_input.get("new_source", "")]
    if tool_name == "Bash":
        return [tool_input.get("command", "")]
    return []


def find_offending_chars(texts):
    """Return (line_no, char_name, snippet) for every dash hit."""
    findings = []
    for text in texts:
        if not isinstance(text, str):
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            for ch_name, ch in (("em dash (U+2014)", EM_DASH), ("en dash (U+2013)", EN_DASH)):
                if ch in line:
                    pos = line.index(ch)
                    snippet = line[max(0, pos - 30):pos + 30].replace(ch, f">>{ch}<<")
                    findings.append((line_no, ch_name, snippet))
    return findings


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)  # fail open
    if not isinstance(payload, dict):
        sys.exit(0)  # fail open: a JSON array/scalar is not a hook payload

    if not enforcement_enabled(payload):
        sys.exit(0)

    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input") or {}
    findings = find_offending_chars(collect_texts(tool_name, tool_input))

    if not findings:
        sys.exit(0)

    lines = [
        "Project rule violated. Tool input contains a unicode em or en dash.",
        "",
        "Findings (line / kind / context):",
    ]
    for line_no, ch_name, snippet in findings[:10]:
        lines.append(f"  line {line_no}: {ch_name} :: {snippet!r}")
    if len(findings) > 10:
        lines.append(f"  (and {len(findings) - 10} more)")
    lines += [
        "",
        "How to fix (do NOT substitute an ASCII hyphen; restructure instead):",
        "  Explanation or list -> colon. 'Result: it shipped.'",
        "  Parenthetical aside -> commas or parentheses. 'The fix, cherry-picked, landed.'",
        "  Range -> 'to' or 'through'. 'v0.6.4 to v0.6.6'.",
        "  Strong pause or contrast -> split into two sentences.",
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
