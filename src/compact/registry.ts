import type { CompactToolSpec } from './types.js';

/**
 * Every compact tool this server can publish (#671). EMPTY on purpose: the layer ships with
 * its dispatcher, guards and setting first, and each compact tool lands in its own ticket
 * (#672 onward) by appending one spec here. Until then MCP_TOOL_SURFACE=compact refuses to
 * start ("No tools would be published") and `all` publishes only the legacy tools.
 */
export const COMPACT_TOOLS: readonly CompactToolSpec[] = [];
