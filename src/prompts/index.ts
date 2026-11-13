import type { PromptDefinition } from './registry.js';

/**
 * Every MCP prompt the server can offer (#660). Empty in the ticket that adds the mechanism;
 * each prompt ticket adds one file under src/prompts/ and one entry here. Whether an entry is
 * offered depends on the published tool list, see resolveOfferedPrompts.
 */
export const PROMPT_DEFINITIONS: readonly PromptDefinition[] = [];
