// #275: MUST be the first import. ES modules evaluate their imports depth-first in
// source order, so this arms the Node floor check before zod, before the rejection
// allowlist, and before the handlers below. `npm start` and the documented
// `node dist/src/index.js --stdio` reach this file without going through bin/, so the
// guard cannot live in bin/ alone.
import './lib/node-version-guard.js';
import { z } from 'zod';
import { isKnownBenignRejection } from './lib/rejection-allowlist.js';
// Add global error handlers

process.on('unhandledRejection', (reason, promise) => {
  console.error('=== UNHANDLED REJECTION ===');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  if (reason instanceof Error) {
    console.error('Stack:', reason.stack);
  }
  console.error('===========================');

  // #275 backstop. The guard above catches both entry points, but a consumer that
  // imports this package as a library reaches neither. Import attributes are the one
  // construct here that fails on an under-floor Node, and it fails asynchronously,
  // so name the real cause rather than letting the reader chase a packaging bug.
  if ((reason as { code?: string } | undefined)?.code === 'ERR_IMPORT_ASSERTION_TYPE_MISSING') {
    console.error(`⚠️  This almost certainly means Node ${process.version} is too old.`);
    console.error('⚠️  actual-mcp-server requires the Node version in package.json "engines".');
    console.error('⚠️  Import attributes (`with { type: "json" }`) need Node 22 or newer.');
  }

  if (isKnownBenignRejection(reason)) {
    console.error('⚠️  Known Actual API domain error escaped to unhandledRejection:');
    console.error('⚠️  ' + String(reason));
    console.error('⚠️  Server will continue running. The caller received an error response.');
    return;
  }

  process.exit(1);
});

