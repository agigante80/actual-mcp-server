# Session Worker Manager

**Status:** Planned — v0.6.x (Q3 2026)  
**Priority:** 🟠 Medium  
**Effort:** ~2 weeks  
**Blocker:** Most valuable when concurrent users actively share the server — pairs with [Multi-Client Support](./MULTI_CLIENT_SUPPORT.md) and [Write Coordinator](./WRITE_COORDINATOR.md)

---

## Overview

Replace the current single-process `withActualApi` pattern with **per-session Node.js Worker Threads**. Each MCP client session gets its own isolated worker — a dedicated OS thread with its own V8 context and Actual Budget connection — preventing one session's operations from blocking or corrupting another's.

**Reference Implementation:** [ZanzyTHEbar/actual-mcp-server fork](https://github.com/ZanzyTHEbar/actual-mcp-server)  
**Fork sources:**
- [`src/lib/SessionWorkerManager.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/SessionWorkerManager.ts) — manager: session registry, worker lifecycle, message routing
- [`src/lib/actualSessionWorker.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/actualSessionWorker.ts) — worker script: Actual Budget init, tool dispatch, message handler

---

## Business Value

| Today | With Session Worker Manager |
|-------|-----------------------------|
| All sessions share one Actual Budget connection and execute sequentially | Each session has its own connection — read operations across users proceed in parallel |
| If one session's budget sync hangs, all other sessions are blocked | Sessions are fully isolated — one hang does not affect any other session |
| In-memory state (loaded budget data) may bleed between sequential requests | Each worker's V8 heap is completely isolated to that session |
| Concurrency managed by a global write queue | Concurrency managed by OS-level thread scheduling per session |

For a single-user personal deployment, this change is invisible. For a shared team server with 3–10 concurrent users, it eliminates the single-file-bottleneck that causes latency spikes when users overlap.

---

## Architecture

```
HTTP Request (sessionId: "abc")
      │
      ▼
SessionWorkerManager (main thread)
  ├── Session "abc" → Worker Thread A  (./actual-data/sessions/abc/ dataDir)
  │     └── actualSessionWorker.ts
  │           ├── api.init({ dataDir: './actual-data/sessions/abc/' })
  │           ├── api.downloadBudget(syncId)
  │           └── dispatches tools on behalf of session "abc"
  │
  ├── Session "def" → Worker Thread B  (./actual-data/sessions/def/ dataDir)
  │     └── actualSessionWorker.ts
  │
  └── Session TTL: 30 min idle → worker.terminate() + dataDir cleanup
```

Each worker runs in a dedicated OS thread (Node.js `worker_threads` module). Workers never share memory except through explicit `SharedArrayBuffer` (not used here — all communication is via messages).

---

## Key Components

### `SessionWorkerManager.ts` (manager — main thread)

Maintains a registry of `Map<sessionId, { worker: Worker, lastActive: Date }>`. Provides the following API:

| Method | Description |
|--------|-------------|
| `createSession(sessionId)` | Spawns a new `Worker` for the session, sets up message handlers, starts idle TTL timer |
| `executeTool(sessionId, toolName, args)` | Posts a `WorkerRequest` to the session's worker, returns a `Promise` that resolves with the worker's response |
| `closeSession(sessionId)` | Sends shutdown message, terminates the worker, removes session data directory |
| `touchSession(sessionId)` | Resets the idle TTL timer (called automatically on every `executeTool`) |

### `actualSessionWorker.ts` (worker script — per session)

Runs inside each Worker Thread. On startup:
1. Reads `workerData.sessionId` and `workerData.dataDir` passed from manager
2. Calls `api.init({ dataDir })` and `api.downloadBudget(syncId)`
3. Enters message loop: listens for `WorkerRequest`, dispatches to adapter, replies with `WorkerResponse`

### Message Protocol

```typescript
// Manager → Worker
interface WorkerRequest {
  type: 'executeTool';
  requestId: string;    // UUID for response correlation
  toolName: string;     // e.g. 'actual_accounts_get'
  args: unknown;        // Tool arguments (Zod-validated in worker)
}

// Worker → Manager
interface WorkerResponse {
  type: 'result' | 'error';
  requestId: string;
  result?: unknown;
  error?: string;
}

// Manager → Worker (teardown)
interface WorkerShutdown {
  type: 'shutdown';
}
```

---

## Session Lifecycle

```
createSession(sessionId)
  → new Worker('./src/lib/actualSessionWorker.ts', { workerData: { sessionId, dataDir } })
  → Worker: api.init() + api.downloadBudget()
  → Session added to registry; idle TTL timer started

executeTool(sessionId, toolName, args)
  → postMessage WorkerRequest to session worker
  → Await WorkerResponse (Promise with configurable timeout, default: 60s)
  → touchSession (reset idle TTL timer)
  → Return result to HTTP layer

closeSession(sessionId) / idle TTL fires
  → postMessage { type: 'shutdown' }
  → Worker: api.shutdown() + graceful exit
  → worker.terminate() after grace period (3s)
  → Remove sessionId from registry
  → Optional: rm -rf ./actual-data/sessions/<sessionId>/ (configurable retention)
```

---

## Integration with Existing Codebase

| File | Change |
|------|--------|
| `src/actualToolsManager.ts` | Tool dispatch delegates to `SessionWorkerManager.executeTool()` instead of calling adapter functions directly |
| `src/server/httpServer.ts` | Creates session on MCP `initialize`, closes session on transport disconnect |
| `src/lib/actual-adapter.ts` | **No changes** — workers use the adapter directly inside their own V8 context |
| `src/lib/cache/ResponseCache.ts` | Must be a manager-process singleton; workers communicate cache operations via messages (see [Performance Optimization](./PERFORMANCE_OPTIMIZATION.md)) |

---

## Configuration

```bash
# New environment variables
SESSION_WORKER_MAX=20               # Maximum concurrent session workers (default: 20)
SESSION_WORKER_IDLE_TTL_MS=1800000  # Idle session TTL in ms (default: 30 min)
SESSION_DATA_DIR=./actual-data/sessions  # Base path for session-scoped Actual data dirs
SESSION_DATA_RETAIN=false           # Retain session dataDir after close for debugging
```

---

## File Structure to Create

```
src/lib/
├── SessionWorkerManager.ts    # Manager: session registry, worker lifecycle, message routing
└── actualSessionWorker.ts     # Worker script: Actual Budget init, tool dispatch

src/server/
└── httpServer.ts              # Modified: createSession / closeSession on connect / disconnect

src/
└── actualToolsManager.ts      # Modified: delegate tool dispatch to SessionWorkerManager
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Worker startup latency (~200 ms per new session) | Pre-warm a configurable pool of idle workers |
| `dataDir` disk usage grows unboundedly | TTL-based cleanup + `SESSION_WORKER_MAX` cap |
| Worker crash kills an active session | Manager catches `'error'` / `'exit'` events, respawns worker, replays last request |
| Cache state not visible across workers | `ResponseCache` singleton lives in manager; workers request cache reads/writes via message |
| Complex multi-thread debugging | Every log line includes `sessionId` + `requestId` for correlation across threads |
| `@actual-app/api` not designed for Worker Threads | Test carefully — the API uses file I/O which is thread-safe; confirm no `process.chdir()` calls |

---

## Success Criteria

- [ ] Two concurrent sessions execute read tools simultaneously without one blocking the other (verified by log timestamps)
- [ ] One worker crash does not affect other active sessions
- [ ] Idle session cleanup frees memory and disk within the configured TTL window
- [ ] Session isolation verified: a write in session A is not visible in session B until both resync
- [ ] Worker startup time P99 < 500 ms
- [ ] `SESSION_WORKER_MAX` enforced: a 21st session request queues rather than spawning an uncapped worker

---

## Related Docs

- [Write Coordinator](./WRITE_COORDINATOR.md) — entity-level locking for write operations within a session; most valuable when sessions run as parallel workers
- [Performance Optimization](./PERFORMANCE_OPTIMIZATION.md) — ResponseCache must be a manager-process singleton when workers are active
- [Multi-Client Support](./MULTI_CLIENT_SUPPORT.md) — provides the multi-user context that makes session isolation valuable

---

## Source Files in ZanzyTHEbar Fork

| File | Lines | Purpose |
|------|-------|---------|
| [`src/lib/SessionWorkerManager.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/SessionWorkerManager.ts) | — | Manager: session registry, worker lifecycle, `getWriteKeys()`, message routing |
| [`src/lib/actualSessionWorker.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/actualSessionWorker.ts) | — | Worker script: Actual Budget init, tool dispatch, message handler |

---

**Last Updated:** 2026-03-03  
**Author:** Analysis based on [ZanzyTHEbar/actual-mcp-server](https://github.com/ZanzyTHEbar/actual-mcp-server) fork study
