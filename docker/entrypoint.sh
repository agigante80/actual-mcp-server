#!/bin/sh
# Entrypoint for actual-mcp-server (#227).
#
# Supports PUID/PGID so the container adapts to the host's directory ownership
# (LinuxServer.io / Unraid convention). When started as root, it aligns the `app`
# user UID/GID to PUID/PGID (default 1001/1001), fixes ownership of the writable
# volumes, then drops privileges and execs the app as that user. When not started
# as root (the orchestrator forced a user), it execs the app directly without
# adjustments.
#
# Two invariants this script must keep:
#  - Fail-closed: `set -eu` so a failed remap/chown aborts BEFORE the privilege
#    drop. The app must never continue as root if the drop cannot be performed.
#  - Zero stdout: this image is shared with stdio users (Claude Desktop), where
#    stdout is reserved for JSON-RPC framing. Every informational line goes to
#    stderr (>&2). Transport selection stays in CMD (MCP_TRANSPORT_MODE); the
#    entrypoint is transport-agnostic.
set -eu

PUID="${PUID:-1001}"
PGID="${PGID:-1001}"

if [ "$(id -u)" = "0" ]; then
    # Align group, then user, to the requested IDs (-o allows non-unique IDs).
    if [ "$(id -g app)" != "$PGID" ]; then
        groupmod -o -g "$PGID" app >&2
    fi
    if [ "$(id -u app)" != "$PUID" ]; then
        usermod -o -u "$PUID" app >&2
    fi

    # The writable mounts must be owned by the runtime user.
    chown -R app:app /app/data /app/logs

    echo "Starting actual-mcp-server as UID:GID ${PUID}:${PGID}" >&2
    exec su-exec app "$@"
fi

# Not root (orchestrator forced a user): run as-is, PUID/PGID ignored.
echo "Starting actual-mcp-server as $(id -u):$(id -g) (not root; PUID/PGID ignored)" >&2
exec "$@"
