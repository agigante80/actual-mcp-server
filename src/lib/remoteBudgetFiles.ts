import config from '../config.js';
import { loginOverFetch } from './apiLogin.js';
import { withOpTimeout } from './opTimeout.js';

const TOKEN_TTL_MS = 60_000;
let cachedToken: { value: string; expires: number } | undefined;
let inFlight: Promise<unknown[]> | undefined;

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
        if (response.status !== 200) throw new Error('File list unavailable');
        const body = await response.json();
        if (body?.status !== 'ok' || !Array.isArray(body.data) ||
            !body.data.every((row: unknown) => row && typeof row === 'object' && !Array.isArray(row))) {
          throw new Error('Invalid file list');
        }
        return body.data.filter((row: { deleted?: unknown }) => !row.deleted);
      }
      throw new Error('File list unavailable');
    }, 'remote file listing');
  } catch {
    // An upstream response, including a login error, may carry private data.
    cachedToken = undefined;
    throw new Error('Could not list files on the configured Actual server');
  } finally {
    controller.abort();
  }
}

/** ACL-only service login; the MCP tools use the permission-filtered adapter listing. */
export function listRemoteBudgetFiles(): Promise<unknown[]> {
  inFlight ??= requestFiles().finally(() => { inFlight = undefined; });
  return inFlight;
}
