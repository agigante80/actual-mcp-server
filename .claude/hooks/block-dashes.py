#!/usr/bin/env python3
# block-dashes-version: 1
"""
Canonical forge-kit PreToolUse hook: block the unicode em dash (U+2014) and
en dash (U+2013) from being written into files or shell commands.

This is the superset of the four hand-rolled variants found across projects.
It covers Write, Edit, MultiEdit, NotebookEdit, and Bash, reports each hit with
line and surrounding context, and fails OPEN (never blocks a real tool call
because the hook could not parse its own input).

Why a hook and not a guideline: the no-dash rule is easy for a model to forget
mid-output. A PreToolUse deny is the only reliable enforcement point.

Wiring (project .claude/settings.json):
  {
    "hooks": {
      "PreToolUse": [
        {
          "matcher": "Write|Edit|MultiEdit|NotebookEdit|Bash",
          "hooks": [
            { "type": "command",
              "command": "python3 .claude/hooks/block-dashes.py" }
          ]
        }
      ]
    }
  }

The correct fix on a hit is to RESTRUCTURE the sentence, never to swap in an
ASCII hyphen. See the guidance emitted in the block reason.
"""

import json
import sys

EM_DASH = "—"
EN_DASH = "–"


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
