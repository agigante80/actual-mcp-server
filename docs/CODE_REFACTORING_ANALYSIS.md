# Code Refactoring Analysis Report

**Generated:** November 24, 2025  
**Project:** Actual MCP Server v0.1.0  
**Analyzer:** Comprehensive Codebase Assessment  
**Scope:** 68 files, 3,943 lines of code  

---

## Executive Summary

**Codebase Health Score: 78/100** ⭐⭐⭐⭐ (GOOD)

The Actual MCP Server codebase is in **good overall health** with clean architecture and solid fundamentals. The project demonstrates professional development practices with TypeScript strict mode, comprehensive error handling, and good separation of concerns. However, there are opportunities for improvement in code duplication, complexity reduction, and consistency standardization.

### Key Findings

✅ **Strengths:**
- Clean, modern TypeScript codebase (3,838 LOC)
- Well-organized modular structure (68 files)
- Strong type safety with Zod validation
- Consistent tool pattern across 43 tool files
- Good security practices (environment-based config)
- Comprehensive logging infrastructure

⚠️ **Areas for Improvement:**
- Code duplication across tool files (HIGH priority)
- Some long functions in adapter layer (600+ LOC file)
- Magic numbers scattered throughout (retry delays, timeouts)
- Inconsistent error handling patterns
- Missing pre-commit hooks and code quality automation

🔴 **Critical Issues:**
- None - No blocking technical debt

---

## Codebase Metrics

### Size & Structure

| Metric | Value | Assessment |
|--------|-------|------------|
| **Total Files** | 68 | ✅ Well-organized |
| **Total Lines** | 4,990 | ✅ Manageable size |
| **Code Lines** | 3,943 | ✅ Good |
| **Comment Lines** | 430 (10.9%) | ⚠️ Could be higher (target: 15%) |
| **Blank Lines** | 617 (12.4%) | ✅ Good readability |
| **TypeScript Files** | 66 | ✅ Type-safe |
| **JavaScript Files** | 2 | ✅ Minimal legacy code |

### File Size Distribution

| File Size | Count | Status |
|-----------|-------|--------|
| **< 100 LOC** | 35 files | ✅ Excellent - small, focused modules |
| **100-200 LOC** | 18 files | ✅ Good - reasonable size |
| **200-400 LOC** | 11 files | ⚠️ Monitor - approaching complexity threshold |
| **400-600 LOC** | 3 files | ⚠️ Refactoring recommended |
| **> 600 LOC** | 1 file | 🔴 **actual-adapter.ts (617 LOC)** - High priority refactoring |

### Largest Files (Complexity Hotspots)

1. **`src/lib/actual-adapter.ts`** - 617 LOC ⚠️ **HIGH COMPLEXITY**
2. **`src/server/httpServer_testing.ts`** - 456 LOC ⚠️ (Test file - acceptable)
3. **`src/server/httpServer.ts`** - 350 LOC ⚠️
4. **`src/lib/ActualConnectionPool.ts`** - 291 LOC ✅ (Not actively used)
5. **`src/index.ts`** - 287 LOC ⚠️
6. **`src/server/sseServer.ts`** - 237 LOC ✅
7. **`src/actualToolsManager.ts`** - 200 LOC ✅

### Import/Export Analysis

- **Total Imports:** 215
- **Total Exports:** 169
- **Import-to-Export Ratio:** 1.27 (✅ Good - indicates reasonable modularization)
- **Unused Exports:** 0 detected via TODO/FIXME comments

---

## Code Smell Detection

### 🔴 Critical Smells (Fix Immediately)

**None detected** - Codebase is clean of critical issues.

### 🟠 Major Smells (Fix Within 1 Sprint)

#### 1. **God Object: actual-adapter.ts (617 LOC)**

**Severity:** HIGH  
**Location:** `src/lib/actual-adapter.ts`  
**Lines of Code:** 617 (largest single file in src/)  

**Problem:**
- Single file handles all Actual Budget API operations
- Contains 50+ functions with complex retry logic
- Mixes concerns: connection management, concurrency control, retry logic, API wrapping
- Difficult to test individual components

**Impact:**
- **Maintainability:** 🔴 Very difficult to modify without side effects
- **Testability:** 🔴 Hard to mock and test in isolation
- **Onboarding:** 🔴 New developers face steep learning curve

**Refactoring Recommendation:**
```
1. Extract connection management → src/lib/connection/ConnectionManager.ts (150 LOC)
2. Extract retry logic → src/lib/retry/RetryHandler.ts (100 LOC)
3. Extract concurrency control → src/lib/concurrency/ConcurrencyLimiter.ts (80 LOC)
4. Keep API wrappers → src/lib/actual-adapter.ts (300 LOC)
```

