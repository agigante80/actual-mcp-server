import config from '../config.js';
import { loginOverFetch } from './apiLogin.js';
import { withOpTimeout } from './opTimeout.js';

const TOKEN_TTL_MS = 60_000;
let cachedToken: { value: string; expires: number } | undefined;
let inFlight: Promise<unknown[]> | undefined;

// Failure reasons safe to show an operator. A login error's code can also be a slice of the
// server's reply, so anything outside this set is reported as 'unknown' (review of #691).
const SAFE_REASONS = new Set(['invalid-server-url', 'network-failure', 'redirect-refused', 'internal',
  'parse-json', 'invalid-password', 'openid-required', 'aborted', 'timeout', 'invalid-file-list']);

function failure(reason: string): Error {
  return Object.assign(new Error('File list unavailable'), { code: reason });
}

function safeReason(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && (SAFE_REASONS.has(code) || /^list-status-\d{3}$/.test(code))) return code;
  if (err instanceof Error && err.message.includes('timed out')) return 'timeout';
  return 'unknown';
}

function isFileRow(row: unknown): boolean {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return false;
  return !('groupId' in row) || row.groupId === null || typeof row.groupId === 'string';
}

async function requestFiles(): Promise<unknown[]> {
  if (!config.ACTUAL_PASSWORD) {
    cachedToken = undefined;
    throw new Error('The Actual service login requires a password');
  }
  const login = { serverUrl: config.ACTUAL_SERVER_URL, password: config.ACTUAL_PASSWORD };
  // Preserve an operator's deployment subpath, just as loginOverFetch does.
  const url = new URL(login.serverUrl);
  url.pathname = url.pathname.replace(/\/+$/, '') + '/sync/list-user-files';
  const controller = new AbortController();
  const { signal } = controller;
  try {
    return await withOpTimeout(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!cachedToken || cachedToken.expires <= Date.now()) {
          const value = await loginOverFetch(login, signal);
          signal.throwIfAborted();
          cachedToken = { value, expires: Date.now() + TOKEN_TTL_MS };
        }
        const response = await fetch(url, {
          headers: { 'X-ACTUAL-TOKEN': cachedToken.value }, redirect: 'manual', signal,
        });
        signal.throwIfAborted();
        if (response.status === 401 && attempt === 0) {
          cachedToken = undefined;
          await response.body?.cancel();
          continue;
        }
        if (response.status !== 200) throw failure(`list-status-${response.status}`);
        const body = await response.json();
        if (body?.status !== 'ok' || !Array.isArray(body.data) ||
            !body.data.every(isFileRow)) {
          throw failure('invalid-file-list');
        }
        return body.data.filter((row: { deleted?: unknown }) => !row.deleted);
      }
      throw failure('list-status-401');
    }, 'remote file listing');
  } catch (err) {
    // An upstream response, including a login error, may carry private data: only a reason
    // from the fixed set above is kept, never the original text.
    cachedToken = undefined;
    const reason = safeReason(err);
    throw Object.assign(
      new Error(`Could not list files on the configured Actual server (${reason})`), { code: reason });
  } finally {
    controller.abort();
  }
}

/** ACL-only service login; the MCP tools use the permission-filtered adapter listing. */
export function listRemoteBudgetFiles(): Promise<unknown[]> {
  inFlight ??= requestFiles().finally(() => { inFlight = undefined; });
  return inFlight;
}
