/**
 * prompts/list and prompts/get (#660): one helper installed by BOTH transports so they cannot
 * drift (the same reason buildToolListEntries exists, #379). It receives the ALREADY RESOLVED
 * offered list; no transport and no handler resolves tool policy.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListPromptsRequestSchema,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { z, ZodError } from 'zod';
import { createModuleLogger } from './loggerFactory.js';
import { formatZodError, sanitizeKey } from './zod-error-format.js';
import { renderPrompt, type PromptDefinition } from '../prompts/registry.js';

const log = createModuleLogger('PROMPTS');

/**
 * A `-32602` protocol error for a prompts/get. Deliberately NOT an McpError (#772): the SDK builds
 * the JSON-RPC error from `code` and `message` as they are, and McpError's own message already
 * starts "MCP error -32602: " which the client's McpError then prefixes a second time. A plain
 * Error with a numeric `code` reaches the wire as exactly `-32602` plus this text. Same rationale
 * as InvalidToolCallError in tool-output.ts, kept separate so the prompt file does not import a
 * tool-named class.
 */
class InvalidPromptCallError extends Error {
  readonly code = ErrorCode.InvalidParams;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPromptCallError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

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
      throw new InvalidPromptCallError(`Unknown prompt: ${shown}`);
    }
    log.debug('prompts/get', { prompt: definition.name });
    let text: string;
    try {
      text = renderPrompt(definition, request.params?.arguments);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new InvalidPromptCallError(formatZodError(err, definition.argsSchema));
      }
      throw err;
    }
    return {
      description: definition.description,
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
    };
  });
}
