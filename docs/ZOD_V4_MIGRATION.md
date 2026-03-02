# Zod 4 Migration Guide

**Project:** Actual MCP Server  
**Created:** 2026-03-02  
**Status:** ✅ Unblocked — `@modelcontextprotocol/sdk` already accepts `"zod": "^3.25 || ^4.0"` and handles Zod 4 schemas natively internally. **Only 2 code changes required** (see Step 2–4 and Step 6 `error.format()`).

---

## Overview

Zod 3.x is currently pinned at `3.25.76` to prevent `zod-to-json-schema` from breaking.  
`zod-to-json-schema` was **deprecated in November 2025** — its author stopped accepting updates because Zod 4 ships native JSON Schema generation via `z.toJSONSchema()`.

This document describes the full migration path to Zod 4 + native JSON Schema generation, eliminating the deprecated dependency and all associated hacks.

---

## Current Pain Points (Why We Need to Migrate)

| Problem | Impact |
|---|---|
| `zod-to-json-schema` is abandoned | No security fixes, no updates |
| Zod 3.x hard-pinned (`3.25.76`) | Blocks all transitive dep upgrades that use Zod 4 |
| Dockerfile Zod reinstall hack | Fragile — must manually strip Zod 4.x after `npm ci` |
| `package.json` overrides pollution | Forces every dep to use Zod 3.x, not just our code |
| `@modelcontextprotocol/sdk` peer dep | Already accepts `"zod": "^3.25 || ^4.0"` — Zod 4 is supported |

---

## Migration Blocker

**Status: No known blockers (as of 2026-03-02)**

`@modelcontextprotocol/sdk` v1.27.1 (currently installed) already declares:
- `"dependencies": { "zod": "^3.25 || ^4.0" }` — direct dep accepts Zod 4
- `"peerDependencies": { "zod": "^3.25 || ^4.0" }` — peer dep accepts Zod 4

The SDK also ships its own `zod-json-schema-compat.js` that detects Zod 4 schemas via `isZ4Schema()` and routes them through `z4mini.toJSONSchema()` natively — it does NOT rely on `zod-to-json-schema` for Zod 4 schemas. Crucially, our `httpServer.ts` converts tool schemas to plain JSON objects before passing them to the SDK, so the SDK's internal path is not even exercised for our tools.

Before migrating, verify no other transitive dep requires Zod 3.x exclusively:

```bash
npm ls zod --all 2>/dev/null | grep -v "4\." | grep zod
# should return empty — if any line appears, that dep is blocking migration
```

---

## Migration Steps

### Step 1 — Update `package.json`

**Remove** the Zod version pin from `dependencies`:

```diff
-    "zod": "3.25.76"
+    "zod": "^4.0.0"
```

**Remove** the Zod override from `overrides`:

```diff
  "overrides": {
-   "zod": "3.25.76",
    "ajv": "8.18.0",
    ...
  }
```

**Remove** the `comments.zod-version` warning key (no longer needed):

```diff
  "comments": {
-   "zod-version": "CRITICAL: Must use Zod 3.x. Zod 4.x breaks zod-to-json-schema causing LibreChat validation to fail. See docs/ZOD_VERSION_CONSTRAINT.md",
    "security-overrides": "..."
  }
```

**Remove** `zod-to-json-schema` if it is listed as an explicit dependency (it is currently pulled transitively, not directly):

```bash
npm uninstall zod-to-json-schema  # only if listed in dependencies
npm install zod@latest
```

---

### Step 2 — Fix `src/lib/ActualMCPConnection.ts`

**Before:**
```typescript
import { zodToJsonSchema } from 'zod-to-json-schema';
// ...
inputSchema: tool.inputSchema ? zodToJsonSchema(tool.inputSchema as any) : { type: 'object' },
```

**After:**
```typescript
import { z } from 'zod';
// ...
inputSchema: tool.inputSchema ? z.toJSONSchema(tool.inputSchema as any) : { type: 'object' },
```

---

### Step 3 — Fix `src/server/httpServer_testing.ts`

**Before:**
```typescript
import { zodToJsonSchema } from "zod-to-json-schema";
```

**After:** Remove the import entirely. Zod 4 exposes `z.toJSONSchema(schema)` — use it directly wherever `zodToJsonSchema()` is called in this file.

Search for all usages in the file:
```bash
grep -n "zodToJsonSchema" src/server/httpServer_testing.ts
```
Replace each call `zodToJsonSchema(schema)` → `z.toJSONSchema(schema)`.

---

### Step 4 — Fix `src/index.ts` (dynamic import)

**Before:**
```typescript
import('zod-to-json-schema'),
// ...
const zodToJsonSchema = (zodToJsonSchemaModule as unknown as { zodToJsonSchema: Function }).zodToJsonSchema;
```

**After:** Remove the dynamic import entirely. The version check it supported (logging the `zod-to-json-schema` version at startup) is no longer needed once the library is gone. If a version check is still wanted, use:

```typescript
import { version as zodVersion } from 'zod/package.json' assert { type: 'json' };
// or simply omit — Zod 4 is the version constraint, not the converter library
```

---

### Step 5 — Fix `Dockerfile`

**Remove** the Zod reinstall hack in the `build` stage:

```diff
  COPY package.json package-lock.json* ./
  RUN npm ci --production=false
- # CRITICAL FIX: Force Zod 3.x (DO NOT REMOVE)
- # Problem: npm chooses Zod 4.x for @modelcontextprotocol/sdk peer dependency (^3.25 || ^4.0)
- # Impact: Zod 4.x breaks zod-to-json-schema, causing LibreChat to detect 0 tools instead of 53
- # Solution: Remove npm's choice and force install Zod 3.25.76
- # See: docs/ZOD_VERSION_CONSTRAINT.md for full details
- RUN rm -rf node_modules/zod && npm install --no-save zod@3.25.76
  COPY . ./
  RUN npm run build
```

