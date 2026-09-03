/**
 * #383: the stdio half of the E2E transport seam.
 *
 * `docker-all-tools.e2e.spec.ts` drives the whole tool surface through ONE fixture (#375 collapsed
 * 154 direct call sites into it), so covering the second transport is a second implementation of
 * that fixture rather than an edit to every test. This file is that implementation.
 *
 * WHY IT SPAWNS FROM THE HOST. The obvious place to put this is inside the `e2e-test-runner`
 * container, next to the HTTP run. It cannot go there: that container mounts only `tests/`, the
 * Playwright config and the two package files, so it has neither the server's `dist/` nor a docker
 * socket, and there is no route from it to a stdio server. Giving it the socket would hand the test
 * runner control of the daemon to save a process boundary. So the stdio project runs on the HOST,
 * exactly as `tests/manual/mcp-client-stdio.js` already does, and reaches the server the same way:
 * `docker exec -i` into the container that is already running.
 *
 * DATA-DIR ISOLATION IS LOAD BEARING, and this is the part that is cheap to get wrong silently.
 * `docker exec` inherits `MCP_BRIDGE_DATA_DIR` from the container, which is the directory the HTTP
 * server is already using. Two `@actual-app/api` instances must never share one budget cache: that
 * is this project's documented cause of data-dir contention hangs, and it wedged the environment
 * during #280 when a stale budget directory carrying the same cloudFileId blocked every
 * re-download until it was moved out. So the child gets its own directory, and `-u app` because
 * `docker exec` defaults to root while the server runs as uid 1001, and root-owned files inside
 * the volume are unusable by the server afterwards.
 */

import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { pace, extractResult } from '../shared/e2e-helpers.js';

/** The container the stdio server is exec'd into. Overridable for a differently-named stack. */
export const STDIO_CONTAINER = process.env.MCP_STDIO_CONTAINER || 'mcp-server-e2e-test';

/**
 * Its own budget cache, never the one the HTTP server is using. See the header.
 *
 * It is its OWN named volume (`mcp-test-stdio-data`), declared in docker-compose.test.yaml, and
 * both halves of that are forced. It cannot live under /app/data because that is the HTTP
 * server's cache and the whole point is not to share one. It cannot live under /tmp either:
 * this image's root filesystem is read-only, which is exactly how the first attempt failed, with
 * every stdio test erroring in ~50ms because the worker fixture could not create its directory.
 *
 * `tests/manual/mcp-client-stdio.js` uses /tmp for the same isolation reason, and that works
 * there only because the dev image it targets has a writable root. Do not copy its path here.
 */
const DATA_DIR = process.env.MCP_STDIO_DATA_DIR || '/app/stdio-data';

/** Where the compose entrypoint gets the sync id. See the note at the transport below. */
const SYNC_ID_FILE = process.env.MCP_STDIO_SYNC_ID_FILE || '/tmp/actual-sync-id.txt';

export type StdioSession = {
  raw(tool: string, args?: Record<string, unknown>): Promise<any>;
  call(tool: string, args?: Record<string, unknown>): Promise<any>;
  close(): Promise<void>;
};

/**
 * Connect once per worker. Opening a `docker exec` per TEST would pay a process spawn and a full
 * api init 100+ times, which turns a 1.4 minute suite into something nobody runs.
 */
export async function openStdioSession(): Promise<StdioSession> {
  // Pre-create the data dir and make it writable by the server's user. The server mkdirs it on
  // some paths, but the adapter's legacy init `scandir`s it first, so an absent directory
  // surfaces as a bare ENOENT with no hint about where it came from.
  //
  // LOUD, not best-effort. The first version swallowed this, and the result was that the run
  // failed later at the first TOOL CALL with a bare `ENOENT: scandir '<dir>'` from inside the
  // server, which points at nothing. The setup step is where the diagnosis belongs.
  try {
    // As ROOT, and only to hand the directory to uid 1001. A freshly created named volume mounts
    // root-owned, so the `app` user the server runs as cannot write into it, and the failure would
    // otherwise appear deep inside the first tool call rather than here.
    execFileSync(
      'docker',
      ['exec', STDIO_CONTAINER, 'sh', '-c', `mkdir -p ${DATA_DIR} && chown -R app:app ${DATA_DIR}`],
      { stdio: 'pipe' },
    );
  } catch (err) {
    const detail = (err as { stderr?: Buffer }).stderr?.toString().trim() || (err as Error).message;
    throw new Error(
      `could not prepare the stdio data dir ${DATA_DIR} in "${STDIO_CONTAINER}": ${detail}\n` +
      `It must exist and be writable by uid 1001. docker-compose.test.yaml mounts the named ` +
      `volume mcp-test-stdio-data there for exactly this; if you are pointing at a different ` +
      `stack, give it a writable mount and set MCP_STDIO_DATA_DIR. Or the container is not running.`,
    );
  }

  // The sync id is NOT in the container's configured environment. The compose ENTRYPOINT reads it
  // from /tmp/actual-sync-id.txt (written by the bootstrap container once the budget exists) and
  // `export`s it into its own shell, and `docker exec` inherits the container's CONFIGURED env,
  // not whatever the entrypoint process exported. So the exec has to repeat that step, or the
  // server exits on config validation with "Required: ACTUAL_SERVER_URL, ACTUAL_PASSWORD,
  // ACTUAL_BUDGET_SYNC_ID" and every test fails in about 40ms. That is what the second attempt
  // at this looked like, and the message points at the client rather than at the entrypoint.
  const transport = new StdioClientTransport({
    command: 'docker',
    args: [
      'exec', '-i',
      '-u', 'app',
      '-e', `MCP_BRIDGE_DATA_DIR=${DATA_DIR}`,
      STDIO_CONTAINER,
      'sh', '-c',
      `export ACTUAL_BUDGET_SYNC_ID=$(cat ${SYNC_ID_FILE}) && exec node dist/src/index.js --stdio`,
    ],
  });

  const client = new Client({ name: 'actual-mcp-e2e-stdio', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
  } catch (err) {
    throw new Error(
      `could not open a stdio session into "${STDIO_CONTAINER}": ${(err as Error).message}\n` +
      `The container must already be running (the docker E2E stack starts it). Override the name ` +
      `with MCP_STDIO_CONTAINER.`,
    );
  }

  let closed = false;
  const close = async () => {
    // TEARDOWN. An orphaned child holds the container's data dir, which is the documented cause
    // of the contention hangs above, so this must run on every exit path including a failure.
    if (closed) return;
    closed = true;
    try { await client.close(); } catch { /* already gone */ }
  };

  const raw = async (tool: string, args: Record<string, unknown> = {}) => {
    // Same pacer instance as the HTTP client: one Actual server, one rate-limit budget.
    await pace();
    return await client.callTool({ name: tool, arguments: args });
  };

  return {
    raw,
    call: async (tool, args = {}) => extractResult(await raw(tool, args)),
    close,
  };
}
