import { createModuleLogger, type ModuleLogger } from './loggerFactory.js';

/**
 * Auth posture gate (#242): make HTTP authentication required-by-default.
 *
 * Background: with AUTH_PROVIDER unset and a blank MCP_SSE_AUTHORIZATION the
 * per-request gate in httpServer.ts serves every request, and the server binds
 * 0.0.0.0 by default, so a forgotten token publishes a financial MCP server open
 * on the LAN. This module decides ONCE at startup whether that posture is safe,
 * before the socket is bound.
 *
 * We refuse startup (Option 1) rather than 401 per request (Option 2): a
 * per-request loopback check would key on req.ip, which is attacker-suppliable
 * via X-Forwarded-For once `trust proxy` is enabled behind the documented reverse
 * proxy, turning the check into a spoofable bypass. The bind host is fixed config
 * no client can influence, so deciding once at startup is the sound boundary.
 */

const logger = createModuleLogger('AUTH_POSTURE');

/**
 * True only for binds that never leave the local host: `localhost`, the entire
 * IPv4 loopback block (127.0.0.0/8, so 127.0.0.2 counts, not just 127.0.0.1),
 * IPv6 loopback in compressed and longhand form, and the IPv4-mapped IPv6
 * loopback. `0.0.0.0` and `::` bind ALL interfaces (including non-loopback ones)
 * so they are exposed, not loopback. An empty or undefined host is treated as
 * exposed (fail-safe): the real runtime default is `0.0.0.0`.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  if (h === 'localhost') return true;
  // IPv4 loopback is the whole 127.0.0.0/8 block, not only 127.0.0.1.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // IPv6 loopback: compressed (::1) and fully-expanded longhand.
  if (h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
  // IPv4-mapped IPv6 loopback (e.g. ::ffff:127.0.0.1).
  if (/^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

export interface HttpAuthPostureInput {
  /** The interface the server will bind (e.g. process.env.MCP_BRIDGE_BIND_HOST || '0.0.0.0'). */
  bindHost: string | undefined;
  /** Whether a non-empty static Bearer token (MCP_SSE_AUTHORIZATION) is set. */
  hasStaticToken: boolean;
  /** Whether OIDC is enabled (AUTH_PROVIDER === 'oidc'). */
  oidcEnabled: boolean;
  /** The explicit open opt-out (MCP_ALLOW_UNAUTHENTICATED === true). */
  allowUnauthenticated: boolean;
}

export type HttpAuthPostureDecision = 'serve' | 'serve-open-warn' | 'refuse';

export interface HttpAuthPostureResult {
  decision: HttpAuthPostureDecision;
  reason: string;
}

/**
 * Pure decision function (no side effects) so it is exhaustively unit-testable
 * without booting a server. Precedence: configured auth serves; otherwise a
 * loopback bind serves; otherwise the explicit opt-out serves (with a warning);
 * otherwise refuse.
 */
export function evaluateHttpAuthPosture(input: HttpAuthPostureInput): HttpAuthPostureResult {
  const { bindHost, hasStaticToken, oidcEnabled, allowUnauthenticated } = input;

  if (hasStaticToken || oidcEnabled) {
    return { decision: 'serve', reason: 'authentication is configured' };
  }
  if (isLoopbackHost(bindHost)) {
    return { decision: 'serve', reason: `loopback bind (${bindHost}) is not exposed` };
  }
  if (allowUnauthenticated) {
    return {
      decision: 'serve-open-warn',
      reason: `MCP_ALLOW_UNAUTHENTICATED=true on a non-loopback bind (${bindHost ?? '0.0.0.0'})`,
    };
  }
  return {
    decision: 'refuse',
    reason: `no authentication configured on a non-loopback bind (${bindHost ?? '0.0.0.0'})`,
  };
}

/**
 * Evaluate the posture and enforce it: refuse exits the process non-zero with a
 * remediation message, the opt-out logs a loud warning, and a safe posture is a
 * no-op. `exit` and `log` are injectable only for the existing process.exit-spy
 * test pattern; production callers use the defaults. Returns the decision so a
 * caller (or test that stubs exit to not throw) can observe it.
 */
export function enforceHttpAuthPosture(
  input: HttpAuthPostureInput,
  log: Pick<ModuleLogger, 'error' | 'warn'> = logger,
  exit: (code: number) => never = process.exit,
): HttpAuthPostureDecision {
  const { decision, reason } = evaluateHttpAuthPosture(input);

  if (decision === 'refuse') {
    log.error(
      `Refusing to start: ${reason}. HTTP auth is required-by-default. ` +
        'Set MCP_SSE_AUTHORIZATION to a strong token (openssl rand -hex 32), or ' +
        'set AUTH_PROVIDER=oidc, or bind a loopback host. To deliberately run open ' +
        '(for example behind your own authenticating proxy), set MCP_ALLOW_UNAUTHENTICATED=true.',
    );
    exit(1);
  } else if (decision === 'serve-open-warn') {
    log.warn(
      `Serving HTTP WITHOUT authentication: ${reason}. Anyone who can reach this ` +
        'port can read and modify your financial data. This is allowed only because ' +
        'MCP_ALLOW_UNAUTHENTICATED=true. Put an authenticating reverse proxy in front, ' +
        'or set MCP_SSE_AUTHORIZATION / AUTH_PROVIDER=oidc.',
    );
  }

  return decision;
}
