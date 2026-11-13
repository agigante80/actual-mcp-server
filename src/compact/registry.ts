import type { CompactToolSpec } from './types.js';
import { getContext } from './tools/get_context.js';
import { listEntities } from './tools/list_entities.js';

/**
 * Every compact tool this server can publish (#671). Each compact tool lands in its own
 * ticket (#672 onward) by appending one spec here. A compact tool is NOT in IMPLEMENTED_TOOLS
 * or src/tools/index.ts: the legacy registry stays 85 tools.
 */
export const COMPACT_TOOLS: readonly CompactToolSpec[] = [getContext, listEntities];
