#!/usr/bin/env python3
"""
PreToolUse(Bash) hook: hard release gate.

Rule (user-mandated, non-negotiable): we do not even consider merging to `main`
unless the `develop` branch is BOTH
  1. version-bumped (origin/develop's VERSION is strictly ahead of the latest
     published vX.Y.Z tag), AND
  2. green in GitHub Actions (the latest CI run for origin/develop's HEAD commit
     completed with conclusion `success`; no failed/cancelled/in-progress run).

The hook fires only on git commands that target `main` (merge into main, push to
main, push of a release tag). For every other command it allows through (exit 0,
no output), exactly like the no_dashes hook.

Fail-closed: if the command targets main and the gate CANNOT be verified (no
network, `gh` missing/unauthenticated, no tags, no CI run found), the hook BLOCKS.
A hard rule that silently passes when it cannot check is not a hard rule.

IO contract mirrors .claude/hooks/no_dashes_hook.py: read the tool envelope from
stdin; on a block emit a JSON `decision: block` with an actionable `reason`.
"""

import json
import re
import subprocess
import sys

TIMEOUT = 25  # seconds for the whole network-bound check budget


def run(args, timeout=TIMEOUT):
    """Run a command, return (rc, stdout, stderr). rc=127 if it could not run."""
    try:
        p = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout
        )
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as exc:
        return 127, "", str(exc)


def parse_version(s):
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", s or "")
    return tuple(int(x) for x in m.groups()) if m else None


def is_main_release_op(cmd):
    """Return a short label if cmd targets main / a release, else None."""
    if not isinstance(cmd, str):
        return None
    # Only consider git commands.
    if "git" not in cmd:
        return None

    # Strip quoted strings (commit messages, gh comment/PR bodies, tag messages)
    # BEFORE matching, so a literal "main" or "vX.Y.Z" inside a message does not
    # trigger the gate. Without this, `git commit -m "... main ..."` or
    # `gh ... --body "... v1.2.3 ..."` on a develop push false-positives as a main
    # operation. The actual ref arguments live outside quotes, so this keeps real
    # `git push origin main` / release-tag detection intact.
    bare = re.sub(r"'[^']*'", "''", cmd)
    bare = re.sub(r'"[^"]*"', '""', bare)

    # Push to the main branch, the tags, or a release tag. Require the token to
    # appear after `git push` in the de-quoted command.
    push_m = re.search(r"\bgit\s+push\b(.*)$", bare, re.DOTALL)
    if push_m:
        push_args = push_m.group(1)
        # `main` as a ref argument (e.g. `git push origin main`, `... HEAD:main`).
        if re.search(r"(^|[\s:/])main(\s|$|/|:)", push_args):
            return "push to main"
        if re.search(r"--tags\b", push_args):
            return "push tags"
        if re.search(r"(^|[\s:/])v\d+\.\d+\.\d+\b", push_args):
            return "push release tag"

    # Merge into main: either an explicit `checkout main` in the same command,
    # or `git merge` while the current branch is main.
    if re.search(r"\bgit\s+merge\b", bare):
        if re.search(r"\bcheckout\s+main\b", bare):
            return "merge into main"
        rc, branch, _ = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], timeout=5)
        if rc == 0 and branch == "main":
            return "merge into main"

    return None


def latest_published_tag():
    """Highest vX.Y.Z tag on origin, or None if it cannot be determined."""
    rc, out, _ = run(["git", "ls-remote", "--tags", "origin"])
    if rc != 0:
        return None
    versions = []
    for line in out.splitlines():
        m = re.search(r"refs/tags/v(\d+)\.(\d+)\.(\d+)(?!\^)", line)
        if m and "^{}" not in line:
            versions.append(tuple(int(x) for x in m.groups()))
    return max(versions) if versions else None