process.on('uncaughtException', (error) => {
  const errMsg = String((error as any)?.message || error);
  const errType = (error as any)?.type;
  // Bank sync errors from GoCardless/SimpleFIN can surface as uncaughtException
  // from within the @actual-app/api SDK when the provider API returns an error
  // asynchronously (e.g. RATE_LIMIT_EXCEEDED from GoCardless/Nordigen).
  // These are non-fatal — the server should survive and continue serving requests.
  if (
    errType === 'BankSyncError' ||
    errMsg.includes('BankSyncError') ||
    errMsg.includes('NORDIGEN_ERROR') ||
    errMsg.includes('RATE_LIMIT_EXCEEDED') ||
    errMsg.includes('Rate limit exceeded') ||
    errMsg.includes('Failed syncing account') ||
    errMsg.includes('GoCardless') ||
    errMsg.includes('SimpleFIN')
  ) {
    console.error('⚠️  [BANK SYNC] Non-fatal bank sync error surfaced as uncaughtException (server continues):');
    console.error('⚠️  ' + errMsg);
    return;
  }
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Minimal early help handling before any side-effectful modules (prevents dotenv from running on --help)
const argsEarly = process.argv.slice(2);

// dotenv v17 outputs diagnostic text to stdout by default (console.log).
// Suppress it unconditionally — in stdio mode stdout is the JSON-RPC channel
// (non-JSON corrupts the framing), and in other modes the diagnostic is noise.
process.env.DOTENV_CONFIG_QUIET = 'true';

// Set MCP_STDIO_MODE before the async IIFE so it is in place when src/logger.ts is first
// imported. The Winston Console transport reads this env var at construction time to decide
// whether to route all output to stderr (required in stdio mode — stdout writes corrupt JSON-RPC).
if (argsEarly.includes('--stdio')) {
  process.env.MCP_STDIO_MODE = 'true';
}

// Only load dotenv if we're not just showing help
// dotenv will be loaded inside the async IIFE below via dynamic import
// to avoid using require() in ESM and to keep the early --help fast exit.

const KNOWN_FLAGS = new Set([
  '--http', '--stdio', '--test-actual-connection', '--test-mcp-client',
  '--debug', '--help', '-h', '--version', '-v',
]);
const unknownFlags = argsEarly.filter(a => a.startsWith('-') && !KNOWN_FLAGS.has(a));
if (unknownFlags.length > 0) {
  console.error(`Unknown option: ${unknownFlags.join(', ')}\nRun \`actual-mcp-server --help\` for usage.`);
  process.exit(1);
}

// Early transport mode check — before dotenv and dynamic imports.
// Without this, the config validation error fires first and confuses users who
// simply forgot to pass --http or --stdio.
if (
  !argsEarly.includes('--http') &&
  !argsEarly.includes('--stdio') &&
  !argsEarly.includes('--test-actual-connection') &&
  !argsEarly.includes('--test-mcp-client') &&
  !argsEarly.includes('--help') && !argsEarly.includes('-h') &&
  !argsEarly.includes('--version') && !argsEarly.includes('-v')
) {
  console.error(
    'No transport mode specified.\n\n' +
    'Usage:\n' +
    '  actual-mcp-server --http        # HTTP server (LibreChat / LobeChat / multi-user)\n' +
    '  actual-mcp-server --stdio       # stdio transport (Claude Desktop / Claude Code)\n\n' +
    'Run actual-mcp-server --help for all options.\n'
  );
  process.exit(1);
}

if (argsEarly.includes('--help') || argsEarly.includes('-h') ||
    argsEarly.includes('--version') || argsEarly.includes('-v')) {
  const pkg = await import('../package.json', { with: { type: 'json' } });
  const version = pkg.default.version;
  if (argsEarly.includes('--version') || argsEarly.includes('-v')) {
    console.log(version);
  } else {
    console.log(`actual-mcp-server v${version}

Usage: actual-mcp-server [--http | --stdio | --test-actual-connection] [--debug] [--help]

Options:
  --http                   Start HTTP MCP server
  --stdio                  Start stdio MCP server (for Claude Desktop / local clients)
  --test-actual-connection Test connecting to Actual and exit
  --debug                  Enable debug logging
  --version, -v            Print version and exit
  --help, -h               Show this help message

Docs & source: https://github.com/agigante80/actual-mcp-server`);
  }
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
  const [{ connectToActual }, { ActualMCPConnection }] = await Promise.all([
    import('./actualConnection.js'),
    import('./lib/ActualMCPConnection.js'),
  ]);

  const [
    { startHttpServer },
    { startStdioServer },
    { enforceHttpAuthPosture },
    loggerModule,
    utilsModule,
    actualToolsManagerModule,
  ] = await Promise.all([
    import('./server/httpServer.js'),
    import('./server/stdioServer.js'),
    import('./lib/authPosture.js'),
    import('./logger.js'),
    import('./utils.js'),
    import('./actualToolsManager.js'),
  ]);

  const logger = (loggerModule as unknown as { default: typeof console }).default;
  const { getLocalIp } = (utilsModule as unknown as { getLocalIp: () => string });
  const actualToolsManager = (actualToolsManagerModule as unknown as { default: any }).default;

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
  const HTTP_PATH = process.env.MCP_HTTP_PATH || '/http';

  const args = process.argv.slice(2);
  const useHttp = args.includes('--http');
  const useStdio = args.includes('--stdio');

  const useTestActualConnection = args.includes('--test-actual-connection');
  const useTestMcpClient = args.includes('--test-mcp-client');

  const SERVER_DESCRIPTION = 'Bridge MCP server exposing Actual finance API to LibreChat.';
  const SERVER_INSTRUCTIONS =
    'Welcome to the Actual MCP server. The tools listed here are only the ones currently confirmed and tested, ' +
    'but the server can proxy any API call supported by Actual. As we expand coverage, more tools will be officially exposed.';

  async function main() {
    // Mutual exclusion — stdio and http are incompatible transports
    if (useHttp && useStdio) {
      logger.error('❌ --http and --stdio are mutually exclusive. Pick one.');
      process.exit(1);
    }

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


    // Initialize tools before usage
    await actualToolsManager.initialize();

    // Now get implemented tools after initialization
    const implementedTools = actualToolsManager.getToolNames();

    // Extract schemas map with tool name → JSON schema
    const toolSchemas: Record<string, unknown> = {};
    for (const toolName of implementedTools) {
      const tool = actualToolsManager.getTool(toolName);
      if (tool?.inputSchema) {
        toolSchemas[toolName] = z.toJSONSchema(tool.inputSchema as any);
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
      scheme = (process.env.MCP_BRIDGE_USE_TLS === 'true' || process.env.MCP_ENABLE_HTTPS === 'true') ? 'https' : 'http';
    }

    // choose advertised path based on transport type
    const advertisedPath = process.env.MCP_BRIDGE_HTTP_PATH || HTTP_PATH;

    const advertisedUrl = `${scheme}://${advertisedHost}:${PORT}${advertisedPath}`;

    // Fail fast if native TLS is enabled but cert/key paths are missing or unreadable
    if (process.env.MCP_ENABLE_HTTPS === 'true') {
      const certPath = process.env.MCP_HTTPS_CERT;
      const keyPath = process.env.MCP_HTTPS_KEY;
      if (!certPath || !keyPath) {
        logger.error('MCP_ENABLE_HTTPS=true requires both MCP_HTTPS_CERT and MCP_HTTPS_KEY to be set');
        process.exit(1);
      }
      const { existsSync } = await import('node:fs');
      for (const [label, p] of [['MCP_HTTPS_CERT', certPath], ['MCP_HTTPS_KEY', keyPath]] as const) {
        if (!existsSync(p)) {
          logger.error(`${label} path not found: ${p}`);
          process.exit(1);
        }
      }
    }

    // #242: the interface both the self-test and the normal HTTP path bind to.
    const bindHost = process.env.MCP_BRIDGE_BIND_HOST || '0.0.0.0';

    // #242: HTTP auth required-by-default. Decide ONCE, before binding, whether
    // the configured posture is safe. On a non-loopback bind with no auth and no
    // explicit opt-out this refuses startup (exit 1) rather than silently serving
    // financial data open on the LAN. stdio mode never reaches this check.
    if (useHttp || useTestMcpClient) {
      const decision = enforceHttpAuthPosture({
        bindHost,
        hasStaticToken: !!process.env.MCP_SSE_AUTHORIZATION,
        oidcEnabled: process.env.AUTH_PROVIDER === 'oidc',
        allowUnauthenticated: process.env.MCP_ALLOW_UNAUTHENTICATED === 'true',
      });
      // enforceHttpAuthPosture already called process.exit(1) on 'refuse'. This
      // explicit return makes the open-start path structurally unreachable even
      // if process.exit were ever non-terminal, so we never bind on a refuse.
      if (decision === 'refuse') return;
    }

    // If requested, run the MCP client-side tests now that all variables are ready
    if (useTestMcpClient) {
      logger.info('⚙️  --test-mcp-client specified, starting HTTP server and running client-side MCP tests...');
      // start server in http mode. Bind all interfaces by default (#239): advertisedUrl
      // uses the LAN IP (getLocalIp), so the self-test client must be able to reach it.
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
        bindHost,
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

    // Startup banner — skip in stdio mode (stdout writes corrupt JSON-RPC framing)
    if (!useStdio) {
      logger.info('---------');
      logger.info('🟡 MCP SERVER INFO');
      logger.info(`• Server Description:   ${SERVER_DESCRIPTION}`);
      logger.info(`• OAuth Required:       false`);
      logger.info(`• Capabilities:         ${Object.keys(capabilities).join(', ')}`);
      logger.info(`• Tools:                ${implementedTools.join(', ') || 'none'}`);
      logger.info(`• Server Instructions:  ${SERVER_INSTRUCTIONS}`);
      logger.info(`• MCP endpoint (advertised): ${advertisedUrl}`);
      logger.info('---------');
    }

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
        version,
        // bind host (ensure server accepts connections on that interface)
        bindHost,
        // advertised URL shown to clients
        advertisedUrl
      );
    } else if (useStdio) {
      logger.debug('Mode: stdio');
      await startStdioServer(
        mcp,
        capabilities,
        implementedTools,
        SERVER_DESCRIPTION,
        SERVER_INSTRUCTIONS,
        toolSchemas,
        version,
      );
    } else {
      logger.error('❌ Please specify a transport mode: --http or --stdio');
      process.exit(1);
    }
  }

  main().catch((err) => {
    logger.error('Failed to start Actual MCP bridge:', err.message || String(err));
    process.exit(1);
  });
})();
