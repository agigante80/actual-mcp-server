// src/lib/config-registry.ts (#231)
//
// The single in-code record of every configuration variable that is NOT a Zod
// schema key in src/config.ts but is still read from process.env somewhere in
// src/. Together with `Object.keys(configSchema.shape)`, this allowlist is the
// canonical set of configuration variables the server understands.
//
// Why an allowlist instead of promoting everything into the schema: most of these
// are read before src/config.ts loads (src/logger.ts, see logger.ts:53) or in the
// deferred-config entry src/index.ts (which reads process.env directly to keep the
// fast `--help` exit, the decision recorded for #230). Promoting them risks a
// load-order regression, so they stay raw but DOCUMENTED here, with a reason and
// read site. Migrating any raw read into the validated config object is deliberately
// out of scope for #231 (a separate, behaviour-sensitive change).
//
// This file is data only. It imports nothing from src/config.ts so it carries no
// process.env requirement and can be imported by the drift guard and its unit test.

export interface RawEnvVar {
  /** The environment variable name. */
  name: string;
  /** Why it is read raw rather than through the validated config object. */
  reason: string;
  /** Where it is read, for the read-site map in docs/CONFIGURATION.md. */
  readSite: string;
  /** True if the value is sensitive (secret/credential). */
  secret?: boolean;
  /**
   * Whether this var belongs in the user-facing docs (.env.example, README env
   * table). Defaults to true. Set false for internal vars that are not operator
   * knobs (a build arg, a dotenv flag, a CLI-flag mirror), so the drift guard does
   * not force documenting them while the enumeration still accounts for them.
   */
  documented?: boolean;
}

/**
 * Variables read from process.env in src/ that are NOT configSchema keys.
 * Grouped by reason in the comments; the array is the machine-readable source.
 */
export const RAW_ENV_ALLOWLIST: readonly RawEnvVar[] = [
  // Logger bootstrap: read in src/logger.ts before src/config.ts loads.
  { name: 'MCP_BRIDGE_STORE_LOGS', reason: 'logger bootstrap (before config loads)', readSite: 'logger.ts:14' },
  { name: 'MCP_BRIDGE_LOG_DIR', reason: 'logger bootstrap (before config loads)', readSite: 'logger.ts:15' },
  { name: 'MCP_BRIDGE_ROTATE_DATEPATTERN', reason: 'logger bootstrap (before config loads)', readSite: 'logger.ts:21' },
  { name: 'MCP_BRIDGE_MAX_LOG_SIZE', reason: 'logger bootstrap (before config loads)', readSite: 'logger.ts:22' },
  { name: 'MCP_BRIDGE_MAX_FILES', reason: 'logger bootstrap (before config loads)', readSite: 'logger.ts:23' },
  { name: 'LOG_FORMAT', reason: 'logger bootstrap, read via resolveLogConfig(env)', readSite: 'logger.ts:74' },
  { name: 'MCP_BRIDGE_LOG_LEVEL', reason: 'logger bootstrap, read via resolveLogConfig(env)', readSite: 'logger.ts:77' },
  { name: 'MCP_SERVICE_NAME', reason: 'logger bootstrap, read via resolveLogConfig(env)', readSite: 'logger.ts:78' },
  { name: 'MCP_STDIO_MODE', reason: 'mirrors the --stdio CLI flag, set in-process before the logger import; not a .env knob', readSite: 'logger.ts:345, index.ts', documented: false },

  // Deferred-config entry: read in src/index.ts to preserve the fast --help exit (#230).
  { name: 'MCP_BRIDGE_BIND_HOST', reason: 'deferred-config entry (index.ts reads process.env directly, #230)', readSite: 'index.ts' },
  { name: 'MCP_HTTP_PATH', reason: 'deferred-config entry; the path the server LISTENS on', readSite: 'index.ts:195' },
  { name: 'MCP_BRIDGE_HTTP_PATH', reason: 'deferred-config entry; the path ADVERTISED to clients, falls back to MCP_HTTP_PATH', readSite: 'index.ts:281' },
  { name: 'MCP_BRIDGE_PUBLIC_HOST', reason: 'deferred-config entry; advertised public host', readSite: 'index.ts:269, httpServer.ts:581' },
  { name: 'MCP_BRIDGE_PUBLIC_SCHEME', reason: 'deferred-config entry; advertised scheme override', readSite: 'index.ts' },
  { name: 'MCP_BRIDGE_USE_TLS', reason: 'deprecated alias of MCP_ENABLE_HTTPS; affects only advertised-scheme detection', readSite: 'index.ts:277' },
  { name: 'MCP_BRIDGE_DEBUG_TRANSPORT', reason: 'transport debug flag, read pre-config', readSite: 'index.ts, utils.ts' },

  // Framework / internal: not user-facing config knobs.
  { name: 'NODE_ENV', reason: 'framework var; selects prod log format and prod behaviours', readSite: 'httpServer.ts, logger.ts (resolveLogConfig)' },
  { name: 'DEBUG', reason: 'framework debug toggle', readSite: 'utils.ts, index.ts' },
  { name: 'LOG_LEVEL', reason: 'debug-detection toggle (distinct from MCP_BRIDGE_LOG_LEVEL, the winston level)', readSite: 'utils.ts' },
  { name: 'DOTENV_CONFIG_QUIET', reason: 'dotenv internal flag, not an operator knob', readSite: 'index.ts', documented: false },
  { name: 'VERSION', reason: 'build-time version arg, injected by the Docker build, not an operator knob', readSite: 'index.ts, server_info.ts', documented: false },

  // Domain-time: read after config loads; future candidates for schema promotion.
  { name: 'ACTUAL_API_CONCURRENCY', reason: 'adapter concurrency tuning; future schema-promotion candidate', readSite: 'lib/actual-adapter/concurrency.ts' },
  { name: 'SESSION_IDLE_TIMEOUT_MINUTES', reason: 'pool idle timeout; future schema-promotion candidate', readSite: 'lib/ActualConnectionPool.ts' },
  { name: 'USE_CONNECTION_POOL', reason: 'pool toggle; future schema-promotion candidate', readSite: 'actualConnection.ts' },
];

