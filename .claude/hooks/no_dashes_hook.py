#!/usr/bin/env python3
"""
PreToolUse hook: block Edit, MultiEdit, Write, and Bash tool calls whose
payload contains the unicode em dash (U+2014) or the unicode en dash (U+2013).

Why: project rule (memory `feedback_no_dashes.md`) forbids these characters
in any output (chat, commits, GitHub comments, file content). The correct
fix is to restructure the sentence so no dash is needed; substituting with
a regular ASCII hyphen is also wrong.

Per Claude Code hook conventions, this script reads the tool call envelope
from stdin and writes a JSON decision to stdout. On a clean payload we
exit 0 with no output; on a violation we emit a `block` decision with a
detailed `reason` that the harness shows to the model.
"""

import json
import sys

EM_DASH = "—"
EN_DASH = "–"


def collect_texts(tool_name: str, tool_input: dict):
    """Return the list of text fields relevant to this tool name."""
    if tool_name == "Edit":
        return [tool_input.get("new_string", "")]
    if tool_name == "MultiEdit":
        return [e.get("new_string", "") for e in tool_input.get("edits", [])]
    if tool_name == "Write":
        return [tool_input.get("content", "")]
    if tool_name == "Bash":
        return [tool_input.get("command", "")]
    return []


def find_offending_chars(texts):
    """Return a list of (line_no, char_name, snippet) for every dash hit."""
    findings = []
    for text in texts:
        if not isinstance(text, str):
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            pairs = [("em dash (U+2014)", EM_DASH), ("en dash (U+2013)", EN_DASH)]
            for ch_name, ch in pairs:
                if ch in line:
                    pos = line.index(ch)
                    start = max(0, pos - 30)
                    end = min(len(line), pos + 30)
                    snippet = line[start:end].replace(ch, f">>{ch}<<")
                    findings.append((line_no, ch_name, snippet))
    return findings


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        # Bad stdin: fail open. Do not block real tool calls because the
        # hook itself could not parse its input.
        sys.exit(0)

    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input") or {}
    texts = collect_texts(tool_name, tool_input)
    findings = find_offending_chars(texts)

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
    lines.extend(
        [
            "",
            "How to fix:",
            "  Do NOT replace with a regular ASCII hyphen. Restructure the sentence so no dash is needed at all.",
            "  Patterns that work:",
            "    Introducing an explanation or list, use a colon. Example: 'Result: it shipped.'",
            "    Parenthetical aside, use commas or parentheses. Example: 'The fix, cherry-picked, landed cleanly.'",
            "    Ranges, use 'to' or 'through'. Example: 'v0.6.4 to v0.6.6'.",
            "    Strong pause or contrast, split into two sentences.",
            "",
            "Reference: memory file feedback_no_dashes.md (project memory).",
        ]
    )
    reason = "\n".join(lines)

    output = {
        "decision": "block",
        "reason": reason,
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }
    print(json.dumps(output))
    sys.exit(0)


if __name__ == "__main__":
    main()
