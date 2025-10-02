// src/index.ts
import dotenv from 'dotenv';
dotenv.config();

import { connectToActual } from './actualConnection.js';
import { testAllTools } from './tests/actualToolsTests.js';
import { ActualMCPConnection } from './lib/ActualMCPConnection.js';
import { startHttpServer } from './server/httpServer.js';
import { startSseServer } from './server/sseServer.js';
import { startWsServer } from './server/wsServer.js';
import { startHttpServer as startHttpServerTesting } from './server/httpServer_testing.js';
import logger from './logger.js';
import os from 'os';
import { getLocalIp } from './utils.js';
import actualToolsManager from './actualToolsManager.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

const PORT = process.env.MCP_BRIDGE_PORT ? Number(process.env.MCP_BRIDGE_PORT) : 3600;
const SSE_PATH = process.env.MCP_SSE_PATH || '/sse';
const HTTP_PATH = process.env.MCP_HTTP_PATH || '/http';

const args = process.argv.slice(2);
const useWebSocket = args.includes('--ws');
const useSSE = args.includes('--sse');
const useHttp = args.includes('--http');
const useSseTesting = args.includes('--http-testing');

const useTestActualConnection = args.includes('--test-actual-connection');
const useTestActualTools = args.includes('--test-actual-tools');

const SERVER_DESCRIPTION = 'Bridge MCP server exposing Actual finance API to LibreChat.';
const SERVER_INSTRUCTIONS =
  'Welcome to the Actual MCP server. The tools listed here are only the ones currently confirmed and tested, ' +
  'but the server can proxy any API call supported by Actual. As we expand coverage, more tools will be officially exposed.';

const usage = `
Usage: npm run dev -- [--ws | --sse | --http | --http-testing | --test-actual-connection | --test-actual-tools] [--debug] [--help]

Options:
  --ws                     Start WebSocket MCP server
  --sse                    Start SSE MCP server
  --http                   Start HTTP MCP server
  --http-testing           Start HTTP MCP test server with hardcoded values
  --test-actual-connection Test connecting to Actual and exit
  --test-actual-tools      Test connecting and run all tools, then exit
  --debug                  Enable debug logging
  --help                   Show this help message
`;

async function main() {
  if (args.includes('--help')) {
    console.log(usage);
    process.exit(0);
  }

  // Connect to Actual once before starting MCP servers or just testing
  await connectToActual();

  if (useTestActualConnection) {
    logger.info('⚙️  --test-actual-connection specified, connection to Actual Finance successful.');
    process.exit(0);
  }

  if (useTestActualTools) {
    logger.info('⚙️  --test-actual-tools specified, connecting and testing all tools...');
    try {
      await testAllTools();
      logger.info('✅ All tool tests completed.');
    } catch (err: any) {
      logger.error('❌ Tool tests failed:', err.message || err);
      process.exit(1);
    }
    process.exit(0);
  }

  // Initialize tools before usage
  await actualToolsManager.initialize();

  // Now get implemented tools after initialization
  const implementedTools = actualToolsManager.getToolNames();

  // Extract schemas map with tool name → JSON schema
  const toolSchemas: Record<string, any> = {};
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

  logger.info('---------');
  logger.info('🟡 MCP SERVER INFO');
  logger.info(`• Server Description:   ${SERVER_DESCRIPTION}`);
  logger.info(`• OAuth Required:       false`);
  logger.info(`• Capabilities:         ${Object.keys(capabilities).join(', ')}`);
  logger.info(`• Tools:                ${implementedTools.join(', ') || 'none'}`);
  logger.info(`• Server Instructions:  ${SERVER_INSTRUCTIONS}`);
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
      toolSchemas
    );
  } else if (useWebSocket) {
    logger.info('Mode: WebSocket');
    await startWsServer(mcp, PORT);
  } else if (useSSE) {
    logger.info('Mode: SSE');
    await startSseServer(mcp, PORT, SSE_PATH);
  } else if (useSseTesting) {
    logger.info('Mode: HTTP-TESTING');
    await startHttpServerTesting(mcp, PORT, HTTP_PATH);
  }

  logger.info('---------');
  logger.info('Starting MCP bridge server...');

  if ([useWebSocket, useSSE, useHttp, useSseTesting].filter(Boolean).length !== 1) {
    logger.error('❌ Please specify exactly one mode: --ws, --sse, --http, or --http-testing');
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error('Failed to start Actual MCP bridge:', err.message || String(err));
  process.exit(1);
});
