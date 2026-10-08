import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import { connectionPool } from '../lib/ActualConnectionPool.js';
import { requestContext } from '../lib/requestContext.js';
import { filterOwnedSessions } from '../lib/session-owners.js';

const InputSchema = z.object({});

const tool: ToolDefinition = {
  name: 'actual_session_list',
  description: 'List your active MCP sessions with their activity status. Useful for diagnosing connection issues or seeing which sessions can be closed. The pool totals cover every session; the list shows only sessions you opened.',
  inputSchema: InputSchema,
  call: async (_args: unknown) => {
    const stats = connectionPool.getStats();
    // Session ids are bearer material: list only the caller's own sessions. The
    // totals stay pool-wide because they explain a "max concurrent sessions" refusal.
    const own = filterOwnedSessions(stats.sessions, requestContext.getStore()?.principal);

    return {
      totalSessions: stats.totalSessions,
      activeSessions: stats.activeSessions,
      maxConcurrent: stats.maxConcurrent,
      availableSlots: stats.maxConcurrent - stats.activeSessions,
      sessions: own.map(s => ({
        sessionId: s.sessionId,
        lastActivity: s.lastActivity,
        idleMinutes: s.idleMinutes,
        status: s.idleMinutes > 5 ? 'idle' : 'active',
      })),
    };
  },
};

export default tool;
