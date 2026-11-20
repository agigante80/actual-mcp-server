// #688: this flag selects the published form and input grammar of the budget tools. The adapter
// enforces authorization. It reads the environment directly, on purpose: tool schemas are also
// imported by the offline docs generator (npm run docs:gen), which runs with no server config,
// so importing config.js here makes that generator exit on the missing ACTUAL_* settings. A value
// the config schema refuses (discovery without OIDC and the Actual ACL source) stops the server
// at startup, so a running server never carries a flag the schema did not accept.
export const showDiscoveredBudgets = process.env.AUTH_BUDGET_DISCOVERY === 'true';

export function validBudgetSelector(value: string): boolean {
  return showDiscoveredBudgets
    ? !/[\x00-\x1f\x7f-\x9f]/.test(value)
    : /^[\p{L}\p{N} ._\-]+$/u.test(value);
}

/** The refusal text for a selector `validBudgetSelector` rejects, matching the active grammar. */
export function budgetSelectorRule(field: string): string {
  return showDiscoveredBudgets
    ? `${field} must not contain control characters`
    : `${field} must contain only letters, digits, spaces, dots, underscores, and hyphens`;
}
