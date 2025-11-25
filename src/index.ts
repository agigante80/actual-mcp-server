// Add global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('=== UNHANDLED REJECTION ===');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  if (reason instanceof Error) {
    console.error('Stack:', reason.stack);
  }
  console.error('===========================');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Minimal early help handling before any side-effectful modules (prevents dotenv from running on --help)
const argsEarly = process.argv.slice(2);

// Only load dotenv if we're not just showing help
// dotenv will be loaded inside the async IIFE below via dynamic import
// to avoid using require() in ESM and to keep the early --help fast exit.

const usageEarly = `
Usage: npm run dev -- [--sse | --http | --test-actual-connection | --test-actual-tools] [--debug] [--help]

Options:
  --sse                    Start SSE MCP server
  --http                   Start HTTP MCP server (recommended)
  --test-actual-connection Test connecting to Actual and exit
  --test-actual-tools      Test connecting and run all tools, then exit
  --debug                  Enable debug logging
  --help                   Show this help message
`;

if (argsEarly.includes('--help')) {
  console.log(usageEarly);
  process.exit(0);
}

// Defer remaining imports until after help check to avoid starting servers on import
export {};
(async () => {
  // Load dotenv here (dynamic import) only when not running with --help
  if (!argsEarly.includes('--help')) {
    const dotenv = await import('dotenv');
    dotenv.config();
  }

  // Enable verbose debug output when --debug is passed
  if (argsEarly.includes('--debug')) {
    // enable "debug" package logs (many libs use this)
    process.env.DEBUG = process.env.DEBUG || '*';
    // enable structured logger at debug level
    process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'debug';
    // optional flag your code can check for even more verbose transport logging
    process.env.MCP_BRIDGE_DEBUG_TRANSPORT = 'true';
    console.log('Debug mode enabled: DEBUG=* LOG_LEVEL=debug');
  }

  // dynamic imports to avoid running side effects on module import
  const [{ connectToActual }, { testAllTools }, { ActualMCPConnection }] = await Promise.all([
    import('./actualConnection.js'),
    import('./tests/actualToolsTests.js'),
  import('./lib/ActualMCPConnection.js'),
  ]);

  const [
    { startHttpServer },
    { startSseServer },
    loggerModule,
    osModule,
    utilsModule,
    actualToolsManagerModule,
    zodToJsonSchemaModule,
  ] = await Promise.all([
    import('./server/httpServer.js'),
    import('./server/sseServer.js'),
    import('./logger.js'),
    import('os'),
    import('./utils.js'),
    import('./actualToolsManager.js'),
    import('zod-to-json-schema'),
  ]);

  const logger = (loggerModule as unknown as { default: typeof console }).default;
  const os = osModule as typeof import('os');
  const { getLocalIp } = (utilsModule as unknown as { getLocalIp: () => string });
  const actualToolsManager = (actualToolsManagerModule as unknown as { default: any }).default;
  const zodToJsonSchema = (zodToJsonSchemaModule as unknown as { zodToJsonSchema: Function }).zodToJsonSchema;

  // Load version from environment (Docker build-time) or package.json (local dev)
  let VERSION = process.env.VERSION;
  if (!VERSION || VERSION === 'unknown') {
    const packageJson = await import('../package.json', { with: { type: 'json' } });
    VERSION = packageJson.default.version;
    
    // Append git commit hash for development builds
    try {
      const { execSync } = await import('child_process');
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
      if (branch === 'develop' || branch !== 'main') {
        VERSION = `${VERSION}-dev-${commitHash}`;
      }
    } catch (err) {
      // Git not available or not in a git repo, use version as-is
      logger.debug('Could not determine git commit hash:', err);
    }
  }
  // Ensure VERSION is always a string (fallback to 0.1.0 if somehow still undefined)
  const version: string = VERSION || '0.1.0';

  // now continue with the original logic (args, flags, usage, etc.)
  const PORT = process.env.MCP_BRIDGE_PORT ? Number(process.env.MCP_BRIDGE_PORT) : 3600;
  const SSE_PATH = process.env.MCP_SSE_PATH || '/sse';
  const HTTP_PATH = process.env.MCP_HTTP_PATH || '/http';

  const args = process.argv.slice(2);
  const useSSE = args.includes('--sse');
  const useHttp = args.includes('--http');

  const useTestActualConnection = args.includes('--test-actual-connection');
  const useTestActualTools = args.includes('--test-actual-tools');
  const useTestMcpClient = args.includes('--test-mcp-client');

  const SERVER_DESCRIPTION = 'Bridge MCP server exposing Actual finance API to LibreChat.';
  const SERVER_INSTRUCTIONS =
    'Welcome to the Actual MCP server. The tools listed here are only the ones currently confirmed and tested, ' +
    'but the server can proxy any API call supported by Actual. As we expand coverage, more tools will be officially exposed.';

  const usage = usageEarly;

  async function main() {
    logger.info(`🚀 Starting Actual MCP Server v${VERSION}`);
    
    // NOTE: Persistent connection disabled - using init/shutdown per operation pattern
    // This ensures tombstone=0 for all created entities (they appear in UI)
    // await connectToActual();

    if (useTestActualConnection) {
      // For test connection mode only, we still need to connect
      await connectToActual();
      logger.info('⚙️  --test-actual-connection specified, connection to Actual Finance successful.');
      process.exit(0);
    }

    if (useTestActualTools) {
      logger.info('⚙️  --test-actual-tools specified, connecting and testing all tools...');
      try {
        await testAllTools();
        logger.info('✅ All tool tests completed.');
      } catch (err: unknown) {
        if (err instanceof Error) {
          logger.error('❌ Tool tests failed: %s', err.message);
        } else {
          logger.error('❌ Tool tests failed: %o', err);
        }
        process.exit(1);
      }
      process.exit(0);
    }

    // Initialize tools before usage
    await actualToolsManager.initialize();

    // Now get implemented tools after initialization
    const implementedTools = actualToolsManager.getToolNames();

    // Extract schemas map with tool name → JSON schema
    const toolSchemas: Record<string, unknown> = {};
    for (const toolName of implementedTools) {
      const tool = actualToolsManager.getTool(toolName);
      if (tool?.inputSchema) {
        toolSchemas[toolName] = zodToJsonSchema(tool.inputSchema);
      }
    }

    // Capabilities object with your fixed capabilities values
    const rawCapabilities = {
      tools: true,
      logging: false,
      events: false,
      prompts: false,
    };

    // Convert to MCP format (object for each capability)
    const capabilities: Record<string, object> = {};
    for (const [key, enabled] of Object.entries(rawCapabilities)) {
      if (enabled) {
        capabilities[key] = {};
      }
    }

    // Create one ActualMCPConnection instance here
    const mcp = new ActualMCPConnection();

    // determine advertised host (what clients should use to reach this server)
    // - MCP_BRIDGE_PUBLIC_HOST: force a public host/IP (e.g. 192.168.33.11)
    // - getLocalIp(): falls back to machine LAN IP
    // - final fallback: localhost
    const advertisedHost =
      process.env.MCP_BRIDGE_PUBLIC_HOST || (getLocalIp && getLocalIp()) || 'localhost';

    // determine scheme/protocol:
    // - MCP_BRIDGE_PUBLIC_SCHEME can override (e.g. "https")
    // - otherwise use http/https based on TLS setting
    const schemeOverride = process.env.MCP_BRIDGE_PUBLIC_SCHEME;
    let scheme = schemeOverride;
    if (!scheme) {
      scheme = process.env.MCP_BRIDGE_USE_TLS === 'true' ? 'https' : 'http';
    }

    // choose advertised path based on transport type
    const advertisedPath = process.env.MCP_BRIDGE_HTTP_PATH || HTTP_PATH;

    const advertisedUrl = `${scheme}://${advertisedHost}:${PORT}${advertisedPath}`;

    // If requested, run the MCP client-side tests now that all variables are ready
    if (useTestMcpClient) {
      logger.info('⚙️  --test-mcp-client specified, starting HTTP server and running client-side MCP tests...');
      // start server in http mode (bind to configured PORT)
      await startHttpServer(
        mcp,
        PORT,
        HTTP_PATH,
        capabilities,
        implementedTools,
        SERVER_DESCRIPTION,
        SERVER_INSTRUCTIONS,
        toolSchemas,
        version,
        process.env.MCP_BRIDGE_BIND_HOST || 'localhost',
        advertisedUrl
      );

      // dynamic import to avoid circular at top
      const { testMcpClient } = await import('./tests/testMcpClient.js');
      try {
        await testMcpClient(advertisedUrl, PORT, HTTP_PATH);
        logger.info('✅ MCP client-side tests passed');
        process.exit(0);
      } catch (err: unknown) {
        // Log the full error object and stack so we get useful debug info
        if (err instanceof Error) {
          logger.error('❌ MCP client-side tests failed: %s', err.message);
          if (err.stack) logger.error(err.stack);
        } else {
          logger.error('❌ MCP client-side tests failed: %o', err);
        }
        process.exit(1);
      }
    }

    logger.info('---------');
    logger.info('🟡 MCP SERVER INFO');
    logger.info(`• Server Description:   ${SERVER_DESCRIPTION}`);
    logger.info(`• OAuth Required:       false`);
    logger.info(`• Capabilities:         ${Object.keys(capabilities).join(', ')}`);
    logger.info(`• Tools:                ${implementedTools.join(', ') || 'none'}`);
    logger.info(`• Server Instructions:  ${SERVER_INSTRUCTIONS}`);
    logger.info(`• MCP endpoint (advertised): ${advertisedUrl}`);
    logger.info('---------');

    if (useHttp) {
      logger.info('Mode: HTTP');
      await startHttpServer(
        mcp,
        PORT,
        HTTP_PATH,
        capabilities,
        implementedTools,
        SERVER_DESCRIPTION,
        SERVER_INSTRUCTIONS,
        toolSchemas,
        // bind host (ensure server accepts connections on that interface)
        process.env.MCP_BRIDGE_BIND_HOST || '0.0.0.0',
        // advertised URL shown to clients
        advertisedUrl
      );
    } else if (useSSE) {
      logger.info('Mode: SSE');
      await startSseServer(
        mcp,
        PORT,
        SSE_PATH,
        capabilities,
        implementedTools,
        SERVER_DESCRIPTION,
        SERVER_INSTRUCTIONS,
        toolSchemas,
        version
      );
    }

    logger.info('---------');
    logger.info('Starting MCP bridge server...');

    if ([useSSE, useHttp].filter(Boolean).length !== 1) {
      logger.error('❌ Please specify exactly one mode: --sse or --http');
      process.exit(1);
    }
  }

  main().catch((err) => {
    logger.error('Failed to start Actual MCP bridge:', err.message || String(err));
    process.exit(1);
  });
})();
