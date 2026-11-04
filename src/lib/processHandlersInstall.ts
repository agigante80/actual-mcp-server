/**
 * #622: side-effect module that registers the process-level handlers. src/index.ts imports
 * it SECOND, right after ./node-version-guard.js (#275), so the handlers are armed before
 * any other module evaluates. The logger arrives later through attachProcessLogger, once
 * src/index.ts has set MCP_STDIO_MODE and loaded src/logger.ts; until then the handlers
 * write one fixed JSON line to stderr.
 *
 * INVARIANT: no import of logger.ts or loggerFactory.ts (see processHandlers.ts).
 */
import { writeSync } from 'node:fs';
import { createProcessHandlers, type ProcessHandlerDeps } from './processHandlers.js';

let attached: ReturnType<ProcessHandlerDeps['getLogger']>;

/** Route the survivable records through the logger from now on. */
export function attachProcessLogger(logger: NonNullable<typeof attached>): void {
  attached = logger;
}

const handlers = createProcessHandlers({
  exit: (code) => process.exit(code),
  writeSync: (fd, text) => {
    writeSync(fd, text);
  },
  getLogger: () => attached,
});

process.on('unhandledRejection', handlers.onUnhandledRejection);
process.on('uncaughtException', handlers.onUncaughtException);
