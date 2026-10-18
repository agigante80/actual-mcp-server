// Multiple static Bearer tokens, each bound to a principal and a budget allow-list.
//
// Why: with the single MCP_SSE_AUTHORIZATION token every caller is the same principal
// ('static-bearer'), so several MCP clients that serve different people/agents share the
// per-principal budget preference (#189) and have no budget isolation unless OIDC is set up.
// MCP_STATIC_TOKENS lets each client present its own token; the token resolves to a
// principal (keys the #189 preference) and to allowedBudgets (enforced by the same ACL paths
// OIDC uses: _enforceBudgetAcl and switchBudget).
//
// Format (JSON object, keyed by principal):
//   MCP_STATIC_TOKENS='{"alice":{"tokenEnv":"MCP_TOKEN_ALICE","budgets":["Home"]},
//                       "bob":{"tokenEnv":"MCP_TOKEN_BOB","budgets":["Home","Work"]}}'
// The token itself is read from the environment variable named by `tokenEnv`, so the JSON is
// configuration that can live in a compose file while the secrets stay in the secret store.
// Budgets are registry names (BUDGET_DEFAULT_NAME / BUDGET_n_NAME), case-insensitive.
//
// Zero-import leaf (only node:crypto), so it is unit-testable without the server.
// Error messages never include token values.

import { timingSafeEqual } from 'node:crypto';

/** What a matched static token resolves to. */
export interface StaticTokenPrincipal {
  principal: string;
  /** Registry names, as configured. */
  budgets: string[];
  /** Sync IDs of those budgets: the request's allowedBudgets. */
  allowedSyncIds: string[];
}

export interface StaticTokenEntry extends StaticTokenPrincipal {
  /** UTF-8 bytes of the token. Never logged. */
  readonly token: Buffer;
}

/** The registry shape this module needs (name + syncId). */
export interface RegistryBudget {
  name: string;
  syncId: string;
}

/** Principal reserved for the legacy single token; a static-token principal may not reuse it. */
export const LEGACY_STATIC_PRINCIPAL = 'static-bearer';

/** Minimum token length: same order as `openssl rand -hex 16`. Short tokens are refused. */
export const MIN_TOKEN_LENGTH = 32;

const PRINCIPAL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse and validate MCP_STATIC_TOKENS. Returns [] when unset/blank.
 * Throws an Error (message safe to log: names only, never token values) on any invalid
 * configuration, so the caller can refuse startup instead of serving with a half-applied ACL.
 */
export function parseStaticTokens(
  raw: string | undefined,
  env: Record<string, string | undefined>,
  registry: Iterable<RegistryBudget>,
  legacyToken?: string,
): StaticTokenEntry[] {
  if (raw === undefined || raw.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MCP_STATIC_TOKENS is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP_STATIC_TOKENS must be a JSON object keyed by principal');
  }

  const byName = new Map<string, RegistryBudget>();
  for (const b of registry) byName.set(b.name.toLowerCase(), b);

  const entries: StaticTokenEntry[] = [];
  const seenTokens: Buffer[] = [];
  if (legacyToken) seenTokens.push(Buffer.from(legacyToken, 'utf8'));

  for (const [principal, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!PRINCIPAL_RE.test(principal)) {
      throw new Error(`MCP_STATIC_TOKENS: invalid principal name "${principal}" (letters, digits, . _ -; max 64)`);
    }
    if (principal === LEGACY_STATIC_PRINCIPAL) {
      throw new Error(`MCP_STATIC_TOKENS: principal "${LEGACY_STATIC_PRINCIPAL}" is reserved for MCP_SSE_AUTHORIZATION`);
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`MCP_STATIC_TOKENS: entry for "${principal}" must be an object {tokenEnv, budgets}`);
    }
    const { tokenEnv, budgets } = value as { tokenEnv?: unknown; budgets?: unknown };

    if (typeof tokenEnv !== 'string' || !ENV_NAME_RE.test(tokenEnv)) {
      throw new Error(`MCP_STATIC_TOKENS: "${principal}".tokenEnv must be an environment variable name`);
    }
    const token = env[tokenEnv];
    if (!token || token.trim() === '') {
      throw new Error(`MCP_STATIC_TOKENS: "${principal}".tokenEnv points to ${tokenEnv}, which is unset or empty`);
    }
    if (token.length < MIN_TOKEN_LENGTH) {
      throw new Error(`MCP_STATIC_TOKENS: token in ${tokenEnv} is shorter than ${MIN_TOKEN_LENGTH} characters`);
    }

    if (!Array.isArray(budgets) || budgets.length === 0 || !budgets.every(b => typeof b === 'string' && b.trim() !== '')) {
      throw new Error(`MCP_STATIC_TOKENS: "${principal}".budgets must be a non-empty array of budget names`);
    }
    const allowedSyncIds: string[] = [];
    for (const name of budgets as string[]) {
      const found = byName.get(name.toLowerCase());
      if (!found) {
        const available = [...byName.values()].map(b => `"${b.name}"`).join(', ');
        throw new Error(`MCP_STATIC_TOKENS: "${principal}" references unknown budget "${name}". Available: ${available}`);
      }
      if (!allowedSyncIds.includes(found.syncId)) allowedSyncIds.push(found.syncId);
    }

    const tokenBuf = Buffer.from(token, 'utf8');
    if (seenTokens.some(t => t.length === tokenBuf.length && timingSafeEqual(t, tokenBuf))) {
      throw new Error(`MCP_STATIC_TOKENS: token in ${tokenEnv} is not unique (reused by another principal or MCP_SSE_AUTHORIZATION)`);
    }
    seenTokens.push(tokenBuf);

    entries.push({ principal, budgets: [...(budgets as string[])], allowedSyncIds, token: tokenBuf });
  }

  if (entries.length === 0) {
    throw new Error('MCP_STATIC_TOKENS is set but defines no principals');
  }
  return entries;
}

/**
 * Constant-work lookup: compares the presented token against EVERY entry (no early exit), so
 * response timing does not reveal which principal matched or how many exist.
 */
export function matchStaticToken(token: string, entries: readonly StaticTokenEntry[]): StaticTokenPrincipal | undefined {
  const presented = Buffer.from(token, 'utf8');
  let match: StaticTokenEntry | undefined;
  for (const e of entries) {
    const equal = presented.length === e.token.length && timingSafeEqual(presented, e.token);
    if (equal && !match) match = e;
  }
  if (!match) return undefined;
  return { principal: match.principal, budgets: [...match.budgets], allowedSyncIds: [...match.allowedSyncIds] };
}
