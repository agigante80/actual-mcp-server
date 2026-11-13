import type { PromptDefinition } from './registry.js';
import monthly_review from './monthly_review.js';
import spending_check from './spending_check.js';
import spending_patterns from './spending_patterns.js';
import budget_cleanup from './budget_cleanup.js';

/**
 * Every MCP prompt the server can offer (#660). Each prompt ticket adds one file under
 * src/prompts/ and one entry here. Whether an entry is offered depends on the published tool
 * list, see resolveOfferedPrompts.
 */
export const PROMPT_DEFINITIONS: readonly PromptDefinition[] = [monthly_review, spending_check, spending_patterns, budget_cleanup];