---

### Step 6 — Fix `error.format()` in `src/config.ts` (only breaking API change found)

A full audit of all Zod usage across `src/` and `tests/` found **one breaking API change** beyond the `zodToJsonSchema` calls:

**File**: `src/config.ts` line 22

```diff
-  console.error('Invalid or missing environment variables:', result.error.format());
+  console.error('Invalid or missing environment variables:', result.error.issues);
+  // alternatively: z.prettifyError(result.error)  (human-readable string)
```

`ZodError.format()` was removed in Zod 4. Use `.issues` (array) or `z.prettifyError(err)` (formatted string).

**Full compatibility table** — all other Zod APIs used in this codebase:

| Zod 3 usage | Zod 4 status | Files |
|---|---|---|
| `z.string().email()` | ✅ unchanged | multiple tools |
| `z.string().uuid()` / `.regex()` | ✅ unchanged | `schemas/common.ts` |
| `z.object({...})` | ✅ unchanged | all tools |
| `z.union([...])` | ✅ unchanged | multiple tools |
| `z.infer<typeof T>` | ✅ unchanged | `config.ts`, `rules_create_or_update.ts` |
| `import type { ZodTypeAny }` | ✅ unchanged | `actualToolsManager.ts`, `tool.d.ts` |
| `.optional()`, `.default()`, `.describe()` | ✅ unchanged | all tools |
| `.parse()`, `.safeParse()` | ✅ unchanged | all tools |
| `.transform()`, `.refine()` | ✅ unchanged | `config.ts` |
| `instanceof z.ZodError` | ✅ unchanged | 4 tool files |
| `zodToJsonSchema(schema)` | ⚠️ use `z.toJSONSchema(schema)` | `index.ts`, `ActualMCPConnection.ts`, `httpServer_testing.ts` |
| `result.error.format()` | ❌ **removed** — use `.issues` or `z.prettifyError()` | `config.ts` |

Full Zod 4 changelog: <https://zod.dev/changelog>

Run a quick validation after migrating:
```bash
node -e "
import('zod').then(({ z }) => {
  const schema = z.object({ id: z.string(), amount: z.number() });
  const json = z.toJSONSchema(schema);
  console.log(JSON.stringify(json, null, 2));
  if (!json.type || !json.properties) process.exit(1);
  console.log('✅ Zod 4 toJsonSchema() works correctly');
});
"
```

> **Actual scope**: The entire migration amounts to **4 file changes**: `package.json` (pin removal), `Dockerfile` (hack removal), and 2 code fixes (`error.format()` + 3× `zodToJsonSchema` calls). Everything else is API-compatible.

---

### Step 7 — Update `renovate.json`

Remove the Zod version-blocking rule that was added to prevent Renovate from upgrading to Zod 4:

```bash
grep -n "zod" renovate.json
```

Remove or update the pin rule that blocks Zod `>=4.0.0`.

---

### Step 8 — Update documentation

The following files contain Zod 3.x warnings that must be updated:

| File | Section to update |
|---|---|
| `docs/AI_INTERACTION_GUIDE.md` | "Zod Version MUST Be 3.x" → remove/replace with "Zod 4.x required" |
| `docs/ARCHITECTURE.md` | Zod version constraint note |
| `docs/SECURITY_AND_PRIVACY.md` | `overrides` section note |
| `README.md` | "Zod Version Constraint" section |
| `.github/copilot-instructions.md` | "Zod Version MUST Be 3.x" section |
| `docs/ZOD_VERSION_CONSTRAINT.md` | Archive or delete (replaced by this document) |

---

### Step 9 — Run full test suite

```bash
npm run build                    # ✅ No TypeScript errors
npm run test:adapter             # ✅ Adapter tests pass
npm run test:unit-js             # ✅ Unit tests pass (schema assertions)
npm run test:e2e                 # ✅ E2E tests pass (tools visible to client)
npm audit --audit-level=moderate # ✅ No vulnerabilities
```

Specifically verify that all 56 tools are visible after the migration:

```bash
# Start the server and call tools/list
npm run dev -- --http --debug &
sleep 5
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const r=JSON.parse(d); console.log('Tools:', r.result?.tools?.length ?? 'ERROR');"
# Must print: Tools: 56
```

---

## Rollback Plan

If migration causes issues (tools invisible, schema validation failures):

```bash
git restore package.json package-lock.json src/ Dockerfile
npm ci
```

The Zod 3.x pin will be restored automatically.

---

## Expected Outcome

After migration:

- ✅ `zod-to-json-schema` removed — no deprecated dependency
- ✅ Zod 4.x pin active — allows transitive dep ecosystem to modernize
- ✅ Dockerfile hack removed — clean `npm ci` only
- ✅ `package.json` overrides simplified
- ✅ All 56 tools visible in LibreChat / any MCP client
- ✅ Native `z.toJSONSchema()` produces correct JSON Schema output

---

## References

- [Zod 4 migration guide](https://v4.zod.dev/v4/changelog)
- [zod-to-json-schema deprecation notice](https://www.npmjs.com/package/zod-to-json-schema) — "As of November 2025, this project will no longer be receiving updates. Zod v4 natively supports generating JSON schemas."
- [docs/ZOD_VERSION_CONSTRAINT.md](./ZOD_VERSION_CONSTRAINT.md) — original problem documentation (Zod 4 breaks `zod-to-json-schema`)
- Commit `8a5ac1e` — "fix(deps): correct Renovate Zod constraint configuration" — root cause established
