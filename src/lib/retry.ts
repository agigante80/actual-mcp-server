import { DEFAULT_RETRY_ATTEMPTS, DEFAULT_RETRY_BACKOFF_MS, MAX_RETRY_DELAY_MS } from './constants.js';
import { ModuleLoggers } from './loggerFactory.js';

const log = ModuleLoggers.RETRY;

export async function retry<T>(fn: () => Promise<T>, opts?: { retries?: number; backoffMs?: number }): Promise<T> {
  const retries = opts?.retries ?? DEFAULT_RETRY_ATTEMPTS;
  const backoffMs = opts?.backoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > retries) {
        log.error(`All retry attempts exhausted after ${retries} tries`, err as Error);
        throw err;
      }
      const delay = Math.min(backoffMs * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
      log.debug(`Retry attempt ${attempt}/${retries} after ${delay}ms`, { error: (err as Error).message });
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

export default retry;
