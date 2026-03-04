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

  // category_groups_delete — create a disposable group, negative UUID test, delete, verify absence
  // NOTE: We create a second group for the delete test so context.categoryGroupId (needed by category tests) remains intact.
  // FIXED(BUG-10): actual_category_groups_delete with nil-UUID now returns { success: false, error } actionable error
  console.log("\nTesting category_groups_delete (CG3): creating disposable group for delete test...");
  const disposableGroup = await callTool("actual_category_groups_create", {
    name: `MCP-Group-Del-${timestamp}`,
  });
  const disposableGroupId = disposableGroup.id || disposableGroup.result || disposableGroup;
  console.log("✓ Created disposable group:", disposableGroupId);

  console.log("\nTesting category_groups_delete (negative nil-UUID)...");
  try {
    const nilResult = await callTool("actual_category_groups_delete", {
      id: '00000000-0000-0000-0000-000000000000',
    });
    const success = nilResult?.success ?? nilResult?.result?.success;
    if (success === false || nilResult?.error) {
      console.log("  ✓ Negative nil-UUID delete: returned error/false correctly");
    } else {
      console.log("  ⚠ Negative nil-UUID delete: unexpectedly accepted (result:", JSON.stringify(nilResult).slice(0, 120), ")");
    }
  } catch (err) {
    console.log("  ✓ Negative nil-UUID delete: threw as expected:", err.message?.slice(0, 80));
  }

  if (disposableGroupId) {
    console.log(`\nDeleting disposable category group (${disposableGroupId})...`);
    try {
      await callTool("actual_category_groups_delete", { id: disposableGroupId });
      console.log("✓ Delete call completed");

      // Verify absence
      const gd = await callTool("actual_category_groups_get", {});
      const all = gd.groups || gd || [];
      const stillExists = Array.isArray(all) ? all.find(g => g.id === disposableGroupId) : null;
      if (stillExists) {
        console.log("  ❌ Verify delete: disposable group still present in list");
      } else {
        console.log("  ✓ Verify delete: disposable group no longer in list");
      }
    } catch (err) {
      console.log("  ❌ Delete threw unexpectedly:", err.message?.slice(0, 120));
    }
  }
}
