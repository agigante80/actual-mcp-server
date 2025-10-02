// src/server/sseServer.ts
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.js';
import express from 'express';
import { createServer } from 'http';
import type { Request, Response } from 'express';
import logger, { logTransportWithDirection } from '../logger.js';

export async function startSseServer(mcp: ActualMCPConnection, port: number, ssePath: string) {
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  app.use((req, res, next) => {
    logger.debug(`HTTP ${req.method} ${req.originalUrl} from ${req.ip || req.connection.remoteAddress}`);
    next();
  });

  app.get(ssePath, (req: Request, res: Response) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown IP';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    logger.info(`⚡ SSE client connected from ${clientIp}`);

    function sendSSE(data: unknown) {
      if (process.env.DEBUG) {
        logger.debug(`to ${clientIp} ${JSON.stringify(data)}`);
      }
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    logger.debug(`from ${clientIp} {}`);

    logger.info('---------');
    logger.info('🟡 MCP SERVER INFO');
    logger.info('• Server Description:   Actual MCP SSE server ready');
    logger.info('• OAuth Required:       false');
    logger.info('• Capabilities:         tools: get_balances, get_transactions');
    logger.info('• Tools:                get_balances, get_transactions');
    logger.info('• Server Instructions:  Welcome to Actual MCP SSE server');
    logger.info('---------');

    sendSSE({
      jsonrpc: "2.0",
      method: "server/capabilities",
      params: {
        capabilities: {
          tools: [
            {
              name: "get_balances",
              description: "Get account balances",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "get_transactions",
              description: "Get transactions",
              inputSchema: {
                type: "object",
                properties: { accountId: { type: "string" } },
              },
            },
          ],
          resources: [],
          prompts: [],
          models: [],
          logging: {},
        },
      },
    });

    sendSSE({
      jsonrpc: "2.0",
      method: "server/instructions",
      params: {
        instructions: "Welcome to Actual MCP SSE server",
      },
    });

    const interval = setInterval(() => {
      sendSSE({ ping: Date.now() });
    }, 15000);

    req.on('error', (err) => {
      logger.error('SSE request error:', err);
    });

    res.on('error', (err) => {
      logger.error('SSE response error:', err);
    });

    req.on('close', () => {
      clearInterval(interval);
      logger.info(`❌ SSE client disconnected from ${clientIp}`);
    });
  });

  app.use((req, res) => {
    logger.warn(`404 Not Found: ${req.method} ${req.originalUrl} from ${req.ip || req.connection.remoteAddress}`);
    res.status(404).json({ ok: false, error: 'Not Found' });
  });

  server.listen(port, () => {
    logger.info(`🌐 SSE MCP server listening on http://localhost:${port}${ssePath}`);
  });
}