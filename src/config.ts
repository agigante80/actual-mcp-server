import { z } from 'zod';

export const configSchema = z.object({
  ACTUAL_SERVER_URL: z.string().url(),
  ACTUAL_PASSWORD: z.string().min(1),
  ACTUAL_BUDGET_SYNC_ID: z.string().min(1),
  MCP_BRIDGE_DATA_DIR: z.string().default('./actual-data'),
  MCP_BRIDGE_PORT: z.string().default('3000'),
  MCP_TRANSPORT_MODE: z.enum(['--http', '--sse']).default('--http'),
  MCP_SSE_AUTHORIZATION: z.string().optional(),
  MCP_ENABLE_HTTPS: z.string().optional().transform(val => val === 'true'),
  MCP_HTTPS_CERT: z.string().optional(),
  MCP_HTTPS_KEY: z.string().optional(),
  MAX_CONCURRENT_SESSIONS: z.string().default('1').transform(val => parseInt(val, 10)),
});

export type Config = z.infer<typeof configSchema>;

function getConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid or missing environment variables:', result.error.format());
    process.exit(1);
  }
  return result.data;
}

const config = getConfig();
export default config;
