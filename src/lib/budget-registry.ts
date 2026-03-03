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
    registry.set(name.toLowerCase(), {
      name,
      serverUrl,
      password,
      syncId,
      encryptionPassword: env[`${prefix}ENCRYPTION_PASSWORD`],
    });
    i++;
  }

  return registry;
}