def check_bump():
    """(ok, message). ok=True only if origin/develop VERSION is ahead of latest tag."""
    run(["git", "fetch", "origin", "develop", "--tags", "--quiet"])
    rc, dev_ver_raw, _ = run(["git", "show", "origin/develop:VERSION"], timeout=10)
    if rc != 0:
        return False, "cannot read origin/develop:VERSION (fetch/branch problem)"
    dev_ver = parse_version(dev_ver_raw)
    latest = latest_published_tag()
    if dev_ver is None:
        return False, f"origin/develop VERSION is unparseable: {dev_ver_raw!r}"
    if latest is None:
        return False, "cannot list remote tags (offline?); refusing to assume bumped"
    dv = ".".join(map(str, dev_ver))
    lv = ".".join(map(str, latest))
    if dev_ver > latest:
        return True, f"develop {dv} is ahead of latest tag v{lv}"
    return False, f"develop VERSION {dv} is NOT ahead of latest tag v{lv}; bump develop first"


def check_green():
    """(ok, message). ok=True only if origin/develop HEAD's CI run is success."""
    rc, sha, _ = run(["git", "rev-parse", "origin/develop"], timeout=10)
    if rc != 0 or not sha:
        return False, "cannot resolve origin/develop HEAD"
    rc, out, err = run(
        [
            "gh", "run", "list", "--commit", sha,
            "--json", "conclusion,status,workflowName,url",
            "-L", "30",
        ]
    )
    if rc != 0:
        return False, f"could not query GitHub Actions for {sha[:8]} (gh missing/unauth/offline): {err[:120]}"
    try:
        runs = json.loads(out or "[]")
    except (json.JSONDecodeError, ValueError):
        return False, "could not parse gh run list output"
    if not runs:
        return False, f"no CI run found for develop HEAD {sha[:8]}; push has not been checked yet"
    bad = []
    pending = []
    for r in runs:
        status = r.get("status")
        concl = r.get("conclusion")
        name = r.get("workflowName", "?")
        if status != "completed":
            pending.append(f"{name} ({status})")
        elif concl not in ("success", "skipped", "neutral"):
            # `skipped`/`neutral` are benign non-failures (a conditional or
            # path-filtered workflow that chose not to run), NOT a red CI. Only
            # real failures (failure/cancelled/timed_out/startup_failure) block.
            bad.append(f"{name}: {concl} {r.get('url','')}")
    if bad:
        return False, "CI is RED on develop HEAD: " + "; ".join(bad[:5])
    if pending:
        return False, "CI still running on develop HEAD: " + "; ".join(pending[:5])
    return True, f"CI green on develop HEAD {sha[:8]} ({len(runs)} run(s))"


def block(label, reasons):
    body = [
        f"BLOCKED: release gate. This command looks like a {label} operation.",
        "",
        "Hard rule: do not merge/push to main unless develop is BOTH version-bumped",
        "AND green in GitHub Actions. Status:",
    ]
    for ok, msg in reasons:
        body.append(f"  [{'PASS' if ok else 'FAIL'}] {msg}")
    body += [
        "",
        "Resolve the FAIL item(s) on develop first:",
        "  - not bumped: run `npm run version:bump -- patch` on develop, commit, push.",
        "  - red/missing CI: fix the failing CI/CD Pipeline run and push until it is green.",
        "Then retry the merge to main.",
    ]
    reason = "\n".join(body)
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


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)  # bad stdin: fail open (do not block unrelated calls)

    if payload.get("tool_name") != "Bash":
        sys.exit(0)
    cmd = (payload.get("tool_input") or {}).get("command", "")

    label = is_main_release_op(cmd)
    if not label:
        sys.exit(0)  # not a main-targeting op: allow

    bump_ok, bump_msg = check_bump()
    green_ok, green_msg = check_green()
    if bump_ok and green_ok:
        sys.exit(0)  # gate satisfied: allow the merge/push
    block(label, [(bump_ok, bump_msg), (green_ok, green_msg)])


if __name__ == "__main__":
    main()
