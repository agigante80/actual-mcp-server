import { fail, skip } from '../assert.js';
/**
 * tests/tags.js
 *
 * TAG TESTS: list, create, update, delete against the LIVE server (#451).
 *
 * WHY THIS MODULE EXISTS. The four tags tools shipped in #184 with unit and E2E coverage but
 * no live-server block, so they were never exercised by the dual-transport run that authorises
 * a release. The completeness guard added with #429 measured that and #451 closed it.
 *
 * WHY ITS OWN MODULE. Tags touch no other entity: no account, no category, no transaction.
 * Appending them to payee.js or category.js would braid two unrelated fixtures into one
 * module's cleanup, which is how residue escapes. Self-contained here, created and deleted
 * inside this function.
 *
 * TWO PROPERTIES OF THE TOOLS SHAPE EVERY ASSERTION BELOW, both from their descriptions:
 *   - actual_tags_create is an UPSERT ON THE WORD. A fixed fixture name would silently reuse
 *     a previous run's row and the create assertion would pass having created nothing, so the
 *     name is timestamped like every other module's fixture.
 *   - actual_tags_delete is a SOFT delete (tombstone). Verification is therefore ABSENCE FROM
 *     THE LIST, never an error on re-read.
 *
 * Reads from context:  (none)
 * Writes to context:   (none: the fixture is created and removed here)
 */

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function tagTests(client, context) {
  const { callTool } = client;
  console.log("\n-- Running TAG TESTS --");

  const TS = Date.now();
  const TAG_WORD = `MCP-Test-tag-${TS}`;
  const RENAMED = `MCP-Test-tag-${TS}-renamed`;
  const NIL_UUID = '00000000-0000-0000-0000-000000000000';

  /**
   * The id from a create response. The runner unwraps a tool result, and this tool returns the
   * id as a BARE STRING, not as an object with `.id`. Reading only `.id` cost a release gate:
   * the create assertion failed, `tagId` stayed null, the `finally` skipped the delete, and the
   * tag survived as residue. Accept both shapes rather than betting on one.
   */
  function idOf(res) {
    if (typeof res === 'string') return res;
    if (res && typeof res.result === 'string') return res.result;
    return res?.id || res?.result?.id || null;
  }

  /** The tag list, normalised: the tools return an array, the runner may wrap it. */
  async function allTags() {
    const res = await callTool("actual_tags_list", {});
    return res?.result || res || [];
  }

  let tagId = null;

  try {
    // --- list (read-only baseline) ---
    console.log("\nListing existing tags...");
    const before = await allTags();
    if (!Array.isArray(before)) {
      fail(`tags_list did not return an array: ${JSON.stringify(before).slice(0, 120)}`);
      return;
    }
    console.log(`✓ Found tags: ${before.length}`);

    // --- create ---
    console.log(`\nCreating tag "${TAG_WORD}"...`);
    const created = await callTool("actual_tags_create", {
      tag: TAG_WORD,
      color: '#33aa33',
      description: 'Created by the MCP integration suite',
    });
    tagId = idOf(created);
    if (!tagId) {
      fail(`tags_create returned no id: ${JSON.stringify(created).slice(0, 160)}`);
      return;
    }
    console.log(`✓ Created tag id: ${tagId}`);

    // Verify by READ-BACK, never by trusting the create response (#347/#349).
    const afterCreate = await allTags();
    if (!afterCreate.find((t) => t.id === tagId)) {
      fail("Verify create: the new tag is not in actual_tags_list");
    } else {
      console.log("  ✓ Verify create: tag present in list");
    }

    // --- upsert semantics: the same word must return the SAME id and not grow the list ---
    // This is the property most likely to surprise a caller, and it is stated in the tool
    // description, so it is pinned here rather than assumed.
    console.log("\nRe-creating the SAME tag word (documented upsert)...");
    const recreated = await callTool("actual_tags_create", { tag: TAG_WORD });
    const recreatedId = idOf(recreated);
    if (recreatedId !== tagId) {
      fail(`Upsert: expected the same id back, got ${recreatedId} (was ${tagId})`);
    } else {
      const afterUpsert = await allTags();
      const matches = afterUpsert.filter((t) => t.tag === TAG_WORD).length;
      if (matches !== 1) {
        fail(`Upsert: expected exactly 1 tag named "${TAG_WORD}", found ${matches}`);
      } else {
        console.log("  ✓ Upsert: same id returned and the list did not grow");
      }
    }

    // --- update ---
    console.log("\nUpdating the tag...");
    await callTool("actual_tags_update", {
      id: tagId,
      tag: RENAMED,
      color: '#112233',
      description: 'Updated by the MCP integration suite',
    });
    const afterUpdate = await allTags();
    const updated = afterUpdate.find((t) => t.id === tagId);
    if (!updated) {
      fail("Verify update: the tag vanished from the list");
    } else if (updated.tag !== RENAMED) {
      fail(`Verify update: expected tag "${RENAMED}", got "${updated.tag}"`);
    } else {
      console.log("  ✓ Verify update: the new word is in the list");
    }

    // --- NEGATIVE: update a well-formed but non-existent id ---
    // Both write tools advertise a PRE-FLIGHT guard over an API that would otherwise silently
    // no-op. A silent success here is the #347 class (reporting success for nothing), so this
    // case is what proves the guard exists at all.
    console.log("\nNEGATIVE: tags_update with a non-existent id...");
    try {
      const res = await callTool("actual_tags_update", { id: NIL_UUID, tag: 'should-not-exist' });
      fail(`Expected a not-found error, got: ${JSON.stringify(res).slice(0, 120)}`);
    } catch (err) {
      const msg = err.message || String(err);
      if (/not found/i.test(msg)) {
        console.log(`  ✓ tags_update non-existent id refused: ${msg.slice(0, 100)}`);
      } else {
        fail(`Threw, but not with a not-found message: ${msg.slice(0, 120)}`);
      }
    }

    // --- NEGATIVE: update with no fields (schema refine) ---
    console.log("\nNEGATIVE: tags_update with no fields to change...");
    try {
      const res = await callTool("actual_tags_update", { id: tagId });
      fail(`Expected a validation error, got: ${JSON.stringify(res).slice(0, 120)}`);
    } catch (err) {
      const msg = err.message || String(err);
      if (/at least one/i.test(msg)) {
        console.log(`  ✓ tags_update with no fields refused: ${msg.slice(0, 100)}`);
      } else {
        fail(`Threw, but not with the expected validation message: ${msg.slice(0, 120)}`);
      }
    }

    // --- NEGATIVE: delete a non-existent id ---
    console.log("\nNEGATIVE: tags_delete with a non-existent id...");
    try {
      const res = await callTool("actual_tags_delete", { id: NIL_UUID });
      fail(`Expected a not-found error, got: ${JSON.stringify(res).slice(0, 120)}`);
    } catch (err) {
      const msg = err.message || String(err);
      if (/not found/i.test(msg)) {
        console.log(`  ✓ tags_delete non-existent id refused: ${msg.slice(0, 100)}`);
      } else {
        fail(`Threw, but not with a not-found message: ${msg.slice(0, 120)}`);
      }
    }
  } finally {
    // ALWAYS remove the fixture, including when an assertion above failed. The suite asserts
    // zero residue at the end of a full run, and a module that only cleans up on the happy
    // path leaves the NEXT run to explain the mess.
    if (tagId) {
      console.log("\nDeleting test tag...");
      try {
        await callTool("actual_tags_delete", { id: tagId });
        // Soft delete: verify ABSENCE from the list, not an error on read.
        const afterDelete = await allTags();
        if (afterDelete.find((t) => t.id === tagId)) {
          fail("Verify delete: the tag is still present in actual_tags_list");
        } else {
          console.log("  ✓ Verify delete: tag no longer in list");
        }
      } catch (err) {
        fail(`Delete threw unexpectedly: ${String(err.message || err).slice(0, 120)}`);
      }
    } else {
      // NO id, but a tag may still EXIST: that is exactly what happened on the first live run.
      // The create succeeded, the id was read from the wrong shape, the assertion failed, and
      // this branch skipped the delete, so the tag survived and failed the zero-residue gate.
      // Recover by NAME rather than trusting that no id means no object.
      const strays = (await allTags()).filter((t) => t?.tag === TAG_WORD || t?.tag === RENAMED);
      if (strays.length === 0) {
        skip("Skipping tag delete (no tag was created)");
      } else {
        console.log(`\nCleaning up ${strays.length} tag(s) found by name (no id was captured)...`);
        for (const stray of strays) {
          try {
            await callTool("actual_tags_delete", { id: stray.id });
            console.log(`  \u2713 Removed stray tag "${stray.tag}"`);
          } catch (err) {
            fail(`Could not remove stray tag "${stray.tag}": ${String(err.message || err).slice(0, 100)}`);
          }
        }
      }
    }
  }
}
