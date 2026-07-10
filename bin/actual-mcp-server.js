#!/usr/bin/env node
// Entry point for npx actual-mcp-server. Delegates to the compiled dist.
//
// #275: the version guard is a STATIC import so it evaluates before this module's
// body, and the dist server is a DYNAMIC import so its module graph is never loaded
// on an interpreter that cannot run it. Reversing either would put us back to the
// cryptic ERR_IMPORT_ASSERTION_TYPE_MISSING on Node 18.
import '../dist/src/lib/node-version-guard.js';

await import('../dist/src/index.js');
