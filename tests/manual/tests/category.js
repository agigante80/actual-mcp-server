/**
 * tests/category.js
 *
 * CATEGORY TESTS — create and update an MCP-Cat-* category inside the group
 * created by categoryGroupTests.
 *
 * Reads from context:  categoryGroupId (skips if absent)
 * Writes to context:   categoryId
 */

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function categoryTests(client, context) {
  const { callTool } = client;
  console.log("\n-- Running CATEGORY TESTS --");

  if (!context.categoryGroupId) {
    console.log("⚠ No MCP category group available - skipping category tests");
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Helper: flatten grouped category response
  function flattenCats(catsData) {
    const raw = catsData.result || catsData || [];
    return Array.isArray(raw)
      ? raw.flatMap(g => g.categories || [g]).filter(c => c && c.id)
      : [];
  }

  // Create
  console.log("\nCreating test category in MCP category group...");
  const newCat = await callTool("actual_categories_create", {
    name: `MCP-Cat-${timestamp}`,
    group_id: context.categoryGroupId,
  });
  const categoryId = newCat.categoryId || newCat.id || newCat.result || newCat;
  console.log("✓ Created category:", categoryId);
  context.categoryId = categoryId;

  // Verify create
  {
    const found = flattenCats(await callTool("actual_categories_get", {})).find(c => c.id === categoryId);
    if (!found) console.log("  ❌ Verify create: category not found in list (id:", categoryId, ")");
    else if (found.name === `MCP-Cat-${timestamp}`) console.log(`  ✓ Verify create: name="${found.name}"`);
    else console.log(`  ❌ Verify create: expected "MCP-Cat-${timestamp}", got "${found.name}"`);
  }

  // Update
  console.log("\nUpdating category...");
  await callTool("actual_categories_update", {
    id: categoryId,
    fields: { name: `MCP-Cat-${timestamp}-Updated` },
  });
  console.log("✓ Category updated");

  // Verify update
  {
    const found = flattenCats(await callTool("actual_categories_get", {})).find(c => c.id === categoryId);
    if (!found) console.log("  ❌ Verify update: category not found in list");
    else if (found.name === `MCP-Cat-${timestamp}-Updated`) console.log(`  ✓ Verify update: name="${found.name}"`);
    else console.log(`  ❌ Verify update: expected "MCP-Cat-${timestamp}-Updated", got "${found.name}"`);
  }

  console.log("  (Category deletion tested in cleanup phase)");
}