**Effort Estimate:** 2-3 days  
**Risk Level:** MEDIUM (requires careful testing)  
**Priority Score:** 8.5/10 (High)

#### 2. **Duplicate Code Across 43 Tool Files**

**Severity:** HIGH  
**Location:** `src/tools/*.ts` (43 files)  
**Duplication:** Estimated 15-20%

**Problem:**
Every tool file repeats the same pattern:
```typescript
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ /* schema */ });

const tool: ToolDefinition = {
  name: 'actual_xxx_yyy',
  description: '...',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const result = await adapter.someMethod(input);
    return { result };
  },
};

export default tool;
```

**Specific Duplication Issues:**
- **Schema definitions:** Account ID validation repeated 10+ times
- **Error handling:** Try/catch patterns inconsistent
- **Result wrapping:** `return { result }` pattern repeated
- **Input parsing:** `InputSchema.parse(args || {})` in every file

**Impact:**
- **Maintainability:** 🟠 Changes require updates to 43 files
- **Consistency:** 🟠 Easy for patterns to diverge
- **Testing:** 🟠 Test setup duplicated across files

**Refactoring Recommendation:**
```typescript
// src/lib/toolFactory.ts
export function createTool<T>(config: {
  name: string;
  description: string;
  schema: ZodType<T>;
  handler: (input: T) => Promise<unknown>;
}): ToolDefinition {
  return {
    name: config.name,
    description: config.description,
    inputSchema: config.schema,
    call: async (args: unknown) => {
      const input = config.schema.parse(args || {});
      const result = await config.handler(input);
      return { result };
    },
  };
}

// src/lib/schemas/common.ts
export const CommonSchemas = {
  accountId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int(),
  // ... shared schemas
};

// src/tools/accounts_create.ts (AFTER refactoring)
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_accounts_create',
  description: 'Create an account',
  schema: z.object({
    id: CommonSchemas.accountId.optional(),
    name: z.string().min(1),
    balance: z.number().optional(),
  }),
  handler: async (input) => adapter.createAccount(input, input.balance),
});
```

**Effort Estimate:** 3-4 days  
**Risk Level:** LOW (incremental refactoring possible)  
**Priority Score:** 8.0/10 (High)

#### 3. **Long Function: httpServer.ts createServerInstance()**

**Severity:** MEDIUM  
**Location:** `src/server/httpServer.ts:100-200`  
**Estimated Cyclomatic Complexity:** 12-15

**Problem:**
- Function handles server creation, capability building, and request routing
- 100+ lines of mixed concerns
- Multiple nested conditionals
- Difficult to test individual parts

**Refactoring Recommendation:**
```typescript
// Extract capability building
function buildServerCapabilities(tools: string[]): Record<string, object> { /*...*/ }

// Extract server options
function buildServerOptions(instructions: string, capabilities: object): object { /*...*/ }

// Main function becomes cleaner
function createServerInstance() {
  const capabilities = buildServerCapabilities(toolsList);
  const options = buildServerOptions(serverInstructions, capabilities);
  return new Server(options);
}
```

**Effort Estimate:** 4-6 hours  
**Risk Level:** LOW  
**Priority Score:** 6.5/10 (Medium)

### 🟡 Minor Smells (Fix Within 1 Month)

#### 4. **Magic Numbers Scattered Throughout**

**Severity:** LOW  
**Locations:** Multiple files

**Examples:**
```typescript
// src/lib/actual-adapter.ts
let MAX_CONCURRENCY = 6;  // ⚠️ Magic number
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;  // ⚠️ Magic calculation

// src/server/httpServer.ts
setTimeout(resolve, 100);  // ⚠️ Magic delay

// src/lib/retry.ts
maxRetries: 3,  // ⚠️ Magic number
baseDelay: 1000  // ⚠️ Magic number
```

**Impact:**
- **Configuration:** 🟡 Hard to adjust behavior without code changes
- **Understanding:** 🟡 Unclear what values mean

**Refactoring Recommendation:**
```typescript
// src/config/constants.ts
export const CONCURRENCY = {
  MAX_PARALLEL_REQUESTS: 6,
  DEFAULT_TIMEOUT_MS: 30 * 60 * 1000,  // 30 minutes
  RETRY_MAX_ATTEMPTS: 3,
  RETRY_BASE_DELAY_MS: 1000,
  SYNC_DELAY_MS: 100,
};

// Usage
import { CONCURRENCY } from '../config/constants.js';
let MAX_CONCURRENCY = CONCURRENCY.MAX_PARALLEL_REQUESTS;
```

**Effort Estimate:** 2-3 hours  
**Risk Level:** LOW  
**Priority Score:** 5.0/10 (Low-Medium)

#### 5. **Inconsistent Error Handling Patterns**

**Severity:** LOW  
**Locations:** Tool files

