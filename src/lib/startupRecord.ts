// #623: the one structured startup record, `sys_startup`, logged at info on both transports
// after the server has really started. Built by a pure allowlist function: every input is
// injected, so it reads no env, no config and no Actual, and a field that is not listed in
// STARTUP_RECORD_KEYS cannot appear. It imports neither src/index.ts, src/server/* nor the tool
// registry (src/tools/server_info.ts imports this file, so importing the registry would cycle).
import { INSTALLED_API_VERSION, resolveInstalledVersion } from './installed-api-version.js';
import { getMcpServerVersion } from './mcp-version.js';
import { describeAuthMode, isLoopbackHost, type HttpAuthPostureDecision } from './authPosture.js';
import { logSafeOrigin, type BudgetRegistrySummary } from './budget-registry.js';
import { parseStaticTokensConfig, staticTokensConfigured } from '../auth/static-tokens.js';
import type { LogConfig } from '../logger.js';

/** Resolved once at module load: the walk does blocking file reads. The SDK exports no root
 *  path, so the resolvable subpath is passed explicitly (#445). */
const MCP_SDK_RESOLVED = resolveInstalledVersion('@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/server/index.js');

/** Every key the record may hold, by group. `event` is the one top-level scalar. */
export const STARTUP_RECORD_KEYS = {
  event: [],
  versions: ['server', 'node', 'actualApi', 'mcpSdk'],
  runtime: ['platform', 'arch', 'container', 'nodeEnv', 'timezone', 'utcOffsetMinutes'],
  logging: ['level', 'format', 'fileSink'],
  privacy: ['actualApiVerbose'],
  paths: ['logDirCustom', 'dataDirCustom'],
  transport: ['kind', 'bindScope', 'port', 'path', 'scheme', 'advertisedOrigin'],
  auth: ['mode', 'posture', 'sharedBearerAccepted', 'issuerOrigin', 'staticPrincipals'],
  tools: ['total', 'registered', 'readOnly', 'toolsets'],
  budgets: ['count', 'distinctServers', 'schemes'],
  limits: ['opTimeoutMs', 'maxSessions', 'idleTimeoutMs', 'keepAliveMs'],
} as const satisfies Record<string, readonly string[]>;

/** Keys present only on the HTTP transport, as `group.key`. */
export const STARTUP_RECORD_HTTP_ONLY_KEYS = [
  'transport.bindScope', 'transport.port', 'transport.path', 'transport.scheme',
  'transport.advertisedOrigin', 'limits.keepAliveMs',
] as const;

/** Keys present only under AUTH_PROVIDER=oidc, as `group.key`. */
export const STARTUP_RECORD_OIDC_ONLY_KEYS = ['auth.issuerOrigin'] as const;

export interface ToolCounts {
  /** What this process publishes (tools/list). */
  published: number;
  /** What exists in the registry. */
  registered: number;
  policy: { toolsets: string[]; readOnly: boolean };
}

export interface VersionAndToolFacts {
  versions: { server: string; node: string; actualApi: string | null; mcpSdk: string | null };
  tools: { total: number; registered: number; readOnly: boolean; toolsets: string[] };
}

/** Shared with actual_server_info, so the tool and the record can never report different
 *  resolved versions or tool counts. */
export function collectVersionAndToolFacts(counts: ToolCounts): VersionAndToolFacts {
  return {
    versions: {
      server: getMcpServerVersion(),
      node: process.version,
      actualApi: INSTALLED_API_VERSION,
      mcpSdk: MCP_SDK_RESOLVED,
    },
    tools: {
      total: counts.published,
      registered: counts.registered,
      readOnly: counts.policy.readOnly,
      toolsets: [...counts.policy.toolsets],
    },
  };
}

/** What the HTTP listen callback knows about the listener it actually built. */
export interface HttpListenerFacts {
  port: number;
  scheme: 'http' | 'https';
  keepAliveMs: number;
}

export type StartupTransport =
  | { kind: 'stdio' }
  | { kind: 'http'; bindHost: string; path: string; advertisedUrl: string; listener: HttpListenerFacts };

