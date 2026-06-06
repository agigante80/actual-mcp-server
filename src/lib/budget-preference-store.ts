// Per-principal active-budget preference store (#189, Phase 1 of #173).
//
// After a server restart the client re-initializes and gets a NEW session, so
// the per-session active-budget selection (sessionBudgetState in actual-adapter)
// is lost and the user silently reverts to the env-default budget. This store
// remembers a principal's last active budget so the new session can restore it.
//
// Security model (see #189):
//   * The key at rest is sha256(principal) hex, never the raw OIDC sub / email /
//     token. The file maps hash -> budget syncId only.
//   * It is NEVER trusted as authorization: the caller re-checks the live ACL
//     (allowedBudgets) before applying a restored preference, so a stale
//     preference can never widen access (pickAllowedPreferredBudget below).
//   * It is keyed per principal, not per session-id, so it does not participate
//     in the #167 session-liveness pool and cannot drift with it.
//   * Missing / corrupt / unwritable file degrades to a no-op (the feature
//     simply does nothing); it never throws into the request path.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import logger from '../logger.js';
import config from '../config.js';
import type { BudgetConfig } from './budget-registry.js';

type PreferenceMap = Record<string, string>; // sha256(principal) -> budget syncId

const FILE_NAME = 'budget-preferences.json';

/** sha256 hex of the principal. Never store the raw principal. */
function hashPrincipal(principal: string): string {
  return createHash('sha256').update(principal, 'utf8').digest('hex');
}

function storePath(): string | null {
  const dir = config.MCP_BRIDGE_DATA_DIR;
  if (!dir) return null;
  return join(dir, FILE_NAME);
}

function readAll(): PreferenceMap {
  const p = storePath();
  if (!p) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as PreferenceMap) : {};
  } catch {
    // Missing or corrupt file: treat as empty. The feature no-ops rather than
    // crashing the request that triggered the read.
    return {};
  }
}

/** The budget syncId this principal last selected, or undefined. */
export function getPreferredBudgetSyncId(principal: string | undefined): string | undefined {
  if (!principal) return undefined;
  return readAll()[hashPrincipal(principal)];
}

/** Persist the principal's active budget. Best-effort: never throws. */
export function setPreferredBudgetSyncId(principal: string | undefined, syncId: string | undefined): void {
  const p = storePath();
  if (!p || !principal || !syncId) return;
  try {
    const all = readAll();
    if (all[hashPrincipal(principal)] === syncId) return; // unchanged, skip write
    all[hashPrincipal(principal)] = syncId;
    mkdirSync(dirname(p), { recursive: true });
    // Atomic write: temp + rename so a crash mid-write cannot corrupt the file.
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
    renameSync(tmp, p);
    try { chmodSync(p, 0o600); } catch { /* best-effort perms */ }
  } catch (e) {
    logger.debug(`[BUDGET-PREF] failed to persist preference (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Pure restore decision: given a principal's stored syncId, the live ACL, and
 * the budget registry, return the budget to restore, or undefined.
 *
 * The ACL re-check is the security boundary: a stored preference is applied
 * ONLY if `allowedBudgets` is unrestricted (`['*']`) or contains the budget's
 * syncId. This is why a stale preference can never widen access. Extracted as a
 * pure function so it is unit-testable without the adapter / requestContext.
 */
export function pickAllowedPreferredBudget(
  storedSyncId: string | undefined,
  allowedBudgets: string[] | undefined,
  registryValues: BudgetConfig[],
): BudgetConfig | undefined {
  if (!storedSyncId) return undefined;
  const found = registryValues.find(b => b.syncId === storedSyncId);
  if (!found) return undefined;
  if (allowedBudgets && !allowedBudgets.includes('*') && !allowedBudgets.includes(found.syncId)) {
    return undefined; // ACL no longer permits this budget
  }
  return found;
}