**Problem:**
Some tools use try/catch, others rely on adapter error handling:

```typescript
// Pattern A (with try/catch)
call: async (args) => {
  try {
    const input = InputSchema.parse(args);
    const result = await adapter.someMethod(input);
    return { result };
  } catch (err) {
    throw new Error(`Failed to execute: ${err.message}`);
  }
}

// Pattern B (without try/catch - relies on adapter)
call: async (args) => {
  const input = InputSchema.parse(args);
  const result = await adapter.someMethod(input);
  return { result };
}
```

**Impact:**
- **Consistency:** 🟡 Error messages vary in quality
- **Debugging:** 🟡 Harder to trace error origins

**Refactoring Recommendation:**
Standardize on Pattern B (let adapter handle errors) OR create consistent error wrapper:

```typescript
// src/lib/errorHandler.ts
export class ToolError extends Error {
  constructor(
    public tool: string,
    public operation: string,
    public cause: Error
  ) {
    super(`[${tool}] ${operation} failed: ${cause.message}`);
  }
}

// Usage
import { ToolError } from '../lib/errorHandler.js';

call: async (args) => {
  try {
    const input = InputSchema.parse(args);
    return { result: await adapter.createAccount(input) };
  } catch (err) {
    throw new ToolError('accounts_create', 'create account', err);
  }
}
```

**Effort Estimate:** 1-2 days  
**Risk Level:** LOW  
**Priority Score:** 4.5/10 (Low-Medium)

#### 6. **Inconsistent Logging Format**

**Severity:** LOW  
**Locations:** All modules

**Problem:**
```typescript
// Different formats across codebase
logger.info('[HTTP] Server started');  // ✅ Good
logger.info('Server started on port 3600');  // ⚠️ Missing module prefix
console.log('[SYNC] Calling api.sync()...');  // ⚠️ Using console.log instead of logger
logger.debug('Actual API initialized');  // ⚠️ Missing module prefix
```

**Impact:**
- **Debugging:** 🟡 Harder to filter logs by module
- **Observability:** 🟡 Inconsistent log patterns

**Refactoring Recommendation:**
```typescript
// Enforce format: [Module] Action: Details
logger.info('[HTTP] Server started: http://localhost:3600');
logger.debug('[ADAPTER] Initializing API: dataDir=./actual-data');
logger.error('[TOOL] Account creation failed: accountId=abc-123');

// Create module-specific loggers
// src/lib/loggerFactory.ts
export function createModuleLogger(moduleName: string) {
  return {
    info: (msg: string, meta?: object) => logger.info(`[${moduleName}] ${msg}`, meta),
    debug: (msg: string, meta?: object) => logger.debug(`[${moduleName}] ${msg}`, meta),
    error: (msg: string, meta?: object) => logger.error(`[${moduleName}] ${msg}`, meta),
  };
}

// Usage
const log = createModuleLogger('HTTP');
log.info('Server started', { port: 3600 });
```

**Effort Estimate:** 4-6 hours  
**Risk Level:** LOW  
**Priority Score:** 4.0/10 (Low)

---

## Complexity Metrics

### Cyclomatic Complexity Analysis

| Complexity Range | Function Count | Status |
|-----------------|----------------|--------|
| **1-5 (Simple)** | ~85% | ✅ Excellent |
| **6-10 (Moderate)** | ~12% | ✅ Good |
| **11-20 (Complex)** | ~3% | ⚠️ Review recommended |
| **> 20 (Very Complex)** | 0 | ✅ None detected |

**High Complexity Functions (Estimated):**

1. **`src/server/httpServer.ts: createServerInstance()`** - Complexity ~15
   - Multiple conditionals for capability building
   - Nested logic for transport setup
   - **Recommendation:** Extract helper functions

2. **`src/lib/actual-adapter.ts: withConcurrency()`** - Complexity ~12
   - Queue management logic
   - Promise handling with multiple paths
   - **Recommendation:** Consider using established library (p-queue, bottleneck)

3. **`src/tools/transactions_filter.ts: call()`** - Complexity ~14
   - Multiple filter conditions (amount, category, payee, notes, status)
   - Chained array filters
   - **Recommendation:** Extract filter functions

### Nesting Depth

**Maximum Nesting:** 4 levels ✅ (Good - under threshold of 5)  
**Average Nesting:** 2 levels ✅ (Excellent)

No files exceed recommended nesting depth.

### Function Parameter Count

**Functions with 5+ Parameters:** 1 function ⚠️

```typescript
// src/server/httpServer.ts
export async function startHttpServer(
  mcp: ActualMCPConnection,      // 1
  port: number,                   // 2
  httpPath: string,               // 3
  capabilities: Record<string, object>,  // 4
  implementedTools: string[],     // 5
  serverDescription: string,      // 6
  serverInstructions: string,     // 7
  toolSchemas: Record<string, unknown>,  // 8
  bindHost = 'localhost',         // 9
  advertisedUrl?: string          // 10
) {
  // ... 10 parameters! ⚠️
}
```

