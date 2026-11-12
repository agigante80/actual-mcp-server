// src/lib/tool-aliases.ts
//
// #652: deprecated tool names. Tool names are lower snake_case (actual_<domain>_<action>);
// the six budget tools below were camelCase until v0.28.0 and were renamed. A call or an
// MCP_TOOLS entry that uses an old name still works: the old name resolves to the new one
// BEFORE registration and publication are checked, so every policy (MCP_READ_ONLY,
// MCP_TOOLSETS, MCP_TOOLS) applies to the resolved name and an alias can never reach a
// tool its new name could not. Aliases are never listed in tools/list (the pattern of
// github-mcp-server's deprecated tool aliases).
//
// Removal: in the first minor release after 2027-02-01. Until then keep this map; the
// removal ticket is filed in the Backlog milestone.

/** Old (deprecated) name to the registered name it resolves to. */
export const DEPRECATED_TOOL_ALIASES: ReadonlyMap<string, string> = new Map([
  ['actual_budgets_getMonth', 'actual_budgets_get_month'],
  ['actual_budgets_getMonths', 'actual_budgets_get_months'],
  ['actual_budgets_setAmount', 'actual_budgets_set_amount'],
  ['actual_budgets_setCarryover', 'actual_budgets_set_carryover'],
  ['actual_budgets_holdForNextMonth', 'actual_budgets_hold_for_next_month'],
  ['actual_budgets_resetHold', 'actual_budgets_reset_hold'],
]);

/** The date after which the first minor release removes the aliases. */
export const TOOL_ALIAS_REMOVAL_AFTER = '2027-02-01';

/**
 * The registered name for `name`: the alias target when `name` is a deprecated alias,
 * otherwise `name` unchanged. A Map lookup, so an inherited property name such as
 * "constructor" is never an alias.
 */
export function resolveToolAlias(name: string): string {
  return DEPRECATED_TOOL_ALIASES.get(name) ?? name;
}
