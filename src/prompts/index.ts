import type { PromptDefinition } from './registry.js';
import monthly_review from './monthly_review.js';

/**
 * Every MCP prompt the server can offer (#660). Each prompt ticket adds one file under
 * src/prompts/ and one entry here. Whether an entry is offered depends on the published tool
 * list, see resolveOfferedPrompts.
 */
export const PROMPT_DEFINITIONS: readonly PromptDefinition[] = [monthly_review];