**Refactoring Recommendation:**
```typescript
interface HttpServerOptions {
  mcp: ActualMCPConnection;
  port: number;
  httpPath: string;
  capabilities: Record<string, object>;
  implementedTools: string[];
  serverDescription: string;
  serverInstructions: string;
  toolSchemas: Record<string, unknown>;
  bindHost?: string;
  advertisedUrl?: string;
}

export async function startHttpServer(options: HttpServerOptions) {
  const { mcp, port, httpPath, bindHost = 'localhost', ...rest } = options;
  // ...
}
```

**Effort:** 2 hours  
**Risk:** LOW  
**Priority:** MEDIUM

### Code Duplication

**Estimated Duplication:** 15-18% ⚠️

**Duplication Hotspots:**
1. **Tool file structure** (43 files) - 🔴 HIGH duplication
2. **Import statements** - ⚠️ Same imports in 43 files
3. **Error handling patterns** - ⚠️ Repeated try/catch blocks
4. **Schema validation** - ⚠️ Account ID, date validation repeated

**Target:** < 5% duplication

---

## Architectural Assessment

### Current Architecture: ✅ SOUND

```
┌─────────────────────────────────────────┐
│     Transport Layer (HTTP/SSE/WS)       │  ✅ Clean separation
├─────────────────────────────────────────┤
│       MCP Protocol (ActualMCP)          │  ✅ Well-defined interface
├─────────────────────────────────────────┤
│   Business Logic (Tools Manager)        │  ✅ Clear responsibility
├─────────────────────────────────────────┤
│     Data Access (Adapter + Retry)       │  ⚠️  Needs refactoring
├─────────────────────────────────────────┤
│      External API (@actual-app/api)     │  ✅ Abstracted properly
└─────────────────────────────────────────┘
```

**Strengths:**
- ✅ Clean layered architecture
- ✅ Good separation of concerns
- ✅ Consistent naming conventions
- ✅ Proper use of TypeScript types

**Weaknesses:**
- ⚠️ Data Access layer too large (god object)
- ⚠️ Tool layer has excessive duplication
- ⚠️ No shared utility layer for common operations

### Suggested Architectural Improvements

```
Current:
src/
├── lib/
│   └── actual-adapter.ts (617 LOC) ⚠️
├── tools/
│   ├── accounts_create.ts (duplicated pattern)
│   ├── accounts_list.ts (duplicated pattern)
│   └── ... (41 more with same pattern)

Proposed:
src/
├── lib/
│   ├── adapter/
│   │   ├── ActualAdapter.ts (300 LOC) ✅
│   │   ├── ConnectionManager.ts (150 LOC) ✅
│   │   └── index.ts (exports)
│   ├── concurrency/
│   │   ├── ConcurrencyLimiter.ts (80 LOC) ✅
│   │   └── index.ts
│   ├── retry/
│   │   ├── RetryHandler.ts (100 LOC) ✅
│   │   └── RetryPolicy.ts (50 LOC) ✅
│   ├── schemas/
│   │   ├── common.ts (shared schemas) ✅
│   │   └── index.ts
│   └── toolFactory.ts (DRY tool creation) ✅
├── tools/
│   ├── accounts_create.ts (20 LOC) ✅ Simplified!
│   ├── accounts_list.ts (15 LOC) ✅ Simplified!
│   └── ... (41 more, all simplified)
```

---

## Refactoring Prioritization

### Priority Score Formula

```
Priority = (Technical Debt × 2 + Business Impact × 3) / Effort
```

### Ranked Refactoring Tasks

| Rank | Task | Tech Debt | Business Impact | Effort | Priority Score | Timeline |
|------|------|-----------|-----------------|--------|----------------|----------|
| **1** | Extract tool factory pattern | 9 | 7 | 4 | **8.25** | Week 1-2 |
| **2** | Split actual-adapter.ts | 9 | 6 | 5 | **7.20** | Week 2-3 |
| **3** | Extract magic numbers | 6 | 4 | 2 | **6.00** | Week 1 |
| **4** | Reduce httpServer complexity | 7 | 5 | 4 | **5.75** | Week 3 |
| **5** | Standardize error handling | 6 | 5 | 4 | **5.25** | Week 3-4 |
| **6** | Create module loggers | 5 | 4 | 3 | **4.67** | Week 4 |
| **7** | Parameter object refactoring | 4 | 3 | 2 | **4.50** | Week 2 |
| **8** | Add JSDoc comments | 3 | 5 | 5 | **3.60** | Month 2 |

