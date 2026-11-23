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
import { capCompletions } from '../prompts/completions.js';

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

/**
 * Loose for the same reason (#775): the stock CompleteRequestSchema is strict, so a malformed
 * completion/complete would answer -32603 with a raw ZodError. Shape checks are in the handler.
 */
const LooseCompleteRequestSchema = z.object({
  method: z.literal('completion/complete'),
  params: z.looseObject({ ref: z.unknown().optional(), argument: z.unknown().optional(), context: z.unknown().optional() }).optional(),
});

/** One static message for every malformed completion request; it never echoes the input. */
const INVALID_COMPLETION_MESSAGE =
  'Invalid completion request: ref must be {type, name} and argument must be {name, value} strings';

const EMPTY_COMPLETION = { completion: { values: [] as string[], total: 0, hasMore: false } };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The server must declare the `completions` capability: the SDK throws from setRequestHandler for
 * completion/complete otherwise. Both transports pass the one capabilities object from index.ts.
 */
export function registerPromptHandlers(server: Server, offeredPrompts: readonly PromptDefinition[]): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: offeredPrompts.map((p) => ({
      name: p.name,
      title: p.title,
      description: p.description,
      // Explicit fields: the `complete` hook is a function and must never be serialised. The SDK
      // PromptArgument type has no `title` (the spec does), so this one array is cast (#775).
      arguments: p.arguments.map((a) => ({
        name: a.name,
        title: a.title,
        description: a.description,
        required: a.required,
      })) as { name: string; description: string; required: boolean }[],
    })),
  }));

  // Computed values only (months, days, a month count): no budget, adapter or session access, and
  // context.arguments is never read. Hidden and unknown prompts are indistinguishable.
  server.setRequestHandler(LooseCompleteRequestSchema, async (request) => {
    const ref = request.params?.ref;
    const argument = request.params?.argument;
    if (
      !isRecord(ref) || typeof ref.type !== 'string' ||
      (ref.type === 'ref/prompt' && typeof ref.name !== 'string') ||
      !isRecord(argument) || typeof argument.name !== 'string' || typeof argument.value !== 'string'
    ) {
      throw new InvalidPromptCallError(INVALID_COMPLETION_MESSAGE);
    }
    if (ref.type !== 'ref/prompt') return EMPTY_COMPLETION;
    // An unknown or hidden prompt name answers an empty completion ON PURPOSE, although the
    // specification suggests -32602: the two must be indistinguishable, so a client cannot probe
    // which prompts are hidden. Do not turn this into an error.
    const definition = offeredPrompts.find((p) => p.name === ref.name);
    const arg = definition?.arguments.find((a) => a.name === argument.name);
    if (!definition || !arg?.complete) return EMPTY_COMPLETION;
    log.debug('completion/complete', { prompt: definition.name, argument: arg.name });
    return { completion: capCompletions(arg.complete(argument.value)) };
  });

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
