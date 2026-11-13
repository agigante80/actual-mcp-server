/**
 * prompts/list and prompts/get (#660): one helper installed by BOTH transports so they cannot
 * drift (the same reason buildToolListEntries exists, #379). It receives the ALREADY RESOLVED
 * offered list; no transport and no handler resolves tool policy.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { createModuleLogger } from './loggerFactory.js';
import { formatZodError, sanitizeKey } from './zod-error-format.js';
import { renderPrompt, type PromptDefinition } from '../prompts/registry.js';

const log = createModuleLogger('PROMPTS');

export function registerPromptHandlers(server: Server, offeredPrompts: readonly PromptDefinition[]): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: offeredPrompts.map((p) => ({
      name: p.name,
      title: p.title,
      description: p.description,
      arguments: p.arguments.map((a) => ({ ...a })),
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const rawName = request.params.name;
    const definition = offeredPrompts.find((p) => p.name === rawName);
    if (!definition) {
      // A fixed marker: the caller's string is never logged. Hidden and unknown look identical.
      log.debug('unknown prompt');
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${sanitizeKey(rawName)}`);
    }
    log.debug('prompts/get', { prompt: definition.name });
    let text: string;
    try {
      text = renderPrompt(definition, request.params.arguments);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new McpError(ErrorCode.InvalidParams, formatZodError(err, definition.argsSchema));
      }
      throw err;
    }
    return {
      description: definition.description,
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
    };
  });
}