export interface StartupRecordInputs {
  /** Read for auth, paths, NODE_ENV and the file sink only; never copied. */
  env: NodeJS.ProcessEnv;
  logConfig: Pick<LogConfig, 'useJson' | 'level'>;
  budgets: BudgetRegistrySummary;
  tools: ToolCounts;
  /** The HTTP posture decision; stdio has none. */
  posture: Exclude<HttpAuthPostureDecision, 'refuse'> | 'n/a';
  actualApiVerbose: boolean;
  limits: { opTimeoutMs: number; maxSessions: number; idleTimeoutMs: number };
  runtime: { container: boolean; timezone: string; utcOffsetMinutes: number };
  transport: StartupTransport;
}

function bindScopeOf(host: string): 'loopback' | 'all-interfaces' | 'specific' {
  if (isLoopbackHost(host)) return 'loopback';
  if (!host || host === '0.0.0.0' || host === '::') return 'all-interfaces';
  return 'specific';
}

/** A count of the configured static principals. config.ts already refused a malformed value at
 *  startup, so a throw here only means "not countable": 0, never a crash. */
function countStaticPrincipals(raw: string | undefined): number {
  try {
    return Object.keys(parseStaticTokensConfig(raw)).length;
  } catch {
    return 0;
  }
}

/**
 * Build the `sys_startup` metadata. Origins go through logSafeOrigin (never throws, drops
 * userinfo, path and query); budget facts arrive as counts; no hostname, bind address, path,
 * budget or principal name, tool name or instructions text is ever read into it.
 */
export function buildStartupRecord(inputs: StartupRecordInputs) {
  const { env, transport } = inputs;
  const oidcEnabled = env.AUTH_PROVIDER === 'oidc';
  const facts = collectVersionAndToolFacts(inputs.tools);

  const http = transport.kind === 'http' ? transport : undefined;

  return {
    event: 'sys_startup',
    versions: facts.versions,
    runtime: {
      platform: process.platform,
      arch: process.arch,
      container: inputs.runtime.container,
      nodeEnv: env.NODE_ENV ?? null,
      timezone: inputs.runtime.timezone,
      utcOffsetMinutes: inputs.runtime.utcOffsetMinutes,
    },
    logging: {
      level: inputs.logConfig.level,
      format: inputs.logConfig.useJson ? 'json' : 'pretty',
      // The same rule as STORE_LOGS in src/logger.ts.
      fileSink: env.MCP_BRIDGE_STORE_LOGS === 'true',
    },
    privacy: {
      actualApiVerbose: inputs.actualApiVerbose,
    },
    paths: {
      logDirCustom: !!env.MCP_BRIDGE_LOG_DIR,
      dataDirCustom: !!env.MCP_BRIDGE_DATA_DIR,
    },
    transport: http
      ? {
          kind: 'http',
          bindScope: bindScopeOf(http.bindHost),
          port: http.listener.port,
          path: http.path,
          scheme: http.listener.scheme,
          advertisedOrigin: logSafeOrigin(http.advertisedUrl),
        }
      : { kind: 'stdio' },
    auth: {
      // #626: the same blank-means-off rules as the posture check. MCP_SSE_AUTHORIZATION stays
      // untrimmed: a whitespace-only value is still a live credential there.
      mode: describeAuthMode({
        oidcEnabled: env.AUTH_PROVIDER === 'oidc',
        hasStaticTokens: staticTokensConfigured(env.MCP_STATIC_TOKENS),
        hasSseAuthorization: !!env.MCP_SSE_AUTHORIZATION,
      }),
      posture: inputs.posture,
      // Under OIDC the bearer entries are never built (httpServer.ts), so the token is not accepted.
      sharedBearerAccepted: !oidcEnabled && !!env.MCP_SSE_AUTHORIZATION,
      ...(oidcEnabled ? { issuerOrigin: logSafeOrigin(env.OIDC_ISSUER ?? '') } : {}),
      staticPrincipals: oidcEnabled ? 0 : countStaticPrincipals(env.MCP_STATIC_TOKENS),
    },
    tools: facts.tools,
    budgets: {
      count: inputs.budgets.count,
      distinctServers: inputs.budgets.distinctServers,
      schemes: [...inputs.budgets.schemes],
    },
    limits: {
      opTimeoutMs: inputs.limits.opTimeoutMs,
      maxSessions: inputs.limits.maxSessions,
      idleTimeoutMs: inputs.limits.idleTimeoutMs,
      ...(http ? { keepAliveMs: http.listener.keepAliveMs } : {}),
    },
  };
}
