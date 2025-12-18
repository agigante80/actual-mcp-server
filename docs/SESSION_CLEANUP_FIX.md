# Session Cleanup Issue - Analysis and Fix

## Problem Statement

When the MCP server restarts, session cleanup was not properly completing, which could lead to:
1. Session limit errors even though the server just restarted
2. Stale API connections not being properly closed
3. Race conditions where new connections were accepted before cleanup finished

## Root Causes Identified

### 1. **Async Constructor Issue** ⚠️

**Location**: `src/lib/ActualConnectionPool.ts` constructor

**Problem**: The constructor called `forceCloseStaleConnections()` but couldn't `await` it (constructors can't be async).

```typescript
// BEFORE (BROKEN)
constructor() {
  // ... config ...
  this.forceCloseStaleConnections(); // ❌ Not awaited!
  this.startCleanupTimer();
}
```

This meant cleanup ran asynchronously in the background while the server started accepting connections.

**Fix**: Created an async `initialize()` method and a `waitForInitialization()` that must be called before accepting connections.

```typescript
// AFTER (FIXED)
constructor() {
  // ... config ...
  this.initializationPromise = this.initialize(); // Store promise
}

private async initialize(): Promise<void> {
  await this.forceCloseStaleConnections(); // ✅ Properly awaited
  this.startCleanupTimer();
}

async waitForInitialization(): Promise<void> {
  if (this.initializationPromise) {
    await this.initializationPromise;
  }
}
```

### 2. **Missing Error Cleanup** ⚠️

**Location**: `src/lib/ActualConnectionPool.ts` - `getConnection()` method

**Problem**: If connection initialization failed (during `api.init()` or `api.downloadBudget()`), the error was thrown but the API was left in a bad state.

```typescript
// BEFORE (BROKEN)
try {
  await api.init({ ... });
  await api.downloadBudget(BUDGET_SYNC_ID);
  this.connections.set(sessionId, conn);
} catch (err) {
  logger.error(`Failed to initialize: ${err}`);
  throw err; // ❌ API left in inconsistent state
}
```

**Fix**: Added proper cleanup in the error path.

```typescript
// AFTER (FIXED)
try {
  await api.init({ ... });
  await api.downloadBudget(BUDGET_SYNC_ID);
  this.connections.set(sessionId, conn);
} catch (err) {
  logger.error(`Failed to initialize: ${err}`);
  
  // ✅ Clean up the failed connection
  try {
    const maybeApi = api as unknown as { shutdown?: Function };
    if (typeof maybeApi.shutdown === 'function') {
      await (maybeApi.shutdown as () => Promise<unknown>)();
    }
  } catch (cleanupErr) {
    // Ignore cleanup errors
  }
  
  // ✅ Ensure session is not in connections map
  this.connections.delete(sessionId);
  
  throw err;
}
```

### 3. **Integration Point**

**Location**: `src/actualConnection.ts` - `connectToActualForSession()` function

**Fix**: Added call to `waitForInitialization()` before accepting connections.

```typescript
// AFTER (FIXED)
export async function connectToActualForSession(sessionId: string) {
  if (!useConnectionPool) {
    return connectToActual();
  }
  
  try {
    // ✅ Ensure pool is initialized before accepting connections
    await connectionPool.waitForInitialization();
    await connectionPool.getConnection(sessionId);
    logger.info(`Actual API connection ready for session: ${sessionId}`);
  } catch (err) {
    logger.error(`Failed to connect to Actual for session ${sessionId}:`, err);
    throw err;
  }
}
```

## Files Modified

1. **`src/lib/ActualConnectionPool.ts`**:
   - Added `initializationPromise` property
   - Created `initialize()` private method
   - Created `waitForInitialization()` public method
   - Added error cleanup in `getConnection()` catch block

2. **`src/actualConnection.ts`**:
   - Updated `connectToActualForSession()` to call `waitForInitialization()`

## Impact

### Before Fix:
- ❌ New connections could be accepted before stale cleanup finished
- ❌ Failed connections left API in bad state
- ❌ Race conditions between cleanup and new connection requests
- ❌ "Session limit reached" errors even after server restart

### After Fix:
- ✅ All cleanup completes before accepting new connections
- ✅ Failed connections are properly cleaned up
- ✅ No race conditions - initialization is serialized
- ✅ Clean slate on server restart

## Testing Recommendations

1. **Restart Test**: 
   - Start server, create sessions, restart server
   - Verify no "session limit" errors on restart
   - Check logs show "Initialization complete, ready to accept connections"

2. **Error Recovery Test**:
   - Configure invalid Actual Budget credentials
   - Attempt to connect (should fail)
   - Fix credentials and retry
   - Verify connection succeeds without stale state

3. **Concurrent Session Test**:
   - Create multiple sessions rapidly
   - Verify all sessions initialized properly
   - Check logs show correct session count

## Notes

- The `@actual-app/api` is a singleton module, so true concurrent multi-session support is limited
- Current implementation supports **15 concurrent sessions** by default (configurable via `MAX_CONCURRENT_SESSIONS`)
- Session idle timeout is **5 minutes** by default (configurable via `SESSION_IDLE_TIMEOUT_MINUTES`)
- All sessions share the same database directory to avoid data loss

## Related Documentation

- `docs/TOMBSTONE_ISSUE_RESOLVED.md` - Explains connection pooling architecture
- `docs/ARCHITECTURE.md` - Overall system design
- `.github/copilot-instructions.md` - Development guidelines

---

**Date**: 2025-12-18  
**Status**: ✅ FIXED  
**Severity**: Medium (could cause "session limit" errors after restart)
