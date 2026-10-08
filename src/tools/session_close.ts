import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import { connectionPool } from '../lib/ActualConnectionPool.js';
import { shutdownActualForSession } from '../actualConnection.js';
import { clearSessionBudgetState } from '../lib/actual-adapter.js';
import { requestContext } from '../lib/requestContext.js';
import { filterOwnedSessions } from '../lib/session-owners.js';

const InputSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to close (partial match among your own sessions). If not provided, closes your oldest idle session.'),
});

const tool: ToolDefinition = {
  name: 'actual_session_close',
  description: 'Close one of your idle MCP sessions to free up connection slots. Useful when you get "Max concurrent sessions reached" errors. Only closes sessions you opened, other than the current one.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const stats = connectionPool.getStats();
    // Get the current session and principal from the request context: the
    // session to protect from closing itself, and the owner to scope by.
    const context = requestContext.getStore();
    const currentSessionId = context?.sessionId;
    // Only the caller's own sessions are candidates, and only their ids appear in
    // any reply. Partial matching stays, because it runs over this list alone.
    const ownSessions = filterOwnedSessions(stats.sessions, context?.principal);

    if (stats.totalSessions === 0) {
      return {
        success: false,
        message: 'No sessions to close',
        currentSessions: stats.totalSessions,
        maxConcurrent: stats.maxConcurrent,
      };
    }

    // Find session to close
    let targetSessionId: string | null = null;

    if (input.sessionId) {
      // Find session by partial match
      const matchingSessions = ownSessions.filter(s => 
        s.sessionId.toLowerCase().includes(input.sessionId!.toLowerCase())
      );
      
      if (matchingSessions.length === 0) {
        return {
          success: false,
          message: `No session found matching "${input.sessionId}"`,
          availableSessions: ownSessions.map(s => s.sessionId),
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
      const sortedSessions = [...ownSessions]
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
          availableSessions: ownSessions.map(s => s.sessionId),
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
