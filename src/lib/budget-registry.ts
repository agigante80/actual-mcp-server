/**
 * Budget Registry — pre-configured multi-budget, multi-server support.
 *
 * Budgets are declared via environment variables:
 *
 *   # Default budget (always present, from existing ACTUAL_* vars)
 *   BUDGET_DEFAULT_NAME=My Budget        # optional, defaults to "Default"
 *   ACTUAL_SERVER_URL=http://actual:5006
 *   ACTUAL_PASSWORD=secret
 *   ACTUAL_BUDGET_SYNC_ID=uuid-here
 *   ACTUAL_BUDGET_PASSWORD=              # optional, for E2E-encrypted budgets
 *
 *   # Additional named budgets — each group can point to a different server
 *   BUDGET_1_NAME=Shared Family Account
 *   BUDGET_1_SERVER_URL=http://actual:5006    # optional, falls back to ACTUAL_SERVER_URL
 *   BUDGET_1_PASSWORD=secret                   # optional, falls back to ACTUAL_PASSWORD
 *   BUDGET_1_SYNC_ID=uuid-here                 # required
 *   BUDGET_1_ENCRYPTION_PASSWORD=              # optional
 *
 *   BUDGET_2_NAME=Office
 *   BUDGET_2_SERVER_URL=http://actual-office:5006
 *   BUDGET_2_PASSWORD=officepassword
 *   BUDGET_2_SYNC_ID=uuid-here
 *
 * The AI uses `actual_budgets_list_available` to see all configured budgets,
 * then `actual_budgets_switch` with the budget name to switch between them.
 */

export interface BudgetConfig {
  name: string;
  serverUrl: string;
  password: string;
  syncId: string;
  encryptionPassword?: string;
}

/**
 * Parse the budget registry from environment variables.
 * Always includes the default budget from the provided defaults (ACTUAL_* vars).
 * Additional budgets are read from sequential BUDGET_n_* groups.
 */
/**
 * #289: hard ceiling for the post-loop numbering-gap scan. The BUDGET_N loop stops at the
 * first missing index; we then scan a BOUNDED range beyond it for orphaned budgets so a gap
 * warns instead of silently dropping them. Fixed and independent of the configured indices,
 * so a sparse or huge index can never cause unbounded work.
 */
export const MAX_BUDGET_SCAN = 100;

export function parseBudgetRegistry(
  env: NodeJS.ProcessEnv,
  defaults: { serverUrl: string; password: string; syncId: string; encryptionPassword?: string },
): Map<string, BudgetConfig> {
  const registry = new Map<string, BudgetConfig>();

  const defaultName = env.BUDGET_DEFAULT_NAME ?? 'Default';
  registry.set(defaultName.toLowerCase(), {
    name: defaultName,
    serverUrl: defaults.serverUrl,
    password: defaults.password,
    syncId: defaults.syncId,
    encryptionPassword: defaults.encryptionPassword,
  });

  let i = 1;
  while (env[`BUDGET_${i}_NAME`]) {
    const prefix = `BUDGET_${i}_`;
    const name = env[`${prefix}NAME`] as string;
    const serverUrl = env[`${prefix}SERVER_URL`] ?? defaults.serverUrl;
    const password = env[`${prefix}PASSWORD`] ?? defaults.password;
    const syncId = env[`${prefix}SYNC_ID`];
    if (!syncId) {
      console.error(
        `[CONFIG] BUDGET_${i}_SYNC_ID is required when BUDGET_${i}_NAME="${name}" is set`,
      );
      process.exit(1);
    }
    const encryptionPassword = env[`${prefix}ENCRYPTION_PASSWORD`];
    // Mirror the default-budget check (#161): never send an E2E encryption
    // password over an http:// upstream unless ALLOW_INSECURE_UPSTREAM is set.
    if (encryptionPassword && env.ALLOW_INSECURE_UPSTREAM !== 'true' && /^http:\/\//i.test(serverUrl)) {
      console.error(
        `[CONFIG] BUDGET_${i}_ENCRYPTION_PASSWORD is set but the upstream URL is http:// (${serverUrl}). ` +
        `Refusing to send the encryption password over plaintext (#161). ` +
        `Use https:// or set ALLOW_INSECURE_UPSTREAM=true to override.`,
      );
      process.exit(1);
    }
    registry.set(name.toLowerCase(), {
      name,
      serverUrl,
      password,
      syncId,
      encryptionPassword,
    });
    i++;
  }

  // #289: the loop above stops at the first missing BUDGET_${i}_NAME, so a gap in the
  // numbering silently drops every later budget (BUDGET_1 + BUDGET_3 with no BUDGET_2 loses
  // BUDGET_3). Scan a bounded range beyond the stop for any orphaned budget and warn once.
  // This does NOT change which budgets load; it only surfaces the misconfiguration. Only
  // index/name tokens are logged (never a password or encryption password). console.warn is
  // hijacked to winston in this process, consistent with the console.error fatal paths above.
  const orphaned: number[] = [];
  for (let k = i + 1; k <= MAX_BUDGET_SCAN; k++) {
    if (env[`BUDGET_${k}_NAME`]) orphaned.push(k);
  }
  if (orphaned.length > 0) {
    // When the gap is at BUDGET_1 (user started extra budgets at BUDGET_2), i stays 1, so
    // "stops at BUDGET_0" would be nonsensical: phrase that case as a start-at-1 rule.
    const stop = i === 1
      ? 'BUDGET_1_NAME is missing, so no extra budgets load (extra-budget numbering must start at BUDGET_1)'
      : `BUDGET_${i}_NAME is missing, so BUDGET numbering stops at BUDGET_${i - 1}`;
    console.warn(
      `[CONFIG] ${stop} and these later budgets are IGNORED: ${orphaned.map((k) => `BUDGET_${k}`).join(', ')}. ` +
      `Number budgets consecutively from 1 (no gaps).`,
    );
  }

  return registry;
}
