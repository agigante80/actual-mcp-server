import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import { connectionPool } from '../lib/ActualConnectionPool.js';
import { shutdownActualForSession } from '../actualConnection.js';
import { clearSessionBudgetState } from '../lib/actual-adapter.js';

const InputSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to close (partial match). If not provided, closes the oldest idle session.'),
});

const tool: ToolDefinition = {
  name: 'actual_session_close',
  description: 'Close an idle MCP session to free up connection slots. Useful when you get "Max concurrent sessions reached" errors. Only closes sessions other than the current one.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const stats = connectionPool.getStats();
    
    if (stats.totalSessions === 0) {
      return {
        success: false,
        message: 'No sessions to close',
        currentSessions: stats.totalSessions,
        maxConcurrent: stats.maxConcurrent,
      };
    }

    // Get current session ID from request context to prevent closing own session
    const { requestContext } = await import('../server/httpServer.js');
    const context = requestContext.getStore();
    const currentSessionId = context?.sessionId;

    // Find session to close
    let targetSessionId: string | null = null;

    if (input.sessionId) {
      // Find session by partial match
      const matchingSessions = stats.sessions.filter(s => 
        s.sessionId.toLowerCase().includes(input.sessionId!.toLowerCase())
      );
      
      if (matchingSessions.length === 0) {
        return {
          success: false,
          message: `No session found matching "${input.sessionId}"`,
          availableSessions: stats.sessions.map(s => s.sessionId),
        };
      }
      
      if (matchingSessions.length > 1) {
        return {
          success: false,
          message: `Multiple sessions match "${input.sessionId}". Please be more specific.`,
          matchingSessions: matchingSessions.map(s => s.sessionId),
        };
      }
      
      targetSessionId = matchingSessions[0].sessionId;
    } else {
      // Close the oldest idle session (not current session)
      const sortedSessions = [...stats.sessions]
        .filter(s => !currentSessionId || !s.sessionId.includes(currentSessionId))
        .sort((a, b) => b.idleMinutes - a.idleMinutes);
      
      if (sortedSessions.length === 0) {
        return {
          success: false,
          message: 'No other sessions to close (only your current session is active)',
          currentSessions: stats.totalSessions,
        };
      }
      
      targetSessionId = sortedSessions[0].sessionId;
    }

    // Don't allow closing current session
    if (currentSessionId && targetSessionId.includes(currentSessionId)) {
      return {
        success: false,
        message: 'Cannot close your current session. Please specify a different session.',
        currentSessionId,
      };
    }

    // Close the session
    try {
      // Verify the session exists via the pool's public surface (#171).
      // Previously this cast connectionPool to `any` and read its private
      // `connections` Map, which leaked internals and defeated type checking.
      if (!connectionPool.has(targetSessionId!)) {
        return {
          success: false,
          message: `Session ${targetSessionId} not found in connection pool`,
          availableSessions: stats.sessions.map(s => s.sessionId),
        };
      }

      await shutdownActualForSession(targetSessionId! as string);
      // Clear the per-session active-budget state so the map does not
      // accumulate stale entries after a session ends. See #156.
      clearSessionBudgetState(targetSessionId! as string);

      const newStats = connectionPool.getStats();
      
      return {
        success: true,
        message: `Session ${targetSessionId} closed successfully`,
        closedSession: targetSessionId,
        remainingSessions: newStats.totalSessions,
        maxConcurrent: newStats.maxConcurrent,
        availableSlots: newStats.maxConcurrent - newStats.activeSessions,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to close session: ${(err as Error).message}`,
        error: String(err),
      };
    }
  },
};

export default tool;
