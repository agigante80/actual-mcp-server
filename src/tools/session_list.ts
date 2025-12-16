import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import { connectionPool } from '../lib/ActualConnectionPool.js';

const InputSchema = z.object({});

const tool: ToolDefinition = {
  name: 'actual_session_list',
  description: 'List all active MCP sessions with their activity status. Useful for diagnosing connection issues or seeing which sessions can be closed.',
  inputSchema: InputSchema,
  call: async (_args: unknown) => {
    const stats = connectionPool.getStats();
    
    return {
      totalSessions: stats.totalSessions,
      activeSessions: stats.activeSessions,
      maxConcurrent: stats.maxConcurrent,
      availableSlots: stats.maxConcurrent - stats.activeSessions,
      sessions: stats.sessions.map(s => ({
        sessionId: s.sessionId,
        lastActivity: s.lastActivity,
        idleMinutes: s.idleMinutes,
        status: s.idleMinutes > 5 ? 'idle' : 'active',
      })),
    };
  },
};

export default tool;
