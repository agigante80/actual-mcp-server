/**
 * Build a "not found" error message with a next-step hint.
 * @param entityType  Human-readable entity name, e.g. "Account", "Category"
 * @param id          The ID that was not found
 * @param listTool    MCP tool name the caller should use to get valid IDs
 */
export function notFoundMsg(entityType: string, id: string, listTool: string): string {
  return `${entityType} "${id}" not found. Use ${listTool} to list available ${entityType.toLowerCase()}s.`;
}

/**
 * Build a "constraint error" message for SQLite-level failures.
 * @param entityType  Human-readable entity name
 * @param id          The ID that failed
 * @param listTool    MCP tool name for listing
 */
export function constraintErrorMsg(entityType: string, id: string, listTool: string): string {
  return `Failed to delete ${entityType.toLowerCase()} "${id}". ` +
    `It may be referenced by other records. Use ${listTool} to verify it exists.`;
}
