/**
 * Tool Factory
 * 
 * Factory function for creating MCP tool definitions with consistent structure,
 * error handling, logging, and observability. This eliminates code duplication
 * across the 43 tool files and ensures consistent behavior.
 * 
 * Benefits:
 * - Reduces boilerplate from ~25 LOC to ~10 LOC per tool
 * - Automatic error handling and logging
 * - Consistent observability integration
 * - Type-safe tool configuration
 * - Easier to test and maintain
 */

import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import { createModuleLogger } from './loggerFactory.js';
import observability from '../observability.js';

const log = createModuleLogger('TOOLS');

/**
 * Tool configuration for factory
 */
export interface ToolConfig<TInput = any, TOutput = any> {
  /**
   * Tool name (must be unique, use actual_ prefix)
   * Example: 'actual_accounts_create'
   */
  name: string;

  /**
   * Human-readable description for AI assistants
   * Example: 'Create a new account in Actual Budget'
   */
  description: string;

  /**
   * Zod schema for input validation
   * Can use CommonSchemas from '../lib/schemas/common.js'
   */
  schema: z.ZodSchema<TInput>;

  /**
   * Handler function that implements the tool logic
   * Receives validated input and optional metadata
   * 
   * @param input - Validated input matching the schema
   * @param meta - Optional metadata from MCP client
   * @returns Tool result (any serializable value)
   */
  handler: (input: TInput, meta?: unknown) => Promise<TOutput>;

  /**
   * Optional examples for documentation
   * Helps AI assistants understand how to use the tool
   */
  examples?: Array<{
    description: string;
    input: TInput;
    output?: TOutput;
  }>;
}

/**
 * Create a tool definition with automatic error handling and logging
 * 
 * @param config - Tool configuration
 * @returns MCP tool definition ready for registration
 * 
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { createTool } from '../lib/toolFactory.js';
 * import { CommonSchemas } from '../lib/schemas/common.js';
 * import adapter from '../lib/actual-adapter.js';
 * 
 * export default createTool({
 *   name: 'actual_accounts_create',
 *   description: 'Create a new account in Actual Budget',
 *   schema: z.object({
 *     id: z.string().optional(),
 *     name: CommonSchemas.name,
 *     balance: CommonSchemas.optionalAmountCents,
 *   }),
 *   handler: async (input) => {
 *     const result = await adapter.createAccount(input, input.balance);
 *     return { id: result };
 *   },
 * });
 * ```
 */
export function createTool<TInput = any, TOutput = any>(
  config: ToolConfig<TInput, TOutput>
): ToolDefinition {
  const { name, description, schema, handler, examples } = config;

  return {
    name,
    description: examples 
      ? `${description}\n\nExamples:\n${examples.map((ex, i) => 
          `${i + 1}. ${ex.description}\n   Input: ${JSON.stringify(ex.input, null, 2)}`
        ).join('\n')}`
      : description,
    inputSchema: schema,
    call: async (args: unknown, meta?: unknown) => {
      const startTime = Date.now();
      
      try {
        // Validate input against schema
        log.debug(`Validating input for ${name}`, { args });
        const input = schema.parse(args || {});
        
        // Execute handler
        log.debug(`Executing ${name}`, { input });
        const result = await handler(input, meta);
        
        // Log success
        const duration = Date.now() - startTime;
        log.debug(`${name} completed in ${duration}ms`, { result });
        
        // Track observability
        await observability.incrementToolCall(name);
        
        return { result };
      } catch (error) {
        // Log error with details
        const duration = Date.now() - startTime;
        log.error(`${name} failed after ${duration}ms`, error as Error, { args });
        
        // Track observability (still increment even on failure)
        await observability.incrementToolCall(name);
        
        // Re-throw for MCP error handling
        throw error;
      }
    },
  };
}

/**
 * Batch create multiple tools with shared configuration
 * Useful for creating related tools (CRUD operations) with common patterns
 * 
 * @param baseConfig - Shared configuration for all tools
 * @param tools - Array of tool-specific overrides
 * @returns Array of tool definitions
 * 
 * @example
 * ```typescript
 * export const accountTools = createTools(
 *   { namePrefix: 'actual_accounts_' },
 *   [
 *     { name: 'create', schema: createSchema, handler: createHandler },
 *     { name: 'update', schema: updateSchema, handler: updateHandler },
 *     { name: 'delete', schema: deleteSchema, handler: deleteHandler },
 *   ]
 * );
 * ```
 */
export function createTools<TInput = any, TOutput = any>(
  baseConfig: Partial<ToolConfig<TInput, TOutput>> & { namePrefix?: string },
  tools: Array<Partial<ToolConfig<TInput, TOutput>> & Pick<ToolConfig<TInput, TOutput>, 'name'>>
): ToolDefinition[] {
  const { namePrefix = '', ...sharedConfig } = baseConfig;
  
  return tools.map((toolConfig) =>
    createTool({
      ...sharedConfig,
      ...toolConfig,
      name: namePrefix + toolConfig.name,
    } as ToolConfig<TInput, TOutput>)
  );
}
