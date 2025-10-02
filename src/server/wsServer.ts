// src/server/wsServer.ts
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.js';
import { WebSocketServer } from 'ws';
import type { WebSocket as WSClient } from 'ws';
import logTransportWithDirection from '../logger.js';
import logger from '../logger.js';

export async function startWsServer(mcp: ActualMCPConnection, port: number) {
  const wss = new WebSocketServer({ port });
  logger.info(`🌐 WebSocket MCP server listening on ws://localhost:${port}`);

  wss.on('connection', (ws: WSClient) => {
    logger.info('⚡ WebSocket client connected');

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