/**
 * Schema keys that are ALSO read directly from process.env at a second site. These
 * are validated by configSchema (so they are canonical via schema membership), but
 * the matrix records their raw read site for completeness. Migrating these reads to
 * config.X is the out-of-scope follow-up.
 */
export const SCHEMA_VARS_ALSO_READ_RAW: ReadonlyArray<{ name: string; readSite: string }> = [
  { name: 'MCP_BRIDGE_PORT', readSite: 'index.ts:194' },
  { name: 'MCP_ENABLE_HTTPS', readSite: 'index.ts:277,286' },
  { name: 'MCP_HTTPS_CERT', readSite: 'index.ts:287' },
  { name: 'MCP_HTTPS_KEY', readSite: 'index.ts:288' },
  { name: 'MAX_CONCURRENT_SESSIONS', readSite: 'ActualConnectionPool.ts:60' },
  { name: 'ACTUAL_BUDGET_PASSWORD', readSite: 'actualConnection.ts:33, ActualConnectionPool.ts:255,338' },
];

/**
 * Prefixes of dynamic variable families enumerated at runtime, not declared one by
 * one. `.env.example` documents example members (BUDGET_1_*, BUDGET_2_*, ...); the
 * drift guard collapses any name starting with one of these to the family.
 */
export const DYNAMIC_ENV_FAMILIES: readonly string[] = ['BUDGET_'];

/**
 * Variables documented for the operator (e.g. in Docker) but read by the OS or
 * runtime, not by the app. The drift guard allows these in docs without requiring a
 * schema/allowlist entry.
 */
export const OS_LEVEL_ENV: readonly string[] = ['TZ'];

/**
 * The canonical set of configuration variable names the server understands:
 * every Zod schema key united with every raw-read allowlist name. Pass the schema
 * keys in (e.g. `Object.keys(configSchema.shape)`) so this module stays free of any
 * import from src/config.ts and its process.env requirement.
 */
export function canonicalConfigVars(schemaKeys: readonly string[]): Set<string> {
  return new Set<string>([...schemaKeys, ...RAW_ENV_ALLOWLIST.map((v) => v.name)]);
}

/**
 * The subset of canonical vars that MUST appear in the user-facing docs
 * (.env.example and the README env table): every schema key, plus every allowlist
 * entry not flagged `documented: false`. Internal vars (build arg, dotenv flag,
 * CLI-flag mirror) are accounted for by the enumeration but exempt from the docs.
 */
export function documentedConfigVars(schemaKeys: readonly string[]): Set<string> {
  return new Set<string>([
    ...schemaKeys,
    ...RAW_ENV_ALLOWLIST.filter((v) => v.documented !== false).map((v) => v.name),
  ]);
}

/** True if `name` belongs to a dynamic family (e.g. BUDGET_2_NAME). */
export function isDynamicFamilyVar(name: string): boolean {
  return DYNAMIC_ENV_FAMILIES.some((prefix) => name.startsWith(prefix));
}
