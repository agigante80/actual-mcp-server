// In-memory concurrency limiter for adapter calls (#166 split out of
// actual-adapter.ts). Self-contained: MAX_CONCURRENCY / running / queue are
// mutated ONLY by the functions here, so the mutable state never crosses a
// module boundary. It prevents bursts from overloading the Actual server.
// Intentionally tiny; replace with Bottleneck or p-queue for production.

import { DEFAULT_CONCURRENCY_LIMIT } from '../constants.js';

let MAX_CONCURRENCY = parseInt(process.env.ACTUAL_API_CONCURRENCY || String(DEFAULT_CONCURRENCY_LIMIT), 10);
let running = 0;
const queue: Array<() => void> = [];

function processQueue() {
  if (running >= MAX_CONCURRENCY) return;
  const next = queue.shift();
  if (!next) return;
  running++;
  try {
    next();
  } catch (e) {
    // next() will manage its own promise resolution
    running--;
    processQueue();
  }
}

export function withConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  if (running < MAX_CONCURRENCY) {
    running++;
    return fn().finally(() => {
      running--;
      processQueue();
    });
  }
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const r = await fn();
        resolve(r);
      } catch (err) {
        reject(err);
      } finally {
        running--;
        processQueue();
      }
    });
  });
}

export function setMaxConcurrency(n: number) {
  MAX_CONCURRENCY = n;
}

/** Read-only snapshot of the limiter state for getConcurrencyState. */
export function getConcurrencySnapshot(): { running: number; queueLength: number; maxConcurrency: number } {
  return { running, queueLength: queue.length, maxConcurrency: MAX_CONCURRENCY };
}