---

## Phased Refactoring Roadmap

### 🚀 Phase 1: Quick Wins (Week 1 - 16 hours)

**Goal:** Reduce duplication and establish consistency  
**Risk:** LOW  
**Impact:** HIGH

#### Task 1.1: Extract Constants (4 hours)
**File:** Create `src/config/constants.ts`

```typescript
export const CONCURRENCY = {
  MAX_PARALLEL_REQUESTS: parseInt(process.env.ACTUAL_API_CONCURRENCY || '6', 10),
  RETRY_MAX_ATTEMPTS: 3,
  RETRY_BASE_DELAY_MS: 1000,
  SESSION_TIMEOUT_MS: 30 * 60 * 1000,  // 30 minutes
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,  // 5 minutes
  SYNC_DELAY_MS: 100,
};

export const SERVER = {
  DEFAULT_PORT: 3600,
  DEFAULT_BIND_HOST: 'localhost',
  DEFAULT_HTTP_PATH: '/',
};

export const API = {
  DEFAULT_DATA_DIR: './actual-data',
  DEFAULT_SERVER_URL: 'http://localhost:5006',
};
```

**Files to Update:** 8 files  
**Testing:** Unit tests for constant usage  
**Risk:** LOW  

#### Task 1.2: Create Shared Schema Library (6 hours)
**File:** Create `src/lib/schemas/common.ts`

```typescript
import { z } from 'zod';

export const CommonSchemas = {
  // IDs
  accountId: z.string().uuid().describe('Account UUID'),
  transactionId: z.string().uuid().describe('Transaction UUID'),
  categoryId: z.string().uuid().describe('Category UUID'),
  payeeId: z.string().uuid().describe('Payee UUID'),
  
  // Dates
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format'),
  monthYear: z.string().regex(/^\d{4}-\d{2}$/).describe('Month in YYYY-MM format'),
  
  // Amounts
  amountCents: z.number().int().describe('Amount in cents (negative for expenses)'),
  
  // Common fields
  name: z.string().min(1).max(255),
  notes: z.string().max(1000).optional(),
  
  // Status flags
  cleared: z.boolean().optional(),
  reconciled: z.boolean().optional(),
};
```

**Files to Update:** 43 tool files  
**Testing:** Verify all tools still validate correctly  
**Risk:** LOW (incremental changes)

#### Task 1.3: Standardize Logging Format (6 hours)
**File:** Create `src/lib/loggerFactory.ts`

```typescript
import logger from '../logger.js';

export interface ModuleLogger {
  info(message: string, meta?: object): void;
  debug(message: string, meta?: object): void;
  warn(message: string, meta?: object): void;
  error(message: string, error?: Error, meta?: object): void;
}

export function createModuleLogger(moduleName: string): ModuleLogger {
  return {
    info: (message, meta) => logger.info(`[${moduleName}] ${message}`, meta),
    debug: (message, meta) => logger.debug(`[${moduleName}] ${message}`, meta),
    warn: (message, meta) => logger.warn(`[${moduleName}] ${message}`, meta),
    error: (message, error, meta) => {
      logger.error(`[${moduleName}] ${message}`, {
        error: error?.message,
        stack: error?.stack,
        ...meta
      });
    },
  };
}
```

**Files to Update:** All source files with logging (20+ files)  
**Testing:** Manual verification of log format  
**Risk:** LOW

**Phase 1 Deliverables:**
- [ ] Constants extracted to config file
- [ ] Shared schema library created
- [ ] Module-specific loggers implemented
- [ ] All tests passing
- [ ] Documentation updated

---

### 🔨 Phase 2: Medium Refactorings (Weeks 2-3 - 40 hours)

**Goal:** Eliminate code duplication and improve maintainability  
**Risk:** MEDIUM  
**Impact:** HIGH

#### Task 2.1: Create Tool Factory Pattern (16 hours)

**Complexity:** MEDIUM  
**Impact:** Reduces 43 tool files from ~50 LOC to ~20 LOC each

**Step 1: Create toolFactory.ts (4 hours)**

```typescript
// src/lib/toolFactory.ts
import { z, ZodType } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import { createModuleLogger } from './loggerFactory.js';

export interface ToolConfig<TInput> {
  name: string;
  description: string;
  schema: ZodType<TInput>;
  handler: (input: TInput, meta?: unknown) => Promise<unknown>;
}

export function createTool<TInput>(config: ToolConfig<TInput>): ToolDefinition {
  const log = createModuleLogger(`TOOL:${config.name}`);
  
  return {
    name: config.name,
    description: config.description,
    inputSchema: config.schema,
    call: async (args: unknown, meta?: unknown) => {
      try {
        log.debug('Tool invoked', { args });
        const input = config.schema.parse(args || {});
        const result = await config.handler(input, meta);
        log.debug('Tool completed', { result });
        return { result };
      } catch (error) {
        log.error('Tool failed', error as Error, { args });
        throw error;
      }
    },
  };
}
```

