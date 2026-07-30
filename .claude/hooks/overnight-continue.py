#!/usr/bin/env python3
# overnight-continue-version: 1
"""Stop hook for the working-overnight run.

Keeps a single overnight cycle from idling to a stop on a question. It is a
safety net, not the loop engine: /loop drives the run across cycles, and Claude
Code caps a Stop hook at 8 consecutive blocks, so this hook never tries to
sustain the loop by itself.

Contract (verified against Claude Code CLI 2.1.207):
  stdin  <- Stop payload JSON (cwd, stop_hook_active, ...)
  stdout -> continue: {"decision": "block", "reason": "..."} ; else nothing
  exit   -> ALWAYS 0. Continuation is signalled on stdout, never by exit code.

Fail-open means ALLOW STOP: on any error, a non-dict payload, an already-active
continuation, or a missing manifest, emit nothing and exit 0. A broken hook must
never be able to hold a session open.
"""
import json
import os
import sys

SENTINEL = os.path.join(".claude", "overnight", "active.md")

REASON = (
    "working-overnight run active: continue the loop. Pull the next work item, "
    "defer you-only decisions to .claude/overnight/decisions.md, and wind down "
    "at queue-empty or the backstop."
)


def project_dir(payload):
    return (os.environ.get("CLAUDE_PROJECT_DIR")
            or payload.get("cwd")
            or os.getcwd())


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0  # fail open: unparseable input allows the stop
    if not isinstance(payload, dict):
        return 0  # not a hook payload: allow stop
    if payload.get("stop_hook_active"):
        return 0  # already continuing from a prior block: do not push the cap
    if not os.path.exists(os.path.join(project_dir(payload), SENTINEL)):
        return 0  # no armed run: dormant
    print(json.dumps({"decision": "block", "reason": REASON}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
