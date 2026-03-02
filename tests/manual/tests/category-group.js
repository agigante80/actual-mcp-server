/**
 * tests/category-group.js
 *
 * CATEGORY GROUP TESTS — create and update an MCP-Group-* category group.
 *
 * Reads from context:  (none)
 * Writes to context:   categoryGroupId
 */

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function categoryGroupTests(client, context) {
  const { callTool } = client;
  console.log("\n-- Running CATEGORY GROUP TESTS --");

  const groupsData = await callTool("actual_category_groups_get", {});
  const groups = groupsData.groups || groupsData || [];
  console.log("✓ Category groups found:", groups.length);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Create
  console.log("\nCreating test category group...");
  const newGroup = await callTool("actual_category_groups_create", {
    name: `MCP-Group-${timestamp}`,
  });
  const groupId = newGroup.id || newGroup.result || newGroup;
  console.log("✓ Created category group:", groupId);
  context.categoryGroupId = groupId;

  // Verify create
  {
    const gd = await callTool("actual_category_groups_get", {});
    const all = gd.groups || gd || [];
    const found = Array.isArray(all) ? all.find(g => g.id === groupId) : null;
    if (!found) console.log("  ❌ Verify create: group not found in list (id:", groupId, ")");
    else if (found.name === `MCP-Group-${timestamp}`) console.log(`  ✓ Verify create: name="${found.name}"`);
    else console.log(`  ❌ Verify create: expected "MCP-Group-${timestamp}", got "${found.name}"`);
  }

  // Update
  console.log("\nUpdating category group...");
  await callTool("actual_category_groups_update", {
    id: groupId,
    fields: { name: `MCP-Group-${timestamp}-Updated` },
  });
  console.log("✓ Category group updated");

  // Verify update
  {
    const gd = await callTool("actual_category_groups_get", {});
    const all = gd.groups || gd || [];
    const found = Array.isArray(all) ? all.find(g => g.id === groupId) : null;
    if (!found) console.log("  ❌ Verify update: group not found in list");
    else if (found.name === `MCP-Group-${timestamp}-Updated`) console.log(`  ✓ Verify update: name="${found.name}"`);
    else console.log(`  ❌ Verify update: expected "MCP-Group-${timestamp}-Updated", got "${found.name}"`);
  }

  console.log("  (Category group deletion tested in cleanup phase)");
}