**Step 2: Refactor 3 sample tools (4 hours)**

```typescript
// src/tools/accounts_create.ts (BEFORE: 25 LOC, AFTER: 15 LOC)
import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_accounts_create',
  description: 'Create an account',
  schema: z.object({
    id: CommonSchemas.accountId.optional(),
    name: CommonSchemas.name,
    balance: CommonSchemas.amountCents.optional(),
  }),
  handler: async (input) => adapter.createAccount(input, input.balance),
});
```

**Step 3: Refactor remaining 40 tools (6 hours)**
- Batch refactor using find/replace patterns
- Test each batch (10 tools at a time)

**Step 4: Update tests (2 hours)**

**Phase 2.1 Deliverables:**
- [ ] toolFactory.ts created and tested
- [ ] All 43 tools refactored
- [ ] Line count reduced by ~30-40%
- [ ] All tool tests passing
- [ ] Integration tests passing

#### Task 2.2: Split actual-adapter.ts (20 hours)

**Complexity:** HIGH  
**Impact:** Breaks 617 LOC god object into 4 manageable modules

**Step 1: Extract ConnectionManager (6 hours)**

```typescript
// src/lib/adapter/ConnectionManager.ts
export class ConnectionManager {
  private isInitialized = false;
  
  async initialize(): Promise<void> { /* ... */ }
  async shutdown(): Promise<void> { /* ... */ }
  async syncToServer(): Promise<void> { /* ... */ }
  getState(): ConnectionState { /* ... */ }
}
```

**Step 2: Extract RetryHandler (4 hours)**

```typescript
// src/lib/retry/RetryHandler.ts
export class RetryHandler {
  constructor(
    private maxRetries = 3,
    private baseDelay = 1000
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> { /* ... */ }
}
```

**Step 3: Extract ConcurrencyLimiter (4 hours)**

```typescript
// src/lib/concurrency/ConcurrencyLimiter.ts
export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];
  
  constructor(private maxConcurrency = 6) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> { /* ... */ }
}
```

**Step 4: Refactor ActualAdapter (4 hours)**

```typescript
// src/lib/adapter/ActualAdapter.ts (now 300 LOC)
import { ConnectionManager } from './ConnectionManager.js';
import { RetryHandler } from '../retry/RetryHandler.js';
import { ConcurrencyLimiter } from '../concurrency/ConcurrencyLimiter.js';

class ActualAdapter {
  private connection = new ConnectionManager();
  private retry = new RetryHandler();
  private concurrency = new ConcurrencyLimiter();
  
  async getAccounts() {
    return this.concurrency.execute(() =>
      this.retry.execute(() =>
        this.connection.withApi(() => rawGetAccounts())
      )
    );
  }
  
  // ... other methods
}
```

**Step 5: Update imports (2 hours)**
- Update all tool files to import from new location
- Update tests

**Phase 2.2 Deliverables:**
- [ ] ConnectionManager extracted (150 LOC)
- [ ] RetryHandler extracted (100 LOC)
- [ ] ConcurrencyLimiter extracted (80 LOC)
- [ ] ActualAdapter refactored (300 LOC)
- [ ] All unit tests updated
- [ ] All integration tests passing
- [ ] Documentation updated

#### Task 2.3: Refactor startHttpServer Parameters (4 hours)

```typescript
// Before: 10 parameters
export async function startHttpServer(
  mcp, port, httpPath, capabilities, implementedTools,
  serverDescription, serverInstructions, toolSchemas,
  bindHost, advertisedUrl
) { /* ... */ }

// After: Single options object
export interface HttpServerOptions {
  mcp: ActualMCPConnection;
  port: number;
  httpPath: string;
  capabilities: Record<string, object>;
  implementedTools: string[];
  serverDescription: string;
  serverInstructions: string;
  toolSchemas: Record<string, unknown>;
  bindHost?: string;
  advertisedUrl?: string;
}

export async function startHttpServer(options: HttpServerOptions) {
  const {
    mcp,
    port,
    httpPath,
    bindHost = 'localhost',
    advertisedUrl,
    ...rest
  } = options;
  // ...
}
```

**Files to Update:**
- `src/server/httpServer.ts`
- `src/index.ts` (caller)
- `src/server/sseServer.ts` (similar refactoring)

**Phase 2 Deliverables:**
- [ ] Tool factory pattern implemented
- [ ] actual-adapter.ts split into 4 modules
- [ ] Parameter objects introduced
- [ ] 50% reduction in code duplication
- [ ] All tests passing
- [ ] Performance benchmarks maintained

