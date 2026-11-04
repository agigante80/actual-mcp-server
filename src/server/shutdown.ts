/**
 * #632: the HTTP server's SIGTERM / SIGINT handler, as a factory with injected effects so unit
 * tests can drive every branch without exiting (the pattern of src/lib/processHandlers.ts).
 *
 * A listener on SIGTERM or SIGINT replaces Node's default exit, so the handler must end the
 * process itself. Before #632 it ran the session cleanup and returned, the listener stayed open,
 * and the process lived until Docker's SIGKILL.
 *
 * Order, chosen so neither failure the gate named can happen:
 *   1. Mark the server as shutting down. The HTTP layer refuses every new request with 503 from
 *      here on, so no request can start after its session is removed and fall back to a fresh
 *      Actual login whose write the exit would then cut.
 *   2. Stop accepting connections and drop idle keep-alive sockets.
 *   3. Wait for in-flight work: requests already past the gate, and writes still queued in the
 *      adapter's debounce window. Without this step a write queued just before the signal was
 *      never sent, while the exit code still said clean.
 *   4. Run the cleanup: it closes every session (ending open SSE streams) and shuts the pooled
 *      Actual connections down under the api lock, so a write already in flight finishes first.
 *   5. Exit 0. Waiting for the listener's close callback is deliberately NOT a step: an open SSE
 *      stream is never idle, so that wait would hit the deadline on every shutdown with a client.
 *
 * A cleanup that throws exits 1. A shutdown still running at the deadline exits 1. A second
 * signal while shutting down exits 1 at once: that is the operator's escape hatch (a second
 * Ctrl-C), and `docker stop` sends only one SIGTERM, so a supervised stop never reaches it.
 *
 * Step 3 has its own budget (the deadline minus a 2 s cleanup reserve by default, never less than
 * half the deadline). A request that never finishes would otherwise use the whole deadline and
 * step 4 would never run, leaving every pooled connection unclosed; past the budget the shutdown
 * logs a warning, runs the cleanup anyway, and then exits 1, never 0: the cleanup may have cut
 * that request's write, so the exit code must not say the shutdown was clean.
 *
 * The `shuttingDown` state is per handler, so several servers in one test process do not share it.
 */

export interface ShutdownLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ShutdownDeps {
  /** Stop accepting connections and close idle ones. Must not wait for active ones. */
  closeListener: () => void;
  /** Resolve once in-flight requests and queued writes are done. Bounded by the deadline. */
  awaitInFlight: () => Promise<void>;
  /** Close sessions and pooled connections. */
  cleanup: () => Promise<void>;
  exit: (code: number) => void;
  logger: ShutdownLogger;
  deadlineMs: number;
  /** Arm the deadline. Default: an unref'd setTimeout, so the timer never holds the process open. */
  armDeadline?: (fn: () => void, ms: number) => void;
  /** How long step 3 may take before the cleanup runs regardless. Default: see CLEANUP_RESERVE_MS. */
  inFlightBudgetMs?: number;
  /** Resolve after `ms`. Default: an unref'd setTimeout. */
  waitBudget?: (ms: number) => Promise<void>;
}

export interface ShutdownHandler {
  shutdown: (signal: NodeJS.Signals) => Promise<void>;
  isShuttingDown: () => boolean;
}

const defaultArmDeadline = (fn: () => void, ms: number) => { setTimeout(fn, ms).unref(); };
/** Time the default in-flight budget leaves for step 4 before the deadline. */
const CLEANUP_RESERVE_MS = 2000;

const defaultWaitBudget = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms).unref(); });

export function createShutdownHandler(deps: ShutdownDeps): ShutdownHandler {
  const { closeListener, awaitInFlight, cleanup, exit, logger, deadlineMs } = deps;
  const armDeadline = deps.armDeadline ?? defaultArmDeadline;
  const waitBudget = deps.waitBudget ?? defaultWaitBudget;
  const inFlightBudgetMs = deps.inFlightBudgetMs
    ?? Math.max(Math.floor(deadlineMs / 2), deadlineMs - CLEANUP_RESERVE_MS);
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      logger.warn(`[SERVER] Second ${signal} during shutdown, exiting now`);
      exit(1);
      return;
    }
    shuttingDown = true;
    logger.info(`[SERVER] ${signal} received, shutting down`);
    armDeadline(() => {
      logger.warn(`[SERVER] Shutdown exceeded ${deadlineMs}ms, forcing exit`);
      exit(1);
    }, deadlineMs);
    try {
      closeListener();
      const drained = await Promise.race([
        awaitInFlight().then(() => true),
        waitBudget(inFlightBudgetMs).then(() => false),
      ]);
      if (!drained) logger.warn(`[SERVER] In-flight work still running after ${inFlightBudgetMs}ms, cleaning up anyway`);
      await cleanup();
      if (!drained) {
        exit(1);
        return;
      }
    } catch (err) {
      logger.error('[SERVER] Shutdown cleanup failed', { error: err instanceof Error ? err.name : 'unknown' });
      exit(1);
      return;
    }
    exit(0);
  };

  return { shutdown, isShuttingDown: () => shuttingDown };
}

interface GateRequest { method: string; path: string }
interface GateResponse {
  set(field: string, value: string): GateResponse;
  status(code: number): GateResponse;
  json(body: unknown): unknown;
  once(event: 'close', fn: () => void): unknown;
}

/**
 * #632: the first middleware. Refuses every request with 503 once a shutdown has started, and
 * counts the requests it admits until their response closes. A GET on the MCP path is the
 * long-lived SSE stream, which only the session cleanup ends, so it is not counted (awaiting it
 * would hit the deadline on every shutdown with a client).
 */
export function createShutdownGate(handler: Pick<ShutdownHandler, 'isShuttingDown'>, mcpPath: string) {
  // Express routes `app.get(httpPath)` case-insensitively and accepts a trailing slash, so the
  // stream can arrive as `/MCP` or `/mcp/`; an exact match would count it and stall step 3.
  const norm = (p: string) => p.toLowerCase().replace(/\/+$/, '');
  const target = norm(mcpPath);
  const isMcpPath = (p: string) => norm(p) === target;
  let inFlight = 0;
  const middleware = (req: GateRequest, res: GateResponse, next: () => void) => {
    if (handler.isShuttingDown()) {
      res.set('Connection', 'close').status(503).json({ error: 'Server is shutting down' });
      return;
    }
    if (!(req.method === 'GET' && isMcpPath(req.path))) {
      inFlight++;
      res.once('close', () => { inFlight--; });
    }
    next();
  };
  return { middleware, inFlight: () => inFlight };
}
