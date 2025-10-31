import { ZodTypeAny } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  // Use `unknown` for external inputs; tool `call` implementations should parse with zod
  call: (args: unknown, meta?: unknown) => Promise<unknown>;
}