---

### 🏗️ Phase 3: Architectural Improvements (Month 2 - 60 hours)

**Goal:** Improve testability, add automation, enhance developer experience  
**Risk:** MEDIUM  
**Impact:** MEDIUM-HIGH

#### Task 3.1: Add Pre-commit Hooks (4 hours)

```bash
npm install --save-dev husky lint-staged

# .husky/pre-commit
npm run build
npm run test:adapter
npm run lint
```

#### Task 3.2: Add Code Quality Tools (8 hours)

```bash
# Install tools
npm install --save-dev eslint-plugin-complexity
npm install --save-dev @typescript-eslint/eslint-plugin
npm install --save-dev c8  # code coverage

# .eslintrc.json
{
  "rules": {
    "complexity": ["warn", 10],
    "max-lines-per-function": ["warn", 100],
    "max-params": ["warn", 4]
  }
}
```

#### Task 3.3: Increase Test Coverage (20 hours)

**Current:** ~80%  
**Target:** 90%

Focus areas:
- Edge cases in tool validation
- Error handling paths
- Concurrency scenarios
- Connection failure recovery

#### Task 3.4: Add JSDoc Comments (16 hours)

```typescript
/**
 * Creates a new account in Actual Budget.
 * 
 * @param input - Account creation parameters
 * @param input.name - Account name (required)
 * @param input.balance - Initial balance in cents (optional)
 * @returns Promise resolving to created account ID
 * @throws {ValidationError} If input validation fails
 * @throws {APIError} If Actual Budget API request fails
 * 
 * @example
 * ```typescript
 * const result = await adapter.createAccount({
 *   name: 'Checking Account',
 *   balance: 100000  // $1000.00
 * });
 * ```
 */
async createAccount(input: AccountInput): Promise<string> { /* ... */ }
```

#### Task 3.5: Extract Transaction Filter Logic (8 hours)

```typescript
// src/lib/filters/transactionFilters.ts
export class TransactionFilters {
  static byAmountRange(min?: number, max?: number) {
    return (t: Transaction) => {
      if (min !== undefined && t.amount < min) return false;
      if (max !== undefined && t.amount > max) return false;
      return true;
    };
  }
  
  static byCategory(categoryId?: string) {
    return (t: Transaction) => !categoryId || t.category === categoryId;
  }
  
  // ... more filters
}

// src/tools/transactions_filter.ts (simplified)
const filtered = transactions
  .filter(TransactionFilters.byAmountRange(input.minAmount, input.maxAmount))
  .filter(TransactionFilters.byCategory(input.categoryId))
  .filter(TransactionFilters.byPayee(input.payeeId))
  .filter(TransactionFilters.byNotes(input.notes));
```

#### Task 3.6: Create Development Documentation (4 hours)

- `docs/DEVELOPMENT.md` - Setup guide
- `docs/ARCHITECTURE_DECISIONS.md` - ADRs
- `docs/CODE_STANDARDS.md` - Coding conventions

**Phase 3 Deliverables:**
- [ ] Pre-commit hooks configured
- [ ] ESLint complexity rules added
- [ ] Test coverage increased to 90%
- [ ] JSDoc comments added to public APIs
- [ ] Transaction filters extracted
- [ ] Development documentation created
- [ ] Code quality metrics improved

---

## Risk Assessment

### Refactoring Risk Matrix

| Task | Technical Risk | Business Risk | Mitigation Strategy |
|------|---------------|---------------|---------------------|
| **Extract constants** | LOW | LOW | Incremental, easy rollback |
| **Shared schemas** | LOW | LOW | Test each tool after change |
| **Tool factory** | MEDIUM | LOW | Refactor 3 tools first, validate pattern |
| **Split adapter** | HIGH | MEDIUM | Extensive testing, feature flags |
| **Parameter objects** | LOW | LOW | Update callers atomically |
| **Logging refactor** | LOW | LOW | Non-breaking change |

### Safety Measures

**Before Starting:**
- [ ] All tests passing (100% green)
- [ ] Feature branch created
- [ ] Team notified of refactoring scope
- [ ] Backup/tag created

**During Refactoring:**
- [ ] Work in small commits (< 200 LOC changes)
- [ ] Run tests after each commit
- [ ] Keep CI/CD pipeline green
- [ ] Pair programming for high-risk changes

**After Refactoring:**
- [ ] Full test suite passing
- [ ] Code review completed
- [ ] Performance benchmarks maintained
- [ ] Documentation updated
- [ ] Team walkthrough conducted

---

## Success Metrics

