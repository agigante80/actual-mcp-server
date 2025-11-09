// src/server/wsServer.ts
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.ts';
import { WebSocketServer } from 'ws';
import type { WebSocket as WSClient } from 'ws';
import type { IncomingMessage } from 'http';
import logTransportWithDirection from '../logger.js';
import logger from '../logger.js';
import config from '../config.js';

/**
 * Authenticate WebSocket connection during handshake
 * Checks Authorization header or token query parameter
 */
const authenticateConnection = (request: IncomingMessage): boolean => {
  // If authentication is not configured, allow connection
  if (!config.MCP_SSE_AUTHORIZATION) {
    logger.debug('WebSocket authentication disabled (MCP_SSE_AUTHORIZATION not set)');
    return true;
  }

  // Check Authorization header first (preferred method)
  const authHeader = request.headers.authorization;
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1] === config.MCP_SSE_AUTHORIZATION) {
      logger.info('✅ WebSocket client authenticated via Authorization header');
      return true;
    }
    logger.warn('❌ WebSocket authentication failed: Invalid Authorization header');
    return false;
  }

  // Fallback: check token query parameter
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam) {
    if (tokenParam === config.MCP_SSE_AUTHORIZATION) {
      logger.info('✅ WebSocket client authenticated via token query parameter');
      return true;
    }
    logger.warn('❌ WebSocket authentication failed: Invalid token parameter');
    return false;
  }

  // No authentication provided
  logger.warn('❌ WebSocket authentication failed: No Authorization header or token parameter');
  return false;
};

export async function startWsServer(mcp: ActualMCPConnection, port: number) {
  const wss = new WebSocketServer({ 
    port,
    verifyClient: (info: { req: IncomingMessage }) => {
      // Authenticate during WebSocket handshake
      const isAuthenticated = authenticateConnection(info.req);
      if (!isAuthenticated) {
        logger.warn('🚫 WebSocket connection rejected: Authentication failed');
      }
      return isAuthenticated;
    }
  });
  
  const authStatus = config.MCP_SSE_AUTHORIZATION 
    ? '🔒 Authentication: ENABLED' 
    : '⚠️  Authentication: DISABLED (set MCP_SSE_AUTHORIZATION to enable)';
  logger.info(`🌐 WebSocket MCP server listening on ws://localhost:${port}`);
  logger.info(authStatus);

  wss.on('connection', (ws: WSClient, request: IncomingMessage) => {
    const clientInfo = `${request.socket.remoteAddress}:${request.socket.remotePort}`;
    logger.info(`⚡ WebSocket client connected from ${clientInfo}`);

    ws.on('message', async (message: WSClient.Data) => {
      try {
        const { tool, params } = JSON.parse(message.toString());
        const result = await mcp.executeTool(tool, params);
        ws.send(JSON.stringify({ ok: true, result }));
      } catch (err: any) {
        ws.send(JSON.stringify({ ok: false, error: err.message }));
      }
    });

    ws.on('close', () => {
      logger.info('⚡ WebSocket client disconnected');
    });
  });
}