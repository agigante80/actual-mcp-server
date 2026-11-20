// Tool schemas are also imported by the offline docs generator, before server config exists.
// This flag selects the published form and input grammar. The adapter enforces authorization.
export const showDiscoveredBudgets = process.env.AUTH_BUDGET_DISCOVERY === 'true';

export function validBudgetSelector(value: string): boolean {
  return showDiscoveredBudgets
    ? !/[\x00-\x1f\x7f-\x9f]/.test(value)
    : /^[\p{L}\p{N} ._\-]+$/u.test(value);
}
