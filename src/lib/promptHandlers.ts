/**
 * prompts/list and prompts/get (#660): one helper installed by BOTH transports so they cannot
 * drift (the same reason buildToolListEntries exists, #379). It receives the ALREADY RESOLVED
 * offered list; no transport and no handler resolves tool policy.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListPromptsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { z, ZodError } from 'zod';
import { createModuleLogger } from './loggerFactory.js';
import { formatZodError, sanitizeKey } from './zod-error-format.js';
import { renderPrompt, type PromptDefinition } from '../prompts/registry.js';

const log = createModuleLogger('PROMPTS');

/**
 * The SDK validates a request against the schema it was registered with BEFORE our handler runs,
 * and a failure there answers -32603 with the raw ZodError (hostile argument keys echoed
 * uncapped). So the request schema is deliberately loose: it keeps the method literal and lets
 * every params shape through, and THIS file decides what is invalid: a non-string or missing name
 * is an unknown prompt, and arguments go to the strict per-prompt schema (formatZodError is
 * value-free). Both end as -32602 InvalidParams.
 */
const LooseGetPromptRequestSchema = z.object({
  method: z.literal('prompts/get'),
  params: z.looseObject({ name: z.unknown().optional(), arguments: z.unknown().optional() }).optional(),
});

export function registerPromptHandlers(server: Server, offeredPrompts: readonly PromptDefinition[]): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: offeredPrompts.map((p) => ({
      name: p.name,
      title: p.title,
      description: p.description,
      arguments: p.arguments.map((a) => ({ ...a })),
    })),
  }));

  server.setRequestHandler(LooseGetPromptRequestSchema, async (request) => {
    const rawName = request.params?.name;
    const definition = typeof rawName === 'string' ? offeredPrompts.find((p) => p.name === rawName) : undefined;
    if (!definition) {
      // A fixed marker: the caller's value is never logged. Hidden and unknown look identical.
      // A non-string name is echoed as nothing at all, never as its raw value.
      log.debug('unknown prompt');
      const shown = typeof rawName === 'string' ? sanitizeKey(rawName) : '(invalid name)';
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${shown}`);
    }
    log.debug('prompts/get', { prompt: definition.name });
    let text: string;
    try {
      text = renderPrompt(definition, request.params?.arguments);
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