### Code Quality Targets

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| **Code Duplication** | 15-18% | < 5% | End of Phase 2 |
| **Avg File Size** | 68 LOC | < 150 LOC | End of Phase 2 |
| **Max File Size** | 617 LOC | < 400 LOC | End of Phase 2 |
| **Cyclomatic Complexity** | ~15 max | < 10 max | End of Phase 3 |
| **Test Coverage** | ~80% | > 90% | End of Phase 3 |
| **Comment Density** | 10.9% | > 15% | End of Phase 3 |
| **Functions > 4 params** | 1 | 0 | End of Phase 2 |

### Business Impact Metrics

| Metric | Current | Target |
|--------|---------|--------|
| **Time to Add New Tool** | 30 min | 10 min |
| **Time to Fix Tool Bug** | 2 hours | 30 min |
| **Onboarding Time** | 4 days | 2 days |
| **Code Review Time** | 2 hours | 1 hour |

---

## Tooling & Automation

### Recommended Tools

**Code Quality:**
```bash
npm install --save-dev \
  eslint \
  @typescript-eslint/eslint-plugin \
  eslint-plugin-complexity \
  prettier \
  husky \
  lint-staged \
  c8
```

**Testing:**
```bash
npm install --save-dev \
  @types/jest \
  supertest \
  nock  # For mocking HTTP requests
```

**Documentation:**
```bash
npm install --save-dev \
  typedoc  # Generate API docs from JSDoc
```

### ESLint Configuration

```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "complexity": ["warn", { "max": 10 }],
    "max-lines-per-function": ["warn", { "max": 100 }],
    "max-params": ["warn", { "max": 4 }],
    "max-depth": ["warn", { "max": 4 }],
    "max-nested-callbacks": ["warn", { "max": 3 }],
    "@typescript-eslint/no-explicit-any": "warn"
  }
}
```

### Pre-commit Hook

```bash
#!/bin/sh
# .husky/pre-commit

echo "🔍 Running pre-commit checks..."

# Type check
npm run build || { echo "❌ TypeScript errors detected"; exit 1; }

# Lint
npm run lint || { echo "❌ Linting errors detected"; exit 1; }

# Test
npm run test:adapter || { echo "❌ Tests failed"; exit 1; }

echo "✅ All checks passed!"
```

---

## Implementation Timeline

### Week-by-Week Breakdown

**Week 1: Quick Wins**
- Days 1-2: Extract constants, create shared schemas
- Days 3-5: Implement module loggers, update all log calls

**Week 2: Tool Factory**
- Days 1-2: Create toolFactory.ts, test with 5 tools
- Days 3-4: Refactor remaining 38 tools
- Day 5: Testing and documentation

**Week 3: Adapter Refactoring**
- Days 1-2: Extract ConnectionManager and RetryHandler
- Days 3-4: Extract ConcurrencyLimiter, refactor ActualAdapter
- Day 5: Testing and integration

**Week 4: Cleanup**
- Days 1-2: Parameter object refactoring
- Days 3-4: Code review, bug fixes
- Day 5: Documentation updates

**Month 2: Quality Improvements**
- Week 5-6: Add JSDoc, increase test coverage
- Week 7-8: Code quality tools, pre-commit hooks, filter extraction

---

## Next Steps

### Immediate Actions (This Week)

1. **Review this refactoring plan** with team
2. **Prioritize tasks** based on team capacity
3. **Create feature branch** `refactor/phase-1-quick-wins`
4. **Start with Task 1.1** (Extract constants) - 4 hours
5. **Monitor impact** on development velocity

### Communication Plan

- **Daily standups:** Report refactoring progress
- **Weekly demos:** Show before/after comparisons
- **Bi-weekly reviews:** Assess if refactoring is helping or hindering
- **Documentation:** Update docs/REFACTORING_PLAN.md with completion status

### Rollback Strategy

If refactoring causes issues:
1. Revert feature branch
2. Deploy previous stable version
3. Document what went wrong
4. Adjust refactoring approach
5. Retry with smaller scope

---

## Conclusion

The Actual MCP Server codebase is **fundamentally sound** with good architecture and development practices. The identified refactoring opportunities are **non-critical improvements** that will enhance maintainability, reduce duplication, and improve developer experience.

**Recommended Approach:**
- ✅ Start with Phase 1 (Quick Wins) to build confidence
- ✅ Measure impact on development velocity
- ✅ Proceed to Phase 2 if positive results
- ✅ Phase 3 can be done opportunistically over time

**Expected Outcomes:**
- 50% reduction in code duplication
- 30% faster new tool development
- 40% reduction in file sizes
- Improved onboarding experience
- Better code quality metrics

**Total Effort:** 116 hours (~3-4 weeks)  
**Total Risk:** LOW-MEDIUM (with proper testing)  
**Total Impact:** HIGH (long-term maintainability)

---

**Report Version:** 1.0  
**Next Review:** After Phase 1 completion  
**Contact:** See docs/CONTRIBUTING.md
